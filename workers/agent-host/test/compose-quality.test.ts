import { expect, it } from 'vitest';
import { compositionIssues } from '../src/compose-quality.js';
it('keeps production budget and film length out of unsupported advertising promises', () => {
  const args = {
    instruction: '動画の台本を3案。予算0円。実測していない速度を主張しない。',
    context: 'AstraはmacOSアプリです。',
  };
  expect(compositionIssues('Astraは無料。30秒で完成します。', args)).toHaveLength(2);
  expect(compositionIssues('0〜30秒：Workで成果物を開く。', args)).toEqual([]);
  expect(compositionIssues('確認会は金曜日15時。', { instruction: '案内文を作成' })).toEqual([]);
});
it('detects duplicated options while allowing a shared product name', () => {
  const duplicate =
    'Homeで依頼文を入力しWorkで結果を開きます。その後コピーしMarkdownで保存します。';
  expect(
    compositionIssues(`### 案1\n${duplicate}\n### 案2\n${duplicate}`, { instruction: '動画を2案' })
      .length,
  ).toBe(1);
  expect(
    compositionIssues(
      '### 案1\n完成した提案書から逆順で依頼を見せる。\n### 案2\nAstraのコピーと保存の使い分けを左右で並べる。',
      { instruction: '動画を2案' },
    ),
  ).toEqual([]);
});

it('detects phone UI inventions without mistaking filming a Mac for phone operation', () => {
  const args = {
    instruction: '動画を3案。予算は0円',
    context: 'AstraはmacOSアプリ。料金は不明です。',
  };
  expect(compositionIssues('スマホ画面に「Home」と入力する', args)).toHaveLength(1);
  expect(compositionIssues('Astraのアプリアイコンをタップする', args)).toHaveLength(1);
  expect(compositionIssues('Astraは無料', args)).toHaveLength(1);
  expect(compositionIssues('MacのHome画面をスマホで撮影する', args)).toEqual([]);
  expect(compositionIssues('制作予算0円で、Macの画面をスマホで撮影します。', args)).toEqual([]);
  expect(compositionIssues('Astraは無料ではありません。', args)).toEqual([]);
  expect(compositionIssues('Astraで文章を簡単に作成・保存！スマホだけで完結', args)).toHaveLength(
    1,
  );
  expect(compositionIssues('スマホ１台で文章作成ができるAstra', args)).toHaveLength(1);
  expect(compositionIssues('Macでの文章作成の様子をスマホだけで撮影します。', args)).toEqual([]);
});

it('checks repeated options with bold rather than heading syntax', () => {
  const duplicate =
    'Homeで依頼文を入力しWorkで結果を開きます。その後コピーしMarkdownで保存します。';
  expect(
    compositionIssues(`**案 １**\n${duplicate}\n**案 ２**\n${duplicate}`, {
      instruction: '動画を2案',
    }),
  ).toHaveLength(1);
});

it('rejects invented metrics when the brief disallows unverified numbers', () => {
  const args = {
    instruction: 'Web改善案を3項目。未検証の数字は書かない。',
    context: '現状のCTRは15%。',
  };
  expect(compositionIssues('CTRを5%にし、閲覧を1.5倍、離脱を半分にする。', args)).toHaveLength(1);
  expect(compositionIssues('現状のCTR15%と、公開後のCTRを比較する。', args)).toEqual([]);
  expect(compositionIssues('1. 問い合わせ率を変更前後で比較。', args)).toEqual([]);
});

it('allows quantitative hypothetical briefs and supplied full-width percentages', () => {
  expect(
    compositionIssues('仮に10%改善する場合を比較する。', {
      instruction: '架空の数値で比較例を作成',
    }),
  ).toEqual([]);
  expect(
    compositionIssues('CTRは5%。', {
      instruction: '未検証の数字は書かない。',
      context: 'CTRは５％。',
    }),
  ).toEqual([]);
});
