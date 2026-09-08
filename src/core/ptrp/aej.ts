// ════════════════════════════════════════════════════════════════════════════
//  AEJ — Arquivo Eletrônico de Jornada (Portaria MTP 671/2021).
//
//  Gera o arquivo-texto da jornada a partir do SNAPSHOT do fechamento
//  (PtrpApuracaoColab[]). Estrutura por REGISTROS, no modelo da Portaria 671:
//
//    Tipo 1 — cabeçalho do empregador (inscrição, razão social, período, geração)
//    Tipo 2 — identificação do empregado (CPF, nome, cargo, admissão)
//    Tipo 4 — marcação de ponto (uma linha por batida: entrada E e saída S)
//    Tipo 5 — ausência / afastamento (folga, férias, atestado, afastamento)
//    Tipo 9 — trailer (contagem de registros)
//
//  ⚠ LEIAUTE PRELIMINAR: os DADOS estão completos e corretos; a largura/ordem
//  fixa dos campos deve ser conferida contra o leiaute oficial da Portaria 671
//  antes de uso legal/fiscalização. Fácil de ajustar (só os `campo()` abaixo).
// ════════════════════════════════════════════════════════════════════════════
import type { PtrpApuracaoColab } from "./tipos";

export type AEJMeta = {
  empresaNome: string;
  empresaCnpj?: string | null;   // 14 dígitos (só números)
  compLabel: string;
  competencia: string;           // YYYY-MM
};

// Remove acentos e força ASCII maiúsculo (arquivos legais não usam acento).
const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
const asc = (s: string): string => (s || "").normalize("NFD").replace(DIACRITICOS, "").toUpperCase();
const padR = (s: string, n: number): string => asc(s).slice(0, n).padEnd(n, " ");
const padL = (s: string | number, n: number): string => String(s ?? "").replace(/\D/g, "").slice(0, n).padStart(n, "0");
const ddmmaaaa = (ymd: string): string => { const [y, m, d] = ymd.split("-"); return `${d}${m}${y}`; };
const hhmm = (hm: string | null): string => (hm || "").replace(":", "").padStart(4, "0").slice(0, 4);
const nowStamp = () => { const d = new Date(Date.now() - 3 * 3600_000); const p = (n: number) => String(n).padStart(2, "0"); return { data: `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`, hora: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` }; };

const AUSENCIA_COD: Record<string, string> = { folga: "FOL", ferias: "FER", atestado: "ATE", afastamento: "AFA", abono: "ABO" };

export function gerarAEJ(colabs: PtrpApuracaoColab[], meta: AEJMeta): string {
  const linhas: string[] = [];
  const { data: dataGer, hora: horaGer } = nowStamp();
  const dias = colabs.flatMap(c => c.dias.map(d => d.data)).sort();
  const dataIni = dias[0] ? ddmmaaaa(dias[0]) : ddmmaaaa(`${meta.competencia}-01`);
  const dataFim = dias.length ? ddmmaaaa(dias[dias.length - 1]) : "";

  // Tipo 1 — cabeçalho do empregador
  linhas.push([
    "1",
    meta.empresaCnpj ? "1" : "2",                 // 1=CNPJ 2=CPF
    padL(meta.empresaCnpj || "", 14),
    padR(meta.empresaNome, 150),
    dataIni, dataFim, dataGer, horaGer,
    "001",                                        // versão do leiaute (placeholder)
  ].join(""));

  let regMarc = 0, regAus = 0;
  for (const c of colabs) {
    // Tipo 2 — identificação do empregado
    linhas.push([
      "2",
      padL(c.cpf, 11),
      padR(c.nome, 150),
      padR(c.cargo || "", 40),
      c.admissao ? ddmmaaaa(c.admissao) : "        ",
    ].join(""));

    for (const d of c.dias) {
      // Tipo 4 — marcações (entrada/saída) de cada batida efetiva
      for (const m of d.marcacoes) {
        if (m.in) { linhas.push(["4", padL(c.cpf, 11), ddmmaaaa(d.data), hhmm(m.in), "E", padL(m.punchId || "", 12), m.pendente ? "P" : "N"].join("")); regMarc++; }
        if (m.out) { linhas.push(["4", padL(c.cpf, 11), ddmmaaaa(d.data), hhmm(m.out), "S", padL(m.punchId || "", 12), m.pendente ? "P" : "N"].join("")); regMarc++; }
      }
      // Tipo 5 — ausências/afastamentos lançados como tratamento
      for (const a of d.ajustes) {
        const cod = AUSENCIA_COD[a.tipo];
        if (cod) { linhas.push(["5", padL(c.cpf, 11), ddmmaaaa(d.data), cod, padR(a.motivo || "", 60)].join("")); regAus++; }
      }
    }
  }

  // Tipo 9 — trailer
  linhas.push(["9", padL(colabs.length, 6), padL(regMarc, 8), padL(regAus, 8), padL(linhas.length + 1, 9)].join(""));

  const aviso = `# AEJ (Portaria MTP 671/2021) — ${meta.empresaNome} — ${meta.compLabel}\r\n# LEIAUTE PRELIMINAR: dados completos; conferir a largura/ordem dos campos contra o leiaute oficial antes de uso legal.\r\n`;
  return aviso + linhas.join("\r\n") + "\r\n";
}
