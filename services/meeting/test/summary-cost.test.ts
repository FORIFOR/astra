import { describe, expect, it, vi } from 'vitest';
import { meetingExecutors } from '../src/executor.js';
import { withMeetingSummary, planTask } from '../../task/src/plan.js';

describe('summary generation is reused when rendering the bundle', () => {
  it('calls the model once across summarizing, worker restart, and repeated bundle rendering', async () => {
    const summarize = vi.fn(async () => ({
      summary: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
    }));
    const deps = {
      meetings: {
        get: async () => ({ title: 'Test meeting' }),
        segments: async () => [],
        speakers: async () => [],
      },
      summarizer: { summarize },
    } as never;
    const input = { tenantId: 'tenant', userId: 'user', taskId: 'task', input: {} };
    const plan = planTask('meeting.finalize', {
      meeting_id: '00000000-0000-4000-8000-000000000001',
    });
    const steps = plan.steps;
    const summary = await meetingExecutors(deps)['meeting.summarize']!.execute(input, steps[3]!);
    const carried = withMeetingSummary(steps[4]!, steps, [null, null, null, summary.result]);
    for (let i = 0; i < 2; i++) {
      const result = await meetingExecutors(deps)['meeting.bundle']!.execute(input, carried);
      expect(result.artifact?.markdown).toContain('Test meeting');
    }
    expect(summarize).toHaveBeenCalledTimes(1);
    await expect(
      meetingExecutors(deps)['meeting.bundle']!.execute(input, {
        ...carried,
        args: { ...carried.args, summary_result: { broken: true } },
      }),
    ).rejects.toThrow();
    expect(summarize).toHaveBeenCalledTimes(1); // invalid cached output must not silently regenerate
  });
});
