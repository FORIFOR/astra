/**
 * task.kind を人の言葉に。UI/UX §6「内部ステップ名をそのまま見せない」。
 * 知らない kind は隠さず、そのまま出す（黙って落とさない）。
 */
const KIND_LABEL: Record<string, string> = {
  echo: '試しの仕事',
  assistant: '質問への答え',
  research: '調べもの',
  meeting: '会議',
  'meeting-summary': '会議のまとめ',
  email: 'メール',
  calendar: '予定',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
