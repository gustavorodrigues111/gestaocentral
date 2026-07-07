// Aba "Templates" do módulo WhatsApp: lista os modelos de mensagem da Meta com
// status (aprovado/pendente/rejeitado), deixa criar novos e excluir. Assim não
// precisa entrar no WhatsApp Manager. Chama /api/whatsapp-templates.
import { useCallback, useEffect, useMemo, useState } from "react";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";

type Comp = { type: string; text?: string; example?: { body_text?: string[][] } };
type Template = { id?: string; name: string; status?: string; category?: string; language?: string; components?: Comp[]; rejected_reason?: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "aprovado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  PENDING: { label: "em análise", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  REJECTED: { label: "rejeitado", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
  PAUSED: { label: "pausado", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
};
const bodyDe = (t: Template) => t.components?.find(c => c.type === "BODY")?.text || "";
const examplesDe = (t: Template) => t.components?.find(c => c.type === "BODY")?.example?.body_text?.[0] || [];

export function WhatsappTemplatesTab({ podeConfig }: { podeConfig: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<Template | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro("");
    try {
      const r = await fetch("/api/whatsapp-templates", { headers: { ...(await authHeader()) } });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falha ao carregar."); setTemplates([]); }
      else setTemplates((j.templates || []) as Template[]);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function excluir(name: string) {
    if (!confirm(`Excluir o template "${name}"? Isso remove da Meta.`)) return;
    const r = await fetch(`/api/whatsapp-templates?name=${encodeURIComponent(name)}`, { method: "DELETE", headers: { ...(await authHeader()) } });
    if (r.ok) void carregar(); else { const j = await r.json().catch(() => ({})); alert(j.error || "Falha ao excluir."); }
  }

  const ordenados = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name)), [templates]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-xs text-gray-500 dark:text-gray-400">Modelos aprovados pela Meta. Mensagens proativas (fora da janela de 24h) só saem por template aprovado.</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void carregar()}>↻ Atualizar</Button>
          {podeConfig && <Button size="sm" onClick={() => setNovo(true)}>+ Novo template</Button>}
        </div>
      </div>

      {erro && <div className="text-sm text-rose-600 dark:text-rose-400 mb-2">{erro}</div>}
      {loading ? (
        <div className="text-sm text-gray-500 py-8 text-center">Carregando templates…</div>
      ) : ordenados.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum template ainda.</div>
      ) : (
        <div className="space-y-2">
          {ordenados.map(t => {
            const st = STATUS[t.status || ""] || { label: (t.status || "—").toLowerCase(), cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" };
            return (
              <div key={t.name} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${st.cls}`}>{st.label}</span>
                  <span className="text-[10px] text-gray-400 uppercase">{t.category}</span>
                  <span className="text-[10px] text-gray-400">{t.language}</span>
                  {podeConfig && <button type="button" onClick={() => setEditando(t)} className="ml-auto text-[11px] text-indigo-500 hover:text-indigo-700">editar</button>}
                  {podeConfig && <button type="button" onClick={() => void excluir(t.name)} className="text-[11px] text-gray-400 hover:text-rose-600">excluir</button>}
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 whitespace-pre-wrap">{bodyDe(t)}</p>
                {t.status === "REJECTED" && t.rejected_reason && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">Motivo: {t.rejected_reason}</p>}
              </div>
            );
          })}
        </div>
      )}

      {novo && <NovoTemplateModal onClose={() => setNovo(false)} onSalvo={() => { setNovo(false); void carregar(); }} />}
      {editando && <NovoTemplateModal editar={{ id: editando.id || "", name: editando.name, category: editando.category || "UTILITY", bodyText: bodyDe(editando), examples: examplesDe(editando) }} onClose={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }} />}
    </div>
  );
}

function NovoTemplateModal({ editar, onClose, onSalvo }: { editar?: { id: string; name: string; category: string; bodyText: string; examples: string[] }; onClose: () => void; onSalvo: () => void }) {
  const editando = !!editar;
  const [name, setName] = useState(editar?.name || "");
  const [categoria, setCategoria] = useState(editar?.category || "UTILITY");
  const [corpo, setCorpo] = useState(editar?.bodyText || "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const nVars = (corpo.match(/\{\{\s*\d+\s*\}\}/g) || []).length;
  const [exemplos, setExemplos] = useState<string[]>(editar?.examples || []);
  useEffect(() => { setExemplos(prev => { const n = [...prev]; while (n.length < nVars) n.push(""); return n.slice(0, nVars); }); }, [nVars]);

  // Validações espelhando as regras da Meta.
  const corpoTrim = corpo.trim();
  const terminaVar = /\{\{\s*\d+\s*\}\}\s*$/.test(corpoTrim);
  const comecaVar = /^\s*\{\{\s*\d+\s*\}\}/.test(corpoTrim);
  const varComQuebra = exemplos.some(e => /\n|\t/.test(e));

  async function salvar() {
    setErro("");
    if (!editando && !name.trim()) return setErro("Dê um nome (ex: lembrete_reuniao).");
    if (!corpoTrim) return setErro("Escreva o corpo da mensagem.");
    if (comecaVar || terminaVar) return setErro("A mensagem não pode começar nem terminar com variável ({{n}}). Ponha texto antes/depois.");
    setEnviando(true);
    try {
      const r = editando
        ? await fetch("/api/whatsapp-templates", { method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ id: editar!.id, category: categoria, bodyText: corpoTrim, examples: exemplos }) })
        : await fetch("/api/whatsapp-templates", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ name: name.trim(), category: categoria, bodyText: corpoTrim, examples: exemplos }) });
      const j = await r.json();
      if (r.ok && j.ok) onSalvo();
      else setErro(j.error || "Falha ao salvar.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro."); }
    finally { setEnviando(false); }
  }

  const input = "w-full px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  return (
    <Modal title={editando ? `Editar "${editar!.name}"` : "Novo template"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {editando && <div className="text-[11px] rounded-lg p-2 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200">Editar <b>re-submete o template pra análise da Meta</b> (volta a “em análise”). O nome e o idioma não mudam. Há limite de edições por período.</div>}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Nome</label>
          <input value={name} disabled={editando} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="lembrete_reuniao" className={`${input} font-mono ${editando ? "opacity-60" : ""}`} />
          {!editando && <p className="text-[11px] text-gray-400 mt-0.5">Só minúsculas, números e _ (underscore).</p>}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Categoria</label>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} className={input}>
            <option value="UTILITY">Utilidade (lembretes, avisos operacionais)</option>
            <option value="MARKETING">Marketing (promoções, novidades)</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Corpo da mensagem</label>
          <textarea value={corpo} onChange={e => setCorpo(e.target.value)} rows={5} placeholder={"Olá, {{1}}! Lembrete: {{2}}.\n\nAbra aqui: {{3}}\n\nQualquer dúvida, responda."} className={`${input} resize-y`} />
          <p className="text-[11px] text-gray-400 mt-0.5">Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… pras partes que mudam. <b>Não</b> comece nem termine com variável. Negrito com *asteriscos*.</p>
          {(comecaVar || terminaVar) && <p className="text-[11px] text-rose-600 mt-1">⚠ Não pode começar/terminar com variável.</p>}
          {varComQuebra && <p className="text-[11px] text-rose-600 mt-1">⚠ Exemplos de variável não podem ter quebra de linha.</p>}
        </div>
        {nVars > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Exemplos das variáveis <span className="font-normal text-gray-400">(a Meta exige, só pra aprovação)</span></label>
            <div className="space-y-1.5">
              {exemplos.map((ex, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-400 w-10">{`{{${i + 1}}}`}</span>
                  <input value={ex} onChange={e => setExemplos(prev => prev.map((x, j) => j === i ? e.target.value : x))} placeholder="exemplo" className={`${input} py-1.5 text-sm`} />
                </div>
              ))}
            </div>
          </div>
        )}
        {erro && <div className="text-sm text-rose-600 dark:text-rose-400">{erro}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={enviando}>{enviando ? "Enviando…" : (editando ? "Salvar e re-submeter" : "Criar e submeter")}</Button>
        </div>
        <p className="text-[11px] text-gray-400">Depois de {editando ? "salvar" : "criar"}, a Meta analisa (minutos a horas). O status aparece na lista.</p>
      </div>
    </Modal>
  );
}
