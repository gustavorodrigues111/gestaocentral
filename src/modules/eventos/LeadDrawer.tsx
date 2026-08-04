import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { parseYmd, pad2 } from "../../core/utils/date";
import type { CanalTratativa, LeadEvento, LeadEventoStatus, LogMensagemEvento, PacoteEvento, Pessoa } from "../../core/types";
import { CANAL_TRATATIVA_ICONE, CANAL_TRATATIVA_LABEL } from "../../core/types";
import { PropostaSection } from "./PropostaSection";
import { BEOSection } from "./BEOSection";
import { ESCOPO_PACOTE_LABEL, MODELO_LABEL, OCASIAO_LABEL } from "./validacoes";
import { FecharEventoModal } from "./FecharEventoModal";
import { EditarLeadModal } from "./EditarLeadModal";
import { fecharEvento, precoUltimaProposta } from "./leadHelpers";
import { registrarTratativa } from "./tratativas";

const STATUS_LABEL: Record<LeadEventoStatus, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  proposta_enviada: "Proposta enviada",
  sinal_recebido: "Sinal recebido",
  confirmado: "Confirmado",
  realizado: "Realizado",
  perdido: "Perdido",
};

// Próxima ação sugerida pra cada estágio. Quando vendedor abre o card,
// vê de imediato o que falta — sem precisar decidir sozinho o que fazer.
const PROXIMA_ACAO: Record<LeadEventoStatus, string[]> = {
  novo: [
    "Mandar primeira mensagem no WhatsApp",
    "Confirmar data, slot e número de convidados",
    "Entender expectativa de orçamento",
  ],
  qualificado: [
    "Escolher pacote-base (ou marcar como personalizado)",
    "Montar proposta",
    "Enviar proposta via WhatsApp",
  ],
  proposta_enviada: [
    "Aguardar resposta do cliente",
    "Lembrete em 3 dias se não responder",
    "Negociar se cliente pedir ajustes",
  ],
  sinal_recebido: [
    "Confirmar recebimento do sinal por escrito",
    "Marcar próximas etapas (degustação? visita?)",
    "Cobrar saldo 1 dia antes do evento",
  ],
  confirmado: [
    "Gerar BEO e mandar pra cozinha",
    "Confirmar contagem final 24h antes",
    "Confirmar timeline do dia",
  ],
  realizado: [
    "Mandar agradecimento + pedir avaliação",
    "Registrar feedback no CRM",
  ],
  perdido: [
    "Marcar motivo da perda",
    "Voltar a oferecer em outra data se fizer sentido",
  ],
};

const STATUS_ORDEM: LeadEventoStatus[] = [
  "novo", "qualificado", "proposta_enviada", "sinal_recebido", "confirmado", "realizado",
];

type Props = {
  lead: LeadEvento;
  pacotes: PacoteEvento[];
  podeEditar: boolean;
  conflitosDoDia?: LeadEvento[];   // outros leads ativos no mesmo dia
  onClose: () => void;
};

