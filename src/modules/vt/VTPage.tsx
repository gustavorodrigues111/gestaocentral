import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { fmtAnoMes, nomeMes, parseAnoMes, shiftMonth } from "../../core/utils/date";
import type { Empregado, EscalaMes, Cargo, VTLote, VTLoteLinha, VTLoteEvento, Area } from "../../core/types";
import { AREAS, VT_LOTE_STATUS_LABEL } from "../../core/types";
import {
  montarLinhasLote,
  recalcularTotalLinha,
  totaisPorAreaELote,
  refMesDoLote,
  round2,
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

  // Edição inline do valor da passagem (persiste em empregado.vtValorPassagem)
  const [editingValorEmpId, setEditingValorEmpId] = useState<string | null>(null);
  const [editingValorRaw, setEditingValorRaw] = useState<string>("");
  const [savingValor, setSavingValor] = useState(false);

  // Modal de confirmação de lançamento
  const [confirmandoLote, setConfirmandoLote] = useState(false);

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

  // Linhas a renderizar: se há lote, usa as do lote; senão, preview
  const linhas: (VTLoteLinha & { semConfig?: boolean; fonteDias?: "snapshot" | "preview" | "vazio" })[] = useMemo(() => {
    if (loteAtivo) return loteAtivo.linhas;
    return linhasPreview || [];
  }, [loteAtivo, linhasPreview]);

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

  // ─── Edição inline do valor da passagem ────────────────────────────────────
  function iniciarEdicaoValor(empId: string, valorAtual: number) {
    if (loteAtivo) return; // não edita cadastro depois de lote criado
    setEditingValorEmpId(empId);
    setEditingValorRaw(valorAtual > 0 ? fmtMoneyInput(valorAtual) : "");
  }
  function cancelarEdicaoValor() {
    setEditingValorEmpId(null);
    setEditingValorRaw("");
  }
  async function salvarValorEditado() {
    if (!editingValorEmpId) return;
    const emp = empregados.find(e => e.id === editingValorEmpId);
    if (!emp) return;
    const novo = round2(parseMoneyInput(editingValorRaw));
    if (novo === (emp.vtValorPassagem || 0)) { cancelarEdicaoValor(); return; }
    setSavingValor(true);
    try {
      const updates: Partial<Empregado> = { vtValorPassagem: novo };
      if (!emp.vtPassagensPorDia || emp.vtPassagensPorDia <= 0) updates.vtPassagensPorDia = 1;
      if (novo > 0 && !emp.vtAtivo) updates.vtAtivo = true;
      await updateDoc(doc(db, "empregados", editingValorEmpId), updates);
      cancelarEdicaoValor();
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSavingValor(false);
    }
  }

  // ─── Criar lote (lançar pra pagamento) ─────────────────────────────────────
  async function criarLote() {
    if (!rid || !me || !linhasPreview) return;
    if (linhasPreview.length === 0) { alert("Nenhum empregado pra lançar."); return; }
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const linhasFinal: VTLoteLinha[] = linhasPreview.map(l => ({
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
      }));
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🚌 Vale Transporte</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeRestaurant.nome}
          </p>
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
          📅 Mês corrente
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
          {/* Navegador de mês */}
          <div className="flex items-center gap-2 mb-4">
            <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
            <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
              {nomeMes(mes)} {ano}
            </div>
            <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
            <div className="ml-3 text-[11px] text-gray-500 dark:text-gray-400">
              Desconto ref: <strong>{nomeMes(refMes.mes).slice(0,3).toLowerCase()}/{String(refMes.ano).slice(2)}</strong>
            </div>
            {statusLote && (
              <div className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${
                statusLote === "rascunho" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
                statusLote === "pago" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" :
                "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
              }`}>
                {VT_LOTE_STATUS_LABEL[statusLote]}
              </div>
            )}
          </div>

          {/* Aviso quando a prevista ainda não foi fechada */}
          {!loteAtivo && !previstaFechada && (
            <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <span className="text-base">⚠️</span>
              <div>
                <strong>Prevista de {nomeMes(mes)}/{ano} ainda não foi fechada.</strong>
                <div className="mt-1 text-xs">
                  Os valores abaixo são <em>preview</em> calculado pelo horário cadastrado de cada empregado.
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
                      <LinhaVT
                        key={l.empregadoId}
                        l={l}
                        loteRascunho={loteAtivo?.status === "rascunho"}
                        readonly={!podeEditarLinhas}
                        editingValorEmpId={editingValorEmpId}
                        editingValorRaw={editingValorRaw}
                        setEditingValorRaw={setEditingValorRaw}
                        iniciarEdicaoValor={iniciarEdicaoValor}
                        cancelarEdicaoValor={cancelarEdicaoValor}
                        salvarValorEditado={salvarValorEditado}
                        savingValor={savingValor}
                        onChangeDescAtivo={(ativo) => {
                          if (loteAtivo) editarLinhaDoLote(l.empregadoId, { ativo });
                          else setOverride(l.empregadoId, { ativo });
                        }}
                        onChangeDescManual={(v) => {
                          if (loteAtivo) editarLinhaDoLote(l.empregadoId, { descontoManual: v });
                          else setOverride(l.empregadoId, { descontoManual: v });
                        }}
                        onChangeAuxPontual={(v) => {
                          if (loteAtivo) editarLinhaDoLote(l.empregadoId, { auxPontual: v });
                          else setOverride(l.empregadoId, { auxPontual: v });
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Modal de confirmação de lançamento */}
          {confirmandoLote && linhasPreview && (
            <ConfirmacaoLoteModal
              linhas={linhasPreview}
              totalGeral={totais.geral}
              porArea={totais.porArea}
              areasComLinhas={areasComLinhas}
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
  l: VTLoteLinha & { semConfig?: boolean; fonteDias?: "snapshot" | "preview" | "vazio" };
  loteRascunho: boolean;
  readonly: boolean;
  editingValorEmpId: string | null;
  editingValorRaw: string;
  setEditingValorRaw: (s: string) => void;
  iniciarEdicaoValor: (empId: string, valorAtual: number) => void;
  cancelarEdicaoValor: () => void;
  salvarValorEditado: () => void;
  savingValor: boolean;
  onChangeDescAtivo: (ativo: boolean) => void;
  onChangeDescManual: (valor: number) => void;
  onChangeAuxPontual: (valor: number) => void;
};

function LinhaVT(props: LinhaVTProps) {
  const { l, readonly, onChangeDescAtivo, onChangeDescManual, onChangeAuxPontual } = props;
  const [editDesc, setEditDesc] = useState(false);
  const [descRaw, setDescRaw] = useState("");
  const [editAux, setEditAux] = useState(false);
  const [auxRaw, setAuxRaw] = useState("");

  function startEditDesc() {
    if (readonly) return;
    setEditDesc(true);
    setDescRaw(l.descontoManual > 0 ? fmtMoneyInput(l.descontoManual) : "");
  }
  function commitDesc() {
    const v = round2(parseMoneyInput(descRaw));
    if (v !== l.descontoManual) onChangeDescManual(v);
    setEditDesc(false);
  }
  function startEditAux() {
    if (readonly) return;
    setEditAux(true);
    setAuxRaw(l.auxPontual > 0 ? fmtMoneyInput(l.auxPontual) : "");
  }
  function commitAux() {
    const v = round2(parseMoneyInput(auxRaw));
    if (v !== l.auxPontual) onChangeAuxPontual(v);
    setEditAux(false);
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-[1.4fr_90px_80px_70px_120px_100px_100px_110px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 gap-1 md:gap-0 ${l.semConfig ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}>
      <div className="font-medium text-gray-900 dark:text-gray-100 truncate md:order-1">
        {l.nome}
        {l.semConfig && <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">⚠ sem config</span>}
        <span className="ml-2 text-[10px] text-gray-400">{l.cargoNome}</span>
      </div>

      <div className="md:text-right tabular-nums text-gray-700 dark:text-gray-300 md:order-2">
        <span className="md:hidden text-[10px] text-gray-500">Aux.fixo: </span>
        {l.auxFixoMensal > 0 ? fmtBR(l.auxFixoMensal) : "—"}
      </div>

      <div className="md:text-right tabular-nums text-gray-700 dark:text-gray-300 md:order-3">
        <span className="md:hidden text-[10px] text-gray-500">Pass/dia: </span>
        {l.passagensPorDia > 0 ? (
          <span>
            {l.passagensPorDia}x{" "}
            <span className="text-gray-400">{fmtBR(l.valorPassagem)}</span>
          </span>
        ) : (
          "—"
        )}
      </div>

      <div className="md:text-right tabular-nums md:order-4">
        <span className="md:hidden text-[10px] text-gray-500">Dias: </span>
        {l.diasTrabalhados}
      </div>

      <div className="md:text-right md:order-5">
        <span className="md:hidden text-[10px] text-gray-500">Desc.sug: </span>
        {l.descontoSugerido > 0 ? (
          <span className="inline-flex items-center gap-1.5 justify-end">
            <input
              type="checkbox"
              disabled={readonly}
              checked={!!l.descontoSugeridoAtivo}
              onChange={(e) => onChangeDescAtivo(e.target.checked)}
              title={l.descontoSugeridoJustificativa || ""}
              className="cursor-pointer"
            />
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

      <div className="md:text-right md:order-6">
        <span className="md:hidden text-[10px] text-gray-500">Desconto: </span>
        {editDesc ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={descRaw}
            onChange={(e) => setDescRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDesc();
              else if (e.key === "Escape") setEditDesc(false);
            }}
            onBlur={commitDesc}
            className="w-20 px-1 py-0.5 text-xs rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 text-right tabular-nums"
            placeholder="0,00"
          />
        ) : (
          <button
            type="button"
            disabled={readonly}
            onClick={startEditDesc}
            className={`text-xs px-1 py-0.5 rounded tabular-nums ${l.descontoManual > 0 ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-gray-400"} ${readonly ? "cursor-default" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            title="Clique pra editar"
          >
            {l.descontoManual > 0 ? `-${fmtBR(l.descontoManual)}` : "—"}
          </button>
        )}
      </div>

      <div className="md:text-right md:order-7">
        <span className="md:hidden text-[10px] text-gray-500">Aux.pontual: </span>
        {editAux ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={auxRaw}
            onChange={(e) => setAuxRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAux();
              else if (e.key === "Escape") setEditAux(false);
            }}
            onBlur={commitAux}
            className="w-20 px-1 py-0.5 text-xs rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 text-right tabular-nums"
            placeholder="0,00"
          />
        ) : (
          <button
            type="button"
            disabled={readonly}
            onClick={startEditAux}
            className={`text-xs px-1 py-0.5 rounded tabular-nums ${l.auxPontual > 0 ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-gray-400"} ${readonly ? "cursor-default" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            title="Clique pra editar"
          >
            {l.auxPontual > 0 ? `+${fmtBR(l.auxPontual)}` : "—"}
          </button>
        )}
      </div>

      <div className="md:text-right md:order-8 font-bold tabular-nums text-gray-900 dark:text-gray-100">
        <span className="md:hidden text-[10px] text-gray-500 font-normal">Total: </span>
        {fmtBR(l.total)}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ConfirmacaoLoteModal
// ────────────────────────────────────────────────────────────────────────────

type ConfirmacaoLoteModalProps = {
  linhas: VTLoteLinha[];
  totalGeral: number;
  porArea: Record<string, number>;
  areasComLinhas: Area[];
  mes: number;
  ano: number;
  onConfirm: () => void;
  onClose: () => void;
  salvando: boolean;
};

function ConfirmacaoLoteModal(props: ConfirmacaoLoteModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
          💸 Lançar pra pagamento
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Lote de <strong>{nomeMes(props.mes)} {props.ano}</strong> com <strong>{props.linhas.length}</strong> empregados.
        </p>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 mb-3 max-h-60 overflow-y-auto">
          <div className="space-y-1.5">
            {props.areasComLinhas.map(a => (
              <div key={a} className="flex justify-between text-sm border-b border-gray-100 dark:border-gray-800 pb-1.5 last:border-0">
                <span className="text-gray-700 dark:text-gray-300">{AREA_ICON[a]} {a}</span>
                <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fmtBR(props.porArea[a] || 0)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-base font-bold pt-2 mt-2 border-t-2 border-gray-200 dark:border-gray-800">
            <span className="text-gray-900 dark:text-gray-100">Total geral</span>
            <span className="tabular-nums text-indigo-700 dark:text-indigo-400">{fmtBR(props.totalGeral)}</span>
          </div>
        </div>

        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 mb-4">
          ⚠ O lote será criado em <strong>rascunho</strong>. Você ainda pode editar valores antes de marcar como pago.
          Depois de pago, só o master pode reabrir ou cancelar.
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onClose} disabled={props.salvando}>Cancelar</Button>
          <Button onClick={props.onConfirm} disabled={props.salvando}>
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
      {props.lotes.map(l => (
        <div key={l.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => props.onAbrir(l)}
                className="font-bold text-base text-indigo-700 dark:text-indigo-400 hover:underline"
              >
                {nomeMes(l.mes)} {l.ano}
              </button>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                l.status === "rascunho" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
                l.status === "pago"     ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" :
                "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
              }`}>
                {VT_LOTE_STATUS_LABEL[l.status]}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {l.linhas.length} empregado{l.linhas.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="font-bold tabular-nums text-base text-gray-900 dark:text-gray-100">
              {fmtBR(l.totalGeral)}
            </div>
          </div>
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
      ))}
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
