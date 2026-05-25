import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import { RESERVA_STATUS_ICON, RESERVA_STATUS_LABEL } from "../../core/types";
import type { Cliente, ConfiguracaoReservas, Mesa, Reserva, ReservaPII, ReservaStatus, Salao } from "../../core/types";
import { ReservaModal } from "./ReservaModal";
import { ClientesTab } from "./ClientesTab";
import { ConfigTab } from "./ConfigTab";
import { TabBadge } from "../../core/ui/TabBadge";
import { ChegouModal } from "./ChegouModal";
import { ClienteHistoricoModal } from "./ClienteHistoricoModal";
import { montarLinkWhatsapp, montarMensagemConfirmacao } from "./whatsappConfirmacao";

type Tab = "reservas" | "clientes" | "config";

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

// Janela de chips visíveis no seletor de dias — 7 dias por vez
const CHIPS_DIAS = 7;
const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES_CURTO = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

export function ReservasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;

  // Checks granulares baseados em Perfis de Acesso. Pra cada ação especifica,
  // chama can("reservas", "ação"). Master sempre true, pessoas com perfil
  // respeitam as ações marcadas, pessoas sem perfil caem no fallback
  // legado (canVer/canConfigurar internos).
  const { can } = useCanAcao(rid);
  const podeVer = can("reservas", "verFuturas") || can("reservas", "verPassadas")
    || can("reservas", "criar") || can("reservas", "editar")
    || can("reservas", "verCRM") || can("reservas", "configurar");
  const podeConfig = can("reservas", "configurar");
  // Granular: cada ação no botão respectivo
  const podeVerPassadas = can("reservas", "verPassadas");
  const podeCriar       = can("reservas", "criar");
  const podeEditar      = can("reservas", "editar");
  const podeCancelar    = can("reservas", "cancelar");
  const podeChegou      = can("reservas", "chegou");
  const podeWhatsapp    = can("reservas", "whatsapp");
  const podeNota        = can("reservas", "notaCliente");
  const podeMesclar     = can("reservas", "mesclar");
  const podeVerCRM      = can("reservas", "verCRM");
  const podeEditarCliente  = can("reservas", "editarCliente");
  const podeExcluirCliente = can("reservas", "excluirCliente");

  const [tab, setTab] = useState<Tab>("reservas");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [saloes, setSaloes] = useState<Salao[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Reserva | "new" | null>(null);
  // Modal "Cliente chegou" — escolhe mesa + nota
  const [chegouReserva, setChegouReserva] = useState<Reserva | null>(null);
  // Modal "Histórico do cliente" no fluxo da reserva (mode=recente)
  const [historicoReserva, setHistoricoReserva] = useState<Reserva | null>(null);

  // Dia selecionado e início da janela de chips (sempre começa em
  // dataAtual ou ontem — pra mostrar contexto recente).
  const [dataAtual, setDataAtual] = useState(todayYmd());
  // Offset (em dias) do primeiro chip da janela em relação a HOJE.
  // 0 = janela começa hoje. Permite navegar setas pra frente/trás.
  const [chipOffset, setChipOffset] = useState(0);

  // Template de confirmação (vive em /configReservas/{rid})
  const [templateConfirmacao, setTemplateConfirmacao] = useState<string | undefined>(undefined);

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

  // Carrega o template de confirmação (1x — reativo via mudança de rid).
  // Usa onSnapshot pra refletir edição em tempo real quando admin
  // muda o template em Configurações → Mensagem.
  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(doc(db, "configReservas", rid), (snap) => {
      if (!snap.exists()) { setTemplateConfirmacao(undefined); return; }
      const data = snap.data() as ConfiguracaoReservas;
      setTemplateConfirmacao(data.templateConfirmacao || undefined);
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

  const today = todayYmd();

  // Reservas do dia selecionado (separadas: ativas vs canceladas/no-show)
  const reservasDoDia = useMemo(() => {
    return reservas.filter(r => r.data === dataAtual);
  }, [reservas, dataAtual]);

  const reservasAtivasDoDia = useMemo(() => {
    return reservasDoDia.filter(r => r.status !== "cancelada" && r.status !== "no_show");
  }, [reservasDoDia]);

  const canceladasDoDia = useMemo(() => {
    return reservasDoDia.filter(r => r.status === "cancelada" || r.status === "no_show");
  }, [reservasDoDia]);

  // Contagem de reservas ATIVAS por dia — usado pros badges dos chips.
  // Mapa { "YYYY-MM-DD": qtd }. Inclui só pendente/confirmada/chegou
  // (cancelada e no-show não contam pro contador do dia).
  const qtdPorDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reservas) {
      if (r.status === "cancelada" || r.status === "no_show") continue;
      m.set(r.data, (m.get(r.data) || 0) + 1);
    }
    return m;
  }, [reservas]);

  // Pendentes não confirmadas no dia → badge no nível da tab Reservas
  const pendentesHoje = useMemo(() => {
    return reservas.filter(r => r.data === today && r.status === "pendente").length;
  }, [reservas, today]);

  // Reservas SEM FECHAMENTO: data < hoje e status ainda em aberto
  // (pendente ou confirmada). Mostra banner no topo do tab Reservas pra
  // admin marcar retroativamente chegou/no_show. Sem isso, no_show fica
  // inflado sem distinção do que realmente aconteceu.
  const semFechamento = useMemo(() => {
    return reservas
      .filter(r => r.data < today && (r.status === "pendente" || r.status === "confirmada"))
      .sort((a, b) => {
        // Mais antigas primeiro — quanto mais pra trás, mais urgente fechar
        const ad = `${a.data} ${a.horario}`;
        const bd = `${b.data} ${b.horario}`;
        return ad.localeCompare(bd);
      });
  }, [reservas, today]);

  // Banner expandido pra mostrar a lista; recolhe por padrão
  const [banneOpen, setBannerOpen] = useState(false);

  // Stats do dia (mostradas no header da agenda)
  const statsDia = useMemo(() => {
    const pendentes = reservasDoDia.filter(r => r.status === "pendente" || r.status === "confirmada").length;
    const chegou = reservasDoDia.filter(r => r.status === "chegou").length;
    const noShow = reservasDoDia.filter(r => r.status === "no_show").length;
    const totalPessoas = reservasDoDia
      .filter(r => r.status !== "cancelada" && r.status !== "no_show")
      .reduce((s, r) => s + (r.pessoas || 0), 0);
    return { pendentes, chegou, noShow, totalPessoas };
  }, [reservasDoDia]);

  // Calcula os 7 chips visíveis a partir do offset atual.
  // Filtra chips de dias passados se a pessoa não tem verPassadas — chip
  // some completamente (não renderiza disabled, evita click acidental).
  const chips = useMemo(() => {
    const base = new Date(today + "T12:00:00");
    base.setDate(base.getDate() + chipOffset);
    const result: Array<{ data: string; dia: number; mes: number; dow: number; eHoje: boolean }> = [];
    for (let i = 0; i < CHIPS_DIAS; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!podeVerPassadas && iso < today) continue;
      result.push({
        data: iso,
        dia: d.getDate(),
        mes: d.getMonth(),
        dow: d.getDay(),
        eHoje: iso === today,
      });
    }
    return result;
  }, [chipOffset, today, podeVerPassadas]);

  async function setStatus(r: Reserva, status: ReservaStatus) {
    if (!me) return;
    // "chegou" não muda status direto — abre modal pra escolher mesa +
    // nota. O modal cuida do updateDoc.
    if (status === "chegou") {
      setChegouReserva(r);
      return;
    }
    const now = new Date().toISOString();
    const patch: Partial<Reserva> = { status, atualizadoEm: now };
    if (status === "confirmada") patch.confirmadaEm = now;
    if (status === "cancelada") patch.canceladaEm = now;
    await updateDoc(doc(db, "reservas", r.id), patch);
  }

  // Abre WhatsApp com a mensagem de confirmação renderizada pra essa
  // reserva. Não atualiza o status — admin marca manualmente quando o
  // cliente responder (botões "Cliente confirmou" / "Desmarcou").
  function abrirWhatsappConfirmacao(r: Reserva) {
    if (!restaurant) return;
    // Busca PII em tempo de uso pra garantir o telefone mais recente
    // (pode ter sido atualizado depois do merge inicial). Tenta primeiro
    // do snapshot; se não tiver, recorre ao /reservasPII.
    const telefone = r.clienteTelefoneSnapshot;
    if (!telefone) {
      alert("Reserva sem telefone — não dá pra mandar WhatsApp.");
      return;
    }
    const salao = saloes.find(s => s.id === r.salaoId) || null;
    const mensagem = montarMensagemConfirmacao({
      reserva: r,
      restauranteNome: restaurant.nome,
      salao,
      template: templateConfirmacao,
    });
    const link = montarLinkWhatsapp(telefone, mensagem);
    if (!link) {
      alert("Telefone inválido — não consigo montar o link do WhatsApp.");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  // Agrupa reservas ATIVAS do dia por horário
  const porHorario = useMemo(() => {
    const m: Record<string, Reserva[]> = {};
    for (const r of reservasAtivasDoDia) {
      const h = r.horario || "00:00";
      if (!m[h]) m[h] = [];
      m[h].push(r);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [reservasAtivasDoDia]);

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
        {podeCriar && tab === "reservas" && (
          <Button onClick={() => setEditing("new")}>+ Nova reserva</Button>
        )}
      </div>

      {/* Tabs nível superior — Clientes só aparece com verCRM; Config só com configurar */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["reservas", "📅 Reservas",     pendentesHoje] as const,
          ...(podeVerCRM
            ? [["clientes", `👥 Clientes (${clientes.length})`, 0] as const]
            : []),
          ...(podeConfig
            ? [["config",   "⚙️ Configurações", 0] as const]
            : []),
        ]).map(([id, label, badge]) => (
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

      {/* ───────────────── TAB RESERVAS ───────────────── */}
      {tab === "reservas" && (
        <div className="space-y-3">
          {/* Banner pendências — reservas antes de hoje sem fechamento */}
          {semFechamento.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setBannerOpen(o => !o)}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
              >
                <span className="text-sm font-semibold text-amber-900 dark:text-amber-200 text-left">
                  ⚠ {semFechamento.length} reserva(s) sem fechamento de dias anteriores
                </span>
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {banneOpen ? "▲ recolher" : "▼ ver e fechar"}
                </span>
              </button>
              {banneOpen && (
                <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-amber-200 dark:border-amber-900">
                  <p className="text-xs text-amber-800 dark:text-amber-300 pt-2">
                    Marca o que de fato aconteceu pra manter o histórico do cliente correto.
                  </p>
                  {semFechamento.map(r => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 text-sm flex-wrap"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {r.clienteNomeSnapshot}
                          <span className="text-xs text-gray-500 font-normal ml-2">
                            📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")} · ⏰ {r.horario} · 👥 {r.pessoas}
                          </span>
                        </div>
                      </div>
                      {(podeChegou || podeEditar || podeCancelar) && (
                        <div className="flex gap-1 flex-wrap">
                          {podeChegou && <Button variant="secondary" size="sm" onClick={() => setChegouReserva(r)}>🪑 Veio</Button>}
                          {podeEditar  && <Button variant="secondary" size="sm" onClick={() => setStatus(r, "no_show")}>😶 Não veio</Button>}
                          {podeCancelar && <Button variant="secondary" size="sm" onClick={() => setStatus(r, "cancelada")}>✕ Cancelar</Button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chips de 7 dias com setas de navegação.
              Quem não tem verPassadas só navega de hoje em diante — botão ◀
              fica desabilitado quando chipOffset chegaria a negativo. */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary" size="sm"
              onClick={() => setChipOffset(o => Math.max(podeVerPassadas ? Number.NEGATIVE_INFINITY : 0, o - CHIPS_DIAS))}
              disabled={!podeVerPassadas && chipOffset <= 0}
              title={podeVerPassadas ? `Ver ${CHIPS_DIAS} dias anteriores` : "Sem permissão pra ver reservas passadas"}
            >◀</Button>

            <div className="flex-1 grid grid-cols-7 gap-1.5">
              {chips.map(c => {
                const ativo = c.data === dataAtual;
                const qtd = qtdPorDia.get(c.data) || 0;
                return (
                  <button
                    key={c.data}
                    type="button"
                    onClick={() => setDataAtual(c.data)}
                    className={`relative flex flex-col items-center py-2 px-1 rounded-xl border transition-colors ${
                      ativo
                        ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                        : c.eHoje
                          ? "border-indigo-200 bg-white dark:bg-gray-900 dark:border-indigo-900 text-gray-700 dark:text-gray-300"
                          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wider opacity-70">
                      {c.eHoje ? "hoje" : SEMANA_CURTA[c.dow]}
                    </span>
                    <span className="text-xl font-bold leading-tight">
                      {String(c.dia).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] opacity-60 uppercase">
                      {MESES_CURTO[c.mes]}
                    </span>
                    {qtd > 0 && (
                      <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                        ativo
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-700 text-white"
                      }`}>
                        {qtd}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <Button
              variant="secondary" size="sm"
              onClick={() => setChipOffset(o => o + CHIPS_DIAS)}
              title={`Ver ${CHIPS_DIAS} próximos dias`}
            >▶</Button>
          </div>

          {/* Botões de atalho — Hoje + datepicker pra dia fora da janela */}
          <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
            <div className="capitalize text-gray-600 dark:text-gray-400 font-medium">
              {dataAtualLabel}
            </div>
            <div className="flex items-center gap-1.5">
              {dataAtual !== today && (
                <Button variant="secondary" size="sm" onClick={() => { setDataAtual(today); setChipOffset(0); }}>
                  Voltar pra hoje
                </Button>
              )}
              <input
                type="date"
                value={dataAtual}
                onChange={(e) => setDataAtual(e.target.value)}
                className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                title="Escolher data específica"
              />
            </div>
          </div>

          {/* Stats do dia */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="A vir" value={statsDia.pendentes} cor="text-blue-700 dark:text-blue-400" />
            <StatCard label="Chegaram" value={statsDia.chegou} cor="text-emerald-700 dark:text-emerald-400" />
            <StatCard label="No-show" value={statsDia.noShow} cor="text-rose-700 dark:text-rose-400" />
            <StatCard label="Pessoas" value={statsDia.totalPessoas} cor="text-indigo-700 dark:text-indigo-400" />
          </div>

          {/* Lista de reservas ativas do dia */}
          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : reservasAtivasDoDia.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Sem reservas pra esse dia</p>
              {podeCriar && (
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
                        acoes={{ podeEditar, podeCancelar, podeChegou, podeWhatsapp, podeVerCRM, podeNota }}
                        onEditar={() => setEditing(r)}
                        onStatus={(s) => setStatus(r, s)}
                        onWhatsapp={() => abrirWhatsappConfirmacao(r)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Accordion canceladas DO DIA — separado da lista ativa pra
              não poluir a operação. Histórico de canceladas de outros
              dias fica visível ao navegar pra esses dias. */}
          {canceladasDoDia.length > 0 && (
            <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                ▼ Canceladas / no-show ({canceladasDoDia.length})
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-1">
                {canceladasDoDia.map(r => (
                  <ReservaCard
                    key={r.id}
                    reserva={r}
                    clientes={clientes}
                    acoes={{ podeEditar, podeCancelar, podeChegou, podeWhatsapp, podeVerCRM, podeNota }}
                    onEditar={() => setEditing(r)}
                    onStatus={(s) => setStatus(r, s)}
                    onWhatsapp={() => abrirWhatsappConfirmacao(r)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ───────────────── TAB CLIENTES ───────────────── */}
      {tab === "clientes" && podeVerCRM && (
        <ClientesTab
          restaurantId={rid}
          podeConfig={podeConfig}
          podeEditarCliente={podeEditarCliente}
          podeExcluirCliente={podeExcluirCliente}
          podeMesclar={podeMesclar}
        />
      )}

      {/* ───────────────── TAB CONFIGURAÇÕES ───────────────── */}
      {tab === "config" && podeConfig && me && (
        <ConfigTab restaurantId={rid} podeConfig={podeConfig} pessoaId={me.id} />
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

      {chegouReserva && (
        <ChegouModal
          reserva={chegouReserva}
          mesas={mesas}
          saloes={saloes}
          reservasDoDia={reservas.filter(r => r.data === chegouReserva.data)}
          onClose={() => setChegouReserva(null)}
        />
      )}

      {historicoReserva && historicoReserva.clienteId && (() => {
        const cliente = clientes.find(c => c.id === historicoReserva.clienteId);
        if (!cliente) {
          // Cliente foi deletado mas reserva ainda referencia — fecha modal
          setHistoricoReserva(null);
          return null;
        }
        const dele = reservas.filter(r => r.clienteId === cliente.id);
        return (
          <ClienteHistoricoModal
            cliente={cliente}
            reservas={dele}
            mode="recente"
            onClose={() => setHistoricoReserva(null)}
          />
        );
      })()}
    </div>
  );

  // ───────────────── ReservaCard (inline, fecha sobre setStatus) ─────
  // Aplica regras de PII: em reservas CANCELADAS, esconde dados não-essenciais
  // (observações, tags, ocasião, restrições alimentares) pra quem NÃO tem
  // acesso ao CRM completo (verCRM). Mantém nome+telefone+horário/pessoas/
  // salão/mesa — info operacional mínima.
  function ReservaCard({
    reserva, clientes, acoes, onEditar, onStatus, onWhatsapp,
  }: {
    reserva: Reserva;
    clientes: Cliente[];
    acoes: {
      podeEditar: boolean;
      podeCancelar: boolean;
      podeChegou: boolean;
      podeWhatsapp: boolean;
      podeVerCRM: boolean;
      podeNota: boolean;
    };
    onEditar: () => void;
    onStatus: (s: ReservaStatus) => void;
    onWhatsapp: () => void;
  }) {
    const temCliente = !!reserva.clienteId && !!clientes.find(c => c.id === reserva.clienteId);
    const cliente = reserva.clienteId ? clientes.find(c => c.id === reserva.clienteId) : null;
    // PII-light: reservas canceladas só mostram nome+telefone+dados básicos
    // pra quem não tem CRM. Operacional minimal — não vaza histórico de
    // ocasiões, observações ou tags pra todo mundo do salão.
    const piiLight = reserva.status === "cancelada" && !acoes.podeVerCRM;
    const podeAlgumaAcao = acoes.podeEditar || acoes.podeCancelar || acoes.podeChegou || acoes.podeWhatsapp;
    return (
      <div className={`rounded-xl border p-3 ${STATUS_CLS[reserva.status]}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900 dark:text-gray-100">{reserva.clienteNomeSnapshot}</span>
              {!piiLight && cliente && cliente.tags && cliente.tags.length > 0 && (
                cliente.tags.map(t => (
                  <span key={t} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    🏷️ {t}
                  </span>
                ))
              )}
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_BADGE_CLS[reserva.status]}`}>
                {RESERVA_STATUS_ICON[reserva.status]} {RESERVA_STATUS_LABEL[reserva.status]}
              </span>
              {!piiLight && reserva.ocasiao && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                  🎉 {reserva.ocasiao}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-3 flex-wrap mt-0.5">
              <span>⏰ {reserva.horario}</span>
              <span>👥 {reserva.pessoas}</span>
              {reserva.salaoNomeSnapshot && <span>🏛️ {reserva.salaoNomeSnapshot}</span>}
              {reserva.mesaNomeSnapshot && <span>🪑 {reserva.mesaNomeSnapshot}</span>}
              {reserva.clienteTelefoneSnapshot && <span>📞 {reserva.clienteTelefoneSnapshot}</span>}
            </div>
            {!piiLight && (reserva.observacoes || cliente?.restricoesAlimentares) && (
              <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {cliente?.restricoesAlimentares && <>⚠ {cliente.restricoesAlimentares}{reserva.observacoes ? " · " : ""}</>}
                {reserva.observacoes && <>📝 {reserva.observacoes}</>}
              </div>
            )}
          </div>
          {podeAlgumaAcao && (
            <div className="flex gap-1 flex-wrap">
              {/* Histórico do cliente (mode=recente, 6 meses) — só com verCRM */}
              {temCliente && acoes.podeVerCRM && (
                <Button variant="secondary" size="sm" onClick={() => setHistoricoReserva(reserva)} title="Ver últimas reservas e notas deste cliente">
                  📊 Histórico
                </Button>
              )}
              {/* WhatsApp confirmar — só pra pendente/confirmada */}
              {acoes.podeWhatsapp && (reserva.status === "pendente" || reserva.status === "confirmada") && reserva.clienteTelefoneSnapshot && (
                <Button variant="secondary" size="sm" onClick={onWhatsapp} title="Abre WhatsApp com mensagem de confirmação">
                  📱 Confirmar via WhatsApp
                </Button>
              )}
              {acoes.podeEditar && reserva.status === "pendente" && (
                <Button variant="secondary" size="sm" onClick={() => onStatus("confirmada")}>✓ Cliente confirmou</Button>
              )}
              {(reserva.status === "pendente" || reserva.status === "confirmada") && (
                <>
                  {acoes.podeChegou && <Button variant="secondary" size="sm" onClick={() => onStatus("chegou")}>🪑 Chegou</Button>}
                  {acoes.podeEditar && <Button variant="secondary" size="sm" onClick={() => onStatus("no_show")}>😶 No-show</Button>}
                </>
              )}
              {acoes.podeCancelar && reserva.status !== "cancelada" && reserva.status !== "chegou" && (
                <Button variant="secondary" size="sm" onClick={() => onStatus("cancelada")}>✕ Cancelar</Button>
              )}
              {acoes.podeEditar && <Button variant="secondary" size="sm" onClick={onEditar}>Editar</Button>}
            </div>
          )}
        </div>
      </div>
    );
  }
}

// ───────────────── StatCard ─────────────────
function StatCard({ label, value, cor }: { label: string; value: number; cor: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${cor}`}>{value}</div>
    </div>
  );
}
