// ════════════════════════════════════════════════════════════════════════════
//  Import de cargos via CSV — pra migração do AppTip pro Planejamento
// ════════════════════════════════════════════════════════════════════════════
//
//  Formato CSV esperado (cabeçalho exato):
//    nome,area,tipo_vinculo,pontos,sem_gorjeta,recebe_producao,ativo
//
//  Match contra cargos existentes: por nome (case insensitive) + área.
//  Pra cada linha, mostra preview e o user decide: criar / atualizar / pular.

import { useRef, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import { AREAS, TIPOS_VINCULO } from "../../core/types";
import type { Area, Cargo, TipoVinculo } from "../../core/types";

type Props = {
  cargosExistentes: Cargo[];
  restaurantId: string;
  onClose: () => void;
};

// Linha parseada + status
type LinhaImport = {
  idx: number;                      // número da linha (1-based, ignora header)
  nome: string;
  area: Area;
  tipoVinculo: TipoVinculo;
  pontos: number;
  semGorjeta: boolean;
  recebeProducao: boolean;
  ativo: boolean;
  // Resultado do match
  acao: "criar" | "atualizar" | "pular" | "erro";
  cargoExistente?: Cargo;           // se acao === "atualizar"
  erro?: string;
};

export function ImportCargosModal({ cargosExistentes, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [linhas, setLinhas] = useState<LinhaImport[]>([]);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; pulados: number } | null>(null);

  function handleFile(file: File) {
    setParseError("");
    setLinhas([]);
    setResultado(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      try {
        const parsed = parseLinhas(text, cargosExistentes);
        setLinhas(parsed);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Erro lendo CSV");
      }
    };
    reader.onerror = () => setParseError("Falha ao ler arquivo");
    reader.readAsText(file, "utf-8");
  }

  function toggleLinhaPular(idx: number) {
    setLinhas(ls => ls.map(l =>
      l.idx === idx
        ? { ...l, acao: l.acao === "pular"
            ? (l.cargoExistente ? "atualizar" : "criar")
            : "pular" }
        : l
    ));
  }

  async function importar() {
    if (!me) return;
    setImporting(true);
    let criados = 0, atualizados = 0, pulados = 0;
    try {
      for (const l of linhas) {
        if (l.acao === "pular" || l.acao === "erro") {
          pulados++;
          continue;
        }
        const payload = {
          restaurantId,
          nome: l.nome,
          area: l.area,
          tipoVinculo: l.tipoVinculo,
          pontos: l.semGorjeta ? 0 : l.pontos,
          semGorjeta: l.semGorjeta,
          recebeProducao: l.semGorjeta ? false : l.recebeProducao,
          ativo: l.ativo,
        };
        if (l.acao === "atualizar" && l.cargoExistente) {
          await updateDoc(doc(db, "cargos", l.cargoExistente.id), payload);
          await logAudit({
            entityType: "cargo",
            entityId: l.cargoExistente.id,
            restaurantId,
            acao: "alterado",
            motivo: "Import CSV (migração AppTip)",
            registradoPor: me.id,
          });
          atualizados++;
        } else {
          const ref = await addDoc(collection(db, "cargos"), {
            ...payload,
            ordem: 999,
            createdAt: new Date().toISOString(),
          });
          await logAudit({
            entityType: "cargo",
            entityId: ref.id,
            restaurantId,
            acao: "criado",
            motivo: "Import CSV (migração AppTip)",
            registradoPor: me.id,
          });
          criados++;
        }
      }
      setResultado({ criados, atualizados, pulados });
    } catch (err) {
      alert("Erro durante import: " + (err instanceof Error ? err.message : "desconhecido"));
    } finally {
      setImporting(false);
    }
  }

  // ── Sumário pra topo ──
  const erros = linhas.filter(l => l.acao === "erro").length;
  const novos = linhas.filter(l => l.acao === "criar").length;
  const atualizarCount = linhas.filter(l => l.acao === "atualizar").length;
  const pulados = linhas.filter(l => l.acao === "pular").length;
  const podeImportar = (novos + atualizarCount) > 0 && !importing;

  return (
    <Modal title="📥 Importar cargos (CSV)" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        {!resultado && linhas.length === 0 && (
          <>
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-sm text-indigo-800 dark:text-indigo-300">
              📋 Como funciona:
              <ol className="list-decimal ml-5 mt-2 text-xs space-y-0.5">
                <li>No AppTip, aba "Cargos" → botão "📤 Exportar CSV"</li>
                <li>Aqui, escolhe o arquivo baixado</li>
                <li>Confere o preview, escolhe o que importar</li>
                <li>Clica "Importar"</li>
              </ol>
              <p className="text-xs mt-2">
                Cargos existentes (mesmo nome + área) viram <strong>atualização</strong>;
                novos viram <strong>criação</strong>. Cada linha pode ser pulada individualmente.
              </p>
            </div>

            <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📂</div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                Escolha o arquivo CSV exportado do AppTip
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                className="hidden"
              />
              <Button onClick={() => fileRef.current?.click()}>Selecionar arquivo CSV</Button>
            </div>
          </>
        )}

        {parseError && (
          <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2">
            {parseError}
          </div>
        )}

        {!resultado && linhas.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2">
                <div className="text-[10px] uppercase tracking-wider text-blue-700 dark:text-blue-400">Novos</div>
                <div className="text-xl font-bold text-blue-700 dark:text-blue-400">{novos}</div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">Atualizar</div>
                <div className="text-xl font-bold text-amber-700 dark:text-amber-400">{atualizarCount}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-700 dark:text-gray-400">Pular</div>
                <div className="text-xl font-bold text-gray-700 dark:text-gray-400">{pulados}</div>
              </div>
              <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg p-2">
                <div className="text-[10px] uppercase tracking-wider text-rose-700 dark:text-rose-400">Erros</div>
                <div className="text-xl font-bold text-rose-700 dark:text-rose-400">{erros}</div>
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5">#</th>
                    <th className="text-left px-2 py-1.5">Nome</th>
                    <th className="text-left px-2 py-1.5">Área</th>
                    <th className="text-right px-2 py-1.5">Pts</th>
                    <th className="text-left px-2 py-1.5">Ação</th>
                    <th className="text-center px-2 py-1.5">Pular?</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(l => (
                    <tr
                      key={l.idx}
                      className={`border-t border-gray-100 dark:border-gray-800 ${
                        l.acao === "erro" ? "bg-rose-50/40 dark:bg-rose-900/10"
                        : l.acao === "pular" ? "opacity-50"
                        : l.acao === "atualizar" ? "bg-amber-50/30 dark:bg-amber-900/10"
                        : "bg-blue-50/30 dark:bg-blue-900/10"
                      }`}
                    >
                      <td className="px-2 py-1.5 text-xs text-gray-500">{l.idx}</td>
                      <td className="px-2 py-1.5 font-medium">{l.nome}</td>
                      <td className="px-2 py-1.5 text-xs">{l.area}</td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {l.semGorjeta ? "—" : l.pontos}
                        {l.recebeProducao && <span className="ml-1 text-amber-600">🏭</span>}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {l.acao === "erro" && <span className="text-rose-600">⚠ {l.erro}</span>}
                        {l.acao === "criar" && <span className="text-blue-700 dark:text-blue-400">+ Criar</span>}
                        {l.acao === "atualizar" && (
                          <span className="text-amber-700 dark:text-amber-400">
                            ↻ Atualizar {l.cargoExistente?.nome ? `"${l.cargoExistente.nome}"` : ""}
                          </span>
                        )}
                        {l.acao === "pular" && <span className="text-gray-500">— Pular</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {l.acao !== "erro" && (
                          <input
                            type="checkbox"
                            checked={l.acao === "pular"}
                            onChange={() => toggleLinhaPular(l.idx)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
              <Button variant="secondary" onClick={() => { setLinhas([]); setResultado(null); }}>
                Recomeçar
              </Button>
              <Button onClick={importar} disabled={!podeImportar}>
                {importing ? "Importando..." : `Importar ${novos + atualizarCount} cargo(s)`}
              </Button>
            </div>
          </>
        )}

        {resultado && (
          <div className="text-center py-6">
            <div className="text-5xl mb-3">✅</div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Importação concluída</h3>
            <div className="mt-4 space-y-1 text-sm text-gray-700 dark:text-gray-300">
              <p>✅ {resultado.criados} cargo(s) criado(s)</p>
              <p>↻ {resultado.atualizados} cargo(s) atualizado(s)</p>
              <p>— {resultado.pulados} pulado(s)/com erro</p>
            </div>
            <Button onClick={onClose} className="mt-4">Fechar</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Parser CSV ─────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else current += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { fields.push(current); current = ""; }
      else current += c;
    }
  }
  fields.push(current);
  return fields;
}

const HEADERS_ESPERADOS = ["nome", "area", "tipo_vinculo", "pontos", "sem_gorjeta", "recebe_producao", "ativo"];

function parseLinhas(text: string, cargosExistentes: Cargo[]): LinhaImport[] {
  // Remove BOM se houver
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) throw new Error("Arquivo vazio");

  const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  // Valida que tem os campos certos (em qualquer ordem)
  const faltam = HEADERS_ESPERADOS.filter(h => !header.includes(h));
  if (faltam.length > 0) {
    throw new Error(`Cabeçalho do CSV não tem: ${faltam.join(", ")}`);
  }
  const idxNome = header.indexOf("nome");
  const idxArea = header.indexOf("area");
  const idxTipo = header.indexOf("tipo_vinculo");
  const idxPontos = header.indexOf("pontos");
  const idxSemG = header.indexOf("sem_gorjeta");
  const idxProd = header.indexOf("recebe_producao");
  const idxAtivo = header.indexOf("ativo");

  const result: LinhaImport[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const idx = i;
    const nome = (fields[idxNome] || "").trim();
    const areaStr = (fields[idxArea] || "").trim();
    const tipoStr = (fields[idxTipo] || "registrado").trim().toLowerCase();
    const pontosStr = (fields[idxPontos] || "0").trim();
    const semGStr = (fields[idxSemG] || "false").trim().toLowerCase();
    const prodStr = (fields[idxProd] || "false").trim().toLowerCase();
    const ativoStr = (fields[idxAtivo] || "true").trim().toLowerCase();

    // Validações
    if (!nome) {
      result.push(errLine(idx, "nome vazio", fields, areaStr, tipoStr, pontosStr, semGStr, prodStr, ativoStr));
      continue;
    }
    if (!AREAS.includes(areaStr as Area)) {
      result.push(errLine(idx, `área inválida: "${areaStr}"`, fields, areaStr, tipoStr, pontosStr, semGStr, prodStr, ativoStr, nome));
      continue;
    }
    if (!TIPOS_VINCULO.includes(tipoStr as TipoVinculo)) {
      result.push(errLine(idx, `tipo_vinculo inválido: "${tipoStr}"`, fields, areaStr, tipoStr, pontosStr, semGStr, prodStr, ativoStr, nome));
      continue;
    }
    const pontos = parseFloat(pontosStr);
    if (isNaN(pontos) || pontos < 0) {
      result.push(errLine(idx, `pontos inválido: "${pontosStr}"`, fields, areaStr, tipoStr, pontosStr, semGStr, prodStr, ativoStr, nome));
      continue;
    }
    const semGorjeta = parseBool(semGStr);
    const recebeProducao = parseBool(prodStr);
    const ativo = parseBool(ativoStr);

    // Match com cargo existente: nome (case insensitive) + area
    const matchExist = cargosExistentes.find(c =>
      c.nome.trim().toLowerCase() === nome.toLowerCase() &&
      c.area === areaStr
    );

    result.push({
      idx,
      nome,
      area: areaStr as Area,
      tipoVinculo: tipoStr as TipoVinculo,
      pontos,
      semGorjeta,
      recebeProducao,
      ativo,
      acao: matchExist ? "atualizar" : "criar",
      cargoExistente: matchExist,
    });
  }
  return result;
}

function parseBool(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === "true" || v === "1" || v === "sim" || v === "yes" || v === "x";
}

function errLine(
  idx: number, erro: string,
  _fields: string[], area: string, tipo: string,
  pontosStr: string, semG: string, prod: string, ativo: string,
  nome?: string,
): LinhaImport {
  return {
    idx,
    nome: nome || "(sem nome)",
    area: (AREAS.includes(area as Area) ? area : "Salão") as Area,
    tipoVinculo: (TIPOS_VINCULO.includes(tipo as TipoVinculo) ? tipo : "registrado") as TipoVinculo,
    pontos: parseFloat(pontosStr) || 0,
    semGorjeta: parseBool(semG),
    recebeProducao: parseBool(prod),
    ativo: parseBool(ativo),
    acao: "erro",
    erro,
  };
}
