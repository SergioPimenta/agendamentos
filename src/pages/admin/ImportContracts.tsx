import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { parseCsv, toCsv } from '../../lib/csv';
import { api } from '../../services/api';

type Row = Record<string, unknown>;
interface Issue { line: number; name: string; reason: string }
interface Summary { total: number; created: number; skipped: Issue[]; errors: Issue[]; missing_clients: Record<string, number> }

const CHUNK = 100; // o servidor aceita até 100 por pedido
const HEADERS = ['codigo_cliente', 'cliente', 'tipo', 'unidade', 'periodicidade', 'assinatura', 'inicio', 'fim', 'fidelidade_ate', 'valor_centavos', 'vencimento_dia', 'escritorio_privativo', 'cadastrado_por', 'ultimo_reajuste', 'indice_reajuste', 'ativo'];

async function run(rows: Row[], dryRun: boolean, onProgress: (done: number) => void): Promise<Summary> {
  const sum: Summary = { total: 0, created: 0, skipped: [], errors: [], missing_clients: {} };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await api.post<Summary>('/admin/contracts/import', { rows: rows.slice(i, i + CHUNK), dry_run: dryRun });
    sum.total += r.total;
    sum.created += r.created;
    sum.skipped.push(...r.skipped.map((s) => ({ ...s, line: s.line + i })));
    sum.errors.push(...r.errors.map((e) => ({ ...e, line: e.line + i })));
    for (const [k, n] of Object.entries(r.missing_clients)) sum.missing_clients[k] = (sum.missing_clients[k] ?? 0) + n;
    onProgress(Math.min(i + CHUNK, rows.length));
  }
  return sum;
}

export function ImportContractsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
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
      if (!parsed.some((r) => r && typeof r === 'object' && 'codigo_cliente' in r && 'inicio' in r)) throw new Error('Não encontrei as colunas "codigo_cliente" e "inicio". Use o modelo de planilha.');
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
      toast.success(`${r.created} contrato${r.created === 1 ? '' : 's'} importado${r.created === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A importação falhou.');
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = () => {
    const sample = ['537', 'Studio Exemplo Ltda', 'Endereço fiscal', 'Coworking Harmonize o Ser', 'Semestral', '', '2026-05-20', '', '2027-05-19', '76140', '25', '', 'Recepção', '', '', 'Sim'];
    const url = URL.createObjectURL(new Blob([toCsv(HEADERS, [sample])], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-importacao-contratos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = result ?? preview;
  const missing = Object.entries(shown?.missing_clients ?? {}).sort((a, b) => b[1] - a[1]);
  const otherErrors = (shown?.errors ?? []).filter((e) => !/não cadastrado\.$/.test(e.reason));

  return (
    <Modal
      open={open}
      onClose={close}
      locked={!!busy}
      size="lg"
      title="Importar contratos"
      subtitle="Traga os contratos do sistema anterior por planilha (CSV) ou arquivo JSON."
      footer={
        result ? <Button onClick={close}>Concluir</Button> : (
          <>
            <Button variant="secondary" onClick={close} disabled={!!busy}>Cancelar</Button>
            <Button icon={<Upload size={16} />} loading={busy === 'import'} disabled={!!busy || !preview || preview.created === 0} onClick={importNow}>
              {preview && preview.created > 0 ? `Importar ${preview.created} contrato${preview.created === 1 ? '' : 's'}` : 'Nada a importar'}
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
                <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" id="import-contracts-file" onChange={(e) => pick(e.target.files?.[0])} disabled={!!busy} />
                <label htmlFor="import-contracts-file" className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-sage-700 px-5 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-sage-900">
                  <FileUp size={16} />Escolher arquivo
                </label>
                <span className="text-[13px] text-stone">{fileName || 'Nenhum arquivo escolhido'}</span>
                <Button variant="ghost" size="sm" className="ml-auto" icon={<Download size={14} />} onClick={downloadTemplate}>Baixar modelo</Button>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-stone">
                O cliente é ligado pelo <code className="text-[12px]">codigo_cliente</code> (número do cadastro no sistema anterior) e precisa já estar cadastrado.
                O contrato é só cadastro: não gera cobranças. O mesmo cliente, tipo, periodicidade e início não entram duas vezes, então dá para repetir sem duplicar.
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
            {result && <p className="flex items-center gap-2 text-[13.5px] text-sage-700"><CheckCircle2 size={16} />Pronto. Os contratos já aparecem na lista.</p>}
            {missing.length > 0 && (
              <div className="rounded-2xl border border-rose/25 bg-rose-dim/40 px-4 py-3.5">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><AlertTriangle size={15} className="text-rose" />Clientes que faltam cadastrar</p>
                <p className="mt-0.5 text-[12.5px] text-stone">Importe esses clientes em Clientes → Importar clientes e rode esta importação de novo.</p>
                <ul className="mt-2 divide-y divide-ink/8 text-[12.5px]">
                  {missing.map(([name, n]) => <li key={name} className="flex justify-between gap-4 py-1.5"><span className="font-medium text-ink">{name}</span><span className="shrink-0 text-stone">{n} contrato{n === 1 ? '' : 's'}</span></li>)}
                </ul>
              </div>
            )}
            {otherErrors.length > 0 && <IssueList title="Outras linhas com problema" icon={<AlertTriangle size={15} className="text-rose" />} items={otherErrors} />}
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
