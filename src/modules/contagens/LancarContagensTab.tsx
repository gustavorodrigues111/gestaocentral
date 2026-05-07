import { useMemo, useState } from "react";
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
  const [filtroCat, setFiltroCat] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // insumoId → string
  const [obsDrafts, setObsDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const categorias = useMemo(() => {
    const s = new Set<string>();
    insumos.forEach(i => s.add(i.categoria || "(sem categoria)"));
    return Array.from(s).sort();
  }, [insumos]);

  const insumosFilt = useMemo(() => {
    return insumos.filter(i => {
      if (filtroCat !== "todas" && (i.categoria || "(sem categoria)") !== filtroCat) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!i.nome.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [insumos, filtroCat, search]);

  // Agrupado por categoria
  const insumosPorCat = useMemo(() => {
    const m: Record<string, Insumo[]> = {};
    for (const i of insumosFilt) {
      const c = i.categoria || "(sem categoria)";
      if (!m[c]) m[c] = [];
      m[c].push(i);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [insumosFilt]);

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
        <div className="text-4xl mb-3">📦</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem insumos ativos pra contar</p>
        {podeConfig && (
          <p className="text-sm text-gray-500 mt-2">Cadastre na aba "Config" pra começar.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Topo: data + filtros */}
      <div className="flex items-end gap-3 flex-wrap">
        <Input
          label="Data da contagem"
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
        <Input
          label="🔍 Buscar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filtra por nome"
          className="flex-1 min-w-[200px]"
        />
      </div>

      {/* Filtro de categoria */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Categoria:</span>
        <button
          type="button"
          onClick={() => setFiltroCat("todas")}
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            filtroCat === "todas"
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          }`}
        >Todas</button>
        {categorias.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setFiltroCat(c)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              filtroCat === c
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >{c}</button>
        ))}
      </div>

      {!podeConfig && (
        <div className="text-xs text-gray-500 italic">
          Sem permissão pra salvar contagens. Você pode visualizar a interface mas não persistir.
        </div>
      )}

      {/* Lista pra digitar */}
      <div className="space-y-3">
        {insumosPorCat.map(([cat, list]) => (
          <div key={cat}>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
              {cat} <span className="text-gray-400 font-normal">({list.length})</span>
            </h3>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
              {list.map(i => {
                const ult = ultimaContagem[i.id];
                const draft = drafts[i.id] || "";
                const min = i.minStock || 0;
                const qtdAtual = parseFloat(draft);
                const abaixoMin = !isNaN(qtdAtual) && min > 0 && qtdAtual < min;
                return (
                  <div key={i.id} className="p-3 flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</div>
                      <div className="text-xs text-gray-500 mt-0.5 flex gap-3 flex-wrap">
                        <span>📏 {i.unidade === "outro" ? (i.unidadeOutroLabel || "outro") : UNIDADES_LABEL[i.unidade]}</span>
                        {i.minStock != null && i.minStock > 0 && <span>min: {i.minStock}</span>}
                        {ult && (
                          <span>última: <strong>{ult.qty}</strong> em {new Date(ult.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 flex-wrap">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={draft}
                        onChange={(e) => setDraft(i.id, e.target.value)}
                        disabled={!podeConfig}
                        placeholder="0"
                        className={`px-3 py-2 text-sm rounded-lg border w-24 text-right font-mono ${
                          abaixoMin
                            ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                            : draft
                              ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10"
                              : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                        } disabled:opacity-60`}
                      />
                      <input
                        type="text"
                        value={obsDrafts[i.id] || ""}
                        onChange={(e) => setObs(i.id, e.target.value)}
                        disabled={!podeConfig || !draft}
                        placeholder="obs (opc.)"
                        className="px-2 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-32 disabled:opacity-60"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
              {saving ? "Salvando..." : `💾 Salvar (${totalDigitados})`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
