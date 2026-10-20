import { useState, type FormEvent } from 'react';
import { Plus, ShieldBan, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { fmtDateFull, todayStr } from '../../lib/format';
import { api, ApiError } from '../../services/api';
import type { Block, Room } from '../../types';

export default function AdminBlocks() {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useApi(() => api.get<{ blocks: Block[] }>('/admin/blocks'), []);
  const rooms = useApi(() => api.get<{ rooms: Room[] }>('/rooms'), []);
  const [open, setOpen] = useState(false);

  const today = todayStr();
  const blank = { room_id: '', start_date: today, start_time: '08:00', end_date: today, end_time: '20:00', reason: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [allDay, setAllDay] = useState(true);

  const start = () => { setF(blank); setAllDay(true); setError(''); setOpen(true); };

  const save = async (force = false) => {
    setSaving(true);
    setError('');
    try {
      await api.post('/admin/blocks', {
        ...f,
        room_id: f.room_id ? Number(f.room_id) : null,
        start_time: allDay ? '00:00' : f.start_time,
        end_time: allDay ? '23:59' : f.end_time,
        force,
      });
      toast.success('Período bloqueado.');
      setOpen(false);
      q.reload();
    } catch (e) {
      if (e instanceof ApiError && e.data.code === 'HAS_BOOKINGS') {
        const ok = await confirm({
          title: 'Há reservas nesse período',
          description: `${e.message} Elas continuarão ativas e você precisará cancelá-las manualmente. Bloquear mesmo assim?`,
          confirmLabel: 'Bloquear mesmo assim',
        });
        if (ok) return save(true);
      } else {
        setError(e instanceof Error ? e.message : 'Não foi possível bloquear.');
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); save(); };

  const remove = async (b: Block) => {
    if (!(await confirm({ title: 'Remover este bloqueio?', description: 'O período volta a ficar disponível para reservas.', confirmLabel: 'Remover', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/blocks/${b.id}`);
      toast.success('Bloqueio removido.');
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover.');
    }
  };

  const fmt = (at: string) => `${fmtDateFull(at.slice(0, 10))} ${at.slice(11)}`;

  return (
    <>
      <PageHeader eyebrow="Operação" title="Bloqueios" description="Feriados, manutenção, eventos… Períodos bloqueados não recebem reservas." actions={<Button icon={<Plus size={16} />} onClick={start}>Novo bloqueio</Button>} />
      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      {!q.data ? <Skeleton className="h-[240px] rounded-[22px]" /> : q.data.blocks.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<ShieldBan />} title="Nenhum bloqueio" description="Tudo liberado para reservas." action={<Button onClick={start}>Bloquear um período</Button>} /></div>
      ) : (
        <DataTable>
          <thead><tr><Th>Sala</Th><Th>Início</Th><Th>Fim</Th><Th>Motivo</Th><Th /></tr></thead>
          <tbody>
            {q.data.blocks.map((b) => (
              <tr key={b.id}>
                <Td>{b.room_name ? b.room_name : <Badge tone="clay">Todas as salas</Badge>}</Td>
                <Td>{fmt(b.start_at)}</Td>
                <Td>{fmt(b.end_at)}</Td>
                <Td className="text-stone">{b.reason || '—'}</Td>
                <Td className="text-right"><IconButton label="Remover bloqueio" onClick={() => remove(b)}><Trash2 size={17} /></IconButton></Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        locked={saving}
        title="Bloquear período"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={saving} onClick={() => save()}>Bloquear</Button></>}
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose sm:col-span-2">{error}</div>}
          <Select containerClassName="sm:col-span-2" label="Sala" value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value })}>
            <option value="">Todas as salas</option>
            {rooms.data?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Input label="Data inicial" type="date" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} />
          <Input label="Data final" type="date" required min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
          <label className="flex items-center gap-2.5 text-[13.5px] text-ink sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-sage-700" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Dia(s) inteiro(s)
          </label>
          {!allDay && (
            <>
              <Input label="Hora inicial" type="time" required value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
              <Input label="Hora final" type="time" required value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} />
            </>
          )}
          <Textarea containerClassName="sm:col-span-2" label="Motivo" rows={2} maxLength={200} placeholder="Ex.: Feriado, manutenção do ar-condicionado…" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </form>
      </Modal>
    </>
  );
}
