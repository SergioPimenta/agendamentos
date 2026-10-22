import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Upload } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { parseCsv } from '../../lib/csv';
import { api } from '../../services/api';

type Row = Record<string, unknown>;
interface Issue { line: number; name: string; reason: string }
interface Summary { total: number; created: number; skipped: Issue[]; errors: Issue[]; missing_rooms: Record<string, number>; missing_clients: Record<string, number> }

const CHUNK = 250; // o servidor aceita até 300 por pedido

const empty = (): Summary => ({ total: 0, created: 0, skipped: [], errors: [], missing_rooms: {}, missing_clients: {} });
const addCounts = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n; };

/** Envia as linhas em lotes e soma os resultados. As linhas são numeradas pela posição no arquivo. */
async function run(rows: Row[], dryRun: boolean, onProgress: (done: number) => void): Promise<Summary> {
  const sum = empty();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await api.post<Summary>('/admin/bookings/import', { rows: rows.slice(i, i + CHUNK), dry_run: dryRun });
    sum.total += r.total;
    sum.created += r.created;
    sum.skipped.push(...r.skipped.map((s) => ({ ...s, line: s.line + i })));
    sum.errors.push(...r.errors.map((e) => ({ ...e, line: e.line + i })));
    addCounts(sum.missing_rooms, r.missing_rooms);
    addCounts(sum.missing_clients, r.missing_clients);
    onProgress(Math.min(i + CHUNK, rows.length));
  }
  return sum;
}

export function ImportBookingsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const reset = () => {
    setFileName(''); setRows([]); setPreview(null); setResult(null); setError(''); setProgress(0);
    if (input.current) input.current.value = '';
  };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const pick = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed: Row[] = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('O arquivo está vazio.');
      if (!parsed.some((r) => r && typeof r === 'object' && 'sala' in r && 'inicio' in r)) throw new Error('Não encontrei as colunas "sala" e "inicio". Use o arquivo gerado a partir do relatório de reservas.');
      setRows(parsed);
      setBusy('preview');
      setPreview(await run(parsed, true, setProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
      setRows([]);
    } finally {
      setBusy(null);
    }
  };

  const importNow = async () => {
    setBusy('import');
    setProgress(0);
    setError('');
    try {
      const r = await run(rows, false, setProgress);
      setResult(r);
      toast.success(`${r.created} reserva${r.created === 1 ? '' : 's'} importada${r.created === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A importação falhou.');
    } finally {
      setBusy(null);
    }
  };

  const shown = result ?? preview;
  const rooms = Object.entries(shown?.missing_rooms ?? {}).sort((a, b) => b[1] - a[1]);
  const clients = Object.entries(shown?.missing_clients ?? {}).sort((a, b) => b[1] - a[1]);
  const otherErrors = (shown?.errors ?? []).filter((e) => !/não cadastrad[ao]\.$/.test(e.reason));

  return (
    <Modal
      open={open}
      onClose={close}
      locked={!!busy}
      size="lg"
      title="Importar reservas"
      subtitle="Traga as reservas do sistema anterior, com sala, cliente, horário e cobrança."
      footer={
        result ? <Button onClick={close}>Concluir</Button> : (
          <>
            <Button variant="secondary" onClick={close} disabled={!!busy}>Cancelar</Button>
            <Button icon={<Upload size={16} />} loading={busy === 'import'} disabled={!!busy || !preview || preview.created === 0} onClick={importNow}>
              {preview && preview.created > 0 ? `Importar ${preview.created} reserva${preview.created === 1 ? '' : 's'}` : 'Nada a importar'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {!result && (
          <>
            <div className="rounded-2xl border border-dashed border-ink/20 bg-sand/50 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" id="import-bookings-file" onChange={(e) => pick(e.target.files?.[0])} disabled={!!busy} />
                <label htmlFor="import-bookings-file" className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-sage-700 px-5 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-sage-900">
                  <FileUp size={16} />Escolher arquivo
                </label>
                <span className="text-[13px] text-stone">{fileName || 'Nenhum arquivo escolhido'}</span>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-stone">
                As salas e os clientes precisam já estar cadastrados (o cliente é ligado pelo número do cadastro no sistema anterior).
                A importação não aplica as regras de agenda: o que já aconteceu ou foi combinado lá entra como está, e as reservas ativas passam a ocupar a agenda.
                Quem já foi importado (mesmo número de reserva) é pulado, então dá para repetir sem duplicar.
              </p>
            </div>
            {busy && <p className="text-[13px] text-stone" role="status">{busy === 'preview' ? 'Conferindo o arquivo…' : 'Importando…'} {progress}/{rows.length || '…'}</p>}
          </>
        )}

        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}

        {shown && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [result ? 'Importadas' : 'Serão importadas', shown.created, 'text-sage-700'],
                ['Puladas', shown.skipped.length, 'text-stone'],
                ['Com problema', shown.errors.length, shown.errors.length ? 'text-rose' : 'text-stone'],
              ].map(([label, n, tone]) => (
                <div key={String(label)} className="rounded-2xl bg-sand px-5 py-4">
                  <p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">{label}</p>
                  <p className={`mt-1 font-display text-[28px] leading-none font-medium ${tone}`}>{n}</p>
                </div>
              ))}
            </div>
            {result && <p className="flex items-center gap-2 text-[13.5px] text-sage-700"><CheckCircle2 size={16} />Pronto. As reservas já aparecem na lista e na agenda.</p>}

            {rooms.length > 0 && (
              <Group title="Salas que faltam cadastrar" hint="Cadastre em Salas (com o mesmo nome ou o primeiro termo dele) e importe de novo: as já importadas são puladas.">
                {rooms.map(([name, n]) => <Line key={name} label={name} n={n} />)}
              </Group>
            )}
            {clients.length > 0 && (
              <Group title="Clientes que faltam cadastrar" hint="Importe esses clientes em Clientes → Importar clientes e rode esta importação de novo.">
                {clients.map(([name, n]) => <Line key={name} label={name} n={n} />)}
              </Group>
            )}
            {otherErrors.length > 0 && <IssueList title="Outras linhas com problema" icon={<AlertTriangle size={15} className="text-rose" />} items={otherErrors} />}
            {shown.skipped.length > 0 && <IssueList title="Puladas" items={shown.skipped} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-rose/25 bg-rose-dim/40 px-4 py-3.5">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><AlertTriangle size={15} className="text-rose" />{title}</p>
      <p className="mt-0.5 text-[12.5px] text-stone">{hint}</p>
      <ul className="mt-2 max-h-[180px] divide-y divide-ink/8 overflow-y-auto text-[12.5px]">{children}</ul>
    </div>
  );
}

const Line = ({ label, n }: { label: string; n: number }) => (
  <li className="flex justify-between gap-4 py-1.5"><span className="font-medium text-ink">{label}</span><span className="shrink-0 text-stone">{n} reserva{n === 1 ? '' : 's'}</span></li>
);

function IssueList({ title, items, icon }: { title: string; items: Issue[]; icon?: React.ReactNode }) {
  return (
    <details className="rounded-2xl border border-ink/8 bg-cream">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-[13.5px] font-semibold text-ink">{icon}{title} ({items.length})</summary>
      <ul className="max-h-[200px] divide-y divide-ink/8 overflow-y-auto border-t border-ink/8 text-[12.5px]">
        {items.slice(0, 200).map((i, k) => (
          <li key={k} className="flex flex-wrap justify-between gap-x-4 px-4 py-2">
            <span className="font-medium text-ink">Linha {i.line + 1} · {i.name || '—'}</span>
            <span className="text-stone">{i.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
