// Módulo PÁGINAS (Master) — hospedagem de HTMLs avulsos com slug próprio,
// servidos em pages.planejamento.app/<slug>. Público ou privado (allowlist de
// e-mail e/ou senha da página). O acesso é validado no servidor (api/hosted-page).
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc } from "firebase/firestore";
import { Globe, Lock, Upload, ExternalLink, Pencil, Trash2, Power, Copy, Check } from "lucide-react";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { PageContainer } from "../../core/ui/PageContainer";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { HostedPage } from "../../core/types";
import { PaginaModal } from "./PaginaModal";

const BASE_URL = "https://planejamento.app/pages";

export function PaginasPage() {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const [paginas, setPaginas] = useState<HostedPage[]>([]);
  const [editing, setEditing] = useState<HostedPage | "new" | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    if (!isMaster) return;
    const unsub = onSnapshot(query(collection(db, "hostedPages")), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as HostedPage);
      list.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setPaginas(list);
    }, () => setPaginas([]));
    return () => unsub();
  }, [isMaster]);

  const slugsUsados = useMemo(() => new Set(paginas.map((p) => p.slug)), [paginas]);

  async function toggleAtivo(p: HostedPage) {
    await updateDoc(doc(db, "hostedPages", p.id), { ativo: !p.ativo, atualizadoEm: new Date().toISOString() });
  }
  async function toggleVisibilidade(p: HostedPage) {
    const nova = p.visibilidade === "publico" ? "privado" : "publico";
    await updateDoc(doc(db, "hostedPages", p.id), { visibilidade: nova, atualizadoEm: new Date().toISOString() });
  }
  async function excluir(p: HostedPage) {
    if (!confirm(`Apagar a página "${p.titulo}" (${p.slug})? Não dá pra desfazer.`)) return;
    await deleteDoc(doc(db, "hostedPages", p.id));
  }
  async function copiarLink(p: HostedPage) {
    try { await navigator.clipboard.writeText(`${BASE_URL}/${p.slug}`); setCopiado(p.id); setTimeout(() => setCopiado(null), 1500); } catch { /* clipboard */ }
  }

  if (!isMaster) {
    return <PageContainer><div className="max-w-md mx-auto py-20 text-center text-gray-500"><Lock size={40} className="mx-auto mb-3 text-gray-400" />Só o master acessa as Páginas.</div></PageContainer>;
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">Suba HTMLs e compartilhe em <code className="text-gray-700 dark:text-gray-300">{BASE_URL.replace("https://", "")}/&lt;slug&gt;</code>.</p>
        <Button onClick={() => setEditing("new")}><span className="inline-flex items-center gap-1.5"><Upload size={15} /> Subir HTML</span></Button>
      </div>

      {paginas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <Globe size={40} className="mx-auto mb-3 text-gray-400" />
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma página ainda</p>
          <p className="text-sm text-gray-500 mt-1">Clique em <strong>Subir HTML</strong> pra publicar a primeira.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginas.map((p) => (
            <div key={p.id} className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 ${!p.ativo ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{p.titulo}</h3>
                    {p.visibilidade === "publico"
                      ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 inline-flex items-center gap-1"><Globe size={10} /> Público</span>
                      : <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 inline-flex items-center gap-1"><Lock size={10} /> Privado</span>}
                    {!p.ativo && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">Desativada</span>}
                  </div>
                  <button type="button" onClick={() => void copiarLink(p)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline" title="Copiar link">
                    {BASE_URL.replace("https://", "")}/{p.slug} {copiado === p.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex gap-2 flex-wrap">
                    {p.visibilidade === "privado" && <span>{(p.emailsAutorizados?.length || 0)} e-mail(s){p.senhaHash ? " · senha" : ""}</span>}
                    {p.tamanhoBytes != null && <span>{(p.tamanhoBytes / 1024).toFixed(0)} KB</span>}
                    {p.criadoEm && <span>{new Date(p.criadoEm).toLocaleDateString("pt-BR")}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <a href={`${BASE_URL}/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs font-medium px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"><ExternalLink size={13} /> Abrir</a>
                  <button type="button" onClick={() => void toggleVisibilidade(p)} title={p.visibilidade === "publico" ? "Tornar privado" : "Tornar público"} className="text-xs font-medium px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1">{p.visibilidade === "publico" ? <Lock size={13} /> : <Globe size={13} />}</button>
                  <button type="button" onClick={() => void toggleAtivo(p)} title={p.ativo ? "Desativar" : "Ativar"} className={`text-xs font-medium px-2 py-1.5 rounded-lg border inline-flex items-center gap-1 ${p.ativo ? "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800" : "border-emerald-300 text-emerald-700 dark:text-emerald-300"}`}><Power size={13} /></button>
                  <button type="button" onClick={() => setEditing(p)} title="Editar" className="text-xs font-medium px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"><Pencil size={13} /></button>
                  <button type="button" onClick={() => void excluir(p)} title="Apagar" className="text-xs font-medium px-2 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 inline-flex items-center gap-1"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && me && (
        <PaginaModal
          pagina={editing === "new" ? null : editing}
          slugsUsados={slugsUsados}
          autor={{ id: me.id, nome: me.nome }}
          onClose={() => setEditing(null)}
          onSalvar={async (dados) => {
            const now = new Date().toISOString();
            if (editing === "new") {
              await addDoc(collection(db, "hostedPages"), sanitizeForFirestore({ ...dados, criadoEm: now, criadoPor: me.id, criadoPorNome: me.nome, atualizadoEm: now }));
            } else {
              await updateDoc(doc(db, "hostedPages", editing.id), sanitizeForFirestore({ ...dados, atualizadoEm: now }));
            }
            setEditing(null);
          }}
        />
      )}
    </PageContainer>
  );
}
