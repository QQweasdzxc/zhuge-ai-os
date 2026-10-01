export function text(value) {
  return value == null ? "" : String(value).trim();
}

export function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/,/g, "").replace(/^\((.*)\)$/, "-$1").replace(/%$/, "").replace(/^\+/, "");
  if (!raw || ["-", "--", "N/A", "NULL", "X", "NaN"].includes(raw.toUpperCase())) return null;
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}

export function rows(value) {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object");
  if (value && typeof value === "object") {
    for (const key of ["data", "Data", "result", "results", "rows", "Rows"]) {
      if (Array.isArray(value[key])) return rows(value[key]);
    }
  }
  return [];
}

export function first(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && text(record[key]) !== "") return record[key];
  }
  return null;
}

export function normalizeDate(value) {
  const raw = text(value).replace(/\//g, "-");
  if (!raw) return null;
  let match = /^(\d{2,3})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) return validDate(Number(match[1]) + 1911, Number(match[2]), Number(match[3]));
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{2,3})(\d{2})(\d{2})$/.exec(raw);
  if (match) return validDate(Number(match[1]) + 1911, Number(match[2]), Number(match[3]));
  return null;
}

function validDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day
    ? d.toISOString().slice(0, 10)
    : null;
}

export function staleByCalendarDays(date, maxDays, now = Date.now()) {
  if (!date) return null;
  const asOf = Date.parse(`${date}T16:00:00+08:00`);
  return Number.isFinite(asOf) ? now - asOf > maxDays * 86_400_000 : null;
}

export function monthStarts(count = 3, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" })
    .formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const result = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    result.push(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01`);
  }
  return result;
}

export function ymd(date) {
  return String(date).replace(/\D/g, "").slice(0, 8);
}
