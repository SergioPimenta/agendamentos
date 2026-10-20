import { useRef, useState, type FormEvent } from 'react';
import { EyeOff, ImagePlus, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Switch, Textarea } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/Misc';
import { useApi } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { fmtMoney } from '../../lib/format';
import { api } from '../../services/api';
import type { Room } from '../../types';

interface FormState {
  name: string; tagline: string; description: string; capacity: number; price: string; image: string;
  amenities: string[]; min_minutes: number; max_minutes: number; buffer_minutes: number; active: boolean; sort_order: number;
}

const blank: FormState = {
  name: '', tagline: '', description: '', capacity: 2, price: '40,00', image: '', amenities: ['Wi-Fi 500 Mbps', 'Ar-condicionado'],
  min_minutes: 60, max_minutes: 480, buffer_minutes: 0, active: true, sort_order: 0,
};

const toForm = (r: Room): FormState => ({
  name: r.name, tagline: r.tagline, description: r.description, capacity: r.capacity,
  price: (r.price_cents / 100).toFixed(2).replace('.', ','), image: r.image, amenities: r.amenities,
  min_minutes: r.min_minutes, max_minutes: r.max_minutes, buffer_minutes: r.buffer_minutes, active: r.active, sort_order: r.sort_order,
});

const parseMoney = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.') || '0') * 100);

export default function AdminRooms() {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useApi(() => api.get<{ rooms: Room[] }>('/admin/rooms'), []);
  const [editing, setEditing] = useState<{ room?: Room } | null>(null);

  const remove = async (room: Room) => {
    const ok = await confirm({ title: `Excluir ${room.name}?`, description: 'Só é possível excluir salas sem reservas. Se houver histórico, desative a sala.', confirmLabel: 'Excluir', tone: 'danger' });
    if (!ok) return;
    try {
      await api.delete(`/admin/rooms/${room.id}`);
      toast.success('Sala excluída.');
      setEditing(null);
      q.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Espaço" title="Salas" description="Cadastre as salas, defina preço, capacidade e regras de duração." actions={<Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Nova sala</Button>} />
      {q.error && <ErrorState message={q.error} onRetry={q.refetch} />}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {!q.data ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[330px] rounded-[24px]" />) : q.data.rooms.map((r) => (
          <article key={r.id} className={cn('overflow-hidden rounded-[24px] border border-ink/8 bg-cream', !r.active && 'opacity-70')}>
            <div className="relative aspect-[16/9] bg-mist-light">
              {r.image && <img src={r.image} alt="" loading="lazy" className="h-full w-full object-cover" />}
              {!r.active && <span className="absolute top-3 left-3"><Badge tone="ink"><EyeOff size={12} />Desativada</Badge></span>}
            </div>
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-[19px] font-medium text-ink">{r.name}</h2>
                  <p className="mt-0.5 text-[13px] text-stone">{r.tagline}</p>
                </div>
                <span className="shrink-0 font-display text-[17px] font-medium text-ink">{fmtMoney(r.price_cents)}<span className="text-[12px] font-normal text-stone">/h</span></span>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[13px] text-stone"><Users size={14} className="text-sage-700" />até {r.capacity} · {r.bookings_count} reservas</span>
                <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing({ room: r })}>Editar</Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <RoomForm
        open={!!editing}
        room={editing?.room}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); q.reload(); }}
        onDelete={remove}
      />
    </>
  );
}

function RoomForm({ open, room, onClose, onSaved, onDelete }: { open: boolean; room?: Room; onClose: () => void; onSaved: () => void; onDelete: (r: Room) => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(blank);
  const [amenity, setAmenity] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seed, setSeed] = useState(-1);
  const file = useRef<HTMLInputElement>(null);

  const key = open ? (room?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setAmenity('');
      setF(room ? toForm(room) : blank);
    }
  }

  const upload = async (files: FileList | null) => {
    const picked = files?.[0];
    if (!picked) return;
    setUploading(true);
    try {
      const r = await api.upload<{ url: string }>('/admin/upload', picked);
      setF((s) => ({ ...s, image: r.url }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no envio da imagem.');
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const addAmenity = () => {
    const v = amenity.trim();
    if (v && !f.amenities.includes(v)) setF((s) => ({ ...s, amenities: [...s.amenities, v] }));
    setAmenity('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...f, price_cents: parseMoney(f.price), price: undefined };
      if (room) await api.put(`/admin/rooms/${room.id}`, body);
      else await api.post('/admin/rooms', body);
      toast.success(room ? 'Sala atualizada.' : 'Sala criada.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const num = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: Number(e.target.value) }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      locked={saving}
      title={room ? `Editar ${room.name}` : 'Nova sala'}
      footer={
        <>
          {room && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={() => onDelete(room)}>Excluir</Button>}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('room-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose sm:col-span-2">{error}</div>}

        <div className="flex items-center gap-4 sm:col-span-2">
          <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-mist-light text-stone-light">
            {f.image ? <img src={f.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={26} />}
          </div>
          <div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="room-image" onChange={(e) => upload(e.target.files)} />
            <Button variant="secondary" size="sm" loading={uploading} onClick={() => file.current?.click()}>{f.image ? 'Trocar foto' : 'Enviar foto'}</Button>
            <p className="mt-2 text-[12px] text-stone-light">JPG, PNG ou WebP, até 5 MB.</p>
          </div>
        </div>

        <Input label="Nome" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sala Brisa" />
        <Input label="Frase curta" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
        <Textarea containerClassName="sm:col-span-2" label="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input label="Capacidade (pessoas)" type="number" min={1} required value={f.capacity} onChange={num('capacity')} />
        <Input label="Valor por hora (R$)" inputMode="decimal" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} hint="Use 0 para salas sem cobrança." />
        <Input label="Duração mínima (min)" type="number" min={15} step={15} required value={f.min_minutes} onChange={num('min_minutes')} />
        <Input label="Duração máxima (min)" type="number" min={15} step={15} required value={f.max_minutes} onChange={num('max_minutes')} />
        <Input label="Intervalo entre reservas (min)" type="number" min={0} step={5} value={f.buffer_minutes} onChange={num('buffer_minutes')} hint="Tempo livre para arrumação entre uma reserva e outra." />
        <Input label="Ordem na lista" type="number" min={0} value={f.sort_order} onChange={num('sort_order')} />

        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-semibold tracking-wide text-ink">Comodidades</span>
          <div className="mb-2.5 flex flex-wrap gap-2">
            {f.amenities.map((a) => (
              <span key={a} className="inline-flex items-center gap-1.5 rounded-full bg-sage-dim py-1 pr-1.5 pl-3 text-[12px] font-medium text-sage-700">
                {a}
                <button type="button" aria-label={`Remover ${a}`} onClick={() => setF((s) => ({ ...s, amenities: s.amenities.filter((x) => x !== a) }))} className="rounded-full p-0.5 hover:bg-sage/30"><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input aria-label="Nova comodidade" containerClassName="flex-1" placeholder="Ex.: TV, quadro branco…" value={amenity} onChange={(e) => setAmenity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAmenity(); } }} />
            <Button variant="secondary" onClick={addAmenity}>Adicionar</Button>
          </div>
        </div>

        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Sala ativa" description="Desativada, não aparece para reservas (o histórico é mantido)." /></div>
      </form>
    </Modal>
  );
}
