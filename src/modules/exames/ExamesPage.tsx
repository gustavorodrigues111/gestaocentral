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
import { collection, onSnapshot, query, where, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { pickDriveFile } from "../../core/google/drivePicker";
import { subirExameNoDrive } from "./driveExames";
import {
  ouvirTipos, salvarTipo, excluirTipo, gerarSubtarefasTemplateDefault,
  criarExame, darBaixa, desativarExame, reativarExame,
} from "./repository";
import { gerarTarefasDeExames } from "./gerador";
import type {
  ExameTipoConfig, ExameEmpregado, Empregado, Cargo,
} from "../../core/types";
import { tipoAplicaAoCargoObj } from "./aplicabilidade";
import { fmtBR, fmtBRDateTime } from "../../core/utils/date";

type Tab = "vencimentos" | "porEmpregado" | "porTipo" | "config";
type JanelaVenc = "atrasados" | "15" | "30" | "60" | "90" | "180" | "todos";

export function ExamesPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const [tab, setTab] = useState<Tab>("vencimentos");
  const [janela, setJanela] = useState<JanelaVenc>("30");
  const [tipos, setTipos] = useState<ExameTipoConfig[]>([]);
  const [exames, setExames] = useState<ExameEmpregado[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [lancarPrefill, setLancarPrefill] = useState<{ empregado: Empregado; tipo: ExameTipoConfig } | null>(null);
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
    const u4 = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      snap => setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cargo)))
    );
    return () => { u1(); u2(); u3(); u4(); };
  }, [rid]);

  const hoje = new Date().toISOString().slice(0, 10);
  const ativos = useMemo(() => exames.filter(e => e.ativo), [exames]);

  const atrasados = useMemo(
    () => ativos
      .filter(e => e.proximoVencimento < hoje)
      .sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento)),
    [ativos, hoje],
  );

  // Contagens pra mostrar nos chips
  const contagens = useMemo(() => {
    const r = { atrasados: atrasados.length, "15": 0, "30": 0, "60": 0, "90": 0, "180": 0, todos: ativos.length };
    const dentro = (dias: number) => ativos.filter(e => {
      if (e.proximoVencimento < hoje) return false;
      const limite = addDias(hoje, dias);
      return e.proximoVencimento <= limite;
    }).length;
    r["15"] = dentro(15);
    r["30"] = dentro(30);
    r["60"] = dentro(60);
    r["90"] = dentro(90);
    r["180"] = dentro(180);
    return r;
  }, [ativos, atrasados, hoje]);

  // Filtra pelo chip ativo
  const exibidos = useMemo(() => {
    if (janela === "atrasados") return atrasados;
    if (janela === "todos") return ativos.slice().sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento));
    const dias = parseInt(janela);
    const limite = addDias(hoje, dias);
    return ativos
      .filter(e => e.proximoVencimento >= hoje && e.proximoVencimento <= limite)
      .sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento));
  }, [janela, ativos, atrasados, hoje]);

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
        <TabButton ativo={tab === "vencimentos"} onClick={() => setTab("vencimentos")}>Vencimentos</TabButton>
        <TabButton ativo={tab === "porEmpregado"} onClick={() => setTab("porEmpregado")}>Por empregado</TabButton>
        <TabButton ativo={tab === "porTipo"} onClick={() => setTab("porTipo")}>Por tipo</TabButton>
        {pessoa?.isMaster && <TabButton ativo={tab === "config"} onClick={() => setTab("config")}>Configuração</TabButton>}
      </nav>

      {tab === "vencimentos" && (
        <div>
          {/* Chips de janela */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            <Chip ativo={janela === "atrasados"} onClick={() => setJanela("atrasados")} cor="red">
              🔥 Atrasados {contagens.atrasados > 0 && `(${contagens.atrasados})`}
            </Chip>
            <Chip ativo={janela === "15"} onClick={() => setJanela("15")}>
              Próximos 15d {contagens["15"] > 0 && `(${contagens["15"]})`}
            </Chip>
            <Chip ativo={janela === "30"} onClick={() => setJanela("30")}>
              30d {contagens["30"] > 0 && `(${contagens["30"]})`}
            </Chip>
            <Chip ativo={janela === "60"} onClick={() => setJanela("60")}>
              60d {contagens["60"] > 0 && `(${contagens["60"]})`}
            </Chip>
            <Chip ativo={janela === "90"} onClick={() => setJanela("90")}>
              90d {contagens["90"] > 0 && `(${contagens["90"]})`}
            </Chip>
            <Chip ativo={janela === "180"} onClick={() => setJanela("180")}>
              180d {contagens["180"] > 0 && `(${contagens["180"]})`}
            </Chip>
            <Chip ativo={janela === "todos"} onClick={() => setJanela("todos")}>
              Todos ({contagens.todos})
            </Chip>
          </div>
          <ListaExames
            exames={exibidos}
            onAbrir={setExameSelecionado}
            vazio={janela === "atrasados" ? "✅ Nenhum exame atrasado." : `Nenhum exame na janela selecionada.`}
            atrasado={janela === "atrasados"}
          />
        </div>
      )}
      {tab === "porEmpregado" && (
        <ListaPorEmpregado
          empregados={empregados} cargos={cargos} tipos={tipos} exames={ativos}
          onAbrir={setExameSelecionado}
          onLancar={(empregado, tipo) => setLancarPrefill({ empregado, tipo })}
        />
      )}
      {tab === "porTipo" && <ListaPorTipo exames={ativos} tipos={tipos} onAbrir={setExameSelecionado} />}
      {tab === "config" && pessoa?.isMaster && <ConfigTab tipos={tipos} rid={rid} pessoaId={pessoa.id} cargos={cargos} />}

      {exameSelecionado && (
        <ExameDetalheModal
          exame={exameSelecionado}
          onClose={() => setExameSelecionado(null)}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
        />
      )}
      {(lancandoNovo || lancarPrefill) && (
        <LancarExameModal
          tipos={tipos}
          empregados={empregados}
          onClose={() => { setLancandoNovo(false); setLancarPrefill(null); }}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
          rid={rid}
          examesExistentes={exames}
          prefill={lancarPrefill ? { empregadoId: lancarPrefill.empregado.id, tipoId: lancarPrefill.tipo.id } : undefined}
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

function Chip({ ativo, onClick, cor, children }: {
  ativo: boolean;
  onClick: () => void;
  cor?: "red" | "default";
  children: React.ReactNode;
}) {
  const corClass = cor === "red"
    ? (ativo ? "bg-red-600 text-white" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 hover:bg-red-100")
    : (ativo ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200");
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${corClass}`}
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
            Vence: <span className={atrasado ? "text-red-600 font-medium" : ""}>{fmtBR(exame.proximoVencimento)}</span>
            {atrasado ? ` · ⚠ ${-dias} dia(s) atrasado` : dias === 0 ? " · hoje" : ` · em ${dias} dia(s)`}
            {exame.ultimaRealizacao && ` · última: ${fmtBR(exame.ultimaRealizacao)}`}
          </div>
        </div>
        {(exame.historico?.length ?? 0) > 0 && (
          <div className="text-[10px] text-gray-400">{exame.historico.length} execução(ões)</div>
        )}
      </div>
    </div>
  );
}

function ListaPorEmpregado({ empregados, cargos, tipos, exames, onAbrir, onLancar }: {
  empregados: Empregado[];
  cargos: Cargo[];
  tipos: ExameTipoConfig[];
  exames: ExameEmpregado[];
  onAbrir: (e: ExameEmpregado) => void;
  onLancar: (emp: Empregado, tipo: ExameTipoConfig) => void;
}) {
  const cargoById = useMemo(() => new Map(cargos.map(c => [c.id, c])), [cargos]);
  const tiposAtivos = useMemo(() => tipos.filter(t => t.ativo), [tipos]);

  // Todos os empregados ATIVOS com cargo → cruza com os exames EXIGIDOS pelo
  // cargo. Falta cadastrar (sem realização) → destaque vermelho pra controle.
  const linhas = useMemo(() => {
    const out = empregados
      .filter(e => e.estaAtivo !== false && e.cargoId)
      .map(e => {
        const cargo = e.cargoId ? cargoById.get(e.cargoId) : undefined;
        const requeridos = tiposAtivos.filter(t => tipoAplicaAoCargoObj(t, cargo));
        const itens = requeridos.map(t => {
          const exame = exames.find(x => x.empregadoId === e.id && x.tipoId === t.id && x.ativo);
          const falta = !exame || !exame.ultimaRealizacao;
          return { tipo: t, exame, falta };
        });
        return { emp: e, cargo, itens, pendencias: itens.filter(i => i.falta).length };
      })
      .filter(l => l.itens.length > 0);
    out.sort((a, b) => (b.pendencias - a.pendencias) || a.emp.nome.localeCompare(b.emp.nome, "pt-BR"));
    return out;
  }, [empregados, cargoById, tiposAtivos, exames]);

  if (linhas.length === 0) return <div className="text-center py-12 text-gray-500">Nenhum empregado CLT com cargo e exames exigidos.</div>;
  const totalPend = linhas.reduce((s, l) => s + l.pendencias, 0);

  return (
    <div className="space-y-3">
      {totalPend > 0 && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ⚠ <strong>{totalPend}</strong> exame(s) sem prazo cadastrado. Registre a data de realização pra controlar os vencimentos.
        </div>
      )}
      {linhas.map(({ emp, cargo, itens, pendencias }) => (
        <div key={emp.id} className={`rounded-xl border overflow-hidden bg-white dark:bg-gray-900 ${pendencias > 0 ? "border-red-200 dark:border-red-800" : "border-gray-200 dark:border-gray-800"}`}>
          <div className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{emp.nome}</span>
              {cargo && <span className="ml-2 text-xs text-gray-500">{cargo.nome}{cargo.area ? ` · ${cargo.area}` : ""}</span>}
            </div>
            {pendencias > 0
              ? <span className="shrink-0 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{pendencias} pendente(s)</span>
              : <span className="shrink-0 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">em dia</span>}
          </div>
          <div className="px-3 pb-3 space-y-1.5">
            {itens.map(({ tipo, exame, falta }) => (
              falta ? (
                <div key={tipo.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                  <div className="text-sm text-red-800 dark:text-red-300 min-w-0">
                    <strong>{tipo.nome}</strong> — sem prazo cadastrado
                    <div className="text-[11px] text-red-600 dark:text-red-400">Periodicidade {tipo.periodicidadeDias}d · falta registrar a última realização</div>
                  </div>
                  <Button size="sm" onClick={() => onLancar(emp, tipo)}>+ Lançar</Button>
                </div>
              ) : (
                <CardExame key={tipo.id} exame={exame!} onAbrir={() => onAbrir(exame!)} />
              )
            ))}
          </div>
        </div>
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

// Lista de fornecedores padrão de exame por restaurante (Restaurant.exameFornecedores).
function FornecedoresConfig({ rid }: { rid: string }) {
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find(r => r.id === rid);
  const fornecedores = restaurant?.exameFornecedores || [];
  const [novo, setNovo] = useState("");

  async function persistir(lista: string[]) {
    await updateDoc(doc(db, "restaurants", rid), { exameFornecedores: lista });
  }
  async function add() {
    const v = novo.trim();
    if (!v || fornecedores.some(f => f.toLowerCase() === v.toLowerCase())) { setNovo(""); return; }
    await persistir([...fornecedores, v].sort((a, b) => a.localeCompare(b, "pt-BR")));
    setNovo("");
  }

  return (
    <div className="mb-4 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Fornecedores</div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
        Clínicas/laboratórios que aparecem no dropdown ao lançar um exame.
      </p>
      {fornecedores.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {fornecedores.map(f => (
            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {f}
              <button type="button" onClick={() => persistir(fornecedores.filter(x => x !== f))} className="text-gray-400 hover:text-rose-600">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={novo} onChange={e => setNovo(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
          placeholder="Ex: Triagem, Almed…" className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        <Button size="sm" onClick={add}>+ Adicionar</Button>
      </div>
    </div>
  );
}

function ConfigTab({ tipos, rid, pessoaId, cargos }: { tipos: ExameTipoConfig[]; rid: string; pessoaId: string; cargos: Cargo[] }) {
  const cargoNome = (id: string) => cargos.find(c => c.id === id)?.nome || "cargo?";
  const cargosLabel = (t: ExameTipoConfig) => {
    if (t.cargosObrigatorios?.length) return t.cargosObrigatorios.map(cargoNome).join(", ");
    if (t.areasAplicaveis?.length) return `áreas ${t.areasAplicaveis.join(", ")}`;
    return "Todos (CLT)";
  };
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<ExameTipoConfig | null>(null);
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string }>>([]);
  const [semeando, setSemeando] = useState(false);
  const [migrando, setMigrando] = useState(false);

  async function semearDefaults() {
    if (!confirm("Criar tipos default (Clínico anual + Coprocultura semestral pra manipuladores)? Vai pular tipos que já existem.")) return;
    setSemeando(true);
    try {
      const defaults: Array<Omit<ExameTipoConfig, "id" | "criadoEm" | "criadoPor" | "atualizadoEm" | "restaurantId">> = [
        {
          nome: "Exame Clínico",
          periodicidadeDias: 365,
          diasAntecedencia: 14,
          areasAplicaveis: [],   // vazio = todas as áreas
          responsavelPadraoId: pessoaId,
          subtarefasTemplate: gerarSubtarefasTemplateDefault(),
          ativo: true,
        },
        {
          nome: "Coprocultura",
          descricao: "Exigido pra manipuladores de alimentos",
          periodicidadeDias: 180,
          diasAntecedencia: 14,
          areasAplicaveis: ["Cozinha", "Bar"],
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
          cargoVinculo: cargo?.tipoVinculo,
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
            {semeando ? "Criando…" : "🌱 Criar 2 tipos default"}
          </Button>
          <Button size="sm" variant="ghost" onClick={migrarEmpregados} disabled={migrando} title="Roda pra cada empregado ativo do rest, cria ExameEmpregado nos tipos aplicáveis">
            {migrando ? "Migrando…" : "👥 Migrar empregados existentes"}
          </Button>
          <Button size="sm" onClick={() => setCriando(true)}>+ Novo Tipo</Button>
        </div>
      </div>
      <FornecedoresConfig rid={rid} />

      <div className="space-y-2">
        {tipos.map(t => (
          <div key={t.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{t.nome}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Periodicidade: {t.periodicidadeDias} dias · Antecedência: {t.diasAntecedencia} dias
                  {t.fornecedorPadrao && ` · Fornecedor: ${t.fornecedorPadrao}`}
                  {" · "}Cargos: {cargosLabel(t)}
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
          cargos={cargos}
          onClose={() => { setCriando(false); setEditando(null); }}
        />
      )}
    </div>
  );
}

function TipoForm({ tipo, rid, pessoas, pessoaId, cargos, onClose }: {
  tipo: ExameTipoConfig | null;
  rid: string;
  pessoas: Array<{ id: string; nome: string }>;
  pessoaId: string;
  cargos: Cargo[];
  onClose: () => void;
}) {
  const [f, setF] = useState<Partial<ExameTipoConfig>>(tipo ? { ...tipo } : {
    restaurantId: rid,
    nome: "",
    periodicidadeDias: 365,
    diasAntecedencia: 14,
    areasAplicaveis: [],
    cargosObrigatorios: [],
    responsavelPadraoId: pessoaId,
    subtarefasTemplate: gerarSubtarefasTemplateDefault(),
    ativo: true,
  });
  // "todos" = cargosObrigatorios vazio (aplica a todos os cargos CLT).
  const [modo, setModo] = useState<"todos" | "especificos">(
    tipo?.cargosObrigatorios?.length ? "especificos" : "todos",
  );
  const cargosOrdenados = cargos.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

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
      areasAplicaveis: f.areasAplicaveis || [],
      cargosObrigatorios: modo === "especificos" ? (f.cargosObrigatorios || []) : [],
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
          <div>
            <div className="text-xs text-gray-600 mb-1">Cargos obrigatórios</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {([
                { v: "todos" as const, t: "Todos os cargos CLT", s: "Ex: Exame Clínico anual" },
                { v: "especificos" as const, t: "Cargos específicos", s: "Ex: Coprocultura → cozinha" },
              ]).map(o => (
                <button key={o.v} type="button" onClick={() => setModo(o.v)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    modo === o.v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30" : "border-gray-200 dark:border-gray-700"
                  }`}>
                  <div className={`text-xs font-semibold ${modo === o.v ? "text-indigo-700 dark:text-indigo-300" : "text-gray-800 dark:text-gray-100"}`}>{o.t}</div>
                  <div className="text-[10px] text-gray-500">{o.s}</div>
                </button>
              ))}
            </div>
            {modo === "especificos" && (
              <div className="flex flex-col gap-1 p-2 border border-gray-300 dark:border-gray-700 rounded-md max-h-44 overflow-y-auto">
                {cargosOrdenados.length === 0 ? (
                  <div className="text-xs text-gray-500">Nenhum cargo cadastrado neste restaurante.</div>
                ) : cargosOrdenados.map(c => {
                  const sel = (f.cargosObrigatorios || []).includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={sel}
                        onChange={(e) => {
                          const cur = f.cargosObrigatorios || [];
                          const novo = e.target.checked ? [...cur, c.id] : cur.filter(x => x !== c.id);
                          setF({ ...f, cargosObrigatorios: novo });
                        }} />
                      <span>{c.nome}{c.area ? <span className="text-gray-400"> · {c.area}</span> : null}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="text-[10px] text-gray-400 mt-0.5">
              "Todos os cargos CLT" = registrados + estagiários (ex: Clínico). "Cargos específicos" = só os marcados (ex: Coprocultura pros manipuladores de alimento).
            </div>
          </div>
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

function LancarExameModal({ tipos, empregados, onClose, autor, rid, examesExistentes, prefill }: {
  tipos: ExameTipoConfig[];
  empregados: Empregado[];
  onClose: () => void;
  autor: { id: string; nome: string };
  rid: string;
  examesExistentes: ExameEmpregado[];
  prefill?: { empregadoId: string; tipoId: string };
}) {
  const [empregadoId, setEmpregadoId] = useState(prefill?.empregadoId || "");
  const [tipoId, setTipoId] = useState(prefill?.tipoId || "");
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

  const { restaurants } = useRestaurant();
  const fornecedoresRest = restaurants.find(r => r.id === rid)?.exameFornecedores || [];
  const [subindo, setSubindo] = useState(false);

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

  async function subirArquivo(file: File) {
    if (!emp) { alert("Escolha o empregado primeiro."); return; }
    setSubindo(true);
    try {
      const r = await subirExameNoDrive(emp, file);
      setAnexoUrl(r.url);
      setAnexoNome(r.nome);
    } catch (e) {
      alert("Erro ao subir arquivo: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubindo(false);
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
              Cadastro mestre já existe. Vai dar baixa + criar próximo ciclo (vencimento será {fmtBR(addDias(realizadoEm, tipo?.periodicidadeDias || 365))}).
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <div className="text-xs text-gray-600 mb-1">Realizado em *</div>
              <input type="date" value={realizadoEm} onChange={(e) => setRealizadoEm(e.target.value)} className="exm-input" />
            </label>
            <label>
              <div className="text-xs text-gray-600 mb-1">Fornecedor</div>
              {fornecedoresRest.length > 0 ? (
                <select
                  value={fornecedoresRest.includes(fornecedor) || !fornecedor ? fornecedor : "__outro__"}
                  onChange={(e) => setFornecedor(e.target.value === "__outro__" ? "" : e.target.value)}
                  className="exm-input"
                >
                  <option value="">— escolher —</option>
                  {fornecedoresRest.map(f => <option key={f} value={f}>{f}</option>)}
                  <option value="__outro__">Outro (digitar)…</option>
                </select>
              ) : (
                <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className="exm-input" placeholder={tipo?.fornecedorPadrao || ""} />
              )}
              {fornecedoresRest.length > 0 && !fornecedoresRest.includes(fornecedor) && (
                <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className="exm-input mt-1" placeholder="Nome do fornecedor" />
              )}
            </label>
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Resultado (PDF)</div>
            <div className="flex gap-2 items-center flex-wrap">
              <Button size="sm" variant="ghost" onClick={escolherArquivo}>📎 Escolher do Drive</Button>
              <label className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${subindo ? "opacity-50" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
                {subindo ? "Subindo…" : "⬆️ Subir arquivo"}
                <input type="file" className="hidden" disabled={subindo}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArquivo(f); e.target.value = ""; }} />
              </label>
              {anexoNome && <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">✓ {anexoNome}</span>}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">"Subir arquivo" joga o PDF na pasta "Exames Médicos" do empregado no Drive.</div>
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
    if (!confirm("Desativar este exame manualmente? Use só pra correções (cadastro errado, exame fora da rotina). Pra demissão/mudança de área, o sistema desativa automaticamente.")) return;
    const motivo = prompt("Motivo (opcional):");
    if (motivo === null) return;
    await desativarExame(exame.id, autor, motivo || "Desativação manual");
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
              <div className="font-medium text-gray-900 dark:text-gray-100">{fmtBR(exame.proximoVencimento)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Última realização</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{exame.ultimaRealizacao ? fmtBR(exame.ultimaRealizacao) : "—"}</div>
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
                    <div className="font-medium text-gray-900 dark:text-gray-100">{fmtBR(h.realizadoEm)}{h.fornecedor && ` · ${h.fornecedor}`}</div>
                    {h.anexoUrl && (
                      <a href={h.anexoUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">📎 {h.anexoNome || "Resultado"}</a>
                    )}
                    {h.observacao && <div className="text-gray-600 dark:text-gray-400 mt-0.5">{h.observacao}</div>}
                    <div className="text-[10px] text-gray-400 mt-0.5">Registrado por {h.registradoPorNome || "—"} em {fmtBRDateTime(h.registradoEm)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 pt-3 border-t border-gray-200 dark:border-gray-800">
          {exame.ativo ? (
            <>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Fechar</Button>
                <Button onClick={() => setDandoBaixa(true)}>✓ Resultado de exame recebido</Button>
              </div>
              <div className="mt-3 pt-2 border-t border-dashed border-gray-200 dark:border-gray-800">
                <Button variant="ghost" onClick={desativar} title="Use só pra casos manuais (cadastro errado, etc)">🗑️ Desativar exame manualmente</Button>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Em caso de <b>demissão</b> ou <b>mudança de área</b>, o sistema desativa exames automaticamente quando não se aplicam mais. Use o botão acima só pra correções manuais (cadastro errado, exame fora da rotina, etc).
                </p>
              </div>
            </>
          ) : (
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={reativar}>Reativar</Button>
              <Button onClick={onClose}>Fechar</Button>
            </div>
          )}
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
      <div className="font-medium text-emerald-900 dark:text-emerald-200">Registrar resultado recebido</div>
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
        <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Confirmar"}</Button>
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
