// Editor estruturado do cardápio (Fase 1). Seções → pratos (título + subtítulo
// + preço). Salva automático (debounce) em /cardapioEstruturado/{rid}. O site
// renderiza ao vivo quando o modo do cardápio é "editor".
import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { authHeader } from "../../core/firebase/idToken";
import { gerarCardapioPdf, gerarCardapioPdfSororoca } from "./shared/gerarCardapioPdf";
import type { CardapioEstruturado, SecaoCardapio, PratoCardapio } from "../../core/types";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// Cardápio atual do Sororoca (parse do PDF Canva — confira/ajuste, as colunas
// do PDF embaralham um pouco a ordem e a seção de alguns pratos).
const DADOS_SOROROCA: { nome: string; obs?: string; pratos: [string, string, string][] }[] = [
  { nome: "Frios", pratos: [
    ["ceviche de pescado", "e frutos do mar com leite de tigre de pipoca", "83"],
    ["tiradito com ovas de salmão", "e molho cítrico", "97"],
    ["crudo de peixe", "com gema de ovo e conserva de cogumelo e lula à dorê", "79"],
    ["salada de batata com polvo", "", "88"],
    ["peixe cru", "com laranja champanhe", "86"],
  ] },
  { nome: "Quentes", pratos: [
    ["caldinho de peixe", "", "24"],
    ["mini pastéis", "de palmito pupunha com tucupi · 4 und", "34"],
    ["bao de açaí", "servido com tucupi", "49"],
    ["guioza de camarão", "", "74"],
    ["arroz de tomate", "", "59"],
    ["bobó de camarão", "acompanha arroz e farofa da casa", "135"],
    ["mexilhões à escabeche", "com molho secreto · 2 ou 4 und", "46"],
    ["ostra no vapor", "com laranja champanhe", "44 | 74"],
  ] },
  { nome: "Brasa", pratos: [
    ["peixes na brasa", "consulte as opções do dia na lousa", ""],
    ["cogumelos grelhados na brasa", "com picles de limão, farofa de castanha e tomilho", "69"],
    ["palmito na brasa", "com azeite de alho e gema de ovo marinada", "78"],
    ["adicional de molho de tucupi com cogumelos e arroz", "", "46"],
    ["adicional de molho de moqueca e arroz", "", "46"],
  ] },
  { nome: "Acompanhamentos", pratos: [
    ["pirão de peixe", "", "29"],
    ["cuscuz de farinha d'água", "", "36"],
    ["salada de feijão manteiguinha", "", "38"],
    ["farofa da casa", "", "29"],
  ] },
  { nome: "Sobremesas", pratos: [
    ["mousse de chocolate", "com praliné de castanha de cajú e flor de sal", "46"],
    ["pavê de cupuaçu", "com crocante de chocolate", "42"],
    ["bolo maria isabel", "com creme de bacuri", "42"],
    ["ribeirinho araújo", "bananada com açaí, creme diplomata e merengue", "46"],
  ] },
];
function seedSororoca(): SecaoCardapio[] {
  return DADOS_SOROROCA.map((s) => ({
    id: uid(), nome: s.nome, ...(s.obs ? { obs: s.obs } : {}),
    pratos: s.pratos.map(([titulo, sub, preco]) => ({
      id: uid(), titulo, ...(sub ? { subtitulo: sub } : {}), ...(preco ? { preco } : {}),
    })),
  }));
}