export function LeadDrawer({ lead, pacotes, podeEditar, conflitosDoDia = [], onClose }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const abrirWhatsapp = useAbrirWhatsapp();
  const restaurant = restaurants.find(r => r.id === lead.restaurantId) || null;
  const pessoasComerciaisIds = restaurant?.eventosConfig?.pessoasComerciaisIds || [];

  const [salvando, setSalvando] = useState(false);

  // Log de tratativas (logsEvento) deste lead.
  const [tratativas, setTratativas] = useState<LogMensagemEvento[]>([]);
  const [novaTratativa, setNovaTratativa] = useState("");
  const [canalTratativa, setCanalTratativa] = useState<CanalTratativa>("whatsapp");
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "logsEvento"), where("leadId", "==", lead.id)),
      (snap) => setTratativas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as LogMensagemEvento)),
      () => { /* silent */ },
    );
    return () => unsub();
  }, [lead.id]);
  const tratativasOrd = useMemo(
    () => [...tratativas].sort((a, b) => (b.enviadoEm || "").localeCompare(a.enviadoEm || "")),
    [tratativas],
  );

  async function registrarTratativaManual() {
    if (!me || !novaTratativa.trim()) return;
    setSalvando(true);
    try {
      await registrarTratativa({
        restaurantId: lead.restaurantId, leadId: lead.id,
        texto: novaTratativa.trim(), canal: canalTratativa,
        porId: me.id, porNome: me.nome, manual: true,
      });
      setNovaTratativa("");
    } finally {
      setSalvando(false);
    }
  }

  // Modal de edição dos dados do lead
  const [editarModalOpen, setEditarModalOpen] = useState(false);

  // Modal de fechamento de evento
  const [fecharModalOpen, setFecharModalOpen] = useState(false);
  const [precoSugerido, setPrecoSugerido] = useState<number>(0);

  // Pessoas — carregadas pra alimentar os pickers do modal de fechamento.
  // Filtragem por pessoasComerciaisIds acontece no próprio modal.
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "pessoas"),
      (snap) => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)),
      () => { /* silent */ },
    );
    return () => unsub();
  }, []);

  const pacote = lead.pacoteSugeridoId ? pacotes.find(p => p.id === lead.pacoteSugeridoId) : null;
  const data = parseYmd(lead.dataDesejada);

  async function abrirFecharModal() {
    if (!podeEditar) return;
    // Pré-carrega preço sugerido só se o lead ainda não tem fechamento (1ª vez).
    if (!lead.fechamento) {
      try {
        const preco = await precoUltimaProposta(lead.id);
        setPrecoSugerido(preco);
      } catch {
        setPrecoSugerido(0);
      }
    }
    setFecharModalOpen(true);
  }

  // Finaliza o evento → sai do board e vai pro histórico do mês em que ocorreu.
  async function finalizarEvento() {
    if (!podeEditar) return;
    if (!lead.fechamento) {
      alert("Preencha o fechamento antes de finalizar (faturamento + dados de comissão).");
      await abrirFecharModal();
      return;
    }
    const now = new Date().toISOString();
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
      arquivadoEm: now,
      arquivadoMesRef: (lead.dataDesejada || now).slice(0, 10).slice(0, 7),
      updatedAt: now,
    }));
    onClose();
  }
  async function reabrirEvento() {
    if (!podeEditar) return;
    await updateDoc(doc(db, "leadsEvento", lead.id), {
      arquivadoEm: deleteField(),
      arquivadoMesRef: deleteField(),
      updatedAt: new Date().toISOString(),
    });
  }

  async function confirmarFechamento(fech: NonNullable<LeadEvento["fechamento"]>) {
    if (!me) throw new Error("Sessão não identificada");
    // Carimba quem fechou. Se já havia fechamento (edição), preserva o original.
    const fechamento: NonNullable<LeadEvento["fechamento"]> = lead.fechamento
      ? { ...fech, fechadoEm: lead.fechamento.fechadoEm, fechadoPor: lead.fechamento.fechadoPor, fechadoPorNome: lead.fechamento.fechadoPorNome }
      : { ...fech, fechadoEm: new Date().toISOString(), fechadoPor: me.id, fechadoPorNome: me.nome };
    await fecharEvento(lead.id, fechamento);
  }

  async function mudarStatus(novoStatus: LeadEventoStatus, motivoPerda?: string) {
    if (!podeEditar) return;
    // Bloqueia transição pra "realizado" sem passar pelo fechamento.
    // Se já tem fechamento, deixa fluir (reabrir após voltar coluna não força modal de novo).
    if (novoStatus === "realizado" && !lead.fechamento) {
      await abrirFecharModal();
      return;
    }
    setSalvando(true);
    try {
      const updates: Record<string, unknown> = {
        status: novoStatus,
        updatedAt: new Date().toISOString(),
      };
      if (novoStatus === "perdido") {
        updates.perdidoEm = new Date().toISOString();
        updates.motivoPerda = motivoPerda || "";
      }
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore(updates));
    } finally {
      setSalvando(false);
    }
  }

  async function perderLead() {
    const motivo = prompt("Motivo da perda:");
    if (motivo === null) return;
    await mudarStatus("perdido", motivo);
  }

  async function avancar() {
    const idx = STATUS_ORDEM.indexOf(lead.status);
    if (idx < 0 || idx >= STATUS_ORDEM.length - 1) return;
    await mudarStatus(STATUS_ORDEM[idx + 1]);
  }

  async function voltar() {
    const idx = STATUS_ORDEM.indexOf(lead.status);
    if (idx <= 0) return;
    await mudarStatus(STATUS_ORDEM[idx - 1]);
  }

  // Responsável padrão do restaurante (default de exibição pra leads sem dono,
  // ex: vindos do form público que não conseguem ler a config na criação).
  const respPadraoId = restaurant?.eventosConfig?.responsavelPadraoId;
  const respPadraoNome = restaurant?.eventosConfig?.responsavelPadraoNome;
  const responsavelEfetivoNome = lead.responsavelNome || respPadraoNome || null;
  const responsavelPeloPadrao = !lead.responsavelId && !!respPadraoId;

  // Pessoas que podem ser responsáveis: comerciais + eu (sem duplicar).
  const candidatosResp = useMemo(() => {
    const set = new Set(pessoasComerciaisIds);
    if (me) set.add(me.id);
    if (respPadraoId) set.add(respPadraoId);
    return pessoas.filter(p => set.has(p.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [pessoas, pessoasComerciaisIds, me, respPadraoId]);

  async function setResponsavel(pessoaId: string) {
    if (!podeEditar) return;
    const p = pessoas.find(x => x.id === pessoaId);
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
      responsavelId: pessoaId || null,
      responsavelNome: p?.nome || null,
      updatedAt: new Date().toISOString(),
    }));
  }

  // Conflito de agenda no mesmo dia. Vermelho se horários se sobrepõem
  // (sempre bloqueia visualmente); amarelo discreto se dia igual mas horários
  // diferentes e o usuário já aceitou ter dois eventos no dia.
  const temSobreposicao = conflitosDoDia.some(
    o => lead.horaInicio < o.horaFim && o.horaInicio < lead.horaFim,
  );
  const temConflitoDia = conflitosDoDia.length > 0;
  async function aceitarConflitoDia() {
    if (!podeEditar) return;
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
      conflitoDiaAceito: true, updatedAt: new Date().toISOString(),
    }));
  }

  // Saudação inicial pré-preenchida no compositor do WhatsApp interno.
  const saudacaoWhats = `Oi ${lead.cliente.nome.split(" ")[0]}, tudo bem? Vi seu interesse pelo evento.`;

  // Editar o nome do cliente (corrige erros de digitação) — com log em logsEvento.
  const [editNome, setEditNome] = useState(false);
  const [nomeDraft, setNomeDraft] = useState(lead.cliente.nome);
  async function salvarNome() {
    const novo = nomeDraft.trim();
    const antigo = lead.cliente.nome || "";
    if (!novo) { alert("O nome não pode ficar vazio."); return; }
    if (novo === antigo) { setEditNome(false); return; }
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ "cliente.nome": novo, atualizadoEm: new Date().toISOString() }));
    try {
      await registrarTratativa({ restaurantId: lead.restaurantId, leadId: lead.id, canal: "sistema", porId: me?.id || "", porNome: me?.nome || "—", manual: true,
        texto: `✏️ Nome do cliente corrigido: "${antigo}" → "${novo}"` });
    } catch { /* log é best-effort */ }
    setEditNome(false);
  }

  return (
    <Modal title={`Lead — ${lead.cliente.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Status + ações */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Status</span>
            <span className="font-bold text-gray-900 dark:text-gray-100">
              {STATUS_LABEL[lead.status]}
            </span>
          </div>
          {podeEditar && (
            <div className="flex gap-1 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => setEditarModalOpen(true)} disabled={salvando}>
                ✏️ Editar
              </Button>
              {lead.status !== "perdido" && (
                <>
                  <Button size="sm" variant="secondary" onClick={voltar} disabled={salvando || lead.status === "novo"}>
                    ← voltar
                  </Button>
                  <Button size="sm" onClick={avancar} disabled={salvando || lead.status === "realizado"}>
                    avançar →
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Banner de conflito de agenda no mesmo dia */}
        {temConflitoDia && (temSobreposicao || !lead.conflitoDiaAceito ? (
          <div className="rounded-lg border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/25 p-3">
            <div className="text-sm font-bold text-rose-800 dark:text-rose-200 flex items-center gap-1.5">
              ⚠ {temSobreposicao ? "Conflito de horário neste dia" : "Já existe evento neste dia"}
            </div>
            <div className="text-[12px] text-rose-700 dark:text-rose-300 mt-1">
              {conflitosDoDia.map(o => `${o.cliente.nome} (${o.horaInicio}–${o.horaFim})`).join(", ")}
              {temSobreposicao
                ? " — os horários se sobrepõem. Ajuste os horários pra liberar."
                : " — confirme se querem mesmo dois eventos no mesmo dia."}
            </div>
            {!temSobreposicao && podeEditar && (
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={aceitarConflitoDia}>
                  Sim, aceitar dois eventos neste dia
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/15 px-3 py-2">
            <div className="text-[12px] text-amber-800 dark:text-amber-300">
              🗓️ Mais de um evento neste dia (horários diferentes) — aceito.
            </div>
          </div>
        ))}

        {/* Próxima ação */}
        <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3">
          <div className="text-[11px] uppercase font-bold tracking-wider text-indigo-700 dark:text-indigo-300 mb-1">
            Próxima ação sugerida
          </div>
          <ul className="text-[13px] text-indigo-900 dark:text-indigo-200 list-disc pl-5 space-y-0.5">
            {PROXIMA_ACAO[lead.status].map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>

        {/* Cliente */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Cliente</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {editNome ? (
                <>
                  <input value={nomeDraft} onChange={e => setNomeDraft(e.target.value)} autoFocus
                    onKeyDown={e => { if (e.key === "Enter") void salvarNome(); if (e.key === "Escape") { setEditNome(false); setNomeDraft(lead.cliente.nome); } }}
                    className="text-sm font-semibold rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1" />
                  <button type="button" onClick={() => void salvarNome()} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white">Salvar</button>
                  <button type="button" onClick={() => { setEditNome(false); setNomeDraft(lead.cliente.nome); }} className="text-xs text-gray-400">cancelar</button>
                </>
              ) : (
                <>
                  <span className="font-semibold">{lead.cliente.nome}</span>
                  {podeEditar && <button type="button" onClick={() => { setNomeDraft(lead.cliente.nome); setEditNome(true); }} title="Corrigir o nome (fica registrado no histórico)" className="text-gray-400 hover:text-indigo-600 text-xs">✎</button>}
                </>
              )}
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                {lead.cliente.tipoPessoa}
              </span>
            </div>
            {lead.cliente.tipoPessoa === "PJ" && lead.cliente.razaoSocial && (
              <div className="text-gray-600 dark:text-gray-400">{lead.cliente.razaoSocial}{lead.cliente.cnpj && ` · CNPJ ${lead.cliente.cnpj}`}</div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-600 dark:text-gray-400">📱 {lead.cliente.whatsapp}</span>
              {lead.cliente.whatsapp && (
                <button
                  type="button"
                  onClick={() => void abrirWhatsapp(lead.restaurantId, "eventos", lead.cliente.whatsapp!, lead.cliente.nome, saudacaoWhats)}
                  className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-200"
                >
                  💬 Falar pelo WhatsApp
                </button>
              )}
            </div>
            {lead.cliente.email && (
              <div className="text-gray-600 dark:text-gray-400">✉ {lead.cliente.email}</div>
            )}
          </div>
        </div>

        {/* Evento desejado */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Evento desejado</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-1">
            <div>
              <strong>{pad2(data.getDate())}/{pad2(data.getMonth() + 1)}/{data.getFullYear()}</strong>
              {" · "}
              {lead.horaInicio} – {lead.horaFim}
              {" · "}
              {lead.slot === "almoco" ? "🌞 Almoço" : lead.slot === "jantar" ? "🌙 Jantar" : "🕒 Dia inteiro"}
            </div>
            <div>{lead.numConvidados} convidados</div>
            <div>
              <span className="text-gray-500">Ocasião: </span>
              {lead.ocasiao === "outros"
                ? (lead.ocasiaoOutros || "Outros")
                : (OCASIAO_LABEL[lead.ocasiao] || lead.ocasiao)}
            </div>
            <div>
              <span className="text-gray-500">Modelo: </span>
              {MODELO_LABEL[lead.modeloEvento] || lead.modeloEvento}
            </div>
            {lead.modeloEvento === "pacote_por_pessoa" && lead.escopoPacote && (
              <div>
                <span className="text-gray-500">Pacote: </span>
                {lead.escopoPacote === "outro"
                  ? (lead.escopoPacoteOutro || "Outro")
                  : ESCOPO_PACOTE_LABEL[lead.escopoPacote]}
              </div>
            )}
            <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400">
              <span>{lead.musicaAoVivo ? "✓" : "✗"} música ao vivo</span>
              <span>{lead.decoracao ? "✓" : "✗"} decoração própria</span>
            </div>
            {pacote && (
              <div className="text-indigo-700 dark:text-indigo-400">📦 {pacote.nome}</div>
            )}
            {lead.dataAlternativa && (
              <div className="text-xs text-gray-500">
                Alternativa: {(() => {
                  const dd = parseYmd(lead.dataAlternativa);
                  return `${pad2(dd.getDate())}/${pad2(dd.getMonth() + 1)}/${dd.getFullYear()}`;
                })()}
              </div>
            )}
          </div>
        </div>

        {lead.observacoesCliente && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              O que o cliente escreveu
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm whitespace-pre-wrap">
              {lead.observacoesCliente}
            </div>
          </div>
        )}

        {/* Responsável */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Responsável</div>
          {podeEditar ? (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={lead.responsavelId || ""}
                onChange={(e) => setResponsavel(e.target.value)}
                className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 max-w-[240px]"
              >
                <option value="">
                  {respPadraoNome ? `Padrão — ${respPadraoNome}` : "— ninguém —"}
                </option>
                {candidatosResp.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
              {responsavelPeloPadrao && (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                  padrão
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm">{responsavelEfetivoNome || <span className="text-gray-500 italic">ninguém atribuído</span>}</div>
          )}
        </div>

        {/* Log de tratativas com o cliente */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            📇 Tratativas com o cliente
          </div>
          {podeEditar && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 mb-2 space-y-2">
              <textarea
                value={novaTratativa}
                onChange={(e) => setNovaTratativa(e.target.value)}
                placeholder="Ex: cliente pediu pra reduzir o valor da locação; combinamos retorno até sexta…"
                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                rows={2}
              />
              <div className="flex items-center gap-2">
                <select
                  value={canalTratativa}
                  onChange={(e) => setCanalTratativa(e.target.value as CanalTratativa)}
                  className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                >
                  <option value="whatsapp">💬 WhatsApp</option>
                  <option value="telefone">📞 Telefone</option>
                  <option value="email">📧 E-mail</option>
                  <option value="presencial">🤝 Presencial</option>
                  <option value="outro">• Outro</option>
                </select>
                <Button size="sm" onClick={registrarTratativaManual} disabled={salvando || !novaTratativa.trim()}>
                  Registrar tratativa
                </Button>
              </div>
            </div>
          )}
          {tratativasOrd.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic px-1">
              Nenhuma tratativa registrada ainda. Proposta enviada e interações ficam aqui.
            </p>
          ) : (
            <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-3">
              {tratativasOrd.map((t) => (
                <li key={t.id} className="ml-4">
                  <span className="absolute -left-[7px] mt-1 w-3 h-3 rounded-full bg-indigo-400 dark:bg-indigo-500" />
                  <div className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{t.texto}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{CANAL_TRATATIVA_ICONE[t.canal] || "•"} {CANAL_TRATATIVA_LABEL[t.canal] || t.canal}</span>
                    <span>·</span>
                    <span>{t.enviadoEm && new Date(t.enviadoEm).toLocaleString("pt-BR")}</span>
                    {t.enviadoPorNome && <><span>·</span><span>{t.enviadoPorNome}</span></>}
                    {!t.manual && <span className="px-1 rounded bg-gray-100 dark:bg-gray-800">auto</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Proposta + pagamento (PR6 + PR7) */}
        {me && (
          <PropostaSection
            lead={lead}
            pacotes={pacotes}
            podeEditar={podeEditar}
            meId={me.id}
            meNome={me.nome}
          />
        )}

        {/* BEO (PR8) — só faz sentido a partir de "sinal_recebido" */}
        {me && (lead.status === "sinal_recebido" || lead.status === "confirmado" || lead.status === "realizado") && (
          <BEOSection
            lead={lead}
            podeEditar={podeEditar}
            meId={me.id}
            meNome={me.nome}
          />
        )}

        {/* Fechamento do evento — bloco read-only + edit. Aparece a partir de
            "confirmado" (CTA pra marcar realizado) e fica como histórico em "realizado". */}
        {(lead.status === "confirmado" || lead.status === "realizado") && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              Fechamento do evento
            </div>
            {lead.fechamento ? (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm space-y-1">
                <div>
                  <strong>Faturamento bruto:</strong>{" "}
                  R$ {lead.fechamento.faturamentoBrutoSemGorjeta.toFixed(2)}
                </div>
                <div>
                  <strong>Classificação:</strong>{" "}
                  {lead.fechamento.classificacao === "inbound" ? "Inbound" : "Outbound"}
                </div>
                <div>
                  <strong>Captação ativa:</strong>{" "}
                  {lead.fechamento.captacaoAtiva.ativo
                    ? `Sim — ${lead.fechamento.captacaoAtiva.pessoaNome || "?"}`
                    : "Não"}
                </div>
                <div>
                  <strong>Negociação:</strong>{" "}
                  {lead.fechamento.negociacaoPor.pessoaNome}
                </div>
                <div>
                  <strong>Acompanhamento presencial:</strong>{" "}
                  {lead.fechamento.acompanhamentoPresencial.ativo
                    ? `Sim — ${lead.fechamento.acompanhamentoPresencial.pessoaNome || "?"}`
                    : "Não"}
                </div>
                <div className="text-[10px] text-gray-500 mt-1">
                  fechado em {new Date(lead.fechamento.fechadoEm).toLocaleString("pt-BR")}
                  {lead.fechamento.fechadoPorNome && ` por ${lead.fechamento.fechadoPorNome}`}
                </div>
                {podeEditar && (
                  lead.arquivadoEm ? (
                    <div className="pt-2 flex items-center gap-2 flex-wrap border-t border-emerald-200 dark:border-emerald-800 mt-2">
                      <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        ✓ Finalizado — no histórico{lead.arquivadoMesRef ? ` de ${lead.arquivadoMesRef.split("-").reverse().join("/")}` : ""}
                      </span>
                      <Button size="sm" variant="secondary" onClick={reabrirEvento} disabled={salvando}>↩︎ Reabrir</Button>
                    </div>
                  ) : (
                    <div className="pt-2 flex gap-2 flex-wrap">
                      <Button size="sm" onClick={finalizarEvento} disabled={salvando}>✓ Finalizar evento</Button>
                      <Button size="sm" variant="secondary" onClick={abrirFecharModal} disabled={salvando}>Editar fechamento</Button>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm">
                {lead.status === "realizado" ? (
                  <p className="text-gray-500 italic">
                    Evento marcado como realizado, mas o fechamento ainda não foi preenchido.
                  </p>
                ) : (
                  <p className="text-gray-600 dark:text-gray-400">
                    Quando o evento acontecer, preencha o fechamento pra registrar
                    faturamento e dados de comissão.
                  </p>
                )}
                {podeEditar && (
                  <div className="mt-2">
                    <Button size="sm" onClick={abrirFecharModal} disabled={salvando}>
                      ✓ Marcar realizado
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          {podeEditar && lead.status !== "perdido" && (
            <Button variant="secondary" onClick={perderLead}>Marcar como perdido</Button>
          )}
          <div className="ml-auto">
            <Button onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </div>

      {editarModalOpen && me && (
        <EditarLeadModal
          lead={lead}
          meId={me.id}
          meNome={me.nome}
          onClose={() => setEditarModalOpen(false)}
        />
      )}

      {fecharModalOpen && (
        <FecharEventoModal
          lead={lead}
          pessoasComerciaisIds={pessoasComerciaisIds}
          pessoas={pessoas}
          precoSugerido={precoSugerido}
          onClose={() => setFecharModalOpen(false)}
          onConfirm={confirmarFechamento}
        />
      )}
    </Modal>
  );
}
