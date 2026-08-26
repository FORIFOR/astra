/**
 * Chirp 3 streaming の実クライアント。正本 §11.2 Live Path。
 *
 * **ここだけ SDK を使う。**V2 の `StreamingRecognize` は gRPC の
 * 双方向 stream で、REST に相当するものが無い。
 * 資格情報は REST 側と同じ ADC（`GoogleAuth` を SDK が内部で使う）。
 */
import {
  locationOf,
  resolveSpeechEndpoint,
  type StreamingSpeechClient,
} from './google-streaming.js';

/**
 * recognizer の location に合わせた endpoint で開く。
 *
 * **既定の endpoint のままだと `locations/us` が見つからない。**
 * これが Chirp 3 の 403 の正体だった。
 */
export async function streamingSpeechClient(
  recognizer: string,
  projectId: string,
): Promise<StreamingSpeechClient> {
  const { v2 } = await import('@google-cloud/speech');
  const client = new v2.SpeechClient({
    apiEndpoint: resolveSpeechEndpoint(locationOf(recognizer)),
    /*
     * 課金と割り当ての先。**利用者資格情報の ADC では必須。**
     * REST の `x-goog-user-project` にあたる。
     * 無いと `RESOURCE_PROJECT_INVALID` になり、原因が「権限」に見える。
     */
    projectId,
    quotaProjectId: projectId,
  });
  /*
   * **`streamingRecognize` は使えない。**
   *
   * SDK の public な `streamingRecognize(streamingConfig, options)` は
   * V1 向けの薄い shim で、
   *   - 設定を `{streamingConfig}` だけで書く（V2 に要る `recognizer` が付かない）
   *   - 音声を `{audioContent}` で包む（V2 の項目名は `audio`）
   * ため、V2 では `Invalid resource field value` になる。
   *
   * V2 の生成メソッドは `_streamingRecognize`。名前に `_` が付くが、
   * こちらが V2 の本体で、shim のほうが V1 の名残。
   */
  const routing = `recognizer=${encodeURIComponent(recognizer)}`;
  return {
    streamingRecognize() {
      return (
        client as unknown as {
          _streamingRecognize(options: unknown): unknown;
        }
      )._streamingRecognize({
        // bidi には request が無いので、routing header は自分で載せる
        otherArgs: { headers: { 'x-goog-request-params': routing } },
      }) as never;
    },
  };
}
