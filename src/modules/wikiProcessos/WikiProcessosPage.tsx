// Wiki de Processos — Fase 1: documentação viva dos processos internos por área.
// 3 formatos (texto / checklist / passo-a-passo) + fotos. Busca + consulta pela
// equipe. Escopo por empresa (restaurantIds[]). Fotos no Firebase Storage.
// Fase 2 (pendente): "Pergunte à IA". Fase 3: trilha de onboarding + confirmar leitura.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, orderBy, setDoc, doc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import type { WikiProcesso, WikiFormato, WikiFoto, WikiPasso, WikiChecklistItem } from "../../core/types";

const FORMATO_LABEL: Record<WikiFormato, string> = { texto: "📄 Texto", checklist: "✅ Checklist", passos: "👣 Passo a passo" };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function WikiProcessosPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const [procs, setProcs] = useState<WikiProcesso[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroArea, setFiltroArea] = useState<string>("todas");
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<WikiProcesso | null>(null);
  const [lendo, setLendo] = useState<WikiProcesso | null>(null);

  useEffect(() => {
    const u = onSnapshot(query(collection(db, "wikiProcessos"), orderBy("titulo")),
      snap => setProcs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WikiProcesso).filter(p => !p.deletadoEm && p.ativo !== false)));
    return () => u();
  }, []);

  if (!pessoa) return null;
  const daEmpresa = procs.filter(p => (p.restaurantIds || []).includes(rid || ""));
  const areas = [...new Set(daEmpresa.map(p => p.area).filter(Boolean))].sort();
  const q = busca.trim().toLowerCase();
  const visiveis = daEmpresa.filter(p =>
    (filtroArea === "todas" || p.area === filtroArea) &&
    (!q || `${p.titulo} ${p.resumo || ""} ${(p.tags || []).join(" ")} ${p.area}`.toLowerCase().includes(q))
  );
  // Agrupa por área
  const porArea = new Map<string, WikiProcesso[]>();
  for (const p of visiveis) { const a = p.area || "Sem área"; const arr = porArea.get(a) || []; arr.push(p); porArea.set(a, arr); }

  const chip = (active: boolean, label: string, onClick: () => void, key?: string) => (
    <button key={key} type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{label}</button>
  );

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-500">{daEmpresa.length} processo{daEmpresa.length === 1 ? "" : "s"} documentado{daEmpresa.length === 1 ? "" : "s"}</div>
        <Button onClick={() => setCriando(true)}>+ Novo processo</Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔎 Buscar processo…"
          className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100 flex-1 min-w-[180px]" />
        {areas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chip(filtroArea === "todas", "Todas as áreas", () => setFiltroArea("todas"))}
            {areas.map(a => chip(filtroArea === a, a, () => setFiltroArea(a), a))}
          </div>
        )}
      </div>

      {daEmpresa.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📚</div>
          <p>Nenhum processo documentado nesta empresa ainda.</p>
          <p className="text-sm mt-1">Comece documentando um: abertura da casa, fechamento de caixa, limpeza, recebimento…</p>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">Nada encontrado pra essa busca/filtro.</div>
      ) : (
        <div className="space-y-5">
          {[...porArea.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([area, lista]) => (
            <div key={area}>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{area}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {lista.map(p => (
                  <button key={p.id} type="button" onClick={() => setLendo(p)}
                    className="text-left p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md transition-shadow">
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                      {p.titulo}
                      {p.publicado === false && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">rascunho</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{FORMATO_LABEL[p.formato]}{p.resumo ? ` · ${p.resumo}` : ""}</div>
                    {(p.fotos?.length ?? 0) > 0 && <div className="text-[11px] text-gray-400 mt-1">📎 {p.fotos!.length} foto{p.fotos!.length === 1 ? "" : "s"}</div>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lendo && <LerModal proc={lendo} onClose={() => setLendo(null)} onEditar={() => { setEditando(lendo); setLendo(null); }} />}
      {(criando || editando) && (
        <WikiForm proc={editando} onClose={() => { setCriando(false); setEditando(null); }}
          restaurantes={restaurants.map(r => ({ id: r.id, nome: r.nome }))} ridAtual={rid || ""}
          areasExistentes={areas} pessoaId={pessoa.id} />
      )}
    </div>
  );
}

// ─── Leitura (consulta) ──────────────────────────────────────────────────────
function LerModal({ proc, onClose, onEditar }: { proc: WikiProcesso; onClose: () => void; onEditar: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{proc.titulo}</h2>
          <Button size="sm" variant="secondary" onClick={onEditar}>✏️ Editar</Button>
        </div>
        <div className="text-xs text-gray-500 mb-4">{proc.area} · {FORMATO_LABEL[proc.formato]} · atualizado {fmtBR((proc.atualizadoEm || "").slice(0, 10))}</div>
        {proc.resumo && <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 italic">{proc.resumo}</p>}

        {proc.formato === "texto" && (
          <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{proc.conteudo || <span className="text-gray-400">Sem conteúdo.</span>}</div>
        )}
        {proc.formato === "checklist" && (
          <ul className="space-y-1.5">
            {(proc.itens || []).map(it => (
              <li key={it.id} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200"><span className="text-emerald-500 mt-0.5">☐</span>{it.texto}</li>
            ))}
          </ul>
        )}
        {proc.formato === "passos" && (
          <ol className="space-y-3">
            {(proc.passos || []).map((s, i) => (
              <li key={s.id} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  {s.titulo && <div className="font-medium text-gray-900 dark:text-gray-100">{s.titulo}</div>}
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{s.descricao}</div>
                  {s.foto && <img src={s.foto.url} alt="" className="mt-2 rounded-lg max-h-52 border border-gray-200 dark:border-gray-700" />}
                </div>
              </li>
            ))}
          </ol>
        )}

        {(proc.fotos?.length ?? 0) > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <div className="text-xs font-medium text-gray-500 mb-2">📎 Fotos</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {proc.fotos!.map(f => (
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.legenda || ""} className="rounded-lg border border-gray-200 dark:border-gray-700 w-full h-28 object-cover" /></a>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end mt-5"><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
      </div>
    </div>
  );
}

// ─── Cadastro/edição ─────────────────────────────────────────────────────────
function WikiForm({ proc, onClose, restaurantes, ridAtual, areasExistentes, pessoaId }: {
  proc: WikiProcesso | null; onClose: () => void; restaurantes: { id: string; nome: string }[];
  ridAtual: string; areasExistentes: string[]; pessoaId: string;
}) {
  const [f, setF] = useState<Partial<WikiProcesso>>(proc ? { ...proc } : {
    titulo: "", area: "", resumo: "", formato: "texto", restaurantIds: ridAtual ? [ridAtual] : [],
    conteudo: "", itens: [], passos: [], fotos: [], publicado: true, ativo: true,
  });
  const [subindo, setSubindo] = useState(false);

  async function subirFoto(file: File): Promise<WikiFoto | null> {
    setSubindo(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `wiki/${ridAtual}/${uid()}.${ext}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(snap.ref);
      return { id: uid(), url, storagePath: path };
    } catch (e) { alert("Erro ao subir foto: " + (e instanceof Error ? e.message : "?")); return null; }
    finally { setSubindo(false); }
  }

  async function salvar() {
    if (!f.titulo?.trim()) { alert("Título é obrigatório"); return; }
    if (!f.area?.trim()) { alert("Escolha/defina a área"); return; }
    const now = new Date().toISOString();
    const id = proc?.id || `wk-${uid()}`;
    const data: WikiProcesso = {
      id, restaurantIds: f.restaurantIds?.length ? f.restaurantIds : (ridAtual ? [ridAtual] : []),
      area: f.area.trim(), titulo: f.titulo.trim(), resumo: f.resumo?.trim() || undefined,
      formato: f.formato || "texto",
      conteudo: f.formato === "texto" ? (f.conteudo || "") : undefined,
      itens: f.formato === "checklist" ? (f.itens || []).filter(i => i.texto.trim()) : undefined,
      passos: f.formato === "passos" ? (f.passos || []).filter(s => s.descricao.trim()) : undefined,
      fotos: f.fotos || [], tags: f.tags,
      publicado: f.publicado ?? true, ativo: true,
      criadoEm: proc?.criadoEm || now, criadoPor: proc?.criadoPor || pessoaId, atualizadoEm: now, atualizadoPor: pessoaId,
    };
    await setDoc(doc(db, "wikiProcessos", id), sanitizeForFirestore(data));
    onClose();
  }
  async function excluir() {
    if (!proc) return;
    if (!confirm(`Excluir "${proc.titulo}"? Vai pra lixeira.`)) return;
    await setDoc(doc(db, "wikiProcessos", proc.id), sanitizeForFirestore({ ...proc, deletadoEm: new Date().toISOString(), deletadoPor: pessoaId }));
    onClose();
  }

  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const toggleRid = (id: string) => setF(p => { const cur = p.restaurantIds || []; return { ...p, restaurantIds: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }; });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{proc ? "Editar processo" : "Novo processo"}</h2>
        <div className="space-y-3">
          <Campo label="Título *"><input value={f.titulo || ""} onChange={e => setF({ ...f, titulo: e.target.value })} className={inp} autoFocus placeholder="Ex: Fechamento de caixa do turno" /></Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Área *">
              <input list="wiki-areas" value={f.area || ""} onChange={e => setF({ ...f, area: e.target.value })} className={inp} placeholder="Cozinha, Salão, DP, Financeiro…" />
              <datalist id="wiki-areas">{areasExistentes.map(a => <option key={a} value={a} />)}</datalist>
            </Campo>
            <Campo label="Formato *">
              <select value={f.formato} onChange={e => setF({ ...f, formato: e.target.value as WikiFormato })} className={inp}>
                {(Object.keys(FORMATO_LABEL) as WikiFormato[]).map(k => <option key={k} value={k}>{FORMATO_LABEL[k]}</option>)}
              </select>
            </Campo>
          </div>
          <Campo label="Resumo (1 linha, opcional)"><input value={f.resumo || ""} onChange={e => setF({ ...f, resumo: e.target.value })} className={inp} placeholder="Do que se trata, em uma frase" /></Campo>

          {/* Conteúdo por formato */}
          {f.formato === "texto" && (
            <Campo label="Conteúdo"><textarea value={f.conteudo || ""} onChange={e => setF({ ...f, conteudo: e.target.value })} className={inp} rows={8} placeholder="Escreva o processo. Quebras de linha são mantidas." /></Campo>
          )}
          {f.formato === "checklist" && (
            <Campo label="Itens do checklist">
              <div className="space-y-1.5">
                {(f.itens || []).map((it, idx) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className="text-gray-400">☐</span>
                    <input value={it.texto} onChange={e => setF({ ...f, itens: (f.itens || []).map(x => x.id === it.id ? { ...x, texto: e.target.value } : x) })} className={inp} placeholder={`Item ${idx + 1}`} />
                    <button type="button" onClick={() => setF({ ...f, itens: (f.itens || []).filter(x => x.id !== it.id) })} className="text-gray-400 hover:text-rose-600 text-sm">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => setF({ ...f, itens: [...(f.itens || []), { id: uid(), texto: "" } as WikiChecklistItem] })} className="text-xs text-indigo-600 hover:underline">+ item</button>
              </div>
            </Campo>
          )}
          {f.formato === "passos" && (
            <Campo label="Passos">
              <div className="space-y-3">
                {(f.passos || []).map((s, idx) => (
                  <div key={s.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-[11px] font-bold flex items-center justify-center">{idx + 1}</span>
                      <input value={s.titulo || ""} onChange={e => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, titulo: e.target.value } : x) })} className={inp} placeholder="Título do passo (opcional)" />
                      <button type="button" onClick={() => setF({ ...f, passos: (f.passos || []).filter(x => x.id !== s.id) })} className="text-gray-400 hover:text-rose-600 text-sm">✕</button>
                    </div>
                    <textarea value={s.descricao} onChange={e => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, descricao: e.target.value } : x) })} className={inp} rows={2} placeholder="O que fazer neste passo" />
                    <div className="flex items-center gap-2">
                      {s.foto ? (
                        <div className="flex items-center gap-2"><img src={s.foto.url} alt="" className="h-12 rounded border border-gray-200 dark:border-gray-700" /><button type="button" onClick={() => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, foto: null } : x) })} className="text-[11px] text-gray-400 hover:text-rose-600">remover foto</button></div>
                      ) : (
                        <label className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer">
                          {subindo ? "…" : "📷 Foto do passo"}
                          <input type="file" accept="image/*" className="hidden" disabled={subindo} onChange={async e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (!file) return; const foto = await subirFoto(file); if (foto) setF(p => ({ ...p, passos: (p.passos || []).map(x => x.id === s.id ? { ...x, foto } : x) })); }} />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setF({ ...f, passos: [...(f.passos || []), { id: uid(), descricao: "" } as WikiPasso] })} className="text-xs text-indigo-600 hover:underline">+ passo</button>
              </div>
            </Campo>
          )}

          {/* Fotos gerais */}
          <Campo label="Fotos (opcional)">
            <div className="flex flex-wrap gap-2 items-center">
              {(f.fotos || []).map(ft => (
                <div key={ft.id} className="relative"><img src={ft.url} alt="" className="h-16 w-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700" /><button type="button" onClick={() => setF({ ...f, fotos: (f.fotos || []).filter(x => x.id !== ft.id) })} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-rose-600 text-xs">✕</button></div>
              ))}
              <label className="h-16 w-16 flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 hover:text-indigo-600 cursor-pointer text-xl">
                {subindo ? "…" : "＋"}
                <input type="file" accept="image/*" className="hidden" disabled={subindo} onChange={async e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (!file) return; const foto = await subirFoto(file); if (foto) setF(p => ({ ...p, fotos: [...(p.fotos || []), foto] })); }} />
              </label>
            </div>
          </Campo>

          {/* Empresas + publicado */}
          {restaurantes.length > 1 && (
            <Campo label="Empresas onde vale">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {restaurantes.map(r => <label key={r.id} className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300"><input type="checkbox" checked={(f.restaurantIds || []).includes(r.id)} onChange={() => toggleRid(r.id)} />{r.nome}</label>)}
              </div>
            </Campo>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={f.publicado ?? true} onChange={e => setF({ ...f, publicado: e.target.checked })} />Publicado (desmarque pra deixar como rascunho)</label>
        </div>

        <div className="flex gap-2 justify-between mt-5">
          {proc ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose} variant="ghost">Cancelar</Button><Button onClick={salvar} disabled={subindo}>{proc ? "Salvar" : "Criar"}</Button></div>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>{children}</label>;
}
