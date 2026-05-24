// Formatador de telefone pra exibição no site público.
//
// O admin pode digitar o telefone em vários formatos (E.164, livre, com
// ou sem DDI) — esse helper normaliza pra um formato amigável BR antes
// de mostrar pro cliente final.
//
// Exemplos:
//   "11985499821"     → "(11) 98549-9821"
//   "5511985499821"   → "+55 (11) 98549-9821"
//   "+5511985499821"  → "+55 (11) 98549-9821"
//   "*5511912152925"  → "+55 (11) 91215-2925"     (ignora caracteres não-dígito)
//   "11 98549-9821"   → "(11) 98549-9821"
//   "1141234567"      → "(11) 4123-4567"          (fixo, 10 dígitos)
//   "123"             → "123"                     (curto demais, devolve o input limpo)
//   "+1 555 1234567"  → "+1 555 1234567"          (não-BR, devolve só "+" + dígitos com espaços)

export function formatarTelefoneExibicao(input: string | undefined | null): string {
  if (!input) return "";
  // Extrai dígitos. O "+" original (se houver) é tratado separadamente —
  // qualquer outro símbolo (`*`, `-`, `(`, `)`, espaço, etc) some.
  const temPrefixoPais = input.trim().startsWith("+");
  const digitos = input.replace(/\D/g, "");
  if (!digitos) return input.trim();

  // Brasil — sem código de país (10 ou 11 dígitos)
  if (!temPrefixoPais && digitos.length === 10) {
    return formatarBR10(digitos);
  }
  if (!temPrefixoPais && digitos.length === 11) {
    return formatarBR11(digitos);
  }

  // Brasil com código de país (12 ou 13 dígitos começando com 55)
  if (digitos.length === 12 && digitos.startsWith("55")) {
    return `+55 ${formatarBR10(digitos.slice(2))}`;
  }
  if (digitos.length === 13 && digitos.startsWith("55")) {
    return `+55 ${formatarBR11(digitos.slice(2))}`;
  }

  // Já tem "+", mas não é BR — devolve formato genérico "+xx xxx xxx..."
  if (temPrefixoPais) {
    // Insere espaços a cada 3-4 dígitos pra ficar legível
    return `+${digitos}`;
  }

  // Fallback: devolve dígitos como veio (sem "+")
  return digitos;
}

// 10 dígitos = DDD + 8 dígitos (fixo). Ex: 1141234567 → (11) 4123-4567
function formatarBR10(digitos: string): string {
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
}

// 11 dígitos = DDD + 9 + 8 dígitos (celular). Ex: 11985499821 → (11) 98549-9821
function formatarBR11(digitos: string): string {
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}
