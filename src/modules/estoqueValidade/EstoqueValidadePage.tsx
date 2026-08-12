// ════════════════════════════════════════════════════════════════════════════
//  Gestão de Estoques e Validades
//
//  Dois tipos de etiqueta: (A) Produção/Validade na cozinha; (B) Estoque/Lote —
//  1 etiqueta FIXA por produto + lotes virtuais, baixa por QR com giro PVPS/PEPS.
//  Este é o 1º corte: cadastro dos LOCAIS de estoque (geladeiras, câmaras,
//  prateleiras, seco…) por loja — onde a etiqueta fixa mora e de onde sai a
//  instrução de arrumação. Produtos/Entrada/Baixa/Validades entram nas próximas.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { type LocalEstoque, type LocalEstoqueTipo, LOCAL_ESTOQUE_TIPO_LABEL } from "../../core/types";

const TIPOS = Object.keys(LOCAL_ESTOQUE_TIPO_LABEL) as LocalEstoqueTipo[];
const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

export function EstoqueValidadePage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurante = restaurants.find((r) => r.id === rid) || null;
  const { can, loading: permLoading } = useCanAcao(rid);
  const podeVer = can("estoqueValidade", "ver");
  const podeEditar = can("estoqueValidade", "editar");

  const [aba, setAba] = useState<"locais" | "produtos" | "entrada" | "baixa" | "validades">("locais");
  const [locais, setLocais] = useState<LocalEstoque[]>([]);
  const [modal, setModal] = useState<{ local: LocalEstoque | null } | null>(null);

  useEffect(() => {
    if (!rid) return;
    const un = onSnapshot(
      query(collection(db, "locaisEstoque"), where("restaurantId", "==", rid)),
      (s) => setLocais(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LocalEstoque)),
      () => setLocais([]),
    );
    return () => un();
  }, [rid]);

  // Agrupa por tipo, ordenado.
  const porTipo = useMemo(() => {
    const m = new Map<LocalEstoqueTipo, LocalEstoque[]>();
    for (const l of locais.slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome))) {
      const arr = m.get(l.tipo) || []; arr.push(l); m.set(l.tipo, arr);
    }
    return m;
  }, [locais]);

  async function salvarLocal(l: Omit<LocalEstoque, "id" | "criadoEm"> & { id?: string }) {
    if (l.id) {
      await updateDoc(doc(db, "locaisEstoque", l.id), { nome: l.nome, tipo: l.tipo, paiId: l.paiId ?? null, ativo: l.ativo });
    } else {
      await addDoc(collection(db, "locaisEstoque"), {
        restaurantId: rid, nome: l.nome, tipo: l.tipo, paiId: l.paiId ?? null, ativo: l.ativo,
        ordem: locais.length, criadoEm: new Date().toISOString(), criadoPor: me?.id || null,
      });
    }
    setModal(null);
  }
  async function excluirLocal(l: LocalEstoque) {
    if (!confirm(`Excluir o local "${l.nome}"?`)) return;
    await deleteDoc(doc(db, "locaisEstoque", l.id));
  }

  if (permLoading) return null;
  if (!podeVer) return <div className="p-6 text-sm text-gray-500">Você não tem acesso à Gestão de Estoques e Validades.</div>;

  const ABAS: Array<[typeof aba, string]> = [
    ["locais", "📍 Locais"], ["produtos", "🏷️ Produtos"], ["entrada", "📥 Entrada"], ["baixa", "📤 Baixa"], ["validades", "⏰ Validades"],
  ];

  return (
    <div className="max-w-4xl">
      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {ABAS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAba(k)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${aba === k ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
            {l}
          </button>
        ))}
      </div>

      {aba === "locais" ? (
        <div>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-xs text-gray-500 max-w-lg">
              Onde os produtos ficam estocados{restaurante ? ` no ${restaurante.nome}` : ""} — geladeiras, câmaras, prateleiras, seco… É aqui que a etiqueta fixa mora e de onde sai a instrução de arrumação PVPS/PEPS.
            </p>
            {podeEditar && <Button size="sm" onClick={() => setModal({ local: null })}>+ Novo local</Button>}
          </div>

          {locais.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
              Nenhum local cadastrado ainda. {podeEditar ? "Comece cadastrando as geladeiras, câmaras e prateleiras." : ""}
            </div>
          ) : (
            <div className="space-y-4">
              {TIPOS.filter((t) => (porTipo.get(t) || []).length > 0).map((t) => (
                <div key={t}>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1.5">
                    <span>{LOCAL_ESTOQUE_TIPO_LABEL[t].icon}</span> {LOCAL_ESTOQUE_TIPO_LABEL[t].label}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(porTipo.get(t) || []).map((l) => (
                      <div key={l.id} className={`rounded-lg border p-3 flex items-center justify-between gap-2 ${l.ativo ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" : "border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/20 opacity-70"}`}>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.nome}</div>
                          {l.paiId && <div className="text-[11px] text-gray-400 truncate">dentro de {locais.find((x) => x.id === l.paiId)?.nome || "—"}</div>}
                          {!l.ativo && <div className="text-[11px] text-gray-400">inativo</div>}
                        </div>
                        {podeEditar && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => setModal({ local: l })} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Editar">✎</button>
                            <button type="button" onClick={() => void excluirLocal(l)} className="text-xs px-2 py-1 rounded text-gray-300 hover:text-rose-600" title="Excluir">🗑</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmBreve aba={aba} />
      )}

      {modal && (
        <LocalModal
          local={modal.local}
          locais={locais}
          onClose={() => setModal(null)}
          onSalvar={salvarLocal}
        />
      )}
    </div>
  );
}

// Placeholder das abas ainda não construídas — mostra o roadmap pra orientar.
function EmBreve({ aba }: { aba: string }) {
  const MAP: Record<string, { t: string; d: string }> = {
    produtos: { t: "🏷️ Produtos", d: "Cadastro de produto com matriz de conservação (refrigerado/congelado/…→dias) e a etiqueta fixa de estoque (QR). Um produto, vários métodos — sem duplicar." },
    entrada: { t: "📥 Entrada & Organização", d: "Dar entrada por foto da nota (OCR) ou manual, informar a validade do lote e receber a instrução de arrumação PVPS/PEPS. Sem imprimir a cada compra." },
    baixa: { t: "📤 Baixa por QR", d: "Ler o QR fixo do produto = baixa: o sistema mostra de qual lote pegar (giro), você confirma e informa a quantidade." },
    validades: { t: "⏰ Validades (FEFO)", d: "Painel do que vence hoje/amanhã/semana por loja, com alerta no WhatsApp. Relatório de desperdício." },
  };
  const m = MAP[aba] || { t: "Em breve", d: "" };
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
      <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">{m.t}</div>
      <div className="text-sm text-gray-500 max-w-md mx-auto">{m.d}</div>
      <div className="text-[11px] text-gray-400 mt-3">Em construção — próxima fase do módulo.</div>
    </div>
  );
}

function LocalModal({ local, locais, onClose, onSalvar }: {
  local: LocalEstoque | null;
  locais: LocalEstoque[];
  onClose: () => void;
  onSalvar: (l: Omit<LocalEstoque, "id" | "criadoEm"> & { id?: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState(local?.nome || "");
  const [tipo, setTipo] = useState<LocalEstoqueTipo>(local?.tipo || "geladeira");
  const [paiId, setPaiId] = useState<string>(local?.paiId || "");
  const [ativo, setAtivo] = useState<boolean>(local?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);

  // Possíveis "pais": outros locais do restaurante (menos ele mesmo).
  const pais = locais.filter((l) => l.id !== local?.id);

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      await onSalvar({ id: local?.id, restaurantId: local?.restaurantId || "", nome: nome.trim(), tipo, paiId: paiId || null, ativo });
    } finally { setSalvando(false); }
  }

  return (
    <Modal title={local ? "Editar local" : "Novo local de estoque"} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Geladeira 1, Câmara de congelados…" className={inp} autoFocus />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as LocalEstoqueTipo)} className={inp}>
              {TIPOS.map((t) => <option key={t} value={t}>{LOCAL_ESTOQUE_TIPO_LABEL[t].icon} {LOCAL_ESTOQUE_TIPO_LABEL[t].label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Dentro de <span className="text-gray-400">(opcional)</span></label>
            <select value={paiId} onChange={(e) => setPaiId(e.target.value)} className={inp}>
              <option value="">— nenhum —</option>
              {pais.map((l) => <option key={l.id} value={l.id}>{LOCAL_ESTOQUE_TIPO_LABEL[l.tipo].icon} {l.nome}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo
        </label>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando || !nome.trim()}>{salvando ? "Salvando…" : local ? "Salvar" : "Criar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
