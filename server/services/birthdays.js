import { db } from '../db/index.js';
import { nowLocal } from '../utils/time.js';
import { sendTemplated } from './emailTemplates.js';

/** A partir desta hora (horário local) o e-mail de aniversário pode sair, para não chegar de madrugada. */
const SEND_FROM_HOUR = 8;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Idade que a pessoa completa em `year` (null se a data de nascimento não permitir calcular). */
export function ageIn(birthDate, year) {
  const born = Number(String(birthDate || '').slice(0, 4));
  return born > 1900 && year >= born ? year - born : null;
}

/** "MM-DD" que contam como aniversário em `date`: quem nasceu em 29/02 comemora em 28/02 nos anos não bissextos. */
function monthDaysOf(date) {
  const year = Number(date.slice(0, 4));
  const md = date.slice(5);
  return md === '02-28' && !isLeap(year) ? ['02-28', '02-29'] : [md];
}

/** Aniversariantes do mês (YYYY-MM), por dia. Só clientes ativos com data de nascimento. */
export async function birthdaysOfMonth(month) {
  const year = Number(month.slice(0, 4));
  const mm = month.slice(5, 7);
  const rows = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.company, u.birth_date, u.birthday_sent_year, p.name AS plan_name
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.role = 'client' AND u.active = 1 AND u.birth_date IS NOT NULL AND SUBSTR(u.birth_date, 6, 2) = ?
      ORDER BY SUBSTR(u.birth_date, 9, 2), u.name`,
    [mm],
  );
  const today = nowLocal().date;
  return rows.map((u) => {
    let day = Number(u.birth_date.slice(8, 10));
    // 29/02 em ano não bissexto aparece em 28/02.
    if (mm === '02' && day === 29 && !isLeap(year)) day = 28;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    return {
      id: Number(u.id),
      name: u.name,
      email: u.email,
      phone: u.phone,
      company: u.company,
      plan_name: u.plan_name ?? null,
      birth_date: u.birth_date,
      day,
      date,
      turning_age: ageIn(u.birth_date, year),
      is_today: date === today,
      email_sent: Number(u.birthday_sent_year) === year,
    };
  }).sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Envia o e-mail de parabéns a quem faz aniversário hoje (uma vez por ano) e devolve quantos saíram.
 * Pode rodar quantas vezes quiser no dia: só marca como enviado quando o envio dá certo.
 * `force` ignora a hora mínima e `send` troca o envio real (ambos usados nos testes).
 */
export async function sendBirthdayEmails({ force = false, send = sendTemplated } = {}) {
  const now = nowLocal();
  if (!force && Number(now.at.slice(11, 13)) < SEND_FROM_HOUR) return 0;
  const year = Number(now.date.slice(0, 4));
  const days = monthDaysOf(now.date);

  const rows = await db.query(
    `SELECT id, name, email, birth_date FROM users
      WHERE role = 'client' AND active = 1 AND birth_date IS NOT NULL
        AND SUBSTR(birth_date, 6, 5) IN (${days.map(() => '?').join(',')})
        AND (birthday_sent_year IS NULL OR birthday_sent_year <> ?)`,
    [...days, year],
  );

  let sent = 0;
  for (const u of rows) {
    const result = await send('birthday', {
      to: u.email,
      vars: {
        nome: u.name.split(' ')[0],
        nome_completo: u.name,
        email: u.email,
        idade: ageIn(u.birth_date, year) ?? '',
      },
    }).catch((e) => ({ success: false, error: e }));
    if (result.success) {
      await db.run('UPDATE users SET birthday_sent_year = ? WHERE id = ?', [year, u.id]);
      sent += 1;
    }
  }
  return sent;
}
