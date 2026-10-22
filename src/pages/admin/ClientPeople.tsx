import { useState, type FormEvent } from 'react';
import { Mail, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Select, Switch } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { fmtDateFull, todayStr } from '../../lib/format';
import { api } from '../../services/api';
import type { ClientPerson } from '../../types';

const blank = {
  name: '', gender: '' as ClientPerson['gender'], birth_date: '', email: '', phone: '', phone2: '', role: '', rg: '', cpf: '',
  signs_contract: false, guarantor: false, active: true, is_primary: false,
};

/** CPF com máscara (000.000.000-00) quando tem 11 dígitos; o resto aparece como está. */
const fmtCpf = (v: string) => (/^\d{11}$/.test(v) ? v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v);

/** Pessoas do cliente (titular, sócios, responsáveis), com cadastro, edição e exclusão. */
export function PeopleSection({ userId, people, canEdit, onChanged }: { userId: number; people: ClientPerson[]; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ person?: ClientPerson } | null>(null);

  const remove = async (p: ClientPerson) => {
    if (!(await confirm({ title: `Excluir ${p.name}?`, description: 'A pessoa sai do cadastro deste cliente.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/people/${p.id}`);
      toast.success('Pessoa excluída.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-[17px] font-medium text-ink">Pessoas</h3>
        {canEdit && <Button size="sm" variant="soft" icon={<Plus size={14} />} onClick={() => setEditing({})}>Adicionar pessoa</Button>}
      </div>
      {people.length === 0 ? (
        <p className="text-[13.5px] text-stone">Nenhuma pessoa cadastrada para este cliente.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {people.map((p) => (
            <li key={p.id} className="rounded-2xl border border-ink/8 bg-cream px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    <UserRound size={15} className="text-sage-700" />{p.name}
                    {p.is_primary && <Badge tone="sage">Principal</Badge>}
                    {p.signs_contract && <Badge tone="clay">Assina o contrato</Badge>}
                    {p.guarantor && <Badge tone="amber">Fiador</Badge>}
                    {!p.active && <Badge tone="mist">Inativa</Badge>}
                  </p>
                  {p.role && <p className="mt-0.5 text-[12.5px] text-stone">{p.role}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Editar ${p.name}`} icon={<Pencil size={14} />} onClick={() => setEditing({ person: p })} />
                    <Button size="sm" variant="ghost" aria-label={`Excluir ${p.name}`} icon={<Trash2 size={14} />} onClick={() => remove(p)} />
                  </div>
                )}
              </div>
              <dl className="mt-2.5 grid gap-x-6 gap-y-1.5 text-[12.5px] text-stone sm:grid-cols-2">
                {p.email && <div className="flex items-center gap-2"><Mail size={13} /><a className="no-underline hover:text-sage-700" href={`mailto:${p.email}`}>{p.email}</a></div>}
                {(p.phone || p.phone2) && <div className="flex items-center gap-2"><Phone size={13} />{[p.phone, p.phone2].filter(Boolean).join(' · ')}</div>}
                {p.birth_date && <div><span className="text-stone-light">Nascimento: </span>{fmtDateFull(p.birth_date)}</div>}
                {p.gender && <div><span className="text-stone-light">Sexo: </span>{p.gender}</div>}
                {p.cpf && <div><span className="text-stone-light">CPF: </span>{fmtCpf(p.cpf)}</div>}
                {p.rg && <div><span className="text-stone-light">RG: </span>{p.rg}</div>}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <PersonForm userId={userId} open={!!editing} person={editing?.person} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
    </div>
  );
}

function PersonForm({ userId, open, person, onClose, onSaved }: { userId: number; open: boolean; person?: ClientPerson; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(-1);

  const key = open ? (person?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setF(person ? {
        name: person.name, gender: person.gender, birth_date: person.birth_date, email: person.email, phone: person.phone, phone2: person.phone2,
        role: person.role, rg: person.rg, cpf: person.cpf, signs_contract: person.signs_contract, guarantor: person.guarantor, active: person.active, is_primary: person.is_primary,
      } : blank);
    }
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (person) await api.put(`/admin/people/${person.id}`, f);
      else await api.post(`/admin/users/${userId}/people`, f);
      toast.success(person ? 'Pessoa atualizada.' : 'Pessoa adicionada.');
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
      size="lg"
      title={person ? `Editar ${person.name}` : 'Adicionar pessoa'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={() => (document.getElementById('person-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
        </>
      }
    >
      <form id="person-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose sm:col-span-2">{error}</div>}
        <Input containerClassName="sm:col-span-2" label="Nome" required maxLength={120} value={f.name} onChange={set('name')} />
        <Select label="Sexo" value={f.gender} onChange={set('gender')}>
          <option value="">Não informado</option>
          <option value="Feminino">Feminino</option>
          <option value="Masculino">Masculino</option>
        </Select>
        <Input label="Data de nascimento" type="date" min="1900-01-01" max={todayStr()} value={f.birth_date} onChange={set('birth_date')} />
        <Input label="E-mail" type="email" maxLength={160} value={f.email} onChange={set('email')} />
        <Input label="Cargo / função" maxLength={80} value={f.role} onChange={set('role')} />
        <Input label="Telefone / WhatsApp" maxLength={30} value={f.phone} onChange={set('phone')} />
        <Input label="Outro telefone" maxLength={30} value={f.phone2} onChange={set('phone2')} />
        <Input label="CPF" maxLength={14} inputMode="numeric" value={f.cpf} onChange={set('cpf')} />
        <Input label="RG" maxLength={20} value={f.rg} onChange={set('rg')} />
        <div className="flex flex-col gap-4 sm:col-span-2">
          <Switch checked={f.is_primary} onChange={(v) => setF({ ...f, is_primary: v })} label="Pessoa principal" description="Só uma por cliente. É a pessoa de contato do cadastro." />
          <Switch checked={f.signs_contract} onChange={(v) => setF({ ...f, signs_contract: v })} label="Assina o contrato" />
          <Switch checked={f.guarantor} onChange={(v) => setF({ ...f, guarantor: v })} label="Fiador" />
          <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Pessoa ativa" />
        </div>
      </form>
    </Modal>
  );
}
