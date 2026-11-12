import assert from 'node:assert/strict';
import { createEAClientFromEnv, retrieveBlazeSession } from '../src/madden/ea_client.js';

const token = { accessToken: 'test-private-access', refreshToken: 'test-private-refresh', console: 'ps5', gameYear: '2026' };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
const success = () => response(200, { userLoginInfo: { sessionKey: 'test-private-session', personaDetails: { personaId: 123 } } });
const quiet = { warn: console.warn, info: console.info };
const logs = [];
console.warn = (...args) => logs.push(args);
console.info = (...args) => logs.push(args);
try {
  let calls = 0;
  const delays = [];
  const requests = [];
  const session = await retrieveBlazeSession({ ...token, serviceOverride: 'saved-service', productOverride: 'saved-product' }, {
    maxAttempts: 3, baseDelayMs: 100,
    fetchImpl: async (_url, request) => {
      calls++;
      requests.push(request);
      return calls === 3 ? success() : response(200, { error: 'ERR_SYSTEM', detail: token.accessToken });
    },
    sleep: async (delay) => delays.push(delay),
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(session.sessionKey, 'test-private-session');
  for (const request of requests) {
    assert.equal(request.headers['X-BLAZE-ID'], 'saved-service');
    assert.equal(JSON.parse(request.body).productName, 'saved-product');
    assert.ok(request.signal instanceof AbortSignal);
  }

  for (const transient of [response(503, '<html>Service unavailable</html>'), response(429, {}), response(200, { error: 'ERR_TIMEOUT' })]) {
    calls = 0;
    await retrieveBlazeSession(token, { maxAttempts: 2, fetchImpl: async () => ++calls === 1 ? transient : success(), sleep: async () => {} });
    assert.equal(calls, 2);
  }
  calls = 0;
  await retrieveBlazeSession(token, { maxAttempts: 2, fetchImpl: async () => {
    if (++calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return success();
  }, sleep: async () => {} });
  assert.equal(calls, 2);

  for (const [status, body, code] of [
    [401, { error: 'AUTH_ERR_INVALID_TOKEN' }, 'EA_SESSION_AUTH'],
    [200, { error: 'AUTH_ERR_INVALID_TOKEN' }, 'EA_SESSION_AUTH'],
    [404, 'The Server Information was not found', 'EA_SESSION_SERVICE'],
    [200, { unexpected: true }, 'EA_SESSION_RESPONSE'],
  ]) {
    calls = 0;
    await assert.rejects(retrieveBlazeSession(token, {
      fetchImpl: async () => { calls++; return response(status, body); },
      sleep: async () => assert.fail('Permanent errors must not retry'),
    }), (error) => error.code === code && error.retryable === false);
    assert.equal(calls, 1);
  }

  calls = 0;
  await assert.rejects(retrieveBlazeSession(token, {
    maxAttempts: 3, fetchImpl: async () => { calls++; return response(500, `ERR_SYSTEM ${token.accessToken}`); }, sleep: async () => {},
  }), (error) => {
    assert.equal(error.code, 'EA_SESSION_TEMPORARY');
    assert.equal(error.attempts, 3);
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /reconnect/i);
    assert.ok(!JSON.stringify(error.diagnostics).includes(token.accessToken));
    return true;
  });
  assert.equal(calls, 3);

  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(retrieveBlazeSession(token, {
      maxAttempts: 1, timeoutMs: 10,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    }), (error) => error.code === 'EA_SESSION_TEMPORARY');
  } finally { clearTimeout(keepAlive); }

  let persisted = 0;
  calls = 0;
  const client = await createEAClientFromEnv({
    EA_ACCESS_TOKEN: token.accessToken, EA_REFRESH_TOKEN: token.refreshToken, EA_CONSOLE: token.console,
    EA_ACCESS_TOKEN_EXPIRES_AT: Date.now() + 3600000,
  }, {
    persistTokenUpdate: () => persisted++,
    fetchImpl: async () => ++calls === 1 ? response(500, { error: 'ERR_SYSTEM' }) : success(),
    sleep: async () => {},
  });
  assert.equal(typeof client.getTeams, 'function');
  assert.equal(calls, 2);
  assert.equal(persisted, 0, 'Session retries must not reset valid saved credentials');
  assert.ok(!JSON.stringify(logs).includes(token.accessToken));
  assert.ok(!JSON.stringify(logs).includes(token.refreshToken));
  assert.ok(!JSON.stringify(logs).includes('test-private-session'));
} finally {
  console.warn = quiet.warn;
  console.info = quiet.info;
}
console.log('PASS EA session retry/recovery, timeout, auth/service errors, saved service settings, credential preservation, and safe diagnostics');
