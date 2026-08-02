# /api/cardapio-pdf — render da filipeta do Puba (reportlab). Recebe POST com o
# estado do cardápio (JSON) e devolve { pdfBase64 }. Layout portado do
# gerar_cardapio.py (pixel-idêntico ao gabarito aprovado). Assets em _cardapio_assets/.
import os, io, json, base64
from http.server import BaseHTTPRequestHandler
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ASSET_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cardapio_assets")

PW, PH = 595.5, 842.25
BLUE = (0.1255, 0.2824, 0.8078)
ORANGE = (0.9882, 0.4627, 0.349)
BX0, BX1 = 11.1, 285.2
LBL_LINE_X0, LBL_LINE_X1 = 35.5, 37.0
TEXT_X = 48.3
PRICE_X = 268.0
DIV_X0, DIV_X1 = 12.8, 285.1
NAME_LH = 10.7
FS = 8.0
BASE_OFF = 6.1
GAP_CAP = 30.0
HDR_BOT = 126.9
LOGO_BOT = 91.2
RULE_TOP = 125.4

_fonts_done = False
def _ensure_fonts():
    global _fonts_done
    if _fonts_done: return
    pdfmetrics.registerFont(TTFont('I400', os.path.join(ASSET_DIR, 'fonts/Jost-350.ttf')))
    pdfmetrics.registerFont(TTFont('I700', os.path.join(ASSET_DIR, 'fonts/Jost-500.ttf')))
    pdfmetrics.registerFont(TTFont('Bebas', os.path.join(ASSET_DIR, 'fonts/BebasNeue.ttf')))
    _fonts_done = True

def _to_sections(pagina):
    out = []
    for sec in (pagina or []):
        itens = []
        for it in (sec.get('itens') or []):
            precos = []
            for p in (it.get('precos') or []):
                if isinstance(p, dict) and 'val' in p:
                    precos.append((str(p.get('qual', '')), str(p['val'])))
                elif isinstance(p, (list, tuple)) and len(p) == 2:
                    precos.append((str(p[0]), str(p[1])))
                else:
                    precos.append(str(p))
            tup = [str(it.get('nome', '')), str(it.get('descricao', '')), precos]
            if it.get('descW'): tup.append(it['descW'])
            itens.append(tuple(tup))
        out.append((str(sec.get('secao', '')), itens))
    return out

def wrap(c, text, font, size, maxw):
    out, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if c.stringWidth(t, font, size) <= maxw: cur = t
        else:
            if cur: out.append(cur)
            cur = w
    if cur: out.append(cur)
    return out

def item_height(c, it):
    name, desc = it[0], it[1]
    desc_w = it[3] if len(it) > 3 else 148
    nl = len(wrap(c, name, 'I700', FS, 148))
    dl = len(wrap(c, desc, 'I400', FS, desc_w)) if desc else 0
    return (nl + dl) * NAME_LH

def label_w(c, txt, size, cs):
    return c.stringWidth(txt, 'Bebas', size) + cs * (len(txt) - 1)

def split_label(c, sec, size, cs, avail):
    if label_w(c, sec, size, cs) <= avail: return [sec]
    words = sec.split()
    if len(words) == 1: return [sec]
    best, best_max = [sec], 1e9
    for i in range(1, len(words)):
        l1, l2 = " ".join(words[:i]), " ".join(words[i:])
        m = max(label_w(c, l1, size, cs), label_w(c, l2, size, cs))
        if m < best_max: best, best_max = [l1, l2], m
    return best

def draw_label(c, dx, sec, sec_top, sec_bot):
    avail = (sec_bot - sec_top) - 10
    size, cs = 9.5, 2.2
    lines = split_label(c, sec, size, cs, avail)
    while max(label_w(c, l, size, cs) for l in lines) > avail and cs > 0.5: cs -= 0.4
    mx = max(label_w(c, l, size, cs) for l in lines)
    if mx > avail: size = size * avail / mx
    mid = (sec_top + sec_bot) / 2
    caph = size * 0.72
    n = len(lines)
    band_center = 24.0 + dx
    pitch = caph + 2.5
    for li, ln in enumerate(lines):
        cx = band_center - (n - 1) * pitch / 2 + li * pitch
        w = label_w(c, ln, size, cs)
        c.saveState(); c.setFillColorRGB(*ORANGE); c.translate(cx, PH - mid); c.rotate(90)
        t = c.beginText(); t.setFont('Bebas', size); t.setCharSpace(cs); t.setTextOrigin(-w/2, -caph/2); t.textOut(ln)
        c.drawText(t); c.restoreState()

def draw_title(c, dx, dy, title_lines):
    size = 10.8; caph = size * 0.727; pitch = caph + 2.2
    total = caph + (len(title_lines) - 1) * pitch
    gap = RULE_TOP - LOGO_BOT
    caps_top = dy + LOGO_BOT + (gap - total) / 2
    c.setFillColorRGB(*BLUE); c.setFont('I700', size)
    cx = (BX0 + BX1) / 2 + dx
    for i, ln in enumerate(title_lines):
        baseline_top = caps_top + caph + i * pitch
        c.drawCentredString(cx, PH - baseline_top, ln)

