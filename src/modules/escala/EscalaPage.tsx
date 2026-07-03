import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { collection, deleteField, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canReabrirEscala, canUse, unidadesAcessiveis } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { SelfServiceRedirect } from "../../core/auth/SemPermissaoCard";
import { Button } from "../../core/ui/Button";
import { MesContextoBanner, tintaVersao } from "../../core/ui/MesContextoBanner";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { AjustesSolicitadosTab } from "./AjustesSolicitadosTab";
import {
  daysInMonth, dowShort, fmtAnoMes, fmtBR, nomeMes, pad2, parseYmd, shiftMonth, ymd as ymdFromDate,
} from "../../core/utils/date";
import type { Area, Cargo, Empregado, EscalaMes, ScheduleStatus, SundaySwap, Unidade, EscalaFase, AjusteEscalaMeta, AtrasoEscalaMeta } from "../../core/types";
import { AREAS, ESCALA_FASE_LABEL, ESCALA_FASE_ICON, getEscalaFase, AJUSTE_MOTIVO_LABEL } from "../../core/types";
import { derivedScheduleForEmpregado, type DerivedDay } from "../../core/escala/horarios";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { validarOverride, type ValidacaoEscalaIssue } from "../../core/escala/validarEscala";
import { FecharMesModal, ReabrirMesModal } from "./FecharMesModal";
import { InversaoDomingoModal } from "./InversaoDomingoModal";
import { ExportarEscalaModal } from "./ExportarEscalaModal";
// SumarioMesModal removido da Escala — o conteúdo (gorjetas, VT, divergências)
// vive nas próprias telas de Gorjetas e Vale Transporte. Mantemos o arquivo
// no repo caso queiramos reaproveitar partes (ex: histórico de versões) no
// futuro como botão dedicado.

// Tabela de status: cor + label curto + label longo
const STATUS_INFO: Record<ScheduleStatus, { label: string; short: string; bg: string; text: string }> = {
  trabalho:  { label: "Trabalho",                short: "TR", bg: "bg-emerald-500",  text: "text-white" },
  folga:     { label: "Folga",                   short: "FO", bg: "bg-gray-300 dark:bg-gray-700",  text: "text-gray-700 dark:text-gray-200" },
  freela:    { label: "Freela",                  short: "FR", bg: "bg-purple-500",   text: "text-white" },
  // comp e comp_trab: variantes ESCURAS dos seus pares (folga/trabalho) — pra que
  // a "família" da compensação fique visualmente próxima do estado original.
  comp:      { label: "Folga por compensação",   short: "FC", bg: "bg-gray-500 dark:bg-gray-500",  text: "text-white" },
  comp_trab: { label: "Trabalho por compensação", short: "TC", bg: "bg-emerald-800",  text: "text-white" },
  ferias:    { label: "Férias",                  short: "FE", bg: "bg-sky-500",      text: "text-white" },
  falta_j:   { label: "Falta justificada",       short: "FJ", bg: "bg-rose-300",     text: "text-rose-900" },
  falta_i:   { label: "Falta injustificada",     short: "FI", bg: "bg-rose-600",     text: "text-white" },
};

const STATUS_LIST: ScheduleStatus[] = [
  "trabalho", "folga", "freela", "comp", "comp_trab", "ferias", "falta_j", "falta_i",
];

