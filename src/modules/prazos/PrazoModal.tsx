// Modal único de criar/editar prazo. O tipo é o segmented do topo; muda só o
// bloco de extras. Recorrência recolhida numa linha que expande. Editar afeta
// só as próximas ocorrências (o histórico é congelado).
import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Prazo, PrazoTipo, PrazoRecorrencia, PrazoSubtipoTrab, Empregado, Pessoa, Imovel } from "../../core/types";
import { PRAZO_TIPO_LABEL, PRAZO_SUBTIPO_TRAB_LABEL } from "../../core/types";
import { resumoRecorrencia } from "./recorrencia";
import { ANTECEDENCIA_PADRAO } from "./logic";
import { Stepper, DatePickerBR } from "./campos";

const ymdToBr = (ymd?: string) => { if (!ymd) return ""; const [a, m, d] = ymd.split("-"); return `${d}/${m}/${a}`; };
const brToYmd = (br: string) => { const [d, m, a] = br.split("/"); return (d && m && a) ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ""; };
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const uid = () => `prazo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
const chip = (on: boolean) => `px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`;

const TIPOS: Array<{ v: PrazoTipo; icon: string }> = [{ v: "conta", icon: "💰" }, { v: "tecnico", icon: "🛠️" }, { v: "trabalhista", icon: "🧑‍⚖️" }, { v: "avulso", icon: "🚩" }];

export function PrazoModal({ rid, prazo, empregados, pessoas, imoveis, onGerenciarImoveis, onClose, onSalvar }: {
  rid: string; prazo: Prazo | null; empregados: Empregado[]; pessoas: Pessoa[]; imoveis: Imovel[];
  onGerenciarImoveis: () => void; onClose: () => void; onSalvar: (p: Prazo) => Promise<void>;
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
  const [imovelId, setImovelId] = useState<string>(prazo?.imovelId || "");
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
        restaurantIds: [rid],
        titulo: titulo.trim(), tipo, vencimento: vy,
        imovelId: imovelId || null,
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
    <Modal title={editando ? "Editar prazo" : "Novo prazo"} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-3">
        {/* Tipo */}
        <div className="flex gap-1.5">
          {TIPOS.map(({ v, icon }) => (
            <button key={v} type="button" onClick={() => trocarTipo(v)} style={{ height: 66 }} className={`flex-1 flex flex-col items-center justify-center gap-1.5 text-xs rounded-lg border box-border ${tipo === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
              <span style={{ height: 22, fontSize: 20 }} className="flex items-center justify-center leading-none">{icon}</span>
              <span className="leading-none">{PRAZO_TIPO_LABEL[v]}</span>
            </button>
          ))}
        </div>

        <div><label className="text-xs text-gray-500 block mb-1">Título</label><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Aluguel do salão" className={inp} /></div>

        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Vencimento</label><DatePickerBR value={venc} onChange={setVenc} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">Responsável</label>
            <select value={respId} onChange={(e) => setRespId(e.target.value)} className={inp}><option value="">—</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 py-1">
          <span>Avisar</span>
          <Stepper value={antec} onChange={setAntec} min={0} max={365} />
          <span>dias antes do vencimento</span>
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

        {/* Imóvel (opcional) — pros técnicos e aluguel. Cada imóvel é de 1 empresa. */}
        {(tipo === "tecnico" || tipo === "conta") && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Imóvel <span className="text-gray-400">(opcional)</span></label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setImovelId("")} className={chip(imovelId === "")}>Nenhum</button>
              {imoveis.map((im) => (
                <button key={im.id} type="button" onClick={() => setImovelId(im.id)} className={chip(imovelId === im.id)}>🏠 {im.apelido}</button>
              ))}
              <button type="button" onClick={onGerenciarImoveis} className="px-3 py-1.5 text-xs rounded-full border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400">+ Imóvel</button>
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
        <div className="mt-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 p-3 space-y-3">
          {/* A cada N semanas/meses */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs text-gray-500 w-16 shrink-0">A cada</span>
            <Stepper value={r.intervalo} onChange={(n) => patch({ intervalo: Math.max(1, n) })} min={1} max={60} />
            <div className="flex gap-1.5">
              <button type="button" onClick={() => patch({ unidade: "semana" })} className={chip(r.unidade === "semana")}>semana(s)</button>
              <button type="button" onClick={() => patch({ unidade: "mes" })} className={chip(r.unidade === "mes")}>mês(es)</button>
            </div>
          </div>

          {r.unidade === "mes" ? (
            <>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs text-gray-500 w-16 shrink-0">Quando</span>
                <button type="button" onClick={() => patch({ modo: "dia_absoluto" })} className={chip(r.modo !== "dia_util")}>Dia do mês</button>
                <button type="button" onClick={() => patch({ modo: "dia_util" })} className={chip(r.modo === "dia_util")}>Dia útil</button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-500 w-16 shrink-0">{r.modo === "dia_util" ? "No" : "Dia"}</span>
                {r.modo === "dia_util" ? (
                  r.diaUtil === "ultimo" ? (
                    <>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Último dia útil</span>
                      <button type="button" onClick={() => patch({ diaUtil: 1 })} className="px-3 py-1.5 text-xs rounded-full border border-gray-200 dark:border-gray-700 text-gray-500">escolher número</button>
                    </>
                  ) : (
                    <>
                      <Stepper value={typeof r.diaUtil === "number" ? r.diaUtil : 1} onChange={(n) => patch({ diaUtil: Math.min(23, Math.max(1, n)) })} min={1} max={23} sufixo="º" />
                      <span className="text-sm text-gray-600 dark:text-gray-300">dia útil</span>
                      <button type="button" onClick={() => patch({ diaUtil: "ultimo" })} className={chip(false)}>ou o último</button>
                    </>
                  )
                ) : (
                  <Stepper value={r.diaDoMes || 1} onChange={(n) => patch({ diaDoMes: Math.min(31, Math.max(1, n)) })} min={1} max={31} />
                )}
              </div>
              {r.modo === "dia_util" && (
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer pl-[4.5rem]">
                  <input type="checkbox" checked={!!r.contaSabado} onChange={(e) => patch({ contaSabado: e.target.checked })} /> Sábado conta como dia útil
                </label>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-gray-500 w-16 shrink-0">Nos dias</span>
              <div className="grid grid-cols-7 gap-1 flex-1">
                {DOW.map((lbl, dow) => { const sel = (r.diasSemana || []).includes(dow); return (
                  <button key={dow} type="button" onClick={() => { const cur = r.diasSemana || []; patch({ diasSemana: sel ? cur.filter((x) => x !== dow) : [...cur, dow].sort() }); }} className={`py-1.5 text-xs rounded-lg border ${sel ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>{lbl}</button>
                ); })}
              </div>
            </div>
          )}

          <div className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5 bg-indigo-100/60 dark:bg-indigo-900/30 rounded-lg px-2.5 py-2 font-medium">🔁 {resumoRecorrencia(r)}</div>
        </div>
      )}
    </div>
  );
}
