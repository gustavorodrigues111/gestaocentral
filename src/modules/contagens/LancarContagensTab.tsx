import { useMemo, useState } from "react";
import { Package, Search, Ruler, Save, Minus, Plus, Users, LayoutGrid } from "lucide-react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Insumo } from "../../core/types";

type Props = {
  insumos: Insumo[];
  ultimaContagem: Record<string, Contagem>;
  restaurantId: string;
  podeConfig: boolean;
};

export function LancarContagensTab({ insumos, ultimaContagem, restaurantId, podeConfig }: Props) {
  const { pessoa: me } = useAuth();
  const [data, setData] = useState(todayYmd());
  const [agrupamento, setAgrupamento] = useState<"categoria" | "fornecedor">("categoria");
  const [filtroChip, setFiltroChip] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // insumoId → string
  const [obsDrafts, setObsDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

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

  async function salvarTudo() {
    if (!me) return;
    if (totalDigitados === 0) { setErr("Digite pelo menos uma quantidade"); return; }
    setErr("");
    setOkMsg("");
    setSaving(true);
    try {
      let saved = 0;
      for (const [insumoId, qtdStr] of Object.entries(drafts)) {
        const qtd = parseFloat(qtdStr);
        if (isNaN(qtd) || qtdStr.trim() === "") continue;
        const insumo = insumos.find(i => i.id === insumoId);
        if (!insumo) continue;
        const c: Omit<Contagem, "id"> = {
          restaurantId,
          insumoId,
          insumoNomeSnapshot: insumo.nome,
          unidadeSnapshot: insumo.unidade,
          qty: qtd,
          data,
          observacao: obsDrafts[insumoId]?.trim() || undefined,
          registradoEm: new Date().toISOString(),
          registradoPor: me.id,
          registradoNome: me.nome,
        };
        await addDoc(collection(db, "contagens"), sanitizeForFirestore(c));
        saved++;
      }
      setDrafts({});
      setObsDrafts({});
      setOkMsg(`✓ ${saved} contagem(ns) salva(s)`);
      setTimeout(() => setOkMsg(""), 3000);
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
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
      {/* Topo: data + busca (empilha no mobile) */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-end">
        <Input label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Input label={<span className="inline-flex items-center gap-1"><Search size={12} /> Buscar</span>} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filtra por nome" />
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
        <div className="flex-1 min-w-0 space-y-4 pb-2">
          {grupos.map(([grupo, list]) => (
            <div key={grupo}>
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
                        <Stepper value={draft} onChange={(v) => setDraft(i.id, v)} disabled={!podeConfig} destaque={!!draft && !abaixoMin} alerta={abaixoMin} />
                      </div>
                      {!!draft && (
                        <input type="text" value={obsDrafts[i.id] || ""} onChange={(e) => setObs(i.id, e.target.value)} disabled={!podeConfig} placeholder="observação (opcional)"
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

      {/* Barra de ação fixa */}
      {podeConfig && (
        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap shadow-lg">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <strong>{totalDigitados}</strong> contagem(ns) prontas pra salvar
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setDrafts({}); setObsDrafts({}); }} disabled={totalDigitados === 0}>
              Limpar
            </Button>
            <Button onClick={salvarTudo} disabled={saving || totalDigitados === 0}>
              {saving ? "Salvando..." : <span className="inline-flex items-center gap-1.5"><Save size={15} /> Salvar ({totalDigitados})</span>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Stepper mobile-first: − [qtd] +. O número é editável (aceita decimal p/ kg).
function Stepper({ value, onChange, disabled, destaque, alerta }: { value: string; onChange: (v: string) => void; disabled?: boolean; destaque?: boolean; alerta?: boolean }) {
  const num = parseFloat(value);
  const passo = (d: number) => onChange(String(Math.max(0, (isNaN(num) ? 0 : num) + d)));
  const btn = "w-10 h-10 rounded-lg inline-flex items-center justify-center select-none disabled:opacity-40 shrink-0 active:scale-95 transition-transform";
  const campo = alerta
    ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
    : destaque
      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-300"
      : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button type="button" disabled={disabled} onClick={() => passo(-1)} aria-label="Diminuir" className={`${btn} border border-gray-300 dark:border-gray-700 text-gray-500`}><Minus size={17} /></button>
      <input type="number" step="any" min={0} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="0"
        className={`w-16 h-10 text-center text-base font-medium rounded-lg border tabular-nums disabled:opacity-60 ${campo}`} />
      <button type="button" disabled={disabled} onClick={() => passo(1)} aria-label="Aumentar" className={`${btn} border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300`}><Plus size={17} /></button>
    </div>
  );
}
