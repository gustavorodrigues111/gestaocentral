import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { useAuth } from "../../core/auth/AuthContext";
import { parseYmd, pad2 } from "../../core/utils/date";
import type { LeadEvento, LeadEventoStatus, PacoteEvento } from "../../core/types";
import { PropostaSection } from "./PropostaSection";
import { BEOSection } from "./BEOSection";

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
  onClose: () => void;
};

export function LeadDrawer({ lead, pacotes, podeEditar, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [salvando, setSalvando] = useState(false);
  const [novaPergunta, setNovaPergunta] = useState("");
  const [novaResposta, setNovaResposta] = useState("");

  const pacote = lead.pacoteSugeridoId ? pacotes.find(p => p.id === lead.pacoteSugeridoId) : null;
  const data = parseYmd(lead.dataDesejada);

  async function mudarStatus(novoStatus: LeadEventoStatus, motivoPerda?: string) {
    if (!podeEditar) return;
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

  async function atribuir(eu: boolean) {
    if (!me) return;
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
      responsavelId: eu ? me.id : null,
      responsavelNome: eu ? me.nome : null,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function perguntarPraGestor() {
    if (!me || !novaPergunta.trim()) return;
    setSalvando(true);
    try {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        duvidaPraGestor: {
          pergunta: novaPergunta.trim(),
          perguntadoEm: new Date().toISOString(),
          perguntadoPor: me.id,
        },
        updatedAt: new Date().toISOString(),
      }));
      setNovaPergunta("");
    } finally {
      setSalvando(false);
    }
  }

  async function responderDuvida() {
    if (!me || !novaResposta.trim() || !lead.duvidaPraGestor) return;
    setSalvando(true);
    try {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        duvidaPraGestor: {
          ...lead.duvidaPraGestor,
          resposta: novaResposta.trim(),
          respondidoEm: new Date().toISOString(),
          respondidoPor: me.id,
        },
        updatedAt: new Date().toISOString(),
      }));
      setNovaResposta("");
    } finally {
      setSalvando(false);
    }
  }

  // Link WhatsApp já preenchido com saudação inicial
  const whatsappLink = lead.cliente.whatsapp
    ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(lead.cliente.whatsapp.replace(/\D/g, ""))}&text=${encodeURIComponent(`Oi ${lead.cliente.nome.split(" ")[0]}, tudo bem? Vi seu interesse pelo evento.`)}`
    : null;

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
          {podeEditar && lead.status !== "perdido" && (
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={voltar} disabled={salvando || lead.status === "novo"}>
                ← voltar
              </Button>
              <Button size="sm" onClick={avancar} disabled={salvando || lead.status === "realizado"}>
                avançar →
              </Button>
            </div>
          )}
        </div>

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
            <div className="flex items-center gap-2">
              <span className="font-semibold">{lead.cliente.nome}</span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                {lead.cliente.tipoPessoa}
              </span>
            </div>
            {lead.cliente.tipoPessoa === "PJ" && lead.cliente.razaoSocial && (
              <div className="text-gray-600 dark:text-gray-400">{lead.cliente.razaoSocial}{lead.cliente.cnpj && ` · CNPJ ${lead.cliente.cnpj}`}</div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-600 dark:text-gray-400">📱 {lead.cliente.whatsapp}</span>
              {whatsappLink && (
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-200"
                >
                  💬 abrir WhatsApp
                </a>
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
              {lead.slot === "almoco" ? "🌞 Almoço" : lead.slot === "jantar" ? "🌙 Jantar" : "🕒 Dia inteiro"}
              {lead.horaInicio && ` · ${lead.horaInicio}`}
            </div>
            <div>{lead.numConvidados} convidados</div>
            {lead.tipoEventoLivre && <div className="italic text-gray-600 dark:text-gray-400">{lead.tipoEventoLivre}</div>}
            {pacote && (
              <div className="text-indigo-700 dark:text-indigo-400">📦 {pacote.nome}</div>
            )}
            {lead.datasAlternativas && lead.datasAlternativas.length > 0 && (
              <div className="text-xs text-gray-500">
                Alternativas: {lead.datasAlternativas.map(d => {
                  const dd = parseYmd(d);
                  return `${pad2(dd.getDate())}/${pad2(dd.getMonth() + 1)}`;
                }).join(", ")}
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

        {lead.inspiracoesUrls && lead.inspiracoesUrls.length > 0 && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              Inspirações
            </div>
            <ul className="text-sm space-y-0.5">
              {lead.inspiracoesUrls.map((url, i) => (
                <li key={i}>
                  <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate inline-block max-w-full">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Atribuição */}
        {podeEditar && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Responsável</div>
            <div className="flex items-center gap-2">
              {lead.responsavelNome ? (
                <>
                  <span className="text-sm font-medium">{lead.responsavelNome}</span>
                  <Button size="sm" variant="secondary" onClick={() => atribuir(false)}>tirar</Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-gray-500 italic">ninguém atribuído</span>
                  <Button size="sm" variant="secondary" onClick={() => atribuir(true)}>assumir</Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Dúvida pro gestor */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            🙋 Dúvida pro gestor
          </div>
          {lead.duvidaPraGestor ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm space-y-2">
              <div>
                <strong>Pergunta:</strong> {lead.duvidaPraGestor.pergunta}
                <div className="text-[10px] text-gray-500 mt-0.5">
                  perguntada em {new Date(lead.duvidaPraGestor.perguntadoEm).toLocaleString("pt-BR")}
                </div>
              </div>
              {lead.duvidaPraGestor.resposta ? (
                <div className="border-t border-amber-200 dark:border-amber-800 pt-2">
                  <strong>Resposta:</strong> {lead.duvidaPraGestor.resposta}
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    respondida em {lead.duvidaPraGestor.respondidoEm && new Date(lead.duvidaPraGestor.respondidoEm).toLocaleString("pt-BR")}
                  </div>
                </div>
              ) : (
                podeEditar && (
                  <div className="space-y-1">
                    <textarea
                      value={novaResposta}
                      onChange={(e) => setNovaResposta(e.target.value)}
                      placeholder="Resposta..."
                      className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      rows={2}
                    />
                    <Button size="sm" onClick={responderDuvida} disabled={salvando || !novaResposta.trim()}>
                      Responder
                    </Button>
                  </div>
                )
              )}
            </div>
          ) : (
            podeEditar && (
              <div className="space-y-1">
                <textarea
                  value={novaPergunta}
                  onChange={(e) => setNovaPergunta(e.target.value)}
                  placeholder="Pergunta pro gestor (vai ficar marcada como pendente no card)..."
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  rows={2}
                />
                <Button size="sm" variant="secondary" onClick={perguntarPraGestor} disabled={salvando || !novaPergunta.trim()}>
                  🙋 Tirar dúvida
                </Button>
              </div>
            )
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
    </Modal>
  );
}