def draw_copy(c, dx, dy, header_png, sections, title_lines, box_bot):
    x0, x1 = BX0 + dx, BX1 + dx
    hw = 286.0 - 10.3; hh = 125.4
    c.drawImage(header_png, 10.3 + dx, PH - (dy + hh), width=hw, height=hh)
    draw_title(c, dx, dy, title_lines)
    hdr = dy + HDR_BOT; bbot = dy + box_bot
    c.setFillColorRGB(*BLUE)
    c.rect(DIV_X0 + dx, PH - hdr, DIV_X1 - DIV_X0, 1.5, stroke=0, fill=1)
    c.setLineWidth(1.5); c.setStrokeColorRGB(*BLUE)
    c.line(x0, PH - (dy + 125.0), x0, PH - bbot)
    c.line(x1, PH - (dy + 125.0), x1, PH - bbot)
    c.line(x0 - 0.75, PH - bbot, x1 + 0.75, PH - bbot)
    c.setFillColorRGB(*BLUE)
    c.rect(LBL_LINE_X0 + dx, PH - bbot, LBL_LINE_X1 - LBL_LINE_X0, bbot - hdr, stroke=0, fill=1)
    contents = [sum(item_height(c, it) for it in items) for _, items in sections]
    counts = [len(items) for _, items in sections]
    area = bbot - hdr
    denom = max(1, sum(n + 1 for n in counts))
    gap = min(GAP_CAP, (area - sum(contents)) / denom)
    sec_heights = [contents[i] + (counts[i] + 1) * gap for i in range(len(sections))]
    leftover = area - sum(sec_heights)
    y = hdr
    for si, (sec, items) in enumerate(sections):
        sec_top = y
        sec_h = sec_heights[si] + (leftover if si == len(sections) - 1 else 0)
        block_h = contents[si] + (counts[si] - 1) * gap
        start = sec_top + (sec_h - block_h) / 2 if leftover > 0.5 else sec_top + gap
        yy = start
        for it in items:
            name, desc, prices = it[0], it[1], it[2]
            desc_w = it[3] if len(it) > 3 else 148
            nlines = wrap(c, name, 'I700', FS, 148)
            first = True; c.setFillColorRGB(*BLUE)
            for ln in nlines:
                base = PH - (yy + BASE_OFF)
                c.setFont('I700', FS); c.drawString(TEXT_X + dx, base, ln)
                if first:
                    for pi, pl in enumerate(prices):
                        py = base - pi*NAME_LH
                        if isinstance(pl, tuple):
                            qual, val = pl
                            c.setFont('I700', FS); c.drawRightString(PRICE_X + dx, py, val)
                            vw = c.stringWidth(val, 'I700', FS)
                            c.setFont('I400', 6.3); c.drawRightString(PRICE_X + dx - vw - 3.5, py, qual)
                            c.setFont('I700', FS)
                        else:
                            c.drawRightString(PRICE_X + dx, py, pl)
                    first = False
                yy += NAME_LH
            if desc:
                c.setFont('I400', FS)
                for ln in wrap(c, desc, 'I400', FS, desc_w):
                    c.drawString(TEXT_X + dx, PH - (yy + BASE_OFF), ln); yy += NAME_LH
            yy += gap
        y = sec_top + sec_h
        if si < len(sections) - 1:
            c.setFillColorRGB(*BLUE)
            c.rect(DIV_X0 + dx, PH - (y + 0.75), DIV_X1 - DIV_X0, 1.5, stroke=0, fill=1)
        draw_label(c, dx, sec, sec_top, y)

def cut_line(c, x0, y0, x1, y1):
    c.setStrokeColorRGB(0.65, 0.65, 0.65); c.setLineWidth(0.4); c.setDash(3, 3)
    c.line(x0, y0, x1, y1); c.setDash()

def render(estado):
    _ensure_fonts()
    comidas = _to_sections(estado.get('comidas'))
    bebidas = _to_sections(estado.get('bebidas'))
    vendinha = _to_sections(estado.get('vendinha'))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(PW, PH))
    Hd = lambda n: os.path.join(ASSET_DIR, 'headers', n)
    for header, secs, title in [(Hd('header_comidas_sem_titulo.png'), comidas, ["COMIDAS"]), (Hd('header_bebidas_sem_titulo.png'), bebidas, ["BEBIDAS"])]:
        if secs:
            for dx in (0.0, 297.8): draw_copy(c, dx, 0.0, header, secs, title, 822.3)
        cut_line(c, PW/2, 8, PW/2, PH-8); c.showPage()
    H3 = PH / 3
    if vendinha:
        for dx in (0.0, 297.8):
            for row in range(3):
                draw_copy(c, dx, row * H3, Hd('header_comidas_sem_titulo.png'), vendinha, ["VENDINHA", "DA NAUTA"], H3 - 14.0)
    cut_line(c, PW/2, 8, PW/2, PH-8)
    cut_line(c, 8, PH - H3, PW-8, PH - H3)
    cut_line(c, 8, PH - 2*H3, PW-8, PH - 2*H3)
    c.showPage(); c.save()
    return buf.getvalue()

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get('content-length', 0) or 0)
            estado = json.loads(self.rfile.read(n) or b'{}')
            pdf = render(estado)
            out = json.dumps({"pdfBase64": base64.b64encode(pdf).decode()}).encode()
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.end_headers()
            self.wfile.write(out)
        except Exception as e:
            out = json.dumps({"error": str(e)}).encode()
            self.send_response(500)
            self.send_header('content-type', 'application/json')
            self.end_headers()
            self.wfile.write(out)
