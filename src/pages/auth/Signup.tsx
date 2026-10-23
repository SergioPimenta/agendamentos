import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input, PasswordInput, Select } from '../../components/ui/Form';
import { useAuth } from '../../contexts/AuthContext';
import { ACTIVITY_AREAS, areaValue, detailMax } from '../../lib/activityAreas';
import { todayStr } from '../../lib/format';
import { maskCnpj, maskCpf, maskPhone, maskRg, maskUf, onlyDigits } from '../../lib/masks';
import { passwordError } from '../../lib/password';
import { api } from '../../services/api';
import type { User } from '../../types';
import { AuthLayout } from './AuthLayout';

type Kind = 'individual' | 'company';

const blank = {
  kind: 'individual' as Kind,
  name: '', company: '', document: '', phone: '', city: '', state: '',
  email: '', password: '',
  // Pessoa física: é a própria pessoa. Empresa: o responsável.
  p_name: '', p_gender: '', p_birth: '', p_cpf: '', p_rg: '', p_role: '', p_area: '', p_area_detail: '', p_email: '', p_phone: '', p_phone2: '',
};

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-4 border-t border-ink/8 pt-5 first:border-0 first:pt-0">
    <div>
      <h2 className="font-display text-[16px] font-medium text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-stone">{hint}</p>}
    </div>
    {children}
  </section>
);

