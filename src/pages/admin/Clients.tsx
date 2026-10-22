import { useState, type FormEvent } from 'react';
import { Mail, MapPin, Pencil, Phone, Plus, Trash2, Upload, Users } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { BookingRow } from '../../components/booking/BookingRow';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Select, SearchInput, Switch, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { Avatar, DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { fmtDateFull, fmtDuration, fmtMoney, fmtMonth, todayStr } from '../../lib/format';
import { api } from '../../services/api';
import { PeopleSection } from './ClientPeople';
import { ImportClientsModal } from './ImportClients';
import type { AccessProfile, Booking, Client, ClientPerson, Plan, Statement } from '../../types';

const PER_PAGE = 25;
const emptyForm = { name: '', email: '', password: '', profile_id: '', phone: '', document: '', company: '', city: '', state: '', tags: '', birth_date: '', plan_id: '', notes: '', active: true };

export default function AdminClients() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canEditClients = can('clients', 'edit');
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [plan, setPlan] = useState('');
  const [active, setActive] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState<{ client?: Client } | null>(null);
  const [importing, setImporting] = useState(false);

  const [page, setPage] = useState(1);
  const list = useApi(() => api.get<{ users: Client[]; total: number }>('/admin/users', { q, plan_id: plan, active, page: String(page), per_page: String(PER_PAGE) }), [q, plan, active, page]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total ? (page - 1) * PER_PAGE + 1 : 0;
  const to = Math.min(page * PER_PAGE, total);
  // Mudou o filtro: volta para a primeira página.
  const filter = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
  const plans = useApi(() => api.get<{ plans: Plan[] }>('/admin/plans'), []);
  // O perfil de acesso só é escolhido aqui por quem gerencia Perfis de usuário.
  const canPickProfile = can('profiles', 'edit');
  const profiles = useApi(() => (canPickProfile ? api.get<{ profiles: AccessProfile[] }>('/admin/profiles') : Promise.resolve(null)), [canPickProfile]);

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Clientes"
        description="Quem usa o espaço, em qual plano e quando reservou pela última vez."
        actions={canEditClients && (<><Button variant="secondary" icon={<Upload size={16} />} onClick={() => setImporting(true)}>Importar clientes</Button><Button icon={<Plus size={16} />} onClick={() => setForm({})}>Novo cliente</Button></>)}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr]">
        <SearchInput placeholder="Buscar por nome, e-mail, empresa, cidade, etiqueta…" value={text} onChange={(e) => filter(setText)(e.target.value)} aria-label="Buscar" />
        <Select aria-label="Plano" value={plan} onChange={(e) => filter(setPlan)(e.target.value)}>
          <option value="">Todos os planos</option>
          {plans.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select aria-label="Situação" value={active} onChange={(e) => filter(setActive)(e.target.value)}>
          <option value="">Ativos e inativos</option>
          <option value="true">Somente ativos</option>
          <option value="false">Somente inativos</option>
        </Select>
      </div>

      {list.error && <ErrorState message={list.error} onRetry={list.refetch} />}
      {!list.data ? <Skeleton className="h-[320px] rounded-[22px]" /> : list.data.users.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<Users />} title="Nenhum cliente encontrado" /></div>
      ) : (
        <>
          <DataTable fit className={list.loading ? 'opacity-60' : ''}>
            <colgroup><col className="w-[29%]" /><col className="w-[29%]" /><col className="w-[17%]" /><col className="w-[25%]" /></colgroup>
            <thead><tr>{['Cliente', 'Contato', 'Plano', 'Situação'].map((h) => <Th key={h} className="px-3 whitespace-normal">{h}</Th>)}</tr></thead>
            <tbody>
              {list.data.users.map((c) => (
                <tr key={c.id} onClick={() => setDetailId(c.id)} className="cursor-pointer transition-colors hover:bg-sage-dim/50">
                  <Td className="px-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.name} size={34} />
                      <div className="min-w-0">
                        <p className="font-medium break-words">{c.name} {c.role === 'admin' && <Badge tone="ink" className="ml-1">{c.profile_name ?? 'admin'}</Badge>}</p>
                        <p className="text-[12px] break-words text-stone">{c.company || (c.has_email ? c.email : c.city)}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="px-3"><span className={`block text-[13px] break-all ${c.has_email ? '' : 'text-stone-light'}`}>{c.has_email ? c.email : 'Sem e-mail'}</span><span className="text-[12px] break-words text-stone">{c.phone || '—'}{c.city ? ` · ${c.city}${c.state ? `/${c.state}` : ''}` : ''}</span></Td>
                  <Td className="px-3">{c.plan_name ? <Badge tone="sage">{c.plan_name}</Badge> : <span className="text-stone-light">—</span>}{c.tags && <span className="mt-1 block text-[11.5px] break-words text-stone">{c.tags}</span>}</Td>
                  <Td className="px-3">
                    <div className="flex flex-col items-start gap-1">
                      {c.active ? <Badge tone="sage">Ativo</Badge> : <Badge tone="rose">Inativo</Badge>}
                      <span className="text-[12px] text-stone">{c.bookings_count} reserva{c.bookings_count === 1 ? '' : 's'}</span>
                      <span className="text-[12px] text-stone">Próxima: {c.next_booking ? `${fmtDateFull(c.next_booking.slice(0, 10))} ${c.next_booking.slice(11)}` : '—'}</span>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-stone">
            <span>{from}–{to} de {total} cliente{total === 1 ? '' : 's'}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1 || list.loading} onClick={() => setPage(page - 1)}>Anterior</Button>
                <span>Página {page} de {pages}</span>
                <Button size="sm" variant="secondary" disabled={page >= pages || list.loading} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            )}
          </div>
        </>
      )}

      <ImportClientsModal open={importing} onClose={() => setImporting(false)} onDone={list.reload} />
      <ClientDetail
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(c) => { setDetailId(null); setForm({ client: c }); }}
        onChanged={list.reload}
      />
      <ClientForm
        open={!!form}
        client={form?.client}
        plans={plans.data?.plans ?? []}
        profiles={canPickProfile ? (profiles.data?.profiles ?? []) : null}
        onClose={() => setForm(null)}
        onSaved={() => { setForm(null); list.reload(); }}
        onDelete={async (c) => {
          const ok = await confirm({ title: `Excluir ${c.name}?`, description: 'Só é possível excluir clientes sem histórico de reservas. Caso contrário, desative a conta.', confirmLabel: 'Excluir', tone: 'danger' });
          if (!ok) return;
          try {
            await api.delete(`/admin/users/${c.id}`);
            toast.success('Cliente excluído.');
            setForm(null);
            list.reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
          }
        }}
      />
    </>
  );
}

