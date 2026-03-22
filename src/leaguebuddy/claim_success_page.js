import { registerHttpRoute, startHealthcheckServer } from './healthcheck.js';
import { getPendingClaimByPaymentReference, isClaimUsable } from './claim_service.js';

let registered = false;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getQueryParam(req, name) {
    try {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1');
        return url.searchParams.get(name);
    } catch {
        return null;
    }
}

function renderPage({ title, bodyHtml }) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background: #0b1220; color: #e6edf7; }
      .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px; }
      .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); border-radius: 14px; padding: 22px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.5; }
      code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 8px; }
      .claim { font-size: 22px; font-weight: 700; letter-spacing: 0.06em; padding: 14px 16px; border-radius: 12px; border: 1px dashed rgba(255,255,255,0.25); background: rgba(87,242,135,0.10); margin: 14px 0; word-break: break-word; }
      .muted { color: rgba(230,237,247,0.74); }
      .steps { margin: 12px 0 0; padding-left: 18px; }
      .steps li { margin: 6px 0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        ${bodyHtml}
      </div>
      <p class="muted" style="margin-top:14px;">If you have issues, contact support and include the email you used at checkout.</p>
    </div>
  </body>
</html>`;
}

async function resolveClaimWithRetry(ref, { attempts = 8, delayMs = 750 } = {}) {
    let claim = null;
    for (let i = 0; i < attempts; i++) {
        claim = getPendingClaimByPaymentReference(ref);
        if (claim) return claim;
        await sleep(delayMs);
    }
    return null;
}

async function handleClaimSuccess(req, res) {
    const sessionId = getQueryParam(req, 'session_id');
    const paymentIntent = getQueryParam(req, 'payment_intent');
    const ref = String(sessionId || paymentIntent || '').trim();

    if (!ref) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderPage({
            title: 'Missing reference',
            bodyHtml: [
                '<h1>Missing payment reference</h1>',
                '<p class="muted">This page needs a <code>session_id</code> (cs_...) from Stripe.</p>',
            ].join(''),
        }));
        return;
    }

    const claim = await resolveClaimWithRetry(ref);
    if (!claim) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderPage({
            title: 'Claim not found yet',
            bodyHtml: [
                '<h1>Almost done…</h1>',
                '<p>We haven\'t received the purchase confirmation yet. Wait 30–60 seconds and refresh this page.</p>',
                `<p class="muted">Reference: <code>${escapeHtml(ref)}</code></p>`,
            ].join(''),
        }));
        return;
    }

    if (!isClaimUsable(claim)) {
        res.writeHead(409, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderPage({
            title: 'Claim already used',
            bodyHtml: [
                '<h1>This claim was already redeemed</h1>',
                '<p>If you believe this is a mistake, contact support.</p>',
                `<p class="muted">Claim: <code>${escapeHtml(claim.claimCode || '')}</code></p>`,
            ].join(''),
        }));
        return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderPage({
        title: 'Your LEAGUEbuddy claim code',
        bodyHtml: [
            '<h1>Payment received ✅</h1>',
            '<p>Copy your claim code below. Then paste it in the Discord server you want to upgrade.</p>',
            `<div class="claim">${escapeHtml(claim.claimCode || '')}</div>`,
            '<p><strong>In Discord:</strong></p>',
            '<ol class="steps">',
            '<li>Go to the server (guild) you want upgraded.</li>',
            '<li>Run <code>/claim-plan</code> and enter the code above.</li>',
            '<li>Run <code>/plan</code> to confirm your server is active.</li>',
            '</ol>',
        ].join(''),
    }));
}

export function startClaimSuccessPage() {
    if (registered) return;
    registerHttpRoute({ method: 'GET', path: '/claim', handler: handleClaimSuccess });
    startHealthcheckServer();
    registered = true;
    console.log('[claim-page] route registered at /claim');
}

export default {
    startClaimSuccessPage,
};
