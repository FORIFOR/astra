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
  DeterministicLanguageModel,
  ResearchService,
  StaticSearchProvider,
  researchExecutors,
} from '@astra/service-research';
import {
  FsRecordingStore,
  KeywordSummarizer,
  MeetingService,
  ScriptedBatchTranscriber,
  meetingExecutors,
} from '@astra/service-meeting';
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

  // LLM・検索・STT のプロバイダは未決（OQ-3 / OQ-11）。決定的な実装で先に配線しておき、
  // 決まったら差し替える（Phase 2 実装仕様 §1.1 / Phase 3 実装仕様 §1.1）。
  // 本番で代役のまま動かさないよう、明示的に拒む。
  if (process.env['ASTRA_ENV'] === 'production') {
    throw new Error(
      'research and meeting providers are still the deterministic stand-ins; wire real search/model/STT providers before production',
    );
  }
  const research = new ResearchService({
    db,
    search: new StaticSearchProvider([]),
    model: new DeterministicLanguageModel(),
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
          batch: new ScriptedBatchTranscriber([]),
          summarizer: new KeywordSummarizer(),
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