export default function Signup() {
  const { user, login, settings } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={from ?? '/app'} replace />;

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const company = form.kind === 'company';
  const setMask = (k: keyof typeof blank, fn: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: fn(e.target.value) }));
  const area = ACTIVITY_AREAS.find((a) => a.label === form.p_area);

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
    const pwError = passwordError(form.password);
    if (pwError) return setError(pwError);
    if (!company && area?.ask && !form.p_area_detail.trim()) return setError(`Especifique ${area.ask} da sua área de atuação.`);
    setLoading(true);
    try {
      const body = {
        kind: form.kind,
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone,
        company: form.company,
        document: onlyDigits(form.document),
        city: form.city,
        state: form.state,
        person: {
          name: company ? form.p_name : form.name,
          gender: form.p_gender,
          birth_date: form.p_birth,
          cpf: onlyDigits(company ? form.p_cpf : form.document),
          rg: form.p_rg,
          role: company ? form.p_role : areaValue(form.p_area, form.p_area_detail),
          email: company ? form.p_email : form.email,
          phone: company ? form.p_phone : form.phone,
          phone2: form.p_phone2,
          signs_contract: true,
        },
      };
      const res = await api.post<{ token: string; user: User }>('/auth/register', body);
      login(res.token, res.user);
      navigate(from ?? '/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a conta.');
    } finally {
      setLoading(false);
    }
  };

  const personFields = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Sexo" value={form.p_gender} onChange={set('p_gender')}>
          <option value="">Prefiro não informar</option>
          <option value="Feminino">Feminino</option>
          <option value="Masculino">Masculino</option>
        </Select>
        <Input label="Data de nascimento" type="date" min="1900-01-01" max={todayStr()} autoComplete="bday" value={form.p_birth} onChange={set('p_birth')} />
        {company && <Input label="CPF do responsável" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" value={form.p_cpf} onChange={setMask('p_cpf', maskCpf)} />}
        <Input label="RG" maxLength={20} placeholder="00.000.000-0" value={form.p_rg} onChange={setMask('p_rg', maskRg)} />
        {company ? (
          <Input label="Cargo / função" maxLength={80} placeholder="Ex.: Sócia, Diretor, Gerente" value={form.p_role} onChange={set('p_role')} />
        ) : (
          <>
            <Select label="Área de atuação" value={form.p_area} onChange={(e) => setForm((f) => ({ ...f, p_area: e.target.value, p_area_detail: '' }))}>
              <option value="">Selecione sua área…</option>
              {ACTIVITY_AREAS.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}
            </Select>
            {area?.ask && (
              <Input
                containerClassName="sm:col-span-2"
                label={`Especifique ${area.ask}`}
                required
                autoFocus
                maxLength={detailMax(area)}
                placeholder="Descreva em poucas palavras"
                value={form.p_area_detail}
                onChange={set('p_area_detail')}
              />
            )}
          </>
        )}
        {company && <Input label="E-mail do responsável" type="email" autoComplete="email" placeholder="responsavel@empresa.com.br" hint="Se for diferente do e-mail de acesso." value={form.p_email} onChange={set('p_email')} />}
        {company && <Input label="Telefone do responsável" type="tel" inputMode="tel" maxLength={15} placeholder="(41) 99999-9999" value={form.p_phone} onChange={setMask('p_phone', maskPhone)} />}
        <Input label="Outro telefone" type="tel" inputMode="tel" maxLength={15} placeholder="(41) 3333-3333" value={form.p_phone2} onChange={setMask('p_phone2', maskPhone)} />
      </div>
    </>
  );

  return (
    <AuthLayout
      title="Crie seu acesso"
      subtitle={from ? 'Preencha o cadastro uma vez. Depois você volta direto para a reserva que estava fazendo.' : 'Preencha o cadastro uma vez. Depois é só escolher a sala e o horário.'}
      footer={<>Já tem conta? <Link to="/login" state={location.state} className="font-semibold text-sage-700 no-underline hover:underline">Entrar</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13.5px] text-rose">{error}</div>}

        <Section title="Tipo de cadastro">
          <Select label="Você vai reservar como" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Kind, document: '' }))}>
            <option value="individual">Pessoa física</option>
            <option value="company">Empresa (CNPJ)</option>
          </Select>
        </Section>

        <Section title={company ? 'Dados da empresa' : 'Seus dados'}>
          <Input label={company ? 'Razão social' : 'Nome completo'} required autoComplete={company ? 'organization' : 'name'} autoFocus placeholder={company ? 'Nome da empresa Ltda' : 'Maria da Silva'} value={form.name} onChange={set('name')} />
          {company && <Input label="Nome fantasia" placeholder="Como a empresa é conhecida" value={form.company} onChange={set('company')} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={company ? 'CNPJ' : 'CPF'} required inputMode="numeric" maxLength={company ? 18 : 14} placeholder={company ? '00.000.000/0000-00' : '000.000.000-00'} value={form.document} onChange={setMask('document', company ? maskCnpj : maskCpf)} />
            <Input label={company ? 'Telefone da empresa' : 'Telefone / WhatsApp'} type="tel" required autoComplete="tel" inputMode="tel" maxLength={15} placeholder="(41) 99999-9999" value={form.phone} onChange={setMask('phone', maskPhone)} />
            <Input label="Cidade" autoComplete="address-level2" maxLength={80} placeholder="Curitiba" value={form.city} onChange={set('city')} />
            <Input label="UF" autoComplete="address-level1" maxLength={2} placeholder="PR" value={form.state} onChange={setMask('state', maskUf)} />
          </div>
          {!company && <Input label="Nome do seu negócio" placeholder="Ex.: Studio Bem-Estar" hint="Opcional. Empresa, consultório, estúdio…" value={form.company} onChange={set('company')} />}
        </Section>

        {company ? (
          <Section title="Responsável pela empresa" hint="Quem assina o contrato e fala pela empresa.">
            <Input label="Nome do responsável" required autoComplete="name" placeholder="Nome completo do responsável" value={form.p_name} onChange={set('p_name')} />
            {personFields}
          </Section>
        ) : (
          <Section title="Mais sobre você">{personFields}</Section>
        )}

        <Section title="Acesso ao sistema">
          <Input label="E-mail" type="email" required autoComplete="email" placeholder="voce@email.com" value={form.email} onChange={set('email')} />
          <PasswordInput label="Senha" required autoComplete="new-password" placeholder="Crie uma senha" showRules value={form.password} onChange={set('password')} />
        </Section>

        <Button type="submit" size="lg" loading={loading} className="w-full">Criar conta</Button>
      </form>
    </AuthLayout>
  );
}
