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

/** Every value a five-field cron field selects, in `[min, max]`, or `undefined` if it is invalid. */
function expand(field: string, min: number, max: number): number[] | undefined {
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
  return [...values].sort((a, b) => a - b);
}

/** Keeps a field readable when it can stay as written; expands only forms AWS may not accept. */
function keep(field: string, min: number, max: number): string | undefined {
  if (field === '*' || /^\*\/\d+$/.test(field))
    return expand(field, min, max) === undefined ? undefined : field;
  if (/^[\d,]+$/.test(field) || /^\d+-\d+$/.test(field)) {
    return expand(field, min, max) === undefined ? undefined : field;
  }
  const values = expand(field, min, max);
  return values === undefined ? undefined : values.join(',');
}

/**
 * Converts a Unix five-field cron expression to the six-field form EventBridge Scheduler uses.
 * Unix counts weekdays from 0 (Sunday) and AWS from 1 (Sunday); AWS needs `?` in either the day of
 * the month or the day of the week; and Unix runs when *either* day field matches, which AWS cannot
 * say. Returns `undefined` for anything that cannot be expressed exactly, so Hero asks instead of
 * scheduling something different from what the application meant.
 */
export function toAwsCron(expression: string): string | undefined {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minute = '', hour = '', dom = '', month = '', dow = ''] = fields;

  const minuteOut = keep(minute, 0, 59);
  const hourOut = keep(hour, 0, 23);
  const domAny = dom === '*';
  const dowAny = dow === '*';
  const domOut = domAny ? '*' : keep(dom, 1, 31);
  const monthOut = keep(month, 1, 12);
  if ([minuteOut, hourOut, domOut, monthOut].includes(undefined)) return undefined;
  if (!domAny && !dowAny) return undefined;

  let dowOut = '?';
  if (!dowAny) {
    const days = expand(dow, 0, 7);
    if (days === undefined) return undefined;
    dowOut = [...new Set(days.map((day) => (day % 7) + 1))].sort((a, b) => a - b).join(',');
  }
  const domField = domAny && !dowAny ? '?' : (domOut ?? '*');
  return `cron(${minuteOut ?? ''} ${hourOut ?? ''} ${domField} ${monthOut ?? ''} ${dowAny ? '?' : dowOut} *)`;
}
