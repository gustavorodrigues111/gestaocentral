import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  Cliente, ClientePublicLookup, ConfiguracaoReservas, Reserva, ReservaPII, Salao,
} from "../../core/types";
import { DEFAULT_JANELA_ANTECEDENCIA_DIAS } from "../../core/types";
import { validarEmail } from "../eventos/validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";
import { useSiteConfigPublic, explicarNotFound } from "./shared/useSiteConfigPublic";
import { SiteFormShell, SiteFormScreen, botaoPrimarioStyle } from "./shared/SiteFormShell";
import { FormField, fieldInputCls } from "./shared/FormField";
import { upsertClienteLookup } from "../reservas/clienteLookup";
import { criarNotaCliente } from "../reservas/notasCliente";

// Página pública: cliente solicita reserva de mesa.
// Rota: /reservas/:rid (sem auth).
//
// Fluxo wizard em 3 passos:
//   1. WhatsApp → lookup em /clientesPublicLookup/<rid>_<e164> (get por ID
//      exato — sem enumeração possível). Se reconhecer, pré-preenche
//      nome/email e reusa o clienteId no CRM.
//   2. Detalhes → nome (editável mesmo se reconhecido), data, pessoas,
//      ocasião, observações.
//   3. Slot → horários disponíveis do dia (das janelas configuradas) com
//      qtd de vagas por salão. Cliente escolhe slot+salão.
//
// Cria doc em /reservas com origem=publico e status=pendente — admin
// confirma no módulo Reservas + CRM.

type Step = "phone" | "details" | "slot" | "submitting";

