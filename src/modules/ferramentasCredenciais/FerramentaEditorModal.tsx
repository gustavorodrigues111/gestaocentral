// ════════════════════════════════════════════════════════════════════════════
//  Modal de criação/edição de Ferramenta.
//
//  Campos seguem o briefing. Picker de usuários autorizados = multi-select
//  simples (lista de checkboxes filtravel por nome).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  FERRAMENTA_CATEGORIA_LABEL,
  FERRAMENTA_METODO_LABEL,
} from "../../core/types";
import type {
  Tool,
  FerramentaCategoria,
  FerramentaMetodoAcesso,
  Pessoa,
} from "../../core/types";
import { createTool, updateTool } from "./repository";

const CATEGORIAS: FerramentaCategoria[] = [
  "delivery", "fornecedores", "operacao", "financeiro", "rh", "infra", "identidade", "restrito",
];
const METODOS: FerramentaMetodoAcesso[] = [
  "login_proprio", "senha_compartilhada", "senha_oculta", "fisico", "restrito", "delegado_sso", "dormente",
];

type Props = {
  tool: Tool | null;       // null = nova
  rid: string;
  pessoaId: string;
  pessoas: Pessoa[];
  onClose: () => void;
};

export function FerramentaEditorModal({ tool, rid, pessoaId, pessoas, onClose }: Props) {
  const isNova = !tool;
  const [nome, setNome] = useState(tool?.nome || "");
  const [icone, setIcone] = useState(tool?.icone || "");
  const [necessidade, setNecessidade] = useState(tool?.necessidade || "");
  const [tagsStr, setTagsStr] = useState((tool?.tags || []).join(", "));
  const [categoria, setCategoria] = useState<FerramentaCategoria>(tool?.categoria || "operacao");
  const [metodoAcesso, setMetodoAcesso] = useState<FerramentaMetodoAcesso>(tool?.metodoAcesso || "login_proprio");
  const [bitwardenItemUrl, setBitwardenItemUrl] = useState(tool?.bitwardenItemUrl || "");
  const [bitwardenCollection, setBitwardenCollection] = useState(tool?.bitwardenCollection || "");
  const [localFisico, setLocalFisico] = useState(tool?.localFisico || "");
  const [instrucoesAcesso, setInstrucoesAcesso] = useState(tool?.instrucoesAcesso || "");
  const [responsavel, setResponsavel] = useState(tool?.responsavel || "");
  const [status, setStatus] = useState<"ativo" | "dormente">(tool?.status || "ativo");
  const [usuariosAutorizados, setUsuariosAutorizados] = useState<string[]>(tool?.usuariosAutorizados || []);
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const pessoasFiltradas = useMemo(() => {
    const t = buscaPessoa.toLowerCase().trim();
    if (!t) return pessoas;
    return pessoas.filter(p => p.nome.toLowerCase().includes(t));
  }, [pessoas, buscaPessoa]);

  function togglePessoa(pid: string) {
    setUsuariosAutorizados(prev =>
      prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid],
    );
  }

  async function salvar() {
    setErr("");
    if (!nome.trim()) { setErr("Nome é obrigatório."); return; }
    if (!necessidade.trim()) { setErr("Necessidade é obrigatória."); return; }
    setSaving(true);
    try {
      const tags = tagsStr.split(",").map(s => s.trim()).filter(Boolean);
      const data = {
        nome: nome.trim(),
        icone: icone.trim() || "🔧",
        necessidade: necessidade.trim(),
        tags,
        categoria,
        metodoAcesso,
        bitwardenItemUrl: bitwardenItemUrl.trim() || null,
        bitwardenCollection: bitwardenCollection.trim() || null,
        localFisico: localFisico.trim() || null,
        instrucoesAcesso: instrucoesAcesso.trim() || null,
        responsavel: responsavel.trim() || null,
        status,
        usuariosAutorizados,
      };
      if (isNova) {
        await createTool(rid, data, pessoaId);
      } else if (tool) {
        await updateTool(tool.id, data, pessoaId);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const selectCls = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  const labelCls = "text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1";

  return (
    <Modal title={isNova ? "Nova ferramenta" : `Editar ${tool?.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="iFood"
        />
        <div>
          <label className={labelCls}>Emoji</label>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl shrink-0">
              {icone || "🔧"}
            </div>
            <input
              value={icone}
              onChange={(e) => setIcone(e.target.value)}
              maxLength={4}
              placeholder="📱"
              className={selectCls + " flex-1"}
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {[
              "📱","🛒","🍔","🍷","🍺","🍱","🚗","🛵","✈️","🏠","🔑","🔒",
              "📋","📅","✅","📝","📊","💰","💸","💳","🧾","📨","📧","📞",
              "🛠️","🔧","⚙️","💡","🎯","🏛️","🏦","📦","🧰","🍽️","🗂️","📍",
            ].map(e => (
              <button
                key={e}
                type="button"
                onClick={() => setIcone(e)}
                className="text-xl w-9 h-9 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                title={e}
              >{e}</button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Necessidade — "pra que serve" *</label>
          <textarea
            value={necessidade}
            onChange={(e) => setNecessidade(e.target.value)}
            rows={2}
            className={selectCls}
            placeholder="Ex: Receber e gerenciar pedidos de delivery"
          />
        </div>

        <div>
          <label className={labelCls}>Tags (separadas por vírgula) — alimentam a busca</label>
          <input
            value={tagsStr}
            onChange={(e) => setTagsStr(e.target.value)}
            className={selectCls}
            placeholder="ifood, pedido, delivery, entrega"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Categoria *</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value as FerramentaCategoria)} className={selectCls}>
              {CATEGORIAS.map(c => <option key={c} value={c}>{FERRAMENTA_CATEGORIA_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Método de acesso *</label>
            <select value={metodoAcesso} onChange={(e) => setMetodoAcesso(e.target.value as FerramentaMetodoAcesso)} className={selectCls}>
              {METODOS.map(m => <option key={m} value={m}>{FERRAMENTA_METODO_LABEL[m]}</option>)}
            </select>
          </div>
        </div>

        {/* Campos condicionais por método */}
        {(metodoAcesso === "senha_compartilhada" || metodoAcesso === "senha_oculta") && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="URL do item no Bitwarden"
              value={bitwardenItemUrl}
              onChange={(e) => setBitwardenItemUrl(e.target.value)}
              placeholder="https://vault.bitwarden.com/#/vault?itemId=..."
            />
            <Input
              label="Collection (referência)"
              value={bitwardenCollection}
              onChange={(e) => setBitwardenCollection(e.target.value)}
              placeholder="Operação – Lobozó"
            />
          </div>
        )}
        {metodoAcesso === "fisico" && (
          <Input
            label="Local físico"
            value={localFisico}
            onChange={(e) => setLocalFisico(e.target.value)}
            placeholder="Cadeado · gaveta do caixa · combinação no Bitwarden"
          />
        )}
        {metodoAcesso === "login_proprio" && (
          <div>
            <label className={labelCls}>Instruções de acesso</label>
            <textarea
              value={instrucoesAcesso}
              onChange={(e) => setInstrucoesAcesso(e.target.value)}
              rows={2}
              className={selectCls}
              placeholder="Como solicitar o login pra esta ferramenta"
            />
          </div>
        )}
        {metodoAcesso === "restrito" && (
          <div>
            <label className={labelCls}>Responsável (pessoaId ou nome)</label>
            <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className={selectCls}>
              <option value="">— selecione —</option>
              {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className={labelCls}>Status</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStatus("ativo")}
              className={`text-xs px-3 py-1.5 rounded border ${status === "ativo" ? "bg-emerald-600 text-white border-emerald-600" : "border-gray-300 dark:border-gray-700"}`}
            >Ativo</button>
            <button
              type="button"
              onClick={() => setStatus("dormente")}
              className={`text-xs px-3 py-1.5 rounded border ${status === "dormente" ? "bg-gray-500 text-white border-gray-500" : "border-gray-300 dark:border-gray-700"}`}
            >Dormente</button>
          </div>
        </div>

        {/* Picker de usuários autorizados */}
        <div>
          <label className={labelCls}>
            Quem tem acesso ({usuariosAutorizados.length} selecionado{usuariosAutorizados.length !== 1 ? "s" : ""})
          </label>
          <input
            value={buscaPessoa}
            onChange={(e) => setBuscaPessoa(e.target.value)}
            placeholder="🔍 Filtrar pessoas..."
            className={selectCls}
          />
          <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
            {pessoasFiltradas.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center text-gray-500">Nenhuma pessoa encontrada.</div>
            ) : pessoasFiltradas.map(p => {
              const checked = usuariosAutorizados.includes(p.id);
              return (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePessoa(p.id)}
                    className="cursor-pointer"
                  />
                  <span className={checked ? "font-medium" : ""}>{p.nome}</span>
                </label>
              );
            })}
          </div>
        </div>

        {err && <div className="text-xs text-rose-600 dark:text-rose-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNova ? "Criar" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
