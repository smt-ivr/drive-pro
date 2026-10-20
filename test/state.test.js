import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signState, verifyState } from '../src/auth/state.js';

test('round-trips a signed state', async () => {
  const state = await signState({ origin: 'https://smti.uk', returnTo: 'https://smti.uk/drive-pro/' }, 'secret');
  const payload = await verifyState(state, 'secret');
  assert.equal(payload.origin, 'https://smti.uk');
  assert.equal(payload.returnTo, 'https://smti.uk/drive-pro/');
});

test('rejects tampered, foreign and expired states', async () => {
  const state = await signState({ origin: 'https://smti.uk' }, 'secret');
  const [body, sig] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ origin: 'https://evil.example', iat: Date.now() })).toString('base64url');

  assert.equal(await verifyState(`${forged}.${sig}`, 'secret'), null);
  assert.equal(await verifyState(state, 'other-secret'), null);
  assert.equal(await verifyState(`${body}.`, 'secret'), null);
  assert.equal(await verifyState(null, 'secret'), null);
  assert.equal(await verifyState(state, 'secret', Date.now() + 16 * 60 * 1000), null);
});
