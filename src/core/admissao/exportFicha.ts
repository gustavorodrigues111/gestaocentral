// ════════════════════════════════════════════════════════════════════════════
//  Exportação da ficha de admissão preenchida pra XLSX. Layout simples:
//  cada seção (Dados pessoais, Endereço, Documentos, etc) com label/valor
//  em 2 colunas. Listas (dependentes/transporte) ganham aba própria.
// ════════════════════════════════════════════════════════════════════════════

import * as XLSX from "xlsx";
import type { Admissao, Cargo } from "../types";

type AOA = (string | number | boolean | null)[][];

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

// Converte um valor preenchido pelo candidato em string legível pra planilha.
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
  if (Array.isArray(v)) return ""; // listas tratadas em aba separada
  return String(v);
}

const DIAS_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function gerarFichaAdmissaoXlsx(
  admissao: Admissao,
  cargos: Cargo[],
  restNome: string,
): Blob {
  const cargo = cargos.find((c) => c.id === admissao.cargoId);
  const dados = (admissao.dadosPreenchidos as Record<string, unknown>) || {};
  const wb = XLSX.utils.book_new();

  // ── Aba principal: ficha ──
  const principal: AOA = [];
  principal.push(["FICHA DE ADMISSÃO"]);
  principal.push([restNome]);
  principal.push([`Gerado em ${new Date().toLocaleString("pt-BR")}`]);
  if (admissao.preenchimentoManual) {
    principal.push([`* Preenchimento manual por ${admissao.preenchimentoManual.por?.nome || "—"}`]);
  }
  principal.push([]);

  // Bloco 1: Dados da vaga (definidos pela empresa)
  principal.push(["DADOS DA VAGA"]);
  principal.push(["Cargo", cargo?.nome || ""]);
  if (cargo?.area) principal.push(["Área", cargo.area]);
  principal.push(["Salário", fmtSalario(admissao.salario)]);
  principal.push(["Data de admissão", fmtData(admissao.dataAdmissao || "")]);
  principal.push(["Cargo de confiança", admissao.cargoConfianca ? "Sim" : "Não"]);
  principal.push([]);

  // Horário (se preenchido)
  if (admissao.horariosCadastrados && Object.keys(admissao.horariosCadastrados).length > 0) {
    principal.push(["HORÁRIO DE TRABALHO"]);
    principal.push(["Dia", "Ativo", "Entrada", "Saída", "Intervalo (min)"]);
    for (let i = 0; i < 7; i++) {
      const d = (admissao.horariosCadastrados[String(i)] || admissao.horariosCadastrados[i]) as
        | { active?: boolean; in?: string; out?: string; break?: number }
        | undefined;
      principal.push([
        DIAS_LABEL[i],
        d?.active ? "Sim" : "—",
        d?.in || "",
        d?.out || "",
        typeof d?.break === "number" ? d.break : "",
      ]);
    }
    principal.push([]);
  }

  // Blocos 2+: dados preenchidos, agrupados pela ordem do schema. Listas
  // (dependentes/transporte) entram em abas separadas.
  const gruposJaImpressos = new Set<string>();
  const camposSeq = admissao.schemaUsado
    .filter((f) => f.ativo)
    .sort((a, b) => a.ordem - b.ordem);

  // Agrupa preservando ordem do schema (sem mexer no Map nativo)
  const ordemGrupos: string[] = [];
  for (const f of camposSeq) {
    if (!gruposJaImpressos.has(f.grupo)) {
      ordemGrupos.push(f.grupo);
      gruposJaImpressos.add(f.grupo);
    }
  }

  for (const grupo of ordemGrupos) {
    const campos = camposSeq.filter((f) => f.grupo === grupo);
    // Pula listas — vão em aba própria
    const camposSimples = campos.filter(
      (f) => f.tipo !== "lista_dependentes" && f.tipo !== "lista_transporte",
    );
    if (camposSimples.length === 0) continue;
    principal.push([grupo.toUpperCase()]);
    for (const f of camposSimples) {
      const valor = fmtValor(dados[f.id], f.tipo);
      principal.push([f.label, valor]);
    }
    principal.push([]);
  }

  // Validação (se preenchida no submit do candidato)
  if (admissao.validacao?.declaracaoEm) {
    principal.push(["DECLARAÇÃO DE VERACIDADE"]);
    principal.push(["Aceita em", new Date(admissao.validacao.declaracaoEm).toLocaleString("pt-BR")]);
    principal.push(["Texto", admissao.validacao.declaracaoTexto || ""]);
    if (admissao.validacao.selfieDataUrl) {
      principal.push(["Selfie", "(anexada no doc da admissão — abrir o admin pra ver)"]);
    }
    principal.push([]);
  }

  const wsPrincipal = XLSX.utils.aoa_to_sheet(principal);
  // Largura mínima nas colunas
  wsPrincipal["!cols"] = [{ wch: 32 }, { wch: 50 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsPrincipal, "Ficha");

  // ── Aba: Dependentes ──
  const deps = (dados.dependentes as { nome?: string; nascimento?: string; cpf?: string; parentesco?: string; depIR?: boolean }[]) || [];
  if (deps.length > 0) {
    const aoaDeps: AOA = [
      ["DEPENDENTES"],
      [],
      ["#", "Nome", "Nascimento", "CPF", "Parentesco", "Dependente IR?"],
      ...deps.map((d, i) => [
        i + 1,
        d.nome || "",
        d.nascimento ? fmtData(d.nascimento) : "",
        d.cpf ? fmtCpf(d.cpf) : "",
        d.parentesco || "",
        d.depIR ? "Sim" : "Não",
      ]),
    ];
    const wsDeps = XLSX.utils.aoa_to_sheet(aoaDeps);
    wsDeps["!cols"] = [{ wch: 4 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsDeps, "Dependentes");
  }

  // ── Aba: Transporte ──
  const transp = (dados.transporte as { tipo?: string; itinerario?: string; tarifa?: string; qtde?: string }[]) || [];
  if (transp.length > 0 || dados.vt_nao_utiliza) {
    const aoaTransp: AOA = [
      ["VALE-TRANSPORTE"],
      [],
    ];
    if (dados.vt_nao_utiliza) {
      aoaTransp.push(["Candidato declarou que NÃO utiliza transporte público (abre mão do VT)."]);
    } else {
      aoaTransp.push(["#", "Tipo", "Itinerário", "Tarifa (R$)", "Qtde/dia"]);
      transp.forEach((t, i) => aoaTransp.push([
        i + 1,
        t.tipo || "",
        t.itinerario || "",
        t.tarifa || "",
        t.qtde || "",
      ]));
    }
    const wsTransp = XLSX.utils.aoa_to_sheet(aoaTransp);
    wsTransp["!cols"] = [{ wch: 4 }, { wch: 20 }, { wch: 28 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsTransp, "Transporte");
  }

  // ── Aba: Checklist de documentos (se houver) ──
  if (admissao.checklistDocumentos) {
    const aoaDocs: AOA = [
      ["CHECKLIST DE DOCUMENTOS"],
      [],
      ["Documento", "Recebido?", "Observação"],
      ...admissao.checklistDocumentos.itens.map((i) => [
        i.nome,
        i.recebido ? "Sim" : "Pendente",
        i.observacao || "",
      ]),
    ];
    const wsDocs = XLSX.utils.aoa_to_sheet(aoaDocs);
    wsDocs["!cols"] = [{ wch: 48 }, { wch: 12 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsDocs, "Docs");
  }

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Dispara download do XLSX no browser. Nome do arquivo: ficha-<nome>-<cpf>.xlsx
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
): string {
  const c = admissao.candidato;
  const linhas = [
    `Olá,`,
    ``,
    `Segue solicitação de admissão pra processar:`,
    ``,
    `🏢 Empresa: ${restNome}`,
    `👤 Candidato: ${c.nome}`,
    `📋 CPF: ${c.cpf}`,
    `📧 E-mail: ${c.email}`,
    `📱 WhatsApp: ${c.whatsapp}`,
    ``,
    `💼 Cargo: ${cargo?.nome || "—"}${cargo?.area ? ` (${cargo.area})` : ""}`,
    admissao.salario ? `💰 Salário: ${admissao.salario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "",
    admissao.dataAdmissao ? `📅 Data de admissão: ${admissao.dataAdmissao.split("-").reverse().join("/")}` : "",
    admissao.cargoConfianca ? `⭐ Cargo de confiança: Sim` : "",
    ``,
    `📎 Anexe a ficha completa (arquivo XLSX baixado automaticamente).`,
    ``,
    `Os documentos do candidato foram coletados via WhatsApp e estão no nosso DP.`,
    ``,
    `Qualquer dúvida, me avisa.`,
    ``,
    `Obrigado!`,
  ].filter((l) => l !== "");
  return linhas.join("\n");
}
