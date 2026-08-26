/**
 * @astra/service-share
 *
 * 共有トークン、パスワード、期限、公開 viewer の認可。正本 §2.3。
 */
export { ShareService, type ShareResolution, type ShareServiceDeps } from './service.js';
export {
  mintShareToken,
  parseShareToken,
  hashShareSecret,
  hashPassword,
  verifyPassword,
  requesterFingerprint,
  shareUrlFor,
} from './tokens.js';
