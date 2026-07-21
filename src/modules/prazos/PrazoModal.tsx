// Modal único de criar/editar prazo. O tipo é o segmented do topo; muda só o
// bloco de extras. Recorrência recolhida numa linha que expande. Editar afeta
// só as próximas ocorrências (o histórico é congelado).
import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Prazo, PrazoTipo, PrazoRecorrencia, PrazoSubtipoTrab, Empregado, Pessoa, Restaurant } from "../../core/types";
import { PRAZO_TIPO_LABEL, PRAZO_SUBTIPO_TRAB_LABEL } from "../../core/types";
import { resumoRecorrencia } from "./recorrencia";
import { ANTECEDENCIA_PADRAO } from "./logic";

const ymdToBr = (ymd?: string) => { if (!ymd) return ""; const [a, m, d] = ymd.split("-"); return `${d}/${m}/${a}`; };
const brToYmd = (br: string) => { const [d, m, a] = br.split("/"); return (d && m && a) ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ""; };
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const uid = () => `prazo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const inp = "w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
const chip = (on: boolean) => `px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`;

const TIPOS: Array<{ v: PrazoTipo; icon: string }> = [{ v: "conta", icon: "💰" }, { v: "tecnico", icon: "🛠️" }, { v: "trabalhista", icon: "🧑‍⚖️" }, { v: "avulso", icon: "🚩" }];

export function PrazoModal({ rid, prazo, empregados, pessoas, restaurantes, onClose, onSalvar }: {
  rid: string; prazo: Prazo | null; empregados: Empregado[]; pessoas: Pessoa[]; restaurantes: Restaurant[];
  onClose: () => void; onSalvar: (p: Prazo) => Promise<void>;
}) {
  const editando = !!prazo;
  const [tipo, setTipo] = useState<PrazoTipo>(prazo?.tipo || "conta");
  const [titulo, setTitulo] = useState(prazo?.titulo || "");
  const [venc, setVenc] = useState(ymdToBr(prazo?.vencimento) || "");
  const [respId, setRespId] = useState(prazo?.responsavelId || "");
  const [antec, setAntec] = useState<number>(prazo?.antecedenciaDias ?? ANTECEDENCIA_PADRAO[prazo?.tipo || "conta"]);
  const [rec, setRec] = useState<PrazoRecorrencia | null>(prazo?.recorrencia ?? null);
  const [exigeLaudo, setExigeLaudo] = useState<boolean>(prazo?.exigeLaudo ?? (prazo?.tipo === "tecnico"));
  const [dados, setDados] = useState<NonNullable<Prazo["dados"]>>(prazo?.dados || {});
  const [restIds, setRestIds] = useState<string[]>(prazo?.restaurantIds || [rid]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const empDoRest = useMemo(() => empregados.filter((e) => e.restaurantId === rid), [empregados, rid]);

  function trocarTipo(t: PrazoTipo) {
    setTipo(t);
    setAntec(ANTECEDENCIA_PADRAO[t]);
    if (t === "tecnico") setExigeLaudo(true); else if (t === "conta" || t === "avulso") setExigeLaudo(false);
    if (!rec && (t === "conta" || t === "tecnico")) setRec({ unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes: parseInt(venc.split("/")[0]) || 1 });
  }

  async function salvar() {
    const vy = brToYmd(venc);
    if (!titulo.trim()) return setErro("Dê um título.");
    if (!vy) return setErro("Vencimento inválido (dd/mm/aaaa).");
    setSalvando(true); setErro("");
    try {
      const resp = pessoas.find((p) => p.id === respId);
      const emp = empDoRest.find((e) => e.id === dados.empregadoId);
      const p: Prazo = {
        id: prazo?.id || uid(),
        restaurantIds: restIds.length ? restIds : [rid],
        titulo: titulo.trim(), tipo, vencimento: vy,
        responsavelId: respId || null, responsavelNome: resp?.nome || null,
        antecedenciaDias: antec,
        recorrencia: rec,
        exigeLaudo,
        status: prazo?.status || "aberto",
        dados: { ...dados, ...(emp ? { empregadoNome: emp.nome } : {}) },
        laudo: prazo?.laudo ?? null,
        agendamento: prazo?.agendamento ?? null,
        origem: prazo?.origem ?? null,
        historico: prazo?.historico || [],
        criadoEm: prazo?.criadoEm || new Date().toISOString(),
        criadoPor: prazo?.criadoPor ?? null,
      };
      await onSalvar(p);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao salvar."); setSalvando(false); }
  }

  return (
    <Modal title={editando ? "Editar prazo" : "Novo prazo"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {/* Tipo */}
        <div className="flex gap-1.5">
          {TIPOS.map(({ v, icon }) => (
            <button key={v} type="button" onClick={() => trocarTipo(v)} className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs rounded-lg border ${tipo === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
              <span className="text-lg">{icon}</span>{PRAZO_TIPO_LABEL[v]}
            </button>
          ))}
        </div>

        <div><label className="text-xs text-gray-500 block mb-1">Título</label><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Aluguel do salão" className={inp} /></div>

        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Vencimento</label><input value={venc} onChange={(e) => setVenc(e.target.value)} placeholder="dd/mm/aaaa" className={inp} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">Responsável</label>
            <select value={respId} onChange={(e) => setRespId(e.target.value)} className={inp}><option value="">—</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          </div>
        </div>

        <div><label className="text-xs text-gray-500 block mb-1">Avisar {antec} dias antes</label>
          <input type="number" min={0} max={365} value={antec} onChange={(e) => setAntec(Math.max(0, parseInt(e.target.value) || 0))} className="w-24 px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        </div>

        <RecorrenciaEditor rec={rec} onChange={setRec} />

        {/* Extras por tipo */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
          {tipo === "conta" && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Valor</label><input value={dados.valor ?? ""} onChange={(e) => setDados({ ...dados, valor: parseFloat(e.target.value.replace(",", ".")) || undefined })} placeholder="0,00" className={inp} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Categoria</label><input value={dados.categoria || ""} onChange={(e) => setDados({ ...dados, categoria: e.target.value })} placeholder="Aluguel, sistemas…" className={inp} /></div>
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Chave PIX (opcional)</label><input value={dados.pix || ""} onChange={(e) => setDados({ ...dados, pix: e.target.value })} placeholder="CNPJ, e-mail ou chave" className={inp} /></div>
            </div>
          )}
          {tipo === "tecnico" && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Fornecedor</label><input value={dados.fornecedor || ""} onChange={(e) => setDados({ ...dados, fornecedor: e.target.value })} placeholder="Prestador" className={inp} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Nº do laudo (opcional)</label><input value={dados.numeroLaudo || ""} onChange={(e) => setDados({ ...dados, numeroLaudo: e.target.value })} className={inp} /></div>
            </div>
          )}
          {tipo === "trabalhista" && (
            <div className="space-y-2">
              <div><label className="text-xs text-gray-500 block mb-1">Empregado</label>
                <select value={dados.empregadoId || ""} onChange={(e) => setDados({ ...dados, empregadoId: e.target.value })} className={inp}><option value="">—</option>{empDoRest.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Tipo de prazo</label>
                <div className="flex gap-1.5 flex-wrap">{(Object.keys(PRAZO_SUBTIPO_TRAB_LABEL) as PrazoSubtipoTrab[]).map((s) => (
                  <button key={s} type="button" onClick={() => setDados({ ...dados, subtipoTrab: s })} className={chip(dados.subtipoTrab === s)}>{PRAZO_SUBTIPO_TRAB_LABEL[s]}</button>
                ))}</div>
              </div>
            </div>
          )}
          {tipo === "avulso" && <p className="text-xs text-gray-400">Sem campos extras — é só um lembrete de data.</p>}
        </div>

        {/* Exige laudo */}
        {tipo !== "avulso" && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
            <input type="checkbox" checked={exigeLaudo} onChange={(e) => setExigeLaudo(e.target.checked)} /> Exige laudo pra concluir
          </label>
        )}

        {/* Empresas (compartilhado quando >1) */}
        {restaurantes.length > 1 && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Empresa(s) deste prazo</label>
            <div className="flex flex-wrap gap-1.5">
              {restaurantes.map((r) => { const on = restIds.includes(r.id); return (
                <button key={r.id} type="button" onClick={() => setRestIds(on ? restIds.filter((x) => x !== r.id) : [...restIds, r.id])} className={chip(on)}>{on ? "✓ " : ""}{r.nome}</button>
              ); })}
            </div>
          </div>
        )}

        {erro && <p className="text-sm text-rose-600">{erro}</p>}
        {editando && rec && <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠ Mudanças valem só pras próximas ocorrências — o histórico não muda.</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : editando ? "Salvar" : "Criar prazo"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Editor de recorrência ──
function RecorrenciaEditor({ rec, onChange }: { rec: PrazoRecorrencia | null; onChange: (r: PrazoRecorrencia | null) => void }) {
  const on = !!rec;
  const r = rec || { unidade: "mes" as const, intervalo: 1, modo: "dia_absoluto" as const, diaDoMes: 1 };
  const patch = (p: Partial<PrazoRecorrencia>) => onChange({ ...r, ...p });
  return (
    <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Repetição</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onChange(null)} className={chip(!on)}>Não repete</button>
          <button type="button" onClick={() => onChange(r)} className={chip(on)}>Repete</button>
        </div>
      </div>
      {on && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">A cada</span>
            <input type="number" min={1} value={r.intervalo} onChange={(e) => patch({ intervalo: Math.max(1, parseInt(e.target.value) || 1) })} className="w-16 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <div className="flex gap-1.5">
              <button type="button" onClick={() => patch({ unidade: "semana" })} className={chip(r.unidade === "semana")}>semana(s)</button>
              <button type="button" onClick={() => patch({ unidade: "mes" })} className={chip(r.unidade === "mes")}>mês(es)</button>
            </div>
          </div>
          {r.unidade === "mes" ? (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <button type="button" onClick={() => patch({ modo: "dia_absoluto" })} className={chip(r.modo !== "dia_util")}>Dia do mês</button>
                <button type="button" onClick={() => patch({ modo: "dia_util" })} className={chip(r.modo === "dia_util")}>Dia útil</button>
              </div>
              {r.modo === "dia_util" ? (
                <div className="flex items-center gap-2"><span className="text-xs text-gray-500">No</span>
                  <select value={String(r.diaUtil ?? 1)} onChange={(e) => patch({ diaUtil: e.target.value === "ultimo" ? "ultimo" : parseInt(e.target.value) })} className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                    {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n}º</option>)}<option value="ultimo">último</option>
                  </select><span className="text-xs text-gray-500">dia útil</span>
                </div>
              ) : (
                <div className="flex items-center gap-2"><span className="text-xs text-gray-500">Dia</span>
                  <input type="number" min={1} max={31} value={r.diaDoMes || 1} onChange={(e) => patch({ diaDoMes: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) })} className="w-16 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {DOW.map((lbl, dow) => { const sel = (r.diasSemana || []).includes(dow); return (
                <button key={dow} type="button" onClick={() => { const cur = r.diasSemana || []; patch({ diasSemana: sel ? cur.filter((x) => x !== dow) : [...cur, dow].sort() }); }} className={`py-1.5 text-xs rounded-lg border ${sel ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>{lbl}</button>
              ); })}
            </div>
          )}
          <div className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg px-2.5 py-1.5">🔁 {resumoRecorrencia(r)}</div>
        </div>
      )}
    </div>
  );
}
