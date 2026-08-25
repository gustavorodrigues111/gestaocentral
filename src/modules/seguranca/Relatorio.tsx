// Relatório de uma avaliação FINALIZADA + geração de ações por inconformidade.
// Mostra nota/classificação, gráficos de não-conformes por bloco e por área, e a
// lista de inconformidades (por item×área). Cada não-conformidade vira uma AÇÃO
// (tarefa operacional) atribuída AO LÍDER DAQUELA ÁREA, com prazo = hoje, num
// clique. A partir daí a Segurança só ACOMPANHA o status (quem resolve é o líder,
// nas Tarefas dele — a ação já cai na Central de Avisos dele).
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import type {
  Tarefa, TarefaStatus,
  SegurancaAvaliacao, SegurancaResultadoItem,
} from "../../core/types";
import { TAREFA_STATUS_LABEL, segAreaCor, segurancaFaixaDe, segResParse, segLideresDe } from "../../core/types";
import { ouvirAvaliacao, salvarResultado, calcularScore, reabrirAvaliacao } from "./repository";
import { criarTarefaOperacional } from "../tarefas/repository";
import { SegurancaFotos } from "./SegurancaFotos";

const dmy = (ymd?: string | null) => (ymd || "").split("-").reverse().join("/");
const hojeYmd = () => new Date().toISOString().slice(0, 10);

const STATUS_PILL: Record<TarefaStatus, string> = {
  a_fazer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  em_andamento: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  concluida: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  cancelada: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
};

// Sufixo do refId que amarra uma ação a esta avaliação: `${av.id}:${resKey}`,
// onde resKey = segResKey(itemId, área) = `itemId::área`.
const refKeyDe = (avId: string, refId?: string | null) =>
  (refId || "").startsWith(avId + ":") ? (refId as string).slice(avId.length + 1) : null;

