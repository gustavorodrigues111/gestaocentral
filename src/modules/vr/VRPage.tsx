import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { nomeMes, pad2, shiftMonth } from "../../core/utils/date";
import { baixarCsvCaju, exportarLoteCaju } from "./exportarLoteCaju";
import { ExportarVRModal } from "./ExportarVRModal";
import type { VRPDFLinha } from "./gerarVRPDF";
import { calcularTotais, montarLinhasLote, recalcularTotal } from "./calc";
import type { Cargo, Empregado, EscalaMes, VRLote, VRLoteEvento, VRLoteLinha, MudancaAgendada } from "../../core/types";
import { projetarEmpregadosParaData } from "../../core/utils/empregado";
import { VR_LOTE_STATUS_LABEL, AREAS } from "../../core/types";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const AREA_ICON: Record<string, string> = {
  Bar: "🍷",
  Cozinha: "👨‍🍳",
  Salão: "🍽",
  Limpeza: "🧹",
};

function parseMoneyInput(s: string): number {
  const clean = (s || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtMoneyInput = (n: number) => (n > 0 ? n.toFixed(2).replace(".", ",") : "");

type OverrideVR = { descontoSugeridoAtivo?: boolean; descontoManual?: number; auxPontual?: number };

export function VRPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;

  const isMaster = !!me?.isMaster;
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeVer = isMaster || can("vr", "ver");
  const podeConfig = isMaster || can("vr", "configurar");

  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [mudancasAgendadas, setMudancasAgendadas] = useState<MudancaAgendada[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [escalaRef, setEscalaRef] = useState<EscalaMes | null>(null);
  const [lotes, setLotes] = useState<VRLote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExportPDF, setShowExportPDF] = useState(false);
  // Sheet de edição por linha (mobile + desktop)
  const [editandoEmpId, setEditandoEmpId] = useState<string | null>(null);

  // Overrides locais do PREVIEW (antes de lançar o lote) — mesma lógica do VT.
  const [overrides, setOverrides] = useState<Record<string, OverrideVR>>({});
  function setOverride(empId: string, patch: OverrideVR) {
    setOverrides((prev) => ({ ...prev, [empId]: { ...prev[empId], ...patch } }));
  }
  useEffect(() => { setOverrides({}); }, [ano, mes, rid]);

  // mês de referência pro desconto = lote.mes − 2
  const ref = useMemo(() => shiftMonth(ano, mes, -2), [ano, mes]);

  useEffect(() => {
    const q = query(collection(db, "mudancasAgendadas"), where("entityType", "==", "empregado"));
    return onSnapshot(q, (snap) => {
      setMudancasAgendadas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MudancaAgendada));
    }, (err) => {
      console.error("[VR] erro ao carregar mudanças agendadas:", err);
      setMudancasAgendadas([]);
    });
  }, []);

  const empregadosProjetados = useMemo(
    () => projetarEmpregadosParaData(empregados, mudancasAgendadas, `${ano}-${pad2(mes)}-01`),
    [empregados, mudancasAgendadas, ano, mes],
  );

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado));
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const escalaId = `${rid}_${ano}-${pad2(mes)}`;
    return onSnapshot(doc(db, "escalas", escalaId), (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
  }, [rid, ano, mes]);

  useEffect(() => {
    if (!rid) return;
    const refId = `${rid}_${ref.ano}-${pad2(ref.mes)}`;
    return onSnapshot(doc(db, "escalas", refId), (snap) => {
      setEscalaRef(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
  }, [rid, ref]);

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(
      collection(db, "vrLotes"),
      where("restaurantId", "==", rid),
      where("ano", "==", ano),
      where("mes", "==", mes),
    );
    return onSnapshot(q, (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VRLote);
      lista.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setLotes(lista);
      setLoading(false);
    }, (err) => {
      console.error("[VR] erro ao carregar lotes:", err);
      setLotes([]);
      setLoading(false);
    });
  }, [rid, ano, mes]);

  const loteAtivo = useMemo(
    () => lotes.find((l) => l.status !== "cancelado") || null,
    [lotes],
  );

  // Preview com overrides aplicados (quando ainda não há lote).
  const linhasPreview = useMemo<VRLoteLinha[]>(() => {
    if (loteAtivo) return [];
    const base = montarLinhasLote({
      empregados: empregadosProjetados,
      cargos,
      escala,
      escalaRefDesconto: escalaRef,
      ano,
      mes,
      refAno: ref.ano,
      refMes: ref.mes,
    });
    return base.map((l) => {
      const ov = overrides[l.empregadoId];
      if (!ov) return l;
      const merged: VRLoteLinha = {
        ...l,
        descontoSugeridoAtivo: ov.descontoSugeridoAtivo ?? l.descontoSugeridoAtivo,
        descontoManual: ov.descontoManual ?? l.descontoManual,
        auxPontual: ov.auxPontual ?? l.auxPontual,
      };
      merged.total = recalcularTotal(merged);
      return merged;
    });
  }, [loteAtivo, empregadosProjetados, cargos, escala, escalaRef, ano, mes, ref, overrides]);

  const linhasExibidas = loteAtivo?.linhas || linhasPreview;
  const totais = useMemo(() => calcularTotais(linhasExibidas), [linhasExibidas]);

  // Agrupa por área (igual ao VT).
  const porArea = useMemo(() => {
    const out: Record<string, VRLoteLinha[]> = {};
    for (const l of linhasExibidas) {
      (out[l.area] ||= []).push(l);
    }
    for (const a of Object.keys(out)) out[a].sort((x, y) => x.nome.localeCompare(y.nome));
    return out;
  }, [linhasExibidas]);
  const areasComLinhas = useMemo(
    () => AREAS.filter((a) => porArea[a] && porArea[a].length > 0),
    [porArea],
  );

  const empregadosById = useMemo(
    () => Object.fromEntries(empregados.map(e => [e.id, e])),
    [empregados],
  );
  const linhasPdf = useMemo<VRPDFLinha[]>(
    () => linhasExibidas.map(l => ({
      ...l,
      recebePeloCaju: empregadosById[l.empregadoId]?.vrRecebePeloCaju !== false,
    })),
    [linhasExibidas, empregadosById],
  );

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  async function lancarLote() {
    if (!me || !rid) return;
    if (linhasPreview.length === 0) {
      alert("Nenhum empregado elegível pra VR neste mês.");
      return;
    }
    const ok = confirm(
      `Lançar lote VR de ${nomeMes(mes)}/${ano}?\n\n` +
      `${linhasPreview.length} colaboradores — total ${fmtBR(totais.totalGeral)}\n\n` +
      `Status inicial: rascunho. Você pode editar antes de marcar como pago.`
    );
    if (!ok) return;
    const nowIso = new Date().toISOString();
    const evento: VRLoteEvento = { acao: "criado", em: nowIso, por: me.id, porNome: me.nome };
    const payload: Omit<VRLote, "id"> = {
      restaurantId: rid,
      ano, mes,
      status: "rascunho",
      linhas: linhasPreview,
      totalGeral: totais.totalGeral,
      totalPorArea: totais.totalPorArea,
      criadoEm: nowIso,
      criadoPor: me.id,
      criadoPorNome: me.nome,
      historico: [evento],
      updatedAt: nowIso,
    };
    await addDoc(collection(db, "vrLotes"), payload);
  }

  async function marcarPago(lote: VRLote) {
    if (!me) return;
    const ok = confirm(
      `Marcar lote VR de ${nomeMes(mes)}/${ano} como PAGO?\n\n` +
      `${lote.linhas.length} colaboradores — total ${fmtBR(lote.totalGeral)}\n\n` +
      `Confirme só DEPOIS de ter feito o pedido no Caju.`
    );
    if (!ok) return;
    const nowIso = new Date().toISOString();
    const evento: VRLoteEvento = { acao: "pago", em: nowIso, por: me.id, porNome: me.nome };
    await updateDoc(doc(db, "vrLotes", lote.id), {
      status: "pago",
      pagoEm: nowIso,
      pagoPor: me.id,
      pagoPorNome: me.nome,
      historico: [...(lote.historico || []), evento],
      updatedAt: nowIso,
    });
  }

  async function cancelarLote(lote: VRLote) {
    if (!me) return;
    const motivo = prompt("Motivo do cancelamento do lote VR:");
    if (motivo === null) return;
    const nowIso = new Date().toISOString();
    const evento: VRLoteEvento = motivo.trim()
      ? { acao: "cancelado", em: nowIso, por: me.id, porNome: me.nome, motivo: motivo.trim() }
      : { acao: "cancelado", em: nowIso, por: me.id, porNome: me.nome };
    try {
      await updateDoc(doc(db, "vrLotes", lote.id), {
        status: "cancelado",
        canceladoEm: nowIso,
        canceladoPor: me.id,
        canceladoPorNome: me.nome,
        motivoCancelamento: motivo.trim() || "",
        historico: [...(lote.historico || []), evento],
        updatedAt: nowIso,
      });
    } catch (e) {
      console.error("[VR cancelarLote]", e);
      alert(`Erro ao cancelar lote: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function reabrirLote(lote: VRLote) {
    if (!me) return;
    const ok = confirm(`Reabrir lote VR pra rascunho?\n\nSomente master.`);
    if (!ok) return;
    const nowIso = new Date().toISOString();
    const evento: VRLoteEvento = { acao: "reaberto", em: nowIso, por: me.id, porNome: me.nome };
    try {
      await updateDoc(doc(db, "vrLotes", lote.id), {
        status: "rascunho",
        pagoEm: null,
        pagoPor: null,
        pagoPorNome: null,
        historico: [...(lote.historico || []), evento],
        updatedAt: nowIso,
      });
    } catch (e) {
      console.error("[VR reabrirLote]", e);
      alert(`Erro ao reabrir lote: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── Edição inline de linha (rascunho → grava no lote) ────────────────────
  async function atualizarLinha(linhaIdx: number, patch: Partial<VRLoteLinha>) {
    if (!loteAtivo || loteAtivo.status !== "rascunho") return;
    const novaLinha = { ...loteAtivo.linhas[linhaIdx], ...patch };
    novaLinha.total = recalcularTotal(novaLinha);
    const novasLinhas = [...loteAtivo.linhas];
    novasLinhas[linhaIdx] = novaLinha;
    const tot = calcularTotais(novasLinhas);
    await updateDoc(doc(db, "vrLotes", loteAtivo.id), {
      linhas: novasLinhas,
      totalGeral: tot.totalGeral,
      totalPorArea: tot.totalPorArea,
      updatedAt: new Date().toISOString(),
    });
  }

  // Roteia a edição: rascunho → doc; preview → override local.
  function editarLinha(empregadoId: string, patch: OverrideVR) {
    if (loteAtivo && loteAtivo.status === "rascunho") {
      const idx = loteAtivo.linhas.findIndex((x) => x.empregadoId === empregadoId);
      if (idx >= 0) atualizarLinha(idx, patch);
    } else {
      setOverride(empregadoId, patch);
    }
  }

  function exportarCaju() {
    if (!loteAtivo || !activeRestaurant) return;
    const slug = (activeRestaurant.nome || "restaurante")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const r = exportarLoteCaju({ lote: loteAtivo, empregados, restaurantSlug: slug });
    baixarCsvCaju(r);
    const totalBR = r.totalValor.toFixed(2).replace(".", ",");
    const ignoradasTxt = r.ignoradas.length === 0
      ? "Nenhuma linha ignorada."
      : `${r.ignoradas.length} linha(s) ignorada(s):\n` +
        r.ignoradas.map(i => `  • ${i.nome}: ${i.motivo}`).join("\n");
    alert(
      `✅ CSV exportado: ${r.filename}\n\n` +
      `${r.qtdLinhasOk} colaborador(es) — R$ ${totalBR}\n\n` +
      ignoradasTxt + "\n\n" +
      `Suba no Caju (Pedidos → Importar planilha).`
    );
  }

  // Linha em edição pelo sheet
  const linhaEditando = useMemo(
    () => linhasExibidas.find((x) => x.empregadoId === editandoEmpId) || null,
    [linhasExibidas, editandoEmpId],
  );
  const editavelGlobal = podeConfig && (!loteAtivo || loteAtivo.status === "rascunho");

  // ─── Render guards ────────────────────────────────────────────────────────
  if (!activeRestaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (loadingPerfis && !isMaster) {
    return <div className="text-sm text-gray-500 py-12 text-center">Carregando permissões…</div>;
  }
  if (!podeVer && !podeConfig) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const statusLabel = loteAtivo ? VR_LOTE_STATUS_LABEL[loteAtivo.status] : "Pré-visualização";
  const isPago = loteAtivo?.status === "pago";

  return (
    <div className="max-w-6xl">
      {/* Header: unidade + navegação de mês */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full bg-indigo-600 text-white cursor-default">
            {activeRestaurant.nome}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
        </div>
      </div>

      {/* Indicador do refMes do desconto sugerido */}
      <div className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
        Desconto sugerido — mês de referência: <strong>{nomeMes(ref.mes).slice(0, 3).toLowerCase()}/{String(ref.ano).slice(2)}</strong>
      </div>

      {/* Banner de total + ações */}
      <div className={`rounded-xl border-2 p-3 mb-4 flex items-center justify-between flex-wrap gap-2 ${
        isPago
          ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20"
          : "border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20"
      }`}>
        <div>
          <div className={`text-[11px] uppercase font-bold tracking-wider ${isPago ? "text-emerald-700 dark:text-emerald-300" : "text-indigo-700 dark:text-indigo-300"}`}>
            {loteAtivo ? `Lote ${statusLabel}` : "A pagar — da escala prevista"}
          </div>
          <div className={`text-2xl font-bold tabular-nums ${isPago ? "text-emerald-900 dark:text-emerald-100" : "text-indigo-900 dark:text-indigo-100"}`}>
            {fmtBR(totais.totalGeral)} <span className={`text-sm font-medium ${isPago ? "text-emerald-700/70 dark:text-emerald-300/70" : "text-indigo-700/70 dark:text-indigo-300/70"}`}>· {linhasExibidas.length} pessoa(s)</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {linhasExibidas.length > 0 && podeConfig && (
            <Button variant="secondary" size="sm" onClick={() => setShowExportPDF(true)} title="Exportar PDF do VR (por área, com forma de pagamento)">
              📄 PDF
            </Button>
          )}
          {loteAtivo && loteAtivo.status !== "cancelado" && podeConfig && (
            <Button variant="secondary" size="sm" onClick={exportarCaju}>📥 Caju</Button>
          )}
          {!loteAtivo && podeConfig && linhasPreview.length > 0 && (
            <Button onClick={lancarLote}>💸 Lançar pra pagamento</Button>
          )}
          {loteAtivo && loteAtivo.status === "rascunho" && podeConfig && (
            <>
              <Button onClick={() => marcarPago(loteAtivo)}>✓ Marcar como pago</Button>
              <Button variant="secondary" onClick={() => cancelarLote(loteAtivo)}>↶ Cancelar lote</Button>
            </>
          )}
          {loteAtivo && loteAtivo.status === "pago" && isMaster && (
            <>
              <Button variant="secondary" onClick={() => reabrirLote(loteAtivo)}>↶ Reabrir (master)</Button>
              <Button variant="danger" onClick={() => cancelarLote(loteAtivo)}>✕ Cancelar (master)</Button>
            </>
          )}
        </div>
      </div>

      {/* Linhas agrupadas por área */}
      {loading ? (
        <div className="text-sm text-gray-500 py-6">Carregando…</div>
      ) : linhasExibidas.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🍱</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Nenhum empregado com VR ativo neste mês.
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Ative <code>vrAtivo</code> + defina <code>vrValorDiario</code> no cadastro
            de cada empregado pra eles aparecerem aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {areasComLinhas.map((area) => {
            const linhasArea = porArea[area];
            const subtotal = totais.totalPorArea[area] || 0;
            return (
              <div key={area} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                  <div className="font-bold text-sm text-gray-800 dark:text-gray-200">
                    {AREA_ICON[area]} {area}
                    <span className="ml-2 text-xs font-normal text-gray-500">({linhasArea.length})</span>
                  </div>
                  <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmtBR(subtotal)}</div>
                </div>

                <div className="hidden md:grid grid-cols-[1.4fr_90px_80px_70px_120px_100px_100px_110px] py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800">
                  <div className="px-3 flex items-center">Empregado</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">Aux. fixo</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">R$/dia</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">Dias</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">Desc. sug.</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">Desconto</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">Aux. pontual</div>
                  <div className="px-2 flex items-center justify-center text-center border-l border-gray-200 dark:border-gray-700">Total</div>
                </div>

                {linhasArea.map((l) => {
                  const recebePeloCaju = empregadosById[l.empregadoId]?.vrRecebePeloCaju !== false;
                  const onAbrir = editavelGlobal ? () => setEditandoEmpId(l.empregadoId) : undefined;
                  return (
                    <div key={l.empregadoId}>
                      <LinhaVR l={l} onAbrirSheet={onAbrir} recebePeloCaju={recebePeloCaju} />
                      <LinhaVRCard l={l} onAbrirSheet={onAbrir} recebePeloCaju={recebePeloCaju} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Histórico mínimo: lotes cancelados do mês */}
      {lotes.filter((l) => l.status === "cancelado").length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">Histórico do mês</h3>
          <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            {lotes.filter((l) => l.status === "cancelado").map((l) => (
              <li key={l.id}>
                ✕ Cancelado em {l.canceladoEm?.slice(0, 10)} — {l.motivoCancelamento || "(sem motivo)"} · {fmtBR(l.totalGeral)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sheet de edição por linha */}
      {linhaEditando && (
        <EditLinhaSheetVR
          l={linhaEditando}
          onClose={() => setEditandoEmpId(null)}
          onAplicar={(patch) => { editarLinha(linhaEditando.empregadoId, patch); setEditandoEmpId(null); }}
        />
      )}

      {showExportPDF && (
        <ExportarVRModal
          ano={ano}
          mes={mes}
          restaurantNome={activeRestaurant.nome}
          statusLabel={statusLabel}
          linhas={linhasPdf}
          onClose={() => setShowExportPDF(false)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Badge da forma de pagamento — Caju (laranja) ou PIX (azul)
// ────────────────────────────────────────────────────────────────────────────
function PagamentoBadge({ caju }: { caju: boolean }) {
  return caju ? (
    <span className="text-[9px] bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">Caju</span>
  ) : (
    <span className="text-[9px] bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">PIX</span>
  );
}

// Desktop: grid de 8 colunas. Edição via ✏️ (abre o sheet).
function LinhaVR({ l, onAbrirSheet, recebePeloCaju }: {
  l: VRLoteLinha;
  onAbrirSheet?: () => void;
  recebePeloCaju: boolean;
}) {
  const cell = "px-2 flex items-center justify-center text-center tabular-nums border-l border-gray-100 dark:border-gray-800";
  return (
    <div className="hidden md:grid grid-cols-[1.4fr_90px_80px_70px_120px_100px_100px_110px] py-2 text-sm border-t border-gray-100 dark:border-gray-800">
      <div className="px-3 flex items-center flex-wrap gap-x-1.5 gap-y-0.5 min-w-0 font-medium text-gray-900 dark:text-gray-100">
        <PagamentoBadge caju={recebePeloCaju} />
        <span className="truncate">{l.nome}</span>
        <span className="text-[10px] text-gray-400">{l.cargoNome}</span>
      </div>
      <div className={`${cell} text-gray-700 dark:text-gray-300`}>{l.auxFixoMensal > 0 ? fmtBR(l.auxFixoMensal) : "—"}</div>
      <div className={`${cell} text-gray-700 dark:text-gray-300`}>{l.valorDiario > 0 ? fmtBR(l.valorDiario) : "—"}</div>
      <div className={cell}>{l.diasTrabalhados}</div>
      <div className={cell}>
        {l.descontoSugerido > 0 ? (
          <span className="inline-flex items-center gap-1 justify-center">
            <span className={`tabular-nums text-xs ${l.descontoSugeridoAtivo ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-gray-400 line-through"}`} title={l.descontoSugeridoJustificativa || ""}>
              -{fmtBR(l.descontoSugerido)}
            </span>
            <span className="text-[10px] text-gray-400 cursor-help" title={l.descontoSugeridoJustificativa || ""}>ⓘ</span>
          </span>
        ) : <span className="text-gray-400 text-xs">—</span>}
      </div>
      <div className={`${cell} text-xs ${l.descontoManual > 0 ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-gray-400"}`}>
        {l.descontoManual > 0 ? `-${fmtBR(l.descontoManual)}` : "—"}
      </div>
      <div className={`${cell} text-xs ${l.auxPontual > 0 ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-gray-400"}`}>
        {l.auxPontual > 0 ? `+${fmtBR(l.auxPontual)}` : "—"}
      </div>
      <div className={`${cell} font-bold text-gray-900 dark:text-gray-100 gap-1.5`}>
        {fmtBR(l.total)}
        {onAbrirSheet && (
          <button type="button" onClick={onAbrirSheet} title="Editar valores" className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-sm">✏️</button>
        )}
      </div>
    </div>
  );
}

// Mobile: card vertical, edição via bottom-sheet.
function LinhaVRCard({ l, onAbrirSheet, recebePeloCaju }: {
  l: VRLoteLinha;
  onAbrirSheet?: () => void;
  recebePeloCaju: boolean;
}) {
  const detalhes: string[] = [];
  if (l.valorDiario > 0) detalhes.push(`${l.diasTrabalhados} dias · ${fmtBR(l.valorDiario)}/dia`);
  const componentes: { label: string; valor: string; cor?: string }[] = [];
  if (l.auxFixoMensal > 0) componentes.push({ label: "Aux.fixo", valor: fmtBR(l.auxFixoMensal) });
  if (l.descontoSugeridoAtivo && l.descontoSugerido > 0) componentes.push({ label: "Desc.sug", valor: `-${fmtBR(l.descontoSugerido)}`, cor: "text-rose-600 dark:text-rose-400" });
  if (l.descontoManual > 0) componentes.push({ label: "Desconto", valor: `-${fmtBR(l.descontoManual)}`, cor: "text-rose-600 dark:text-rose-400" });
  if (l.auxPontual > 0) componentes.push({ label: "Aux.pontual", valor: `+${fmtBR(l.auxPontual)}`, cor: "text-emerald-600 dark:text-emerald-400" });

  return (
    <div className="md:hidden border-t border-gray-100 dark:border-gray-800 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate flex items-center gap-1.5 flex-wrap">
            <PagamentoBadge caju={recebePeloCaju} />
            {l.nome}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{l.cargoNome}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmtBR(l.total)}</div>
          {onAbrirSheet && (
            <button type="button" onClick={onAbrirSheet} className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-base leading-none px-1" title="Editar valores">✏️</button>
          )}
        </div>
      </div>
      {detalhes.length > 0 && (
        <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">{detalhes.join(" · ")}</div>
      )}
      {componentes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
          {componentes.map(c => (
            <span key={c.label} className={c.cor || "text-gray-600 dark:text-gray-400"}>
              <span className="text-gray-500 dark:text-gray-500">{c.label}: </span>{c.valor}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EditLinhaSheetVR — edição de valores por linha (bottom-sheet/modal), igual ao VT
// ────────────────────────────────────────────────────────────────────────────
function EditLinhaSheetVR({ l, onClose, onAplicar }: {
  l: VRLoteLinha;
  onClose: () => void;
  onAplicar: (patch: OverrideVR) => void;
}) {
  const [descRaw, setDescRaw] = useState(fmtMoneyInput(l.descontoManual));
  const [auxRaw, setAuxRaw] = useState(fmtMoneyInput(l.auxPontual));
  const [descAtivo, setDescAtivo] = useState(l.descontoSugeridoAtivo);

  function aplicar() {
    const patch: OverrideVR = {};
    const novoDesc = round2(parseMoneyInput(descRaw));
    const novoAux = round2(parseMoneyInput(auxRaw));
    if (descAtivo !== l.descontoSugeridoAtivo) patch.descontoSugeridoAtivo = descAtivo;
    if (novoDesc !== l.descontoManual) patch.descontoManual = novoDesc;
    if (novoAux !== l.auxPontual) patch.auxPontual = novoAux;
    onAplicar(patch);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full md:max-w-md bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-xl shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">✏️ {l.nome}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{l.cargoNome} · {l.area}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl px-2">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-xs space-y-0.5 tabular-nums">
            <div className="flex justify-between"><span className="text-gray-500">Auxílio fixo:</span><span>{fmtBR(l.auxFixoMensal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">VR base ({l.diasTrabalhados} dias × {fmtBR(l.valorDiario)}):</span><span>{fmtBR(l.vrBase)}</span></div>
          </div>

          {l.descontoSugerido > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={descAtivo} onChange={(e) => setDescAtivo(e.target.checked)} className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">Desconto sugerido</span>
                    <span className={`tabular-nums font-bold ${descAtivo ? "text-rose-700 dark:text-rose-400" : "text-gray-400 line-through"}`}>-{fmtBR(l.descontoSugerido)}</span>
                  </div>
                  {l.descontoSugeridoJustificativa && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{l.descontoSugeridoJustificativa}</div>
                  )}
                </div>
              </label>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Desconto adicional (R$)</label>
            <input type="text" inputMode="decimal" value={descRaw} onChange={(e) => setDescRaw(e.target.value)} placeholder="0,00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Desconto manual além do sugerido. Pra zerar, deixe vazio.</div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Auxílio pontual (R$)</label>
            <input type="text" inputMode="decimal" value={auxRaw} onChange={(e) => setAuxRaw(e.target.value)} placeholder="0,00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Valor extra a pagar nesse mês (acréscimo, ajuda de custo etc).</div>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex gap-2 shrink-0">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={aplicar} className="flex-1">Aplicar</Button>
        </div>
      </div>
    </div>
  );
}
