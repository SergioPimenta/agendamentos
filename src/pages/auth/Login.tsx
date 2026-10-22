import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Form';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import type { User } from '../../types';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  const { user, login, settings } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={from ?? (user.role === 'admin' ? '/admin' : '/app')} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
      login(res.token, res.user);
      navigate(from ?? (res.user.role === 'admin' ? '/admin' : '/app'), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Bem-vindo(a) de volta"
      subtitle={from ? 'Entre para concluir a sua reserva. O horário que você escolheu fica guardado.' : 'Entre com seu e-mail e senha para reservar salas e acompanhar seu consumo.'}
      footer={
        settings?.allow_signup !== false && (
          <>
            Ainda não é cliente?{' '}
            <Link to="/cadastro" state={location.state} className="font-semibold text-sage-700 no-underline hover:underline">
              Cadastre-se aqui
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">
            {error}
          </div>
        )}
        <Input label="E-mail" type="email" required autoComplete="email" autoFocus placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Input label="Senha" type={show ? 'text' : 'password'} required autoComplete="current-password" placeholder="Sua senha" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-12" />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
              className="absolute right-3 bottom-[11px] rounded-full p-1.5 text-stone hover:text-ink"
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <Link to="/esqueci-senha" className="self-end text-[12.5px] font-medium text-stone no-underline hover:text-sage-700">
            Esqueceu sua senha?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Entrar <ArrowRight size={16} />
        </Button>
        <div className="flex items-center gap-3 text-[12px] text-stone-light before:h-px before:flex-1 before:bg-ink/10 after:h-px after:flex-1 after:bg-ink/10">ou</div>
        <Link
          to="/primeiro-acesso"
          state={location.state}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-sage-700/40 px-6 py-3 text-[14px] font-semibold text-sage-700 no-underline transition-colors hover:bg-sage-dim"
        >
          Primeiro login
        </Link>
        <p className="-mt-2 text-center text-[12.5px] text-stone">Já era cliente do sistema anterior? Entre com um código enviado ao seu e-mail.</p>
      </form>
    </AuthLayout>
  );
}
