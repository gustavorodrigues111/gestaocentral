// ════════════════════════════════════════════════════════════════════════════
//  Chat — Central de Avisos (Fase C2.1)
//
//  Futura TELA DE ABERTURA do planejamento.app. Reúne tudo que precisa da
//  atenção do usuário, vindo de várias fontes:
//
//   1. Avisos automáticos do sistema (DERIVADOS — sem coleção própria):
//        • Solicitações de ajuste de escala aguardando análise   ✅
//        • Novas mensagens do Fale com DP                         ✅
//        • Demais módulos (financeiro, operação, DP…)             ⏳ (em batches)
//   2. Conversas entre usuários (1:1 / grupos)                    ⏳ (futuro)
//   3. WhatsApp externo                                           ⏳ (futuro)
//
//  ARQUITETURA:
//  • Feed DERIVADO: avisos computados ao vivo das coleções-fonte, filtrados
//    pela PERMISSÃO do usuário (cada módulo tem uma ação "receber avisos").
//  • VINCULADO AO USUÁRIO (transversal): agrega avisos de TODOS os
//    restaurantes que a pessoa acessa. Cada card tem a tag do restaurante;
//    ao agir, troca o restaurante ativo e resolve no lugar certo.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { canAcao } from "../../core/auth/permissions";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { subscribeFaleDpNovas, tratarFaleDp } from "../faleDp/repository";
import type { EscalaSolicitacao, ScheduleStatus, FaleDpMensagem } from "../../core/types";
import {
  FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE,
} from "../../core/types";

// ─── Modelo do aviso (client-side, derivado) ────────────────────────────────

type AvisoTipo = "escala_solicitacao" | "fale_dp";

