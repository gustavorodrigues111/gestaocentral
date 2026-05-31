// Cadastro mestre de Contas Fixas — pagamentos recorrentes. Gera tarefa
// no Gestor de Tarefas X dias antes do vencimento (via generator.ts em
// futura fase do trabalho — Fase 1 do próximo sprint).
//
// MVP nesta fase: CRUD de cadastro. Geração de tarefa é manual por
// enquanto (botão "Gerar lembrete agora").

import { useEffect, useState } from "react";
import {
  collection, onSnapshot, query, orderBy, setDoc, doc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import type {
  ContaFixa, ContaFixaCategoria, ContaFixaRecorrencia,
} from "../../core/types";
import {
  CONTA_FIXA_CATEGORIA_LABEL, CONTA_FIXA_RECORRENCIA_LABEL,
} from "../../core/types";

export function ContasFixasPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [contas, setContas] = useState<ContaFixa[]>([]);
  const [editando, setEditando] = useState<ContaFixa | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    const u = onSnapshot(
      query(collection(db, "contasFixas"), orderBy("nome")),
      snap => setContas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContaFixa).filter(c => !c.deletadoEm))
    );
    return () => u();
  }, []);

  if (!pessoa) return null;

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">💵 Contas Fixas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Cadastro mestre de pagamentos recorrentes — gera tarefas-lembrete no Gestor de Tarefas
          </p>
        </div>
        <Button onClick={() => setCriando(true)}>+ Nova Conta Fixa</Button>
      </header>

      {contas.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📋</div>
          <p>Nenhuma conta fixa cadastrada.</p>
          <p className="text-sm mt-1">Cadastre os pagamentos recorrentes (aluguel, sistemas, impostos) pra gerar lembretes automáticos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contas.map(c => (
            <div
              key={c.id}
              onClick={() => setEditando(c)}
              className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{c.nome}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {CONTA_FIXA_CATEGORIA_LABEL[c.categoria]}
                    {c.fornecedor && ` · ${c.fornecedor}`}
                    {` · ${CONTA_FIXA_RECORRENCIA_LABEL[c.recorrencia]}`}
                    {c.diaDoMes && ` · dia ${c.diaDoMes}`}
                    {c.valorEstimado && ` · R$ ${c.valorEstimado.toFixed(2)}`}
                  </div>
                  {c.restaurantIds.length > 0 && (
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {c.restaurantIds.map(rid => restaurants.find(r => r.id === rid)?.nome || rid).join(", ")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(criando || editando) && (
        <ContaFixaForm
          conta={editando}
          onClose={() => { setCriando(false); setEditando(null); }}
          restaurantes={restaurants.map(r => ({ id: r.id, nome: r.nome }))}
          pessoaId={pessoa.id}
        />
      )}
    </div>
  );
}

function ContaFixaForm({ conta, onClose, restaurantes, pessoaId }: {
  conta: ContaFixa | null;
  onClose: () => void;
  restaurantes: { id: string; nome: string }[];
  pessoaId: string;
}) {
  const [f, setF] = useState<Partial<ContaFixa>>(conta ? { ...conta } : {
    nome: "",
    categoria: "outros" as ContaFixaCategoria,
    restaurantIds: [],
    recorrencia: "mensal" as ContaFixaRecorrencia,
    diasAntecedencia: 3,
    responsavelPadraoId: pessoaId,
    projetoId: "proj-financ-rot",
    subprojetoId: "sub-financ-contas",
    ativo: true,
  });

  async function salvar() {
    if (!f.nome) { alert("Nome obrigatório"); return; }
    const now = new Date().toISOString();
    const id = conta?.id || `cf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data: ContaFixa = {
      id,
      nome: f.nome,
      fornecedor: f.fornecedor,
      categoria: f.categoria || "outros",
      restaurantIds: f.restaurantIds || [],
      valorEstimado: f.valorEstimado,
      pix: f.pix,
      banco: f.banco,
      titular: f.titular,
      observacoes: f.observacoes,
      recorrencia: f.recorrencia || "mensal",
      diaDoMes: f.diaDoMes,
      diaDaSemana: f.diaDaSemana,
      mesDoAno: f.mesDoAno,
      diasAntecedencia: f.diasAntecedencia ?? 3,
      responsavelPadraoId: f.responsavelPadraoId || pessoaId,
      responsavelPadraoNome: f.responsavelPadraoNome,
      projetoId: f.projetoId || "proj-financ-rot",
      subprojetoId: f.subprojetoId || "sub-financ-contas",
      ultimaGeracaoChave: f.ultimaGeracaoChave,
      ativo: f.ativo ?? true,
      deletadoEm: f.deletadoEm,
      deletadoPor: f.deletadoPor,
      criadoEm: conta?.criadoEm || now,
      criadoPor: conta?.criadoPor || pessoaId,
      atualizadoEm: now,
    };
    await setDoc(doc(db, "contasFixas", id), sanitizeForFirestore(data));
    onClose();
  }

  async function excluir() {
    if (!conta) return;
    if (!confirm(`Excluir "${conta.nome}"? Isso vai pra lixeira (não é exclusão definitiva).`)) return;
    await setDoc(doc(db, "contasFixas", conta.id), sanitizeForFirestore({
      ...conta,
      deletadoEm: new Date().toISOString(),
      deletadoPor: pessoaId,
    }));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">
          {conta ? "Editar Conta Fixa" : "Nova Conta Fixa"}
        </h2>
        <div className="space-y-3">
          <Field label="Nome *">
            <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} className="cf-input" autoFocus placeholder="Ex: Aluguel Imóvel Harmonia,322" />
          </Field>
          <Field label="Fornecedor">
            <input value={f.fornecedor || ""} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} className="cf-input" placeholder="Ex: Grenna Imóveis" />
          </Field>
          <Field label="Categoria *">
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as ContaFixaCategoria })} className="cf-input">
              {(Object.keys(CONTA_FIXA_CATEGORIA_LABEL) as ContaFixaCategoria[]).map(c => (
                <option key={c} value={c}>{CONTA_FIXA_CATEGORIA_LABEL[c]}</option>
              ))}
            </select>
          </Field>
          <Field label="Empresa(s) que paga(m) *">
            <div className="flex flex-wrap gap-2">
              {restaurantes.map(r => (
                <label key={r.id} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={(f.restaurantIds || []).includes(r.id)}
                    onChange={(e) => {
                      const cur = f.restaurantIds || [];
                      setF({ ...f, restaurantIds: e.target.checked ? [...cur, r.id] : cur.filter(x => x !== r.id) });
                    }}
                  />
                  {r.nome}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Valor estimado (R$)">
            <input type="number" step="0.01" value={f.valorEstimado || ""} onChange={(e) => setF({ ...f, valorEstimado: e.target.value ? parseFloat(e.target.value) : undefined })} className="cf-input" />
          </Field>
          <Field label="Recorrência *">
            <select value={f.recorrencia} onChange={(e) => setF({ ...f, recorrencia: e.target.value as ContaFixaRecorrencia })} className="cf-input">
              {(Object.keys(CONTA_FIXA_RECORRENCIA_LABEL) as ContaFixaRecorrencia[]).map(r => (
                <option key={r} value={r}>{CONTA_FIXA_RECORRENCIA_LABEL[r]}</option>
              ))}
            </select>
          </Field>
          {(f.recorrencia === "mensal" || f.recorrencia === "anual" || f.recorrencia === "trimestral" || f.recorrencia === "semestral") && (
            <Field label="Dia do mês (1-31)">
              <input type="number" min="1" max="31" value={f.diaDoMes || ""} onChange={(e) => setF({ ...f, diaDoMes: e.target.value ? parseInt(e.target.value) : undefined })} className="cf-input" />
            </Field>
          )}
          {f.recorrencia === "semanal" && (
            <Field label="Dia da semana">
              <select value={f.diaDaSemana ?? 1} onChange={(e) => setF({ ...f, diaDaSemana: parseInt(e.target.value) })} className="cf-input">
                <option value="0">Domingo</option><option value="1">Segunda</option><option value="2">Terça</option>
                <option value="3">Quarta</option><option value="4">Quinta</option><option value="5">Sexta</option><option value="6">Sábado</option>
              </select>
            </Field>
          )}
          <Field label="Dias de antecedência do lembrete">
            <input type="number" min="0" max="60" value={f.diasAntecedencia ?? 3} onChange={(e) => setF({ ...f, diasAntecedencia: parseInt(e.target.value) || 0 })} className="cf-input" />
          </Field>
          <Field label="Chave PIX (opcional)">
            <input value={f.pix || ""} onChange={(e) => setF({ ...f, pix: e.target.value })} className="cf-input" />
          </Field>
          <Field label="Banco (opcional)">
            <input value={f.banco || ""} onChange={(e) => setF({ ...f, banco: e.target.value })} className="cf-input" placeholder="Ex: Nubank" />
          </Field>
          <Field label="Titular (opcional)">
            <input value={f.titular || ""} onChange={(e) => setF({ ...f, titular: e.target.value })} className="cf-input" />
          </Field>
          <Field label="Observações (vão pra nota da tarefa)">
            <textarea value={f.observacoes || ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} className="cf-input" rows={3} />
          </Field>
        </div>
        <style>{`.cf-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .cf-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex gap-2 justify-between mt-5">
          {conta ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost">Cancelar</Button>
            <Button onClick={salvar}>{conta ? "Salvar" : "Criar"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}
