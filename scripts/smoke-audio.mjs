/**
 * 会議の音声 WS を実プロセスへ流す。smoke から呼ぶ。
 * 引数: <baseUrl> <accessToken> <meetingId>
 */
import WebSocket from 'ws';

const [base, token, meetingId] = process.argv.slice(2);
const url = `${base.replace(/^http/, 'ws')}/v1/meetings/${meetingId}/audio`;
const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });

ws.on('open', () => {
  // 100ms 分の無音を 20 回。中身は問わない。経路が通ることを見る。
  for (let i = 0; i < 20; i += 1) ws.send(Buffer.alloc(3200));
  ws.send(JSON.stringify({ type: 'marker', kind: 'decision', at_ms: 1000 }));
  setTimeout(() => ws.close(), 400);
});
ws.on('close', () => process.exit(0));
ws.on('error', (err) => {
  console.error(String(err));
  process.exit(1);
});
