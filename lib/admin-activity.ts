export interface ActivityRecord {
  created_at: string;
}

export interface ActivityWeek {
  start: string;
  label: string;
  count: number;
}

function mondayOfWeek(date: Date): Date {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}

export function buildPostActivitySeries(
  records: ActivityRecord[],
  now: Date = new Date(),
  weekCount = 8,
): ActivityWeek[] {
  const currentMonday = mondayOfWeek(now);
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const start = new Date(currentMonday);
    start.setUTCDate(start.getUTCDate() - (weekCount - index - 1) * 7);
    return {
      start,
      count: 0,
    };
  });

  for (const record of records) {
    const createdAt = new Date(record.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;

    const weekStart = mondayOfWeek(createdAt).getTime();
    const week = weeks.find((candidate) => candidate.start.getTime() === weekStart);
    if (week) week.count++;
  }

  return weeks.map(({ start, count }) => ({
    start: start.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(start),
    count,
  }));
}
