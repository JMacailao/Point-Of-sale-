import { badRequest } from './errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the given IANA time zone. */
export function todayIn(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Manila' }).format(new Date());
}

export function parseRange(query, timezone, { maxDays = 366, defaultDays = 0 } = {}) {
  const today = todayIn(timezone);
  const to = query.to || today;
  let from = query.from;
  if (!from) {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - defaultDays);
    from = d.toISOString().slice(0, 10);
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw badRequest('Dates must use the YYYY-MM-DD format');
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0) throw badRequest('The start date must be before the end date');
  if (days > maxDays) throw badRequest(`The date range cannot exceed ${maxDays} days`);
  return { from, to };
}
