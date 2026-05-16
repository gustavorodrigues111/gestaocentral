import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse, unidadesAcessiveis } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { ModuleConfigButton } from "../../core/ui/ModuleConfigButton";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import {
  daysInMonth, dowShort, fmtAnoMes, nomeMes, pad2, parseYmd, shiftMonth,
} from "../../core/utils/date";
import type { Cargo, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import { getActiveSplitVersion } from "./splitRules";
import { RegrasDivisaoConfig } from "./RegrasDivisaoConfig";
import { DivisaoMesTab } from "./DivisaoMesTab";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GorjetasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "gorjetas");
  const podeConfig = canConfig(me, rid, "gorjetas");

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [splitVersions, setSplitVersions] = useState<SplitVersion[]>([]);
  const [loading, setLoading] = useState(true);
  // Quando edita, captura date + unidadeId (vazio se single-unit)
  const [editing, setEditing] = useState<{ date: string; unidadeId: string } | null>(null);
  const [tab, setTab] = useState<"lancamentos" | "divisao">("lancamentos");

  // SplitVersions do restaurante (regras de divisão)
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "splitVersions"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setSplitVersions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SplitVersion));
    });
    return () => unsub();
  }, [rid]);

  // taxRate vigente HOJE — vem da SplitVersion. Sem fallback pro Restaurant
  // (legado). Se não há regra cobrindo hoje → 0 + UI sinaliza "sem regra".
  const taxRateDefault = useMemo(() => {
    const v = getActiveSplitVersion(splitVersions, `${ano}-${pad2(mes)}-${pad2(new Date().getDate())}`);
    return v?.taxRate ?? 0;
  }, [splitVersions, ano, mes]);

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

  // Escala do mês
  useEffect(() => {
    if (!rid) return;
    const ref = doc(db, "escalas", `${rid}_${fmtAnoMes(ano, mes)}`);
    const unsub = onSnapshot(ref, (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, ano, mes]);

  // Gorjetas do mês — query simples (só restaurantId), filtra mês no client
  // pra não precisar criar composite index no Firestore
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(
      collection(db, "gorjetas"),
      where("restaurantId", "==", rid),
    );
    const unsub = onSnapshot(q, (snap) => {
      const inicio = `${ano}-${pad2(mes)}-01`;
      const fim    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
      let list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Gorjeta)
        .filter(g => g.date >= inicio && g.date <= fim);
      // Filtra pelo escopo de unidade da permissão (se restrito)
      const escopo = unidadesAcessiveis(me, rid, "gorjetas");
      if (escopo !== null) {
        list = list.filter(g => !g.unidadeId || escopo.includes(g.unidadeId));
      }
      list.sort((a, b) => a.date.localeCompare(b.date));
      setGorjetas(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid, ano, mes]);

  // Multi-unidades. UI ativa apenas quando há 2+ unidades ativas.
  const todasUnidades = activeRestaurant?.unidades || [];
  const usaMultiUnidades = todasUnidades.filter(u => u.ativa).length > 1;
  // Escopo de permissão de gorjetas — se ampla, mostra todas; senão filtra
  const escopoUnidades = unidadesAcessiveis(me, rid, "gorjetas");
  const unidades = escopoUnidades === null
    ? todasUnidades
    : todasUnidades.filter(u => escopoUnidades.includes(u.id));
  const unidadesAtendimento = unidades.filter(u => u.tipo === "atendimento" && u.ativa);

  // Key da gorjeta na map:
  //   single-unit: date            (gorjetaMap["2026-05-10"])
  //   multi-unidade: date|unidadeId (gorjetaMap["2026-05-10|u_abc"])
  const gorjetaMap = useMemo(() => {
    const m: Record<string, Gorjeta> = {};
    gorjetas.forEach(g => {
      const key = g.unidadeId ? `${g.date}|${g.unidadeId}` : g.date;
      m[key] = g;
    });
    return m;
  }, [gorjetas]);

  const totaisMes = useMemo(() => {
    const bruto = gorjetas.reduce((s, g) => s + (g.valorBruto || 0), 0);
    const liquido = gorjetas.reduce((s, g) => s + (g.valorLiquido || 0), 0);
    const datasUnicas = new Set(gorjetas.map(g => g.date));
    return { bruto, liquido, dias: datasUnicas.size, lancamentos: gorjetas.length };
  }, [gorjetas]);

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
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">💸 Gorjetas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeRestaurant.nome}
            {taxRateDefault > 0 && <> · retenção {taxRateDefault}%</>}
            {taxRateDefault === 0 && <> · sem retenção configurada</>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
          <ModuleConfigButton title="⚙️ Regras de divisão de gorjeta" disabled={!podeConfig}>
            <RegrasDivisaoConfig
              rid={rid}
              onClose={() => { /* fechado pelo Modal */ }}
            />
          </ModuleConfigButton>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4">
        <button
          type="button"
          onClick={() => setTab("lancamentos")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "lancamentos"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
          }`}
        >
          📅 Lançamentos
        </button>
        <button
          type="button"
          onClick={() => setTab("divisao")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "divisao"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
          }`}
        >
          📊 Divisão do mês
        </button>
      </div>

      {tab === "lancamentos" && (
        <>
          {/* Resumo do mês */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card label="Bruto do mês" value={fmtBR(totaisMes.bruto)} />
            <Card label="Líquido do mês" value={fmtBR(totaisMes.liquido)} highlight />
            <Card label="Dias lançados" value={`${totaisMes.dias} dia(s)`} />
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : (
            <ListaDias
              ano={ano}
              mes={mes}
              gorjetaMap={gorjetaMap}
              empregados={empregados}
              cargos={cargos}
              escala={escala}
              splitVersions={splitVersions}
              unidadesAtendimento={unidadesAtendimento}
              unidades={unidades}
              usaMultiUnidades={usaMultiUnidades}
              onPick={(date, unidadeId) => setEditing({ date, unidadeId })}
            />
          )}
        </>
      )}

      {tab === "divisao" && (
        <DivisaoMesTab
          ano={ano}
          mes={mes}
          gorjetas={gorjetas}
          empregados={empregados}
          cargos={cargos}
          escala={escala}
          splitVersions={splitVersions}
          restaurantNome={activeRestaurant.nome}
          unidades={unidades}
          usaMultiUnidades={usaMultiUnidades}
        />
      )}

      {editing && (
        <GorjetaModal
          date={editing.date}
          rid={rid}
          taxRateDefault={taxRateDefault}
          gorjeta={
            (editing.unidadeId
              ? gorjetaMap[`${editing.date}|${editing.unidadeId}`]
              : gorjetaMap[editing.date]
            ) || null
          }
          empregados={empregados}
          cargos={cargos}
          escala={escala}
          splitVersions={splitVersions}
          podeEditar={podeConfig}
          onClose={() => setEditing(null)}
          unidadeId={editing.unidadeId || undefined}
          unidades={unidades}
          usaMultiUnidades={usaMultiUnidades}
        />
      )}
    </div>
  );
}

