import {
  ConnectionError,
  RobaseError,
  ValidationError,
  errorFromResponse,
} from './errors.ts';
import { OTPResource } from './otp.ts';
import { SMSResource } from './sms.ts';

/** SDK version, reported in the User-Agent. */
export const VERSION = '1.0.0';

/** Production API endpoint. */
export const DEFAULT_BASE_URL = 'https://api.robase.dev';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_BACKOFF_MS = 8_000;

/** Minimal shape of `fetch`, so a custom implementation can be injected. */
export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface RobaseOptions {
  /** API key from the dashboard. Starts with `robe_`. Falls back to `process.env.ROBASE_API_KEY`. */
  apiKey?: string;
  /** API host. Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** How many times to retry a failed request. Defaults to 2. Pass 0 to disable. */
  maxRetries?: number;
  /** Custom `fetch` implementation. Defaults to the global one. */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

/** Per-call overrides. */
export interface RequestOptions {
  /**
   * Pins the `Idempotency-Key` for this call. POSTs generate a random key when
   * none is given, so this is only needed to reuse a key across processes.
   * Keys are honoured for 24 hours.
   */
  idempotencyKey?: string;
  /** Extra headers for this call only. */
  headers?: Record<string, string>;
  /** Aborts this call. Composed with the client timeout. */
  signal?: AbortSignal;
  /** Overrides the client's retry budget for this call. */
  maxRetries?: number;
}

/**
 * Client for the Robase SMS OTP API.
 *
 * ```ts
 * const robase = new Robase({ apiKey: process.env.ROBASE_API_KEY });
 * const sent = await robase.otp.send({ phone_number: '+2348012345678' });
 * ```
 */
export class Robase {
  /** The `/v1/otp` endpoints. */
  readonly otp: OTPResource;
  /** The `/v1/sms` endpoints. */
  readonly sms: SMSResource;

  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly timeout: number;

  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #headers: Record<string, string>;

  constructor(options: RobaseOptions = {}) {
    const apiKey =
      options.apiKey ??
      (typeof process !== 'undefined' ? process.env?.ROBASE_API_KEY : undefined);

    if (!apiKey) {
      throw new ValidationError({
        type: 'validation_error',
        message:
          'Missing API key. Pass { apiKey } or set the ROBASE_API_KEY environment variable.',
      });
    }
    if (!apiKey.startsWith('robe_')) {
      throw new ValidationError({
        type: 'validation_error',
        message: 'Invalid API key: Robase keys start with "robe_".',
      });
    }

    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new ValidationError({
        type: 'validation_error',
        message:
          'No fetch implementation available. Use Node 18+ or pass { fetch }.',
      });
    }

    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.#headers = options.headers ?? {};
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    this.otp = new OTPResource(this);
    this.sms = new SMSResource(this);
  }

  /**
   * Issues an API call and returns the decoded body. Internal — use the `otp`
   * and `sms` resources.
   */
  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);

    // A POST that fails mid-flight may already have been charged. Giving every
    // POST an idempotency key makes the retry below safe: the server replays
    // the original response instead of sending a second message.
    const idempotencyKey =
      options.idempotencyKey ?? (method === 'POST' ? randomUUID() : undefined);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: 'application/json',
      'User-Agent': `robase-js/${VERSION}`,
      ...this.#headers,
      ...options.headers,
    };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const budget = options.maxRetries ?? this.maxRetries;

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(this.baseUrl + path, {
          method,
          headers,
          body: payload,
          signal: this.#buildSignal(options.signal),
        });
      } catch (cause) {
        // An abort the caller asked for is a decision, not a transient fault.
        if (options.signal?.aborted) {
          throw new ConnectionError('Request aborted', cause);
        }
        if (attempt >= budget) {
          throw new ConnectionError(
            `Request to ${path} failed: ${(cause as Error)?.message ?? cause}`,
            cause,
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      const text = await response.text();

      if (response.ok) {
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch (cause) {
          throw new RobaseError({
            type: 'api_error',
            message: 'Failed to decode API response as JSON',
            status: response.status,
            body: text,
            cause,
          });
        }
      }

      const error = errorFromResponse(response, text);
      if (attempt < budget && isRetryable(response.status)) {
        await sleep(backoffMs(attempt, error.retryAfter));
        continue;
      }
      throw error;
    }
  }

  /** Combines the caller's abort signal with the client-wide timeout. */
  #buildSignal(caller?: AbortSignal): AbortSignal | undefined {
    const timeoutSignal =
      this.timeout > 0 ? AbortSignal.timeout(this.timeout) : undefined;
    if (!caller) return timeoutSignal;
    if (!timeoutSignal) return caller;
    return AbortSignal.any([caller, timeoutSignal]);
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Delay before the next attempt: the server's `Retry-After` when it sent one,
 * otherwise exponential growth with full jitter so simultaneous callers spread out.
 */
function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_BACKOFF_MS);
  }
  const ceiling = Math.min(2 ** attempt * 500, MAX_RETRY_BACKOFF_MS);
  return Math.random() * ceiling;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Older runtimes without crypto.randomUUID: any unique value keeps the
  // idempotency guarantee useful.
  return `robase-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
