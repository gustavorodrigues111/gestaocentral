// ════════════════════════════════════════════════════════════════════════════
//  Chat — Central de Avisos (Fase C2.2)
//
//  Futura TELA DE ABERTURA do planejamento.app. Reúne tudo que precisa da
//  atenção do usuário, de várias fontes derivadas das coleções dos módulos,
//  filtradas pela permissão `receberAvisos` de cada módulo (transversal a
//  todos os restaurantes do usuário).
//
//  O cálculo das fontes vive em useAvisos (provider no shell) pra Sidebar e
//  esta página compartilharem o MESMO resultado — badge bate com o feed.
//  Aqui é só a renderização + o modal de leitura do Fale com DP.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { tratarFaleDp } from "../faleDp/repository";
import { useAvisosCentral, type Aviso } from "./useAvisos";
import type { FaleDpMensagem } from "../../core/types";
import { FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE } from "../../core/types";

type AbaCentral = "inbox" | "historico";

export function ChatPage() {
  const { pessoa } = useAuth();
  const { restaurants, activeRestaurant, setActiveId } = useRestaurant();
  const navigate = useNavigate();
  const { inbox, historico, marcarLido, marcarNaoLido, marcarTodosLidos } = useAvisosCentral();

  const multiRest = restaurants.length > 1;
  const [aba, setAba] = useState<AbaCentral>("inbox");
  const [msgAberta, setMsgAberta] = useState<{ msg: FaleDpMensagem; nome: string } | null>(null);

  // Histórico agrupado por categoria (módulo).
  const gruposHistorico = useMemo(() => {
    const m = new Map<string, { icone: string; itens: Aviso[] }>();
    for (const a of historico) {
      const g = m.get(a.categoria) || { icone: a.categoriaIcone, itens: [] };
      g.itens.push(a);
      m.set(a.categoria, g);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [historico]);

  function abrirAviso(a: Aviso) {
    if (a.faleDp) { setMsgAberta({ msg: a.faleDp, nome: a.restauranteNome }); return; }
    if (a.href) {
      if (a.restauranteId !== activeRestaurant?.id) setActiveId(a.restauranteId);
      navigate(a.href);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          💬 Central de Avisos
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          O que precisa da sua atenção{multiRest ? " em todos os seus restaurantes" : ""}.
          {inbox.length > 0 && (
            <span className="ml-1">{inbox.length} {inbox.length === 1 ? "aviso" : "avisos"} na caixa de entrada.</span>
          )}
        </p>
      </header>

      {/* Abas: Caixa de entrada / Histórico */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {([
          { k: "inbox" as const, label: "📥 Caixa de entrada", n: inbox.length },
          { k: "historico" as const, label: "🗂️ Histórico", n: historico.length },
        ]).map((t) => (
          <button
            key={t.k}
            onClick={() => setAba(t.k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              aba === t.k
                ? "border-indigo-600 text-indigo-700 dark:text-indigo-300"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
            {t.n > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                aba === t.k ? "bg-indigo-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              }`}>{t.n}</span>
            )}
          </button>
        ))}
      </div>

      {aba === "inbox" && (
        inbox.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
            <div className="text-4xl mb-3">✨</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Tudo em dia</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Nenhum aviso pendente pra você por aqui.</p>
          </div>
        ) : (
          <>
            <div className="flex justify-end mb-2">
              <button
                onClick={marcarTodosLidos}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                ✓ Marcar todos como lidos
              </button>
            </div>
            <div className="space-y-2.5">
              {inbox.map((a) => (
                <AvisoCard
                  key={a.id} aviso={a} multiRest={multiRest}
                  onAbrir={() => abrirAviso(a)}
                  acao={{ label: "Marcar como lido", icone: "✓", onClick: () => marcarLido(a) }}
                />
              ))}
            </div>
          </>
        )
      )}

      {aba === "historico" && (
        historico.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
            <div className="text-4xl mb-3">🗂️</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Histórico vazio</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avisos que você marcar como lidos aparecem aqui, por módulo.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {gruposHistorico.map(([categoria, g]) => (
              <div key={categoria}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-base leading-none">{g.icone}</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{categoria}</span>
                  <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">({g.itens.length})</span>
                </div>
                <div className="space-y-2.5">
                  {g.itens.map((a) => (
                    <AvisoCard
                      key={a.id} aviso={a} multiRest={multiRest} lido
                      onAbrir={() => abrirAviso(a)}
                      acao={{ label: "Voltar pra caixa de entrada", icone: "↩︎", onClick: () => marcarNaoLido(a) }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-6 text-center">
        Em breve: conversas entre usuários e WhatsApp externo.
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

// ─── Card de aviso (usado na caixa de entrada e no histórico) ───────────────
// Container é <div> (não <button>) pra poder ter um botão de ação dentro sem
// aninhar botões. Clique no corpo abre o destino; o botão de ação (lido / não
// lido) usa stopPropagation.

function AvisoCard({
  aviso: a, multiRest, lido, onAbrir, acao,
}: {
  aviso: Aviso;
  multiRest: boolean;
  lido?: boolean;
  onAbrir: () => void;
  acao: { label: string; icone: string; onClick: () => void };
}) {
  return (
    <div
      onClick={onAbrir}
      className={`w-full text-left flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-800 transition-colors p-4 cursor-pointer ${
        lido
          ? "bg-gray-50/60 dark:bg-gray-900/40 hover:bg-gray-100 dark:hover:bg-gray-800/60"
          : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60"
      }`}
    >
      <span className={`text-xl leading-none mt-0.5 ${lido ? "opacity-60" : ""}`}>{a.icone}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${lido ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>{a.titulo}</span>
          {multiRest && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
              🏠 {a.restauranteNome}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{a.descricao}</div>
        <div className={`text-[11px] font-medium mt-2 ${lido ? "text-gray-400 dark:text-gray-500" : "text-indigo-600 dark:text-indigo-400"}`}>{a.cta} →</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); acao.onClick(); }}
        title={acao.label}
        aria-label={acao.label}
        className="shrink-0 self-center w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
      >
        {acao.icone}
      </button>
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
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
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
