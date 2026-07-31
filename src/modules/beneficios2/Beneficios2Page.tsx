// ════════════════════════════════════════════════════════════════════════════
//  Benefícios (novo) — Fase 1: aba PAGAMENTO (escala prevista).
//  VT/VR = valor diário × dias de trabalho da prevista + auxílio fixo.
//  Carrega sozinho ao trocar o mês; exige a prevista fechada pra confirmar.
//  Exporta Caju (CSV) e Pix (lista) separados. Lote congelado = histórico.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { nomeMes, pad2, shiftMonth } from "../../core/utils/date";
import { montarLinhasPagamento, totaisDoLote } from "./calc";
import { exportarCajuPag, exportarPixPag, baixarCsv } from "./exportar";
import { gerarPagamentoPDF } from "./gerarPDF";
import type { Cargo, Empregado, EscalaMes, BeneficioPagLote, BeneficioPagLinha } from "../../core/types";

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const slugify = (s: string) => (s || "rest").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function Beneficios2Page() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const rest = restaurants.find((r) => r.id === rid) || null;
  const usaVR = !!rest?.modulosAtivos?.includes("vr");
  const { can } = useCanAcao(rid);
  const isMaster = !!me?.isMaster;
  const podeVer = isMaster || can("vt", "verTime") || can("vr", "ver") || can("vt", "configurar") || can("vr", "configurar");
  const podeConfig = isMaster || can("vt", "configurar") || can("vr", "configurar");

  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [lotes, setLotes] = useState<BeneficioPagLote[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (!rid) return; return onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado))); }, [rid]);
  useEffect(() => { if (!rid) return; return onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)), (s) => setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo))); }, [rid]);
  useEffect(() => { if (!rid) return; return onSnapshot(doc(db, "escalas", `${rid}_${ano}-${pad2(mes)}`), (snap) => setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null)); }, [rid, ano, mes]);
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "beneficioPagamentos"), where("restaurantId", "==", rid), where("ano", "==", ano), where("mes", "==", mes)),
      (s) => { const l = s.docs.map((d) => ({ id: d.id, ...d.data() }) as BeneficioPagLote); l.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")); setLotes(l); },
      () => setLotes([]));
  }, [rid, ano, mes]);

  const previstaFechada = !!(escala && (escala as { previstaFechadaEm?: string | null }).previstaFechadaEm);
  const loteAtivo = useMemo(() => lotes.find((l) => l.status !== "cancelado") || null, [lotes]);
  const preview = useMemo<BeneficioPagLinha[]>(() => loteAtivo ? [] : montarLinhasPagamento(empregados, cargos, escala, ano, mes, usaVR), [loteAtivo, empregados, cargos, escala, ano, mes, usaVR]);
  const linhas = loteAtivo ? loteAtivo.linhas : preview;
  const totais = useMemo(() => totaisDoLote(linhas), [linhas]);

  function irMes(delta: number) { const { ano: a, mes: m } = shiftMonth(ano, mes, delta); setAno(a); setMes(m); }

  async function confirmarPagamento() {
    if (!rid || loteAtivo || !podeConfig) return;
    if (!previstaFechada) { alert("Feche a escala prevista deste mês antes de confirmar o pagamento."); return; }
    if (linhas.length === 0) { alert("Nada a pagar neste mês."); return; }
    setSalvando(true);
    try {
      const t = totaisDoLote(linhas);
      const nowIso = new Date().toISOString();
      const lote: Omit<BeneficioPagLote, "id"> = {
        restaurantId: rid, ano, mes, status: "pago", linhas,
        totalVt: t.totalVt, totalVr: t.totalVr, totalGeral: t.totalGeral,
        criadoEm: nowIso, criadoPor: me?.id || null, criadoPorNome: me?.nome || null,
        pagoEm: nowIso, pagoPor: me?.id || null,
        historico: [{ tipo: "pago", em: nowIso, por: me?.id || null, porNome: me?.nome || null }],
        updatedAt: nowIso,
      };
      await addDoc(collection(db, "beneficioPagamentos"), sanitizeForFirestore(lote));
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }
  async function cancelarLote() {
    if (!loteAtivo || !podeConfig) return;
    if (!confirm("Cancelar este pagamento? Volta pra prévia (o lote fica no histórico como cancelado).")) return;
    await updateDoc(doc(db, "beneficioPagamentos", loteAtivo.id), { status: "cancelado", canceladoEm: new Date().toISOString() });
  }
  function exportarCaju() {
    const r = exportarCajuPag(linhas, empregados, slugify(rest?.nome || ""), ano, mes);
    baixarCsv(r.csv, r.filename);
    if (r.ignoradas.length) alert(`${r.qtd} no CSV do Caju.\nFora (CPF inválido): ${r.ignoradas.map((x) => x.nome).join(", ")}`);
  }
  function exportarPix() {
    const r = exportarPixPag(linhas, slugify(rest?.nome || ""), ano, mes);
    if (r.qtd === 0) { alert("Ninguém marcado como Pix neste mês."); return; }
    baixarCsv(r.csv, r.filename);
    if (r.semChave.length) alert(`Atenção: sem chave Pix cadastrada: ${r.semChave.join(", ")}`);
  }

  if (!podeVer) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Benefícios.</div>;

  const temPix = linhas.some((l) => l.forma === "pix" && l.total > 0);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🎁 Benefícios <span className="text-[10px] align-middle px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">novo</span></h1>
          <p className="text-xs text-gray-500">{rest?.nome} · Pagamento (escala prevista)</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => irMes(-1)} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300">◀</button>
          <div className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-sm font-semibold text-gray-800 dark:text-gray-100 min-w-[130px] text-center">{nomeMes(mes)} {ano}</div>
          <button type="button" onClick={() => irMes(1)} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300">▶</button>
        </div>
      </header>

      {/* Status da prevista + do lote */}
      {loteAtivo ? (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 mb-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 flex-wrap">
          <span>✅ Pagamento confirmado em {new Date(loteAtivo.pagoEm || loteAtivo.criadoEm).toLocaleDateString("pt-BR")} — total {fmt(loteAtivo.totalGeral)}.</span>
          {podeConfig && <button type="button" onClick={() => void cancelarLote()} className="text-xs px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300">Cancelar pagamento</button>}
        </div>
      ) : !previstaFechada ? (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 mb-3 text-sm text-amber-800 dark:text-amber-200">
          ⚠️ A <b>escala prevista</b> de {nomeMes(mes)} ainda não está fechada. Você pode conferir a prévia, mas só dá pra <b>confirmar o pagamento</b> depois de fechar a prevista.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-3 mb-3 text-sm text-gray-600 dark:text-gray-300">Prévia em cima da escala prevista (fechada). Confira e confirme.</div>
      )}

      {/* Tabela */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Empregado</th>
              <th className="text-center px-2 py-2">Forma</th>
              <th className="text-center px-2 py-2">Dias</th>
              <th className="text-right px-3 py-2">VT</th>
              {usaVR && <th className="text-right px-3 py-2">VR</th>}
              <th className="text-right px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {linhas.length === 0 ? (
              <tr><td colSpan={usaVR ? 6 : 5} className="px-3 py-8 text-center text-gray-400">Ninguém com benefício neste mês.</td></tr>
            ) : linhas.map((l) => (
              <tr key={l.empregadoId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    {l.empregadoNome}
                    {l.semConfig && <span className="text-[9px] px-1 py-0.5 rounded-full bg-rose-100 text-rose-700" title="Ativo mas sem valor diário">sem valor</span>}
                  </div>
                  {l.cargoNome && <div className="text-[11px] text-gray-400">{l.cargoNome}</div>}
                </td>
                <td className="text-center px-2 py-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${l.forma === "pix" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"}`}>{l.forma === "pix" ? "⚡ Pix" : "🟣 Caju"}</span>
                </td>
                <td className="text-center px-2 py-2 text-gray-600 dark:text-gray-300">{l.diasTrabalhados}</td>
                <td className="text-right px-3 py-2 tabular-nums">{l.vtTotal > 0 ? fmt(l.vtTotal) : "—"}{l.vtAuxFixo > 0 && <span className="text-[10px] text-gray-400"> (+aux)</span>}</td>
                {usaVR && <td className="text-right px-3 py-2 tabular-nums">{l.vrTotal > 0 ? fmt(l.vrTotal) : "—"}</td>}
                <td className="text-right px-3 py-2 font-semibold tabular-nums">{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-gray-800/40 font-bold text-gray-800 dark:text-gray-100">
              <tr>
                <td className="px-3 py-2" colSpan={3}>Total</td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(totais.totalVt)}</td>
                {usaVR && <td className="text-right px-3 py-2 tabular-nums">{fmt(totais.totalVr)}</td>}
                <td className="text-right px-3 py-2 tabular-nums">{fmt(totais.totalGeral)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-2 mt-3 justify-end">
        {linhas.length > 0 && <Button variant="secondary" onClick={() => void gerarPagamentoPDF({ linhas, restaurantNome: rest?.nome || "", ano, mes, usaVR, totais })}>📄 Exportar PDF</Button>}
        {linhas.length > 0 && <Button variant="secondary" onClick={exportarCaju}>🟣 Exportar Caju (CSV)</Button>}
        {temPix && <Button variant="secondary" onClick={exportarPix}>⚡ Exportar Pix</Button>}
        {!loteAtivo && podeConfig && (
          <Button onClick={() => void confirmarPagamento()} disabled={salvando || !previstaFechada || linhas.length === 0}>
            {salvando ? "Confirmando…" : "✅ Confirmar pagamento"}
          </Button>
        )}
      </div>

      {/* Histórico */}
      {lotes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Histórico deste mês</h3>
          <div className="space-y-1">
            {lotes.map((l) => (
              <div key={l.id} className="text-xs flex items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
                <span className={l.status === "cancelado" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}>
                  {l.status === "cancelado" ? "🚫 Cancelado" : "✅ Pago"} · {new Date(l.criadoEm).toLocaleString("pt-BR")}
                </span>
                <span className="tabular-nums text-gray-600 dark:text-gray-300">{fmt(l.totalGeral)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
