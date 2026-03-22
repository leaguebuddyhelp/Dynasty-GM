import { registerHttpRoute, startHealthcheckServer } from './healthcheck.js';

let registered = false;

function env(name) {
    const value = String(process.env[name] || '').trim();
    return value ? value : null;
}

function publicBaseUrlFromRequest(req) {
    try {
        const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
        const forwardedHost = String(req.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
        const host = forwardedHost || String(req.headers?.host || '').trim();
        const proto = forwardedProto || 'http';
        if (!host) return null;
        return `${proto}://${host}`;
    } catch {
        return null;
    }
}

function resolvePublicBaseUrl(req) {
    const explicit = env('LB_PUBLIC_BASE_URL');
    if (explicit) return explicit.replace(/\/+$/, '');
    const inferred = publicBaseUrlFromRequest(req);
    return inferred ? inferred.replace(/\/+$/, '') : null;
}

async function getStripeClient() {
    const key = env('LB_STRIPE_SECRET_KEY');
    if (!key) {
        const error = new Error('LB_STRIPE_SECRET_KEY is not set');
        error.code = 'stripe_secret_missing';
        throw error;
    }

    // Lazy import to avoid adding startup cost for non-billing deployments.
    const mod = await import('stripe');
    const Stripe = mod?.default || mod;
    return new Stripe(key, { apiVersion: '2024-06-20' });
}

function requireConfiguredPriceId(plan) {
    const key = plan === 'premium' ? 'LB_STRIPE_PREMIUM_PRICE_ID' : 'LB_STRIPE_STANDARD_PRICE_ID';
    const value = env(key);
    if (!value) {
        const error = new Error(`${key} is not set`);
        error.code = 'stripe_price_missing';
        throw error;
    }
    return value;
}

function wantsTestMode() {
    // Helpful for local smoke tests. In prod, live key decides behavior.
    return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

async function createCheckoutSession({ req, plan }) {
    const stripe = await getStripeClient();

    const baseUrl = resolvePublicBaseUrl(req);
    if (!baseUrl) {
        const error = new Error('Public base url could not be inferred; set LB_PUBLIC_BASE_URL');
        error.code = 'public_base_url_missing';
        throw error;
    }

    const priceId = requireConfiguredPriceId(plan);
    const successUrl = `${baseUrl}/claim?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/pricing`;

    return stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: `lb_plan:${plan}`,
        metadata: { lb_plan: plan },
        allow_promotion_codes: true,
    });
}

function redirect(res, url) {
    res.writeHead(303, {
        location: url,
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end('redirecting');
}

function jsonError(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

async function handleBuy(req, res, plan) {
    try {
        const session = await createCheckoutSession({ req, plan });
        if (!session?.url) {
            jsonError(res, 500, { ok: false, error: 'session_url_missing' });
            return;
        }
        redirect(res, session.url);
    } catch (err) {
        const message = err?.message || String(err);
        const code = err?.code || 'internal_error';
        const status = code === 'stripe_secret_missing' || code === 'stripe_price_missing' ? 503 : 500;
        jsonError(res, status, { ok: false, error: code, message });
    }
}

async function handleBuyStandard(req, res) {
    await handleBuy(req, res, 'standard');
}

async function handleBuyPremium(req, res) {
    await handleBuy(req, res, 'premium');
}

export function startStripeCheckoutBuyRoutes() {
    if (registered) return;

    registerHttpRoute({ method: 'GET', path: '/buy/standard', handler: handleBuyStandard });
    registerHttpRoute({ method: 'GET', path: '/buy/premium', handler: handleBuyPremium });

    startHealthcheckServer();
    registered = true;
    console.log('[stripe-buy] routes registered at /buy/standard and /buy/premium');
}

export default {
    startStripeCheckoutBuyRoutes,
};
