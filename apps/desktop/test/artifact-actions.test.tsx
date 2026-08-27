/** preview からの download / share（UI/UX §10.1・§10.2）。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AstraClient } from '@astra/api-client';
import type { Artifact } from '@astra/contracts';
import { ArtifactActions, parseAllowlist } from '../src/library/ArtifactActions.js';

afterEach(cleanup);

const artifact = { id: 'art-1', title: 'A社 提案書' } as unknown as Artifact;

describe('parseAllowlist', () => {
  it('accepts commas, spaces and newlines, and drops noise', () => {
    expect(parseAllowlist('a@x.io, @corp.jp\n b@y.io  ,,')).toEqual([
      'a@x.io',
      '@corp.jp',
      'b@y.io',
    ]);
    expect(parseAllowlist('')).toEqual([]);
  });
});

describe('ArtifactActions', () => {
  it('creates a share with the chosen policy and shows the link once', async () => {
    const user = userEvent.setup();
    const createShare = vi.fn(async () => ({
      share: {} as never,
      url: 'https://astra.local/s/abc',
    }));
    const client = { createShare, artifactContent: vi.fn() } as unknown as AstraClient;
    const onShared = vi.fn();
    render(<ArtifactActions client={client} artifact={artifact} onShared={onShared} />);

    await user.click(screen.getByRole('button', { name: '共有…' }));
    await user.selectOptions(screen.getByLabelText('期限'), '1d');
    await user.type(screen.getByLabelText(/合言葉/), 'hunter2');
    await user.click(screen.getByLabelText('ダウンロードを許す'));
    await user.type(screen.getByLabelText(/開ける人/), '@corp.jp');
    await user.click(screen.getByRole('button', { name: 'リンクを作る' }));

    expect(createShare).toHaveBeenCalledWith('art-1', {
      expires_in: '1d',
      allow_download: true,
      one_time: false,
      allowlist: ['@corp.jp'],
      watermark: false,
      password: 'hunter2',
    });
    expect((screen.getByLabelText('共有リンク') as HTMLInputElement).value).toBe(
      'https://astra.local/s/abc',
    );
    expect(onShared).toHaveBeenCalled();
  });

  it('never sends a password shorter than four characters', async () => {
    const user = userEvent.setup();
    const createShare = vi.fn(async (_id: string, _body: unknown) => ({
      share: {} as never,
      url: 'u',
    }));
    const client = { createShare } as unknown as AstraClient;
    render(<ArtifactActions client={client} artifact={artifact} />);
    await user.click(screen.getByRole('button', { name: '共有…' }));
    await user.type(screen.getByLabelText(/合言葉/), 'ab');
    await user.click(screen.getByRole('button', { name: 'リンクを作る' }));
    expect(createShare.mock.calls[0]?.[1]).not.toHaveProperty('password');
  });

  it('is disabled without a connection instead of failing silently', () => {
    render(<ArtifactActions client={null} artifact={artifact} />);
    expect(
      (screen.getByRole('button', { name: 'ダウンロード' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '共有…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
