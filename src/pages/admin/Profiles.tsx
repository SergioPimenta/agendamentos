import { useState, type FormEvent } from 'react';
import { Lock, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, SearchInput, Select } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { Avatar, DataTable, PageHeader, Td, Th } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { useApi, useDebounced } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { api } from '../../services/api';
import type { AccessLevel, AccessModule, AccessProfile, ModuleKey, Permissions, ProfileUser } from '../../types';

const LEVEL_LABEL: Record<AccessLevel, string> = { none: 'Sem acesso', view: 'Ver', edit: 'Editar' };
const LEVEL_ORDER: AccessLevel[] = ['none', 'view', 'edit'];

interface ProfilesPayload { profiles: AccessProfile[]; modules: AccessModule[] }

const summarize = (p: Permissions) => {
  const levels = Object.values(p);
  return { edit: levels.filter((l) => l === 'edit').length, view: levels.filter((l) => l === 'view').length };
};

export default function AdminProfiles() {
  const toast = useToast();
  const { user: me, can } = useAuth();
  const canEdit = can('profiles', 'edit');
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ profile?: AccessProfile } | null>(null);
  const [savingUser, setSavingUser] = useState<number | null>(null);

  const profiles = useApi(() => api.get<ProfilesPayload>('/admin/profiles'), []);
  const users = useApi(() => api.get<{ users: ProfileUser[] }>('/admin/profiles-users', { q, profile_id: filter }), [q, filter]);

  const changeProfile = async (u: ProfileUser, value: string) => {
    setSavingUser(u.id);
    try {
      await api.put(`/admin/profiles-users/${u.id}`, { profile_id: value ? Number(value) : null });
      toast.success(value ? `${u.name} agora tem o perfil escolhido.` : `${u.name} deixou de ter acesso ao painel.`);
      users.reload();
      profiles.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível alterar o perfil.');
    } finally {
      setSavingUser(null);
    }
  };

  const list = profiles.data?.profiles ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Perfis de usuário"
        description="Defina o que cada perfil pode ver e alterar no painel administrativo e escolha o perfil de cada pessoa."
        actions={canEdit && <Button icon={<Plus size={16} />} onClick={() => setEditing({})}>Novo perfil</Button>}
      />

      {profiles.error && <ErrorState message={profiles.error} onRetry={profiles.refetch} />}
      <div className="mb-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {!profiles.data ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[190px] rounded-[24px]" />) : list.map((p) => {
          const s = summarize(p.permissions);
          return (
            <article key={p.id} className="flex flex-col rounded-[24px] border border-ink/8 bg-cream p-6">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-[20px] font-medium text-ink">{p.name}</h2>
                {p.is_system && <Badge tone="ink"><Lock size={11} />Fixo</Badge>}
              </div>
              <p className="mt-1.5 min-h-[40px] text-[13px] leading-snug text-stone">{p.description || 'Sem descrição.'}</p>
              <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-stone">
                <li className="flex items-center gap-2"><ShieldCheck size={15} className="text-sage-700" />{s.edit} área{s.edit === 1 ? '' : 's'} com edição · {s.view} só consulta</li>
                <li className="flex items-center gap-2"><Users size={15} className="text-sage-700" />{p.users_count} usuário{p.users_count === 1 ? '' : 's'}</li>
              </ul>
              <Button className="mt-5" variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing({ profile: p })}>
                {canEdit && !p.is_system ? 'Editar acessos' : 'Ver acessos'}
              </Button>
            </article>
          );
        })}
      </div>

      <h2 className="mb-1 font-display text-[22px] font-medium text-ink">Perfil de cada usuário</h2>
      <p className="mb-5 text-[13.5px] text-stone">
        Escolha o perfil para dar acesso ao painel. Quem fica em “Sem acesso ao painel” usa só a área do cliente.
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-[1.6fr_1fr]">
        <SearchInput placeholder="Buscar por nome ou e-mail…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar usuário" />
        <Select aria-label="Filtrar por perfil" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os perfis</option>
          <option value="none">Sem acesso ao painel</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>

      {users.error && <ErrorState message={users.error} onRetry={users.refetch} />}
      {!users.data ? <Skeleton className="h-[280px] rounded-[22px]" /> : users.data.users.length === 0 ? (
        <div className="rounded-[22px] border border-ink/8 bg-cream"><EmptyState icon={<Users />} title="Nenhum usuário encontrado" /></div>
      ) : (
        <DataTable className={users.loading ? 'opacity-60' : ''}>
          <thead><tr><Th>Usuário</Th><Th>Acesso ao painel</Th><Th className="w-[300px]">Perfil</Th></tr></thead>
          <tbody>
            {users.data.users.map((u) => {
              const isMe = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size={36} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.name}{isMe && <span className="ml-1.5 text-[12px] font-normal text-stone">(você)</span>}</p>
                        <p className="truncate text-[12px] text-stone">{u.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{u.profile_id ? <Badge tone="sage">{u.profile_name}</Badge> : <Badge tone="mist">Somente cliente</Badge>}</Td>
                  <Td>
                    <Select
                      aria-label={`Perfil de ${u.name}`}
                      value={u.profile_id ?? ''}
                      disabled={!canEdit || isMe || savingUser === u.id}
                      onChange={(e) => changeProfile(u, e.target.value)}
                    >
                      <option value="">Sem acesso ao painel (cliente)</option>
                      {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                    {isMe && <p className="mt-1 text-[11.5px] text-stone-light">Você não pode alterar o próprio perfil.</p>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      <ProfileForm
        open={!!editing}
        profile={editing?.profile}
        modules={profiles.data?.modules ?? []}
        readOnly={!canEdit || !!editing?.profile?.is_system}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); profiles.reload(); users.reload(); }}
      />
    </>
  );
}

function LevelPicker({ value, onChange, disabled, label }: { value: AccessLevel; onChange: (l: AccessLevel) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-full border border-ink/10 bg-sand p-0.5">
      {LEVEL_ORDER.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          disabled={disabled}
          onClick={() => onChange(l)}
          className={cn(
            'rounded-full px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors duration-200',
            value === l ? (l === 'none' ? 'bg-ink/80 text-cream' : 'bg-sage-700 text-cream') : 'text-stone',
            !disabled && value !== l && 'hover:text-ink',
            disabled && 'cursor-default',
          )}
        >
          {LEVEL_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

function ProfileForm({ open, profile, modules, readOnly, onClose, onSaved }: {
  open: boolean; profile?: AccessProfile; modules: AccessModule[]; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const blank = { name: '', description: '', permissions: {} as Partial<Permissions> };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(-1);

  const key = open ? (profile?.id ?? 0) : -1;
  if (seed !== key) {
    setSeed(key);
    if (open) {
      setError('');
      setF(profile ? { name: profile.name, description: profile.description, permissions: { ...profile.permissions } } : blank);
    }
  }

  const level = (m: ModuleKey): AccessLevel => f.permissions[m] ?? 'none';
  const setLevel = (m: ModuleKey, l: AccessLevel) => setF((s) => ({ ...s, permissions: { ...s.permissions, [m]: l } }));
  const setAll = (l: AccessLevel) => setF((s) => ({ ...s, permissions: Object.fromEntries(modules.map((m) => [m.key, l])) as Permissions }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const permissions = Object.fromEntries(modules.map((m) => [m.key, level(m.key)]));
      const body = { name: f.name, description: f.description, permissions };
      if (profile) await api.put(`/admin/profiles/${profile.id}`, body);
      else await api.post('/admin/profiles', body);
      toast.success(profile ? 'Perfil atualizado.' : 'Perfil criado.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    if (!(await confirm({ title: `Excluir o perfil ${profile.name}?`, description: 'Só é possível excluir perfis sem usuários.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    try {
      await api.delete(`/admin/profiles/${profile.id}`);
      toast.success('Perfil excluído.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      size="lg"
      title={profile ? (readOnly ? profile.name : `Editar ${profile.name}`) : 'Novo perfil'}
      subtitle={profile?.is_system ? 'Perfil fixo: sempre tem acesso total e não pode ser alterado.' : undefined}
      footer={
        readOnly ? <Button variant="secondary" onClick={onClose}>Fechar</Button> : (
          <>
            {profile && <Button variant="danger" className="sm:mr-auto" icon={<Trash2 size={15} />} onClick={remove}>Excluir</Button>}
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button loading={saving} onClick={() => (document.getElementById('profile-form') as HTMLFormElement)?.requestSubmit()}>Salvar</Button>
          </>
        )
      }
    >
      <form id="profile-form" onSubmit={submit} className="flex flex-col gap-5">
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome do perfil" required disabled={readOnly} maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Descrição" disabled={readOnly} maxLength={200} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-[16px] font-medium text-ink">Acesso por área do painel</h3>
            {!readOnly && (
              <div className="flex items-center gap-1 text-[12px] text-stone">
                Marcar todas:
                {LEVEL_ORDER.map((l) => (
                  <button key={l} type="button" onClick={() => setAll(l)} className="rounded-full px-2.5 py-1 font-semibold text-sage-700 hover:bg-sage-dim">{LEVEL_LABEL[l]}</button>
                ))}
              </div>
            )}
          </div>
          <p className="mb-3 text-[12.5px] text-stone"><strong className="font-semibold text-ink">Ver</strong> só mostra as informações. <strong className="font-semibold text-ink">Editar</strong> também permite criar, alterar e excluir.</p>
          <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/8">
            {modules.map((m) => (
              <li key={m.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink">{m.label}</p>
                  <p className="text-[12px] leading-snug text-stone">{m.description}</p>
                </div>
                <LevelPicker label={`Acesso a ${m.label}`} value={profile?.is_system ? 'edit' : level(m.key)} disabled={readOnly} onChange={(l) => setLevel(m.key, l)} />
              </li>
            ))}
          </ul>
        </div>
      </form>
    </Modal>
  );
}
