// ════════════════════════════════════════════════════════════════════════════
//  Análise de Ponto — módulo NOVO (lado a lado com "Registros de Ponto"/Exceções,
//  que será aposentado depois). Motor determinístico sobre a API Sólides:
//  carga prevista × trabalhada + saldo do período (jornada flexível), com as
//  ocorrências divididas em duas categorias de AÇÃO: A Corrigir × A Avaliar.
//
//  Fase 1b: leitura (período + restaurante → relatório). Correções (escrita),
//  Excel e FALTA (precisa do roster de colaboradores) entram nas próximas fases.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { fetchPunches } from "../../core/excecoes/solidesClient";
import { fetchScheduleCatalog, fetchRoster } from "../../core/ponto/solidesPontoClient";
import {
  analisarPonto, CAT_LABEL, ROTULOS, type Categoria, type Ocorrencia,
  type PontoMarcacao, type ResultadoAnalise, type Severidade,
} from "../../core/ponto/analise";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const SEV_COR: Record<Severidade, string> = {
  alta: "bg-red-500",
  media: "bg-amber-500",
  baixa: "bg-gray-400",
};

export function AnalisePontoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const podeVer = canVer(me, rid, "analise-ponto");

  const hoje = new Date();
  const [inicio, setInicio] = useState(fmtYmd(new Date(hoje.getTime() - 7 * 86400000)));
  const [fim, setFim] = useState(fmtYmd(hoje));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoAnalise | null>(null);

  async function analisar() {
    if (!activeRestaurant) return;
    const shortCode = activeRestaurant.shortCode || "";
    if (!shortCode) { setErro("Restaurante sem shortCode configurado."); return; }
    setErro("");
    setCarregando(true);
    setResultado(null);
    try {
      // Roster pode vir vazio em algumas contas → FALTA simplesmente não aponta;
      // não derruba o resto. Por isso o catch dele é tolerante.
      const [{ punches }, schedules, employees] = await Promise.all([
        fetchPunches(inicio, fim, shortCode),
        fetchScheduleCatalog(shortCode),
        fetchRoster(shortCode).catch(() => []),
      ]);
      const res = analisarPonto(
        punches as unknown as PontoMarcacao[], employees, schedules, inicio, fim,
      );
      setResultado(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao analisar.");
    } finally {
      setCarregando(false);
    }
  }

  if (!activeRestaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      {/* Filtros */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Início</label>
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fim</label>
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        </div>
        <button type="button" onClick={() => void analisar()} disabled={carregando}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
          {carregando ? "Analisando…" : "🔍 Analisar período"}
        </button>
        <span className="text-[11px] text-gray-400 ml-auto">{activeRestaurant.nome} · {activeRestaurant.shortCode}</span>
      </div>

      {erro && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>
      )}

      {resultado && (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-3 gap-3">
            <Cartao titulo="A Corrigir" valor={resultado.porCategoria.CORRIGIR} cor="text-red-600" />
            <Cartao titulo="A Avaliar" valor={resultado.porCategoria.AVALIAR} cor="text-amber-600" />
            <Cartao titulo="Total" valor={resultado.total} cor="text-gray-700 dark:text-gray-200" />
          </div>

          {(["CORRIGIR", "AVALIAR"] as Categoria[]).map((cat) => {
            const itens = resultado.ocorrencias.filter((o) => o.categoria === cat);
            return (
              <section key={cat} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-900 dark:text-gray-100">
                  {cat === "CORRIGIR" ? "🔧" : "👀"} {CAT_LABEL[cat]} ({itens.length})
                </header>
                {itens.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-400">Nada nesta categoria 🎉</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {itens.map((o, i) => <Linha key={i} o={o} />)}
                  </div>
                )}
              </section>
            );
          })}

          <p className="text-[11px] text-gray-400">
            FALTA depende do roster de colaboradores da Sólides (se a conta não
            retornar colaboradores, faltas não são apontadas). As correções
            (escrita) vêm na próxima fase.
          </p>
        </>
      )}

      {!resultado && !carregando && !erro && (
        <div className="text-center text-sm text-gray-400 py-12">
          Escolha o período e clique em <strong>Analisar</strong>.
        </div>
      )}
    </div>
  );
}

function Cartao({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold tabular-nums ${cor}`}>{valor}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{titulo}</div>
    </div>
  );
}

function Linha({ o }: { o: Ocorrencia }) {
  return (
    <div className="px-4 py-2.5 flex items-start gap-2.5">
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_COR[o.severidade]}`} title={o.severidade} />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{o.colaborador}</span>
          <span className="text-gray-400"> · {o.data}{o.diaSemana !== "período" ? ` (${o.diaSemana})` : ""}</span>
        </div>
        <div className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">{ROTULOS[o.tipo]}</div>
        <div className="text-xs text-gray-600 dark:text-gray-300">{o.detalhe}</div>
        {o.marcacoes.length > 0 && (
          <div className="text-[11px] text-gray-400 tabular-nums mt-0.5">{o.marcacoes.join("  ·  ")}</div>
        )}
      </div>
    </div>
  );
}
