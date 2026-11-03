// ════════════════════════════════════════════════════════════════════════════
//  /painel-update/<arquivo> — feed de AUTO-UPDATE do app Painel do Salão
//  (electron-updater). Mesma mecânica do /pdv-update: a política da org bloqueia
//  bucket público, então servimos o feed pelo próprio domínio e redirecionamos
//  (302) pros arquivos no Firebase Storage, acessíveis por TOKEN.
//
//  Arquivos (latest.yml, instaladores, blockmaps) ficam em /painel-updates/ no
//  bucket, todos com o MESMO token (SHARED_TOKEN).
//
//  Rewrite no vercel.json: /painel-update/(.*) -> /api/painel-update?file=$1
// ════════════════════════════════════════════════════════════════════════════
const BUCKET = "gestaocentral-85b13.firebasestorage.app";
const SHARED_TOKEN = "87522B2C-9534-4645-B0E0-F5348BB246C6";

type VercelReq = { query?: Record<string, string | string[] | undefined> };
type VercelRes = { status: (c: number) => VercelRes; setHeader: (k: string, v: string) => void; end: (b?: string | Buffer) => void };

export default async function handler(req: VercelReq, res: VercelRes) {
  let file = req.query?.file;
  if (Array.isArray(file)) file = file[0];
  file = (file || "").toString();
  try { file = decodeURIComponent(file); } catch { /* já estava decodificado */ }
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
    res.status(400).end("arquivo inválido");
    return;
  }
  const objeto = encodeURIComponent("painel-updates/" + file);
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${objeto}?alt=media&token=${SHARED_TOKEN}`;
  res.setHeader("Cache-Control", "no-cache");

  // Metadados pequenos (.yml/.blockmap): servir o conteúdo direto (200) — o
  // electron-updater tropeça no 302 pro Storage. Instaladores grandes: 302.
  const lower = file.toLowerCase();
  const pequeno = lower.endsWith(".yml") || lower.endsWith(".blockmap");
  if (pequeno) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader("Content-Type", lower.endsWith(".yml") ? "text/yaml; charset=utf-8" : "application/octet-stream");
        res.setHeader("Content-Length", String(buf.length));
        res.status(200).end(buf);
        return;
      }
    } catch { /* cai pro redirect abaixo */ }
  }
  res.setHeader("Location", url);
  res.status(302).end();
}