export function Relatorio({ avaliacaoId, autor, onClose, onVerPreenchimento }: {
  avaliacaoId: string;
  autor: { id: string; nome: string };
  onClose: () => void;
  onVerPreenchimento: () => void;
}) {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const [av, setAv] = useState<SegurancaAvaliacao | null>(null);
  const [acoes, setAcoes] = useState<Tarefa[]>([]);
  const [gerando, setGerando] = useState(false);
  const [exportando, setExportando] = useState(false);

  useEffect(() => ouvirAvaliacao(avaliacaoId, setAv), [avaliacaoId]);

  const rid = av?.restaurantId || "";
  const { can } = useCanAcao(rid);
  const podePreencher = isMaster || can("seguranca", "preencher");
  const podeGerar = isMaster || can("seguranca", "resolverAcoes");

  // Ações desta avaliação (filtro client-side por origem + refId).
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "tarefas"), where("origem", "==", "avaliacao_sanitaria")), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tarefa)
        .filter((a) => !a.deletadoEm && refKeyDe(avaliacaoId, a.origemRefId) != null);
      setAcoes(list);
    }, () => setAcoes([]));
  }, [rid, avaliacaoId]);

  const itens = useMemo(() => av?.itensSnapshot || [], [av]);
  const blocos = useMemo(() => (av?.blocosSnapshot || []).slice().sort((a, b) => a.ordem - b.ordem), [av]);
  const faixas = av?.faixasSnapshot || [];
  const areasLista = useMemo(() => (
    av?.areasSnapshot?.length ? av.areasSnapshot : Array.from(new Set(itens.flatMap((i) => i.areas || (i.area ? [i.area] : []))))
  ), [av?.areasSnapshot, itens]);
  const itemById = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);
  const blocoById = useMemo(() => new Map(blocos.map((b) => [b.id, b])), [blocos]);
  const responsaveisArea = av?.responsaveisAreaSnapshot || {};

  // Nota: usa a persistida se finalizada; senão recompute.
  const calc = useMemo(() => calcularScore(av?.resultado || {}, itens), [av?.resultado, itens]);
  const score = av?.status === "finalizada" && typeof av.score === "number" ? av.score : calc.score;
  const faixa = segurancaFaixaDe(score, faixas);
  const faixaLabel = av?.status === "finalizada" && av.faixaLabel ? av.faixaLabel : faixa?.label || "—";
  const cor = faixa?.cor || "#4f46e5";

  // Inconformidades (respostas não-conformes) ordenadas por área e bloco.
  const inconformidades = useMemo(() => {
    const out: Array<{ key: string; itemId: string; r: SegurancaResultadoItem; area?: string; blocoNome: string; texto: string }> = [];
    for (const [key, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const { itemId, area } = segResParse(key);
      const it = itemById.get(itemId);
      out.push({ key, itemId, r, area, blocoNome: blocoById.get(it?.blocoId || "")?.nome || "—", texto: it?.texto || "(item removido)" });
    }
    const areaOrder = (a?: string) => (a ? areasLista.indexOf(a) : 99);
    return out.sort((a, b) => areaOrder(a.area) - areaOrder(b.area) || a.blocoNome.localeCompare(b.blocoNome) || a.texto.localeCompare(b.texto));
  }, [av?.resultado, itemById, blocoById, areasLista]);

  // Não-conformes PONTUÁVEIS por bloco.
  const ncPorBloco = useMemo(() => {
    const m = new Map<string, number>();
    for (const [key, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const it = itemById.get(segResParse(key).itemId);
      if (!it || !it.pontua) continue;
      m.set(it.blocoId, (m.get(it.blocoId) || 0) + 1);
    }
    return blocos.map((b) => ({ nome: b.nome, n: m.get(b.id) || 0 })).filter((x) => x.n > 0);
  }, [av?.resultado, itemById, blocos]);

  // Não-conformes por área.
  const ncPorArea = useMemo(() => {
    const m = {} as Record<string, number>;
    for (const [key, r] of Object.entries(av?.resultado || {})) {
      if (r.resposta !== "nao_conforme") continue;
      const a = segResParse(key).area;
      if (a) m[a] = (m[a] || 0) + 1;
    }
    return areasLista.map((a) => ({ area: a, n: m[a] || 0 })).filter((x) => x.n > 0);
  }, [av?.resultado, areasLista]);

  const acaoPorKey = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const a of acoes) { const k = refKeyDe(avaliacaoId, a.origemRefId); if (k) m.set(k, a); }
    return m;
  }, [acoes, avaliacaoId]);

  const semAcao = useMemo(() => inconformidades.filter((i) => !acaoPorKey.has(i.key)), [inconformidades, acaoPorKey]);

  async function reabrir() {
    if (!av) return;
    if (!confirm("Reabrir esta avaliação para edição? A nota volta a ser parcial.")) return;
    await reabrirAvaliacao(av, autor);
    onVerPreenchimento();
  }

  // Cria a AÇÃO já atribuída aos líderes da área (1º = responsável, demais =
  // co-responsáveis), prazo = hoje. Sem nenhum líder → erro.
  async function criarAcao(inc: { key: string; area?: string; texto: string; r: SegurancaResultadoItem }): Promise<boolean> {
    if (!av) return false;
    const lideres = segLideresDe(responsaveisArea, inc.area);
    if (!lideres.length) {
      alert(`A área "${inc.area || "—"}" não tem líder definido. Defina o(s) líder(es) no ⚙ Checklist antes de gerar a ação.`);
      return false;
    }
    const [primeiro, ...resto] = lideres;
    const id = await criarTarefaOperacional({
      rid, titulo: inc.texto, descricao: inc.r.observacao || "",
      origem: "avaliacao_sanitaria", origemRefId: `${av.id}:${inc.key}`, origemRefLabel: inc.texto,
      prioridade: "normal", prazo: hojeYmd(),
      responsavelId: primeiro.id, responsavelNome: primeiro.nome,
      coResponsaveis: resto.map((l) => l.id), coResponsaveisNomes: resto.map((l) => l.nome),
      criadoPor: autor.id, criadoPorNome: autor.nome,
    });
    const cur = av.resultado?.[inc.key];
    if (cur) await salvarResultado(av.id, inc.key, { ...cur, acaoId: id });
    return true;
  }

  async function gerarTodas() {
    if (!av || semAcao.length === 0) return;
    setGerando(true);
    let semLider = 0;
    try {
      for (const i of semAcao) {
        if (!segLideresDe(responsaveisArea, i.area).length) { semLider++; continue; }
        await criarAcao(i);
      }
    } finally { setGerando(false); }
    if (semLider > 0) alert(`${semLider} inconformidade(s) ficaram sem ação: a área não tem líder definido. Configure no ⚙ Checklist.`);
  }

  async function exportarPdf() {
    if (!av) return;
    setExportando(true);
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const d = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = d.internal.pageSize.getWidth();
      const pageH = d.internal.pageSize.getHeight();
      const M = 14;
      const contentW = pageW - 2 * M;
      const bot = 16;                     // margem inferior útil (acima do rodapé)

      // Paleta
      type RGB = [number, number, number];
      const INK: RGB = [31, 41, 55], MUT: RGB = [107, 114, 128], FAINT: RGB = [160, 165, 175];
      const LINE: RGB = [228, 231, 236], CARD: RGB = [247, 246, 242];
      const ROSE: RGB = [214, 40, 71], EMER: RGB = [17, 145, 108];
      const acc = hexToRgb(cor);
      const tint = (c: RGB, k = 0.84): RGB => [Math.round(c[0] + (255 - c[0]) * k), Math.round(c[1] + (255 - c[1]) * k), Math.round(c[2] + (255 - c[2]) * k)];
      const dark = (c: RGB, k = 0.68): RGB => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
      const tc = (c: RGB) => d.setTextColor(c[0], c[1], c[2]);
      const fc = (c: RGB) => d.setFillColor(c[0], c[1], c[2]);
      const dcol = (c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
      const modeloNome = (av as { modeloNome?: string }).modeloNome || "";

      // ── Cabeçalho ──
      const hy = M, hh = 30;
      fc(CARD); d.roundedRect(M, hy, contentW, hh, 3, 3, "F");
      fc(acc); d.roundedRect(M, hy, 3, hh, 1.5, 1.5, "F");
      d.setFont("helvetica", "bold"); d.setFontSize(16); tc(INK);
      d.text("Relatório de Segurança Sanitária", M + 8, hy + 11);
      d.setFont("helvetica", "normal"); d.setFontSize(9.5); tc(MUT);
      d.text(`${av.avaliadorNome || "—"}   ·   ${dmy(av.data)}${modeloNome ? "   ·   " + modeloNome : ""}`, M + 8, hy + 18);
      if (av.status !== "finalizada") { d.setFontSize(8); tc([180, 120, 20]); d.text("Rascunho — nota parcial", M + 8, hy + 24.5); }
      // Selo de nota
      const bw = 44, bh = 22, bx = M + contentW - bw - 5, by = hy + 4;
      fc(acc); d.roundedRect(bx, by, bw, bh, 3, 3, "F");
      tc([255, 255, 255]); d.setFont("helvetica", "bold"); d.setFontSize(20);
      d.text(`${score}%`, bx + bw / 2, by + 11, { align: "center" });
      d.setFont("helvetica", "normal"); d.setFontSize(7.5);
      d.text(faixaLabel.toUpperCase(), bx + bw / 2, by + 17, { align: "center" });

      // ── KPIs ──
      let y = hy + hh + 6;
      const gap = 5, kw = (contentW - 2 * gap) / 3, kh = 18;
      const kpi = (x: number, label: string, val: number, c: RGB) => {
        dcol(LINE); d.setLineWidth(0.3); fc([255, 255, 255]);
        d.roundedRect(x, y, kw, kh, 2.5, 2.5, "FD");
        d.setFont("helvetica", "bold"); d.setFontSize(16); tc(c);
        d.text(String(val), x + 5, y + 9.5);
        d.setFont("helvetica", "normal"); d.setFontSize(8); tc(MUT);
        d.text(label, x + 5, y + 14.5);
      };
      kpi(M, "Conformes", calc.conformes, EMER);
      kpi(M + kw + gap, "Não-conformes", calc.naoConformes, ROSE);
      kpi(M + 2 * (kw + gap), "Itens pontuados", calc.respondidos, INK);
      y += kh + 9;

      // ── Não-conformes por área (barras) ──
      if (ncPorArea.length) {
        d.setFont("helvetica", "bold"); d.setFontSize(8.5); tc(FAINT);
        d.text("NÃO-CONFORMES POR ÁREA", M, y); y += 5;
        const maxA = Math.max(1, ...ncPorArea.map((x) => x.n));
        const labW = 42, barX = M + labW + 2, barW = contentW - labW - 12, rh = 6.4;
        for (const a of ncPorArea) {
          const ac = hexToRgb(segAreaCor(a.area).dot);
          d.setFont("helvetica", "normal"); d.setFontSize(8.5); tc(INK);
          d.text(d.splitTextToSize(a.area, labW)[0], M, y + 4.2);
          fc([237, 239, 243]); d.roundedRect(barX, y + 1, barW, rh - 2, 1, 1, "F");
          const w = Math.max(2, (a.n / maxA) * barW);
          fc(ac); d.roundedRect(barX, y + 1, w, rh - 2, 1, 1, "F");
          d.setFont("helvetica", "bold"); d.setFontSize(8.5); tc(INK);
          d.text(String(a.n), barX + barW + 3, y + 4.2);
          y += rh;
        }
        y += 5;
      }

      // ── Tabela de inconformidades ──
      d.setFont("helvetica", "bold"); d.setFontSize(8.5); tc(FAINT);
      d.text(`INCONFORMIDADES (${inconformidades.length})`, M, y); y += 2.5;
      if (inconformidades.length === 0) {
        y += 6; d.setFont("helvetica", "normal"); d.setFontSize(10); tc(EMER);
        d.text("Nenhuma inconformidade nesta avaliação.", M, y);
      } else {
        autoTable(d, {
          startY: y,
          head: [["Área", "Item", "Observação"]],
          body: inconformidades.map((i) => [i.area || "—", i.texto, i.r.observacao || ""]),
          theme: "striped",
          margin: { left: M, right: M, bottom: bot },
          styles: { font: "helvetica", fontSize: 8, cellPadding: 2, lineColor: LINE, lineWidth: 0.1, textColor: INK, valign: "top" },
          headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          columnStyles: { 0: { cellWidth: 34, cellPadding: { left: 6, top: 2, right: 2, bottom: 2 } }, 1: { cellWidth: 72 } },
          didDrawCell: (data) => {
            if (data.section === "body" && data.column.index === 0) {
              const area = (data.row.raw as string[])[0];
              if (area && area !== "—") { const c = hexToRgb(segAreaCor(area).dot); fc(c); d.circle(data.cell.x + 3, data.cell.y + 3.6, 1.1, "F"); }
            }
          },
        });
      }

      // ── Fotos por item ──
      // Normaliza cada foto num canvas (resolve EXIF + reexporta JPEG) — sem distorção.
      const carregarImagem = (url: string): Promise<{ dataUrl: string; w: number; h: number } | null> =>
        new Promise((resolve) => {
          fetch(url).then((r) => r.blob()).then((blob) => {
            const fr = new FileReader();
            fr.onload = () => {
              const src = String(fr.result || "");
              const img = new Image();
              img.onload = () => {
                try {
                  const maxSide = 1400;
                  const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
                  const scale = Math.min(1, maxSide / Math.max(nw, nh));
                  const cw = Math.max(1, Math.round(nw * scale)), ch = Math.max(1, Math.round(nh * scale));
                  const canvas = document.createElement("canvas");
                  canvas.width = cw; canvas.height = ch;
                  const ctx = canvas.getContext("2d");
                  if (!ctx) { resolve(null); return; }
                  ctx.drawImage(img, 0, 0, cw, ch);
                  let dataUrl = src;
                  try { dataUrl = canvas.toDataURL("image/jpeg", 0.85); } catch { /* mantém src */ }
                  resolve({ dataUrl, w: cw, h: ch });
                } catch { resolve(null); }
              };
              img.onerror = () => resolve(null);
              img.src = src;
            };
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
          }).catch(() => resolve(null));
        });

      // Pílula de área (dot + nome, tom pastel da cor da área)
      const chip = (x: number, cy: number, area?: string) => {
        const base: RGB = area ? hexToRgb(segAreaCor(area).dot) : MUT;
        const label = area || "sem área";
        d.setFont("helvetica", "bold"); d.setFontSize(8);
        const tw = d.getTextWidth(label);
        fc(tint(base)); d.roundedRect(x, cy - 3.4, tw + 8, 5.2, 2.6, 2.6, "F");
        fc(base); d.circle(x + 3, cy - 0.8, 1, "F");
        tc(dark(base)); d.text(label, x + 5.5, cy);
      };

      const comFotos = inconformidades.filter((i) => (i.r.fotos || []).some((f) => f.url));
      if (comFotos.length) {
        d.addPage();
        let py = M + 2;
        d.setFont("helvetica", "bold"); d.setFontSize(14); tc(INK);
        d.text("Fotos por item", M, py + 4); py += 11;
        const cw = (contentW - 6) / 2, maxH = 74;
        for (const i of comFotos) {
          const fotos = (i.r.fotos || []).filter((f) => f.url);
          if (py > pageH - bot - 34) { d.addPage(); py = M + 2; }
          chip(M, py + 1, i.area); py += 7;
          d.setFont("helvetica", "bold"); d.setFontSize(10); tc(INK);
          const t = d.splitTextToSize(i.texto, contentW);
          d.text(t, M, py); py += t.length * 5 + 1;
          if (i.r.observacao) {
            d.setFont("helvetica", "normal"); d.setFontSize(8.5); tc(MUT);
            const o = d.splitTextToSize(i.r.observacao, contentW);
            d.text(o, M, py); py += o.length * 4.2 + 2;
          }
          let col = 0, rowH = 0;
          for (const f of fotos) {
            const img = await carregarImagem(f.url as string);
            if (!img) continue;
            const ratio = (img.w || 1) / (img.h || 1);
            let dw = cw, dh = dw / ratio;
            if (dh > maxH) { dh = maxH; dw = dh * ratio; }
            if (py + dh > pageH - bot) {
              if (col === 1) { py += rowH + 5; col = 0; rowH = 0; }
              if (py + dh > pageH - bot) { d.addPage(); py = M + 2; col = 0; rowH = 0; }
            }
            const x = M + col * (cw + 6) + (cw - dw) / 2;   // centraliza na coluna
            try { d.addImage(img.dataUrl, "JPEG", x, py, dw, dh); } catch { continue; }
            dcol(LINE); d.setLineWidth(0.3); d.roundedRect(x, py, dw, dh, 1.2, 1.2, "S");   // moldura
            rowH = Math.max(rowH, dh); col++;
            if (col === 2) { py += rowH + 5; col = 0; rowH = 0; }
          }
          if (col === 1) { py += rowH + 5; }
          dcol(LINE); d.setLineWidth(0.2); d.line(M, py + 1, pageW - M, py + 1);
          py += 7;
        }
      }

      // ── Rodapé em todas as páginas ──
      const totalPg = d.getNumberOfPages();
      const now = new Date();
      const ger = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      for (let p = 1; p <= totalPg; p++) {
        d.setPage(p);
        dcol(LINE); d.setLineWidth(0.2); d.line(M, pageH - 10, pageW - M, pageH - 10);
        d.setFont("helvetica", "normal"); d.setFontSize(7.5); tc(FAINT);
        d.text("Segurança Sanitária", M, pageH - 6);
        d.text(`Gerado em ${ger}`, pageW / 2, pageH - 6, { align: "center" });
        d.text(`Página ${p}/${totalPg}`, pageW - M, pageH - 6, { align: "right" });
      }

      d.save(`seguranca-${av.data}.pdf`);
    } finally { setExportando(false); }
  }

  if (!av) return <p className="text-sm text-gray-500 py-16 text-center">Carregando avaliação…</p>;

  const maxBloco = Math.max(1, ...ncPorBloco.map((x) => x.n));
  const maxArea = Math.max(1, ...ncPorArea.map((x) => x.n));

  return (
    <div className="space-y-5 pb-6">
      {/* Cabeçalho */}
      <div className="space-y-3">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-sm inline-flex items-center gap-1">
          <span className="text-base leading-none">←</span> Voltar
        </button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Relatório da avaliação</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{av.avaliadorNome || "—"} · {dmy(av.data)}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => void exportarPdf()} disabled={exportando}>{exportando ? "Gerando…" : "⤓ PDF"}</Button>
            <Button variant="secondary" size="sm" onClick={onVerPreenchimento}>Ver preenchimento</Button>
            {podePreencher && <Button variant="secondary" size="sm" onClick={() => void reabrir()}>Reabrir</Button>}
          </div>
        </div>
      </div>

      {/* Badge grande de nota */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex items-center gap-5">
        <div className="shrink-0 w-24 h-24 rounded-2xl flex flex-col items-center justify-center tabular-nums"
          style={{ background: `color-mix(in srgb, ${cor} 14%, transparent)`, color: cor }}>
          <span className="text-3xl font-extrabold leading-none">{score}%</span>
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold" style={{ color: cor }}>{faixaLabel}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {calc.conformes} conforme(s) · <span className="text-rose-600 dark:text-rose-400 font-semibold">{calc.naoConformes} não-conforme(s)</span> · {calc.respondidos} pontuados
          </div>
          {av.status !== "finalizada" && <div className="text-[11px] mt-1 text-amber-600 dark:text-amber-400">Rascunho — nota parcial</div>}
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Não-conformes por bloco</div>
          {ncPorBloco.length === 0 ? <p className="text-sm text-gray-400 py-2">Nenhuma inconformidade pontuável. 🎉</p> : (
            <div className="space-y-2">
              {ncPorBloco.map((x) => (
                <div key={x.nome} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[12px] text-gray-600 dark:text-gray-300 truncate" title={x.nome}>{x.nome}</span>
                  <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded bg-rose-500/80" style={{ width: `${(x.n / maxBloco) * 100}%` }} />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">{x.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Não-conformes por área</div>
          {ncPorArea.length === 0 ? <p className="text-sm text-gray-400 py-2">Nenhuma inconformidade. 🎉</p> : (
            <div className="space-y-2">
              {ncPorArea.map((x) => (
                <div key={x.area} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[12px] text-gray-600 dark:text-gray-300 truncate">{x.area}</span>
                  <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${(x.n / maxArea) * 100}%`, background: segAreaCor(x.area).dot }} />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">{x.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Inconformidades + geração de ações */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Inconformidades ({inconformidades.length})
          </div>
          {podeGerar && semAcao.length > 0 && (
            <Button size="sm" onClick={() => void gerarTodas()} disabled={gerando}>
              {gerando ? "Gerando…" : `🎯 Gerar ações (${semAcao.length})`}
            </Button>
          )}
        </div>
        {inconformidades.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Nenhuma inconformidade nesta avaliação. 🎉</p>}
        <div className="space-y-2.5">
          {inconformidades.map((i) => {
            const lideres = segLideresDe(responsaveisArea, i.area);
            return (
              <div key={i.key} className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 p-3.5">
                <div className="flex items-start gap-2 flex-wrap">
                  <AreaChip area={i.area} />
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{i.blocoNome}</span>
                </div>
                <div className="text-[15px] leading-snug text-gray-900 dark:text-gray-100 mt-1.5">{i.texto}</div>
                {i.r.observacao && <div className="text-[13px] text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{i.r.observacao}</div>}
                {(i.r.fotos?.length || 0) > 0 && (
                  <div className="mt-2">
                    <SegurancaFotos disabled fotos={i.r.fotos || []} pastaLabel="" onChange={() => {}} />
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-rose-200/60 dark:border-rose-900/40">
                  {acaoPorKey.has(i.key)
                    ? <AcaoStatus acao={acaoPorKey.get(i.key)!} />
                    : podeGerar
                      ? <button type="button" onClick={() => void criarAcao(i)}
                          className="text-[13px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline text-left">
                          🎯 Virar ação{lideres.length ? ` → ${lideres.map((l) => l.nome).join(", ")}` : ""}
                        </button>
                      : <span className="text-[12px] text-gray-400">Sem ação vinculada.</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── Acompanhamento de uma ação vinculada (SÓ-LEITURA) ─────────────────────────
// Quem resolve é o líder, nas Tarefas dele. Aqui só mostramos o status.
function AcaoStatus({ acao }: { acao: Tarefa }) {
  const concluida = acao.status === "concluida";
  const resolvLog = concluida ? [...(acao.log || [])].reverse().find((l) => l.acao === "status_mudou") : null;
  const ultimoComentario = (acao.comentarios || []).slice(-1)[0];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_PILL[acao.status]}`}>{TAREFA_STATUS_LABEL[acao.status]}</span>
        <span className="text-gray-500 dark:text-gray-400">
          {[acao.responsavelNome || "sem responsável", ...(acao.coResponsaveisNomes || [])].join(", ")}
        </span>
        {acao.prazo && <span className="text-gray-500 dark:text-gray-400 tabular-nums">📅 {dmy(acao.prazo)}</span>}
      </div>
      {concluida && resolvLog && (
        <div className="text-[12px] text-emerald-700 dark:text-emerald-400">
          ✓ Resolvida em {dmy((resolvLog.em || "").slice(0, 10))}{resolvLog.autorNome ? ` por ${resolvLog.autorNome}` : ""}
        </div>
      )}
      {ultimoComentario && (
        <div className="text-[12px] text-gray-600 dark:text-gray-300">
          <span className="text-gray-400">“</span>{ultimoComentario.texto}<span className="text-gray-400">”</span>
          <span className="text-gray-400"> — {ultimoComentario.autorNome}</span>
        </div>
      )}
    </div>
  );
}

function AreaChip({ area }: { area?: string }) {
  if (!area) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400">sem área</span>;
  const c = segAreaCor(area);
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.fg}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />{area}
    </span>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const v = parseInt(n, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
