import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { MODULES } from "../../config/modules";
import type { ModuleId, Pessoa, Rotina, RotinaRecorrencia } from "../../core/types";
import { salvarRotina } from "./repository";
import { recorrenciaLabel, proximaData } from "./rotinasEngine";
import { subDestinosDe } from "./subDestinos";

const DIAS = [
  { v: 0, l: "Dom" }, { v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" },
  { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" },
];
const TIPOS: { v: RotinaRecorrencia["tipo"]; l: string; sub: string }[] = [
  { v: "semanal", l: "Semanal", sub: "dias da semana" },
  { v: "mensal_dia", l: "Mensal", sub: "dia do mês" },
  { v: "mensal_posicao", l: "Mensal", sub: "posição (1ª seg…)" },
  { v: "quinzenal", l: "Quinzenal", sub: "a cada 15 dias" },
];

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">{titulo}</div>
      {children}
    </div>
  );
}

type Props = {
  rid: string;
  rotina: Rotina | null;
  pessoas: Pessoa[];
  modulosAtivos: ModuleId[];
  meId: string;
  meNome: string;
  onClose: () => void;
};

export function RotinaModal({ rid, rotina, pessoas, modulosAtivos, meId, meNome, onClose }: Props) {
  const [titulo, setTitulo] = useState(rotina?.titulo || "");
  const [descricao, setDescricao] = useState(rotina?.descricao || "");
  const [moduloAlvo, setModuloAlvo] = useState<ModuleId | "">(rotina?.moduloAlvo || "");
  const [subAlvo, setSubAlvo] = useState<string>(rotina?.subAlvo || "");
  const [responsaveis, setResponsaveis] = useState<string[]>(rotina?.responsaveis || []);
  const [buscaResp, setBuscaResp] = useState("");
  const [rec, setRec] = useState<RotinaRecorrencia>(rotina?.recorrencia || { tipo: "semanal", diasSemana: [2] });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const hoje = new Date().toISOString().slice(0, 10);
  const proxima = useMemo(() => proximaData(rec, hoje), [rec, hoje]);
  const subDestinos = useMemo(() => subDestinosDe(moduloAlvo || undefined), [moduloAlvo]);

  const modulosDisponiveis = useMemo(
    () => MODULES.filter(m => !m.oculto && m.id !== "rotinas" && modulosAtivos.includes(m.id)),
    [modulosAtivos],
  );

  // Ao trocar de módulo, zera a sub-aba se ela não pertence ao novo módulo.
  useEffect(() => {
    if (subAlvo && !subDestinos.some(s => s.id === subAlvo)) setSubAlvo("");
  }, [subDestinos, subAlvo]);

  const pessoasFiltradas = useMemo(() => {
    const f = buscaResp.trim().toLowerCase();
    if (!f) return pessoas;
    return pessoas.filter(p => p.nome.toLowerCase().includes(f));
  }, [pessoas, buscaResp]);
  const selecionadas = useMemo(() => pessoas.filter(p => responsaveis.includes(p.id)), [pessoas, responsaveis]);

  function toggleResp(id: string) {
    setResponsaveis(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleDia(v: number) {
    setRec(prev => prev.tipo !== "semanal" ? prev
      : { ...prev, diasSemana: prev.diasSemana.includes(v) ? prev.diasSemana.filter(d => d !== v) : [...prev.diasSemana, v] });
  }
  function setTipo(t: RotinaRecorrencia["tipo"]) {
    if (t === "semanal") setRec({ tipo: "semanal", diasSemana: rec.tipo === "semanal" ? rec.diasSemana : [2] });
    else if (t === "mensal_dia") setRec({ tipo: "mensal_dia", diaDoMes: 1 });
    else if (t === "mensal_posicao") setRec({ tipo: "mensal_posicao", posicao: 1, diaSemana: 1 });
    else setRec({ tipo: "quinzenal", dataBase: hoje });
  }

  async function salvar() {
    setErro("");
    if (!titulo.trim()) return setErro("Dê um título pra rotina.");
    if (responsaveis.length === 0) return setErro("Atribua pelo menos uma pessoa.");
    if (rec.tipo === "semanal" && rec.diasSemana.length === 0) return setErro("Escolha ao menos um dia da semana.");
    if (rec.tipo === "quinzenal" && !rec.dataBase) return setErro("Defina a data-base da quinzena.");

    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const nomes: Record<string, string> = {};
      for (const id of responsaveis) { const p = pessoas.find(x => x.id === id); if (p) nomes[id] = p.nome; }
      const nova: Rotina = {
        id: rotina?.id || `rot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        restaurantId: rid,
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        moduloAlvo: moduloAlvo || undefined,
        subAlvo: moduloAlvo && subAlvo ? subAlvo : undefined,
        responsaveis,
        responsaveisNomes: nomes,
        recorrencia: rec,
        ativo: rotina?.ativo ?? true,
        criadoEm: rotina?.criadoEm || now,
        criadoPor: rotina?.criadoPor || meId,
        criadoPorNome: rotina?.criadoPorNome || meNome,
        atualizadoEm: now,
      };
      await salvarRotina(nova);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";

  return (
    <Modal title={rotina ? "Editar rotina" : "Nova rotina"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* O quê */}
        <Secao titulo="O que precisa ser feito">
          <div className="space-y-2">
            <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Fechar o ponto da semana" />
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
              placeholder="Detalhes (opcional)" className={inputCls} />
          </div>
        </Secao>

        {/* Onde (módulo + sub-aba em cascata) */}
        <Secao titulo="Onde (leva o responsável direto pra tela)">
          <div className="grid sm:grid-cols-2 gap-2">
            <select value={moduloAlvo} onChange={e => setModuloAlvo(e.target.value as ModuleId | "")} className={inputCls}>
              <option value="">— nenhuma (só lembrete) —</option>
              {modulosDisponiveis.map(m => <option key={m.id} value={m.id}>{m.icon} {m.label}</option>)}
            </select>
            {subDestinos.length > 0 ? (
              <select value={subAlvo} onChange={e => setSubAlvo(e.target.value)} className={inputCls}>
                <option value="">Módulo inteiro (tela inicial)</option>
                {subDestinos.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            ) : (
              <div className="text-[11px] text-gray-400 dark:text-gray-500 self-center px-1">
                {moduloAlvo ? "Este módulo não tem abas específicas." : "Escolha um módulo pra ver as abas."}
              </div>
            )}
          </div>
        </Secao>

        {/* Recorrência */}
        <Secao titulo="Quando se repete">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {TIPOS.map(t => {
              const ativo = rec.tipo === t.v;
              return (
                <button key={t.v + t.sub} type="button" onClick={() => setTipo(t.v)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    ativo ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30" : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                  }`}>
                  <div className={`text-sm font-semibold ${ativo ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-gray-100"}`}>{t.l}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">{t.sub}</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
            {rec.tipo === "semanal" && (
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map(d => (
                  <button key={d.v} type="button" onClick={() => toggleDia(d.v)}
                    className={`w-11 py-1.5 rounded-md text-xs font-semibold border ${
                      rec.diasSemana.includes(d.v)
                        ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900"
                    }`}>{d.l}</button>
                ))}
              </div>
            )}
            {rec.tipo === "mensal_dia" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-300">Todo dia</span>
                <input type="number" min={1} max={31} value={rec.diaDoMes}
                  onChange={e => setRec({ tipo: "mensal_dia", diaDoMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                  className="w-20 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right" />
                <span className="text-[11px] text-gray-500">(31 = último dia do mês)</span>
              </div>
            )}
            {rec.tipo === "mensal_posicao" && (
              <div className="flex items-center gap-2 flex-wrap">
                <select value={rec.posicao} onChange={e => setRec({ ...rec, posicao: Number(e.target.value) as 1 | 2 | 3 | 4 | -1 })}
                  className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <option value={1}>1ª</option><option value={2}>2ª</option><option value={3}>3ª</option><option value={4}>4ª</option><option value={-1}>última</option>
                </select>
                <select value={rec.diaSemana} onChange={e => setRec({ ...rec, diaSemana: Number(e.target.value) })}
                  className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  {DIAS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
                <span className="text-sm text-gray-600 dark:text-gray-300">do mês</span>
              </div>
            )}
            {rec.tipo === "quinzenal" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-300">A partir de</span>
                <input type="date" value={rec.dataBase} onChange={e => setRec({ tipo: "quinzenal", dataBase: e.target.value })}
                  className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              </div>
            )}
            <div className="text-[11px] text-indigo-700 dark:text-indigo-300 mt-2 font-medium">
              🔁 {recorrenciaLabel(rec)}{proxima && ` · próxima: ${proxima.split("-").reverse().join("/")}`}
            </div>
          </div>
        </Secao>

        {/* Responsáveis */}
        <Secao titulo={`Responsáveis${responsaveis.length ? ` (${responsaveis.length})` : ""}`}>
          {selecionadas.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selecionadas.map(p => (
                <button key={p.id} type="button" onClick={() => toggleResp(p.id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  {p.nome} <span className="text-indigo-400">✕</span>
                </button>
              ))}
            </div>
          )}
          <Input value={buscaResp} onChange={e => setBuscaResp(e.target.value)} placeholder="🔍 Buscar pessoa…" className="mb-1" />
          <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {pessoasFiltradas.length === 0 ? (
              <div className="p-3 text-sm text-gray-500">Nenhuma pessoa.</div>
            ) : pessoasFiltradas.map(p => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <input type="checkbox" checked={responsaveis.includes(p.id)} onChange={() => toggleResp(p.id)} className="accent-indigo-600" />
                <span className="text-gray-900 dark:text-gray-100">{p.nome}</span>
              </label>
            ))}
          </div>
        </Secao>

        {erro && <div className="text-sm text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar rotina"}</Button>
        </div>
      </div>
    </Modal>
  );
}
