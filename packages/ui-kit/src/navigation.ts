/**
 * トップレベル Navigation。UI/UX §2.1、逸脱 D-16。
 *
 * **4 つから増やさない。** Plugin を入れても増えない（正本 §2 絶対原則、AC-12）。
 * 表示名は Home / Work / Library / Apps。内部の Agent Runtime / Plugin Registry と
 * いった技術名称は管理者向け画面でのみ使う。
 */
export const TOP_LEVEL_TABS = [
  {
    id: 'home',
    /*
     * §2.1 の表そのままの名前。内部で「AI Agent」「Plugin」を持っていても、
     * 上の 4 つは Home / Work / Library / Apps。片仮名に写していたのをやめた。
     */
    label: 'Home',
    path: '/home',
    /** 通常ユーザーが期待する答え（§2.1） */
    answers: '今、何をすべき？',
  },
  { id: 'work', label: 'Work', path: '/work', answers: '仕事はどこまで進んだ？' },
  { id: 'library', label: 'Library', path: '/library', answers: '結果はどこ？' },
  { id: 'apps', label: 'Apps', path: '/apps', answers: '何を追加できる？' },
] as const;

export type TabId = (typeof TOP_LEVEL_TABS)[number]['id'];

export const TAB_IDS = TOP_LEVEL_TABS.map((t) => t.id) as readonly TabId[];

export function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value);
}

export function tabForPath(path: string): TabId {
  return TOP_LEVEL_TABS.find((t) => path.startsWith(t.path))?.id ?? 'home';
}
