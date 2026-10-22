import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { parseCsv, toCsv } from '../../lib/csv';
import { api } from '../../services/api';

type Row = Record<string, unknown>;
interface Issue { line: number; name: string; reason: string }
interface Summary { total: number; created: number; updated: number; people: number; skipped: Issue[]; errors: Issue[] }

const CHUNK = 100; // o servidor aceita até 300 por pedido; lotes menores mantêm a resposta rápida
const PERSON_COLUMNS = ['nome', 'sexo', 'nascimento', 'email', 'telefone', 'telefone2', 'cargo', 'rg', 'cpf', 'assina', 'fiador', 'ativo', 'codigo'];
const TEMPLATE_HEADERS = [
  'codigo_antigo', 'nome', 'nome_fantasia', 'documento', 'cidade', 'uf', 'telefone', 'email', 'plano', 'plano_desde', 'nascimento', 'cadastro', 'tags', 'observacoes',
  ...PERSON_COLUMNS.map((c) => `pessoa_${c}`),
  ...PERSON_COLUMNS.map((c) => `pessoa2_${c}`),
];

const empty = (): Summary => ({ total: 0, created: 0, updated: 0, people: 0, skipped: [], errors: [] });

interface ImportResponse { total: number; created: number; updated: number; people: number; skipped: Issue[]; errors: Issue[] }

/** Envia as linhas em lotes e soma os resultados. As linhas são numeradas pela posição no arquivo. */
async function run(rows: Row[], dryRun: boolean, update: boolean, onProgress: (done: number) => void): Promise<Summary> {
  const sum = empty();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const r = await api.post<ImportResponse>('/admin/users/import', { rows: part, dry_run: dryRun, update });
    sum.total += r.total;
    sum.created += r.created;
    sum.updated += r.updated;
    sum.people += r.people;
    sum.skipped.push(...r.skipped.map((s) => ({ ...s, line: s.line + i })));
    sum.errors.push(...r.errors.map((e) => ({ ...e, line: e.line + i })));
    onProgress(Math.min(i + CHUNK, rows.length));
  }
  return sum;
}

