export { Robase, DEFAULT_BASE_URL, VERSION } from './client.ts';
export type { FetchLike, RequestOptions, RobaseOptions } from './client.ts';

export { OTPResource } from './otp.ts';
export { SMSResource } from './sms.ts';

export {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  RobaseError,
  ServerError,
  SpamDetectedError,
  ValidationError,
  isRobaseError,
} from './errors.ts';
export type { RobaseErrorType } from './errors.ts';

export { MAX_MESSAGE_LENGTH } from './types.ts';
export type {
  Message,
  MessageStatus,
  OTP,
  OTPStatus,
  SendOTPParams,
  SendOTPResponse,
  SendSMSParams,
  SendSMSResponse,
  VerifyOTPParams,
  VerifyOTPResponse,
} from './types.ts';

export {
  EVENT_HEADER,
  SIGNATURE_HEADER,
  SignatureVerificationError,
  parseWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhook.ts';
export type {
  CreditWebhookData,
  OTPWebhookData,
  SMSWebhookData,
  WebhookEvent,
  WebhookPayload,
} from './webhook.ts';

export { Robase as default } from './client.ts';
