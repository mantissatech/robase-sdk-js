# Robase JavaScript SDK

Official JavaScript/TypeScript client for the [Robase](https://robase.dev) SMS OTP
and transactional SMS API.

Zero runtime dependencies. Ships ESM and CommonJS builds with full type
definitions. Works on Node 20+, Deno, Bun, and edge runtimes with `fetch` and
WebCrypto.

## Install

```bash
npm install @robasedev/sdk
```

## Quick start

```ts
import { Robase } from '@robasedev/sdk';

const robase = new Robase({ apiKey: process.env.ROBASE_API_KEY });

const sent = await robase.otp.send({ phone_number: '+2348012345678' });
console.log(sent.id, sent.expires_at);

// ...after the user types in the code they received:
const result = await robase.otp.verify({ otp_id: sent.id, code: '123456' });
if (result.valid) {
  console.log('verified');
}
```

CommonJS works too:

```js
const { Robase } = require('@robasedev/sdk');
```

Field names mirror the wire format exactly — `snake_case` in and out. There's no
camelCase mapping layer to drift out of sync with the API.

## Client options

```ts
const robase = new Robase({
  apiKey: 'robe_...',                  // or set ROBASE_API_KEY
  baseUrl: 'http://localhost:8080',    // default: https://api.robase.dev
  timeout: 10_000,                     // default: 30000 ms
  maxRetries: 3,                       // default: 2
  headers: { 'X-App': 'checkout' },    // sent with every request
  fetch: myFetch,                      // custom fetch implementation
});
```

Every method also takes per-call options:

```ts
await robase.sms.send(params, {
  idempotencyKey: `order-${orderId}`,
  signal: AbortSignal.timeout(5_000),
  maxRetries: 0,
  headers: { 'X-Trace-Id': traceId },
});
```

## API

### OTP

| Method | Endpoint |
|---|---|
| `robase.otp.send(params, options?)` | `POST /v1/otp/send` |
| `robase.otp.verify(params, options?)` | `POST /v1/otp/verify` |
| `robase.otp.get(id, options?)` | `GET /v1/otp/{id}` |

```ts
const sent = await robase.otp.send({
  phone_number: '+2348012345678',  // required, E.164
  code_length: 6,                  // optional, 4–8, defaults to 6
  ttl_seconds: 600,                // optional, ≤3600, defaults to 600
  metadata: { user_id: 'u_123' },
});
```

A wrong-but-not-yet-exhausted code is **not** an error — `verify` resolves with
`valid: false` and `attempts_remaining` set:

```ts
import { ConflictError } from '@robasedev/sdk';

try {
  const result = await robase.otp.verify({ otp_id, code });
  if (result.valid) {
    // success
  } else {
    console.log(`wrong code, ${result.attempts_remaining} attempts left`);
  }
} catch (error) {
  if (error instanceof ConflictError) {
    // error.type is 'otp_expired' | 'otp_already_verified' | 'max_attempts_exceeded'
  }
  throw error;
}
```

### SMS

| Method | Endpoint |
|---|---|
| `robase.sms.send(params, options?)` | `POST /v1/sms/send` |
| `robase.sms.get(id, options?)` | `GET /v1/sms/{id}` |

```ts
const msg = await robase.sms.send({
  phone_number: '+2348012345678',
  message: 'Your order #12345 has shipped.',   // ≤918 characters
  metadata: { order_id: '12345' },
});
```

`send` resolves as soon as the message is queued and charged — `status` is always
`pending`. Subscribe to the `sms.delivered` / `sms.failed` webhooks, or poll
`sms.get`, to learn the outcome.

## Errors

Every non-2xx response throws a subclass of `RobaseError`. Match on the class, or
on `error.type` for finer-grained cases:

```ts
import { InsufficientCreditsError, isRobaseError } from '@robasedev/sdk';

try {
  await robase.otp.send({ phone_number });
} catch (error) {
  if (error instanceof InsufficientCreditsError) {
    // top up and retry
  } else if (isRobaseError(error)) {
    console.error(error.type, error.message, error.status);
  }
}
```

| Class | HTTP | `type` |
|---|---|---|
| `ValidationError` | 400 | `validation_error`, `invalid_phone`, `country_not_supported` |
| `AuthenticationError` | 401 | `unauthorized` |
| `InsufficientCreditsError` | 402 | `insufficient_credits` |
| `SpamDetectedError` | 403 | `spam_detected` |
| `NotFoundError` | 404 | `otp_not_found`, `sms_not_found` |
| `ConflictError` | 409 | `otp_expired`, `otp_already_verified`, `max_attempts_exceeded` |
| `RateLimitError` | 429 | `rate_limited` — see `error.retryAfter` |
| `ServerError` | 5xx | `internal_error` |
| `ConnectionError` | — | network failure, timeout, or abort |

`ValidationError` is also thrown locally, before any request, for obviously bad
arguments — a missing `phone_number`, an over-long `message`.

When anti-spam blocks a message, `error.detail` carries `score`, `category` and
`reason`.

## Retries and idempotency

Network errors, `429`s and `5xx`s are retried with exponential backoff and full
jitter, honouring `Retry-After` when the server sends it. Every `POST` carries an
auto-generated `Idempotency-Key`, and a retry reuses the same key — so a retried
send replays the original response instead of charging you twice.

Pass `idempotencyKey` explicitly to reuse a key across processes. Keys are
honoured for 24 hours.

## Webhooks

Robase signs every delivery with `X-Robase-Signature` — a hex HMAC-SHA256 of the
raw body under your webhook secret. Verification is async because it uses
WebCrypto, which works in every modern runtime.

```ts
import express from 'express';
import { parseWebhook, SignatureVerificationError } from '@robasedev/sdk';

const app = express();

// The raw bytes matter — express.json() would re-encode and break the signature.
app.post('/webhooks/robase', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = await parseWebhook(req.body, req.header('x-robase-signature'), SECRET);
  } catch (error) {
    if (error instanceof SignatureVerificationError) return res.sendStatus(401);
    throw error;
  }

  switch (event.event) {
    case 'otp.verified':
      console.log('verified', event.data.id);
      break;
    case 'sms.delivered':
      console.log('delivered', event.data.id);
      break;
    case 'credit_balance.low':
      console.log('balance low', event.data.balance);
      break;
  }

  res.sendStatus(200);
});
```

`event.event` discriminates the union, so a `switch` narrows `event.data` to the
right payload type.

Events: `otp.sent`, `otp.delivered`, `otp.verified`, `otp.expired`, `otp.failed`,
`sms.sent`, `sms.delivered`, `sms.failed`, `credit_balance.low`,
`credit_balance.exhausted`, `credit_balance.topped_up`.

## Development

```bash
npm install
npm test        # node --test, runs the TypeScript directly
npm run typecheck
npm run build   # emits dist/esm and dist/cjs
```

## License

MIT
