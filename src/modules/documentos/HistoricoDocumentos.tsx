// Histórico de documentos gerados (por empresa). Re-download REGENERA o DOCX a
// partir do input salvo (documentosGerados.dados) — sempre a versão atual.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { fmtBRDateTime } from "../../core/utils/date";
import { gerarContratoDocx, baixarDocxBase64 } from "./contratoApi";

type DocGerado = {
  id: string; restaurantId: string; tipo: string; modelo: string; modeloDesc?: string;
  empregadoNome?: string; empregadoCpf?: string; empresaNome?: string; filename?: string;
  dados: Record<string, unknown>; criadoEm?: string; criadoPor?: { id: string; nome: string };
};

export function HistoricoDocumentos({ rid }: { rid: string }) {
  const [itens, setItens] = useState<DocGerado[]>([]);
  const [busca, setBusca] = useState("");
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!rid) { setItens([]); return; }
    return onSnapshot(query(collection(db, "documentosGerados"), where("restaurantId", "==", rid)),
      s => setItens(s.docs.map(d => ({ id: d.id, ...d.data() }) as DocGerado)), () => setItens([]));
  }, [rid]);

  const lista = useMemo(() => {
    const s = busca.trim().toLowerCase();
    return [...itens]
      .filter(d => !s || `${d.empregadoNome} ${d.modeloDesc} ${d.empresaNome}`.toLowerCase().includes(s))
      .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  }, [itens, busca]);

  async function rebaixar(d: DocGerado) {
    setErro(""); setBaixando(d.id);
    try {
      const j = await gerarContratoDocx(d.modelo, d.dados);
      baixarDocxBase64(j.docxBase64, d.filename || j.filename);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao gerar."); }
    finally { setBaixando(null); }
  }

  return (
    <div className="max-w-3xl">
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar por nome, modelo…"
        className="w-full mb-4 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />

      {erro && <div className="text-sm text-rose-600 mb-3">{erro}</div>}

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhum documento gerado nesta empresa ainda. Gere um em <strong>Novos contratos de trabalho</strong> e ele aparece aqui pra rebaixar.
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(d => (
            <div key={d.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{d.empregadoNome || "—"}</div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
                  {d.modeloDesc || d.modelo}{d.empresaNome ? ` · ${d.empresaNome}` : ""}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {d.criadoEm ? fmtBRDateTime(d.criadoEm) : ""}{d.criadoPor?.nome ? ` · ${d.criadoPor.nome}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => void rebaixar(d)} disabled={baixando === d.id}
                className="text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 whitespace-nowrap">
                {baixando === d.id ? "Gerando…" : "⬇ Baixar DOCX"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
