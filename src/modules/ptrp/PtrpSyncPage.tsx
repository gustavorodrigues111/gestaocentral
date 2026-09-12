// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Status do sync de batidas (master).
//  Mostra, por empresa, o cursor e o resultado da última sincronização do
//  /api/ptrp-punch-sync (batidas do Sólides → coleção imutável ptrpBatidas).
//  Permite disparar o sync na hora (geral ou por empresa) pra acompanhar o
//  backfill sem abrir o console do Firestore.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Scale, Landmark, Settings, ScrollText, Repeat, Building2, Lock, TriangleAlert, Hourglass } from "lucide-react";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { PtrpCctTab } from "./PtrpCctTab";
import { PtrpApuracaoTab } from "./PtrpApuracaoTab";
import { PageContainer } from "../../core/ui/PageContainer";

type SyncState = {
  id: string;
  cursor?: string;
  ultimaSync?: string;
  ok?: boolean;
  erro?: string | null;
  ultimaJanela?: { desde?: string; ate?: string };
  primeiroDia?: string;
  lidasUltima?: number;
  criadasUltima?: number;
  atrasado?: boolean;
};

const hojeBRT = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const fmtDT = (iso?: string) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtD = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "—";
const desde = (iso?: string) => {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "agora há pouco";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
};

