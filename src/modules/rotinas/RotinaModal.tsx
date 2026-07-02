import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { MODULES } from "../../config/modules";
import type { ModuleId, Pessoa, Rotina, RotinaRecorrencia } from "../../core/types";
import { salvarRotina } from "./repository";
import { recorrenciaLabel, proximaData } from "./rotinasEngine";

const DIAS = [
  { v: 0, l: "Dom" }, { v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" },
  { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" },
];

type Props = {
  rid: string;
  rotina: Rotina | null;          // null = nova
  pessoas: Pessoa[];              // candidatos a responsável
  modulosAtivos: ModuleId[];
  meId: string;
  meNome: string;
  onClose: () => void;
};

export function RotinaModal({ rid, rotina, pessoas, modulosAtivos, meId, meNome, onClose }: Props) {
  const [titulo, setTitulo] = useState(rotina?.titulo || "");
  const [descricao, setDescricao] = useState(rotina?.descricao || "");
  const [moduloAlvo, setModuloAlvo] = useState<ModuleId | "">(rotina?.moduloAlvo || "");
  const [responsaveis, setResponsaveis] = useState<string[]>(rotina?.responsaveis || []);
  const [rec, setRec] = useState<RotinaRecorrencia>(rotina?.recorrencia || { tipo: "semanal", diasSemana: [2] });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const hoje = new Date().toISOString().slice(0, 10);
  const proxima = useMemo(() => proximaData(rec, hoje), [rec, hoje]);

  // Módulos que podem ser alvo do deep-link (ativos no restaurante, não ocultos).
  const modulosDisponiveis = useMemo(
    () => MODULES.filter(m => !m.oculto && m.id !== "rotinas" && modulosAtivos.includes(m.id)),
    [modulosAtivos],
  );

  function toggleResp(id: string) {
    setResponsaveis(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleDia(v: number) {
    setRec(prev => {
      if (prev.tipo !== "semanal") return prev;
      const has = prev.diasSemana.includes(v);
      return { ...prev, diasSemana: has ? prev.diasSemana.filter(d => d !== v) : [...prev.diasSemana, v] };
    });
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
      for (const id of responsaveis) {
        const p = pessoas.find(x => x.id === id);
        if (p) nomes[id] = p.nome;
      }
      const nova: Rotina = {
        id: rotina?.id || `rot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        restaurantId: rid,
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        moduloAlvo: moduloAlvo || undefined,
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

  return (
    <Modal title={rotina ? "Editar rotina" : "+ Nova rotina"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Título *</label>
          <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Fechar o ponto da semana" className="mt-1" />
        </div>
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Descrição</label>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Função do sistema (opcional)</label>
          <select value={moduloAlvo} onChange={e => setModuloAlvo(e.target.value as ModuleId | "")}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
            <option value="">— nenhuma (só lembrete) —</option>
            {modulosDisponiveis.map(m => (
              <option key={m.id} value={m.id}>{m.icon} {m.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-0.5">O aviso leva direto pra essa tela.</p>
        </div>

        {/* Responsáveis */}
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Responsáveis *</label>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {pessoas.length === 0 ? (
              <div className="p-3 text-sm text-gray-500">Nenhuma pessoa disponível.</div>
            ) : pessoas.map(p => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm">
                <input type="checkbox" checked={responsaveis.includes(p.id)} onChange={() => toggleResp(p.id)} className="accent-indigo-600" />
                <span className="text-gray-900 dark:text-gray-100">{p.nome}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Recorrência */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
          <label className="text-[11px] uppercase font-bold text-gray-500 dark:text-gray-400">Recorrência</label>
          <select
            value={rec.tipo}
            onChange={(e) => {
              const t = e.target.value as RotinaRecorrencia["tipo"];
              if (t === "semanal") setRec({ tipo: "semanal", diasSemana: [2] });
              else if (t === "mensal_dia") setRec({ tipo: "mensal_dia", diaDoMes: 1 });
              else if (t === "mensal_posicao") setRec({ tipo: "mensal_posicao", posicao: 1, diaSemana: 1 });
              else setRec({ tipo: "quinzenal", dataBase: hoje });
            }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="semanal">Semanal (dias da semana)</option>
            <option value="mensal_dia">Mensal — dia do mês</option>
            <option value="mensal_posicao">Mensal — posição (ex: 1ª segunda)</option>
            <option value="quinzenal">Quinzenal (a cada 15 dias)</option>
          </select>

          {rec.tipo === "semanal" && (
            <div className="flex flex-wrap gap-1">
              {DIAS.map(d => (
                <button key={d.v} type="button" onClick={() => toggleDia(d.v)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                    rec.diasSemana.includes(d.v)
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                  }`}>{d.l}</button>
              ))}
            </div>
          )}

          {rec.tipo === "mensal_dia" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-300">Todo dia</span>
              <input type="number" min={1} max={31} value={rec.diaDoMes}
                onChange={(e) => setRec({ tipo: "mensal_dia", diaDoMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                className="w-20 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right" />
              <span className="text-[11px] text-gray-500">(31 = último dia)</span>
            </div>
          )}

          {rec.tipo === "mensal_posicao" && (
            <div className="flex items-center gap-2 flex-wrap">
              <select value={rec.posicao} onChange={(e) => setRec({ ...rec, posicao: Number(e.target.value) as 1 | 2 | 3 | 4 | -1 })}
                className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value={1}>1ª</option><option value={2}>2ª</option><option value={3}>3ª</option><option value={4}>4ª</option><option value={-1}>última</option>
              </select>
              <select value={rec.diaSemana} onChange={(e) => setRec({ ...rec, diaSemana: Number(e.target.value) })}
                className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                {DIAS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
              </select>
              <span className="text-sm text-gray-600 dark:text-gray-300">do mês</span>
            </div>
          )}

          {rec.tipo === "quinzenal" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-300">A partir de</span>
              <input type="date" value={rec.dataBase}
                onChange={(e) => setRec({ tipo: "quinzenal", dataBase: e.target.value })}
                className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
          )}

          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {recorrenciaLabel(rec)}
            {proxima && ` · próxima: ${proxima.split("-").reverse().join("/")}`}
          </div>
        </div>

        {erro && <div className="text-sm text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar rotina"}</Button>
        </div>
      </div>
    </Modal>
  );
}
