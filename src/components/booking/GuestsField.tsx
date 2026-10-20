import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Mail, UserPlus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

interface Props {
  value: string[];
  onChange: (emails: string[]) => void;
  /** E-mail de quem está reservando (não faz sentido convidar a si mesmo). */
  ownerEmail?: string;
  max?: number;
}

/** "Convidar pessoas": botão que abre um campo de e-mails (um por vez ou vários colados), mostrados como etiquetas. */
export function GuestsField({ value, onChange, ownerEmail, max = 10 }: Props) {
  const [open, setOpen] = useState(value.length > 0);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // Se a lista vier preenchida de fora (ex.: editar uma reserva), mantém o campo aberto.
  useEffect(() => {
    if (value.length > 0) setOpen(true);
  }, [value.length]);

  /** Aceita vários e-mails separados por vírgula, ponto e vírgula, espaço ou quebra de linha. */
  const commit = (raw: string) => {
    const tokens = raw.split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return;
    const next = [...value];
    const bad: string[] = [];
    let full = false;
    for (const t of tokens) {
      if (!EMAIL.test(t)) bad.push(t);
      else if (t === ownerEmail?.toLowerCase() || next.includes(t)) continue; // já está na lista (ou é você)
      else if (next.length >= max) full = true;
      else next.push(t);
    }
    onChange(next);
    setText(bad.join(' '));
    setError(bad.length ? `E-mail inválido: ${bad.slice(0, 2).join(', ')}` : full ? `No máximo ${max} convidados por reserva.` : '');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';'].includes(e.key) || (e.key === ' ' && text.trim())) {
      e.preventDefault();
      commit(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (/[\s,;]/.test(pasted.trim())) {
      e.preventDefault();
      commit(`${text} ${pasted}`);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 30); }}
        className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-dashed border-sage-700/50 px-4 py-2 text-[13px] font-semibold text-sage-700 transition-colors hover:bg-sage-dim"
      >
        <UserPlus size={16} />Convidar pessoas
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-ink/10 bg-sand/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ink"><UserPlus size={15} className="text-sage-700" />Convidar pessoas</p>
        {value.length === 0 && (
          <button type="button" onClick={() => { setOpen(false); setText(''); setError(''); }} className="cursor-pointer text-[12px] font-medium text-stone hover:text-ink">Fechar</button>
        )}
      </div>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Convidados">
          {value.map((g) => (
            <li key={g} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-sage-700/25 bg-cream py-1 pr-1.5 pl-3 text-[12.5px] text-ink">
              <Mail size={12} className="shrink-0 text-sage-700" />
              <span className="truncate">{g}</span>
              <button type="button" aria-label={`Remover ${g}`} onClick={() => onChange(value.filter((x) => x !== g))} className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone hover:bg-rose-dim hover:text-rose"><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          ref={input}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={text}
          onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => text.trim() && commit(text)}
          disabled={value.length >= max}
          placeholder={value.length >= max ? `Limite de ${max} convidados` : 'E-mail do convidado'}
          aria-label="E-mail do convidado"
          aria-invalid={!!error}
          className={cn('min-w-0 flex-1 rounded-xl border bg-cream px-3.5 py-2.5 text-[14px] text-ink outline-none transition-all placeholder:text-stone-light focus:border-sage-700 focus:ring-4 focus:ring-sage/20 disabled:bg-sand-deep/60', error ? 'border-rose' : 'border-ink/12')}
        />
        <Button type="button" variant="soft" size="sm" disabled={!text.trim() || value.length >= max} onClick={() => commit(text)}>Adicionar</Button>
      </div>
      {error && <p role="alert" className="text-[12px] text-rose">{error}</p>}
      <p className="text-[12px] leading-snug text-stone-light">
        Elas recebem um e-mail com os dados da reserva e o evento para o calendário quando a reserva for confirmada. Cole vários e-mails de uma vez, se preferir.
      </p>
    </div>
  );
}
