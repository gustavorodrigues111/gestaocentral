import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { LeadEvento, Pessoa } from "../../core/types";

type Fechamento = NonNullable<LeadEvento["fechamento"]>;

type Props = {
  lead: LeadEvento;
  pessoasComerciaisIds: string[];   // do restaurant.eventosConfig
  pessoas: Pessoa[];                // já carregado pelo pai
  precoSugerido?: number;           // pré-preencher faturamento bruto (precoTotal da última proposta)
  onClose: () => void;
  onConfirm: (fechamento: Fechamento) => Promise<void>;
};

// Modal "Fechar evento" — abre ao mover lead pra coluna "realizado".
// Captura dados pra apuração futura de comissão por vendedor.
export function FecharEventoModal({
  lead, pessoasComerciaisIds, pessoas, precoSugerido, onClose, onConfirm,
}: Props) {
  const fechExistente = lead.fechamento;
  const [faturamento, setFaturamento] = useState<string>(
    fechExistente
      ? String(fechExistente.faturamentoBrutoSemGorjeta)
      : (precoSugerido && precoSugerido > 0 ? String(precoSugerido) : ""),
  );
  const [classificacao, setClassificacao] = useState<"inbound" | "outbound" | "">(
    fechExistente?.classificacao || "",
  );
  const [captacaoAtiva, setCaptacaoAtiva] = useState<boolean | null>(
    fechExistente ? fechExistente.captacaoAtiva.ativo : null,
  );
  const [captadoPorId, setCaptadoPorId] = useState<string>(
    fechExistente?.captacaoAtiva.pessoaId || "",
  );
  const [negociadoPorId, setNegociadoPorId] = useState<string>(
    fechExistente?.negociacaoPor.pessoaId || "",
  );
  const [acompAtivo, setAcompAtivo] = useState<boolean | null>(
    fechExistente ? fechExistente.acompanhamentoPresencial.ativo : null,
  );
  const [acompPorId, setAcompPorId] = useState<string>(
    fechExistente?.acompanhamentoPresencial.pessoaId || "",
  );

  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  // Lista de pessoas comerciais (filtradas + ordenadas) pros pickers.
  const pessoasComerciais = useMemo(() => {
    const setIds = new Set(pessoasComerciaisIds);
    return pessoas
      .filter(p => setIds.has(p.id))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [pessoas, pessoasComerciaisIds]);

  const semPessoasConfiguradas = pessoasComerciais.length === 0;

  function pessoaNome(id: string): string {
    return pessoas.find(p => p.id === id)?.nome || "";
  }

  async function confirmar() {
    setErro("");

    const fatNum = parseFloat(String(faturamento).replace(",", "."));
    if (!Number.isFinite(fatNum) || fatNum <= 0) {
      setErro("Faturamento bruto deve ser maior que zero.");
      return;
    }
    if (classificacao !== "inbound" && classificacao !== "outbound") {
      setErro("Selecione a classificação (inbound ou outbound).");
      return;
    }
    if (captacaoAtiva === null) {
      setErro("Indique se houve captação ativa.");
      return;
    }
    if (captacaoAtiva && !captadoPorId) {
      setErro("Selecione quem fez a captação.");
      return;
    }
    if (!negociadoPorId) {
      setErro("Selecione quem negociou e fechou.");
      return;
    }
    if (acompAtivo === null) {
      setErro("Indique se houve acompanhamento presencial.");
      return;
    }
    if (acompAtivo && !acompPorId) {
      setErro("Selecione quem acompanhou.");
      return;
    }

    const fechamento: Fechamento = {
      faturamentoBrutoSemGorjeta: fatNum,
      classificacao,
      captacaoAtiva: captacaoAtiva
        ? { ativo: true, pessoaId: captadoPorId, pessoaNome: pessoaNome(captadoPorId) }
        : { ativo: false },
      negociacaoPor: { pessoaId: negociadoPorId, pessoaNome: pessoaNome(negociadoPorId) },
      acompanhamentoPresencial: acompAtivo
        ? { ativo: true, pessoaId: acompPorId, pessoaNome: pessoaNome(acompPorId) }
        : { ativo: false },
      fechadoEm: fechExistente?.fechadoEm || new Date().toISOString(),
      fechadoPor: fechExistente?.fechadoPor || "",
      fechadoPorNome: fechExistente?.fechadoPorNome,
    };

    setSaving(true);
    try {
      await onConfirm(fechamento);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar fechamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`✓ Fechar evento — ${lead.cliente.nome}`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {semPessoasConfiguradas && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200">
            ⚠ Nenhuma pessoa comercial configurada. Vá em <strong>Eventos → Comercial</strong> e
            selecione quem pode aparecer aqui.
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Esses dados ficam gravados pra apuração de comissão por vendedor.
          Você pode editar depois pelo card do lead.
        </p>

        {/* Faturamento */}
        <div>
          <Input
            label="Faturamento bruto sem gorjeta (R$) *"
            type="number"
            step="0.01"
            min="0"
            value={faturamento}
            onChange={(e) => setFaturamento(e.target.value)}
            placeholder="0,00"
          />
          {precoSugerido && precoSugerido > 0 && !fechExistente && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Pré-preenchido com o total da última proposta (R$ {precoSugerido.toFixed(2)}).
              Ajuste se o valor faturado foi diferente.
            </p>
          )}
        </div>

        {/* Classificação */}
        <div>
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
            Classificação *
          </div>
          <div className="flex gap-2">
            <RadioPill
              checked={classificacao === "inbound"}
              onClick={() => setClassificacao("inbound")}
              label="Inbound"
              hint="cliente procurou a gente"
            />
            <RadioPill
              checked={classificacao === "outbound"}
              onClick={() => setClassificacao("outbound")}
              label="Outbound"
              hint="a gente foi atrás"
            />
          </div>
        </div>

        {/* Captação ativa */}
        <div>
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
            Houve captação ativa? *
          </div>
          <div className="flex gap-2">
            <RadioPill checked={captacaoAtiva === true} onClick={() => setCaptacaoAtiva(true)} label="Sim" />
            <RadioPill checked={captacaoAtiva === false} onClick={() => { setCaptacaoAtiva(false); setCaptadoPorId(""); }} label="Não" />
          </div>
          {captacaoAtiva && (
            <div className="mt-2">
              <PessoaSelect
                label="Captado por *"
                value={captadoPorId}
                onChange={setCaptadoPorId}
                pessoas={pessoasComerciais}
              />
            </div>
          )}
        </div>

        {/* Negociação */}
        <div>
          <PessoaSelect
            label="Negociação e fechamento por *"
            value={negociadoPorId}
            onChange={setNegociadoPorId}
            pessoas={pessoasComerciais}
          />
        </div>

        {/* Acompanhamento presencial */}
        <div>
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
            Houve acompanhamento presencial no evento? *
          </div>
          <div className="flex gap-2">
            <RadioPill checked={acompAtivo === true} onClick={() => setAcompAtivo(true)} label="Sim" />
            <RadioPill checked={acompAtivo === false} onClick={() => { setAcompAtivo(false); setAcompPorId(""); }} label="Não" />
          </div>
          {acompAtivo && (
            <div className="mt-2">
              <PessoaSelect
                label="Acompanhado por *"
                value={acompPorId}
                onChange={setAcompPorId}
                pessoas={pessoasComerciais}
              />
            </div>
          )}
        </div>

        {erro && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-2.5 text-sm text-rose-800 dark:text-rose-300">
            ⚠ {erro}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={saving || semPessoasConfiguradas}>
            {saving ? "Salvando..." : "Confirmar e fechar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RadioPill({
  checked, onClick, label, hint,
}: { checked: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
        checked
          ? "bg-indigo-100 border-indigo-400 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-600 dark:text-indigo-200"
          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
      }`}
    >
      <div>{label}</div>
      {hint && <div className="text-[10px] text-gray-500 dark:text-gray-400 font-normal mt-0.5">{hint}</div>}
    </button>
  );
}

function PessoaSelect({
  label, value, onChange, pessoas,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  pessoas: { id: string; nome: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
      >
        <option value="">— selecione —</option>
        {pessoas.map(p => (
          <option key={p.id} value={p.id}>{p.nome}</option>
        ))}
      </select>
    </div>
  );
}
