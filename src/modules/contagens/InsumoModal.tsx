import { useState, useEffect, type ReactNode } from "react";
import { Sparkles, Pencil, Trash2, ChevronDown } from "lucide-react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db, auth } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { UNIDADES_LABEL, UNIDADES_LISTA } from "../../core/types";
import type { Fornecedor, Insumo, UnidadeMedida } from "../../core/types";

// Opção de preço/pacote de UM fornecedor, ao juntar produtos diferentes.
export type OpcaoPreco = { fornecedor: string; precoPacote?: number; fator: number; unidade: UnidadeMedida };

type Props = {
  insumo: Insumo | null;
  fornecedores: Fornecedor[];
  restaurantId: string;
  // Categorias já usadas em outros insumos — entram nos chips junto das sugeridas.
  categoriasExistentes?: string[];
  // Reavaliar pela IA automaticamente ao abrir (usado no "Juntar" de sugestões,
  // pra a IA escolher nome/categoria/unidade mais adequados do produto unido).
  autoReavaliar?: boolean;
  // Nomes ORIGINAIS das notas (grafias antes da limpeza da IA) — pra comparar e
  // reavaliar do original. O 1º é o mais frequente (usado no "reavaliar do original").
  nomesOriginais?: string[];
  // Clicar numa grafia → abre a última nota onde ela aparece (anexo + itens).
  onVerNota?: (grafia: string) => void;
  // Ao JUNTAR produtos de fornecedores diferentes: opções de preço/pacote pra
  // escolher qual prevalece (uma por fornecedor/grupo).
  opcoesPreco?: OpcaoPreco[];
  // Unidades "outro" já usadas (ex.: "bandeja") — viram opções no seletor.
  unidadesCustom?: string[];
  // Pré-preenchimento ao criar (ex.: sugestão vinda do Recebimento).
  preset?: Partial<Insumo> | null;
  onExcluir?: (insumo: Insumo) => void;   // excluir de dentro do modo "ver"
  onClose: () => void;
};

const CATEGORIAS_SUGERIDAS = [
  "Bebidas", "Vinhos", "Cervejas", "Destilados",
  "Carnes", "Aves", "Peixes", "Hortifrúti", "Laticínios",
  "Mercearia", "Limpeza", "Descartáveis", "Outros",
];

