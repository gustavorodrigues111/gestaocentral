// Hub de Conectores — plataformas externas (GetIn, Altec/Riser, …) num lugar só.
// Mostra o status do último sync por restaurante e permite forçar na hora.
// Os dados vivem em <tipo>SyncStatus/{rid}, gravados pelos crons api/*-sync.
import { useEffect, useMemo, useState } from "react";
import { Plug } from "lucide-react";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { Restaurant } from "../../core/types";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";

type Status = { restaurantId?: string; nome?: string; atualizadoEm?: string; ok?: boolean; erro?: string; [k: string]: unknown };

// "há 3 min" / "há 2 h" / "agora".
function haQuando(iso?: string): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
const money = (v: unknown) => (typeof v === "number" ? v : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const CONECTORES = [
  { tipo: "getin", nome: "GetIn (Reservas)", icon: "🍽️", statusCol: "getinSyncStatus", endpoint: "/api/getin-sync",
    resumo: (s: Status) => `${Number(s.total || 0)} reservas` },
  { tipo: "altec", nome: "Altec / Riser (Vendas)", icon: "📊", statusCol: "altecSyncStatus", endpoint: "/api/altec-sync",
    resumo: (s: Status) => `hoje ${money(s.faturamentoHoje)}` },
] as const;

export function ConectoresPage() {
  const { restaurants } = useRestaurant();
  const [statusPorCol, setStatusPorCol] = useState<Record<string, Record<string, Status>>>({});
  const [forcando, setForcando] = useState<string>("");   // `${tipo}_${rid}`
  const [backfill, setBackfill] = useState<{ rid: string; msg: string; rodando: boolean } | null>(null);
  const [snap, setSnap] = useState<{ rid: string; msg: string; rodando: boolean } | null>(null);

  // Grava os snapshots mensais (vendasProdutoAltec) que o agente de IA lê —
  // relatório oficial "Vendas por Produto", 12 meses. É o que faz o agente
  // responder "quanto vendeu de X no mês" com o número exato.
  async function puxarSnapshots(rid: string) {
    if (snap?.rodando) return;
    setSnap({ rid, msg: "consultando o Altec (12 meses)…", rodando: true });
    try {
      const r = await fetch(`/api/altec-relatorio?rid=${encodeURIComponent(rid)}&meses=12`, { method: "POST", headers: { ...(await authHeader()) } });
      const j = (await r.json().catch(() => ({}))) as { error?: string; resultado?: Array<{ meses?: unknown[]; erro?: string }> };
      if (!r.ok) { setSnap({ rid, msg: "falha: " + (j.error || `HTTP ${r.status}`), rodando: false }); return; }
      const casa = (j.resultado || [])[0];
      if (casa?.erro) { setSnap({ rid, msg: "falha: " + casa.erro, rodando: false }); return; }
      const n = Array.isArray(casa?.meses) ? casa!.meses!.length : 0;
      setSnap({ rid, msg: `✓ ${n} meses gravados pro agente`, rodando: false });
    } catch (e) {
      setSnap({ rid, msg: "falha: " + (e instanceof Error ? e.message : "?"), rodando: false });
    }
  }

  useEffect(() => {
    const unsubs = CONECTORES.map((c) =>
      onSnapshot(collection(db, c.statusCol), (snap) => {
        const m: Record<string, Status> = {};
        for (const d of snap.docs) m[d.id] = { restaurantId: d.id, ...(d.data() as Status) };
        setStatusPorCol((prev) => ({ ...prev, [c.statusCol]: m }));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  // Restaurantes que TÊM algum conector (aparece status pra ele em alguma coleção).
  const restsComConector = useMemo(() => {
    const ids = new Set<string>();
    for (const c of CONECTORES) for (const rid of Object.keys(statusPorCol[c.statusCol] || {})) ids.add(rid);
    return restaurants.filter((r) => ids.has(r.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [restaurants, statusPorCol]);

  async function forcar(tipo: string, endpoint: string, rid: string) {
    const chave = `${tipo}_${rid}`;
    if (forcando) return;
    setForcando(chave);
    try {
      const r = await fetch(`${endpoint}?rid=${encodeURIComponent(rid)}`, { method: "POST", headers: { ...(await authHeader()) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) alert("Falha ao sincronizar: " + ((j as { error?: string }).error || `HTTP ${r.status}`));
      // O badge atualiza sozinho via o listener.
    } catch (e) {
      alert("Falha ao sincronizar: " + (e instanceof Error ? e.message : "?"));
    } finally { setForcando(""); }
  }

  // Backfill do histórico (Altec): roda em blocos de ~90 dias seguindo o cursor
  // `proximo` que o backend devolve, até varrer tudo desde 01/01/2025.
  async function puxarHistorico(rid: string) {
    if (backfill?.rodando) return;
    const desde = "2025-01-01";
    if (!confirm("Puxar TODO o histórico de vendas desde jan/2025?\n\nRoda em blocos e pode levar alguns minutos — deixe esta tela aberta.")) return;
    let ate: string | undefined;
    let totalDias = 0, blocos = 0;
    setBackfill({ rid, msg: "iniciando…", rodando: true });
    try {
      for (let i = 0; i < 40; i++) {   // teto de segurança (40 × 90 = 3600 dias)
        const qs = new URLSearchParams({ rid, desde });
        if (ate) qs.set("ate", ate);
        const r = await fetch(`/api/altec-sync?${qs.toString()}`, { method: "POST", headers: { ...(await authHeader()) } });
        const j = (await r.json().catch(() => ({}))) as { error?: string; resultado?: Array<{ dias?: number; erro?: string }>; proximo?: { ate?: string } | null };
        if (!r.ok) { alert("Falha no backfill: " + (j.error || `HTTP ${r.status}`)); break; }
        const res0 = (j.resultado || [])[0] || {};
        if (res0.erro) { alert("Falha no backfill: " + res0.erro); break; }
        totalDias += Number(res0.dias || 0);
        blocos++;
        const prox = j.proximo;
        if (!prox || !prox.ate) { setBackfill({ rid, msg: `✓ histórico completo — ${totalDias} dias gravados`, rodando: false }); break; }
        ate = prox.ate;
        setBackfill({ rid, msg: `${totalDias} dias gravados (${blocos} blocos) · buscando até ${prox.ate.split("-").reverse().join("/")}…`, rodando: true });
      }
    } catch (e) {
      alert("Falha no backfill: " + (e instanceof Error ? e.message : "?"));
      setBackfill({ rid, msg: "erro — pode tentar de novo (já gravou o que puxou)", rodando: false });
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Plug size={20} className="text-gray-500 dark:text-gray-400" /> Conectores</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Plataformas externas que abastecem o app (reservas, vendas…). Sincronizam sozinhas a cada ~15 min; aqui você vê o status e pode forçar na hora.
        </p>
      </div>

      {restsComConector.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhum conector ativo ainda. Quando um restaurante estiver ligado a uma plataforma (GetIn, Altec…), ele aparece aqui.
        </div>
      ) : (
        <div className="space-y-4">
          {restsComConector.map((r) => (
            <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{r.nome}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CONECTORES.map((c) => {
                  const s = statusPorCol[c.statusCol]?.[r.id];
                  if (!s) return null;
                  const chave = `${c.tipo}_${r.id}`;
                  return (
                    <div key={c.tipo} className={`rounded-lg border p-3 ${s.erro ? "border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/20" : "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.icon} {c.nome}</span>
                        <Button size="sm" variant="secondary" disabled={forcando === chave} onClick={() => void forcar(c.tipo, c.endpoint, r.id)}>
                          {forcando === chave ? "…" : "↻"}
                        </Button>
                      </div>
                      <div className="text-[12px] mt-1.5">
                        {s.erro ? (
                          <span className="text-rose-700 dark:text-rose-300" title={s.erro}>⚠ erro na sincronização</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-300">✓ sincronizado {haQuando(s.atualizadoEm)}</span>
                        )}
                        <span className="text-gray-500 dark:text-gray-400"> · {c.resumo(s)}</span>
                      </div>
                      {c.tipo === "altec" && (
                        <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-gray-700/70">
                          <button
                            type="button"
                            disabled={backfill?.rodando}
                            onClick={() => void puxarHistorico(r.id)}
                            className="text-[12px] font-medium text-sky-700 dark:text-sky-300 hover:underline disabled:opacity-50 disabled:no-underline"
                          >
                            {backfill?.rid === r.id && backfill.rodando ? "⏳ puxando histórico…" : "⤓ Puxar histórico completo"}
                          </button>
                          {backfill?.rid === r.id && (
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{backfill.msg}</div>
                          )}
                          <div className="mt-1.5">
                            <button
                              type="button"
                              disabled={snap?.rodando}
                              onClick={() => void puxarSnapshots(r.id)}
                              className="text-[12px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline disabled:opacity-50 disabled:no-underline"
                            >
                              {snap?.rid === r.id && snap.rodando ? "⏳ salvando…" : "🤖 Salvar 12 meses de produtos pro agente"}
                            </button>
                            {snap?.rid === r.id && !snap.rodando && (
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{snap.msg}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AltecConfig restaurants={restaurants} />
    </div>
  );
}

// ── Configuração do Altec por empresa ──────────────────────────────────────
// Grava restaurants/{id}.altec = { ativo, host, credKey }. As credenciais
// (usuário/senha) NÃO ficam aqui nem no banco — são secrets da Vercel
// (ALTEC_<credKey>_USER / ALTEC_<credKey>_PASS), que só o master cadastra lá.
const SUGESTOES: Record<string, { host: string; credKey: string }> = {
  puba: { host: "pubabar.r3.riser.com.br", credKey: "PUBA" },
  sororoca: { host: "sororocabar.r3.riser.com.br", credKey: "SOROROCA" },
};
function AltecConfig({ restaurants }: { restaurants: Restaurant[] }) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, { ativo: boolean; host: string; credKey: string }>>({});
  const [salvo, setSalvo] = useState<string>("");

  const valor = (r: Restaurant) => {
    const d = rascunho[r.id];
    if (d) return d;
    const sug = Object.entries(SUGESTOES).find(([k]) => r.nome.toLowerCase().includes(k))?.[1];
    return { ativo: !!r.altec?.ativo, host: r.altec?.host || sug?.host || "", credKey: r.altec?.credKey || sug?.credKey || "" };
  };
  const set = (rid: string, patch: Partial<{ ativo: boolean; host: string; credKey: string }>) => {
    const r = restaurants.find((x) => x.id === rid)!;
    setRascunho((p) => ({ ...p, [rid]: { ...valor(r), ...patch } }));
  };
  async function salvar(r: Restaurant) {
    const v = valor(r);
    setSalvo(r.id + ":salvando");
    try {
      await updateDoc(doc(db, "restaurants", r.id), { altec: { ativo: v.ativo, host: v.host.trim(), credKey: v.credKey.trim().toUpperCase() } });
      setSalvo(r.id + ":ok");
    } catch { setSalvo(r.id + ":erro"); }
  }

  const ordenados = [...restaurants].sort((a, b) => a.nome.localeCompare(b.nome));
  return (
    <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between p-4 text-left">
        <span className="font-semibold text-gray-900 dark:text-gray-100">⚙️ Configurar Altec (por empresa)</span>
        <span className="text-gray-400">{aberto ? "▲" : "▼"}</span>
      </button>
      {aberto && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Ligue o PDV Altec/Riser de cada empresa (host + apelido da credencial). As <b>senhas ficam só na Vercel</b> como secrets
            <code className="mx-1 px-1 rounded bg-gray-100 dark:bg-gray-800">ALTEC_&lt;apelido&gt;_USER</code>/<code className="px-1 rounded bg-gray-100 dark:bg-gray-800">_PASS</code> — nunca no código nem no banco.
          </p>
          {ordenados.map((r) => {
            const v = valor(r);
            const st = salvo.startsWith(r.id + ":") ? salvo.split(":")[1] : "";
            return (
              <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-medium text-sm text-gray-800 dark:text-gray-100">{r.nome}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={v.ativo} onChange={(e) => set(r.id, { ativo: e.target.checked })} /> ativo
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="text-[11px] text-gray-500">Host do painel
                    <input value={v.host} onChange={(e) => set(r.id, { host: e.target.value })} placeholder="ex.: sororocabar.r3.riser.com.br"
                      className="mt-0.5 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5" />
                  </label>
                  <label className="text-[11px] text-gray-500">Apelido da credencial (credKey)
                    <input value={v.credKey} onChange={(e) => set(r.id, { credKey: e.target.value })} placeholder="ex.: SOROROCA"
                      className="mt-0.5 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 uppercase" />
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button size="sm" variant="secondary" onClick={() => void salvar(r)} disabled={st === "salvando"}>
                    {st === "salvando" ? "Salvando…" : "Salvar"}
                  </Button>
                  {st === "ok" && <span className="text-xs text-emerald-600">✓ salvo — agora crie os secrets <code>ALTEC_{v.credKey || "…"}_USER/PASS</code> na Vercel</span>}
                  {st === "erro" && <span className="text-xs text-rose-600">falha ao salvar</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
