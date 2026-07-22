import type { Robase, RequestOptions } from './client.ts';
import { ValidationError } from './errors.ts';
import type {
  OTP,
  SendOTPParams,
  SendOTPResponse,
  VerifyOTPParams,
  VerifyOTPResponse,
} from './types.ts';

/** The `/v1/otp` endpoints. Access via `robase.otp`. */
export class OTPResource {
  readonly #client: Robase;

  constructor(client: Robase) {
    this.#client = client;
  }

  /**
   * Generates a code and delivers it by SMS.
   *
   * The credit charge is applied before this resolves; delivery itself is
   * asynchronous, so a `pending` status is the normal success case.
   *
   * ```ts
   * const sent = await robase.otp.send({ phone_number: '+2348012345678' });
   * ```
   */
  async send(
    params: SendOTPParams,
    options?: RequestOptions,
  ): Promise<SendOTPResponse> {
    if (!params?.phone_number) {
      throw new ValidationError({
        type: 'validation_error',
        message: 'phone_number is required',
      });
    }
    return this.#client.request<SendOTPResponse>(
      'POST',
      '/v1/otp/send',
      params,
      options,
    );
  }

  /**
   * Verifies a code against a previously sent OTP, using a constant-time
   * comparison server-side.
   *
   * A wrong-but-still-usable code resolves with `valid: false` — it does not
   * throw. Terminal states reject with a `ConflictError` whose `type` is
   * `otp_expired`, `otp_already_verified`, or `max_attempts_exceeded`.
   */
  async verify(
    params: VerifyOTPParams,
    options?: RequestOptions,
  ): Promise<VerifyOTPResponse> {
    if (!params?.otp_id) {
      throw new ValidationError({
        type: 'validation_error',
        message: 'otp_id is required',
      });
    }
    if (!params?.code) {
      throw new ValidationError({
        type: 'validation_error',
        message: 'code is required',
      });
    }
    return this.#client.request<VerifyOTPResponse>(
      'POST',
      '/v1/otp/verify',
      params,
      options,
    );
  }

  /** Retrieves the current state of an OTP. */
  async get(id: string, options?: RequestOptions): Promise<OTP> {
    if (!id) {
      throw new ValidationError({ type: 'validation_error', message: 'id is required' });
    }
    return this.#client.request<OTP>(
      'GET',
      `/v1/otp/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }
}
