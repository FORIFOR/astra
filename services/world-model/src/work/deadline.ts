/**
 * 文からの期限抽出。**規則で決める**（LLM に頼らない・推測で埋めない）。
 *
 * 拾うもの: 「9/8 まで」「9月8日」「明日まで」「今日中」「来週金曜」「by Friday」「EOD」「2026-09-08」。
 * 拾えなければ null。時刻が無ければその日の 18:00（業務時間の終わり）にする — 「日付だけ」を 0:00 にすると
 * 期限を 1 日早く数えてしまう。
 * 日付と相対表現は業務タイムゾーン（日本語版の既定: Asia/Tokyo）で解釈し、ホストの TZ に依存しない。
 */
import { BUSINESS_TIME_ZONE, businessFormatter, wallClock, instant } from './business-time.js';

const DAY_MS = 86_400_000;
const WEEKDAYS: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(18, 0, 0, 0);
  return x;
}

export interface ExtractedDeadline {
  readonly at: string;
  /** どの語から取ったか（出所の抜粋）。 */
  readonly phrase: string;
}

export function extractDeadline(
  text: string,
  now: Date,
  timeZone = BUSINESS_TIME_ZONE,
): ExtractedDeadline | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = businessFormatter(timeZone);
    now = wallClock(now, formatter);
  } catch {
    return null;
  }
  const deadline = (date: Date, phrase: string): ExtractedDeadline | null => {
    if (!Number.isFinite(date.getTime())) return null;
    const at = instant(date, formatter);
    return at ? { at, phrase } : null;
  };
  const t = text.normalize('NFKC');
  let m: RegExpMatchArray | null;

  if (
    (m = t.match(
      /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?/i,
    ))
  ) {
    const year = Number(m[1]),
      month = Number(m[2]),
      day = Number(m[3]);
    const hour = m[4] ? Number(m[4]) : 18,
      minute = Number(m[5] ?? 0),
      second = Number(m[6] ?? 0);
    const millisecond = Number((m[7] ?? '').slice(0, 3).padEnd(3, '0'));
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day ||
      d.getUTCHours() !== hour ||
      d.getUTCMinutes() !== minute ||
      d.getUTCSeconds() !== second
    )
      return null;
    if (m[8]) {
      const explicit = new Date(m[0].replace(' ', 'T'));
      return Number.isFinite(explicit.getTime())
        ? { at: explicit.toISOString(), phrase: m[0] }
        : null;
    }
    return deadline(d, m[0]);
  }
  if (
    (m = t.match(
      /(\d{1,2})[\/月](\d{1,2})日?(?:\s*\(?[月火水木金土日]\)?)?\s*(?:まで|迄|中|締め?切り?|期限|deadline|by)?/i,
    ))
  ) {
    const month = Number(m[1]),
      day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let d = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));
      if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
      // 過ぎた日付は来年（「1/10 まで」を 12 月に見たとき）。
      if (d.getTime() < now.getTime() - 60 * DAY_MS)
        d = new Date(Date.UTC(now.getUTCFullYear() + 1, month - 1, day));
      if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
      return deadline(endOfDay(d), m[0].trim());
    }
  }
  if ((m = t.match(/今日中|本日中|今日まで|本日まで|EOD|end of day/i))) {
    return deadline(endOfDay(now), m[0]);
  }
  if ((m = t.match(/明後日|day after tomorrow/i))) {
    return deadline(endOfDay(new Date(now.getTime() + 2 * DAY_MS)), m[0]);
  }
  if ((m = t.match(/明日(?:まで|中)?|tomorrow/i))) {
    return deadline(endOfDay(new Date(now.getTime() + DAY_MS)), m[0]);
  }
  if (
    (m = t.match(
      /(今週|来週|next|this)\s*(?:の)?\s*(月|火|水|木|金|土|日|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)(?:曜日?)?/i,
    ))
  ) {
    const target = WEEKDAYS[(m[2] ?? '').toLowerCase()];
    if (target !== undefined) {
      const isNext = /来週|next/i.test(m[1] ?? '');
      const today = now.getUTCDay();
      // 今週 = 次にその曜日が来る日（今日を含む）。来週 = その 7 日後。
      const delta = ((target - today + 7) % 7) + (isNext ? 7 : 0);
      return deadline(endOfDay(new Date(now.getTime() + delta * DAY_MS)), m[0]);
    }
  }
  if (
    (m = t.match(
      /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i,
    ))
  ) {
    const target = WEEKDAYS[(m[1] ?? '').toLowerCase()];
    if (target !== undefined) {
      const delta = (target - now.getUTCDay() + 7) % 7 || 7;
      return deadline(endOfDay(new Date(now.getTime() + delta * DAY_MS)), m[0]);
    }
  }
  if ((m = t.match(/(\d+)\s*日以内|within\s+(\d+)\s*days?/i))) {
    const n = Number(m[1] ?? m[2]);
    return deadline(endOfDay(new Date(now.getTime() + n * DAY_MS)), m[0]);
  }
  return null;
}
