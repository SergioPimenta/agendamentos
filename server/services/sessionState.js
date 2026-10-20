import { addMinutesAt, minutesBetween } from '../utils/time.js';

/**
 * Estado do uso da sala (check-in / check-out) de uma reserva, calculado só a partir da linha do banco,
 * das regras e da hora atual. Sem acesso ao banco, para poder ser usado em qualquer lugar.
 *
 *   upcoming         ainda não começou
 *   awaiting_checkin começou e o cliente não fez check-in
 *   in_use           check-in feito, dentro do horário (ou da tolerância)
 *   overtime         check-in feito e já passou do horário + tolerância, sem check-out
 *   done             check-out feito
 *   no_checkin       a reserva terminou sem nenhum check-in
 */
export function sessionState(row, rules, now) {
  if (row.status !== 'confirmed') return null;
  if (row.checked_out_at) return 'done';
  if (row.checked_in_at) {
    return minutesBetween(row.end_at, now.at) > (rules.overtime_grace_minutes ?? 0) ? 'overtime' : 'in_use';
  }
  if (now.at > row.end_at) return 'no_checkin';
  if (now.at >= row.start_at) return 'awaiting_checkin';
  return 'upcoming';
}

export function sessionInfo(row, rules, now) {
  const state = sessionState(row, rules, now);
  const window = rules.checkin_window_minutes ?? 0;
  const checkedIn = Boolean(row.checked_in_at);
  const checkedOut = Boolean(row.checked_out_at);
  return {
    state,
    can_check_in: row.status === 'confirmed' && !checkedIn && !checkedOut && now.at <= row.end_at && minutesBetween(now.at, row.start_at) <= window,
    can_check_out: row.status === 'confirmed' && checkedIn && !checkedOut,
    check_in_opens_at: addMinutesAt(row.start_at, -window).slice(11),
    live_overtime_minutes: checkedIn && !checkedOut ? Math.max(0, minutesBetween(row.end_at, now.at)) : 0,
  };
}
