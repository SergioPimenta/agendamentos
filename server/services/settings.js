import { config } from '../config.js';
import { db } from '../db/index.js';

let cache = null;

const NUMBERS = ['slot_step_minutes', 'min_notice_minutes', 'max_advance_days', 'cancel_min_hours', 'max_upcoming_bookings', 'max_recurrence_weeks', 'invoice_due_day', 'pagarme_expires_minutes', 'booking_hold_minutes', 'pagarme_max_installments', 'checkin_window_minutes', 'overtime_grace_minutes', 'auto_close_minutes', 'bank_credit_days'];
const BOOLS = ['require_approval', 'allow_signup', 'overtime_charge', 'pagarme_enabled', 'pay_on_booking'];

/** Pagamento online está ligado no painel E a chave secreta existe no servidor. */
export const onlinePaymentsReady = (s) => Boolean(s.pagarme_enabled && config.pagarme.secretKey);

export async function getSettings() {
  if (cache) return cache;
  const rows = await db.query('SELECT k, v FROM settings');
  const out = {};
  for (const { k, v } of rows) {
    out[k] = NUMBERS.includes(k) ? Number(v) : BOOLS.includes(k) ? v === 'true' : v;
  }
  cache = out;
  return out;
}

export async function saveSettings(values) {
  for (const [k, v] of Object.entries(values)) {
    const value = String(v);
    const has = await db.get('SELECT k FROM settings WHERE k = ?', [k]);
    if (has) await db.run('UPDATE settings SET v = ? WHERE k = ?', [value, k]);
    else await db.run('INSERT INTO settings (k, v) VALUES (?, ?)', [k, value]);
  }
  cache = null;
  return getSettings();
}

/** Somente o que o cliente final precisa saber. */
export const publicSettings = (s) => ({
  business_name: s.business_name,
  business_address: s.business_address,
  business_phone: s.business_phone,
  business_whatsapp: s.business_whatsapp,
  business_email: s.business_email,
  slot_step_minutes: s.slot_step_minutes,
  min_notice_minutes: s.min_notice_minutes,
  max_advance_days: s.max_advance_days,
  cancel_min_hours: s.cancel_min_hours,
  max_recurrence_weeks: s.max_recurrence_weeks,
  require_approval: s.require_approval,
  allow_signup: s.allow_signup,
  notice_message: s.notice_message,
  usage_policy: s.usage_policy ?? '',
  checkin_window_minutes: s.checkin_window_minutes,
  overtime_grace_minutes: s.overtime_grace_minutes,
  overtime_charge: s.overtime_charge,
  online_payments: onlinePaymentsReady(s),
  pay_on_booking: onlinePaymentsReady(s) && Boolean(s.pay_on_booking),
});
