import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const DEFAULT_TIMEZONE = "UTC";

/**
 * Validates if an IANA timezone string is valid.
 */
export const isValidTimezone = (tz?: string | null): boolean => {
  if (!tz || typeof tz !== "string" || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves the appropriate timezone.
 * Priority:
 * 1. Request header 'x-timezone' (if valid)
 * 2. User/argument timezone (if valid)
 * 3. DEFAULT_TIMEZONE ('UTC')
 */
export const resolveTimezone = (
  userTimezone?: string | null,
  headerTimezone?: string | string[] | null,
): string => {
  const headerTz = Array.isArray(headerTimezone)
    ? headerTimezone[0]
    : headerTimezone;

  if (isValidTimezone(headerTz)) {
    return headerTz!.trim();
  }

  if (isValidTimezone(userTimezone)) {
    return userTimezone!.trim();
  }

  return DEFAULT_TIMEZONE;
};

/**
 * Returns UTC Date object representing 00:00:00.000 in the specified timezone for given date.
 */
export const getZonedStartOfDay = (
  date: Date | number | string = new Date(),
  tz: string = DEFAULT_TIMEZONE,
): Date => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return dayjs(date).tz(targetTz).startOf("day").toDate();
};

/**
 * Returns UTC Date object representing 23:59:59.999 in the specified timezone for given date.
 */
export const getZonedEndOfDay = (
  date: Date | number | string = new Date(),
  tz: string = DEFAULT_TIMEZONE,
): Date => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return dayjs(date).tz(targetTz).endOf("day").toDate();
};

/**
 * Returns UTC Date object representing the start of week (Sunday 00:00:00) in the specified timezone.
 */
export const getZonedStartOfWeek = (
  date: Date | number | string = new Date(),
  tz: string = DEFAULT_TIMEZONE,
): Date => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return dayjs(date).tz(targetTz).day(0).startOf("day").toDate();
};

/**
 * Format time in "hh:mm a" format (e.g., "02:30 pm") in user timezone.
 */
export const formatZonedTime = (
  date: Date | number | string,
  tz: string = DEFAULT_TIMEZONE,
): string => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return dayjs(date).tz(targetTz).format("hh:mm a");
};

/**
 * Format time in "h:mm A" format (e.g., "2:30 PM") in user timezone.
 */
export const formatZonedTimeV2 = (
  date: Date | number | string,
  tz: string = DEFAULT_TIMEZONE,
): string => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return dayjs(date).tz(targetTz).format("h:mm A");
};

/**
 * Returns "YYYY-MM-DD" string in the user's timezone.
 */
export const formatZonedDateKey = (
  date: Date | number | string,
  tz: string = DEFAULT_TIMEZONE,
): string => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return dayjs(date).tz(targetTz).format("YYYY-MM-DD");
};

/**
 * Returns "TODAY", "YESTERDAY", or "MMM D" (e.g., "SEP 4") based on user's timezone today.
 */
export const getZonedDateGroupHeader = (
  dateStr: string,
  tz: string = DEFAULT_TIMEZONE,
): string => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const now = dayjs().tz(targetTz);
  const todayStr = now.format("YYYY-MM-DD");
  const yesterdayStr = now.subtract(1, "day").format("YYYY-MM-DD");

  if (dateStr === todayStr) {
    return "TODAY";
  }
  if (dateStr === yesterdayStr) {
    return "YESTERDAY";
  }

  // Parse YYYY-MM-DD and format to "MMM D" in uppercase
  const d = dayjs(dateStr).tz(targetTz);
  return d.format("MMM D").toUpperCase();
};

/**
 * Formats sinceDate string (e.g., "Since September 4, 2026") in user's timezone.
 */
export const formatZonedSinceDate = (
  date: Date | number | string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
): string => {
  if (!date) return "No focus history";
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  return `Since ${dayjs(date).tz(targetTz).format("MMMM D, YYYY")}`;
};

/**
 * Formats time range (e.g., "2:30 PM – 3:15 PM" or "02:30 pm - 03:15 pm") in user's timezone.
 */
export const formatZonedTimeRange = (
  startTime: Date | number | string,
  endTime: Date | number | string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
  isV2 = false,
): string => {
  const targetTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  if (isV2) {
    const start = formatZonedTimeV2(startTime, targetTz);
    const end = endTime ? formatZonedTimeV2(endTime, targetTz) : "Active";
    return `${start} – ${end}`;
  } else {
    const start = formatZonedTime(startTime, targetTz);
    const end = endTime ? formatZonedTime(endTime, targetTz) : "Active";
    return `${start} - ${end}`;
  }
};
