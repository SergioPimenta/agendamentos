import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Form';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import type { User } from '../../types';
import { AuthLayout } from './AuthLayout';

type Step = 'email' | 'code' | 'password';
const RESEND_SECONDS = 60;

const Alert = ({ children }: { children: React.ReactNode }) => (
  <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">{children}</div>
);

/** Primeiro acesso de quem veio do sistema anterior: e-mail → código recebido por e-mail → define a senha. */
export default function FirstLogin() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // Já está dentro (e não está no meio de definir a senha): vai para o painel.
  if (user && step !== 'password') return <Navigate to={from ?? (user.role === 'admin' ? '/admin' : '/app')} replace />;

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError('');
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      await api.post('/auth/first-login/request', { email });
      setCode('');
      setStep('code');
      setWait(RESEND_SECONDS);
    }, 'Não foi possível enviar o código.');
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await api.post<{ token: string; user: User; set_password: boolean }>('/auth/first-login/verify', { email, code });
      setStep('password'); // antes do login, para a tela não redirecionar
      login(res.token, res.user);
    }, 'Código inválido.');
  };

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('A senha precisa ter ao menos 8 caracteres.');
    if (password !== confirm) return setError('As senhas não conferem.');
    return run(async () => {
      await api.post('/auth/first-login/password', { password });
      navigate(from ?? '/app', { replace: true });
    }, 'Não foi possível salvar a senha.');
  };

  const back = <>Já tem senha? <Link to="/login" state={location.state} className="font-semibold text-sage-700 no-underline hover:underline">Entrar</Link></>;

  if (step === 'password') {
    return (
      <AuthLayout title="Crie sua senha" subtitle="Você já está dentro. Defina uma senha para entrar nas próximas vezes com e-mail e senha.">
        <form onSubmit={savePassword} className="flex flex-col gap-5" noValidate>
          {error && <Alert>{error}</Alert>}
          <Input label="Nova senha" type="password" required autoComplete="new-password" autoFocus hint="Mínimo de 8 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Repita a senha" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button type="submit" size="lg" loading={loading} className="w-full">Salvar e continuar</Button>
        </form>
      </AuthLayout>
    );
  }

  if (step === 'code') {
    return (
      <AuthLayout title="Digite o código" subtitle={<>Se <strong className="font-semibold text-ink">{email}</strong> tiver um primeiro acesso pendente, enviamos um código de 6 números. Ele vale por 15 minutos.</>} footer={back}>
        <form onSubmit={verify} className="flex flex-col gap-5" noValidate>
          {error && <Alert>{error}</Alert>}
          <Input label="Código" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" size="lg" loading={loading} disabled={code.length !== 6} className="w-full">Entrar</Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-stone">
            <button type="button" className="cursor-pointer font-medium text-stone hover:text-sage-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={wait > 0 || loading} onClick={() => sendCode()}>
              {wait > 0 ? `Reenviar código em ${wait}s` : 'Reenviar código'}
            </button>
            <button type="button" className="cursor-pointer font-medium text-stone hover:text-sage-700" onClick={() => { setStep('email'); setError(''); }}>Trocar e-mail</button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Primeiro acesso"
      subtitle="Já era cliente do harmonizeoser? Informe o e-mail do seu cadastro e enviaremos um código para você entrar."
      footer={back}
    >
      <form onSubmit={sendCode} className="flex flex-col gap-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Input label="E-mail" type="email" required autoComplete="email" autoFocus placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" size="lg" loading={loading} disabled={!email.trim()} className="w-full">Enviar código</Button>
      </form>
    </AuthLayout>
  );
}
