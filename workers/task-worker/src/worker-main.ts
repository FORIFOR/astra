/**
 * Temporal worker の起動口。実装仕様 §6.2。
 *
 * 制御プレーン（api-gateway）とは別プロセスで動かす。ADR 0001 は
 * サービスを 1 プロセスに畳むと決めているが、worker は別枠にしてある:
 * ワークフローのサンドボックスと activity の実行を、HTTP の応答性と
 * 同じイベントループに乗せたくないため。
 */
import path from 'node:path';
import { NativeConnection } from '@temporalio/worker';
import { createDb, dbConfigFromEnv } from '@astra/db';
import { createLogger } from '@astra/telemetry';
import { FsObjectStore, LibraryService } from '@astra/service-library';
import {
  ResearchService,
  researchExecutors,
  researchProvidersFromEnv,
} from '@astra/service-research';
import {
  FsRecordingStore,
  MeetingService,
  meetingExecutors,
  meetingProvidersFromEnv,
} from '@astra/service-meeting';
// 数え方は gateway と同じものを使う。別々に数えると片方だけ見落とす。
import { assertNoStandIns } from '@astra/contracts';
import { capabilityReport } from '@astra/service-capabilities';
import { createTaskWorker, TASK_QUEUE, NoopPublisher } from '@astra/service-task';

async function main(): Promise<void> {
  const logger = createLogger({
    service: 'task-worker',
    level: process.env['ASTRA_LOG_LEVEL'] ?? 'info',
    pretty: process.env['ASTRA_ENV'] === 'development',
  });

  const db = createDb(dbConfigFromEnv());
  // 相対パスは cwd 依存なので絶対化してから使う。gateway と同じ場所を指す必要がある。
  const objectStoreRoot = path.resolve(process.env['ASTRA_OBJECT_STORE_ROOT'] ?? './.data/objects');
  const library = new LibraryService(db, new FsObjectStore(objectStoreRoot));

  const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
  const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'default';
  const taskQueue = process.env['ASTRA_TASK_QUEUE'] ?? TASK_QUEUE;

  // 設定されたものだけ本物になる。決まっていないものは代役のまま名乗る
  // （Phase 2 実装仕様 §1.1 / Phase 3 実装仕様 §1.1）。
  const researchProviders = researchProvidersFromEnv(process.env);
  const meetingProviders = await meetingProvidersFromEnv(process.env);

  /*
   * 本番で代役のまま動かさない。**何が代役なのかを名指しで言う。**
   *
   * 数え方は gateway と同じものを使う。別々に数えると、
   * 片方だけ新しい能力を見落とす（実際、gateway は言語モデルを見ていなかった）。
   */
  const report = capabilityReport({
    research: researchProviders,
    meeting: meetingProviders,
    env: process.env,
  });
  const { warn, remaining } = assertNoStandIns(report, process.env['ASTRA_ENV'] ?? 'development');
  if (warn) logger.warn({ stand_ins: remaining.map((r) => r.capability) }, warn);

  const research = new ResearchService({
    db,
    search: researchProviders.search,
    model: researchProviders.model,
  });

  const recordingRoot = path.resolve(process.env['ASTRA_RECORDING_ROOT'] ?? './.data/recordings');
  const meetings = new MeetingService({ db, publisher: NoopPublisher });

  const connection = await NativeConnection.connect({ address });
  const worker = await createTaskWorker(
    {
      db,
      library,
      publisher: NoopPublisher,
      executors: {
        ...researchExecutors(research),
        ...meetingExecutors({
          meetings,
          library,
          recordings: new FsRecordingStore(recordingRoot),
          batch: meetingProviders.batch,
          summarizer: meetingProviders.summarizer,
        }),
      },
    },
    { connection, namespace, taskQueue },
  );

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down the task worker');
    worker.shutdown();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info(
    { address, namespace, taskQueue, object_store: objectStoreRoot, recordings: recordingRoot },
    'task worker listening',
  );
  await worker.run();

  await connection.close();
  await db.close();
}

main().catch((error: unknown) => {
  // 起動不能。握りつぶさず終了コードで知らせる。
  console.error(error);
  process.exit(1);
});
