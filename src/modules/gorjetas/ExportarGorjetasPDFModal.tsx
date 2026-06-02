// ════════════════════════════════════════════════════════════════════════════
//  Modal — Exportar divisão de gorjetas em PDF
//
//  Igual ao da escala: seleciona unidade + área, pré-visualiza num iframe,
//  baixa no clique. Recebe as linhas JÁ calculadas pela DivisaoMesTab e
//  filtra in-memory — não refaz cálculo (gorjeta tem snapshot + split rules
//  complexas que já moram lá).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import type { jsPDF as JsPDFType } from "jspdf";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { gerarGorjetasPDF, type GorjetasPDFLinha } from "./gerarGorjetasPDF";
import { AREAS } from "../../core/types";
import type { Area, Empregado, Unidade } from "../../core/types";

// Versão "estendida" da linha — precisa do empregadoId pra filtrar por
// unidadePadrao. O DivisaoMesTab já tem isso.
type LinhaInput = GorjetasPDFLinha & {
  empregadoId: string;
};

type Props = {
  ano: number;
  mes: number;
  restaurantNome: string;
  linhas: LinhaInput[];
  empregados: Empregado[];
  unidades: Unidade[];
  usaMultiUnidades: boolean;
  // Totais GLOBAIS (não filtrados) usados como fallback quando "todas" está
  // selecionado. Quando filtra, recalcula a partir das linhas filtradas.
  totaisGlobais: { bruto: number; retencao: number; liquido: number; distribuido: number };
  diasLancados: number;
  // Estado inicial do filtro (vindo do header da página).
  unidadeInicial?: string;
  onClose: () => void;
};

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function ExportarGorjetasPDFModal({
  ano, mes, restaurantNome, linhas, empregados, unidades, usaMultiUnidades,
  totaisGlobais, diasLancados, unidadeInicial, onClose,
}: Props) {
  const [unidadeSel, setUnidadeSel] = useState<string>(unidadeInicial || "");
  const [areaSel, setAreaSel] = useState<"" | Area>("");
  const [gerando, setGerando] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [erro, setErro] = useState("");
  const docRef = useRef<JsPDFType | null>(null);
  const urlRef = useRef<string>("");

  const empById = useMemo(() => Object.fromEntries(empregados.map(e => [e.id, e])), [empregados]);

  const linhasFiltradas = useMemo(() => {
    let lista = linhas;
    if (unidadeSel) {
      lista = lista.filter(l => empById[l.empregadoId]?.unidadePadraoId === unidadeSel);
    }
    if (areaSel) {
      lista = lista.filter(l => l.area === areaSel);
    }
    return lista;
  }, [linhas, unidadeSel, areaSel, empById]);

  // Áreas que têm gente na unidade selecionada (não oferece áreas vazias).
  const areasDisponiveis = useMemo(() => {
    const base = unidadeSel
      ? linhas.filter(l => empById[l.empregadoId]?.unidadePadraoId === unidadeSel)
      : linhas;
    const set = new Set<Area>();
    for (const l of base) if (l.area) set.add(l.area as Area);
    return AREAS.filter(a => set.has(a));
  }, [linhas, unidadeSel, empById]);

  const subtitulo = useMemo(() => {
    const parts: string[] = [];
    if (usaMultiUnidades) {
      parts.push(unidadeSel
        ? (unidades.find(u => u.id === unidadeSel)?.nome || "Unidade")
        : "Todas as unidades",
      );
    }
    parts.push(areaSel || "Todas as áreas");
    return parts.join(" · ");
  }, [usaMultiUnidades, unidadeSel, areaSel, unidades]);

  // Totais: se filtro mudou o recorte, recalcula a partir das linhas. Se
  // está mostrando "todas", usa o totais global (mais preciso pq considera
  // snapshots de publicação).
  const totaisFiltrados = useMemo(() => {
    if (!unidadeSel && !areaSel) return totaisGlobais;
    const bruto = linhasFiltradas.reduce((s, l) => s + l.bruto, 0);
    const retencao = linhasFiltradas.reduce((s, l) => s + l.retencao, 0);
    const liquido = linhasFiltradas.reduce((s, l) => s + l.liquido, 0);
    return { bruto, retencao, liquido, distribuido: liquido };
  }, [unidadeSel, areaSel, linhasFiltradas, totaisGlobais]);

  // (Re)gera o PDF sempre que o recorte muda
  useEffect(() => {
    let cancelled = false;
    async function gen() {
      setErro("");
      if (linhasFiltradas.length === 0) {
        docRef.current = null;
        if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ""; }
        setPreviewUrl("");
        return;
      }
      setGerando(true);
      try {
        const doc = await gerarGorjetasPDF({
          ano, mes, restaurantNome, subtitulo,
          linhas: linhasFiltradas,
          totais: totaisFiltrados,
          diasLancados,
        });
        if (cancelled) return;
        docRef.current = doc;
        const blob = doc.output("blob");
        const novaUrl = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = novaUrl;
        setPreviewUrl(novaUrl);
      } catch (e) {
        if (!cancelled) setErro(e instanceof Error ? e.message : "Erro ao gerar PDF.");
      } finally {
        if (!cancelled) setGerando(false);
      }
    }
    gen();
    return () => { cancelled = true; };
  }, [linhasFiltradas, ano, mes, restaurantNome, subtitulo, totaisFiltrados, diasLancados]);

  // Revoga URL ao desmontar
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  function baixar() {
    if (!docRef.current) return;
    const recorte = [
      usaMultiUnidades && unidadeSel ? slugify(unidades.find(u => u.id === unidadeSel)?.nome || "") : "",
      areaSel ? slugify(areaSel) : "",
    ].filter(Boolean).join("-");
    const nome = `gorjetas-${slugify(restaurantNome)}${recorte ? "-" + recorte : ""}-${ano}-${String(mes).padStart(2, "0")}.pdf`;
    docRef.current.save(nome);
  }

  const selectCls = "px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-full";

  return (
    <Modal title="📄 Exportar gorjetas em PDF" onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className={`grid grid-cols-1 ${usaMultiUnidades ? "sm:grid-cols-2" : ""} gap-3`}>
          {usaMultiUnidades && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidade</label>
              <select
                className={selectCls}
                value={unidadeSel}
                onChange={(e) => { setUnidadeSel(e.target.value); setAreaSel(""); }}
              >
                <option value="">🏢 Todas as unidades</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área</label>
            <select
              className={selectCls}
              value={areaSel}
              onChange={(e) => setAreaSel(e.target.value as Area | "")}
            >
              <option value="">Todas as áreas</option>
              {areasDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {linhasFiltradas.length} empregado(s) · {subtitulo}
          </span>
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              ↗ abrir em nova aba
            </a>
          )}
        </div>

        <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 h-[55vh] flex items-center justify-center overflow-hidden">
          {gerando ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Gerando pré-visualização…</span>
          ) : linhasFiltradas.length === 0 ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Nenhum empregado nesse recorte.</span>
          ) : previewUrl ? (
            <iframe src={previewUrl} title="Pré-visualização do PDF de gorjetas" className="w-full h-full bg-white" />
          ) : null}
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={baixar} disabled={gerando || linhasFiltradas.length === 0 || !docRef.current}>
            ⬇️ Baixar PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}
