// Read-only Temporal poller check. No synthetic task, model call, or artifact.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../services/task/package.json', import.meta.url));
const { Connection } = require('@temporalio/client');
const connection = await Connection.connect({
  address: process.env.TEMPORAL_ADDRESS,
  connectTimeout: '5 seconds',
});
try {
  for (const taskQueueType of [1, 2]) {
    const result = await connection.workflowService.describeTaskQueue({
      namespace: 'default',
      taskQueue: { name: process.env.ASTRA_TASK_QUEUE },
      taskQueueType,
    });
    if (!result.pollers?.length) process.exitCode = 1;
  }
} finally {
  await connection.close();
}
