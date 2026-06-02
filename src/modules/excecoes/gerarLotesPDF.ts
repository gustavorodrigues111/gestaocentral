// Gera PDF consolidado de TODOS os lotes de ajuste pendentes — formato
// texto (igual à mensagem que vai pelo WhatsApp), uma seção por empregado.
// Pensado pra imprimir e usar como apoio em conversas presenciais.
//
// jsPDF + helvetica não suporta UTF-8 emoji/setas — `sanitize()` substitui
// caracteres problemáticos por equivalentes ASCII.

import type { jsPDF as JsPDFType } from "jspdf";
import type { LoteRascunhoDoc } from "../../core/excecoes/loteRascunho";
import { montarMensagemLoteAjuste } from "../../core/excecoes/loteAjusteWhats";
import { RULES_META } from "../../core/excecoes/rules";
import { pad2 } from "../../core/utils/date";

const TXT_DARK: [number, number, number] = [31, 41, 55];
const TXT_MUTED: [number, number, number] = [100, 116, 139];
const COR_AMBAR: [number, number, number] = [180, 83, 9]; // amber-700

export type LotePDFApontamento = {
  date: string;       // YYYY-MM-DD
  ruleId: string;
  description: string;
  detail?: string;
  batidas?: string;
};

export type LotePDFEmpregado = {
  empregadoId: string;
  nome: string;
  cpf?: string;
  apontamentos: LotePDFApontamento[];
  // Status do envio do lote
  lote?: LoteRascunhoDoc;
};

export type EmpresaResolveItem = {
  empregadoId: string;
  empregadoNome: string;
  cpf?: string;
  date: string;
  ruleId: string;
  description: string;
  detail?: string;
  batidas?: string;
};

export type GerarLotesPDFParams = {
  ano: number;
  mes: number;        // 1..12
  restaurantNome: string;
  empregados: LotePDFEmpregado[];
  // Apontamentos marcados como "empresa vai resolver na Sólides" — listados
  // numa seção compacta no fim do PDF pra quem for resolver direto.
  empresaResolve?: EmpresaResolveItem[];
};

// Substitui caracteres não suportados pelo Helvetica embutido do jsPDF
// (que só roda WinAnsi). Sem isso, vira "Ø=ÝP" ou similar no PDF.
function sanitize(s: string): string {
  if (!s) return "";
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/·/g, "*")
    .replace(/…/g, "...")
    .replace(/✓/g, "OK")
    .replace(/↻/g, "[re]")
    // Emojis comuns que aparecem nas mensagens
    .replace(/🕐/g, "")
    .replace(/📦/g, "")
    .replace(/📱/g, "")
    .replace(/🗣/g, "")
    .replace(/⏳/g, "")
    .replace(/⚠/g, "")
    .replace(/◐/g, "")
    .replace(/💬/g, "")
    .replace(/✗/g, "x")
    .replace(/👁/g, "")
    // Fallback: remove qualquer caractere fora do range Latin-1
    // (jsPDF Helvetica é WinAnsi/Latin-1)
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, "")
    .trim();
}

