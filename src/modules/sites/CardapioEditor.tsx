// Editor estruturado do cardápio (Fase 1). Seções → pratos (título + subtítulo
// + preço). Salva automático (debounce) em /cardapioEstruturado/{rid}. O site
// renderiza ao vivo quando o modo do cardápio é "editor".
import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { authHeader } from "../../core/firebase/idToken";
import { CardapioVisual, TacaIcon, GarrafaIcon } from "./CardapioVisual";
import { IconePickerModal, IconeCardapioView } from "../cardapio/iconesCardapio";
import type { CardapioEstruturado, CardapioLayout, SecaoCardapio, PratoCardapio } from "../../core/types";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// Assinatura do conteúdo PT (nome/obs da seção + título/subtítulo dos pratos).
// Usada pra saber se a tradução está em dia: traduziu → guarda a assinatura;
// mudou o PT → assinatura difere → reabilita o botão de traduzir.
type GrupoSite = { id: string; titulo: string; secaoIds: string[] };

function sigPt(secoes: SecaoCardapio[]): string {
  const txt = secoes.map((s) => [s.nome || "", s.obs || "", ...s.pratos.flatMap((p) => [p.titulo || "", p.subtitulo || ""])].join("")).join("");
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function CardapioEditor({ rid, podeEditar, nomeRestaurante, menuId, nomeMenu, sharedLayout, menuLayoutProprio, menuLayout }: { rid: string; podeEditar: boolean; nomeRestaurante?: string; menuId?: string; nomeMenu?: string; sharedLayout?: CardapioLayout; menuLayoutProprio?: boolean; menuLayout?: CardapioLayout }) {
  const { pessoa: me } = useAuth();
  const [secoes, setSecoes] = useState<SecaoCardapio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");
  const [traduzidoEm, setTraduzidoEm] = useState<string | undefined>(undefined);
  const [traduzidoSig, setTraduzidoSig] = useState<string | undefined>(undefined);
  const [traduzindo, setTraduzindo] = useState(false);
  const [lang, setLang] = useState<"pt" | "en">("pt");
  const [erroTrad, setErroTrad] = useState("");
  const [mostrarVisual, setMostrarVisual] = useState(false);
  const [iconePrato, setIconePrato] = useState<{ si: number; pi: number } | null>(null);
  const [tituloCapaMenu, setTituloCapaMenu] = useState("");
  const [mostrarGarrafa, setMostrarGarrafa] = useState(false);
  const [gruposSite, setGruposSite] = useState<GrupoSite[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const tituloTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancel = false;
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((snap) => {
      if (cancel) return;
      if (snap.exists()) {
        const d = snap.data() as CardapioEstruturado;
        if (menuId) {
          const m = (d.cardapios || []).find((c) => c.id === menuId);
          setTituloCapaMenu(m?.tituloCapa ?? ""); setMostrarGarrafa(!!m?.mostrarGarrafa);
          setGruposSite(m?.gruposSite || []);
          setSecoes(m?.secoes || []); setTraduzidoEm(m?.traduzidoEm); setTraduzidoSig(m?.traduzidoSig);
        } else {
          setSecoes(d.secoes || []); setTraduzidoEm(d.traduzidoEm); setTraduzidoSig(d.traduzidoSig);
        }
      } else {
        setSecoes([]);
      }
      setCarregando(false);
    });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid, menuId]);

  function commit(next: SecaoCardapio[], stampTraducao?: string, sigTraducao?: string) {
    setSecoes(next);
    if (!podeEditar) return;
    const stamp = stampTraducao ?? traduzidoEm; // preserva (setDoc sobrescreve o doc todo)
    const sig = sigTraducao ?? traduzidoSig;    // idem — só muda quando traduz
    setEstado("salvando");
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const ref = doc(db, "cardapioEstruturado", rid);
        if (menuId) {
          // Atualiza só ESTE cardápio dentro do array (read-modify-write).
          const snap = await getDoc(ref);
          const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
          const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, secoes: next, ...(stamp ? { traduzidoEm: stamp } : {}), ...(sig ? { traduzidoSig: sig } : {}) } : c);
          await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true });
        } else {
          const payload: CardapioEstruturado = {
            id: rid, restaurantId: rid, secoes: next,
            atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id,
            ...(stamp ? { traduzidoEm: stamp } : {}),
            ...(sig ? { traduzidoSig: sig } : {}),
          };
          await setDoc(ref, sanitizeForFirestore(payload), { merge: true });
        }
        setEstado("salvo");
        setTimeout(() => setEstado(""), 1800);
      } catch { setEstado(""); }
    }, 700);
  }

  async function traduzir() {
    setErroTrad(""); setTraduzindo(true);
    try {
      const resp = await fetch("/api/traduzir-cardapio", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ secoes: secoes.map((s) => ({ nome: s.nome, obs: s.obs, pratos: s.pratos.map((p) => ({ titulo: p.titulo, subtitulo: p.subtitulo })) })) }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((j as { error?: string }).error || `HTTP ${resp.status}`);
      const tr = (j as { secoes?: Array<{ nomeEn?: string; obsEn?: string; pratos?: Array<{ tituloEn?: string; subtituloEn?: string }> }> }).secoes || [];
      const next = secoes.map((s, si) => {
        const ts = tr[si] || {};
        return {
          ...s,
          nomeEn: ts.nomeEn || undefined,
          obsEn: ts.obsEn || undefined,
          pratos: s.pratos.map((p, pi) => {
            const tp = (ts.pratos || [])[pi] || {};
            return { ...p, tituloEn: tp.tituloEn || undefined, subtituloEn: tp.subtituloEn || undefined };
          }),
        };
      });
      // Valida: a tradução TEM que ter vindo com algum inglês. Se voltou vazia
      // (truncou/erro), NÃO marca como traduzido — evita "diz traduzido mas sem EN".
      const temAlgumEn = next.some((s) => s.nomeEn || s.pratos.some((p) => p.tituloEn));
      if (!temAlgumEn) throw new Error("A tradução voltou vazia. Tente de novo.");
      const now = new Date().toISOString();
      const novaSig = sigPt(secoes);
      setSecoes(next);
      setTraduzidoEm(now);
      setTraduzidoSig(novaSig);
      // Salva IMEDIATO e aguardando (não pelo debounce do commit, que pode se
      // perder se trocar de menu/fechar antes dos 700ms). Tradução é cara.
      if (podeEditar) {
        const ref = doc(db, "cardapioEstruturado", rid);
        if (menuId) {
          const snap = await getDoc(ref);
          const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
          const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, secoes: next, traduzidoEm: now, traduzidoSig: novaSig } : c);
          await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios, atualizadoEm: now, atualizadoPor: me?.id }), { merge: true });
        } else {
          await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, secoes: next, traduzidoEm: now, traduzidoSig: novaSig, atualizadoEm: now, atualizadoPor: me?.id }), { merge: true });
        }
        setEstado("salvo"); setTimeout(() => setEstado(""), 1800);
      }
      setLang("en");
    } catch (e) {
      setErroTrad(e instanceof Error ? e.message : "Falha ao traduzir.");
    } finally { setTraduzindo(false); }
  }

  // ── mutators ──────────────────────────────────────────────────────────────
  const setSec = (i: number, patch: Partial<SecaoCardapio>) => commit(secoes.map((s, j) => j === i ? { ...s, ...patch } : s));
  const addSecao = (nome = "") => commit([...secoes, { id: uid(), nome, pratos: [] }]);
  const removeSecao = (i: number) => commit(secoes.filter((_, j) => j !== i));
  const moveSecao = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= secoes.length) return;
    const n = [...secoes]; [n[i], n[j]] = [n[j]!, n[i]!]; commit(n);
  };
  const setPrato = (si: number, pi: number, patch: Partial<PratoCardapio>) =>
    setSec(si, { pratos: secoes[si]!.pratos.map((p, j) => j === pi ? { ...p, ...patch } : p) });
  const addPrato = (si: number) => setSec(si, { pratos: [...secoes[si]!.pratos, { id: uid(), titulo: "" }] });
  const removePrato = (si: number, pi: number) => setSec(si, { pratos: secoes[si]!.pratos.filter((_, j) => j !== pi) });
  const movePrato = (si: number, pi: number, dir: -1 | 1) => {
    const pratos = [...secoes[si]!.pratos]; const j = pi + dir;
    if (j < 0 || j >= pratos.length) return;
    [pratos[pi], pratos[j]] = [pratos[j]!, pratos[pi]!]; setSec(si, { pratos });
  };
  // Salva o título da capa POR cardápio (não no layout compartilhado).
  function salvarTituloCapa(v: string) {
    setTituloCapaMenu(v);
    if (!menuId || !podeEditar) return;
    if (tituloTimer.current) clearTimeout(tituloTimer.current);
    tituloTimer.current = window.setTimeout(async () => {
      const ref = doc(db, "cardapioEstruturado", rid);
      const snap = await getDoc(ref);
      const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
      const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, tituloCapa: v.trim() || undefined } : c);
      await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
    }, 600);
  }
  async function salvarMostrarGarrafa(v: boolean) {
    setMostrarGarrafa(v);
    if (!menuId || !podeEditar) return;
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
    const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, mostrarGarrafa: v || undefined } : c);
    await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
  }
  async function salvarGrupos(next: GrupoSite[]) {
    setGruposSite(next);
    if (!menuId || !podeEditar) return;
    const limpos = next
      .map((g) => ({ ...g, titulo: g.titulo.trim(), secaoIds: g.secaoIds.filter((id) => secoes.some((s) => s.id === id)) }))
      .filter((g) => g.secaoIds.length);
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
    const cardapios = (d?.cardapios || []).map((c) => c.id === menuId ? { ...c, gruposSite: limpos.length ? limpos : undefined } : c);
    await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
  }
  const addGrupo = () => void salvarGrupos([...gruposSite, { id: uid(), titulo: "", secaoIds: [] }]);
  const setGrupo = (i: number, patch: Partial<GrupoSite>) => void salvarGrupos(gruposSite.map((g, j) => j === i ? { ...g, ...patch } : g));
  const removeGrupo = (i: number) => void salvarGrupos(gruposSite.filter((_, j) => j !== i));
  const toggleSecaoGrupo = (i: number, secaoId: string) => {
    const g = gruposSite[i]!;
    const on = g.secaoIds.includes(secaoId);
    setGrupo(i, { secaoIds: on ? g.secaoIds.filter((x) => x !== secaoId) : [...g.secaoIds, secaoId] });
  };
  // Seções que não estão em nenhum grupo → viram chip individual no site.
  const secoesEmGrupo = new Set(gruposSite.flatMap((g) => g.secaoIds));

  // Edição direta de um prato pelo id (usada pela edição inline no preview do PDF).
  const editarPratoPorId = (pratoId: string, campo: keyof PratoCardapio, valor: string) =>
    commit(secoes.map((s) => ({ ...s, pratos: s.pratos.map((p) => p.id === pratoId ? { ...p, [campo]: valor.trim() || undefined } : p) })));

  if (carregando) return <div className="text-sm text-gray-500">Carregando cardápio…</div>;

  const inp = "px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-60";
  // Inputs com cor por tipo: seção = vermelho, prato = verde, descrição = azul.
  const inpBase = "px-2 py-1.5 text-sm rounded-lg border dark:text-gray-100 disabled:opacity-60";
  const inpSecao = `${inpBase} bg-rose-50 dark:bg-rose-950/25 border-rose-200 dark:border-rose-900/50`;
  const inpTitulo = `${inpBase} bg-emerald-50 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900/50`;
  const inpDesc = `${inpBase} bg-sky-50 dark:bg-sky-950/25 border-sky-200 dark:border-sky-900/50`;

  const en = lang === "en";
  const refCls = "text-[11px] text-gray-400 dark:text-gray-500 px-1";

  return (
    <div className="space-y-3">
      {/* Idiomas à esquerda · Ver PDF à direita */}
      {secoes.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden shrink-0">
            <button type="button" onClick={() => setLang("pt")} className={`text-[13px] px-2.5 py-1.5 font-medium ${!en ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>🇧🇷 PT</button>
            <button type="button" onClick={() => setLang("en")} className={`text-[13px] px-2.5 py-1.5 font-medium ${en ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>🇺🇸 EN</button>
          </div>
          {podeEditar && (
            <label className="text-[12px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap" title="Mostra o ícone de garrafa em TODOS os itens deste cardápio (tudo ou nada)">
              <input type="checkbox" checked={mostrarGarrafa} onChange={(e) => void salvarMostrarGarrafa(e.target.checked)} />
              🍾 Cardápio de vinhos
            </label>
          )}
          <span className="text-[12px] text-emerald-600 dark:text-emerald-400 ml-auto">
            {estado === "salvando" ? "salvando…" : estado === "salvo" ? "✓ salvo" : ""}
          </span>
          {podeEditar && (
            <button type="button" onClick={() => setMostrarVisual(true)}
              className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 shrink-0 font-medium">
              🎨 Ver PDF
            </button>
          )}
        </div>
      )}

      {/* Exibição no site: agrupa seções em chips navegáveis */}
      {podeEditar && secoes.length > 1 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">🔖 Chips no site</div>
            <button type="button" onClick={addGrupo} className="text-[12px] text-indigo-600 dark:text-indigo-400 font-medium">+ Juntar seções num chip</button>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">No site, o cliente navega o cardápio por chips. Sem configurar nada, <b>cada seção vira um chip</b>. Crie um chip aqui pra <b>juntar duas ou mais seções</b> sob um título só (ex.: Brasa + Acompanhamentos → “Brasa e Acompanhamentos”). Reaproveita os pratos que já existem.</p>
          {gruposSite.map((g, i) => (
            <div key={g.id} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input value={g.titulo} onChange={(e) => setGrupo(i, { titulo: e.target.value })} placeholder="Título do chip"
                  className="flex-1 text-[13px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
                <button type="button" onClick={() => removeGrupo(i)} className="text-[11px] text-gray-400 hover:text-rose-600 shrink-0">remover</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {secoes.map((s) => {
                  const on = g.secaoIds.includes(s.id);
                  const emOutro = secoesEmGrupo.has(s.id) && !on;
                  return (
                    <button key={s.id} type="button" disabled={emOutro} onClick={() => toggleSecaoGrupo(i, s.id)}
                      className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${on ? "bg-indigo-600 border-indigo-600 text-white" : emOutro ? "border-gray-200 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-400"}`}
                      title={emOutro ? "Já está em outro chip" : ""}>
                      {s.nome || "(sem nome)"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {gruposSite.length > 0 && secoes.some((s) => !secoesEmGrupo.has(s.id)) && (
            <p className="text-[11px] text-gray-400">As demais seções ({secoes.filter((s) => !secoesEmGrupo.has(s.id)).map((s) => s.nome || "(sem nome)").join(", ")}) aparecem como chips individuais.</p>
          )}
        </div>
      )}

      {/* Banner do modo inglês: traduz a partir do português */}
      {en && podeEditar && secoes.length > 0 && (() => {
        const emDia = !!traduzidoEm && traduzidoSig === sigPt(secoes);
        return (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12px] text-indigo-900 dark:text-indigo-200">
              Versão em inglês. {!traduzidoEm ? "Ainda não traduzido."
                : emDia ? `Tradução em dia (${new Date(traduzidoEm).toLocaleString("pt-BR")}).`
                : "O português mudou desde a última tradução — gere de novo."} Gere automático a partir do português e revise abaixo.
            </p>
            <button type="button" disabled={traduzindo || emDia} onClick={() => void traduzir()}
              title={emDia ? "Nada mudou no português desde a última tradução" : undefined}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50 shrink-0">
              {traduzindo ? "traduzindo…" : emDia ? "✓ Tradução atualizada" : "🌐 Traduzir a partir do português"}
            </button>
          </div>
        );
      })()}
      {erroTrad && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">⚠ {erroTrad}</div>}

      {secoes.length === 0 && (
        <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl space-y-3">
          <p className="text-sm text-gray-400">Nenhuma seção ainda.</p>
          {podeEditar && (
            <button type="button" onClick={() => addSecao()} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Adicionar seção</button>
          )}
        </div>
      )}

      {secoes.map((sec, si) => (
        <div key={sec.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-2">
          {/* Cabeçalho da seção */}
          {en ? (
            <div>
              <div className={refCls}>{sec.nome || "—"}</div>
              <input value={sec.nomeEn || ""} disabled={!podeEditar} onChange={(e) => setSec(si, { nomeEn: e.target.value || undefined })} placeholder="English — section name" className={`${inpSecao} w-full text-base font-bold`} />
              {sec.obs && (
                <>
                  <div className={`${refCls} mt-1 italic`}>{sec.obs}</div>
                  <input value={sec.obsEn || ""} disabled={!podeEditar} onChange={(e) => setSec(si, { obsEn: e.target.value || undefined })} placeholder="English — note" className={`${inp} w-full text-[12px] text-gray-500`} />
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input value={sec.nome} disabled={!podeEditar} onChange={(e) => setSec(si, { nome: e.target.value })} placeholder="Nome da seção (ex: Frios)" className={`${inpSecao} flex-1 text-base font-bold`} />
                {podeEditar && (
                  <div className="flex items-center gap-0.5 shrink-0 text-gray-400">
                    <button type="button" title="Subir" onClick={() => moveSecao(si, -1)} className="px-1.5 hover:text-gray-700">↑</button>
                    <button type="button" title="Descer" onClick={() => moveSecao(si, 1)} className="px-1.5 hover:text-gray-700">↓</button>
                    <button type="button" title="Remover seção" onClick={() => { if (confirm(`Remover a seção "${sec.nome}" e seus pratos?`)) removeSecao(si); }} className="px-1.5 hover:text-rose-600">🗑</button>
                  </div>
                )}
              </div>
              <input value={sec.obs || ""} disabled={!podeEditar} onChange={(e) => setSec(si, { obs: e.target.value || undefined })} placeholder="Observação da seção (opcional) — ex: consulte as opções do dia na lousa" className={`${inp} w-full text-[12px] text-gray-500`} />
            </>
          )}

          {/* Pratos */}
          <div className="space-y-1.5">
            {sec.pratos.map((p, pi) => (
              <div key={p.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-2 space-y-1">
                {en ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className={`${refCls} flex-1 truncate`}>{p.titulo || "—"}</div>
                      {p.preco && <span className="text-[12px] text-gray-400 shrink-0">{p.preco}</span>}
                    </div>
                    <textarea value={p.tituloEn || ""} disabled={!podeEditar} rows={2} onChange={(e) => setPrato(si, pi, { tituloEn: e.target.value || undefined })} placeholder="English — title (Enter = line break)" className={`${inpTitulo} w-full font-semibold resize-y`} />
                    {p.subtitulo && <div className={refCls}>{p.subtitulo}</div>}
                    <textarea value={p.subtituloEn || ""} disabled={!podeEditar} rows={2} onChange={(e) => setPrato(si, pi, { subtituloEn: e.target.value || undefined })} placeholder="English — description (Enter = quebra de linha)" className={`${inpDesc} w-full text-[12px] resize-y`} />
                  </>
                ) : (
                  // Coluna do ícone (à esquerda) + coluna do conteúdo (alinhada).
                  <div className="flex gap-2">
                    {podeEditar && (
                      <button type="button" title="Ícone do item" onClick={() => setIconePrato({ si, pi })}
                        className="shrink-0 w-9 h-9 mt-px flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                        {p.iconeUrl ? <img src={p.iconeUrl} alt="" className="w-5 h-5 object-contain" /> : p.iconeId ? <IconeCardapioView id={p.iconeId} size={18} /> : <span className="text-gray-300 text-sm">🖼</span>}
                      </button>
                    )}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Título (verde) — 2 linhas (Enter = quebra; ótimo pra nome de vinho) */}
                      <textarea value={p.titulo} disabled={!podeEditar} rows={2} onChange={(e) => setPrato(si, pi, { titulo: e.target.value })} placeholder="Nome do prato/vinho (Enter = quebra de linha)" className={`${inpTitulo} w-full font-semibold resize-y`} />
                      {/* Preço (com $) + checkbox taça + reordenar */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative w-28 shrink-0">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
                          <input value={p.preco || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { preco: e.target.value || undefined })} placeholder={mostrarGarrafa ? "garrafa" : "preço"} className={`${inpTitulo} w-full text-right pl-6`} />
                        </div>
                        {podeEditar && (
                          <label className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 cursor-pointer whitespace-nowrap">
                            <input type="checkbox" checked={!!p.taca} onChange={(e) => setPrato(si, pi, e.target.checked ? { taca: true } : { taca: undefined, precoTaca: undefined, tacaMl: undefined })} />
                            <TacaIcon size={13} /> taça
                          </label>
                        )}
                        {podeEditar && (
                          <div className="flex items-center gap-1 ml-auto text-gray-400">
                            <button type="button" title="Subir" onClick={() => movePrato(si, pi, -1)} className="w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-800">↑</button>
                            <button type="button" title="Descer" onClick={() => movePrato(si, pi, 1)} className="w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-800">↓</button>
                            <button type="button" title="Remover prato" onClick={() => removePrato(si, pi)} className="w-7 h-7 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30 hover:text-rose-600">✕</button>
                          </div>
                        )}
                      </div>
                      {mostrarGarrafa && (
                        <div className="relative w-24" title="Tamanho da garrafa (ml) — opcional, só pra garrafas não-padrão">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><GarrafaIcon size={13} /></span>
                          <input value={p.garrafaMl || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { garrafaMl: e.target.value.replace(/[^\d]/g, "") || undefined })} placeholder="ml (opc.)" className={`${inpTitulo} w-full text-right pl-7`} />
                        </div>
                      )}
                      {p.taca && (
                        <div className="flex items-center gap-2">
                          <div className="relative w-24 shrink-0">
                            <input value={p.tacaMl || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { tacaMl: e.target.value.replace(/[^\d]/g, "") || undefined })} placeholder="ml" className={`${inpTitulo} w-full text-right pr-6`} />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[11px] pointer-events-none">ml</span>
                          </div>
                          <div className="relative w-28">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"><TacaIcon size={13} /></span>
                            <input value={p.precoTaca || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { precoTaca: e.target.value || undefined })} placeholder="taça" className={`${inpTitulo} w-full text-right pl-7`} />
                          </div>
                        </div>
                      )}
                      {/* Descrição (azul) */}
                      <textarea value={p.subtitulo || ""} disabled={!podeEditar} rows={2} onChange={(e) => setPrato(si, pi, { subtitulo: e.target.value || undefined })} placeholder="Descrição (Enter = quebra de linha)" className={`${inpDesc} w-full text-[12px] resize-y`} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!en && podeEditar && (
            <button type="button" onClick={() => addPrato(si)} className="text-[12px] text-indigo-600 hover:underline">+ adicionar prato</button>
          )}
        </div>
      ))}

      {!en && podeEditar && secoes.length > 0 && (
        <button type="button" onClick={() => addSecao()} className="text-sm px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">+ Adicionar seção</button>
      )}

      {mostrarVisual && (
        <CardapioVisual rid={rid} menuId={menuId} secoes={secoes} mostrarGarrafa={mostrarGarrafa} nomeRestaurante={nomeRestaurante} nomeMenu={nomeMenu} tituloCapa={tituloCapaMenu} onTituloCapa={salvarTituloCapa} lang={lang} onEditarPrato={editarPratoPorId} onSecoes={(next) => commit(next)}
          sharedLayout={sharedLayout} menuLayoutProprio={menuLayoutProprio} menuLayout={menuLayout} onClose={() => setMostrarVisual(false)} />
      )}
      {iconePrato && (() => {
        const p = secoes[iconePrato.si]?.pratos[iconePrato.pi];
        if (!p) return null;
        return <IconePickerModal rid={rid} pratoId={p.id} value={{ iconeId: p.iconeId, iconeUrl: p.iconeUrl }}
          onChange={(v) => setPrato(iconePrato.si, iconePrato.pi, { iconeId: v.iconeId, iconeUrl: v.iconeUrl })}
          onClose={() => setIconePrato(null)} />;
      })()}
    </div>
  );
}
