import * as chrono from "chrono-node";

export const FAR_FUTURE = "9999-12-31T23:59:59.000Z";

const RECURRING_PATTERN = /every\s+(\d+)\s*(second|minute|hour|day|week|month|year)s?\b/i;
/** Time-of-day after "at" (e.g. "at 11:30 PM", "at 23:30") — capture phrase before "starting", "until", or end */
const AT_PATTERN = /at\s+(.+?)(?=\s+starting\s|\s+until\s|$)/is;
const STARTING_PATTERN = /starting\s+(.+?)(?=\s+until\s|$)/is;
const UNTIL_PATTERN = /until\s+(.+)$/i;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH = 30 * MS_PER_DAY;   // approximate
const MS_PER_YEAR = 365 * MS_PER_DAY;   // approximate

function intervalMsForUnit(n: number, unit: string): number {
  const u = unit.toLowerCase();
  switch (u) {
    case "second":  return n * MS_PER_SECOND;
    case "minute":  return n * MS_PER_MINUTE;
    case "hour":    return n * MS_PER_HOUR;
    case "day":     return n * MS_PER_DAY;
    case "week":    return n * MS_PER_WEEK;
    case "month":   return n * MS_PER_MONTH;
    case "year":    return n * MS_PER_YEAR;
    default:        return n * MS_PER_DAY;
  }
}

export interface NextNotificationResult {
  next: string;
  isOneTime: boolean;
}

/**
 * Parse "notify" string (chrono-parseable or "every N ... [at TIME] [starting X] [until Y]").
 * Supports time-of-day e.g. "every 1 day at 11:30 PM". One-time is inferred when "every" is absent.
 */
export function getNextNotificationAt(
  notify: string,
  ref: Date,
  lastNotifiedAt?: string,
  _createdAt?: string
): NextNotificationResult {
  const s = (notify || "").trim();
  if (!s || /^(no|none|never|—|нет|без напоминаний?)$/i.test(s)) {
    return { next: FAR_FUTURE, isOneTime: false };
  }

  const recurringMatch = s.match(RECURRING_PATTERN);
  if (recurringMatch) {
    const n = Math.max(1, parseInt(recurringMatch[1], 10));
    const unit = recurringMatch[2];
    const intervalMs = intervalMsForUnit(n, unit);

    let startDate = ref;
    const startingMatch = s.match(STARTING_PATTERN);
    if (startingMatch) {
      const startPhrase = startingMatch[1].trim();
      const startParsed = chrono.parseDate(startPhrase, ref, { forwardDate: true });
      if (startParsed) startDate = startParsed;
    }

    let untilDate: Date | null = null;
    const untilMatch = s.match(UNTIL_PATTERN);
    if (untilMatch) {
      const untilPhrase = untilMatch[1].trim();
      const untilParsed = chrono.parseDate(untilPhrase, ref, { forwardDate: true });
      if (untilParsed) untilDate = untilParsed;
    }

    let nextDate: Date;
    if (lastNotifiedAt) {
      const last = new Date(lastNotifiedAt);
      nextDate = new Date(last.getTime() + intervalMs);
    } else {
      nextDate = startDate.getTime() < ref.getTime()
        ? new Date(ref.getTime() + intervalMs)
        : new Date(startDate.getTime());
    }

    // If "at <time>" is present (e.g. "every 1 day at 11:30 PM"), use next occurrence of that time
    const atMatch = s.match(AT_PATTERN);
    if (atMatch) {
      const timePhrase = atMatch[1].trim();
      const base = lastNotifiedAt
        ? new Date(new Date(lastNotifiedAt).getTime() + intervalMs)
        : ref;
      const atTime = chrono.parseDate(timePhrase, base, { forwardDate: true });
      if (atTime && atTime.getTime() >= base.getTime()) {
        nextDate = atTime;
      }
    }

    if (untilDate && nextDate > untilDate) {
      return { next: FAR_FUTURE, isOneTime: false };
    }
    return { next: nextDate.toISOString(), isOneTime: false };
  }

  const parsed = chrono.parseDate(s, ref, { forwardDate: true });
  if (!parsed) {
    return { next: FAR_FUTURE, isOneTime: false };
  }
  return { next: parsed.toISOString(), isOneTime: true };
}