export function ReservasPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const { siteConfig, loading: loadingSite, erro: erroCarregar, notFoundMotivo } = useSiteConfigPublic(rid, {
    requireFeature: "hasReservas",
  });

  // Salões + configuração de janelas
  const [saloes, setSaloes] = useState<Salao[]>([]);
  const [config, setConfig] = useState<ConfiguracaoReservas | null>(null);
  const [loadingDados, setLoadingDados] = useState(true);

  // Reservas do dia escolhido (pra calcular disponibilidade)
  const [reservasDoDia, setReservasDoDia] = useState<Reserva[]>([]);

  // Step do wizard
  const [step, setStep] = useState<Step>("phone");
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reconhecimento de cliente recorrente. Lookup feito por getDoc em
  // /clientesPublicLookup/<rid>_<e164> ao avançar o step do WhatsApp.
  // Se reconhecer, reusamos o clienteId no /clientes ao invés de criar
  // novo (mantém histórico do CRM contíguo). Nome/email vem pré-preenchidos
  // mas seguem editáveis.
  const [lookupState, setLookupState] = useState<"idle" | "checking" | "found" | "notfound">("idle");
  const [clienteIdConhecido, setClienteIdConhecido] = useState<string | null>(null);
  // Snapshot dos valores do lookup — usado pra detectar se o cliente
  // alterou nome/email e logar a mudança na nota do CRM.
  const [nomeOriginalLookup, setNomeOriginalLookup] = useState<string | null>(null);
  const [emailOriginalLookup, setEmailOriginalLookup] = useState<string | null>(null);

  // Form state
  const [paisIso, setPaisIso] = useState(PAIS_BR.iso);
  const [ddiManual, setDdiManual] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [data, setData] = useState("");
  const [pessoas, setPessoas] = useState("2");
  const [ocasiao, setOcasiao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  // Slot selecionado
  const [slotHorario, setSlotHorario] = useState("");
  const [salaoId, setSalaoId] = useState("");
  // Indisponíveis expandidos no slot picker (chave: "slot|salaoId")
  const [indisponiveisAbertos, setIndisponiveisAbertos] = useState<Set<string>>(new Set());
  // LGPD: aceite da política de privacidade (obrigatório pra submit)
  const [aceiteLgpd, setAceiteLgpd] = useState(false);
  function toggleIndisponivel(slot: string, salId: string) {
    setIndisponiveisAbertos(prev => {
      const k = `${slot}|${salId}`;
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  // Data mínima = hoje (formato YYYY-MM-DD em horário LOCAL — toISOString
  // é UTC e quebra a virada de dia em fuso GMT-3 nas primeiras 3h da
  // madrugada). Idem agora (HH:MM) usado pra esconder slots passados.
  const hojeISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  // Buffer mínimo pra aceitar reserva (em minutos). 30min dá tempo da casa
  // se organizar — sem isso, cliente conseguia reservar pra 5 min no futuro.
  const BUFFER_MIN_MINUTOS = 30;
  // Soma BUFFER aos minutos atuais e retorna "HH:MM" (zero-padded), pra
  // comparar lexicograficamente com slot.horario.
  const agoraComBuffer = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + BUFFER_MIN_MINUTOS);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, []);

  // ──────────────── Carrega salões + config ────────────────
  useEffect(() => {
    if (!rid) return;
    let cancelado = false;
    (async () => {
      try {
        const [salSnap, cfgSnap] = await Promise.all([
          getDocs(query(collection(db, "saloes"), where("restaurantId", "==", rid))),
          getDoc(doc(db, "configReservas", rid)),
        ]);
        if (cancelado) return;
        const list = salSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao)
          .filter(s => s.ativo)
          .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
        setSaloes(list);
        setConfig(cfgSnap.exists() ? ({ id: cfgSnap.id, ...cfgSnap.data() } as ConfiguracaoReservas) : null);
      } catch (e) {
        console.error("[reservas] erro carregando saloes/config:", e);
      } finally {
        setLoadingDados(false);
      }
    })();
    return () => { cancelado = true; };
  }, [rid]);

  // ──────────────── Listener: reservas do dia selecionado ────────────────
  // Reativo — atualiza quando outras pessoas reservam no mesmo dia.
  useEffect(() => {
    if (!rid || !data) { setReservasDoDia([]); return; }
    const q = query(
      collection(db, "reservas"),
      where("restaurantId", "==", rid),
      where("data", "==", data),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reserva);
      setReservasDoDia(list);
    });
    return () => unsub();
  }, [rid, data]);

  // ──────────────── Validações por step ────────────────
  function validatePhone(): string | null {
    const pais = getPaisByIso(paisIso);
    if (pais.iso === "OUTROS") {
      if (!validarDDIManual(ddiManual)) return "DDI inválido.";
      if (whatsapp.replace(/\D/g, "").length < 4) return "Digite seu WhatsApp.";
    } else if (!validarNumeroLocal(whatsapp, pais)) {
      return "WhatsApp inválido. Confere DDD + número.";
    }
    return null;
  }

  // Avança pro step "details" + faz lookup público de cliente recorrente.
  //
  // SEGURANÇA: O lookup é getDoc por ID exato em /clientesPublicLookup —
  // doc id determinístico (`<rid>_<e164>`). Rules permitem `get` público
  // mas bloqueiam `list`, então ninguém consegue enumerar a coleção. O
  // doc contém só { nome, email?, clienteId } — nada de aniversário,
  // restrições, observações ou outros campos sensíveis do /clientes.
  // Mesmo risco que perguntar "fulano é cliente?" pelo WhatsApp da casa.
  async function avancarPhone() {
    setErro("");
    const v = validatePhone();
    if (v) return setErro(v);
    if (!rid) return setErro("URL inválida.");

    const pais = getPaisByIso(paisIso);
    const e164 = montarE164(
      pais.iso === "OUTROS" ? ddiManual : pais.ddi,
      whatsapp,
    );
    const lookupId = `${rid}_${e164.replace(/^\+/, "")}`;

    setLookupState("checking");
    try {
      const snap = await getDoc(doc(db, "clientesPublicLookup", lookupId));
      if (snap.exists()) {
        const lk = snap.data() as ClientePublicLookup;
        // Pré-preenche só se o usuário ainda não digitou nada — não
        // sobrescreve se ele voltou pro step 1 depois de já ter mexido.
        if (!nome.trim()) setNome(lk.nome || "");
        if (!email.trim() && lk.email) setEmail(lk.email);
        setClienteIdConhecido(lk.clienteId);
        // Guarda os originais pra detectar edição no submit
        setNomeOriginalLookup(lk.nome || null);
        setEmailOriginalLookup(lk.email || null);
        setLookupState("found");
      } else {
        setClienteIdConhecido(null);
        setNomeOriginalLookup(null);
        setEmailOriginalLookup(null);
        setLookupState("notfound");
      }
    } catch (e) {
      // Falha de rede não é blocker — segue como cliente novo.
      console.warn("[reservas] lookup falhou, seguindo como novo:", e);
      setClienteIdConhecido(null);
      setLookupState("notfound");
    }
    setStep("details");
  }

  function validateDetails(): string | null {
    if (!nome.trim()) return "Preenche seu nome.";
    if (!email.trim()) return "Email é obrigatório — usamos pra te enviar a confirmação.";
    if (!validarEmail(email)) return "Email inválido.";
    if (!data) return "Escolhe a data da reserva.";
    if (data < hojeISO) return "A data não pode ser no passado.";
    const n = parseInt(pessoas, 10);
    if (!n || n < 1) return "Quantas pessoas? Mínimo 1.";
    if (n > 50) return "Pra grupos acima de 50, fala com a gente pelo WhatsApp.";
    return null;
  }

  function avancarDetails() {
    setErro("");
    const v = validateDetails();
    if (v) return setErro(v);
    setStep("slot");
  }

  // ──────────────── Slots disponíveis do dia ────────────────
  // Regra de precedência:
  //  1. Se há exceção pra essa data no SiteConfig:
  //     - exc.fechado === true  → sem reservas (casa fechada)
  //     - exc.slotsReservaCustom === [] → sem reservas (sem aceitar reservas)
  //     - exc.slotsReservaCustom = [...] → usa esses slots customizados
  //     - exc.slotsReservaCustom undefined → herda janela semanal
  //  2. Senão, usa janela do dia da semana padrão.
  const slotsDisponiveis = useMemo(() => {
    if (!data || !config) return [];
    const pax = parseInt(pessoas, 10) || 0;

    // Procura exceção pra essa data específica
    const excecao = siteConfig?.excecoes?.find(e => e.data === data);
    let slotsBase: { horario: string; salaoIds: string[] }[];
    if (excecao) {
      if (excecao.fechado) return [];
      if (excecao.slotsReservaCustom !== undefined) {
        if (excecao.slotsReservaCustom.length === 0) return [];
        slotsBase = excecao.slotsReservaCustom;
      } else {
        // Sem custom — herda janela semanal
        const dow = new Date(data + "T12:00:00").getDay();
        const janela = config.janelas?.find(j => j.dia === dow);
        if (!janela || janela.slots.length === 0) return [];
        slotsBase = janela.slots;
      }
    } else {
      // Dia normal — usa janela do dia da semana
      const dow = new Date(data + "T12:00:00").getDay();
      const janela = config.janelas?.find(j => j.dia === dow);
      if (!janela || janela.slots.length === 0) return [];
      slotsBase = janela.slots;
    }

    // Se for HOJE, esconde slots já passados (com BUFFER de 30min).
    // Comparação lexicográfica de "HH:MM" funciona porque é zero-padded.
    const slotsValidos = data === hojeISO
      ? slotsBase.filter(s => s.horario > agoraComBuffer)
      : slotsBase;

    return slotsValidos.map(slot => {
      // Pra cada salão habilitado nesse slot, computa vagas
      const salaoStatus = slot.salaoIds.map(sId => {
        const sal = saloes.find(s => s.id === sId);
        if (!sal) return null;
        // Reservas existentes nesse slot+salão (excluindo cancelada/no_show)
        const existentes = reservasDoDia.filter(r =>
          r.salaoId === sId
          && r.horario === slot.horario
          && r.status !== "cancelada"
          && r.status !== "no_show"
        );
        // Cliente não vê contagem de vagas (info interna). Só mostra
        // mensagem quando NÃO está disponível — explicando o porquê
        // (ex: "aceita mesas de 4 a 6 pax").
        if (sal.modeloCapacidade === "por_capacidade") {
          const usados = existentes.reduce((s, r) => s + (r.pessoas || 0), 0);
          const cap = sal.capacidadeMaxPax || 0;
          const livres = Math.max(0, cap - usados);
          const minMesa = sal.paxMinPorMesaCap || 1;
          const maxMesa = sal.paxMaxPorMesaCap || cap;
          const paxOk = pax >= minMesa && pax <= maxMesa;
          const disponivel = paxOk && pax <= livres;
          return {
            salao: sal,
            disponivel,
            descricao: disponivel
              ? ""
              : !paxOk
                ? `aceita mesas de ${minMesa} a ${maxMesa} pax`
                : "sem vagas neste horário",
          };
        } else {
          const usadas = existentes.length;
          const total = sal.numMesas || 0;
          const livres = Math.max(0, total - usadas);
          const minMesa = sal.paxMinPorMesa || 1;
          const maxMesa = sal.paxMaxPorMesa || minMesa;
          const paxOk = pax >= minMesa && pax <= maxMesa;
          const disponivel = paxOk && livres > 0;
          return {
            salao: sal,
            disponivel,
            descricao: disponivel
              ? ""
              : !paxOk
                ? `mesas de ${minMesa}–${maxMesa} pax`
                : "sem mesas neste horário",
          };
        }
      }).filter((x): x is NonNullable<typeof x> => !!x);

      const algumDisponivel = salaoStatus.some(s => s.disponivel);
      return { horario: slot.horario, salaoStatus, algumDisponivel };
    });
  }, [data, hojeISO, agoraComBuffer, config, saloes, reservasDoDia, pessoas, siteConfig?.excecoes]);

  // ──────────────── Próximos dias disponíveis ────────────────
  // Lista os próximos 6 dias DISPONÍVEIS (com janelas configuradas) —
  // varre até `janelaAntecedenciaDias` dias à frente (configurável por
  // restaurante, default 90). Quem quiser data específica além das 6
  // chips clica em "Ver outra data" e usa o date picker nativo.
  const MAX_DIAS = 6;
  const janelaDias = config?.janelaAntecedenciaDias || DEFAULT_JANELA_ANTECEDENCIA_DIAS;
  const diasDisponiveis = useMemo(() => {
    if (!config) return [];
    const hojeBase = new Date(hojeISO + "T12:00:00");
    const result: Array<{
      data: string; diaSemanaCurto: string; diaSemanaLong: string;
      dia: number; mes: number; mesLabel: string;
      hasExcecao: boolean; motivo?: string;
    }> = [];
    const meses = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const sCurto = ["dom","seg","ter","qua","qui","sex","sáb"];
    const sLong = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];

    for (let i = 0; i < janelaDias && result.length < MAX_DIAS; i++) {
      const d = new Date(hojeBase);
      d.setDate(d.getDate() + i);
      // Igual ao hojeISO: monta em horário LOCAL, não UTC
      const dataIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dow = d.getDay();
      const ehHoje = dataIso === hojeISO;
      // Aplica regra de precedência (mesma do slotsDisponiveis)
      const exc = siteConfig?.excecoes?.find(e => e.data === dataIso);
      let slotsDoDia: { horario: string }[] = [];
      if (exc) {
        if (exc.fechado) continue;
        if (exc.slotsReservaCustom !== undefined) {
          if (exc.slotsReservaCustom.length === 0) continue;
          slotsDoDia = exc.slotsReservaCustom.filter(s => s.salaoIds.length > 0);
        } else {
          const j = config.janelas?.find(jw => jw.dia === dow);
          if (j) slotsDoDia = j.slots;
        }
      } else {
        const j = config.janelas?.find(jw => jw.dia === dow);
        if (j) slotsDoDia = j.slots;
      }
      // Se for hoje, descarta slots já passados com buffer
      if (ehHoje) {
        slotsDoDia = slotsDoDia.filter(s => s.horario > agoraComBuffer);
      }
      if (slotsDoDia.length === 0) continue;
      result.push({
        data: dataIso,
        diaSemanaCurto: sCurto[dow]!,
        diaSemanaLong: sLong[dow]!,
        dia: d.getDate(),
        mes: d.getMonth() + 1,
        mesLabel: meses[d.getMonth()]!,
        hasExcecao: !!exc,
        motivo: exc?.motivo,
      });
    }
    return result;
  }, [config, siteConfig?.excecoes, hojeISO, agoraComBuffer, janelaDias]);

  // ──────────────── Submit ────────────────
  async function submit() {
    setErro("");
    if (!slotHorario || !salaoId) {
      return setErro("Escolhe horário e salão.");
    }
    if (!aceiteLgpd) {
      return setErro("Aceita a política de privacidade pra continuar.");
    }
    setSubmitting(true);
    setStep("submitting");
    try {
      if (!rid) throw new Error("URL inválida");
      const pais = getPaisByIso(paisIso);
      const id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const sal = saloes.find(s => s.id === salaoId);
      const telefoneE164 = montarE164(
        pais.iso === "OUTROS" ? ddiManual : pais.ddi,
        whatsapp,
      );

      // ─── Cliente: se foi reconhecido pelo lookup público, reusa o
      // clienteId (mantém histórico do CRM contíguo — admin vê todas as
      // reservas da pessoa sob o mesmo registro). Senão, cria novo.
      //
      // Se o cliente alterou nome ou email na tela, ATUALIZA o cadastro
      // em /clientes (só esses 2 campos — outros como aniversário, tags,
      // restrições continuam intocados, são curados pelo admin) e cria
      // uma nota no log explicando a mudança (admin vê o histórico).
      const clienteIdFinal = clienteIdConhecido
        || `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nomeNovo = nome.trim();
      const emailNovo = email.trim();

      if (!clienteIdConhecido) {
        // Cliente novo — cria
        const cliente: Cliente = {
          id: clienteIdFinal,
          restaurantId: rid,
          nome: nomeNovo,
          telefone: telefoneE164,
          email: emailNovo || undefined,
          criadoEm: now,
          criadoPor: "publico",
          atualizadoEm: now,
        };
        await setDoc(doc(db, "clientes", clienteIdFinal), sanitizeForFirestore(cliente));
      } else {
        // Cliente reconhecido — detecta mudanças vs original do lookup
        const nomeMudou = nomeOriginalLookup !== null && nomeNovo !== nomeOriginalLookup;
        const emailMudou = (emailOriginalLookup || "") !== emailNovo;
        if (nomeMudou || emailMudou) {
          try {
            // Atualiza só os campos que mudaram (preserva tags, observações, etc)
            const patch: Partial<Cliente> = { atualizadoEm: now };
            if (nomeMudou) patch.nome = nomeNovo;
            if (emailMudou) patch.email = emailNovo || undefined;
            await updateDoc(doc(db, "clientes", clienteIdFinal), sanitizeForFirestore(patch));
          } catch (e) {
            // Update pode falhar por rules se cliente foi criado fora desse fluxo —
            // não bloqueia a reserva, só loga.
            console.warn("[reservas] update cliente falhou:", e);
          }
          // Cria nota no log do cliente registrando o que mudou
          const partesDaNota: string[] = [];
          if (nomeMudou) partesDaNota.push(`nome: "${nomeOriginalLookup}" → "${nomeNovo}"`);
          if (emailMudou) partesDaNota.push(`email: "${emailOriginalLookup || "(vazio)"}" → "${emailNovo}"`);
          try {
            await criarNotaCliente({
              restaurantId: rid,
              clienteId: clienteIdFinal,
              texto: `Cliente atualizou ${partesDaNota.join(" e ")} ao fazer nova reserva pelo site.`,
              criadoPor: "publico",
              criadoPorNome: "Cliente via site",
            });
          } catch (e) {
            console.warn("[reservas] criar nota falhou:", e);
          }
        }
      }

      // Upsert do lookup público — ID determinístico permite que próximas
      // reservas dessa pessoa caiam no mesmo clienteId. Só nome/email/ref
      // ficam aqui; nada de campos sensíveis do CRM.
      await upsertClienteLookup({
        restaurantId: rid,
        telefone: telefoneE164,
        nome: nome.trim(),
        email: email.trim() || undefined,
        clienteId: clienteIdFinal,
      });

      // Doc PRINCIPAL — sem PII. Read pode ser público pra contar
      // disponibilidade. PII vai pro /reservasPII abaixo (read auth-only).
      const reserva: Reserva = {
        id,
        restaurantId: rid,
        data,
        horario: slotHorario,
        clienteId: clienteIdFinal,
        pessoas: parseInt(pessoas, 10),
        salaoId,
        salaoNomeSnapshot: sal?.nome,
        mesaId: null,
        status: "pendente",
        origem: "publico",
        registradoEm: now,
        registradoPor: "publico",
        atualizadoEm: now,
      };
      const reservaPII: ReservaPII = {
        id,
        restaurantId: rid,
        clienteNomeSnapshot: nome.trim(),
        clienteTelefoneSnapshot: telefoneE164,
        clienteEmailSnapshot: email.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
        ocasiao: ocasiao.trim() || undefined,
        registradoEm: now,
      };
      // 2 escritas paralelas — não tem batch transacional aqui porque o
      // usuário público não pode garantir consistência cross-collection
      // via rules. Aceitável: se PII falhar, /reservas fica órfã (admin
      // vê reserva sem dados — recupera por contato direto).
      await Promise.all([
        setDoc(doc(db, "reservas", id), sanitizeForFirestore(reserva)),
        setDoc(doc(db, "reservasPII", id), sanitizeForFirestore(reservaPII)),
      ]);
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro ao enviar — tenta novamente");
      setStep("slot");
    } finally {
      setSubmitting(false);
    }
  }

  // ──────────────── Estados de carga/erro/sucesso ────────────────
  const loading = loadingSite || loadingDados;
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 14 }}>
        Carregando...
      </div>
    );
  }
  if (erroCarregar) {
    return <SiteFormScreen siteConfig={siteConfig} icone="⚠️" titulo="Erro ao carregar" mensagem={erroCarregar} />;
  }
  if (notFoundMotivo) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="❌"
        titulo="Página não encontrada"
        mensagem={explicarNotFound(notFoundMotivo, "reservas online")}
      />
    );
  }
  // Sem salões cadastrados → instrução
  if (saloes.length === 0) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="🏛️"
        titulo="Reservas em configuração"
        mensagem="O restaurante ainda não cadastrou os salões. Tenta de novo em algumas horas."
      />
    );
  }
  // Sem janelas configuradas → instrução
  if (!config || config.janelas.every(j => j.slots.length === 0)) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="🕒"
        titulo="Reservas em configuração"
        mensagem="O restaurante ainda não definiu horários de reserva. Tenta de novo em algumas horas."
      />
    );
  }
  if (submitted) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="✓"
        titulo="Reserva enviada!"
        mensagem={
          <>
            A gente confere a disponibilidade e confirma pelo WhatsApp em breve.
            <br />
            <strong>{data && formatarDataBR(data)} · {slotHorario}</strong>
            {saloes.find(s => s.id === salaoId)?.nome && (
              <> · {saloes.find(s => s.id === salaoId)?.nome}</>
            )}
          </>
        }
      />
    );
  }

  // ──────────────── Render ────────────────
  const corPrimaria = siteConfig?.tema?.corPrimaria || "#1a5c2a";

  return (
    <SiteFormShell
      siteConfig={siteConfig}
      titulo="Reservar mesa"
      subtitulo={
        step === "phone"
          ? "Pra começar, qual seu WhatsApp?"
          : step === "details"
            ? "Conta um pouco sobre você e o dia."
            : "Escolhe horário e salão."
      }
    >
      {/* Barra de progresso visual */}
      <StepIndicator step={step} corPrimaria={corPrimaria} />

      {/* STEP 1: WhatsApp */}
      {step === "phone" && (
        <div className="space-y-4">
          <FormField label="WhatsApp *">
            {paisIso === "OUTROS" ? (
              <div className="grid grid-cols-[110px_70px_1fr] gap-1.5">
                <select
                  value={paisIso}
                  onChange={(e) => { setPaisIso(e.target.value); setWhatsapp(""); setDdiManual(""); }}
                  className={fieldInputCls}
                >
                  {PAISES.map(p => (
                    <option key={p.iso} value={p.iso}>{p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}</option>
                  ))}
                </select>
                <input
                  type="tel" inputMode="numeric"
                  value={ddiManual}
                  onChange={(e) => setDdiManual(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="DDI"
                  className={fieldInputCls + " tabular-nums"}
                />
                <input
                  type="tel" inputMode="numeric"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="Número"
                  className={fieldInputCls}
                />
              </div>
            ) : (
              <div className="grid grid-cols-[110px_1fr] gap-1.5">
                <select
                  value={paisIso}
                  onChange={(e) => { setPaisIso(e.target.value); setWhatsapp(""); }}
                  className={fieldInputCls}
                >
                  {PAISES.map(p => (
                    <option key={p.iso} value={p.iso}>{p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}</option>
                  ))}
                </select>
                <input
                  type="tel" inputMode="numeric"
                  value={whatsapp}
                  onChange={(e) => {
                    const pais = getPaisByIso(paisIso);
                    setWhatsapp(formatarNumeroLocal(e.target.value, pais));
                  }}
                  placeholder={paisIso === "BR" ? "(11) 99999-9999" : `${getPaisByIso(paisIso).minLen} dígitos`}
                  className={fieldInputCls}
                />
              </div>
            )}
          </FormField>
          {erro && <div className="text-sm text-rose-600">{erro}</div>}
          <button
            type="button"
            onClick={avancarPhone}
            disabled={lookupState === "checking"}
            style={{ ...botaoPrimarioStyle(siteConfig), opacity: lookupState === "checking" ? 0.6 : 1 }}
          >
            {lookupState === "checking" ? "Verificando..." : "Continuar"}
          </button>
        </div>
      )}

      {/* STEP 2: Detalhes */}
      {step === "details" && (
        <div className="space-y-4">
          {lookupState === "found" && (
            <div style={{
              fontSize: 13, padding: "10px 12px", borderRadius: 10,
              backgroundColor: `${corPrimaria}10`,
              border: `1px solid ${corPrimaria}30`,
              color: corPrimaria, lineHeight: 1.4,
            }}>
              👋 Bem-vindo de volta{nome ? `, ${nome.split(" ")[0]}` : ""}! Confere se os dados estão certos.
            </div>
          )}
          <FormField label="Seu nome *">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Email *" dica="Usamos pra enviar a confirmação">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Data *" dica="Próximos dias disponíveis — ou escolha uma data específica">
            {diasDisponiveis.length === 0 ? (
              <div className="text-sm rounded-lg p-3 bg-amber-50 border border-amber-200 text-amber-800">
                Nenhuma data com reservas disponíveis nos próximos {janelaDias} dias.
                Fale com a casa pelo WhatsApp.
              </div>
            ) : (
              <div style={{
                display: "flex", gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-start",
              }}>
                {diasDisponiveis.map(d => {
                  const ativo = data === d.data;
                  return (
                    <button
                      key={d.data}
                      type="button"
                      onClick={() => { setData(d.data); setSlotHorario(""); setSalaoId(""); }}
                      style={{
                        flex: "1 1 calc(33.33% - 8px)",   // 3 chips por linha (6 = 2 linhas de 3)
                        minWidth: 78, maxWidth: 140,
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: `1px solid ${ativo ? corPrimaria : "#d1d5db"}`,
                        backgroundColor: ativo ? `${corPrimaria}15` : "#fff",
                        color: ativo ? corPrimaria : "#1a1a1a",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "background-color 0.15s, border-color 0.15s",
                      }}
                      title={d.motivo}
                    >
                      <div style={{ fontSize: 11, textTransform: "lowercase", opacity: 0.7 }}>
                        {d.diaSemanaCurto}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, marginTop: 2 }}>
                        {String(d.dia).padStart(2, "0")}
                      </div>
                      <div style={{ fontSize: 10, textTransform: "lowercase", opacity: 0.7, marginTop: 2 }}>
                        {d.mesLabel}
                      </div>
                      {d.hasExcecao && (
                        <div style={{
                          fontSize: 8, marginTop: 3, color: corPrimaria,
                          textTransform: "uppercase", fontWeight: 700,
                        }}>★</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Date picker como fallback pra qualquer data dentro da janela.
                Aparece quando o cliente quer reservar fora dos 6 chips
                (ex: aniversário em 60 dias). Limitado pela janela configurada. */}
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#666" }}>ou escolha outra data:</span>
              <input
                type="date"
                value={data}
                min={hojeISO}
                max={(() => {
                  const d = new Date(hojeISO + "T12:00:00");
                  d.setDate(d.getDate() + janelaDias);
                  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                })()}
                onChange={(e) => { setData(e.target.value); setSlotHorario(""); setSalaoId(""); }}
                className={fieldInputCls}
                style={{ maxWidth: 180, flex: "0 1 auto" }}
              />
            </div>
          </FormField>

          <FormField label="Pessoas *">
            <input
              type="number" inputMode="numeric"
              min={1} max={50}
              value={pessoas}
              onChange={(e) => { setPessoas(e.target.value); setSlotHorario(""); setSalaoId(""); }}
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Ocasião (opcional)">
            <input
              value={ocasiao}
              onChange={(e) => setOcasiao(e.target.value)}
              placeholder="ex: Aniversário, almoço de negócios"
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Observações (opcional)">
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Restrições alimentares, mesa preferida, etc."
              className={fieldInputCls + " resize-y"}
            />
          </FormField>

          {erro && <div className="text-sm text-rose-600">{erro}</div>}

          <button
            type="button"
            onClick={avancarDetails}
            style={botaoPrimarioStyle(siteConfig)}
          >
            Ver horários
          </button>
          <button
            type="button"
            onClick={() => { setErro(""); setStep("phone"); }}
            style={voltarLinkStyle}
          >
            ← Voltar
          </button>
        </div>
      )}

      {/* STEP 3: Slot picker */}
      {(step === "slot" || step === "submitting") && (
        <div className="space-y-4">
          {/* Resumo do que já foi escolhido */}
          <div className="text-xs rounded-lg p-3 bg-gray-50 border border-gray-200">
            <div>📅 {formatarDataBR(data)} · 👥 {pessoas} pessoa(s)</div>
            <div className="mt-0.5 text-gray-500">{nome}</div>
          </div>

          {slotsDisponiveis.length === 0 ? (
            <div className="text-sm rounded-lg p-4 bg-amber-50 border border-amber-200 text-amber-800">
              Sem horários disponíveis pra esse dia. Tenta outra data ou fala
              com a gente pelo WhatsApp.
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Escolhe um horário
              </label>
              {slotsDisponiveis.map(slot => {
                const ativo = slotHorario === slot.horario;
                return (
                  <div key={slot.horario} style={{
                    borderRadius: 12,
                    border: `1px solid ${ativo ? `${corPrimaria}60` : "#d1d5db"}`,
                    backgroundColor: ativo ? `${corPrimaria}08` : "#fff",
                    padding: 12,
                    opacity: slot.algumDisponivel ? 1 : 0.5,
                  }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-lg font-semibold" style={{ color: corPrimaria }}>
                        🕒 {slot.horario}
                      </div>
                      {!slot.algumDisponivel && (
                        <span className="text-xs text-gray-500">sem vagas</span>
                      )}
                    </div>
                    {slot.algumDisponivel && (() => {
                      // Ordena salões: disponíveis primeiro, indisponíveis depois.
                      const disponiveis = slot.salaoStatus.filter(s => s.disponivel);
                      const indisponiveis = slot.salaoStatus.filter(s => !s.disponivel);
                      return (
                        <div className="mt-2 grid grid-cols-1 gap-1.5">
                          {/* Disponíveis em destaque */}
                          {disponiveis.map(({ salao: sal }) => {
                            const salSel = ativo && salaoId === sal.id;
                            return (
                              <button
                                key={sal.id}
                                type="button"
                                onClick={() => { setSlotHorario(slot.horario); setSalaoId(sal.id); setErro(""); }}
                                style={salaoOptionStyle(salSel, true, corPrimaria)}
                              >
                                <div>
                                  <div className="font-semibold">{sal.nome}</div>
                                  {sal.descricao && (
                                    <div className="text-xs opacity-70 mt-0.5">{sal.descricao}</div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                          {/* Indisponíveis compactos — só nome + chevron. Click
                              expande pra mostrar motivo (sem permitir reserva). */}
                          {indisponiveis.map(({ salao: sal, descricao }) => {
                            const expandido = indisponiveisAbertos.has(`${slot.horario}|${sal.id}`);
                            return (
                              <button
                                key={sal.id}
                                type="button"
                                onClick={() => toggleIndisponivel(slot.horario, sal.id)}
                                style={{
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  fontSize: 13,
                                  textAlign: "left",
                                  cursor: "pointer",
                                  border: "1px solid #e5e7eb",
                                  backgroundColor: "#fafafa",
                                  color: "#888",
                                  width: "100%",
                                  transition: "background-color 0.15s",
                                }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span>{sal.nome}</span>
                                  <span className="text-[11px] opacity-60">
                                    {expandido ? "▲ indisponível" : "▼ indisponível"}
                                  </span>
                                </div>
                                {expandido && (descricao || sal.descricao) && (
                                  <div className="text-xs mt-1.5 pt-1.5 border-t border-gray-200" style={{ color: "#888" }}>
                                    {descricao && <div>{descricao}</div>}
                                    {sal.descricao && <div className="opacity-70 mt-0.5">{sal.descricao}</div>}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}

          {/* LGPD: aceite da política de privacidade obrigatório */}
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            cursor: "pointer",
            fontSize: 12, lineHeight: 1.5, color: "#555",
          }}>
            <input
              type="checkbox"
              checked={aceiteLgpd}
              onChange={(e) => setAceiteLgpd(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span>
              Concordo com a coleta e o uso dos meus dados conforme a{" "}
              {siteConfig?.slug ? (
                <Link to={`/politica/${siteConfig.slug}`} target="_blank" style={{ color: corPrimaria, textDecoration: "underline" }}>
                  política de privacidade
                </Link>
              ) : (
                <span style={{ color: corPrimaria }}>política de privacidade</span>
              )} (LGPD).
            </span>
          </label>

          {erro && <div className="text-sm text-rose-600">{erro}</div>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !slotHorario || !salaoId || !aceiteLgpd}
            style={{ ...botaoPrimarioStyle(siteConfig), opacity: (submitting || !slotHorario || !salaoId || !aceiteLgpd) ? 0.6 : 1 }}
          >
            {submitting ? "Enviando..." : "Confirmar reserva"}
          </button>
          <button
            type="button"
            onClick={() => { setErro(""); setStep("details"); }}
            disabled={submitting}
            style={voltarLinkStyle}
          >
            ← Voltar
          </button>
        </div>
      )}
    </SiteFormShell>
  );
}

// "Voltar" como link discreto — usado depois do botão primário em cada step
const voltarLinkStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  fontSize: 13,
  padding: "8px 0",
  cursor: "pointer",
  display: "block",
  margin: "0 auto",
  textDecoration: "underline",
  textDecorationStyle: "dotted",
  textUnderlineOffset: 3,
};

// ─── Helpers visuais ────────────────────────────────────────────────

function StepIndicator({ step, corPrimaria }: { step: Step; corPrimaria: string }) {
  const i = step === "phone" ? 0 : step === "details" ? 1 : 2;
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {[0, 1, 2].map(idx => (
        <div key={idx} style={{
          width: idx <= i ? 28 : 16,
          height: 6,
          borderRadius: 3,
          backgroundColor: idx <= i ? corPrimaria : "#d1d5db",
          transition: "all 0.2s",
        }} />
      ))}
    </div>
  );
}

function salaoOptionStyle(selecionado: boolean, disponivel: boolean, corPrimaria: string): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 14,
    textAlign: "left",
    cursor: disponivel ? "pointer" : "not-allowed",
    border: `1px solid ${selecionado ? corPrimaria : disponivel ? "#d1d5db" : "#e5e7eb"}`,
    backgroundColor: selecionado ? `${corPrimaria}15` : "#fff",
    color: disponivel ? "#1a1a1a" : "#999",
    transition: "background-color 0.15s, border-color 0.15s",
    width: "100%",
  };
}

function formatarDataBR(iso: string): ReactNode {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
