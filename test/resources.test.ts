import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ConflictError,
  MAX_MESSAGE_LENGTH,
  NotFoundError,
  ValidationError,
} from '../src/index.ts';
import { stubClient } from './helpers.ts';

describe('otp.send', () => {
  it('posts to /v1/otp/send and returns the record', async () => {
    const { client, requests } = stubClient({
      body: {
        id: '7f3a1c9e-0000-4000-8000-000000000001',
        phone_number: '+2348012345678',
        country_code: 'NG',
        credit_cost: 1,
        status: 'pending',
        code_length: 6,
        expires_at: '2026-07-22T10:10:00Z',
        created_at: '2026-07-22T10:00:00Z',
      },
    });

    const sent = await client.otp.send({ phone_number: '+2348012345678' });

    assert.equal(requests[0]!.method, 'POST');
    assert.equal(requests[0]!.url, 'https://api.test.local/v1/otp/send');
    assert.equal(sent.country_code, 'NG');
    assert.equal(sent.status, 'pending');
    assert.equal(sent.credit_cost, 1);
  });

  it('rejects a missing phone_number without calling the API', async () => {
    const { client, requests } = stubClient({ body: {} });
    // @ts-expect-error deliberately omitting a required field
    await assert.rejects(client.otp.send({}), ValidationError);
    assert.equal(requests.length, 0);
  });
});

describe('otp.verify', () => {
  it('sends otp_id, not id', async () => {
    const { client, requests } = stubClient({
      body: { valid: true, status: 'verified', attempts_used: 1 },
    });

    const result = await client.otp.verify({ otp_id: 'otp_1', code: '123456' });

    assert.deepEqual(requests[0]!.body, { otp_id: 'otp_1', code: '123456' });
    assert.equal(result.valid, true);
    assert.equal(result.attempts_remaining, undefined);
  });

  it('treats a wrong code as a successful call', async () => {
    const { client } = stubClient({
      body: { valid: false, status: 'sent', attempts_used: 2, attempts_remaining: 3 },
    });

    const result = await client.otp.verify({ otp_id: 'otp_1', code: '000000' });
    assert.equal(result.valid, false);
    assert.equal(result.attempts_remaining, 3);
  });

  it('rejects terminal states with a ConflictError', async () => {
    const { client } = stubClient({
      status: 409,
      body: { error: { type: 'max_attempts_exceeded', message: 'too many' } },
    });

    await assert.rejects(
      client.otp.verify({ otp_id: 'otp_1', code: '000000' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        assert.equal((error as ConflictError).type, 'max_attempts_exceeded');
        return true;
      },
    );
  });

  it('validates required fields locally', async () => {
    const { client, requests } = stubClient({ body: {} });
    // @ts-expect-error deliberately omitting otp_id
    await assert.rejects(client.otp.verify({ code: '1' }), ValidationError);
    // @ts-expect-error deliberately omitting code
    await assert.rejects(client.otp.verify({ otp_id: 'otp_1' }), ValidationError);
    assert.equal(requests.length, 0);
  });
});

describe('otp.get', () => {
  it('returns the full record', async () => {
    const { client, requests } = stubClient({
      body: {
        id: 'otp_1',
        workspace_id: 'ws_1',
        phone_number: '+2348012345678',
        country_code: 'NG',
        credit_cost: 1,
        provider: 'beem',
        status: 'sent',
        code_length: 6,
        ttl_seconds: 600,
        attempt_count: 0,
        max_attempts: 5,
        sent_at: '2026-07-22T10:00:05Z',
        expired_at: '2026-07-22T10:10:00Z',
        created_at: '2026-07-22T10:00:00Z',
      },
    });

    const otp = await client.otp.get('otp_1');
    assert.equal(requests[0]!.url, 'https://api.test.local/v1/otp/otp_1');
    assert.equal(otp.provider, 'beem');
    assert.equal(otp.max_attempts, 5);
    assert.equal(otp.delivered_at, undefined);
  });

  it('rejects an unknown id with NotFoundError', async () => {
    const { client } = stubClient({
      status: 404,
      body: { error: { type: 'otp_not_found', message: 'OTP not found' } },
    });
    await assert.rejects(client.otp.get('missing'), NotFoundError);
  });
});

describe('sms.send', () => {
  it('posts to /v1/sms/send', async () => {
    const { client, requests } = stubClient({
      body: {
        id: 'msg_1',
        phone_number: '+2348012345678',
        country_code: 'NG',
        credit_cost: 1,
        status: 'pending',
        created_at: '2026-07-22T10:00:00Z',
      },
    });

    const msg = await client.sms.send({
      phone_number: '+2348012345678',
      message: 'Your order #12345 has shipped.',
    });

    assert.equal(requests[0]!.url, 'https://api.test.local/v1/sms/send');
    assert.equal(msg.status, 'pending');
    assert.equal(msg.id, 'msg_1');
  });

  it('validates locally before spending a request', async () => {
    const { client, requests } = stubClient({ body: {} });

    // @ts-expect-error deliberately omitting phone_number
    await assert.rejects(client.sms.send({ message: 'hi' }), ValidationError);
    // @ts-expect-error deliberately omitting message
    await assert.rejects(client.sms.send({ phone_number: '+2348012345678' }), ValidationError);
    await assert.rejects(
      client.sms.send({
        phone_number: '+2348012345678',
        message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1),
      }),
      ValidationError,
    );

    assert.equal(requests.length, 0);
  });
});

describe('sms.get', () => {
  it('returns the message with metadata', async () => {
    const { client } = stubClient({
      body: {
        id: 'msg_1',
        phone_number: '+2348012345678',
        country_code: 'NG',
        credit_cost: 1,
        status: 'delivered',
        message: 'Your order #12345 has shipped.',
        metadata: { order_id: '12345' },
        created_at: '2026-07-22T10:00:00Z',
      },
    });

    const msg = await client.sms.get('msg_1');
    assert.equal(msg.status, 'delivered');
    assert.equal(msg.metadata?.order_id, '12345');
  });

  it('rejects an unknown id with NotFoundError', async () => {
    const { client } = stubClient({
      status: 404,
      body: { error: { type: 'sms_not_found', message: 'SMS message not found' } },
    });
    await assert.rejects(client.sms.get('missing'), NotFoundError);
  });
});
