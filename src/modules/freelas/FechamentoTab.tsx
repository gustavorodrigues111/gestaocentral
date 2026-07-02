import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import {
  AREAS, type Area, type Empregado, type EscalaMes, type FreelaMensalistaLinha,
  type FreelaPagamento, type FreelaPagamentoResumoPessoa, type FreelaShift,
  type Gorjeta, type Restaurant,
} from "../../core/types";
import {
  VALORES_DIARIA, VALORES_HORA,
  calcHoras, calcTotal, fmtBR, fmtHoras, historicoDaPessoa, proximoNumeroLote,
} from "./helpers";
import { diasNoMes, diasTrabalhadosMensalista, gorjetaMensalDe, mensalistasAtivosNoMes } from "./mensalista";
import { nomeMes } from "../../core/utils/date";

// Desloca a competência "YYYY-MM" em ±N meses.
function shiftMes(comp: string, delta: number): string {
  const [a, m] = comp.split("-").map(Number);
  const d = new Date(a, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
import { LotePDFPreviewModal } from "./LotePDFPreviewModal";
import { HorarioModal } from "./HorarioModal";
import { Modal } from "../../core/ui/Modal";

type Props = {
  restaurantId: string;
  restaurant: Restaurant | null;
  shifts: FreelaShift[];
  pagamentos: FreelaPagamento[];
  podeEditar: boolean;
};

const AREA_ICONE: Record<Area, string> = {
  Bar:     "🍷",
  Cozinha: "🍳",
  Salão:   "🍽️",
  Limpeza: "🧼",
};

// Tab Fechamento — EXCLUSIVA do DP. Mesma estrutura visual de Lançamentos:
// blocos por área, tabela no desktop, lista densa no mobile.
//   Seções (em ordem):
//     1. Lotes pendentes (banner amarelo)
//     2. Aguardando precificação (status=aberto + entrada+saída)
//     3. Prontos pra lote      (status=fechamento sem lote)
export function FechamentoTab({ restaurantId, restaurant, shifts, pagamentos, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  // PIX ao vivo das pessoas do restaurante — o snapshot do turno pode estar
  // vazio (turno criado antes da chave ser cadastrada). Resolve por id/CPF.
  const [pixMap, setPixMap] = useState<{ byId: Record<string, string>; byCpf: Record<string, string> }>({ byId: {}, byCpf: {} });
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId));
    return onSnapshot(q, (snap) => {
      const byId: Record<string, string> = {}, byCpf: Record<string, string> = {};
      snap.forEach((d) => {
        const p = d.data() as { pix?: string; cpf?: string };
        if (p.pix) { byId[d.id] = p.pix; if (p.cpf) byCpf[String(p.cpf).replace(/\D/g, "")] = p.pix; }
      });
      setPixMap({ byId, byCpf });
    });
  }, [restaurantId]);
  const pixDe = (s: FreelaShift): string =>
    s.pixSnapshot || (s.pessoaId ? pixMap.byId[s.pessoaId] : "") || (s.cpfSnapshot ? pixMap.byCpf[String(s.cpfSnapshot).replace(/\D/g, "")] : "") || "";

  // ── Freela MENSALISTA — fechamento por competência ──────────────────────
  const [competencia, setCompetencia] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [ano, mes] = useMemo(() => { const [a, m] = competencia.split("-"); return [Number(a), Number(m)]; }, [competencia]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [gorjetasMes, setGorjetasMes] = useState<Gorjeta[]>([]);
  const [mensSel, setMensSel] = useState<Set<string>>(new Set());
  type MensInput = { remuneracao: string; modo: "bruto" | "liquido"; desconto: string; descontoDesc: string; acrescimo: string; acrescimoDesc: string };
  const [mensInputs, setMensInputs] = useState<Record<string, MensInput>>({});
  const inputDe = (id: string): MensInput => mensInputs[id] || { remuneracao: "", modo: "liquido", desconto: "", descontoDesc: "", acrescimo: "", acrescimoDesc: "" };
  const setInput = (id: string, patch: Partial<MensInput>) => setMensInputs(prev => ({ ...prev, [id]: { ...inputDe(id), ...patch } }));

  useEffect(() => {
    if (!restaurantId) return;
    return onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", restaurantId)),
      (snap) => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() } as Empregado))));
  }, [restaurantId]);
  useEffect(() => {
    if (!restaurantId) return;
    return onSnapshot(doc(db, "escalas", `${restaurantId}_${competencia}`),
      (snap) => setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null), () => setEscala(null));
  }, [restaurantId, competencia]);
  useEffect(() => {
    if (!restaurantId) return;
    return onSnapshot(query(collection(db, "gorjetas"), where("restaurantId", "==", restaurantId)),
      (snap) => setGorjetasMes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Gorjeta)).filter(g => (g.date || "").startsWith(competencia))));
  }, [restaurantId, competencia]);

  const mensalistas = useMemo(() => mensalistasAtivosNoMes(empregados, ano, mes), [empregados, ano, mes]);
  const dnm = diasNoMes(ano, mes);

  // Linhas calculadas dos mensalistas (pra exibir e pra montar o lote).
  const mensLinhas = useMemo<FreelaMensalistaLinha[]>(() => {
    return mensalistas.map((e) => {
      const inp = inputDe(e.id);
      const dias = diasTrabalhadosMensalista(e.id, escala, ano, mes);
      const gorj = gorjetaMensalDe(e.id, gorjetasMes);
      const remMes = parseFloat(inp.remuneracao.replace(",", ".")) || 0;
      const proporcional = Math.round((remMes * dias / dnm) * 100) / 100;
      const gorjetaAplicada = inp.modo === "bruto" ? gorj.bruto : gorj.liquido;
      const desconto = parseFloat(inp.desconto.replace(",", ".")) || 0;
      const acrescimo = parseFloat(inp.acrescimo.replace(",", ".")) || 0;
      const total = Math.round((proporcional + gorjetaAplicada + acrescimo - desconto) * 100) / 100;
      return {
        empregadoId: e.id, nome: e.nome, pix: pixMap.byId[e.id] || null, cpf: e.cpf ?? null,
        competencia, diasTrabalhados: dias, diasNoMes: dnm,
        remuneracaoMes: remMes, remuneracaoProporcional: proporcional,
        gorjetaModo: inp.modo, gorjetaLiquido: gorj.liquido, gorjetaBruto: gorj.bruto, gorjetaAplicada,
        desconto, descontoDesc: inp.descontoDesc.trim() || undefined,
        acrescimo, acrescimoDesc: inp.acrescimoDesc.trim() || undefined,
        total,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensalistas, escala, gorjetasMes, mensInputs, ano, mes, dnm, competencia, pixMap]);

  const mensLinhasSel = useMemo(() => mensLinhas.filter(l => mensSel.has(l.empregadoId)), [mensLinhas, mensSel]);

  // Aguardando precificação: operacional fechou (tem entrada+saída) e DP ainda
  // não confirmou. Status="aberto".
  const aPrecificar = useMemo(
    () => shifts.filter((s) => s.status === "aberto" && s.entrada && s.saida),
    [shifts],
  );

  // Subconjunto que JÁ tem valor selecionado (valorTipo + valorUnit) — pode
  // ser confirmado em lote sem precisar abrir um por um.
  const aPrecificarComValor = useMemo(
    () => aPrecificar.filter((s) => !!s.valorTipo && (s.valorUnit ?? 0) > 0),
    [aPrecificar],
  );

  async function confirmarTodosComValor() {
    if (!me || aPrecificarComValor.length === 0) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      for (const s of aPrecificarComValor) {
        const horas = calcHoras(s.entrada, s.saida, s.intervalo);
        const total = calcTotal(s.valorTipo, s.valorUnit, horas);
        batch.update(doc(db, "freelaShifts", s.id), {
          status: "fechamento",
          horas,
          totalCalc: total,
          confirmadoEm: now,
          confirmadoPor: me.id,
          updatedAt: now,
        });
      }
      await batch.commit();
    } catch (e) {
      console.error("[confirmarTodosComValor]", e);
      alert(`Erro ao confirmar em lote: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  // Prontos pra lote: status="fechamento" sem lote ainda. Inclui os
  // CANCELADOS (zerados) — entram no lote só pra registro.
  const prontosLote = useMemo(
    () => shifts.filter((s) => (s.status === "fechamento" || s.status === "cancelado") && !s.lotePagamentoId),
    [shifts],
  );

  // Cancela um turno lançado errado: status "cancelado", zera o valor e
  // registra o motivo. Some da precificação e entra em "Prontos pra lote"
  // zerado, podendo ir num lote só pra registro. Reversível via "Reabrir".
  async function cancelarShift(s: FreelaShift) {
    const motivo = prompt(
      `Cancelar o turno de ${s.nomeSnapshot} (${fmtDataCurta(s.date)})?\n\n` +
      `Ele fica zerado e entra em "Prontos pra lote" só pra registro.\n\nMotivo:`,
    );
    if (motivo === null) return;
    try {
      await updateDoc(doc(db, "freelaShifts", s.id), {
        status: "cancelado",
        totalCalc: 0,
        motivoCancelamento: motivo.trim() || "",
        canceladoEm: new Date().toISOString(),
        canceladoPor: me?.id || null,
        canceladoPorNome: me?.nome || null,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[cancelarShift]", e);
      alert(`Erro ao cancelar turno: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function toggle(id: string) {
    setSelecionados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleGrupo(grupo: FreelaShift[]) {
    setSelecionados((prev) => {
      const n = new Set(prev);
      const todos = grupo.every((s) => n.has(s.id));
      if (todos) grupo.forEach((s) => n.delete(s.id));
      else grupo.forEach((s) => n.add(s.id));
      return n;
    });
  }
  function marcarTodos() {
    if (selecionados.size === prontosLote.length) setSelecionados(new Set());
    else setSelecionados(new Set(prontosLote.map((s) => s.id)));
  }

  const totaisSelec = useMemo(() => {
    const sel = prontosLote.filter((s) => selecionados.has(s.id));
    const total = sel.reduce((acc, s) => acc + (s.totalCalc || 0), 0);
    const pessoas = new Set(sel.map((s) => s.pessoaId || s.empregadoId || s.nomeSnapshot));
    return { qtd: sel.length, total, pessoas: pessoas.size };
  }, [prontosLote, selecionados]);

  async function gerarLote() {
    if (!me) return;
    const selecShifts = prontosLote.filter((s) => selecionados.has(s.id));
    if (!selecShifts.length && !mensLinhasSel.length) { alert("Selecione ao menos 1 turno ou 1 mensalista."); return; }
    const totalMens = mensLinhasSel.reduce((a, l) => a + l.total, 0);
    const partes = [
      selecShifts.length ? `${selecShifts.length} turno(s)` : "",
      mensLinhasSel.length ? `${mensLinhasSel.length} mensalista(s)` : "",
    ].filter(Boolean).join(" + ");
    if (!confirm(`Gerar lote com ${partes} — ${fmtBR(totaisSelec.total + totalMens)}?`)) return;
    setSalvando(true);
    try {
      const resumoMap = new Map<string, FreelaPagamentoResumoPessoa>();
      for (const s of selecShifts) {
        const key = s.pessoaId ? `pes:${s.pessoaId}` : s.empregadoId ? `emp:${s.empregadoId}` : `nome:${s.nomeSnapshot}`;
        // IMPORTANTE: Firestore rejeita undefined nos campos. Usa null no
        // lugar (cpf/pix/whatsapp podem faltar pra shifts antigos sem snapshot).
        const r = resumoMap.get(key) || {
          pessoaId: s.pessoaId || null,
          empregadoId: s.empregadoId || null,
          nome: s.nomeSnapshot,
          pix: pixDe(s) || null,
          cpf: s.cpfSnapshot ?? null,
          whatsapp: s.whatsappSnapshot ?? null,
          qtdShifts: 0, totalHoras: 0, totalValor: 0,
        };
        r.qtdShifts += 1;
        r.totalHoras += s.horas || 0;
        r.totalValor += s.totalCalc || 0;
        resumoMap.set(key, r);
      }
      const pessoasResumo = Array.from(resumoMap.values())
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((r) => ({
          ...r,
          totalHoras: Math.round(r.totalHoras * 100) / 100,
          totalValor: Math.round(r.totalValor * 100) / 100,
        }));
      const now = new Date().toISOString();
      const numero = proximoNumeroLote(pagamentos);
      const totalGeral = pessoasResumo.reduce((a, p) => a + p.totalValor, 0) + mensLinhasSel.reduce((a, l) => a + l.total, 0);

      const payload: Omit<FreelaPagamento, "id"> = {
        restaurantId,
        numero,
        ...(obs.trim() ? { observacao: obs.trim() } : {}),
        shiftIds: selecShifts.map((s) => s.id),
        pessoasResumo,
        ...(mensLinhasSel.length ? { mensalistas: mensLinhasSel } : {}),
        totalGeral: Math.round(totalGeral * 100) / 100,
        qtdShifts: selecShifts.length,
        qtdPessoas: pessoasResumo.length + mensLinhasSel.length,
        status: "pendente",
        criadoEm: now,
        criadoPor: me.id,
        criadoPorNome: me.nome,
      };
      const ref = await addDoc(collection(db, "freelaPagamentos"), payload as Record<string, unknown>);
      const batch = writeBatch(db);
      for (const s of selecShifts) {
        batch.update(doc(db, "freelaShifts", s.id), { lotePagamentoId: ref.id, updatedAt: now });
      }
      await batch.commit();
      setSelecionados(new Set());
      setMensSel(new Set());
      setObs("");
      alert(`Lote ${numero} criado.`);
    } catch (e) {
      console.error("[gerarLote]", e);
      alert(`Erro ao gerar lote: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  const lotesPendentes = pagamentos.filter((p) => p.status === "pendente");

  return (
    <div className="space-y-6">
      {lotesPendentes.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
            ⏳ {lotesPendentes.length} lote(s) pendente(s) de pagamento
          </div>
          <div className="space-y-1 text-xs text-amber-700 dark:text-amber-200">
            {lotesPendentes.map((p) => (
              <LotePendenteRow
                key={p.id}
                lote={p}
                shifts={shifts}
                restaurant={restaurant}
                podeEditar={podeEditar}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── Aguardando precificação ─── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            🏷️ Aguardando precificação
            <span className="ml-2 text-[11px] text-gray-500 font-normal">
              ({aPrecificar.length} — operacional fechou, falta DP precificar)
            </span>
          </h3>
          {aPrecificarComValor.length > 0 && podeEditar && (
            <Button
              size="sm"
              onClick={confirmarTodosComValor}
              disabled={salvando}
              title="Confirma de uma vez todos os turnos que já têm valor selecionado"
            >
              ✅ Confirmar {aPrecificarComValor.length} com valor
            </Button>
          )}
        </div>
        {aPrecificar.length === 0 ? (
          <EmptyState texto="Nenhum turno aguardando precificação." />
        ) : (
          <AreaGroups
            shifts={aPrecificar}
            renderRowDesktop={(s) => <PrecificarRowDesktop key={s.id} shift={s} podeEditar={podeEditar} todosShifts={shifts} semPix={!pixDe(s)} onCancelar={() => cancelarShift(s)} />}
            renderRowMobile={(s)  => <PrecificarRowMobile  key={s.id} shift={s} podeEditar={podeEditar} todosShifts={shifts} semPix={!pixDe(s)} onCancelar={() => cancelarShift(s)} />}
            headerDesktop={
              <tr className="text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-800/30">
                <th className="px-4 py-2 w-24">Data</th>
                <th className="px-2 py-2">Pessoa</th>
                <th className="px-2 py-2">Horário</th>
                <th className="px-2 py-2">Tarifa</th>
                <th className="px-2 py-2 w-24 text-right">Total</th>
                <th className="px-4 py-2 w-32 text-right">Ação</th>
              </tr>
            }
          />
        )}
      </section>

      {/* ─── Freela mensalistas ─── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            🗓️ Freela mensalistas
            <span className="ml-2 text-[11px] text-gray-500 font-normal">remuneração do mês (proporcional aos dias) + gorjeta</span>
          </h3>
          <div className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
            <button type="button" onClick={() => setCompetencia(shiftMes(competencia, -1))}
              className="px-2.5 py-1.5 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400" aria-label="Mês anterior">◀</button>
            <span className="px-3 text-sm font-semibold text-gray-900 dark:text-gray-100 min-w-[120px] text-center">{nomeMes(mes)}/{ano}</span>
            <button type="button" onClick={() => setCompetencia(shiftMes(competencia, 1))}
              className="px-2.5 py-1.5 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400" aria-label="Próximo mês">▶</button>
          </div>
        </div>
        {mensalistas.length === 0 ? (
          <EmptyState texto={`Nenhum freela mensalista ativo em ${nomeMes(mes)}/${ano}. (Marque "Freela mensalista" no cadastro do empregado com o período.)`} />
        ) : (
          <div className="space-y-2">
            {mensLinhas.map((l) => {
              const inp = inputDe(l.empregadoId);
              const sel = mensSel.has(l.empregadoId);
              return (
                <div key={l.empregadoId} className={`rounded-xl border p-3 ${sel ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-900/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {podeEditar && (
                      <input type="checkbox" checked={sel} onChange={() => setMensSel(s => { const n = new Set(s); if (n.has(l.empregadoId)) n.delete(l.empregadoId); else n.add(l.empregadoId); return n; })} className="w-4 h-4 accent-indigo-600" />
                    )}
                    <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{l.nome}</span>
                    <span className="text-[11px] text-gray-500">{l.diasTrabalhados}/{dnm} dias · gorjeta líq {fmtBR(l.gorjetaLiquido)} · bruto {fmtBR(l.gorjetaBruto)}</span>
                    <span className="ml-auto text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtBR(l.total)}</span>
                  </div>
                  {podeEditar && (
                    <div className="mt-2 grid sm:grid-cols-4 gap-2">
                      <label className="text-xs">
                        <span className="text-gray-500">Remuneração do mês</span>
                        <input value={inp.remuneracao} onChange={(e) => setInput(l.empregadoId, { remuneracao: e.target.value })} inputMode="decimal" placeholder="0,00"
                          className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                        <span className="text-[10px] text-gray-400">proporcional: {fmtBR(l.remuneracaoProporcional)}</span>
                      </label>
                      <div className="text-xs">
                        <span className="text-gray-500">Gorjeta</span>
                        <div className="mt-0.5 inline-flex rounded-md bg-gray-100 dark:bg-gray-800 p-0.5 w-full">
                          {(["liquido", "bruto"] as const).map(m => (
                            <button key={m} type="button" onClick={() => setInput(l.empregadoId, { modo: m })}
                              className={`flex-1 px-2 py-1 text-xs font-semibold rounded ${inp.modo === m ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>
                              {m === "liquido" ? "Líquido" : "Bruto"}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] text-gray-400">aplica {fmtBR(l.gorjetaAplicada)}</span>
                      </div>
                      <label className="text-xs">
                        <span className="text-gray-500">Desconto</span>
                        <input value={inp.desconto} onChange={(e) => setInput(l.empregadoId, { desconto: e.target.value })} inputMode="decimal" placeholder="0,00"
                          className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                        <input value={inp.descontoDesc} onChange={(e) => setInput(l.empregadoId, { descontoDesc: e.target.value })} placeholder="motivo (opcional)"
                          className="w-full mt-1 px-2 py-1 text-[11px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                      </label>
                      <label className="text-xs">
                        <span className="text-gray-500">Acréscimo</span>
                        <input value={inp.acrescimo} onChange={(e) => setInput(l.empregadoId, { acrescimo: e.target.value })} inputMode="decimal" placeholder="0,00"
                          className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                        <input value={inp.acrescimoDesc} onChange={(e) => setInput(l.empregadoId, { acrescimoDesc: e.target.value })} placeholder="motivo (opcional)"
                          className="w-full mt-1 px-2 py-1 text-[11px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Prontos pra lote ─── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            💰 Prontos pra lote
            <span className="ml-2 text-[11px] text-gray-500 font-normal">
              ({prontosLote.length} · {fmtBR(prontosLote.reduce((a, s) => a + (s.totalCalc || 0), 0))})
            </span>
          </h3>
          {prontosLote.length > 0 && podeEditar && (
            <button type="button" onClick={marcarTodos} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
              {selecionados.size === prontosLote.length ? "Desmarcar todos" : "Marcar todos"}
            </button>
          )}
        </div>
        {prontosLote.length === 0 ? (
          <EmptyState texto="Nenhum turno pronto pra lote. Precifique acima primeiro." />
        ) : (
          <AreaGroups
            shifts={prontosLote}
            onToggleGrupo={(rows) => toggleGrupo(rows)}
            grupoMarcado={(rows) => rows.length > 0 && rows.every((s) => selecionados.has(s.id))}
            grupoAlgumMarcado={(rows) => rows.some((s) => selecionados.has(s.id))}
            podeEditar={podeEditar}
            renderRowDesktop={(s) => (
              <ProntoLoteRowDesktop key={s.id} shift={s} podeEditar={podeEditar}
                checked={selecionados.has(s.id)} onToggle={() => toggle(s.id)} onCancelar={() => cancelarShift(s)} />
            )}
            renderRowMobile={(s) => (
              <ProntoLoteRowMobile key={s.id} shift={s} podeEditar={podeEditar}
                checked={selecionados.has(s.id)} onToggle={() => toggle(s.id)} onCancelar={() => cancelarShift(s)} />
            )}
            headerDesktop={
              <tr className="text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-800/30">
                <th className="px-4 py-2 w-10"></th>
                <th className="px-2 py-2 w-24">Data</th>
                <th className="px-2 py-2">Pessoa</th>
                <th className="px-2 py-2">Horário</th>
                <th className="px-2 py-2 w-24">Tarifa</th>
                <th className="px-2 py-2 w-28 text-right">Total</th>
                <th className="px-4 py-2 w-24 text-right">Ação</th>
              </tr>
            }
          />
        )}

        {podeEditar && (prontosLote.length > 0 || mensalistas.length > 0) && (
          <div className="mt-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 p-3">
            <div className="text-sm font-medium text-indigo-900 dark:text-indigo-200 mb-2">
              💰 {totaisSelec.qtd} turno(s){mensLinhasSel.length > 0 ? ` + ${mensLinhasSel.length} mensalista(s)` : ""} ·{" "}
              <strong>{fmtBR(totaisSelec.total + mensLinhasSel.reduce((a, l) => a + l.total, 0))}</strong>
            </div>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              placeholder="Observação do lote (opcional)…"
              className="w-full px-2 py-1.5 text-xs rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 dark:text-gray-100 mb-2"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={gerarLote} disabled={salvando || (totaisSelec.qtd === 0 && mensLinhasSel.length === 0)}>
                {salvando ? "Gerando…" : "Gerar lote de pagamento"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-xs text-gray-500">
      {texto}
    </div>
  );
}

// ── Agrupamento por área (compartilhado) ─────────────────────────────────
type AreaGroupsProps = {
  shifts: FreelaShift[];
  renderRowDesktop: (s: FreelaShift) => React.ReactNode;
  renderRowMobile:  (s: FreelaShift) => React.ReactNode;
  headerDesktop: React.ReactNode;
  // Checkbox de seleção por grupo (opcional)
  onToggleGrupo?: (rows: FreelaShift[]) => void;
  grupoMarcado?: (rows: FreelaShift[]) => boolean;
  grupoAlgumMarcado?: (rows: FreelaShift[]) => boolean;
  podeEditar?: boolean;
};

function AreaGroups({
  shifts, renderRowDesktop, renderRowMobile, headerDesktop,
  onToggleGrupo, grupoMarcado, grupoAlgumMarcado, podeEditar,
}: AreaGroupsProps) {
  const grupos = useMemo(() => {
    const map = new Map<string, FreelaShift[]>();
    for (const s of shifts) {
      const key = s.area || "__sem_area__";
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        a.date.localeCompare(b.date) || a.nomeSnapshot.localeCompare(b.nomeSnapshot),
      );
    }
    const out: { area: string; nome: string; icone: string; rows: FreelaShift[] }[] = [];
    for (const a of AREAS) {
      const arr = map.get(a);
      if (arr && arr.length) out.push({ area: a, nome: a, icone: AREA_ICONE[a], rows: arr });
    }
    const sem = map.get("__sem_area__");
    if (sem && sem.length) {
      out.unshift({ area: "__sem_area__", nome: "Sem área (legado)", icone: "⚠️", rows: sem });
    }
    return out;
  }, [shifts]);

  return (
    <div className="space-y-4">
      {grupos.map((g) => {
        const totalGrupo = g.rows.reduce((a, s) => a + (s.totalCalc || 0), 0);
        const checked = grupoMarcado ? grupoMarcado(g.rows) : false;
        const indet = grupoAlgumMarcado ? (grupoAlgumMarcado(g.rows) && !checked) : false;
        return (
          <section key={g.area} className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
            <header className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100 cursor-pointer">
                {onToggleGrupo && (
                  <input
                    type="checkbox"
                    checked={checked}
                    ref={(el) => { if (el) el.indeterminate = indet; }}
                    onChange={() => onToggleGrupo(g.rows)}
                    disabled={!podeEditar}
                  />
                )}
                {g.icone} {g.nome.toUpperCase()}
              </label>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                {g.rows.length} turno(s) · {fmtBR(totalGrupo)}
              </div>
            </header>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>{headerDesktop}</thead>
                <tbody>{g.rows.map(renderRowDesktop)}</tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-800">
              {g.rows.map(renderRowMobile)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function fmtDataCurta(ymd: string): string {
  const [_a, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

// ─── Linhas: Aguardando precificação ─────────────────────────────────────

// Tarifas predeterminadas — auto-inicialização pela última do mesmo freela.
// Se valor não bate com nenhum preset, ativa modo "Outro" automaticamente.
function valoresPraTipo(tipo: "hora" | "diaria"): readonly number[] {
  return tipo === "hora" ? VALORES_HORA : VALORES_DIARIA;
}

function usePrecificar(shift: FreelaShift, todosShifts: FreelaShift[]) {
  const { pessoa: me } = useAuth();
  const hist = historicoDaPessoa(shift, todosShifts);

  // Inicialização: se shift já tem valor → usa ele.
  // Senão → puxa último valor do mesmo freela como sugestão automática.
  const tipoInicial: "hora" | "diaria" =
    shift.valorTipo || hist.ultimoTipo || "hora";
  const valorInicial: number =
    shift.valorUnit || (hist.ultimoTipo === tipoInicial ? hist.ultimoValor || 0 : 0);

  const [valorTipo, setValorTipo] = useState<"hora" | "diaria">(tipoInicial);
  const [valorUnit, setValorUnit] = useState<number>(valorInicial);
  const [saving, setSaving] = useState(false);

  // "Outro" ativo quando valor não bate com nenhum preset do tipo atual
  const presets = valoresPraTipo(valorTipo);
  const outroAtivo =
    valorUnit > 0 && !presets.some((p) => Math.abs(p - valorUnit) < 0.01);

  useEffect(() => {
    setValorTipo(shift.valorTipo || hist.ultimoTipo || "hora");
    setValorUnit(shift.valorUnit || (hist.ultimoTipo && (shift.valorTipo || hist.ultimoTipo) === hist.ultimoTipo ? hist.ultimoValor || 0 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.id]);

  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  const total = calcTotal(valorTipo, valorUnit, horas);

  async function persistir(extras: Partial<FreelaShift> = {}) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "freelaShifts", shift.id), {
        valorTipo, valorUnit, horas, totalCalc: total,
        ...extras,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmar() {
    if (!me) return;
    if (!valorUnit) { alert("Selecione uma tarifa antes de confirmar."); return; }
    // Sem confirm() — ação reversível via "Reabrir" depois.
    await persistir({
      status: "fechamento",
      confirmadoEm: new Date().toISOString(),
      confirmadoPor: me.id,
    });
  }

  async function aplicarTarifa(tipo: "hora" | "diaria", v: number) {
    setValorTipo(tipo);
    setValorUnit(v);
    const novoTotal = calcTotal(tipo, v, horas);
    await persistir({ valorTipo: tipo, valorUnit: v, totalCalc: novoTotal });
  }

  return {
    valorTipo, valorUnit, total, saving, hist, outroAtivo,
    setValorUnit, confirmar, aplicarTarifa,
  };
}

// Chips de tarifa com valores predeterminados (hardcoded).
function TarifaPicker({
  hist, valorTipo, valorUnit, outroAtivo, onAplicar, setValorUnit, disabled, block,
}: {
  hist: ReturnType<typeof historicoDaPessoa>;
  valorTipo: "hora" | "diaria";
  valorUnit: number;
  outroAtivo: boolean;
  onAplicar: (tipo: "hora" | "diaria", v: number) => void;
  setValorUnit: (n: number) => void;
  disabled?: boolean;
  // block: layout empilhado/largura-cheia (mobile). Sem block = inline (desktop).
  block?: boolean;
}) {
  const presets = valoresPraTipo(valorTipo);

  function chipCls(ativo: boolean) {
    const baseCls = `text-xs font-semibold px-3 py-1.5 rounded-full transition-colors border ${block ? "w-full text-center" : ""}`;
    if (ativo) return `${baseCls} bg-indigo-600 text-white border-indigo-600`;
    return `${baseCls} bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800`;
  }

  return (
    <div className="space-y-2">
      <div className={`${block ? "grid grid-cols-2" : "inline-flex"} rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 text-[11px]`}>
        <button
          type="button" disabled={disabled}
          onClick={() => onAplicar("hora", 0)}
          className={`px-2 py-1.5 ${valorTipo === "hora" ? "bg-gray-700 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"}`}
        >Hora</button>
        <button
          type="button" disabled={disabled}
          onClick={() => onAplicar("diaria", 0)}
          className={`px-2 py-1.5 ${valorTipo === "diaria" ? "bg-gray-700 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"}`}
        >Diária</button>
      </div>

      <div className={block ? "grid grid-cols-3 gap-1.5" : "flex items-center gap-1.5 flex-wrap"}>
        {presets.map((p) => {
          const ativo = !outroAtivo && Math.abs(p - valorUnit) < 0.01;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onAplicar(valorTipo, p)}
              className={chipCls(ativo)}
            >
              {fmtBR(p)}{valorTipo === "hora" ? "/h" : ""}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setValorUnit(0.01)}
          className={chipCls(outroAtivo)}
        >
          Outro
        </button>
        {!block && outroAtivo && (
          <input
            type="number" min={0} step="0.01"
            value={valorUnit > 0.01 ? valorUnit : ""}
            onChange={(e) => setValorUnit(parseFloat(e.target.value) || 0.01)}
            onBlur={() => onAplicar(valorTipo, valorUnit)}
            disabled={disabled}
            placeholder="R$"
            autoFocus
            className="w-24 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
        )}
      </div>

      {block && outroAtivo && (
        <input
          type="number" min={0} step="0.01"
          value={valorUnit > 0.01 ? valorUnit : ""}
          onChange={(e) => setValorUnit(parseFloat(e.target.value) || 0.01)}
          onBlur={() => onAplicar(valorTipo, valorUnit)}
          disabled={disabled}
          placeholder="Valor (R$)"
          autoFocus
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
        />
      )}

      {/* Info contextual: último valor pago a esse freela */}
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        {hist.anteriores === 0
          ? "📊 1º turno"
          : <>📊 {hist.anteriores + 1}º turno · último: {hist.ultimoTipo === "diaria" ? "diária " : ""}{fmtBR(hist.ultimoValor || 0)}{hist.ultimoTipo === "hora" ? "/h" : ""}</>
        }
      </div>
    </div>
  );
}

function PrecificarRowDesktop({ shift, podeEditar, todosShifts, semPix, onCancelar }: { shift: FreelaShift; podeEditar: boolean; todosShifts: FreelaShift[]; semPix: boolean; onCancelar: () => void }) {
  const s = usePrecificar(shift, todosShifts);
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  const [editar, setEditar] = useState(false);
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 align-top">
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums">{fmtDataCurta(shift.date)}</td>
      <td className="px-2 py-3">
        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{shift.nomeSnapshot}</div>
        {semPix && (
          <div className="text-[10px] text-red-600">⚠ sem PIX</div>
        )}
      </td>
      <td className="px-2 py-3 text-xs text-gray-700 dark:text-gray-300">
        {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""}
        <div className="text-[11px] text-gray-500">{fmtHoras(horas)}</div>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setEditar(true)}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5"
          >
            ✏️ editar horário
          </button>
        )}
        {editar && (
          <HorarioModal shift={shift} mode="editar" onClose={() => setEditar(false)} onSaved={() => setEditar(false)} />
        )}
      </td>
      <td className="px-2 py-3">
        <TarifaPicker
          hist={s.hist}
          valorTipo={s.valorTipo} valorUnit={s.valorUnit} outroAtivo={s.outroAtivo}
          onAplicar={s.aplicarTarifa} setValorUnit={s.setValorUnit}
          disabled={!podeEditar || s.saving}
        />
      </td>
      <td className="px-2 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtBR(s.total)}</td>
      <td className="px-4 py-3 text-right">
        {podeEditar && (
          <div className="flex flex-col items-end gap-1.5">
            <Button size="sm" onClick={s.confirmar} disabled={s.saving || !s.valorUnit}>✅ Confirmar</Button>
            <button type="button" onClick={onCancelar} className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline" title="Cancelar turno (lançado errado) — fica zerado, só pra registro">
              ✕ Cancelar
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function PrecificarRowMobile({ shift, podeEditar, todosShifts, semPix, onCancelar }: { shift: FreelaShift; podeEditar: boolean; todosShifts: FreelaShift[]; semPix: boolean; onCancelar: () => void }) {
  const s = usePrecificar(shift, todosShifts);
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  const [editar, setEditar] = useState(false);
  return (
    <div className="px-3 py-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-gray-500 tabular-nums">{fmtDataCurta(shift.date)}</div>
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 break-words">{shift.nomeSnapshot}</div>
          {semPix && <div className="text-[10px] text-red-600">⚠ sem PIX</div>}
        </div>
        <div className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums shrink-0">{fmtBR(s.total)}</div>
      </div>
      <div className="text-xs text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2 flex-wrap">
        <span>{shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""} · {fmtHoras(horas)}</span>
        {podeEditar && (
          <button type="button" onClick={() => setEditar(true)} className="text-indigo-600 dark:text-indigo-400 hover:underline">
            ✏️ editar
          </button>
        )}
      </div>
      {editar && (
        <HorarioModal shift={shift} mode="editar" onClose={() => setEditar(false)} onSaved={() => setEditar(false)} />
      )}
      <TarifaPicker
        hist={s.hist}
        valorTipo={s.valorTipo} valorUnit={s.valorUnit} outroAtivo={s.outroAtivo}
        onAplicar={s.aplicarTarifa} setValorUnit={s.setValorUnit}
        disabled={!podeEditar || s.saving}
        block
      />
      {podeEditar && (
        <div className="mt-3 space-y-1.5">
          <Button size="sm" className="w-full" onClick={s.confirmar} disabled={s.saving || !s.valorUnit}>✅ Confirmar</Button>
          <button type="button" onClick={onCancelar} className="w-full text-[11px] text-rose-600 dark:text-rose-400 hover:underline" title="Cancelar turno (lançado errado)">
            ✕ Cancelar turno
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Linhas: Prontos pra lote ─────────────────────────────────────────────
// Reabrir SEM confirm — operação reversível (basta clicar Confirmar de novo
// na seção "Aguardando precificação"). Confirm() atrapalha em casos onde
// o DP precisa reabrir vários turnos seguidos.
async function reabrirShift(shift: FreelaShift) {
  await updateDoc(doc(db, "freelaShifts", shift.id), {
    status: "aberto",
    confirmadoEm: null,
    confirmadoPor: null,
    updatedAt: new Date().toISOString(),
  });
}

// Badge "cancelado" + motivo (tooltip). Reutilizado nas linhas.
function CanceladoBadge({ shift }: { shift: FreelaShift }) {
  if (shift.status !== "cancelado") return null;
  return (
    <span
      title={shift.motivoCancelamento ? `Motivo: ${shift.motivoCancelamento}` : "Turno cancelado"}
      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
    >
      ✕ cancelado
    </span>
  );
}

function ProntoLoteRowDesktop({ shift, podeEditar, checked, onToggle, onCancelar }: { shift: FreelaShift; podeEditar: boolean; checked: boolean; onToggle: () => void; onCancelar: () => void }) {
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  const cancelado = shift.status === "cancelado";
  return (
    <tr className={`border-t border-gray-100 dark:border-gray-800 ${cancelado ? "bg-rose-50/40 dark:bg-rose-950/20" : ""}`}>
      <td className="px-4 py-2">
        <input type="checkbox" checked={checked} onChange={onToggle} disabled={!podeEditar} />
      </td>
      <td className="px-2 py-2 text-gray-700 dark:text-gray-300 tabular-nums">{fmtDataCurta(shift.date)}</td>
      <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100 truncate">
        <span className="inline-flex items-center gap-1.5">{shift.nomeSnapshot} <CanceladoBadge shift={shift} /></span>
      </td>
      <td className="px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
        {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""} · {fmtHoras(horas)}
      </td>
      <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">
        {cancelado ? "—" : `${shift.valorTipo === "diaria" ? "diária" : "R$/h"} ${fmtBR(shift.valorUnit || 0)}`}
      </td>
      <td className={`px-2 py-2 text-right font-semibold tabular-nums ${cancelado ? "text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>{fmtBR(shift.totalCalc || 0)}</td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        {podeEditar && (
          <span className="inline-flex items-center gap-2">
            {!cancelado && (
              <button type="button" onClick={onCancelar} className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline" title="Cancelar turno (lançado errado) — fica zerado">
                ✕ Cancelar
              </button>
            )}
            <button type="button" onClick={() => reabrirShift(shift)} className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline" title="Reabrir e voltar pra precificação">
              ↩ Reabrir
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

function ProntoLoteRowMobile({ shift, podeEditar, checked, onToggle, onCancelar }: { shift: FreelaShift; podeEditar: boolean; checked: boolean; onToggle: () => void; onCancelar: () => void }) {
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  const cancelado = shift.status === "cancelado";
  return (
    <div className={`px-3 py-3 flex items-start gap-3 ${cancelado ? "bg-rose-50/40 dark:bg-rose-950/20" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={!podeEditar} className="mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] text-gray-500 tabular-nums">{fmtDataCurta(shift.date)}</div>
            <div className="font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">{shift.nomeSnapshot} <CanceladoBadge shift={shift} /></div>
          </div>
          <div className={`text-sm font-bold tabular-nums ${cancelado ? "text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>{fmtBR(shift.totalCalc || 0)}</div>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-300">
          {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""} · {fmtHoras(horas)}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="text-[11px] text-gray-500">
            {cancelado ? (shift.motivoCancelamento || "cancelado") : `${shift.valorTipo === "diaria" ? "diária" : "R$/h"} ${fmtBR(shift.valorUnit || 0)}`}
          </div>
          {podeEditar && (
            <span className="inline-flex items-center gap-2">
              {!cancelado && (
                <button type="button" onClick={onCancelar} className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline">✕ Cancelar</button>
              )}
              <button type="button" onClick={() => reabrirShift(shift)} className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline">↩ Reabrir</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lote pendente ────────────────────────────────────────────────────────
function LotePendenteRow({ lote, shifts, restaurant, podeEditar }: {
  lote: FreelaPagamento;
  shifts: FreelaShift[];
  restaurant: Restaurant | null;
  podeEditar: boolean;
}) {
  const { pessoa: me } = useAuth();
  const [salvando, setSalvando] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [pagarAberto, setPagarAberto] = useState(false);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const hojeYmd = () => { const h = new Date(); return `${h.getFullYear()}-${p2(h.getMonth() + 1)}-${p2(h.getDate())}`; };
  const [dataPag, setDataPag] = useState(hojeYmd);

  const shiftsDoLote = useMemo(
    () => shifts.filter((s) => lote.shiftIds.includes(s.id)),
    [shifts, lote.shiftIds],
  );

  async function confirmarPagamento() {
    if (!me) return;
    const m = dataPag.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { alert("Selecione uma data válida."); return; }
    const pagoEm = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0).toISOString(); // meio-dia local evita virar o dia por fuso
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "freelaPagamentos", lote.id), {
        status: "pago", pagoEm, pagoPor: me.id, pagoPorNome: me.nome,
      });
      const batch = writeBatch(db);
      for (const sid of lote.shiftIds) {
        const s = shiftsDoLote.find((x) => x.id === sid);
        // Turno cancelado segue cancelado (registro zerado) — só marca pagoEm.
        const upd = s?.status === "cancelado"
          ? { pagoEm, updatedAt: now }
          : { status: "pago", pagoEm, updatedAt: now };
        batch.update(doc(db, "freelaShifts", sid), upd);
      }
      await batch.commit();
      setPagarAberto(false);
    } catch (e) { console.error(e); alert("Erro ao confirmar pagamento."); }
    finally { setSalvando(false); }
  }

  async function reabrirTurnos() {
    if (!confirm(`Reabrir os turnos do lote ${lote.numero}? Eles voltam pra "Em fechamento" e o lote é desfeito.`)) return;
    setSalvando(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      for (const sid of lote.shiftIds) {
        batch.update(doc(db, "freelaShifts", sid), { lotePagamentoId: null, updatedAt: now });
      }
      batch.delete(doc(db, "freelaPagamentos", lote.id));
      await batch.commit();
    } catch (e) { console.error(e); alert("Erro ao reabrir turnos."); }
    finally { setSalvando(false); }
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex-1 truncate">
        <strong>{lote.numero}</strong> · {lote.qtdPessoas} pessoa(s) · {lote.qtdShifts} turno(s) · <strong>{fmtBR(lote.totalGeral)}</strong>
      </div>
      {podeEditar && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPreviewAberto(true)}
            disabled={!restaurant}
            className="text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline disabled:opacity-50"
            title="Pré-visualizar PDF do lote antes de baixar"
          >
            📄 PDF
          </button>
          <button type="button" onClick={reabrirTurnos} disabled={salvando} className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50">↩ Reabrir turnos</button>
          <button type="button" onClick={() => { setDataPag(hojeYmd()); setPagarAberto(true); }} disabled={salvando} className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50">✅ Marcar pago</button>
        </div>
      )}
      {previewAberto && restaurant && (
        <LotePDFPreviewModal
          lote={lote}
          shifts={shiftsDoLote}
          restaurant={restaurant}
          onClose={() => setPreviewAberto(false)}
        />
      )}
      {pagarAberto && (
        <Modal title="✅ Marcar lote como pago" onClose={() => !salvando && setPagarAberto(false)} maxWidth="max-w-sm">
          <div className="space-y-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">Lote <strong>{lote.numero}</strong> · {lote.qtdPessoas} pessoa(s) · {lote.qtdShifts} turno(s) · <strong>{fmtBR(lote.totalGeral)}</strong></div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data do pagamento</label>
              <input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={salvando} onClick={() => setPagarAberto(false)}>Cancelar</Button>
              <Button size="sm" disabled={salvando} onClick={() => void confirmarPagamento()}>{salvando ? "Salvando…" : "Confirmar pagamento"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

