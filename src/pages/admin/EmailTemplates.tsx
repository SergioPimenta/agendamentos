import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Mail, RotateCcw, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, ErrorState, PageLoader, useConfirm, useToast } from '../../components/ui/Feedback';
import { Input, Switch, Textarea } from '../../components/ui/Form';
import { Card, CardHeader, PageHeader } from '../../components/ui/Misc';
import { useApi, useDebounced } from '../../hooks/useApi';
import { cn } from '../../lib/cn';
import { api } from '../../services/api';
import type { EmailTemplate, EmailTemplateValues } from '../../types';

type Draft = EmailTemplateValues & { enabled: boolean };
type FieldName = keyof EmailTemplateValues;

const toDraft = (t: EmailTemplate): Draft => ({ ...t.values, enabled: t.enabled });
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export default function AdminEmailTemplatesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useApi(() => api.get<{ templates: EmailTemplate[]; smtp_configured: boolean; notify_email: string }>('/admin/email-templates'), []);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const lastField = useRef<{ name: FieldName; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setTemplates(q.data.templates);
    setSelectedKey((k) => k ?? q.data!.templates[0]?.key ?? null);
  }, [q.data]);

  const selected = templates.find((t) => t.key === selectedKey) ?? null;

  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
    lastField.current = null;
    // Só recarrega o rascunho ao trocar de modelo (ou depois de salvar/restaurar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, selected?.updated_at, selected?.customized]);

  const dirty = useMemo(() => {
    if (!selected || !draft) return false;
    const base = toDraft(selected);
    return (Object.keys(base) as (keyof Draft)[]).some((k) => base[k] !== draft[k]);
  }, [selected, draft]);

  const unknown = useMemo(() => {
    if (!selected || !draft) return [] as string[];
    const known = new Set(selected.variables.map((v) => v.name));
    const bad = new Set<string>();
    for (const text of [draft.subject, draft.title, draft.body, draft.cta_label]) {
      for (const m of text.matchAll(PLACEHOLDER)) if (!known.has(m[1].toLowerCase())) bad.add(m[1]);
    }
    return [...bad];
  }, [selected, draft]);

  const debounced = useDebounced(draft, 450);
  useEffect(() => {
    if (!selected || !debounced) return;
    if (!debounced.subject.trim() || !debounced.title.trim() || !debounced.body.trim()) {
      setPreviewError('Preencha assunto, título e texto para ver a prévia.');
      return;
    }
    let cancelled = false;
    api
      .post<{ subject: string; html: string }>(`/admin/email-templates/${selected.key}/preview`, {
        subject: debounced.subject, title: debounced.title, body: debounced.body, cta_label: debounced.cta_label,
      })
      .then((r) => {
        if (cancelled) return;
        setPreview(r);
        setPreviewError('');
      })
      .catch((e) => !cancelled && setPreviewError(e instanceof Error ? e.message : 'Não foi possível gerar a prévia.'));
    return () => { cancelled = true; };
  }, [selected?.key, debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error) return <ErrorState message={q.error} onRetry={q.refetch} />;
  if (!q.data || !selected || !draft) return <PageLoader />;

  const groups = [...new Set(templates.map((t) => t.group))];
  const set = (name: FieldName) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [name]: e.target.value });
  const track = (name: FieldName) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { lastField.current = { name, el: e.currentTarget }; };

  const replaceTemplate = (t: EmailTemplate) => setTemplates((all) => all.map((x) => (x.key === t.key ? t : x)));

  const pick = async (key: string) => {
    if (key === selectedKey) return;
    if (dirty && !(await confirm({ title: 'Descartar alterações?', description: 'Você editou este modelo e não salvou. Se trocar de modelo, as alterações serão perdidas.', confirmLabel: 'Descartar', cancelLabel: 'Continuar editando', tone: 'danger' }))) return;
    setPreview(null);
    setSelectedKey(key);
  };

  /** Insere {{variável}} no campo que estava em foco (ou no texto, se nenhum). */
  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const target = lastField.current ?? null;
    const field: FieldName = target?.name ?? 'body';
    const el = target?.el;
    const current = draft[field];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    setDraft({ ...draft, [field]: current.slice(0, start) + token + current.slice(end) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const payload = { subject: draft.subject, title: draft.title, body: draft.body, cta_label: selected.has_button ? draft.cta_label : '' };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ template: EmailTemplate }>(`/admin/email-templates/${selected.key}`, { ...payload, enabled: draft.enabled });
      replaceTemplate(r.template);
      toast.success('Modelo salvo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!(await confirm({ title: 'Restaurar o texto padrão?', description: `O modelo "${selected.name}" voltará ao texto original do sistema. O que você personalizou será perdido.`, confirmLabel: 'Restaurar padrão', tone: 'danger' }))) return;
    try {
      const r = await api.delete<{ template: EmailTemplate }>(`/admin/email-templates/${selected.key}`);
      replaceTemplate(r.template);
      setDraft(toDraft(r.template));
      toast.success('Texto padrão restaurado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível restaurar.');
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ message: string }>(`/admin/email-templates/${selected.key}/test`, payload);
      toast.success(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar o teste.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Sistema"
        title="Modelos de e-mail"
        description="Todos os e-mails que o sistema envia. Edite assunto e texto, use variáveis como {{nome}} e {{sala}}, veja a prévia e mande um teste para você."
      />

      {!q.data.smtp_configured && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber/30 bg-amber-dim px-4 py-3.5 text-[13px] leading-relaxed text-ink">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber" />
          <p>
            <strong>O envio de e-mails ainda não está configurado neste servidor</strong> (SMTP no arquivo <code>.env</code>). Os modelos podem ser editados e salvos normalmente,
            mas nenhum e-mail sai de verdade — nem o de teste — até configurar.
          </p>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card padded={false} className="overflow-hidden xl:sticky xl:top-6">
          {groups.map((g) => (
            <div key={g} className="border-b border-ink/8 last:border-0">
              <p className="px-5 pt-4 pb-1.5 text-[10.5px] font-semibold tracking-[0.18em] text-stone-light uppercase">{g}</p>
              <ul className="pb-2">
                {templates.filter((t) => t.group === g).map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => pick(t.key)}
                      aria-current={t.key === selected.key}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-3 px-5 py-2.5 text-left transition-colors hover:bg-sage-dim/60',
                        t.key === selected.key && 'bg-sage-dim',
                      )}
                    >
                      <Mail size={16} className={cn('mt-0.5 shrink-0', t.key === selected.key ? 'text-sage-700' : 'text-stone-light')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] leading-snug font-semibold text-ink">{t.name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11.5px] text-stone">Para: {t.recipient}</span>
                          {!t.enabled && <Badge tone="rose" className="px-2 py-0.5 text-[10px]">Desligado</Badge>}
                          {t.customized && <Badge tone="sage" className="px-2 py-0.5 text-[10px]">Personalizado</Badge>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={selected.name} subtitle={selected.description} />

            <Switch
              checked={draft.enabled}
              disabled={selected.locked}
              onChange={(v) => setDraft({ ...draft, enabled: v })}
              label="Enviar este e-mail"
              description={selected.locked ? 'Sempre ativo: sem ele o cliente não consegue recuperar a senha.' : 'Desligado, o sistema simplesmente não envia este e-mail.'}
            />

            <div className="mt-6 flex flex-col gap-4 border-t border-ink/8 pt-5">
              <Input label="Assunto" value={draft.subject} maxLength={200} onChange={set('subject')} onFocus={track('subject')} />
              <Input label="Título dentro do e-mail" value={draft.title} maxLength={160} onChange={set('title')} onFocus={track('title')} />
              <Textarea
                label="Texto"
                rows={7}
                maxLength={4000}
                value={draft.body}
                onChange={set('body')}
                onFocus={track('body')}
                error={unknown.length ? `Variável desconhecida: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use só as da lista abaixo.` : undefined}
                hint="Quebras de linha viram parágrafos. Não precisa de HTML."
              />
              {selected.has_button && (
                <Input
                  label="Texto do botão"
                  value={draft.cta_label}
                  maxLength={60}
                  onChange={set('cta_label')}
                  onFocus={track('cta_label')}
                  hint="Deixe vazio para enviar sem botão. O link do botão é definido pelo sistema."
                />
              )}
            </div>

            <div className="mt-5 rounded-2xl bg-sand-deep/50 p-4">
              <p className="text-[12px] font-semibold tracking-wide text-ink">Variáveis disponíveis</p>
              <p className="mt-0.5 text-[12px] text-stone">Clique para inserir no campo em que você está digitando. Elas são trocadas pelos dados reais no envio.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.variables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    title={v.label}
                    onClick={() => insertVariable(v.name)}
                    className="cursor-pointer rounded-full border border-ink/12 bg-cream px-3 py-1 font-mono text-[12px] text-sage-900 transition-colors hover:border-sage-700 hover:bg-sage-dim"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
              {selected.has_details && (
                <p className="mt-3 text-[12px] text-stone">A tabela com sala, data, horário, valor e código aparece sozinha abaixo do texto.</p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button loading={saving} disabled={!dirty || unknown.length > 0} onClick={save}>Salvar modelo</Button>
              <Button variant="secondary" icon={<Send size={15} />} loading={testing} disabled={unknown.length > 0} onClick={sendTest}>Enviar teste para mim</Button>
              <Button variant="ghost" icon={<RotateCcw size={15} />} disabled={!selected.customized} onClick={restore} className="sm:ml-auto">Restaurar padrão</Button>
            </div>
            {dirty && <p className="mt-3 text-[12px] text-amber">Você tem alterações que ainda não foram salvas.</p>}
          </Card>

          <Card>
            <CardHeader title="Prévia" subtitle="Com dados de exemplo (cliente Maria Souza, Sala Cachoeira). Atualiza enquanto você digita." />
            {previewError && <p className="mb-3 text-[13px] text-rose">{previewError}</p>}
            {preview ? (
              <>
                <p className="mb-3 rounded-xl bg-sand-deep/50 px-4 py-2.5 text-[13px] text-ink">
                  <span className="text-stone">Assunto: </span>
                  <strong>{preview.subject}</strong>
                </p>
                <iframe
                  title="Prévia do e-mail"
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-[600px] w-full rounded-2xl border border-ink/10 bg-white"
                />
              </>
            ) : (
              !previewError && <p className="text-[13px] text-stone">Gerando prévia…</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
