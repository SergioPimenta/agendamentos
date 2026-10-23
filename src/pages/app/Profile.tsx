import { useRef, useState, type FormEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input, PasswordInput } from '../../components/ui/Form';
import { useToast } from '../../components/ui/Feedback';
import { Avatar, Card, CardHeader, PageHeader } from '../../components/ui/Misc';
import { useAuth } from '../../contexts/AuthContext';
import { todayStr } from '../../lib/format';
import { squarePhoto } from '../../lib/image';
import { passwordError } from '../../lib/password';
import { api } from '../../services/api';
import type { User } from '../../types';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', company: user?.company ?? '', document: user?.document ?? '', birth_date: user?.birth_date ?? '' });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState<'send' | 'remove' | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put<{ user: User }>('/auth/me', form);
      setUser(res.user);
      toast.success('Perfil atualizado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const sendPhoto = async (picked: File | undefined) => {
    if (photoInput.current) photoInput.current.value = '';
    if (!picked) return;
    setPhotoBusy('send');
    try {
      const res = await api.upload<{ user: User }>('/auth/me/avatar', await squarePhoto(picked));
      setUser(res.user);
      toast.success('Foto de perfil atualizada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a foto.');
    } finally {
      setPhotoBusy(null);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy('remove');
    try {
      const res = await api.delete<{ user: User }>('/auth/me/avatar');
      setUser(res.user);
      toast.success('Foto removida.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível remover a foto.');
    } finally {
      setPhotoBusy(null);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    const invalid = passwordError(pw.new_password);
    if (invalid) return setPwError(invalid);
    setPwSaving(true);
    try {
      await api.put('/auth/password', pw);
      setPw({ current_password: '', new_password: '' });
      toast.success('Senha alterada.');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Conta" title="Meu perfil" description="Mantenha seus dados atualizados para que a recepção consiga falar com você." />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-4">
            <Avatar name={user?.name ?? ''} src={user?.avatar} size={84} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[20px] font-medium text-ink">{user?.name}</p>
              <p className="text-[13px] text-stone">{user?.email}{user?.plan ? ` · Plano ${user.plan.name}` : ''}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Escolher foto de perfil" onChange={(e) => sendPhoto(e.target.files?.[0])} />
                <Button type="button" variant="secondary" size="sm" icon={<Camera size={15} />} loading={photoBusy === 'send'} disabled={photoBusy !== null} onClick={() => photoInput.current?.click()}>
                  {user?.avatar ? 'Trocar foto' : 'Enviar foto'}
                </Button>
                {user?.avatar && (
                  <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={15} />} loading={photoBusy === 'remove'} disabled={photoBusy !== null} onClick={removePhoto}>Remover</Button>
                )}
              </div>
              <p className="mt-2 text-[12px] text-stone-light">JPG, PNG ou WebP. A foto é recortada em quadrado automaticamente.</p>
            </div>
          </div>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Input containerClassName="sm:col-span-2" label="Nome completo" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Telefone / WhatsApp" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Empresa ou profissão" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <Input label="CPF / CNPJ" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} hint="Usado para emissão de notas, se necessário." />
            <Input label="Data de nascimento" type="date" min="1900-01-01" max={todayStr()} value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} hint="Para a gente te desejar um feliz aniversário." />
            <Input label="E-mail" value={user?.email ?? ''} disabled hint="Para trocar o e-mail, fale com a recepção." />
            <div className="sm:col-span-2"><Button type="submit" loading={saving}>Salvar alterações</Button></div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Alterar senha" />
          <form onSubmit={changePassword} className="flex flex-col gap-4">
            {pwError && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{pwError}</div>}
            <PasswordInput label="Senha atual" autoComplete="current-password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
            <PasswordInput label="Nova senha" autoComplete="new-password" required showRules value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            <Button type="submit" variant="secondary" loading={pwSaving}>Atualizar senha</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
