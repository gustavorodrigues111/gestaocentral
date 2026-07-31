import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { registrarAdmissao, registrarMudancaCargo } from "../trilha/autoEventos";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { PastaDriveEmpregado } from "./PastaDriveEmpregado";
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

  // Unidades disponíveis. Sempre há pelo menos 1 (auto-criada no boot).
  const unidadesAtivas = (restaurant?.unidades || []).filter(u => u.ativa);
  const temVariasUnidades = unidadesAtivas.length > 1;

  const [cargoId, setCargoId] = useState<string>(empregado?.cargoId || cargosAtivos[0]?.id || "");
  // batePonto: override individual sobre o cargo. undefined = herda do cargo.
  // false = é cargo de confiança (não bate ponto).
  const [batePonto, setBatePonto] = useState<boolean | null>(
    typeof empregado?.batePonto === "boolean" ? empregado.batePonto : null,
  );
  // Freela mensalista: freela (provisório) que cobre um período e entra na
  // gorjeta dos dias trabalhados. Não bate ponto — fecha pela prevista.
  const [freelaMensalista, setFreelaMensalista] = useState<boolean>(!!empregado?.freelaMensalista);
  // Auto-sugere unidade padrão: se cargo é produção, pega primeira de produção;
  // senão pega primeira de atendimento. Se rest tem só 1, usa essa.
  function sugestaoUnidade(novoCargoId: string): string {
    if (unidadesAtivas.length === 0) return "";
    if (unidadesAtivas.length === 1) return unidadesAtivas[0].id;
    const cargoEscolhido = cargosAtivos.find(c => c.id === novoCargoId);
    if (cargoEscolhido?.recebeProducao) {
      const prod = unidadesAtivas.find(u => u.tipo === "producao");
      if (prod) return prod.id;
    }
    const atend = unidadesAtivas.find(u => u.tipo === "atendimento");
    return atend?.id || unidadesAtivas[0].id;
  }
  const [unidadePadraoId, setUnidadePadraoId] = useState<string>(
    empregado?.unidadePadraoId || sugestaoUnidade(empregado?.cargoId || cargosAtivos[0]?.id || "")
  );
  const ultimoPeriodo = empregado?.periodos?.[empregado.periodos.length - 1];
  const [admissao, setAdmissao] = useState<string>(
    empregado?.admissaoAtual || ultimoPeriodo?.admissao || todayYmd()
  );
  // Fim da cobertura do freela mensalista (= demissão do período). "" = em aberto.
  const [coberturaFim, setCoberturaFim] = useState<string>(ultimoPeriodo?.demissao || "");
  const [coberturaMotivo, setCoberturaMotivo] = useState<string>(ultimoPeriodo?.motivo || "");
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
  const [vtAuxilioFixoMensal, setVtAuxilioFixoMensal] = useState<string>(
    empregado?.vtAuxilioFixoMensal ? String(empregado.vtAuxilioFixoMensal) : ""
  );
  // Default true (recebe via Caju). Só vira false se o user desmarcar.
  const [vtRecebePeloCaju, setVtRecebePeloCaju] = useState(empregado?.vtRecebePeloCaju ?? true);
  // VR — só aparece se o restaurante tem "vr" em modulosAtivos
  const usaVR = !!restaurant?.modulosAtivos?.includes("vr");
  const [vrAtivo, setVrAtivo] = useState(empregado?.vrAtivo ?? false);
  const [vrValorDiario, setVrValorDiario] = useState<string>(
    empregado?.vrValorDiario ? String(empregado.vrValorDiario) : ""
  );
  const [vrAuxilioFixoMensal, setVrAuxilioFixoMensal] = useState<string>(
    empregado?.vrAuxilioFixoMensal ? String(empregado.vrAuxilioFixoMensal) : ""
  );
  const [vrRecebePeloCaju, setVrRecebePeloCaju] = useState(empregado?.vrRecebePeloCaju ?? true);
  // Benefícios (módulo novo): VT valor diário único + forma de recebimento (Caju/Pix).
  const [vtValorDiario, setVtValorDiario] = useState<string>(
    empregado?.vtValorDiario != null ? String(empregado.vtValorDiario) : ""
  );
  const [formaBeneficio, setFormaBeneficio] = useState<"caju" | "pix">(empregado?.formaBeneficio ?? "caju");
  const [chavePix, setChavePix] = useState<string>(empregado?.chavePix ?? "");

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
    const novoAuxFixo = parseFloat(vtAuxilioFixoMensal) || 0;
    if ((empregado.vtAuxilioFixoMensal ?? 0) !== novoAuxFixo) {
      criticas.push({
        campo: "vtAuxilioFixoMensal",
        label: "Auxílio fixo mensal",
        valorAntes: `R$ ${(empregado.vtAuxilioFixoMensal ?? 0).toFixed(2)}`,
        valorDepois: `R$ ${novoAuxFixo.toFixed(2)}`,
        rawValorAntes: empregado.vtAuxilioFixoMensal ?? 0,
        rawValorDepois: novoAuxFixo,
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
    const novoUnidadePadrao = unidadePadraoId || null;
    if ((empregado.unidadePadraoId || null) !== novoUnidadePadrao) {
      nonCritical.unidadePadraoId = novoUnidadePadrao;
    }
    // batePonto: override individual sobre o cargo. null = herdar (grava null
    // no Firestore — empregadoBatePonto() só consulta se for boolean).
    if (!!empregado.freelaMensalista !== freelaMensalista) {
      nonCritical.freelaMensalista = freelaMensalista;
    }
    const batePontoAtualEmp = typeof empregado.batePonto === "boolean" ? empregado.batePonto : null;
    if (batePontoAtualEmp !== batePonto) {
      nonCritical.batePonto = batePonto;
    }
    // VR (sem versionamento por enquanto — atualiza imediato).
    if (usaVR) {
      const novoVrAtivo = !!vrAtivo;
      if ((empregado.vrAtivo ?? false) !== novoVrAtivo) {
        nonCritical.vrAtivo = novoVrAtivo;
      }
      const novoVrValor = vrAtivo ? parseFloat(vrValorDiario) : 0;
      if ((empregado.vrValorDiario ?? 0) !== novoVrValor) {
        nonCritical.vrValorDiario = novoVrValor;
      }
      const novoVrAuxFixo = parseFloat(vrAuxilioFixoMensal) || 0;
      if ((empregado.vrAuxilioFixoMensal ?? 0) !== novoVrAuxFixo) {
        nonCritical.vrAuxilioFixoMensal = novoVrAuxFixo;
      }
      const novoVrRec = !!vrRecebePeloCaju;
      if ((empregado.vrRecebePeloCaju ?? true) !== novoVrRec) {
        nonCritical.vrRecebePeloCaju = novoVrRec;
      }
    }
    // Flag vtRecebePeloCaju — só afeta o export do CSV pro Caju.
    const novoVtRec = !!vtRecebePeloCaju;
    if ((empregado.vtRecebePeloCaju ?? true) !== novoVtRec) {
      nonCritical.vtRecebePeloCaju = novoVtRec;
    }
    // Benefícios (novo): VT valor diário + forma de recebimento (Caju/Pix).
    const novoVtVd = parseFloat(vtValorDiario) || 0;
    if ((empregado.vtValorDiario ?? 0) !== novoVtVd) nonCritical.vtValorDiario = novoVtVd || null;
    if ((empregado.formaBeneficio ?? "caju") !== formaBeneficio) nonCritical.formaBeneficio = formaBeneficio;
    const novaChave = chavePix.trim();
    if ((empregado.chavePix ?? "") !== novaChave) nonCritical.chavePix = novaChave || null;
    return { criticas, nonCritical };
  }

  // Fim do período: freela mensalista fecha na data de fim da cobertura;
  // demais vínculos ficam em aberto (demissão vem pelo fluxo de inativação).
  const demissaoPeriodo = (): string | null => (freelaMensalista && coberturaFim ? coberturaFim : null);

  function buildPeriodos() {
    const now = new Date().toISOString();
    const dem = demissaoPeriodo();
    // Freela mensalista: edita a JANELA do último período (início + fim + motivo).
    if (freelaMensalista) {
      const mot = coberturaMotivo.trim() || null;
      const p = { admissao, demissao: dem, ...(mot ? { motivo: mot } : {}), registradoEm: now, registradoPor: me!.id };
      if (!empregado?.periodos?.length) return [p];
      const last = empregado.periodos[empregado.periodos.length - 1];
      if (last.admissao === admissao && (last.demissao || null) === dem && (last.motivo || "") === (mot || "")) return empregado.periodos;
      const { motivo: _drop, ...lastSemMotivo } = last;
      return [...empregado.periodos.slice(0, -1), { ...lastSemMotivo, admissao, demissao: dem, ...(mot ? { motivo: mot } : {}) }];
    }
    // ── fluxo normal ──
    const periodoNovo = { admissao, demissao: null, registradoEm: now, registradoPor: me!.id };
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
    // Unidade padrão é obrigatória sempre. Se há só 1 unidade, já vem
    // auto-preenchida; se há várias, o user precisa escolher.
    if (!unidadePadraoId) {
      setErr("Defina a unidade padrão do empregado.");
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
    if (usaVR && vrAtivo) {
      if (!vrValorDiario || parseFloat(vrValorDiario) <= 0) {
        setErr("VR ativo exige valor diário"); return;
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
          // Freela mensalista não bate ponto mesmo em cargo CLT.
          ...(freelaMensalista ? { batePonto: false } : (batePonto !== null ? { batePonto } : {})),
          ...(freelaMensalista ? { freelaMensalista: true } : {}),
          unidadePadraoId: unidadePadraoId || null,
          empCode: empCode.trim() || null,
          codigoContabil: codigoContabil.trim() || null,
          emergenciaNome: emergenciaNome.trim() || null,
          emergenciaTelefone: emergenciaTelefone.trim() || null,
          periodos: buildPeriodos(),
          // Freela mensalista segue ATIVO após o fim da cobertura (fica de
          // sobreaviso p/ próximas coberturas); a escala/gorjeta usam o período.
          estaAtivo: freelaMensalista ? true : !demissaoPeriodo(),
          admissaoAtual: (freelaMensalista || !demissaoPeriodo()) ? admissao : null,
          demitidoEm: freelaMensalista ? null : demissaoPeriodo(),
          vtAtivo: !!vtAtivo,
          ...(vtAtivo ? {
            vtPassagensPorDia: parseFloat(vtPassagensPorDia),
            vtValorPassagem: parseFloat(vtValorPassagem),
          } : {}),
          ...((parseFloat(vtAuxilioFixoMensal) || 0) > 0 ? {
            vtAuxilioFixoMensal: parseFloat(vtAuxilioFixoMensal),
          } : {}),
          // Só grava se for false (default = ausente = true = recebe via Caju)
          ...(vtRecebePeloCaju === false ? { vtRecebePeloCaju: false } : {}),
          // Benefícios (novo): valor diário + forma de recebimento
          ...((parseFloat(vtValorDiario) || 0) > 0 ? { vtValorDiario: parseFloat(vtValorDiario) } : {}),
          ...(formaBeneficio === "pix" ? { formaBeneficio: "pix" as const, ...(chavePix.trim() ? { chavePix: chavePix.trim() } : {}) } : {}),
          ...(usaVR ? {
            vrAtivo: !!vrAtivo,
            ...(vrAtivo ? { vrValorDiario: parseFloat(vrValorDiario) } : {}),
            ...((parseFloat(vrAuxilioFixoMensal) || 0) > 0 ? {
              vrAuxilioFixoMensal: parseFloat(vrAuxilioFixoMensal),
            } : {}),
            ...(vrRecebePeloCaju === false ? { vrRecebePeloCaju: false } : {}),
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
    const admissaoMudou = empregado!.admissaoAtual !== admissao;
    if (JSON.stringify(periodos) !== JSON.stringify(empregado!.periodos)) {
      nonCritical.periodos = periodos;
      const dem = demissaoPeriodo();
      // Freela mensalista segue ativo mesmo com a cobertura encerrada.
      nonCritical.admissaoAtual = (freelaMensalista || !dem) ? admissao : null;
      nonCritical.estaAtivo = freelaMensalista ? true : !dem;
      nonCritical.demitidoEm = freelaMensalista ? null : dem;
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
        // Se a admissão mudou, oferece recalcular prazos de Experiência
        // das tarefas em aberto. Só pergunta se há tarefas pra recalcular,
        // pra não jogar confirm vazio no caminho do user.
        if (admissaoMudou && empregado) {
          await oferecerRecalculoExperiencia(empregado.id, admissao, { id: me.id, nome: me.nome });
        }
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
        // Fase 7: reavalia exames do empregado pela nova área. Desativa
        // os que não se aplicam mais e cria os novos exames aplicáveis.
        try {
          const { reavaliarExamesDoEmpregado } = await import("../exames/gerador");
          const r = await reavaliarExamesDoEmpregado(
            empregado.id,
            { id: me.id, nome: me.nome || "" },
          );
          if (r.desativados > 0 || r.criados > 0) {
            console.info(`[exames] mudança de cargo: ${r.desativados} desativado(s), ${r.criados} criado(s)`);
          }
        } catch (e) {
          console.warn("[exames] falha ao reavaliar:", e);
        }
      }
      // Fase 9: registra mudança de salário na Trilha
      if (c.campo === "salario") {
        try {
          const { registrarEvento } = await import("../trilha/repository");
          await registrarEvento({
            restaurantId,
            empregadoId: empregado.id,
            empregadoNomeSnapshot: empregado.nome,
            tipo: "promocao_salarial",
            data: vigencia,
            titulo: `Promoção salarial — R$ ${c.valorAntes} → R$ ${c.valorDepois}`,
            descricao: motivo,
            metadados: {
              valorAntes: c.rawValorAntes,
              valorDepois: c.rawValorDepois,
              vigenteApartir: vigencia,
            },
            fonte: "auto",
            refOrigem: `salario:${empregado.id}:${vigencia}`,
            registradoPor: { id: me.id, nome: me.nome || "" },
          });
        } catch (e) {
          console.warn("[trilha] falha ao registrar promoção salarial:", e);
        }
      }
    }
    // Mesmo caminho com vigência: se mudou admissão (vai dentro de
    // nonVersionedUpdates.admissaoAtual), oferece recalcular Experiência.
    if (pendingVigencia.nonVersionedUpdates.admissaoAtual && me) {
      const novaAdm = pendingVigencia.nonVersionedUpdates.admissaoAtual as string;
      if (novaAdm !== empregado.admissaoAtual) {
        await oferecerRecalculoExperiencia(empregado.id, novaAdm, { id: me.id, nome: me.nome });
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
            onChange={(e) => {
              const novoCargoId = e.target.value;
              setCargoId(novoCargoId);
              // Re-sugere unidade se o cargo mudou (ex: cargo produção sugere unidade produção)
              if (!empregado?.unidadePadraoId) {
                setUnidadePadraoId(sugestaoUnidade(novoCargoId));
              }
            }}
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

        {/* Cargo de confiança — override individual. SÓ pra vínculos que batem
            ponto por padrão (CLT/estagiário). Freela/terceirizado já não bate
            ponto pela natureza do vínculo — não é "cargo de confiança". */}
        {cargo && !freelaMensalista && (cargo.tipoVinculo === "registrado" || cargo.tipoVinculo === "estagiario") && (() => {
          // CLT/estagiário batem ponto por padrão; confiança = override do cargo.
          const herdadoDoCargo = cargo.batePonto === false;
          const efetivoConfianca = batePonto === null ? herdadoDoCargo : batePonto === false;
          return (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/30">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={efetivoConfianca}
                  onChange={(e) => {
                    // Marcar = não bate (confiança). Desmarcar = bate.
                    // Se virar igual ao default do cargo, limpa pra null (herdar).
                    const novoBate = !e.target.checked;
                    const cargoDefault = !herdadoDoCargo;
                    setBatePonto(novoBate === cargoDefault ? null : novoBate);
                  }}
                />
                <span className="font-medium">🎩 Cargo de confiança</span>
                <span className="text-xs text-gray-500">(não bate ponto)</span>
              </label>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 ml-6">
                {batePonto === null
                  ? `Herda do cargo "${cargo.nome}": ${herdadoDoCargo ? "✓ é cargo de confiança" : "✗ bate ponto normalmente"}`
                  : `⚠ Override individual ativo (diferente do default do cargo)`}
              </p>
            </div>
          );
        })()}

        {/* ── Bloco Freela mensalista (cobertura provisória) ──
            Reaproveita QUALQUER cargo existente (o cargo dá pontos/área pra
            gorjeta). Marca que a pessoa cobre um PERÍODO e entra na escala +
            gorjeta só desses dias, sem bater ponto (≠ diarista, que é por turno
            no módulo Freelas). Início = Admissão; Fim = fim da cobertura. */}
        {cargo && (
          <div className="border border-violet-200 dark:border-violet-800/50 rounded-lg p-3 bg-violet-50/60 dark:bg-violet-950/20 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={freelaMensalista}
                onChange={(e) => { setFreelaMensalista(e.target.checked); if (e.target.checked) setBatePonto(false); }} />
              <span className="font-medium">🗓️ Freela mensalista (cobertura)</span>
              <span className="text-xs text-gray-500">(entra na escala e na gorjeta só no período)</span>
            </label>
            {freelaMensalista ? (
              <>
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Início da cobertura *</label>
                    <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Fim da cobertura</label>
                    <input type="date" value={coberturaFim} min={admissao || undefined} onChange={(e) => setCoberturaFim(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
                  </div>
                </div>
                <div className="pl-6">
                  <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Motivo da cobertura</label>
                  <input type="text" value={coberturaMotivo} onChange={(e) => setCoberturaMotivo(e.target.value)}
                    placeholder="ex: cobertura de férias do Fulano"
                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 pl-6">
                  Usa o cargo <strong>"{cargo.nome}"</strong> (pontos/área da gorjeta). Só entra na escala/gorjeta entre as datas. <strong>Não bate ponto</strong> — fecha pela prevista na Análise de Ponto. Segue como freela ativo após o fim.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 pl-6">
                Marque se esta pessoa é freela cobrindo um período (ex: férias de um CLT) e deve <strong>entrar na gorjeta</strong> desses dias, no cargo escolhido acima. Diarista pago por turno é no módulo <strong>Freelas</strong>.
              </p>
            )}
          </div>
        )}

        {/* Unidade padrão: só aparece se há mais de 1 unidade. Se há 1 só,
            já vem auto-preenchida e não precisa mostrar dropdown. */}
        {temVariasUnidades && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidade padrão *</label>
            <select
              value={unidadePadraoId}
              onChange={(e) => setUnidadePadraoId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
            >
              <option value="">— escolha —</option>
              {unidadesAtivas.map(u => (
                <option key={u.id} value={u.id}>
                  {u.nome} {u.tipo === "producao" ? "(Produção)" : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Onde o empregado atua na maior parte do tempo. Pode ser sobrescrito
              dia a dia nos horários (aba ao lado) ou diretamente na escala.
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

        {/* Pasta do empregado no Google Drive — criar/vincular/trocar */}
        {empregado && empregado.id && restaurant && (
          <PastaDriveEmpregado empregado={empregado} restaurant={restaurant} />
        )}

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

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-3">
          <div>
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
            {vtAtivo && (
              <div className="mt-2">
                <Input
                  label="VT — valor diário (R$) · novo Benefícios"
                  type="number" min="0" step="0.01"
                  value={vtValorDiario}
                  onChange={(e) => setVtValorDiario(e.target.value)}
                  placeholder="ex: 10,00"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Valor por dia trabalhado usado no <b>módulo novo de Benefícios</b>. Se vazio, ele usa passagens/dia × valor da passagem.
                </p>
              </div>
            )}
          </div>
          <div>
            <Input
              label="Auxílio fixo mensal (R$)"
              type="number" min="0" step="0.01"
              value={vtAuxilioFixoMensal}
              onChange={(e) => setVtAuxilioFixoMensal(e.target.value)}
              placeholder="ex: 150,00"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Valor cheio adicionado ao VT do mês (não proporcional aos dias trabalhados).
              Independente do VT diário — pode haver auxílio fixo sem passagens.
            </p>
          </div>

          {/* Flag "recebe pelo Caju" — default ON. Desmarcar exclui do CSV
              mas mantém no lote (pagamento manual). */}
          {(vtAtivo || (parseFloat(vtAuxilioFixoMensal) || 0) > 0) && (
            <label className="flex items-start gap-2 text-sm cursor-pointer py-1">
              <input
                type="checkbox"
                checked={vtRecebePeloCaju}
                onChange={(e) => setVtRecebePeloCaju(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Recebe VT pelo Caju</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  Desmarque se essa pessoa recebe por PIX direto ou outro meio.
                  Continua aparecendo no lote (você precisa pagar), mas fica fora do CSV exportado pro Caju.
                </span>
              </span>
            </label>
          )}

          {/* Forma de recebimento (módulo novo de Benefícios): Caju ou Pix. */}
          <div className="pt-1">
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Forma de recebimento (Benefícios) · Caju/Pix</label>
            <div className="flex gap-2 mt-1">
              {([["caju", "🟣 Caju"], ["pix", "⚡ Pix"]] as const).map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => setFormaBeneficio(v)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${formaBeneficio === v ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300"}`}>{lbl}</button>
              ))}
            </div>
            {formaBeneficio === "pix" && (
              <Input label="Chave Pix" value={chavePix} onChange={(e) => setChavePix(e.target.value)} placeholder="CPF, e-mail, telefone ou aleatória" />
            )}
          </div>

          {/* VR — só aparece se o restaurante tem "vr" em modulosAtivos.
              Quibebe é o caso atual. Master ativa pelo painel /admin. */}
          {usaVR && (
            <>
              <div className="border-t border-gray-200 dark:border-gray-800 pt-3 mt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={vrAtivo} onChange={(e) => setVrAtivo(e.target.checked)} />
                  <span className="font-medium">🍱 Recebe Vale Refeição</span>
                </label>
                {vrAtivo && (
                  <div className="mt-2">
                    <Input
                      label="Valor diário (R$) *"
                      type="number" min="0" step="0.01"
                      value={vrValorDiario}
                      onChange={(e) => setVrValorDiario(e.target.value)}
                      placeholder="ex: 25,00"
                    />
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                      Multiplicado pelos dias trabalhados na escala prevista do mês.
                      Falta justificada NÃO desconta (regra do VR).
                    </p>
                  </div>
                )}
              </div>
              <div>
                <Input
                  label="Auxílio fixo mensal VR (R$)"
                  type="number" min="0" step="0.01"
                  value={vrAuxilioFixoMensal}
                  onChange={(e) => setVrAuxilioFixoMensal(e.target.value)}
                  placeholder="ex: 0,00"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Valor fixo mensal de VR (não proporcional). Opcional.
                </p>
              </div>

              {(vrAtivo || (parseFloat(vrAuxilioFixoMensal) || 0) > 0) && (
                <label className="flex items-start gap-2 text-sm cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={vrRecebePeloCaju}
                    onChange={(e) => setVrRecebePeloCaju(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Recebe VR pelo Caju</span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                      Desmarque se recebe por PIX direto ou outro meio. Continua no lote,
                      mas fica fora do CSV pro Caju.
                    </span>
                  </span>
                </label>
              )}
            </>
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

// Helper local: oferece (via confirm) recalcular prazos de Experiência
// quando a admissão muda. Verifica primeiro se há tarefas em aberto pra
// não jogar um confirm vazio na cara do user (caso comum: empregado
// recém-criado ainda sem cascata gerada, ou já demitido).
async function oferecerRecalculoExperiencia(
  empregadoId: string,
  novaAdmissao: string,
  autor: { id: string; nome: string },
): Promise<void> {
  try {
    const { getDocs, query, collection, where } = await import("firebase/firestore");
    const snap = await getDocs(query(
      collection(db, "tarefas"),
      where("origemRefId", "==", empregadoId),
      where("origem", "==", "admissao"),
    ));
    // Filtra só as em aberto e que ainda apontam pra prazo diferente da
    // nova admissão (sempre seguro recalcular — função é idempotente).
    const emAberto = snap.docs.filter(d => {
      const t = d.data() as { status?: string; deletadoEm?: string | null; recorrenciaKey?: string };
      const isExp = t.recorrenciaKey?.endsWith("-exp1") || t.recorrenciaKey?.endsWith("-exp2");
      return isExp && t.status !== "concluida" && t.status !== "cancelada" && !t.deletadoEm;
    });
    if (emAberto.length === 0) return; // nada a recalcular
    const ok = confirm(
      `Você alterou a data de admissão.\n\n` +
      `Há ${emAberto.length} tarefa(s) de Experiência (1ª/2ª etapa) em aberto vinculadas a esse empregado. ` +
      `Deseja recalcular os prazos pra refletir a nova data de admissão?\n\n` +
      `(Tarefas concluídas ou canceladas não são afetadas.)`,
    );
    if (!ok) return;
    const { recalcularPrazosExperiencia } = await import("../tarefas/generator");
    const r = await recalcularPrazosExperiencia(empregadoId, novaAdmissao, autor);
    alert(`${r.afetadas} tarefa(s) atualizada(s) com os novos prazos.`);
  } catch (e) {
    console.warn("[experiencia] falha ao oferecer recálculo:", e);
  }
}
