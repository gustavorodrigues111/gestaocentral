// Produtos de um equipamento: o jeito de "colocar um produto na geladeira".
// Busca primeiro entre os produtos que já existem; se faltar o prazo para a
// conservação do equipamento, informa ali mesmo. Cadastrar novo é o último
// recurso, oferecido só quando a busca não encontra nada igual.
import { useState } from "react";
import { X, Plus } from "lucide-react";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import type { LocalEstoque } from "../../core/types";
import { compativel, nomeCompleto } from "./compatibilidade";
import { mesmoNome, normalizarNome, similaridade } from "./similaridade";
import type { ProdutoEtiqueta } from "./EstoqueValidadePage";

export function VinculosModal({ local, locais, produtos, metodoLabel, onClose, onNovoProduto }: {
  local: LocalEstoque; locais: LocalEstoque[]; produtos: ProdutoEtiqueta[]; metodoLabel: string;
  onClose: () => void; onNovoProduto: (nome: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [diasNovo, setDiasNovo] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const metodo = local.metodoConservacao || "";

  const vinculados = produtos.filter((p) => (p.locais || []).includes(local.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  const termo = normalizarNome(busca).join(" ");
  const resultados = termo.length < 2 ? [] : produtos
    .filter((p) => p.ativo && !(p.locais || []).includes(local.id))
    .map((p) => ({ p, s: normalizarNome(p.nome).join(" ").includes(termo) ? 1 : similaridade(busca, p.nome) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s || a.p.nome.localeCompare(b.p.nome))
    .slice(0, 8)
    .map((x) => x.p);
  const existeIgual = produtos.some((p) => mesmoNome(p.nome, busca));

  async function vincular(p: ProdutoEtiqueta) {
    setErro("");
    const precisaPrazo = !compativel(p, local);
    const dias = parseInt((diasNovo[p.id] || "").replace(/\D/g, ""), 10);
    if (precisaPrazo && !(dias > 0)) { setErro(`Informe o prazo de ${metodoLabel} para ${p.nome}.`); return; }
    setSalvando(p.id);
    try {
      await updateDoc(doc(db, "produtosEtiqueta", p.id), {
        locais: arrayUnion(local.id),
        ...(precisaPrazo ? { [`conservacao.${metodo}`]: dias } : {}),
      });
      setBusca("");
    } catch { setErro("Não consegui salvar. Tente de novo."); }
    finally { setSalvando(null); }
  }

  async function desvincular(p: ProdutoEtiqueta) {
    setSalvando(p.id);
    try { await updateDoc(doc(db, "produtosEtiqueta", p.id), { locais: arrayRemove(local.id) }); }
    catch { setErro("Não consegui salvar. Tente de novo."); }
    finally { setSalvando(null); }
  }

  return (
    <Modal title={nomeCompleto(local, locais)} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-gray-500 -mt-2">{metodoLabel || "Sem conservação definida"} · {vinculados.length} produto{vinculados.length === 1 ? "" : "s"}</p>

        <div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Adicionar produto: digite o nome" autoFocus
            className="w-full h-11 px-3 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          {erro && <p className="text-xs text-rose-600 mt-1.5">{erro}</p>}
          {termo.length >= 2 && (
            <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
              {resultados.map((p) => {
                const ok = compativel(p, local);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{p.nome}</div>
                      <div className={`text-xs ${ok ? "text-gray-400" : "text-amber-600"}`}>{ok ? `${p.conservacao[metodo]} dias` : `Sem prazo de ${metodoLabel}`}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!ok && (
                        <input value={diasNovo[p.id] || ""} onChange={(e) => setDiasNovo({ ...diasNovo, [p.id]: e.target.value })} placeholder="dias" inputMode="numeric"
                          className="w-14 h-9 px-2 text-sm text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                      )}
                      <button type="button" disabled={salvando === p.id} onClick={() => void vincular(p)}
                        className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50">Adicionar</button>
                    </div>
                  </div>
                );
              })}
              {resultados.length === 0 && <p className="py-2.5 text-sm text-gray-400">Nenhum produto cadastrado com esse nome.</p>}
              {!existeIgual && (
                <button type="button" onClick={() => onNovoProduto(busca.trim())}
                  className="w-full py-3 text-left text-sm text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1.5">
                  <Plus size={15} /> Cadastrar "{busca.trim()}" como produto novo
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Neste equipamento</div>
          {vinculados.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">Nenhum produto ainda.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {vinculados.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{p.nome}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">{p.conservacao?.[metodo] != null ? `${p.conservacao[metodo]} dias` : "sem prazo"}</span>
                    <button type="button" disabled={salvando === p.id} onClick={() => void desvincular(p)} title="Tirar deste equipamento"
                      className="h-8 w-8 rounded-lg text-gray-300 hover:text-rose-600 inline-flex items-center justify-center"><X size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
