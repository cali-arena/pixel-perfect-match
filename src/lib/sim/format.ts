const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (n: number) => nf0.format(Math.round(n));
export const fmt1 = (n: number) => nf1.format(n);
export const fmt2 = (n: number) => nf2.format(n);
export const fmtPct = (n: number, d = 1) => `${d === 0 ? nf0.format(n * 100) : nf1.format(n * 100)}%`;

export function fmtUsd(n: number, compact = false) {
  if (compact) {
    if (Math.abs(n) >= 1e6) return `USD ${nf1.format(n / 1e6)} M`;
    if (Math.abs(n) >= 1e3) return `USD ${nf0.format(n / 1e3)} mil`;
  }
  return `USD ${nf2.format(n)}`;
}

export function fmtMoney(n: number, moneda: string) {
  const dec = moneda === "CLP" || moneda === "COP" ? nf0 : nf2;
  return `${moneda} ${dec.format(n)}`;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(ts: number) {
  const d = new Date(ts);
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDayShort(ts: number) {
  const d = new Date(ts);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}
export function fmtClock(ts: number) {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
export function fmtClockMs(ts: number) {
  const d = new Date(ts);
  return `${fmtClock(ts)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function fmtDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0.1, ms / 1000).toFixed(1).replace(".", ",")} s`;
  const s = ms / 1000;
  if (s < 60) return `${fmt1(s)} s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 48) return `${fmt1(h)} h`;
  return `${fmt1(h / 24)} d`;
}
