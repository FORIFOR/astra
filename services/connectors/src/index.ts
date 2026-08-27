/**
 * @astra/service-connectors
 *
 * Calendar / Gmail への接続。正本 §2.4・§21、UI/UX §22。
 *
 * ここが守るもの:
 *   - **トークンを保持しない。**呼ぶ直前に端末から受け取る
 *   - **許可を操作ごとに要求する。**足りなければ実行前に断る
 *   - **送信と削除は、人の承認の跡が無ければ実行しない**
 */
export * from './http.js';
export * from './approval.js';
export * from './mime.js';
export * from './calendar.js';
export * from './gmail.js';
export * from './scopes.js';
