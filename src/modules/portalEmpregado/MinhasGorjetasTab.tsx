import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import {
  daysInMonth, fmtAnoMes, nomeMes, pad2, parseYmd, shiftMonth,
} from "../../core/utils/date";
import type { Cargo, Empregado, EscalaMes, Gorjeta, SplitVersion } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "../gorjetas/calc";
import { getActiveSplitVersion } from "../gorjetas/splitRules";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  empregado: Empregado;
  restaurantId: string;
};

export function MinhasGorjetasTab({ empregado, restaurantId }: Props) {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [splitVersions, setSplitVersions] = useState<SplitVersion[]>([]);

  // Gorjetas do mês
  useEffect(() => {
    const q = query(collection(db, "gorjetas"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const inicio = `${ano}-${pad2(mes)}-01`;
      const fim    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Gorjeta)
        .filter(g => g.date >= inicio && g.date <= fim);
      list.sort((a, b) => a.date.localeCompare(b.date));
      setGorjetas(list);
    });
    return () => unsub();
  }, [restaurantId, ano, mes]);

  // Empregados, cargos, escala, splitVersions (pra recalcular divisão se gorjeta não paga)
  useEffect(() => {
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const ref = doc(db, "escalas", `${restaurantId}_${fmtAnoMes(ano, mes)}`);
    const unsub = onSnapshot(ref, (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [restaurantId, ano, mes]);

  useEffect(() => {
    const q = query(collection(db, "splitVersions"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setSplitVersions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SplitVersion));
    });
    return () => unsub();
  }, [restaurantId]);

  // Linhas: pra cada gorjeta, calcula a divisão e filtra a parte do empregado logado
  const linhas = useMemo(() => {
    const result: { date: string; bruto: number; retencao: number; liquido: number; status: "live" | "snapshot" }[] = [];
    for (const g of gorjetas) {
      const sv = getActiveSplitVersion(splitVersions, g.date);
      const itens = (g.paidAt && g.divisaoSnapshot)
        ? g.divisaoSnapshot
        : calcularDivisaoDia(g.date, calcularValorLiquido(g.valorBruto, g.taxRate), empregados, cargos, escala, sv).itens;
      const meu = itens.find(it => it.empregadoId === empregado.id);
      if (!meu) continue;
      const fator = 1 - (g.taxRate || 0) / 100;
      const liquido = meu.valor;
      const bruto = fator > 0 ? liquido / fator : liquido;
      const retencao = bruto - liquido;
      result.push({
        date: g.date,
        bruto: Math.round(bruto * 100) / 100,
        retencao: Math.round(retencao * 100) / 100,
        liquido: Math.round(liquido * 100) / 100,
        status: g.paidAt ? "snapshot" : "live",
      });
    }
    return result;
  }, [gorjetas, empregado.id, empregados, cargos, escala, splitVersions]);

  const totais = useMemo(() => {
    return linhas.reduce(
      (acc, l) => ({
        bruto: acc.bruto + l.bruto,
        retencao: acc.retencao + l.retencao,
        liquido: acc.liquido + l.liquido,
      }),
      { bruto: 0, retencao: 0, liquido: 0 },
    );
  }, [linhas]);

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  return (
    <div className="space-y-4">
      {/* Header com nav */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Extrato de gorjetas de {empregado.nome}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[140px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
        </div>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-3 gap-2">
        <Card label="Bruto" value={fmtBR(totais.bruto)} />
        <Card label="Retenção" value={fmtBR(totais.retencao)} variant="warn" />
        <Card label="Líquido" value={fmtBR(totais.liquido)} variant="ok" />
      </div>

      {/* Lista de dias */}
      {linhas.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">💸</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Sem gorjetas neste mês</p>
          <p className="text-sm text-gray-500 mt-2">
            Quando o restaurante lançar gorjeta dos dias que você trabalhou, aparece aqui.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[80px_120px_110px_120px_60px] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
            <div>Dia</div>
            <div className="text-right">Bruto</div>
            <div className="text-right">Retenção</div>
            <div className="text-right">Líquido</div>
            <div className="text-center">Status</div>
          </div>
          {linhas.map((l, i) => {
            const d = parseYmd(l.date);
            return (
              <div key={l.date} className={`grid grid-cols-[80px_120px_110px_120px_60px] gap-2 px-3 py-2 items-center text-sm ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{pad2(d.getDate())}/{pad2(d.getMonth() + 1)}</div>
                  <div className="text-[10px] text-gray-500 uppercase">
                    {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]}
                  </div>
                </div>
                <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(l.bruto)}</div>
                <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(l.retencao)}</div>
                <div className="text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{fmtBR(l.liquido)}</div>
                <div className="text-center">
                  {l.status === "snapshot" ? (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold" title="Gorjeta paga e congelada">
                      ✓
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Estimativa — gorjeta ainda não paga">
                      Pend.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {/* Total */}
          <div className="grid grid-cols-[80px_120px_110px_120px_60px] gap-2 px-3 py-3 items-center text-sm border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
            <div>TOTAL</div>
            <div className="text-right tabular-nums">{fmtBR(totais.bruto)}</div>
            <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(totais.retencao)}</div>
            <div className="text-right tabular-nums text-emerald-700 dark:text-emerald-300">{fmtBR(totais.liquido)}</div>
            <div></div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
        ✓ pago = valor congelado (não muda mais).{" "}
        <span className="text-amber-600">Pend.</span> = estimativa em tempo real, pode mudar até a gorjeta ser paga.
      </div>
    </div>
  );
}

function Card({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const cls =
    variant === "ok" ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
    : variant === "warn" ? "border-amber-200 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
