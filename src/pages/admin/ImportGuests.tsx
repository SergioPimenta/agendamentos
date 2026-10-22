import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { parseCsv, toCsv } from '../../lib/csv';
import { api } from '../../services/api';

type Row = Record<string, unknown>;
interface Issue { line: number; name: string; reason: string }
interface Summary { total: number; created: number; skipped: Issue[]; errors: Issue[] }

const CHUNK = 100; // o servidor aceita até 300 por pedido
const HEADERS = ['codigo', 'unidade', 'codigo_cliente', 'cliente', 'anfitriao', 'nome', 'email', 'data_convite', 'inicio', 'fim', 'vinculado', 'cadastro'];

/** Envia as linhas em lotes e soma os resultados. As linhas são numeradas pela posição no arquivo. */
async function run(rows: Row[], dryRun: boolean, onProgress: (done: number) => void): Promise<Summary> {
  const sum: Summary = { total: 0, created: 0, skipped: [], errors: [] };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await api.post<Summary>('/admin/guests/import', { rows: rows.slice(i, i + CHUNK), dry_run: dryRun });
    sum.total += r.total;
    sum.created += r.created;
    sum.skipped.push(...r.skipped.map((s) => ({ ...s, line: s.line + i })));
    sum.errors.push(...r.errors.map((e) => ({ ...e, line: e.line + i })));
    onProgress(Math.min(i + CHUNK, rows.length));
  }
  return sum;
}

export function ImportGuestsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
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
      if (!parsed.some((r) => r && typeof r === 'object' && 'email' in r)) throw new Error('Não encontrei a coluna "email". Use o modelo de planilha.');
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
      toast.success(`${r.created} convidado${r.created === 1 ? '' : 's'} importado${r.created === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A importação falhou.');
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = () => {
    const sample = ['192', 'Coworking Harmonize o Ser', '30', 'Fabiane Zoraia Tribess', 'Fabiane Zoraia Tribess', 'Franciele Loch', 'franciele@exemplo.com', '2026-11-09', '14:00', '17:00', 'Sim', '2026-10-01 19:49:00'];
    const url = URL.createObjectURL(new Blob([toCsv(HEADERS, [sample])], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-importacao-convidados.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = result ?? preview;

  return (
    <Modal
      open={open}
      onClose={close}
      locked={!!busy}
      size="lg"
      title="Importar convidados"
      subtitle="Traga os convidados do sistema anterior por planilha (CSV) ou arquivo JSON."
      footer={
        result ? <Button onClick={close}>Concluir</Button> : (
          <>
            <Button variant="secondary" onClick={close} disabled={!!busy}>Cancelar</Button>
            <Button icon={<Upload size={16} />} loading={busy === 'import'} disabled={!!busy || !preview || preview.created === 0} onClick={importNow}>
              {preview && preview.created > 0 ? `Importar ${preview.created} convidado${preview.created === 1 ? '' : 's'}` : 'Nada a importar'}
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
                <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" id="import-guests-file" onChange={(e) => pick(e.target.files?.[0])} disabled={!!busy} />
                <label htmlFor="import-guests-file" className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-sage-700 px-5 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-sage-900">
                  <FileUp size={16} />Escolher arquivo
                </label>
                <span className="text-[13px] text-stone">{fileName || 'Nenhum arquivo escolhido'}</span>
                <Button variant="ghost" size="sm" className="ml-auto" icon={<Download size={14} />} onClick={downloadTemplate}>Baixar modelo</Button>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-stone">
                Colunas: {HEADERS.join(', ')}. O cliente é ligado pelo <code className="text-[12px]">codigo_cliente</code> (número do cadastro no sistema anterior).
                Quem já foi importado (mesmo <code className="text-[12px]">codigo</code>) é pulado, então dá para repetir sem duplicar.
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
                [result ? 'Importados' : 'Serão importados', shown.created, 'text-sage-700'],
                ['Pulados', shown.skipped.length, 'text-stone'],
                ['Com problema', shown.errors.length, shown.errors.length ? 'text-rose' : 'text-stone'],
              ].map(([label, n, tone]) => (
                <div key={String(label)} className="rounded-2xl bg-sand px-5 py-4">
                  <p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">{label}</p>
                  <p className={`mt-1 font-display text-[28px] leading-none font-medium ${tone}`}>{n}</p>
                </div>
              ))}
            </div>
            {result && <p className="flex items-center gap-2 text-[13.5px] text-sage-700"><CheckCircle2 size={16} />Pronto. Os convidados já aparecem na lista.</p>}
            {shown.errors.length > 0 && <IssueList title="Linhas com problema (não serão importadas)" icon={<AlertTriangle size={15} className="text-rose" />} items={shown.errors} />}
            {shown.skipped.length > 0 && <IssueList title="Pulados" items={shown.skipped} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

function IssueList({ title, items, icon }: { title: string; items: Issue[]; icon?: React.ReactNode }) {
  return (
    <details className="rounded-2xl border border-ink/8 bg-cream">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-[13.5px] font-semibold text-ink">{icon}{title} ({items.length})</summary>
      <ul className="max-h-[200px] divide-y divide-ink/8 overflow-y-auto border-t border-ink/8 text-[12.5px]">
        {items.map((i, k) => (
          <li key={k} className="flex flex-wrap justify-between gap-x-4 px-4 py-2">
            <span className="font-medium text-ink">Linha {i.line + 1} · {i.name || '—'}</span>
            <span className="text-stone">{i.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
