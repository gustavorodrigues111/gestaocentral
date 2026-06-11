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
import { VR_LOTE_STATUS_LABEL } from "../../core/types";

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

  // mês de referência pro desconto = lote.mes − 2
  const ref = useMemo(() => shiftMonth(ano, mes, -2), [ano, mes]);

  // Mudanças agendadas (ex: "desligar VR/VT a partir de 1/6") — pra projetar o
  // estado do empregado no mês do lote antes da data chegar.
  useEffect(() => {
    const q = query(collection(db, "mudancasAgendadas"), where("entityType", "==", "empregado"));
    return onSnapshot(q, (snap) => {
      setMudancasAgendadas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MudancaAgendada));
    }, (err) => {
      console.error("[VR] erro ao carregar mudanças agendadas:", err);
      setMudancasAgendadas([]);
    });
  }, []);

  // Empregados projetados pro mês do lote (aplica mudanças agendadas vigentes
  // até o 1º dia do mês).
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
    // ID canônico da escala: `${rid}_${ano}-${mes}` (igual Escala/VT). Antes
    // usava "_" no lugar do "-", lendo um doc que não existe → escala sempre
    // null → dias trabalhados zerados no VR.
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
    // Sem orderBy: a combinação where×3 + orderBy exige índice composto no
    // Firestore. Se faltar o índice, o onSnapshot dá erro e o loading nunca
    // sai (tela travada em "Carregando…"). Ordenamos por criadoEm no cliente.
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

  // Lote "ativo" do mês = rascunho ou pago mais recente (não cancelado)
  const loteAtivo = useMemo(
    () => lotes.find((l) => l.status !== "cancelado") || null,
    [lotes],
  );

  // Preview das linhas (quando ainda não há lote)
  const linhasPreview = useMemo<VRLoteLinha[]>(() => {
    if (loteAtivo) return [];
    return montarLinhasLote({
      empregados: empregadosProjetados,
      cargos,
      escala,
      escalaRefDesconto: escalaRef,
      ano,
      mes,
      refAno: ref.ano,
      refMes: ref.mes,
    });
  }, [loteAtivo, empregadosProjetados, cargos, escala, escalaRef, ano, mes, ref]);

  const linhasExibidas = loteAtivo?.linhas || linhasPreview;
  const totais = useMemo(() => calcularTotais(linhasExibidas), [linhasExibidas]);

  // Linhas pro PDF — enriquece com a forma de pagamento (Caju/PIX) do cadastro.
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
    const evento: VRLoteEvento = {
      acao: "criado",
      em: nowIso,
      por: me.id,
      porNome: me.nome,
    };
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

  // ─── Edição inline de linha (só rascunho) ─────────────────────────────────
  async function atualizarLinha(linhaIdx: number, patch: Partial<VRLoteLinha>) {
    if (!loteAtivo || loteAtivo.status !== "rascunho") return;
    const novaLinha = { ...loteAtivo.linhas[linhaIdx], ...patch };
    novaLinha.total = recalcularTotal(novaLinha);
    const novasLinhas = [...loteAtivo.linhas];
    novasLinhas[linhaIdx] = novaLinha;
    const totais = calcularTotais(novasLinhas);
    await updateDoc(doc(db, "vrLotes", loteAtivo.id), {
      linhas: novasLinhas,
      totalGeral: totais.totalGeral,
      totalPorArea: totais.totalPorArea,
      updatedAt: new Date().toISOString(),
    });
  }

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

  return (
    <div className="max-w-6xl">
      {/* Navegação de mês */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <span className="font-semibold text-lg">
            {nomeMes(mes)}/{ano}
          </span>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
          {loteAtivo && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
              loteAtivo.status === "pago"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}>
              {VR_LOTE_STATUS_LABEL[loteAtivo.status]}
            </span>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Exportar PDF — sempre disponível (preview ou lote), igual ao VT. */}
          {linhasExibidas.length > 0 && podeConfig && (
            <Button variant="secondary" size="sm" onClick={() => setShowExportPDF(true)} title="Exportar PDF do VR (por área, com forma de pagamento) e pré-visualizar">
              📄 Exportar PDF
            </Button>
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
          {loteAtivo && loteAtivo.status !== "cancelado" && podeConfig && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
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
              }}
            >
              📥 Exportar CSV pra Caju
            </Button>
          )}
        </div>
      </div>

      {/* Cards de totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Empregados" value={String(linhasExibidas.length)} />
        <StatCard label="Total geral" value={fmtBR(totais.totalGeral)} />
        {Object.entries(totais.totalPorArea).slice(0, 2).map(([area, valor]) => (
          <StatCard key={area} label={`${AREA_ICON[area] || ""} ${area}`} value={fmtBR(valor)} />
        ))}
      </div>

      {/* Linhas */}
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
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Empregado</th>
                  <th className="text-right px-3 py-2">Dias</th>
                  <th className="text-right px-3 py-2">R$/dia</th>
                  <th className="text-right px-3 py-2">Base</th>
                  <th className="text-right px-3 py-2">Aux. fixo</th>
                  <th className="text-right px-3 py-2" title="Desconto sugerido (não conta falta justificada)">
                    Desc. sug.
                  </th>
                  <th className="text-right px-3 py-2">Desc. manual</th>
                  <th className="text-right px-3 py-2">Aux. pontual</th>
                  <th className="text-right px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {linhasExibidas.map((l, i) => {
                  const editavel = !!loteAtivo && loteAtivo.status === "rascunho" && podeConfig;
                  return (
                    <tr key={l.empregadoId} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.nome}</div>
                        <div className="text-xs text-gray-500">
                          {AREA_ICON[l.area]} {l.area} · {l.cargoNome}
                        </div>
                      </td>
                      <td className="text-right px-3 py-2">{l.diasTrabalhados}</td>
                      <td className="text-right px-3 py-2">{fmtBR(l.valorDiario)}</td>
                      <td className="text-right px-3 py-2">{fmtBR(l.vrBase)}</td>
                      <td className="text-right px-3 py-2">{fmtBR(l.auxFixoMensal)}</td>
                      <td className="text-right px-3 py-2" title={l.descontoSugeridoJustificativa || ""}>
                        {editavel ? (
                          <label className="flex items-center justify-end gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={l.descontoSugeridoAtivo}
                              onChange={(e) => atualizarLinha(i, { descontoSugeridoAtivo: e.target.checked })}
                            />
                            <span className={l.descontoSugeridoAtivo ? "" : "line-through text-gray-400"}>
                              -{fmtBR(l.descontoSugerido)}
                            </span>
                          </label>
                        ) : (
                          <span className={l.descontoSugeridoAtivo ? "" : "line-through text-gray-400"}>
                            -{fmtBR(l.descontoSugerido)}
                          </span>
                        )}
                      </td>
                      <td className="text-right px-3 py-2">
                        {editavel ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            defaultValue={l.descontoManual ? l.descontoManual.toFixed(2).replace(".", ",") : ""}
                            onBlur={(e) => {
                              const v = parseMoneyInput(e.target.value);
                              if (v !== l.descontoManual) atualizarLinha(i, { descontoManual: v });
                            }}
                            placeholder="0,00"
                            className="w-20 text-right border rounded px-1 py-0.5 text-xs bg-transparent"
                          />
                        ) : (
                          fmtBR(l.descontoManual)
                        )}
                      </td>
                      <td className="text-right px-3 py-2">
                        {editavel ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            defaultValue={l.auxPontual ? l.auxPontual.toFixed(2).replace(".", ",") : ""}
                            onBlur={(e) => {
                              const v = parseMoneyInput(e.target.value);
                              if (v !== l.auxPontual) atualizarLinha(i, { auxPontual: v });
                            }}
                            placeholder="0,00"
                            className="w-20 text-right border rounded px-1 py-0.5 text-xs bg-transparent"
                          />
                        ) : (
                          fmtBR(l.auxPontual)
                        )}
                      </td>
                      <td className="text-right px-3 py-2 font-bold">{fmtBR(l.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-800 font-bold">
                  <td className="px-3 py-2" colSpan={8}>Total geral</td>
                  <td className="text-right px-3 py-2">{fmtBR(totais.totalGeral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Lista de lotes cancelados (histórico mínimo do mês) */}
      {lotes.length > 1 && (
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
            Histórico do mês
          </h2>
          <ul className="text-xs text-gray-600 space-y-1">
            {lotes.filter((l) => l.status === "cancelado").map((l) => (
              <li key={l.id}>
                ✕ Cancelado em {l.canceladoEm?.slice(0, 10)} — {l.motivoCancelamento || "(sem motivo)"} ·
                {" "}{fmtBR(l.totalGeral)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showExportPDF && (
        <ExportarVRModal
          ano={ano}
          mes={mes}
          restaurantNome={activeRestaurant.nome}
          statusLabel={loteAtivo ? VR_LOTE_STATUS_LABEL[loteAtivo.status] : "Pré-visualização"}
          linhas={linhasPdf}
          onClose={() => setShowExportPDF(false)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}
