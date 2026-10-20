export type Role = 'admin' | 'client';

export interface Plan {
  id: number;
  name: string;
  description: string;
  included_minutes: number;
  unlimited: boolean;
  room_discount_percent: number;
  price_cents: number;
  active: boolean;
  sort_order: number;
  users_count?: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string;
  document: string;
  company: string;
  plan: { id: number; name: string; included_minutes: number; unlimited: boolean } | null;
}

export interface Room {
  id: number;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  capacity: number;
  price_cents: number;
  image: string;
  amenities: string[];
  min_minutes: number;
  max_minutes: number;
  buffer_minutes: number;
  active: boolean;
  sort_order: number;
  bookings_count?: number;
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show';
export type DisplayStatus = BookingStatus | 'completed';
export type PaymentStatus = 'none' | 'pending' | 'paid';

export interface Booking {
  id: number;
  code: string;
  room: { id: number; name: string; slug: string; image: string };
  user?: { id: number; name: string; email: string; phone: string; company: string };
  date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  display_status: DisplayStatus;
  title: string;
  notes: string;
  attendees: number;
  total_minutes: number;
  included_minutes: number;
  price_cents: number;
  payment_status: PaymentStatus;
  series_id: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  can_cancel: boolean;
  can_edit: boolean;
  awaiting_payment: boolean;
  hold_until: string | null;
  /** E-mails convidados (só o dono e a administração enxergam). */
  guests?: string[];
  checked_in_at: string | null;
  check_in_method: 'app' | 'qr' | 'admin' | null;
  checked_out_at: string | null;
  check_out_method: 'app' | 'qr' | 'admin' | 'auto' | null;
  overtime_minutes: number;
  overtime_cents: number;
  overtime_payment_status: PaymentStatus;
  session: BookingSession;
}

export type SessionState = 'upcoming' | 'awaiting_checkin' | 'in_use' | 'overtime' | 'done' | 'no_checkin';

export interface BookingSession {
  state: SessionState | null;
  can_check_in: boolean;
  can_check_out: boolean;
  check_in_opens_at: string;
  live_overtime_minutes: number;
}

export interface CheckoutPreview {
  over_minutes: number;
  grace_minutes: number;
  overtime_minutes: number;
  overtime_cents: number;
  charge: boolean;
}

export interface RoomSessionResponse {
  room: Room;
  booking: Booking | null;
  next: Booking | null;
  overtime_estimate: { minutes: number; cents: number } | null;
  settings: PublicSettings;
}

export interface LiveRoom {
  room: { id: number; name: string; slug: string; image: string };
  state: 'free' | 'in_use' | 'overtime' | 'awaiting_checkin';
  booking: Booking | null;
  next: { date: string; start_time: string; client: string } | null;
}

export interface BusinessHours {
  weekday: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
}

export interface PublicSettings {
  business_name: string;
  business_address: string;
  business_phone: string;
  business_whatsapp: string;
  business_email: string;
  slot_step_minutes: number;
  min_notice_minutes: number;
  max_advance_days: number;
  cancel_min_hours: number;
  max_recurrence_weeks: number;
  require_approval: boolean;
  allow_signup: boolean;
  notice_message: string;
  usage_policy: string;
  checkin_window_minutes: number;
  overtime_grace_minutes: number;
  overtime_charge: boolean;
  online_payments: boolean;
  pay_on_booking: boolean;
}

export interface AdminSettings extends PublicSettings {
  max_upcoming_bookings: number;
  auto_close_minutes: number;
  invoice_due_day: number;
  pay_on_booking: boolean;
  booking_hold_minutes: number;
  pagarme_enabled: boolean;
  pagarme_methods: string;
  pagarme_expires_minutes: number;
  pagarme_max_installments: number;
}

export interface Slot {
  time: string;
  state: 'free' | 'booked' | 'blocked' | 'past';
  mine?: boolean;
}

export interface DayAvailability {
  date: string;
  open: boolean;
  open_time?: string;
  close_time?: string;
  step: number;
  beyond: boolean;
  rooms: { room: Room; open: boolean; slots: Slot[] }[];
}

export interface MonthDay {
  date: string;
  state: 'past' | 'beyond' | 'closed' | 'available' | 'full';
  free_slots?: number;
  mine?: boolean;
}

export interface Block {
  id: number;
  room_id: number | null;
  room_name?: string | null;
  start_at: string;
  end_at: string;
  reason: string;
}

export interface Statement {
  month: string;
  plan: { id: number; name: string; included_minutes: number | null; unlimited: boolean; room_discount_percent: number } | null;
  included_total: number | null;
  included_used: number;
  included_remaining: number | null;
  totals: { bookings: number; minutes: number; amount_cents: number; paid_cents: number; pending_cents: number; overtime_cents: number };
  bookings: Booking[];
}

export interface Client {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string;
  document: string;
  company: string;
  plan_id: number | null;
  plan_name: string | null;
  notes: string;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
  bookings_count?: number;
  next_booking?: string | null;
}

export interface EmailTemplateValues {
  subject: string;
  title: string;
  body: string;
  cta_label: string;
}

export interface EmailTemplate {
  key: string;
  group: string;
  name: string;
  description: string;
  recipient: string;
  locked: boolean;
  has_details: boolean;
  has_button: boolean;
  variables: { name: string; label: string }[];
  defaults: EmailTemplateValues;
  values: EmailTemplateValues;
  enabled: boolean;
  customized: boolean;
  updated_at: string | null;
}

/* ---------- Financeiro ---------- */

export type PayMethod = 'pix' | 'boleto' | 'cartao' | 'dinheiro' | 'transferencia' | 'outro';
export type FinStatus = 'open' | 'overdue' | 'paid';

export interface Receivable {
  kind: 'invoice' | 'manual';
  key: string;
  id?: number;
  user: { id: number; name: string; email: string; company: string } | null;
  month?: string;
  description: string;
  category: string;
  bookings?: number;
  amount_cents: number;
  paid_cents: number;
  open_cents: number;
  due_date: string;
  status: FinStatus;
  paid_at?: string | null;
  payment_method?: PayMethod | null;
  notes?: string;
  series_id?: string | null;
  ref?: string | null;
}

export interface ReceivableTotals { amount_cents: number; paid_cents: number; open_cents: number; overdue_cents: number; count: number }

export interface InvoiceLine {
  id: number; code: string; date: string; start_time: string; end_time: string; room: string; status: BookingStatus;
  price_cents: number; payment_status: PaymentStatus; paid_at: string | null; payment_method: PayMethod | null;
  overtime_cents: number; overtime_minutes: number; overtime_payment_status: PaymentStatus;
  overtime_paid_at: string | null; overtime_payment_method: PayMethod | null;
}

export interface Payable {
  id: number;
  description: string;
  supplier: string;
  category: string;
  amount_cents: number;
  due_date: string;
  status: FinStatus;
  paid_at: string | null;
  payment_method: PayMethod | null;
  notes: string;
  series_id: string | null;
}

export interface Movement {
  id: string;
  date: string;
  type: 'in' | 'out';
  category: string;
  party: string;
  description: string;
  method: PayMethod | null;
  amount_cents: number;
  balance_cents: number;
}

export interface CashMonth { month: string; in_cents: number; out_cents: number; result_cents: number }

export interface FinanceOverview {
  month: string;
  cash: { in_cents: number; out_cents: number; result_cents: number };
  billed_cents: number;
  receivable: { open_cents: number; overdue_cents: number; count: number };
  payable: { open_cents: number; overdue_cents: number; due_7d_cents: number; count: number };
  series: CashMonth[];
  by_room: { name: string; total_cents: number; bookings: number }[];
  by_method: { method: PayMethod; total_cents: number }[];
  expenses_by_category: { category: string; total_cents: number }[];
  top_debtors: { user: { id: number; name: string; email: string; company: string }; open_cents: number; overdue_cents: number }[];
  next_receivables: { key: string; description: string; party: string; due_date: string; open_cents: number; status: FinStatus }[];
  next_payables: { id: number; description: string; party: string; due_date: string; amount_cents: number; status: FinStatus }[];
}

/* ---------- Pagamento online (Pagar.me) ---------- */

export interface OnlinePayment {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  kind: 'invoice' | 'booking' | 'receivable';
  description: string;
  amount_cents: number;
  status: 'pending' | 'paid' | 'failed' | 'canceled';
  display_status: 'pending' | 'paid' | 'failed' | 'canceled' | 'expired';
  method: PayMethod | null;
  paid_at: string | null;
  expires_at: string | null;
  checkout_url: string | null;
  pix_qr_code: string | null;
  needs_review: boolean;
  note: string | null;
  created_at: string;
}

export interface GatewayStatus {
  secret_key_configured: boolean;
  public_key_configured: boolean;
  mode: 'none' | 'test' | 'live' | 'unknown';
  webhook_token_configured: boolean;
  webhook_url: string | null;
  api_url: string;
}

/** O que o popup de reserva precisa para oferecer o pagamento na hora. */
export interface PaymentConfig {
  pay_on_booking: boolean;
  methods: ('pix' | 'credit_card')[];
  public_key: string | null;
  max_installments: number;
  hold_minutes: number;
}
