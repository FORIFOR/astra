/**
 * @astra/api-client
 *
 * `@astra/contracts` に対する HTTP / SSE クライアント。
 * 応答は必ずスキーマで検証してから返す（実装仕様 §11、逸脱 D-20）。
 */
export { AstraClient, type Page, type TaskView } from './client.js';
export { HttpClient, type ClientConfig, type RequestOptions } from './http.js';
export {
  streamMeetingEvents,
  streamTaskEvents,
  parseSseFrames,
  type StreamOptions,
} from './sse.js';
export { errorFrom } from './errors.js';
export {
  PublicShareClient,
  ShareUnavailableError,
  isRenderable,
  type PublicShareConfig,
  type UnlockedShare,
} from './share.js';
