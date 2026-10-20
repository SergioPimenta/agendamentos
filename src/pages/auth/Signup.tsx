import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Form';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import type { User } from '../../types';
import { AuthLayout } from './AuthLayout';

export default function Signup() {
  const { user, login, settings } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={from ?? '/app'} replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (settings && !settings.allow_signup) {
    return (
      <AuthLayout title="Cadastro fechado" subtitle="No momento novos cadastros são feitos pela recepção do harmonizeoser." footer={<Link to="/login" className="font-semibold text-sage-700 no-underline hover:underline">Voltar para o login</Link>}>
        <p className="text-[14px] text-stone">Fale com a gente pelo WhatsApp ou e-mail para criar seu acesso.</p>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('A senha precisa ter ao menos 8 caracteres.');
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: User }>('/auth/register', form);
      login(res.token, res.user);
      navigate(from ?? '/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Crie seu acesso"
      subtitle={from ? 'Leva menos de um minuto. Depois você volta direto para a reserva que estava fazendo.' : 'Leva menos de um minuto. Depois é só escolher a sala e o horário.'}
      footer={<>Já tem conta? <Link to="/login" state={location.state} className="font-semibold text-sage-700 no-underline hover:underline">Entrar</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">{error}</div>}
        <Input label="Nome completo" required autoComplete="name" autoFocus value={form.name} onChange={set('name')} />
        <Input label="E-mail" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Telefone / WhatsApp" type="tel" autoComplete="tel" placeholder="(41) 99999-9999" value={form.phone} onChange={set('phone')} />
          <Input label="Empresa ou profissão" value={form.company} onChange={set('company')} />
        </div>
        <Input label="Senha" type="password" required autoComplete="new-password" hint="Mínimo de 8 caracteres" value={form.password} onChange={set('password')} />
        <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">Criar conta</Button>
      </form>
    </AuthLayout>
  );
}
