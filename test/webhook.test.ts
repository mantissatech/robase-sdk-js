import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SignatureVerificationError,
  parseWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../src/index.ts';

const SECRET = 'whsec_test';

describe('signWebhookPayload', () => {
  // Must match the Go server's core.SignWebhookPayload byte for byte:
  // lowercase hex HMAC-SHA256 over the raw body.
  it('matches the server fixture', async () => {
    const signature = await signWebhookPayload('hello', 'secret');
    assert.equal(
      signature,
      '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b',
    );
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({
    event: 'otp.sent',
    timestamp: '2026-07-22T10:00:00Z',
    data: {},
  });

  it('accepts a correct signature', async () => {
    const signature = await signWebhookPayload(body, SECRET);
    assert.equal(await verifyWebhookSignature(body, signature, SECRET), true);
  });

  it('rejects the wrong secret', async () => {
    const signature = await signWebhookPayload(body, SECRET);
    assert.equal(await verifyWebhookSignature(body, signature, 'other'), false);
  });

  it('rejects a tampered body', async () => {
    const signature = await signWebhookPayload(body, SECRET);
    assert.equal(await verifyWebhookSignature(body + ' ', signature, SECRET), false);
  });

  it('rejects a missing signature', async () => {
    assert.equal(await verifyWebhookSignature(body, null, SECRET), false);
    assert.equal(await verifyWebhookSignature(body, '', SECRET), false);
  });

  it('accepts raw bytes as well as strings', async () => {
    const bytes = new TextEncoder().encode(body);
    const signature = await signWebhookPayload(bytes, SECRET);
    assert.equal(await verifyWebhookSignature(body, signature, SECRET), true);
  });
});

describe('parseWebhook', () => {
  it('narrows otp events', async () => {
    const body = JSON.stringify({
      event: 'otp.verified',
      timestamp: '2026-07-22T10:00:00Z',
      data: {
        id: 'otp_1',
        phone_number: '+2348012345678',
        country_code: 'NG',
        status: 'verified',
        provider: 'beem',
        credit_cost: 1,
      },
    });

    const event = await parseWebhook(body, await signWebhookPayload(body, SECRET), SECRET);
    assert.equal(event.event, 'otp.verified');
    if (event.event === 'otp.verified') {
      assert.equal(event.data.id, 'otp_1');
      assert.equal(event.data.provider, 'beem');
    }
  });

  it('narrows sms events', async () => {
    const body = JSON.stringify({
      event: 'sms.delivered',
      timestamp: '2026-07-22T10:00:00Z',
      data: {
        id: 'msg_1',
        phone_number: '+2348012345678',
        country_code: 'NG',
        message: 'hi',
        status: 'delivered',
        provider: 'termii',
        credit_cost: 1,
      },
    });

    const event = await parseWebhook(body, await signWebhookPayload(body, SECRET), SECRET);
    if (event.event === 'sms.delivered') {
      assert.equal(event.data.message, 'hi');
    } else {
      assert.fail('expected sms.delivered');
    }
  });

  it('narrows credit events', async () => {
    const body = JSON.stringify({
      event: 'credit_balance.low',
      timestamp: '2026-07-22T10:00:00Z',
      data: { workspace_id: 'ws_1', balance: 42, threshold: 100 },
    });

    const event = await parseWebhook(body, await signWebhookPayload(body, SECRET), SECRET);
    if (event.event === 'credit_balance.low') {
      assert.equal(event.data.balance, 42);
      assert.equal(event.data.threshold, 100);
    } else {
      assert.fail('expected credit_balance.low');
    }
  });

  it('throws on a bad signature', async () => {
    const body = JSON.stringify({ event: 'otp.sent', timestamp: '', data: {} });
    await assert.rejects(
      parseWebhook(body, 'deadbeef', SECRET),
      SignatureVerificationError,
    );
  });
});
