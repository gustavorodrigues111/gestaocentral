// ════════════════════════════════════════════════════════════════════════════
//  Exportação da ficha de admissão pra XLSX no formato "ficha modelo"
//  (similar ao da Senador Contábil): layout de formulário em A4, cabeçalho,
//  faixas de seção coloridas, label/valor em 2 colunas pareadas. Lista de
//  dependentes/transporte aparece inline. Checklist de docs em aba separada.
// ════════════════════════════════════════════════════════════════════════════

import XLSX from "xlsx-js-style";
import type { Admissao, Cargo, FormField, Restaurant } from "../types";
import { getTemplate, renderTemplate } from "./admissaoHelpers";

// ─── Formatadores ──────────────────────────────────────────────────────────

function fmtData(ymd: string): string {
  if (!ymd) return "";
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

function fmtSalario(s: number | undefined): string {
  if (typeof s !== "number") return "";
  return s.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtCpf(d: string): string {
  const x = (d || "").replace(/\D/g, "");
  if (x.length !== 11) return d;
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function fmtWhats(d: string): string {
  const x = (d || "").replace(/\D/g, "");
  if (x.length === 11) return `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  if (x.length === 10) return `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`;
  return d;
}

function fmtCep(s: string): string {
  const x = (s || "").replace(/\D/g, "");
  if (x.length === 8) return `${x.slice(0, 5)}-${x.slice(5)}`;
  return s;
}

function fmtValor(v: unknown, tipo: string): string {
  if (v == null || v === "") return "";
  if (tipo === "data" && typeof v === "string") return fmtData(v);
  if (tipo === "cpf" && typeof v === "string") return fmtCpf(v);
  if (tipo === "telefone" && typeof v === "string") return fmtWhats(v);
  if (tipo === "boolean") return v ? "Sim" : "Não";
  if (tipo === "naturalidade" && typeof v === "object") {
    const o = v as { uf?: string; cidade?: string };
    return o.uf && o.cidade ? `${o.cidade}/${o.uf}` : "";
  }
  if (Array.isArray(v)) return "";
  return String(v);
}

const DIAS_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// ─── Estilos compartilhados ─────────────────────────────────────────────────

type CellStyle = NonNullable<XLSX.CellObject["s"]>;

const BORDER_THIN = { style: "thin", color: { rgb: "D1D5DB" } } as const; // gray-300
const BORDER_DARK = { style: "medium", color: { rgb: "1E293B" } } as const; // slate-800

const STYLE_TITLE: CellStyle = {
  font: { name: "Calibri", sz: 18, bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "1E3A8A" } }, // indigo-900
  alignment: { horizontal: "center", vertical: "center" },
  border: { top: BORDER_DARK, bottom: BORDER_DARK, left: BORDER_DARK, right: BORDER_DARK },
};

const STYLE_SUBTITLE: CellStyle = {
  font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "1E3A8A" } },
  fill: { patternType: "solid", fgColor: { rgb: "EEF2FF" } }, // indigo-50
  alignment: { horizontal: "center", vertical: "center" },
  border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_DARK, right: BORDER_DARK },
};

const STYLE_META: CellStyle = {
  font: { name: "Calibri", sz: 9, italic: true, color: { rgb: "6B7280" } },
  fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
  alignment: { horizontal: "center", vertical: "center" },
  border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_DARK, right: BORDER_DARK },
};

const STYLE_SECTION: CellStyle = {
  font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "4F46E5" } }, // indigo-600
  alignment: { horizontal: "left", vertical: "center", indent: 1 },
  border: { top: BORDER_DARK, bottom: BORDER_DARK, left: BORDER_DARK, right: BORDER_DARK },
};

const STYLE_LABEL: CellStyle = {
  font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "374151" } },
  fill: { patternType: "solid", fgColor: { rgb: "F3F4F6" } }, // gray-100
  alignment: { horizontal: "left", vertical: "center", wrapText: true, indent: 1 },
  border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_DARK, right: BORDER_THIN },
};

const STYLE_VALUE: CellStyle = {
  font: { name: "Calibri", sz: 10, color: { rgb: "111827" } },
  fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true, indent: 1 },
  border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_DARK },
};

const STYLE_TABLE_HEAD: CellStyle = {
  font: { name: "Calibri", sz: 9, bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "6366F1" } }, // indigo-500
  alignment: { horizontal: "center", vertical: "center" },
  border: { top: BORDER_DARK, bottom: BORDER_DARK, left: BORDER_THIN, right: BORDER_THIN },
};

const STYLE_TABLE_CELL: CellStyle = {
  font: { name: "Calibri", sz: 9, color: { rgb: "111827" } },
  fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true, indent: 1 },
  border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN },
};

const STYLE_FOOTER_NOTE: CellStyle = {
  font: { name: "Calibri", sz: 8, italic: true, color: { rgb: "6B7280" } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true, indent: 1 },
};

// ─── Builder ────────────────────────────────────────────────────────────────

type Cell = { v: string | number | boolean; s?: CellStyle };
type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

class SheetBuilder {
  rows: Cell[][] = [];
  merges: Merge[] = [];
  rowHeights: { hpt: number }[] = [];
  colWidths: { wch: number }[];

  constructor(colWidths: number[]) {
    this.colWidths = colWidths.map((w) => ({ wch: w }));
  }

  push(row: Cell[], heightPt?: number): number {
    this.rows.push(row);
    this.rowHeights.push({ hpt: heightPt ?? 18 });
    return this.rows.length - 1;
  }

  mergeRow(rowIdx: number, fromCol: number, toCol: number) {
    this.merges.push({ s: { r: rowIdx, c: fromCol }, e: { r: rowIdx, c: toCol } });
  }

  blank(heightPt = 6) {
    this.push(
      this.colWidths.map(() => ({ v: "", s: { fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } } } })),
      heightPt,
    );
  }

  // Linha de section header: 1 célula merged ao longo de toda a largura.
  section(title: string) {
    const cols = this.colWidths.length;
    const row: Cell[] = [{ v: title, s: STYLE_SECTION }];
    for (let i = 1; i < cols; i++) row.push({ v: "", s: STYLE_SECTION });
    const idx = this.push(row, 22);
    this.mergeRow(idx, 0, cols - 1);
  }

  // Linha com 2 pares label/valor (4 colunas: L V L V). Aceita valor vazio
  // (renderiza célula em branco mas com border).
  pair(label1: string, value1: string, label2: string, value2: string) {
    this.push([
      { v: label1, s: STYLE_LABEL },
      { v: value1 || "", s: STYLE_VALUE },
      { v: label2, s: STYLE_LABEL },
      { v: value2 || "", s: STYLE_VALUE },
    ], 20);
  }

  // Linha com 1 par label/valor ocupando largura toda (label normal, valor merged)
  single(label: string, value: string) {
    const cols = this.colWidths.length;
    const row: Cell[] = [
      { v: label, s: STYLE_LABEL },
      { v: value || "", s: STYLE_VALUE },
    ];
    for (let i = 2; i < cols; i++) row.push({ v: "", s: STYLE_VALUE });
    const idx = this.push(row, 20);
    this.mergeRow(idx, 1, cols - 1);
  }

  // Cabeçalho de tabela (horário, dependentes, transporte). N colunas iguais
  // distribuídas pela largura total via merges proporcionais.
  tableHeader(cols: string[]) {
    const total = this.colWidths.length;
    if (cols.length === total) {
      this.push(cols.map((c) => ({ v: c, s: STYLE_TABLE_HEAD })), 20);
      return;
    }
    // Distribui cols sobre `total` colunas: aproximadamente 1 col por slot,
    // com a última eventualmente absorvendo o resto. Pra tabelas menores que
    // a largura total, merge as células vazias no final.
    const cells: Cell[] = cols.map((c) => ({ v: c, s: STYLE_TABLE_HEAD }));
    while (cells.length < total) cells.push({ v: "", s: STYLE_TABLE_HEAD });
    const idx = this.push(cells, 20);
    if (cols.length < total) {
      this.mergeRow(idx, cols.length - 1, total - 1);
    }
  }

  tableRow(values: (string | number)[]) {
    const total = this.colWidths.length;
    const cells: Cell[] = values.map((v) => ({ v, s: STYLE_TABLE_CELL }));
    while (cells.length < total) cells.push({ v: "", s: STYLE_TABLE_CELL });
    const idx = this.push(cells, 18);
    if (values.length < total) {
      this.mergeRow(idx, values.length - 1, total - 1);
    }
  }

  toWorksheet(): XLSX.WorkSheet {
    const ws: XLSX.WorkSheet = {};
    const rowCount = this.rows.length;
    const colCount = this.colWidths.length;
    for (let r = 0; r < rowCount; r++) {
      const row = this.rows[r];
      if (!row) continue;
      for (let c = 0; c < colCount; c++) {
        const cell = row[c];
        if (!cell) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = {
          v: cell.v,
          t: typeof cell.v === "number" ? "n" : typeof cell.v === "boolean" ? "b" : "s",
          s: cell.s,
        };
      }
    }
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(0, rowCount - 1), c: colCount - 1 },
    });
    ws["!cols"] = this.colWidths;
    ws["!rows"] = this.rowHeights;
    if (this.merges.length > 0) ws["!merges"] = this.merges;
    // Configura impressão A4 retrato com margens estreitas, ajuste pra 1 página de largura.
    ws["!pageSetup"] = { orientation: "portrait", paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
    ws["!margins"] = { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
    return ws;
  }
}

// ─── Helpers de busca de campo (por id) ────────────────────────────────────

function findVal(
  schema: FormField[],
  dados: Record<string, unknown>,
  id: string,
): { label: string; valor: string } | null {
  const f = schema.find((x) => x.id === id);
  if (!f) return null;
  return { label: f.label, valor: fmtValor(dados[id], f.tipo) };
}

function pair2(
  b: SheetBuilder,
  schema: FormField[],
  dados: Record<string, unknown>,
  id1: string,
  id2: string,
) {
  const v1 = findVal(schema, dados, id1);
  const v2 = findVal(schema, dados, id2);
  if (!v1 && !v2) return;
  b.pair(
    v1?.label || "",
    v1?.valor || "",
    v2?.label || "",
    v2?.valor || "",
  );
}

function single(
  b: SheetBuilder,
  schema: FormField[],
  dados: Record<string, unknown>,
  id: string,
) {
  const v = findVal(schema, dados, id);
  if (!v) return;
  b.single(v.label, v.valor);
}

// ─── Geração principal ─────────────────────────────────────────────────────

export function gerarFichaAdmissaoXlsx(
  admissao: Admissao,
  cargos: Cargo[],
  restNome: string,
): Blob {
  const cargo = cargos.find((c) => c.id === admissao.cargoId);
  const dados = (admissao.dadosPreenchidos as Record<string, unknown>) || {};
  const schema = admissao.schemaUsado;
  const wb = XLSX.utils.book_new();

  // 4 colunas largas — formato A4 retrato em ficha de admissão CLT.
  // A=label1 (24ch) | B=value1 (28ch) | C=label2 (24ch) | D=value2 (28ch)
  const b = new SheetBuilder([24, 28, 24, 28]);

  // ─── Cabeçalho ───
  {
    const row = b.push([
      { v: "FICHA DE ADMISSÃO", s: STYLE_TITLE },
      { v: "", s: STYLE_TITLE },
      { v: "", s: STYLE_TITLE },
      { v: "", s: STYLE_TITLE },
    ], 34);
    b.mergeRow(row, 0, 3);
  }
  {
    const row = b.push([
      { v: restNome, s: STYLE_SUBTITLE },
      { v: "", s: STYLE_SUBTITLE },
      { v: "", s: STYLE_SUBTITLE },
      { v: "", s: STYLE_SUBTITLE },
    ], 22);
    b.mergeRow(row, 0, 3);
  }
  {
    const meta = `Gerado em ${new Date().toLocaleString("pt-BR")}` +
      (admissao.preenchimentoManual
        ? `  •  Preenchimento manual: ${admissao.preenchimentoManual.por?.nome || "—"}`
        : "");
    const row = b.push([
      { v: meta, s: STYLE_META },
      { v: "", s: STYLE_META },
      { v: "", s: STYLE_META },
      { v: "", s: STYLE_META },
    ], 16);
    b.mergeRow(row, 0, 3);
  }

  // ─── Seção: Dados da vaga ───
  b.blank();
  b.section("1. DADOS DA VAGA");
  b.pair("Cargo", cargo?.nome || "", "Área", cargo?.area || "");
  b.pair("Salário", fmtSalario(admissao.salario), "Data de admissão", fmtData(admissao.dataAdmissao || ""));
  b.pair("Cargo de confiança", admissao.cargoConfianca ? "Sim" : "Não", "", "");

  // ─── Seção: Horário de trabalho ───
  if (admissao.horariosCadastrados && Object.keys(admissao.horariosCadastrados).length > 0) {
    b.blank();
    b.section("2. HORÁRIO DE TRABALHO");
    b.tableHeader(["Dia", "Entrada", "Saída", "Intervalo (min)"]);
    for (let i = 0; i < 7; i++) {
      const d = (admissao.horariosCadastrados[String(i)] || admissao.horariosCadastrados[i]) as
        | { active?: boolean; in?: string; out?: string; break?: number }
        | undefined;
      if (!d?.active) {
        b.tableRow([DIAS_LABEL[i] || "", "Folga", "—", "—"]);
      } else {
        b.tableRow([
          DIAS_LABEL[i] || "",
          d.in || "",
          d.out || "",
          typeof d.break === "number" ? `${d.break} min` : "",
        ]);
      }
    }
  }

  // ─── Seção: Dados pessoais ───
  b.blank();
  b.section("3. DADOS PESSOAIS");
  single(b, schema, dados, "nome_completo");
  pair2(b, schema, dados, "data_nascimento", "sexo");
  pair2(b, schema, dados, "nacionalidade", "naturalidade");
  pair2(b, schema, dados, "estado_civil", "cor");
  pair2(b, schema, dados, "escolaridade", "num_filhos");
  single(b, schema, dados, "nome_pai");
  single(b, schema, dados, "nome_mae");

  // ─── Seção: Contato ───
  b.blank();
  b.section("4. CONTATO");
  pair2(b, schema, dados, "whatsapp", "tel_residencial");
  pair2(b, schema, dados, "tel_emergencia", "contato_emergencia_nome");

  // ─── Seção: Endereço ───
  b.blank();
  b.section("5. ENDEREÇO");
  const cep = findVal(schema, dados, "endereco_cep");
  if (cep) {
    b.pair(cep.label, fmtCep(cep.valor), "", "");
  }
  pair2(b, schema, dados, "endereco_logradouro", "endereco_numero");
  pair2(b, schema, dados, "endereco_complemento", "endereco_bairro");
  pair2(b, schema, dados, "endereco_cidade", "endereco_estado");

  // ─── Seção: Documentos ───
  b.blank();
  b.section("6. DOCUMENTOS");
  pair2(b, schema, dados, "cpf", "rg");
  pair2(b, schema, dados, "rg_orgao", "rg_uf");
  single(b, schema, dados, "rg_data_emissao");
  pair2(b, schema, dados, "ctps_numero", "ctps_serie");
  pair2(b, schema, dados, "ctps_data_emissao", "pis");
  pair2(b, schema, dados, "titulo_eleitor", "titulo_zona");
  pair2(b, schema, dados, "titulo_secao", "titulo_data_emissao");
  pair2(b, schema, dados, "reservista", "cnh");
  single(b, schema, dados, "cnh_categoria");

  // ─── Seção: Banco ───
  b.blank();
  b.section("7. DADOS BANCÁRIOS");
  pair2(b, schema, dados, "banco_nome", "banco_agencia");
  pair2(b, schema, dados, "banco_conta", "pix");
  single(b, schema, dados, "email_recibo");

  // ─── Seção: Dependentes ───
  const deps = (dados.dependentes as { nome?: string; nascimento?: string; cpf?: string; parentesco?: string; depIR?: boolean }[]) || [];
  b.blank();
  b.section("8. DEPENDENTES");
  if (deps.length === 0) {
    b.tableRow(["Nenhum dependente declarado."]);
  } else {
    b.tableHeader(["Nome", "Nascimento", "CPF", "Parentesco / Dep IR"]);
    for (const d of deps) {
      b.tableRow([
        d.nome || "",
        d.nascimento ? fmtData(d.nascimento) : "",
        d.cpf ? fmtCpf(d.cpf) : "",
        `${d.parentesco || ""}${d.depIR ? " (Dep IR)" : ""}`,
      ]);
    }
  }

  // ─── Seção: Transporte ───
  const transp = (dados.transporte as { tipo?: string; itinerario?: string; tarifa?: string; qtde?: string }[]) || [];
  const vtNao = !!dados.vt_nao_utiliza;
  b.blank();
  b.section("9. VALE-TRANSPORTE");
  if (vtNao) {
    b.single("Declaração", "Candidato declarou que NÃO utiliza transporte público (abre mão do VT).");
  } else if (transp.length === 0) {
    b.tableRow(["Sem trechos de transporte declarados."]);
  } else {
    b.tableHeader(["Tipo", "Itinerário", "Tarifa (R$)", "Qtde/dia"]);
    for (const t of transp) {
      b.tableRow([
        t.tipo || "",
        t.itinerario || "",
        t.tarifa || "",
        t.qtde || "",
      ]);
    }
  }

  // ─── Seção: Declaração de veracidade ───
  if (admissao.validacao?.declaracaoEm) {
    b.blank();
    b.section("10. DECLARAÇÃO DE VERACIDADE");
    b.single("Aceita em", new Date(admissao.validacao.declaracaoEm).toLocaleString("pt-BR"));
    if (admissao.validacao.declaracaoTexto) {
      b.single("Texto declarado", admissao.validacao.declaracaoTexto);
    }
    if (admissao.validacao.selfieDataUrl) {
      b.single("Selfie de validação", "Anexada no painel do admin — abrir a admissão pra visualizar.");
    }
  }

  // ─── Rodapé ───
  b.blank();
  {
    const cols = b.colWidths.length;
    const row = b.push([
      { v: "Documento gerado automaticamente pelo sistema. Confira os dados antes de processar a admissão.", s: STYLE_FOOTER_NOTE },
      ...Array(cols - 1).fill(null).map(() => ({ v: "", s: STYLE_FOOTER_NOTE })),
    ], 14);
    b.mergeRow(row, 0, cols - 1);
  }

  XLSX.utils.book_append_sheet(wb, b.toWorksheet(), "Ficha");

  // ─── Aba: Checklist de documentos (se houver) ──────────────────────────
  if (admissao.checklistDocumentos) {
    const c = new SheetBuilder([48, 16, 28]);
    {
      const row = c.push([
        { v: "CHECKLIST DE DOCUMENTOS RECEBIDOS", s: STYLE_TITLE },
        { v: "", s: STYLE_TITLE },
        { v: "", s: STYLE_TITLE },
      ], 30);
      c.mergeRow(row, 0, 2);
    }
    {
      const meta = admissao.checklistDocumentos.atualizadoEm
        ? `Atualizado em ${new Date(admissao.checklistDocumentos.atualizadoEm).toLocaleString("pt-BR")}` +
          (admissao.checklistDocumentos.atualizadoPor?.nome
            ? ` por ${admissao.checklistDocumentos.atualizadoPor.nome}`
            : "")
        : "";
      const row = c.push([
        { v: meta, s: STYLE_META },
        { v: "", s: STYLE_META },
        { v: "", s: STYLE_META },
      ], 16);
      c.mergeRow(row, 0, 2);
    }
    c.blank();
    c.push([
      { v: "Documento", s: STYLE_TABLE_HEAD },
      { v: "Status", s: STYLE_TABLE_HEAD },
      { v: "Observação", s: STYLE_TABLE_HEAD },
    ], 20);
    for (const i of admissao.checklistDocumentos.itens) {
      c.push([
        { v: i.nome, s: STYLE_TABLE_CELL },
        { v: i.recebido ? "✓ Recebido" : "Pendente", s: {
          ...STYLE_TABLE_CELL,
          font: { ...STYLE_TABLE_CELL.font, bold: true, color: { rgb: i.recebido ? "047857" : "B45309" } },
        } },
        { v: i.observacao || "", s: STYLE_TABLE_CELL },
      ], 18);
    }
    XLSX.utils.book_append_sheet(wb, c.toWorksheet(), "Checklist Docs");
  }

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Dispara download do XLSX no browser. Nome do arquivo: ficha-admissao-<nome>-<cpf>.xlsx
export function baixarFichaAdmissao(
  admissao: Admissao,
  cargos: Cargo[],
  restNome: string,
): void {
  const blob = gerarFichaAdmissaoXlsx(admissao, cargos, restNome);
  const safeName = admissao.candidato.nome
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ficha-admissao-${safeName}-${admissao.candidato.cpf}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// Monta URL de compose do Gmail (web). Funciona em qualquer navegador
// pra quem usa Gmail web. Anexo TEM que ser arrastado pelo usuário —
// limitação da API HTTP do compose.
export function montarGmailComposeUrl(opts: {
  to?: string;
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (opts.to) params.set("to", opts.to);
  params.set("su", opts.subject);
  params.set("body", opts.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function montarCorpoEmailContabilidade(
  admissao: Admissao,
  cargo: Cargo | undefined,
  restNome: string,
  rest?: Restaurant | null,
): string {
  const c = admissao.candidato;
  const template = getTemplate(rest, "envioContabilidade");
  return renderTemplate(template, {
    restaurante: restNome,
    nome: c.nome,
    cpf: c.cpf,
    email: c.email,
    whatsapp: c.whatsapp,
    cargo: cargo ? `${cargo.nome}${cargo.area ? ` (${cargo.area})` : ""}` : "—",
    salarioLinha: admissao.salario
      ? `💰 Salário: ${admissao.salario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}\n`
      : "",
    dataAdmissaoLinha: admissao.dataAdmissao
      ? `📅 Data de admissão: ${admissao.dataAdmissao.split("-").reverse().join("/")}\n`
      : "",
    cargoConfiancaLinha: admissao.cargoConfianca ? "⭐ Cargo de confiança: Sim\n" : "",
  });
}
