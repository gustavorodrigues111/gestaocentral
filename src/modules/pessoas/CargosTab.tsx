import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { canConfigurar } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { VigenciaModal, type ChangedField } from "../../core/ui/VigenciaModal";
import { applyVersionedChange, logAudit } from "../../core/audit/versionedChange";
import {
  AREAS, TIPOS_VINCULO, TIPO_VINCULO_LABEL, TIPOS_VINCULO_COM_PESSOA,
} from "../../core/types";
import type { Area, Cargo, Empregado, TipoVinculo } from "../../core/types";
import { defaultBatePontoPorVinculo } from "../../core/types";
import { ImportCargosModal } from "./ImportCargosModal";
import { HistoricoCargoModal } from "./HistoricoCargoModal";

type Props = { restaurantId: string };

export function CargosTab({ restaurantId }: Props) {
  const { pessoa: me } = useAuth();
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cargo | "new" | null>(null);
  const [showHistory, setShowHistory] = useState<Cargo | null>(null);
  const [filtroAtivos, setFiltroAtivos] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [importing, setImporting] = useState(false);
  const podeConfig = canConfigurar(me, restaurantId, "pessoas");

  // Carrega cargos
  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo);
      setCargos(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  // Carrega empregados (pra validação de inativação)
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId]);

  // Index reverso: cargoId → empregados ativos com esse cargo
  const empregadosAtivosPorCargo = useMemo(() => {
    const m: Record<string, Empregado[]> = {};
    for (const e of empregados) {
      if (!e.estaAtivo) continue;
      if (!m[e.cargoId]) m[e.cargoId] = [];
      m[e.cargoId].push(e);
    }
    return m;
  }, [empregados]);

  // Filtro + agrupa por área
  const filtered = useMemo(() => {
    return cargos.filter(c => {
      if (filtroAtivos === "ativos"  && !c.ativo) return false;
      if (filtroAtivos === "inativos" && c.ativo) return false;
      return true;
    });
  }, [cargos, filtroAtivos]);

  const byArea = useMemo(() => {
    const m: Record<string, Cargo[]> = {};
    AREAS.forEach(a => { m[a] = []; });
    filtered.forEach(c => {
      if (!m[c.area]) m[c.area] = [];
      m[c.area].push(c);
    });
    Object.keys(m).forEach(a => {
      m[a].sort((x, y) => (x.ordem ?? 999) - (y.ordem ?? 999) || x.nome.localeCompare(y.nome));
    });
    return m;
  }, [filtered]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} cargo(s)
        </p>
        {podeConfig && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)} title="Importar cargos via CSV (migração do AppTip)">
              📥 Importar CSV
            </Button>
            <Button onClick={() => setEditing("new")}>+ Novo cargo</Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        {(["ativos", "inativos", "todos"] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltroAtivos(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtroAtivos === f
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            {f === "ativos" ? "✓ Ativos" : f === "inativos" ? "○ Inativos" : "Todos"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : cargos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🏷️</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum cargo cadastrado</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Cadastre os cargos do restaurante (Garçom 1, Cozinheiro Líder, Freela Garçom, etc).
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {AREAS.map(area => {
            const lista = byArea[area];
            if (!lista || lista.length === 0) return null;
            return (
              <div key={area}>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {area}
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                  {lista.map((c, i) => (
                    <CargoRow
                      key={c.id}
                      cargo={c}
                      isFirst={i === 0}
                      empregadosAtivos={empregadosAtivosPorCargo[c.id]?.length || 0}
                      podeConfig={podeConfig}
                      onEdit={() => setEditing(c)}
                      onShowHistory={() => setShowHistory(c)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CargoModal
          cargo={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          empregadosAtivos={editing === "new" ? 0 : (empregadosAtivosPorCargo[editing.id]?.length || 0)}
          onClose={() => setEditing(null)}
        />
      )}

      {importing && (
        <ImportCargosModal
          cargosExistentes={cargos}
          restaurantId={restaurantId}
          onClose={() => setImporting(false)}
        />
      )}

      {showHistory && (
        <HistoricoCargoModal
          cargo={showHistory}
          restaurantId={restaurantId}
          onClose={() => setShowHistory(null)}
        />
      )}
    </div>
  );
}

function CargoRow({
  cargo, isFirst, empregadosAtivos, podeConfig, onEdit, onShowHistory,
}: {
  cargo: Cargo;
  isFirst: boolean;
  empregadosAtivos: number;
  podeConfig: boolean;
  onEdit: () => void;
  onShowHistory: () => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${isFirst ? "" : "border-t border-gray-100 dark:border-gray-800"} ${!cargo.ativo ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 dark:text-gray-100">{cargo.nome}</span>
          <TipoVinculoBadge tipo={cargo.tipoVinculo} />
          {!cargo.ativo && <span className="text-xs text-gray-400">(inativo)</span>}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
          {cargo.semGorjeta
            ? <span>Sem gorjeta</span>
            : <span>{cargo.pontos} ponto(s)</span>}
          {cargo.recebeProducao && <span className="text-amber-600 dark:text-amber-400">· recebe produção (todo dia)</span>}
          {empregadosAtivos > 0 && (
            <span className="text-indigo-600 dark:text-indigo-400">· {empregadosAtivos} empregado(s) ativo(s)</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" size="sm" onClick={onShowHistory} title="Histórico de alterações deste cargo">
          📜 Histórico
        </Button>
        {podeConfig && (
          <Button variant="secondary" size="sm" onClick={onEdit}>Editar</Button>
        )}
      </div>
    </div>
  );
}

function TipoVinculoBadge({ tipo }: { tipo: TipoVinculo }) {
  const cls = tipo === "registrado"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : tipo === "estagiario"
    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
    : tipo === "provisorio"
    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {TIPO_VINCULO_LABEL[tipo].split(" ")[0]}
    </span>
  );
}

// ─── MODAL DE EDIÇÃO ────────────────────────────────────────────────────────

function CargoModal({
  cargo, restaurantId, empregadosAtivos, onClose,
}: {
  cargo: Cargo | null;
  restaurantId: string;
  empregadosAtivos: number;
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(cargo?.nome || "");
  const [area, setArea] = useState<Area>(cargo?.area || "Salão");
  const [tipoVinculo, setTipoVinculo] = useState<TipoVinculo>(cargo?.tipoVinculo || "registrado");
  const [pontos, setPontos] = useState<number>(cargo?.pontos ?? 1);
  const [semGorjeta, setSemGorjeta] = useState(cargo?.semGorjeta ?? false);
  const [recebeProducao, setRecebeProducao] = useState(cargo?.recebeProducao ?? false);
  // batePonto opcional — default = true pra registrado/estagiario, false pra
  // freela/terceirizado. Quando o user marca/desmarca, vira valor explícito.
  // null = "herda do TipoVinculo" (não persiste).
  const [batePonto, setBatePonto] = useState<boolean | null>(cargo?.batePonto ?? null);
  const [ativo, setAtivo] = useState(cargo?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Pending vigência changes (quando há mudança crítica em cargo existente)
  const [pendingVigencia, setPendingVigencia] = useState<{
    changes: ChangedField[];
    nonVersionedUpdates: Record<string, unknown>;
  } | null>(null);

  const tipoOriginal = cargo?.tipoVinculo;
  const ativoOriginal = cargo?.ativo;

  // Validações
  const tentaInativarComEmpregados = !!cargo && ativoOriginal && !ativo && empregadosAtivos > 0;
  const trocouTipoVinculo = !!cargo && tipoOriginal && tipoOriginal !== tipoVinculo && empregadosAtivos > 0;
  const tipoExigePessoa = TIPOS_VINCULO_COM_PESSOA.includes(tipoVinculo);

  // Detecta diff entre cargo original e form atual.
  // Retorna { criticas, naoCriticas } separadas. Críticas vão pelo VigenciaModal.
  function diffAtual() {
    const criticas: ChangedField[] = [];
    const naoCriticas: Record<string, unknown> = {};

    if (!cargo) return { criticas, naoCriticas };

    // Não-versionados (sempre aplicam imediato)
    if (cargo.nome !== nome.trim()) naoCriticas.nome = nome.trim();
    if (cargo.area !== area) naoCriticas.area = area;
    if (cargo.ativo !== ativo) naoCriticas.ativo = ativo;
    // batePonto: muda imediatamente — afeta só filtragem do relatório de ponto
    const batePontoAtualCargo = cargo.batePonto ?? null;
    if (batePontoAtualCargo !== batePonto) {
      naoCriticas.batePonto = batePonto === null ? null : batePonto;
    }

    // Versionados (críticos — afetam gorjeta/escala/empregados)
    const novoPontos = semGorjeta ? 0 : pontos;
    if ((cargo.pontos ?? 0) !== novoPontos) {
      criticas.push({
        campo: "pontos",
        label: "Pontos",
        valorAntes: String(cargo.pontos ?? 0),
        valorDepois: String(novoPontos),
        rawValorAntes: cargo.pontos ?? 0,
        rawValorDepois: novoPontos,
      });
    }
    if ((cargo.semGorjeta ?? false) !== semGorjeta) {
      criticas.push({
        campo: "semGorjeta",
        label: "Sem gorjeta",
        valorAntes: cargo.semGorjeta ? "Sim" : "Não",
        valorDepois: semGorjeta ? "Sim" : "Não",
        rawValorAntes: cargo.semGorjeta ?? false,
        rawValorDepois: semGorjeta,
      });
    }
    const novoRecebeProd = semGorjeta ? false : recebeProducao;
    if ((cargo.recebeProducao ?? false) !== novoRecebeProd) {
      criticas.push({
        campo: "recebeProducao",
        label: "Recebe produção",
        valorAntes: cargo.recebeProducao ? "Sim" : "Não",
        valorDepois: novoRecebeProd ? "Sim" : "Não",
        rawValorAntes: cargo.recebeProducao ?? false,
        rawValorDepois: novoRecebeProd,
      });
    }
    if ((cargo.tipoVinculo ?? "registrado") !== tipoVinculo) {
      criticas.push({
        campo: "tipoVinculo",
        label: "Tipo de vínculo",
        valorAntes: TIPO_VINCULO_LABEL[cargo.tipoVinculo ?? "registrado"],
        valorDepois: TIPO_VINCULO_LABEL[tipoVinculo],
        rawValorAntes: cargo.tipoVinculo ?? "registrado",
        rawValorDepois: tipoVinculo,
      });
    }

    return { criticas, naoCriticas };
  }

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (tentaInativarComEmpregados) {
      setErr(`Não dá pra inativar — ${empregadosAtivos} empregado(s) com esse cargo. Migre eles primeiro.`);
      return;
    }
    if (!me) { setErr("Sessão inválida"); return; }
    setErr("");

    // Caso 1: cargo NOVO — addDoc imediato + audit log "criado"
    if (!cargo) {
      setSaving(true);
      try {
        const data = {
          restaurantId,
          nome: nome.trim(),
          area,
          tipoVinculo,
          pontos: semGorjeta ? 0 : pontos,
          semGorjeta,
          recebeProducao: semGorjeta ? false : recebeProducao,
          ...(batePonto !== null ? { batePonto } : {}),
          ativo,
        };
        const ref = await addDoc(collection(db, "cargos"), {
          ...data,
          ordem: 999,
          createdAt: new Date().toISOString(),
        });
        await logAudit({
          entityType: "cargo",
          entityId: ref.id,
          restaurantId,
          acao: "criado",
          registradoPor: me.id,
        });
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Caso 2: editando — separa diff entre crítico (com vigência) e não-crítico (imediato)
    const { criticas, naoCriticas } = diffAtual();

    if (criticas.length === 0) {
      // Sem mudanças críticas: aplica direto
      if (Object.keys(naoCriticas).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      try {
        await updateDoc(doc(db, "cargos", cargo.id), naoCriticas);
        await logAudit({
          entityType: "cargo",
          entityId: cargo.id,
          restaurantId,
          acao: "alterado",
          diff: Object.fromEntries(Object.entries(naoCriticas).map(([k, v]) =>
            [k, { antes: (cargo as unknown as Record<string, unknown>)[k], depois: v }]
          )),
          registradoPor: me.id,
        });
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Caso 3: tem mudanças críticas — abre VigenciaModal
    setPendingVigencia({ changes: criticas, nonVersionedUpdates: naoCriticas });
  }

  async function aplicarComVigencia(vigencia: string, motivo: string) {
    if (!cargo || !me || !pendingVigencia) return;
    // 1. Aplica não-críticos imediato
    if (Object.keys(pendingVigencia.nonVersionedUpdates).length > 0) {
      await updateDoc(doc(db, "cargos", cargo.id), pendingVigencia.nonVersionedUpdates);
    }
    // 2. Cada mudança crítica vai pelo applyVersionedChange (com a mesma vigência+motivo)
    for (const c of pendingVigencia.changes) {
      await applyVersionedChange({
        entityType: "cargo",
        entityId: cargo.id,
        restaurantId,
        campo: c.campo,
        valorAntes: c.rawValorAntes,
        valorDepois: c.rawValorDepois,
        vigenteApartir: vigencia,
        motivo,
        registradoPor: me.id,
      });
    }
  }

  async function excluir() {
    if (!cargo) return;
    if (empregadosAtivos > 0) {
      alert(`Não dá pra excluir — ${empregadosAtivos} empregado(s) com esse cargo.`);
      return;
    }
    if (!confirm(`Excluir o cargo "${cargo.nome}" PERMANENTEMENTE?\n(use Inativar pra preservar histórico)`)) return;
    await deleteDoc(doc(db, "cargos", cargo.id));
    onClose();
  }

  return (
    <Modal title={cargo ? `Editar — ${cargo.nome}` : "+ Novo cargo"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Nome do cargo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Garçom 1, Cozinheiro Líder, Freela Garçom"
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área</label>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as Area)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
            >
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tipo de vínculo</label>
            <select
              value={tipoVinculo}
              onChange={(e) => setTipoVinculo(e.target.value as TipoVinculo)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
            >
              {TIPOS_VINCULO.map(t => (
                <option key={t} value={t}>{TIPO_VINCULO_LABEL[t]}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {tipoExigePessoa
                ? "📧 Exige Pessoa vinculada (login no sistema)"
                : "🆔 Sem login — só consta na escala/gorjeta"}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-2">
            Gorjeta
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={semGorjeta}
                onChange={(e) => setSemGorjeta(e.target.checked)}
              />
              <span>Não recebe gorjeta</span>
              <span className="text-xs text-gray-400">(cobre sócios, gerência etc)</span>
            </label>
            {!semGorjeta && (
              <>
                <Input
                  label="Pontos para divisão"
                  type="number"
                  min="0" step="0.5"
                  value={String(pontos)}
                  onChange={(e) => setPontos(parseFloat(e.target.value) || 0)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={recebeProducao}
                    onChange={(e) => setRecebeProducao(e.target.checked)}
                  />
                  <span>Recebe produção</span>
                  <span className="text-xs text-gray-400">(gorjeta TODO dia, mesmo sem trabalhar — cozinha)</span>
                </label>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-2">
            Registro de ponto
          </label>
          {(() => {
            // Cargo de confiança = NÃO bate ponto (CLT Art. 62 II).
            // Checkbox marcado = é cargo de confiança = batePonto false.
            const defaultBate = defaultBatePontoPorVinculo(tipoVinculo);
            const efetivoBate = batePonto ?? defaultBate;
            const efetivoConfianca = !efetivoBate;
            return (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={efetivoConfianca}
                    onChange={(e) => setBatePonto(!e.target.checked)}
                  />
                  <span>🎩 Cargo de confiança <span className="text-xs text-gray-500">(não bate ponto)</span></span>
                  <span className="text-xs text-gray-400">
                    {batePonto === null
                      ? `(default por vínculo "${tipoVinculo}": ${defaultBate ? "bate" : "não bate"})`
                      : "(override do cargo)"}
                  </span>
                </label>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 ml-6">
                  CLT Art. 62 II: gerentes, diretores e cargos de confiança não submetidos a controle de jornada.
                  Quem não bate ponto não gera inconformidades no módulo de Registros de Ponto.
                </p>
              </>
            );
          })()}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            <span className="font-medium">Ativo</span>
          </label>
        </div>

        {trocouTipoVinculo && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
            ⚠️ <strong>Atenção:</strong> {empregadosAtivos} empregado(s) tem esse cargo.
            Mudar o tipo de vínculo pode exigir migrações (ex: criar/desvincular Pessoa).
            Verifique cada empregado depois.
          </div>
        )}

        {tentaInativarComEmpregados && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-800 dark:text-rose-300">
            🚫 <strong>Bloqueado:</strong> {empregadosAtivos} empregado(s) ativo(s) com esse cargo.
            Migre eles pra outro cargo antes de inativar.
          </div>
        )}

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
          <div>
            {cargo && (
              <Button variant="danger" size="sm" onClick={excluir} disabled={empregadosAtivos > 0}>
                Excluir permanente
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving || tentaInativarComEmpregados}>
              {saving ? "..." : "Salvar"}
            </Button>
          </div>
        </div>
      </div>

      {pendingVigencia && (
        <VigenciaModal
          titulo={`Confirmar mudança no cargo "${cargo?.nome ?? ""}"`}
          changes={pendingVigencia.changes}
          impacto={
            empregadosAtivos > 0
              ? `${empregadosAtivos} empregado(s) tem esse cargo. A mudança afeta cálculo de gorjeta a partir da data de vigência.`
              : undefined
          }
          onConfirm={async (vigencia, motivo) => {
            await aplicarComVigencia(vigencia, motivo);
            setPendingVigencia(null);
            onClose();
          }}
          onClose={() => setPendingVigencia(null)}
        />
      )}
    </Modal>
  );
}
