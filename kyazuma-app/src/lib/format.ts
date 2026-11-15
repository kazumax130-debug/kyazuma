const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a YYYY-MM-DD string into a local Date, or null when invalid. */
export function parseDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** Whole days from today until the given date (negative when overdue). */
export function daysUntil(value: string, today: Date = new Date()): number | null {
  const date = parseDate(value);
  if (!date) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date.getTime() - start.getTime()) / 86_400_000);
}

export function deadlineLabel(value: string, today?: Date): string | null {
  const days = daysUntil(value, today);
  if (days === null) return null;
  if (days < 0) return `${-days}日超過`;
  if (days === 0) return '今日まで';
  return `あと${days}日`;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
