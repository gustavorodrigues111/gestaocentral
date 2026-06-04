// ════════════════════════════════════════════════════════════════════════════
//  Modal de importação CSV — cria várias ferramentas de uma vez.
//
//  Fluxo:
//   1. Usuário baixa o template (botão "↓ Template CSV")
//   2. Preenche no Excel/Google Sheets
//   3. Cola o CSV (ou faz upload do .csv)
//   4. Preview valida cada linha — ok/erro
//   5. Confirma → cria tudo (idempotente por nome+restaurantId)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { parseToolsCsv, gerarTemplateCsv, type LinhaImportada } from "./importCsv";
import { createTool } from "./repository";

type Props = {
  rid: string;
  pessoaId: string;
  onClose: () => void;
};

export function ImportarCsvModal({ rid, pessoaId, onClose }: Props) {
  const [texto, setTexto] = useState("");
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ criadas: number; erros: number } | null>(null);

  const linhas = useMemo<LinhaImportada[]>(() => {
    if (!texto.trim()) return [];
    try { return parseToolsCsv(texto); } catch { return []; }
  }, [texto]);

  const linhasOk = linhas.filter(l => l.ok);
  const linhasErr = linhas.filter(l => !l.ok);

  function baixarTemplate() {
    const csv = gerarTemplateCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ferramentas-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    const text = await file.text();
    setTexto(text);
  }

  async function importar() {
    if (linhasOk.length === 0) return;
    if (!confirm(`Criar ${linhasOk.length} ferramenta(s)? Linhas com erro serão ignoradas.`)) return;
    setImportando(true);
    let criadas = 0;
    let erros = 0;
    for (const l of linhasOk) {
      if (!l.dados) continue;
      try {
        await createTool(rid, { ...l.dados, usuariosAutorizados: [], status: "ativo" }, pessoaId);
        criadas++;
      } catch (e) {
        erros++;
        console.warn(`[csv] erro linha ${l.linha}:`, e);
      }
    }
    setResultado({ criadas, erros });
    setImportando(false);
  }

  return (
    <Modal title="📤 Importar ferramentas via CSV" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        {!resultado ? (
          <>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-900 dark:text-blue-200">
              <p className="font-semibold mb-1">Formato esperado</p>
              <p>Colunas obrigatórias: <code className="font-mono">nome</code>, <code className="font-mono">necessidade</code>, <code className="font-mono">categoria</code>, <code className="font-mono">metodoAcesso</code></p>
              <p className="mt-1">
                <strong>Categoria:</strong> delivery, fornecedores, operacao, financeiro, rh, infra, identidade, restrito
              </p>
              <p>
                <strong>metodoAcesso:</strong> login_proprio, senha_compartilhada, senha_oculta, fisico, restrito, delegado_sso, dormente
              </p>
              <p className="mt-1">
                <strong>Tags:</strong> separadas por <code className="font-mono">|</code> (pipe). Ex: <code className="font-mono">motoboy|entrega|chamar</code>
              </p>
              <p className="mt-1 text-blue-700 dark:text-blue-300">
                ⚠ Senha NÃO entra no CSV — só link do Bitwarden. Atribuição de usuários é feita depois manualmente.
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={baixarTemplate}>
                ↓ Baixar template CSV
              </Button>
              <label className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                📁 Subir arquivo .csv
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">
                Ou cole o conteúdo do CSV aqui:
              </label>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                placeholder="nome,emoji,necessidade,tags,categoria,metodoAcesso,..."
              />
            </div>

            {linhas.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-xs">
                <p className="font-semibold mb-2">
                  Preview: <span className="text-emerald-700 dark:text-emerald-400">{linhasOk.length} ok</span>
                  {linhasErr.length > 0 && <> · <span className="text-rose-700 dark:text-rose-400">{linhasErr.length} com erro</span></>}
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {linhas.map((l, i) => (
                    <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded ${
                      l.ok ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-rose-50 dark:bg-rose-900/20"
                    }`}>
                      <span className="text-gray-500 shrink-0">L{l.linha}</span>
                      {l.ok && l.dados ? (
                        <span className="flex-1">
                          {l.dados.icone} {l.dados.nome} — <em className="text-gray-500">{l.dados.necessidade}</em>
                        </span>
                      ) : (
                        <span className="flex-1 text-rose-700 dark:text-rose-300">
                          {l.erros.join("; ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={importar} disabled={linhasOk.length === 0 || importando}>
                {importando ? "Importando..." : `Importar ${linhasOk.length} ferramenta(s)`}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <div className="text-5xl mb-3">✓</div>
            <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">Importação concluída</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {resultado.criadas} criada(s){resultado.erros > 0 ? `, ${resultado.erros} com erro` : ""}.
            </p>
            <div className="mt-4">
              <Button onClick={onClose}>Fechar</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
