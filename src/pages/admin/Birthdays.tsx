import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cake, CalendarHeart, ChevronLeft, ChevronRight, Mail, MailCheck, Phone, UserX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Avatar, Card, PageHeader, Stat } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../hooks/useApi';
import { addMonths, fmtDayNumber, fmtMonth, fmtWeekdayShort, todayStr } from '../../lib/format';
import { cn } from '../../lib/cn';
import { api } from '../../services/api';
import type { Birthday } from '../../types';

interface Payload { month: string; today: string; birthdays: Birthday[]; without_birth_date: number }

export default function AdminBirthdays() {
  const { can } = useAuth();
  const currentMonth = todayStr().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const q = useApi(() => api.get<Payload>('/admin/birthdays', { month }), [month]);
  const d = q.data;
  const todayCount = d?.birthdays.filter((b) => b.is_today).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Aniversariantes"
        description="Clientes que fazem aniversário no mês, a partir da data de nascimento do cadastro."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        <Button variant="secondary" size="sm" aria-label="Mês anterior" icon={<ChevronLeft size={16} />} onClick={() => setMonth(addMonths(month, -1))} />
        <h2 className="min-w-[10.5rem] text-center font-display text-[19px] font-medium text-ink" aria-live="polite">{fmtMonth(month)}</h2>
        <Button variant="secondary" size="sm" aria-label="Próximo mês" icon={<ChevronRight size={16} />} onClick={() => setMonth(addMonths(month, 1))} />
        {month !== currentMonth && <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>Mês atual</Button>}
      </div>

      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="No mês" value={d ? d.birthdays.length : '—'} hint={d?.birthdays.length === 1 ? 'aniversariante' : 'aniversariantes'} icon={<CalendarHeart />} />
        <Stat label="Hoje" value={d && month === currentMonth ? todayCount : '—'} hint={month === currentMonth ? (todayCount === 1 ? 'aniversariante hoje' : 'aniversariantes hoje') : 'só no mês atual'} icon={<Cake />} tone="clay" />
        <Stat label="Sem data de nascimento" value={d ? d.without_birth_date : '—'} hint={d?.without_birth_date ? <Link to="/admin/clientes" className="font-semibold text-sage-700 no-underline">Completar cadastros →</Link> : 'Cadastros completos'} icon={<UserX />} tone="amber" />
      </div>

      {!d ? <Skeleton className="h-[280px] rounded-[22px]" /> : d.birthdays.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream">
          <EmptyState icon={<Cake />} title={`Ninguém faz aniversário em ${fmtMonth(month).split(' ')[0].toLowerCase()}`} description="Cadastre a data de nascimento dos clientes para vê-los aqui." />
        </div>
      ) : (
        <ul className={cn('flex flex-col gap-3', q.loading && 'opacity-60')}>
          {d.birthdays.map((b) => (
            <li
              key={b.id}
              className={cn(
                'flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[22px] border bg-cream px-5 py-4',
                b.is_today ? 'border-clay/40 bg-clay-dim/40' : 'border-ink/8',
              )}
            >
              <div className={cn('flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl', b.is_today ? 'bg-clay text-cream' : 'bg-sand text-ink')}>
                <span className="font-display text-[22px] leading-none font-medium">{fmtDayNumber(b.date)}</span>
                <span className="mt-0.5 text-[10.5px] font-semibold tracking-wide uppercase opacity-80">{fmtWeekdayShort(b.date)}</span>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={b.name} size={40} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{b.name}</p>
                  <p className="truncate text-[12.5px] text-stone">
                    {b.turning_age != null ? `Faz ${b.turning_age} anos` : 'Idade não informada'}
                    {b.company ? ` · ${b.company}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1 text-[13px] text-stone">
                <a className="inline-flex items-center gap-2 truncate no-underline hover:text-sage-700" href={`mailto:${b.email}`}><Mail size={14} />{b.email}</a>
                {b.phone && <a className="inline-flex items-center gap-2 no-underline hover:text-sage-700" href={`tel:${b.phone}`}><Phone size={14} />{b.phone}</a>}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {b.plan_name && <Badge tone="sage">{b.plan_name}</Badge>}
                {b.is_today && <Badge tone="clay"><Cake size={12} />Hoje</Badge>}
                {b.email_sent && <Badge tone="mist"><MailCheck size={12} />E-mail enviado</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sage-dim text-sage-700"><MailCheck size={18} /></span>
          <div>
            <h3 className="font-display text-[16px] font-medium text-ink">E-mail de aniversário automático</h3>
            <p className="mt-1 max-w-[70ch] text-[13.5px] leading-relaxed text-stone">
              No dia do aniversário, de manhã, cada cliente recebe o modelo “Feliz aniversário”, uma vez por ano.
              O envio depende do e-mail (SMTP) configurado no servidor.
              {can('email_templates') && <> Edite o texto ou desligue o envio em <Link to="/admin/modelos-de-email" className="font-semibold text-sage-700">Modelos de e-mail</Link>.</>}
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
