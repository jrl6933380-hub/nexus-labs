// lib/secretScan.js
// Board-integrity epic item #6: scan text before it ever reaches the
// board for token-shaped strings, and redact them. This is the real
// fix for what actually happened tonight - the Claude Routine trigger
// token leaked into a task's blocked_reason via an unredacted fetch
// error and briefly sat in board data before anyone caught it. That
// was fixed at its source (lib/routineWake.js) after the fact; this
// makes the same class of accident survive even when the source
// forgets to redact, by scanning at the one choke point everything
// passes through: lib/board.js's writes.
//
// DELIBERATE SCOPE LIMIT: only well-known prefixed secret formats are
// matched (ghp_, sk-, sk_live_, AKIA, eyJ...JWT, Bearer <token>).
// A naive "any long hex/base64 string" rule was considered and
// rejected: this board's own messages constantly reference full
// 40-character git commit SHAs and Vercel deployment IDs, which are
// exactly the shape a naive entropy check would flag. Redacting those
// would make the board's own history unreadable for zero real
// security benefit, since a bare commit hash isn't a credential.
// Prefixed-format matching has a much lower false-positive rate and
// still catches the exact class of leak that happened.

const SECRET_PATTERNS = [
  { name: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: 'aws_access_key_id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'stripe_key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g },
  { name: 'openai_style_key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9\-_.]{20,}\b/gi },
];

export function redactSecrets(text) {
  if (!text || typeof text !== 'string') return { text, redacted: false, matchedPatterns: [] };
  let result = text;
  const matchedPatterns = [];
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(result)) {
      matchedPatterns.push(name);
      re.lastIndex = 0;
      result = result.replace(re, '[REDACTED-POSSIBLE-SECRET]');
    }
  }
  return { text: result, redacted: matchedPatterns.length > 0, matchedPatterns };
}

export function redactFields(fields) {
  const out = {};
  const allMatched = new Set();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    const { text, matchedPatterns } = redactSecrets(value);
    out[key] = text;
    matchedPatterns.forEach((p) => allMatched.add(p));
  }
  const secret_check = allMatched.size > 0
    ? { flagged: true, matched_patterns: [...allMatched], flagged_at: Date.now() }
    : null;
  return { fields: out, secret_check };
}

export const __internals = { SECRET_PATTERNS };
