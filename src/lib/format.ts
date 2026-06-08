export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function formatRelativeToToday(value: string, now = new Date()): string {
  const target = startOfLocalDay(new Date(value));
  const current = startOfLocalDay(now);
  const diffDays = Math.round((target.getTime() - current.getTime()) / 86_400_000);

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(diffDays, "day");
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