type Aviso = {
  id: string;
  tipo: AvisoTipo;
  icone: string;
  titulo: string;
  descricao: string;
  em: string;
  restauranteId: string;
  restauranteNome: string;
  cta: string;
  href?: string;                 // navegação (avisos que abrem outra tela)
  faleDp?: FaleDpMensagem;       // payload pro modal (avisos de Fale com DP)
};

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
  const { pessoa } = useAuth();
  const { restaurants, activeRestaurant, setActiveId } = useRestaurant();
  const { perfis } = useAccessProfiles();
  const navigate = useNavigate();

  const nomePorRid = useMemo(() => {
    const m: Record<string, string> = {};
    restaurants.forEach((r) => { m[r.id] = r.nome; });
    return m;
  }, [restaurants]);

  // ── Fonte 1: solicitações de ajuste de escala pendentes ──
  // Gate: quem recebe avisos de escala OU quem aprova (aprovador sempre vê).
  const ridsEscala = useMemo(
    () => restaurants
      .filter((r) =>
        canAcao(pessoa, r.id, "escala", "receberAvisos", perfis) ||
        canAcao(pessoa, r.id, "escala", "aprovarSolicitacoes", perfis))
      .map((r) => r.id),
    [restaurants, pessoa, perfis],
  );
  const ridsEscalaKey = ridsEscala.join(",");
  const [solicPorRid, setSolicPorRid] = useState<Record<string, EscalaSolicitacao[]>>({});
  useEffect(() => {
    if (ridsEscala.length === 0) { setSolicPorRid({}); return; }
    setSolicPorRid({});
    const unsubs = ridsEscala.map((rid) =>
      onSnapshot(
        query(collection(db, "escalaSolicitacoes"), where("restaurantId", "==", rid), where("status", "==", "pendente")),
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EscalaSolicitacao, "id">) }));
          setSolicPorRid((prev) => ({ ...prev, [rid]: arr }));
        },
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridsEscalaKey]);

  // ── Fonte 2: mensagens do Fale com DP (novas) ──
  // Gate: portalEmpregado.receberFaleDp.
  const ridsFaleDp = useMemo(
    () => restaurants
      .filter((r) => canAcao(pessoa, r.id, "portalEmpregado", "receberFaleDp", perfis))
      .map((r) => r.id),
    [restaurants, pessoa, perfis],
  );
  const ridsFaleDpKey = ridsFaleDp.join(",");
  const [faleDpPorRid, setFaleDpPorRid] = useState<Record<string, FaleDpMensagem[]>>({});
  useEffect(() => {
    if (ridsFaleDp.length === 0) { setFaleDpPorRid({}); return; }
    setFaleDpPorRid({});
    const unsubs = ridsFaleDp.map((rid) =>
      subscribeFaleDpNovas(rid, (msgs) => setFaleDpPorRid((prev) => ({ ...prev, [rid]: msgs }))),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridsFaleDpKey]);

  // ── Monta a lista de avisos ──
  const avisos: Aviso[] = [];

  for (const rid of Object.keys(solicPorRid)) {
    const nome = nomePorRid[rid] || "Restaurante";
    for (const s of solicPorRid[rid] || []) {
      const quem = s.empregadoNome || "Empregado";
      const ehHorario = s.tipo === "horario";
      avisos.push({
        id: `esc_${s.id}`,
        tipo: "escala_solicitacao",
        icone: "📅",
        titulo: ehHorario ? `${quem} pediu ajuste de horário` : `${quem} pediu ajuste de escala`,
        descricao: ehHorario
          ? `Acha que a jornada contratual dele não bate. "${(s.motivo || "").slice(0, 140)}"`
          : `Dia ${fmtDataCurta(s.data)}: de ${statusLabel(s.statusAtual)} → ${statusLabel(s.statusSolicitado)}. "${(s.motivo || "").slice(0, 140)}"`,
        em: s.criadoEm || "",
        restauranteId: rid,
        restauranteNome: nome,
        cta: "Analisar na Escala",
        href: `/r/${rid}/escala?aba=ajustes`,
      });
    }
  }

  for (const rid of Object.keys(faleDpPorRid)) {
    const nome = nomePorRid[rid] || "Restaurante";
    for (const m of faleDpPorRid[rid] || []) {
      const cat = FALE_DP_CATEGORIA_LABEL[m.categoria] || "Mensagem";
      const remetente = m.anonimo ? "Anônimo" : (m.autorNome || "Identificado");
      avisos.push({
        id: `fdp_${m.id}`,
        tipo: "fale_dp",
        icone: FALE_DP_CATEGORIA_ICONE[m.categoria] || "🗣️",
        titulo: `Fale com DP · ${cat}`,
        descricao: `${remetente}: "${(m.texto || "").slice(0, 140)}"`,
        em: m.criadoEm || "",
        restauranteId: rid,
        restauranteNome: nome,
        cta: "Ler mensagem",
        faleDp: m,
      });
    }
  }

  avisos.sort((a, b) => (b.em || "").localeCompare(a.em || ""));

  // ── Ação do card ──
  const [msgAberta, setMsgAberta] = useState<{ msg: FaleDpMensagem; nome: string } | null>(null);
  function abrirAviso(a: Aviso) {
    if (a.faleDp) { setMsgAberta({ msg: a.faleDp, nome: a.restauranteNome }); return; }
    if (a.href) {
      if (a.restauranteId !== activeRestaurant?.id) setActiveId(a.restauranteId);
      navigate(a.href);
    }
  }

  const multiRest = restaurants.length > 1;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          💬 Central de Avisos
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          O que precisa da sua atenção{multiRest ? " em todos os seus restaurantes" : ""}.
          {avisos.length > 0 && (
            <span className="ml-1">{avisos.length} {avisos.length === 1 ? "aviso" : "avisos"}.</span>
          )}
        </p>
      </header>

      {avisos.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
          <div className="text-4xl mb-3">✨</div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Tudo em dia</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Nenhum aviso pendente pra você por aqui.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {avisos.map((a) => (
            <button
              key={a.id}
              onClick={() => abrirAviso(a)}
              className="w-full text-left flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors p-4"
            >
              <span className="text-xl leading-none mt-0.5">{a.icone}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{a.titulo}</span>
                  {multiRest && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                      🏠 {a.restauranteNome}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{a.descricao}</div>
                <div className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 mt-2">{a.cta} →</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-6 text-center">
        Em breve: avisos de financeiro, operação e demais módulos; conversas entre usuários.
      </p>

      {msgAberta && (
        <FaleDpModal
          msg={msgAberta.msg}
          restauranteNome={msgAberta.nome}
          pessoaId={pessoa?.id || ""}
          pessoaNome={pessoa?.nome || ""}
          onClose={() => setMsgAberta(null)}
        />
      )}
    </div>
  );
}

// ─── Modal de leitura + tratar do Fale com DP ───────────────────────────────

function FaleDpModal({
  msg, restauranteNome, pessoaId, pessoaNome, onClose,
}: {
  msg: FaleDpMensagem;
  restauranteNome: string;
  pessoaId: string;
  pessoaNome: string;
  onClose: () => void;
}) {
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function tratar() {
    setSalvando(true);
    try {
      await tratarFaleDp(msg.id, pessoaId, pessoaNome, nota);
      onClose();
    } catch (e) {
      console.error(e);
      setSalvando(false);
    }
  }

  const dt = msg.criadoEm ? new Date(msg.criadoEm).toLocaleString("pt-BR") : "";

  return (
    <Modal onClose={onClose} title={`${FALE_DP_CATEGORIA_ICONE[msg.categoria]} Fale com DP · ${FALE_DP_CATEGORIA_LABEL[msg.categoria]}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
            🏠 {restauranteNome}
          </span>
          {msg.anonimo ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              🕶️ Anônimo
            </span>
          ) : (
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {msg.autorNome}{msg.cargoNome ? ` · ${msg.cargoNome}` : ""}
            </span>
          )}
          {dt && <span>· {dt}</span>}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-3 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
          {msg.texto}
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Observação ao tratar (opcional)
          </label>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            placeholder="Ex: conversado com a equipe, encaminhado pro sócio…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={tratar} disabled={salvando}>
            {salvando ? "Salvando…" : "Marcar como tratada"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
