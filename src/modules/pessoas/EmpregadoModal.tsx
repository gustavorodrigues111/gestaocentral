import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { registrarAdmissao, registrarMudancaCargo } from "../trilha/autoEventos";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { VigenciaModal, type ChangedField } from "../../core/ui/VigenciaModal";
import { applyVersionedChange, logAudit } from "../../core/audit/versionedChange";
import { TIPO_VINCULO_LABEL, TIPOS_VINCULO_COM_PESSOA } from "../../core/types";
import type { Cargo, Empregado, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { HorariosTab } from "./HorariosTab";

type Props = {
  empregado: Empregado | null;       // null = novo
  pessoa: Pessoa | null;             // se vindo de PessoaModal
  restaurantId: string;
  cargos: Cargo[];
  onClose: () => void;
  onSaved?: (empregadoId: string) => void;
};

export function EmpregadoModal({ empregado: empregadoProp, pessoa, restaurantId, cargos, onClose, onSaved }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find(r => r.id === restaurantId);
  // State local pro empregado: começa = prop. Após criar, vira o empregado novo
  // pra a aba Horários ficar disponível inline (sem precisar fechar/reabrir).
  const [empregado, setEmpregado] = useState<Empregado | null>(empregadoProp);
  const isNew = !empregado;

  // Cargos ativos pra escolha
  const cargosAtivos = cargos.filter(c => c.ativo).sort((a, b) =>
    (a.area || "").localeCompare(b.area || "") || a.nome.localeCompare(b.nome)
  );

  // Unidades disponíveis (só relevante se restaurante tem multi-unidades)
  const usaMultiUnidades = !!restaurant?.multiUnidades;
  const unidadesAtivas = (restaurant?.unidades || []).filter(u => u.ativa);

  const [cargoId, setCargoId] = useState<string>(empregado?.cargoId || cargosAtivos[0]?.id || "");
  const [unidadePadraoId, setUnidadePadraoId] = useState<string>(
    empregado?.unidadePadraoId || ""
  );
  const [admissao, setAdmissao] = useState<string>(
    empregado?.admissaoAtual || todayYmd()
  );
  const [empCode, setEmpCode] = useState(empregado?.empCode || "");
  const [codigoContabil, setCodigoContabil] = useState(empregado?.codigoContabil || "");
  const [emergenciaNome, setEmergenciaNome] = useState(empregado?.emergenciaNome || "");
  const [emergenciaTelefone, setEmergenciaTelefone] = useState(empregado?.emergenciaTelefone || "");
  // Nome/CPF: se está vinculado a Pessoa, herda. Senão (provisório) aceita customizado.
  const [nomeProvisorio, setNomeProvisorio] = useState(empregado?.nome || "");
  const [cpfProvisorio, setCpfProvisorio] = useState(empregado?.cpf || "");
  // VT
  const [vtAtivo, setVtAtivo] = useState(empregado?.vtAtivo ?? false);
  const [vtPassagensPorDia, setVtPassagensPorDia] = useState<string>(
    empregado?.vtPassagensPorDia ? String(empregado.vtPassagensPorDia) : ""
  );
  const [vtValorPassagem, setVtValorPassagem] = useState<string>(
    empregado?.vtValorPassagem ? String(empregado.vtValorPassagem) : ""
  );

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"dados" | "horarios">("dados");
  const [pendingVigencia, setPendingVigencia] = useState<{
    changes: ChangedField[];
    nonVersionedUpdates: Record<string, unknown>;
  } | null>(null);

  const cargo = cargosAtivos.find(c => c.id === cargoId);
  const exigePessoa = cargo ? TIPOS_VINCULO_COM_PESSOA.includes(cargo.tipoVinculo) : false;
  const usaPessoa = !!pessoa;

  function diffCriticoEmpregado(): { criticas: ChangedField[]; nonCritical: Record<string, unknown> } {
    const criticas: ChangedField[] = [];
    const nonCritical: Record<string, unknown> = {};
    if (!empregado) return { criticas, nonCritical };

    const cargoNovoId = cargoId;
    const cargoNovoNome = cargosAtivos.find(c => c.id === cargoNovoId)?.nome || cargoNovoId;
    const cargoAntigoNome = cargosAtivos.find(c => c.id === empregado.cargoId)?.nome || empregado.cargoId;
    if (empregado.cargoId !== cargoNovoId) {
      criticas.push({
        campo: "cargoId",
        label: "Cargo",
        valorAntes: cargoAntigoNome,
        valorDepois: cargoNovoNome,
        rawValorAntes: empregado.cargoId,
        rawValorDepois: cargoNovoId,
      });
    }
    const novoVtAtivo = !!vtAtivo;
    if ((empregado.vtAtivo ?? false) !== novoVtAtivo) {
      criticas.push({
        campo: "vtAtivo",
        label: "VT ativo",
        valorAntes: empregado.vtAtivo ? "Sim" : "Não",
        valorDepois: novoVtAtivo ? "Sim" : "Não",
        rawValorAntes: empregado.vtAtivo ?? false,
        rawValorDepois: novoVtAtivo,
      });
    }
    const novoVtPassagens = vtAtivo ? parseFloat(vtPassagensPorDia) : 0;
    if (vtAtivo && (empregado.vtPassagensPorDia ?? 0) !== novoVtPassagens) {
      criticas.push({
        campo: "vtPassagensPorDia",
        label: "VT passagens/dia",
        valorAntes: String(empregado.vtPassagensPorDia ?? 0),
        valorDepois: String(novoVtPassagens),
        rawValorAntes: empregado.vtPassagensPorDia ?? 0,
        rawValorDepois: novoVtPassagens,
      });
    }
    const novoVtValor = vtAtivo ? parseFloat(vtValorPassagem) : 0;
    if (vtAtivo && (empregado.vtValorPassagem ?? 0) !== novoVtValor) {
      criticas.push({
        campo: "vtValorPassagem",
        label: "VT valor passagem",
        valorAntes: `R$ ${(empregado.vtValorPassagem ?? 0).toFixed(2)}`,
        valorDepois: `R$ ${novoVtValor.toFixed(2)}`,
        rawValorAntes: empregado.vtValorPassagem ?? 0,
        rawValorDepois: novoVtValor,
      });
    }

    // Não-versionados (aplicam imediato): nome, cpf, empCode, codigoContabil, contatos, periodos
    const novoNome = usaPessoa ? pessoa.nome : nomeProvisorio.trim();
    const novoCpf = usaPessoa ? (pessoa.cpf || null) : (cpfProvisorio.trim() || null);
    if (empregado.nome !== novoNome) nonCritical.nome = novoNome;
    if ((empregado.cpf || null) !== novoCpf) nonCritical.cpf = novoCpf;
    if ((empregado.empCode || null) !== (empCode.trim() || null)) nonCritical.empCode = empCode.trim() || null;
    if ((empregado.codigoContabil || null) !== (codigoContabil.trim() || null)) nonCritical.codigoContabil = codigoContabil.trim() || null;
    if ((empregado.emergenciaNome || null) !== (emergenciaNome.trim() || null)) nonCritical.emergenciaNome = emergenciaNome.trim() || null;
    if ((empregado.emergenciaTelefone || null) !== (emergenciaTelefone.trim() || null)) nonCritical.emergenciaTelefone = emergenciaTelefone.trim() || null;
    // Unidade padrão: não afeta cálculo retroativo (só novos lançamentos de escala)
    const novoUnidadePadrao = usaMultiUnidades ? (unidadePadraoId || null) : null;
    if ((empregado.unidadePadraoId || null) !== novoUnidadePadrao) {
      nonCritical.unidadePadraoId = novoUnidadePadrao;
    }
    return { criticas, nonCritical };
  }

  function buildPeriodos() {
    const now = new Date().toISOString();
    const periodoNovo = {
      admissao,
      demissao: null,
      registradoEm: now,
      registradoPor: me!.id,
    };
    if (!empregado?.periodos) return [periodoNovo];
    const last = empregado.periodos[empregado.periodos.length - 1];
    if (last && !last.demissao && last.admissao === admissao) return empregado.periodos;
    if (last && !last.demissao) {
      return [...empregado.periodos.slice(0, -1), { ...last, admissao }];
    }
    return [...empregado.periodos, periodoNovo];
  }

  async function salvar() {
    if (!cargoId) { setErr("Cargo obrigatório"); return; }
    if (!admissao) { setErr("Admissão obrigatória"); return; }
    if (!usaPessoa && !nomeProvisorio.trim()) {
      setErr("Nome obrigatório (empregado provisório, sem Pessoa)");
      return;
    }
    if (exigePessoa && !usaPessoa) {
      setErr("Cargo do tipo registrado/estagiário exige Pessoa vinculada (login). Use cadastro de Pessoa.");
      return;
    }
    if (vtAtivo) {
      if (!vtPassagensPorDia || parseFloat(vtPassagensPorDia) <= 0) {
        setErr("VT ativo exige passagens/dia"); return;
      }
      if (!vtValorPassagem || parseFloat(vtValorPassagem) <= 0) {
        setErr("VT ativo exige valor da passagem"); return;
      }
    }
    if (!me) return;
    setErr("");

    // Caso 1: NOVO empregado — addDoc + audit log "criado"
    if (isNew) {
      setSaving(true);
      try {
        const now = new Date().toISOString();
        const data: Omit<Empregado, "id" | "createdAt" | "createdBy"> = {
          restaurantId,
          pessoaId: pessoa?.id || null,
          nome: usaPessoa ? pessoa.nome : nomeProvisorio.trim(),
          cpf: usaPessoa ? (pessoa.cpf || null) : (cpfProvisorio.trim() || null),
          cargoId,
          unidadePadraoId: usaMultiUnidades ? (unidadePadraoId || null) : null,
          empCode: empCode.trim() || null,
          codigoContabil: codigoContabil.trim() || null,
          emergenciaNome: emergenciaNome.trim() || null,
          emergenciaTelefone: emergenciaTelefone.trim() || null,
          periodos: buildPeriodos(),
          estaAtivo: true,
          admissaoAtual: admissao,
          demitidoEm: null,
          vtAtivo: !!vtAtivo,
          ...(vtAtivo ? {
            vtPassagensPorDia: parseFloat(vtPassagensPorDia),
            vtValorPassagem: parseFloat(vtValorPassagem),
          } : {}),
          email: pessoa?.email || null,
          telefone: pessoa?.whatsapp || null,
        };
        const ref = await addDoc(collection(db, "empregados"), {
          ...data,
          createdAt: now,
          createdBy: me.id,
        });
        await logAudit({
          entityType: "empregado",
          entityId: ref.id,
          restaurantId,
          acao: "criado",
          registradoPor: me.id,
        });
        // Auto-evento de trilha: admissão
        await registrarAdmissao({
          restaurantId,
          empregadoId: ref.id,
          empregadoNome: data.nome,
          cargoNome: cargo?.nome || "(cargo)",
          area: cargo?.area || "(área)",
          admissao,
          registradoPor: me.id,
        });
        // Atualiza state local pra continuar editando (sem fechar) e pula
        // direto pra aba Horários — UX mais fluida pro user que acabou de criar.
        const novoEmpregado: Empregado = {
          id: ref.id,
          ...data,
          createdAt: now,
          createdBy: me.id,
        };
        setEmpregado(novoEmpregado);
        setTab("horarios");
        onSaved?.(ref.id);
      } catch (e) {
        console.error(e);
        setErr(e instanceof Error ? e.message : "Erro");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Caso 2: editando — separa críticos/não-críticos
    const { criticas, nonCritical } = diffCriticoEmpregado();
    // periodos sempre vai junto se admissao mudou
    const periodos = buildPeriodos();
    if (JSON.stringify(periodos) !== JSON.stringify(empregado!.periodos)) {
      nonCritical.periodos = periodos;
      nonCritical.admissaoAtual = admissao;
    }

    if (criticas.length === 0) {
      // Só não-críticos — aplica direto
      if (Object.keys(nonCritical).length === 0) { onClose(); return; }
      setSaving(true);
      try {
        await updateDoc(doc(db, "empregados", empregado!.id), nonCritical);
        await logAudit({
          entityType: "empregado",
          entityId: empregado!.id,
          restaurantId,
          acao: "alterado",
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

    // Caso 3: tem críticas — abre VigenciaModal
    setPendingVigencia({ changes: criticas, nonVersionedUpdates: nonCritical });
  }

  async function aplicarComVigencia(vigencia: string, motivo: string) {
    if (!empregado || !me || !pendingVigencia) return;
    if (Object.keys(pendingVigencia.nonVersionedUpdates).length > 0) {
      await updateDoc(doc(db, "empregados", empregado.id), pendingVigencia.nonVersionedUpdates);
    }
    for (const c of pendingVigencia.changes) {
      await applyVersionedChange({
        entityType: "empregado",
        entityId: empregado.id,
        restaurantId,
        campo: c.campo,
        valorAntes: c.rawValorAntes,
        valorDepois: c.rawValorDepois,
        vigenteApartir: vigencia,
        motivo,
        registradoPor: me.id,
      });
      // Auto-evento de trilha: mudança de cargo
      if (c.campo === "cargoId") {
        await registrarMudancaCargo({
          restaurantId,
          empregadoId: empregado.id,
          empregadoNome: empregado.nome,
          cargoAntigo: String(c.valorAntes),
          cargoNovo: String(c.valorDepois),
          vigenteApartir: vigencia,
          motivo,
          registradoPor: me.id,
        });
      }
    }
  }

  async function excluirVinculo() {
    if (!empregado || !me) return;
    const aviso = `Excluir o vínculo de empregado de "${empregado.nome}"?\n\n` +
      `⚠ Apaga o registro de empregado (workSchedules incluídos).\n` +
      `⚠ A Pessoa NÃO é apagada — só perde a relação de equipe.\n` +
      `⚠ Gorjetas/VT já pagos mantêm snapshot do nome (preservação histórica).\n` +
      `⚠ Se quiser preservar histórico de períodos, use "Demitir" em vez de excluir.`;
    if (!confirm(aviso)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "empregados", empregado.id));
      await logAudit({
        entityType: "empregado",
        entityId: empregado.id,
        restaurantId,
        acao: "excluido",
        diff: { nome: { antes: empregado.nome, depois: null } },
        motivo: "Vínculo de equipe excluído (Pessoa preservada)",
        registradoPor: me.id,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Vincular como empregado" : "Editar dados de empregado"} onClose={onClose} maxWidth="max-w-2xl">
      {/* Tabs (só aparecem se empregado já criado) */}
      {!isNew && empregado && (
        <div className="flex border-b border-gray-200 dark:border-gray-800 -mx-6 px-6 mb-4">
          <button
            type="button"
            onClick={() => setTab("dados")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "dados"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            📇 Dados
          </button>
          <button
            type="button"
            onClick={() => setTab("horarios")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "horarios"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            🕒 Horários
          </button>
        </div>
      )}

      {tab === "horarios" && empregado ? (
        <HorariosTab
          empregado={empregado}
          restaurantId={restaurantId}
          exigeValidacao={exigePessoa}
        />
      ) : (
      <div className="space-y-3">
        {/* Identidade (só pra provisório sem Pessoa) */}
        {!usaPessoa && (
          <>
            <Input
              label="Nome do empregado *"
              value={nomeProvisorio}
              onChange={(e) => setNomeProvisorio(e.target.value)}
              placeholder="ex: João Freela"
            />
            <Input
              label="CPF (opcional pra provisório)"
              value={cpfProvisorio}
              onChange={(e) => setCpfProvisorio(e.target.value)}
              placeholder="000.000.000-00"
            />
          </>
        )}
        {usaPessoa && (
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
            👤 Vinculado à Pessoa: <strong>{pessoa.nome}</strong>{pessoa.email ? ` · ${pessoa.email}` : ""}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Cargo *</label>
          <select
            value={cargoId}
            onChange={(e) => setCargoId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
          >
            <option value="">— escolha —</option>
            {cargosAtivos.map(c => (
              <option key={c.id} value={c.id}>
                {c.nome} · {c.area} ({TIPO_VINCULO_LABEL[c.tipoVinculo]})
              </option>
            ))}
          </select>
          {cargo && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {cargo.semGorjeta ? "Sem gorjeta" : `${cargo.pontos} ponto(s)${cargo.recebeProducao ? " · recebe produção" : ""}`}
            </p>
          )}
        </div>

        {usaMultiUnidades && unidadesAtivas.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidade padrão</label>
            <select
              value={unidadePadraoId}
              onChange={(e) => setUnidadePadraoId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
            >
              <option value="">— sem padrão —</option>
              {unidadesAtivas.map(u => (
                <option key={u.id} value={u.id}>
                  {u.nome} {u.tipo === "producao" ? "(Produção)" : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Ao marcar "Trabalho" na escala, vem pré-preenchido com essa unidade. Pode ser alterado dia a dia.
            </p>
          </div>
        )}

        <Input
          label="Data de admissão *"
          type="date"
          value={admissao}
          onChange={(e) => setAdmissao(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Código interno"
            value={empCode}
            onChange={(e) => setEmpCode(e.target.value)}
            placeholder="ex: SOR001"
          />
          <Input
            label="Código contábil"
            value={codigoContabil}
            onChange={(e) => setCodigoContabil(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Contato emergência"
            value={emergenciaNome}
            onChange={(e) => setEmergenciaNome(e.target.value)}
            placeholder="nome"
          />
          <Input
            label="Telefone emergência"
            value={emergenciaTelefone}
            onChange={(e) => setEmergenciaTelefone(e.target.value)}
            placeholder="(11) 99999-9999"
          />
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vtAtivo} onChange={(e) => setVtAtivo(e.target.checked)} />
            <span className="font-medium">Recebe Vale Transporte</span>
          </label>
          {vtAtivo && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <Input
                label="Passagens/dia *"
                type="number" min="0" step="1"
                value={vtPassagensPorDia}
                onChange={(e) => setVtPassagensPorDia(e.target.value)}
                placeholder="ex: 2"
              />
              <Input
                label="Valor passagem (R$) *"
                type="number" min="0" step="0.01"
                value={vtValorPassagem}
                onChange={(e) => setVtValorPassagem(e.target.value)}
                placeholder="ex: 5.00"
              />
            </div>
          )}
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-between items-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <div>
            {!isNew && empregado && (
              <Button variant="danger" size="sm" onClick={excluirVinculo} disabled={saving}>
                🗑 Excluir vínculo
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Vincular" : "Salvar"}</Button>
          </div>
        </div>
      </div>
      )}

      {pendingVigencia && (
        <VigenciaModal
          titulo={`Confirmar mudança em "${empregado?.nome ?? ""}"`}
          changes={pendingVigencia.changes}
          impacto="A mudança afeta cálculo de gorjeta e VT a partir da data de vigência."
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
