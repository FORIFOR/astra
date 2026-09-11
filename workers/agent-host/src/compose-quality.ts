/** Cheap checks for observed drafting failures. Limited checks, not a factual certification. */
export function compositionIssues(text: string, args: Record<string, unknown>): string[] {
  const instruction = String(args['instruction'] ?? '');
  const context = String(args['context'] ?? '');
  const source = `${context}\n${instruction}`;
  const issues: string[] = [];
  if (
    /未検証|未測定|実測していない|根拠のない/.test(source) &&
    /書かない|主張しない|補わない|断定しない|禁止/.test(instruction)
  ) {
    const known = quantities(source);
    const invented = [...quantities(text)].filter((value) => !known.has(value));
    if (invented.length)
      issues.push(
        `根拠が提供されていない数値（${invented.slice(0, 8).join('、')}）を追加しています。数値目標や効果を創作せず、確認する指標と比較方法だけを書いてください。`,
      );
  }
  if (!/動画|台本|ショート|リール/.test(instruction)) return issues;
  if (
    text
      .split(/[。\n]/)
      .some(
        (line) =>
          /無料|0円/.test(line) &&
          !/撮影|制作|素材|予算/.test(line) &&
          !/(?:無料|0円)(?:では|じゃ|とは)(?:ない|ありません)/.test(line),
      ) &&
    /予算(?:は|が)?\s*0円/.test(instruction) &&
    !/(?:料金|価格)[は:：]?\s*(?:無料|0円)|(?:製品|アプリ|Astra)[は:：]?\s*無料/.test(context)
  )
    issues.push('制作予算0円を製品価格と混同しています。「無料」「0円」の宣伝を削除してください。');
  if (
    /\d+\s*秒で[^\n。]{0,30}(?:完成|保存|生成|完了)/.test(text) &&
    /実測していない|未測定|保証.*しない/.test(source)
  )
    issues.push(
      '未測定の処理速度を宣伝しています。「○秒で完成・保存」の表現を削除してください。動画の尺と製品の処理時間は別です。',
    );
  if (
    /macOS|Macアプリ/.test(context) &&
    (/スマホ(?:の)?画面[^\n。]*(?:Home|Work|Astra)|(?:Astra|アプリアイコン)[^\n。]*タップ/i.test(
      text,
    ) ||
      text
        .split(/[。\n]/)
        .some(
          (line) =>
            /スマホ(?:だけ|一台|1台)で[^\n。]*(?:完結|文章|作成|操作)/.test(
              line.normalize('NFKC'),
            ) && !/撮影|収録/.test(line),
        ))
  )
    issues.push(
      'Macのアプリをスマホで操作する場面になっています。スマホは撮影機材で、操作対象はMacです。',
    );
  const optionHeading = /^(?:#{1,6}\s*)?(?:\*{1,2})?案\s*[0-9一二三四五]/;
  const options = text
    .normalize('NFKC')
    .split(/(?=^(?:#{1,6}\s*)?(?:\*{1,2})?案\s*[0-9一二三四五])/m)
    .filter((s) => optionHeading.test(s));
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      if (similarity(options[i]!, options[j]!) > 0.66) {
        issues.push(
          `案${i + 1}と案${j + 1}は内容がほぼ同じです。説明の順番と見せ場から作り分けてください。`,
        );
      }
    }
  }
  return issues;
}

function quantities(text: string): Set<string> {
  return new Set(
    [...text.normalize('NFKC').matchAll(/\d+(?:\.\d+)?\s*(?:%|倍)|半分/g)].map((match) =>
      match[0].replace(/\s/g, ''),
    ),
  );
}

function similarity(left: string, right: string): number {
  const grams = (s: string) => {
    const text = s.replace(/^#{1,6}[^\n]+/gm, '').replace(/[\s\p{P}\p{N}]/gu, '');
    return new Set(
      Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)),
    );
  };
  const a = grams(left),
    b = grams(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((part) => b.has(part)).length / Math.min(a.size, b.size);
}
