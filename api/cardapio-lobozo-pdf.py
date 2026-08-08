# /api/cardapio-lobozo-pdf — render do cardápio do Lobozó (reportlab). Começa com
# a folha "Almoço Executivo": filipeta A5 paisagem (2 por A4 pra corte), logo
# oficial + Poppins (título/seções, ~Cocogoose) + Ruda (texto). Colunas alinhadas
# linha a linha. Recebe POST { estado } e devolve { pdfBase64 }.
import os, io, json, base64
from http.server import BaseHTTPRequestHandler
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ASSET = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cardapio_assets")
LOGO = os.path.join(ASSET, "lobozo", "logo.png")

W = 595.5                # A4 de largura
FH = 421.125             # meia A4 (A5 paisagem) = uma filipeta
BLACK = (0.10, 0.10, 0.10)

# geometria (origem no TOPO da filipeta; T(y) converte pro reportlab, +dy p/ 2-up)
BOX_L, BOX_R = 37.0, 558.5
BOX_T, BOX_B = 82.0, 392.0
LX, RX = 76.0, 328.0     # x de texto das colunas esquerda/direita
PRICE_X = 519.0
COLW = 232.0             # largura p/ wrap dos itens
LH = 16.5                # entrelinha do item

_fonts_done = False
def _ensure_fonts():
    global _fonts_done
    if _fonts_done: return
    pdfmetrics.registerFont(TTFont("Pop",   os.path.join(ASSET, "fonts/Poppins-700.ttf")))
    pdfmetrics.registerFont(TTFont("PopH",  os.path.join(ASSET, "fonts/Poppins-900.ttf")))
    pdfmetrics.registerFont(TTFont("Ruda",  os.path.join(ASSET, "fonts/Ruda-400.ttf")))
    pdfmetrics.registerFont(TTFont("RudaB", os.path.join(ASSET, "fonts/Ruda-700.ttf")))
    _fonts_done = True

def wrap(c, text, font, size, maxw):
    out, cur = [], ""
    for w in str(text).split():
        t = (cur + " " + w).strip()
        if c.stringWidth(t, font, size) <= maxw: cur = t
        else:
            if cur: out.append(cur)
            cur = w
    if cur: out.append(cur)
    return out or [""]

def draw_veg(c, x, y_base):
    # símbolo do prato vegetariano: circulinho + folha (aproximação da marca)
    r, cy = 5.2, y_base + 3.2
    c.saveState(); c.setStrokeColorRGB(*BLACK)
    c.setLineWidth(1.0); c.circle(x + r, cy, r, stroke=1, fill=0)
    c.setLineWidth(1.2); c.line(x + r, cy + r*0.55, x + r + r*0.55, cy - r*0.2)
    c.restoreState()

def _item_nome_veg(it):
    if isinstance(it, dict): return str(it.get("nome", "")), bool(it.get("veg"))
    return str(it), False

def draw_combo(c, combo, y_top, dy):
    """Combo = faixa (titulo+preço) + régua + colunas alinhadas linha a linha.
    Retorna o y (topo, sistema top-origin) após o combo."""
    def Td(y): return (FH - y) + dy
    c.setFillColorRGB(*BLACK)
    c.setFont("Pop", 16.5); c.drawString(LX, Td(y_top), combo.get("titulo", ""))
    if combo.get("preco"):
        c.setFont("Ruda", 15.0); c.drawRightString(PRICE_X, Td(y_top), str(combo["preco"]))
    rule_y = y_top + 12.0
    c.setLineWidth(1.1); c.setStrokeColorRGB(*BLACK)
    c.line(LX, Td(rule_y), PRICE_X, Td(rule_y))

    cols = combo.get("colunas", [])
    if not cols: return rule_y + 8.0
    tem_hdr = any(col.get("titulo") for col in cols)
    y = rule_y + 26.0
    if tem_hdr:
        c.setFont("Pop", 14.5); c.setFillColorRGB(*BLACK)
        for col, cx in zip(cols, (LX, RX)):
            if col.get("titulo"): c.drawString(cx, Td(y), col["titulo"])
        y += 28.0
    else:
        y += 4.0

    nrows = max((len(col.get("itens", [])) for col in cols), default=0)
    for i in range(nrows):
        wrapped = []
        for col, cx in zip(cols, (LX, RX)):
            itens = col.get("itens", [])
            if i >= len(itens): wrapped.append((cx, False, [])); continue
            nome, veg = _item_nome_veg(itens[i])
            ln = wrap(c, nome, "Ruda", 13.5, COLW - (14 if veg else 0))
            wrapped.append((cx, veg, ln))
        rows_lines = max((len(ln) for _, _, ln in wrapped), default=1)
        c.setFillColorRGB(*BLACK)
        for cx, veg, ln in wrapped:
            yy = y
            for k, s in enumerate(ln):
                tx = cx
                if k == 0 and veg:
                    draw_veg(c, cx, Td(yy)); tx = cx + 15
                c.setFont("Ruda", 13.5); c.drawString(tx, Td(yy), s)
                yy += LH
        y += rows_lines * LH + 12.0
    return y

def draw_filipeta(c, dy, estado):
    _ensure_fonts()
    def Td(y): return (FH - y) + dy
    # logo (mantém proporção 1182x473)
    lw = 176.0; lh = lw * 473.0 / 1182.0
    c.drawImage(LOGO, 34.0, Td(10.0 + lh), width=lw, height=lh, mask="auto")
    # título à direita, centrado com a logo
    c.setFillColorRGB(*BLACK); c.setFont("Pop", 20.0)
    c.drawRightString(BOX_R, Td(51.0), estado.get("titulo", "ALMOÇO EXECUTIVO"))
    # caixa
    c.setLineWidth(1.3); c.setStrokeColorRGB(*BLACK)
    c.rect(BOX_L, Td(BOX_B), BOX_R - BOX_L, BOX_B - BOX_T, stroke=1, fill=0)
    # combos
    y = 118.0
    for combo in estado.get("combos", []):
        y = draw_combo(c, combo, y, dy) + 10.0
    # rodapé (aviso do símbolo vegetariano), auto-encolhe p/ caber na caixa
    rod = estado.get("rodape")
    if rod:
        fy = BOX_B + 15.0; tx = BOX_L + 16.0
        draw_veg(c, BOX_L, Td(fy))
        fs = 10.0
        while c.stringWidth(rod, "Ruda", fs) > (BOX_R - tx) and fs > 6.0: fs -= 0.2
        c.setFont("Ruda", fs); c.setFillColorRGB(*BLACK)
        c.drawString(tx, Td(fy), rod)

def render(estado):
    _ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, FH * 2))     # A4 retrato, 2 filipetas
    draw_filipeta(c, FH, estado)                     # de cima
    draw_filipeta(c, 0.0, estado)                    # de baixo
    c.setStrokeColorRGB(0.65, 0.65, 0.65); c.setLineWidth(0.4); c.setDash(3, 3)
    c.line(8, FH, W - 8, FH); c.setDash()            # linha de corte no meio
    c.save()
    return buf.getvalue()

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get('content-length', 0) or 0)
            estado = json.loads(self.rfile.read(n) or b'{}')
            pdf = render(estado)
            out = json.dumps({"pdfBase64": base64.b64encode(pdf).decode()}).encode()
            self.send_response(200); self.send_header('content-type', 'application/json')
            self.end_headers(); self.wfile.write(out)
        except Exception as e:
            out = json.dumps({"error": str(e)}).encode()
            self.send_response(500); self.send_header('content-type', 'application/json')
            self.end_headers(); self.wfile.write(out)
