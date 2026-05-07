import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { canExcluirPessoa } from "../../core/auth/permissions";  // pra checar isMaster
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { todayYmd } from "../../core/utils/date";
import { AREAS } from "../../core/types";
import type { Area, AreaPercentConfig, Cargo, Empregado, SplitVersion } from "../../core/types";
import {
  computeAreaPercentages, countEmpregadosRegistradosNaArea,
  defaultPercentages, getActiveSplitVersion,
} from "./splitRules";
import { HistoricoRegrasTab } from "./HistoricoRegrasTab";

type Props = {
  rid: string;
  onClose: () => void;
};

export function RegrasDivisaoConfig({ rid, onClose: _ }: Props) {
  const { pessoa: me } = useAuth();
  const [tab, setTab] = useState<"editar" | "historico">("editar");
  const [versions, setVersions] = useState<SplitVersion[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);

  // Permissão especial dedicada
  const podeConfigurarRegra = me?.isMaster
    || me?.specialPermissions?.[rid]?.gorjetasConfigurarRegra === true
    // Master mestre por convenção
    || canExcluirPessoa(me, rid);  // reuso ergonômico (master também pode)

  // Carrega versões
  useEffect(() => {
    const q = query(collection(db, "splitVersions"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as SplitVersion);
      list.sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
      setVersions(list);
    });
    return () => unsub();
  }, [rid]);

  // Empregados (pra calcular % efetivo das áreas variáveis)
  useEffect(() => {
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  const versaoVigente = useMemo(
    () => getActiveSplitVersion(versions, todayYmd()),
    [versions],
  );

  // Form
  const [mode, setMode] = useState<"global_points" | "area_points">(versaoVigente?.mode || "global_points");
  const [percentages, setPercentages] = useState<NonNullable<SplitVersion["percentages"]>>(
    versaoVigente?.percentages || defaultPercentages(),
  );
  const [taxRate, setTaxRate] = useState<string>(String(versaoVigente?.taxRate ?? 0));
  const [effectiveFrom, setEffectiveFrom] = useState(todayYmd());
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");

  // Re-sincroniza quando versão vigente muda (após salvar)
  useEffect(() => {
    if (versaoVigente) {
      setMode(versaoVigente.mode);
      setPercentages(versaoVigente.percentages || defaultPercentages());
      setTaxRate(String(versaoVigente.taxRate ?? 0));
    }
  }, [versaoVigente]);

  // Calcula % efetivo de cada área HOJE (com N empregados ativos)
  const cargoMap = useMemo(() =>
    Object.fromEntries(cargos.map(c => [c.id, { area: c.area, tipoVinculo: c.tipoVinculo }])),
    [cargos]
  );
  const empregadosPorArea = useMemo(() => {
    const m: Partial<Record<Area, number>> = {};
    AREAS.forEach(a => {
      m[a] = countEmpregadosRegistradosNaArea(empregados, cargoMap, a, todayYmd());
    });
    return m;
  }, [empregados, cargoMap]);
  const finalPct = useMemo(
    () => computeAreaPercentages(percentages, empregadosPorArea),
    [percentages, empregadosPorArea],
  );
  const somaFinal = useMemo(
    () => Object.values(finalPct).reduce((s, v) => s + v, 0),
    [finalPct],
  );

  function setAreaConfig(area: Area, cfg: AreaPercentConfig) {
    setPercentages(p => ({ ...p, [area]: cfg }));
  }

  async function salvar() {
    if (!me) return;
    if (!podeConfigurarRegra) {
      setErr("Sem permissão. Pede 'gorjetasConfigurarRegra' pro master.");
      return;
    }
    const tax = parseFloat(taxRate) || 0;
    if (tax < 0 || tax > 100) { setErr("Retenção entre 0 e 100"); return; }
    if (!effectiveFrom) { setErr("Data de vigência obrigatória"); return; }
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const novaVersao: Omit<SplitVersion, "id"> = {
        restaurantId: rid,
        effectiveFrom,
        mode,
        ...(mode === "area_points" ? { percentages } : {}),
        taxRate: tax,
        ata: {
          meetingDate: meetingDate || undefined,
          meetingLocation: meetingLocation.trim() || undefined,
          motivo: motivo.trim() || undefined,
        },
        status: "active",
        createdAt: now,
        createdBy: me.id,
      };
      // Marca versões anteriores ativas como superseded (só pra ficar limpo)
      for (const v of versions) {
        if (v.status === "active" && v.effectiveFrom < effectiveFrom) {
          // Mantém — ela ainda foi vigente até effectiveFrom-1 (resolvido por getActive)
        }
      }
      await addDoc(collection(db, "splitVersions"), sanitizeForFirestore(novaVersao));
      await logAudit({
        entityType: "restaurant",
        entityId: rid,
        restaurantId: rid,
        acao: "alterado",
        diff: {
          regraDivisao: { antes: versaoVigente?.id || null, depois: "nova versão" },
          modo: { antes: versaoVigente?.mode || null, depois: mode },
          taxRate: { antes: versaoVigente?.taxRate ?? null, depois: tax },
          effectiveFrom: { antes: versaoVigente?.effectiveFrom || null, depois: effectiveFrom },
        },
        motivo: motivo.trim() || undefined,
        registradoPor: me.id,
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  if (!podeConfigurarRegra) {
    return (
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
        🔒 Mudar regras de divisão exige permissão especial <code>gorjetasConfigurarRegra</code>.
        Peça pro master te dar essa permissão em Pessoas → Permissões → Especiais.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Regras de divisão de gorjeta. Mudanças criam nova versão com data de vigência.
        Cada versão pode gerar uma <strong>Ata de Assembleia</strong>.
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 -mx-1">
        <button
          type="button"
          onClick={() => setTab("editar")}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === "editar"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500"
          }`}
        >
          ✏️ Nova versão
        </button>
        <button
          type="button"
          onClick={() => setTab("historico")}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === "historico"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500"
          }`}
        >
          📋 Histórico ({versions.length})
        </button>
      </div>

      {tab === "historico" && <HistoricoRegrasTab rid={rid} />}

      {tab === "editar" && (
        <>
      {/* Versão vigente */}
      {versaoVigente && (
        <div className="text-xs bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-emerald-800 dark:text-emerald-300">
          ✓ <strong>Vigente desde {versaoVigente.effectiveFrom}.</strong>{" "}
          Modo: {versaoVigente.mode === "global_points" ? "Pontos Globais" : "Por Área + Pontos"}.
          Retenção: {versaoVigente.taxRate}%.
        </div>
      )}

      {/* Modo */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
          Modo de divisão
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("global_points")}
            className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
              mode === "global_points"
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                : "border-gray-200 dark:border-gray-800 hover:bg-gray-50"
            }`}
          >
            <div className="font-medium">📊 Pontos Globais</div>
            <div className="text-xs text-gray-500 mt-1">Líquido inteiro dividido pelos pontos do cargo de quem trabalhou</div>
          </button>
          <button
            type="button"
            onClick={() => setMode("area_points")}
            className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
              mode === "area_points"
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                : "border-gray-200 dark:border-gray-800 hover:bg-gray-50"
            }`}
          >
            <div className="font-medium">🏷️ Por Área + Pontos</div>
            <div className="text-xs text-gray-500 mt-1">Primeiro divide entre áreas (% configurável); dentro da área por pontos</div>
          </button>
        </div>
      </div>

      {/* Áreas (só se modo área) */}
      {mode === "area_points" && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_120px_80px] gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            <div>Área</div>
            <div>Tipo</div>
            <div className="text-right">Valor</div>
            <div className="text-right">% Efetivo hoje</div>
          </div>
          {AREAS.map(area => {
            const cfg = percentages[area];
            const empN = empregadosPorArea[area] || 0;
            return (
              <div key={area} className="grid grid-cols-[1fr_140px_120px_80px] gap-2 px-3 py-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm">
                <div className="font-medium">{area}</div>
                <select
                  value={cfg.type}
                  onChange={(e) => setAreaConfig(area, e.target.value === "fixed"
                    ? { type: "fixed", value: 0 }
                    : { type: "perEmployee", valuePerEmp: 0 })}
                  className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                >
                  <option value="fixed">Fixo (%)</option>
                  <option value="perEmployee">Variável (% × N)</option>
                </select>
                <div>
                  <input
                    type="number"
                    min="0" step="0.01"
                    value={cfg.type === "fixed" ? cfg.value : cfg.valuePerEmp}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      if (cfg.type === "fixed") setAreaConfig(area, { type: "fixed", value: v });
                      else setAreaConfig(area, { type: "perEmployee", valuePerEmp: v });
                    }}
                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right"
                  />
                  {cfg.type === "perEmployee" && (
                    <div className="text-[10px] text-gray-500 mt-0.5">× {empN} empregado{empN !== 1 ? "s" : ""} = {(cfg.valuePerEmp * empN).toFixed(2)}%</div>
                  )}
                </div>
                <div className="text-right tabular-nums font-semibold">
                  {finalPct[area].toFixed(2)}%
                </div>
              </div>
            );
          })}
          <div className={`grid grid-cols-[1fr_140px_120px_80px] gap-2 px-3 py-2 items-center border-t-2 ${
            Math.abs(somaFinal - 100) < 0.01 ? "border-emerald-300 bg-emerald-50/30 dark:bg-emerald-900/10" : "border-rose-300 bg-rose-50/30 dark:bg-rose-900/10"
          }`}>
            <div className="font-bold text-sm">Soma</div>
            <div></div>
            <div></div>
            <div className={`text-right font-bold tabular-nums ${
              Math.abs(somaFinal - 100) < 0.01 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
            }`}>
              {somaFinal.toFixed(2)}%
              {Math.abs(somaFinal - 100) < 0.01 ? " ✓" : " ⚠"}
            </div>
          </div>
        </div>
      )}

      {/* Retenção */}
      <Input
        label="Retenção da gorjeta (%)"
        type="number"
        min="0" max="100" step="0.01"
        value={taxRate}
        onChange={(e) => setTaxRate(e.target.value)}
        placeholder="ex: 33"
      />

      {/* Vigência + Ata */}
      <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
        <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
          Nova versão
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Vigente a partir de *"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
          <Input
            label="Data da assembleia (ata)"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Input
            label="Local da assembleia"
            value={meetingLocation}
            onChange={(e) => setMeetingLocation(e.target.value)}
            placeholder="ex: Sede do restaurante"
          />
          <Input
            label="Motivo / observação"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="ex: ajuste de %"
          />
        </div>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex justify-end items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
        {savedAt && <span className="text-xs text-emerald-600">✓ Salvo às {savedAt}</span>}
        <Button onClick={salvar} disabled={saving || (mode === "area_points" && Math.abs(somaFinal - 100) >= 0.01)}>
          {saving ? "Salvando..." : "Salvar nova versão"}
        </Button>
      </div>
        </>
      )}
    </div>
  );
}
