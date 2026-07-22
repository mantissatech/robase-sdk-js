/** Lifecycle state of an OTP. */
export type OTPStatus = 'pending' | 'sent' | 'verified' | 'expired' | 'failed';

/** Delivery state of a transactional SMS. */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';

/** The longest message body `sms.send` accepts. */
export const MAX_MESSAGE_LENGTH = 918;

// Field names mirror the wire format exactly — snake_case in and out. There is
// no camelCase mapping layer to drift out of sync with the API.

export interface SendOTPParams {
  /** Destination in E.164 format, e.g. `+2348012345678`. */
  phone_number: string;
  /** Digits in the generated code, 4–8. Defaults to 6. */
  code_length?: number;
  /** How long the code stays valid, in seconds, up to 3600. Defaults to 600. */
  ttl_seconds?: number;
  /** Arbitrary data stored with the OTP and echoed back by `otp.get`. */
  metadata?: Record<string, unknown>;
}

export interface SendOTPResponse {
  /** Identifies the OTP. Pass it to `verify` and `get`. */
  id: string;
  phone_number: string;
  /** ISO 3166-1 alpha-2 code derived from the number. */
  country_code: string;
  /** Credits the send consumed. */
  credit_cost: number;
  /** `pending` on accept — delivery happens asynchronously. */
  status: OTPStatus;
  code_length: number;
  /** RFC 3339 timestamp after which the code can no longer be verified. */
  expires_at: string;
  created_at: string;
}

export interface VerifyOTPParams {
  /** The id returned by `send`. */
  otp_id: string;
  /** The code the user entered. */
  code: string;
}

/**
 * A wrong-but-still-usable code is not an error: the call resolves with
 * `valid: false` and `attempts_remaining` set. Terminal states — expired,
 * already verified, attempts exhausted — reject with a {@link ConflictError}.
 */
export interface VerifyOTPResponse {
  valid: boolean;
  status: OTPStatus;
  /** Attempts made so far, including this one. */
  attempts_used: number;
  /** Attempts left. Only present when `valid` is false. */
  attempts_remaining?: number;
}

/** The full OTP record returned by `otp.get`. The code itself is never returned. */
export interface OTP {
  id: string;
  workspace_id: string;
  phone_number: string;
  country_code: string;
  credit_cost: number;
  provider?: string;
  provider_msg_id?: string;
  status: OTPStatus;
  code_length: number;
  ttl_seconds: number;
  attempt_count: number;
  max_attempts: number;
  sent_at?: string;
  delivered_at?: string;
  verified_at?: string;
  expired_at: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface SendSMSParams {
  /** Destination in E.164 format. */
  phone_number: string;
  /** Message body, at most {@link MAX_MESSAGE_LENGTH} characters. */
  message: string;
  /** Arbitrary data stored with the message and echoed back by `sms.get`. */
  metadata?: Record<string, unknown>;
}

export interface SendSMSResponse {
  id: string;
  phone_number: string;
  country_code: string;
  credit_cost: number;
  /** Always `pending` here; it transitions asynchronously. */
  status: MessageStatus;
  created_at: string;
}

/** The full message record returned by `sms.get`. */
export interface Message {
  id: string;
  phone_number: string;
  country_code: string;
  message: string;
  credit_cost: number;
  status: MessageStatus;
  metadata?: Record<string, unknown>;
  created_at: string;
}
