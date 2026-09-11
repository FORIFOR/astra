import { LlmRuntime } from '../../../workers/agent-host/src/llm-steps.ts';
import { HttpLlmClient } from '../../../workers/agent-host/src/http-llm.ts';
import { mkdir, writeFile } from 'node:fs/promises';
const llm = new LlmRuntime({http:{local:new HttpLlmClient({kind:'local',endpoint:'http://127.0.0.1:11434/v1',model:process.env['ASTRA_QUALITY_MODEL'] ?? 'qwen3.5:9b',maxOutputTokens:4096,reasoningEffort:"none"})}});
const cases = [
 ['announcement','llm.compose',{instruction:'社内向けのお知らせ文を1つ、本文のみ100字以内で作成してください。情報は「金曜日15時にリリース確認会」「参加者は開発チーム」「事前にテスト結果を共有」の3点だけです。署名・URLは入れないでください。'}],
 ['video','llm.compose',{context:'AstraはmacOSアプリです。スマホは撮影の機材で、Astraの動作端末ではありません。Astraで今回使う機能はHomeで依頼文を入力、Workで完成した文章を開く、コピー、Markdown保存の4つだけ。素材はこの4操作の画面収録。グラフ・動画編集・テーマ変更機能はない。',instruction:'Astraの操作画面を素材に、30秒の縦型動画の構成を3案作成してください。個人開発者がスマホだけ・予算0円で撮れます。各案に冒頭2秒のフック、秒数付きの構成、最後の一言を含めてください。3案は別の見せ方にし、実測していない時間短縮や成功実績は主張しないでください。'}],
 ['website','llm.compose',{instruction:'架空の住宅修理会社のWebサイト改善提案を1つ作成してください。現状として分かっているのは「スマートフォンでは問い合わせボタンが最下部だけ」「施工例は文章だけ」「料金が掲載されていない」の3点です。優先順位順に改善案を3項目、各項目に狙いと確認指標を含めてください。売上増加などの未検証の数字は書かないでください。'}],
 ['grounded','llm.answer',{question:'金曜日までに誰が何をすることになっていますか？',context:'会議の決定事項：佐藤は金曜日までにテスト結果を共有する。田中は来週月曜日に画面案を提出する。'}],
 ['unknown','llm.answer',{question:'この施策で売上は何％増えますか？',context:'問い合わせボタンを画面上部に追加する予定。利用者テストや売上データはまだありません。'}],
] as const;
const output=process.env['ASTRA_QUALITY_OUTPUT'] ?? '/tmp/astra-quality-adopted';
await mkdir(output,{recursive:true});
for(const [id,toolId,args] of cases){ const started=Date.now(); const result=await llm.run({id,toolId,args,approval:null}); await writeFile(`${output}/${id}.json`,JSON.stringify({id,elapsedMs:Date.now()-started,result},null,2)); console.log(id,result.ok,Date.now()-started); }
