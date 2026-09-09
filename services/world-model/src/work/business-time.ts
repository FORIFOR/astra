/** Japanese release business calendar; never inherit the server process timezone. */
export const BUSINESS_TIME_ZONE = 'Asia/Tokyo';
const DAY_MS = 86_400_000;

export function businessFormatter(timeZone = BUSINESS_TIME_ZONE): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** A UTC-shaped calendar value, used only for arithmetic in the selected zone. */
export function wallClock(date: Date, formatter: Intl.DateTimeFormat = businessFormatter()): Date {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return new Date(
    Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      Number(parts['hour']),
      Number(parts['minute']),
      Number(parts['second']),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Reject missing/ambiguous wall times rather than inventing a DST interpretation. */
export function instant(
  wall: Date,
  formatter: Intl.DateTimeFormat = businessFormatter(),
): string | null {
  const target = wall.getTime();
  const candidates = new Set<number>();
  for (const shift of [-DAY_MS, 0, DAY_MS]) {
    const probe = target + shift;
    const offset = wallClock(new Date(probe), formatter).getTime() - probe;
    const candidate = target - offset;
    if (wallClock(new Date(candidate), formatter).getTime() === target) candidates.add(candidate);
  }
  return candidates.size === 1 ? new Date([...candidates][0]!).toISOString() : null;
}
