/**
 * 初期セットアップ。正本 §3。
 *
 * 守りたいのは 3 つ:
 *   - 画面に説明を並べない
 *   - 一度に全 permission を要求しない
 *   - 動画ではなく 1 回の成功体験で終える
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7 } from '@astra/contracts';
import { Onboarding } from '../src/onboarding/Onboarding.js';

afterEach(cleanup);

const fakeClient = (over: Record<string, unknown> = {}) =>
  ({
    updateOnboarding: vi.fn(async () => ({})),
    onboardingRecommendations: vi.fn(async () => ({
      items: [
        {
          plugin_id: 'com.astra.gmail',
          name: 'Gmail',
          because: '営業を選んだため',
          permissions: ['email.read'],
        },
      ],
      permissions: ['calendar_contacts', 'notifications'],
    })),
    installPlugin: vi.fn(async () => ({})),
    createTask: vi.fn(async () => ({ id: uuidv7() })),
    ...over,
  }) as never;

const start = (client = fakeClient(), onDone = vi.fn()) => {
  render(<Onboarding client={client} onDone={onDone} />);
  return { client, onDone };
};

describe('step 1 — the promise', () => {
  it('says one sentence, not a list of features', () => {
    start();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '話すか、打つだけ。調べる・作る・動かすまでやります。',
    );
    // 機能一覧を並べない
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('step 2 — how they like to work', () => {
  it('says plainly that the choice does not limit anything', async () => {
    start();
    await userEvent.click(screen.getByRole('button', { name: '始める' }));
    expect(screen.getByText(/機能は変わりません/)).toBeTruthy();
  });
});

describe('step 3 — what to take on', () => {
  const toInterests = async () => {
    await userEvent.click(screen.getByRole('button', { name: '始める' }));
    await userEvent.click(screen.getByRole('button', { name: '両方' }));
  };

  it('will not move on until something is chosen', async () => {
    start();
    await toInterests();
    expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '営業' }));
    expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('takes more than one', async () => {
    start();
    await toInterests();
    await userEvent.click(screen.getByRole('button', { name: '営業' }));
    await userEvent.click(screen.getByRole('button', { name: '会議' }));
    expect(screen.getByRole('button', { name: '営業' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '会議' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('step 4 — what it recommends', () => {
  const toPacks = async () => {
    await userEvent.click(screen.getByRole('button', { name: '始める' }));
    await userEvent.click(screen.getByRole('button', { name: '両方' }));
    await userEvent.click(screen.getByRole('button', { name: '営業' }));
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
  };

  it('says why each one is recommended', async () => {
    start();
    await toPacks();
    expect(await screen.findByText('Gmail')).toBeTruthy();
    // 「たぶん要る」で薦めない
    expect(screen.getByText('営業を選んだため')).toBeTruthy();
  });

  it('shows the permissions before anything is installed', async () => {
    const { client } = start();
    await toPacks();
    await screen.findByText('Gmail');
    expect(screen.getByText('email.read')).toBeTruthy();
    expect(
      (client as unknown as { installPlugin: ReturnType<typeof vi.fn> }).installPlugin,
    ).not.toHaveBeenCalled();
  });

  it('lets them skip installing anything', async () => {
    start();
    await toPacks();
    await screen.findByText('Gmail');
    await userEvent.click(screen.getByRole('button', { name: 'あとで' }));
    expect(screen.getByRole('heading', { name: '必要な許可' })).toBeTruthy();
  });
});

describe('step 5 — permissions', () => {
  const toPermissions = async () => {
    await userEvent.click(screen.getByRole('button', { name: '始める' }));
    await userEvent.click(screen.getByRole('button', { name: '両方' }));
    await userEvent.click(screen.getByRole('button', { name: '営業' }));
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByText('Gmail');
    await userEvent.click(screen.getByRole('button', { name: 'あとで' }));
  };

  it('says what each permission is for, right where it asks', async () => {
    // まとめて求めると、何のために許すのか分からないまま許すことになる
    start();
    await toPermissions();
    expect(screen.getByText(/次の会議と参加者を把握するため/)).toBeTruthy();
    expect(screen.getByText(/長い仕事が終わったときに知らせるため/)).toBeTruthy();
  });

  it('lets them grant nothing and move on', async () => {
    const { client } = start();
    await toPermissions();
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByRole('heading', { name: '呼び出し方' })).toBeTruthy();

    const saved = (client as unknown as { updateOnboarding: ReturnType<typeof vi.fn> })
      .updateOnboarding.mock.calls;
    const permissionCall = saved.find((c) => 'granted_permissions' in (c[0] as object));
    expect((permissionCall![0] as { granted_permissions: string[] }).granted_permissions).toEqual(
      [],
    );
  });
});

describe('step 7 — the first real thing', () => {
  const toFirstTask = async () => {
    await userEvent.click(screen.getByRole('button', { name: '始める' }));
    await userEvent.click(screen.getByRole('button', { name: '両方' }));
    await userEvent.click(screen.getByRole('button', { name: '営業' }));
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByText('Gmail');
    await userEvent.click(screen.getByRole('button', { name: 'あとで' }));
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
  };

  it('asks for one annoying thing, not a tutorial', async () => {
    start();
    await toFirstTask();
    expect(
      screen.getByRole('heading', { name: '今、面倒なことを1つ頼んでください。' }),
    ).toBeTruthy();
  });

  it('actually runs something before it calls itself done', async () => {
    // 送り切っただけで完了にすると、成功体験のないまま製品が始まる
    const { client, onDone } = start();
    await toFirstTask();
    await userEvent.click(screen.getByRole('button', { name: '試してみる' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(
      (client as unknown as { createTask: ReturnType<typeof vi.fn> }).createTask,
    ).toHaveBeenCalled();

    const saved = (client as unknown as { updateOnboarding: ReturnType<typeof vi.fn> })
      .updateOnboarding.mock.calls;
    const done = saved.find((c) => (c[0] as { step?: string }).step === 'done');
    expect((done![0] as { first_task_id: string }).first_task_id).toBeTruthy();
  });

  it('says what went wrong instead of pretending it finished', async () => {
    const { onDone } = start(
      fakeClient({
        createTask: vi.fn(async () => {
          throw new Error('まだ接続できていません');
        }),
      }),
    );
    await toFirstTask();
    await userEvent.click(screen.getByRole('button', { name: '試してみる' }));

    expect((await screen.findByRole('alert')).textContent).toContain('まだ接続できていません');
    expect(onDone).not.toHaveBeenCalled();
  });
});
