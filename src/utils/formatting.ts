import { differenceInCalendarDays, format, isValid, parse, parseISO } from "date-fns";

export function formatDisplayDate(date: string) {
  const parsed = parseISO(date);

  if (!isValid(parsed)) {
    return date;
  }

  return format(parsed, "EEEE, MMMM d");
}

export function formatCountdown(date: string) {
  const parsed = parseISO(date);

  if (!isValid(parsed)) {
    return "";
  }

  const dayDiff = differenceInCalendarDays(parsed, new Date());

  if (dayDiff <= 0) {
    return dayDiff === 0 ? "Today" : "Passed";
  }

  return `${dayDiff}d`;
}

export function formatDisplayTime(time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  const parsed = parse(time, "HH:mm", new Date());

  if (!isValid(parsed)) {
    return time;
  }

  return format(parsed, "h:mm a");
}

export function formatDueAt(dueAt?: string) {
  if (!dueAt) {
    return "";
  }

  const parsed = parseISO(dueAt);

  if (!isValid(parsed)) {
    return dueAt;
  }

  return dueAt.includes("T")
    ? `Due ${format(parsed, "MMM d • h:mm a")}`
    : `Due ${format(parsed, "MMM d")}`;
}

export function formatTaskType(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatEventType(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
