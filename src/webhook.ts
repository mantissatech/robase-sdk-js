import { RobaseError } from './errors.ts';
import type { MessageStatus, OTPStatus } from './types.ts';

/** Header carrying the hex HMAC-SHA256 of the raw body. */
export const SIGNATURE_HEADER = 'x-robase-signature';
/** Header carrying the event name, for routing before parsing. */
export const EVENT_HEADER = 'x-robase-event';

/** Every event Robase can deliver. */
export type WebhookEvent =
  | 'otp.sent'
  | 'otp.delivered'
  | 'otp.verified'
  | 'otp.expired'
  | 'otp.failed'
  | 'sms.sent'
  | 'sms.delivered'
  | 'sms.failed'
  | 'credit_balance.low'
  | 'credit_balance.exhausted'
  | 'credit_balance.topped_up';

export interface OTPWebhookData {
  id: string;
  phone_number: string;
  country_code: string;
  status: OTPStatus;
  provider: string;
  credit_cost: number;
}

export interface SMSWebhookData {
  id: string;
  phone_number: string;
  country_code: string;
  message: string;
  status: MessageStatus;
  provider: string;
  credit_cost: number;
}

export interface CreditWebhookData {
  workspace_id: string;
  balance: number;
  threshold?: number;
}

/**
 * The body Robase POSTs to your endpoint. The `event` discriminates `data`, so
 * a `switch` on it narrows the payload type.
 */
export type WebhookPayload =
  | {
      event: 'otp.sent' | 'otp.delivered' | 'otp.verified' | 'otp.expired' | 'otp.failed';
      timestamp: string;
      data: OTPWebhookData;
    }
  | {
      event: 'sms.sent' | 'sms.delivered' | 'sms.failed';
      timestamp: string;
      data: SMSWebhookData;
    }
  | {
      event: 'credit_balance.low' | 'credit_balance.exhausted' | 'credit_balance.topped_up';
      timestamp: string;
      data: CreditWebhookData;
    };

/** Thrown when a webhook signature doesn't authenticate the payload. */
export class SignatureVerificationError extends RobaseError {
  constructor(message = 'Webhook signature verification failed') {
    super({ type: 'invalid_signature', message });
  }
}

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes the hex HMAC-SHA256 of `payload` under `secret` — what Robase sends
 * in `X-Robase-Signature`. Exported mainly for building test fixtures.
 */
export async function signWebhookPayload(
  payload: string | Uint8Array,
  secret: string,
): Promise<string> {
  const key = await hmacKey(secret);
  const bytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, bytes as BufferSource);
  return toHex(signature);
}

/** Constant-time string comparison, so a mismatch leaks no position information. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Reports whether `signature` authenticates `payload` under `secret`.
 *
 * Pass the **raw** body you received — re-encoding the JSON changes the
 * signature. In Express, that means `express.raw({ type: 'application/json' })`
 * rather than `express.json()`.
 */
export async function verifyWebhookSignature(
  payload: string | Uint8Array,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await signWebhookPayload(payload, secret);
  return timingSafeEqual(expected, signature);
}

/**
 * Verifies the signature and parses the payload in one step, throwing
 * {@link SignatureVerificationError} if the signature doesn't match.
 *
 * ```ts
 * const event = await parseWebhook(rawBody, req.headers['x-robase-signature'], secret);
 * switch (event.event) {
 *   case 'otp.verified':
 *     console.log(event.data.id);
 *     break;
 * }
 * ```
 */
export async function parseWebhook(
  payload: string | Uint8Array,
  signature: string | null | undefined,
  secret: string,
): Promise<WebhookPayload> {
  if (!(await verifyWebhookSignature(payload, signature, secret))) {
    throw new SignatureVerificationError();
  }
  const text =
    typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  try {
    return JSON.parse(text) as WebhookPayload;
  } catch (cause) {
    throw new RobaseError({
      type: 'validation_error',
      message: 'Webhook payload is not valid JSON',
      body: text,
      cause,
    });
  }
}
