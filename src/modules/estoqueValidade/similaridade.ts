// Detecção de produtos parecidos (evita cadastro duplicado).
// Compara nomes normalizados: sem acento, minúsculo, sem palavras de ligação e
// com plural simples removido. "Caldos de Peixe" ≈ "caldo peixe".

const LIGACAO = new Set(["de", "da", "do", "das", "dos", "e", "com", "sem", "a", "o", "em", "na", "no", "para", "p"]);

export function normalizarNome(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !LIGACAO.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Duas palavras "batem" se são iguais ou quase (erro de digitação, 1 letra a cada 5). */
function palavrasBatem(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return levenshtein(a, b) <= Math.floor(Math.max(a.length, b.length) / 5);
}

/** 0 a 1: quanto os dois nomes parecem ser o mesmo produto. */
export function similaridade(a: string, b: string): number {
  const ta = normalizarNome(a), tb = normalizarNome(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(" ") === tb.join(" ")) return 1;
  const comuns = ta.filter((x) => tb.some((y) => palavrasBatem(x, y))).length;
  const cobertura = comuns / Math.min(ta.length, tb.length);   // um nome contido no outro
  const jaccard = comuns / (ta.length + tb.length - comuns);
  const ja = ta.join(""), jb = tb.join("");
  const letras = 1 - levenshtein(ja, jb) / Math.max(ja.length, jb.length);
  return Math.max(jaccard, cobertura * 0.85, letras);
}

export function mesmoNome(a: string, b: string): boolean {
  return normalizarNome(a).join(" ") === normalizarNome(b).join(" ");
}

/** Produtos parecidos com o nome digitado, do mais parecido para o menos. */
export function parecidos<T extends { id: string; nome: string }>(nome: string, produtos: T[], ignorarId?: string, limite = 5): T[] {
  if (normalizarNome(nome).join("").length < 3) return [];
  return produtos
    .filter((p) => p.id !== ignorarId)
    .map((p) => ({ p, s: similaridade(nome, p.nome) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s)
    .slice(0, limite)
    .map((x) => x.p);
}
