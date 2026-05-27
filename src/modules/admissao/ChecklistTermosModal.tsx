// ════════════════════════════════════════════════════════════════════════════
//  Modal — Checklist de termos a assinar
//
//  Aberto pelo botão "📋 Abrir checklist de termos" da subtarefa
//  st_termos_assinatura ("Preenchimento dos termos para assinatura").
//  Mostra cada termo com checkbox + campo de link opcional (URL do PDF
//  assinado, Drive ou Clicksign).
//
//  Os termos vivem em `admissao.termosAssinados`. Quando o array tá vazio
//  (admissão nova ou criada antes desta feature), instancia com o default
//  global de `getTermosAssinaturaDefault()`.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type {
  Admissao, ItemUniforme, KitAreaUniforme, Pessoa, Restaurant, TermoAssinado,
} from "../../core/types";
import {
  atualizarTermoAssinado,
  instanciarTermosAssinados,
} from "../../core/admissao/admissaoHelpers";
import { NovaEntregaModal } from "../uniformes/NovaEntregaModal";

type Props = {
  admissao: Admissao;
  pessoa: Pessoa;
  activeRestaurant: Restaurant;
  onClose: () => void;
};

export function ChecklistTermosModal({ admissao, pessoa, activeRestaurant, onClose }: Props) {
  // Inicializa com o existente OU com o default global
  const [termos, setTermos] = useState<TermoAssinado[]>(
    () => instanciarTermosAssinados(admissao.termosAssinados),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Modal de entrega (uniforme/EPI) — aberto pelo botão "Gerar termo"
  const [gerarTermoTipo, setGerarTermoTipo] = useState<"uniforme" | "epi" | null>(null);
  // Carrega lazy itens + kits quando o NovaEntregaModal precisa
  const [itensUniforme, setItensUniforme] = useState<ItemUniforme[]>([]);
  const [kitsAreaUniforme, setKitsAreaUniforme] = useState<KitAreaUniforme[]>([]);
  const [carregandoUniformes, setCarregandoUniformes] = useState(false);
  async function abrirGerarTermo(tipo: "uniforme" | "epi") {
    if (itensUniforme.length === 0 && !carregandoUniformes) {
      setCarregandoUniformes(true);
      try {
        const [iSnap, kSnap] = await Promise.all([
          getDocs(query(collection(db, "itensUniforme"), where("restaurantId", "==", admissao.restaurantId))),
          getDocs(query(collection(db, "kitsAreaUniforme"), where("restaurantId", "==", admissao.restaurantId))),
        ]);
        setItensUniforme(iSnap.docs.map(d => ({ ...d.data(), id: d.id }) as ItemUniforme));
        setKitsAreaUniforme(kSnap.docs.map(d => ({ ...d.data(), id: d.id }) as KitAreaUniforme));
      } finally {
        setCarregandoUniformes(false);
      }
    }
    setGerarTermoTipo(tipo);
  }
  // Quando entrega é criada via NovaEntregaModal, marca o termo correspondente
  // como assinado (com link pendente — DP pode atualizar depois com URL do PDF).
  function marcarTermoEspecialComoAssinado(tipo: "uniforme" | "epi") {
    const now = new Date().toISOString();
    setTermos(prev => prev.map(t => {
      if (t.tipoEspecial !== tipo) return t;
      return {
        ...t,
        assinado: true,
        assinadoEm: now,
        assinadoPor: { id: pessoa.id, nome: pessoa.nome },
      };
    }));
  }

  // Sincroniza com mudanças externas (admissão atualizada em outro lugar)
  useEffect(() => {
    setTermos(instanciarTermosAssinados(admissao.termosAssinados));
  }, [admissao.termosAssinados]);

  const obrigatorios = useMemo(() => termos.filter(t => t.obrigatorio), [termos]);
  const obrigPendentes = obrigatorios.filter(t => !t.assinado).length;
  const totalAssinados = termos.filter(t => t.assinado).length;

  function togglarAssinatura(id: string) {
    const now = new Date().toISOString();
    setTermos(prev => prev.map(t => {
      if (t.id !== id) return t;
      const assinado = !t.assinado;
      const merged: TermoAssinado = {
        ...t,
        assinado,
      };
      if (assinado) {
        merged.assinadoEm = now;
        merged.assinadoPor = { id: pessoa.id, nome: pessoa.nome };
      } else {
        delete merged.assinadoEm;
        delete merged.assinadoPor;
      }
      return merged;
    }));
  }

  function atualizarLink(id: string, link: string) {
    setTermos(prev => prev.map(t => {
      if (t.id !== id) return t;
      const merged: TermoAssinado = { ...t };
      if (link.trim()) merged.link = link.trim();
      else delete merged.link;
      return merged;
    }));
  }

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      await atualizarTermoAssinado(admissao.id, termos);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="📋 Termos a assinar" onClose={onClose} maxWidth="max-w-xl">
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Marca cada termo conforme o candidato vai assinando. Cole o link do
          PDF assinado (Drive, Clicksign) pra deixar registrado.
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {totalAssinados} de {termos.length} assinados
          </span>
          {obrigPendentes > 0 && (
            <span className="text-amber-700 dark:text-amber-400 font-semibold">
              ⚠ {obrigPendentes} obrigatório(s) pendente(s)
            </span>
          )}
          {obrigPendentes === 0 && (
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              ✓ Todos obrigatórios assinados
            </span>
          )}
        </div>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {termos.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border p-3 ${
                t.assinado
                  ? "bg-emerald-50/40 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/60"
                  : t.obrigatorio
                    ? "bg-white dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
                    : "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
              }`}
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={t.assinado}
                  onChange={() => togglarAssinatura(t.id)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${t.assinado ? "line-through text-gray-600 dark:text-gray-400" : "text-gray-900 dark:text-gray-100 font-medium"}`}>
                    {t.nome}
                    {!t.obrigatorio && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">opcional</span>
                    )}
                  </div>
                  {t.assinado && t.assinadoEm && (
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                      ✓ {new Date(t.assinadoEm).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                      {t.assinadoPor?.nome ? ` · por ${t.assinadoPor.nome}` : ""}
                    </div>
                  )}
                </div>
              </label>
              <div className="mt-2 pl-6 space-y-1.5">
                {/* Botão "Gerar termo" pra termos com tipo especial (uniforme/EPI).
                    Abre o modal de entrega — gera PDF + baixa estoque + cria
                    registro de entrega. Termo entra no kit do Clicksign depois. */}
                {t.tipoEspecial && !t.assinado && (
                  <button
                    type="button"
                    onClick={() => abrirGerarTermo(t.tipoEspecial!)}
                    disabled={carregandoUniformes}
                    className="text-[11px] px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-medium"
                  >
                    {carregandoUniformes
                      ? "Carregando catálogo…"
                      : t.tipoEspecial === "uniforme"
                        ? "📦 Gerar termo de uniformes"
                        : "🦺 Gerar termo de EPIs"}
                  </button>
                )}
                <input
                  type="url"
                  value={t.link || ""}
                  onChange={(e) => atualizarLink(t.id, e.target.value)}
                  placeholder="https://… (link do PDF assinado)"
                  className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                {t.link && (
                  <a
                    href={t.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 inline-block"
                  >
                    ↗ abrir link
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      {gerarTermoTipo && (
        <NovaEntregaModal
          tipo={gerarTermoTipo}
          itens={itensUniforme}
          kits={kitsAreaUniforme}
          restaurantId={admissao.restaurantId}
          activeRestaurant={activeRestaurant}
          pessoa={pessoa}
          admissaoContexto={admissao}
          onEntregaCriada={() => marcarTermoEspecialComoAssinado(gerarTermoTipo)}
          onClose={() => setGerarTermoTipo(null)}
        />
      )}
    </Modal>
  );
}
