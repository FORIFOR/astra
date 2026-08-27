/**
 * Apps タブと dashboard。UI/UX §11、正本 §14.1。P4-08 / P4-09。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { DashboardView, PluginCatalogEntry } from '@astra/contracts';
import type { ReactElement } from 'react';
import { DashboardRenderer } from '../src/apps/DashboardRenderer.js';
import { InstallConsent } from '../src/apps/InstallConsent.js';
import { AppDetail } from '../src/apps/AppDetail.js';
import { AppsPage, packsFirst } from '../src/pages/Apps.js';

afterEach(cleanup);

const plugin = (over: Partial<PluginCatalogEntry> = {}): PluginCatalogEntry =>
  ({
    id: 'com.acme.pipeline',
    name: 'Pipeline',
    publisher: 'acme',
    verified: false,
    category: 'domain-agent',
    latest_version: '1.0.0',
    compliance_profile: 'GENERAL',
    builtin: false,
    removable: true,
    permissions: ['crm.read', 'crm.write'],
    data_accessed: ['商談の一覧'],
    tool_count: 7,
    execution_surfaces: ['cloud'],
    signature_state: 'VERIFIED',
    installed: false,
    installed_version: null,
    ...over,
  }) as PluginCatalogEntry;

const view = (data: Record<string, unknown>, items: unknown[]): DashboardView =>
  ({
    plugin_id: 'com.acme.pipeline',
    schema: { id: 'pipeline', title: 'パイプライン', layout: 'grid', items },
    data,
  }) as DashboardView;

describe('DashboardRenderer (§14.1)', () => {
  it('draws a metric from resolved data', () => {
    render(
      <DashboardRenderer
        view={view({ 'acme.total': { kind: 'count', value: 12 } }, [
          { type: 'metric', title: '件数', bind: 'acme.total' },
        ])}
      />,
    );
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('says why it could not draw, instead of showing a zero', () => {
    // 0 で描くと「無い」と「壊れている」が区別できない（D-34）
    render(
      <DashboardRenderer
        view={view({ 'acme.total': { kind: 'unavailable', reason: 'no host query named "x"' } }, [
          { type: 'metric', title: '件数', bind: 'acme.total' },
        ])}
      />,
    );
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('no host query named');
  });

  it('separates "resolved but empty" from "could not resolve"', () => {
    render(
      <DashboardRenderer
        view={view({ 'acme.rows': { kind: 'rows', columns: ['a'], rows: [] } }, [
          { type: 'table', title: '一覧', bind: 'acme.rows' },
        ])}
      />,
    );
    expect(screen.getByText('まだありません。')).toBeTruthy();
  });

  it('does not run plugin markup — text is drawn as text', () => {
    render(
      <DashboardRenderer
        view={view({}, [{ type: 'text', body: '<img src=x onerror=alert(1)>' }])}
      />,
    );
    // そのまま文字として出る。HTML として解釈しない。
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('says so when the data has the wrong shape', () => {
    render(
      <DashboardRenderer
        view={view({ 'acme.total': { kind: 'count', value: 3 } }, [
          { type: 'table', title: '一覧', bind: 'acme.total' },
        ])}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('データの形が合いません');
  });

  it('does not silently skip a component it cannot draw yet', () => {
    render(
      <DashboardRenderer
        view={view({ 'acme.board': { kind: 'rows', columns: [], rows: [[]] } }, [
          { type: 'kanban', title: 'ボード', bind: 'acme.board' },
        ])}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('まだ対応していません');
  });
});

describe('InstallConsent (§11.1)', () => {
  it('grants nothing until each scope is chosen', async () => {
    const onInstall = vi.fn();
    render(<InstallConsent plugin={plugin()} onCancel={() => {}} onInstall={onInstall} />);

    // 触るデータは押す前に見えている
    expect(screen.getByText('商談の一覧')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '追加する' }));
    // 押しただけで権限が付かない
    expect(onInstall).toHaveBeenCalledWith([]);

    await userEvent.click(screen.getByLabelText('crm.read'));
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));
    expect(onInstall).toHaveBeenLastCalledWith(['crm.read']);
  });
});

describe('AppDetail (§11.1)', () => {
  it('shows publisher, version, data and where it runs', () => {
    render(<AppDetail plugin={plugin()} onInstall={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/acme/)).toBeTruthy();
    expect(screen.getByText(/v1\.0\.0/)).toBeTruthy();
    expect(screen.getByText('商談の一覧')).toBeTruthy();
    expect(screen.getByText('クラウド')).toBeTruthy();
  });

  it('says how far the data goes, in one short phrase (§22)', () => {
    // crm.write は外へ出て行く
    const { unmount } = render(
      <AppDetail plugin={plugin()} onInstall={() => {}} onUninstall={() => {}} />,
    );
    expect(screen.getByText('外部へ送信')).toBeTruthy();
    expect(screen.getByText(/ほかのサービスへ送ります/)).toBeTruthy();
    unmount();

    // 自分の保管庫に書くだけのものを「外部へ送信」と言わない
    render(
      <AppDetail
        plugin={plugin({ permissions: ['artifacts.read', 'artifacts.write'] })}
        onInstall={() => {}}
        onUninstall={() => {}}
      />,
    );
    expect(screen.getByText('クラウドで処理')).toBeTruthy();
    expect(screen.queryByText('外部へ送信')).toBeNull();
  });

  it('calls a plugin that never leaves the machine local (§22)', () => {
    render(
      <AppDetail
        plugin={plugin({
          permissions: ['microphone.capture', 'files.read'],
          execution_surfaces: ['local'],
        })}
        onInstall={() => {}}
        onUninstall={() => {}}
      />,
    );
    expect(screen.getByText('手元だけ')).toBeTruthy();
    expect(screen.getByText(/外には出ません/)).toBeTruthy();
  });

  it('refuses to offer removal for a core capability', () => {
    render(
      <AppDetail
        plugin={plugin({ installed: true, installed_version: '1.0.0', removable: false })}
        onInstall={() => {}}
        onUninstall={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull();
    expect(screen.getByText(/中核の機能なので削除できません/)).toBeTruthy();
  });
});

describe('AppsPage (§11)', () => {
  it('puts packs before single connectors', () => {
    const ordered = packsFirst([
      plugin({ id: 'a' as never, name: 'Gmail', category: 'connector' }),
      plugin({ id: 'b' as never, name: 'Sales Pack', category: 'domain-agent' }),
      plugin({ id: 'c' as never, name: 'OCR', category: 'capability' }),
    ]);
    expect(ordered.map((p) => p.name)).toEqual(['Sales Pack', 'OCR', 'Gmail']);
  });

  const fakeClient = (over: Record<string, unknown> = {}) =>
    ({
      pluginCatalog: vi.fn().mockResolvedValue([plugin()]),
      dashboards: vi.fn().mockResolvedValue([]),
      installPlugin: vi.fn().mockResolvedValue({}),
      uninstallPlugin: vi.fn().mockResolvedValue(undefined),
      dashboard: vi.fn(),
      ...over,
    }) as never;

  const page = (client: never): ReactElement => <AppsPage client={client} />;

  it('asks for consent before installing anything', async () => {
    const client = fakeClient();
    render(page(client));

    await waitFor(() => expect(screen.getByRole('button', { name: /Pipeline/ })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /Pipeline/ }));
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    // 同意画面が出るまで install は呼ばれない
    expect(
      (client as unknown as { installPlugin: ReturnType<typeof vi.fn> }).installPlugin,
    ).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pipeline の追加')).toBeTruthy();
  });

  it('shows a dashboard that a plugin brought, with no code change', async () => {
    const client = fakeClient({
      dashboards: vi.fn().mockResolvedValue([
        {
          plugin_id: 'com.acme.pipeline',
          plugin_name: 'Pipeline',
          id: 'pipeline',
          title: 'パイプライン',
        },
      ]),
      dashboard: vi
        .fn()
        .mockResolvedValue(
          view({ 'acme.total': { kind: 'count', value: 42 } }, [
            { type: 'metric', title: '件数', bind: 'acme.total' },
          ]),
        ),
    });
    render(page(client));

    const entry = await screen.findByRole('button', { name: /Pipeline — パイプライン/ });
    await userEvent.click(entry);
    expect(await screen.findByText('42')).toBeTruthy();
  });

  it('says what went wrong instead of showing an empty page', async () => {
    const client = fakeClient({
      pluginCatalog: vi.fn().mockRejectedValue(new Error('catalog unavailable')),
    });
    render(page(client));
    expect((await screen.findByRole('alert')).textContent).toContain('catalog unavailable');
  });
});
