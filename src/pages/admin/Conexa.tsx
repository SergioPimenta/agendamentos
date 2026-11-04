import { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw, RotateCcw, Plug } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useToast } from '../../components/ui/Feedback';
import { Select } from '../../components/ui/Form';
import { Card, PageHeader } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { api } from '../../services/api';

interface ConexaEvent { id: number; source: 'webhook' | 'api'; kind: string; booking_ref: string | null; status: 'ok' | 'ignored' | 'error'; message: string; created_at: string; retryable: boolean }
interface ConexaStatus {
  webhook: { configured: boolean; url: string | null };
  api: { configured: boolean; base_url: string | null };
  syncing: boolean;
  last_sync: { status: string; message: string; created_at: string } | null;
  pending_errors: number;
  bookings_from_conexa: number;
  places: { place_id: string; name: string; room_id: number | null }[];
  rooms: { id: number; name: string }[];
  events: ConexaEvent[];
}

const KIND: Record<string, string> = {
  reserva_cadastrada: 'Reserva cadastrada', reserva_editada: 'Reserva editada', reserva_cancelada: 'Reserva cancelada',
  sincronizacao: 'Conferência pela API', reserva: 'Reserva', outro: 'Outro aviso',
};
const WEBHOOKS = ['Reserva · Cadastro de Reserva', 'Reserva · Edição de Reserva', 'Reserva · Cancelamento de Reserva', 'Reserva Recorrente · Cadastro de Reserva Recorrente'];
const stamp = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;

