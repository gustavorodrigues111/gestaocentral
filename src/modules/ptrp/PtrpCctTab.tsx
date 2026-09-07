// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Convenções (CCT) por empresa. Vincula cada empresa (aparecida no sync)
//  a uma das 3 CCTs do grupo, aplicando o template correspondente. O motor de
//  apuração resolve os parâmetros por empresa + data da ocorrência.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { ParametrosCCT } from "../../core/ptrp/tipos";
import { cctQuibebe, cctSaoPaulo, cctBelem } from "../../core/ptrp/cctTemplates";

type Modelo = "quibebe" | "sp_especial" | "sp_diferenciado" | "sp_normal" | "belem";
const MODELOS: { id: Modelo; label: string }[] = [
  { id: "quibebe", label: "Quibebe — EAA/Sescon-SP (60/80/100 · comp. 60d · not. 30%)" },
  { id: "sp_especial", label: "SP Especial — SINTHORESP (extra 50% · not. 20% · banco 365d · saldo −30h)" },
  { id: "sp_diferenciado", label: "SP Diferenciado — SINTHORESP (extra 70% · not. 35% · banco 365d)" },
  { id: "sp_normal", label: "SP Normal — SINTHORESP (extra 100% · not. 50% · banco 90d)" },
  { id: "belem", label: "Belém — SINTHRBS/PA (80% · not. 25% · 12x36 · folga dom. 6 sem)" },
];
function montar(modelo: Modelo, empresaKey: string): ParametrosCCT {
  switch (modelo) {
    case "quibebe": return cctQuibebe(empresaKey);
    case "sp_especial": return cctSaoPaulo(empresaKey, "especial", true);
    case "sp_diferenciado": return cctSaoPaulo(empresaKey, "diferenciado", true);
    case "sp_normal": return cctSaoPaulo(empresaKey, "normal", false);
    case "belem": return cctBelem(empresaKey);
  }
}

const fmtD = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "—";

export function PtrpCctTab() {
  const { pessoa: me } = useAuth();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [ccts, setCcts] = useState<ParametrosCCT[]>([]);
  const [sel, setSel] = useState<Record<string, Modelo>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "ptrpSyncState"), s => setEmpresas(s.docs.map(d => d.id).sort()));
    const u2 = onSnapshot(collection(db, "parametrosCCT"), s => setCcts(s.docs.map(d => ({ id: d.id, ...d.data() }) as ParametrosCCT)));
    return () => { u1(); u2(); };
  }, []);

  // CCT vigente/mais recente por empresa.
  const cctPorEmpresa = useMemo(() => {
    const m: Record<string, ParametrosCCT> = {};
    for (const c of ccts) if (!m[c.empresaKey] || c.vigenciaDe > m[c.empresaKey].vigenciaDe) m[c.empresaKey] = c;
    return m;
  }, [ccts]);

  async function aplicar(empresaKey: string) {
    const modelo = sel[empresaKey];
    if (!modelo) { setMsg("Escolha a CCT antes de aplicar."); return; }
    setSalvando(empresaKey); setMsg("");
    try {
      const p = montar(modelo, empresaKey);
      p.atualizadoEm = new Date().toISOString();
      p.atualizadoPor = { id: me?.id || "", nome: me?.nome || "" };
      await setDoc(doc(db, "parametrosCCT", p.id), sanitizeForFirestore(p));
      setMsg(`✓ CCT aplicada em ${empresaKey}.`);
    } catch (e) {
      setMsg("Falha ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally { setSalvando(null); }
  }

  if (!me?.isMaster) return <div className="p-8 text-center text-gray-500">🔒 Só o master.</div>;

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Vincule cada empresa à sua convenção. O motor de apuração resolve os parâmetros pela empresa do colaborador e pela <strong>data</strong> da ocorrência (CCT tem vigência). As empresas aparecem aqui depois do primeiro sync.</p>
      {msg && <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">{msg}</div>}
      {empresas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhuma empresa ainda — rode o sync primeiro (aba Sincronização).</div>
      ) : (
        <div className="space-y-3">
          {empresas.map(empresaKey => {
            const atual = cctPorEmpresa[empresaKey];
            return (
              <div key={empresaKey} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">🏢 {empresaKey}</div>
                  {atual
                    ? <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${atual.vigente === false ? "bg-amber-400 text-amber-900" : "bg-emerald-500 text-white"}`}>{atual.vigente === false ? "CCT vencida" : "configurada"}</span>
                    : <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200">sem CCT</span>}
                </div>
                {atual && (
                  <div className="mt-2 text-[12.5px] text-gray-600 dark:text-gray-300">
                    <div><strong>{atual.cctNome}</strong> · vigência {fmtD(atual.vigenciaDe)}–{fmtD(atual.vigenciaAte)}</div>
                    <div className="text-gray-500 mt-0.5">
                      extra {atual.extras.faixa1Perc}%{atual.extras.faixa2Perc ? `/${atual.extras.faixa2Perc}%` : ""} · noturno {atual.adicionalNoturno.perc}% · {atual.regimeCompensacao === "banco" ? "banco" : "compensação"} {atual.prazoCompensacaoDias}d{atual.enquadramentoPiso ? ` · piso ${atual.enquadramentoPiso}` : ""}
                    </div>
                    {(atual.pendencias || []).map((p, i) => <div key={i} className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">⚠ {p}</div>)}
                  </div>
                )}
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <select value={sel[empresaKey] || ""} onChange={e => setSel(s => ({ ...s, [empresaKey]: e.target.value as Modelo }))}
                    className="flex-1 min-w-[240px] px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
                    <option value="">— escolher CCT —</option>
                    {MODELOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <Button size="sm" onClick={() => void aplicar(empresaKey)} disabled={salvando === empresaKey || !sel[empresaKey]}>
                    {salvando === empresaKey ? "Salvando…" : atual ? "Substituir" : "Aplicar"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