export function CardapioEditor({ rid, podeEditar, nomeRestaurante, corPrimaria }: { rid: string; podeEditar: boolean; nomeRestaurante?: string; corPrimaria?: string }) {
  const { pessoa: me } = useAuth();
  const [secoes, setSecoes] = useState<SecaoCardapio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");
  const [traduzidoEm, setTraduzidoEm] = useState<string | undefined>(undefined);
  const [traduzindo, setTraduzindo] = useState(false);
  const [lang, setLang] = useState<"pt" | "en">("pt");
  const [erroTrad, setErroTrad] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancel = false;
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((snap) => {
      if (cancel) return;
      if (snap.exists()) {
        const d = snap.data() as CardapioEstruturado;
        setSecoes(d.secoes || []);
        setTraduzidoEm(d.traduzidoEm);
      } else if (podeEditar && /soror/i.test(nomeRestaurante || "")) {
        // Piloto Sororoca: já carrega o cardápio atual na primeira abertura.
        const seed = seedSororoca();
        setSecoes(seed);
        void setDoc(doc(db, "cardapioEstruturado", rid), sanitizeForFirestore({
          id: rid, restaurantId: rid, secoes: seed, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id,
        })).catch(() => {});
      } else {
        setSecoes([]);
      }
      setCarregando(false);
    });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);

  function commit(next: SecaoCardapio[], stampTraducao?: string) {
    setSecoes(next);
    if (!podeEditar) return;
    const stamp = stampTraducao ?? traduzidoEm; // preserva (setDoc sobrescreve o doc todo)
    setEstado("salvando");
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const payload: CardapioEstruturado = {
          id: rid, restaurantId: rid, secoes: next,
          atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id,
          ...(stamp ? { traduzidoEm: stamp } : {}),
        };
        await setDoc(doc(db, "cardapioEstruturado", rid), sanitizeForFirestore(payload));
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
      const now = new Date().toISOString();
      setTraduzidoEm(now);
      commit(next, now);
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

  if (carregando) return <div className="text-sm text-gray-500">Carregando cardápio…</div>;

  const inp = "px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-60";

  const en = lang === "en";
  const refCls = "text-[11px] text-gray-400 dark:text-gray-500 px-1";

  return (
    <div className="space-y-3">
      {/* Seletor de idioma + ações */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {secoes.length > 0 ? (
          <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
            <button type="button" onClick={() => setLang("pt")} className={`text-sm px-3 py-1.5 font-medium ${!en ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>🇧🇷 Português</button>
            <button type="button" onClick={() => setLang("en")} className={`text-sm px-3 py-1.5 font-medium ${en ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>🇺🇸 English</button>
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-emerald-600 dark:text-emerald-400 min-w-14 text-right">
            {estado === "salvando" ? "salvando…" : estado === "salvo" ? "✓ salvo" : ""}
          </span>
          {podeEditar && secoes.length > 0 && (
            <button type="button" onClick={() => {
              const nomeArq = `${(nomeRestaurante || "cardapio").toLowerCase().replace(/\s+/g, "-")}-cardapio${en ? "-en" : ""}.pdf`;
              if (/soror/i.test(nomeRestaurante || "")) void gerarCardapioPdfSororoca({ secoes, idioma: lang, nomeArquivo: nomeArq });
              else void gerarCardapioPdf({ secoes, titulo: nomeRestaurante || "Cardápio", corPrimaria, idioma: lang, nomeArquivo: nomeArq });
            }}
              className="text-[12px] px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              ⬇ PDF impressão{en ? " (EN)" : ""}
            </button>
          )}
        </div>
      </div>

      {/* Banner do modo inglês: traduz a partir do português */}
      {en && podeEditar && secoes.length > 0 && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12px] text-indigo-900 dark:text-indigo-200">
            Versão em inglês. {traduzidoEm ? `Traduzido em ${new Date(traduzidoEm).toLocaleString("pt-BR")}.` : "Ainda não traduzido."} Gere automático a partir do português e revise abaixo.
          </p>
          <button type="button" disabled={traduzindo} onClick={() => void traduzir()}
            className="text-[12px] px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50 shrink-0">
            {traduzindo ? "traduzindo…" : "🌐 Traduzir a partir do português"}
          </button>
        </div>
      )}
      {erroTrad && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">⚠ {erroTrad}</div>}

      {secoes.length === 0 && (
        <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl space-y-3">
          <p className="text-sm text-gray-400">Nenhuma seção ainda.</p>
          {podeEditar && (
            <div className="flex flex-wrap gap-2 justify-center">
              <button type="button" onClick={() => addSecao()} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Adicionar seção</button>
              <button type="button" onClick={() => commit(seedSororoca())} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">
                📥 Carregar cardápio do Sororoca (teste)
              </button>
            </div>
          )}
        </div>
      )}

      {secoes.map((sec, si) => (
        <div key={sec.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-2">
          {/* Cabeçalho da seção */}
          {en ? (
            <div>
              <div className={refCls}>{sec.nome || "—"}</div>
              <input value={sec.nomeEn || ""} disabled={!podeEditar} onChange={(e) => setSec(si, { nomeEn: e.target.value || undefined })} placeholder="English — section name" className={`${inp} w-full font-bold`} />
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
                <input value={sec.nome} disabled={!podeEditar} onChange={(e) => setSec(si, { nome: e.target.value })} placeholder="Nome da seção (ex: Frios)" className={`${inp} flex-1 font-bold`} />
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
                    <input value={p.tituloEn || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { tituloEn: e.target.value || undefined })} placeholder="English — title" className={`${inp} w-full font-semibold`} />
                    {p.subtitulo && <div className={refCls}>{p.subtitulo}</div>}
                    <input value={p.subtituloEn || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { subtituloEn: e.target.value || undefined })} placeholder="English — description" className={`${inp} w-full text-[12px] text-gray-500`} />
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <input value={p.titulo} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { titulo: e.target.value })} placeholder="Título do prato" className={`${inp} flex-1 font-semibold`} />
                      <input value={p.preco || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { preco: e.target.value || undefined })} placeholder="Preço" className={`${inp} w-24 text-right`} />
                      {podeEditar && (
                        <div className="flex items-center gap-0.5 shrink-0 text-gray-400">
                          <button type="button" title="Subir" onClick={() => movePrato(si, pi, -1)} className="px-1 hover:text-gray-700">↑</button>
                          <button type="button" title="Descer" onClick={() => movePrato(si, pi, 1)} className="px-1 hover:text-gray-700">↓</button>
                          <button type="button" title="Remover" onClick={() => removePrato(si, pi)} className="px-1 hover:text-rose-600">✕</button>
                        </div>
                      )}
                    </div>
                    <input value={p.subtitulo || ""} disabled={!podeEditar} onChange={(e) => setPrato(si, pi, { subtitulo: e.target.value || undefined })} placeholder="Subtítulo / descrição (opcional)" className={`${inp} w-full text-[12px] text-gray-500`} />
                  </>
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
    </div>
  );
}
