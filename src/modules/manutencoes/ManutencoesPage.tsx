// Cadastro mestre de Manutenções & Licenças (potabilidade, dedetização, CLCB,
// alvarás, etc). Gera tarefa no Gestor de Tarefas X dias antes do vencimento.
//
// MVP: CRUD + cálculo automático de próximo vencimento ao concluir manutenção.
// Geração de tarefa-lembrete vem na próxima fase (generator.ts).

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
  Manutencao, ManutencaoTipo, ManutencaoPeriodicidade,
} from "../../core/types";
import {
  MANUTENCAO_TIPO_LABEL, MANUTENCAO_PERIODICIDADE_LABEL,
  MANUTENCAO_PERIODICIDADE_DIAS,
} from "../../core/types";

export function ManutencoesPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [manutencoes, setManutencoes] = useState<Manutencao[]>([]);
  const [editando, setEditando] = useState<Manutencao | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    const u = onSnapshot(
      query(collection(db, "manutencoes"), orderBy("proximoVencimento")),
      snap => setManutencoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Manutencao).filter(m => !m.deletadoEm))
    );
    return () => u();
  }, []);

  if (!pessoa) return null;

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between mb-4">
        <div />
        <Button onClick={() => setCriando(true)}>+ Nova Manutenção</Button>
      </header>

      {manutencoes.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📅</div>
          <p>Nenhuma manutenção cadastrada.</p>
          <p className="text-sm mt-1">Cadastre filtros, potabilidade, dedetização, CLCB, certificados, etc — o sistema lembra do próximo vencimento.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {manutencoes.map(m => {
            const atrasada = m.proximoVencimento < hoje;
            const proxima = !atrasada && m.proximoVencimento <= addDias(hoje, 30);
            return (
              <div
                key={m.id}
                onClick={() => setEditando(m)}
                className={`p-3 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${
                  atrasada
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                    : proxima
                    ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {MANUTENCAO_TIPO_LABEL[m.tipo]}
                      {m.fornecedor && <span className="text-gray-500 dark:text-gray-400 font-normal"> · {m.fornecedor}</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {MANUTENCAO_PERIODICIDADE_LABEL[m.periodicidade]}
                      {` · próx. vencimento: ${m.proximoVencimento}`}
                      {atrasada && " · ⚠️ VENCIDA"}
                      {proxima && " · ⏰ próximo"}
                    </div>
                    {m.restaurantIds.length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        {m.restaurantIds.map(rid => restaurants.find(r => r.id === rid)?.nome || rid).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(criando || editando) && (
        <ManutencaoForm
          manutencao={editando}
          onClose={() => { setCriando(false); setEditando(null); }}
          restaurantes={restaurants.map(r => ({ id: r.id, nome: r.nome }))}
          pessoaId={pessoa.id}
        />
      )}
    </div>
  );
}

function ManutencaoForm({ manutencao, onClose, restaurantes, pessoaId }: {
  manutencao: Manutencao | null;
  onClose: () => void;
  restaurantes: { id: string; nome: string }[];
  pessoaId: string;
}) {
  const [f, setF] = useState<Partial<Manutencao>>(manutencao ? { ...manutencao } : {
    tipo: "filtros_agua",
    restaurantIds: [],
    periodicidade: "semestral",
    proximoVencimento: addDias(new Date().toISOString().slice(0, 10), 180),
    diasAntecedencia: 30,
    responsavelPadraoId: pessoaId,
    projetoId: "proj-prazos",
    subprojetoId: "sub-prazos-manutencoes",
    ativo: true,
  });

  async function salvar() {
    if (!f.tipo || !f.proximoVencimento) { alert("Tipo e próximo vencimento obrigatórios"); return; }
    const now = new Date().toISOString();
    const id = manutencao?.id || `mt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data: Manutencao = {
      id,
      tipo: f.tipo,
      fornecedor: f.fornecedor,
      descricao: f.descricao,
      restaurantIds: f.restaurantIds || [],
      periodicidade: f.periodicidade || "semestral",
      periodicidadeCustomDias: f.periodicidadeCustomDias,
      proximoVencimento: f.proximoVencimento,
      ultimaExecucao: f.ultimaExecucao,
      diasAntecedencia: f.diasAntecedencia ?? 30,
      responsavelPadraoId: f.responsavelPadraoId || pessoaId,
      responsavelPadraoNome: f.responsavelPadraoNome,
      projetoId: f.projetoId || "proj-prazos",
      subprojetoId: f.subprojetoId || "sub-prazos-manutencoes",
      pastaDrive: f.pastaDrive,
      observacoes: f.observacoes,
      ultimaGeracaoChave: f.ultimaGeracaoChave,
      ativo: f.ativo ?? true,
      deletadoEm: f.deletadoEm,
      deletadoPor: f.deletadoPor,
      criadoEm: manutencao?.criadoEm || now,
      criadoPor: manutencao?.criadoPor || pessoaId,
      atualizadoEm: now,
    };
    await setDoc(doc(db, "manutencoes", id), sanitizeForFirestore(data));
    onClose();
  }

  async function marcarRealizada() {
    if (!manutencao) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const dias = MANUTENCAO_PERIODICIDADE_DIAS[manutencao.periodicidade] || manutencao.periodicidadeCustomDias || 180;
    const novo = addDias(hoje, dias);
    setF({ ...f, ultimaExecucao: hoje, proximoVencimento: novo });
  }

  async function excluir() {
    if (!manutencao) return;
    if (!confirm(`Excluir essa manutenção? Vai pra lixeira.`)) return;
    await setDoc(doc(db, "manutencoes", manutencao.id), sanitizeForFirestore({
      ...manutencao,
      deletadoEm: new Date().toISOString(),
      deletadoPor: pessoaId,
    }));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">
          {manutencao ? "Editar Manutenção" : "Nova Manutenção"}
        </h2>
        <div className="space-y-3">
          <Field label="Tipo *">
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as ManutencaoTipo })} className="mt-input">
              {(Object.keys(MANUTENCAO_TIPO_LABEL) as ManutencaoTipo[]).map(t => (
                <option key={t} value={t}>{MANUTENCAO_TIPO_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Fornecedor">
            <input value={f.fornecedor || ""} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} className="mt-input" placeholder="Ex: OrangeBio, Passare, Heavy Cleaning" />
          </Field>
          <Field label="Empresa(s) *">
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
          <Field label="Periodicidade *">
            <select value={f.periodicidade} onChange={(e) => setF({ ...f, periodicidade: e.target.value as ManutencaoPeriodicidade })} className="mt-input">
              {(Object.keys(MANUTENCAO_PERIODICIDADE_LABEL) as ManutencaoPeriodicidade[]).map(p => (
                <option key={p} value={p}>{MANUTENCAO_PERIODICIDADE_LABEL[p]}</option>
              ))}
            </select>
          </Field>
          {f.periodicidade === "custom" && (
            <Field label="Dias customizados">
              <input type="number" min="1" value={f.periodicidadeCustomDias || ""} onChange={(e) => setF({ ...f, periodicidadeCustomDias: parseInt(e.target.value) || 0 })} className="mt-input" />
            </Field>
          )}
          <Field label="Próximo vencimento *">
            <input type="date" value={f.proximoVencimento || ""} onChange={(e) => setF({ ...f, proximoVencimento: e.target.value })} className="mt-input" />
          </Field>
          {manutencao && (
            <div className="flex gap-2 items-center">
              <Button size="sm" variant="ghost" onClick={marcarRealizada}>✓ Marcar realizada hoje</Button>
              <span className="text-xs text-gray-500 dark:text-gray-400">— recalcula próximo vencimento</span>
            </div>
          )}
          <Field label="Dias de antecedência do lembrete">
            <input type="number" min="0" max="120" value={f.diasAntecedencia ?? 30} onChange={(e) => setF({ ...f, diasAntecedencia: parseInt(e.target.value) || 0 })} className="mt-input" />
          </Field>
          <Field label="Pasta Drive (opcional)">
            <input value={f.pastaDrive || ""} onChange={(e) => setF({ ...f, pastaDrive: e.target.value })} className="mt-input" placeholder="Link do laudo/certificado" />
          </Field>
          <Field label="Observações">
            <textarea value={f.observacoes || ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} className="mt-input" rows={2} />
          </Field>
        </div>
        <style>{`.mt-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .mt-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex gap-2 justify-between mt-5">
          {manutencao ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost">Cancelar</Button>
            <Button onClick={salvar}>{manutencao ? "Salvar" : "Criar"}</Button>
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

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
