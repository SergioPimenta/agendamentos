import { useEffect, useState } from 'react';
import { Plus, UserPlus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Guest } from '../../types';
import { Button } from '../ui/Button';

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Linhas preenchidas, com o e-mail em minúsculas. Linha totalmente vazia é descartada. */
export const cleanGuests = (list: Guest[]): Guest[] =>
  list.filter((g) => g.name.trim() || g.email.trim()).map((g) => ({ name: g.name.trim(), email: g.email.trim().toLowerCase() }));

/** Primeiro problema da lista (e-mail faltando ou inválido, repetido ou o do próprio dono), ou '' se está tudo certo. */
export function guestsError(list: Guest[], ownerEmail?: string): string {
  const seen = new Set<string>();
  for (const [i, g] of cleanGuests(list).entries()) {
    const label = `Convidado ${i + 1}`;
    if (!g.email) return `${label}: informe o e-mail.`;
    if (!EMAIL.test(g.email)) return `${label}: e-mail inválido.`;
    if (g.email === ownerEmail?.toLowerCase()) return `${label}: esse é o seu e-mail.`;
    if (seen.has(g.email)) return `${label}: e-mail repetido.`;
    seen.add(g.email);
  }
  return '';
}

interface Props {
  value: Guest[];
  onChange: (guests: Guest[]) => void;
  /** E-mail de quem está reservando (não faz sentido convidar a si mesmo). */
  ownerEmail?: string;
  max?: number;
}

const inputClass = (bad: boolean) =>
  cn('min-w-0 w-full rounded-xl border bg-cream px-3.5 py-2.5 text-[14px] text-ink outline-none transition-all placeholder:text-stone-light focus:border-sage-700 focus:ring-4 focus:ring-sage/20', bad ? 'border-rose' : 'border-ink/12');

/** "Convidar pessoas": uma linha por convidado, com nome e e-mail. */
export function GuestsField({ value, onChange, ownerEmail, max = 10 }: Props) {
  const [open, setOpen] = useState(value.length > 0);
  // Linhas que já perderam o foco: só elas mostram erro (não ralha enquanto a pessoa ainda está digitando).
  const [touched, setTouched] = useState<Set<number>>(new Set());

  // Se a lista vier preenchida de fora (ex.: editar uma reserva), mantém o campo aberto.
  useEffect(() => {
    if (value.length > 0) setOpen(true);
  }, [value.length]);

  const update = (i: number, patch: Partial<Guest>) => onChange(value.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const touch = (i: number) => setTouched((s) => new Set(s).add(i));
  const add = () => onChange([...value, { name: '', email: '' }]);
  const remove = (i: number) => {
    onChange(value.filter((_, k) => k !== i));
    setTouched(new Set());
  };

  const emailProblem = (g: Guest, i: number) => {
    const e = g.email.trim().toLowerCase();
    if (!touched.has(i) && !e) return '';
    if (!e) return g.name.trim() ? 'Informe o e-mail.' : '';
    if (!EMAIL.test(e)) return 'E-mail inválido.';
    if (e === ownerEmail?.toLowerCase()) return 'Esse é o seu e-mail.';
    if (value.some((o, k) => k < i && o.email.trim().toLowerCase() === e)) return 'E-mail repetido.';
    return '';
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); if (!value.length) add(); }}
        className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-dashed border-sage-700/50 px-4 py-2 text-[13px] font-semibold text-sage-700 transition-colors hover:bg-sage-dim"
      >
        <UserPlus size={16} />Convidar pessoas
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-sand/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ink"><UserPlus size={15} className="text-sage-700" />Convidar pessoas</p>
        {cleanGuests(value).length === 0 && (
          <button type="button" onClick={() => { setOpen(false); onChange([]); setTouched(new Set()); }} className="cursor-pointer text-[12px] font-medium text-stone hover:text-ink">Fechar</button>
        )}
      </div>

      <ul className="flex flex-col gap-3" aria-label="Convidados">
        {value.map((g, i) => {
          const problem = emailProblem(g, i);
          return (
            <li key={i} className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  value={g.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Nome do convidado"
                  aria-label={`Nome do convidado ${i + 1}`}
                  className={inputClass(false)}
                />
                <div className="min-w-0">
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    maxLength={160}
                    value={g.email}
                    onChange={(e) => update(i, { email: e.target.value })}
                    onBlur={() => touch(i)}
                    placeholder="E-mail do convidado"
                    aria-label={`E-mail do convidado ${i + 1}`}
                    aria-invalid={!!problem}
                    className={inputClass(!!problem)}
                  />
                  {problem && <p role="alert" className="mt-1 text-[12px] text-rose">{problem}</p>}
                </div>
              </div>
              <button type="button" aria-label={`Remover convidado ${i + 1}`} onClick={() => remove(i)} className="mt-1.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone hover:bg-rose-dim hover:text-rose"><X size={16} /></button>
            </li>
          );
        })}
      </ul>

      <Button type="button" variant="soft" size="sm" className="w-fit" icon={<Plus size={14} />} disabled={value.length >= max} onClick={add}>
        {value.length >= max ? `Limite de ${max} convidados` : 'Adicionar convidado'}
      </Button>
      <p className="text-[12px] leading-snug text-stone-light">
        Cada convidado recebe um e-mail com os dados da reserva e o evento para o calendário quando a reserva for confirmada.
      </p>
    </div>
  );
}
