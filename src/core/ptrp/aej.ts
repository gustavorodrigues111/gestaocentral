// ════════════════════════════════════════════════════════════════════════════
//  AEJ — Arquivo Eletrônico de Jornada (Portaria MTP 671/2021, Anexo VI).
//
//  Leiaute OFICIAL: texto ASCII (ISO 8859-1), 1 registro por linha terminando
//  em CR+LF, campos separados por "|" (pipe). Tipos: N numérico, A alfanumérico,
//  H hora "hhmm", D data "AAAA-MM-DD", DH "AAAA-MM-DDThh:mm:00±ZZZZ". Versão "002".
//
//  Registros gerados: 01 cabeçalho · 02 REPs · 03 vínculos · 04 horário
//  contratual · 05 marcações (E/S/D + fonte O/I/P) · 07 ausências (falta) ·
//  08 identificação do PTRP · 99 trailer · assinatura digital.
//
//  Fonte da marcação: "O" original do REP · "I" incluída manual · "P" pré-
//  assinalada · "D" (tpMarc) desconsiderada. Sem o nº do REP configurado, as
//  marcações originais saem como "T" (outras fontes) — informe repNumero p/ "O".
// ════════════════════════════════════════════════════════════════════════════
import type { PtrpApuracaoColab } from "./tipos";

