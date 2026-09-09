// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Mapeamento de motivos (Sólides ↔ status da escala do planejamento.app).
//  Puxa AO VIVO os motivos de ajuste/afastamento da Sólides (por empresa) e deixa
//  o usuário: (a) mapear cada motivo → um ScheduleStatus (pra formar a praticada);
//  (b) marcar quais aparecem no tratamento (⚙️) do PTRP. Guarda em ptrpMotivosMapa/{empresa}.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import type { ScheduleStatus } from "../../core/types";
import { fetchMotivosAfastamento, type MotivoAfastamento } from "../../core/ponto/solidesPontoClient";

export type MotivoMap = { status?: ScheduleStatus | ""; exibir?: boolean; descricao?: string };
export type PtrpMotivosMapa = { empresaKey?: string; mapa?: Record<string, MotivoMap>; atualizadoEm?: string };

// Os 8 status da escala (mesmos do módulo Escala) — alvo do mapeamento.
export const STATUS_OPCOES: { id: ScheduleStatus; label: string }[] = [
  { id: "trabalho", label: "Trabalho" },
  { id: "folga", label: "Folga" },
  { id: "comp", label: "Folga por compensação" },
  { id: "comp_trab", label: "Trabalho por compensação" },
  { id: "ferias", label: "Férias" },
  { id: "falta_j", label: "Falta justificada" },
  { id: "falta_i", label: "Falta injustificada" },
  { id: "freela", label: "Freela" },
];

const inp = "px-2 py-1 text-[12px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

export function PtrpMotivosTab() {
  const { pessoa: me } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const shortCode = (activeRestaurant as { shortCode?: string } | null)?.shortCode || "";
  const [motivos, setMotivos] = useState<MotivoAfastamento[]>([]);
  const [mapa, setMapa] = useState<Record<string, MotivoMap>>({});
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { if (!shortCode) { setMapa({}); return; } return onSnapshot(doc(db, "ptrpMotivosMapa", shortCode), d => setMapa(d.exists() ? ((d.data() as PtrpMotivosMapa).mapa || {}) : {})); }, [shortCode]);
  useEffect(() => {
    if (!shortCode) { setMotivos([]); return; }
    setLoading(true); setErro("");
    fetchMotivosAfastamento(shortCode).then(setMotivos).catch(e => setErro(e instanceof Error ? e.message : "Falha ao buscar os motivos da Sólides.")).finally(() => setLoading(false));
  }, [shortCode]);

  const setM = (id: number, patch: MotivoMap) => setMapa(m => ({ ...m, [id]: { ...m[id], ...patch } }));

  async function salvar() {
    setSalvando(true); setMsg("");
    try {
      const full: Record<string, MotivoMap> = { ...mapa };
      for (const mo of motivos) full[mo.id] = { ...full[mo.id], descricao: mo.description };
      await setDoc(doc(db, "ptrpMotivosMapa", shortCode), sanitizeForFirestore({ empresaKey: shortCode, mapa: full, atualizadoEm: new Date().toISOString(), atualizadoPor: me ? { id: me.id, nome: me.nome } : null }));
      setMsg("✓ Mapeamento salvo.");
    } catch (e) { setMsg("Falha: " + (e instanceof Error ? e.message : "erro")); }
    finally { setSalvando(false); }
  }

  const nExibir = Object.values(mapa).filter(m => m.exibir).length;

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Motivos de ajuste/afastamento da <strong>Sólides</strong> ({activeRestaurant?.nome}) — puxados ao vivo. Para cada um: <strong>→ status da escala</strong> (forma a praticada) e <strong>☑ exibir no tratamento do PTRP</strong> (o ⚙️ da Conferência lista só os marcados).</p>
      {erro && <div className="text-[12px] text-rose-600 mb-2">⚠ {erro}</div>}
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Buscando motivos da Sólides…</div> : motivos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhum motivo retornado — confira o token da empresa no Sólides.</div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[520px] [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:px-2.5">
              <thead><tr className="text-[10px] uppercase text-gray-400 text-left border-b border-gray-200 dark:border-gray-800">
                <th className="py-2">Motivo (Sólides)</th><th>→ Status da escala</th><th className="text-center">Exibir no PTRP</th>
              </tr></thead>
              <tbody>
                {motivos.map(mo => { const m = mapa[mo.id] || {}; return (
                  <tr key={mo.id} className="border-b border-gray-50 dark:border-gray-800/40">
                    <td className="text-gray-800 dark:text-gray-100">{mo.description}<span className="text-[10px] text-gray-400 ml-1.5">#{mo.id}{mo.fullDay ? " · dia inteiro" : ""}</span></td>
                    <td>
                      <select value={m.status || ""} onChange={e => setM(mo.id, { status: e.target.value as ScheduleStatus | "" })} className={inp}>
                        <option value="">— não mapeado —</option>
                        {STATUS_OPCOES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="text-center"><input type="checkbox" checked={!!m.exibir} onChange={e => setM(mo.id, { exibir: e.target.checked })} /></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar mapeamento"}</Button>
            <span className="text-[11px] text-gray-400">{nExibir} motivo(s) marcado(s) pra exibir no PTRP.</span>
            {msg && <span className={`text-[12px] ${msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
