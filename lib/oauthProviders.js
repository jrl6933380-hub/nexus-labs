// lib/oauthProviders.js
// GitHub and Vercel OAuth adapters for BYO tenant connections (task
// 09). Each provider exposes authorizeUrl() (where to send the user)
// and handleCallback() (exchange the returned code for a token, plus
// whatever non-secret account info is worth recording).
//
// Vercel's install flow is a marketplace-style "Add Integration" page
// (vercel.com/integrations/{slug}/new), not a classic /oauth/authorize
// endpoint -- it still accepts a state param and echoes it back on
// the configured redirect URL, which is what makes correlating the
// callback to a tenant possible. Token exchange for both providers
// happens against each provider's own token endpoint.

const VERCEL_INTEGRATION_SLUG = process.env.VERCEL_INTEGRATION_SLUG || 'nexus';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function exchangeGithubCode(code) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
      client_secret: requireEnv('GITHUB_OAUTH_CLIENT_SECRET'),
      code,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error_description || data.error || 'GitHub token exchange failed');
  return { accessToken: data.access_token, scope: data.scope };
}

async function fetchGithubAccountLogin(accessToken) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nexus-labs' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.login || null;
  } catch {
    return null;
  }
}

async function exchangeVercelCode(code, redirectUri) {
  const res = await fetch('https://api.vercel.com/v2/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('VERCEL_OAUTH_CLIENT_ID'),
      client_secret: requireEnv('VERCEL_OAUTH_CLIENT_SECRET'),
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || data.error_description || 'Vercel token exchange failed');
  return { accessToken: data.access_token, teamId: data.team_id || null, installationId: data.installation_id || null };
}

export const PROVIDERS = {
  github: {
    authorizeUrl({ redirectUri, state }) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', requireEnv('GITHUB_OAUTH_CLIENT_ID'));
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'repo');
      url.searchParams.set('state', state);
      return url.toString();
    },
    async handleCallback({ code }) {
      const { accessToken, scope } = await exchangeGithubCode(code);
      const accountLogin = await fetchGithubAccountLogin(accessToken);
      return { accessToken, refreshToken: null, expiresAt: null, metadata: { accountLogin, scope } };
    },
  },
  vercel: {
    authorizeUrl({ state }) {
      // Vercel's install page, not a raw OAuth authorize endpoint --
      // the redirect URL itself is configured in the Integration
      // Console, not passed here.
      const url = new URL(`https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new`);
      url.searchParams.set('state', state);
      return url.toString();
    },
    async handleCallback({ code, redirectUri }) {
      const { accessToken, teamId, installationId } = await exchangeVercelCode(code, redirectUri);
      return { accessToken, refreshToken: null, expiresAt: null, metadata: { teamId, installationId } };
    },
  },
};

export function requireProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown OAuth provider: ${name}`);
  return provider;
}
