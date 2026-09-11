import { expect, it } from 'vitest';
import { researchProvidersFromEnv, withModelContext } from '../src/factory.js';
it('overlapping tasks never send another user or task context to the model host', async () => {
  const seen: { taskId: string; userId: string; tenantId: string; question: unknown }[] = [];
  const { model } = researchProvidersFromEnv(
    {},
    {
      host: {
        execute: async (where, step) => {
          seen.push({ ...where, question: step.args['question'] });
          return { result: { answer: String(step.args['question']) } };
        },
      },
    },
  );
  const task = async (id: string, delay: number) =>
    withModelContext(
      { taskId: id, userId: 'user-' + id, tenantId: 'tenant-' + id, stepIndex: 0 },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return model.answer(id);
      },
    );
  expect(await Promise.all([task('A', 30), task('B', 5), task('C', 15)])).toEqual(['A', 'B', 'C']);
  for (const entry of seen)
    expect(entry).toEqual({
      taskId: entry.question,
      userId: 'user-' + entry.question,
      tenantId: 'tenant-' + entry.question,
      question: entry.question,
    });
  await expect(model.answer('outside a task')).rejects.toThrow();
});
