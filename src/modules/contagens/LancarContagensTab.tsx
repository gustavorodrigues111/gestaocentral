import { useEffect, useMemo, useRef, useState } from "react";
import { Package, Search, Ruler, Save, Minus, Plus, Users, LayoutGrid, Radio, Ban, ArrowLeft } from "lucide-react";
import { addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, ContagemSessao, Insumo } from "../../core/types";

type Props = {
  insumos: Insumo[];
  ultimaContagem: Record<string, Contagem>;
  restaurantId: string;
  podeConfig: boolean;
  onSair?: () => void;   // voltar pra home de Contagens
};

export function LancarContagensTab({ insumos, ultimaContagem, restaurantId, podeConfig, onSair }: Props) {
  const { pessoa: me } = useAuth();
  const [agrupamento, setAgrupamento] = useState<"categoria" | "fornecedor">("categoria");
  const [filtroChip, setFiltroChip] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // insumoId → string
  const [obsDrafts, setObsDrafts] = useState<Record<string, string>>({});
  const [nome, setNome] = useState("");   // nome opcional da contagem
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  // ── Sessão AO VIVO (colaborativa) — UMA por restaurante ────────────────────
  const [sessao, setSessao] = useState<ContagemSessao | null>(null);
  const editandoRef = useRef<string | null>(null);   // campo em foco agora (não sobrescreve com snapshot)
  const sessionId = `${restaurantId}_live`;
  const dataAtual = sessao?.data || todayYmd();   // data = quando a contagem começou (automático)

  // Assina a sessão viva do restaurante; sincroniza os campos que NÃO estou
  // editando (pra ver o que os outros digitam em tempo real).
  useEffect(() => {
    setDrafts({}); setObsDrafts({}); setNome(""); editandoRef.current = null;
    const ref = doc(db, "contagemSessoes", sessionId);
    return onSnapshot(ref, snap => {
      const raw = snap.exists() ? ({ id: snap.id, ...snap.data() } as ContagemSessao) : null;
      const s = raw && (!raw.status || raw.status === "em_andamento") ? raw : null;   // só a viva
      setSessao(s);
      const val = s?.valores || {};
      setDrafts(prev => {
        const n = { ...prev };
        for (const [id, v] of Object.entries(val)) if (editandoRef.current !== id) n[id] = String(v.qty);
        for (const id of Object.keys(n)) if (!(id in val) && editandoRef.current !== id) delete n[id];
        return n;
      });
      setObsDrafts(prev => {
        const n = { ...prev };
        for (const [id, v] of Object.entries(val)) if (editandoRef.current !== id) n[id] = v.obs || "";
        return n;
      });
      if (editandoRef.current !== "__nome__") setNome(s?.nome || "");
    }, () => setSessao(null));
  }, [sessionId]);

  // Grava um item na sessão viva (ou remove se ficou vazio). setDoc merge cria a
  // sessão na 1ª digitação e mescla `valores.{id}` sem tocar nos outros itens.
  async function commit(id: string, override?: string) {
    if (!me || !podeConfig) return;
    const now = new Date().toISOString();
    const ref = doc(db, "contagemSessoes", sessionId);
    const meta = {
      restaurantId, data: dataAtual, status: "em_andamento" as const, atualizadoEm: now, atualizadoPorNome: me.nome,
      iniciadoPor: sessao?.iniciadoPor || me.id, iniciadoPorNome: sessao?.iniciadoPorNome || me.nome, iniciadoEm: sessao?.iniciadoEm || now,
    };
    const raw = override ?? drafts[id];
    const qtd = parseFloat((raw || "").replace(",", "."));
    try {
      if (raw == null || raw.trim() === "" || isNaN(qtd)) {
        await setDoc(ref, sanitizeForFirestore({ ...meta, valores: { [id]: deleteField() } }), { merge: true });
      } else {
        await setDoc(ref, sanitizeForFirestore({ ...meta, valores: { [id]: { qty: qtd, obs: obsDrafts[id]?.trim() || undefined, porId: me.id, porNome: me.nome, em: now } } }), { merge: true });
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao sincronizar"); }
  }

  // Nome opcional da contagem — só grava se já existe sessão viva (não cria sessão
  // vazia só por causa do nome; ele entra no snapshot ao finalizar de qualquer jeito).
  async function commitNome() {
    if (!me || !podeConfig || !sessao) return;
    try { await updateDoc(doc(db, "contagemSessoes", sessionId), sanitizeForFirestore({ nome: nome.trim() || deleteField(), atualizadoEm: new Date().toISOString() })); }
    catch { /* silencioso: nome é secundário */ }
  }

  // Fornecedor PRIORITÁRIO do insumo (nome), pra agrupar "por fornecedor".
  const fornecedorDe = (i: Insumo): string => {
    const arr = i.fornecedores || [];
    const pref = arr.find(x => x.fornecedorId && x.fornecedorId === i.fornecedorPreferredId);
    return ((pref?.nome || arr[0]?.nome || "").trim()) || "Sem fornecedor";
  };
  // Chave do agrupamento atual (categoria ou fornecedor).
  const chaveDe = (i: Insumo): string => agrupamento === "categoria" ? (i.categoria || "(sem categoria)") : fornecedorDe(i);

  const chaves = useMemo(() => Array.from(new Set(insumos.map(chaveDe))).sort((a, b) => a.localeCompare(b)), [insumos, agrupamento]);   // eslint-disable-line react-hooks/exhaustive-deps

  const insumosFilt = useMemo(() => insumos.filter(i => {
    if (filtroChip !== "todas" && chaveDe(i) !== filtroChip) return false;
    if (search.trim() && !i.nome.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [insumos, filtroChip, search, agrupamento]);   // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => {
    const m: Record<string, Insumo[]> = {};
    for (const i of insumosFilt) { const k = chaveDe(i); (m[k] = m[k] || []).push(i); }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [insumosFilt, agrupamento]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Progresso por grupo (total × contados) — pro rail e cabeçalhos.
  const grupoStats = useMemo(() => {
    const m: Record<string, { total: number; feitos: number }> = {};
    for (const i of insumos) {
      const k = chaveDe(i);
      const s = m[k] || { total: 0, feitos: 0 };
      s.total++;
      const d = drafts[i.id];
      if (d && d.trim() !== "" && !isNaN(parseFloat(d))) s.feitos++;
      m[k] = s;
    }
    return m;
  }, [insumos, agrupamento, drafts]);   // eslint-disable-line react-hooks/exhaustive-deps

  function setDraft(id: string, v: string) {
    setDrafts(s => ({ ...s, [id]: v }));
  }
  function setObs(id: string, v: string) {
    setObsDrafts(s => ({ ...s, [id]: v }));
  }

  const totalDigitados = Object.entries(drafts).filter(([, v]) => v.trim() !== "" && !isNaN(parseFloat(v))).length;

  // Fonte de verdade ao finalizar = valores da sessão viva (colaborativa). Fallback
  // pros drafts locais caso a sessão ainda não tenha sincronizado.
  function valoresParaGravar(): Array<{ insumoId: string; qty: number; obs?: string }> {
    const val = sessao?.valores || {};
    const ids = new Set([...Object.keys(val), ...Object.keys(drafts)]);
    const out: Array<{ insumoId: string; qty: number; obs?: string }> = [];
    for (const id of ids) {
      const raw = drafts[id] ?? (val[id] != null ? String(val[id].qty) : "");
      const qty = parseFloat((raw || "").replace(",", "."));
      if (isNaN(qty) || raw.trim() === "") continue;
      out.push({ insumoId: id, qty, obs: obsDrafts[id]?.trim() || val[id]?.obs?.trim() || undefined });
    }
    return out;
  }

  async function salvarTudo() {
    if (!me) return;
    const itens = valoresParaGravar();
    if (itens.length === 0) { setErr("Digite pelo menos uma quantidade"); return; }
    setErr(""); setOkMsg(""); setSaving(true);
    try {
      const now = new Date().toISOString();
      // 1) Cria o REGISTRO da sessão (histórico) com status "realizada". O id dele
      //    vira o sessaoId das contagens (liga histórico ↔ contagens).
      const regRef = await addDoc(collection(db, "contagemSessoes"), sanitizeForFirestore({
        restaurantId, data: dataAtual, nome: nome.trim() || undefined, status: "realizada",
        valores: sessao?.valores || {},
        iniciadoPor: sessao?.iniciadoPor || me.id, iniciadoPorNome: sessao?.iniciadoPorNome || me.nome, iniciadoEm: sessao?.iniciadoEm || now,
        finalizadaEm: now, finalizadaPor: me.id, finalizadaPorNome: me.nome, totalItens: itens.length, atualizadoEm: now,
      }));
      const sessaoId = regRef.id;
      // 2) Materializa as contagens.
      for (const it of itens) {
        const insumo = insumos.find(i => i.id === it.insumoId); if (!insumo) continue;
        await addDoc(collection(db, "contagens"), sanitizeForFirestore({
          restaurantId, insumoId: it.insumoId, insumoNomeSnapshot: insumo.nome, unidadeSnapshot: insumo.unidade,
          qty: it.qty, data: dataAtual, observacao: it.obs, registradoEm: now, registradoPor: me.id, registradoNome: me.nome,
          sessaoId,
        }));
      }
      // 3) Apaga a sessão viva (deterministic).
      await deleteDoc(doc(db, "contagemSessoes", sessionId)).catch(() => {});
      setDrafts({}); setObsDrafts({});
      setOkMsg(`✓ Contagem finalizada — ${itens.length} item(ns)`);
      setTimeout(() => setOkMsg(""), 3000);
      onSair?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally { setSaving(false); }
  }

  // Aborta a contagem ao vivo: dupla confirmação → guarda um registro "cancelada"
  // (com os valores, pra retomar no Histórico) e apaga a sessão viva.
  async function abortar() {
    if (!me || !sessao) return;
    if (!confirm("Abortar esta contagem em andamento? Ela não vira contagem oficial.")) return;
    if (!confirm("Tem certeza? Os valores ficam guardados em 'canceladas' (dá pra retomar depois no Histórico), mas a contagem atual é encerrada.")) return;
    setSaving(true); setErr("");
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, "contagemSessoes"), sanitizeForFirestore({
        restaurantId, data: dataAtual, nome: nome.trim() || undefined, status: "cancelada",
        valores: sessao.valores || {},
        iniciadoPor: sessao.iniciadoPor, iniciadoPorNome: sessao.iniciadoPorNome, iniciadoEm: sessao.iniciadoEm,
        canceladaEm: now, canceladaPorNome: me.nome, totalItens: Object.keys(sessao.valores || {}).length, atualizadoEm: now,
      }));
      await deleteDoc(doc(db, "contagemSessoes", sessionId)).catch(() => {});
      setDrafts({}); setObsDrafts({});
      setOkMsg("Contagem abortada (guardada em canceladas).");
      setTimeout(() => setOkMsg(""), 3000);
      onSair?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally { setSaving(false); }
  }

  if (insumos.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem insumos ativos pra contar</p>
        {podeConfig && (
          <p className="text-sm text-gray-500 mt-2">Cadastre na aba "Config" pra começar.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {onSair && (
        <button type="button" onClick={onSair} className="text-[13px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><ArrowLeft size={14} /> voltar</button>
      )}

      {/* Identificação da contagem: nome OPCIONAL + data/horário automáticos */}
      <div>
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Nome da contagem <span className="font-normal text-gray-400">(opcional)</span></label>
        <input value={nome} disabled={!podeConfig}
          onChange={(e) => setNome(e.target.value)} onFocus={() => { editandoRef.current = "__nome__"; }} onBlur={() => { editandoRef.current = null; void commitNome(); }}
          placeholder='ex: "Fechamento sexta", "Inventário mensal"…'
          className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-60" />
        <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1">
          <Radio size={11} className={sessao ? "text-emerald-500" : "text-gray-300"} />
          {sessao?.iniciadoEm
            ? <>Iniciada em {new Date(sessao.iniciadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{sessao.iniciadoPorNome ? ` por ${sessao.iniciadoPorNome}` : ""} · encerra ao finalizar</>
            : <>A data e o horário são registrados automaticamente quando você começar a contar.</>}
        </p>
      </div>

      {/* Buscar ITEM (filtra a lista de insumos) */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item pra contar…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
      </div>

      {/* Toggle do agrupamento: por categoria OU por fornecedor prioritário */}
      <div className="flex bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1">
        {([["categoria", "Por categoria", LayoutGrid], ["fornecedor", "Por fornecedor", Users]] as const).map(([k, label, Ico]) => (
          <button key={k} type="button" onClick={() => { setAgrupamento(k); setFiltroChip("todas"); }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${agrupamento === k ? "bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-300 shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
            <Ico size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Chips — só no mobile (no desktop vira rail à esquerda) */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 lg:hidden">
        <button type="button" onClick={() => setFiltroChip("todas")} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${filtroChip === "todas" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>Todas</button>
        {chaves.map(c => (
          <button key={c} type="button" onClick={() => setFiltroChip(c)} className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium ${filtroChip === c ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>{c}</button>
        ))}
      </div>

      {sessao && Object.keys(sessao.valores || {}).length > 0 && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-900/15 px-3 py-2 text-[12px] text-emerald-800 dark:text-emerald-200 flex items-center gap-2 flex-wrap">
          <Radio size={14} className="shrink-0 animate-pulse" />
          <span><strong>Contagem em andamento</strong> (ao vivo) — {Object.keys(sessao.valores).length} item(ns). Outras pessoas podem contar junto; salva sozinho a cada campo. Só vira contagem oficial ao <strong>Finalizar</strong>.</span>
          {sessao.atualizadoPorNome && <span className="text-emerald-600/80 dark:text-emerald-400/80">última edição: {sessao.atualizadoPorNome}</span>}
          {podeConfig && <button type="button" onClick={() => void abortar()} className="ml-auto text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1"><Ban size={12} /> Abortar</button>}
        </div>
      )}

      {!podeConfig && (
        <div className="text-xs text-gray-500 italic">Sem permissão pra salvar contagens — você vê a interface mas não persiste.</div>
      )}

      <div className="lg:flex lg:gap-4 lg:items-start">
        {/* Rail de grupos — só desktop */}
        <aside className="hidden lg:block lg:w-56 shrink-0 lg:sticky lg:top-2 self-start">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-2 pb-1.5">{agrupamento === "categoria" ? "Categorias" : "Fornecedores"}</div>
          <div className="flex flex-col gap-0.5">
            <button type="button" onClick={() => setFiltroChip("todas")} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm ${filtroChip === "todas" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50"}`}>Todas <span className="text-[11px] text-gray-400">{Object.values(grupoStats).reduce((s, g) => s + g.feitos, 0)}/{insumos.length}</span></button>
            {chaves.map(c => {
              const st = grupoStats[c] || { total: 0, feitos: 0 };
              return (
                <button key={c} type="button" onClick={() => setFiltroChip(c)} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left ${filtroChip === c ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50"}`}>
                  <span className="truncate">{c}</span>
                  <span className={`text-[11px] shrink-0 ${st.feitos > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>{st.feitos}/{st.total}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Itens — grade 2 colunas no desktop, 1 no mobile */}
        <div className="flex-1 min-w-0 space-y-3 pb-2">
          {grupos.map(([grupo, list]) => (
            <div key={grupo} className={grupos.length > 1 ? "rounded-xl bg-gray-100/60 dark:bg-white/[0.03] p-2.5" : ""}>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">{grupo}</h3>
                <span className="text-[11px] text-gray-400">{(grupoStats[grupo]?.feitos || 0)}/{list.length} contados</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {list.map(i => {
                  const ult = ultimaContagem[i.id];
                  const draft = drafts[i.id] || "";
                  const min = i.minStock || 0;
                  const qtdAtual = parseFloat(draft);
                  const abaixoMin = !isNaN(qtdAtual) && min > 0 && qtdAtual < min;
                  const forn = fornecedorDe(i);
                  return (
                    <div key={i.id} className={`bg-white dark:bg-gray-900 border rounded-xl p-3 ${draft ? "border-emerald-300 dark:border-emerald-800" : "border-gray-200 dark:border-gray-800"}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{i.nome}</div>
                          <div className="text-xs text-gray-500 mt-0.5 flex gap-2.5 flex-wrap">
                            <span className="inline-flex items-center gap-1"><Ruler size={12} /> {i.unidade === "outro" ? (i.unidadeOutroLabel || "outro") : UNIDADES_LABEL[i.unidade]}</span>
                            {agrupamento === "categoria" && forn !== "Sem fornecedor" && <span className="inline-flex items-center gap-1 truncate"><Users size={12} /> {forn}</span>}
                            {ult && <span>última <strong>{ult.qty}</strong></span>}
                            {abaixoMin && <span className="text-amber-600 dark:text-amber-400">abaixo do mín ({min})</span>}
                          </div>
                        </div>
                        <Stepper value={draft} onChange={(v) => setDraft(i.id, v)} onCommit={(v) => void commit(i.id, v)}
                          onFocus={() => { editandoRef.current = i.id; }} onBlur={() => { editandoRef.current = null; void commit(i.id); }}
                          disabled={!podeConfig} destaque={!!draft && !abaixoMin} alerta={abaixoMin} />
                      </div>
                      {!!draft && (
                        <input type="text" value={obsDrafts[i.id] || ""} onChange={(e) => setObs(i.id, e.target.value)}
                          onFocus={() => { editandoRef.current = i.id; }} onBlur={() => { editandoRef.current = null; void commit(i.id); }}
                          disabled={!podeConfig} placeholder="observação (opcional)"
                          className="mt-2 w-full px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 disabled:opacity-60" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}
      {okMsg && <div className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">{okMsg}</div>}

      {/* Barra fina de ação — só quando há itens contados; não cobre o card (spacer) */}
      {podeConfig && totalDigitados > 0 && (
        <>
          <div className="h-14" aria-hidden />
          <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="text-[13px] text-gray-600 dark:text-gray-300 min-w-0 truncate">
              <strong className="text-gray-900 dark:text-gray-100">{totalDigitados}</strong> contados <span className="text-emerald-500">· salvando ao vivo</span>
            </div>
            <Button size="sm" onClick={salvarTudo} disabled={saving}>
              {saving ? "Finalizando…" : <span className="inline-flex items-center gap-1.5"><Save size={15} /> Finalizar ({totalDigitados})</span>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Stepper mobile-first: − [qtd] +. O número é editável (aceita decimal p/ kg).
function Stepper({ value, onChange, onCommit, onFocus, onBlur, disabled, destaque, alerta }: { value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; onFocus?: () => void; onBlur?: () => void; disabled?: boolean; destaque?: boolean; alerta?: boolean }) {
  const num = parseFloat(value);
  const passo = (d: number) => { const v = String(Math.max(0, (isNaN(num) ? 0 : num) + d)); onChange(v); onCommit?.(v); };
  const btn = "w-10 h-10 rounded-lg inline-flex items-center justify-center select-none disabled:opacity-40 shrink-0 active:scale-95 transition-transform";
  const campo = alerta
    ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
    : destaque
      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-300"
      : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button type="button" disabled={disabled} onClick={() => passo(-1)} aria-label="Diminuir" className={`${btn} border border-gray-300 dark:border-gray-700 text-gray-500`}><Minus size={17} /></button>
      <input type="number" inputMode="decimal" step="any" min={0} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} onBlur={onBlur} disabled={disabled} placeholder="0"
        className={`w-16 h-10 text-center text-base font-medium rounded-lg border tabular-nums disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${campo}`} />
      <button type="button" disabled={disabled} onClick={() => passo(1)} aria-label="Aumentar" className={`${btn} border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300`}><Plus size={17} /></button>
    </div>
  );
}
