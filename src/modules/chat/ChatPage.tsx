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

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { tratarFaleDp } from "../faleDp/repository";
import { useAvisos, type Aviso } from "./useAvisos";
import type { FaleDpMensagem } from "../../core/types";
import { FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE } from "../../core/types";

export function ChatPage() {
  const { pessoa } = useAuth();
  const { restaurants, activeRestaurant, setActiveId } = useRestaurant();
  const navigate = useNavigate();
  const avisos = useAvisos();

  const multiRest = restaurants.length > 1;
  const [msgAberta, setMsgAberta] = useState<{ msg: FaleDpMensagem; nome: string } | null>(null);

  function abrirAviso(a: Aviso) {
    if (a.faleDp) { setMsgAberta({ msg: a.faleDp, nome: a.restauranteNome }); return; }
    if (a.href) {
      if (a.restauranteId !== activeRestaurant?.id) setActiveId(a.restauranteId);
      navigate(a.href);
    }
  }

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
