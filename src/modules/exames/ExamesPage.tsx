// Módulo Exames Médicos — gestão de exames periódicos dos empregados.
//
// Tabs:
//   Próximos 30d — exames com vencimento próximo
//   Atrasados — exames vencidos
//   Por empregado — agrupado
//   Por tipo — agrupado
//   Configuração — catálogo de tipos do restaurante
//
// Botão "+ Lançar exame" abre modal: escolhe empregado + tipo + data realizada
//   → cria/atualiza ExameEmpregado + adiciona ao histórico.

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { pickDriveFile } from "../../core/google/drivePicker";
import {
  ouvirTipos, salvarTipo, excluirTipo, gerarSubtarefasTemplateDefault,
  criarExame, darBaixa, desativarExame, reativarExame,
} from "./repository";
import { gerarTarefasDeExames } from "./gerador";
import type {
  ExameTipoConfig, ExameEmpregado, Empregado, ExameAplicabilidade,
} from "../../core/types";

type Tab = "proximos" | "atrasados" | "porEmpregado" | "porTipo" | "config";

export function ExamesPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const [tab, setTab] = useState<Tab>("proximos");
  const [tipos, setTipos] = useState<ExameTipoConfig[]>([]);
  const [exames, setExames] = useState<ExameEmpregado[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [exameSelecionado, setExameSelecionado] = useState<ExameEmpregado | null>(null);
  const [lancandoNovo, setLancandoNovo] = useState(false);
  const [gerando, setGerando] = useState(false);

  // Listeners
  useEffect(() => {
    if (!rid) return;
    const u1 = ouvirTipos(rid, setTipos);
    const u2 = onSnapshot(
      query(collection(db, "examesEmpregado"), where("restaurantId", "==", rid)),
      snap => setExames(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExameEmpregado)))
    );
    const u3 = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      snap => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() } as Empregado)))
    );
    return () => { u1(); u2(); u3(); };
  }, [rid]);

  const hoje = new Date().toISOString().slice(0, 10);
  const ativos = useMemo(() => exames.filter(e => e.ativo), [exames]);

  const proximos30 = useMemo(() => {
    const limite = addDias(hoje, 30);
    return ativos
      .filter(e => e.proximoVencimento >= hoje && e.proximoVencimento <= limite)
      .sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento));
  }, [ativos, hoje]);

  const atrasados = useMemo(
    () => ativos
      .filter(e => e.proximoVencimento < hoje)
      .sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento)),
    [ativos, hoje],
  );

  async function rodarGerador() {
    if (!pessoa) return;
    setGerando(true);
    try {
      const r = await gerarTarefasDeExames({ id: pessoa.id, nome: pessoa.nome });
      alert(`Geração de exames:\n• ${r.geradas} tarefa(s)-pai criada(s)\n• ${r.jaExistiam} já existiam\n${r.erros.length ? `• ${r.erros.length} erro(s)` : ""}`);
    } catch (e) {
      alert("Erro: " + String(e));
    } finally {
      setGerando(false);
    }
  }

  if (!rid) {
    return <div className="text-center py-12 text-gray-500">Selecione um restaurante.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-4">
      <header className="flex items-center justify-between mb-4 gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🩺 Exames Médicos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Gestão de exames periódicos dos empregados — {atrasados.length > 0 && <span className="text-red-600 font-medium">{atrasados.length} atrasado(s) · </span>}{proximos30.length} próximos 30 dias
          </p>
        </div>
        <div className="flex gap-2">
          {pessoa?.isMaster && (
            <Button size="sm" variant="ghost" onClick={rodarGerador} disabled={gerando} title="Cria tarefas-pai pros exames cuja janela de antecedência chegou">
              {gerando ? "Gerando…" : "🔁 Gerar pendentes"}
            </Button>
          )}
          <Button onClick={() => setLancandoNovo(true)}>+ Lançar exame</Button>
        </div>
      </header>

      {tipos.length === 0 && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
          <h2 className="font-bold text-amber-900 dark:text-amber-100">Catálogo de tipos vazio</h2>
          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
            Não tem tipo de exame cadastrado pra este restaurante. Vá em "Configuração" pra criar (Clínico, Complementar, Coprocultura, etc).
          </p>
          <Button size="sm" onClick={() => setTab("config")} className="mt-2">Ir pra configuração →</Button>
        </div>
      )}

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        <TabButton ativo={tab === "proximos"} onClick={() => setTab("proximos")}>
          Próximos 30d {proximos30.length > 0 && <span className="ml-1 text-[10px] px-1.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{proximos30.length}</span>}
        </TabButton>
        <TabButton ativo={tab === "atrasados"} onClick={() => setTab("atrasados")}>
          Atrasados {atrasados.length > 0 && <span className="ml-1 text-[10px] px-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{atrasados.length}</span>}
        </TabButton>
        <TabButton ativo={tab === "porEmpregado"} onClick={() => setTab("porEmpregado")}>Por empregado</TabButton>
        <TabButton ativo={tab === "porTipo"} onClick={() => setTab("porTipo")}>Por tipo</TabButton>
        {pessoa?.isMaster && <TabButton ativo={tab === "config"} onClick={() => setTab("config")}>Configuração</TabButton>}
      </nav>

      {tab === "proximos" && <ListaExames exames={proximos30} onAbrir={setExameSelecionado} vazio="Nenhum exame nos próximos 30 dias." />}
      {tab === "atrasados" && <ListaExames exames={atrasados} onAbrir={setExameSelecionado} vazio="✅ Nenhum exame atrasado." atrasado />}
      {tab === "porEmpregado" && <ListaPorEmpregado exames={ativos} onAbrir={setExameSelecionado} />}
      {tab === "porTipo" && <ListaPorTipo exames={ativos} tipos={tipos} onAbrir={setExameSelecionado} />}
      {tab === "config" && pessoa?.isMaster && <ConfigTab tipos={tipos} rid={rid} pessoaId={pessoa.id} />}

      {exameSelecionado && (
        <ExameDetalheModal
          exame={exameSelecionado}
          onClose={() => setExameSelecionado(null)}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
        />
      )}
      {lancandoNovo && (
        <LancarExameModal
          tipos={tipos}
          empregados={empregados}
          onClose={() => setLancandoNovo(false)}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
          rid={rid}
          examesExistentes={exames}
        />
      )}
    </div>
  );
}