function Card({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${
      highlight
        ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800"
        : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
    }`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-bold ${highlight ? "text-emerald-700 dark:text-emerald-300" : "text-gray-900 dark:text-gray-100"}`}>
        {value}
      </div>
    </div>
  );
}

function ListaDias({
  ano, mes, gorjetaMap, empregados, cargos, escala, splitVersions,
  unidadesAtendimento, unidades, usaMultiUnidades, onPick,
}: {
  ano: number; mes: number;
  gorjetaMap: Record<string, Gorjeta>;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  unidadesAtendimento: Unidade[];
  unidades: Unidade[];
  usaMultiUnidades: boolean;
  onPick: (date: string, unidadeId: string) => void;
}) {
  const dias = daysInMonth(ano, mes);
  const todayYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  // Lista de unidades a exibir: pra multi, 1 row por unidade de atendimento.
  // Pra single, 1 row sem unidade (com "" como key).
  const unidadesParaRow: { id: string; nome: string }[] = usaMultiUnidades
    ? unidadesAtendimento.map(u => ({ id: u.id, nome: u.nome }))
    : [{ id: "", nome: "" }];

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="grid grid-cols-[80px_120px_1fr_120px_120px_60px] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
        <div>Dia</div>
        <div>Unidade</div>
        <div>Resumo</div>
        <div className="text-right">Bruto</div>
        <div className="text-right">Líquido</div>
        <div></div>
      </div>
      {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
        const date = `${ano}-${pad2(mes)}-${pad2(dia)}`;
        const d = parseYmd(date);
        const wd = d.getDay();
        const weekend = wd === 0 || wd === 6;
        const isToday = date === todayYmd;
        const splitVersion = getActiveSplitVersion(splitVersions, date);
        return unidadesParaRow.map((u, idx) => {
          const key = u.id ? `${date}|${u.id}` : date;
          const g = gorjetaMap[key];
          const recebem = g
            ? calcularDivisaoDia(date, g.valorLiquido, empregados, cargos, escala, splitVersion, u.id || null, unidades).itens.length
            : 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(date, u.id)}
              className={`w-full grid grid-cols-[80px_120px_1fr_120px_120px_60px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left ${
                weekend ? "bg-amber-50/40 dark:bg-amber-900/10" : ""
              } ${isToday ? "ring-1 ring-indigo-300 dark:ring-indigo-700 ring-inset" : ""}`}
            >
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {idx === 0 ? (
                  <>
                    {pad2(dia)}
                    <span className="ml-1 text-[10px] text-gray-400 uppercase">{dowShort(d)}</span>
                  </>
                ) : (
                  <span className="text-gray-300 dark:text-gray-700">·</span>
                )}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {usaMultiUnidades ? u.nome : <span className="text-gray-400">—</span>}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {g
                  ? <>{recebem} empregado(s) recebem · {fmtBR(g.valorLiquido / Math.max(1, recebem))} médio</>
                  : <span className="text-gray-400">— sem lançamento —</span>}
              </div>
              <div className={`text-right font-medium ${g ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}`}>
                {g ? fmtBR(g.valorBruto) : "—"}
              </div>
              <div className={`text-right font-medium ${g ? "text-emerald-600" : "text-gray-400"}`}>
                {g ? fmtBR(g.valorLiquido) : "—"}
              </div>
              <div className="text-right text-gray-400">›</div>
            </button>
          );
        });
      })}
    </div>
  );
}

