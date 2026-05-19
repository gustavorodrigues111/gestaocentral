// ════════════════════════════════════════════════════════════════════════════
//  Aba "Ajustes de Escala" — agrupa por SEMANA → EMPREGADO os apontamentos
//  criados na aba "Inconformidades". O líder usa essa aba pra:
//    - revisar o que anotou
//    - escolher por checkbox quais apontamentos vão pro WhatsApp do empregado
//      (ex: "intervalo a menos no dia 5" pode ficar só como log, sem envio)
//    - disparar o WhatsApp por empregado
//    - remover apontamentos errados
//
//  Apontamentos vivem dentro de /excecoesStatusSemana/{rid}_{weekStart}.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import {
  atualizarApontamento,
  listarStatusDoRestaurante,
  marcarApontamentosEnviados,
  removerApontamento,
} from "../../core/excecoes/statusSemana";
import { montarMensagemAjustes, whatsLink } from "../../core/excecoes/whatsapp";
import {
  EXCECAO_STATUS_LABEL,
  type ApontamentoFuncionario,
  type Empregado,
  type ExcecaoStatusSemana,
  type Pessoa,
} from "../../core/types";

type Props = {
  rid: string;
};

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

export function AjustesEscalaTab({ rid }: Props) {
  const { pessoa: me } = useAuth();
  const [semanas, setSemanas] = useState<ExcecaoStatusSemana[]>([]);
  // Mapa empregadoId → whatsapp (resolvido cruzando empregados[].pessoaId →
  // pessoas[].whatsapp; o whatsapp vive na Pessoa, não no Empregado).
  const [whatsByEmpId, setWhatsByEmpId] = useState<Map<string, string>>(new Map());
  const [restNome, setRestNome] = useState("");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [mostrarVazias, setMostrarVazias] = useState(false);

  // Carrega empregados + pessoas pra puxar whatsapp pelo cruzamento pessoaId.
  useEffect(() => {
    if (!rid) return;
    let empregados: Empregado[] = [];
    let pessoas: Pessoa[] = [];
    function reconstruirMapa() {
      const pessoaPorId = new Map<string, Pessoa>();
      for (const p of pessoas) pessoaPorId.set(p.id, p);
      const m = new Map<string, string>();
      for (const emp of empregados) {
        const pid = emp.pessoaId;
        const w = pid ? pessoaPorId.get(pid)?.whatsapp : undefined;
        if (w) m.set(emp.id, w);
      }
      setWhatsByEmpId(m);
    }
    const unsubEmp = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (snap) => {
        empregados = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Empregado));
        reconstruirMapa();
      },
    );
    const unsubPes = onSnapshot(
      query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (snap) => {
        pessoas = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pessoa));
        reconstruirMapa();
      },
    );
    return () => { unsubEmp(); unsubPes(); };
  }, [rid]);

  // Nome do restaurante
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "restaurants"), where("__name__", "==", rid));
    return onSnapshot(q, (snap) => {
      const r = snap.docs[0]?.data() as { nome?: string } | undefined;
      setRestNome(r?.nome || "");
    });
  }, [rid]);

  // Carrega semanas (não usa onSnapshot pra evitar overhead — recarrega após cada ação)
  async function recarregar() {
    if (!rid) return;
    setLoading(true);
    setErro("");
    try {
      const rows = await listarStatusDoRestaurante(rid);
      setSemanas(rows);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rid]);

  // Ordena semanas mais recentes primeiro, e filtra as que têm apontamentos
  const semanasComApontamentos = useMemo(
    () =>
      semanas
        .filter((s) => (s.apontamentos || []).length > 0)
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [semanas],
  );

  const semanasVazias = useMemo(
    () =>
      semanas
        .filter((s) => (s.apontamentos || []).length === 0)
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [semanas],
  );

  // Alterna entre "pendente" (vai pro WhatsApp) e remoção total. Itens já
  // enviados/ciência aparecem read-only — a UI mostra status badge.
  async function toggleEnviar(s: ExcecaoStatusSemana, ap: ApontamentoFuncionario) {
    try {
      if (ap.status === "pendente") {
        // Desmarcar pendente → remove
        await removerApontamento(rid, s.weekStart, s.weekEnd, ap.id);
      } else if (ap.status === "enviado" || ap.status === "ciencia") {
        // Não-pendente: não permite toggle (read-only)
        alert("Item já finalizado. Use a aba Inconformidades pra reabrir.");
        return;
      } else {
        // legado sem status: força pendente
        await atualizarApontamento(rid, s.weekStart, s.weekEnd, ap.id, { status: "pendente" });
      }
      await recarregar();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function remover(s: ExcecaoStatusSemana, ap: ApontamentoFuncionario) {
    if (!confirm(`Remover apontamento "${ap.texto.slice(0, 60)}..."?`)) return;
    try {
      await removerApontamento(rid, s.weekStart, s.weekEnd, ap.id);
      await recarregar();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function enviarWhats(s: ExcecaoStatusSemana, empregadoId: string, aps: ApontamentoFuncionario[]) {
    const enviaveis = aps.filter((a) => a.status === "pendente");
    if (enviaveis.length === 0) {
      alert("Não há apontamentos pendentes pra enviar (todos já foram enviados ou marcados como ciência).");
      return;
    }
    const whatsapp = whatsByEmpId.get(empregadoId);
    const nome = aps[0]?.empregadoNome ?? "";
    const msg = montarMensagemAjustes({
      empregadoNome: nome,
      restNome,
      weekStart: s.weekStart,
      weekEnd: s.weekEnd,
      apontamentos: enviaveis,
    });
    const link = whatsLink(whatsapp, msg);
    if (!link) {
      alert(`Sem WhatsApp cadastrado pra ${nome}. Cadastre em Pessoas pra usar essa ação.`);
      return;
    }
    window.open(link, "_blank");
    // Marca como enviado (apenas os que estavam `enviar: true`)
    try {
      await marcarApontamentosEnviados(rid, s.weekStart, s.weekEnd, enviaveis.map((a) => a.id));
      await recarregar();
    } catch (e) {
      console.warn("Erro marcando enviados:", e);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Carregando…</div>;
  }
  if (erro) {
    return (
      <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
        ❌ {erro}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300">
        💡 Lista dos <strong>apontamentos por empregado</strong> que precisam virar ajustes
        manuais na <strong>escala praticada</strong> (semana já conferida pelo gerente). Use
        como roteiro pra atualizar a praticada — faltas justificadas/injustificadas, atestados,
        trocas etc. <em>No futuro vamos conectar essa atualização automática; por enquanto é manual.</em>
      </div>

      {semanasComApontamentos.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Nenhum apontamento ainda
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            Vá na aba <strong>Inconformidades</strong>, escolha a semana, e use os botões{" "}
            <strong>"📝 anotar"</strong> ao lado de cada item ou <strong>"+ anotar"</strong> no
            header do empregado pra criar apontamentos.
          </p>
        </div>
      )}

      {semanasComApontamentos.map((s) => (
        <SemanaBlock
          key={s.id}
          semana={s}
          whatsByEmpId={whatsByEmpId}
          restNome={restNome}
          podeEditar={!!me}
          onToggleEnviar={(ap) => toggleEnviar(s, ap)}
          onRemover={(ap) => remover(s, ap)}
          onEnviarWhats={(empId, aps) => enviarWhats(s, empId, aps)}
        />
      ))}

      {semanasVazias.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setMostrarVazias((v) => !v)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {mostrarVazias
              ? `Ocultar ${semanasVazias.length} semana(s) sem apontamentos`
              : `Mostrar ${semanasVazias.length} semana(s) sem apontamentos`}
          </button>
          {mostrarVazias && (
            <ul className="mt-2 space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
              {semanasVazias.map((s) => (
                <li key={s.id}>
                  Semana {fmtDataBr(s.weekStart)}–{fmtDataBr(s.weekEnd)} ·{" "}
                  <em>{EXCECAO_STATUS_LABEL[s.status]}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SemanaBlock({
  semana,
  whatsByEmpId,
  restNome,
  podeEditar,
  onToggleEnviar,
  onRemover,
  onEnviarWhats,
}: {
  semana: ExcecaoStatusSemana;
  whatsByEmpId: Map<string, string>;
  restNome: string;
  podeEditar: boolean;
  onToggleEnviar: (ap: ApontamentoFuncionario) => void;
  onRemover: (ap: ApontamentoFuncionario) => void;
  onEnviarWhats: (empregadoId: string, aps: ApontamentoFuncionario[]) => void;
}) {
  const aps = semana.apontamentos || [];
  // Agrupa por empregado
  const grupos = useMemo(() => {
    const m = new Map<string, ApontamentoFuncionario[]>();
    for (const a of aps) {
      const arr = m.get(a.empregadoId) || [];
      arr.push(a);
      m.set(a.empregadoId, arr);
    }
    return Array.from(m.entries())
      .map(([empregadoId, lista]) => ({
        empregadoId,
        empregadoNome: lista[0]?.empregadoNome ?? "",
        cpf: lista[0]?.cpf,
        lista: lista.sort((a, b) => (a.data || "").localeCompare(b.data || "")),
      }))
      .sort((a, b) => a.empregadoNome.localeCompare(b.empregadoNome));
  }, [aps]);

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
        <div className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">
          Semana {fmtDataBr(semana.weekStart)} a {fmtDataBr(semana.weekEnd)}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          Status: <strong>{EXCECAO_STATUS_LABEL[semana.status]}</strong> · {aps.length} apontamento(s)
          em {grupos.length} empregado(s)
        </div>
      </header>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {grupos.map((g) => {
          const whatsapp = whatsByEmpId.get(g.empregadoId);
          const semWhats = !whatsapp;
          const pendentesCount = g.lista.filter((a) => a.status === "pendente").length;
          return (
            <div key={g.empregadoId} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">
                    {g.empregadoNome}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {whatsapp ? (
                      <>📱 {whatsapp}</>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        ⚠ sem WhatsApp cadastrado
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={pendentesCount > 0 && !semWhats ? "primary" : "secondary"}
                  disabled={pendentesCount === 0 || semWhats || !restNome}
                  onClick={() => onEnviarWhats(g.empregadoId, g.lista)}
                  title={
                    semWhats ? "Sem WhatsApp cadastrado" :
                    pendentesCount === 0 ? "Nenhum pendente — todos enviados/ciência" :
                    `Enviar ${pendentesCount} pendente(s) via WhatsApp`
                  }
                >
                  💬 Enviar {pendentesCount > 0 && `(${pendentesCount})`}
                </Button>
              </div>

              <ol className="space-y-1.5">
                {g.lista.map((a, i) => {
                  const pendente = a.status === "pendente";
                  const enviado = a.status === "enviado";
                  const ciencia = a.status === "ciencia";
                  return (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pendente}
                      onChange={() => onToggleEnviar(a)}
                      className="mt-1 accent-indigo-600"
                      title={pendente ? "Desmarcar (remove)" : enviado ? "Já enviado" : ciencia ? "Já marcado como ciência" : "Marcar"}
                      disabled={!podeEditar || enviado || ciencia}
                    />
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums select-none mt-0.5 text-[11px]">
                      {i + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-gray-800 dark:text-gray-200 ${pendente ? "" : "opacity-60"}`}>
                        {a.texto}
                        {a.data && (
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">
                            ({fmtDataBr(a.data)})
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>
                          {a.origem === "inconformidade" ? "🔗 da inconformidade" : "✍ manual"} ·{" "}
                          {a.criadoPorNome}
                        </span>
                        {enviado && a.enviadoEm && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            📨 enviado
                          </span>
                        )}
                        {ciencia && (
                          <span className="text-sky-600 dark:text-sky-400">
                            👁 ciência
                          </span>
                        )}
                      </div>
                    </div>
                    {podeEditar && (
                      <button
                        type="button"
                        onClick={() => onRemover(a)}
                        className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                        title="Remover apontamento"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}