export function EscalaPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const navigate = useNavigate();
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "escala");
  const podeConfig = canConfig(me, rid, "escala");
  // Gates granulares (sistema novo). Renomeados com prefixo `acao` pra não
  // colidir com vars locais legadas (ex: podeEditar abaixo já considera
  // fechamento de mês + outras regras de negócio).
  const { can, loading: loadingPerfis } = useCanAcao(rid);
  const podeVerTime       = !!me?.isMaster
    || can("escala", "verTime") || can("escala", "editar")
    || can("escala", "aprovarTrocas") || can("escala", "publicar")
    || can("escala", "exportar") || can("escala", "planejarPrevista");
  const acaoEditarEscala  = !!me?.isMaster || can("escala", "editar");
  const acaoAprovarTrocas = !!me?.isMaster || can("escala", "aprovarTrocas");
  const acaoPublicar      = !!me?.isMaster || can("escala", "publicar");
  const acaoExportar      = !!me?.isMaster || can("escala", "exportar");
  const acaoAprovarSolic  = !!me?.isMaster || can("escala", "aprovarSolicitacoes");
  void acaoEditarEscala; void acaoAprovarTrocas; void acaoPublicar; void acaoExportar;

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [sundaySwaps, setSundaySwaps] = useState<SundaySwap[]>([]);
  const [loading, setLoading] = useState(true);
  // Versão da escala em edição: prevista (planejamento) ou real (após o mês)
  const [versao, setVersao] = useState<"prevista" | "real">("prevista");
  // Aba do módulo: grade da escala ou ajustes solicitados pelos empregados.
  // Deep-link via ?aba=ajustes (usado pela Central de Avisos do Chat).
  const [searchParams] = useSearchParams();
  const [aba, setAba] = useState<"grade" | "ajustes">(
    searchParams.get("aba") === "ajustes" ? "ajustes" : "grade",
  );
  const [numPendentes, setNumPendentes] = useState(0);
  useEffect(() => {
    if (!rid || !acaoAprovarSolic) { setNumPendentes(0); return; }
    const q = query(collection(db, "escalaSolicitacoes"), where("restaurantId", "==", rid), where("status", "==", "pendente"));
    const unsub = onSnapshot(q, (snap) => setNumPendentes(snap.size));
    return () => unsub();
  }, [rid, acaoAprovarSolic]);

  // ── Modais / filtro UI — useState TÊM que ficar aqui no topo, antes de
  // qualquer return condicional. Antes estavam mais embaixo, depois dos
  // returns de "Sem permissão"/redirect, violando Rules of Hooks. Quando
  // a tela alternava entre redirect → conteúdo (ex: durante load de
  // perfis), a sequência de hooks mudava e React crashava (tela em branco).
  const [showFeriasLote, setShowFeriasLote] = useState(false);
  const [showFecharMes, setShowFecharMes] = useState(false);
  const [showReabrirMes, setShowReabrirMes] = useState(false);
  const [showInversao, setShowInversao] = useState(false);
  const [filtroUnidadeId, setFiltroUnidadeId] = useState<string>("");  // "" = todas

  // Quando carrega a escala / navega entre meses:
  //   - prevista fechada → abre na praticada (= real)
  //   - prevista NÃO fechada → força a view pra prevista (mesmo que estava em
  //     "real" no mês anterior). Senão fica tela vazia/quebrada.
  useEffect(() => {
    if (escala?.previstaFechadaEm) {
      setVersao("real");
    } else {
      setVersao("prevista");
    }
  }, [escala?.previstaFechadaEm]);

  // Empregados
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
      setEmpregados(list);
    });
    return () => unsub();
  }, [rid]);

  // Cargos
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo);
      setCargos(list);
    });
    return () => unsub();
  }, [rid]);

  // Escala do mês
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const ref = doc(db, "escalas", escalaId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setEscala({ id: snap.id, ...snap.data() } as EscalaMes);
      } else {
        setEscala(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [rid, escalaId]);

  // Escalas adjacentes (mês anterior + próximo) — necessárias pro mobile que
  // navega por semana atravessando meses. Cada doc tem onSnapshot próprio.
  // Resultado consolidado num map "YYYY-MM" → EscalaMes.
  const [escalaPrev, setEscalaPrev] = useState<EscalaMes | null>(null);
  const [escalaNext, setEscalaNext] = useState<EscalaMes | null>(null);
  const mesPrev = useMemo(() => shiftMonth(ano, mes, -1), [ano, mes]);
  const mesNext = useMemo(() => shiftMonth(ano, mes, +1), [ano, mes]);
  useEffect(() => {
    if (!rid) return;
    const id = `${rid}_${fmtAnoMes(mesPrev.ano, mesPrev.mes)}`;
    const unsub = onSnapshot(doc(db, "escalas", id), (snap) => {
      setEscalaPrev(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, mesPrev.ano, mesPrev.mes]);
  useEffect(() => {
    if (!rid) return;
    const id = `${rid}_${fmtAnoMes(mesNext.ano, mesNext.mes)}`;
    const unsub = onSnapshot(doc(db, "escalas", id), (snap) => {
      setEscalaNext(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, mesNext.ano, mesNext.mes]);

  // Mapa "YYYY-MM" → EscalaMes (atual + prev + next). Usado pelo mobile pra
  // ler de qualquer mês na semana visível.
  const escalaPorMes = useMemo(() => {
    const m: Record<string, EscalaMes | null> = {};
    m[fmtAnoMes(ano, mes)] = escala;
    m[fmtAnoMes(mesPrev.ano, mesPrev.mes)] = escalaPrev;
    m[fmtAnoMes(mesNext.ano, mesNext.mes)] = escalaNext;
    return m;
  }, [escala, escalaPrev, escalaNext, ano, mes, mesPrev, mesNext]);

  // Inversões de domingo do restaurante (todas — filtramos por data no map)
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "sundaySwaps"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setSundaySwaps(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SundaySwap));
    });
    return () => unsub();
  }, [rid]);

  // Indexa swaps por chave "empregadoId|date" pra lookup O(1) na renderização
  // de cada célula. Cada swap gera 2 entradas: A em date1 e B em date2.
  const swapsPorCelula = useMemo(() => {
    const m: Record<string, SundaySwap> = {};
    for (const s of sundaySwaps) {
      m[`${s.empAId}|${s.date1}`] = s;
      m[`${s.empBId}|${s.date1}`] = s;
      m[`${s.empAId}|${s.date2}`] = s;
      m[`${s.empBId}|${s.date2}`] = s;
    }
    return m;
  }, [sundaySwaps]);

  // Filtra empregados que estiveram ATIVOS em algum dia do mês
  // (algum dos periodos cobre alguma data do intervalo)
  const empregadosDoMes = useMemo(() => {
    const inicioMes = `${ano}-${pad2(mes)}-01`;
    const fimMes    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
    return empregados.filter(e => {
      for (const p of e.periodos || []) {
        if (p.admissao > fimMes) continue;            // admitido depois do fim do mês
        if (p.demissao && p.demissao <= inicioMes) continue; // demitido antes/no 1º dia
        return true;
      }
      return false;
    });
  }, [empregados, ano, mes]);

  // Dias ainda NÃO fechados na praticada (empregado ativo, dia passado/hoje sem
  // status em real). Usado pra travar o "Encerrar mês" enquanto houver pendência.
  const diasPendentesPraticada = useMemo(() => {
    if (!escala) return 0;
    const ultimoDia = daysInMonth(ano, mes);
    const hojeStr = ymdFromDate(hoje);
    let count = 0;
    for (const e of empregadosDoMes) {
      for (let dia = 1; dia <= ultimoDia; dia++) {
        const date = `${ano}-${pad2(mes)}-${pad2(dia)}`;
        if (date > hojeStr) break;                 // não conta dias futuros
        if (!empregadoAtivoEm(e, date)) continue;
        if (!escala.real?.[e.id]?.[date]) count++;
      }
    }
    return count;
  }, [escala, empregadosDoMes, ano, mes, hoje]);

  // Calcula a escala derivada (dos workSchedules) pra cada empregado do mês
  const derivados = useMemo(() => {
    const m: Record<string, { [date: string]: DerivedDay }> = {};
    for (const e of empregadosDoMes) {
      m[e.id] = derivedScheduleForEmpregado(e, ano, mes);
    }
    return m;
  }, [empregadosDoMes, ano, mes]);

  // Derivados estendidos: também calcula pros meses anterior/próximo, pra
  // suportar a navegação por semana do mobile que atravessa meses.
  // Resultado: empId → date → DerivedDay (incluindo datas dos 3 meses).
  const derivadosEstendidos = useMemo(() => {
    const m: Record<string, { [date: string]: DerivedDay }> = {};
    for (const e of empregados) {
      // Empregado precisa estar ativo em pelo menos um dos 3 meses
      const inicioJ = `${mesPrev.ano}-${pad2(mesPrev.mes)}-01`;
      const fimJ = `${mesNext.ano}-${pad2(mesNext.mes)}-${pad2(daysInMonth(mesNext.ano, mesNext.mes))}`;
      const ativo = (e.periodos || []).some(p => {
        if (p.admissao > fimJ) return false;
        if (p.demissao && p.demissao <= inicioJ) return false;
        return true;
      });
      if (!ativo) continue;
      const dPrev = derivedScheduleForEmpregado(e, mesPrev.ano, mesPrev.mes);
      const dCur  = derivedScheduleForEmpregado(e, ano, mes);
      const dNext = derivedScheduleForEmpregado(e, mesNext.ano, mesNext.mes);
      m[e.id] = { ...dPrev, ...dCur, ...dNext };
    }
    return m;
  }, [empregados, ano, mes, mesPrev, mesNext]);

  // Ordena por área (alfabética) + nome do empregado (alfabético).
  // Filtra por escopo de permissão de unidade — se a pessoa tem permissão
  // restrita, só mostra empregados cuja unidadePadrão está no escopo dela
  // (empregados sem unidade padrão são incluídos pra evitar "sumir" alguém).
  // Filtro de área — "" = todas (state inicializado mais abaixo)
  const [filtroArea, setFiltroArea] = useState<"" | Area>("");

  const empregadosOrdenados = useMemo(() => {
    const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
    let lista = empregadosDoMes;
    if (me && !me.isMaster) {
      const escopo = unidadesAcessiveis(me, rid, "escala");
      if (escopo !== null) {
        lista = lista.filter(e => !e.unidadePadraoId || escopo.includes(e.unidadePadraoId));
      }
    }
    // Filtro por área (do cargo)
    if (filtroArea) {
      lista = lista.filter(e => {
        const cargo = cargoMap[e.cargoId];
        return cargo?.area === filtroArea;
      });
    }
    // Filtro por unidade (multi-unidades): mostra só quem tem essa unidade
    // como padrão NO CADASTRO (unidadePadraoId). "" = todas. Antes o dropdown
    // só esmaecia células de trabalho em outra unidade, mas não removia a
    // linha — então gente de outra unidade continuava aparecendo.
    if (filtroUnidadeId) {
      lista = lista.filter(e => e.unidadePadraoId === filtroUnidadeId);
    }
    return [...lista].sort((a, b) => {
      const ca = cargoMap[a.cargoId];
      const cb = cargoMap[b.cargoId];
      const areaA = ca?.area || "ZZ";
      const areaB = cb?.area || "ZZ";
      if (areaA !== areaB) return areaA.localeCompare(areaB);
      return a.nome.localeCompare(b.nome);
    });
  }, [empregadosDoMes, cargos, me, rid, filtroArea, filtroUnidadeId]);

  const dias = daysInMonth(ano, mes);

  // ─── Regras temporais do lifecycle ──────────────────────────────────────
  // Mês FUTURO: prevista editável livre. Praticada bloqueada (prevista aberta).
  // Mês ATUAL/PASSADO: prevista NÃO editável (só pode ser fechada). Master
  //   bypassa esse bloqueio. Praticada idem (depende de prevista fechada).
  const isMesFuturo = useMemo(() => {
    const hoje = new Date();
    const refAtual = hoje.getFullYear() * 12 + hoje.getMonth();
    const refMes   = ano * 12 + (mes - 1);
    return refMes > refAtual;
  }, [ano, mes]);

  // Praticada tem edição MANUAL (diferente da prevista célula-a-célula)?
  // Usado pra bloquear reabertura da prevista quando praticada "começou a viver"
  // por conta própria — significa que praticada não é mais espelho da prevista,
  // então reabrir e mexer na prevista perde sentido.
  const praticadaTemEdicaoManual = useMemo(() => {
    if (!escala) return false;
    const real = escala.real || {};
    const prev = escala.prevista || {};
    for (const empId of Object.keys(real)) {
      const cellsR = real[empId] || {};
      const cellsP = prev[empId] || {};
      for (const date of Object.keys(cellsR)) {
        if (cellsR[date] !== cellsP[date]) return true;
      }
    }
    return false;
  }, [escala]);

  async function setStatusCelula(
    empregadoId: string,
    ymdDate: string,
    status: ScheduleStatus | null,
    unidadeId?: string | null,
  ): Promise<ValidacaoEscalaIssue[]> {
    if (!rid) return [];
    const isMaster = !!me?.isMaster;

    // ── BLOQUEIOS DO LIFECYCLE ──
    // Praticada NÃO é mais editável pela tela de Escala — a edição da realidade
    // do mês passou a ser exclusiva do Fechamento de folha (Análise de Ponto).
    if (versao === "real") {
      alert(
        "✏️ A edição da Praticada agora é pelo Fechamento de folha de ponto.\n\n" +
        "Abra Análise de Ponto → Fechamento pra ajustar os dias e fechar a praticada do mês.",
      );
      return [];
    }
    // Prevista só edita em mês FUTURO (a não ser que seja master)
    if (versao === "prevista" && !isMesFuturo && !isMaster && !escala?.previstaFechadaEm) {
      alert(
        "⏰ O mês já começou — a Prevista não pode mais ser editada.\n\n" +
        "Pra ajustar o que está acontecendo, clique em '🔒 Fechar prevista' e edite a Praticada."
      );
      return [];
    }

    // ── VALIDAÇÃO CLT ──
    // Antes de aplicar, simula o estado novo e checa DSR.
    // Se viola, NÃO salva e retorna as issues pro caller mostrar.
    const issues = validarOverride({
      empregadoId, data: ymdDate, novoStatus: status,
      escala, derivados, versao,
    });
    if (issues.length > 0) return issues;

    // Pode estar editando um dia de OUTRO mês (semana atravessou no mobile).
    // Resolve o doc da escala pelo mês do `ymdDate`, não pelo mês do header.
    const dayAno = parseInt(ymdDate.slice(0, 4), 10);
    const dayMes = parseInt(ymdDate.slice(5, 7), 10);
    const escalaIdDoDia = `${rid}_${fmtAnoMes(dayAno, dayMes)}`;
    const ref = doc(db, "escalas", escalaIdDoDia);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: escalaIdDoDia,
        restaurantId: rid,
        ano: dayAno, mes: dayMes,
        prevista: {},
        real: {},
        updatedAt: new Date().toISOString(),
      });
    }

    const statusPath = `${versao}.${empregadoId}.${ymdDate}`;
    const unidadeKey = versao === "prevista" ? "unidadesPrevistas" : "unidadesReais";
    const unidadePath = `${unidadeKey}.${empregadoId}.${ymdDate}`;

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (status === null) {
      // Reverter: limpa status E unidade
      updates[statusPath] = deleteField();
      updates[unidadePath] = deleteField();
    } else {
      updates[statusPath] = status;
      // Unidade só faz sentido pra "trabalho". Outros status limpam unidade.
      if (status === "trabalho" && unidadeId) {
        updates[unidadePath] = unidadeId;
      } else {
        updates[unidadePath] = deleteField();
      }
    }
    await updateDoc(ref, updates);
    return [];
  }

  // `copiarPrevistaParaReal` removida — agora cópia é automática no 1º
  // fechamento da prevista.

  // ── Fechar prevista do mês ─────────────────────────────────────────────────
  // 1. Tira foto: pra cada empregado ativo no mês, congela o status efetivo
  //    de cada dia (override gravado OR derivado do horário cadastrado).
  // 2. Grava previstaFechadaEm — fotografia oficial.
  // 3. Auto-popula a Praticada com o conteúdo da prevista (ponto de partida).
  async function fecharPrevista() {
    if (!rid || !me) return;
    const motivo = prompt(
      "Fechar a prevista de " + nomeMes(mes) + "/" + ano + "?\n\n" +
      "A prevista vira fotografia oficial e o lançamento do VT é liberado.\n" +
      "Depois disso, ajustes do mês passam pra Praticada.\n\n" +
      "Motivo / observação (opcional):"
    );
    if (motivo === null) return;
    // Congela o status efetivo nas células ainda vazias (override ∪ derivado)
    const prevAtual = escala?.prevista || {};
    const novaPrevista: { [empregadoId: string]: { [date: string]: ScheduleStatus } } = {};
    for (const e of empregadosDoMes) {
      const empCells = prevAtual[e.id] || {};
      const derivado = derivedScheduleForEmpregado(e, ano, mes);
      const cellsFinal: { [d: string]: ScheduleStatus } = { ...empCells };
      for (const date of Object.keys(derivado)) {
        if (cellsFinal[date] === undefined) {
          cellsFinal[date] = derivado[date].status;
        }
      }
      novaPrevista[e.id] = cellsFinal;
    }
    const now = new Date().toISOString();
    // PRIMEIRO fechamento: copia a prevista pra praticada (espelho inicial).
    // Re-fechamentos (após reabrir+ajustar): pergunta ao usuário se quer
    // sobrescrever a Praticada com a Prevista atualizada. Se a Praticada
    // tiver edições manuais, o aviso é mais forte (vai perder essas edições).
    const isPrimeiroFechamento = !escala?.previstaReabertaEm;
    let deveReplicarPraticada = isPrimeiroFechamento;
    if (!isPrimeiroFechamento) {
      const aviso = praticadaTemEdicaoManual
        ? "⚠️ ATENÇÃO: a Praticada tem edições manuais que serão PERDIDAS.\n\n"
        : "";
      deveReplicarPraticada = confirm(
        aviso +
        "Replicar as alterações da Prevista pra Praticada?\n\n" +
        "✅ Sim — Praticada vira espelho da Prevista atualizada.\n" +
        "❌ Não — Praticada continua como está; só a Prevista é atualizada."
      );
    }
    await setDoc(doc(db, "escalas", escalaId), {
      id: escalaId,
      restaurantId: rid,
      ano, mes,
      prevista: novaPrevista,
      ...(deveReplicarPraticada ? { real: novaPrevista } : {}),
      previstaFechadaEm: now,
      previstaFechadaPor: me.id,
      previstaFechadaPorNome: me.nome,
      previstaFechadaMotivo: motivo || "",
      updatedAt: now,
    }, { merge: true });
    setVersao("real");
  }

  async function reabrirPrevista() {
    if (!rid || !me || !escala) return;
    const vtPagoLocal = !!escala.vtPagoEm;
    const isMaster = !!me.isMaster;
    // Bloqueio 1: Praticada já tem edição manual → reabrir prevista perde sentido
    // (a praticada não é mais espelho da prevista). Master pode forçar com aviso.
    if (praticadaTemEdicaoManual && !isMaster) {
      alert(
        "🔒 A Praticada já tem edições manuais — ela não é mais espelho da Prevista.\n\n" +
        "Reabrir a Prevista agora não faz sentido. Pra continuar, ajuste diretamente a Praticada."
      );
      return;
    }
    if (praticadaTemEdicaoManual && isMaster) {
      if (!confirm(
        "⚠ A Praticada já tem edições manuais.\n\n" +
        "Reabrir a Prevista mesmo assim? A Praticada NÃO será zerada — vai continuar como está."
      )) return;
    }
    // Bloqueio 2: VT pago → só master pode reabrir (já existia)
    if (vtPagoLocal && !isMaster) {
      alert("VT já foi lançado pra esse mês. Só o master pode reabrir a prevista (e isso CANCELA o lote VT).");
      return;
    }
    const motivo = prompt("Motivo da reabertura da prevista:");
    if (motivo === null) return;
    const now = new Date().toISOString();
    await updateDoc(doc(db, "escalas", escalaId), {
      previstaFechadaEm: null,
      previstaFechadaPor: null,
      previstaFechadaPorNome: null,
      previstaFechadaMotivo: "",
      previstaReabertaEm: now,
      previstaReabertaPor: me.id,
      previstaReabertaPorNome: me.nome,
      previstaReabertaMotivo: motivo || "",
      // Se VT estava pago, limpa também (master tem que ir no /vt cancelar o lote)
      ...(vtPagoLocal ? { vtPagoEm: null, vtPagoPor: null } : {}),
      updatedAt: now,
    });
    setVersao("prevista");
  }

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  // ── Exportar PDF da escala ──────────────────────────────────────────
  // Abre o modal de exportação (escolhe unidade/área + pré-visualiza antes de
  // baixar). A geração do PDF em si fica dentro do ExportarEscalaModal.
  const [showExportPDF, setShowExportPDF] = useState(false);

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  // Espera perfis carregarem antes de decidir se redireciona — evita
  // flash de "Sem permissão" / redirect indevido enquanto a lista de
  // perfis ainda está chegando do Firestore. Master tem isMaster=true
  // antes mesmo dos perfis carregarem (bypass), então não impacta ele.
  if (loadingPerfis && !me?.isMaster) {
    return <div className="text-sm text-gray-500 py-12 text-center">Carregando permissões...</div>;
  }
  if (!podeUsar || !podeVerTime) {
    return (
      <SelfServiceRedirect
        restaurantId={rid}
        icone="📆"
        titulo="Sua escala está no Meu Portal"
        descricao="Essa tela é a visão de gestão (todo o time). Pra ver sua escala pessoal, vai em Meu Portal."
      />
    );
  }

  const fechada = !!escala?.fechadoEm;
  const vtPago = !!escala?.vtPagoEm;
  const previstaFechada = !!escala?.previstaFechadaEm;
  const fase: EscalaFase = getEscalaFase(escala);
  const podeReabrir = canReabrirEscala(me, rid);

  // Multi-unidades — derivados. UI multi-unit aparece quando há 2+ unidades
  // ativas; com 1 só, sistema age como single (auto-preenchido implicitamente).
  const todasUnidadesAtivas = (activeRestaurant?.unidades || []).filter(u => u.ativa);
  const usaMultiUnidades = todasUnidadesAtivas.length > 1;

  // Escopo da permissão: se a pessoa tem permissão restrita a unidades, lista
  // só essas. null = ampla (todas). Lista vazia = sem acesso (não cai aqui
  // porque já passou pelo canUse).
  const escopoUnidades = unidadesAcessiveis(me, rid, "escala");
  const unidadesAtivas = escopoUnidades === null
    ? todasUnidadesAtivas
    : todasUnidadesAtivas.filter(u => escopoUnidades.includes(u.id));
  // Pode editar a versão atualmente selecionada?
  // - Mês fechado → nada editável
  // - Prevista após FECHADA (snapshot) → trava (admin/master só via "Reabrir prevista")
  // - Praticada até o fechamento → editável
  // Pode editar a versão atualmente selecionada?
  //   - Mês fechado → nada editável
  //   - Prevista após FECHADA → trava (precisa reabrir)
  //   - Prevista em mês ATUAL ou PASSADO → trava (não-master); master bypassa
  //   - Praticada com prevista AINDA aberta → trava (precisa fechar prevista primeiro)
  const podeEditar = podeConfig
    && !fechada
    // Praticada é READ-ONLY aqui — a edição da realidade do mês passou a ser só
    // pelo Fechamento de folha (Análise de Ponto). A Prevista continua editável.
    && versao !== "real"
    && !(versao === "prevista" && previstaFechada)
    && !(versao === "prevista" && !isMesFuturo && !me?.isMaster && !previstaFechada);

  // Barra de abas — só aparece pra quem pode aprovar solicitações.
  const tabBar = acaoAprovarSolic ? (
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-3">
      <button type="button" onClick={() => setAba("grade")}
        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${aba === "grade" ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>Grade</button>
      <button type="button" onClick={() => setAba("ajustes")}
        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${aba === "ajustes" ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
        Ajustes solicitados
        {numPendentes > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">{numPendentes}</span>}
      </button>
    </div>
  ) : null;

  if (aba === "ajustes" && acaoAprovarSolic) {
    return (
      <div>
        {tabBar}
        <AjustesSolicitadosTab rid={rid} />
      </div>
    );
  }

  return (
    <div>
      {tabBar}
      <MesContextoBanner
        ano={ano}
        mes={mes}
        onPrev={() => navegarMes(-1)}
        onNext={() => navegarMes(1)}
        versao={versao}
        extra={
          <div className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${
            fase === "em_planejamento"   ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" :
            fase === "prevista_fechada"  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" :
            fase === "vt_pago"           ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" :
            "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
          }`}>
            {ESCALA_FASE_ICON[fase]} {ESCALA_FASE_LABEL[fase]}
          </div>
        }
      />

      {/* Toggle Prevista / Real + status */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800/60 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setVersao("prevista")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              versao === "prevista"
                ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
            }`}
          >
            📋 Prevista
            {previstaFechada && versao !== "prevista" && <span className="ml-1 text-[10px]">🔒</span>}
          </button>
          <button
            type="button"
            onClick={() => setVersao("real")}
            disabled={!previstaFechada}
            title={previstaFechada
              ? ""
              : "🔒 A Praticada só fica disponível depois que a Prevista é fechada."}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              versao === "real"
                ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
                : !previstaFechada
                ? "text-gray-400 dark:text-gray-600 cursor-not-allowed"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
            }`}
          >
            ✅ Praticada{!previstaFechada && <span className="ml-1 text-[10px]">🔒</span>}
          </button>
        </div>

        {versao === "real" && !fechada && (
          <button
            type="button"
            onClick={() => navigate(`/r/${rid}/analise-ponto?tab=fechamento`)}
            title="A edição da praticada agora é no Fechamento de folha de ponto"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            ✏️ Editar no Fechamento de folha →
          </button>
        )}

        {versao === "real" && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded outline outline-1 outline-dashed outline-gray-500/70 opacity-60 bg-emerald-500/60" />
            tracejado = previsto (dia ainda não fechado) · sólido = fechado na praticada
          </span>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {usaMultiUnidades && unidadesAtivas.length > 0 && (
            <select
              value={filtroUnidadeId}
              onChange={(e) => setFiltroUnidadeId(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              title="Filtrar escala por unidade"
            >
              <option value="">🏢 Todas as unidades</option>
              {unidadesAtivas.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          )}
          <select
            value={filtroArea}
            onChange={(e) => setFiltroArea(e.target.value as "" | Area)}
            className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            title="Filtrar escala por área"
          >
            <option value="">📊 Todas as áreas</option>
            {AREAS.map(a => (
              <option key={a} value={a}>
                {a === "Bar" ? "🍸 Bar" : a === "Cozinha" ? "👨‍🍳 Cozinha" : a === "Salão" ? "🍽️ Salão" : "🧹 Limpeza"}
              </option>
            ))}
          </select>
          {/* Ações administrativas — só desktop. No mobile o foco é editar
              a escala dia-a-dia; fechamentos vivem no desktop.
              Botões aparecem só na versão correspondente (Prevista ou Praticada)
              pra não poluir a barra com ações irrelevantes ao contexto. */}
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {podeEditar && (
              <Button variant="secondary" size="sm" onClick={() => setShowFeriasLote(true)}>
                🏖️ Marcar férias em lote
              </Button>
            )}
            {podeConfig && (
              <Button variant="secondary" size="sm" onClick={() => setShowInversao(true)}>
                ↔️ Inversão de domingo
              </Button>
            )}
            {/* "Copiar Prevista → Praticada" removido — agora é automático
                no 1º fechamento da prevista (lifecycle unificado). */}
            {/* Exportar PDF — funciona pra qualquer versão (prevista/praticada),
                fechada ou aberta. Usado pra imprimir e colar no vestiário. */}
            {empregadosDoMes.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowExportPDF(true)}
                title="Exportar PDF da escala (escolhe unidade/área e pré-visualiza)"
              >
                📄 Exportar PDF
              </Button>
            )}
            {/* PREVISTA: Fechar / Reabrir prevista — só quando versao === "prevista" */}
            {versao === "prevista" && !previstaFechada && !fechada && podeConfig && (
              <Button size="sm" onClick={fecharPrevista}>
                🔒 Fechar prevista
              </Button>
            )}
            {versao === "prevista" && previstaFechada && !fechada && podeConfig && (
              <Button
                variant="secondary"
                size="sm"
                onClick={reabrirPrevista}
                title={vtPago ? "VT já pago — só master pode reabrir (cancela o lote VT)" : "Reabrir prevista pra ajustes"}
              >
                🔓 Reabrir prevista
              </Button>
            )}
            {/* PRATICADA: Encerrar / Reabrir o MÊS (congela a praticada). O
                fechamento dia a dia é no Análise de Ponto; aqui é o lock final. */}
            {versao === "real" && !fechada && podeConfig && (
              <div className="flex items-center gap-2">
                {diasPendentesPraticada > 0 && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    {diasPendentesPraticada} dia(s) a fechar no Análise de Ponto
                  </span>
                )}
                <Button variant="danger" size="sm" disabled={diasPendentesPraticada > 0} onClick={() => setShowFecharMes(true)}
                  title={diasPendentesPraticada > 0 ? "Feche todos os dias no Análise de Ponto antes de encerrar o mês" : "Congela a praticada do mês (read-only)"}>
                  🔒 Encerrar mês
                </Button>
              </div>
            )}
            {versao === "real" && fechada && podeReabrir && (
              <Button variant="secondary" size="sm" onClick={() => setShowReabrirMes(true)}>
                🔓 Reabrir mês
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Banner status — info, só desktop (mobile usa o título da versão) */}
      <div className="hidden md:block">
        <BannerStatus versao={versao} previstaFechada={previstaFechada} vtPago={vtPago} fechada={fechada} isMesFuturo={isMesFuturo} />
      </div>

      {/* Hint de atalhos de teclado — desktop only (sem teclado no mobile) */}
      <div className="hidden md:block text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        💡 <strong>Click</strong> nos dias pra selecionar · paleta aparece embaixo · use atalhos: <kbd className="px-1 bg-gray-200 dark:bg-gray-700 rounded">T</kbd> trabalho · <kbd className="px-1 bg-gray-200 dark:bg-gray-700 rounded">F</kbd> folga · <kbd className="px-1 bg-gray-200 dark:bg-gray-700 rounded">V</kbd> férias · <kbd className="px-1 bg-gray-200 dark:bg-gray-700 rounded">⌫</kbd> reverter · <kbd className="px-1 bg-gray-200 dark:bg-gray-700 rounded">ESC</kbd> fechar
      </div>

      {/* Legenda — desktop only. Mobile usa o botão "?" abaixo */}
      <div className="hidden md:block">
        <Legenda />
      </div>
      <details className="md:hidden mb-3 text-xs">
        <summary className="cursor-pointer text-gray-500 dark:text-gray-400 select-none inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
          ❓ Legenda das cores
        </summary>
        <div className="mt-2">
          <Legenda />
        </div>
      </details>

      {loading ? (
        <div className="text-sm text-gray-500 mt-6">Carregando...</div>
      ) : empregadosOrdenados.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center mt-6">
          <div className="text-4xl mb-3">🤷</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum empregado neste mês</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Cadastre empregados em Pessoas (filtro "Empregados") pra começar a montar a escala.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop / Tablet: vista mensal completa (31 colunas) */}
          <div className="hidden md:block">
            <Grade
              ano={ano}
              mes={mes}
              dias={dias}
              empregados={empregadosOrdenados}
              cargos={cargos}
              escala={escala}
              derivados={derivados}
              versao={versao}
              podeEditar={podeEditar}
              onSetStatus={setStatusCelula}
              unidadesAtivas={unidadesAtivas}
              usaMultiUnidades={usaMultiUnidades}
              filtroUnidadeId={filtroUnidadeId}
              swapsPorCelula={swapsPorCelula}
            />
          </div>

          {/* Mobile: vista semanal + bottom-sheet picker pra editar */}
          <div className="md:hidden">
            <GradeMobile
              ano={ano}
              mes={mes}
              empregados={empregadosOrdenados}
              cargos={cargos}
              escala={escala}
              escalaPorMes={escalaPorMes}
              derivados={derivadosEstendidos}
              versao={versao}
              podeEditar={podeEditar}
              onSetStatus={setStatusCelula}
              swapsPorCelula={swapsPorCelula}
              onMesChange={(novoAno, novoMes) => {
                setAno(novoAno);
                setMes(novoMes);
              }}
            />
          </div>
        </>
      )}

      {showFeriasLote && (
        <MarcarFeriasLoteModal
          empregados={empregadosOrdenados}
          ano={ano}
          mes={mes}
          onClose={() => setShowFeriasLote(false)}
          onApply={async (empregadoId, dataInicio, dataFim, status) => {
            if (!rid) return;
            const ini = parseYmd(dataInicio);
            const fim = parseYmd(dataFim);

            // Agrupa dias por mês ("YYYY-MM") pra ler o doc da escala UMA vez
            // por mês envolvido e decidir em qual versão gravar (prevista ou
            // real) baseado no `previstaFechadaEm` daquele mês — não na versão
            // global da página. Sem isso, dias do mês futuro (não fechado)
            // gravavam na `real` e ficavam invisíveis pra tela que mostra
            // só prevista.
            const diasPorMes = new Map<string, string[]>();
            for (let d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
              const ymd = ymdFromDate(d);
              const ym = ymd.slice(0, 7);
              const arr = diasPorMes.get(ym) || [];
              arr.push(ymd);
              diasPorMes.set(ym, arr);
            }

            for (const [ym, dias] of diasPorMes) {
              const docId = `${rid}_${ym}`;
              const ref = doc(db, "escalas", docId);
              const snap = await getDoc(ref);
              const data = snap.exists() ? snap.data() as EscalaMes : null;
              const fechada = !!data?.previstaFechadaEm;
              const versaoMes: "prevista" | "real" = fechada ? "real" : "prevista";
              const ano = parseInt(ym.slice(0, 4), 10);
              const mes = parseInt(ym.slice(5, 7), 10);

              // Cria doc se não existe
              if (!snap.exists()) {
                await setDoc(ref, {
                  id: docId,
                  restaurantId: rid,
                  ano, mes,
                  prevista: {}, real: {},
                  updatedAt: new Date().toISOString(),
                });
              }

              // Monta updates pra todos os dias daquele mês de uma vez
              const updates: Record<string, unknown> = {
                updatedAt: new Date().toISOString(),
              };
              const unidadeKey = versaoMes === "prevista" ? "unidadesPrevistas" : "unidadesReais";
              for (const ymd of dias) {
                updates[`${versaoMes}.${empregadoId}.${ymd}`] = status;
                updates[`${unidadeKey}.${empregadoId}.${ymd}`] = deleteField();
              }
              await updateDoc(ref, updates);
            }
            setShowFeriasLote(false);
          }}
        />
      )}

      {showFecharMes && (
        <FecharMesModal
          rid={rid}
          ano={ano}
          mes={mes}
          escala={escala}
          diasPendentes={diasPendentesPraticada}
          onClose={() => setShowFecharMes(false)}
        />
      )}
      {showReabrirMes && (
        <ReabrirMesModal
          rid={rid}
          ano={ano}
          mes={mes}
          escala={escala}
          onClose={() => setShowReabrirMes(false)}
        />
      )}
      {showInversao && me && (
        <InversaoDomingoModal
          restaurantId={rid}
          ano={ano}
          mes={mes}
          empregados={empregadosOrdenados}
          escala={escala}
          meId={me.id}
          meNome={me.nome}
          isMaster={!!me.isMaster}
          onClose={() => setShowInversao(false)}
        />
      )}

      {showExportPDF && activeRestaurant && (
        <ExportarEscalaModal
          ano={ano}
          mes={mes}
          versao={versao}
          restaurantNome={activeRestaurant.nome}
          empregados={empregadosDoMes}
          cargos={cargos}
          escala={escala}
          usaMultiUnidades={usaMultiUnidades}
          unidades={unidadesAtivas}
          onClose={() => setShowExportPDF(false)}
        />
      )}
    </div>
  );
}

// Painel explicativo da versão escolhida — muda conforme a fase do mês.
// Substitui o BannerStatus enxuto por um "explicador" didático sempre visível,
// que ensina o conceito enquanto o user usa.
function BannerStatus({
  versao, previstaFechada, vtPago, fechada, isMesFuturo,
}: { versao: "prevista" | "real"; previstaFechada: boolean; vtPago: boolean; fechada: boolean; isMesFuturo: boolean }) {

  // ── PREVISTA ───────────────────────────────────────────────────────────
  if (versao === "prevista") {
    if (fechada) {
      return (
        <PainelExplicativo cor="rose" icone="🔒" titulo="Escala Prevista — mês fechado (read-only)">
          <p>
            O mês foi encerrado. Tudo travado pra preservar o histórico de gorjetas e VT.
            Pra alterar alguma coisa aqui, é preciso reabrir o mês (botão "🔓 Reabrir mês"
            no topo — só aparece pra quem tem permissão de reabertura).
          </p>
        </PainelExplicativo>
      );
    }
    if (vtPago) {
      return (
        <PainelExplicativo cor="emerald" icone="💸" titulo="Escala Prevista — lote VT lançado (travada permanentemente)">
          <p>
            A prevista foi usada pra criar o lote VT do mês, que <strong>já foi marcado como pago</strong>.
            Por isso ela está travada como prova do que foi pago.
          </p>
          <p>
            Pra mexer aqui agora, o master precisa primeiro <strong>cancelar o lote VT</strong> no
            menu 🚌 Vale Transporte. Os ajustes do dia-a-dia (faltas, atestados, trocas, freelas
            cobrindo) vão na <strong>Praticada</strong>, não aqui.
          </p>
        </PainelExplicativo>
      );
    }
    if (previstaFechada) {
      return (
        <PainelExplicativo cor="amber" icone="🔒" titulo="Escala Prevista — fechada (fotografia tirada)">
          <p>
            A prevista foi fechada e virou a <strong>base oficial</strong> pro cálculo do VT do mês.
            Agora o botão "💸 Lançar pra pagamento" no menu 🚌 Vale Transporte está liberado.
          </p>
          <p>
            Pra editar ainda, clique em <strong>🔓 Reabrir prevista</strong> no topo — volta o mês
            pra estado de planejamento. Se você só quer registrar o que está acontecendo no
            dia-a-dia (faltas, atestados, trocas), vá na <strong>Praticada</strong>.
          </p>
        </PainelExplicativo>
      );
    }
    if (!isMesFuturo) {
      return (
        <PainelExplicativo cor="amber" icone="⏰" titulo="Escala Prevista — mês já começou">
          <p>
            <strong>O mês atual já está em curso</strong> — a Prevista não pode mais ser editada
            (não-master). Pra registrar o que está acontecendo, clique em <strong>🔒 Fechar prevista</strong>
            no topo. A partir daí, todos os ajustes vão pra Praticada.
          </p>
          <p>
            Ao fechar, a prevista vira fotografia oficial do mês e o lançamento do VT é liberado.
          </p>
        </PainelExplicativo>
      );
    }
    return (
      <PainelExplicativo cor="blue" icone="📋" titulo="Escala Prevista — planejamento do mês">
        <p>
          É a versão que você monta <strong>antes</strong> do mês acontecer: folgas, escalas de
          trabalho, freelas previstos, férias programadas. A base vem do horário cadastrado de
          cada empregado — você só ajusta as exceções.
        </p>
        <p>
          Quando terminar, clique em <strong>🔒 Fechar prevista</strong> no topo. A prevista vira
          fotografia oficial, libera o lançamento do VT, e a edição passa pra <strong>Praticada</strong>.
          Antes de fechar, o VT não pode ser lançado pra pagamento.
        </p>
      </PainelExplicativo>
    );
  }

  // ── PRATICADA ──────────────────────────────────────────────────────────
  if (fechada) {
    return (
      <PainelExplicativo cor="rose" icone="🔒" titulo="Escala Praticada — registro final do mês">
        <p>
          Versão consolidada do que aconteceu no mês. Read-only, preservada pra histórico de
          gorjetas e VT. Pra editar, é preciso reabrir o mês (só com permissão de reabertura).
        </p>
      </PainelExplicativo>
    );
  }
  if (!previstaFechada) {
    return (
      <PainelExplicativo cor="gray" icone="🔒" titulo="Escala Praticada — bloqueada (Prevista aberta)">
        <p>
          A Praticada <strong>espelha a Prevista</strong> até ela ser fechada. Nada do que está
          aqui é editável — pra mexer, primeiro feche a Prevista (botão <strong>🔒 Fechar prevista</strong>
          no topo).
        </p>
        <p>
          Depois que a Prevista for fechada, a Praticada vira cópia exata dela e se torna o foco
          dos ajustes do dia-a-dia (faltas, atestados, trocas, hora extra).
        </p>
      </PainelExplicativo>
    );
  }
  return (
    <PainelExplicativo cor="emerald" icone="✅" titulo="Escala Praticada — realidade do dia-a-dia">
      <p>
        É a versão da realidade do mês. Nasceu como cópia da Prevista no momento que ela foi
        fechada, e vai sendo ajustada conforme as coisas acontecem: <strong>falta, atestado,
        troca de folga, freela cobrindo, hora extra</strong>.
      </p>
      <p>
        É a fonte usada pra calcular gorjetas e pra detectar divergências de VT (dias a devolver
        ou a receber). Depois de fechar todos os dias no Análise de Ponto, trave o mês com
        <strong> 🔒 Encerrar mês</strong> pra consolidar gorjetas e VT.
      </p>
      <p className="text-amber-700 dark:text-amber-300">
        ✏️ <strong>Aqui a praticada é só leitura.</strong> Os ajustes do dia-a-dia (falta, atestado,
        troca, hora extra) são feitos no <strong>Fechamento de folha de ponto</strong> (Análise de Ponto),
        que cruza com as batidas da Sólides e sobe pra cá.
      </p>
    </PainelExplicativo>
  );
}

// Painel didático colorido por fase.
function PainelExplicativo({
  cor, icone, titulo, children,
}: {
  cor: "blue" | "amber" | "emerald" | "rose" | "gray";
  icone: string;
  titulo: string;
  children: React.ReactNode;
}) {
  const classes: Record<typeof cor, string> = {
    blue:    "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200",
    amber:   "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200",
    emerald: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200",
    rose:    "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200",
    gray:    "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300",
  };
  return (
    <div className={`rounded-lg border p-3 mb-4 ${classes[cor]}`}>
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0">{icone}</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm mb-1.5">{titulo}</div>
          <div className="text-xs space-y-1.5 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {STATUS_LIST.map(s => (
        <div key={s} className="flex items-center gap-1.5 text-xs">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} font-bold`}>
            {STATUS_INFO[s].short}
          </span>
          <span className="text-gray-600 dark:text-gray-400">{STATUS_INFO[s].label}</span>
        </div>
      ))}
    </div>
  );
}

