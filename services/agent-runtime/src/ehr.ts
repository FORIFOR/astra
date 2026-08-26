/**
 * EHR Assist。正本 §15.5。
 *
 * 仕様が言っていること:
 *   - 高リスク領域
 *   - 初期版は read / assist / draft 中心
 *   - Write-back は明示承認 + audit
 *   - **診断 / 治療を自律決定しない**
 *
 * 最後の一行を、実装側で守れる形にしてある:
 *
 *   - 要約に載せられるのは、**出典を言える文だけ**（`summarize`）
 *   - 取り出すのは、**書いてある値だけ**（`extract`）
 *   - 書かれていない項目は「記載なし」。**「異常なし」にしない**
 */
import type { DomainEntity } from '@astra/contracts';

export interface ClinicalNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly author: string | null;
  readonly encounterId: string | null;
  readonly signed: boolean;
}

function text(entity: DomainEntity, field: string): string | null {
  const value = entity.fields[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function toClinicalNote(entity: DomainEntity): ClinicalNote {
  return {
    id: entity.id,
    title: text(entity, 'title') ?? '無題',
    body: text(entity, 'body') ?? '',
    author: text(entity, 'author'),
    encounterId: text(entity, 'encounter'),
    // 署名の記録が無いものを、署名済みにしない
    signed: entity.fields['signed'] === true,
  };
}

/** 出典付きの一文。**出典を持たない文はここに入れない。** */
export interface CitedLine {
  readonly text: string;
  /** どの記録の何行目か。 */
  readonly noteId: string;
  readonly line: number;
}

/**
 * 記録から、出典の付いた文だけを取り出す。
 *
 * **要約でも言い換えでもない。**元の行をそのまま持ってくる。
 * 言い換えた時点で「どの記録の何行目か」が言えなくなり、
 * §15.5 の source citation が成り立たなくなる。
 */
export function citedLines(notes: readonly ClinicalNote[]): CitedLine[] {
  const lines: CitedLine[] = [];
  for (const note of notes) {
    note.body.split('\n').forEach((raw, index) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      lines.push({ text: trimmed, noteId: note.id, line: index + 1 });
    });
  }
  return lines;
}

/**
 * 受診の要約。**一文ごとに出典を添える。**
 *
 * 添えられない文は出さない。出せる文が無いなら、無いと書く。
 */
export function encounterSummary(notes: readonly ClinicalNote[]): string {
  const lines = citedLines(notes);
  if (lines.length === 0) {
    // 記録が無いことを、所見が無いことにしない
    return 'この受診に紐づく記録がありません。';
  }
  return [
    '# 受診の記録',
    '',
    ...lines.map((line) => `- ${line.text}  \n  （出典: ${line.noteId} 行 ${line.line}）`),
    '',
    '※ 記録からそのまま引用したものです。診断・治療方針は含みません。',
  ].join('\n');
}

/** 取り出したい項目。**増やすときは、取り方も一緒に決める。** */
export const EXTRACTION_FIELDS = [
  { id: 'bp', label: '血圧', pattern: /(?:血圧|BP)[^\d]{0,4}(\d{2,3}\s*\/\s*\d{2,3})/ },
  {
    id: 'temperature',
    label: '体温',
    pattern: /(?:体温|BT|KT)[^\d]{0,4}(\d{2}(?:\.\d)?)\s*(?:℃|度)?/,
  },
  { id: 'pulse', label: '脈拍', pattern: /(?:脈拍|PR|HR)[^\d]{0,4}(\d{2,3})/ },
  { id: 'spo2', label: 'SpO2', pattern: /(?:SpO2|SPO2)[^\d]{0,4}(\d{2,3})\s*%?/ },
] as const;

export interface Extracted {
  readonly id: string;
  readonly label: string;
  /** 書いてある値。**無ければ null。** */
  readonly value: string | null;
  readonly noteId: string | null;
  readonly line: number | null;
}

/**
 * 構造化して取り出す。
 *
 * **書いてある値だけ。**見つからない項目は null のまま返し、
 * 表示側が「記載なし」と書く。**「異常なし」にしない**
 * （書かれていないことと、正常だったことは違う）。
 */
export function extract(notes: readonly ClinicalNote[]): Extracted[] {
  const lines = citedLines(notes);
  return EXTRACTION_FIELDS.map((field) => {
    for (const line of lines) {
      const match = field.pattern.exec(line.text);
      if (match?.[1]) {
        return {
          id: field.id,
          label: field.label,
          // 記録のとおりに写す。丸めない。単位を変えない。
          value: match[1].replace(/\s+/g, ''),
          noteId: line.noteId,
          line: line.line,
        };
      }
    }
    return { id: field.id, label: field.label, value: null, noteId: null, line: null };
  });
}

export function extractionTable(rows: readonly Extracted[]): string {
  return [
    '| 項目 | 値 | 出典 |',
    '| --- | --- | --- |',
    ...rows.map((row) =>
      row.value === null
        ? // **「異常なし」ではない。**書かれていないだけ。
          `| ${row.label} | 記載なし | |`
        : `| ${row.label} | ${row.value} | ${row.noteId} 行 ${row.line} |`,
    ),
  ].join('\n');
}

/** 診断・治療の言葉。**下書きに混ざっていないかを見る。** */
const CLINICAL_DECISION = /(と診断|診断する|処方する|投与する|開始する|中止する|手術を)/;

export interface DraftCheck {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * 下書きが線を越えていないか。正本 §15.5「診断/治療を自律決定しない」。
 *
 * **記録からの引用は通す。**自分で決めた文だけを止める。
 * 見分けは出典の有無で付ける。
 */
export function checkDraft(draft: string, cited: readonly CitedLine[]): DraftCheck {
  const known = new Set(cited.map((line) => line.text));
  const problems: string[] = [];

  for (const raw of draft.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!CLINICAL_DECISION.test(line)) continue;
    // 記録にそのまま書いてある文なら、引用として通す
    if (known.has(line)) continue;
    problems.push(line);
  }

  return { ok: problems.length === 0, problems };
}
