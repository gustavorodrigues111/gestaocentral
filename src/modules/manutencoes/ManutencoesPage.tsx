// Cadastro mestre de Manutenções & Licenças (potabilidade, dedetização, CLCB,
// alvarás, etc). Cada item amarra a 1+ ENDEREÇOS (N:N). Gera tarefa-lembrete X
// dias antes do vencimento (generator.ts). Coloração por urgência.

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, orderBy, where, setDoc, doc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import type { Manutencao, ManutencaoTipo, ManutencaoPeriodicidade, Endereco } from "../../core/types";
import { MANUTENCAO_TIPO_LABEL, MANUTENCAO_PERIODICIDADE_LABEL, MANUTENCAO_PERIODICIDADE_DIAS } from "../../core/types";

// Tipos flexíveis (podem adiar sem pendência crítica); o resto é obrigatório (gera laudo).
const TIPOS_FLEXIVEIS = new Set<ManutencaoTipo>(["filtros_agua", "ar_condicionado", "estofado"]);

export function ManutencoesPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [manutencoes, setManutencoes] = useState<Manutencao[]>([]);
  const [enderecos, setEnderecos] = useState<Endereco[]>([]);
  const [editando, setEditando] = useState<Manutencao | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    const u = onSnapshot(
      query(collection(db, "manutencoes"), orderBy("proximoVencimento")),
      snap => setManutencoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Manutencao).filter(m => !m.deletadoEm))
    );
    return () => u();
  }, []);

  const ridsKey = restaurants.map(r => r.id).join(",");
  useEffect(() => {
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setEnderecos([]); return; }
    const u = onSnapshot(query(collection(db, "enderecos"), where("restaurantId", "in", rids)),
      snap => setEnderecos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Endereco)), () => setEnderecos([]));
    return () => u();
  }, [ridsKey]);

  const endById = useMemo(() => Object.fromEntries(enderecos.map(e => [e.id, e])), [enderecos]);
  const nomeRest = (rid: string) => restaurants.find(r => r.id === rid)?.nome || rid;
  const rotuloEnderecos = (m: Manutencao) => {
    const ids = m.enderecoIds || [];
    if (ids.length) return ids.map(id => { const e = endById[id]; return e ? `${nomeRest(e.restaurantId)} · ${e.apelido}` : "endereço?"; }).join("  ·  ");
    return (m.restaurantIds || []).map(nomeRest).join(", ");  // legado
  };

  if (!pessoa) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  const isMaster = !!pessoa.isMaster;
  const vencidas = manutencoes.filter(m => m.proximoVencimento < hoje).length;

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-sm text-gray-500">
          {manutencoes.length} item{manutencoes.length === 1 ? "" : "s"}{vencidas > 0 && <span className="text-rose-600 font-medium"> · {vencidas} vencido{vencidas === 1 ? "" : "s"}</span>}
        </div>
        <Button onClick={() => setCriando(true)}>+ Nova Manutenção</Button>
      </header>

      {enderecos.length === 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          ⚠️ Nenhum endereço cadastrado. Cadastre em <b>Configurações → 📍 Endereços</b> de cada empresa pra amarrar os itens por endereço.
        </div>
      )}

      {manutencoes.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📅</div>
          <p>Nenhuma manutenção cadastrada.</p>
          <p className="text-sm mt-1">Cadastre filtros, potabilidade, dedetização, CLCB, certificados, etc — o sistema lembra do próximo vencimento.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {manutencoes.map(m => {
            const atrasada = m.proximoVencimento < hoje;
            const proxima = !atrasada && m.proximoVencimento <= addDias(hoje, m.diasAntecedencia || 30);
            return (
              <div key={m.id} onClick={() => setEditando(m)}
                className={`p-3 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${atrasada ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" : proxima ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {MANUTENCAO_TIPO_LABEL[m.tipo]}
                      {m.fornecedor && <span className="text-gray-500 dark:text-gray-400 font-normal"> · {m.fornecedor}</span>}
                      {m.obrigatorio === false && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">flexível</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {MANUTENCAO_PERIODICIDADE_LABEL[m.periodicidade]}
                      {` · próx. vencimento: ${fmtBR(m.proximoVencimento)}`}
                      {atrasada && " · ⚠️ VENCIDA"}
                      {proxima && " · ⏰ próximo"}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">📍 {rotuloEnderecos(m) || "—"}</div>
                  </div>
                  {m.pastaDrive && <a href={m.pastaDrive} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-indigo-600 hover:underline shrink-0">📎 laudo</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isMaster && <ImportManutencoes restaurants={restaurants.map(r => ({ id: r.id, nome: r.nome }))} enderecos={enderecos} pessoaId={pessoa.id} existentes={manutencoes} />}

      {(criando || editando) && (
        <ManutencaoForm
          manutencao={editando}
          onClose={() => { setCriando(false); setEditando(null); }}
          restaurants={restaurants.map(r => ({ id: r.id, nome: r.nome }))}
          enderecos={enderecos}
          pessoaId={pessoa.id}
        />
      )}
    </div>
  );
}

function ManutencaoForm({ manutencao, onClose, restaurants, enderecos, pessoaId }: {
  manutencao: Manutencao | null;
  onClose: () => void;
  restaurants: { id: string; nome: string }[];
  enderecos: Endereco[];
  pessoaId: string;
}) {
  const [f, setF] = useState<Partial<Manutencao>>(manutencao ? { ...manutencao } : {
    tipo: "filtros_agua", restaurantIds: [], enderecoIds: [], obrigatorio: true,
    periodicidade: "semestral", proximoVencimento: addDias(new Date().toISOString().slice(0, 10), 180),
    diasAntecedencia: 30, responsavelPadraoId: pessoaId, projetoId: "proj-prazos", subprojetoId: "sub-prazos-manutencoes", ativo: true,
  });
  const selIds = f.enderecoIds || [];
  const toggleEnd = (id: string) => setF(p => { const cur = p.enderecoIds || []; return { ...p, enderecoIds: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }; });
  // Endereços agrupados por empresa (só ativos + os já selecionados).
  const porEmpresa = restaurants.map(r => ({ r, ends: enderecos.filter(e => e.restaurantId === r.id && (e.ativo !== false || selIds.includes(e.id))) })).filter(g => g.ends.length);

  async function salvar() {
    if (!f.tipo || !f.proximoVencimento) { alert("Tipo e próximo vencimento são obrigatórios"); return; }
    const now = new Date().toISOString();
    const id = manutencao?.id || `mt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const endIds = f.enderecoIds || [];
    const rids = [...new Set(endIds.map(eid => enderecos.find(e => e.id === eid)?.restaurantId).filter(Boolean) as string[])];
    const data: Manutencao = {
      id, tipo: f.tipo, fornecedor: f.fornecedor, descricao: f.descricao,
      restaurantIds: rids.length ? rids : (f.restaurantIds || []), enderecoIds: endIds,
      obrigatorio: f.obrigatorio ?? true,
      periodicidade: f.periodicidade || "semestral", periodicidadeCustomDias: f.periodicidadeCustomDias,
      proximoVencimento: f.proximoVencimento, ultimaExecucao: f.ultimaExecucao, diasAntecedencia: f.diasAntecedencia ?? 30,
      responsavelPadraoId: f.responsavelPadraoId || pessoaId, responsavelPadraoNome: f.responsavelPadraoNome,
      projetoId: f.projetoId || "proj-prazos", subprojetoId: f.subprojetoId || "sub-prazos-manutencoes",
      pastaDrive: f.pastaDrive, observacoes: f.observacoes, ultimaGeracaoChave: f.ultimaGeracaoChave,
      ativo: f.ativo ?? true, deletadoEm: f.deletadoEm, deletadoPor: f.deletadoPor,
      criadoEm: manutencao?.criadoEm || now, criadoPor: manutencao?.criadoPor || pessoaId, atualizadoEm: now,
    };
    await setDoc(doc(db, "manutencoes", id), sanitizeForFirestore(data));
    onClose();
  }

  function marcarRealizada() {
    if (!manutencao) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const dias = MANUTENCAO_PERIODICIDADE_DIAS[f.periodicidade || manutencao.periodicidade] || f.periodicidadeCustomDias || manutencao.periodicidadeCustomDias || 180;
    setF({ ...f, ultimaExecucao: hoje, proximoVencimento: addDias(hoje, dias) });
  }

  async function excluir() {
    if (!manutencao) return;
    if (!confirm(`Excluir essa manutenção? Vai pra lixeira.`)) return;
    await setDoc(doc(db, "manutencoes", manutencao.id), sanitizeForFirestore({ ...manutencao, deletadoEm: new Date().toISOString(), deletadoPor: pessoaId }));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{manutencao ? "Editar Manutenção" : "Nova Manutenção"}</h2>
        <div className="space-y-3">
          <Field label="Tipo *">
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as ManutencaoTipo, obrigatorio: !TIPOS_FLEXIVEIS.has(e.target.value as ManutencaoTipo) })} className="mt-input">
              {(Object.keys(MANUTENCAO_TIPO_LABEL) as ManutencaoTipo[]).map(t => <option key={t} value={t}>{MANUTENCAO_TIPO_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Fornecedor">
            <input value={f.fornecedor || ""} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} className="mt-input" placeholder="Ex: OrangeBio, Passare, Heavy Cleaning" />
          </Field>
          <Field label="Endereço(s) * — o item cobre estes locais">
            {porEmpresa.length === 0 ? (
              <p className="text-xs text-amber-600">Cadastre endereços em Configurações → 📍 Endereços.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {porEmpresa.map(({ r, ends }) => (
                  <div key={r.id}>
                    <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{r.nome}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                      {ends.map(e => (
                        <label key={e.id} className={`flex items-center gap-1 text-xs ${e.ativo === false ? "opacity-60" : ""}`}>
                          <input type="checkbox" checked={selIds.includes(e.id)} onChange={() => toggleEnd(e.id)} />
                          {e.apelido}{e.ativo === false ? " (inativo)" : ""}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={f.obrigatorio ?? true} onChange={(e) => setF({ ...f, obrigatorio: e.target.checked })} />
            Obrigatório (gera laudo / prazo rígido) <span className="text-xs text-gray-400">— desmarque se for flexível (pode adiar)</span>
          </label>
          <Field label="Periodicidade *">
            <select value={f.periodicidade} onChange={(e) => setF({ ...f, periodicidade: e.target.value as ManutencaoPeriodicidade })} className="mt-input">
              {(Object.keys(MANUTENCAO_PERIODICIDADE_LABEL) as ManutencaoPeriodicidade[]).map(p => <option key={p} value={p}>{MANUTENCAO_PERIODICIDADE_LABEL[p]}</option>)}
            </select>
          </Field>
          {f.periodicidade === "custom" && (
            <Field label="Dias customizados">
              <input type="number" min="1" value={f.periodicidadeCustomDias || ""} onChange={(e) => setF({ ...f, periodicidadeCustomDias: parseInt(e.target.value) || 0 })} className="mt-input" />
            </Field>
          )}
          <Field label="Próximo vencimento *">
            <input type="date" value={f.proximoVencimento || ""} onChange={(e) => setF({ ...f, proximoVencimento: e.target.value })} className="mt-input" />
          </Field>
          {manutencao && (
            <div className="flex gap-2 items-center">
              <Button size="sm" variant="ghost" onClick={marcarRealizada}>✓ Marcar realizada hoje</Button>
              <span className="text-xs text-gray-500 dark:text-gray-400">— recalcula próximo vencimento</span>
            </div>
          )}
          <Field label="Dias de antecedência do lembrete">
            <input type="number" min="0" max="120" value={f.diasAntecedencia ?? 30} onChange={(e) => setF({ ...f, diasAntecedencia: parseInt(e.target.value) || 0 })} className="mt-input" />
          </Field>
          <Field label="Link do laudo/certificado (Drive)">
            <input value={f.pastaDrive || ""} onChange={(e) => setF({ ...f, pastaDrive: e.target.value })} className="mt-input" placeholder="https://drive.google.com/..." />
          </Field>
          <Field label="Observações">
            <textarea value={f.observacoes || ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} className="mt-input" rows={2} />
          </Field>
        </div>
        <style>{`.mt-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .mt-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex gap-2 justify-between mt-5">
          {manutencao ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost">Cancelar</Button>
            <Button onClick={salvar}>{manutencao ? "Salvar" : "Criar"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Import provisório do CSV do Asana (carga histórica) ─────────────────────
function ImportManutencoes({ restaurants, enderecos, pessoaId, existentes }: {
  restaurants: { id: string; nome: string }[]; enderecos: Endereco[]; pessoaId: string; existentes: Manutencao[];
}) {
  const [status, setStatus] = useState("");
  const [rodando, setRodando] = useState(false);
  const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function tipoDe(name: string): ManutencaoTipo {
    const n = norm(name);
    if (n.includes("filtro")) return "filtros_agua";
    if (n.includes("gelo")) return "gelo";
    if (n.includes("potabilidade") && n.includes("agua")) return "potabilidade_agua";
    if (n.includes("caixa")) return "caixa_dagua";
    if (n.includes("dedetiz")) return "dedetizacao";
    if (n.includes("oleo")) return "coleta_oleo";
    if (n.includes("residuo") || n.includes("destinacao")) return "destinacao_residuos";
    if (n.includes("coifa")) return "coifa";
    if (n.includes("estofado")) return "estofado";
    if (n.includes("ar condicionado") || n.includes("ar-condicionado")) return "ar_condicionado";
    if (n.includes("termometro") || n.includes("calibra")) return "termometro";
    if (n.includes("clcb") || n.includes("bombeiro")) return "clcb_bombeiros";
    if (n.includes("cmvs") || n.includes("vigilancia") || n.includes("sanitaria")) return "cmvs_vigilancia";
    if (n.includes("alvara")) return "alvara_funcionamento";
    if (n.includes("pgr")) return "pgr";
    if (n.includes("pcmso")) return "pcmso";
    if (n.includes("certificado digital")) return "certificado_digital";
    if (n.includes("licenciamento")) return "licenciamento_integrado";
    return "outro";
  }
  function periodDe(notes: string, tipo: ManutencaoTipo): ManutencaoPeriodicidade {
    const n = norm(notes);
    if (/45\s*dias/.test(n)) return "45_dias";
    if (/3\s*meses|trimestral/.test(n)) return "trimestral";
    if (/6\s*meses|semestral/.test(n)) return "semestral";
    if (/12\s*meses|anual|1\s*ano/.test(n)) return "anual";
    const porTipo: Partial<Record<ManutencaoTipo, ManutencaoPeriodicidade>> = { dedetizacao: "trimestral", gelo: "trimestral", ar_condicionado: "45_dias", potabilidade_agua: "semestral", caixa_dagua: "semestral", filtros_agua: "semestral", coifa: "anual", termometro: "anual" };
    return porTipo[tipo] || "anual";
  }
  function resolveEndereco(label: string): string | null {
    const n = norm(label);
    const acha = (pred: (e: Endereco) => boolean) => enderecos.find(pred)?.id || null;
    const emp = (e: Endereco) => norm(restaurants.find(r => r.id === e.restaurantId)?.nome || "");
    const ap = (e: Endereco) => norm(e.apelido) + " " + norm(e.logradouro || "");
    if (n.includes("porto")) return acha(e => ap(e).includes("porto"));
    if (n.includes("harmonia")) return acha(e => ap(e).includes("harmonia"));
    if (n.includes("simao") || n.includes("alvares")) return acha(e => ap(e).includes("simao") || ap(e).includes("alvares") || ap(e).includes("785"));
    if (n.includes("patizal")) return acha(e => ap(e).includes("patizal"));
    if (n.includes("lobozo")) return acha(e => emp(e).includes("lobozo"));
    if (n.includes("quibebe")) return acha(e => emp(e).includes("quibebe"));
    if (n.includes("puba")) return acha(e => emp(e).includes("puba") && !ap(e).includes("porto"));
    return null;
  }

  async function importar(file: File) {
    setStatus(""); setRodando(true);
    try {
      if (!enderecos.length) { setStatus("⚠️ Cadastre os endereços primeiro (Configurações → 📍 Endereços)."); return; }
      const rows = parseCSV(await file.text());   // parser próprio: preserva datas YYYY-MM-DD
      const head = rows[0].map(h => norm(String(h)));
      const col = (frag: string) => head.findIndex(h => h.includes(frag));
      const iName = col("name"), iDue = col("due date"), iNotes = col("notes"), iEmp = head.length - 1;  // Empresas(s) = última
      const now = new Date().toISOString();
      const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
      let n = 0, semEndereco = 0, jaExiste = 0;
      const chaveExistente = new Set(existentes.map(m => `${m.tipo}|${m.proximoVencimento}|${(m.enderecoIds || []).slice().sort().join(",")}`));

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; const name = String(row[iName] || "").trim(); if (!name) continue;
        const due = String(row[iDue] || "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;   // sem vencimento → pula
        const notes = String(row[iNotes] || "");
        const tipo = tipoDe(name);
        const fornBruto = name.includes("|") ? name.split("|").pop()!.replace(/\(.*?\)/g, "").trim() : "";
        const fornecedor = /harmonia|simao|alvares|patizal|porto|\d{3}/.test(norm(fornBruto)) ? "" : fornBruto;
        const link = (notes.match(/https?:\/\/drive\.google\.com\/[^\s"')]+/) || [])[0] || "";
        const labels = String(row[iEmp] || "").split(",").map(s => s.trim()).filter(Boolean);
        const endIds = [...new Set(labels.map(resolveEndereco).filter(Boolean) as string[])];
        if (!endIds.length) { semEndereco++; continue; }
        const rids = [...new Set(endIds.map(eid => enderecos.find(e => e.id === eid)?.restaurantId).filter(Boolean) as string[])];
        const chave = `${tipo}|${due}|${endIds.slice().sort().join(",")}`;
        if (chaveExistente.has(chave)) { jaExiste++; continue; }
        chaveExistente.add(chave);
        const id = `mt-imp-${row[0] || Math.random().toString(36).slice(2, 8)}`;
        ops.push(b => b.set(doc(db, "manutencoes", id), sanitizeForFirestore({
          id, tipo, fornecedor: fornecedor || undefined, restaurantIds: rids, enderecoIds: endIds,
          obrigatorio: !TIPOS_FLEXIVEIS.has(tipo), periodicidade: periodDe(notes, tipo),
          proximoVencimento: due, diasAntecedencia: 30, responsavelPadraoId: pessoaId,
          projetoId: "proj-prazos", subprojetoId: "sub-prazos-manutencoes",
          pastaDrive: link || undefined, observacoes: notes.replace(/https?:\/\/\S+/g, "").trim() || undefined,
          ativo: true, criadoEm: now, criadoPor: pessoaId, atualizadoEm: now,
        })));
        n++;
      }
      if (!n) { setStatus(`Nada a importar. ${semEndereco} sem endereço reconhecido, ${jaExiste} já existentes.`); return; }
      const vencidos = rows.slice(1).filter(row => { const d = String(row[iDue] || ""); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < now.slice(0, 10); }).length;
      if (!confirm(`Importar ${n} manutenções/licenças (${vencidos} já vencidas)?${semEndereco ? `\n${semEndereco} item(ns) sem endereço reconhecido serão pulados.` : ""}${jaExiste ? `\n${jaExiste} já existentes serão puladas.` : ""}`)) { setStatus(""); return; }
      for (let k = 0; k < ops.length; k += 450) { const b = writeBatch(db); for (const op of ops.slice(k, k + 450)) op(b); await b.commit(); }
      setStatus(`✅ Importado: ${n} itens${semEndereco ? ` · ${semEndereco} sem endereço (pulados)` : ""}.`);
    } catch (e) { setStatus("Erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setRodando(false); }
  }

  return (
    <div className="mt-6 max-w-lg rounded-2xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-4 space-y-2">
      <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">🧪 Importar CSV (Asana — provisório)</div>
      <p className="text-xs text-gray-600 dark:text-gray-400">Sobe o CSV "Prazos de Licenças…". Mapeia tipo, fornecedor, vencimento, link do Drive e endereço(s) por N:N. Requer os endereços cadastrados. Idempotente (pula duplicados por tipo+vencimento+endereço).</p>
      <label className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${rodando ? "opacity-50" : "border-amber-400 bg-white dark:bg-gray-900 hover:bg-amber-50 text-amber-700 dark:text-amber-300"}`}>
        {rodando ? "Importando…" : "📥 Subir CSV e importar"}
        <input type="file" accept=".csv" className="hidden" disabled={rodando} onChange={e => { const f = e.target.files?.[0]; if (f) void importar(f); e.currentTarget.value = ""; }} />
      </label>
      {status && <p className={`text-xs ${status.startsWith("✅") ? "text-emerald-600" : status.startsWith("⚠️") ? "text-amber-700" : "text-gray-600 dark:text-gray-400"}`}>{status}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>{children}</label>;
}

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Parser CSV robusto (campos com aspas, vírgulas e quebras de linha embutidas).
// Preserva os valores originais (datas ficam "YYYY-MM-DD", sem reinterpretação).
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
