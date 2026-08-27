/**
 * Top bar。UI/UX §7.1: page title / global search / notifications / profile。
 * Appendix A の GlobalSearch（idle / results）。
 */
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { TaskView } from '@astra/api-client';
import type { Artifact } from '@astra/contracts';
import { ThemeProvider } from '../src/state/ThemeProvider.js';
import { ShellProvider } from '../src/state/ShellProvider.js';
import { AppShell } from '../src/shell/AppShell.js';
import { searchWorkspace } from '../src/shell/GlobalSearch.js';
import { initialOf } from '../src/shell/ProfileMenu.js';
import { relativeTime } from '../src/home/time.js';
import { kindLabel } from '../src/work/kind.js';

afterEach(cleanup);

function Shell(): JSX.Element {
  return (
    <ThemeProvider>
      <ShellProvider>
        <AppShell>
          <div />
        </AppShell>
      </ShellProvider>
    </ThemeProvider>
  );
}

const task = (id: string, title: string | null, kind = 'research'): TaskView =>
  ({ id, title, kind, status: 'RUNNING', dockState: 'working' }) as unknown as TaskView;
const artifact = (id: string, title: string): Artifact =>
  ({ id, title, type: 'document' }) as unknown as Artifact;

describe('top bar (§7.1)', () => {
  it('shows title, search, notifications and profile', () => {
    render(<Shell />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
    expect(screen.getByRole('searchbox', { name: '仕事・成果物を検索' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '通知' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /アカウント/ })).not.toBeNull();
  });

  it('keeps 外観 and 設定 inside the profile menu, not on the bar', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(screen.queryByLabelText('外観')).toBeNull();
    await user.click(screen.getByRole('button', { name: /アカウント/ }));
    expect(screen.getByLabelText('外観')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: '設定' }));
    expect(screen.getByRole('group', { name: '設定' })).not.toBeNull();
  });

  it('says it is quiet when there is nothing to attend to', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: '通知' }));
    expect(screen.getByText(/静かです/)).not.toBeNull();
  });
});

describe('searchWorkspace', () => {
  const tasks = [task('t1', 'A社 商談準備'), task('t2', null, 'echo'), task('t3', 'B社 見積')];
  const artifacts = [artifact('a1', 'A社向け提案'), artifact('a2', '議事録')];

  it('is idle on an empty query', () => {
    expect(searchWorkspace('   ', tasks, artifacts)).toEqual([]);
  });

  it('finds work and artifacts by title, work first', () => {
    const hits = searchWorkspace('a社', tasks, artifacts);
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(['task:t1', 'artifact:a1']);
  });

  it('finds untitled work by what kind of work it is', () => {
    const hits = searchWorkspace('試し', tasks, artifacts);
    expect(hits.map((h) => h.id)).toEqual(['t2']);
    expect(hits[0]!.title).toBe('名前のない仕事');
  });

  it('never returns more than eight', () => {
    const many = Array.from({ length: 20 }, (_, i) => task(`t${i}`, `仕事 ${i}`));
    expect(searchWorkspace('仕事', many, [])).toHaveLength(8);
  });
});

describe('small helpers', () => {
  it('takes the first character as the avatar initial', () => {
    expect(initialOf('堀尾')).toBe('堀');
    expect(initialOf('  shuhei ')).toBe('S');
    expect(initialOf(null)).toBe('?');
  });

  it('describes time in words a person would use', () => {
    const now = Date.parse('2026-08-27T12:00:00+09:00');
    expect(relativeTime('2026-08-27T11:59:40+09:00', now)).toBe('たった今');
    expect(relativeTime('2026-08-27T11:15:00+09:00', now)).toBe('45分前');
    expect(relativeTime('2026-08-27T08:00:00+09:00', now)).toBe('4時間前');
    expect(relativeTime('2026-08-25T12:00:00+09:00', now)).toBe('2日前');
    expect(relativeTime('2026-08-01T12:00:00+09:00', now)).toBe('8/1');
    expect(relativeTime('nonsense', now)).toBe('');
  });

  it('never hides an unknown kind', () => {
    expect(kindLabel('research')).toBe('調べもの');
    expect(kindLabel('com.example.custom')).toBe('com.example.custom');
  });
});
