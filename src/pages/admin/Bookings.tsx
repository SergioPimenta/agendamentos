import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Plus, Search, Upload } from 'lucide-react';
import { BookingDetail } from '../../components/booking/BookingDetail';
import { BookingFormModal } from '../../components/booking/BookingFormModal';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, PaymentBadge, Skeleton, StatusBadge, useToast } from '../../components/ui/Feedback';
import { Input, Select, SearchInput } from '../../components/ui/Form';
import { DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { fmtDateFull, fmtDuration, fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { Booking, BusinessHours, PublicSettings, Room } from '../../types';
import { ImportBookingsModal } from './ImportBookings';

interface List { total: number; page: number; limit: number; bookings: Booking[] }

export default function AdminBookings() {
  const toast = useToast();
  const { can } = useAuth();
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const q = useDebounced(text, 350);
  const [filters, setFilters] = useState({
    status: params.get('status') ?? '', room_id: '', payment: '', from: '', to: '',
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [form, setForm] = useState<{ booking?: Booking | null } | null>(null);

  const list = useApi(
    () => api.get<List>('/admin/bookings', { ...filters, q, page, limit: 25 }),
    [filters.status, filters.room_id, filters.payment, filters.from, filters.to, q, page],
  );
  const meta = useApi(async () => {
    const [rooms, s] = await Promise.all([
      api.get<{ rooms: Room[] }>('/rooms'),
      api.get<{ settings: PublicSettings; hours: BusinessHours[] }>('/admin/settings'),
    ]);
    return { rooms: rooms.rooms, settings: s.settings, hours: s.hours };
  }, []);

  const setF = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
    if (k === 'status') setParams(e.target.value ? { status: e.target.value } : {}, { replace: true });
  };

  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;

  const exportCsv = () =>
    api.download('/admin/reports/export', 'reservas.csv', { from: filters.from || undefined, to: filters.to || undefined }).catch((e) => toast.error(e.message));

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Reservas"
        description="Busque, filtre e gerencie todas as reservas."
        actions={<>
          {can('bookings', 'edit') && <Button variant="secondary" icon={<Upload size={16} />} onClick={() => setImporting(true)}>Importar reservas</Button>}
          <Button variant="secondary" icon={<Download size={16} />} onClick={exportCsv}>Exportar CSV</Button>
          <Button icon={<Plus size={16} />} onClick={() => setForm({})}>Nova reserva</Button>
        </>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr]">
        <SearchInput placeholder="Buscar cliente, e-mail ou código…" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} aria-label="Buscar" />
        <Select aria-label="Status" value={filters.status} onChange={setF('status')}>
          <option value="">Todos os status</option>
          <option value="pending">Aguardando aprovação</option>
          <option value="confirmed">Confirmadas (futuras)</option>
          <option value="completed">Concluídas</option>
          <option value="cancelled">Canceladas</option>
          <option value="no_show">Não compareceu</option>
        </Select>
        <Select aria-label="Sala" value={filters.room_id} onChange={setF('room_id')}>
          <option value="">Todas as salas</option>
          {meta.data?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select aria-label="Pagamento" value={filters.payment} onChange={setF('payment')}>
          <option value="">Qualquer pagamento</option>
          <option value="pending">A pagar</option>
          <option value="paid">Pago</option>
          <option value="none">Sem cobrança</option>
        </Select>
        <Input aria-label="De" type="date" value={filters.from} onChange={setF('from')} />
        <Input aria-label="Até" type="date" value={filters.to} onChange={setF('to')} />
      </div>

      {list.error && <ErrorState message={list.error} onRetry={list.refetch} />}

      {!d ? <Skeleton className="h-[360px] rounded-[22px]" /> : d.bookings.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<Search />} title="Nenhuma reserva encontrada" description="Ajuste os filtros ou crie uma nova reserva." /></div>
      ) : (
        <>
          <DataTable className={list.loading ? 'opacity-60' : ''}>
            <thead><tr><Th>Data</Th><Th>Sala</Th><Th>Cliente</Th><Th>Duração</Th><Th className="text-right">Valor</Th><Th>Status</Th><Th>Pagamento</Th></tr></thead>
            <tbody>
              {d.bookings.map((b) => (
                <tr key={b.id} onClick={() => setSelected(b)} className="cursor-pointer transition-colors hover:bg-sage-dim/50">
                  <Td><span className="font-medium">{fmtDateFull(b.date)}</span><span className="block text-[12px] text-stone">{b.start_time}–{b.end_time}</span></Td>
                  <Td>{b.room.name}</Td>
                  <Td><span className="font-medium">{b.user?.name}</span><span className="block max-w-[200px] truncate text-[12px] text-stone">{b.title || b.code}</span></Td>
                  <Td>{fmtDuration(b.total_minutes)}</Td>
                  <Td className="text-right font-medium">{b.price_cents ? fmtMoney(b.price_cents) : '—'}</Td>
                  <Td><StatusBadge status={b.display_status} /></Td>
                  <Td>{b.status === 'cancelled' ? '—' : <PaymentBadge status={b.payment_status} />}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <div className="mt-4 flex items-center justify-between text-[13px] text-stone">
            <span>{d.total} reserva{d.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft size={15} />}>Anterior</Button>
              <span>Página {page} de {pages}</span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima <ChevronRight size={15} /></Button>
            </div>
          </div>
        </>
      )}

      <ImportBookingsModal open={importing} onClose={() => setImporting(false)} onDone={list.reload} />
      <BookingDetail booking={selected} admin onClose={() => setSelected(null)} onEdit={(b) => { setSelected(null); setForm({ booking: b }); }} onChanged={list.reload} />
      {meta.data && <BookingFormModal open={!!form} onClose={() => setForm(null)} admin booking={form?.booking} rooms={meta.data.rooms} hours={meta.data.hours} settings={meta.data.settings} onSaved={list.reload} />}
    </>
  );
}
