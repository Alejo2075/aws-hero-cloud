/** How many values a five-field cron field selects, within `[min, max]`. */
function countField(field: string, min: number, max: number): number | undefined {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (match === null) return undefined;
    const [, range = '', stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return undefined;
    let from = min;
    let to = max;
    if (range !== '*') {
      const [a = '', b] = range.split('-');
      from = Number(a);
      to = b === undefined ? (stepText === undefined ? from : max) : Number(b);
    }
    if (from < min || to > max || from > to) return undefined;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values.size;
}

/**
 * How many times a five-field cron expression runs in a 30-day month, as an upper bound: day and
 * weekday restrictions are ignored, so a job that only runs on weekdays is counted as every day.
 * Returns `undefined` for an expression it cannot read.
 */
export function cronRunsPerMonth(expression: string): number | undefined {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minute = '', hour = ''] = fields;
  const minutes = countField(minute, 0, 59);
  const hours = countField(hour, 0, 23);
  return minutes === undefined || hours === undefined ? undefined : minutes * hours * 30;
}
