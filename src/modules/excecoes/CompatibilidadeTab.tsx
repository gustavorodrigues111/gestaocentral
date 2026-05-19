// ════════════════════════════════════════════════════════════════════════════
//  Aba "Compatibilidade de Cadastros" — compara os horários cadastrados na
//  Sólides com os do Planejamento e aponta divergências. Stub por enquanto.
// ════════════════════════════════════════════════════════════════════════════

type Props = {
  rid: string;
};

export function CompatibilidadeTab(_props: Props) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
      <div className="text-4xl mb-3">🚧</div>
      <p className="text-gray-700 dark:text-gray-300 font-medium">
        Compatibilidade de Cadastros — em breve
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
        Vai comparar os horários cadastrados na Sólides com os do
        Planejamento e apontar divergências (escala diferente, dias de folga
        invertidos, etc).
      </p>
    </div>
  );
}
