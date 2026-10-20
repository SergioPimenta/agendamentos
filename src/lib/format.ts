const TZ = 'America/Sao_Paulo';

const pad = (n: number) => String(n).padStart(2, '0');

/** Data e hora de agora em Curitiba, no mesmo formato da API. */
export function nowLocal() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const todayStr = () => nowLocal().date;

const utc = (date: string) => new Date(`${date}T12:00:00Z`);

export function addDays(date: string, n: number) {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (date: string) => utc(date).getUTCDay();

export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export const startOfWeek = (date: string) => addDays(date, -weekdayOf(date));

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts }).format(utc(date));

export const fmtDateShort = (d: string) => fmt(d, { day: '2-digit', month: 'short' }).replace('.', '');
export const fmtDateLong = (d: string) => {
  const label = fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};
export const fmtDateFull = (d: string) => fmt(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtWeekdayShort = (d: string) => fmt(d, { weekday: 'short' }).replace('.', '');
export const fmtDayNumber = (d: string) => fmt(d, { day: 'numeric' });

export function fmtMonth(month: string) {
  const label = fmt(`${month}-01`, { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function relativeDay(date: string) {
  const today = todayStr();
  if (date === today) return 'Hoje';
  if (date === addDays(today, 1)) return 'Amanhã';
  if (date === addDays(today, -1)) return 'Ontem';
  return null;
}

export const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

export const fmtHours = (min: number) => `${(min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;

export const firstName = (name = '') => name.trim().split(/\s+/)[0] ?? '';

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
