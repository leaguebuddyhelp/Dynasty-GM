 import assert from 'node:assert/strict';

import { inferPlanFromStripeCheckoutSession } from '../src/leaguebuddy/claim_service.js';

function withEnv(vars, fn) {
    const before = { ...process.env };
    Object.assign(process.env, vars);
    try {
        fn();
    } finally {
        process.env = before;
    }
}

withEnv({
    LB_STRIPE_PAYMENT_LINK_ID_STANDARD: 'plink_STANDARD',
    LB_STRIPE_PAYMENT_LINK_ID_PREMIUM: 'plink_PREMIUM',
    LB_STRIPE_STANDARD_AMOUNT_CENTS: '500',
    LB_STRIPE_PREMIUM_AMOUNT_CENTS: '1000',
}, () => {
    assert.equal(inferPlanFromStripeCheckoutSession({ metadata: { lb_plan: 'standard' } }), 'standard');
    assert.equal(inferPlanFromStripeCheckoutSession({ metadata: { plan: 'premium' } }), 'premium');

    assert.equal(inferPlanFromStripeCheckoutSession({ client_reference_id: 'lb_plan:standard' }), 'standard');

    assert.equal(inferPlanFromStripeCheckoutSession({ payment_link: 'plink_STANDARD' }), 'standard');
    assert.equal(
        inferPlanFromStripeCheckoutSession({ payment_link: 'https://buy.stripe.com/test_abc/plink_STANDARD' }),
        'standard',
    );

    assert.equal(inferPlanFromStripeCheckoutSession({ amount_total: 500 }), 'standard');
    assert.equal(inferPlanFromStripeCheckoutSession({ amount_subtotal: 1000 }), 'premium');
});

console.log('ok - stripe plan inference');
