// Hub de Conectores — plataformas externas (GetIn, Altec/Riser, …) num lugar só.
// Mostra o status do último sync por restaurante e permite forçar na hora.
// Os dados vivem em <tipo>SyncStatus/{rid}, gravados pelos crons api/*-sync.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
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

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">🔌 Conectores</h1>
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
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
