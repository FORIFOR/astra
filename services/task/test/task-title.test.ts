import { expect, it } from 'vitest';
import { Task } from '@astra/contracts';
import { boundedTaskTitle } from '../src/task-title.js';

it('keeps a long creative request readable as task metadata, including legacy rows', () => {
  const request = 'Astraを紹介する動画の構成を3案。対象、予算、撮影手順を示してください。'.repeat(
    20,
  );
  for (const value of [null, '既存の題名', request, 'a'.repeat(198) + '🎬'.repeat(12)]) {
    const title = boundedTaskTitle(value);
    expect(Task.shape.title.safeParse(title).success).toBe(true);
    expect(title?.endsWith('\ud83c…')).not.toBe(true);
  }
  expect(boundedTaskTitle(request)).toContain('Astraを紹介する動画');
  expect(request.length).toBeGreaterThan(200);
});
