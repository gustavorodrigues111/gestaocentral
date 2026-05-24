import { useEffect, useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { ExcecaoHorarioSite, HorarioFuncionamentoDia, SiteConfig } from "../../core/types";
import { useSiteConfig } from "./useSiteConfig";

type Props = {
  rid: string;
  nomeRestaurante: string;
  podeEditar: boolean;
};

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Tab Horários: edita horário semanal padrão + lista de exceções pontuais.
// Os dados aqui são lidos pelo site público AND pelo módulo Reservas
// (mesma fonte da verdade — quando você adiciona exceção "fechado em 25/12",
// Reservas bloqueia automaticamente).
export function HorariosTab({ rid, nomeRestaurante, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const { config: cfgRemoto, loading, erro, save } = useSiteConfig(rid, nomeRestaurante);
  const [horarios, setHorarios] = useState<HorarioFuncionamentoDia[]>([]);
  const [excecoes, setExcecoes] = useState<ExcecaoHorarioSite[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Exceção sendo criada
  const [nova, setNova] = useState<{ data: string; fechado: boolean; abre: string; fecha: string; motivo: string }>({
    data: "", fechado: false, abre: "19:00", fecha: "23:00", motivo: "",
  });

  useEffect(() => {
    if (cfgRemoto) {
      setHorarios(cfgRemoto.horarios);
      setExcecoes(cfgRemoto.excecoes || []);
    }
  }, [cfgRemoto]);

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">⚠ Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;

  function toggleFechado(dia: number) {
    setHorarios(hs => hs.map(h => h.dia === dia ? { ...h, fechado: !h.fechado, turnos: !h.fechado ? [] : (h.turnos.length === 0 ? [{ abre: "19:00", fecha: "23:00" }] : h.turnos) } : h));
  }
  function addTurno(dia: number) {
    setHorarios(hs => hs.map(h => h.dia === dia ? { ...h, turnos: [...h.turnos, { abre: "19:00", fecha: "23:00" }] } : h));
  }
  function setTurno(dia: number, idx: number, parcial: { abre?: string; fecha?: string }) {
    setHorarios(hs => hs.map(h => h.dia === dia ? {
      ...h,
      turnos: h.turnos.map((t, i) => i === idx ? { ...t, ...parcial } : t),
    } : h));
  }
  function delTurno(dia: number, idx: number) {
    setHorarios(hs => hs.map(h => h.dia === dia ? {
      ...h,
      turnos: h.turnos.filter((_, i) => i !== idx),
      fechado: h.turnos.length <= 1,
    } : h));
  }

  function addExcecao() {
    if (!nova.data) {
      alert("Escolha a data da exceção.");
      return;
    }
    if (!me) return;
    const ex: ExcecaoHorarioSite = {
      id: `exc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      data: nova.data,
      fechado: nova.fechado,
      turnos: nova.fechado ? undefined : [{ abre: nova.abre, fecha: nova.fecha }],
      motivo: nova.motivo.trim() || undefined,
      criadoEm: new Date().toISOString(),
      criadoPor: me.id,
    };
    setExcecoes(es => [...es, ex].sort((a, b) => a.data.localeCompare(b.data)));
    setNova({ data: "", fechado: false, abre: "19:00", fecha: "23:00", motivo: "" });
  }
  function delExcecao(id: string) {
    setExcecoes(es => es.filter(e => e.id !== id));
  }

  async function salvar() {
    if (!me) return;
    setSalvando(true);
    try {
      const parcial: Partial<SiteConfig> = { horarios, excecoes };
      await save(parcial, me.id);
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  // Filtrar exceções: futuras + últimas 30 dias passadas (limpeza visual)
  const hojeYmd = new Date().toISOString().slice(0, 10);
  const excecoesVisiveis = excecoes.filter(e => {
    if (e.data >= hojeYmd) return true;
    // Mantém até 30 dias atrás
    const diff = (new Date(hojeYmd).getTime() - new Date(e.data).getTime()) / (1000 * 60 * 60 * 24);
    return diff < 30;
  });

  return (
    <div className="space-y-6">
      {/* Horário padrão */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Horário padrão semanal
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Configure os horários por dia da semana. Cada dia pode ter 1 ou mais turnos (ex: almoço + jantar).
        </p>
        <div className="space-y-2">
          {horarios.map(h => (
            <div key={h.dia} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold text-gray-900 dark:text-gray-100 min-w-[80px]">
                  {DIAS[h.dia]}
                </div>
                <button
                  type="button"
                  onClick={() => podeEditar && toggleFechado(h.dia)}
                  disabled={!podeEditar}
                  className={`px-2 py-1 text-xs font-bold uppercase rounded ${
                    h.fechado
                      ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300"
                      : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {h.fechado ? "Fechado" : "Aberto"}
                </button>
              </div>
              {!h.fechado && (
                <div className="mt-2 space-y-1.5">
                  {h.turnos.map((t, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <input
                        type="time"
                        value={t.abre}
                        onChange={(e) => setTurno(h.dia, i, { abre: e.target.value })}
                        disabled={!podeEditar}
                        className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      />
                      <input
                        type="time"
                        value={t.fecha}
                        onChange={(e) => setTurno(h.dia, i, { fecha: e.target.value })}
                        disabled={!podeEditar}
                        className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      />
                      {podeEditar && (
                        <button onClick={() => delTurno(h.dia, i)} className="text-xs text-rose-600 hover:underline px-2">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {podeEditar && h.turnos.length < 3 && (
                    <Button size="sm" variant="secondary" onClick={() => addTurno(h.dia)}>
                      + turno
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Exceções */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Exceções pontuais
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Use pra dias específicos: feriados, fechamento por evento privado, abertura especial. <br/>
          O módulo <strong>Reservas</strong> lê dessa mesma lista — fechar aqui bloqueia reservas
          automaticamente no dia.
        </p>

        {/* Adicionar nova */}
        {podeEditar && (
          <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-end">
              <Input
                label="Data"
                type="date"
                value={nova.data}
                onChange={(e) => setNova({ ...nova, data: e.target.value })}
              />
              <Input
                label="Motivo (opcional)"
                value={nova.motivo}
                onChange={(e) => setNova({ ...nova, motivo: e.target.value })}
                placeholder="ex: Natal, evento privado, feriado"
              />
              <button
                type="button"
                onClick={() => setNova({ ...nova, fechado: !nova.fechado })}
                className={`px-3 py-2 text-xs font-bold uppercase rounded border ${
                  nova.fechado
                    ? "bg-rose-100 border-rose-300 dark:bg-rose-900/30 dark:border-rose-700 text-rose-700 dark:text-rose-300"
                    : "bg-emerald-100 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {nova.fechado ? "Fechado" : "Aberto"}
              </button>
            </div>
            {!nova.fechado && (
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <Input label="Abre" type="time" value={nova.abre} onChange={(e) => setNova({ ...nova, abre: e.target.value })} />
                <Input label="Fecha" type="time" value={nova.fecha} onChange={(e) => setNova({ ...nova, fecha: e.target.value })} />
              </div>
            )}
            <Button size="sm" onClick={addExcecao}>+ Adicionar exceção</Button>
          </div>
        )}

        {/* Lista de exceções */}
        {excecoesVisiveis.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">Nenhuma exceção cadastrada.</p>
        ) : (
          <div className="space-y-1.5">
            {excecoesVisiveis.map(e => {
              const data = new Date(e.data + "T12:00:00");
              const passada = e.data < hojeYmd;
              return (
                <div key={e.id} className={`rounded-lg border ${passada ? "border-gray-200 dark:border-gray-800 opacity-60" : "border-gray-300 dark:border-gray-700"} bg-white dark:bg-gray-900 p-2 flex items-center justify-between gap-2 text-sm`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold tabular-nums">
                        {String(data.getDate()).padStart(2, "0")}/{String(data.getMonth() + 1).padStart(2, "0")}/{data.getFullYear()}
                      </span>
                      <span className="text-[10px] uppercase text-gray-500">
                        {DIAS[data.getDay()].slice(0, 3)}
                      </span>
                      {e.fechado ? (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">
                          fechado
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          {e.turnos?.map(t => `${t.abre}–${t.fecha}`).join(", ") || "aberto"}
                        </span>
                      )}
                      {passada && <span className="text-[10px] text-gray-400">(passou)</span>}
                    </div>
                    {e.motivo && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{e.motivo}</div>
                    )}
                  </div>
                  {podeEditar && (
                    <button onClick={() => delExcecao(e.id)} className="text-xs text-rose-600 hover:underline px-2 shrink-0">
                      apagar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer salvar */}
      {podeEditar && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {savedAt && <span className="text-emerald-600">✓ salvo às {savedAt}</span>}
          </div>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar horários"}</Button>
        </div>
      )}
    </div>
  );
}
