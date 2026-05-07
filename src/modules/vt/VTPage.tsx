import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { fmtAnoMes, nomeMes, shiftMonth } from "../../core/utils/date";
import type { Empregado, EscalaMes, VTFolha, VTFolhaItem } from "../../core/types";
import { calcularDivergenciasVT, calcularVTLinha, type VTDivergencia } from "./calc";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function VTPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "vt");
  const podeConfig = canConfig(me, rid, "vt");

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [folha, setFolha] = useState<VTFolha | null>(null);
  const [loading, setLoading] = useState(true);

  const folhaId = `${rid}_${fmtAnoMes(ano, mes)}`;
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;

  // Empregados
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  // Escala do mês
  useEffect(() => {
    if (!rid) return;
    const ref = doc(db, "escalas", escalaId);
    const unsub = onSnapshot(ref, (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, escalaId]);

  // Folha VT do mês (com paidAt)
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const ref = doc(db, "vtFolhas", folhaId);
    const unsub = onSnapshot(ref, (snap) => {
      setFolha(snap.exists() ? ({ id: snap.id, ...snap.data() } as VTFolha) : null);
      setLoading(false);
    });
    return () => unsub();
  }, [rid, folhaId]);

  const linhas = useMemo(() => {
    return empregados
      .map(e => {
        const calc = calcularVTLinha(e, escala);
        if (!calc) return null;
        const item = folha?.itens?.[e.id];
        const semConfig = !e.vtPassagensPorDia || !e.vtValorPassagem;
        return { ...calc, paidAt: item?.paidAt ?? null, semConfig };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [empregados, escala, folha]);

  const totais = useMemo(() => {
    const total = linhas.reduce((s, l) => s + l.total, 0);
    const pago = linhas.filter(l => l.paidAt).reduce((s, l) => s + l.total, 0);
    const pendente = total - pago;
    return { total, pago, pendente };
  }, [linhas]);

  async function togglePago(empregadoId: string) {
    if (!rid) return;
    const linha = linhas.find(l => l.empregadoId === empregadoId);
    if (!linha) return;
    const itens = { ...(folha?.itens || {}) };
    const item: VTFolhaItem = {
      diasTrabalhados: linha.diasTrabalhados,
      passagensPorDia: linha.passagensPorDia,
      valorPassagem: linha.valorPassagem,
      total: linha.total,
      paidAt: linha.paidAt ? null : new Date().toISOString(),
      paidBy: linha.paidAt ? null : me?.id || null,
    };
    itens[empregadoId] = item;
    const payload: VTFolha = {
      id: folhaId,
      restaurantId: rid,
      ano, mes,
      itens,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, "vtFolhas", folhaId), payload, { merge: true });
  }

  async function pagarTodos() {
    if (!rid) return;
    if (!confirm("Marcar TODOS os pendentes como pagos?\n\nIsso também CONGELA a Prevista da escala como snapshot pro cálculo. Mudanças posteriores na escala REAL geram divergências (a devolver / a receber).")) return;
    const itens = { ...(folha?.itens || {}) };
    const now = new Date().toISOString();
    for (const l of linhas) {
      if (l.paidAt) continue;
      itens[l.empregadoId] = {
        diasTrabalhados: l.diasTrabalhados,
        passagensPorDia: l.passagensPorDia,
        valorPassagem: l.valorPassagem,
        total: l.total,
        paidAt: now,
        paidBy: me?.id || null,
      };
    }
    await setDoc(doc(db, "vtFolhas", folhaId), {
      id: folhaId,
      restaurantId: rid, ano, mes, itens,
      updatedAt: now,
    }, { merge: true });
    // Congela a Prevista da escala marcando vtPagoEm
    if (!escala?.vtPagoEm) {
      try {
        await updateDoc(doc(db, "escalas", escalaId), {
          vtPagoEm: now,
          vtPagoPor: me?.id || null,
        });
      } catch (e) {
        // Doc da escala pode não existir ainda — cria
        await setDoc(doc(db, "escalas", escalaId), {
          id: escalaId,
          restaurantId: rid,
          ano, mes,
          prevista: {},
          real: {},
          vtPagoEm: now,
          vtPagoPor: me?.id || null,
          updatedAt: now,
        }, { merge: true });
      }
    }
  }

  // Divergências entre Real e Prevista (só faz sentido APÓS VT pago)
  const divergencias: VTDivergencia[] = useMemo(
    () => calcularDivergenciasVT(empregados, escala),
    [empregados, escala],
  );
  const totaisDivergencia = useMemo(() => {
    const aReceber = divergencias.filter(d => d.delta > 0).reduce((s, d) => s + d.diferencaValor, 0);
    const aDevolver = -divergencias.filter(d => d.delta < 0).reduce((s, d) => s + d.diferencaValor, 0);
    return { aReceber, aDevolver, saldoLiquido: aReceber - aDevolver };
  }, [divergencias]);

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

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🚌 Vale Transporte</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeRestaurant.nome}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card label="Total do mês" value={fmtBR(totais.total)} />
        <Card label="Pago" value={fmtBR(totais.pago)} variant="ok" />
        <Card label="Pendente" value={fmtBR(totais.pendente)} variant="warn" />
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : linhas.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🚌</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Ninguém com VT ativo neste mês</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Marque empregados como "VT ativo" no cadastro pra aparecer aqui.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_70px_90px_110px_120px] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
            <div>Empregado</div>
            <div className="text-right">Dias</div>
            <div className="text-right">Pass/dia</div>
            <div className="text-right">Valor pass.</div>
            <div className="text-right">Total</div>
            <div className="text-right">Status</div>
          </div>
          {linhas.map(l => (
            <div key={l.empregadoId} className={`grid grid-cols-[1fr_70px_70px_90px_110px_120px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 ${l.semConfig ? "bg-amber-50 dark:bg-amber-900/10" : ""}`}>
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                {l.nome}
                {l.semConfig && <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">⚠ sem config</span>}
              </div>
              <div className="text-right tabular-nums">{l.diasTrabalhados}</div>
              <div className="text-right tabular-nums">{l.passagensPorDia}</div>
              <div className="text-right tabular-nums">{fmtBR(l.valorPassagem)}</div>
              <div className="text-right font-semibold tabular-nums">{fmtBR(l.total)}</div>
              <div className="text-right">
                {l.paidAt ? (
                  <button
                    type="button"
                    disabled={!podeConfig}
                    onClick={() => togglePago(l.empregadoId)}
                    className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 disabled:opacity-60"
                    title={`Pago em ${new Date(l.paidAt).toLocaleString("pt-BR")}`}
                  >
                    ✓ Pago
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!podeConfig || l.total <= 0}
                    onClick={() => togglePago(l.empregadoId)}
                    className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 disabled:opacity-50"
                  >
                    Marcar pago
                  </button>
                )}
              </div>
            </div>
          ))}
          {podeConfig && totais.pendente > 0 && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 flex justify-end">
              <Button size="sm" onClick={pagarTodos}>💸 Pagar todos pendentes ({fmtBR(totais.pendente)})</Button>
            </div>
          )}
        </div>
      )}

      {/* Tela de Divergências (Real vs Prevista) — aparece APÓS VT pago */}
      {escala?.vtPagoEm && divergencias.length > 0 && (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  📊 Divergências entre Prevista e Real
                </h2>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Comparação dos dias trabalhados na escala REAL contra a PREVISTA (que pagou o VT).
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold tracking-wider text-amber-700">Saldo</div>
                <div className={`text-lg font-bold tabular-nums ${
                  totaisDivergencia.saldoLiquido >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                }`}>
                  {totaisDivergencia.saldoLiquido >= 0 ? "+" : "-"}
                  {fmtBR(Math.abs(totaisDivergencia.saldoLiquido))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="rounded bg-emerald-100 dark:bg-emerald-900/40 px-2 py-1 text-xs">
                <span className="text-emerald-700 dark:text-emerald-300 font-semibold">A receber (a + dias):</span>
                <span className="ml-2 font-bold tabular-nums text-emerald-900 dark:text-emerald-200">{fmtBR(totaisDivergencia.aReceber)}</span>
              </div>
              <div className="rounded bg-rose-100 dark:bg-rose-900/40 px-2 py-1 text-xs">
                <span className="text-rose-700 dark:text-rose-300 font-semibold">A devolver (- dias):</span>
                <span className="ml-2 font-bold tabular-nums text-rose-900 dark:text-rose-200">{fmtBR(totaisDivergencia.aDevolver)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_70px_70px_90px_140px] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
            <div>Empregado</div>
            <div className="text-right">Prev.</div>
            <div className="text-right">Real</div>
            <div className="text-right">Δ dias</div>
            <div className="text-right">Diferença R$</div>
          </div>
          {divergencias.map(d => (
            <div key={d.empregadoId} className={`grid grid-cols-[1fr_70px_70px_90px_140px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 ${
              d.delta > 0 ? "bg-emerald-50/30 dark:bg-emerald-900/10" : "bg-rose-50/30 dark:bg-rose-900/10"
            }`}>
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{d.nome}</div>
              <div className="text-right tabular-nums text-gray-600 dark:text-gray-400">{d.diasPrevista}</div>
              <div className="text-right tabular-nums text-gray-900 dark:text-gray-100 font-medium">{d.diasReal}</div>
              <div className={`text-right tabular-nums font-semibold ${d.delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {d.delta > 0 ? "+" : ""}{d.delta}
              </div>
              <div className={`text-right tabular-nums font-bold ${d.delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {d.delta > 0 ? "+" : ""}{fmtBR(d.diferencaValor)}
              </div>
            </div>
          ))}
        </div>
      )}

      {escala?.vtPagoEm && divergencias.length === 0 && (
        <div className="mt-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center text-sm text-emerald-800 dark:text-emerald-300">
          ✓ <strong>Sem divergências.</strong> A escala Real bate com a Prevista — VT calculado certinho.
        </div>
      )}
    </div>
  );
}

function Card({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const cls =
    variant === "ok"
      ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
      : variant === "warn"
      ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-700 dark:text-amber-300"
      : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