export type AEJMeta = {
  empresaNome: string;
  empresaCnpj?: string | null;      // 14 díg (CNPJ) — se ausente, usa CPF? (aqui só CNPJ)
  compLabel: string;
  competencia: string;              // YYYY-MM
  repTipo?: "1" | "2" | "3";        // 1 REP-C · 2 REP-A · 3 REP-P (default)
  repNumero?: string | null;        // nº fabricação/INPI do REP; sem ele, marcação = fonte "T"
  ptrp?: { nome?: string; versao?: string; devTipoId?: "1" | "2"; devId?: string; devNome?: string; devEmail?: string };
};

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
const asc = (s: string): string => (s || "").normalize("NFD").replace(DIACRITICOS, "").replace(/\|/g, " ").slice(0, 150);
const dig = (s?: string | null): string => (s || "").replace(/\D/g, "");
const hHM = (hhmm: string): string => (hhmm || "").replace(":", "").padStart(4, "0").slice(0, 4);   // "HH:MM" → "HHMM"
const dhBRT = (data: string, hhmm: string): string => `${data}T${(hhmm || "00:00").slice(0, 5)}:00-0300`;
const nowDH = (): string => { const d = new Date(Date.now() - 3 * 3600_000); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00-0300`; };
const rec = (...campos: (string | number)[]): string => campos.map(c => String(c ?? "")).join("|");

// Parseia "09:00–12:00 13:00–18:48" (traço en-dash) → pares [{in:"0900",out:"1200"},...]
function paresDoPrevisto(previstoTxt: string): { in: string; out: string }[] {
  if (!previstoTxt || !previstoTxt.includes("–")) return [];
  return previstoTxt.trim().split(/\s+/).map(seg => { const [i, o] = seg.split("–"); return { in: hHM(i || ""), out: hHM(o || "") }; }).filter(p => p.in && p.out);
}
const durMinDoPrevisto = (previstoTxt: string): number =>
  paresDoPrevisto(previstoTxt).reduce((s, p) => { const im = Number(p.in.slice(0, 2)) * 60 + Number(p.in.slice(2)); let om = Number(p.out.slice(0, 2)) * 60 + Number(p.out.slice(2)); if (om < im) om += 24 * 60; return s + (om - im); }, 0);

export function gerarAEJ(colabs: PtrpApuracaoColab[], meta: AEJMeta): string {
  const linhas: string[] = [];
  const cont: Record<string, number> = { "01": 0, "02": 0, "03": 0, "04": 0, "05": 0, "06": 0, "07": 0, "08": 0 };
  const add = (linha: string) => { linhas.push(linha); const t = linha.slice(0, 2); if (t in cont) cont[t]++; };

  const dias = colabs.flatMap(c => c.dias.map(d => d.data)).sort();
  const dataIni = dias[0] || `${meta.competencia}-01`;
  const dataFim = dias[dias.length - 1] || dataIni;
  const cnpj = dig(meta.empresaCnpj);

  // 01 — Cabeçalho
  add(rec("01", cnpj ? "1" : "2", cnpj, "", "", asc(meta.empresaNome), dataIni, dataFim, nowDH(), "002"));

  // 02 — REP utilizado (só quando o nº do REP é conhecido)
  const idRep = meta.repNumero ? "1" : "";
  const fonteOriginal = meta.repNumero ? "O" : "T";
  if (meta.repNumero) add(rec("02", "1", meta.repTipo || "3", dig(meta.repNumero)));

  // 03 — Vínculos (1 por colaborador) + índice
  const vinc = new Map<string, number>();   // colaboradorId → idtVinculoAej
  colabs.forEach((c, i) => { vinc.set(c.id, i + 1); add(rec("03", i + 1, dig(c.cpf).padStart(11, "0"), asc(c.nome))); });

  // 04 — Horários contratuais distintos → código H1, H2…
  const horCod = new Map<string, string>();  // previstoTxt → codHorContratual
  for (const c of colabs) for (const d of c.dias) {
    const pares = paresDoPrevisto(d.previstoTxt);
    if (!pares.length || horCod.has(d.previstoTxt)) continue;
    const cod = `H${horCod.size + 1}`;
    horCod.set(d.previstoTxt, cod);
    add(rec("04", cod, durMinDoPrevisto(d.previstoTxt), ...pares.flatMap(p => [p.in, p.out])));
  }

  // 05 — Marcações (E/S/D) por vínculo/dia; 07 — ausências (falta)
  for (const c of colabs) {
    const idv = vinc.get(c.id)!;
    for (const d of c.dias) {
      const cod = horCod.get(d.previstoTxt) || "";
      let seq = 0;
      const marcs = [...d.marcacoes].sort((a, b) => (a.in || a.out || "").localeCompare(b.in || b.out || ""));
      for (const m of marcs) {
        if (m.pendente) continue;   // pendência não aprovada não entra no AEJ oficial
        seq++;
        const fonte = m.origem === "incluida" ? "I" : m.origem === "preassinalada" ? "P" : fonteOriginal;
        const motivo = m.desconsiderada || m.origem === "incluida" ? asc("tratamento no PTRP") : "";
        if (m.in) add(rec("05", idv, dhBRT(d.data, m.in), idRep, m.desconsiderada ? "D" : "E", seq, fonte, seq === 1 && !m.desconsiderada ? cod : "", motivo));
        if (m.out) add(rec("05", idv, dhBRT(d.data, m.out), idRep, m.desconsiderada ? "D" : "S", seq, fonte, "", motivo));
      }
      if (d.excecoes?.includes("falta")) add(rec("07", idv, "2", d.data, "", ""));           // 2 = falta não justificada
    }
  }

  // 08 — Identificação do PTRP (o programa de tratamento = planejamento.app)
  const p = meta.ptrp || {};
  add(rec("08", asc(p.nome || "planejamento.app"), (p.versao || "1").slice(0, 8), p.devTipoId || "1", dig(p.devId) || cnpj, asc(p.devNome || "planejamento.app"), (p.devEmail || "contato@planejamento.app").slice(0, 50)));

  // 99 — Trailer (contagem por tipo 01..08)
  add(rec("99", cont["01"], cont["02"], cont["03"], cont["04"], cont["05"], cont["06"], cont["07"], cont["08"]));

  // Assinatura digital (literal — o .p7s acompanha o arquivo)
  linhas.push("ASSINATURA_DIGITAL_EM_ARQUIVO_P7S".padEnd(100, " "));

  return linhas.join("\r\n") + "\r\n";
}