export function ImportClientsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  // Completar quem já foi importado antes (preenche só o que estava vazio; nada existente é sobrescrito).
  const [update, setUpdate] = useState(true);

  const reset = () => {
    setFileName('');
    setRows([]);
    setPreview(null);
    setResult(null);
    setError('');
    setProgress(0);
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
      if (!parsed.some((r) => r && typeof r === 'object' && 'nome' in r)) throw new Error('Não encontrei a coluna "nome". Use o modelo de planilha.');
      setRows(parsed);
      setBusy('preview');
      setPreview(await run(parsed, true, update, setProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
      setRows([]);
    } finally {
      setBusy(null);
    }
  };

  const toggleUpdate = async (value: boolean) => {
    setUpdate(value);
    if (!rows.length) return;
    setBusy('preview');
    setError('');
    try {
      setPreview(await run(rows, true, value, setProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível conferir o arquivo.');
    } finally {
      setBusy(null);
    }
  };

  const importNow = async () => {
    setBusy('import');
    setProgress(0);
    setError('');
    try {
      const r = await run(rows, false, update, setProgress);
      setResult(r);
      toast.success(`${r.created} importado${r.created === 1 ? '' : 's'}${r.updated ? `, ${r.updated} completado${r.updated === 1 ? '' : 's'}` : ''}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A importação falhou.');
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = () => {
    const sample = [
      '608', 'Maria da Silva', 'Studio Maria', '', 'Curitiba', 'PR', '(41) 99999-0000', 'maria@exemplo.com', 'Modo Brisa', '', '1985-07-20', '2026-10-20', 'Eventos', '',
      'Maria da Silva', 'Feminino', '1985-07-20', 'maria@exemplo.com', '(41) 99999-0000', '', 'Sócia', '123456789', '12345678909', 'Sim', 'Não', 'Sim', '552',
      '', '', '', '', '', '', '', '', '', '', '', '', '',
    ];
    const url = URL.createObjectURL(new Blob([toCsv(TEMPLATE_HEADERS, [sample])], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-importacao-clientes.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = result ?? preview;
  const toCreate = (preview?.created ?? 0) + (preview?.updated ?? 0);

  return (
    <Modal
      open={open}
      onClose={close}
      locked={!!busy}
      size="lg"
      title="Importar clientes"
      subtitle="Traga os clientes de outro sistema por planilha (CSV) ou arquivo JSON."
      footer={
        result ? <Button onClick={close}>Concluir</Button> : (
          <>
            <Button variant="secondary" onClick={close} disabled={!!busy}>Cancelar</Button>
            <Button icon={<Upload size={16} />} loading={busy === 'import'} disabled={!!busy || toCreate === 0} onClick={importNow}>
              {toCreate > 0 ? `Importar ${toCreate} cliente${toCreate === 1 ? '' : 's'}` : 'Nada a importar'}
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
                <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" id="import-file" onChange={(e) => pick(e.target.files?.[0])} disabled={!!busy} />
                <label htmlFor="import-file" className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-sage-700 px-5 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-sage-900">
                  <FileUp size={16} />Escolher arquivo
                </label>
                <span className="text-[13px] text-stone">{fileName || 'Nenhum arquivo escolhido'}</span>
                <Button variant="ghost" size="sm" className="ml-auto" icon={<Download size={14} />} onClick={downloadTemplate}>Baixar modelo</Button>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-stone">
                Colunas: <code className="text-[12px]">nome</code> (obrigatória), codigo_antigo, nome_fantasia, documento, cidade, uf, telefone, email, plano, plano_desde, nascimento, cadastro (AAAA-MM-DD), tags e observacoes,
                mais os dados das pessoas do cliente (colunas pessoa_* e pessoa2_*, ou a lista “pessoas” no JSON).
                Quem já existe (mesmo código, e-mail ou documento) é pulado, então dá para repetir sem duplicar. Clientes sem e-mail ficam cadastrados e sem acesso ao sistema até você informar um.
              </p>
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-ink">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sage-700" checked={update} disabled={!!busy} onChange={(e) => toggleUpdate(e.target.checked)} />
                <span>
                  <strong className="font-semibold">Completar quem já foi importado</strong>
                  <span className="block text-[12.5px] text-stone">Preenche só o que estiver vazio (e-mail, CPF, nascimento, pessoas…). Nada que já esteja cadastrado é sobrescrito.</span>
                </span>
              </label>
            </div>

            {busy && (
              <p className="text-[13px] text-stone" role="status">
                {busy === 'preview' ? 'Conferindo o arquivo…' : 'Importando…'} {progress}/{rows.length || '…'}
              </p>
            )}
          </>
        )}

        {error && <div role="alert" className="rounded-xl border border-rose/25 bg-rose-dim px-4 py-3 text-[13px] text-rose">{error}</div>}

        {shown && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                [result ? 'Importados' : 'Serão importados', shown.created, 'text-sage-700'],
                [result ? 'Completados' : 'Serão completados', shown.updated, 'text-sage-700'],
                ['Pulados', shown.skipped.length, 'text-stone'],
                ['Com problema', shown.errors.length, shown.errors.length ? 'text-rose' : 'text-stone'],
              ].map(([label, n, tone]) => (
                <div key={String(label)} className="rounded-2xl bg-sand px-5 py-4">
                  <p className="text-[11px] font-semibold tracking-[0.1em] text-stone uppercase">{label}</p>
                  <p className={`mt-1 font-display text-[28px] leading-none font-medium ${tone}`}>{n}</p>
                </div>
              ))}
            </div>
            <p className="text-[12.5px] text-stone">{shown.people} pessoa{shown.people === 1 ? '' : 's'} {result ? 'cadastrada' : 'a cadastrar'}{shown.people === 1 ? '' : 's'} junto com os clientes.</p>
            {result && <p className="flex items-center gap-2 text-[13.5px] text-sage-700"><CheckCircle2 size={16} />Pronto. Os clientes já aparecem na lista.</p>}

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
