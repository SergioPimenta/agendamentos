import nodemailer from 'nodemailer';
import { config } from '../config.js';

const enabled = Boolean(config.mail.host && config.mail.user);

const transporter = enabled
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: { user: config.mail.user, pass: config.mail.pass },
    })
  : null;

export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Envelope visual no padrão harmonizeoser. `rows` = [[rótulo, valor]] */
export function emailTemplate({ title, intro, rows = [], cta, footer = '' }) {
  const details = rows.length
    ? `<table role="presentation" width="100%" style="margin:20px 0;border-collapse:collapse">${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:9px 0;border-bottom:1px solid #e7e2d3;color:#6c6f62;font-size:13px;width:38%">${escapeHtml(k)}</td><td style="padding:9px 0;border-bottom:1px solid #e7e2d3;color:#262a22;font-size:14px;font-weight:600">${escapeHtml(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const button = cta
    ? `<p style="margin:26px 0 6px"><a href="${cta.url}" style="background:#566b4f;color:#fffdf7;text-decoration:none;padding:13px 26px;border-radius:999px;font-size:14px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f7f4ec;padding:28px 12px;font-family:Manrope,Segoe UI,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fffdf7;border-radius:22px;padding:34px;border:1px solid #e7e2d3">
    <div style="font-family:Georgia,serif;font-size:21px;color:#262a22;margin-bottom:22px">harmonize<span style="color:#566b4f">oser</span></div>
    <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;color:#262a22;margin:0 0 10px">${escapeHtml(title)}</h1>
    <p style="color:#6c6f62;font-size:14.5px;line-height:1.7;margin:0">${intro}</p>
    ${details}${button}
    <p style="color:#9a9c90;font-size:12px;line-height:1.6;margin:26px 0 0">${footer}</p>
  </div></body></html>`;
}

/** Envio "melhor esforço": nunca derruba a requisição. Sem SMTP configurado, apenas registra no log. */
export async function sendMail({ to, subject, html, text = '', attachments }) {
  // Nos testes, tudo o que seria enviado fica numa caixa de saída em memória para conferir.
  if (process.env.NODE_ENV === 'test') (globalThis.__mailOutbox ??= []).push({ to, subject, html, text, attachments });
  if (!transporter) {
    console.log(`[mail:desativado] Para: ${to} · ${subject}${text ? `\n${text}` : ''}`);
    return { success: false, skipped: true };
  }
  try {
    const info = await transporter.sendMail({ from: `"harmonizeoser" <${config.mail.from}>`, to, subject, text, html, attachments });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[mail] falha ao enviar:', error.message);
    return { success: false, error };
  }
}
