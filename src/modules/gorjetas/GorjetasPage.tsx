import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import {
  daysInMonth, dowShort, fmtAnoMes, nomeMes, pad2, parseYmd, shiftMonth,
} from "../../core/utils/date";
import type { Cargo, Empregado, EscalaMes, Gorjeta } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";

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
  const [loading, setLoading] = useState(true);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const taxRateDefault = activeRestaurant?.taxRate ?? 0;

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

  // Gorjetas do mês
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const inicio = `${ano}-${pad2(mes)}-01`;
    const fim    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
    const q = query(
      collection(db, "gorjetas"),
      where("restaurantId", "==", rid),
      where("date", ">=", inicio),
      where("date", "<=", fim),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Gorjeta);
      list.sort((a, b) => a.date.localeCompare(b.date));
      setGorjetas(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid, ano, mes]);

  const gorjetaMap = useMemo(() => {
    const m: Record<string, Gorjeta> = {};
    gorjetas.forEach(g => { m[g.date] = g; });
    return m;
  }, [gorjetas]);

  const totaisMes = useMemo(() => {
    const bruto = gorjetas.reduce((s, g) => s + (g.valorBruto || 0), 0);
    const liquido = gorjetas.reduce((s, g) => s + (g.valorLiquido || 0), 0);
    return { bruto, liquido, dias: gorjetas.length };
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
        </div>
      </div>

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
          onPickDate={(d) => setEditingDate(d)}
        />
      )}

      {editingDate && (
        <GorjetaModal
          date={editingDate}
          rid={rid}
          taxRateDefault={taxRateDefault}
          gorjeta={gorjetaMap[editingDate] || null}
          empregados={empregados}
          cargos={cargos}
          escala={escala}
          podeEditar={podeConfig}
          onClose={() => setEditingDate(null)}
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
  ano, mes, gorjetaMap, empregados, cargos, escala, onPickDate,
}: {
  ano: number; mes: number;
  gorjetaMap: Record<string, Gorjeta>;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  onPickDate: (d: string) => void;
}) {
  const dias = daysInMonth(ano, mes);
  const todayYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="grid grid-cols-[80px_1fr_120px_120px_60px] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
        <div>Dia</div>
        <div>Resumo</div>
        <div className="text-right">Bruto</div>
        <div className="text-right">Líquido</div>
        <div></div>
      </div>
      {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
        const date = `${ano}-${pad2(mes)}-${pad2(dia)}`;
        const g = gorjetaMap[date];
        const d = parseYmd(date);
        const wd = d.getDay();
        const weekend = wd === 0 || wd === 6;
        const isToday = date === todayYmd;
        const recebem = g ? calcularDivisaoDia(date, g.valorLiquido, empregados, cargos, escala).itens.length : 0;
        return (
          <button
            key={date}
            type="button"
            onClick={() => onPickDate(date)}
            className={`w-full grid grid-cols-[80px_1fr_120px_120px_60px] items-center px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left ${
              weekend ? "bg-amber-50/40 dark:bg-amber-900/10" : ""
            } ${isToday ? "ring-1 ring-indigo-300 dark:ring-indigo-700 ring-inset" : ""}`}
          >
            <div className="font-medium text-gray-900 dark:text-gray-100">
              {pad2(dia)}
              <span className="ml-1 text-[10px] text-gray-400 uppercase">{dowShort(d)}</span>
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
      })}
    </div>
  );
}

function GorjetaModal({
  date, rid, taxRateDefault, gorjeta, empregados, cargos, escala, podeEditar, onClose,
}: {
  date: string; rid: string; taxRateDefault: number;
  gorjeta: Gorjeta | null;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  podeEditar: boolean;
  onClose: () => void;
}) {
  const { pessoa } = useAuth();
  const [valorBruto, setValorBruto] = useState<string>(gorjeta ? String(gorjeta.valorBruto).replace(".", ",") : "");
  const [taxRate, setTaxRate] = useState<string>(String(gorjeta?.taxRate ?? taxRateDefault));
  const [observacao, setObservacao] = useState(gorjeta?.observacao || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const bruto = parseFloat(valorBruto.replace(",", ".")) || 0;
  const tax   = parseFloat(taxRate) || 0;
  const liquido = calcularValorLiquido(bruto, tax);

  const divisao = useMemo(
    () => calcularDivisaoDia(date, liquido, empregados, cargos, escala),
    [date, liquido, empregados, cargos, escala],
  );

  async function salvar() {
    if (!pessoa) return;
    if (bruto <= 0) { setErr("Valor bruto obrigatório"); return; }
    setErr("");
    setSaving(true);
    try {
      const id = `${rid}_${date}`;
      const now = new Date().toISOString();
      const data: Gorjeta = {
        id,
        restaurantId: rid,
        date,
        valorBruto: Math.round(bruto * 100) / 100,
        taxRate: tax,
        valorLiquido: liquido,
        observacao: observacao.trim() || undefined,
        paidAt: gorjeta?.paidAt ?? null,
        paidBy: gorjeta?.paidBy ?? null,
        createdAt: gorjeta?.createdAt || now,
        createdBy: gorjeta?.createdBy || pessoa.id,
        updatedAt: now,
      };
      await setDoc(doc(db, "gorjetas", id), data);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
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
          <Input
            label="Retenção (%)"
            type="number"
            min="0" max="100" step="0.01"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            disabled={!podeEditar}
          />
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
              {divisao.itens.map((it, i) => (
                <div key={it.empregadoId} className={`flex items-center justify-between px-3 py-1.5 text-sm ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
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
              ))}
            </div>
          )}
          {divisao.resto !== 0 && (
            <div className="text-[11px] text-gray-500 mt-2">
              Resto não distribuído: {fmtBR(divisao.resto)}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
        <div>
          {gorjeta && podeEditar && <Button variant="danger" size="sm" onClick={excluir}>Excluir</Button>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {podeEditar && (
            <Button onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
