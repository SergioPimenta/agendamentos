import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorState, PageLoader, useToast } from '../../components/ui/Feedback';
import { Input, Select, Switch, Textarea } from '../../components/ui/Form';
import { Card, CardHeader, PageHeader } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { WEEKDAYS } from '../../lib/format';
import { PagarmeSettingsCard } from './PagarmeSettingsCard';
import { api } from '../../services/api';
import type { AdminSettings, BusinessHours } from '../../types';

export default function AdminSettingsPage() {
  const toast = useToast();
  const q = useApi(() => api.get<{ settings: AdminSettings; hours: BusinessHours[] }>('/admin/settings'), []);
  const [s, setS] = useState<AdminSettings | null>(null);
  const [hours, setHours] = useState<BusinessHours[]>([]);
  const [savingS, setSavingS] = useState(false);
  const [savingH, setSavingH] = useState(false);

  useEffect(() => {
    if (q.data) {
      setS(q.data.settings);
      setHours(q.data.hours);
    }
  }, [q.data]);

  if (q.error) return <ErrorState message={q.error} onRetry={q.refetch} />;
  if (!s) return <PageLoader />;

  const num = (k: keyof AdminSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [k]: Number(e.target.value) });
  const txt = (k: keyof AdminSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });

  const saveSettings = async () => {
    setSavingS(true);
    try {
      await api.put('/admin/settings', s);
      toast.success('Configurações salvas.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSavingS(false);
    }
  };

  const saveHours = async () => {
    setSavingH(true);
    try {
      await api.put('/admin/hours', hours);
      toast.success('Horário de funcionamento salvo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSavingH(false);
    }
  };

  const setHour = (i: number, patch: Partial<BusinessHours>) => setHours((h) => h.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <>
      <PageHeader eyebrow="Sistema" title="Configurações" description="Horário de funcionamento, regras de reserva e informações do espaço." />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Horário de funcionamento" subtitle="Define quando as salas podem ser reservadas." />
          <ul className="flex flex-col">
            {hours.map((h, i) => (
              <li key={h.weekday} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink/6 py-3 last:border-0">
                <label className="flex w-[130px] items-center gap-3 text-[13.5px] font-medium text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-sage-700" checked={h.is_open} onChange={(e) => setHour(i, { is_open: e.target.checked })} />
                  {WEEKDAYS[h.weekday]}
                </label>
                {h.is_open ? (
                  <div className="flex items-center gap-2">
                    <input aria-label={`Abertura ${WEEKDAYS[h.weekday]}`} type="time" value={h.open_time} onChange={(e) => setHour(i, { open_time: e.target.value })} className="rounded-xl border border-ink/12 bg-cream px-3 py-2 text-[13.5px] outline-none focus:border-sage-700" />
                    <span className="text-stone">às</span>
                    <input aria-label={`Fechamento ${WEEKDAYS[h.weekday]}`} type="time" value={h.close_time} onChange={(e) => setHour(i, { close_time: e.target.value })} className="rounded-xl border border-ink/12 bg-cream px-3 py-2 text-[13.5px] outline-none focus:border-sage-700" />
                  </div>
                ) : <span className="text-[13px] text-stone-light">Fechado</span>}
              </li>
            ))}
          </ul>
          <Button className="mt-5" loading={savingH} onClick={saveHours}>Salvar horários</Button>
        </Card>

        <Card>
          <CardHeader title="Regras de reserva" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Intervalo dos horários" value={s.slot_step_minutes} onChange={num('slot_step_minutes')} hint="Granularidade da agenda.">
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>1 hora</option>
            </Select>
            <Input label="Antecedência mínima (min)" type="number" min={0} value={s.min_notice_minutes} onChange={num('min_notice_minutes')} hint="Quanto antes do início o cliente precisa reservar." />
            <Input label="Reservar com até (dias)" type="number" min={1} max={365} value={s.max_advance_days} onChange={num('max_advance_days')} />
            <Input label="Cancelar até (horas antes)" type="number" min={0} max={168} value={s.cancel_min_hours} onChange={num('cancel_min_hours')} hint="Depois disso, só a recepção cancela." />
            <Input label="Validade das horas devolvidas (dias)" type="number" min={0} max={3650} value={s.bank_credit_days} onChange={num('bank_credit_days')} hint="Reserva paga e cancelada devolve as horas ao banco de horas do cliente. 0 = sem validade." />
            <Input label="Limite de reservas futuras" type="number" min={0} value={s.max_upcoming_bookings} onChange={num('max_upcoming_bookings')} hint="Por cliente. 0 = sem limite." />
            <Input label="Repetição semanal (máx.)" type="number" min={0} max={52} value={s.max_recurrence_weeks} onChange={num('max_recurrence_weeks')} hint="Semanas extras. 0 = desativa." />
          </div>
          <div className="mt-6 flex flex-col gap-5 border-t border-ink/8 pt-5">
            <Switch checked={s.require_approval} onChange={(v) => setS({ ...s, require_approval: v })} label="Exigir aprovação da recepção" description="Novas reservas dos clientes ficam pendentes até você aprovar." />
            <Switch checked={s.allow_signup} onChange={(v) => setS({ ...s, allow_signup: v })} label="Permitir cadastro pelo site" description="Quando desligado, só a recepção cria novos clientes." />
          </div>
          <Textarea containerClassName="mt-5" label="Políticas de uso (página de cada sala)" rows={5} maxLength={2000} hint="Uma regra por linha. Aparece na página de cada sala; a regra de cancelamento é acrescentada automaticamente." value={s.usage_policy ?? ''} onChange={txt('usage_policy')} />
          <Textarea containerClassName="mt-5" label="Aviso na tela de reservas" rows={2} maxLength={300} placeholder="Ex.: Fechamos de 24/12 a 02/01 para recesso." value={s.notice_message} onChange={txt('notice_message')} />
          <Button className="mt-5" loading={savingS} onClick={saveSettings}>Salvar regras</Button>
        </Card>

        <Card>
          <CardHeader title="Financeiro" subtitle="Como as faturas dos clientes são fechadas e cobradas." />
          <Input label="Vencimento da fatura (dia do mês seguinte)" type="number" min={1} max={28} value={s.invoice_due_day} onChange={num('invoice_due_day')} hint="A fatura de um mês reúne todas as reservas do cliente e vence neste dia do mês seguinte. Depois disso, aparece como vencida em Financeiro." />
          <Button className="mt-5" loading={savingS} onClick={saveSettings}>Salvar financeiro</Button>
        </Card>

        <PagarmeSettingsCard s={s} setS={setS} onSave={saveSettings} saving={savingS} />

        <Card>
          <CardHeader title="Check-in e check-out" subtitle="Como o cliente registra a chegada e a saída da sala (botão no sistema ou QR da porta)." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Check-in abre (min antes)" type="number" min={0} max={240} value={s.checkin_window_minutes} onChange={num('checkin_window_minutes')} hint="Quanto antes do início o cliente já pode fazer check-in." />
            <Input label="Tolerância no término (min)" type="number" min={0} max={120} value={s.overtime_grace_minutes} onChange={num('overtime_grace_minutes')} hint="Até aqui depois do fim, nada é cobrado." />
            <Input label="Encerrar sozinho após (min)" type="number" min={30} max={1440} value={s.auto_close_minutes} onChange={num('auto_close_minutes')} hint="Quem esquece o check-out é encerrado no horário previsto, sem excedente." />
          </div>
          <div className="mt-6 border-t border-ink/8 pt-5">
            <Switch checked={s.overtime_charge} onChange={(v) => setS({ ...s, overtime_charge: v })} label="Cobrar excedente por minuto" description="Passou da tolerância? Cobra os minutos que passaram do horário pelo valor da hora da sala (com o desconto do plano). Desligado, só registra." />
          </div>
          <Button className="mt-5" loading={savingS} onClick={saveSettings}>Salvar check-in e check-out</Button>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Informações do espaço" subtitle="Aparecem na ajuda, nos e-mails e nos convites de calendário." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome" value={s.business_name} onChange={txt('business_name')} />
            <Input label="E-mail de contato" type="email" value={s.business_email} onChange={txt('business_email')} />
            <Input containerClassName="sm:col-span-2" label="Endereço" value={s.business_address} onChange={txt('business_address')} />
            <Input label="Telefone" value={s.business_phone} onChange={txt('business_phone')} />
            <Input label="WhatsApp (com DDI e DDD)" placeholder="5541999999999" value={s.business_whatsapp} onChange={txt('business_whatsapp')} />
          </div>
          <Button className="mt-5" loading={savingS} onClick={saveSettings}>Salvar informações</Button>
        </Card>
      </div>
    </>
  );
}
