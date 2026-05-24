import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type {
  ExcecaoHorarioSite, HorarioFuncionamentoDia, Salao,
  SiteConfig, SlotReserva,
} from "../../core/types";
import { useSiteConfig } from "./useSiteConfig";
import { buscarFeriadosProximos, type FeriadoBR } from "./feriadosHelper";

type Props = {
  rid: string;
  nomeRestaurante: string;
  podeEditar: boolean;
};

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Tab Horários: edita horário semanal padrão + lista de exceções pontuais.
// Os dados aqui são lidos pelo site público AND pelo módulo Reservas
// (mesma fonte da verdade — quando você adiciona exceção "fechado em 25/12",
// Reservas bloqueia automaticamente).
export function HorariosTab({ rid, nomeRestaurante, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const { config: cfgRemoto, loading, erro, save } = useSiteConfig(rid, nomeRestaurante);
  const [horarios, setHorarios] = useState<HorarioFuncionamentoDia[]>([]);
  const [excecoes, setExcecoes] = useState<ExcecaoHorarioSite[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Salões ativos do restaurante — usado pra editar slots de reserva na
  // exceção. Carrega assim que entra na aba (não exige hasReservas estar
  // ligado pra carregar; só pra exibir a UI).
  const [saloes, setSaloes] = useState<Salao[]>([]);
  useEffect(() => {
    const q = query(collection(db, "saloes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao)
        .filter(s => s.ativo)
        .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
      setSaloes(list);
    });
    return () => unsub();
  }, [rid]);
  const hasReservasFeature = !!cfgRemoto?.features?.hasReservas;

  // Exceção sendo criada
  const [nova, setNova] = useState<{
    data: string;
    fechado: boolean;
    // Múltiplos turnos (ex: feriado só com almoço quando semana tem almoço+jantar)
    turnosNova: { abre: string; fecha: string }[];
    motivo: string;
    // Reservas nessa data:
    //  - "padrao"  → herda janela semanal (se fechado, sem reservas)
    //  - "sem"     → sem reservas mesmo (slotsReservaCustom = [])
    //  - "custom"  → usa slotsCustom definidos abaixo
    reservaModo: "padrao" | "sem" | "custom";
    slotsCustom: SlotReserva[];
  }>({
    data: "", fechado: false,
    turnosNova: [{ abre: "19:00", fecha: "23:00" }],
    motivo: "",
    reservaModo: "padrao", slotsCustom: [],
  });

  useEffect(() => {
    if (cfgRemoto) {
      setHorarios(cfgRemoto.horarios);
      setExcecoes(cfgRemoto.excecoes || []);
    }
  }, [cfgRemoto]);

  // Feriados sugeridos (BrasilAPI nacionais + tabela estadual por UF do
  // restaurante, próximos 6 meses, cache 24h em localStorage)
  const ufRestaurante = cfgRemoto?.endereco?.uf;
  const [feriados, setFeriados] = useState<FeriadoBR[]>([]);
  const [feriadosErro, setFeriadosErro] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    buscarFeriadosProximos(ufRestaurante, 6)
      .then(list => { if (!cancelado) setFeriados(list); })
      .catch(e => { if (!cancelado) setFeriadosErro(e?.message || "Erro ao buscar feriados"); });
    return () => { cancelado = true; };
  }, [ufRestaurante]);

  // Ref pro form de criação de exceção — usado pra scroll quando o user
  // clica num feriado da lista de sugestões.
  const novaExcecaoRef = useRef<HTMLDivElement>(null);

  // Click num feriado sugerido NÃO salva direto — apenas pré-preenche o
  // form de "Nova exceção" com data + motivo. User decide aberto/fechado,
  // turnos e reservas antes de salvar. Default fechado (caso comum em
  // feriado) mas alterável no toggle Aberto/Fechado.
  function abrirEdicaoFeriado(f: FeriadoBR) {
    if (excecoes.some(e => e.data === f.date)) return; // dedupe — já existe
    setNova({
      data: f.date,
      fechado: true,                                  // default sensato pra feriado
      turnosNova: [{ abre: "19:00", fecha: "23:00" }],
      motivo: f.name,
      reservaModo: "padrao",
      slotsCustom: [],
    });
    // Scroll suave pro form (defer pra dar tempo do React aplicar state)
    setTimeout(() => {
      novaExcecaoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">⚠ Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;

  function toggleFechado(dia: number) {
    setHorarios(hs => hs.map(h => h.dia === dia ? { ...h, fechado: !h.fechado, turnos: !h.fechado ? [] : (h.turnos.length === 0 ? [{ abre: "19:00", fecha: "23:00" }] : h.turnos) } : h));
  }
  function addTurno(dia: number) {
    setHorarios(hs => hs.map(h => h.dia === dia ? { ...h, turnos: [...h.turnos, { abre: "19:00", fecha: "23:00" }] } : h));
  }
  function setTurno(dia: number, idx: number, parcial: { abre?: string; fecha?: string }) {
    setHorarios(hs => hs.map(h => h.dia === dia ? {
      ...h,
      turnos: h.turnos.map((t, i) => i === idx ? { ...t, ...parcial } : t),
    } : h));
  }
  function delTurno(dia: number, idx: number) {
    setHorarios(hs => hs.map(h => h.dia === dia ? {
      ...h,
      turnos: h.turnos.filter((_, i) => i !== idx),
      fechado: h.turnos.length <= 1,
    } : h));
  }

  function addExcecao() {
    if (!nova.data) {
      alert("Escolha a data da exceção.");
      return;
    }
    if (!me) return;
    // Resolve slotsReservaCustom conforme o modo escolhido pelo usuário
    let slotsReservaCustom: SlotReserva[] | undefined;
    if (nova.reservaModo === "sem") {
      slotsReservaCustom = [];
    } else if (nova.reservaModo === "custom") {
      // Valida slots customizados
      for (const s of nova.slotsCustom) {
        if (!/^\d{2}:\d{2}$/.test(s.horario)) {
          alert(`Horário de reserva inválido: "${s.horario || "(vazio)"}". Use HH:MM`);
          return;
        }
        if (s.salaoIds.length === 0) {
          alert(`Slot ${s.horario}: escolha pelo menos 1 salão.`);
          return;
        }
      }
      slotsReservaCustom = [...nova.slotsCustom].sort((a, b) => a.horario.localeCompare(b.horario));
    }
    const ex: ExcecaoHorarioSite = {
      id: `exc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      data: nova.data,
      fechado: nova.fechado,
      turnos: nova.fechado ? undefined : nova.turnosNova,
      slotsReservaCustom,
      motivo: nova.motivo.trim() || undefined,
      criadoEm: new Date().toISOString(),
      criadoPor: me.id,
    };
    setExcecoes(es => [...es, ex].sort((a, b) => a.data.localeCompare(b.data)));
    setNova({
      data: "", fechado: false,
      turnosNova: [{ abre: "19:00", fecha: "23:00" }],
      motivo: "",
      reservaModo: "padrao", slotsCustom: [],
    });
  }
  // Helpers de turnos da nova exceção
  function addTurnoNova() {
    setNova(n => ({ ...n, turnosNova: [...n.turnosNova, { abre: "19:00", fecha: "23:00" }] }));
  }
  function delTurnoNova(idx: number) {
    setNova(n => ({ ...n, turnosNova: n.turnosNova.filter((_, i) => i !== idx) }));
  }
  function setTurnoNova(idx: number, parcial: { abre?: string; fecha?: string }) {
    setNova(n => ({
      ...n,
      turnosNova: n.turnosNova.map((t, i) => i === idx ? { ...t, ...parcial } : t),
    }));
  }

  // Helpers pra editar slotsCustom da exceção nova
  function addSlotCustom() {
    setNova(n => ({
      ...n,
      slotsCustom: [...n.slotsCustom, { horario: "", salaoIds: saloes.map(s => s.id) }],
    }));
  }
  function removerSlotCustom(idx: number) {
    setNova(n => ({ ...n, slotsCustom: n.slotsCustom.filter((_, i) => i !== idx) }));
  }
  function updateSlotCustom(idx: number, patch: Partial<SlotReserva>) {
    setNova(n => ({
      ...n,
      slotsCustom: n.slotsCustom.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }));
  }
  function toggleSalaoNoSlotCustom(idx: number, salaoId: string) {
    setNova(n => ({
      ...n,
      slotsCustom: n.slotsCustom.map((s, i) => {
        if (i !== idx) return s;
        const ja = s.salaoIds.includes(salaoId);
        return { ...s, salaoIds: ja ? s.salaoIds.filter(x => x !== salaoId) : [...s.salaoIds, salaoId] };
      }),
    }));
  }
  function delExcecao(id: string) {
    setExcecoes(es => es.filter(e => e.id !== id));
  }

  async function salvar() {
    if (!me) return;
    setSalvando(true);
    try {
      const parcial: Partial<SiteConfig> = { horarios, excecoes };
      await save(parcial, me.id);
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  // Filtrar exceções: futuras + últimas 30 dias passadas (limpeza visual)
  const hojeYmd = new Date().toISOString().slice(0, 10);
  const excecoesVisiveis = excecoes.filter(e => {
    if (e.data >= hojeYmd) return true;
    // Mantém até 30 dias atrás
    const diff = (new Date(hojeYmd).getTime() - new Date(e.data).getTime()) / (1000 * 60 * 60 * 24);
    return diff < 30;
  });

  // Bloco de sugestões de feriado — separado do JSX principal pra
  // poder ser posicionado ANTES da seção de exceções pontuais.
  const feriadosSugestoesUi = podeEditar ? (
    <details className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" open>
      <summary className="cursor-pointer px-3 py-2 list-none">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            📅 Sugestões de feriados
          </h3>
          <span className="text-xs text-gray-400">
            {feriadosErro
              ? "(erro ao buscar)"
              : feriados.length === 0
                ? "(carregando...)"
                : `(${feriados.filter(f => !excecoes.some(e => e.data === f.date)).length} disponíveis)`}
          </span>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Próximos 6 meses — feriados nacionais (BrasilAPI) {ufRestaurante && `+ estaduais (${ufRestaurante})`}.
          Clique abre o formulário de exceção pré-preenchido com a data e o motivo —
          você decide aberto/fechado, turnos e reservas antes de salvar.
        </p>
      </summary>
      {feriadosErro ? (
        <p className="px-3 pb-3 text-xs text-rose-600">⚠ {feriadosErro}</p>
      ) : (
        <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {feriados.map(f => {
            const ja = excecoes.some(e => e.data === f.date);
            const d = new Date(f.date + "T12:00:00");
            const diaSemana = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"][d.getDay()];
            const tipoLabel = f.type === "nacional" ? "🇧🇷 nacional" : f.type === "estadual" ? `🏛️ ${f.uf}` : "🏙️ municipal";
            return (
              <button
                key={`${f.date}_${f.name}`}
                type="button"
                disabled={ja}
                onClick={() => abrirEdicaoFeriado(f)}
                className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                  ja
                    ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 opacity-50 cursor-not-allowed"
                    : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/20"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold tabular-nums">
                    {String(d.getDate()).padStart(2, "0")}/{String(d.getMonth() + 1).padStart(2, "0")}/{d.getFullYear()}
                  </div>
                  <div className="text-[10px] text-gray-500">{diaSemana}</div>
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{f.name}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{tipoLabel}</div>
                {ja && <div className="text-[10px] text-emerald-600 mt-0.5">✓ já adicionado</div>}
              </button>
            );
          })}
        </div>
      )}
    </details>
  ) : null;

  return (
    <div className="space-y-6">
      {/* Horário padrão */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Horário padrão semanal
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Configure os horários por dia da semana. Cada dia pode ter 1 ou mais turnos (ex: almoço + jantar).
        </p>
        <div className="space-y-2">
          {horarios.map(h => (
            <div key={h.dia} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold text-gray-900 dark:text-gray-100 min-w-[80px]">
                  {DIAS[h.dia]}
                </div>
                <button
                  type="button"
                  onClick={() => podeEditar && toggleFechado(h.dia)}
                  disabled={!podeEditar}
                  className={`px-2 py-1 text-xs font-bold uppercase rounded ${
                    h.fechado
                      ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300"
                      : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {h.fechado ? "Fechado" : "Aberto"}
                </button>
              </div>
              {!h.fechado && (
                <div className="mt-2 space-y-1.5">
                  {h.turnos.map((t, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <input
                        type="time"
                        value={t.abre}
                        onChange={(e) => setTurno(h.dia, i, { abre: e.target.value })}
                        disabled={!podeEditar}
                        className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      />
                      <input
                        type="time"
                        value={t.fecha}
                        onChange={(e) => setTurno(h.dia, i, { fecha: e.target.value })}
                        disabled={!podeEditar}
                        className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      />
                      {podeEditar && (
                        <button onClick={() => delTurno(h.dia, i)} className="text-xs text-rose-600 hover:underline px-2">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {podeEditar && h.turnos.length < 3 && (
                    <Button size="sm" variant="secondary" onClick={() => addTurno(h.dia)}>
                      + turno
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Sugestões de feriados — em cima, pra usuário marcar com 1 clique
          antes de partir pra criar exceções manuais.
          Bloco completo (UI) está mais abaixo — ver `feriadosSugestoesUi`. */}
      {feriadosSugestoesUi}

      {/* Exceções pontuais — vira accordion. Default open quando há
          exceções cadastradas; fechado quando vazio. */}
      <details className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" open={excecoesVisiveis.length > 0}>
        <summary className="cursor-pointer px-3 py-2 list-none">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              ✂ Exceções pontuais ({excecoesVisiveis.length})
            </h3>
            <span className="text-xs text-gray-400">▼ expandir / fechar</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Datas específicas: feriados, fechamento por evento privado, abertura especial.
            O módulo Reservas lê dessa lista — fechar aqui bloqueia reservas no dia.
          </p>
        </summary>

        <div className="px-3 pb-3 space-y-3">

        {/* Adicionar nova */}
        {podeEditar && (
          <div ref={novaExcecaoRef} className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-end">
              <Input
                label="Data"
                type="date"
                value={nova.data}
                onChange={(e) => setNova({ ...nova, data: e.target.value })}
              />
              <Input
                label="Motivo (opcional)"
                value={nova.motivo}
                onChange={(e) => setNova({ ...nova, motivo: e.target.value })}
                placeholder="ex: Natal, evento privado, feriado"
              />
              <button
                type="button"
                onClick={() => setNova({ ...nova, fechado: !nova.fechado })}
                className={`px-3 py-2 text-xs font-bold uppercase rounded border ${
                  nova.fechado
                    ? "bg-rose-100 border-rose-300 dark:bg-rose-900/30 dark:border-rose-700 text-rose-700 dark:text-rose-300"
                    : "bg-emerald-100 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {nova.fechado ? "Fechado" : "Aberto"}
              </button>
            </div>
            {!nova.fechado && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                  Turnos nessa data
                </div>
                {nova.turnosNova.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="time"
                      value={t.abre}
                      onChange={(e) => setTurnoNova(i, { abre: e.target.value })}
                      className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    />
                    <input
                      type="time"
                      value={t.fecha}
                      onChange={(e) => setTurnoNova(i, { fecha: e.target.value })}
                      className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    />
                    {nova.turnosNova.length > 1 && (
                      <button
                        type="button"
                        onClick={() => delTurnoNova(i)}
                        className="text-xs text-rose-600 hover:underline px-2"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {nova.turnosNova.length < 3 && (
                  <Button size="sm" variant="secondary" onClick={addTurnoNova}>
                    + turno
                  </Button>
                )}
                <p className="text-[11px] text-gray-500">
                  Cada turno sobrescreve o horário normal desse dia da semana.
                </p>
              </div>
            )}

            {/* Bloco de RESERVAS na data — só aparece se feature ligada + tem salões */}
            {hasReservasFeature && saloes.length > 0 && (
              <div className="mt-3 p-3 rounded-lg bg-indigo-50/40 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800">
                <div className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-2">
                  🎫 Reservas nessa data
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {(["padrao", "sem", "custom"] as const).map(modo => {
                    const ativo = nova.reservaModo === modo;
                    const labels = {
                      padrao: nova.fechado
                        ? "Sem reservas (data fechada)"
                        : "Usar horários padrão do dia da semana",
                      sem: "Sem reservas nessa data (mesmo aberto)",
                      custom: "Personalizar horários de reserva pra essa data",
                    };
                    const subs = {
                      padrao: nova.fechado
                        ? "Como a casa está fechada, reservas ficam bloqueadas automaticamente."
                        : "Reservas usam as janelas configuradas em Reservas → Janelas.",
                      sem: "Útil pra evento privado: casa aberta mas sem aceitar reservas externas.",
                      custom: "Define horários e salões específicos só pra essa data.",
                    };
                    // "padrao" + fechado é o estado natural quando fecha — não exige escolha extra
                    const disabled = modo === "custom" && nova.fechado;
                    return (
                      <button
                        key={modo}
                        type="button"
                        disabled={disabled}
                        onClick={() => setNova(n => ({ ...n, reservaModo: modo }))}
                        className={`text-left px-3 py-2 rounded-lg text-sm border ${
                          ativo
                            ? "bg-indigo-100 border-indigo-300 dark:bg-indigo-900/30 dark:border-indigo-700"
                            : "bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700"
                        } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                      >
                        <div className="font-medium">{labels[modo]}</div>
                        <div className="text-[11px] opacity-70 mt-0.5">{subs[modo]}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Editor de slots customizados */}
                {nova.reservaModo === "custom" && !nova.fechado && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Horários de reserva nessa data
                      </div>
                      <Button size="sm" variant="secondary" onClick={addSlotCustom}>+ horário</Button>
                    </div>
                    {nova.slotsCustom.length === 0 ? (
                      <div className="text-xs text-gray-500 italic">
                        Adicione pelo menos 1 horário de reserva.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {nova.slotsCustom.map((s, i) => (
                          <div key={i} className="border border-gray-200 dark:border-gray-800 rounded-lg p-2 bg-white dark:bg-gray-900">
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="time"
                                value={s.horario}
                                onChange={(e) => updateSlotCustom(i, { horario: e.target.value })}
                                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                              />
                              <span className="text-xs text-gray-500">salões:</span>
                              {saloes.map(sal => {
                                const on = s.salaoIds.includes(sal.id);
                                return (
                                  <button
                                    key={sal.id}
                                    type="button"
                                    onClick={() => toggleSalaoNoSlotCustom(i, sal.id)}
                                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                                      on
                                        ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-700 dark:text-indigo-300"
                                        : "bg-white border-gray-300 text-gray-600 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400"
                                    }`}
                                  >
                                    {on ? "✓ " : ""}{sal.nome}
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => removerSlotCustom(i)}
                                className="ml-auto text-xs text-rose-600 hover:underline"
                              >
                                remover
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <Button size="sm" onClick={addExcecao}>✓ Salvar essa exceção</Button>
          </div>
        )}

        {/* (Sugestões de feriados vivem agora ANTES da seção de exceções —
            ver feriadosSugestoesUi acima do <details>.) */}

        {/* Lista de exceções */}
        {excecoesVisiveis.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">Nenhuma exceção cadastrada.</p>
        ) : (
          <div className="space-y-1.5">
            {excecoesVisiveis.map(e => {
              const data = new Date(e.data + "T12:00:00");
              const passada = e.data < hojeYmd;
              return (
                <div key={e.id} className={`rounded-lg border ${passada ? "border-gray-200 dark:border-gray-800 opacity-60" : "border-gray-300 dark:border-gray-700"} bg-white dark:bg-gray-900 p-2 flex items-center justify-between gap-2 text-sm`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold tabular-nums">
                        {String(data.getDate()).padStart(2, "0")}/{String(data.getMonth() + 1).padStart(2, "0")}/{data.getFullYear()}
                      </span>
                      <span className="text-[10px] uppercase text-gray-500">
                        {DIAS[data.getDay()].slice(0, 3)}
                      </span>
                      {e.fechado ? (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">
                          fechado
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          {e.turnos?.map(t => `${t.abre}–${t.fecha}`).join(", ") || "aberto"}
                        </span>
                      )}
                      {hasReservasFeature && (
                        e.slotsReservaCustom === undefined ? null
                        : e.slotsReservaCustom.length === 0 ? (
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300" title="Reservas desabilitadas nessa data">
                            sem reservas
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" title={e.slotsReservaCustom.map(s => s.horario).join(", ")}>
                            🎫 reservas custom ({e.slotsReservaCustom.length})
                          </span>
                        )
                      )}
                      {passada && <span className="text-[10px] text-gray-400">(passou)</span>}
                    </div>
                    {e.motivo && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{e.motivo}</div>
                    )}
                  </div>
                  {podeEditar && (
                    <button onClick={() => delExcecao(e.id)} className="text-xs text-rose-600 hover:underline px-2 shrink-0">
                      apagar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </details>

      {/* Footer salvar */}
      {podeEditar && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {savedAt && <span className="text-emerald-600">✓ salvo às {savedAt}</span>}
          </div>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar horários"}</Button>
        </div>
      )}
    </div>
  );
}
