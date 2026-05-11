import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { nomeMes, pad2 } from "../../core/utils/date";
import type { Cargo, Empregado, EscalaMes, Gorjeta, Restaurant, SplitVersion, VTFolha } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "../gorjetas/calc";
import { getActiveSplitVersion } from "../gorjetas/splitRules";
import { calcularDivergenciasVT } from "../vt/calc";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  rid: string;
  ano: number;
  mes: number;
  escala: EscalaMes | null;
  empregados: Empregado[];
  cargos: Cargo[];
  restaurant: Restaurant;
  onClose: () => void;
};

export function SumarioMesModal({
  rid, ano, mes, escala, empregados, cargos, restaurant, onClose,
}: Props) {
  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [folha, setFolha] = useState<VTFolha | null>(null);
  const [splitVersions, setSplitVersions] = useState<SplitVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const inicio = `${ano}-${pad2(mes)}-01`;
      const fim = `${ano}-${pad2(mes)}-31`;
      const [snapG, snapV, snapS] = await Promise.all([
        getDocs(query(collection(db, "gorjetas"), where("restaurantId", "==", rid))),
        getDocs(query(collection(db, "vtFolhas"), where("restaurantId", "==", rid))),
        getDocs(query(collection(db, "splitVersions"), where("restaurantId", "==", rid))),
      ]);
      if (!alive) return;
      const gMes = snapG.docs
        .map(d => ({ id: d.id, ...d.data() }) as Gorjeta)
        .filter(g => g.date >= inicio && g.date <= fim);
      setGorjetas(gMes);
      const vtFolha = snapV.docs
        .map(d => ({ id: d.id, ...d.data() }) as VTFolha)
        .find(f => f.ano === ano && f.mes === mes) || null;
      setFolha(vtFolha);
      setSplitVersions(snapS.docs.map(d => ({ id: d.id, ...d.data() }) as SplitVersion));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [rid, ano, mes]);

  // Totais de gorjetas
  const totaisGorjeta = useMemo(() => {
    const bruto = gorjetas.reduce((s, g) => s + (g.valorBruto || 0), 0);
    const liquido = gorjetas.reduce((s, g) => s + (g.valorLiquido || 0), 0);
    const retencao = bruto - liquido;
    const pagas = gorjetas.filter(g => g.paidAt).length;
    return { bruto, liquido, retencao, total: gorjetas.length, pagas };
  }, [gorjetas]);

  // Distribuição por empregado (igual à DivisaoMesTab)
  const linhasGorjeta = useMemo(() => {
    const acc: Record<string, { nome: string; cargo: string; area: string; bruto: number; liquido: number }> = {};
    for (const g of gorjetas) {
      const sv = getActiveSplitVersion(splitVersions, g.date);
      const itens = (g.paidAt && g.divisaoSnapshot)
        ? g.divisaoSnapshot
        : calcularDivisaoDia(g.date, calcularValorLiquido(g.valorBruto, g.taxRate), empregados, cargos, escala, sv, g.unidadeId || null, restaurant.unidades || []).itens;
      const fator = 1 - (g.taxRate || 0) / 100;
      for (const it of itens) {
        if (!acc[it.empregadoId]) {
          acc[it.empregadoId] = { nome: it.empregadoNome, cargo: it.cargoNome, area: it.area, bruto: 0, liquido: 0 };
        }
        acc[it.empregadoId].liquido += it.valor;
        acc[it.empregadoId].bruto += fator > 0 ? it.valor / fator : it.valor;
      }
    }
    return Object.values(acc)
      .map(l => ({ ...l, bruto: Math.round(l.bruto * 100) / 100, liquido: Math.round(l.liquido * 100) / 100 }))
      .sort((a, b) => (a.area || "").localeCompare(b.area || "") || a.nome.localeCompare(b.nome));
  }, [gorjetas, empregados, cargos, escala, splitVersions]);

  // Totais VT
  const totaisVT = useMemo(() => {
    if (!folha) return { total: 0, pago: 0, pendente: 0, empregados: 0 };
    const itens = Object.values(folha.itens || {});
    const total = itens.reduce((s, i) => s + (i.total || 0), 0);
    const pago = itens.filter(i => !!i.paidAt).reduce((s, i) => s + (i.total || 0), 0);
    return { total, pago, pendente: total - pago, empregados: itens.length };
  }, [folha]);

  // Divergências VT
  const divergencias = useMemo(
    () => calcularDivergenciasVT(empregados, escala),
    [empregados, escala],
  );
  const divTotais = useMemo(() => {
    const aReceber = divergencias.filter(d => d.delta > 0).reduce((s, d) => s + d.diferencaValor, 0);
    const aDevolver = -divergencias.filter(d => d.delta < 0).reduce((s, d) => s + d.diferencaValor, 0);
    return { aReceber, aDevolver, saldo: aReceber - aDevolver };
  }, [divergencias]);

  return (
    <Modal title={`📊 Sumário — ${nomeMes(mes)} ${ano}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-5">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {restaurant.nome}
          {escala?.fechadoEm && (
            <> · 🔒 Fechado em {new Date(escala.fechadoEm).toLocaleString("pt-BR")}</>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-gray-500">Carregando dados do mês...</div>
        ) : (
          <>
            {/* Gorjetas */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                💸 Gorjetas
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Bruto" value={fmtBR(totaisGorjeta.bruto)} />
                <Stat label="Retenção" value={fmtBR(totaisGorjeta.retencao)} variant="warn" />
                <Stat label="Líquido" value={fmtBR(totaisGorjeta.liquido)} variant="ok" />
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {totaisGorjeta.total} dia(s) lançado(s) · {totaisGorjeta.pagas} pago(s)
              </div>
            </section>

            {/* VT */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                🚌 Vale Transporte
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Total" value={fmtBR(totaisVT.total)} />
                <Stat label="Pago" value={fmtBR(totaisVT.pago)} variant="ok" />
                <Stat label="Pendente" value={fmtBR(totaisVT.pendente)}
                  variant={totaisVT.pendente > 0 ? "warn" : undefined} />
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {totaisVT.empregados} empregado(s) com VT
              </div>
            </section>

            {/* Divergências VT */}
            {divergencias.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                  📊 Divergências VT (Real vs Prevista)
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="A receber" value={fmtBR(divTotais.aReceber)} variant="ok" />
                  <Stat label="A devolver" value={fmtBR(divTotais.aDevolver)} variant="warn" />
                  <Stat label="Saldo" value={`${divTotais.saldo >= 0 ? "+" : ""}${fmtBR(divTotais.saldo)}`}
                    variant={divTotais.saldo >= 0 ? "ok" : "warn"} />
                </div>
                <div className="text-[11px] text-gray-500 mt-1">
                  {divergencias.length} empregado(s) com divergência
                </div>
              </section>
            )}

            {/* Top empregados por gorjeta */}
            {linhasGorjeta.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                  👥 Distribuição de gorjeta por empregado
                </h3>
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900 max-h-[300px] overflow-y-auto">
                  <div className="grid grid-cols-[1fr_120px_120px] gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                    <div>Empregado</div>
                    <div className="text-right">Bruto</div>
                    <div className="text-right">Líquido</div>
                  </div>
                  {linhasGorjeta.map(l => (
                    <div key={l.nome} className="grid grid-cols-[1fr_120px_120px] gap-2 px-3 py-1.5 text-xs border-t border-gray-100 dark:border-gray-800">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{l.nome}</div>
                        <div className="text-[10px] text-gray-500">{l.cargo} · {l.area}</div>
                      </div>
                      <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(l.bruto)}</div>
                      <div className="text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{fmtBR(l.liquido)}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Histórico (versões anteriores) */}
            {escala?.versoesAnteriores && escala.versoesAnteriores.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                  📜 Histórico
                </h3>
                <div className="space-y-1 text-xs">
                  {escala.versoesAnteriores.map((v, i) => (
                    <div key={i} className="bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 text-gray-700 dark:text-gray-300">
                      {v.motivo === "fechamento" ? "🔒" : "🔓"}{" "}
                      <strong>{v.motivo}</strong> em {new Date(v.snapshotEm).toLocaleString("pt-BR")}
                      {v.motivoTexto && ` — "${v.motivoTexto}"`}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const cls =
    variant === "ok" ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
    : variant === "warn" ? "border-amber-200 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-lg border p-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
