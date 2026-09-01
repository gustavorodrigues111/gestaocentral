# ════════════════════════════════════════════════════════════════════════════
#  /api/contrato-preencher — gera os contratos de trabalho (DOCX) a partir dos
#  7 modelos do escritório de advocacia, reusando a lógica da skill
#  contratos-trabalho (api/_contratos/scripts/preencher.py, stdlib puro).
#
#  POST { action: "listar" }
#     → { modelos:[{id,descricao}], empresas:{...}, cargos:{...} }  (catálogos)
#  POST { action:"gerar", modelo, dados:{empresaKey?,cargoKey?,empresa?,empregado,cargo?,contrato,...} }
#     → { docxBase64, filename }   (PDF fica pra depois — sem LibreOffice na Vercel)
#
#  Assets bundlados via vercel.json → includeFiles "api/_contratos/**".
# ════════════════════════════════════════════════════════════════════════════
import os, sys, re, json, base64, tempfile, shutil
from http.server import BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "_contratos")
sys.path.insert(0, os.path.join(BASE, "scripts"))
import preencher as P  # noqa: E402  (módulo da skill — só stdlib)

REF = os.path.join(BASE, "references")
ID_OK = re.compile(r"^[a-z0-9-]{1,50}$")


def _load(name):
    try:
        with open(os.path.join(REF, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception as e:
            return self._send(400, {"error": f"JSON inválido: {e}"})

        action = str(body.get("action") or "gerar").strip()

        # ── Catálogos + lista de modelos (pra popular a UI) ──
        if action == "listar":
            modelos = [{"id": k, "descricao": v[0]} for k, v in P.MODELOS.items()]
            return self._send(200, {
                "modelos": modelos,
                "empresas": _load("empresas.json"),
                "cargos": _load("cargos.json"),
            })

        # ── Gerar o contrato ──
        modelo = str(body.get("modelo") or "").strip()
        if not ID_OK.match(modelo) or modelo not in P.MODELOS:
            return self._send(400, {"error": f"Modelo inválido: {modelo}"})
        dados = body.get("dados") or {}
        if not isinstance(dados, dict):
            return self._send(400, {"error": "dados deve ser um objeto."})

        # Merge dos catálogos — empresaKey/cargoKey trazem o bloco pronto; os
        # campos passados explicitamente sobrescrevem (ex.: salário de 1 pessoa).
        empresas, cargos = _load("empresas.json"), _load("cargos.json")
        ek = dados.pop("empresaKey", None)
        if ek and ek in empresas:
            dados["empresa"] = {**empresas[ek], **(dados.get("empresa") or {})}
        ck = dados.pop("cargoKey", None)
        if ck and ck in cargos:
            dados["cargo"] = {**cargos[ck], **(dados.get("cargo") or {})}

        tmp = tempfile.mkdtemp()
        try:
            out_docx, _pdf = P.preencher(modelo, dados, os.path.join(tmp, "contrato"))
            with open(out_docx, "rb") as f:
                docx_bytes = f.read()
        except SystemExit as e:
            shutil.rmtree(tmp, ignore_errors=True)
            return self._send(500, {"error": f"Falha ao preencher: {e}"})
        except Exception as e:
            shutil.rmtree(tmp, ignore_errors=True)
            return self._send(500, {"error": f"Falha ao preencher: {e}"})
        shutil.rmtree(tmp, ignore_errors=True)

        alvo = (dados.get("empregado", {}) or {}).get("nome") \
            or (dados.get("contratado", {}) or {}).get("nome") or "Contrato"
        nome = re.sub(r"[^A-Za-z0-9]+", "_", alvo).strip("_") or "Contrato"
        return self._send(200, {
            "docxBase64": base64.b64encode(docx_bytes).decode("ascii"),
            "filename": f"{modelo}_{nome}.docx",
        })