export default function AdminConexa() {
  const toast = useToast();
  const [watch, setWatch] = useState(false);
  const q = useApi(() => api.get<ConexaStatus>('/admin/conexa/status'), []);
  const d = q.data;
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);

  // Enquanto lê a API, acompanha o andamento.
  useEffect(() => {
    if (!watch && !d?.syncing) return;
    const t = setInterval(() => q.reload(), 4000);
    if (watch && d && !d.syncing) setWatch(false);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch, d?.syncing]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) toast.success(msg);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setBusy('');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Selecione o endereço e copie manualmente.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Integrações" title="Integração Conexa" description="As reservas feitas na Conexa aparecem aqui sozinhas: a Conexa avisa cada reserva (webhook) e, com o token da API, o sistema confere de tempos em tempos." />
      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      {!d ? <Skeleton className="h-[320px] rounded-[22px]" /> : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5">
              <p className="text-[12px] font-semibold tracking-wide text-stone uppercase">Avisos (webhook)</p>
              <div className="mt-2"><Badge tone={d.webhook.configured ? 'sage' : 'amber'}>{d.webhook.configured ? 'Pronto para receber' : 'Falta o segredo'}</Badge></div>
              <p className="mt-2 text-[13px] text-stone">{d.webhook.configured ? 'Cadastre os endereços abaixo na Conexa.' : 'Defina CONEXA_WEBHOOK_TOKEN no servidor (Hostinger) e reinicie.'}</p>
            </Card>
            <Card className="p-5">
              <p className="text-[12px] font-semibold tracking-wide text-stone uppercase">API (conferência)</p>
              <div className="mt-2"><Badge tone={d.api.configured ? 'sage' : 'mist'}>{d.api.configured ? 'Configurada' : 'Sem token'}</Badge></div>
              <p className="mt-2 text-[13px] text-stone">{d.api.configured ? d.api.base_url : 'Opcional. Defina CONEXA_URL e CONEXA_TOKEN no servidor.'}</p>
            </Card>
            <Card className="p-5">
              <p className="text-[12px] font-semibold tracking-wide text-stone uppercase">Reservas vindas da Conexa</p>
              <p className="mt-2 font-display text-[28px] font-medium text-ink">{d.bookings_from_conexa}</p>
              {d.pending_errors > 0 && <p className="text-[13px] text-rose">{d.pending_errors} aviso(s) parado(s) esperando ajuste.</p>}
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-display text-[18px] font-medium text-ink">1 · Cadastre os webhooks na Conexa</h2>
            <p className="mt-1 text-[13px] text-stone">Em Configurações → Integrações → Webhooks, crie um webhook para cada evento abaixo, todos com o mesmo endereço. Os 3 antigos, desativados, podem ficar como estão.</p>
            {d.webhook.url ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-xl bg-sand px-3.5 py-2.5 text-[12.5px] break-all text-ink">{d.webhook.url}</code>
                <Button variant="secondary" size="sm" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={() => copy(d.webhook.url!)}>{copied ? 'Copiado' : 'Copiar'}</Button>
              </div>
            ) : <p className="mt-3 text-[13px] text-amber">O endereço aparece aqui assim que CONEXA_WEBHOOK_TOKEN estiver definido no servidor.</p>}
            <ul className="mt-3 flex flex-col gap-1 text-[13px] text-ink">
              {WEBHOOKS.map((w) => <li key={w} className="flex items-center gap-2"><Plug size={14} className="text-sage-700" />{w}</li>)}
            </ul>
            <p className="mt-3 text-[12px] text-stone-light">A Conexa envia o aviso em até 5 minutos e bloqueia o webhook depois de 5 falhas seguidas. Por isso o sistema sempre responde "ok" e deixa os problemas registrados aqui embaixo.</p>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-[18px] font-medium text-ink">2 · Relacione as salas</h2>
            <p className="mt-1 text-[13px] text-stone">Cada local da Conexa precisa de uma sala daqui. O sistema relaciona pelo nome; o que não bater aparece abaixo para você escolher.</p>
            {d.places.length === 0 ? <p className="mt-3 text-[13px] text-stone">Nenhum local recebido ainda. Eles aparecem aqui quando chega o primeiro aviso.</p> : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {d.places.map((p) => (
                  <Select
                    key={p.place_id}
                    label={`${p.name || 'Local'} (nº ${p.place_id})`}
                    value={p.room_id ?? ''}
                    disabled={busy === `p${p.place_id}`}
                    onChange={(e) => run(`p${p.place_id}`, async () => {
                      const r = await api.put<{ reprocessed: number }>(`/admin/conexa/places/${p.place_id}`, { room_id: e.target.value ? Number(e.target.value) : null });
                      return r.reprocessed ? `Sala relacionada. ${r.reprocessed} aviso(s) parado(s) foram aplicados.` : 'Sala relacionada.';
                    })}
                  >
                    <option value="">Sem sala (reservas desse local ficam paradas)</option>
                    {d.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-[18px] font-medium text-ink">3 · Conferência pela API</h2>
            <p className="mt-1 text-[13px] text-stone">Lê as reservas da Conexa e corrige o que algum aviso perdeu, inclusive reservas anteriores ao webhook. Roda sozinha de hora em hora; a leitura completa pode levar alguns minutos (limite de 60 chamadas por minuto).</p>
            {d.last_sync && <p className="mt-2 text-[13px] text-ink">Última conferência ({stamp(d.last_sync.created_at)}): {d.last_sync.message}</p>}
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Button variant="secondary" size="sm" disabled={!d.api.configured} loading={busy === 'test'} onClick={() => run('test', async () => { await api.post('/admin/conexa/test'); return 'Conexão com a Conexa funcionando.'; })}>Testar conexão</Button>
              <Button size="sm" icon={<RefreshCw size={15} />} disabled={!d.api.configured || d.syncing} loading={busy === 'sync' || d.syncing} onClick={() => run('sync', async () => { await api.post('/admin/conexa/sync', { days_back: 30, days_ahead: 365 }); setWatch(true); return 'Conferência iniciada. Acompanhe aqui.'; })}>{d.syncing ? 'Conferindo…' : 'Sincronizar agora'}</Button>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-[18px] font-medium text-ink">O que chegou</h2>
            {d.events.length === 0 ? <p className="mt-2 text-[13px] text-stone">Nada ainda.</p> : (
              <ul className="mt-3 divide-y divide-ink/8">
                {d.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-[13px]">
                    <span className="w-[88px] shrink-0 text-stone">{stamp(e.created_at)}</span>
                    <Badge tone={e.status === 'ok' ? 'sage' : e.status === 'error' ? 'rose' : 'mist'}>{e.status === 'ok' ? 'Ok' : e.status === 'error' ? 'Parado' : 'Ignorado'}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{KIND[e.kind] ?? e.kind}{e.booking_ref ? ` · nº ${e.booking_ref}` : ''}</span>
                      <span className="text-stone"> · {e.source === 'webhook' ? 'aviso' : 'API'}</span>
                      <span className="block text-stone">{e.message}</span>
                    </span>
                    {e.retryable && <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} loading={busy === `e${e.id}`} onClick={() => run(`e${e.id}`, async () => { const r = await api.post<{ status: string; message?: string }>(`/admin/conexa/events/${e.id}/retry`); return r.status === 'ok' ? 'Aviso aplicado.' : r.message || 'Ainda não foi possível aplicar.'; })}>Reprocessar</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
