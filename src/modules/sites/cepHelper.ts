// Busca endereço por CEP via ViaCEP (grátis, sem auth).
// Doc: https://viacep.com.br/

export type EnderecoViaCEP = {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export function limparCep(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function formatarCep(s: string): string {
  const d = limparCep(s).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function validarCep(s: string): boolean {
  return limparCep(s).length === 8;
}

export async function buscarCep(cep: string): Promise<EnderecoViaCEP | null> {
  const limpo = limparCep(cep);
  if (limpo.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    if (!r.ok) return null;
    const data = await r.json();
    if (data.erro) return null;
    return {
      cep: data.cep || "",
      logradouro: data.logradouro || "",
      bairro: data.bairro || "",
      cidade: data.localidade || "",
      uf: data.uf || "",
    };
  } catch {
    return null;
  }
}
