/**
 * Inspector の中身。UI/UX §7.1。
 * 開けるようになっても、中身が無ければ「詳細」と書いた空の panel でしかない。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { TaskView } from '@astra/api-client';
import { INSPECTOR_TABS, TaskInspector } from '../src/shell/TaskInspector.js';

afterEach(cleanup);

const task = {
  id: '01a00000-0000-7000-8000-000000000001',
  title: 'A社 商談準備',
  status: 'RUNNING',
  input: { message: 'A社向けの提案を直して' },
  started_at: '2026-08-27T09:00:00.000Z',
} as unknown as TaskView;

describe('the inspector shows the surroundings of the open job', () => {
  it('offers context, evidence and activity — the three the spec names', () => {
    render(<TaskInspector client={null} task={task} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(
      INSPECTOR_TABS.map((t) => t.label),
    );
  });

  it('starts on context and shows what the job is about', () => {
    render(<TaskInspector client={null} task={task} />);
    expect(screen.getByText('A社 商談準備')).toBeTruthy();
    expect(screen.getByText('A社向けの提案を直して')).toBeTruthy();
  });

  it('switches tabs', async () => {
    const user = userEvent.setup();
    render(<TaskInspector client={null} task={task} />);
    await user.click(screen.getByRole('tab', { name: '根拠' }));
    expect(screen.getByRole('tab', { name: '根拠' }).getAttribute('aria-selected')).toBe('true');
  });

  it('says so when nothing is open, instead of lining up empty tabs', () => {
    render(<TaskInspector client={null} task={null} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText(/仕事を開くと/)).toBeTruthy();
  });
});
