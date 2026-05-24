import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import { RESERVA_STATUS_ICON, RESERVA_STATUS_LABEL } from "../../core/types";
import type { Cliente, Mesa, Reserva, ReservaPII, ReservaStatus } from "../../core/types";
import { ReservaModal } from "./ReservaModal";
import { ClientesTab } from "./ClientesTab";
import { MesasTab } from "./MesasTab";
import { SaloesTab } from "./SaloesTab";
import { TabBadge } from "../../core/ui/TabBadge";
// JanelasTab agora vive no módulo "Horários" — não importa mais aqui.
import type { Salao } from "../../core/types";

type Tab = "agenda" | "proximas" | "canceladas" | "clientes" | "saloes" | "mesas";

const STATUS_CLS: Record<ReservaStatus, string> = {
  pendente:   "border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800",
  confirmada: "border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-800",
  chegou:     "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800",
  no_show:    "border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800",
  cancelada:  "border-gray-200 dark:border-gray-800 opacity-60",
};

const STATUS_BADGE_CLS: Record<ReservaStatus, string> = {
  pendente:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  confirmada: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  chegou:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  no_show:    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  cancelada:  "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function ReservasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "reservas");
  const podeConfig = canConfigurar(me, rid, "reservas");

  const [tab, setTab] = useState<Tab>("agenda");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [saloes, setSaloes] = useState<Salao[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Reserva | "new" | null>(null);

  const [dataAtual, setDataAtual] = useState(todayYmd());

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "clientes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setClientes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cliente));
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "mesas"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setMesas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Mesa));
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "saloes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao);
      list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
      setSaloes(list);
    });
    return () => unsub();
  }, [rid]);

  // 2 listeners: /reservas (sem PII) + /reservasPII (PII). Faz merge no
  // client pra montar a Reserva completa pra UI. PII só chega aqui se
  // user está authed (rules garantem). Reservas antigas (pre-refactor)
  // têm PII inline em /reservas e funcionam sem merge.
  const [reservasBase, setReservasBase] = useState<Reserva[]>([]);
  const [piiMap, setPiiMap] = useState<Map<string, ReservaPII>>(new Map());

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "reservas"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reserva);
      setReservasBase(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "reservasPII"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const m = new Map<string, ReservaPII>();
      for (const d of snap.docs) m.set(d.id, { id: d.id, ...d.data() } as ReservaPII);
      setPiiMap(m);
    });
    return () => unsub();
  }, [rid]);

  // Merge: reserva base + PII se disponível (reservas antigas têm PII inline)
  useEffect(() => {
    const merged: Reserva[] = reservasBase.map(r => {
      const pii = piiMap.get(r.id);
      if (!pii) return r; // legado — PII já está inline
      return {
        ...r,
        clienteNomeSnapshot: pii.clienteNomeSnapshot || r.clienteNomeSnapshot,
        clienteTelefoneSnapshot: pii.clienteTelefoneSnapshot || r.clienteTelefoneSnapshot,
        clienteEmailSnapshot: pii.clienteEmailSnapshot || r.clienteEmailSnapshot,
        observacoes: pii.observacoes || r.observacoes,
        ocasiao: pii.ocasiao || r.ocasiao,
      };
    });
    merged.sort((a, b) => {
      const ad = `${a.data} ${a.horario || "00:00"}`;
      const bd = `${b.data} ${b.horario || "00:00"}`;
      return ad.localeCompare(bd);
    });
    setReservas(merged);
  }, [reservasBase, piiMap]);

  // Filtros / agrupamentos
  const reservasDoDia = useMemo(() => {
    return reservas.filter(r => r.data === dataAtual);
  }, [reservas, dataAtual]);

  const today = todayYmd();
  const proximas = useMemo(() => {
    return reservas
      .filter(r => r.data >= today && (r.status === "pendente" || r.status === "confirmada"))
      .slice(0, 50);
  }, [reservas, today]);

  // Pendentes confirmação (reservas públicas que admin ainda não confirmou) —
  // usado pra badge de notificação na tab "Próximas".
  const pendentesConfirmacao = useMemo(() => {
    return reservas.filter(r => r.data >= today && r.status === "pendente").length;
  }, [reservas, today]);
  // Pendentes do DIA atual — badge na agenda do dia
  const pendentesDoDia = useMemo(() => {
    return reservasDoDia.filter(r => r.status === "pendente").length;
  }, [reservasDoDia]);

  // Histórico de canceladas + no-show — preserva o registro do cliente
  const canceladas = useMemo(() => {
    return reservas
      .filter(r => r.status === "cancelada" || r.status === "no_show")
      .sort((a, b) => {
        // Mais recentes primeiro (por data+horário)
        const ad = `${a.data} ${a.horario || "00:00"}`;
        const bd = `${b.data} ${b.horario || "00:00"}`;
        return bd.localeCompare(ad);
      });
  }, [reservas]);

  // Stats do dia
  const statsDia = useMemo(() => {
    const pendentes = reservasDoDia.filter(r => r.status === "pendente" || r.status === "confirmada").length;
    const chegou = reservasDoDia.filter(r => r.status === "chegou").length;
    const noShow = reservasDoDia.filter(r => r.status === "no_show").length;
    const totalPessoas = reservasDoDia
      .filter(r => r.status !== "cancelada" && r.status !== "no_show")
      .reduce((s, r) => s + (r.pessoas || 0), 0);
    return { pendentes, chegou, noShow, totalPessoas };
  }, [reservasDoDia]);

  function navegarDia(diff: number) {
    const d = new Date(dataAtual + "T12:00:00");
    d.setDate(d.getDate() + diff);
    setDataAtual(d.toISOString().slice(0, 10));
  }

  async function setStatus(r: Reserva, status: ReservaStatus) {
    if (!me) return;
    const now = new Date().toISOString();
    const patch: Partial<Reserva> = { status, atualizadoEm: now };
    if (status === "confirmada") patch.confirmadaEm = now;
    if (status === "chegou") {
      patch.chegouEm = now;
      // Atualiza ultimaVisita do cliente
      if (r.clienteId) {
        try {
          await updateDoc(doc(db, "clientes", r.clienteId), { ultimaVisita: r.data, atualizadoEm: now });
        } catch (e) { console.error(e); }
      }
    }
    if (status === "cancelada") patch.canceladaEm = now;
    await updateDoc(doc(db, "reservas", r.id), patch);
  }

  // Excluir permanente desabilitado na UI — preserva histórico e dados do
  // cliente. Pra remover, use Cancelar (status: cancelada). Em caso extremo,
  // master pode deletar via Firestore console.

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  // Agrupa reservas do dia por horário
  const porHorario = useMemo(() => {
    const m: Record<string, Reserva[]> = {};
    for (const r of reservasDoDia) {
      const h = r.horario || "00:00";
      if (!m[h]) m[h] = [];
      m[h].push(r);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [reservasDoDia]);

  const dataAtualLabel = new Date(dataAtual + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🎫 Reservas + CRM</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{restaurant.nome}</p>
        </div>
        {podeConfig && (tab === "agenda" || tab === "proximas") && (
          <Button onClick={() => setEditing("new")}>+ Nova reserva</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["agenda",     `📅 Agenda do dia (${reservasDoDia.length})`, pendentesDoDia],
          ["proximas",   `⏰ Próximas (${proximas.length})`, pendentesConfirmacao],
          ["canceladas", `🗑 Canceladas (${canceladas.length})`, 0],
          ["clientes",   `👥 Clientes (${clientes.length})`, 0],
          ["saloes",     `🏛️ Salões (${saloes.filter(s => s.ativo).length})`, 0],
          ["mesas",      `🪑 Mesas (${mesas.filter(m => m.ativa).length})`, 0],
        ] as const).map(([id, label, badge]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            {label}
            <TabBadge count={badge} />
          </button>
        ))}
      </div>

      {/* TAB AGENDA */}
      {tab === "agenda" && (
        <div className="space-y-3">
          {/* Navegação por dia */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => navegarDia(-1)}>◀</Button>
              <input
                type="date"
                value={dataAtual}
                onChange={(e) => setDataAtual(e.target.value)}
                className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
              <Button variant="secondary" size="sm" onClick={() => navegarDia(1)}>▶</Button>
              {dataAtual !== today && (
                <Button variant="secondary" size="sm" onClick={() => setDataAtual(today)}>Hoje</Button>
              )}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 capitalize">{dataAtualLabel}</div>
          </div>

          {/* Stats do dia */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">A vir</div>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{statsDia.pendentes}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Chegaram</div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{statsDia.chegou}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">No-show</div>
              <div className="text-2xl font-bold text-rose-700 dark:text-rose-400">{statsDia.noShow}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Pessoas</div>
              <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">{statsDia.totalPessoas}</div>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : reservasDoDia.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Sem reservas pra esse dia</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Adicione clicando em "+ Nova reserva"</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {porHorario.map(([h, list]) => (
                <div key={h}>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    ⏰ {h} — {list.length} reserva(s)
                  </h3>
                  <div className="space-y-1">
                    {list.map(r => (
                      <ReservaCard
                        key={r.id}
                        reserva={r}
                        clientes={clientes}
                        podeConfig={podeConfig}
                        onEditar={() => setEditing(r)}
                        onStatus={(s) => setStatus(r, s)}
                        onExcluir={() => { /* desativado */ }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB CANCELADAS — histórico, sem ações de cancelar/excluir */}
      {tab === "canceladas" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Reservas canceladas e no-show. Histórico preservado pro CRM —
            cliente continua aparecendo na aba Clientes.
          </p>
          {canceladas.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">🗑</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma reserva cancelada</p>
            </div>
          ) : (
            canceladas.map(r => (
              <ReservaCard
                key={r.id}
                reserva={r}
                clientes={clientes}
                podeConfig={podeConfig}
                onEditar={() => setEditing(r)}
                onStatus={(s) => setStatus(r, s)}
                onExcluir={() => {/* desabilitado */}}
                mostrarData
              />
            ))
          )}
        </div>
      )}

      {/* TAB PRÓXIMAS */}
      {tab === "proximas" && (
        <div className="space-y-2">
          {proximas.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">⏰</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma reserva pendente futura</p>
            </div>
          ) : (
            proximas.map(r => (
              <ReservaCard
                key={r.id}
                reserva={r}
                clientes={clientes}
                podeConfig={podeConfig}
                onEditar={() => setEditing(r)}
                onStatus={(s) => setStatus(r, s)}
                mostrarData
              />
            ))
          )}
        </div>
      )}

      {/* TAB CLIENTES */}
      {tab === "clientes" && (
        <ClientesTab restaurantId={rid} podeConfig={podeConfig} />
      )}

      {/* TAB SALÕES */}
      {tab === "saloes" && me && (
        <SaloesTab restaurantId={rid} podeConfig={podeConfig} pessoaId={me.id} />
      )}

      {/* TAB JANELAS */}
      {/* TAB MESAS */}
      {tab === "mesas" && (
        <MesasTab restaurantId={rid} podeConfig={podeConfig} />
      )}

      {editing && (
        <ReservaModal
          reserva={editing === "new" ? null : editing}
          defaultData={dataAtual}
          clientes={clientes}
          mesas={mesas}
          reservasMesmoDia={reservas.filter(r => r.data === (editing === "new" ? dataAtual : (editing as Reserva).data))}
          restaurantId={rid}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );

  function ReservaCard({
    reserva, clientes, podeConfig, onEditar, onStatus, mostrarData,
  }: {
    reserva: Reserva;
    clientes: Cliente[];
    podeConfig: boolean;
    onEditar: () => void;
    onStatus: (s: ReservaStatus) => void;
    onExcluir?: () => void;          // legado — não é mais usado na UI
    mostrarData?: boolean;
  }) {
    const cliente = reserva.clienteId ? clientes.find(c => c.id === reserva.clienteId) : null;
    return (
      <div className={`rounded-xl border p-3 ${STATUS_CLS[reserva.status]}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900 dark:text-gray-100">{reserva.clienteNomeSnapshot}</span>
              {cliente && cliente.tags && cliente.tags.length > 0 && (
                cliente.tags.map(t => (
                  <span key={t} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    🏷️ {t}
                  </span>
                ))
              )}
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_BADGE_CLS[reserva.status]}`}>
                {RESERVA_STATUS_ICON[reserva.status]} {RESERVA_STATUS_LABEL[reserva.status]}
              </span>
              {reserva.ocasiao && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                  🎉 {reserva.ocasiao}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-3 flex-wrap mt-0.5">
              {mostrarData && <span>📅 {new Date(reserva.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>}
              <span>⏰ {reserva.horario}</span>
              <span>👥 {reserva.pessoas}</span>
              {reserva.mesaNomeSnapshot && <span>🪑 {reserva.mesaNomeSnapshot}</span>}
              {reserva.clienteTelefoneSnapshot && <span>📞 {reserva.clienteTelefoneSnapshot}</span>}
            </div>
            {(reserva.observacoes || cliente?.restricoesAlimentares) && (
              <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {cliente?.restricoesAlimentares && <>⚠ {cliente.restricoesAlimentares}{reserva.observacoes ? " · " : ""}</>}
                {reserva.observacoes && <>📝 {reserva.observacoes}</>}
              </div>
            )}
          </div>
          {podeConfig && (
            <div className="flex gap-1 flex-wrap">
              {reserva.status === "pendente" && (
                <Button variant="secondary" size="sm" onClick={() => onStatus("confirmada")}>✓ Confirmar</Button>
              )}
              {(reserva.status === "pendente" || reserva.status === "confirmada") && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onStatus("chegou")}>🪑 Chegou</Button>
                  <Button variant="secondary" size="sm" onClick={() => onStatus("no_show")}>😶 No-show</Button>
                </>
              )}
              {reserva.status !== "cancelada" && reserva.status !== "chegou" && (
                <Button variant="secondary" size="sm" onClick={() => onStatus("cancelada")}>✕ Cancelar</Button>
              )}
              <Button variant="secondary" size="sm" onClick={onEditar}>Editar</Button>
              {/* Excluir permanente removido da UI — preserva histórico e cliente.
                  Use "Cancelar" pra remover; cliente continua no CRM. */}
            </div>
          )}
        </div>
      </div>
    );
  }
}
