'use strict';

/* New Zealand date/time formatting shared by inquiry notifications.
   NZ convention: day/month/year, with the 24-hour time kept separate. */
const TIME_ZONE = 'Pacific/Auckland';

function nzParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const out = {};
  parts.forEach((part) => { out[part.type] = part.value; });
  return out;
}

function nzDate(value) { const p = nzParts(value); return p ? p.day + '/' + p.month + '/' + p.year : ''; }
function nzTime(value) { const p = nzParts(value); return p ? p.hour + ':' + p.minute : ''; }

module.exports = { TIME_ZONE, nzParts, nzDate, nzTime };
