// ════════════════════════════════════════════════════════════════════════════
//  Benefícios — lote único de VT + VR (Mobilidade + Refeição) por mês.
//  Vigente de junho/2026. Um "Lançar pra pagamento", um lote, um CSV pro Caju.
//  Lotes antigos de VT/VR seguem no histórico (telas antigas).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { nomeMes, pad2, shiftMonth } from "../../core/utils/date";
import { projetarEmpregadosParaData } from "../../core/utils/empregado";
import { refMesDoLote } from "../vt/calc";
import { montarLinhasBeneficios, totaisBeneficios, type BeneficiosLinhaPreview } from "./calc";
import { exportarBeneficiosCaju, baixarCsvBeneficios } from "./exportarCaju";
import { ExportarBeneficiosModal } from "./ExportarBeneficiosModal";
import { AREAS, BENEFICIOS_LOTE_STATUS_LABEL } from "../../core/types";
import type {
  Cargo, Empregado, EscalaMes, MudancaAgendada,
  BeneficiosLote, BeneficiosLoteLinha, BeneficiosLoteEvento, Unidade,
} from "../../core/types";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function BeneficiosPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;

  const { can } = useCanAcao(rid);
  const isMaster = !!me?.isMaster;
  const podeVer = isMaster || can("vt", "verTime") || can("vr", "ver") || can("vt", "configurar") || can("vr", "configurar");
  const podeConfig = isMaster || can("vt", "configurar") || can("vr", "configurar");

  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [mudancas, setMudancas] = useState<MudancaAgendada[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escalaLote, setEscalaLote] = useState<EscalaMes | null>(null);
  const [escalaRef, setEscalaRef] = useState<EscalaMes | null>(null);
  const [lotes, setLotes] = useState<BeneficiosLote[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [filtroUnidadeId, setFiltroUnidadeId] = useState<string>("");
  const [showPDF, setShowPDF] = useState(false);

  const ref = useMemo(() => refMesDoLote(ano, mes), [ano, mes]);

  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => {
      setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado));
    });
  }, [rid]);

  useEffect(() => {
    return onSnapshot(query(collection(db, "mudancasAgendadas"), where("entityType", "==", "empregado")), (s) => {
      setMudancas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as MudancaAgendada));
    }, () => setMudancas([]));
  }, []);

  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)), (s) => {
      setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    return onSnapshot(doc(db, "escalas", `${rid}_${ano}-${pad2(mes)}`), (snap) => {
      setEscalaLote(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
  }, [rid, ano, mes]);

  useEffect(() => {
    if (!rid) return;
    return onSnapshot(doc(db, "escalas", `${rid}_${ref.ano}-${pad2(ref.mes)}`), (snap) => {
      setEscalaRef(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
  }, [rid, ref]);

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    return onSnapshot(
      query(collection(db, "beneficiosLotes"), where("restaurantId", "==", rid), where("ano", "==", ano), where("mes", "==", mes)),
      (s) => {
        const lista = s.docs.map((d) => ({ id: d.id, ...d.data() }) as BeneficiosLote);
        lista.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
        setLotes(lista);
        setLoading(false);
      },
      (err) => { console.error("[Benefícios] erro lotes:", err); setLotes([]); setLoading(false); },
    );
  }, [rid, ano, mes]);

  const empregadosProjetados = useMemo(
    () => projetarEmpregadosParaData(empregados, mudancas, `${ano}-${pad2(mes)}-01`),
    [empregados, mudancas, ano, mes],
  );

  const loteAtivo = useMemo(() => lotes.find((l) => l.status !== "cancelado") || null, [lotes]);

  const linhasPreview = useMemo<BeneficiosLinhaPreview[]>(() => {
    if (loteAtivo) return [];
    return montarLinhasBeneficios({ empregados: empregadosProjetados, cargos, escalaLote, escalaRef, ano, mes });
  }, [loteAtivo, empregadosProjetados, cargos, escalaLote, escalaRef, ano, mes]);

  const empById = useMemo(() => Object.fromEntries(empregados.map((e) => [e.id, e])), [empregados]);
  const unidadesAtivas = useMemo<Unidade[]>(() => (activeRestaurant?.unidades || []).filter((u) => u.ativa), [activeRestaurant]);
  const usaMultiUnidades = unidadesAtivas.length > 1;

  // Linhas a exibir (lote ou preview) + filtro de unidade pela unidadePadrão.
  const linhas = useMemo(() => {
    const base = loteAtivo ? loteAtivo.linhas : linhasPreview;
    if (!filtroUnidadeId) return base;
    return base.filter((l) => empById[l.empregadoId]?.unidadePadraoId === filtroUnidadeId);
  }, [loteAtivo, linhasPreview, filtroUnidadeId, empById]);

  const totais = useMemo(() => totaisBeneficios(linhas as BeneficiosLinhaPreview[]), [linhas]);

  function navegarMes(delta: number) {
    const nx = shiftMonth(ano, mes, delta);
    setAno(nx.ano); setMes(nx.mes);
  }

  // Converte preview → linhas de lote (limpa extras do vt preview).
  function toLoteLinhas(prev: BeneficiosLinhaPreview[]): BeneficiosLoteLinha[] {
    return prev.filter((l) => l.total > 0).map((l) => ({
      empregadoId: l.empregadoId,
      nome: l.nome,
      cargoNome: l.cargoNome,
      area: l.area,
      vt: {
        empregadoId: l.vt.empregadoId, nome: l.vt.nome, cargoNome: l.vt.cargoNome, area: l.vt.area,
        passagensPorDia: l.vt.passagensPorDia, valorPassagem: l.vt.valorPassagem, diasTrabalhados: l.vt.diasTrabalhados,
        auxFixoMensal: l.vt.auxFixoMensal, vtBase: l.vt.vtBase,
        descontoSugeridoAtivo: l.vt.descontoSugeridoAtivo, descontoSugerido: l.vt.descontoSugerido,
        descontoSugeridoJustificativa: l.vt.descontoSugeridoJustificativa, descontoSugeridoRefMes: l.vt.descontoSugeridoRefMes,
        descontoManual: l.vt.descontoManual, auxPontual: l.vt.auxPontual, total: l.vt.total,
      },
      vr: l.vr,
      vtRecebePeloCaju: l.vtRecebePeloCaju,
      vrRecebePeloCaju: l.vrRecebePeloCaju,
      total: l.total,
    }));
  }

  async function lancar() {
    if (!rid || !me) return;
    const linhasFinal = toLoteLinhas(linhasPreview);
    if (linhasFinal.length === 0) { alert("Nenhum empregado com benefício pra lançar."); return; }
    if (!confirm(`Lançar lote de Benefícios de ${nomeMes(mes)}/${ano}?\n\nMobilidade: ${fmtBR(totais.totalMobilidade)}\nRefeição: ${fmtBR(totais.totalRefeicao)}\nTotal: ${fmtBR(totais.totalGeral)}`)) return;
    setSalvando(true);
    try {
      const nowIso = new Date().toISOString();
      const t = totaisBeneficios(linhasPreview.filter((l) => l.total > 0));
      const evento: BeneficiosLoteEvento = { acao: "criado", em: nowIso, por: me.id, porNome: me.nome };
      const lote: Omit<BeneficiosLote, "id"> = {
        restaurantId: rid, ano, mes, status: "rascunho",
        linhas: linhasFinal,
        totalGeral: t.totalGeral, totalMobilidade: t.totalMobilidade, totalRefeicao: t.totalRefeicao, totalPorArea: t.totalPorArea,
        criadoEm: nowIso, criadoPor: me.id, criadoPorNome: me.nome,
        historico: [evento], updatedAt: nowIso,
      };
      await addDoc(collection(db, "beneficiosLotes"), lote);
    } catch (e) {
      alert("Erro ao lançar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  async function marcarPago(lote: BeneficiosLote) {
    if (!me) return;
    if (!confirm(`Marcar lote de ${nomeMes(lote.mes)}/${lote.ano} como PAGO?\n\nTotal: ${fmtBR(lote.totalGeral)}`)) return;
    const nowIso = new Date().toISOString();
    const evento: BeneficiosLoteEvento = { acao: "pago", em: nowIso, por: me.id, porNome: me.nome };
    await updateDoc(doc(db, "beneficiosLotes", lote.id), {
      status: "pago", pagoEm: nowIso, pagoPor: me.id, pagoPorNome: me.nome,
      historico: [...(lote.historico || []), evento], updatedAt: nowIso,
    });
  }

  async function reabrir(lote: BeneficiosLote) {
    if (!me) return;
    if (lote.status === "pago" && !isMaster) { alert("Só master reabre lote pago."); return; }
    const motivo = prompt("Motivo da reabertura:");
    if (motivo === null) return;
    const nowIso = new Date().toISOString();
    const evento: BeneficiosLoteEvento = motivo.trim()
      ? { acao: "reaberto", em: nowIso, por: me.id, porNome: me.nome, motivo: motivo.trim() }
      : { acao: "reaberto", em: nowIso, por: me.id, porNome: me.nome };
    await updateDoc(doc(db, "beneficiosLotes", lote.id), {
      status: "rascunho", pagoEm: null, pagoPor: null, pagoPorNome: null,
      canceladoEm: null, canceladoPor: null, canceladoPorNome: null, motivoCancelamento: "",
      historico: [...(lote.historico || []), evento], updatedAt: nowIso,
    });
  }

  async function cancelar(lote: BeneficiosLote) {
    if (!me || !isMaster) { alert("Só master cancela lotes."); return; }
    const motivo = prompt("Motivo do cancelamento:");
    if (motivo === null) return;
    const nowIso = new Date().toISOString();
    const evento: BeneficiosLoteEvento = motivo.trim()
      ? { acao: "cancelado", em: nowIso, por: me.id, porNome: me.nome, motivo: motivo.trim() }
      : { acao: "cancelado", em: nowIso, por: me.id, porNome: me.nome };
    await updateDoc(doc(db, "beneficiosLotes", lote.id), {
      status: "cancelado", canceladoEm: nowIso, canceladoPor: me.id, canceladoPorNome: me.nome,
      motivoCancelamento: motivo.trim() || "",
      historico: [...(lote.historico || []), evento], updatedAt: nowIso,
    });
  }

  function exportarCsv() {
    if (!loteAtivo) { alert("Crie o lote (Lançar pra pagamento) antes de exportar o CSV."); return; }
    const slug = (activeRestaurant?.nome || "restaurante").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const r = exportarBeneficiosCaju({ lote: loteAtivo, empregados, restaurantSlug: slug });
    baixarCsvBeneficios(r);
    const ign = r.ignoradas.length === 0 ? "Nenhuma linha ignorada." : `${r.ignoradas.length} ignorada(s):\n` + r.ignoradas.map((i) => `  • ${i.nome}: ${i.motivo}`).join("\n");
    alert(`✅ CSV exportado: ${r.filename}\n\n${r.qtdLinhasOk} colaborador(es)\nMobilidade: ${fmtBR(r.totalMobilidade)}\nRefeição: ${fmtBR(r.totalRefeicao)}\n\n${ign}\n\nConfira no Caju (Pedidos → Importar planilha).`);
  }

  if (!activeRestaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const statusLabel = loteAtivo ? BENEFICIOS_LOTE_STATUS_LABEL[loteAtivo.status] : "Pré-visualização";
  const areasComLinhas = AREAS.filter((a) => linhas.some((l) => l.area === a));

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🎁 Benefícios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{activeRestaurant.nome} · VT (Mobilidade) + VR (Refeição) num lote só</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <span className="font-semibold text-lg">{nomeMes(mes)}/{ano}</span>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${loteAtivo?.status === "pago" ? "bg-emerald-100 text-emerald-700" : loteAtivo ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
            {statusLabel}
          </span>
          {usaMultiUnidades && (
            <select value={filtroUnidadeId} onChange={(e) => setFiltroUnidadeId(e.target.value)} className="ml-2 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">🏢 Todas as unidades</option>
              {unidadesAtivas.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {linhas.length > 0 && podeConfig && (
            <Button variant="secondary" size="sm" onClick={() => setShowPDF(true)} title="Exportar PDF (preview)">📄 Exportar PDF</Button>
          )}
          {loteAtivo && podeConfig && (
            <Button variant="secondary" size="sm" onClick={exportarCsv} title="CSV único pro Caju">📥 Exportar CSV Caju</Button>
          )}
          {!loteAtivo && podeConfig && linhasPreview.some((l) => l.total > 0) && (
            <Button onClick={lancar} disabled={salvando}>{salvando ? "Lançando…" : "💸 Lançar pra pagamento"}</Button>
          )}
          {loteAtivo?.status === "rascunho" && podeConfig && (
            <>
              <Button onClick={() => marcarPago(loteAtivo)}>✓ Marcar como pago</Button>
              {isMaster && <Button variant="secondary" onClick={() => cancelar(loteAtivo)}>✕ Cancelar</Button>}
            </>
          )}
          {loteAtivo?.status === "pago" && isMaster && (
            <>
              <Button variant="secondary" onClick={() => reabrir(loteAtivo)}>↶ Reabrir (master)</Button>
              <Button variant="danger" onClick={() => cancelar(loteAtivo)}>✕ Cancelar (master)</Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Empregados" value={String(linhas.length)} />
        <StatCard label="Mobilidade (VT)" value={fmtBR(totais.totalMobilidade)} />
        <StatCard label="Refeição (VR)" value={fmtBR(totais.totalRefeicao)} />
        <StatCard label="Total geral" value={fmtBR(totais.totalGeral)} />
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-6">Carregando…</div>
      ) : linhas.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500">
          Nenhum empregado com benefício neste mês/recorte.
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1.6fr_90px_110px_110px_110px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-200 dark:border-gray-800">
            <div>Empregado</div><div className="text-center">Pgto</div>
            <div className="text-right">Mobilidade</div><div className="text-right">Refeição</div><div className="text-right">Total</div>
          </div>
          {areasComLinhas.map((area) => (
            <div key={area}>
              <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800/50 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">{area}</div>
              {linhas.filter((l) => l.area === area).map((l) => {
                const pg = pgto(l);
                return (
                  <div key={l.empregadoId} className="grid grid-cols-[1.6fr_90px_110px_110px_110px] gap-2 px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 items-center">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{l.nome}</span>
                      <span className="ml-2 text-[10px] text-gray-400">{l.cargoNome}</span>
                    </div>
                    <div className="text-center">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${pg.cls}`}>{pg.texto}</span>
                    </div>
                    <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{l.vt.total > 0 ? fmtBR(l.vt.total) : "—"}</div>
                    <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{l.vr.total > 0 ? fmtBR(l.vr.total) : "—"}</div>
                    <div className="text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">{fmtBR(l.total)}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {showPDF && (
        <ExportarBeneficiosModal
          ano={ano} mes={mes}
          restaurantNome={activeRestaurant.nome}
          statusLabel={statusLabel}
          linhas={linhas as BeneficiosLinhaPreview[]}
          onClose={() => setShowPDF(false)}
        />
      )}
    </div>
  );
}

function pgto(l: { vt: { total: number }; vr: { total: number }; vtRecebePeloCaju: boolean; vrRecebePeloCaju: boolean }): { texto: string; cls: string } {
  const m = new Set<string>();
  if (l.vt.total > 0) m.add(l.vtRecebePeloCaju ? "Caju" : "PIX");
  if (l.vr.total > 0) m.add(l.vrRecebePeloCaju ? "Caju" : "PIX");
  if (m.size === 0) return { texto: "—", cls: "bg-gray-100 text-gray-400 dark:bg-gray-800" };
  if (m.size === 1) {
    const x = [...m][0];
    return x === "Caju"
      ? { texto: "Caju", cls: "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300" }
      : { texto: "PIX", cls: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300" };
  }
  return { texto: "Caju/PIX", cls: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200" };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}
