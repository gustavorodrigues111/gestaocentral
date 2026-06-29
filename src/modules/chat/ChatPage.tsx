// ════════════════════════════════════════════════════════════════════════════
//  Chat — Central de Avisos (Fase C2.0)
//
//  Esta é a futura TELA DE ABERTURA do planejamento.app. O Chat reúne, num
//  só lugar, tudo que precisa da atenção do usuário:
//
//   1. Avisos automáticos do sistema (DERIVADOS — sem coleção própria):
//        • Solicitações de ajuste de escala aguardando análise  ✅ (esta fase)
//        • Novas mensagens do Fale com DP                        ⏳ (quando existir)
//        • Comunicados internos do app                           ⏳
//   2. Conversas entre usuários (1:1 / grupos)                   ⏳ (C2.x)
//   3. WhatsApp externo (banco, contador, fornecedor)            ⏳ (C3/C4)
//
//  DECISÃO DE ARQUITETURA — feed derivado:
//  Os avisos NÃO são materializados numa coleção `notificacoes`. São
//  computados ao vivo a partir das coleções-fonte (ex: escalaSolicitacoes
//  pendentes), filtrados pela PERMISSÃO do usuário (só vê o aviso quem pode
//  tratá-lo). Isso evita backfill, mantém sempre em sincronia e não exige
//  write-hooks espalhados pelo app. Quando entrar chat pessoa-a-pessoa, ele
//  ganha sua própria coleção (`conversations`/`chatMessages`, já no repo).
//
//  Escopo: restaurante ATIVO (consistente com o resto do app, que é /r/:rid).
//  Transversalidade (avisos de todos os restaurantes do usuário num feed só)
//  fica pra quando o Chat virar de fato a home.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import type { EscalaSolicitacao, ScheduleStatus } from "../../core/types";

// ─── Modelo do aviso (client-side, derivado) ────────────────────────────────

type AvisoTipo = "escala_solicitacao";

type Aviso = {
  id: string;            // estável por item da fonte
  tipo: AvisoTipo;
  icone: string;
  titulo: string;
  descricao: string;
  em: string;            // ISO — pra ordenar (mais recente primeiro)
  href: string;          // rota pra resolver o aviso
  cta: string;           // rótulo do botão de ação
};

// Label amigável do status do dia (mesmos valores de ScheduleStatus).
const STATUS_LABEL: Record<ScheduleStatus, string> = {
  trabalho: "trabalho", folga: "folga", freela: "freela",
  comp: "folga por compensação", comp_trab: "trabalho por compensação",
  ferias: "férias", falta_j: "falta justificada", falta_i: "falta injustificada",
};
function statusLabel(s?: string | null): string {
  if (!s) return "—";
  return STATUS_LABEL[s as ScheduleStatus] || s;
}

function fmtDataCurta(ymd?: string): string {
  if (!ymd) return "";
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

export function ChatPage() {
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id || "";
  const navigate = useNavigate();
  const { can } = useCanAcao(rid);

  // Quem pode APROVAR ajustes de escala recebe os avisos de solicitação.
  const podeVerSolicEscala = can("escala", "aprovarSolicitacoes");

  // ── Fonte 1: solicitações de ajuste de escala pendentes ──
  const [solicEscala, setSolicEscala] = useState<EscalaSolicitacao[]>([]);
  useEffect(() => {
    if (!rid || !podeVerSolicEscala) { setSolicEscala([]); return; }
    const q = query(
      collection(db, "escalaSolicitacoes"),
      where("restaurantId", "==", rid),
      where("status", "==", "pendente"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSolicEscala(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EscalaSolicitacao, "id">) })));
    });
    return () => unsub();
  }, [rid, podeVerSolicEscala]);

  // ── Monta a lista de avisos a partir das fontes ──
  const avisos: Aviso[] = [];

  for (const s of solicEscala) {
    const quem = s.empregadoNome || "Empregado";
    const ehHorario = s.tipo === "horario";
    const titulo = ehHorario
      ? `${quem} pediu ajuste de horário`
      : `${quem} pediu ajuste de escala`;
    const descricao = ehHorario
      ? `Acha que a jornada contratual dele não bate. "${(s.motivo || "").slice(0, 140)}"`
      : `Dia ${fmtDataCurta(s.data)}: de ${statusLabel(s.statusAtual)} → ${statusLabel(s.statusSolicitado)}. "${(s.motivo || "").slice(0, 140)}"`;
    avisos.push({
      id: `esc_${s.id}`,
      tipo: "escala_solicitacao",
      icone: "📅",
      titulo,
      descricao,
      em: s.criadoEm || "",
      href: `/r/${rid}/escala?aba=ajustes`,
      cta: "Analisar na Escala",
    });
  }

  // Mais recentes primeiro.
  avisos.sort((a, b) => (b.em || "").localeCompare(a.em || ""));

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          💬 Central de Avisos
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          O que precisa da sua atenção em <strong>{activeRestaurant?.nome || "—"}</strong>.
          {avisos.length > 0 && (
            <span className="ml-1">
              {avisos.length} {avisos.length === 1 ? "aviso" : "avisos"}.
            </span>
          )}
        </p>
      </header>

      {avisos.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
          <div className="text-4xl mb-3">✨</div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Tudo em dia</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Nenhum aviso pendente pra você por aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {avisos.map((a) => (
            <button
              key={a.id}
              onClick={() => navigate(a.href)}
              className="w-full text-left flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors p-4"
            >
              <span className="text-xl leading-none mt-0.5">{a.icone}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{a.titulo}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{a.descricao}</div>
                <div className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 mt-2">
                  {a.cta} →
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Rodapé — sinaliza o que vem por aqui sem poluir a tela */}
      <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-6 text-center">
        Em breve: mensagens do Fale com DP, comunicados internos e conversas entre usuários.
      </p>
    </div>
  );
}
