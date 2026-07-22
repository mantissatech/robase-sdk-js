/**
 * Machine-readable error identifiers the API returns in `error.type`.
 * Match on these rather than on message text, which is prose and may change.
 */
export type RobaseErrorType =
  | 'validation_error'
  | 'invalid_phone'
  | 'country_not_supported'
  | 'unauthorized'
  | 'insufficient_credits'
  | 'spam_detected'
  | 'otp_not_found'
  | 'sms_not_found'
  | 'otp_expired'
  | 'otp_already_verified'
  | 'max_attempts_exceeded'
  | 'rate_limited'
  | 'internal_error'
  | 'api_error'
  // Keeps the union open so a new server-side type doesn't break compilation
  // while still giving autocomplete for the known ones.
  | (string & {});

export interface RobaseErrorOptions {
  type: RobaseErrorType;
  message: string;
  status?: number;
  retryAfter?: number;
  detail?: Record<string, unknown>;
  body?: string;
  cause?: unknown;
}

/** Base class for every error this SDK throws. */
export class RobaseError extends Error {
  /** The API's error identifier, e.g. `insufficient_credits`. */
  readonly type: RobaseErrorType;
  /** HTTP status code, or `undefined` when the request never got a response. */
  readonly status?: number;
  /** Seconds to wait, from the `Retry-After` header. */
  readonly retryAfter?: number;
  /** Extra context the endpoint attached. Anti-spam blocks populate this. */
  readonly detail?: Record<string, unknown>;
  /** Raw response body, useful when the payload wasn't the standard envelope. */
  readonly body?: string;

  constructor(options: RobaseErrorOptions) {
    super(options.message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.type = options.type;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.detail = options.detail;
    this.body = options.body;
  }
}

/** The API key is missing, malformed, or unknown (401). */
export class AuthenticationError extends RobaseError {}

/** The request body failed validation (400). */
export class ValidationError extends RobaseError {}

/** The workspace balance is below the send cost (402). */
export class InsufficientCreditsError extends RobaseError {}

/** Anti-spam blocked the message (403). `detail` holds score, category, reason. */
export class SpamDetectedError extends RobaseError {}

/** No record with that id (404). */
export class NotFoundError extends RobaseError {}

/**
 * The OTP is in a terminal state (409) — expired, already verified, or out of
 * attempts. Check `type` to tell them apart.
 */
export class ConflictError extends RobaseError {}

/** A rate limit tripped (429). `retryAfter` says how long to wait. */
export class RateLimitError extends RobaseError {}

/** The API failed unexpectedly (5xx). */
export class ServerError extends RobaseError {}

/** The request never completed — network failure, timeout, or abort. */
export class ConnectionError extends RobaseError {
  constructor(message: string, cause?: unknown) {
    super({ type: 'connection_error', message, cause });
  }
}

/** True when `value` is any error thrown by this SDK. */
export function isRobaseError(value: unknown): value is RobaseError {
  return value instanceof RobaseError;
}

function classFor(status: number, type: string): typeof RobaseError {
  switch (status) {
    case 400:
      return ValidationError;
    case 401:
    case 403:
      return type === 'spam_detected' ? SpamDetectedError : AuthenticationError;
    case 402:
      return InsufficientCreditsError;
    case 404:
      return NotFoundError;
    case 409:
      return ConflictError;
    case 429:
      return RateLimitError;
    default:
      return status >= 500 ? ServerError : RobaseError;
  }
}

function fallbackType(status: number): RobaseErrorType {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'insufficient_credits';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal_error';
  return 'api_error';
}

/**
 * Builds the right error subclass from a non-2xx response.
 *
 * The API reports failures as `{"error":{"type","message"}}`, except the
 * anti-spam block, which sends `{"error":"spam_detected","detail":{...}}`.
 * Both shapes are handled, as is a body that isn't JSON at all.
 */
export function errorFromResponse(response: Response, body: string): RobaseError {
  let type: RobaseErrorType | undefined;
  let message: string | undefined;
  let detail: Record<string, unknown> | undefined;

  try {
    const parsed = JSON.parse(body) as {
      error?: unknown;
      detail?: Record<string, unknown>;
    };
    detail = parsed.detail;

    if (typeof parsed.error === 'string') {
      type = parsed.error;
      message = parsed.error;
    } else if (parsed.error && typeof parsed.error === 'object') {
      const envelope = parsed.error as { type?: string; message?: string };
      type = envelope.type;
      message = envelope.message;
    }
  } catch {
    // Not JSON — fall through to the status-derived defaults below.
  }

  const status = response.status;
  const resolvedType = type ?? fallbackType(status);
  const resolvedMessage = message ?? body.trim() ?? response.statusText;

  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;

  const ErrorClass = classFor(status, resolvedType);
  return new ErrorClass({
    type: resolvedType,
    message: resolvedMessage || response.statusText || `HTTP ${status}`,
    status,
    retryAfter: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    detail,
    body,
  });
}
