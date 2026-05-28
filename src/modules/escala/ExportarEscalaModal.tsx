// ════════════════════════════════════════════════════════════════════════════
//  Modal — Exportar escala em PDF
//
//  Aberto pelo botão "Exportar PDF". Deixa escolher o recorte antes de baixar:
//    • Unidade (só em multi-unidades): uma específica ou todas.
//    • Área: uma específica ou todas (filtra pelas áreas que têm gente na
//      unidade escolhida).
//  Gera uma pré-visualização do PDF (iframe) que atualiza ao mudar o filtro, e
//  só baixa no clique. Antes esse export ignorava o filtro e exportava todo
//  mundo — agora o recorte é explícito e aparece no cabeçalho do PDF.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import type { jsPDF as JsPDFType } from "jspdf";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { gerarEscalaPDF } from "./gerarEscalaPDF";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import { pad2 } from "../../core/utils/date";
import { AREAS } from "../../core/types";
import type { Area, Cargo, Empregado, EscalaMes, ScheduleStatus, Unidade } from "../../core/types";

type Props = {
  ano: number;
  mes: number;
  versao: "prevista" | "real";
  restaurantNome: string;
  empregados: Empregado[];   // todos os ativos do mês
  cargos: Cargo[];
  escala: EscalaMes | null;
  usaMultiUnidades: boolean;
  unidades: Unidade[];       // unidades ativas (no escopo do usuário)
  onClose: () => void;
};

function slugify(s: string): string {
  // NFD decompõe acentos (é → e + combinante); o filtro [^a-z0-9] já remove os
  // combinantes, então não precisa de passo separado de diacríticos.
  return s.toLowerCase().normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function ExportarEscalaModal({
  ano, mes, versao, restaurantNome, empregados, cargos, escala, usaMultiUnidades, unidades, onClose,
}: Props) {
  const [unidadeSel, setUnidadeSel] = useState<string>("");   // "" = todas
  const [areaSel, setAreaSel] = useState<"" | Area>("");      // "" = todas
  const [gerando, setGerando] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [erro, setErro] = useState("");
  const docRef = useRef<JsPDFType | null>(null);
  const urlRef = useRef<string>("");

  const cargoMap = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c])), [cargos]);

  const empregadosFiltrados = useMemo(() => {
    let lista = empregados;
    if (unidadeSel) lista = lista.filter(e => e.unidadePadraoId === unidadeSel);
    if (areaSel) lista = lista.filter(e => cargoMap[e.cargoId]?.area === areaSel);
    return lista;
  }, [empregados, unidadeSel, areaSel, cargoMap]);

  // Áreas que têm pelo menos 1 empregado (considerando a unidade escolhida) —
  // evita oferecer área que sairia vazia.
  const areasDisponiveis = useMemo(() => {
    const base = unidadeSel ? empregados.filter(e => e.unidadePadraoId === unidadeSel) : empregados;
    const set = new Set<Area>();
    for (const e of base) { const a = cargoMap[e.cargoId]?.area; if (a) set.add(a); }
    return AREAS.filter(a => set.has(a));
  }, [empregados, unidadeSel, cargoMap]);

  const subtitulo = useMemo(() => {
    const parts: string[] = [];
    if (usaMultiUnidades) {
      parts.push(unidadeSel ? (unidades.find(u => u.id === unidadeSel)?.nome || "Unidade") : "Todas as unidades");
    }
    parts.push(areaSel || "Todas as áreas");
    return parts.join(" · ");
  }, [usaMultiUnidades, unidadeSel, areaSel, unidades]);

  // (Re)gera o PDF sempre que o recorte muda.
  useEffect(() => {
    let cancelled = false;
    async function gen() {
      setErro("");
      if (empregadosFiltrados.length === 0) {
        docRef.current = null;
        if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ""; }
        setPreviewUrl("");
        return;
      }
      setGerando(true);
      try {
        // Materializa células vazias com o status derivado do workSchedule —
        // mesma regra do export antigo, pra o PDF não sair com buracos.
        const fonte = versao === "real" ? (escala?.real || {}) : (escala?.prevista || {});
        const resolved: { [empId: string]: { [date: string]: ScheduleStatus } } = {};
        for (const e of empregadosFiltrados) {
          const cells = fonte[e.id] || {};
          const derivado = derivedScheduleForEmpregado(e, ano, mes);
          const final: { [d: string]: ScheduleStatus } = { ...cells };
          for (const date of Object.keys(derivado)) {
            if (final[date] === undefined) final[date] = derivado[date].status;
          }
          resolved[e.id] = final;
        }
        const doc = await gerarEscalaPDF({
          ano, mes, restaurantNome, empregados: empregadosFiltrados,
          cargos, prevista: resolved, versao, subtitulo,
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
  }, [empregadosFiltrados, ano, mes, restaurantNome, cargos, escala, versao, subtitulo]);

  // Revoga a última URL ao desmontar.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  function baixar() {
    if (!docRef.current) return;
    const tag = versao === "real" ? "praticada" : "prevista";
    const recorte = [
      usaMultiUnidades && unidadeSel ? slugify(unidades.find(u => u.id === unidadeSel)?.nome || "") : "",
      areaSel ? slugify(areaSel) : "",
    ].filter(Boolean).join("-");
    const nome = `escala-${tag}-${slugify(restaurantNome)}${recorte ? "-" + recorte : ""}-${ano}-${pad2(mes)}.pdf`;
    docRef.current.save(nome);
  }

  const selectCls = "px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-full";

  return (
    <Modal title="📄 Exportar escala em PDF" onClose={onClose} maxWidth="max-w-4xl">
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

        {/* Pré-visualização */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {empregadosFiltrados.length} empregado(s) · {subtitulo}
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
          ) : empregadosFiltrados.length === 0 ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Nenhum empregado nesse recorte.</span>
          ) : previewUrl ? (
            <iframe src={previewUrl} title="Pré-visualização da escala" className="w-full h-full bg-white" />
          ) : null}
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={baixar} disabled={gerando || empregadosFiltrados.length === 0 || !docRef.current}>
            ⬇️ Baixar PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}
