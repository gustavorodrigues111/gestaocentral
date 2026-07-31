// Aba Ajustes: reconcilia um lote de Pagamento pago × escala praticada, numa
// janela [cursor+1, apurado até]. Gera um lote de ajuste (pendente) que abate no
// próximo pagamento. Sugere a data apurada (último dia com praticada pra TODOS).
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { nomeMes, pad2 } from "../../core/utils/date";
import { apuracaoPraticada, proximaJanela, montarLinhasAjuste, totalAjuste } from "./ajuste";
import type { Empregado, EscalaMes, Pessoa, BeneficioPagLote, BeneficioAjusteLote, BeneficioAjusteLinha } from "../../core/types";

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", signDisplay: "exceptZero" });
const brDate = (ymd: string) => ymd ? ymd.split("-").reverse().join("/") : "—";

export function AjustesTab(props: {
  rid: string; empregados: Empregado[]; usaVR: boolean; podeConfig: boolean; me: Pessoa | null;
  pagamentos: BeneficioPagLote[]; ajustes: BeneficioAjusteLote[];
}) {
  const { rid, empregados, usaVR, podeConfig, me, pagamentos, ajustes } = props;
  const pagos = useMemo(() => pagamentos.filter((p) => p.status === "pago").sort((a, b) => (b.ano * 12 + b.mes) - (a.ano * 12 + a.mes)), [pagamentos]);
  const [selId, setSelId] = useState<string>("");
  const sel = pagos.find((p) => p.id === selId) || pagos[0] || null;
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [ateManual, setAteManual] = useState<string>("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!sel) { setEscala(null); return; }
    return onSnapshot(doc(db, "escalas", `${rid}_${sel.ano}-${pad2(sel.mes)}`), (snap) => setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null));
  }, [rid, sel?.ano, sel?.mes]);

  // Alvo = ontem (ou o fim do mês ajustado, o que vier antes). É até onde a gente
  // quer reconciliar; as pendências dizem quem não está confirmado até lá.
  const alvo = useMemo(() => {
    if (!sel) return "";
    const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
    const fimMes = new Date(sel.ano, sel.mes, 0);
    const d = ontem < fimMes ? ontem : fimMes;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, [sel?.ano, sel?.mes]);
  const apur = useMemo(() => sel ? apuracaoPraticada(empregados, escala, sel.ano, sel.mes, alvo) : null, [sel, empregados, escala, alvo]);
  const cursor = useMemo(() => sel ? proximaJanela(sel, ajustes) : null, [sel, ajustes]);
  // Padrão = último dia confirmado por TODOS (seguro). Se todos confirmados até
  // ontem, cai no alvo. Editável: você pode forçar outra data.
  const ate = ateManual || apur?.sugerido || alvo || "";
  const linhas = useMemo<BeneficioAjusteLinha[]>(() => {
    if (!sel || !cursor || !ate || ate < cursor.de) return [];
    return montarLinhasAjuste({ pagamento: sel, empregados, escala, ano: sel.ano, mes: sel.mes, de: cursor.de, ate, usaVR });
  }, [sel, cursor, ate, empregados, escala, usaVR]);
  const total = totalAjuste(linhas);
  const ajustesDoLote = useMemo(() => sel ? ajustes.filter((a) => a.pagamentoLoteId === sel.id).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")) : [], [sel, ajustes]);

  async function confirmar() {
    if (!sel || !cursor || !ate || !podeConfig) return;
    if (ate < cursor.de) { alert("A data apurada é anterior ao que já foi ajustado."); return; }
    if (linhas.length === 0 && !confirm("Nenhuma diferença nesta janela. Fechar o ajuste mesmo assim (só avança o cursor)?")) return;
    setSalvando(true);
    try {
      const nowIso = new Date().toISOString();
      const lote: Omit<BeneficioAjusteLote, "id"> = {
        restaurantId: rid, ano: sel.ano, mes: sel.mes, pagamentoLoteId: sel.id,
        janelaDe: cursor.de, janelaAte: ate, status: "pendente", linhas,
        totalAjuste: total, criadoEm: nowIso, criadoPor: me?.id || null, criadoPorNome: me?.nome || null,
      };
      await addDoc(collection(db, "beneficioAjustes"), sanitizeForFirestore(lote));
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  if (pagos.length === 0) return <div className="mx-auto mt-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhum pagamento pago ainda. O ajuste reconcilia um mês já pago contra a praticada.</div>;

  return (
    <div className="space-y-3">
      {/* Escolher qual pagamento reconciliar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-gray-500 uppercase">Ajustar o pagamento de</span>
        <select value={sel?.id || ""} onChange={(e) => { setSelId(e.target.value); setAteManual(""); }} className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
          {pagos.map((p) => <option key={p.id} value={p.id}>{nomeMes(p.mes)} {p.ano}</option>)}
        </select>
      </div>

      {sel && cursor && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-700 dark:text-gray-200">
            <span>Reconciliar a partir de <b>{brDate(cursor.de)}</b></span>
            <span className="flex items-center gap-1.5">até
              <input type="date" value={ate} min={cursor.de} max={`${sel.ano}-${pad2(sel.mes)}-${pad2(new Date(sel.ano, sel.mes, 0).getDate())}`} onChange={(e) => setAteManual(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm" />
            </span>
            <span className="text-[11px] text-gray-400">alvo: até ontem ({brDate(alvo)})</span>
          </div>
          {apur && apur.pendentes.length > 0 ? (
            <div className="text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-2">
              ⚠️ Para reconciliar até <b>{brDate(alvo)}</b>, falta o DP fechar o ponto de: {apur.pendentes.map((p) => `${p.nome}${p.ultimoDia ? ` (confirmado até ${brDate(p.ultimoDia)})` : " (sem nenhum dia confirmado)"}`).join(" · ")}. Os dias não confirmados aparecem sem diferença (usam a cópia da prevista) e entram quando o DP fechar.
            </div>
          ) : (
            <div className="text-[12px] text-emerald-700 dark:text-emerald-300">✅ Ponto confirmado até {brDate(alvo)} para todos.</div>
          )}
        </div>
      )}

      {/* Tabela do ajuste */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Empregado</th>
              <th className="text-center px-2 py-2">Pago (dias)</th>
              <th className="text-center px-2 py-2">Praticado</th>
              <th className="text-center px-2 py-2">Dif.</th>
              <th className="text-right px-3 py-2">Ajuste</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {linhas.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Nenhuma diferença nesta janela.</td></tr>
            ) : linhas.map((l) => (
              <tr key={l.empregadoId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{l.empregadoNome}</td>
                <td className="text-center px-2 py-2 text-gray-500">{l.diasPrevista}</td>
                <td className="text-center px-2 py-2 text-gray-500">{l.diasPraticada}</td>
                <td className={`text-center px-2 py-2 font-semibold cursor-help ${l.ajusteDias < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}
                  title={[
                    (l.diasDesconto && l.diasDesconto.length) ? `Descontar (não trabalhou): ${l.diasDesconto.map(brDate).join(", ")}` : "",
                    (l.diasCredito && l.diasCredito.length) ? `Adicionar (trabalhou a mais): ${l.diasCredito.map(brDate).join(", ")}` : "",
                  ].filter(Boolean).join("\n") || "Sem diferença de dias"}>
                  {l.ajusteDias > 0 ? `+${l.ajusteDias}` : l.ajusteDias}
                </td>
                <td className={`text-right px-3 py-2 font-semibold tabular-nums ${l.ajusteTotal < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmt(l.ajusteTotal)}</td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-gray-800/40 font-bold text-gray-800 dark:text-gray-100">
              <tr><td className="px-3 py-2" colSpan={4}>Total do ajuste (abate no próximo pagamento)</td><td className={`text-right px-3 py-2 tabular-nums ${total < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmt(total)}</td></tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex justify-end">
        {podeConfig && <Button onClick={() => void confirmar()} disabled={salvando || !ate}>{salvando ? "Fechando…" : "🔒 Fechar ajuste"}</Button>}
      </div>

      {/* Ajustes já fechados deste pagamento */}
      {ajustesDoLote.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2 mt-2">Ajustes fechados deste mês</h3>
          <div className="space-y-1">
            {ajustesDoLote.map((a) => (
              <div key={a.id} className="text-xs flex items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
                <span className={a.status === "cancelado" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}>
                  {brDate(a.janelaDe)}–{brDate(a.janelaAte)} · {a.status === "aplicado" ? "aplicado no pagamento" : a.status === "cancelado" ? "cancelado" : "pendente (abate no próximo)"}
                </span>
                <span className={`tabular-nums font-semibold ${a.totalAjuste < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmt(a.totalAjuste)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
