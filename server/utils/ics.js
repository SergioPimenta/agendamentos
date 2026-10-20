const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

/** Gera um .ics (horário de Brasília, sem VTIMEZONE: usa TZID nomeado). */
export function bookingToIcs(b, { businessName, address }) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${esc(businessName)}//Agendamento//PT-BR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.code}@harmonizeoser`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=America/Sao_Paulo:${stamp(b.date, b.start_time)}`,
    `DTEND;TZID=America/Sao_Paulo:${stamp(b.date, b.end_time)}`,
    `SUMMARY:${esc(b.title || `Reserva — ${b.room_name}`)}`,
    `LOCATION:${esc(`${b.room_name} · ${businessName}${address ? `, ${address}` : ''}`)}`,
    `DESCRIPTION:${esc(`Reserva ${b.code}`)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Sua reserva começa em 30 minutos',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