export function PtrpSyncPage() {
  const { pessoa: me } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const shortCode = (activeRestaurant as { shortCode?: string } | null)?.shortCode || "";
  const { can } = useCanAcao(activeRestaurant?.id || "");
  const isMaster = !!me?.isMaster;
  const podeConferir = isMaster || can("ponto", "conferir");
  const podeValidar = isMaster || can("ponto", "validar");
  const podeBanco = isMaster || can("ponto", "banco");
  const podeSincronizar = isMaster || can("ponto", "sincronizar");
  const podeRegras = isMaster || can("ponto", "regras");
  const podeConfig = podeSincronizar || podeRegras;   // aba Configurações agrupa Regras/Sync/Mapeamento
  const [estados, setEstados] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(true);
  const [rodando, setRodando] = useState<string | null>(null);   // "*" = geral; ou empresaKey
  const [msg, setMsg] = useState("");
  const [aba, setAba] = useState<"conferencia" | "validar" | "banco" | "config">("conferencia");
  const [subAba, setSubAba] = useState<"regras" | "sync" | "validadores">("regras");
  const [desdeInput, setDesdeInput] = useState("");
  // Top-abas (Conferência · Banco · Configurações); a efetiva é a 1ª válida.
  const abasPermitidas = [
    ...(podeConferir ? [["conferencia", "Conferência", BarChart3] as const] : []),
    ...(podeValidar ? [["validar", "Exceções a validar", Scale] as const] : []),
    ...(podeBanco ? [["banco", "Banco de horas", Landmark] as const] : []),
    ...(podeConfig ? [["config", "Configurações", Settings] as const] : []),
  ];
  const abaEfetiva = abasPermitidas.some(([v]) => v === aba) ? aba : (abasPermitidas[0]?.[0] || "conferencia");
  // Sub-abas de Configurações (Regras · Sincronização). O mapeamento de motivos
  // saiu daqui — agora é feito INLINE no tratamento (⚙️): preferidos (★) + o
  // status da escala é lembrado por motivo. Sem tabela gigante.
  const subAbas = [
    ...(podeRegras ? [["regras", <span className="inline-flex items-center gap-1"><ScrollText size={14}/> Regras</span>] as const] : []),
    ...(podeSincronizar ? [["sync", <span className="inline-flex items-center gap-1"><Repeat size={14}/> Sincronização</span>] as const] : []),
    ...(podeRegras ? [["validadores", <span className="inline-flex items-center gap-1"><Scale size={14}/> Responsáveis por área</span>] as const] : []),
  ];
  const subAbaEfetiva = subAbas.some(([v]) => v === subAba) ? subAba : (subAbas[0]?.[0] || "regras");

  useEffect(() => {
    const u = onSnapshot(collection(db, "ptrpSyncState"), snap => {
      setEstados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SyncState).sort((a, b) => a.id.localeCompare(b.id)));
      setLoading(false);
    }, () => setLoading(false));
    return () => u();
  }, []);

  const hoje = hojeBRT();
  const algumAtrasado = useMemo(() => estados.some(e => (e.cursor || "") < hoje), [estados, hoje]);
  // A aba Sincronização mostra SÓ a empresa ativa no seletor do sistema.
  const estadosVis = useMemo(() => estados.filter(e => !shortCode || e.id === shortCode), [estados, shortCode]);
  // Primeiro dia REAL com batida no Sólides (menor data em ptrpBatidas) da empresa ativa.
  const [primeiroReal, setPrimeiroReal] = useState("");
  useEffect(() => {
    if (!shortCode) { setPrimeiroReal(""); return; }
    let cancel = false;
    getDocs(query(collection(db, "ptrpBatidas"), where("empresaKey", "==", shortCode), orderBy("date", "asc"), limit(1)))
      .then(s => { if (!cancel) setPrimeiroReal((s.docs[0]?.data() as { date?: string })?.date || ""); })
      .catch(() => { if (!cancel) setPrimeiroReal(""); });
    return () => { cancel = true; };
  }, [shortCode, estados]);

  async function sincronizar(opts?: { empresa?: string; desde?: string }) {
    const empresaKey = opts?.empresa;
    setRodando(empresaKey || "*"); setMsg("");
    try {
      const p = new URLSearchParams();
      if (empresaKey) p.set("empresa", empresaKey);
      if (opts?.desde) p.set("desde", opts.desde);
      const qs = p.toString() ? `?${p.toString()}` : "";
      const r = await fetch(`/api/ptrp-punch-sync${qs}`, { method: "GET", headers: { ...(await authHeader()) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(`Falha: ${(j as { error?: string }).error || `HTTP ${r.status}`}`); return; }
      const res = (j as { resultado?: Record<string, { criadas?: number; lidas?: number; erro?: string }> }).resultado || {};
      const partes = Object.entries(res).map(([k, v]) => v.erro ? `${k}: erro` : `${k}: +${v.criadas ?? 0} novas`);
      setMsg(`✓ Sincronizado — ${partes.join(" · ") || "sem novidades"}`);
    } catch (e) {
      setMsg("Falha ao chamar o sync: " + (e instanceof Error ? e.message : "erro de rede"));
    } finally { setRodando(null); }
  }

  if (abasPermitidas.length === 0) return <div className="max-w-3xl mx-auto p-8 text-center text-gray-500 inline-flex items-center gap-1"><Lock size={15}/> Sem acesso ao módulo de Ponto. Peça permissão no Perfil de Acesso.</div>;

  return (
    <PageContainer>
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {abasPermitidas.map(([v, l, Ico]) => (
          <button key={v} type="button" onClick={() => setAba(v)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${abaEfetiva === v ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}><Ico size={15} /> {l}</button>
        ))}
      </div>

      {abaEfetiva === "conferencia" ? <PtrpApuracaoTab /> : abaEfetiva === "validar" ? <PtrpApuracaoTab mode="validar" /> : abaEfetiva === "banco" ? <PtrpApuracaoTab mode="banco" /> : (
      <>
      {/* Configurações → sub-abas */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {subAbas.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setSubAba(v)}
            className={`px-3 py-1.5 text-[13px] font-semibold -mb-px border-b-2 ${subAbaEfetiva === v ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{l}</button>
        ))}
      </div>
      {subAbaEfetiva === "regras" ? <PtrpCctTab /> : subAbaEfetiva === "validadores" ? <PtrpApuracaoTab mode="validadores" /> : (
      <>
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1.5 mb-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{activeRestaurant?.nome} · {shortCode || "sem shortCode"}</div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Button size="sm" onClick={() => void sincronizar(shortCode ? { empresa: shortCode } : undefined)} disabled={!!rodando}>
          {rodando ? "Sincronizando…" : <span className="inline-flex items-center gap-1"><Repeat size={14}/> Sincronizar agora</span>}
        </Button>
        {msg && <span className="text-xs text-gray-600 dark:text-gray-300">{msg}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-xs text-gray-600 dark:text-gray-300">
        <span>Rebuscar desde:</span>
        <input type="date" value={desdeInput} max={hoje} onChange={e => setDesdeInput(e.target.value)}
          className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
        <Button size="sm" variant="secondary" disabled={!!rodando || !desdeInput} onClick={() => void sincronizar({ empresa: shortCode, desde: desdeInput })}>Rebuscar</Button>
        <span className="text-gray-400">força puxar tudo a partir dessa data (ex.: início do mês a validar).</span>
      </div>
      {algumAtrasado && <div className="text-xs text-amber-600 dark:text-amber-400 mb-3 inline-flex items-center gap-1"><Hourglass size={12}/> Backfill em andamento — rode algumas vezes até o cursor chegar em hoje ({fmtD(hoje)}).</div>}

      {loading ? (
        <div className="text-sm text-gray-400 py-10 text-center">Carregando…</div>
      ) : estadosVis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">
          <strong>{activeRestaurant?.nome}</strong> ainda não foi sincronizado. Clique em <strong>Sincronizar agora</strong> pra iniciar o backfill (ou aguarde o cron).
          <div className="mt-1 text-[11px] text-gray-400">Se continuar vazio, confira o token/shortcode desta empresa em <code>SOLIDES_TOKENS</code> nas env vars da Vercel.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {estadosVis.map(e => {
            const atrasado = (e.cursor || "") < hoje;
            return (
              <div key={e.id} className={`rounded-xl border p-3.5 ${e.ok === false ? "border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-900/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1"><Building2 size={14}/> {e.id}</div>
                  {e.ok === false
                    ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-500 text-white">erro</span>
                    : atrasado
                      ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-400 text-amber-900">backfill</span>
                      : <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500 text-white">em dia</span>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-y-1 text-[12.5px]">
                  <span className="text-gray-500">Sincronizado desde</span><span className="text-right tabular-nums" title="Menor data de batida já espelhada do Sólides">{fmtD(primeiroReal || e.primeiroDia)}</span>
                  <span className="text-gray-500">Cursor (até)</span><span className="text-right font-medium tabular-nums">{fmtD(e.cursor)}</span>
                  <span className="text-gray-500">Última sync</span><span className="text-right">{fmtDT(e.ultimaSync)} <span className="text-gray-400">{desde(e.ultimaSync)}</span></span>
                  <span className="text-gray-500">Última janela</span><span className="text-right tabular-nums">{fmtD(e.ultimaJanela?.desde)}–{fmtD(e.ultimaJanela?.ate)}</span>
                  <span className="text-gray-500">Lidas / novas</span><span className="text-right tabular-nums">{e.lidasUltima ?? 0} / <strong className="text-emerald-600 dark:text-emerald-400">{e.criadasUltima ?? 0}</strong></span>
                </div>
                {e.erro && <div className="mt-2 text-[11px] text-rose-600 dark:text-rose-400 break-words inline-flex items-start gap-1"><TriangleAlert size={12} className="shrink-0 mt-0.5"/> {e.erro}</div>}
                <div className="mt-2.5 flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => void sincronizar({ empresa: e.id, ...(desdeInput ? { desde: desdeInput } : {}) })} disabled={!!rodando}>
                    {rodando === e.id ? "…" : "Sincronizar"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3">
        <PtrpApuracaoTab mode="comparar" />
      </div>
      </>
      )}
      </>
      )}
    </PageContainer>
  );
}
