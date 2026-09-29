// Aba Ajustes: reconcilia um lote de Pagamento pago × escala praticada, numa
// janela [cursor+1, apurado até]. Gera um lote de ajuste (pendente) que abate no
// próximo pagamento. Sugere a data apurada (último dia com praticada pra TODOS).
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { TriangleAlert, CheckSquare, UserRoundMinus, Lock, Hourglass } from "lucide-react";
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
    return montarLinhasAjuste({ pagamento: sel, empregados, escala, ano: sel.ano, mes: sel.mes, de: cursor.de, ate, usaVR, ajustesAnteriores: ajustes });
  }, [sel, cursor, ate, empregados, escala, usaVR, ajustes]);
  // ── Edição MANUAL do DP antes de fechar (quando o cálculo não contemplou algo) ──
  const [editando, setEditando] = useState(false);
  const [ovr, setOvr] = useState<Record<string, { v: string; m: string }>>({});   // delta R$ + motivo por empregado
  const [manuais, setManuais] = useState<{ id: string; nome: string; v: string; m: string }[]>([]); // linhas 100% manuais
  useEffect(() => { setOvr({}); setManuais([]); setEditando(false); }, [sel?.id, cursor?.de, ate]);
  const parseR = (s: string) => { const n = parseFloat((s || "").replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
  const linhasFinais = useMemo<BeneficioAjusteLinha[]>(() => {
    const base = linhas.map((l) => { const o = ovr[l.empregadoId]; const dv = o ? parseR(o.v) : 0; return dv ? { ...l, ajusteManual: dv, motivoManual: (o?.m || "").trim() || undefined, ajusteTotal: l.ajusteTotal + dv } : l; });
    const extra = manuais.filter((m) => m.nome.trim() && parseR(m.v) !== 0).map((m) => ({
      empregadoId: `manual_${m.id}`, empregadoNome: m.nome.trim(), diasPrevista: 0, diasPraticada: 0, ajusteDias: 0,
      vtValorDiario: 0, vrValorDiario: 0, ajusteVt: 0, ajusteVr: 0, ajusteTotal: parseR(m.v), manual: true, motivoManual: (m.m || "").trim() || undefined,
    } as BeneficioAjusteLinha));
    return [...base, ...extra];
  }, [linhas, ovr, manuais]);
  const total = totalAjuste(linhasFinais);
  const ajustesDoLote = useMemo(() => sel ? ajustes.filter((a) => a.pagamentoLoteId === sel.id).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")) : [], [sel, ajustes]);

  // Reabrir = cancelar o lote de ajuste pra refazer a janela. Só enquanto ele
  // ainda está PENDENTE (não foi consumido por um pagamento). Se já foi aplicado,
  // é preciso cancelar o pagamento correspondente primeiro.
  async function reabrir(a: BeneficioAjusteLote) {
    if (!podeConfig || a.status === "cancelado") return;
    if (a.status === "aplicado") { alert("Este ajuste já foi aplicado num pagamento. Cancele o pagamento correspondente primeiro para reabrir o ajuste."); return; }
    if (!confirm(`Reabrir o ajuste de ${brDate(a.janelaDe)}–${brDate(a.janelaAte)}? Ele será cancelado e o período volta a ficar disponível pra refazer.`)) return;
    try { await updateDoc(doc(db, "beneficioAjustes", a.id), { status: "cancelado", canceladoEm: new Date().toISOString() }); }
    catch (e) { alert("Erro ao reabrir: " + (e instanceof Error ? e.message : "?")); }
  }

  async function confirmar() {
    if (!sel || !cursor || !ate || !podeConfig) return;
    if (ate < cursor.de) { alert("A data apurada é anterior ao que já foi ajustado."); return; }
    if (linhasFinais.length === 0 && !confirm("Nenhuma diferença nesta janela. Fechar o ajuste mesmo assim (só avança o cursor)?")) return;
    setSalvando(true);
    try {
      const nowIso = new Date().toISOString();
      const lote: Omit<BeneficioAjusteLote, "id"> = {
        restaurantId: rid, ano: sel.ano, mes: sel.mes, pagamentoLoteId: sel.id,
        janelaDe: cursor.de, janelaAte: ate, status: "pendente", linhas: linhasFinais,
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
            <div className="text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-2 space-y-1">
              <div><TriangleAlert size={12} className="inline align-[-2px] mr-1"/>O ajuste vai só até <b>{brDate(ate)}</b> porque o ponto ainda não foi fechado até <b>{brDate(alvo)}</b> para todos.</div>
              <div>Falta o DP fechar o ponto de: {apur.pendentes.map((p) => `${p.nome}${p.ultimoDia ? ` (fechado até ${brDate(p.ultimoDia)})` : " (nenhum dia fechado)"}`).join(" · ")}. Depois que fechar, esses dias entram no próximo ajuste.</div>
            </div>
          ) : (
            <div className="text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"><CheckSquare size={13}/> Ponto fechado até {brDate(alvo)} para todos — pode reconciliar até aí.</div>
          )}
        </div>
      )}

      {/* Toolbar: editar valores antes de fechar */}
      {podeConfig && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400">{editando ? "Ajuste manual: some/subtrai R$ ao calculado (com motivo). Também dá pra adicionar linhas do zero." : "Confira os valores. Precisa mexer em algo que o sistema não pegou? Clique em Editar ajuste."}</span>
          <button type="button" onClick={() => setEditando((v) => !v)} className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border ${editando ? "border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{editando ? "✓ Concluir edição" : "✎ Editar ajuste"}</button>
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
            {linhas.length === 0 && manuais.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Nenhuma diferença nesta janela.{editando ? " Você pode adicionar um ajuste manual abaixo." : ""}</td></tr>
            ) : (<>
              {linhas.map((l) => {
                const o = ovr[l.empregadoId]; const dv = o ? parseR(o.v) : 0; const tot = l.ajusteTotal + dv;
                return (
                <tr key={l.empregadoId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                    {l.empregadoNome}
                    {l.demissao && <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded px-1.5 py-0.5 inline-flex items-center gap-1"><UserRoundMinus size={11}/> demitido · acerto do mês inteiro</span>}
                  </td>
                  <td className="text-center px-2 py-2 text-gray-500">{l.diasPrevista}</td>
                  <td className="text-center px-2 py-2 text-gray-500">{l.diasPraticada}</td>
                  <td className={`text-center px-2 py-2 font-semibold cursor-help ${l.ajusteDias < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}
                    title={[
                      (l.diasDesconto && l.diasDesconto.length) ? `Descontar (não trabalhou): ${l.diasDesconto.map(brDate).join(", ")}` : "",
                      (l.diasCredito && l.diasCredito.length) ? `Adicionar (trabalhou a mais): ${l.diasCredito.map(brDate).join(", ")}` : "",
                      ((l.ajusteAuxVt || 0) + (l.ajusteAuxVr || 0)) ? `Auxílio proporcional: ${fmt((l.ajusteAuxVt || 0) + (l.ajusteAuxVr || 0))}${l.demissao ? " (÷30, rescisão)" : " (÷dias previstos)"}` : "",
                    ].filter(Boolean).join("\n") || "Sem diferença de dias"}>
                    {l.ajusteDias > 0 ? `+${l.ajusteDias}` : l.ajusteDias}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums">
                    {editando ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10.5px] text-gray-400">calc {fmt(l.ajusteTotal)}</span>
                        <div className="inline-flex items-center gap-1">
                          <span className="text-[11px] text-gray-400">+/−</span>
                          <input value={o?.v ?? ""} onChange={(e) => setOvr((s) => ({ ...s, [l.empregadoId]: { v: e.target.value, m: s[l.empregadoId]?.m || "" } }))} placeholder="R$ 0,00" className="w-24 text-right text-[12px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-0.5" />
                        </div>
                        {dv !== 0 && <input value={o?.m ?? ""} onChange={(e) => setOvr((s) => ({ ...s, [l.empregadoId]: { v: s[l.empregadoId]?.v || "", m: e.target.value } }))} placeholder="motivo do ajuste" className="w-40 text-[11px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-0.5" />}
                        {dv !== 0 && <span className={`text-[12.5px] font-bold ${tot < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>= {fmt(tot)}</span>}
                      </div>
                    ) : <span className={`font-semibold ${tot < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmt(tot)}{dv !== 0 && <span className="ml-1 text-[10px] text-indigo-500" title={o?.m || "ajuste manual"}>✎</span>}</span>}
                  </td>
                </tr>
              ); })}
              {manuais.map((m) => (
                <tr key={m.id} className="bg-amber-50/40 dark:bg-amber-950/10">
                  <td className="px-3 py-2">
                    <input value={m.nome} onChange={(e) => setManuais((arr) => arr.map((x) => x.id === m.id ? { ...x, nome: e.target.value } : x))} placeholder="Descrição / empregado" className="w-full text-[13px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-0.5" />
                    <span className="ml-1 align-middle text-[9px] font-semibold uppercase text-amber-700 dark:text-amber-300">manual</span>
                  </td>
                  <td className="text-center px-2 py-2 text-gray-300">—</td>
                  <td className="text-center px-2 py-2 text-gray-300">—</td>
                  <td className="text-center px-2 py-2 text-gray-300">—</td>
                  <td className="text-right px-3 py-2">
                    <div className="flex flex-col items-end gap-1">
                      <div className="inline-flex items-center gap-1">
                        <input value={m.v} onChange={(e) => setManuais((arr) => arr.map((x) => x.id === m.id ? { ...x, v: e.target.value } : x))} placeholder="R$ (+/−)" className="w-24 text-right text-[12px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-0.5" />
                        <button type="button" onClick={() => setManuais((arr) => arr.filter((x) => x.id !== m.id))} className="text-rose-400 hover:text-rose-600 text-sm px-1" title="Remover">✕</button>
                      </div>
                      <input value={m.m} onChange={(e) => setManuais((arr) => arr.map((x) => x.id === m.id ? { ...x, m: e.target.value } : x))} placeholder="motivo" className="w-40 text-[11px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-0.5" />
                    </div>
                  </td>
                </tr>
              ))}
            </>)}
          </tbody>
          {linhasFinais.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-gray-800/40 font-bold text-gray-800 dark:text-gray-100">
              <tr><td className="px-3 py-2" colSpan={4}>Total do ajuste (abate no próximo pagamento)</td><td className={`text-right px-3 py-2 tabular-nums ${total < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmt(total)}</td></tr>
            </tfoot>
          )}
        </table>
        {editando && (
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
            <button type="button" onClick={() => setManuais((arr) => [...arr, { id: Math.random().toString(36).slice(2, 9), nome: "", v: "", m: "" }])} className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">+ Adicionar ajuste manual</button>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        {podeConfig && <Button onClick={() => void confirmar()} disabled={salvando || !ate}>{salvando ? "Fechando…" : <span className="inline-flex items-center gap-1"><Lock size={14}/> Fechar ajuste</span>}</Button>}
      </div>

      {/* Ajustes já fechados deste pagamento */}
      {ajustesDoLote.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2 mt-2">Ajustes fechados deste mês</h3>
          <div className="space-y-1">
            {ajustesDoLote.map((a) => (
              <div key={a.id} className="text-xs flex items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
                <span className={a.status === "cancelado" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}>
                  {brDate(a.janelaDe)}–{brDate(a.janelaAte)} · {a.status === "aplicado" ? <span className="inline-flex items-center gap-1"><CheckSquare size={12}/> aplicado no pagamento</span> : a.status === "cancelado" ? "cancelado" : <span className="inline-flex items-center gap-1"><Hourglass size={12}/> pendente (abate no próximo pagamento)</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`tabular-nums font-semibold ${a.totalAjuste < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmt(a.totalAjuste)}</span>
                  {podeConfig && a.status !== "cancelado" && (
                    <button type="button" onClick={() => void reabrir(a)} className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400">Reabrir</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
