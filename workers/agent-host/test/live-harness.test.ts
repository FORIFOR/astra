/**
 * WORK_CONTEXT_LIVE_GATE の無人 harness の、live 無しで確かめられる部分。
 *
 *   - harness 用のファイルストアは 0600 で、login keychain を触らない
 *   - fixture は相対の日付で、nonce が件名に入る
 *   - 期待値の判定は機械で読める（通る形 / 通らない形の両方）
 */
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkContext } from '@astra/contracts';
import { FileSecretStore, keychainFor } from '../src/keychain.js';
import { checkLiveExpectations, liveFixture } from '../src/live-fixture.js';

describe('file secret store (harness only)', () => {
  it('round-trips values in a 0600 file and is chosen only when asked for', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'astra-secrets-'));
    const file = path.join(dir, 'secrets.json');
    const store = new FileSecretStore(file);
    expect(await store.get('a')).toBeNull();
    await store.set('a', 'v1');
    expect(await store.get('a')).toBe('v1');
    expect(((await stat(file)).mode & 0o777).toString(8)).toBe('600');
    await store.delete('a');
    expect(await store.get('a')).toBeNull();

    expect(keychainFor('darwin', 'me', { ASTRA_SECRET_STORE_FILE: file })).toBeInstanceOf(
      FileSecretStore,
    );
    expect(keychainFor('darwin', 'me', {})).not.toBeInstanceOf(FileSecretStore);
  });
});

describe('live fixture and expectations', () => {
  const now = new Date('2026-09-07T03:00:00.000Z');
  const f = liveFixture(now, 'WC1234');

  it('tags everything with the nonce and uses relative dates', () => {
    expect(f.mailA.subject).toContain('WC1234');
    expect(f.mailB.subject).toContain('WC1234');
    expect(f.meeting.subject).toContain('WC1234');
    expect(f.task.title).toContain('WC1234');
    expect(new Date(f.deadlineIso).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(f.meeting.startIso).getTime()).toBeGreaterThan(now.getTime());
    expect(f.mailA.body).toMatch(/までに見積をください/);
  });

  it('passes on the expected graph and names what is missing otherwise', () => {
    const src = {
      source: 'gmail' as const,
      external_id: 'm1',
      label: f.mailA.subject,
      observed_at: now.toISOString(),
      url: null,
      excerpt: f.mailA.body.slice(0, 200),
    };
    const good: WorkContext = {
      generated_at: now.toISOString(),
      inference_enabled: true,
      priorities: [
        {
          id: 'project:x',
          project: f.project,
          title: '見積を返す',
          score: 0.71,
          due_at: f.deadlineIso,
          waiting_on: null,
          lines: ['Example Client からの返信待ち', `明日 15:00 顧客定例`],
          counts: { gmail: 2 },
          factors: [],
          sources: [src],
        },
      ],
      waiting_on: [],
      owed: [
        {
          id: 'owed:m1',
          to: 'Example Client',
          what: '見積を送る',
          due_at: f.deadlineIso,
          project: f.project,
          sources: [src],
        },
      ],
      week: { meeting_hours: 1, deadlines: 1, unanswered: 2, waiting: 0 },
      sources: { gmail: 2 } as WorkContext['sources'],
    };
    const rows = checkLiveExpectations(good, f, now);
    expect(
      rows.every((r) => r.ok),
      rows.map((r) => `${r.row}:${r.detail}`).join(' | '),
    ).toBe(true);

    const bad: WorkContext = { ...good, priorities: [], owed: [] };
    const failing = checkLiveExpectations(bad, f, now)
      .filter((r) => !r.ok)
      .map((r) => r.row);
    expect(failing).toEqual([
      'project',
      'deadline',
      'self_waiting',
      'meeting',
      'pressure',
      'provenance',
    ]);
  });
});
