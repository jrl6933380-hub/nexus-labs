// /public/browser-error-reporter.js
// Reports uncaught browser-side JS errors to the same Sentry project
// the API handlers already use (lib/sentry.js). Deliberately NOT the
// @sentry/browser SDK -- this is a ~60-line direct post to Sentry's
// ingest endpoint, because:
//
//   1. A debugging tool must never be able to break the page it's
//      debugging. There's no bundle to fail to load, and every code
//      path here is wrapped so a reporter failure stays silent.
//   2. It loads before anything else and catches errors from modules
//      that fail at import time -- exactly the class of failure that
//      leaves a completely blank screen with nothing rendered.
//
// Why this exists: a client-side crash blanked the mobile dashboard
// and there was no browser-side telemetry at all, so the only
// diagnosis available was guessing and reverting. Server errors were
// already captured; browser errors silently weren't.

const SENTRY_KEY = '4a552a592fb1cc665915d1c59d8ee34e';
const SENTRY_PROJECT = '4511994137346048';
const INGEST_URL = `https://o4511994101825536.ingest.us.sentry.io/api/${SENTRY_PROJECT}/store/?sentry_key=${SENTRY_KEY}&sentry_version=7`;

// One report per unique message per page load. A render loop that
// throws every frame must not turn into thousands of network posts.
const alreadyReported = new Set();

function report(kind, message, stack, extra = {}) {
  try {
    const key = `${kind}:${message}`;
    if (alreadyReported.has(key)) return;
    alreadyReported.add(key);

    const body = JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      logger: 'browser',
      message: { formatted: String(message).slice(0, 1000) },
      extra: {
        stack: String(stack || '').slice(0, 4000),
        url: window.location.href,
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        ...extra,
      },
      tags: { source: 'browser', page: window.location.pathname },
    });

    // keepalive so a report still goes out even if the error happened
    // during page load and the page is about to be abandoned.
    fetch(INGEST_URL, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch(() => {});
  } catch {
    // Reporting must never itself throw into the page.
  }
}

window.addEventListener('error', (event) => {
  report('error', event.message || 'Unknown error', event.error?.stack, {
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  report('unhandledrejection', reason?.message || String(reason), reason?.stack);
});

export { report };
