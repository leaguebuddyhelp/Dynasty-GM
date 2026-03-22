import crypto from 'crypto';

import { registerHttpRoute, startHealthcheckServer } from './healthcheck.js';
import { createPendingClaim, inferPlanFromStripeCheckoutSession } from './claim_service.js';

let registered = false;

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseStripeSignature(headerValue) {
  const parts = String(headerValue || '').split(',').map((part) => part.trim()).filter(Boolean);
  const parsed = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value) parsed[key] = value;
  }
  return parsed;
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parsed = parseStripeSignature(signatureHeader);
  const timestamp = parsed.t;
  const signature = parsed.v1;
  if (!timestamp || !signature || !secret) return false;
  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return timingSafeEquals(expected, signature);
}

function shouldHandleEvent(event) {
  const type = String(event?.type || '');
  return type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded';
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function handleStripeWebhook(req, res) {
  try {
    const secret = String(process.env.LB_STRIPE_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'webhook_secret_missing' }));
      return;
    }

    const rawBuffer = await readRawBody(req);
    const rawBody = rawBuffer.toString('utf8');
    const signature = req.headers['stripe-signature'];
    if (!verifyStripeSignature(rawBody, signature, secret)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_signature' }));
      return;
    }

    const event = JSON.parse(rawBody);
    if (!shouldHandleEvent(event)) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ignored: true }));
      return;
    }

    const session = event?.data?.object || {};
    const plan = inferPlanFromStripeCheckoutSession(session);
    if (!plan) {
      console.warn('[stripe-claims] unable to infer plan', {
        eventType: event?.type,
        eventId: event?.id,
        sessionId: session?.id,
        paymentLinkId: session?.payment_link,
        amountTotal: session?.amount_total,
      });
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, created: false, reason: 'plan_not_inferred' }));
      return;
    }

    const claim = createPendingClaim({
      paymentReference: session?.payment_intent || session?.id,
      alternatePaymentReferences: [session?.payment_intent, session?.id],
      plan,
      paymentSource: 'stripe_payment_link',
      stripeEventId: event?.id,
      stripeSessionId: session?.id,
      paymentLinkId: session?.payment_link,
      amountTotal: session?.amount_total,
      currency: session?.currency,
      customerEmail: session?.customer_details?.email || session?.customer_email || null,
      customerName: session?.customer_details?.name || null,
      metadata: session?.metadata || null,
      source: 'stripe_webhook',
    });

    console.log('[stripe-claims] claim created', {
      plan: claim.plan,
      claimCode: claim.claimCode,
      paymentReference: claim.paymentReference,
      eventId: event?.id,
    });

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, created: true }));
  } catch (error) {
    console.warn('[stripe-claims] webhook failed', error?.message || error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
  }
}

export function startStripeClaimsWebhook() {
  if (registered) return;
  registerHttpRoute({
    method: 'POST',
    path: '/stripe/webhook',
    handler: handleStripeWebhook,
  });
  startHealthcheckServer();
  registered = true;
  console.log('[stripe-claims] route registered at /stripe/webhook');
}

export default {
  startStripeClaimsWebhook,
};