function TabButton({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        ativo
          ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Listas ────────────────────────────────────────────────────────────

function ListaExames({ exames, onAbrir, vazio, atrasado }: {
  exames: ExameEmpregado[];
  onAbrir: (e: ExameEmpregado) => void;
  vazio: string;
  atrasado?: boolean;
}) {
  if (exames.length === 0) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">{vazio}</div>;
  }
  return (
    <div className="space-y-2">
      {exames.map(e => <CardExame key={e.id} exame={e} onAbrir={() => onAbrir(e)} forceAtrasado={atrasado} />)}
    </div>
  );
}

function CardExame({ exame, onAbrir, forceAtrasado }: {
  exame: ExameEmpregado;
  onAbrir: () => void;
  forceAtrasado?: boolean;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const atrasado = forceAtrasado ?? (exame.proximoVencimento < hoje);
  const dias = Math.round((new Date(exame.proximoVencimento).getTime() - new Date(hoje).getTime()) / 86400000);
  return (
    <div
      onClick={onAbrir}
      className={`p-3 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${
        atrasado
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
          : dias <= 14
          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
          : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {exame.tipoNomeSnapshot}{" "}
            <span className="text-gray-500 dark:text-gray-400 font-normal">— {exame.empregadoNomeSnapshot}</span>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {exame.cargoSnapshot && `${exame.cargoSnapshot} · `}
            Vence: <span className={atrasado ? "text-red-600 font-medium" : ""}>{exame.proximoVencimento}</span>
            {atrasado ? ` · ⚠ ${-dias} dia(s) atrasado` : dias === 0 ? " · hoje" : ` · em ${dias} dia(s)`}
            {exame.ultimaRealizacao && ` · última: ${exame.ultimaRealizacao}`}
          </div>
        </div>
        {(exame.historico?.length ?? 0) > 0 && (
          <div className="text-[10px] text-gray-400">{exame.historico.length} execução(ões)</div>
        )}
      </div>
    </div>
  );
}

function ListaPorEmpregado({ exames, onAbrir }: { exames: ExameEmpregado[]; onAbrir: (e: ExameEmpregado) => void }) {
  const grupos = new Map<string, ExameEmpregado[]>();
  exames.forEach(e => {
    const arr = grupos.get(e.empregadoId) || [];
    arr.push(e);
    grupos.set(e.empregadoId, arr);
  });
  const lista = Array.from(grupos.entries()).sort((a, b) => {
    const na = a[1][0]?.empregadoNomeSnapshot || "";
    const nb = b[1][0]?.empregadoNomeSnapshot || "";
    return na.localeCompare(nb);
  });
  if (lista.length === 0) return <div className="text-center py-12 text-gray-500">Nenhum exame cadastrado.</div>;
  return (
    <div className="space-y-3">
      {lista.map(([empId, exs]) => (
        <details key={empId} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <summary className="p-3 cursor-pointer font-semibold text-gray-900 dark:text-gray-100">
            {exs[0]?.empregadoNomeSnapshot}
            <span className="ml-2 text-xs text-gray-500 font-normal">{exs.length} exame(s)</span>
          </summary>
          <div className="px-3 pb-3 space-y-1.5">
            {exs.sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento)).map(e => (
              <CardExame key={e.id} exame={e} onAbrir={() => onAbrir(e)} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function ListaPorTipo({ exames, tipos, onAbrir }: { exames: ExameEmpregado[]; tipos: ExameTipoConfig[]; onAbrir: (e: ExameEmpregado) => void }) {
  const grupos = new Map<string, ExameEmpregado[]>();
  exames.forEach(e => {
    const arr = grupos.get(e.tipoId) || [];
    arr.push(e);
    grupos.set(e.tipoId, arr);
  });
  if (grupos.size === 0) return <div className="text-center py-12 text-gray-500">Nenhum exame cadastrado.</div>;
  return (
    <div className="space-y-3">
      {Array.from(grupos.entries()).map(([tipoId, exs]) => {
        const tipo = tipos.find(t => t.id === tipoId);
        return (
          <details key={tipoId} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <summary className="p-3 cursor-pointer font-semibold text-gray-900 dark:text-gray-100">
              {tipo?.nome || exs[0]?.tipoNomeSnapshot}
              <span className="ml-2 text-xs text-gray-500 font-normal">{exs.length} empregado(s)</span>
            </summary>
            <div className="px-3 pb-3 space-y-1.5">
              {exs.sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento)).map(e => (
                <CardExame key={e.id} exame={e} onAbrir={() => onAbrir(e)} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ─── Configuração ──────────────────────────────────────────────────────

function ConfigTab({ tipos, rid, pessoaId }: { tipos: ExameTipoConfig[]; rid: string; pessoaId: string }) {
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<ExameTipoConfig | null>(null);
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string }>>([]);
  const [semeando, setSemeando] = useState(false);
  const [migrando, setMigrando] = useState(false);

  async function semearDefaults() {
    if (!confirm("Criar tipos default (Clínico anual, Complementar semestral, Coprocultura semestral)? Vai pular tipos que já existem.")) return;
    setSemeando(true);
    try {
      const defaults: Array<Omit<ExameTipoConfig, "id" | "criadoEm" | "criadoPor" | "atualizadoEm" | "restaurantId">> = [
        {
          nome: "Exame Clínico",
          periodicidadeDias: 365,
          diasAntecedencia: 14,
          aplicabilidade: "todos",
          responsavelPadraoId: pessoaId,
          subtarefasTemplate: gerarSubtarefasTemplateDefault(),
          ativo: true,
        },
        {
          nome: "Exame Complementar",
          periodicidadeDias: 180,
          diasAntecedencia: 14,
          aplicabilidade: "todos",
          responsavelPadraoId: pessoaId,
          subtarefasTemplate: gerarSubtarefasTemplateDefault(),
          ativo: true,
        },
        {
          nome: "Coprocultura",
          descricao: "Exigido pra manipuladores de alimentos (Cozinha/Bar)",
          periodicidadeDias: 180,
          diasAntecedencia: 14,
          aplicabilidade: "manipulador",
          responsavelPadraoId: pessoaId,
          subtarefasTemplate: gerarSubtarefasTemplateDefault(),
          ativo: true,
        },
      ];
      let criados = 0;
      let pulados = 0;
      for (const def of defaults) {
        if (tipos.find(t => t.nome.toLowerCase() === def.nome.toLowerCase())) { pulados++; continue; }
        const id = `etc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        await salvarTipo({ id, restaurantId: rid, ...def, criadoEm: now, criadoPor: pessoaId, atualizadoEm: now } as ExameTipoConfig);
        criados++;
      }
      alert(`Defaults criados: ${criados}, já existiam: ${pulados}`);
    } catch (e) {
      alert("Erro: " + String(e));
    } finally {
      setSemeando(false);
    }
  }

  async function migrarEmpregados() {
    if (!confirm("Pra cada empregado ATIVO deste restaurante, criar ExameEmpregado nos tipos aplicáveis (data de admissão = última realização). Idempotente — pula quem já tem cadastro.")) return;
    setMigrando(true);
    try {
      const { gerarExamesParaAdmissao, carregarCargo } = await import("./gerador");
      // Carrega empregados ativos do rest
      const empSnap = await getDocs(query(collection(db, "empregados"), where("restaurantId", "==", rid)));
      const empregados = empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Empregado)).filter(e => e.estaAtivo !== false);
      let total = 0;
      for (const emp of empregados) {
        const cargo = emp.cargoId ? await carregarCargo(emp.cargoId) : null;
        const criados = await gerarExamesParaAdmissao({
          empregadoId: emp.id,
          empregadoNome: emp.nome,
          cargoId: emp.cargoId,
          cargoNome: cargo?.nome,
          cargoArea: cargo?.area,
          restaurantId: rid,
          dataAdmissao: emp.admissaoAtual || emp.periodos?.[emp.periodos.length - 1]?.admissao || new Date().toISOString().slice(0, 10),
          autor: { id: pessoaId, nome: "Migração inicial" },
        });
        total += criados;
      }
      alert(`Migração concluída: ${total} exame(s) criado(s) pra ${empregados.length} empregado(s) ativo(s).`);
    } catch (e) {
      alert("Erro: " + String(e));
    } finally {
      setMigrando(false);
    }
  }

  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoas(list);
    });
    return () => u();
  }, []);

  async function deletarTipo(t: ExameTipoConfig) {
    if (!confirm(`Excluir tipo "${t.nome}"? Os exames existentes desse tipo NÃO serão removidos.`)) return;
    await excluirTipo(t.id);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400 flex-1 min-w-[240px]">
          Tipos de exame cadastrados pra este restaurante. Cada tipo define periodicidade, antecedência, fluxo padrão e aplicabilidade.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={semearDefaults} disabled={semeando}>
            {semeando ? "Criando…" : "🌱 Criar 3 tipos default"}
          </Button>
          <Button size="sm" variant="ghost" onClick={migrarEmpregados} disabled={migrando} title="Roda pra cada empregado ativo do rest, cria ExameEmpregado nos tipos aplicáveis">
            {migrando ? "Migrando…" : "👥 Migrar empregados existentes"}
          </Button>
          <Button size="sm" onClick={() => setCriando(true)}>+ Novo Tipo</Button>
        </div>
      </div>
      <div className="space-y-2">
        {tipos.map(t => (
          <div key={t.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{t.nome}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Periodicidade: {t.periodicidadeDias} dias · Antecedência: {t.diasAntecedencia} dias
                  {t.fornecedorPadrao && ` · Fornecedor: ${t.fornecedorPadrao}`}
                  {" · "}Aplicabilidade: {t.aplicabilidade === "todos" ? "Todos" : t.aplicabilidade === "manipulador" ? "Manipulador (Cozinha/Bar)" : "Custom"}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Responsável padrão: {t.responsavelPadraoNome || "—"} · Subtarefas template: {t.subtarefasTemplate?.length || 0}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditando(t)}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => deletarTipo(t)}>🗑️</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {(criando || editando) && (
        <TipoForm
          tipo={editando}
          rid={rid}
          pessoas={pessoas}
          pessoaId={pessoaId}
          onClose={() => { setCriando(false); setEditando(null); }}
        />
      )}
    </div>
  );
}

function TipoForm({ tipo, rid, pessoas, pessoaId, onClose }: {
  tipo: ExameTipoConfig | null;
  rid: string;
  pessoas: Array<{ id: string; nome: string }>;
  pessoaId: string;
  onClose: () => void;
}) {
  const [f, setF] = useState<Partial<ExameTipoConfig>>(tipo ? { ...tipo } : {
    restaurantId: rid,
    nome: "",
    periodicidadeDias: 365,
    diasAntecedencia: 14,
    aplicabilidade: "todos",
    responsavelPadraoId: pessoaId,
    subtarefasTemplate: gerarSubtarefasTemplateDefault(),
    ativo: true,
  });

  async function salvar() {
    if (!f.nome) { alert("Nome obrigatório"); return; }
    const now = new Date().toISOString();
    const id = tipo?.id || `etc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const respNome = pessoas.find(p => p.id === f.responsavelPadraoId)?.nome;
    const data: ExameTipoConfig = {
      id, restaurantId: rid,
      nome: f.nome,
      descricao: f.descricao,
      periodicidadeDias: f.periodicidadeDias ?? 365,
      diasAntecedencia: f.diasAntecedencia ?? 14,
      fornecedorPadrao: f.fornecedorPadrao,
      aplicabilidade: f.aplicabilidade || "todos",
      cargoIdsCustom: f.cargoIdsCustom,
      responsavelPadraoId: f.responsavelPadraoId || pessoaId,
      responsavelPadraoNome: respNome,
      subtarefasTemplate: f.subtarefasTemplate || gerarSubtarefasTemplateDefault(),
      ativo: f.ativo ?? true,
      criadoEm: tipo?.criadoEm || now,
      criadoPor: tipo?.criadoPor || pessoaId,
      atualizadoEm: now,
    };
    await salvarTipo(data);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{tipo ? "Editar Tipo de Exame" : "Novo Tipo de Exame"}</h2>
        <div className="space-y-3 text-sm">
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Nome *</div>
            <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} className="exm-input" placeholder="Ex: Exame Clínico, Coprocultura, Audiometria" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <div className="text-xs text-gray-600 mb-1">Periodicidade (dias) *</div>
              <input type="number" min="1" value={f.periodicidadeDias ?? 365} onChange={(e) => setF({ ...f, periodicidadeDias: parseInt(e.target.value) || 365 })} className="exm-input" />
              <div className="text-[10px] text-gray-400 mt-0.5">365=anual, 180=semestral, 90=trimestral</div>
            </label>
            <label>
              <div className="text-xs text-gray-600 mb-1">Antecedência do lembrete (dias) *</div>
              <input type="number" min="0" value={f.diasAntecedencia ?? 14} onChange={(e) => setF({ ...f, diasAntecedencia: parseInt(e.target.value) || 14 })} className="exm-input" />
              <div className="text-[10px] text-gray-400 mt-0.5">Cria tarefa-pai X dias antes</div>
            </label>
          </div>
          <label>
            <div className="text-xs text-gray-600 mb-1">Fornecedor padrão</div>
            <input value={f.fornecedorPadrao || ""} onChange={(e) => setF({ ...f, fornecedorPadrao: e.target.value })} className="exm-input" placeholder="Ex: Triagem, Almed" />
          </label>
          <label>
            <div className="text-xs text-gray-600 mb-1">Aplicabilidade</div>
            <select value={f.aplicabilidade} onChange={(e) => setF({ ...f, aplicabilidade: e.target.value as ExameAplicabilidade })} className="exm-input">
              <option value="todos">Todos os empregados registrados</option>
              <option value="manipulador">Só manipuladores de alimento (Cozinha/Bar)</option>
              <option value="custom">Cargos específicos</option>
            </select>
          </label>
          <label>
            <div className="text-xs text-gray-600 mb-1">Responsável padrão (recebe as tarefas-pai)</div>
            <select value={f.responsavelPadraoId || ""} onChange={(e) => setF({ ...f, responsavelPadraoId: e.target.value })} className="exm-input">
              <option value="">— escolher —</option>
              {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label>
            <div className="text-xs text-gray-600 mb-1">Descrição (opcional)</div>
            <textarea value={f.descricao || ""} onChange={(e) => setF({ ...f, descricao: e.target.value })} rows={2} className="exm-input" />
          </label>
          <div className="text-xs text-gray-500 italic">
            Subtarefas template: usando default do fluxo (Agendar → Informar → Confirmar realização → Remarcar → Receber → Anexar → Baixa). Edição avançada vem em fase futura.
          </div>
        </div>
        <style>{`.exm-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .exm-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar}>{tipo ? "Salvar" : "Criar"}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal "+ Lançar exame" (registrar exame realizado/atualizar baixa) ──

function LancarExameModal({ tipos, empregados, onClose, autor, rid, examesExistentes }: {
  tipos: ExameTipoConfig[];
  empregados: Empregado[];
  onClose: () => void;
  autor: { id: string; nome: string };
  rid: string;
  examesExistentes: ExameEmpregado[];
}) {
  const [empregadoId, setEmpregadoId] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [realizadoEm, setRealizadoEm] = useState(new Date().toISOString().slice(0, 10));
  const [fornecedor, setFornecedor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [anexoUrl, setAnexoUrl] = useState("");
  const [anexoNome, setAnexoNome] = useState("");

  const tipo = tipos.find(t => t.id === tipoId);
  const emp = empregados.find(e => e.id === empregadoId);
  const exameExistente = examesExistentes.find(e => e.empregadoId === empregadoId && e.tipoId === tipoId && e.ativo);

  useEffect(() => {
    if (tipo && !fornecedor) setFornecedor(tipo.fornecedorPadrao || "");
  }, [tipoId, tipo, fornecedor]);

  async function escolherArquivo() {
    try {
      const f = await pickDriveFile("Selecione o resultado do exame");
      if (f) {
        setAnexoNome(f.name);
        setAnexoUrl(`https://drive.google.com/open?id=${f.id}`);
      }
    } catch (e) {
      alert("Não foi possível abrir o Drive Picker: " + String(e));
    }
  }

  async function salvar() {
    if (!empregadoId || !tipoId || !realizadoEm) { alert("Preencha empregado, tipo e data"); return; }
    if (!emp || !tipo) return;
    try {
      if (exameExistente) {
        // Já existe cadastro mestre → dá baixa
        await darBaixa({
          exameId: exameExistente.id,
          realizadoEm,
          fornecedor: fornecedor || undefined,
          anexoUrl: anexoUrl || undefined,
          anexoNome: anexoNome || undefined,
          observacao: observacao || undefined,
          autor,
        });
      } else {
        // Cria cadastro novo
        const id = await criarExame({
          restaurantId: rid,
          empregadoId,
          empregadoNomeSnapshot: emp.nome,
          cargoSnapshot: undefined,
          tipoId,
          tipoNomeSnapshot: tipo.nome,
          periodicidadeDias: tipo.periodicidadeDias,
          diasAntecedencia: tipo.diasAntecedencia,
          fornecedor: fornecedor || tipo.fornecedorPadrao,
          ultimaRealizacao: realizadoEm,
          proximoVencimento: addDias(realizadoEm, tipo.periodicidadeDias),
          ativo: true,
          criadoPor: autor.id,
        });
        if (anexoUrl) {
          // Registra a 1ª execução no histórico
          await darBaixa({
            exameId: id,
            realizadoEm,
            fornecedor: fornecedor || undefined,
            anexoUrl,
            anexoNome,
            observacao: observacao || undefined,
            autor,
          });
        }
      }
      onClose();
    } catch (e) {
      alert("Erro: " + String(e));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1 text-gray-900 dark:text-gray-100">+ Lançar Exame</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Registra um exame realizado. Se já existe cadastro mestre, dá baixa e recalcula vencimento; senão, cria novo.
        </p>
        <div className="space-y-3 text-sm">
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Empregado *</div>
            <select value={empregadoId} onChange={(e) => setEmpregadoId(e.target.value)} className="exm-input" autoFocus>
              <option value="">— escolher —</option>
              {empregados.filter(e => e.estaAtivo !== false).sort((a, b) => a.nome.localeCompare(b.nome)).map(e => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Tipo de exame *</div>
            <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} className="exm-input">
              <option value="">— escolher —</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nome} ({t.periodicidadeDias}d)</option>)}
            </select>
          </label>
          {exameExistente && (
            <div className="p-2 text-xs bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-blue-900 dark:text-blue-200">
              Cadastro mestre já existe. Vai dar baixa + criar próximo ciclo (vencimento será {addDias(realizadoEm, tipo?.periodicidadeDias || 365)}).
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <div className="text-xs text-gray-600 mb-1">Realizado em *</div>
              <input type="date" value={realizadoEm} onChange={(e) => setRealizadoEm(e.target.value)} className="exm-input" />
            </label>
            <label>
              <div className="text-xs text-gray-600 mb-1">Fornecedor</div>
              <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className="exm-input" placeholder={tipo?.fornecedorPadrao || ""} />
            </label>
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Resultado (arquivo do Drive)</div>
            <div className="flex gap-2 items-center">
              <Button size="sm" variant="ghost" onClick={escolherArquivo}>📎 Escolher arquivo do Drive</Button>
              {anexoNome && <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{anexoNome}</span>}
            </div>
          </div>
          <label className="block">
            <div className="text-xs text-gray-600 mb-1">Observação</div>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className="exm-input" />
          </label>
        </div>
        <style>{`.exm-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .exm-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar}>{exameExistente ? "Dar baixa" : "Lançar"}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal detalhe ─────────────────────────────────────────────────────

function ExameDetalheModal({ exame, onClose, autor }: {
  exame: ExameEmpregado;
  onClose: () => void;
  autor: { id: string; nome: string };
}) {
  const [dandoBaixa, setDandoBaixa] = useState(false);

  async function desativar() {
    const motivo = prompt("Motivo da desativação (opcional):");
    if (motivo === null) return;
    if (!confirm("Desativar este exame? Não vai mais gerar tarefas-lembrete.")) return;
    await desativarExame(exame.id, autor, motivo || undefined);
    onClose();
  }
  async function reativar() {
    if (!confirm("Reativar exame?")) return;
    await reativarExame(exame.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{exame.tipoNomeSnapshot}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{exame.empregadoNomeSnapshot}{exame.cargoSnapshot && ` · ${exame.cargoSnapshot}`}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </header>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-gray-500">Próximo vencimento</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{exame.proximoVencimento}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Última realização</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{exame.ultimaRealizacao || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Periodicidade</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{exame.periodicidadeDias} dias</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Status</div>
              <div className={`font-medium ${exame.ativo ? "text-emerald-600" : "text-red-600"}`}>{exame.ativo ? "Ativo" : "Inativo"}</div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
              Histórico ({exame.historico?.length || 0})
            </h3>
            {!exame.historico || exame.historico.length === 0 ? (
              <div className="text-xs text-gray-400 italic">Nenhuma execução registrada ainda.</div>
            ) : (
              <div className="space-y-1.5">
                {exame.historico.slice().reverse().map(h => (
                  <div key={h.id} className="text-xs bg-gray-50 dark:bg-gray-800/40 p-2 rounded-md">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{h.realizadoEm}{h.fornecedor && ` · ${h.fornecedor}`}</div>
                    {h.anexoUrl && (
                      <a href={h.anexoUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">📎 {h.anexoNome || "Resultado"}</a>
                    )}
                    {h.observacao && <div className="text-gray-600 dark:text-gray-400 mt-0.5">{h.observacao}</div>}
                    <div className="text-[10px] text-gray-400 mt-0.5">Registrado por {h.registradoPorNome || "—"} em {h.registradoEm.slice(0, 16).replace("T", " ")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-between gap-2 mt-5">
          {exame.ativo ? (
            <Button variant="ghost" onClick={desativar}>Desativar</Button>
          ) : (
            <Button variant="ghost" onClick={reativar}>Reativar</Button>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
            {exame.ativo && <Button onClick={() => setDandoBaixa(true)}>✓ Dar baixa</Button>}
          </div>
        </div>

        {dandoBaixa && (
          <BaixaInlineForm
            exame={exame}
            autor={autor}
            onDone={() => { setDandoBaixa(false); onClose(); }}
            onCancel={() => setDandoBaixa(false)}
          />
        )}
      </div>
    </div>
  );
}

function BaixaInlineForm({ exame, autor, onDone, onCancel }: {
  exame: ExameEmpregado;
  autor: { id: string; nome: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [realizadoEm, setRealizadoEm] = useState(new Date().toISOString().slice(0, 10));
  const [fornecedor, setFornecedor] = useState(exame.fornecedor || "");
  const [observacao, setObservacao] = useState("");
  const [anexoUrl, setAnexoUrl] = useState("");
  const [anexoNome, setAnexoNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function escolherArquivo() {
    try {
      const f = await pickDriveFile("Selecione o resultado do exame");
      if (f) {
        setAnexoNome(f.name);
        setAnexoUrl(`https://drive.google.com/open?id=${f.id}`);
      }
    } catch (e) {
      alert("Não foi possível abrir o Drive Picker: " + String(e));
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      await darBaixa({
        exameId: exame.id,
        realizadoEm,
        fornecedor: fornecedor || undefined,
        anexoUrl: anexoUrl || undefined,
        anexoNome: anexoNome || undefined,
        observacao: observacao || undefined,
        autor,
      });
      onDone();
    } catch (e) {
      alert("Erro: " + String(e));
      setSalvando(false);
    }
  }

  return (
    <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md space-y-2 text-sm">
      <div className="font-medium text-emerald-900 dark:text-emerald-200">Dar baixa neste exame</div>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <div className="text-xs text-gray-600 mb-0.5">Realizado em *</div>
          <input type="date" value={realizadoEm} onChange={(e) => setRealizadoEm(e.target.value)} className="exm-input" />
        </label>
        <label>
          <div className="text-xs text-gray-600 mb-0.5">Fornecedor</div>
          <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className="exm-input" />
        </label>
      </div>
      <div className="flex gap-2 items-center">
        <Button size="sm" variant="ghost" onClick={escolherArquivo}>📎 Anexar resultado</Button>
        {anexoNome && <span className="text-xs text-gray-700 truncate flex-1">{anexoNome}</span>}
      </div>
      <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação (opcional)" rows={2} className="exm-input" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Confirmar baixa"}</Button>
      </div>
    </div>
  );
}

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Helper exposto pra setDoc inline (não-usado, evita TS no-unused — Force usado em runtime)
void setDoc; void doc; void getDoc; void sanitizeForFirestore;