function GorjetaModal({
  date, rid, taxRateDefault, gorjeta, empregados, cargos, escala, splitVersions, podeEditar, onClose,
  unidadeId: unidadeIdProp, unidades, usaMultiUnidades,
}: {
  date: string; rid: string; taxRateDefault: number;
  gorjeta: Gorjeta | null;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  podeEditar: boolean;
  onClose: () => void;
  unidadeId?: string;          // unidade pré-selecionada (se vier da listagem por unidade)
  unidades: Unidade[];
  usaMultiUnidades: boolean;
}) {
  const { pessoa } = useAuth();
  const [valorBruto, setValorBruto] = useState<string>(gorjeta ? String(gorjeta.valorBruto).replace(".", ",") : "");
  const [observacao, setObservacao] = useState(gorjeta?.observacao || "");
  const [unidadeId, setUnidadeId] = useState<string>(
    gorjeta?.unidadeId || unidadeIdProp || ""
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const isPago = !!gorjeta?.paidAt;
  const unidadesAtendimento = unidades.filter(u => u.tipo === "atendimento" && u.ativa);

  // SplitVersion vigente NA DATA da gorjeta (não hoje)
  const splitVersion = useMemo(() => getActiveSplitVersion(splitVersions, date), [splitVersions, date]);

  // taxRate: se a gorjeta está PAGA, usa o snapshot dela (congelado);
  // senão usa a splitVersion vigente da data (ou default do restaurante).
  // Antes priorizava gorjeta.taxRate sempre, o que era ruim pra docs
  // importados com taxRate em formato decimal (0.2 em vez de 20).
  const tax = (gorjeta?.paidAt && gorjeta?.taxRate != null)
    ? gorjeta.taxRate
    : (splitVersion?.taxRate ?? taxRateDefault);

  const bruto = parseFloat(valorBruto.replace(",", ".")) || 0;
  const liquido = calcularValorLiquido(bruto, tax);

  // Se a gorjeta está paga, usa o snapshot da divisão (congelado).
  // Senão, calcula em tempo real a partir da escala/cargos/splitVersion vigentes na data.
  const divisaoLive = useMemo(
    () => calcularDivisaoDia(date, liquido, empregados, cargos, escala, splitVersion, unidadeId || null, unidades),
    [date, liquido, empregados, cargos, escala, splitVersion, unidadeId, unidades],
  );
  const divisao = isPago && gorjeta?.divisaoSnapshot
    ? {
        itens: gorjeta.divisaoSnapshot,
        totalPontos: gorjeta.divisaoSnapshot.reduce((s, i) => s + i.pontos, 0),
        valorPonto: gorjeta.divisaoSnapshot[0]?.pontos
          ? gorjeta.divisaoSnapshot[0].valor / gorjeta.divisaoSnapshot[0].pontos : 0,
        totalDistribuido: gorjeta.divisaoSnapshot.reduce((s, i) => s + i.valor, 0),
        resto: 0,
      }
    : divisaoLive;

  async function salvar() {
    if (!pessoa) return;
    if (bruto <= 0) { setErr("Valor bruto obrigatório"); return; }
    if (usaMultiUnidades && !unidadeId) {
      setErr("Selecione a unidade que arrecadou essa gorjeta.");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      // ID composto quando multi-unidade
      const id = unidadeId ? `${rid}_${date}_${unidadeId}` : `${rid}_${date}`;
      const now = new Date().toISOString();
      const data: Gorjeta = {
        id,
        restaurantId: rid,
        date,
        unidadeId: unidadeId || null,
        valorBruto: Math.round(bruto * 100) / 100,
        taxRate: tax,
        valorLiquido: liquido,
        observacao: observacao.trim() || undefined,
        divisaoSnapshot: gorjeta?.divisaoSnapshot,
        paidAt: gorjeta?.paidAt ?? null,
        paidBy: gorjeta?.paidBy ?? null,
        createdAt: gorjeta?.createdAt || now,
        createdBy: gorjeta?.createdBy || pessoa.id,
        updatedAt: now,
      };
      await setDoc(doc(db, "gorjetas", id), sanitizeForFirestore(data));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function pagar() {
    if (!pessoa || !gorjeta) return;
    if (!confirm(`Marcar como PAGO?\n\nA divisão atual (${divisaoLive.itens.length} pessoa(s) · ${fmtBR(divisaoLive.totalDistribuido)}) será CONGELADA como snapshot. Mudanças futuras em cargos/escala não afetam essa gorjeta.`)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await setDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
        ...gorjeta,
        divisaoSnapshot: divisaoLive.itens,
        paidAt: now,
        paidBy: pessoa.id,
        updatedAt: now,
      }));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function desfazerPagamento() {
    if (!gorjeta) return;
    if (!confirm("Desfazer pagamento?\n\nA divisão volta a ser calculada em tempo real e o snapshot é apagado.")) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
        ...gorjeta,
        divisaoSnapshot: null,
        paidAt: null,
        paidBy: null,
        updatedAt: new Date().toISOString(),
      }));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (!gorjeta) return;
    if (!confirm("Excluir o lançamento deste dia?")) return;
    await deleteDoc(doc(db, "gorjetas", gorjeta.id));
    onClose();
  }

  const d = parseYmd(date);
  const titulo = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} (${dowShort(d)})`;

  return (
    <Modal title={`Gorjeta · ${titulo}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="grid md:grid-cols-2 gap-5">
        {/* Esquerda: lançamento */}
        <div className="space-y-3">
          {usaMultiUnidades && (
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidade que arrecadou *</label>
              <select
                value={unidadeId}
                onChange={(e) => setUnidadeId(e.target.value)}
                disabled={!podeEditar || isPago}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-60"
              >
                <option value="">— escolha a unidade —</option>
                {unidadesAtendimento.map(u => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>
              {isPago && (
                <p className="text-[11px] text-gray-500 mt-1">Lançamento pago — unidade não pode mudar.</p>
              )}
            </div>
          )}
          <Input
            label="Valor bruto (R$)"
            type="text"
            inputMode="decimal"
            value={valorBruto}
            onChange={(e) => setValorBruto(e.target.value)}
            placeholder="0,00"
            disabled={!podeEditar}
            autoFocus
          />
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Retenção {gorjeta ? "(snapshot do dia)" : "(do restaurante)"}
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{tax}%</div>
              <span className="text-[11px] text-gray-500">
                {gorjeta
                  ? "fixo neste lançamento — pra mudar, use o ⚙️ de Gorjetas (afeta novos)"
                  : "vem do ⚙️ Configurações de Gorjetas — vai virar snapshot ao salvar"}
              </span>
            </div>
          </div>
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Líquido a distribuir</div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{fmtBR(liquido)}</div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação</label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              disabled={!podeEditar}
              rows={2}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-60"
            />
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>

        {/* Direita: divisão */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Divisão</div>
            <div className="text-xs text-gray-500">
              {divisao.totalPontos > 0 && <>{divisao.totalPontos.toFixed(1)} pts · {fmtBR(divisao.valorPonto)}/pt</>}
            </div>
          </div>
          {divisao.itens.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">
              Ninguém recebe nesse dia.
              <div className="text-xs mt-1 text-gray-400">Confira escala, cargos e flags de produção.</div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 max-h-[340px] overflow-y-auto">
              {[...divisao.itens]
                .sort((a, b) => (a.area || "").localeCompare(b.area || "") || a.empregadoNome.localeCompare(b.empregadoNome))
                .map((it, i, arr) => {
                const areaPrev = i > 0 ? arr[i - 1].area : null;
                const isPrimeiroDaArea = it.area !== areaPrev;
                return (
                  <Fragment key={it.empregadoId}>
                    {isPrimeiroDaArea && (
                      <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 first:border-t-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                          {it.area || "Sem área"}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-3 py-1.5 text-sm border-t border-gray-100 dark:border-gray-800">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{it.empregadoNome}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400">
                          {it.cargoNome} · {it.pontos} pts
                          {it.motivo === "freela" && " · freela"}
                          {it.motivo === "producao" && " · produção"}
                        </div>
                      </div>
                      <div className="font-semibold text-emerald-600 tabular-nums">{fmtBR(it.valor)}</div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}
          {divisao.resto !== 0 && (
            <div className="text-[11px] text-gray-500 mt-2">
              Resto não distribuído: {fmtBR(divisao.resto)}
            </div>
          )}
        </div>
      </div>

      {isPago && (
        <div className="mt-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          ✓ <strong>Paga em {gorjeta?.paidAt && new Date(gorjeta.paidAt).toLocaleString("pt-BR")}.</strong>{" "}
          Divisão congelada — mudanças posteriores em cargos/escala não afetam.
        </div>
      )}

      <div className="flex justify-between items-center pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
        <div className="flex gap-2">
          {gorjeta && podeEditar && !isPago && (
            <Button variant="danger" size="sm" onClick={excluir}>Excluir</Button>
          )}
          {gorjeta && podeEditar && isPago && (
            <Button variant="secondary" size="sm" onClick={desfazerPagamento}>↩ Desfazer pagamento</Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {podeEditar && !isPago && gorjeta && divisaoLive.itens.length > 0 && (
            <Button variant="secondary" onClick={pagar} disabled={saving}>💰 Marcar como pago</Button>
          )}
          {podeEditar && !isPago && (
            <Button onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// GorjetasConfig antigo foi substituído por RegrasDivisaoConfig (Fase 16A).
// O arquivo RegrasDivisaoConfig.tsx faz CRUD de SplitVersion versionado.
