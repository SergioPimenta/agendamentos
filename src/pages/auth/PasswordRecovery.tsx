import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input, PasswordInput } from '../../components/ui/Form';
import { useToast } from '../../components/ui/Feedback';
import { passwordError } from '../../lib/password';
import { api } from '../../services/api';
import { AuthLayout } from './AuthLayout';

const backLink = (
  <Link to="/login" className="font-semibold text-sage-700 no-underline hover:underline">
    Voltar para o login
  </Link>
);

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Confira seu e-mail" subtitle="Se houver uma conta com esse endereço, enviamos um link para criar uma nova senha. Ele vale por 1 hora." footer={backLink}>
        <div className="flex items-center gap-4 rounded-2xl bg-sage-dim p-5 text-[13.5px] text-sage-800">
          <MailCheck size={28} className="shrink-0 text-sage-700" />
          Não chegou? Veja a caixa de spam ou peça um novo link.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Esqueceu a senha?" subtitle="Informe seu e-mail e enviaremos um link para você criar uma nova." footer={backLink}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">{error}</div>}
        <Input label="E-mail" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" size="lg" loading={loading} className="w-full">Enviar link</Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const pwError = passwordError(password);
    if (pwError) return setError(pwError);
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.success('Senha redefinida! Entre com a nova senha.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Crie uma nova senha" subtitle="Escolha uma senha com pelo menos 8 caracteres, uma letra e um número." footer={backLink}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">{error}</div>}
        <PasswordInput label="Nova senha" required autoFocus autoComplete="new-password" showRules value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" size="lg" loading={loading} disabled={!token} className="w-full">Salvar nova senha</Button>
      </form>
    </AuthLayout>
  );
}
