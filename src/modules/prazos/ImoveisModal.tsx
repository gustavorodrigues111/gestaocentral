// Cadastro leve de Imóveis (compartilhado). Cada imóvel é de UMA empresa.
import { useState } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Imovel, ImovelEndereco } from "../../core/types";
import { enderecoResumo } from "../../core/types";

const inp = "w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
const uid = () => `imovel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export function ImoveisModal({ rid, restauranteNome, imoveis, meId, onClose }: {
  rid: string; restauranteNome: string; imoveis: Imovel[]; meId: string; onClose: () => void;
}) {
  const [apelido, setApelido] = useState("");
  const [end, setEnd] = useState<ImovelEndereco>({});
  const [salvando, setSalvando] = useState(false);

  async function adicionar() {
    if (!apelido.trim()) return;
    setSalvando(true);
    try {
      const id = uid();
      await setDoc(doc(db, "imoveis", id), sanitizeForFirestore({ id, restaurantId: rid, apelido: apelido.trim(), endereco: end, ativo: true, criadoEm: new Date().toISOString(), criadoPor: meId }));
      setApelido(""); setEnd({});
    } finally { setSalvando(false); }
  }
  const remover = (im: Imovel) => updateDoc(doc(db, "imoveis", im.id), { deletadoEm: new Date().toISOString(), deletadoPor: meId });
  const set = (k: keyof ImovelEndereco, v: string) => setEnd((e) => ({ ...e, [k]: v }));

  return (
    <Modal title={`🏠 Imóveis · ${restauranteNome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">Prédios/endereços desta empresa. Prazos técnicos (AVCB, dedetização, extintores…) e o aluguel apontam pra um imóvel.</p>
        {imoveis.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {imoveis.map((im) => (
              <div key={im.id} className="p-2.5 flex items-start gap-2">
                <span className="text-base">🏠</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{im.apelido}</div>
                  {enderecoResumo(im.endereco) && <div className="text-xs text-gray-500">{enderecoResumo(im.endereco)}</div>}
                </div>
                <button type="button" onClick={() => void remover(im)} className="text-gray-300 hover:text-rose-600">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 p-3 space-y-2">
          <input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="Apelido (ex.: Salão principal, Depósito)" className={inp} />
          <div className="grid grid-cols-3 gap-2">
            <input value={end.logradouro || ""} onChange={(e) => set("logradouro", e.target.value)} placeholder="Logradouro" className={`${inp} col-span-2`} />
            <input value={end.numero || ""} onChange={(e) => set("numero", e.target.value)} placeholder="Nº" className={inp} />
            <input value={end.bairro || ""} onChange={(e) => set("bairro", e.target.value)} placeholder="Bairro" className={inp} />
            <input value={end.cidade || ""} onChange={(e) => set("cidade", e.target.value)} placeholder="Cidade" className={inp} />
            <input value={end.uf || ""} onChange={(e) => set("uf", e.target.value.toUpperCase().slice(0, 2))} placeholder="UF" className={inp} />
          </div>
          <div className="flex justify-end"><Button size="sm" onClick={() => void adicionar()} disabled={salvando || !apelido.trim()}>+ Adicionar imóvel</Button></div>
        </div>
      </div>
    </Modal>
  );
}
