import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  Robase,
  RobaseError,
  ServerError,
  SpamDetectedError,
  ValidationError,
  isRobaseError,
} from '../src/index.ts';
import { stubClient } from './helpers.ts';

describe('constructor', () => {
  it('rejects a missing api key', () => {
    assert.throws(() => new Robase({ apiKey: '' }), RobaseError);
  });

  it('rejects a key without the robe_ prefix', () => {
    assert.throws(() => new Robase({ apiKey: 'sk_live_nope' }), /robe_/);
  });

  it('reads ROBASE_API_KEY from the environment', () => {
    const previous = process.env.ROBASE_API_KEY;
    process.env.ROBASE_API_KEY = 'robe_from_env';
    try {
      assert.doesNotThrow(() => new Robase());
    } finally {
      if (previous === undefined) delete process.env.ROBASE_API_KEY;
      else process.env.ROBASE_API_KEY = previous;
    }
  });

  it('strips trailing slashes from baseUrl', () => {
    const client = new Robase({ apiKey: 'robe_x', baseUrl: 'http://localhost:8080///' });
    assert.equal(client.baseUrl, 'http://localhost:8080');
  });
});

describe('request headers', () => {
  it('sends auth, content type and user agent', async () => {
    const { client, requests } = stubClient({ body: { id: 'otp_1' } });
    await client.otp.send({ phone_number: '+2348012345678' });

    const headers = requests[0]!.headers;
    assert.equal(headers.authorization, 'Bearer robe_test_key');
    assert.equal(headers['content-type'], 'application/json');
    assert.match(headers['user-agent']!, /^robase-js\//);
  });

  it('auto-generates an Idempotency-Key on POST', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.otp.send({ phone_number: '+2348012345678' });
    assert.ok(requests[0]!.headers['idempotency-key']);
  });

  it('does not send an Idempotency-Key on GET', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.otp.get('otp_1');
    assert.equal(requests[0]!.headers['idempotency-key'], undefined);
  });

  it('honours an explicit idempotencyKey', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.sms.send(
      { phone_number: '+2348012345678', message: 'hi' },
      { idempotencyKey: 'order-42' },
    );
    assert.equal(requests[0]!.headers['idempotency-key'], 'order-42');
  });

  it('merges per-request headers', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.otp.get('otp_1', { headers: { 'X-Trace-Id': 'abc' } });
    assert.equal(requests[0]!.headers['x-trace-id'], 'abc');
  });
});

describe('error mapping', () => {
  const cases: Array<[string, number, unknown, new (...args: never[]) => RobaseError, string]> = [
    ['400', 400, { error: { type: 'validation_error', message: 'bad' } }, ValidationError, 'validation_error'],
    ['401', 401, { error: { type: 'unauthorized', message: 'nope' } }, AuthenticationError, 'unauthorized'],
    ['402', 402, { error: { type: 'insufficient_credits', message: 'broke' } }, InsufficientCreditsError, 'insufficient_credits'],
    ['404', 404, { error: { type: 'otp_not_found', message: 'gone' } }, NotFoundError, 'otp_not_found'],
    ['409', 409, { error: { type: 'otp_expired', message: 'expired' } }, ConflictError, 'otp_expired'],
    ['429', 429, { error: { type: 'rate_limited', message: 'slow' } }, RateLimitError, 'rate_limited'],
    ['500', 500, { error: { type: 'internal_error', message: 'boom' } }, ServerError, 'internal_error'],
  ];

  for (const [name, status, body, ErrorClass, type] of cases) {
    it(`maps ${name} to ${ErrorClass.name}`, async () => {
      const { client } = stubClient({ status, body });
      await assert.rejects(
        client.otp.send({ phone_number: '+2348012345678' }),
        (error: unknown) => {
          assert.ok(error instanceof ErrorClass, `expected ${ErrorClass.name}, got ${error}`);
          assert.equal((error as RobaseError).type, type);
          assert.equal((error as RobaseError).status, status);
          assert.ok(isRobaseError(error));
          return true;
        },
      );
    });
  }

  it('maps the anti-spam block and keeps its detail', async () => {
    const { client } = stubClient({
      status: 403,
      body: {
        error: 'spam_detected',
        detail: { score: 0.94, category: 'phishing', reason: 'credential harvesting' },
      },
    });

    await assert.rejects(
      client.sms.send({ phone_number: '+2348012345678', message: 'click here' }),
      (error: unknown) => {
        assert.ok(error instanceof SpamDetectedError);
        assert.equal((error as SpamDetectedError).detail?.category, 'phishing');
        return true;
      },
    );
  });

  it('classifies a non-JSON error body by status', async () => {
    const { client } = stubClient({ status: 502, body: '<html>bad gateway</html>' });
    await assert.rejects(client.otp.get('otp_1'), (error: unknown) => {
      assert.ok(error instanceof ServerError);
      assert.equal((error as ServerError).type, 'internal_error');
      return true;
    });
  });

  it('surfaces Retry-After', async () => {
    const { client } = stubClient({
      status: 429,
      body: { error: { type: 'rate_limited', message: 'slow' } },
      headers: { 'retry-after': '30' },
    });
    await assert.rejects(client.otp.send({ phone_number: '+2348012345678' }), (error: unknown) => {
      assert.equal((error as RateLimitError).retryAfter, 30);
      return true;
    });
  });

  it('wraps transport failures in ConnectionError', async () => {
    const client = new Robase({
      apiKey: 'robe_test_key',
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError('network down');
      },
    });
    await assert.rejects(client.otp.get('otp_1'), ConnectionError);
  });
});

