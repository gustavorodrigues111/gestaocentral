// Configurações do módulo — gestão dos TEMPLATES de checklist. Dá pra ter
// vários (ex.: um por unidade/estação); a nova avaliação usa o único ativo ou
// pergunta qual. Criar (em branco ou da lista-base), editar, duplicar, excluir,
// ativar/desativar.
import { useState } from "react";
import { Button } from "../../core/ui/Button";
import type { SegurancaModelo } from "../../core/types";
import { criarModeloVazio, criarModeloSemente, duplicarModelo, excluirModelo, salvarModelo } from "./repository";

export function ConfigChecklists({ rid, modelos, autorId, onEditar, onClose }: {
  rid: string;
  modelos: SegurancaModelo[];
  autorId?: string;
  onEditar: (id: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  async function novoEmBranco() {
    const nome = prompt("Nome do novo checklist:", "Novo checklist");
    if (nome === null) return;
    setBusy(true); setErro("");
    try { const id = await criarModeloVazio(rid, nome, autorId); onEditar(id); }
    catch (e) { setErro(msg(e)); } finally { setBusy(false); }
  }
  async function novoDaBase() {
    const nome = prompt("Nome do checklist (a partir da lista-base):", "Avaliação de boas práticas");
    if (nome === null) return;
    setBusy(true); setErro("");
    try { const id = await criarModeloSemente(rid, autorId, nome); onEditar(id); }
    catch (e) { setErro(msg(e)); } finally { setBusy(false); }
  }
  async function duplicar(m: SegurancaModelo) {
    setBusy(true); setErro("");
    try { await duplicarModelo(m, autorId); } catch (e) { setErro(msg(e)); } finally { setBusy(false); }
  }
  async function excluir(m: SegurancaModelo) {
    if (!confirm(`Excluir o template "${m.nome}"?\n\nAvaliações já feitas com ele NÃO são afetadas (guardam uma cópia própria).`)) return;
    setBusy(true); setErro("");
    try { await excluirModelo(m.id); } catch (e) { setErro(msg(e)); } finally { setBusy(false); }
  }
  async function toggleAtivo(m: SegurancaModelo) {
    try { await salvarModelo({ ...m, ativo: !(m.ativo !== false) }); } catch (e) { setErro(msg(e)); }
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-sm inline-flex items-center gap-1">
          <span className="text-base leading-none">←</span> Voltar
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Configurações · Checklists</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Templates de checklist. Uma nova avaliação usa o ativo — se houver mais de um, o app pergunta qual.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void novoEmBranco()}>+ Em branco</Button>
          <Button size="sm" disabled={busy} onClick={() => void novoDaBase()}>+ Da lista-base</Button>
        </div>
      </div>

      {erro && <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">{erro}</div>}

      {modelos.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nenhum template ainda. Crie um <b>em branco</b> ou já a partir da <b>lista-base</b> (todos os itens da nutricionista).
        </div>
      )}

      <div className="space-y-2">
        {modelos.map((m) => {
          const ativo = m.ativo !== false;
          return (
            <div key={m.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{m.nome}</div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400">{m.itens.length} {m.itens.length === 1 ? "item" : "itens"} · {m.blocos.length} blocos</div>
              </div>
              <button type="button" onClick={() => void toggleAtivo(m)} title={ativo ? "Ativo (aparece em nova avaliação)" : "Inativo"}
                className={`shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-full ${ativo ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                {ativo ? "ativo" : "inativo"}
              </button>
              <Button size="sm" variant="secondary" onClick={() => onEditar(m.id)}>Editar</Button>
              <button onClick={() => void duplicar(m)} disabled={busy} title="Duplicar" className="shrink-0 text-gray-400 hover:text-indigo-600 text-sm px-1">⧉</button>
              <button onClick={() => void excluir(m)} disabled={busy} title="Excluir" className="shrink-0 text-gray-300 hover:text-rose-500 text-sm px-1">🗑</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Falha na operação.");
