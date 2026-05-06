import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { fmtAnoMes, nomeMes, shiftMonth } from "../../core/utils/date";
import type { Empregado, EscalaMes, VTFolha, VTFolhaItem } from "../../core/types";
import { calcularVTLinha } from "./calc";

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

  const defaults = {
    passagens: activeRestaurant?.vtPassagensDefault ?? 2,
    valor:     activeRestaurant?.vtValorPassagemDefault ?? 0,
  };

  const linhas = useMemo(() => {
    return empregados
      .map(e => {
        const calc = calcularVTLinha(e, escala, defaults);
        if (!calc) return null;
        const item = folha?.itens?.[e.id];
        return { ...calc, paidAt: item?.paidAt ?? null };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [empregados, escala, folha, defaults]);

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
    if (!confirm("Marcar TODOS os pendentes como pagos?")) return;
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

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🚌 Vale Transporte</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeRestaurant.nome} · padrão {defaults.passagens} pass/dia × {fmtBR(defaults.valor)}
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
            <div key={l.empregadoId} className="grid grid-cols-[1fr_70px_70px_90px_110px_120px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{l.nome}</div>
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
              <Button size="sm" onClick={pagarTodos}>Pagar todos pendentes ({fmtBR(totais.pendente)})</Button>
            </div>
          )}
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