function ClientForm({ open, client, plans, profiles, onClose, onSaved, onDelete }: {
  open: boolean; client?: Client; plans: Plan[]; profiles: AccessProfile[] | null; onClose: () => void; onSaved: () => void; onDelete: (c: Client) => void;
}) {
  const toast = useToast();
  const { user: me } = useAuth();
  const [f, setF] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState<number | null | undefined>(undefined);

  // Reinicia ao abrir
  const key = open ? (client?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setF(client ? {
        name: client.name, email: client.email, password: '', profile_id: client.profile_id ? String(client.profile_id) : '', phone: client.phone, document: client.document,
        company: client.company, city: client.city ?? '', state: client.state ?? '', tags: client.tags ?? '', birth_date: client.birth_date ?? '', plan_id: client.plan_id ? String(client.plan_id) : '', notes: client.notes, active: client.active,
      } : emptyForm);
    }
  }

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { profile_id, ...rest } = f;
      const body = {
        ...rest,
        plan_id: f.plan_id ? Number(f.plan_id) : null,
        password: f.password || undefined,
        // Sem permissão para gerenciar perfis, o acesso ao painel fica como está.
        ...(profiles ? { profile_id: profile_id ? Number(profile_id) : null } : {}),
      };
      if (client) await api.put(`/admin/users/${client.id}`, body);
      else await api.post('/admin/users', body);
      toast.success(client ? 'Cliente atualizado.' : 'Cliente criado.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title={client ? 'Editar cliente' : 'Novo cliente'}
      footer={
        <>
          {client && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={() => onDelete(client)}>Excluir</Button>}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('client-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose sm:col-span-2">{error}</div>}
        <Input containerClassName="sm:col-span-2" label="Nome completo" required value={f.name} onChange={set('name')} />
        <Input label="E-mail" type="email" value={f.email} onChange={set('email')} hint={client && !client.has_email ? 'Sem e-mail: informe um para o cliente poder entrar e receber mensagens.' : client ? undefined : 'Pode ficar em branco: o cliente não entra sozinho, a recepção reserva por ele.'} />
        <Input label={client ? 'Nova senha' : 'Senha inicial'} type="password" autoComplete="new-password" required={!client && !!f.email} minLength={8} hint={client ? 'Deixe em branco para manter' : 'Obrigatória com e-mail; mínimo de 8 caracteres'} value={f.password} onChange={set('password')} />
        <Input label="Telefone / WhatsApp" value={f.phone} onChange={set('phone')} />
        <Input label="Nome fantasia / empresa / profissão" value={f.company} onChange={set('company')} />
        <Input label="CPF / CNPJ" value={f.document} onChange={set('document')} />
        <Input label="Cidade" maxLength={80} value={f.city} onChange={set('city')} />
        <Input label="UF" maxLength={2} value={f.state} onChange={set('state')} hint="Ex.: PR" />
        <Input containerClassName="sm:col-span-2" label="Etiquetas" maxLength={255} value={f.tags} onChange={set('tags')} hint="Separe por vírgula. Ex.: Eventos, Pré-Pago" />
        <Input label="Data de nascimento" type="date" min="1900-01-01" max={todayStr()} value={f.birth_date} onChange={set('birth_date')} hint="Usada na lista de aniversariantes e no e-mail de parabéns." />
        <Select label="Plano" value={f.plan_id} onChange={set('plan_id')}>
          <option value="">Sem plano</option>
          {plans.filter((p) => p.active || String(p.id) === f.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {profiles ? (
          <Select
            label="Perfil de acesso ao painel"
            value={f.profile_id}
            onChange={set('profile_id')}
            disabled={client?.id === me?.id}
            hint={client?.id === me?.id ? 'Você não pode alterar o próprio perfil.' : 'Defina o que a pessoa vê e altera no painel.'}
          >
            <option value="">Sem acesso ao painel (cliente)</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold tracking-wide text-ink">Acesso ao painel</span>
            <span className="py-3 text-[14px] text-stone">{client?.profile_name ?? (client?.role === 'admin' ? 'Administrador' : 'Somente cliente')}</span>
          </div>
        )}
        <div className="flex items-end pb-2"><Switch checked={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} label="Conta ativa" description="Desativada, não consegue entrar." /></div>
        {client?.legacy_code && <p className="text-[12.5px] text-stone-light sm:col-span-2">Cliente nº {client.legacy_code} no sistema anterior.</p>}
        <Textarea containerClassName="sm:col-span-2" label="Observações internas" value={f.notes} onChange={set('notes')} />
      </form>
    </Modal>
  );
}

interface Detail {
  user: Client;
  people: ClientPerson[];
  statement: Statement;
  history: Booking[];
  lifetime: { bookings: number; minutes: number; amount_cents: number; pending_cents: number };
}

function ClientDetail({ id, onClose, onEdit, onChanged }: { id: number | null; onClose: () => void; onEdit: (c: Client) => void; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('clients', 'edit');
  const [month] = useState(todayStr().slice(0, 7));
  const [selected, setSelected] = useState<Booking | null>(null);
  const q = useApi(() => (id ? api.get<Detail>(`/admin/users/${id}`, { month }) : Promise.resolve(null)), [id, month]);
  const d = q.data;

  const payMonth = async () => {
    if (!id) return;
    try {
      const r = await api.post<{ updated: number }>(`/admin/users/${id}/pay`, { month });
      toast.success(`${r.updated} cobrança(s) marcadas como pagas.`);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao registrar pagamento.');
    }
  };

  return (
    <>
      <Modal
        open={!!id && !selected}
        onClose={onClose}
        size="lg"
        title={d?.user.name ?? 'Cliente'}
        subtitle={d?.user.company || d?.user.email || undefined}
        footer={<>{d && canEdit && <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => onEdit(d.user)}>Editar</Button>}<Button variant="ghost" onClick={onClose}>Fechar</Button></>}
      >
        {!d ? <Skeleton className="h-[260px]" /> : (
          <div className="flex flex-col gap-7">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-stone">
              {d.user.has_email
                ? <a className="inline-flex items-center gap-2 no-underline hover:text-sage-700" href={`mailto:${d.user.email}`}><Mail size={15} />{d.user.email}</a>
                : <span className="inline-flex items-center gap-2 text-stone-light"><Mail size={15} />Sem e-mail</span>}
              {d.user.phone && <a className="inline-flex items-center gap-2 no-underline hover:text-sage-700" href={`tel:${d.user.phone}`}><Phone size={15} />{d.user.phone}</a>}
              {d.user.city && <span className="inline-flex items-center gap-2"><MapPin size={15} />{d.user.city}{d.user.state ? `/${d.user.state}` : ''}</span>}
              {d.user.plan_name ? <Badge tone="sage">{d.user.plan_name}</Badge> : <Badge tone="mist">Sem plano</Badge>}
              {d.user.tags && d.user.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t} tone="clay">{t}</Badge>)}
              {!d.user.active && <Badge tone="rose">Inativo</Badge>}
            </div>
            {(d.user.legacy_code || d.user.notes) && (
              <p className="-mt-3 text-[12.5px] leading-relaxed text-stone-light">
                {d.user.legacy_code && <>Cliente nº {d.user.legacy_code} no sistema anterior. </>}{d.user.notes}
              </p>
            )}

            <PeopleSection userId={d.user.id} people={d.people} canEdit={canEdit} onChanged={() => { q.reload(); onChanged(); }} />

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Reservas (total)', String(d.lifetime.bookings)],
                ['Horas (total)', fmtDuration(d.lifetime.minutes)],
                ['Em aberto', fmtMoney(d.lifetime.pending_cents)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-sand px-5 py-4"><p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">{k}</p><p className="mt-1 font-display text-[24px] font-medium text-ink">{v}</p></div>
              ))}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-[17px] font-medium text-ink">Fatura de {fmtMonth(d.statement.month)}</h3>
                {canEdit && d.statement.totals.pending_cents > 0 && <Button size="sm" variant="soft" onClick={payMonth}>Marcar {fmtMoney(d.statement.totals.pending_cents)} como pago</Button>}
              </div>
              <p className="text-[13.5px] text-stone">
                {d.statement.totals.bookings} reservas · {fmtDuration(d.statement.totals.minutes)} · total {fmtMoney(d.statement.totals.amount_cents)}
                {d.statement.included_total != null && <> · plano: {fmtDuration(d.statement.included_used)} de {fmtDuration(d.statement.included_total)} usadas</>}
              </p>
            </div>

            <div>
              <h3 className="mb-3 font-display text-[17px] font-medium text-ink">Últimas reservas</h3>
              {d.history.length === 0 ? <p className="text-[13.5px] text-stone">Sem reservas ainda.</p> : (
                <div className="flex flex-col gap-2.5">{d.history.slice(0, 8).map((b) => <BookingRow key={b.id} booking={b} onClick={() => setSelected(b)} />)}</div>
              )}
            </div>
          </div>
        )}
      </Modal>
      <BookingDetail booking={selected} admin onClose={() => setSelected(null)} onChanged={() => { q.reload(); onChanged(); }} />
    </>
  );
}