function fmtCpf(d: string | undefined): string {
  const x = (d || "").replace(/\D/g, "");
  if (x.length !== 11) return d || "";
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function fmtDataHoraIso(iso: string): string {
  try {
    const d = new Date(iso);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export async function gerarLotesPDF({
  ano, mes, restaurantNome, empregados, empresaResolve = [],
}: GerarLotesPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }] = await Promise.all([
    import("jspdf"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const MARGIN_X = 14;
  const MARGIN_TOP = 14;
  const MARGIN_BOTTOM = 14;

  let yCursor = MARGIN_TOP;

  function ensureSpace(linhasNecessarias: number, lineHeightMm = 4) {
    if (yCursor + linhasNecessarias * lineHeightMm > pageH - MARGIN_BOTTOM) {
      doc.addPage();
      yCursor = MARGIN_TOP;
    }
  }

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...TXT_DARK);
  doc.text(
    sanitize(`Pedidos de ajuste em aberto — ${NOMES_MES[mes - 1]}/${ano}`),
    MARGIN_X,
    yCursor,
  );
  yCursor += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TXT_MUTED);
  doc.text(sanitize(restaurantNome), MARGIN_X, yCursor);

  const agora = new Date();
  const stamp =
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ` +
    `${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
  doc.text(stamp, pageW - MARGIN_X, yCursor, { align: "right" });
  yCursor += 5;

  const totalApontamentos = empregados.reduce((s, e) => s + e.apontamentos.length, 0);
  doc.setFontSize(9);
  doc.text(
    `${empregados.length} empregado(s) · ${totalApontamentos} apontamento(s) pendente(s)`.replace(/·/g, "*"),
    MARGIN_X, yCursor,
  );
  yCursor += 7;

  // Linha divisória
  doc.setDrawColor(229, 231, 235);
  doc.line(MARGIN_X, yCursor, pageW - MARGIN_X, yCursor);
  yCursor += 6;

  // ── Uma seção por empregado ───────────────────────────────────────────
  for (let i = 0; i < empregados.length; i++) {
    const emp = empregados[i];

    // Nome
    ensureSpace(4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...TXT_DARK);
    doc.text(sanitize(emp.nome), MARGIN_X, yCursor);
    yCursor += 5;

    // CPF
    if (emp.cpf) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TXT_MUTED);
      doc.text(`CPF ${fmtCpf(emp.cpf)}`, MARGIN_X, yCursor);
      yCursor += 4;
    }

    // Status do envio
    if (emp.lote?.enviadoEm) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COR_AMBAR);
      const tipo = emp.lote.enviadoTipo === "presencial" ? "presencial" : "WhatsApp";
      doc.text(
        sanitize(`Enviado em ${fmtDataHoraIso(emp.lote.enviadoEm)} (${tipo})`),
        MARGIN_X, yCursor,
      );
      yCursor += 4;
      for (const r of emp.lote.reenvios || []) {
        const t = r.tipo === "presencial" ? "presencial" : "WhatsApp";
        doc.text(
          sanitize(`[reenviado] ${fmtDataHoraIso(r.em)} (${t})`),
          MARGIN_X, yCursor,
        );
        yCursor += 4;
      }
    } else if (emp.lote) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...TXT_MUTED);
      doc.text("Ainda nao enviado", MARGIN_X, yCursor);
      yCursor += 4;
    }
    yCursor += 1;

    // ── Mensagem em formato WhatsApp ─────────────────────────────────
    // Usa a MESMA função que monta a mensagem real do WhatsApp pra garantir
    // que o conteúdo do PDF é idêntico ao que o empregado recebe.
    const msg = montarMensagemLoteAjuste({
      empregadoNome: emp.nome,
      restNome: restaurantNome,
      apontamentos: emp.apontamentos,
    });
    const linhasMsg = msg.split("\n").map(sanitize);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...TXT_DARK);

    // Wrap manual por largura disponível
    const maxWidth = pageW - 2 * MARGIN_X;
    const LINE_H = 4.5;
    for (const linha of linhasMsg) {
      if (linha.length === 0) {
        // linha em branco — espaçamento simples
        ensureSpace(1, LINE_H);
        yCursor += LINE_H * 0.6;
        continue;
      }
      // splitTextToSize quebra automaticamente
      const wrapped = doc.splitTextToSize(linha, maxWidth) as string[];
      for (const w of wrapped) {
        ensureSpace(1, LINE_H);
        doc.text(w, MARGIN_X, yCursor);
        yCursor += LINE_H;
      }
    }

    yCursor += 4;
    // Linha divisória entre empregados (exceto última)
    if (i < empregados.length - 1) {
      ensureSpace(2);
      doc.setDrawColor(229, 231, 235);
      doc.line(MARGIN_X, yCursor, pageW - MARGIN_X, yCursor);
      yCursor += 6;
    }
  }

  if (empregados.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...TXT_MUTED);
    doc.text("Nenhum lote em aberto.", MARGIN_X, yCursor + 5);
  }

  // ── Seção: Empresa vai resolver na Sólides ──────────────────────────
  // Lista compacta agrupada por empregado, pra quem for entrar na Sólides
  // e ajustar direto. Vai em PÁGINA NOVA pra separar visualmente.
  if (empresaResolve.length > 0) {
    doc.addPage();
    yCursor = MARGIN_TOP;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...TXT_DARK);
    doc.text(
      sanitize("Empresa vai resolver na Solides"),
      MARGIN_X, yCursor,
    );
    yCursor += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...TXT_MUTED);
    doc.text(
      sanitize(
        "Apontamentos que a empresa marcou pra ajustar direto na Solides " +
        "(nao foram enviados ao empregado). Use esta lista pra fazer os " +
        "ajustes em lote no painel da Solides.",
      ),
      MARGIN_X, yCursor,
      { maxWidth: pageW - 2 * MARGIN_X },
    );
    yCursor += 8;

    doc.setDrawColor(229, 231, 235);
    doc.line(MARGIN_X, yCursor, pageW - MARGIN_X, yCursor);
    yCursor += 5;

    // Agrupa por empregado
    const porEmp = new Map<string, EmpresaResolveItem[]>();
    for (const it of empresaResolve) {
      const arr = porEmp.get(it.empregadoId) || [];
      arr.push(it);
      porEmp.set(it.empregadoId, arr);
    }
    const empsOrdenados = Array.from(porEmp.entries())
      .map(([id, itens]) => ({ id, nome: itens[0].empregadoNome, cpf: itens[0].cpf, itens }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    for (const e of empsOrdenados) {
      ensureSpace(4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...TXT_DARK);
      doc.text(sanitize(e.nome), MARGIN_X, yCursor);
      yCursor += 5;

      if (e.cpf) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...TXT_MUTED);
        doc.text(`CPF ${fmtCpf(e.cpf)}`, MARGIN_X, yCursor);
        yCursor += 4;
      }
      yCursor += 1;

      // Ordena itens por data ASC
      const itens = [...e.itens].sort((a, b) => a.date.localeCompare(b.date));
      const LINE_H = 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...TXT_DARK);

      for (const it of itens) {
        ensureSpace(3, LINE_H);
        const [y, m, d] = it.date.split("-");
        const dataBr = `${d}/${m}/${y}`;
        const ruleMeta = RULES_META[it.ruleId as keyof typeof RULES_META];
        const label = sanitize(ruleMeta?.label || it.ruleId);
        const linha1 = sanitize(`- ${dataBr}  ${label}`);
        doc.text(linha1, MARGIN_X, yCursor);
        yCursor += LINE_H;

        if (it.batidas) {
          doc.setFontSize(9);
          doc.setTextColor(...TXT_MUTED);
          const linha2 = sanitize(`   Batidas: ${it.batidas}`);
          const wrapped = doc.splitTextToSize(linha2, pageW - 2 * MARGIN_X - 4) as string[];
          for (const w of wrapped) {
            ensureSpace(1, LINE_H);
            doc.text(w, MARGIN_X, yCursor);
            yCursor += LINE_H;
          }
          doc.setFontSize(10);
          doc.setTextColor(...TXT_DARK);
        }
        if (it.detail || it.description) {
          doc.setFontSize(9);
          doc.setTextColor(...TXT_MUTED);
          const linha3 = sanitize(`   ${it.detail || it.description}`);
          const wrapped = doc.splitTextToSize(linha3, pageW - 2 * MARGIN_X - 4) as string[];
          for (const w of wrapped) {
            ensureSpace(1, LINE_H);
            doc.text(w, MARGIN_X, yCursor);
            yCursor += LINE_H;
          }
          doc.setFontSize(10);
          doc.setTextColor(...TXT_DARK);
        }
      }
      yCursor += 5;
    }
  }

  return doc;
}
