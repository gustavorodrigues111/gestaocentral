import { useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { TIPO_VINCULO_LABEL } from "../../core/types";
import type { Cargo, Empregado, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";

type Props = {
  empregado: Empregado | null;       // null = novo
  pessoa: Pessoa | null;             // se vindo de PessoaModal
  restaurantId: string;
  cargos: Cargo[];
  onClose: () => void;
  onSaved?: (empregadoId: string) => void;
};

export function EmpregadoModal({ empregado, pessoa, restaurantId, cargos, onClose, onSaved }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !empregado;

  // Cargos ativos pra escolha
  const cargosAtivos = cargos.filter(c => c.ativo).sort((a, b) =>
    (a.area || "").localeCompare(b.area || "") || a.nome.localeCompare(b.nome)
  );

  const [cargoId, setCargoId] = useState<string>(empregado?.cargoId || cargosAtivos[0]?.id || "");
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

  const cargo = cargosAtivos.find(c => c.id === cargoId);
  const exigePessoa = cargo ? ["registrado", "estagiario"].includes(cargo.tipoVinculo) : false;
  const usaPessoa = !!pessoa;

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
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // Periodo atual (ou novo se readmissão)
      const periodoNovo = {
        admissao,
        demissao: null,
        registradoEm: now,
        registradoPor: me.id,
      };
      const periodos = empregado?.periodos
        ? // Se editando e o último período já está aberto com mesma admissao, não duplica.
          (() => {
            const last = empregado.periodos[empregado.periodos.length - 1];
            if (last && !last.demissao && last.admissao === admissao) return empregado.periodos;
            // Se adminssao mudou e último período tá aberto: substitui (caso de correção)
            if (last && !last.demissao) {
              return [...empregado.periodos.slice(0, -1), { ...last, admissao }];
            }
            return [...empregado.periodos, periodoNovo];
          })()
        : [periodoNovo];

      const data: Omit<Empregado, "id" | "createdAt" | "createdBy"> & {
        createdAt?: string;
        createdBy?: string;
      } = {
        restaurantId,
        pessoaId: pessoa?.id || empregado?.pessoaId || null,
        nome: usaPessoa ? pessoa.nome : nomeProvisorio.trim(),
        cpf: usaPessoa ? (pessoa.cpf || null) : (cpfProvisorio.trim() || null),
        cargoId,
        empCode: empCode.trim() || null,
        codigoContabil: codigoContabil.trim() || null,
        emergenciaNome: emergenciaNome.trim() || null,
        emergenciaTelefone: emergenciaTelefone.trim() || null,
        periodos,
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

      let savedId: string;
      if (isNew) {
        const ref = await addDoc(collection(db, "empregados"), {
          ...data,
          createdAt: now,
          createdBy: me.id,
        });
        savedId = ref.id;
      } else {
        await updateDoc(doc(db, "empregados", empregado.id), data);
        savedId = empregado.id;
      }
      onSaved?.(savedId);
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Vincular como empregado" : "Editar dados de empregado"} onClose={onClose} maxWidth="max-w-xl">
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

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Vincular" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
