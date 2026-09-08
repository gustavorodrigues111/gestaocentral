// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Configuração do AEJ / empregador (Portaria 671).
//  Guarda em parametrosPTRP/global: dados do DESENVOLVEDOR do PTRP (registro 08)
//  e, por empresa, o CNPJ do empregador (cabeçalho 01) + o nº/tipo do REP
//  (registro 02). Sem isso o AEJ sai com fonte "T" e CNPJ em branco.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { Restaurant } from "../../core/types";

export type PtrpDev = { tipoId: "1" | "2"; id: string; nome: string; email: string };
export type PtrpEmpCfg = { cnpj?: string; repTipo?: "1" | "2" | "3"; repNumero?: string };
export type ParametrosPTRP = { desenvolvedor?: PtrpDev; empresas?: Record<string, PtrpEmpCfg>; atualizadoEm?: string };

// Desenvolvedor padrão = Quibebe (o PTRP é in-house; não exige registro em órgão).
export const DEV_PADRAO: PtrpDev = { tipoId: "1", id: "23972933000146", nome: "QUIBEBE COZINHA LTDA.", email: "contato@quibebe.com.br" };
// REP-P do software da Sólides — o mesmo pra todas as contas (do cabeçalho do AFD).
export const REP_PADRAO = "5120210032276";

const inp = "w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
const lbl = "text-[11px] font-semibold text-gray-600 dark:text-gray-400";

export function PtrpAejConfig({ empresas }: { empresas: string[] }) {
  const { pessoa: me } = useAuth();
  const [cfg, setCfg] = useState<ParametrosPTRP>({});
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  const [rests, setRests] = useState<Restaurant[]>([]);
  useEffect(() => onSnapshot(doc(db, "parametrosPTRP", "global"), d => setCfg(d.exists() ? (d.data() as ParametrosPTRP) : {})), []);
  useEffect(() => onSnapshot(collection(db, "restaurants"), s => setRests(s.docs.map(d => ({ id: d.id, ...d.data() }) as Restaurant))), []);
  const restPorShort = useMemo(() => { const m: Record<string, Restaurant> = {}; for (const r of rests) if (r.shortCode) m[r.shortCode] = r; return m; }, [rests]);

  const dev: PtrpDev = { ...DEV_PADRAO, ...(cfg.desenvolvedor || {}) };
  const empCfg = (k: string): PtrpEmpCfg => cfg.empresas?.[k] || {};
  const setDev = (patch: Partial<PtrpDev>) => setCfg(c => ({ ...c, desenvolvedor: { ...dev, ...patch } }));
  const setEmp = (k: string, patch: Partial<PtrpEmpCfg>) => setCfg(c => ({ ...c, empresas: { ...(c.empresas || {}), [k]: { ...empCfg(k), ...patch } } }));

  async function salvar() {
    setSalvando(true); setMsg("");
    try {
      const empresasMat: Record<string, PtrpEmpCfg> = { ...(cfg.empresas || {}) };
      for (const k of empresas) empresasMat[k] = { repTipo: empresasMat[k]?.repTipo || "3", repNumero: empresasMat[k]?.repNumero ?? REP_PADRAO };
      await setDoc(doc(db, "parametrosPTRP", "global"), sanitizeForFirestore({ ...cfg, empresas: empresasMat, desenvolvedor: dev, atualizadoEm: new Date().toISOString(), atualizadoPor: me ? { id: me.id, nome: me.nome } : null }));
      setMsg("✓ Configuração salva.");
    } catch (e) { setMsg("Falha: " + (e instanceof Error ? e.message : "erro")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-900/10 mb-3">
      <button type="button" onClick={() => setAberto(v => !v)} className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left">
        <span className="font-semibold text-gray-800 dark:text-gray-100 text-[13px]">⚙️ Configuração do AEJ — empregador · REP · desenvolvedor</span>
        <span className="text-gray-400 text-xs">{aberto ? "▲" : "▼ abrir"}</span>
      </button>
      {aberto && (
        <div className="px-3.5 pb-3.5 space-y-4">
          {/* Desenvolvedor do PTRP (registro 08) */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Desenvolvedor do PTRP (registro 08) — o programa de tratamento</div>
            <p className="text-[11px] text-gray-500 mb-2">O PTRP não precisa de registro em órgão nenhum (é in-house). Identifica só quem desenvolve/opera o programa — no caso, o Quibebe.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="flex flex-col gap-1"><label className={lbl}>Tipo</label>
                <select value={dev.tipoId} onChange={e => setDev({ tipoId: e.target.value as "1" | "2" })} className={inp}><option value="1">CNPJ</option><option value="2">CPF</option></select></div>
              <div className="flex flex-col gap-1"><label className={lbl}>{dev.tipoId === "1" ? "CNPJ" : "CPF"}</label><input value={dev.id} onChange={e => setDev({ id: e.target.value })} className={inp} placeholder="só números" /></div>
              <div className="flex flex-col gap-1"><label className={lbl}>Razão social / nome</label><input value={dev.nome} onChange={e => setDev({ nome: e.target.value })} className={inp} /></div>
              <div className="flex flex-col gap-1"><label className={lbl}>E-mail</label><input value={dev.email} onChange={e => setDev({ email: e.target.value })} className={inp} /></div>
            </div>
          </div>

          {/* Empregador (do cadastro) + REP por empresa */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Por empresa — empregador (do cadastro) + nº do REP (Sólides)</div>
            <p className="text-[11px] text-gray-500 mb-2">CNPJ e razão social vêm do <strong>cadastro do restaurante</strong> (Configurações). O nº do REP vem do cabeçalho do AFD da Sólides — é o mesmo REP-P pra todas (já pré-preenchido).</p>
            <div className="space-y-2">
              {empresas.length === 0 && <div className="text-[12px] text-gray-400">Nenhuma empresa ainda — rode o sync.</div>}
              {empresas.map(k => { const e = empCfg(k); const r = restPorShort[k]; const rep = e.repNumero ?? REP_PADRAO; return (
                <div key={k} className="grid grid-cols-1 sm:grid-cols-[1fr_240px] gap-2 items-center rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-700 dark:text-gray-200 text-[13px] truncate">🏢 {r?.razaoSocial || r?.nome || k} <span className="text-[11px] font-normal text-gray-400">· {k}</span></div>
                    {r?.cnpj ? <div className="text-[11px] text-gray-500 tabular-nums">CNPJ {r.cnpj}</div> : <div className="text-[11px] text-amber-600 dark:text-amber-400">⚠ sem CNPJ no cadastro — preencha em Configurações → cadastro do restaurante</div>}
                  </div>
                  <div className="flex flex-col gap-1"><label className={lbl}>Nº do REP (REP-P)</label><input value={rep} onChange={ev => setEmp(k, { repNumero: ev.target.value, repTipo: e.repTipo || "3" })} className={inp} placeholder={REP_PADRAO} /></div>
                </div>
              ); })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar configuração"}</Button>
            {msg && <span className={`text-[12px] ${msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
