// ════════════════════════════════════════════════════════════════════════════
//  Modal read-only que mostra o estado parcial do form do candidato. Útil
//  quando RH quer ver o que foi preenchido até agora (antes do candidato
//  submeter o form). Reusa o CampoRender com bloqueado=true.
// ════════════════════════════════════════════════════════════════════════════

import { Modal } from "../../core/ui/Modal";
import type { Admissao } from "../../core/types";
import { CampoRender, agruparPorGrupo } from "./AdmissaoPublicaPage";

type Props = {
  admissao: Admissao;
  onClose: () => void;
  // Quando provido, mostra botão "Conferir e editar" no topo (só aparece se
  // form já foi finalizado). Click chama esse callback — a Lista fecha esse
  // modal e abre o PreencherFormManualModal em modo "revisao".
  onEditar?: () => void;
};

export function VerPreenchimentoModal({ admissao, onClose, onEditar }: Props) {
  const dados = (admissao.dadosPreenchidos as Record<string, unknown>) || {};
  const gruposOrdenados = agruparPorGrupo(admissao.schemaUsado);
  const exigeDependentes = dados.tem_dependentes_legais === true;
  const vtNaoUtiliza = dados.vt_nao_utiliza === true;

  // Conta quantos campos foram preenchidos (não vazios)
  const totalCampos = admissao.schemaUsado.filter((f) => f.ativo).length;
  const preenchidos = admissao.schemaUsado.filter((f) => {
    if (!f.ativo) return false;
    const v = dados[f.id];
    if (v == null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }).length;

  return (
    <Modal
      title={`👁 Preenchimento do candidato — ${admissao.candidato.nome}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-3">
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-xs">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              📊 <strong>{preenchidos} de {totalCampos}</strong> campos preenchidos
              {admissao.preenchidoEm ? (
                <span className="ml-2 text-emerald-700 dark:text-emerald-400">
                  · ✓ form finalizado em {new Date(admissao.preenchidoEm).toLocaleString("pt-BR")}
                </span>
              ) : (
                <span className="ml-2 text-amber-700 dark:text-amber-400">
                  · preenchimento em andamento (auto-save do candidato)
                </span>
              )}
              {admissao.dadosRevisadosEm && (
                <span className="ml-2 text-sky-700 dark:text-sky-400">
                  · ✏️ revisado em {new Date(admissao.dadosRevisadosEm).toLocaleString("pt-BR")}
                  {admissao.dadosRevisadosPor?.nome ? ` por ${admissao.dadosRevisadosPor.nome}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onEditar && admissao.preenchidoEm && (
                <button
                  type="button"
                  onClick={onEditar}
                  className="text-[11px] px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  ✏️ Conferir e editar
                </button>
              )}
              <div className="text-indigo-700 dark:text-indigo-400 italic">
                somente leitura
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {gruposOrdenados.map(({ grupo, campos }) => (
            <section key={grupo} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 space-y-2">
              <h3 className="font-bold text-xs text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800 pb-1.5">
                {grupo}
              </h3>
              {campos.map((f) => {
                const v = dados[f.id];
                const vazio = v == null || v === "" || (Array.isArray(v) && v.length === 0);
                return (
                  <div key={f.id} className={vazio ? "opacity-50" : ""}>
                    <CampoRender
                      field={f}
                      value={v}
                      onChange={() => { /* read-only */ }}
                      bloqueado
                      ctx={{ exigeDependentes, vtNaoUtiliza }}
                    />
                    {vazio && (
                      <div className="text-[10px] text-gray-400 italic mt-0.5">
                        (em branco)
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}
