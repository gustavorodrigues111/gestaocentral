// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Convenções (CCT) por empresa. Lista as empresas e abre o EDITOR
//  completo (PtrpCctEditor) com todas as premissas descritas e editáveis — o
//  editor tem "carregar de um modelo" pra pré-preencher com uma das 3 CCTs.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type { ParametrosCCT } from "../../core/ptrp/tipos";
import { PtrpCctEditor } from "./PtrpCctEditor";
import { PtrpAejConfig } from "./PtrpAejConfig";

const fmtD = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "—";

export function PtrpCctTab() {
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [ccts, setCcts] = useState<ParametrosCCT[]>([]);
  const [editando, setEditando] = useState<{ empresaKey: string; inicial: ParametrosCCT | null } | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "ptrpSyncState"), s => setEmpresas(s.docs.map(d => d.id).sort()));
    const u2 = onSnapshot(collection(db, "parametrosCCT"), s => setCcts(s.docs.map(d => ({ id: d.id, ...d.data() }) as ParametrosCCT)));
    return () => { u1(); u2(); };
  }, []);

  const cctPorEmpresa = useMemo(() => {
    const m: Record<string, ParametrosCCT> = {};
    for (const c of ccts) if (!m[c.empresaKey] || c.vigenciaDe > m[c.empresaKey].vigenciaDe) m[c.empresaKey] = c;
    return m;
  }, [ccts]);

  // Acesso controlado pela permissão "regras" (Perfis de Acesso), não mais só master.

  return (
    <div>
      <PtrpAejConfig empresas={empresas} />
      <p className="text-xs text-gray-500 mb-3">Cada empresa tem sua convenção com <strong>vigência</strong>. Clique em Configurar pra ver e editar <strong>todas as premissas</strong> (o editor pré-preenche com um modelo e deixa tudo ajustável). A apuração resolve os parâmetros pela empresa do colaborador e pela data da ocorrência. As empresas aparecem após o primeiro sync.</p>
      {empresas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhuma empresa ainda — rode o sync primeiro (aba Sincronização).</div>
      ) : (
        <div className="space-y-3">
          {empresas.map(empresaKey => {
            const atual = cctPorEmpresa[empresaKey] || null;
            return (
              <div key={empresaKey} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">🏢 {empresaKey}</div>
                  <div className="flex items-center gap-2">
                    {atual
                      ? <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${atual.vigente === false ? "bg-amber-400 text-amber-900" : "bg-emerald-500 text-white"}`}>{atual.vigente === false ? "CCT vencida" : "configurada"}</span>
                      : <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200">sem CCT</span>}
                    <Button size="sm" variant={atual ? "secondary" : "primary"} onClick={() => setEditando({ empresaKey, inicial: atual })}>{atual ? "✏️ Editar" : "⚙️ Configurar"}</Button>
                  </div>
                </div>
                {atual && (
                  <div className="mt-2 text-[12.5px] text-gray-600 dark:text-gray-300">
                    <div><strong>{atual.cctNome}</strong> · vigência {fmtD(atual.vigenciaDe)}–{fmtD(atual.vigenciaAte)}</div>
                    <div className="text-gray-500 mt-0.5">
                      extra {atual.extras.faixa1Perc}%{atual.extras.faixa2Perc ? `/${atual.extras.faixa2Perc}%` : ""} · noturno {atual.adicionalNoturno.perc}% · {atual.regimeCompensacao === "banco" ? "banco" : "compensação"} {atual.prazoCompensacaoDias}d{atual.enquadramentoPiso ? ` · piso ${atual.enquadramentoPiso}` : ""}
                    </div>
                    {(atual.pendencias || []).map((pd, i) => <div key={i} className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">⚠ {pd}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editando && <PtrpCctEditor empresaKey={editando.empresaKey} inicial={editando.inicial} onClose={() => setEditando(null)} />}
    </div>
  );
}
