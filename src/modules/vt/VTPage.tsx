import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { daysInMonth, fmtAnoMes, nomeMes, pad2, parseAnoMes, shiftMonth } from "../../core/utils/date";
import type { Empregado, EscalaMes, Cargo, VTLote, VTLoteLinha, VTLoteEvento, Area } from "../../core/types";
import { AREAS, VT_LOTE_STATUS_LABEL } from "../../core/types";
import {
  montarLinhasLote,
  recalcularTotalLinha,
  totaisPorAreaELote,
  refMesDoLote,
  round2,
  rangesJaCobertos,
  detectarOverlap,
  gapsDoMes,
  aplicarModoIntegral,
  aplicarModoParcial,
  type VTLoteLinhaPreview,
  type RangeCoberto,
} from "./calc";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const AREA_ICON: Record<Area, string> = {
  Bar:     "🍷",
  Cozinha: "👨‍🍳",
  Salão:   "🍽",
  Limpeza: "🧹",
};

function fmtMoneyInput(n: number): string {
  if (!n) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseMoneyInput(s: string): number {
  const clean = (s || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
}

type AbaPrincipal = "mes" | "historico";

export function VTPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "vt");
  const podeConfig = canConfig(me, rid, "vt");
  const isMaster = !!me?.isMaster;

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [aba, setAba] = useState<AbaPrincipal>("mes");

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escalaLote, setEscalaLote] = useState<EscalaMes | null>(null);
  const [escalaRef, setEscalaRef] = useState<EscalaMes | null>(null);
  const [lotesDoMes, setLotesDoMes] = useState<VTLote[]>([]);
  const [lotesHistorico, setLotesHistorico] = useState<VTLote[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Modal de confirmação de lançamento
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  // Bottom-sheet/modal de edição por linha — guarda o empregadoId
  const [editandoMobileEmpId, setEditandoMobileEmpId] = useState<string | null>(null);
  // Filtro de unidade (multi-unidades) — "" = todas
  const [filtroUnidadeId, setFiltroUnidadeId] = useState<string>("");

  // Override local de toggle desc.sugerido / valores manuais (antes de criar lote)
  // Key: empregadoId → { ativo, descontoManual, auxPontual }
  type OverrideLinha = { ativo?: boolean; descontoManual?: number; auxPontual?: number };
  const [overrides, setOverrides] = useState<Record<string, OverrideLinha>>({});
  function setOverride(empId: string, patch: OverrideLinha) {
    setOverrides(prev => ({ ...prev, [empId]: { ...prev[empId], ...patch } }));
  }
  // Reset overrides quando muda de mês
  useEffect(() => { setOverrides({}); }, [ano, mes, rid]);

  const escalaIdLote = `${rid}_${fmtAnoMes(ano, mes)}`;
  const refMes = refMesDoLote(ano, mes);
  const escalaIdRef = `${rid}_${fmtAnoMes(refMes.ano, refMes.mes)}`;

  // Empregados
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  // Cargos
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  // Escala do mês corrente (pra calcular base)
  useEffect(() => {
    if (!rid) return;
    const ref = doc(db, "escalas", escalaIdLote);
    const unsub = onSnapshot(ref, (snap) => {
      setEscalaLote(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, escalaIdLote]);

  // Escala do refMes (X-2) — pra desconto sugerido
  useEffect(() => {
    if (!rid) return;
    const ref = doc(db, "escalas", escalaIdRef);
    const unsub = onSnapshot(ref, (snap) => {
      setEscalaRef(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, escalaIdRef]);

  // Lotes do mês corrente (rascunho/pago/cancelado)
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(
      collection(db, "vtLotes"),
      where("restaurantId", "==", rid),
      where("ano", "==", ano),
      where("mes", "==", mes),
    );
    const unsub = onSnapshot(q, (snap) => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }) as VTLote);
      // Ordena por criação desc — primeiro item é o mais recente
      lista.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setLotesDoMes(lista);
      setLoading(false);
    });
    return () => unsub();
  }, [rid, ano, mes]);

  // Histórico de lotes (todos os meses, mais recentes primeiro)
  useEffect(() => {
    if (!rid) return;
    const q = query(
      collection(db, "vtLotes"),
      where("restaurantId", "==", rid),
      orderBy("criadoEm", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setLotesHistorico(snap.docs.map(d => ({ id: d.id, ...d.data() }) as VTLote));
    }, () => {
      // Se não tem índice composto ainda, faz fallback sem orderBy
      const q2 = query(collection(db, "vtLotes"), where("restaurantId", "==", rid));
      onSnapshot(q2, (snap) => {
        const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }) as VTLote);
        lista.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
        setLotesHistorico(lista);
      });
    });
    return () => unsub();
  }, [rid]);

  // O lote "ativo" do mês: priorizando ordem rascunho → pago → cancelado.
  const loteAtivo = useMemo<VTLote | null>(() => {
    if (lotesDoMes.length === 0) return null;
    const rascunho = lotesDoMes.find(l => l.status === "rascunho");
    if (rascunho) return rascunho;
    const pago = lotesDoMes.find(l => l.status === "pago");
    if (pago) return pago;
    return lotesDoMes[0]; // cancelado / outro
  }, [lotesDoMes]);

  // Linhas preview (quando não há lote ainda) — calcula do empregado + escala
  const linhasPreview = useMemo(() => {
    if (loteAtivo) return null; // já tem lote, mostra dele
    const base = montarLinhasLote(empregados, cargos, escalaLote, escalaRef, ano, mes);
    // Aplica overrides do usuário (toggle, descontos, auxPontual)
    return base.map(l => {
      const ov = overrides[l.empregadoId] || {};
      const ativo = ov.ativo ?? l.descontoSugeridoAtivo;
      const descontoManual = ov.descontoManual ?? 0;
      const auxPontual = ov.auxPontual ?? 0;
      const total = recalcularTotalLinha({
        auxFixoMensal: l.auxFixoMensal,
        vtBase: l.vtBase,
        descontoSugerido: l.descontoSugerido,
        descontoSugeridoAtivo: ativo,
        descontoManual,
        auxPontual,
      });
      return { ...l, descontoSugeridoAtivo: ativo, descontoManual, auxPontual, total };
    });
  }, [loteAtivo, empregados, cargos, escalaLote, escalaRef, ano, mes, overrides]);

  // Unidades ativas do restaurante (pra badge + filtro)
  const unidadesAtivas = useMemo(
    () => (activeRestaurant?.unidades || []).filter(u => u.ativa),
    [activeRestaurant],
  );
  const usaMultiUnidades = unidadesAtivas.length > 1;
  const unidadesById = useMemo(
    () => Object.fromEntries(unidadesAtivas.map(u => [u.id, u])),
    [unidadesAtivas],
  );
  const empregadosById = useMemo(
    () => Object.fromEntries(empregados.map(e => [e.id, e])),
    [empregados],
  );

  // Linhas a renderizar: se há lote, usa as do lote; senão, preview.
  // Aplica filtro de unidade (pela unidadePadraoId do empregado) quando há filtro ativo.
  const linhas: (VTLoteLinha & { semConfig?: boolean; semBeneficioCadastrado?: boolean; fonteDias?: "snapshot" | "preview" | "vazio" })[] = useMemo(() => {
    const base = loteAtivo ? loteAtivo.linhas : (linhasPreview || []);
    if (!filtroUnidadeId) return base;
    return base.filter(l => {
      const emp = empregadosById[l.empregadoId];
      return emp?.unidadePadraoId === filtroUnidadeId;
    });
  }, [loteAtivo, linhasPreview, filtroUnidadeId, empregadosById]);

  // Agrupa por área
  const porArea = useMemo(() => {
    const out: Record<string, typeof linhas> = {};
    for (const l of linhas) {
      if (!out[l.area]) out[l.area] = [];
      out[l.area].push(l);
    }
    for (const a of Object.keys(out)) {
      out[a].sort((a, b) => a.nome.localeCompare(b.nome));
    }
    return out;
  }, [linhas]);

  const areasComLinhas = useMemo(
    () => AREAS.filter(a => porArea[a] && porArea[a].length > 0),
    [porArea]
  );

  const totais = useMemo(() => {
    if (loteAtivo) return { porArea: loteAtivo.totalPorArea, geral: loteAtivo.totalGeral };
    return totaisPorAreaELote(linhas);
  }, [loteAtivo, linhas]);

  // Resumos auxiliares (só rascunho/preview pra visão financeira)
  const resumos = useMemo(() => {
    let auxFixoTotal = 0, vtBaseTotal = 0, descSugTotal = 0, descManualTotal = 0, auxPontualTotal = 0;
    for (const l of linhas) {
      auxFixoTotal     += l.auxFixoMensal || 0;
      vtBaseTotal      += l.vtBase || 0;
      if (l.descontoSugeridoAtivo) descSugTotal += l.descontoSugerido || 0;
      descManualTotal  += l.descontoManual || 0;
      auxPontualTotal  += l.auxPontual || 0;
    }
    return {
      auxFixo: round2(auxFixoTotal),
      vtBase: round2(vtBaseTotal),
      descSug: round2(descSugTotal),
      descManual: round2(descManualTotal),
      auxPontual: round2(auxPontualTotal),
    };
  }, [linhas]);

  // Edição inline de valorPassagem foi removida — pra editar o cadastro do
  // empregado, vá em Pessoas. A coluna "Pass/dia" do VT é só visualização.

  // ─── Criar lote (lançar pra pagamento) ─────────────────────────────────────
  // Recebe a lista de linhas a INCLUIR (pode ser subset com modos customizados).
  async function criarLote(linhasParaSalvar: VTLoteLinhaPreview[]) {
    if (!rid || !me) return;
    if (linhasParaSalvar.length === 0) { alert("Nenhum empregado pra lançar."); return; }
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const linhasFinal: VTLoteLinha[] = linhasParaSalvar.map(l => {
        const base: VTLoteLinha = {
          empregadoId: l.empregadoId,
          nome: l.nome,
          cargoNome: l.cargoNome,
          area: l.area,
          passagensPorDia: l.passagensPorDia,
          valorPassagem: l.valorPassagem,
          diasTrabalhados: l.diasTrabalhados,
          auxFixoMensal: l.auxFixoMensal,
          vtBase: l.vtBase,
          descontoSugeridoAtivo: l.descontoSugeridoAtivo,
          descontoSugerido: l.descontoSugerido,
          descontoSugeridoJustificativa: l.descontoSugeridoJustificativa,
          descontoSugeridoRefMes: l.descontoSugeridoRefMes,
          descontoManual: l.descontoManual,
          auxPontual: l.auxPontual,
          total: l.total,
          modo: l.modo || "integral",
          totalMesCompleto: l.totalMesCompleto,
          diasMesCompleto: l.diasMesCompleto,
        };
        if (l.modo === "parcial") {
          base.periodoInicio = l.periodoInicio;
          base.periodoFim = l.periodoFim;
        }
        return base;
      });
      const tot = totaisPorAreaELote(linhasFinal);
      const evento: VTLoteEvento = {
        acao: "criado",
        em: now,
        por: me.id,
        porNome: me.nome,
      };
      const lote: Omit<VTLote, "id"> = {
        restaurantId: rid,
        ano, mes,
        status: "rascunho",
        tipo: "regular",
        linhas: linhasFinal,
        totalGeral: tot.geral,
        totalPorArea: tot.porArea,
        criadoEm: now,
        criadoPor: me.id,
        criadoPorNome: me.nome,
        historico: [evento],
        updatedAt: now,
      };
      await addDoc(collection(db, "vtLotes"), lote);
      setConfirmandoLote(false);
    } catch (e) {
      console.error(e);
      alert("Erro ao criar lote: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  // Criar lote de AJUSTE — 1 linha por empregado, valor manual + justificativa.
  // NÃO valida overlap (é justamente pra corrigir diferenças).
  async function criarLoteAjuste(empregadoId: string, valor: number, justificativa: string) {
    if (!rid || !me) return;
    const emp = empregados.find(e => e.id === empregadoId);
    if (!emp) { alert("Empregado não encontrado."); return; }
    const cargo = cargos.find(c => c.id === emp.cargoId);
    const area: Area = (cargo?.area || "Salão") as Area;
    const now = new Date().toISOString();
    const linha: VTLoteLinha = {
      empregadoId: emp.id,
      nome: emp.nome,
      cargoNome: cargo?.nome || "—",
      area,
      passagensPorDia: 0,
      valorPassagem: 0,
      diasTrabalhados: 0,
      auxFixoMensal: 0,
      vtBase: 0,
      descontoSugeridoAtivo: false,
      descontoSugerido: 0,
      descontoManual: 0,
      auxPontual: 0,
      total: valor,
      modo: "ajuste",
      justificativa,
    };
    const totalGeral = valor;
    const totalPorArea: Record<string, number> = { [area]: valor };
    const evento: VTLoteEvento = { acao: "criado", em: now, por: me.id, porNome: me.nome, motivo: justificativa };
    const lote: Omit<VTLote, "id"> = {
      restaurantId: rid,
      ano, mes,
      status: "rascunho",
      tipo: "ajuste",
      linhas: [linha],
      totalGeral,
      totalPorArea,
      criadoEm: now,
      criadoPor: me.id,
      criadoPorNome: me.nome,
      historico: [evento],
      updatedAt: now,
    };
    await addDoc(collection(db, "vtLotes"), lote);
    setEditandoMobileEmpId(null);
  }

  // Marcar lote como pago
  async function marcarPago(lote: VTLote) {
    if (!me) return;
    if (!confirm(`Marcar lote de ${nomeMes(lote.mes)}/${lote.ano} como PAGO?\n\nTotal: ${fmtBR(lote.totalGeral)}`)) return;
    const now = new Date().toISOString();
    const evento: VTLoteEvento = { acao: "pago", em: now, por: me.id, porNome: me.nome };
    await updateDoc(doc(db, "vtLotes", lote.id), {
      status: "pago",
      pagoEm: now,
      pagoPor: me.id,
      pagoPorNome: me.nome,
      historico: [...(lote.historico || []), evento],
      updatedAt: now,
    });
  }

  // Reabrir lote — admin se rascunho/pago, master sempre
  async function reabrirLote(lote: VTLote) {
    if (!me) return;
    const podeReabrir = lote.status === "pago"
      ? isMaster
      : podeConfig; // rascunho/cancelado: admin
    if (!podeReabrir) {
      alert(lote.status === "pago"
        ? "Apenas o master pode reabrir um lote já pago."
        : "Sem permissão pra reabrir.");
      return;
    }
    const motivo = prompt("Motivo da reabertura:");
    if (motivo === null) return;
    const now = new Date().toISOString();
    const evento: VTLoteEvento = { acao: "reaberto", em: now, por: me.id, porNome: me.nome, motivo: motivo || undefined };
    await updateDoc(doc(db, "vtLotes", lote.id), {
      status: "rascunho",
      pagoEm: null,
      pagoPor: null,
      pagoPorNome: null,
      canceladoEm: null,
      canceladoPor: null,
      canceladoPorNome: null,
      motivoCancelamento: "",
      historico: [...(lote.historico || []), evento],
      updatedAt: now,
    });
  }

  // Cancelar lote — só master
  async function cancelarLote(lote: VTLote) {
    if (!me) return;
    if (!isMaster) { alert("Apenas o master pode cancelar lotes."); return; }
    const motivo = prompt("Motivo do cancelamento:");
    if (motivo === null) return;
    const now = new Date().toISOString();
    const evento: VTLoteEvento = { acao: "cancelado", em: now, por: me.id, porNome: me.nome, motivo: motivo || undefined };
    await updateDoc(doc(db, "vtLotes", lote.id), {
      status: "cancelado",
      canceladoEm: now,
      canceladoPor: me.id,
      canceladoPorNome: me.nome,
      motivoCancelamento: motivo || "",
      historico: [...(lote.historico || []), evento],
      updatedAt: now,
    });
  }

  // ─── Edição de linhas DENTRO DE UM LOTE EM RASCUNHO ────────────────────────
  async function editarLinhaDoLote(empId: string, patch: { ativo?: boolean; descontoManual?: number; auxPontual?: number }) {
    if (!loteAtivo || loteAtivo.status !== "rascunho") return;
    const novasLinhas = loteAtivo.linhas.map(l => {
      if (l.empregadoId !== empId) return l;
      const novo: VTLoteLinha = {
        ...l,
        descontoSugeridoAtivo: patch.ativo ?? l.descontoSugeridoAtivo,
        descontoManual: patch.descontoManual ?? l.descontoManual,
        auxPontual: patch.auxPontual ?? l.auxPontual,
      };
      novo.total = recalcularTotalLinha(novo);
      return novo;
    });
    const tot = totaisPorAreaELote(novasLinhas);
    await updateDoc(doc(db, "vtLotes", loteAtivo.id), {
      linhas: novasLinhas,
      totalGeral: tot.geral,
      totalPorArea: tot.porArea,
      updatedAt: new Date().toISOString(),
    });
  }

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const podeEditarLinhas = loteAtivo ? (loteAtivo.status === "rascunho" && podeConfig) : podeConfig;
  const statusLote = loteAtivo?.status || null;
  const previstaFechada = !!escalaLote?.previstaFechadaEm;
  // Pode lançar lote? Exige prevista fechada (snapshot oficial) e nenhum lote ativo
  const podeLancarLote = !loteAtivo && previstaFechada;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🚌 Benefícios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeRestaurant.nome}
          </p>
          {/* Filtro de unidade — pills clicáveis quando o restaurante é multi-unidades */}
          {usaMultiUnidades && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFiltroUnidadeId("")}
                className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  filtroUnidadeId === ""
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                Todas
              </button>
              {unidadesAtivas.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setFiltroUnidadeId(u.id)}
                  className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    filtroUnidadeId === u.id
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {u.nome}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
          {statusLote && (
            <div className={`text-xs px-2 py-1 rounded-full font-medium ${
              statusLote === "rascunho" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
              statusLote === "pago" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" :
              "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
            }`}>
              {VT_LOTE_STATUS_LABEL[statusLote]}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4">
        <button
          type="button"
          onClick={() => setAba("mes")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            aba === "mes"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          📅 Mês em edição
        </button>
        <button
          type="button"
          onClick={() => setAba("historico")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            aba === "historico"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          📋 Histórico ({lotesHistorico.length})
        </button>
      </div>

      {aba === "mes" && (
        <>
          {/* Indicador do refMes do desconto sugerido */}
          <div className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
            Desconto sugerido — mês de referência: <strong>{nomeMes(refMes.mes).slice(0,3).toLowerCase()}/{String(refMes.ano).slice(2)}</strong>
          </div>

          {/* Aviso quando a prevista ainda não foi fechada */}
          {!loteAtivo && !previstaFechada && (
            <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <span className="text-base">⚠️</span>
              <div>
                <strong>Prevista de {nomeMes(mes)}/{ano} ainda não foi fechada.</strong>
                <div className="mt-1 text-xs">
                  Os valores abaixo são <em>preview</em> da escala prevista — podem mudar até ela ser fechada.
                  Pra lançar o VT pra pagamento, vá em <strong>📅 Escala</strong> → ajuste o que precisar → clique em <strong>🔒 Fechar prevista</strong>.
                  Daí volte aqui pra criar o lote oficial.
                </div>
              </div>
            </div>
          )}

          {/* Cards de resumo */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            <Card label="VT base" value={fmtBR(resumos.vtBase)} />
            <Card label="Auxílio fixo" value={fmtBR(resumos.auxFixo)} />
            <Card label="Desc. sugerido" value={`-${fmtBR(resumos.descSug)}`} variant="warn" />
            <Card label="Desc. manual" value={`-${fmtBR(resumos.descManual)}`} variant="warn" />
            <Card label="Aux. pontual" value={`+${fmtBR(resumos.auxPontual)}`} variant="ok" />
          </div>

          <div className="rounded-xl border-2 border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[11px] uppercase font-bold text-indigo-700 dark:text-indigo-300 tracking-wider">Total geral do mês</div>
              <div className="text-2xl font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">{fmtBR(totais.geral)}</div>
            </div>
            {!loteAtivo && podeConfig && linhasPreview && linhasPreview.length > 0 && (
              <Button
                onClick={() => setConfirmandoLote(true)}
                disabled={!podeLancarLote}
                title={!previstaFechada ? "Feche a prevista de " + nomeMes(mes) + " em /escala primeiro" : undefined}
              >
                💸 Lançar pra pagamento
              </Button>
            )}
            {loteAtivo && loteAtivo.status === "rascunho" && podeConfig && (
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => marcarPago(loteAtivo)}>✓ Marcar como pago</Button>
                <Button variant="secondary" onClick={() => reabrirLote(loteAtivo)}>↶ Cancelar lote</Button>
              </div>
            )}
            {loteAtivo && loteAtivo.status === "pago" && (
              <div className="flex gap-2 flex-wrap">
                {isMaster && (
                  <Button variant="secondary" onClick={() => reabrirLote(loteAtivo)}>↶ Reabrir (master)</Button>
                )}
                {isMaster && (
                  <Button variant="danger" onClick={() => cancelarLote(loteAtivo)}>✕ Cancelar (master)</Button>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : linhas.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">🚌</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Ninguém com VT ativo neste mês</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Marque empregados como "VT ativo" ou defina "Auxílio fixo mensal" no cadastro.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {areasComLinhas.map(area => {
                const linhasArea = porArea[area];
                const subtotal = totais.porArea[area] || 0;
                return (
                  <div key={area} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                      <div className="font-bold text-sm text-gray-800 dark:text-gray-200">
                        {AREA_ICON[area]} {area}
                        <span className="ml-2 text-xs font-normal text-gray-500">({linhasArea.length})</span>
                      </div>
                      <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                        {fmtBR(subtotal)}
                      </div>
                    </div>

                    <div className="hidden md:grid grid-cols-[1.4fr_90px_80px_70px_120px_100px_100px_110px] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800">
                      <div>Empregado</div>
                      <div className="text-right">Aux. fixo</div>
                      <div className="text-right">Pass/dia</div>
                      <div className="text-right">Dias</div>
                      <div className="text-right">Desc. sug.</div>
                      <div className="text-right">Desconto</div>
                      <div className="text-right">Aux. pontual</div>
                      <div className="text-right">Total</div>
                    </div>

                    {linhasArea.map(l => (
                      <div key={l.empregadoId}>
                        {(() => {
                          const emp = empregadosById[l.empregadoId];
                          const unidadeNome = usaMultiUnidades && emp?.unidadePadraoId
                            ? unidadesById[emp.unidadePadraoId]?.nome
                            : undefined;
                          return (
                            <>
                              {/* Desktop: tabela com 8 colunas + ✏️ no canto direito */}
                              <LinhaVT
                                l={l}
                                onAbrirSheet={podeConfig ? () => setEditandoMobileEmpId(l.empregadoId) : undefined}
                                unidadeNome={unidadeNome}
                              />
                              {/* Mobile: card com ✏️ */}
                              <LinhaVTCard
                                l={l}
                                onAbrirSheet={podeConfig ? () => setEditandoMobileEmpId(l.empregadoId) : undefined}
                                unidadeNome={unidadeNome}
                              />
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sheet/modal por linha (mobile + desktop) — 2 tabs: editar valores e lançar ajuste */}
          {editandoMobileEmpId && (() => {
            const linha = linhas.find(x => x.empregadoId === editandoMobileEmpId);
            if (!linha) return null;
            return (
              <EditLinhaSheet
                l={linha}
                podeEditarValores={podeEditarLinhas}
                podeLancarAjuste={podeConfig}
                onClose={() => setEditandoMobileEmpId(null)}
                onChangeDescAtivo={(ativo) => {
                  if (loteAtivo) editarLinhaDoLote(linha.empregadoId, { ativo });
                  else setOverride(linha.empregadoId, { ativo });
                }}
                onChangeDescManual={(v) => {
                  if (loteAtivo) editarLinhaDoLote(linha.empregadoId, { descontoManual: v });
                  else setOverride(linha.empregadoId, { descontoManual: v });
                }}
                onChangeAuxPontual={(v) => {
                  if (loteAtivo) editarLinhaDoLote(linha.empregadoId, { auxPontual: v });
                  else setOverride(linha.empregadoId, { auxPontual: v });
                }}
                onLancarAjuste={(valor, just) => criarLoteAjuste(linha.empregadoId, valor, just)}
              />
            );
          })()}

          {/* Modal de confirmação de lançamento */}
          {confirmandoLote && linhasPreview && (
            <ConfirmacaoLoteModal
              linhasPreview={linhasPreview}
              empregados={empregados}
              escalaLote={escalaLote}
              lotesExistentes={lotesDoMes}
              mes={mes}
              ano={ano}
              onConfirm={criarLote}
              onClose={() => setConfirmandoLote(false)}
              salvando={salvando}
            />
          )}

        </>
      )}

      {aba === "historico" && (
        <HistoricoTab
          lotes={lotesHistorico}
          isMaster={isMaster}
          podeConfig={podeConfig}
          onMarcarPago={marcarPago}
          onReabrir={reabrirLote}
          onCancelar={cancelarLote}
          onAbrir={(lote) => {
            const am = parseAnoMes(`${lote.ano}-${String(lote.mes).padStart(2, "0")}`);
            setAno(am.ano);
            setMes(am.mes);
            setAba("mes");
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LinhaVT — uma linha (empregado)
// ────────────────────────────────────────────────────────────────────────────

type LinhaVTProps = {
  l: VTLoteLinha & { semConfig?: boolean; semBeneficioCadastrado?: boolean; fonteDias?: "snapshot" | "preview" | "vazio" };
  // ✏️ no canto direito — abre o EditLinhaSheet com tabs (valores + ajuste)
  onAbrirSheet?: () => void;
  // Nome da unidade do empregado (multi-unidades). undefined = single-unidade
  unidadeNome?: string;
};

// Desktop: grid horizontal com 8 colunas (tabela). Desc/aux são READ-ONLY —
// toda edição acontece via ✏️ do canto direito (abre o sheet).
function LinhaVT(props: LinhaVTProps) {
  const { l, unidadeNome } = props;

  return (
    <div className={`hidden md:grid grid-cols-[1.4fr_90px_80px_70px_120px_100px_100px_110px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 ${l.semConfig ? "bg-amber-50/40 dark:bg-amber-900/10" : l.semBeneficioCadastrado ? "bg-gray-50/40 dark:bg-gray-900/10" : ""}`}>
      <div className={`font-medium truncate ${l.semBeneficioCadastrado ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
        {l.nome}
        {l.semConfig && <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">⚠ sem config</span>}
        {l.semBeneficioCadastrado && (
          <span className="ml-2 text-[10px] italic text-gray-500 dark:text-gray-400">— sem vale transporte cadastrado</span>
        )}
        {l.modo === "parcial" && l.periodoInicio && l.periodoFim && (
          <span className="ml-2 text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
            Parcial {l.periodoInicio.slice(8)}-{l.periodoFim.slice(8)}/{l.periodoFim.slice(5, 7)}
          </span>
        )}
        <span className="ml-2 text-[10px] text-gray-400">{l.cargoNome}</span>
        {unidadeNome && (
          <span className="ml-2 text-[9px] bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
            {unidadeNome}
          </span>
        )}
      </div>

      <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">
        {l.auxFixoMensal > 0 ? fmtBR(l.auxFixoMensal) : "—"}
      </div>

      <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">
        {l.passagensPorDia > 0 ? (
          <span>
            {l.passagensPorDia}x{" "}
            <span className="text-gray-400">{fmtBR(l.valorPassagem)}</span>
          </span>
        ) : (
          "—"
        )}
      </div>

      <div className="text-right tabular-nums">
        {l.diasTrabalhados}
      </div>

      <div className="text-right">
        {l.descontoSugerido > 0 ? (
          <span className="inline-flex items-center gap-1 justify-end">
            <span
              className={`tabular-nums text-xs ${l.descontoSugeridoAtivo ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-gray-400 line-through"}`}
              title={l.descontoSugeridoJustificativa || ""}
            >
              -{fmtBR(l.descontoSugerido)}
            </span>
            <span
              className="text-[10px] text-gray-400 cursor-help"
              title={l.descontoSugeridoJustificativa || ""}
            >
              ⓘ
            </span>
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </div>

      <div className={`text-right text-xs tabular-nums ${l.descontoManual > 0 ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-gray-400"}`}>
        {l.descontoManual > 0 ? `-${fmtBR(l.descontoManual)}` : "—"}
      </div>

      <div className={`text-right text-xs tabular-nums ${l.auxPontual > 0 ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-gray-400"}`}>
        {l.auxPontual > 0 ? `+${fmtBR(l.auxPontual)}` : "—"}
      </div>

      <div className="text-right font-bold tabular-nums text-gray-900 dark:text-gray-100">
        <span className="inline-flex items-center gap-1.5 justify-end">
          {fmtBR(l.total)}
          {props.onAbrirSheet && (
            <button
              type="button"
              onClick={props.onAbrirSheet}
              title="Editar valores ou lançar ajuste"
              className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-sm px-1"
            >
              ✏️
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LinhaVTCard — versão mobile (card vertical, edição via bottom-sheet)
// ────────────────────────────────────────────────────────────────────────────

type LinhaVTCardProps = {
  l: VTLoteLinha & { semConfig?: boolean; semBeneficioCadastrado?: boolean; fonteDias?: "snapshot" | "preview" | "vazio" };
  // ✏️ no canto direito — abre o EditLinhaSheet
  onAbrirSheet?: () => void;
  // Nome da unidade (multi-unidades). undefined = single
  unidadeNome?: string;
};

function LinhaVTCard({ l, onAbrirSheet, unidadeNome }: LinhaVTCardProps) {
  // Resumos compactos — só mostra o que tem valor
  const detalhes: string[] = [];
  if (l.passagensPorDia > 0) {
    detalhes.push(`${l.diasTrabalhados} dias · ${l.passagensPorDia}x ${fmtBR(l.valorPassagem)}`);
  }
  const isParcial = l.modo === "parcial" && l.periodoInicio && l.periodoFim;
  const labelParcial = isParcial ? `Parcial ${l.periodoInicio!.slice(8)}-${l.periodoFim!.slice(8)}/${l.periodoFim!.slice(5, 7)}` : "";

  const componentes: { label: string; valor: string; cor?: string }[] = [];
  if (l.auxFixoMensal > 0) componentes.push({ label: "Aux.fixo", valor: fmtBR(l.auxFixoMensal) });
  if (l.descontoSugeridoAtivo && l.descontoSugerido > 0) componentes.push({ label: "Desc.sug", valor: `-${fmtBR(l.descontoSugerido)}`, cor: "text-rose-600 dark:text-rose-400" });
  if (l.descontoManual > 0) componentes.push({ label: "Desconto", valor: `-${fmtBR(l.descontoManual)}`, cor: "text-rose-600 dark:text-rose-400" });
  if (l.auxPontual > 0) componentes.push({ label: "Aux.pontual", valor: `+${fmtBR(l.auxPontual)}`, cor: "text-emerald-600 dark:text-emerald-400" });

  return (
    <div className={`md:hidden border-t border-gray-100 dark:border-gray-800 px-3 py-2.5 ${l.semConfig ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate flex items-center gap-1.5 flex-wrap">
            {l.nome}
            {l.semConfig && <span className="text-[10px] text-amber-700 dark:text-amber-400">⚠ sem config</span>}
            {isParcial && (
              <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
                {labelParcial}
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate flex items-center gap-1.5">
            <span>{l.cargoNome}</span>
            {unidadeNome && (
              <span className="text-[9px] bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
                {unidadeNome}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmtBR(l.total)}</div>
          {onAbrirSheet && (
            <button
              type="button"
              onClick={onAbrirSheet}
              className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-base leading-none px-1"
              title="Editar valores ou lançar ajuste"
            >
              ✏️
            </button>
          )}
        </div>
      </div>

      {l.semBeneficioCadastrado && componentes.length === 0 ? (
        <div className="mt-1 text-[11px] italic text-gray-500 dark:text-gray-400">
          Sem vale transporte cadastrado
        </div>
      ) : (
        <>
          {detalhes.length > 0 && (
            <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">
              {detalhes.join(" · ")}
            </div>
          )}
          {componentes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
              {componentes.map(c => (
                <span key={c.label} className={c.cor || "text-gray-600 dark:text-gray-400"}>
                  <span className="text-gray-500 dark:text-gray-500">{c.label}: </span>
                  {c.valor}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EditLinhaSheet — ações por linha (editar valores + lançar ajuste)
// Bottom-sheet no mobile, modal centralizado no desktop. 2 tabs.
// ────────────────────────────────────────────────────────────────────────────

type EditLinhaSheetProps = {
  l: VTLoteLinha;
  podeEditarValores: boolean;                                        // false = só tab Ajuste
  podeLancarAjuste: boolean;                                         // master sempre, admin se podeConfig
  onClose: () => void;
  onChangeDescAtivo: (ativo: boolean) => void;
  onChangeDescManual: (valor: number) => void;
  onChangeAuxPontual: (valor: number) => void;
  onLancarAjuste: (valor: number, justificativa: string) => Promise<void> | void;
};

function EditLinhaSheet(props: EditLinhaSheetProps) {
  const { l, podeEditarValores, onClose } = props;

  // Sem tabs — modo único determinado pelo contexto:
  //   - podeEditarValores=true → modo "valores" (edita o lote vigente)
  //   - podeEditarValores=false → modo "ajuste" (lote já pago, cria correção)
  const modo: "valores" | "ajuste" = podeEditarValores ? "valores" : "ajuste";

  // Estado modo "valores"
  const [descRaw, setDescRaw] = useState(l.descontoManual > 0 ? fmtMoneyInput(l.descontoManual) : "");
  const [auxRaw, setAuxRaw] = useState(l.auxPontual > 0 ? fmtMoneyInput(l.auxPontual) : "");
  const [descAtivo, setDescAtivo] = useState(l.descontoSugeridoAtivo);

  // Estado modo "ajuste"
  const [sinal, setSinal] = useState<"+" | "-">("+");
  const [valorAjusteRaw, setValorAjusteRaw] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [savingAjuste, setSavingAjuste] = useState(false);

  function aplicarValores() {
    const novoDesc = round2(parseMoneyInput(descRaw));
    const novoAux = round2(parseMoneyInput(auxRaw));
    if (descAtivo !== l.descontoSugeridoAtivo) props.onChangeDescAtivo(descAtivo);
    if (novoDesc !== l.descontoManual) props.onChangeDescManual(novoDesc);
    if (novoAux !== l.auxPontual) props.onChangeAuxPontual(novoAux);
    onClose();
  }

  const valorAjusteAbs = round2(parseMoneyInput(valorAjusteRaw));
  const valorAjusteFinal = sinal === "+" ? valorAjusteAbs : -valorAjusteAbs;
  const podeSalvarAjuste = valorAjusteAbs > 0 && justificativa.trim().length >= 3 && !savingAjuste;

  async function salvarAjuste() {
    if (!podeSalvarAjuste) return;
    setSavingAjuste(true);
    try { await props.onLancarAjuste(valorAjusteFinal, justificativa.trim()); }
    finally { setSavingAjuste(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full md:max-w-md bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">
              {modo === "valores" ? "✏️ " : "⚖ "}{l.nome}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {l.cargoNome} · {l.area} {modo === "ajuste" && <span className="ml-1">— lançar ajuste sobre lote pago</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl px-2">✕</button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-4">
          {modo === "valores" ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-xs space-y-0.5 tabular-nums">
                <div className="flex justify-between"><span className="text-gray-500">Auxílio fixo:</span><span>{fmtBR(l.auxFixoMensal)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">VT base ({l.diasTrabalhados} dias):</span><span>{fmtBR(l.vtBase)}</span></div>
              </div>

              {l.descontoSugerido > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={descAtivo}
                      onChange={(e) => setDescAtivo(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">Desconto sugerido</span>
                        <span className={`tabular-nums font-bold ${descAtivo ? "text-rose-700 dark:text-rose-400" : "text-gray-400 line-through"}`}>
                          -{fmtBR(l.descontoSugerido)}
                        </span>
                      </div>
                      {l.descontoSugeridoJustificativa && (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{l.descontoSugeridoJustificativa}</div>
                      )}
                    </div>
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Desconto adicional (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={descRaw}
                  onChange={(e) => setDescRaw(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Use pra desconto manual além do sugerido. Pra zerar, deixe vazio.
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Auxílio pontual (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={auxRaw}
                  onChange={(e) => setAuxRaw(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Valor extra a pagar nesse mês (acréscimo, ajuda de custo etc).
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-2.5">
                ⚖ Cria um lote separado de <strong>ajuste</strong>. Use pra corrigir uma diferença (faltou descontar, pagar a mais, etc) sobre um lote já pago. Não valida overlap com outros pagamentos.
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Valor (R$) *</label>
                <div className="flex gap-2">
                  <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setSinal("+")}
                      className={`px-3 py-1.5 rounded-md text-sm font-bold ${sinal === "+" ? "bg-emerald-500 text-white" : "text-gray-500"}`}
                    >+</button>
                    <button
                      type="button"
                      onClick={() => setSinal("-")}
                      className={`px-3 py-1.5 rounded-md text-sm font-bold ${sinal === "-" ? "bg-rose-500 text-white" : "text-gray-500"}`}
                    >−</button>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valorAjusteRaw}
                    onChange={(e) => setValorAjusteRaw(e.target.value)}
                    placeholder="0,00"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right tabular-nums"
                  />
                </div>
                {valorAjusteAbs > 0 && (
                  <div className={`text-[11px] mt-1 text-right tabular-nums ${sinal === "+" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                    {sinal === "+" ? "Pagar a mais" : "Cobrar / descontar"}: <strong>{sinal}{fmtBR(valorAjusteAbs)}</strong>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Justificativa *</label>
                <textarea
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  rows={3}
                  placeholder="Ex: faltou injustificado dia 28 — descontar 2 passagens"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Obrigatório (mín 3 caracteres). Vai pro histórico do lote.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex gap-2 shrink-0">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          {modo === "valores" ? (
            <Button onClick={aplicarValores} className="flex-1">Aplicar</Button>
          ) : (
            <Button onClick={salvarAjuste} disabled={!podeSalvarAjuste} className="flex-1">
              {savingAjuste ? "Criando..." : "✓ Criar lote de ajuste"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ConfirmacaoLoteModal — 2 modos: Todos integral (1 click) ou Customizar lote
// ────────────────────────────────────────────────────────────────────────────

type ConfirmacaoLoteModalProps = {
  linhasPreview: VTLoteLinhaPreview[];
  empregados: Empregado[];
  escalaLote: EscalaMes | null;
  lotesExistentes: VTLote[];          // pra checar overlap
  mes: number;
  ano: number;
  onConfirm: (linhas: VTLoteLinhaPreview[]) => Promise<void> | void;
  onClose: () => void;
  salvando: boolean;
};

// Estado de uma linha durante a edição do modal customizado
type LinhaEditavel = {
  incluida: boolean;
  modo: "integral" | "parcial";
  inicio: string;        // só faz sentido pra parcial
  fim: string;
  linha: VTLoteLinhaPreview;  // resultado calculado (vtBase, total, dias)
};

function ConfirmacaoLoteModal(props: ConfirmacaoLoteModalProps) {
  const inicioMesYmd = `${props.ano}-${pad2(props.mes)}-01`;
  const fimMesYmd    = `${props.ano}-${pad2(props.mes)}-${pad2(daysInMonth(props.ano, props.mes))}`;
  const empregadosById = useMemo(
    () => Object.fromEntries(props.empregados.map(e => [e.id, e])),
    [props.empregados],
  );

  const [modoLote, setModoLote] = useState<"simples" | "custom">("simples");

  // Estado por linha (só usado em modoLote === "custom")
  const [estado, setEstado] = useState<Record<string, LinhaEditavel>>(() => {
    const inicial: Record<string, LinhaEditavel> = {};
    for (const l of props.linhasPreview) {
      // Cobertura de overlap PRE-EXISTENTE: se já há lote regular com esse
      // empregado, sugere o gap restante como modo parcial inicial.
      const cobertos = rangesJaCobertos(l.empregadoId, props.ano, props.mes, props.lotesExistentes);
      const gaps = gapsDoMes(props.ano, props.mes, cobertos);
      const gap = gaps[0];
      const totalmenteCoberto = gaps.length === 0;
      inicial[l.empregadoId] = {
        incluida: !totalmenteCoberto,  // não inclui por default se já pago
        modo: cobertos.length > 0 && gap ? "parcial" : "integral",
        inicio: gap?.inicio || inicioMesYmd,
        fim: gap?.fim || fimMesYmd,
        linha: l,
      };
    }
    return inicial;
  });

  // Recalcula linha quando modo/range mudam
  function atualizarLinha(empId: string, patch: Partial<LinhaEditavel>) {
    setEstado(prev => {
      const cur = prev[empId];
      if (!cur) return prev;
      const next: LinhaEditavel = { ...cur, ...patch };
      const emp = empregadosById[empId];
      if (!emp) return { ...prev, [empId]: next };
      // Recalcula a linha de acordo com o modo
      if (next.modo === "parcial") {
        next.linha = aplicarModoParcial(cur.linha, emp, props.escalaLote, props.ano, props.mes, next.inicio, next.fim);
      } else if (cur.modo === "parcial" && next.modo === "integral") {
        next.linha = aplicarModoIntegral(cur.linha, emp, props.escalaLote, props.ano, props.mes);
      }
      return { ...prev, [empId]: next };
    });
  }

  // ── Validação de overlap ──
  // Por linha, lista os ranges já cobertos por outros lotes regulares.
  // Detecta conflito da linha CORRENTE (estado) com esses cobertos.
  const overlapsPorEmp = useMemo(() => {
    const out: Record<string, RangeCoberto[]> = {};
    for (const empId of Object.keys(estado)) {
      const linhaEditavel = estado[empId];
      if (!linhaEditavel.incluida) { out[empId] = []; continue; }
      const cobertos = rangesJaCobertos(empId, props.ano, props.mes, props.lotesExistentes);
      const inicioCheck = linhaEditavel.modo === "parcial" ? linhaEditavel.inicio : inicioMesYmd;
      const fimCheck    = linhaEditavel.modo === "parcial" ? linhaEditavel.fim    : fimMesYmd;
      out[empId] = detectarOverlap(inicioCheck, fimCheck, cobertos);
    }
    return out;
  }, [estado, props.lotesExistentes, props.ano, props.mes, inicioMesYmd, fimMesYmd]);

  const temOverlap = Object.values(overlapsPorEmp).some(arr => arr.length > 0);

  // ── Linhas finais a salvar (subset incluído) ──
  const linhasFinais: VTLoteLinhaPreview[] = useMemo(() => {
    if (modoLote === "simples") return props.linhasPreview;
    return Object.values(estado).filter(e => e.incluida).map(e => e.linha);
  }, [modoLote, estado, props.linhasPreview]);

  const totaisFinais = useMemo(() => {
    const tot = totaisPorAreaELote(linhasFinais);
    return tot;
  }, [linhasFinais]);

  // No modo simples, vai overlap de PEC pré-existente? Só avisamos no modo simples
  // se há gaps ZERADOS pra algum empregado (pagaria duas vezes inteiro).
  const conflitoModoSimples = useMemo(() => {
    if (modoLote !== "simples") return [] as string[];
    const conflitos: string[] = [];
    for (const l of props.linhasPreview) {
      const cobertos = rangesJaCobertos(l.empregadoId, props.ano, props.mes, props.lotesExistentes);
      if (cobertos.length > 0) conflitos.push(l.nome);
    }
    return conflitos;
  }, [modoLote, props.linhasPreview, props.lotesExistentes, props.ano, props.mes]);

  // Linhas agrupadas por área pra UI do custom
  const linhasPorArea = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const l of props.linhasPreview) {
      if (!m[l.area]) m[l.area] = [];
      m[l.area].push(l.empregadoId);
    }
    return m;
  }, [props.linhasPreview]);
  const areasOrdenadas = AREAS.filter(a => linhasPorArea[a]?.length);

  const podeConfirmar = !props.salvando
    && linhasFinais.length > 0
    && (modoLote === "custom" ? !temOverlap : conflitoModoSimples.length === 0);

  async function confirmar() {
    if (!podeConfirmar) return;
    await props.onConfirm(linhasFinais);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={props.onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            💸 Lançar pra pagamento
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Lote de <strong>{nomeMes(props.mes)} {props.ano}</strong>
          </p>

          {/* Switch de modo */}
          <div className="mt-3 inline-flex items-center bg-gray-100 dark:bg-gray-800/60 p-0.5 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setModoLote("simples")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                modoLote === "simples"
                  ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              Todos integral
            </button>
            <button
              type="button"
              onClick={() => setModoLote("custom")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                modoLote === "custom"
                  ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              Customizar lote
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {modoLote === "simples" ? (
            <>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                <strong>{props.linhasPreview.length}</strong> empregados serão pagos pelo mês inteiro.
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 mb-3">
                <div className="space-y-1.5">
                  {areasOrdenadas.map(a => (
                    <div key={a} className="flex justify-between text-sm border-b border-gray-100 dark:border-gray-800 pb-1.5 last:border-0">
                      <span className="text-gray-700 dark:text-gray-300">{AREA_ICON[a]} {a}</span>
                      <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtBR(totaisFinais.porArea[a] || 0)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-base font-bold pt-2 mt-2 border-t-2 border-gray-200 dark:border-gray-800">
                  <span className="text-gray-900 dark:text-gray-100">Total geral</span>
                  <span className="tabular-nums text-indigo-700 dark:text-indigo-400">{fmtBR(totaisFinais.geral)}</span>
                </div>
              </div>

              {conflitoModoSimples.length > 0 && (
                <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-2 mb-2">
                  ⚠ <strong>Conflito de pagamento duplicado</strong> para: {conflitoModoSimples.join(", ")}.<br />
                  Esses empregados já têm lote(s) cobrindo este mês. Use <strong>Customizar lote</strong> pra pagar só o saldo
                  ou exclua-os do lote.
                </div>
              )}

              <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                ⚠ O lote será criado em <strong>rascunho</strong>. Você pode editar valores antes de marcar como pago.
                Depois de pago, só o master pode reabrir.
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Marque quem entra no lote, e escolha o modo de cada um. <strong>Integral</strong> = mês inteiro.
                <strong className="ml-1">Parcial</strong> = só um intervalo de datas (o saldo fica pra outro lote).
              </div>

              <div className="space-y-3">
                {areasOrdenadas.map(area => (
                  <div key={area} className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                      {AREA_ICON[area]} {area}
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {linhasPorArea[area].map(empId => {
                        const e = estado[empId];
                        if (!e) return null;
                        const overlaps = overlapsPorEmp[empId] || [];
                        const cobertos = rangesJaCobertos(empId, props.ano, props.mes, props.lotesExistentes);
                        const temCobertura = cobertos.length > 0;
                        return (
                          <div key={empId} className={`px-3 py-2 ${overlaps.length > 0 ? "bg-rose-50/40 dark:bg-rose-900/10" : ""}`}>
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={e.incluida}
                                onChange={(ev) => atualizarLinha(empId, { incluida: ev.target.checked })}
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                                    {e.linha.nome}
                                    <span className="ml-2 text-[10px] text-gray-400">{e.linha.cargoNome}</span>
                                  </div>
                                  <div className="font-bold tabular-nums text-sm text-gray-900 dark:text-gray-100">
                                    {fmtBR(e.linha.total)}
                                  </div>
                                </div>

                                {e.incluida && (
                                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                    <label className="text-xs flex items-center gap-1">
                                      <input
                                        type="radio"
                                        checked={e.modo === "integral"}
                                        onChange={() => atualizarLinha(empId, { modo: "integral" })}
                                      /> Integral
                                    </label>
                                    <label className="text-xs flex items-center gap-1">
                                      <input
                                        type="radio"
                                        checked={e.modo === "parcial"}
                                        onChange={() => atualizarLinha(empId, { modo: "parcial" })}
                                      /> Parcial
                                    </label>
                                    {e.modo === "parcial" && (
                                      <>
                                        <input
                                          type="date"
                                          value={e.inicio}
                                          min={inicioMesYmd}
                                          max={fimMesYmd}
                                          onChange={(ev) => atualizarLinha(empId, { inicio: ev.target.value })}
                                          className="text-xs px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                                        />
                                        <span className="text-xs text-gray-500">a</span>
                                        <input
                                          type="date"
                                          value={e.fim}
                                          min={inicioMesYmd}
                                          max={fimMesYmd}
                                          onChange={(ev) => atualizarLinha(empId, { fim: ev.target.value })}
                                          className="text-xs px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                                        />
                                        <span className="text-[10px] text-gray-500 tabular-nums">
                                          {e.linha.diasTrabalhados} dia{e.linha.diasTrabalhados !== 1 ? "s" : ""}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                )}

                                {temCobertura && (
                                  <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                                    ⚠ Já tem pagamento em {cobertos.map(c => `${c.inicio.slice(8)}-${c.fim.slice(8)}/${pad2(props.mes)}`).join(", ")}
                                    {" "}({cobertos[0].loteStatus})
                                  </div>
                                )}
                                {overlaps.length > 0 && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                                    ✕ Conflito: o range escolhido sobrepõe pagamento existente — ajuste pra continuar.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Resumo do total */}
              <div className="mt-3 rounded-lg border-2 border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 flex justify-between items-center">
                <div>
                  <div className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-300 tracking-wider">Total do lote</div>
                  <div className="text-xs text-indigo-700 dark:text-indigo-300">
                    {linhasFinais.length} empregado{linhasFinais.length !== 1 ? "s" : ""}
                    {" · "}
                    {linhasFinais.filter(l => l.modo === "parcial").length} parcial(is)
                  </div>
                </div>
                <div className="text-xl font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">
                  {fmtBR(totaisFinais.geral)}
                </div>
              </div>

              {temOverlap && (
                <div className="mt-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-2">
                  ⚠ Existe conflito de overlap em uma ou mais linhas. Ajuste os ranges ou desmarque os empregados em conflito pra liberar o salvamento.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onClose} disabled={props.salvando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!podeConfirmar}>
            {props.salvando ? "Criando..." : "✓ Confirmar e criar lote"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HistoricoTab
// ────────────────────────────────────────────────────────────────────────────

type HistoricoTabProps = {
  lotes: VTLote[];
  isMaster: boolean;
  podeConfig: boolean;
  onMarcarPago: (l: VTLote) => void;
  onReabrir: (l: VTLote) => void;
  onCancelar: (l: VTLote) => void;
  onAbrir: (l: VTLote) => void;
};

function HistoricoTab(props: HistoricoTabProps) {
  if (props.lotes.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem lotes ainda</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {props.lotes.map(l => {
        const isAjuste = l.tipo === "ajuste";
        const qtdParciais = l.linhas.filter(x => x.modo === "parcial").length;
        return (
        <div key={l.id} className={`bg-white dark:bg-gray-900 border rounded-xl p-3 ${isAjuste ? "border-orange-200 dark:border-orange-900 bg-orange-50/30 dark:bg-orange-900/10" : "border-gray-200 dark:border-gray-800"}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => props.onAbrir(l)}
                className="font-bold text-base text-indigo-700 dark:text-indigo-400 hover:underline"
              >
                {nomeMes(l.mes)} {l.ano}
              </button>
              {isAjuste && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200">
                  ⚖ Ajuste
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                l.status === "rascunho" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
                l.status === "pago"     ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" :
                "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
              }`}>
                {VT_LOTE_STATUS_LABEL[l.status]}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {l.linhas.length} empregado{l.linhas.length !== 1 ? "s" : ""}
                {qtdParciais > 0 && (
                  <> · <span className="text-amber-700 dark:text-amber-400 font-medium">{qtdParciais} parcial{qtdParciais !== 1 ? "is" : ""}</span></>
                )}
              </span>
            </div>
            <div className={`font-bold tabular-nums text-base ${isAjuste && l.totalGeral < 0 ? "text-rose-700 dark:text-rose-400" : isAjuste ? "text-emerald-700 dark:text-emerald-400" : "text-gray-900 dark:text-gray-100"}`}>
              {isAjuste && l.totalGeral > 0 ? "+" : ""}{fmtBR(l.totalGeral)}
            </div>
          </div>
          {isAjuste && l.linhas[0]?.justificativa && (
            <div className="mt-1.5 text-xs text-orange-800 dark:text-orange-300 italic">
              "{l.linhas[0].justificativa}" — {l.linhas[0].nome}
            </div>
          )}
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-3 flex-wrap">
            <span>📝 Criado: {new Date(l.criadoEm).toLocaleDateString("pt-BR")} por {l.criadoPorNome || "?"}</span>
            {l.pagoEm && (
              <span>✓ Pago: {new Date(l.pagoEm).toLocaleDateString("pt-BR")} por {l.pagoPorNome || "?"}</span>
            )}
            {l.canceladoEm && (
              <span>✕ Cancelado: {new Date(l.canceladoEm).toLocaleDateString("pt-BR")}{l.motivoCancelamento ? ` — ${l.motivoCancelamento}` : ""}</span>
            )}
          </div>
          <div className="mt-2 flex gap-2 flex-wrap">
            {l.status === "rascunho" && props.podeConfig && (
              <>
                <Button size="sm" onClick={() => props.onMarcarPago(l)}>✓ Marcar pago</Button>
                <Button size="sm" variant="secondary" onClick={() => props.onAbrir(l)}>✎ Editar</Button>
                {props.isMaster && (
                  <Button size="sm" variant="danger" onClick={() => props.onCancelar(l)}>✕ Cancelar</Button>
                )}
              </>
            )}
            {l.status === "pago" && (
              <>
                {props.isMaster && (
                  <Button size="sm" variant="secondary" onClick={() => props.onReabrir(l)}>↶ Reabrir (master)</Button>
                )}
                {props.isMaster && (
                  <Button size="sm" variant="danger" onClick={() => props.onCancelar(l)}>✕ Cancelar (master)</Button>
                )}
              </>
            )}
            {l.status === "cancelado" && props.isMaster && (
              <Button size="sm" variant="secondary" onClick={() => props.onReabrir(l)}>↶ Reabrir (master)</Button>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Card de resumo
// ────────────────────────────────────────────────────────────────────────────

function Card({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const cls =
    variant === "ok"
      ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-900/10 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
      : variant === "warn"
      ? "border-rose-200 bg-rose-50/50 dark:bg-rose-900/10 dark:border-rose-900 text-rose-700 dark:text-rose-300"
      : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-lg border p-2.5 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70 mb-0.5">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