function Grade({
  ano, mes, dias, empregados, cargos, escala, derivados, versao, podeEditar, onSetStatus,
  unidadesAtivas, usaMultiUnidades, filtroUnidadeId, swapsPorCelula,
}: {
  ano: number; mes: number; dias: number;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  derivados: Record<string, { [date: string]: DerivedDay }>;
  versao: "prevista" | "real";
  podeEditar: boolean;
  onSetStatus: (empregadoId: string, ymd: string, status: ScheduleStatus | null, unidadeId?: string | null) => Promise<ValidacaoEscalaIssue[]>;
  unidadesAtivas: Unidade[];
  usaMultiUnidades: boolean;
  filtroUnidadeId: string;
  swapsPorCelula: Record<string, SundaySwap>;
}) {
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const empMap = Object.fromEntries(empregados.map(e => [e.id, e]));
  // Seleção: Set<"empId|date"> — qualquer click adiciona/remove. Ações via barra inferior.
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  // Multi-unidades: override de unidade ao aplicar bulk de "trabalho".
  // "" (default) = usa unidade padrão de cada empregado.
  // <unidadeId>    = força essa unidade pra todos.
  const [unidadeOverride, setUnidadeOverride] = useState<string>("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Atalhos de teclado quando há seleção
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignora se digitando em input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        setSelecionadas(new Set());
        return;
      }
      // Atalhos só com seleção ativa e em modo edição
      if (selecionadas.size === 0 || !podeEditar) return;
      const map: Record<string, ScheduleStatus | null> = {
        "t": "trabalho",
        "f": "folga",
        "r": "freela",
        "c": "comp",
        "b": "comp_trab",
        "v": "ferias",
        "j": "falta_j",
        "i": "falta_i",
      };
      const k = e.key.toLowerCase();
      if (k in map) {
        e.preventDefault();
        aplicarBulk(map[k]);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        aplicarBulk(null); // reverter
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadas, podeEditar]);

  function toggleSelecao(empId: string, date: string) {
    const key = `${empId}|${date}`;
    setSelecionadas(s => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Resolve qual unidade aplicar pra um empregado quando o status é "trabalho":
  //   override > derivedDay.unidadeId (do workSchedule do dia da semana) > unidadePadrao > null
  function resolverUnidade(empId: string, date: string): string | null {
    if (unidadeOverride) return unidadeOverride;
    const dayUnit = derivados[empId]?.[date]?.unidadeId;
    if (dayUnit) return dayUnit;
    const emp = empMap[empId];
    return emp?.unidadePadraoId || null;
  }

  async function aplicarBulk(status: ScheduleStatus | null) {
    if (selecionadas.size === 0) return;
    const erros: ValidacaoEscalaIssue[] = [];
    let aplicados = 0;
    for (const key of selecionadas) {
      const [empId, date] = key.split("|");
      const unidadeId = (status === "trabalho" && usaMultiUnidades) ? resolverUnidade(empId, date) : null;
      const issues = await onSetStatus(empId, date, status, unidadeId);
      if (issues.length > 0) erros.push(...issues);
      else aplicados++;
    }
    if (erros.length > 0) {
      const empMap = Object.fromEntries(empregados.map(e => [e.id, e.nome]));
      const msg = erros
        .map(er => {
          const empId = [...selecionadas].find(k => k.includes(er.data))?.split("|")[0];
          const nome = empId ? empMap[empId] : "?";
          return `• ${nome} em ${fmtBR(er.data)}: ${er.mensagem} (${er.artigo})`;
        })
        .slice(0, 10)
        .join("\n");
      alert(`⚠ ${erros.length} célula(s) bloqueada(s) por violação CLT.\n${aplicados > 0 ? `${aplicados} célula(s) foram aplicadas.\n` : ""}\n${msg}${erros.length > 10 ? "\n…" : ""}`);
    }
    setSelecionadas(new Set());
  }

  // Ressincronização: limpa todos os overrides do mês pra um empregado na
  // versão visualizada. Usado quando o cadastro do empregado é corrigido
  // depois da prevista já estar pintada — em vez de selecionar 30 dias e
  // clicar reverter, faz tudo de uma vez.
  const [ressincSaving, setRessincSaving] = useState<string | null>(null);
  async function ressincronizarEmpregado(empId: string, nome: string) {
    // Conta quantos dias têm override pra essa versão
    const versaoMap = versao === "prevista" ? escala?.prevista?.[empId] : escala?.real?.[empId];
    const diasComOverride: string[] = [];
    for (let d = 1; d <= dias; d++) {
      const ymd = `${ano}-${pad2(mes)}-${pad2(d)}`;
      if (versaoMap && versaoMap[ymd] !== undefined) diasComOverride.push(ymd);
    }
    if (diasComOverride.length === 0) {
      alert(`Nada pra ressincronizar — ${nome} não tem overrides nessa versão.`);
      return;
    }
    const ok = window.confirm(
      `Ressincronizar ${diasComOverride.length} dia(s) de ${nome} com o cadastro?\n\n` +
      `Os overrides da ${versao === "prevista" ? "prevista" : "praticada"} desse empregado neste mês serão apagados ` +
      `— os dias voltam a ser calculados pelo horário cadastrado.`,
    );
    if (!ok) return;
    setRessincSaving(empId);
    try {
      for (const ymd of diasComOverride) {
        await onSetStatus(empId, ymd, null, null);
      }
    } finally {
      setRessincSaving(null);
    }
  }

  const hojeYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  return (
    <div
      ref={wrapRef}
      className={`border border-gray-200 dark:border-gray-800 rounded-xl overflow-auto max-h-[calc(100vh-260px)] min-h-[400px] ${tintaVersao(versao) || "bg-white dark:bg-gray-900"}`}
    >
      <table className="w-full text-xs border-collapse">
        {/* sticky top-0 funciona porque o wrapper agora tem overflow-y (max-h + overflow-auto) */}
        <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0 z-10 shadow-[0_2px_0_rgba(0,0,0,0.05)]">
          <tr>
            <th className="text-left px-2 py-2 font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-800/50 z-20 w-[140px] min-w-[140px]">
              Empregado
            </th>
            {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
              const d = new Date(ano, mes - 1, dia);
              const wd = d.getDay();
              const weekend = wd === 0 || wd === 6;
              return (
                <th
                  key={dia}
                  style={{ width: 28, minWidth: 28 }}
                  className={`px-0 py-1 text-center font-semibold ${weekend ? "bg-amber-50 dark:bg-amber-900/20" : ""}`}
                >
                  <div className="text-gray-700 dark:text-gray-300">{dia}</div>
                  <div className="text-[10px] text-gray-400 uppercase">{dowShort(d)}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {empregados.map((e, idx) => {
            const cargo = cargoMap[e.cargoId];
            const cargoPrev = idx > 0 ? cargoMap[empregados[idx - 1].cargoId] : null;
            const areaPrev = cargoPrev?.area;
            const areaAtual = cargo?.area;
            const isPrimeiroDaArea = areaAtual !== areaPrev;
            const dot = areaAtual === "Salão" ? "bg-emerald-500"
                      : areaAtual === "Bar"    ? "bg-blue-500"
                      : areaAtual === "Cozinha" ? "bg-orange-500"
                      : "bg-gray-400";
            return (
              <Fragment key={e.id}>
              {isPrimeiroDaArea && (
                <tr className="bg-gray-50 dark:bg-gray-800/50">
                  <td colSpan={dias + 1} className="px-2 py-1 sticky left-0 bg-gray-50 dark:bg-gray-800/50 z-10">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                      {areaAtual || "Sem área"}
                    </span>
                  </td>
                </tr>
              )}
              <tr className="border-t border-gray-100 dark:border-gray-800 group">
                <td className="px-2 py-1.5 sticky left-0 bg-white dark:bg-gray-900 z-10 border-r border-gray-100 dark:border-gray-800 w-[140px] min-w-[140px] max-w-[140px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{e.nome}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{cargo?.nome || "—"}</div>
                    </div>
                    {podeEditar && (
                      <button
                        type="button"
                        onClick={() => ressincronizarEmpregado(e.id, e.nome)}
                        disabled={ressincSaving === e.id}
                        title={`Ressincronizar todos os dias de ${e.nome} com o cadastro (limpa overrides da ${versao === "prevista" ? "prevista" : "praticada"})`}
                        className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-wait"
                      >
                        {ressincSaving === e.id ? (
                          <span className="text-[10px] animate-spin">↻</span>
                        ) : (
                          <span className="text-sm">↻</span>
                        )}
                      </button>
                    )}
                  </div>
                </td>
                {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
                  const d = `${ano}-${pad2(mes)}-${pad2(dia)}`;
                  // Empregado precisa estar dentro de algum período de
                  // atividade nesse dia. Fora dele (antes da admissão ou
                  // a partir de demitidoEm), a célula fica vazia mesmo se
                  // tem override antigo no Firestore — o override é
                  // mascarado, não apagado, então reativar a contratação
                  // recupera a escala pintada de antes.
                  const ativoNoDia = empregadoAtivoEm(e, d);
                  // Na PRATICADA, célula sem entry específica cai pra prevista
                  // como fallback. Isso cobre:
                  //   - Prevista aberta (praticada espelha prevista)
                  //   - Prevista fechada mas praticada vazia (migração / 1ª vez)
                  //   - Prevista fechada e praticada parcialmente preenchida
                  //     (dias intocados continuam vindo da prevista)
                  const realCell = escala?.real?.[e.id]?.[d];
                  const previstaCell = escala?.prevista?.[e.id]?.[d];
                  const override = !ativoNoDia ? undefined : (versao === "real"
                    ? (realCell ?? previstaCell)
                    : previstaCell);
                  const derived = derivados[e.id]?.[d];
                  const isToday = d === hojeYmd;
                  const cellKey = `${e.id}|${d}`;
                  const isSelected = selecionadas.has(cellKey);
                  // Unidade do dia em 2 camadas:
                  //  - "override": mudou a unidade especificamente nesse dia
                  //    (vem de unidadesPrevistas/unidadesReais). Aparece a badge.
                  //  - "efetiva": pra filtro, fallback: override → derived (do
                  //    workSchedule do dia) → unidadePadraoId do empregado.
                  //    Sem esse fallback, filtro esmaece célula errada quando
                  //    a unidade vem da unidade padrão.
                  const unidadeOverride = usaMultiUnidades
                    ? escala?.[versao === "prevista" ? "unidadesPrevistas" : "unidadesReais"]?.[e.id]?.[d]
                    : undefined;
                  const unidadeIdDoDia = unidadeOverride
                    || derived?.unidadeId
                    || e.unidadePadraoId
                    || undefined;
                  const unidadeBadge = unidadeOverride
                    ? (unidadesAtivas.find(u => u.id === unidadeOverride)?.nome?.[0]?.toUpperCase() || "?")
                    : undefined;
                  // Filtro: esmaece células de TRABALHO em unidade diferente da filtrada
                  const status = override || derived?.status;
                  const ocultaPorFiltro = !!(
                    filtroUnidadeId && status === "trabalho" && unidadeIdDoDia !== filtroUnidadeId
                  );
                  const swap = ativoNoDia ? swapsPorCelula[`${e.id}|${d}`] : undefined;
                  // Dias fora do período (pré-admissão/pós-demissão): célula
                  // listrada cinza, sem click pra editar.
                  if (!ativoNoDia) {
                    return (
                      <td
                        key={dia}
                        className={`p-0 text-center relative bg-gray-100 dark:bg-gray-800/40 ${isToday ? "ring-1 ring-indigo-400 ring-inset" : ""}`}
                        title="Fora do período de atividade do empregado (pré-admissão ou pós-demissão)"
                      >
                        <div className="w-full h-7 flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-600 select-none">·</div>
                      </td>
                    );
                  }
                  return (
                    <td key={dia} className={`p-0 text-center relative ${isToday ? "ring-1 ring-indigo-400 ring-inset" : ""} ${ocultaPorFiltro ? "opacity-25" : ""}`}>
                      <Celula
                        override={override}
                        derived={derived}
                        podeEditar={podeEditar}
                        isOpen={false}
                        isSelected={isSelected}
                        onClick={() => toggleSelecao(e.id, d)}
                        unidadeBadge={unidadeBadge}
                        swap={swap}
                        empregadoId={e.id}
                        // F5 — ícones de origem (ponto): só na PRATICADA
                        ajuste={versao === "real" ? escala?.realAjustes?.[e.id]?.[d] : undefined}
                        atraso={versao === "real" ? escala?.atrasos?.[e.id]?.[d] : undefined}
                        // Praticada ainda não fechada → tracejado. Fechado = realAjustes
                        // com origem "solides_sync" (fechamento de folha), não só `real`
                        // nem apontamento automático (ponto_auto).
                        previsto={versao === "real" && escala?.realAjustes?.[e.id]?.[d]?.origem !== "solides_sync"}
                      />
                    </td>
                  );
                })}
              </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Barra de bulk quando há células selecionadas — fica fixa no rodapé
          do viewport (não da página). Spacer empurra a última linha da tabela
          pra cima pra não ficar atrás da barra. */}
      {selecionadas.size > 0 && podeEditar && (
        <>
          <div className="h-32" aria-hidden />
          <BulkActionBar
            selecionadas={selecionadas}
            empregados={empregados}
            onApply={aplicarBulk}
            onClear={() => setSelecionadas(new Set())}
            unidadesAtivas={unidadesAtivas}
            usaMultiUnidades={usaMultiUnidades}
            unidadeOverride={unidadeOverride}
            onChangeUnidadeOverride={setUnidadeOverride}
          />
        </>
      )}
    </div>
  );
}

// Renderiza UMA célula da grade combinando override + derivado.
// - Com status (override ou derivado do cadastro): cor sólida.
// - Sem horário cadastrado: célula vazia com "·" (lembra de cadastrar).
// - Selecionada (multi-select): ring indigo
function Celula({
  override, derived, podeEditar, isOpen, isSelected, onClick, unidadeBadge, swap, empregadoId,
  ajuste, atraso, previsto,
}: {
  override: ScheduleStatus | undefined;
  derived: DerivedDay | undefined;
  podeEditar: boolean;
  isOpen: boolean;
  isSelected: boolean;
  onClick: (ev: React.MouseEvent) => void;
  unidadeBadge?: string;     // letra única da unidade (ex: "M", "F", "P")
  swap?: SundaySwap;         // se a célula tem inversão de domingo registrada
  empregadoId?: string;      // pra montar o tooltip do swap
  // F5 — integração com Ponto: marcadores de ajuste auto / atraso
  ajuste?: AjusteEscalaMeta;
  atraso?: AtrasoEscalaMeta;
  // Na praticada: dia AINDA não fechado (mostra a prevista como fallback) →
  // tracejado/esmaecido pra diferenciar do dia já fechado (praticada confirmada).
  previsto?: boolean;
}) {
  // Resolve display
  const displayStatus = override ?? derived?.status;
  const isFromOverride = !!override;
  const isImplicito = !override && derived?.fonte === "implicito";
  // Estilo "previsto, não fechado" (só faz sentido na praticada).
  const previstoCls = previsto ? "opacity-60 outline outline-1 outline-dashed outline-gray-500/70 -outline-offset-2" : "";

  // Ring extra quando célula está selecionada via Shift+Click
  const selRing = isSelected ? "ring-2 ring-indigo-500 ring-offset-1" : "";

  // Badge da unidade — pequeno indicador no canto inferior direito
  const unidadeSubscript = unidadeBadge ? (
    <span
      className="absolute -bottom-0.5 -right-0.5 text-[8px] font-bold leading-none px-0.5 rounded bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700"
      style={{ minWidth: "10px", textAlign: "center" }}
    >
      {unidadeBadge}
    </span>
  ) : null;

  // F5 — Marcadores de origem (vindos do módulo Ponto):
  //   ⚡ no canto superior esquerdo: ajuste automático via apontamento
  //   🕐 no canto inferior esquerdo: atraso detectado pela regra atrasoEntrada
  // Tooltips agregados com info de origem.
  const ajusteBadge = ajuste && ajuste.origem === "ponto_auto" ? (
    <span
      className="absolute -top-1 -left-1 text-[9px] leading-none px-0.5 rounded bg-indigo-600 text-white font-bold border border-indigo-700 shadow-sm"
      style={{ minWidth: "11px", textAlign: "center" }}
      title={`⚡ Ajuste automático via apontamento de ponto${ajuste.motivo ? ` (${AJUSTE_MOTIVO_LABEL[ajuste.motivo]})` : ""}${ajuste.ajustadoPorNome ? ` por ${ajuste.ajustadoPorNome}` : ""}`}
    >
      ⚡
    </span>
  ) : null;
  // 🕐 Badge de atraso OCULTADO temporariamente — os horários de atraso ainda não
  // estão batendo certo e estavam gerando confusão na Escala. Plumbing mantida
  // (prop `atraso` + tooltip) pra retomar no futuro; só não renderiza o ícone.
  const atrasoBadge = null;
  const ajusteAtrasoTitle = [
    ajuste && ajuste.origem === "ponto_auto"
      ? `⚡ Ajuste automático: ${ajuste.motivo ? AJUSTE_MOTIVO_LABEL[ajuste.motivo] : "—"}${ajuste.observacao ? ` (${ajuste.observacao})` : ""}${ajuste.ajustadoPorNome ? ` · por ${ajuste.ajustadoPorNome}` : ""}${ajuste.ajustadoEm ? ` em ${new Date(ajuste.ajustadoEm).toLocaleString("pt-BR")}` : ""}`
      : null,
    atraso
      ? `🕐 Atraso de ${atraso.minutos}min${atraso.previsto ? ` (previsto ${atraso.previsto}, chegou ${atraso.realizado || "?"})` : ""}`
      : null,
  ].filter(Boolean).join(" · ");

  // Inversão de domingo: borda violet sólida 2px (cor única no sistema —
  // nenhum outro estado/status usa violet) + badge ↔ pequeno no canto.
  // O hover do botão mostra o nome do par e motivo via title.
  const swapPar = swap
    ? (empregadoId === swap.empAId ? swap.empBNome : swap.empANome)
    : null;
  const swapTitle = swap
    ? `Inversão com ${swapPar}${swap.motivo ? ` — ${swap.motivo}` : ""}`
    : null;
  const swapClass = swap ? "ring-2 ring-violet-500 ring-offset-1" : "";
  const swapBadge = swap ? (
    <span
      className="absolute -top-1 -left-1 text-[9px] leading-none px-0.5 rounded bg-violet-600 text-white font-bold border border-violet-700 shadow-sm"
      style={{ minWidth: "11px", textAlign: "center" }}
    >
      ↔
    </span>
  ) : null;

  // Sem status: célula cinza (vazio). Inclui empregado sem horário cadastrado
  // (implícito = "assume trabalho" no cálculo, mas visualmente sinaliza falta
  // de cadastro pra o gestor preencher).
  if (!displayStatus || isImplicito) {
    return (
      <button
        type="button"
        disabled={!podeEditar}
        onClick={onClick}
        className={`relative w-7 h-7 rounded text-[10px] font-bold transition-all bg-gray-100 dark:bg-gray-800/40 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 ${
          podeEditar ? "cursor-pointer hover:scale-110" : "cursor-default"
        } ${isOpen ? "ring-1 ring-indigo-400" : ""} ${selRing} ${swapClass} ${previstoCls}`}
        title={[swapTitle, ajusteAtrasoTitle, previsto ? "Previsto — dia ainda não fechado na praticada" : (isImplicito ? "Sem horário cadastrado — assume trabalho no cálculo" : "Vazio")].filter(Boolean).join(" · ")}
      >
        {isImplicito ? "·" : ""}
        {unidadeSubscript}
        {swapBadge}
        {ajusteBadge}
        {atrasoBadge}
      </button>
    );
  }

  // Com status: célula sólida — não distingue mais entre derivado-do-cadastro
  // e override manual. Pro usuário, a prevista É o horário cadastrado +
  // edições pontuais. Ambos mostram igual.
  const info = STATUS_INFO[displayStatus];
  return (
    <button
      type="button"
      disabled={!podeEditar}
      onClick={onClick}
      className={`relative w-7 h-7 rounded text-[10px] font-bold transition-all ${info.bg} ${info.text} ${
        podeEditar ? "cursor-pointer hover:scale-110" : "cursor-default"
      } ${isOpen ? "ring-1 ring-indigo-400" : ""} ${selRing} ${swapClass} ${previstoCls}`}
      title={[swapTitle, ajusteAtrasoTitle, previsto ? `${info.label} · previsto (dia ainda não fechado)` : (isFromOverride ? `${info.label} (override manual)` : info.label)].filter(Boolean).join(" · ")}
    >
      {info.short}
      {unidadeSubscript}
      {swapBadge}
      {ajusteBadge}
      {atrasoBadge}
    </button>
  );
}

// CellMenu (popover por célula) foi removido — todas as alterações passam
// pela barra de bulk inferior. Click numa célula só seleciona/desmarca.

// ─── Barra de ação flutuante quando há células multi-selecionadas ─────────
// Mapa de atalhos pra mostrar na barra
const STATUS_KEY: Partial<Record<ScheduleStatus, string>> = {
  trabalho: "T", folga: "F", freela: "R", comp: "C", comp_trab: "B",
  ferias: "V", falta_j: "J", falta_i: "I",
};

function BulkActionBar({
  selecionadas, empregados, onApply, onClear,
  unidadesAtivas, usaMultiUnidades, unidadeOverride, onChangeUnidadeOverride,
}: {
  selecionadas: Set<string>;
  empregados: Empregado[];
  onApply: (status: ScheduleStatus | null) => void;
  onClear: () => void;
  unidadesAtivas: Unidade[];
  usaMultiUnidades: boolean;
  unidadeOverride: string;
  onChangeUnidadeOverride: (v: string) => void;
}) {
  // Agrupa células selecionadas por empregado pra mostrar breakdown:
  //   - João Silva: dias 12, 15, 18
  //   - Maria: dia 20
  const breakdown = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const key of selecionadas) {
      const [empId, date] = key.split("|");
      const dia = parseInt(date.slice(-2), 10);
      if (!map[empId]) map[empId] = [];
      map[empId].push(dia);
    }
    const lista = Object.entries(map).map(([empId, dias]) => {
      const emp = empregados.find(e => e.id === empId);
      return {
        empId,
        nome: emp?.nome || "(?)",
        dias: dias.sort((a, b) => a - b),
      };
    });
    lista.sort((a, b) => a.nome.localeCompare(b.nome));
    return lista;
  }, [selecionadas, empregados]);

  const count = selecionadas.size;

  return (
    <>
      {/* Keyframe da animação de entrada da barra */}
      <style>{`@keyframes slideUpBar{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div
        className="fixed bottom-0 left-0 md:left-60 right-0 z-30 bg-indigo-50/95 dark:bg-indigo-900/80 backdrop-blur-sm border-t-2 border-indigo-400 dark:border-indigo-600 shadow-[0_-8px_24px_rgba(79,70,229,0.18)]"
        style={{ animation: "slideUpBar 0.2s ease-out" }}
      >
        {/* Breakdown — quem + quais dias */}
        <div className="px-4 pt-2 pb-1 max-h-24 overflow-y-auto">
          <div className="flex items-start gap-2">
            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider shrink-0">
              Selecionados ({count}):
            </span>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-800 dark:text-gray-200 min-w-0">
              {breakdown.map(b => (
                <span key={b.empId} className="inline-flex items-center gap-1 whitespace-nowrap">
                  <strong className="text-indigo-700 dark:text-indigo-300">{b.nome}:</strong>
                  <span className="tabular-nums">{b.dias.join(", ")}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 pb-2.5 flex items-center gap-3 flex-wrap">

          {/* Dropdown de unidade — só aparece se multi-unidades */}
          {usaMultiUnidades && unidadesAtivas.length > 0 && (
            <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg px-2 py-1 border border-indigo-300 dark:border-indigo-700 shadow-sm">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                🏢
              </span>
              <select
                value={unidadeOverride}
                onChange={(e) => onChangeUnidadeOverride(e.target.value)}
                className="text-xs bg-transparent border-0 outline-none text-gray-900 dark:text-gray-100"
                title="Unidade que será atribuída quando o status for 'Trabalho'. Vazio = usa o padrão de cada empregado."
              >
                <option value="">Padrão do empregado</option>
                {unidadesAtivas.map(u => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>
            </div>
          )}

          {/* Status — chip colorido + nome + atalho visível */}
          <div className="flex items-center gap-1.5 flex-wrap flex-1">
            {STATUS_LIST.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => onApply(s)}
                title={`${STATUS_INFO[s].label} — atalho: ${STATUS_KEY[s]}`}
                className={`inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} text-xs font-bold hover:scale-105 active:scale-95 transition-transform shadow-sm`}
              >
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-black/20 text-[10px] font-bold leading-none">{STATUS_INFO[s].short}</span>
                <span className="hidden md:inline whitespace-nowrap">{STATUS_INFO[s].label}</span>
                <kbd className="text-[10px] font-mono font-bold bg-white/30 text-current px-1.5 py-0.5 rounded border border-white/30 leading-none">{STATUS_KEY[s]}</kbd>
              </button>
            ))}
            <button
              type="button"
              onClick={() => onApply(null)}
              title="Reverter ao cadastrado em todas — atalho: ⌫"
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium shadow-sm"
            >
              <span className="whitespace-nowrap">↩ Reverter</span>
              <kbd className="text-[10px] font-mono font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 rounded leading-none">⌫</kbd>
            </button>
          </div>

          {/* Fechar barra de ações */}
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium"
          >
            <span className="whitespace-nowrap">✕ Fechar</span>
            <kbd className="text-[10px] font-mono font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 rounded leading-none">ESC</kbd>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Modal: marcar férias (ou outro status) em lote num range ──────────────
function MarcarFeriasLoteModal({
  empregados, ano, mes, onClose, onApply,
}: {
  empregados: Empregado[];
  ano: number; mes: number;
  onClose: () => void;
  onApply: (empregadoId: string, dataInicio: string, dataFim: string, status: ScheduleStatus) => Promise<void>;
}) {
  const [empregadoId, setEmpregadoId] = useState(empregados[0]?.id || "");
  // Default: 1º dia do mês visualizado
  const inicioDefault = `${ano}-${pad2(mes)}-01`;
  const fimDefault = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
  const [dataInicio, setDataInicio] = useState(inicioDefault);
  const [dataFim, setDataFim] = useState(fimDefault);
  const [status, setStatus] = useState<ScheduleStatus>("ferias");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Calcula quantos dias serão alterados
  const diasNoRange = (() => {
    if (!dataInicio || !dataFim || dataInicio > dataFim) return 0;
    const ini = parseYmd(dataInicio);
    const fim = parseYmd(dataFim);
    return Math.round((fim.getTime() - ini.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  })();

  async function aplicar() {
    if (!empregadoId) { setErr("Escolha um empregado"); return; }
    if (!dataInicio || !dataFim) { setErr("Datas obrigatórias"); return; }
    if (dataInicio > dataFim) { setErr("Início depois do fim"); return; }
    setErr("");
    setSaving(true);
    try {
      await onApply(empregadoId, dataInicio, dataFim, status);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // Status disponíveis no modo lote (mais comuns)
  const statusOpcoes: ScheduleStatus[] = ["ferias", "falta_j", "comp", "folga"];

  return (
    <Modal title="🏖️ Marcar em lote" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Pinta um intervalo de dias com o mesmo status (override). Útil pra férias,
          atestados longos, banco de horas em compensação.
        </p>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Empregado *</label>
          <select
            value={empregadoId}
            onChange={(e) => setEmpregadoId(e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {empregados.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.nome}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Início *"
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
          />
          <Input
            label="Fim *"
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-2">Status pra aplicar</label>
          <div className="flex gap-2 flex-wrap">
            {statusOpcoes.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  status === s
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} text-[10px] font-bold`}>
                  {STATUS_INFO[s].short}
                </span>
                <span className="text-gray-700 dark:text-gray-300">{STATUS_INFO[s].label}</span>
              </button>
            ))}
          </div>
        </div>

        {diasNoRange > 0 && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
            Vai aplicar <strong>{STATUS_INFO[status].label}</strong> em <strong>{diasNoRange} dia(s)</strong>.
            Sobrescreve overrides existentes no range. (Pra reverter, use o botão "↩ Reverter" depois.)
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={aplicar} disabled={saving || diasNoRange <= 0}>
            {saving ? "Aplicando..." : `Aplicar em ${diasNoRange} dia(s)`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// GradeMobile — vista semanal (7 colunas grandes) com bottom-sheet pra edição.
// Pensada pra celular: cada célula é clicável confortavelmente, navegação por
// semana ←→, e tocar uma célula abre uma lista vertical com os nomes completos
// dos status (Trabalho, Folga, Férias...) — sem decorar siglas.
// ════════════════════════════════════════════════════════════════════════════

const DOW_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// Retorna a Segunda da semana de uma data
function getSegunda(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Dom..6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  d.setHours(12, 0, 0, 0);
  return d;
}

function GradeMobile({
  ano, mes, empregados, cargos, escala, escalaPorMes, derivados, versao, podeEditar, onSetStatus,
  swapsPorCelula,
  onMesChange,
}: {
  ano: number; mes: number;
  empregados: Empregado[]; cargos: Cargo[]; escala: EscalaMes | null;
  // Mapa "YYYY-MM" → EscalaMes pra ler escalas de meses adjacentes
  // (semana atravessando o mês).
  escalaPorMes: Record<string, EscalaMes | null>;
  derivados: Record<string, { [date: string]: DerivedDay }>;
  versao: "prevista" | "real";
  podeEditar: boolean;
  onSetStatus: (empregadoId: string, ymd: string, status: ScheduleStatus | null) => Promise<ValidacaoEscalaIssue[]>;
  swapsPorCelula: Record<string, SundaySwap>;
  // Callback pra avisar a EscalaPage quando a semana visualizada cai num
  // outro mês (atravessou virada). A página recarrega escala/derivados do
  // novo mês — fluxo de navegação por semana fica contínuo entre meses.
  onMesChange: (novoAno: number, novoMes: number) => void;
}) {
  // Helper: pega a escala do mês a que o `iso` pertence
  function escalaDoIso(iso: string): EscalaMes | null {
    const ym = iso.slice(0, 7); // "YYYY-MM"
    return escalaPorMes[ym] ?? null;
  }
  // Semana inicial visível:
  // - Se está vendo o mês corrente → semana de HOJE (mais útil no dia-a-dia)
  // - Senão → 1ª segunda que cai DENTRO do mês (não a segunda da semana do
  //   dia 1, que frequentemente está no mês anterior — quando o dia 1 é
  //   ter/qua/qui/sex/sáb/dom, a segunda dessa semana cai no mês passado.
  //   Isso gerava bug: mudar de junho pra maio caía na semana 04-27, que
  //   tem maioria em abril, e o efeito "majMes !== mes" disparava
  //   onMesChange(abril) — pulando maio inteiro).
  function initialWeekStart(): Date {
    const hoje = new Date();
    if (hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes) {
      return getSegunda(hoje);
    }
    const dia1 = new Date(ano, mes - 1, 1);
    const segDaSemanaDoDia1 = getSegunda(dia1);
    // Se a segunda já caiu DENTRO do mês (dia1 é segunda), usa essa.
    // Senão, adiciona 7 dias pra cair na 1ª segunda do mês.
    if (segDaSemanaDoDia1.getMonth() === dia1.getMonth() &&
        segDaSemanaDoDia1.getFullYear() === dia1.getFullYear()) {
      return segDaSemanaDoDia1;
    }
    const proxSegunda = new Date(segDaSemanaDoDia1);
    proxSegunda.setDate(proxSegunda.getDate() + 7);
    return proxSegunda;
  }
  const [weekStart, setWeekStart] = useState<Date>(() => initialWeekStart());
  // O auto-switch de mês (semana caiu majoritariamente em outro mês) só vale
  // quando o USUÁRIO navega semanas. Na semana inicial automática NÃO pode
  // disparar — senão, no fim do mês, a "semana de hoje" (ex: 29/jun–05/jul,
  // maioria em julho) joga a tela pro mês seguinte e o usuário não consegue
  // ficar no mês corrente. Como o GradeMobile fica montado mesmo no desktop,
  // sem isso o bug sequestra a navegação do desktop também.
  const userNavegouSemanaRef = useRef(false);

  // Reseta quando o mês/ano muda no header (mas só se a semana atual NÃO
  // está dentro do novo mês — senão fica perdendo a posição quando o
  // header é atualizado pelo próprio efeito de "semana atravessou o mês").
  useEffect(() => {
    const semanaAno = weekStart.getFullYear();
    const semanaMes = weekStart.getMonth() + 1;
    // Se algum dia da semana atual está no novo mês, mantém a semana
    const dataFim = new Date(weekStart);
    dataFim.setDate(dataFim.getDate() + 6);
    const fimAno = dataFim.getFullYear();
    const fimMes = dataFim.getMonth() + 1;
    const semanaTocaNovoMes =
      (semanaAno === ano && semanaMes === mes) || (fimAno === ano && fimMes === mes);
    if (!semanaTocaNovoMes) { userNavegouSemanaRef.current = false; setWeekStart(initialWeekStart()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  // 7 datas a partir do weekStart
  const dates: { iso: string; date: Date; inMes: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    dates.push({ iso, date: d, inMes: d.getMonth() === mes - 1 && d.getFullYear() === ano });
  }

  // Sempre que mudar de semana, vê se a maior parte da semana caiu em outro
  // mês. Se sim, dispara onMesChange pra EscalaPage trocar de mês e
  // recarregar tudo (escala + derivados + empregados).
  useEffect(() => {
    // Conta dias por mês na semana
    const contagem: Record<string, number> = {};
    for (const { date } of dates) {
      const k = `${date.getFullYear()}-${date.getMonth() + 1}`;
      contagem[k] = (contagem[k] || 0) + 1;
    }
    // Mês com mais dias
    let majAno = ano, majMes = mes, majCount = 0;
    for (const [k, v] of Object.entries(contagem)) {
      if (v > majCount) {
        const [a, m] = k.split("-").map(Number);
        majAno = a; majMes = m; majCount = v;
      }
    }
    // Só segue o mês majoritário em navegação ATIVA de semana do usuário.
    // (Na semana inicial automática, não — evita o flip indevido no fim do mês.)
    if (userNavegouSemanaRef.current && (majAno !== ano || majMes !== mes)) {
      userNavegouSemanaRef.current = false;
      onMesChange(majAno, majMes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getTime()]);

  const [picker, setPicker] = useState<{ empId: string; date: string } | null>(null);
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  function navegarSemana(delta: number) {
    userNavegouSemanaRef.current = true;   // navegação ativa → pode trocar de mês
    const novo = new Date(weekStart);
    novo.setDate(novo.getDate() + delta * 7);
    setWeekStart(novo);
  }

  const hoje = new Date();
  const hojeYmd = `${hoje.getFullYear()}-${pad2(hoje.getMonth() + 1)}-${pad2(hoje.getDate())}`;

  const empregadoPicker = picker ? empregados.find(e => e.id === picker.empId) : null;

  async function aplicarStatus(status: ScheduleStatus | null) {
    if (!picker) return;
    await onSetStatus(picker.empId, picker.date, status);
    setPicker(null);
  }

  // Label da semana: "12 a 18 de mai"
  const inicio = dates[0].date;
  const fim = dates[6].date;
  const mesesNomes = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const mesIni = mesesNomes[inicio.getMonth()];
  const mesFim = mesesNomes[fim.getMonth()];
  const labelSemana = mesIni === mesFim
    ? `${inicio.getDate()} a ${fim.getDate()} de ${mesIni}`
    : `${inicio.getDate()} ${mesIni} a ${fim.getDate()} ${mesFim}`;

  return (
    <>
      {/* Navegação de semana */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={() => navegarSemana(-1)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 active:bg-gray-100"
        >←</button>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {labelSemana}
        </div>
        <button
          type="button"
          onClick={() => navegarSemana(1)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 active:bg-gray-100"
        >→</button>
      </div>

      {/* Tabela semanal: nome empregado (sticky left) + 7 dias */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
        {/* Header de dias */}
        <div className="grid grid-cols-[120px_repeat(7,1fr)] gap-1 sticky top-0 z-10 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 px-2 py-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Empregado</div>
          {dates.map(({ date, iso, inMes }) => (
            <div
              key={iso}
              className={`text-center ${iso === hojeYmd ? "text-indigo-600 dark:text-indigo-400" : "text-gray-600 dark:text-gray-400"}`}
            >
              <div className="text-[9px] uppercase font-bold">{DOW_LABELS[(date.getDay() + 6) % 7]}</div>
              <div className={`text-sm font-bold ${!inMes ? "opacity-30" : ""}`}>{date.getDate()}</div>
            </div>
          ))}
        </div>

        {/* Linhas por empregado */}
        {empregados.map((e, idx) => {
          const cargo = cargoMap[e.cargoId];
          const cargoPrev = idx > 0 ? cargoMap[empregados[idx - 1].cargoId] : null;
          const isPrimeiroDaArea = cargo?.area !== cargoPrev?.area;
          return (
            <Fragment key={e.id}>
              {isPrimeiroDaArea && (
                <div className="px-2 py-1 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    {cargo?.area || "Sem área"}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-[120px_repeat(7,1fr)] gap-1 items-center px-2 py-2 border-t border-gray-100 dark:border-gray-800">
                <div className="min-w-0 pr-1">
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{e.nome}</div>
                  <div className="text-[9px] text-gray-500 truncate">{cargo?.nome || "—"}</div>
                </div>
                {dates.map(({ iso, inMes }) => {
                  // Lê da escala do mês a que o dia pertence (suporta semana
                  // atravessando virada de mês).
                  const escDoDia = escalaDoIso(iso);
                  const realCell = escDoDia?.real?.[e.id]?.[iso];
                  const previstaCell = escDoDia?.prevista?.[e.id]?.[iso];
                  const ativoNoDia = empregadoAtivoEm(e, iso);
                  const override = !ativoNoDia ? undefined : (versao === "real"
                    ? (realCell ?? previstaCell)
                    : previstaCell);
                  const derived = derivados[e.id]?.[iso];
                  const status = override ?? derived?.status;
                  const isImplicito = !override && derived?.fonte === "implicito";
                  const info = status ? STATUS_INFO[status] : null;
                  const swap = ativoNoDia ? swapsPorCelula[`${e.id}|${iso}`] : undefined;
                  if (!ativoNoDia) {
                    return (
                      <div
                        key={iso}
                        className="aspect-square w-full max-w-[44px] mx-auto rounded bg-gray-100 dark:bg-gray-800/40 flex items-center justify-center text-[10px] text-gray-400 dark:text-gray-600"
                        title="Fora do período de atividade do empregado"
                      >·</div>
                    );
                  }
                  // Dia fora do mês majoritário: visualmente mais opaco, mas
                  // continua clicável (abre picker). O auto-switch do useEffect
                  // já troca de mês quando 4+ dias da semana caem no outro.
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={!podeEditar}
                      onClick={() => setPicker({ empId: e.id, date: iso })}
                      className={`relative aspect-square w-full max-w-[44px] mx-auto rounded text-[11px] font-bold ${
                        !status || isImplicito
                          ? "bg-gray-100 dark:bg-gray-800/40 text-gray-400"
                          : `${info!.bg} ${info!.text}`
                      } ${!inMes ? "opacity-40" : ""} ${swap ? "ring-2 ring-violet-500 ring-offset-1" : ""} ${versao === "real" && escDoDia?.realAjustes?.[e.id]?.[iso]?.origem !== "solides_sync" ? "opacity-60 outline outline-1 outline-dashed outline-gray-500/70 -outline-offset-2" : ""} ${podeEditar ? "active:scale-95 transition-transform" : ""}`}
                      title={versao === "real" && escDoDia?.realAjustes?.[e.id]?.[iso]?.origem !== "solides_sync" ? "Previsto — dia ainda não fechado na praticada" : (swap ? `Inversão com ${e.id === swap.empAId ? swap.empBNome : swap.empANome}${swap.motivo ? ` — ${swap.motivo}` : ""}` : undefined)}
                    >
                      {isImplicito ? "·" : (info?.short || "")}
                      {swap && (
                        <span
                          className="absolute -top-1 -left-1 text-[10px] leading-none px-0.5 rounded bg-violet-600 text-white font-bold border border-violet-700 shadow-sm"
                          style={{ minWidth: "12px", textAlign: "center" }}
                        >
                          ↔
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* Bottom-sheet picker */}
      {picker && empregadoPicker && (
        <StatusPickerSheet
          empregadoNome={empregadoPicker.nome}
          date={picker.date}
          atual={escala?.[versao]?.[picker.empId]?.[picker.date]}
          onApply={aplicarStatus}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

function StatusPickerSheet({
  empregadoNome, date, atual, onApply, onClose,
}: {
  empregadoNome: string;
  date: string;
  atual: ScheduleStatus | undefined;
  onApply: (status: ScheduleStatus | null) => void;
  onClose: () => void;
}) {
  const dataBr = (() => {
    const [y, m, d] = date.split("-");
    return `${d}/${m}/${y}`;
  })();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto"
        style={{ animation: "slideUpSheet 0.2s ease-out" }}
      >
        <style>{`@keyframes slideUpSheet{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        {/* Handle visual */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>
        {/* Header */}
        <div className="px-4 pt-1 pb-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{empregadoNome}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">📅 {dataBr}</p>
        </div>
        {/* Lista de opções */}
        <div className="p-2">
          {STATUS_LIST.map(s => {
            const info = STATUS_INFO[s];
            const ativo = atual === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onApply(s)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
                  ativo
                    ? "bg-indigo-50 dark:bg-indigo-900/30 ring-2 ring-indigo-400"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100"
                }`}
              >
                <span className={`inline-flex items-center justify-center w-8 h-8 rounded ${info.bg} ${info.text} text-xs font-bold flex-shrink-0`}>
                  {info.short}
                </span>
                <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">{info.label}</span>
                {ativo && <span className="text-indigo-600 dark:text-indigo-400 text-sm">✓</span>}
              </button>
            );
          })}
          {/* Reverter ao cadastrado */}
          <button
            type="button"
            onClick={() => onApply(null)}
            className="w-full flex items-center gap-3 px-3 py-3 mt-1 rounded-lg text-left text-gray-700 dark:text-gray-300 border-t border-gray-200 dark:border-gray-800 pt-3 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm flex-shrink-0">↩</span>
            <span className="flex-1 text-sm">Reverter ao cadastrado</span>
          </button>
        </div>
        {/* Cancelar */}
        <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 active:bg-gray-200"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