describe('retries', () => {
  it('retries a 429 then succeeds', async () => {
    const { client, requests } = stubClient(
      [
        { status: 429, body: { error: { type: 'rate_limited', message: 'slow' } }, headers: { 'retry-after': '0' } },
        { body: { id: 'otp_1' } },
      ],
      { maxRetries: 2 },
    );

    const sent = await client.otp.send({ phone_number: '+2348012345678' });
    assert.equal(sent.id, 'otp_1');
    assert.equal(requests.length, 2);
  });

  it('reuses the same idempotency key across retries', async () => {
    const { client, requests } = stubClient(
      [
        { status: 500, body: { error: { type: 'internal_error', message: 'boom' } }, headers: { 'retry-after': '0' } },
        { body: { id: 'otp_1' } },
      ],
      { maxRetries: 1 },
    );

    await client.otp.send({ phone_number: '+2348012345678' });
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.headers['idempotency-key'], requests[1]!.headers['idempotency-key']);
    assert.ok(requests[0]!.headers['idempotency-key']);
  });

  it('does not retry 4xx', async () => {
    const { client, requests } = stubClient(
      { status: 400, body: { error: { type: 'invalid_phone', message: 'bad' } } },
      { maxRetries: 3 },
    );
    await assert.rejects(client.otp.send({ phone_number: '+234' }), ValidationError);
    assert.equal(requests.length, 1);
  });

  it('gives up after the retry budget', async () => {
    const { client, requests } = stubClient(
      { status: 503, body: { error: { type: 'internal_error', message: 'boom' } }, headers: { 'retry-after': '0' } },
      { maxRetries: 2 },
    );
    await assert.rejects(client.otp.get('otp_1'), ServerError);
    assert.equal(requests.length, 3);
  });

  it('honours a per-request retry override', async () => {
    const { client, requests } = stubClient(
      { status: 503, body: {}, headers: { 'retry-after': '0' } },
      { maxRetries: 5 },
    );
    await assert.rejects(client.otp.get('otp_1', { maxRetries: 0 }), ServerError);
    assert.equal(requests.length, 1);
  });
});

describe('request bodies', () => {
  it('sends params verbatim in snake_case', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.otp.send({
      phone_number: '+2348012345678',
      code_length: 4,
      ttl_seconds: 300,
      metadata: { user_id: 'u_1' },
    });

    assert.deepEqual(requests[0]!.body, {
      phone_number: '+2348012345678',
      code_length: 4,
      ttl_seconds: 300,
      metadata: { user_id: 'u_1' },
    });
  });

  it('omits unset optionals so server defaults apply', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.otp.send({ phone_number: '+2348012345678' });
    assert.deepEqual(requests[0]!.body, { phone_number: '+2348012345678' });
  });

  it('builds the right paths', async () => {
    const { client, requests } = stubClient({ body: {} });
    await client.sms.get('msg 1');
    assert.equal(requests[0]!.url, 'https://api.test.local/v1/sms/msg%201');
    assert.equal(requests[0]!.method, 'GET');
  });
});
