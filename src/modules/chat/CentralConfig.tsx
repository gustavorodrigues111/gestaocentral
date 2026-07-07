// Aba "Configurações" da Central de Avisos: centraliza tudo de notificação —
// templates do WhatsApp, tags das conversas e os canais dos avisos de sistema
// (in-app/email/WhatsApp por notificação, do restaurante ativo).
import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Pessoa, WhatsappTag, ModuleId } from "../../core/types";
import { WhatsappTemplatesTab } from "../whatsapp/WhatsappTemplatesTab";
import { AvisosSistemaTab } from "../rotinas/AvisosSistemaTab";

const PALETA = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#8b5cf6", "#64748b"];

function Secao({ titulo, desc, children }: { titulo: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h3 className="font-bold text-gray-900 dark:text-gray-100">{titulo}</h3>
      {desc && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">{desc}</p>}
      <div className={desc ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

export function CentralConfig({ rid, restauranteNome, pessoas, modulosAtivos, meId, podeConfig }: {
  rid: string; restauranteNome: string; pessoas: Pessoa[]; modulosAtivos: ModuleId[]; meId: string; podeConfig: boolean;
}) {
  return (
    <div className="space-y-5">
      <Secao titulo="🔔 Avisos do sistema — canais" desc={`Ligue/desligue in-app, email e WhatsApp de cada aviso, com destinatários, horário e dias. Configurando: ${restauranteNome}.`}>
        <AvisosSistemaTab rid={rid} pessoas={pessoas} modulosAtivos={modulosAtivos} meId={meId} podeGerenciar={podeConfig} />
      </Secao>

      <Secao titulo="💬 Templates do WhatsApp" desc="Modelos aprovados pela Meta usados nas mensagens proativas (fora da janela de 24h).">
        <WhatsappTemplatesTab podeConfig={podeConfig} />
      </Secao>

      <Secao titulo="🏷 Tags das conversas" desc="Etiquetas pra organizar as conversas de WhatsApp.">
        <TagsConfig podeConfig={podeConfig} />
      </Secao>
    </div>
  );
}

function TagsConfig({ podeConfig }: { podeConfig: boolean }) {
  const [tags, setTags] = useState<WhatsappTag[]>([]);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(PALETA[0]!);
  useEffect(() => {
    const u = onSnapshot(collection(db, "whatsappTags"), snap => setTags(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WhatsappTag).sort((a, b) => a.nome.localeCompare(b.nome))));
    return () => u();
  }, []);
  async function criar() { const n = nome.trim(); if (!n) return; await addDoc(collection(db, "whatsappTags"), sanitizeForFirestore({ nome: n, cor, criadoEm: new Date().toISOString() })); setNome(""); }
  async function excluir(id: string) { await deleteDoc(doc(db, "whatsappTags", id)); }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 && <span className="text-sm text-gray-400">Nenhuma tag ainda.</span>}
        {tags.map(t => (
          <span key={t.id} className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full text-white" style={{ background: t.cor || "#6366f1" }}>
            {t.nome}
            {podeConfig && <button type="button" onClick={() => void excluir(t.id)} className="opacity-80 hover:opacity-100 leading-none">×</button>}
          </span>
        ))}
      </div>
      {podeConfig && (
        <div className="flex items-center gap-2 flex-wrap">
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nova tag" onKeyDown={e => { if (e.key === "Enter") void criar(); }}
            className="flex-1 min-w-[140px] px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <div className="flex items-center gap-1">
            {PALETA.map(c => <button key={c} type="button" onClick={() => setCor(c)} className={`w-6 h-6 rounded-full ${cor === c ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900" : ""}`} style={{ background: c }} />)}
          </div>
          <button type="button" onClick={() => void criar()} disabled={!nome.trim()} className="text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">Adicionar</button>
        </div>
      )}
    </div>
  );
}
