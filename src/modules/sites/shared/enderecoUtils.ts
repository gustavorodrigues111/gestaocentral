import type { SiteConfig } from "../../../core/types";

export function enderecoTextoCompleto(end: SiteConfig["endereco"]): string {
  const partes: string[] = [];
  if (end.rua) {
    partes.push(end.numero ? `${end.rua}, ${end.numero}` : end.rua);
  }
  if (end.complemento) partes.push(end.complemento);
  if (end.bairro) partes.push(end.bairro);
  if (end.cidade) partes.push(end.uf ? `${end.cidade}/${end.uf}` : end.cidade);
  if (end.cep) partes.push(`CEP ${end.cep}`);
  return partes.join(" · ");
}

export function enderecoLinhaUm(end: SiteConfig["endereco"]): string {
  if (!end.rua) return "";
  return end.numero ? `${end.rua}, ${end.numero}` : end.rua;
}

export function enderecoLinhaDois(end: SiteConfig["endereco"]): string {
  const partes: string[] = [];
  if (end.bairro) partes.push(end.bairro);
  if (end.cidade) partes.push(end.uf ? `${end.cidade}/${end.uf}` : end.cidade);
  return partes.join(" · ");
}

// Link pro Google Maps. Prioriza URL custom; senão monta query a partir do endereço.
export function googleMapsLink(end: SiteConfig["endereco"]): string {
  if (end.googleMapsUrl) return end.googleMapsUrl;
  const query = [end.rua, end.numero, end.bairro, end.cidade, end.uf].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
