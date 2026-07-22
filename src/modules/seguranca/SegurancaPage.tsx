// Módulo SEGURANÇA SANITÁRIA — página principal.
// Fase 1: modelo-semente (botão provisório), iniciar/retomar avaliação
// (preenchimento mobile-first) e histórico das avaliações do restaurante ativo.
// Relatório detalhado, plano de ação e gráficos entram nas próximas fases.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import type { SegurancaAvaliacao, SegurancaModelo } from "../../core/types";
import { ouvirModelos, ouvirAvaliacoes, criarModeloSemente, criarAvaliacao, excluirAvaliacao } from "./repository";
import { Preenchimento } from "./Preenchimento";
import { ModeloEditor } from "./ModeloEditor";

const dmy = (ymd: string) => (ymd || "").split("-").reverse().join("/");

export function SegurancaPage() {
  const { pessoa: me } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid);
  const podePreencher = isMaster || can("seguranca", "preencher");
  const podeConfig = isMaster || can("seguranca", "configurar");
  const podeVer = isMaster || can("seguranca", "ver") || podePreencher;

  const [modelos, setModelos] = useState<SegurancaModelo[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<SegurancaAvaliacao[]>([]);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => { if (rid) return ouvirModelos(rid, setModelos); }, [rid]);
  useEffect(() => { if (rid) return ouvirAvaliacoes(rid, setAvaliacoes); }, [rid]);

  const modeloAtivo = useMemo(() => modelos.find((m) => m.ativo) || null, [modelos]);
  const autor = { id: me?.id || "", nome: me?.nome || "—" };

  async function semear() {
    setBusy(true); setErro("");
    try { await criarModeloSemente(rid, me?.id); }
    catch (e) { setErro("Falha ao criar o modelo: " + (e instanceof Error ? e.message : "?")); }
    finally { setBusy(false); }
  }
  async function novaAvaliacao() {
    if (!modeloAtivo) return;
    setBusy(true); setErro("");
    try { const id = await criarAvaliacao(rid, modeloAtivo, autor); setAbertaId(id); }
    catch (e) { setErro("Falha ao iniciar: " + (e instanceof Error ? e.message : "?")); }
    finally { setBusy(false); }
  }
  async function excluir(a: SegurancaAvaliacao) {
    if (!confirm(`Excluir a avaliação de ${dmy(a.data)}?`)) return;
    await excluirAvaliacao(a.id);
  }

  function ncDe(a: SegurancaAvaliacao): number {
    return Object.values(a.resultado || {}).filter((r) => r.resposta === "nao_conforme").length;
  }

  if (!podeVer) {
    return <div className="max-w-md mx-auto py-20 text-center text-gray-500">
      <div className="text-4xl mb-3">🔒</div>Você não tem acesso à Segurança Sanitária.
    </div>;
  }

  if (abertaId) {
    return (
      <div className="max-w-5xl mx-auto">
        <Preenchimento avaliacaoId={abertaId} autor={autor} onClose={() => setAbertaId(null)} />
      </div>
    );
  }
  if (editando && modeloAtivo) {
    return (
      <div className="max-w-5xl mx-auto">
        <ModeloEditor modelo={modeloAtivo} onClose={() => setEditando(false)} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">🧪 Segurança Sanitária</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Avaliação de boas práticas por área. Cada não-conforme vira ação para a operação.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:justify-end sm:shrink-0">
          {podeConfig && modeloAtivo && (
            <Button variant="secondary" onClick={() => setEditando(true)}>⚙ Checklist</Button>
          )}
          {podePreencher && modeloAtivo && (
            <Button onClick={() => void novaAvaliacao()} disabled={busy}>+ Nova avaliação</Button>
          )}
        </div>
      </header>
      {podeConfig && !activeRestaurant?.driveRootFolderId && (
        <div className="text-xs rounded-lg px-3 py-2 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          📁 Defina a <b>pasta raiz do restaurante no Drive</b> em <b>Configurações › Google Drive</b>. As fotos vão pra <code>planejamento.app › Segurança Sanitária</code>, organizadas por avaliação. Sem isso, não dá pra anexar fotos.
        </div>
      )}

      {erro && <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">{erro}</div>}

      {/* Sem modelo → botão-semente provisório */}
      {!modeloAtivo && (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <div className="text-4xl mb-3">🧪</div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Nenhum checklist-modelo ainda</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
            Carregue o modelo inicial com todos os itens da lista da nutricionista (Sororoca/Lobozó). Dá pra editar depois.
          </p>
          {podeConfig
            ? <Button className="mt-4" onClick={() => void semear()} disabled={busy}>{busy ? "Criando…" : "⚡ Criar modelo inicial"}</Button>
            : <p className="text-xs text-gray-400 mt-4">Peça a um administrador para criar o modelo.</p>}
        </div>
      )}

      {/* Histórico */}
      {modeloAtivo && (
        <section>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Histórico de avaliações</div>
          {avaliacoes.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Nenhuma avaliação ainda. Toque em “Nova avaliação” para começar.</p>}
          <div className="space-y-2">
            {avaliacoes.map((a) => {
              const nc = ncDe(a);
              const final = a.status === "finalizada";
              return (
                <button key={a.id} type="button" onClick={() => setAbertaId(a.id)}
                  className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5 flex items-center gap-3 hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 tabular-nums">{dmy(a.data)}</div>
                    <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{a.avaliadorNome || "—"}</div>
                  </div>
                  {nc > 0 && <span className="text-[12px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums shrink-0">{nc} não-conf.</span>}
                  {final
                    ? <span className="shrink-0 text-[12px] font-bold px-2.5 py-1 rounded-full tabular-nums"
                        style={{ background: "color-mix(in srgb, var(--faixa) 15%, transparent)", color: "var(--faixa)", ["--faixa" as string]: faixaCor(a) }}>
                        {a.score}% · {a.faixaLabel}
                      </span>
                    : <span className="shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">rascunho</span>}
                  {(podeConfig || a.status !== "finalizada") && (
                    <span onClick={(e) => { e.stopPropagation(); void excluir(a); }} className="shrink-0 text-gray-300 hover:text-rose-500 text-sm px-1" title="Excluir">🗑</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function faixaCor(a: SegurancaAvaliacao): string {
  const f = (a.faixasSnapshot || []).find((x) => x.label === a.faixaLabel);
  return f?.cor || "#0f766e";
}
