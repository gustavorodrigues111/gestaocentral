import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import {
  AREAS, type Area, type FreelaPagamento,
  type FreelaPagamentoResumoPessoa, type FreelaShift, type Restaurant,
} from "../../core/types";
import {
  VALORES_DIARIA, VALORES_HORA,
  calcHoras, calcTotal, fmtBR, fmtHoras, historicoDaPessoa, proximoNumeroLote,
} from "./helpers";
import { LotePDFPreviewModal } from "./LotePDFPreviewModal";

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

  // Prontos pra lote: status="fechamento" sem lote ainda.
  const prontosLote = useMemo(
    () => shifts.filter((s) => s.status === "fechamento" && !s.lotePagamentoId),
    [shifts],
  );

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
    if (!selecShifts.length) { alert("Selecione ao menos 1 turno."); return; }
    if (!confirm(`Gerar lote com ${selecShifts.length} turno(s) — ${fmtBR(totaisSelec.total)}?`)) return;
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
          pix: s.pixSnapshot ?? null,
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
      const totalGeral = pessoasResumo.reduce((a, p) => a + p.totalValor, 0);

      const payload: Omit<FreelaPagamento, "id"> = {
        restaurantId,
        numero,
        ...(obs.trim() ? { observacao: obs.trim() } : {}),
        shiftIds: selecShifts.map((s) => s.id),
        pessoasResumo,
        totalGeral: Math.round(totalGeral * 100) / 100,
        qtdShifts: selecShifts.length,
        qtdPessoas: pessoasResumo.length,
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
            renderRowDesktop={(s) => <PrecificarRowDesktop key={s.id} shift={s} podeEditar={podeEditar} todosShifts={shifts} />}
            renderRowMobile={(s)  => <PrecificarRowMobile  key={s.id} shift={s} podeEditar={podeEditar} todosShifts={shifts} />}
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
                checked={selecionados.has(s.id)} onToggle={() => toggle(s.id)} />
            )}
            renderRowMobile={(s) => (
              <ProntoLoteRowMobile key={s.id} shift={s} podeEditar={podeEditar}
                checked={selecionados.has(s.id)} onToggle={() => toggle(s.id)} />
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

        {prontosLote.length > 0 && podeEditar && (
          <div className="mt-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 p-3">
            <div className="text-sm font-medium text-indigo-900 dark:text-indigo-200 mb-2">
              💰 {totaisSelec.qtd} turno(s) selecionado(s) · {totaisSelec.pessoas} pessoa(s) ·{" "}
              <strong>{fmtBR(totaisSelec.total)}</strong>
            </div>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              placeholder="Observação do lote (opcional)…"
              className="w-full px-2 py-1.5 text-xs rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 dark:text-gray-100 mb-2"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={gerarLote} disabled={salvando || totaisSelec.qtd === 0}>
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
  hist, valorTipo, valorUnit, outroAtivo, onAplicar, setValorUnit, disabled,
}: {
  hist: ReturnType<typeof historicoDaPessoa>;
  valorTipo: "hora" | "diaria";
  valorUnit: number;
  outroAtivo: boolean;
  onAplicar: (tipo: "hora" | "diaria", v: number) => void;
  setValorUnit: (n: number) => void;
  disabled?: boolean;
}) {
  const presets = valoresPraTipo(valorTipo);

  function chipCls(ativo: boolean) {
    const baseCls = "text-xs font-semibold px-3 py-1.5 rounded-full transition-colors border";
    if (ativo) return `${baseCls} bg-indigo-600 text-white border-indigo-600`;
    return `${baseCls} bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800`;
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 text-[11px]">
        <button
          type="button" disabled={disabled}
          onClick={() => onAplicar("hora", 0)}
          className={`px-2 py-1 ${valorTipo === "hora" ? "bg-gray-700 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"}`}
        >Hora</button>
        <button
          type="button" disabled={disabled}
          onClick={() => onAplicar("diaria", 0)}
          className={`px-2 py-1 ${valorTipo === "diaria" ? "bg-gray-700 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"}`}
        >Diária</button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
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
        {outroAtivo && (
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

function PrecificarRowDesktop({ shift, podeEditar, todosShifts }: { shift: FreelaShift; podeEditar: boolean; todosShifts: FreelaShift[] }) {
  const s = usePrecificar(shift, todosShifts);
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 align-top">
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums">{fmtDataCurta(shift.date)}</td>
      <td className="px-2 py-3">
        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{shift.nomeSnapshot}</div>
        {!shift.pixSnapshot && (
          <div className="text-[10px] text-red-600">⚠ sem PIX</div>
        )}
      </td>
      <td className="px-2 py-3 text-xs text-gray-700 dark:text-gray-300">
        {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""}
        <div className="text-[11px] text-gray-500">{fmtHoras(horas)}</div>
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
          <Button size="sm" onClick={s.confirmar} disabled={s.saving || !s.valorUnit}>✅ Confirmar</Button>
        )}
      </td>
    </tr>
  );
}

function PrecificarRowMobile({ shift, podeEditar, todosShifts }: { shift: FreelaShift; podeEditar: boolean; todosShifts: FreelaShift[] }) {
  const s = usePrecificar(shift, todosShifts);
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-gray-500 tabular-nums">{fmtDataCurta(shift.date)}</div>
          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{shift.nomeSnapshot}</div>
          {!shift.pixSnapshot && <div className="text-[10px] text-red-600">⚠ sem PIX</div>}
        </div>
        <div className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtBR(s.total)}</div>
      </div>
      <div className="text-xs text-gray-700 dark:text-gray-300 mb-2">
        {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""} · {fmtHoras(horas)}
      </div>
      <TarifaPicker
        hist={s.hist}
        valorTipo={s.valorTipo} valorUnit={s.valorUnit} outroAtivo={s.outroAtivo}
        onAplicar={s.aplicarTarifa} setValorUnit={s.setValorUnit}
        disabled={!podeEditar || s.saving}
      />
      {podeEditar && (
        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={s.confirmar} disabled={s.saving || !s.valorUnit}>✅ Confirmar</Button>
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

function ProntoLoteRowDesktop({ shift, podeEditar, checked, onToggle }: { shift: FreelaShift; podeEditar: boolean; checked: boolean; onToggle: () => void }) {
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-4 py-2">
        <input type="checkbox" checked={checked} onChange={onToggle} disabled={!podeEditar} />
      </td>
      <td className="px-2 py-2 text-gray-700 dark:text-gray-300 tabular-nums">{fmtDataCurta(shift.date)}</td>
      <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100 truncate">{shift.nomeSnapshot}</td>
      <td className="px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
        {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""} · {fmtHoras(horas)}
      </td>
      <td className="px-2 py-2 text-xs text-gray-600 dark:text-gray-400">
        {shift.valorTipo === "diaria" ? "diária" : "R$/h"} {fmtBR(shift.valorUnit || 0)}
      </td>
      <td className="px-2 py-2 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtBR(shift.totalCalc || 0)}</td>
      <td className="px-4 py-2 text-right">
        {podeEditar && (
          <button
            type="button"
            onClick={() => reabrirShift(shift)}
            className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
            title="Reabrir e voltar pra precificação"
          >
            ↩ Reabrir
          </button>
        )}
      </td>
    </tr>
  );
}

function ProntoLoteRowMobile({ shift, podeEditar, checked, onToggle }: { shift: FreelaShift; podeEditar: boolean; checked: boolean; onToggle: () => void }) {
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);
  return (
    <div className="px-3 py-3 flex items-start gap-3">
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={!podeEditar} className="mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] text-gray-500 tabular-nums">{fmtDataCurta(shift.date)}</div>
            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{shift.nomeSnapshot}</div>
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtBR(shift.totalCalc || 0)}</div>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-300">
          {shift.entrada}→{shift.saida}{shift.intervalo ? ` (${shift.intervalo}min)` : ""} · {fmtHoras(horas)}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="text-[11px] text-gray-500">
            {shift.valorTipo === "diaria" ? "diária" : "R$/h"} {fmtBR(shift.valorUnit || 0)}
          </div>
          {podeEditar && (
            <button
              type="button"
              onClick={() => reabrirShift(shift)}
              className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
            >
              ↩ Reabrir
            </button>
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

  const shiftsDoLote = useMemo(
    () => shifts.filter((s) => lote.shiftIds.includes(s.id)),
    [shifts, lote.shiftIds],
  );

  async function marcarPago() {
    if (!me) return;
    const forma = prompt("Forma de pagamento (PIX, dinheiro, etc.) — opcional:") || "";
    if (!confirm(`Confirmar PAGAMENTO do lote ${lote.numero} (${fmtBR(lote.totalGeral)})?`)) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "freelaPagamentos", lote.id), {
        status: "pago", pagoEm: now, pagoPor: me.id, pagoPorNome: me.nome,
        ...(forma.trim() ? { formaPagamento: forma.trim() } : {}),
      });
      const batch = writeBatch(db);
      for (const sid of lote.shiftIds) {
        batch.update(doc(db, "freelaShifts", sid), { status: "pago", pagoEm: now, updatedAt: now });
      }
      await batch.commit();
    } catch (e) { console.error(e); alert("Erro ao confirmar pagamento."); }
    finally { setSalvando(false); }
  }

  async function cancelar() {
    if (!confirm(`Cancelar lote ${lote.numero}? Turnos voltam pra "Em fechamento".`)) return;
    setSalvando(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      for (const sid of lote.shiftIds) {
        batch.update(doc(db, "freelaShifts", sid), { lotePagamentoId: null, updatedAt: now });
      }
      batch.delete(doc(db, "freelaPagamentos", lote.id));
      await batch.commit();
    } catch (e) { console.error(e); alert("Erro ao cancelar lote."); }
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
          <button type="button" onClick={cancelar} disabled={salvando} className="text-[11px] text-red-600 hover:underline disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={marcarPago} disabled={salvando} className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50">✅ Marcar pago</button>
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
    </div>
  );
}

