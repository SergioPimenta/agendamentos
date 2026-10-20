import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';

export const inputClass =
  'w-full rounded-xl border border-ink/12 bg-cream px-4 py-3 text-[14px] text-ink outline-none transition-all duration-200 placeholder:text-stone-light hover:border-ink/25 focus:border-sage-700 focus:ring-4 focus:ring-sage/20 disabled:cursor-not-allowed disabled:bg-sand-deep/60 disabled:text-stone';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[12px] font-semibold tracking-wide text-ink">
          {label}
          {required && <span className="ml-0.5 text-clay">*</span>}
        </label>
      )}
      {children(id)}
      {error ? (
        <p role="alert" className="text-[12px] text-rose">{error}</p>
      ) : (
        hint && <p className="text-[12px] text-stone-light">{hint}</p>
      )}
    </div>
  );
}

type FieldExtras = Omit<FieldProps, 'children'>;

export function Input({ label, hint, error, required, className, containerClassName, ...rest }: InputHTMLAttributes<HTMLInputElement> & FieldExtras & { containerClassName?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {(id) => <input id={id} required={required} className={cn(inputClass, error && 'border-rose', className)} {...rest} />}
    </Field>
  );
}

export function Select({
  label, hint, error, required, className, containerClassName, children, ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & FieldExtras & { containerClassName?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {(id) => (
        <select
          id={id}
          required={required}
          className={cn(inputClass, 'appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236c6f62%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><path d=%27M6 9l6 6 6-6%27/></svg>")] bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10', error && 'border-rose', className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export function Textarea({ label, hint, error, required, className, containerClassName, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras & { containerClassName?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {(id) => <textarea id={id} required={required} rows={3} className={cn(inputClass, 'resize-y', error && 'border-rose', className)} {...rest} />}
    </Field>
  );
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search size={16} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-stone-light" />
      <input type="search" className={cn(inputClass, 'rounded-full py-2.5 pl-10')} {...rest} />
    </div>
  );
}

export function Switch({
  checked, onChange, label, description, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4', disabled && 'opacity-60')}>
      <span>
        <span className="block text-[13.5px] font-semibold text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] leading-snug text-stone">{description}</span>}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="block h-6 w-11 rounded-full bg-ink/15 transition-colors peer-checked:bg-sage-700 peer-focus-visible:ring-4 peer-focus-visible:ring-sage/30" />
        <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-cream shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
