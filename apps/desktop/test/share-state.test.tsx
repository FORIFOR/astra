/**
 * 共有の状態。UI/UX §10.2・§22。
 *
 * 既定はオフ。だが**既定を、常にオフと書いてはいけない。**
 * 出したつもりのないものが出ている状態に気付けなくなる。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { uuidv7, type Share } from '@astra/contracts';
import { ArtifactShareState, ShareState, activeShares } from '../src/library/ShareState.js';

afterEach(cleanup);

const NOW = new Date('2026-08-27T04:00:00.000Z');

const share = (over: Partial<Share> = {}): Share =>
  ({
    id: uuidv7(),
    tenant_id: uuidv7(),
    artifact_id: uuidv7(),
    created_by: uuidv7(),
    policy: {
      allow_download: false,
      one_time: false,
      requires_password: true,
      allowlist: [],
      watermark: false,
    },
    expires_at: '2026-08-28T00:00:00.000Z',
    revoked_at: null,
    consumed_at: null,
    access_count: 0,
    created_at: '2026-08-27T00:00:00.000Z',
    ...over,
  }) as Share;

describe('which shares still count', () => {
  it('drops the ones that no longer open', () => {
    const live = share();
    const expired = share({ expires_at: '2026-08-26T00:00:00.000Z' });
    const revoked = share({ revoked_at: '2026-08-27T01:00:00.000Z' });
    const used = share({ consumed_at: '2026-08-27T01:00:00.000Z', policy: live.policy });

    expect(activeShares([live, expired, revoked, used], NOW)).toEqual([live]);
  });
});

describe('what the header says', () => {
  it('says off when nothing is shared', () => {
    render(<ShareState shares={[]} now={NOW} />);
    expect(screen.getByText('共有: オフ')).toBeTruthy();
  });

  it('does not call an unknown state "off"', () => {
    // まだ確かめていないものを、オフと書かない
    render(<ShareState shares={null} now={NOW} />);
    expect(screen.getByText('共有: 確認しています')).toBeTruthy();
    expect(screen.queryByText('共有: オフ')).toBeNull();
  });

  it('shows expiry, password and download for a live share (§22)', () => {
    render(
      <ShareState
        shares={[
          share({
            policy: {
              allow_download: true,
              one_time: true,
              requires_password: false,
              allowlist: [],
              watermark: false,
            },
            access_count: 3,
          }),
        ]}
        now={NOW}
      />,
    );
    const header = screen.getByLabelText('共有の状態');
    expect(header.textContent).toContain('共有: オン');
    expect(header.textContent).toContain('まで');
    expect(header.textContent).toContain('合言葉なし');
    expect(header.textContent).toContain('ダウンロード可');
    expect(header.textContent).toContain('一度きり');
    expect(header.textContent).toContain('3 回開かれました');
  });

  it('counts the links when there is more than one', () => {
    render(<ShareState shares={[share(), share()]} now={NOW} />);
    expect(screen.getByText(/共有: オン（2 件のリンク）/)).toBeTruthy();
  });
});

describe('when the state cannot be read', () => {
  it('says so rather than reporting off', async () => {
    const client = {
      artifactShares: vi.fn(async () => {
        throw new Error('接続できません');
      }),
    } as never;
    render(<ArtifactShareState client={client} artifactId={uuidv7()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('接続できません'));
    // 取れなかったことを「オフ」にしない
    expect(screen.queryByText('共有: オフ')).toBeNull();
  });

  it('reports off only once the server actually said so', async () => {
    const client = { artifactShares: vi.fn(async () => []) } as never;
    render(<ArtifactShareState client={client} artifactId={uuidv7()} />);
    await waitFor(() => expect(screen.getByText('共有: オフ')).toBeTruthy());
  });
});