export function InsumoModal({ insumo, fornecedores, restaurantId, categoriasExistentes, autoReavaliar, nomesOriginais, onVerNota, opcoesPreco, unidadesCustom, preset, onExcluir, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !insumo;
  const base = insumo ?? preset ?? null;   // ao criar, usa o preset da sugestão
  // Chips de categoria = sugeridas fixas + as já usadas em outros insumos (dedup).
  const catsChips = (() => {
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const vistos = new Set(CATEGORIAS_SUGERIDAS.map(norm));
    const extras = (categoriasExistentes || []).filter(c => { const k = norm(c); if (vistos.has(k)) return false; vistos.add(k); return true; });
    // "Outros" sempre por último.
    const semOutros = CATEGORIAS_SUGERIDAS.filter(c => c !== "Outros");
    return [...semOutros, ...extras, "Outros"];
  })();
  // Abre em modo VER quando é um insumo existente; editar entra pelo botão.
  const [modo, setModo] = useState<"ver" | "editar">(insumo ? "ver" : "editar");

  const [nome, setNome] = useState(base?.nome || "");
  const [categoria, setCategoria] = useState(base?.categoria || "");
  const [catCustom, setCatCustom] = useState<boolean>(!!base?.categoria && !catsChips.includes(base.categoria));
  const fieldCls = "w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  const [unidade, setUnidade] = useState<UnidadeMedida>(base?.unidade || "un");
  const [unidadeOutro, setUnidadeOutro] = useState(base?.unidadeOutroLabel || "");
  const [minStock, setMinStock] = useState(base?.minStock != null ? String(base.minStock) : "");
  // Fornecedor por NOME (combobox) — funciona mesmo antes de o fornecedor virar
  // cadastro; é criado/casado ao salvar. Default = primário do preset/insumo.
  const nomePrefInicial = (() => {
    const prim = base?.fornecedores?.find((f) => f.primario) || base?.fornecedores?.[0];
    if (prim?.nome) return prim.nome;
    if (base?.fornecedorPreferredId) return fornecedores.find((f) => f.id === base.fornecedorPreferredId)?.nome || "";
    return "";
  })();
  const [fornecedorNome, setFornecedorNome] = useState<string>(nomePrefInicial);
  const fornOpcoes = (() => {
    const set = new Set<string>(fornecedores.map((f) => f.nome));
    for (const f of (base?.fornecedores || [])) if (f.nome) set.add(f.nome);
    return [...set].sort((a, b) => a.localeCompare(b));
  })();
  const [fatorCompra, setFatorCompra] = useState(base?.fatorCompra != null ? String(base.fatorCompra) : "");
  // Preço sempre com 2 casas (vírgula): "25" → "25,00".
  const fmtPreco2 = (v: string) => { const n = parseFloat(v.replace(",", ".")); return isNaN(n) ? v : n.toFixed(2).replace(".", ","); };
  // precoEstimado = preço UNITÁRIO (é o que fica salvo, usado nas fichas/CMV).
  const [precoEstimado, setPrecoEstimado] = useState(base?.precoEstimado != null ? base.precoEstimado.toFixed(2).replace(".", ",") : "");
  // "Comprado em pacote": entra o preço do PACOTE (como vem do recebimento) e a
  // qtd por pacote → o unitário é o pacote ÷ qtd. precoPacote é só de entrada.
  const [ehPacote, setEhPacote] = useState<boolean>((base?.fatorCompra ?? 1) > 1);
  const [precoPacote, setPrecoPacote] = useState(
    base?.precoEstimado != null && (base?.fatorCompra ?? 1) > 1
      ? (base.precoEstimado * (base.fatorCompra as number)).toFixed(2).replace(".", ",")
      : ""
  );
  // Unitário derivado no modo pacote (preço do pacote ÷ qtd por pacote).
  const unitDoPacote = (() => {
    const f = parseInt(fatorCompra) || 0;
    const pp = parseFloat(precoPacote.replace(",", "."));
    return ehPacote && f > 0 && !isNaN(pp) ? pp / f : null;
  })();
  const [ativo, setAtivo] = useState(insumo?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [revisandoIa, setRevisandoIa] = useState(false);
  // Unidades "outro" já usadas (ex.: bandeja) → viram opções. Valor da opção custom = "outro::<label>".
  const unidCustomList = [...new Set((unidadesCustom || []).map(s => s.trim()).filter(Boolean))];
  const selUnidVal = unidade === "outro" && unidadeOutro.trim() && unidCustomList.some(c => c.toLowerCase() === unidadeOutro.trim().toLowerCase()) ? `outro::${unidadeOutro.trim()}` : unidade;
  const mostrarDescricaoOutro = selUnidVal === "outro";   // "+ Nova unidade" escolhida → pede o texto
  // Ao juntar fornecedores diferentes: qual opção de preço/pacote prevalece.
  const [opcaoSel, setOpcaoSel] = useState(0);
  function aplicarOpcao(i: number) {
    const o = opcoesPreco?.[i]; if (!o) return;
    setOpcaoSel(i);
    const precoStr = o.precoPacote != null ? o.precoPacote.toFixed(2).replace(".", ",") : "";
    if (o.fator > 1) { setEhPacote(true); setFatorCompra(String(o.fator)); setPrecoPacote(precoStr); }
    else { setEhPacote(false); setPrecoEstimado(precoStr); }
    if (o.fornecedor) setFornecedorNome(o.fornecedor);
  }

  // Reavaliação sob demanda: reroda a IA neste produto pra confirmar/ajustar
  // categoria e unidade. Não roda sozinho — a leitura já vem do cache das
  // sugestões; isto é o botão "Reavaliar pela IA" pra uma revisão final.
  async function reavaliarIa(sourceName?: string) {
    const alvo = (sourceName ?? nome).trim();
    if (!alvo) return;
    setRevisandoIa(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/contagens-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, produtos: [{ chave: alvo, nome: alvo, unidadeAtual: unidade }], jaCadastrados: [] }) });
      const j = await r.json() as { itens?: Array<{ nomeLimpo?: string; qtdPorPacote?: number; categoria?: string; unidade?: string }> };
      const it = j?.itens?.[0];
      if (it) {
        if (it.nomeLimpo?.trim()) setNome(it.nomeLimpo.trim());
        if (it.categoria) setCategoria(it.categoria);
        const ehPct = !!(it.qtdPorPacote && it.qtdPorPacote > 1);
        const pacoteLike = (u: string) => u === "pct" || u === "cx" || u === "fardo";
        // Unidade = a de DENTRO do pacote; nunca "pacote/caixa/fardo" quando é pacote.
        if (it.unidade && (UNIDADES_LISTA as string[]).includes(it.unidade)) {
          setUnidade(ehPct && pacoteLike(it.unidade) ? "un" : (it.unidade as UnidadeMedida));
        } else if (ehPct && pacoteLike(unidade)) {
          setUnidade("un");
        }
        // Pacote → marca "comprado em pacote" + qtd por pacote; o unitário sai da divisão.
        if (ehPct) {
          setEhPacote(true);
          setFatorCompra(String(Math.round(it.qtdPorPacote as number)));
          // Semeia o preço do PACOTE com o valor carregado (que vem como preço do pacote).
          if (!precoPacote.trim() && precoEstimado.trim()) setPrecoPacote(precoEstimado);
        }
      }
    } catch { /* silencioso */ } finally { setRevisandoIa(false); }
  }

  // Junção de sugestões: reavalia pela IA 1x ao abrir (nome/categoria/unidade do produto unido).
  useEffect(() => {
    if (autoReavaliar && isNew && nome.trim()) void reavaliarIa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (unidade === "outro" && !unidadeOutro.trim()) { setErr("Descreva a unidade ('outro')"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const min = minStock.trim() ? parseFloat(minStock.replace(",", ".")) : undefined;
      // Modo pacote: fator = qtd/pacote; unitário = preço do pacote ÷ fator.
      // Modo avulso: sem fator; preço é o unitário digitado direto.
      const fatorNum = ehPacote ? (parseInt(fatorCompra) || 0) : 0;
      const fator = ehPacote && fatorNum > 1 ? fatorNum : undefined;
      const preco = ehPacote
        ? (unitDoPacote != null ? Math.round(unitDoPacote * 100) / 100 : undefined)
        : (precoEstimado.trim() ? parseFloat(precoEstimado.replace(",", ".")) : undefined);

      // Resolve o fornecedor preferencial pelo NOME: casa com um existente ou cria.
      let fornPrefId: string | null = null;
      const fn = fornecedorNome.trim();
      if (fn) {
        const nf = fn.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
        const existente = fornecedores.find((f) => f.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase() === nf);
        if (existente) fornPrefId = existente.id;
        else { const ref = await addDoc(collection(db, "fornecedores"), sanitizeForFirestore({ restaurantId, nome: fn, ativo: true, criadoEm: now, criadoPor: me.id })); fornPrefId = ref.id; }
      }

      const payload: Omit<Insumo, "id"> = {
        restaurantId,
        nome: nome.trim(),
        categoria: categoria.trim() || undefined,
        unidade,
        unidadeOutroLabel: unidade === "outro" ? unidadeOutro.trim() : undefined,
        minStock: min !== undefined && !isNaN(min) ? min : undefined,
        // aliases + fornecedores (multi-fornecedor) vêm do preset/insumo e passam direto.
        aliases: base?.aliases,
        fornecedores: base?.fornecedores,
        fornecedorPreferredId: fornPrefId,
        fatorCompra: fator !== undefined && !isNaN(fator) && fator > 0 ? fator : undefined,
        precoEstimado: preco !== undefined && !isNaN(preco) ? preco : undefined,
        ativo,
        ordem: insumo?.ordem,
        criadoEm: insumo?.criadoEm || now,
        criadoPor: insumo?.criadoPor || me.id,
        atualizadoEm: now,
      };
      if (isNew) {
        await addDoc(collection(db, "insumos"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "insumos", insumo.id), sanitizeForFirestore(payload));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // ── Modo VER — detalhes read-only + Editar/Excluir dentro do modal ──
  if (modo === "ver" && insumo) {
    const unidLabel = insumo.unidade === "outro" ? (insumo.unidadeOutroLabel || "outro") : UNIDADES_LABEL[insumo.unidade];
    const fornLista = (insumo.fornecedores && insumo.fornecedores.length ? insumo.fornecedores.map((f) => f.nome) : []);
    const fornPref = insumo.fornecedorPreferredId ? fornecedores.find((f) => f.id === insumo.fornecedorPreferredId)?.nome : null;
    const Row = ({ label, children }: { label: string; children: ReactNode }) => (
      <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        <span className="text-sm text-gray-900 dark:text-gray-100 text-right">{children}</span>
      </div>
    );
    return (
      <Modal title={insumo.nome} onClose={onClose} maxWidth="max-w-lg">
        <div className="space-y-1">
          <Row label="Categoria">{insumo.categoria || "—"}</Row>
          <Row label="Unidade (contagem)">{unidLabel}</Row>
          {insumo.fatorCompra && insumo.fatorCompra > 1 && <Row label="Pacote de compra">{insumo.fatorCompra} un</Row>}
          <Row label="Estoque mínimo">{insumo.minStock != null ? insumo.minStock : "—"}</Row>
          <Row label="Preço estimado">{insumo.precoEstimado != null ? `R$ ${insumo.precoEstimado.toFixed(2)}/un${insumo.fatorCompra && insumo.fatorCompra > 1 ? ` · pacote R$ ${(insumo.precoEstimado * insumo.fatorCompra).toFixed(2)}` : ""}` : "—"}</Row>
          <Row label="Fornecedor(es)">{fornLista.length ? fornLista.join(", ") : (fornPref || "—")}</Row>
          {insumo.aliases && insumo.aliases.length > 0 && <Row label="Reconhece na nota como"><span className="text-[11px] text-gray-500">{insumo.aliases.length} nome(s)</span></Row>}
          <Row label="Status">{insumo.ativo ? "Ativo" : "Inativo"}</Row>
        </div>
        <div className="flex items-center gap-2 pt-4 mt-2 border-t border-gray-200 dark:border-gray-800">
          {onExcluir && <Button variant="danger" onClick={() => { onExcluir(insumo); onClose(); }}><span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Excluir</span></Button>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={() => setModo("editar")}><span className="inline-flex items-center gap-1.5"><Pencil size={14} /> Editar</span></Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={isNew ? "+ Novo insumo" : `Editar — ${insumo.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Vinho Malbec, Detergente, Filé Mignon"
          autoFocus
        />
        {isNew && (nomesOriginais?.length ?? 0) > 0 && (() => {
          const orig0 = nomesOriginais![0];
          const difere = orig0.trim().toLowerCase() !== nome.trim().toLowerCase() || nomesOriginais!.length > 1;
          return (
            <div className="-mt-1.5 bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 rounded-md px-2.5 py-1.5 space-y-1">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-amber-800 dark:text-amber-300">
                  {nomesOriginais!.length > 1 ? `Nomes na nota (${nomesOriginais!.length}):` : "Original da nota:"}{" "}
                  {nomesOriginais!.map((o, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : ""}
                      {onVerNota
                        ? <button type="button" onClick={() => onVerNota(o)} title="Ver a última nota onde aparece (anexo + itens)" className="font-semibold underline decoration-dotted hover:text-indigo-600 dark:hover:text-indigo-400">{o}</button>
                        : <b>{o}</b>}
                    </span>
                  ))}
                </span>
                {difere && (
                  <div className="inline-flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => setNome(orig0)} className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline">usar original</button>
                    <button type="button" disabled={revisandoIa} onClick={() => void reavaliarIa(orig0)} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 disabled:opacity-60"><Sparkles size={11} /> reavaliar do original</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Categoria</label>
            <button type="button" onClick={() => void reavaliarIa()} disabled={revisandoIa} className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:underline inline-flex items-center gap-1 disabled:opacity-60">
              <Sparkles size={10} /> {revisandoIa ? "reavaliando…" : "Reavaliar pela IA"}
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mt-1.5 mb-1.5">
            {catsChips.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { setCategoria(c === categoria ? "" : c); setCatCustom(false); }}
                className={`px-1 py-1 text-[11px] rounded-lg border text-center truncate transition-colors ${
                  categoria === c && !catCustom
                    ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setCatCustom(true); if (catsChips.includes(categoria)) setCategoria(""); }}
              className={`px-1 py-1 text-[11px] rounded-lg border border-dashed text-center transition-colors ${catCustom ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}
            >
              + Nova
            </button>
          </div>
          {catCustom && <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="nome da nova categoria" autoFocus />}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidade *</label>
            <div className="relative mt-1">
              <select
                value={selUnidVal}
                onChange={(e) => { const v = e.target.value; if (v.startsWith("outro::")) { setUnidade("outro"); setUnidadeOutro(v.slice(7)); } else if (v === "outro") { setUnidade("outro"); setUnidadeOutro(""); } else setUnidade(v as UnidadeMedida); }}
                className="appearance-none w-full px-3 py-2 pr-9 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:border-indigo-400"
              >
                {UNIDADES_LISTA.filter(u => u !== "outro").map(u => <option key={u} value={u}>{UNIDADES_LABEL[u]}</option>)}
                {unidCustomList.map(c => <option key={"c:" + c} value={`outro::${c}`}>{c}</option>)}
                <option value="outro">+ Nova unidade…</option>
              </select>
              <ChevronDown size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
          {mostrarDescricaoOutro && (
            <Input
              label="Nome da nova unidade *"
              value={unidadeOutro}
              onChange={(e) => setUnidadeOutro(e.target.value)}
              placeholder="ex: bandeja, dúzia"
            />
          )}
          {!mostrarDescricaoOutro && (
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Estoque mínimo</label>
              <input inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0 = sem alerta" className={fieldCls} />
            </div>
          )}
        </div>

        {mostrarDescricaoOutro && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Estoque mínimo</label>
            <input inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0 = sem alerta" className={fieldCls} />
          </div>
        )}

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Compra
          </label>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fornecedor preferencial</label>
              <input
                list="forn-modal-sug"
                value={fornecedorNome}
                onChange={(e) => setFornecedorNome(e.target.value)}
                placeholder="escolher ou digitar fornecedor…"
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
              />
              <datalist id="forn-modal-sug">{fornOpcoes.map((n) => <option key={n} value={n} />)}</datalist>
              <p className="text-[10px] text-gray-400 mt-1">Escolhe um existente ou digita um novo — ele é criado ao salvar.</p>
            </div>

            {(opcoesPreco?.length ?? 0) > 1 && (
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/15 p-2.5 space-y-1.5">
                <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Qual preço prevalece? (fornecedores diferentes)</div>
                <div className="space-y-1">
                  {opcoesPreco!.map((o, i) => (
                    <label key={i} className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="opcaoPreco" checked={opcaoSel === i} onChange={() => aplicarOpcao(i)} />
                      <span className="text-gray-800 dark:text-gray-100">
                        <b>{o.fornecedor || "—"}</b> · {o.precoPacote != null ? `R$ ${o.precoPacote.toFixed(2).replace(".", ",")}` : "sem preço"}
                        {o.fator > 1 ? <span className="text-gray-500"> — pacote {o.fator}× (unid. R$ {o.precoPacote != null ? (o.precoPacote / o.fator).toFixed(2).replace(".", ",") : "—"})</span> : <span className="text-gray-500"> — avulso</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={ehPacote} onChange={(e) => {
                const on = e.target.checked;
                // Carrega o "preço visível" entre os modos: ao marcar, o preço da
                // unidade vira preço do pacote; ao desmarcar, o preço do pacote vira
                // o preço da unidade única (sem divisão). Corrige o preço dividido "preso".
                if (on) { if (precoEstimado.trim() && !precoPacote.trim()) setPrecoPacote(precoEstimado); }
                else { if (precoPacote.trim()) setPrecoEstimado(precoPacote); }
                setEhPacote(on);
              }} />
              <span className="font-medium">Comprado em pacote</span>
              <span className="text-xs text-gray-500">(fardo/caixa com várias unidades)</span>
            </label>

            {ehPacote ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidades por pacote</label>
                    <input inputMode="numeric" value={fatorCompra} onChange={(e) => setFatorCompra(e.target.value.replace(/[^\d]/g, ""))} placeholder="ex: 24" className={fieldCls} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Preço do pacote</label>
                    <div className="mt-1 flex items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden focus-within:border-indigo-400">
                      <span className="px-2.5 py-2 text-sm text-gray-400 bg-gray-50 dark:bg-gray-800">R$</span>
                      <input inputMode="decimal" value={precoPacote} onChange={(e) => setPrecoPacote(e.target.value.replace(/[^\d.,]/g, ""))} onBlur={() => setPrecoPacote(fmtPreco2)} placeholder="0,00" className="flex-1 px-2 py-2 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100 text-right tabular-nums" />
                    </div>
                  </div>
                </div>
                <div className="rounded-lg bg-indigo-50/60 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900 px-3 py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300">Preço unitário {(parseInt(fatorCompra) || 0) > 0 && <span className="text-[11px] text-gray-400">(pacote ÷ {parseInt(fatorCompra)})</span>}</span>
                  <strong className="text-indigo-700 dark:text-indigo-300 tabular-nums">{unitDoPacote != null ? `R$ ${unitDoPacote.toFixed(2)}` : "—"}</strong>
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Preço por unidade</label>
                <div className="mt-1 flex items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden focus-within:border-indigo-400">
                  <span className="px-2.5 py-2 text-sm text-gray-400 bg-gray-50 dark:bg-gray-800">R$</span>
                  <input inputMode="decimal" value={precoEstimado} onChange={(e) => setPrecoEstimado(e.target.value.replace(/[^\d.,]/g, ""))} onBlur={() => setPrecoEstimado(fmtPreco2)} placeholder="0,00" className="flex-1 px-2 py-2 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100 text-right tabular-nums" />
                </div>
              </div>
            )}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer pt-2 border-t border-gray-200 dark:border-gray-800">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Insumo ativo</span>
          <span className="text-xs text-gray-500">(inativo não aparece nas contagens nem nas sugestões)</span>
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
