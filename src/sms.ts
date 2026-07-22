import type { Robase, RequestOptions } from './client.ts';
import { ValidationError } from './errors.ts';
import {
  MAX_MESSAGE_LENGTH,
  type Message,
  type SendSMSParams,
  type SendSMSResponse,
} from './types.ts';

/** The `/v1/sms` endpoints. Access via `robase.sms`. */
export class SMSResource {
  readonly #client: Robase;

  constructor(client: Robase) {
    this.#client = client;
  }

  /**
   * Queues a transactional SMS. Routing, billing and provider failover are the
   * same as for OTPs.
   *
   * Resolves as soon as the message is queued and charged — `status` is always
   * `pending`. Subscribe to the `sms.delivered` / `sms.failed` webhooks, or poll
   * {@link get}, to learn the outcome.
   *
   * If anti-spam blocks the message this rejects with a `SpamDetectedError`
   * whose `detail` holds the score, category and reason.
   */
  async send(
    params: SendSMSParams,
    options?: RequestOptions,
  ): Promise<SendSMSResponse> {
    if (!params?.phone_number) {
      throw new ValidationError({
        type: 'validation_error',
        message: 'phone_number is required',
      });
    }
    if (!params?.message) {
      throw new ValidationError({
        type: 'validation_error',
        message: 'message is required',
      });
    }
    if (params.message.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError({
        type: 'validation_error',
        message: `message must be at most ${MAX_MESSAGE_LENGTH} characters`,
      });
    }
    return this.#client.request<SendSMSResponse>(
      'POST',
      '/v1/sms/send',
      params,
      options,
    );
  }

  /** Retrieves the current state of a transactional SMS. */
  async get(id: string, options?: RequestOptions): Promise<Message> {
    if (!id) {
      throw new ValidationError({ type: 'validation_error', message: 'id is required' });
    }
    return this.#client.request<Message>(
      'GET',
      `/v1/sms/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }
}
