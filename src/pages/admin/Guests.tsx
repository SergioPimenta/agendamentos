import { useState } from 'react';
import { Trash2, Upload, UserPlus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { SearchInput } from '../../components/ui/Form';
import { DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { fmtDateFull } from '../../lib/format';
import { api } from '../../services/api';
import type { ClientGuest } from '../../types';
import { ImportGuestsModal } from './ImportGuests';

const PER_PAGE = 25;

/** Convidados dos clientes: os do sistema anterior (importados) e os de cada reserva nova. */
export default function AdminGuests() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canEdit = can('clients', 'edit');
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);

  const list = useApi(() => api.get<{ guests: ClientGuest[]; total: number }>('/admin/guests', { q, page: String(page), per_page: String(PER_PAGE) }), [q, page]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total ? (page - 1) * PER_PAGE + 1 : 0;
  const to = Math.min(page * PER_PAGE, total);

  const remove = async (g: ClientGuest) => {
    if (!(await confirm({ title: `Excluir ${g.name || g.email}?`, description: 'O convidado sai desta lista. A reserva em si não muda.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/guests/${g.id}`);
      toast.success('Convidado excluído.');
      list.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Convidados"
        description="Quem foi convidado para as reservas dos clientes. Cada convidado de uma reserva nova entra aqui sozinho."
        actions={canEdit && <Button variant="secondary" icon={<Upload size={16} />} onClick={() => setImporting(true)}>Importar convidados</Button>}
      />

      <div className="mb-5">
        <SearchInput placeholder="Buscar por convidado, e-mail, cliente ou anfitrião…" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} aria-label="Buscar" />
      </div>

      {list.error && <ErrorState message={list.error} onRetry={list.refetch} />}
      {!list.data ? <Skeleton className="h-[320px] rounded-[22px]" /> : list.data.guests.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<UserPlus />} title="Nenhum convidado encontrado" /></div>
      ) : (
        <>
          <DataTable fit className={list.loading ? 'opacity-60' : ''}>
            <colgroup><col className="w-[24%]" /><col className="w-[26%]" /><col className="w-[18%]" /><col className="w-[14%]" /><col className="w-[18%]" /></colgroup>
            <thead><tr>{['Convidado', 'Cliente e anfitrião', 'Convite', 'Reserva', 'Cadastro'].map((h) => <Th key={h} className="px-3 whitespace-normal">{h}</Th>)}</tr></thead>
            <tbody>
              {list.data.guests.map((g) => (
                <tr key={g.id}>
                  <Td className="px-3">
                    <p className="font-medium break-words">{g.name || <span className="text-stone-light">Sem nome</span>}</p>
                    <a className="text-[12px] break-all text-stone no-underline hover:text-sage-700" href={`mailto:${g.email}`}>{g.email}</a>
                  </Td>
                  <Td className="px-3">
                    <p className="break-words">{g.client_code ? `${g.client_code} - ` : ''}{g.client_name || '—'}</p>
                    {g.host_name && <p className="text-[12px] text-stone">Anfitrião: {g.host_name}</p>}
                    {g.unit && <p className="text-[12px] text-stone">Unidade: {g.unit}</p>}
                  </Td>
                  <Td className="px-3">
                    {g.invite_date ? fmtDateFull(g.invite_date) : '—'}
                    {g.invite_start && <span className="block text-[12px] text-stone">{g.invite_start}{g.invite_end ? ` às ${g.invite_end}` : ''}</span>}
                  </Td>
                  <Td className="px-3">
                    {g.linked ? <Badge tone="sage">Vinculado</Badge> : <Badge tone="mist">Sem vínculo</Badge>}
                  </Td>
                  <Td className="px-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12.5px] text-stone">{fmtDateFull(g.created_at.slice(0, 10))}<span className="block">{g.created_at.slice(11, 16)}</span></span>
                      {canEdit && <Button size="sm" variant="ghost" aria-label={`Excluir ${g.name || g.email}`} icon={<Trash2 size={14} />} onClick={() => remove(g)} />}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-stone">
            <span>{from}–{to} de {total} convidado{total === 1 ? '' : 's'}</span>
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

      <ImportGuestsModal open={importing} onClose={() => setImporting(false)} onDone={() => { setPage(1); list.reload(); }} />
    </>
  );
}
