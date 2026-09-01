#!/usr/bin/env python3
"""
Preenche os modelos de contrato/aditivo do escritório de advocacia com os dados
do empregado, da empresa e do cargo, sem alterar a formatação do .docx.

Uso:
    python preencher.py --modelo contrato-hibrido --dados dados.json --saida /mnt/user-data/outputs/Contrato_X
    python preencher.py --listar-modelos
    python preencher.py --variaveis contrato-hibrido      # mostra as variáveis que o modelo usa

Gera <saida>.docx e <saida>.pdf (o PDF via LibreOffice, se disponível).

O JSON de dados tem quatro blocos (ver references/variaveis.md):
    {"empresa": {...}, "empregado": {...}, "cargo": {...}, "contrato": {...}}
Para o contrato de autônomo, use os blocos "empresa", "contratado" e "autonomo".
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, zipfile, html
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, "..", "assets", "templates")

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]

# ----------------------------------------------------------------------------
# utilidades de texto
# ----------------------------------------------------------------------------

def data_br(iso):
    """'2026-09-01' -> '01/09/2026'"""
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


def data_extenso(iso):
    """'2026-09-01' -> '01 de setembro de 2026'"""
    y, m, d = iso.split("-")
    return f"{d} de {MESES[int(m) - 1]} de {y}"


def soma_dias(iso, n):
    y, m, d = map(int, iso.split("-"))
    return (date(y, m, d) + timedelta(days=n)).isoformat()


_UNI = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
        "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
        "dezessete", "dezoito", "dezenove"]
_DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta",
        "oitenta", "noventa"]
_CEN = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
        "seiscentos", "setecentos", "oitocentos", "novecentos"]


def _ate_999(n):
    if n == 0:
        return ""
    if n == 100:
        return "cem"
    c, r = divmod(n, 100)
    d, u = divmod(r, 10)
    partes = []
    if c:
        partes.append(_CEN[c])
    if r:
        if r < 20:
            partes.append(_UNI[r])
        else:
            partes.append(_DEZ[d] + (f" e {_UNI[u]}" if u else ""))
    return " e ".join(partes)


def extenso(valor):
    """3350.0 -> 'três mil, trezentos e cinquenta reais'"""
    valor = round(float(valor), 2)
    inteiro = int(valor)
    cent = int(round((valor - inteiro) * 100))
    if inteiro == 0:
        txt = "zero reais"
    else:
        grupos = []
        milhoes, resto = divmod(inteiro, 1_000_000)
        milhares, unidades = divmod(resto, 1000)
        if milhoes:
            grupos.append(("um milhão" if milhoes == 1 else _ate_999(milhoes) + " milhões"))
        if milhares:
            grupos.append(("mil" if milhares == 1 else _ate_999(milhares) + " mil"))
        if unidades:
            grupos.append(_ate_999(unidades))
        # junta com vírgula/e: último grupo com "e" se for < 100 ou múltiplo de 100
        if len(grupos) == 1:
            txt = grupos[0]
        else:
            ult = grupos[-1]
            sep = " e " if (unidades and (unidades < 100 or unidades % 100 == 0)) else ", "
            txt = ", ".join(grupos[:-1]) + sep + ult
        txt += " real" if inteiro == 1 else " reais"
    if cent:
        txt += f" e {_ate_999(cent)} centavo" + ("s" if cent > 1 else "")
    return txt


def moeda(valor):
    """3350 -> 'R$ 3.350,00'"""
    v = f"{float(valor):,.2f}"
    return "R$ " + v.replace(",", "X").replace(".", ",").replace("X", ".")


# ----------------------------------------------------------------------------
# manipulação do document.xml
# ----------------------------------------------------------------------------

# runs vazios (sem <w:t>) que o LibreOffice deixa em parágrafos em branco
VAZIO = r"(?:<w:r>(?:<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)?</w:r>)*"

RPR_BASE = ('<w:rFonts w:ascii="Bookman Old Style" w:hAnsi="Bookman Old Style"/>'
            '<w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/>')


def esc(s):
    return html.escape(s, quote=False)


def paragrafos(xml):
    return list(re.finditer(r"<w:p[ >](?:(?!</w:p>).)*?</w:p>", xml, re.S))


def texto_par(par):
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", par))


def limpar_rpr(rpr):
    rpr = re.sub(r"<w:highlight[^/]*/>|<w:b/>|<w:bCs/>|<w:u [^/]*/>|<w:i/>|<w:iCs/>", "", rpr)
    rpr = rpr.replace('<w:color w:val="FF0000"/>', '<w:color w:val="000000"/>')
    return rpr


def montar_runs(par, segmentos):
    """segmentos: lista de str ou (str, bold). Usa o rPr do primeiro run do parágrafo."""
    m = re.search(r"<w:r>(?:<w:rPr>(.*?)</w:rPr>)?", par, re.S)
    rpr = limpar_rpr(m.group(1)) if (m and m.group(1)) else RPR_BASE
    runs = ""
    for seg in segmentos:
        if isinstance(seg, str):
            seg = (seg, False)
        t, b = seg
        r = rpr
        if b:
            r = r.replace("<w:color", "<w:b/><w:color", 1) if "<w:color" in r else "<w:b/>" + r
        runs += f'<w:r><w:rPr>{r}</w:rPr><w:t xml:space="preserve">{esc(t)}</w:t></w:r>'
    return runs


def reconstruir(par, segmentos):
    if "</w:pPr>" in par:
        head = par[: par.index("</w:pPr>") + len("</w:pPr>")]
    else:
        head = par[: par.index(">") + 1]
    return head + montar_runs(par, segmentos) + "</w:p>"


class Doc:
    def __init__(self, xml):
        self.xml = xml

    # -- localizar -----------------------------------------------------------
    def _achar(self, anchor, exato=False, indice=0):
        """indice=-1 pega a última ocorrência (útil para blocos de assinatura)."""
        hits = []
        for m in paragrafos(self.xml):
            t = texto_par(m.group(0))
            ok = (t.strip() == anchor) if exato else (anchor in t)
            if ok:
                hits.append(m)
        if not hits or (indice >= 0 and len(hits) <= indice):
            raise KeyError(f"âncora não encontrada: {anchor!r} (ocorrência {indice})")
        return hits[indice]

    # -- operações -----------------------------------------------------------
    def substituir(self, anchor, segmentos, exato=False, indice=0):
        m = self._achar(anchor, exato, indice)
        self.xml = self.xml[: m.start()] + reconstruir(m.group(0), segmentos) + self.xml[m.end():]

    def apagar(self, anchor, exato=False, indice=0):
        try:
            m = self._achar(anchor, exato, indice)
        except KeyError:
            return
        self.xml = self.xml[: m.start()] + self.xml[m.end():]

    def limpar_destaque(self, anchor):
        """Remove realce amarelo / vermelho de um parágrafo que fica no documento."""
        try:
            m = self._achar(anchor)
        except KeyError:
            return
        par = m.group(0)
        novo = re.sub(r"<w:highlight[^/]*/>", "", par).replace('<w:color w:val="FF0000"/>', '<w:color w:val="000000"/>')
        self.xml = self.xml[: m.start()] + novo + self.xml[m.end():]

    def preencher_celula_seguinte(self, anchor, texto):
        """Escreve no primeiro parágrafo da célula que vem depois da célula com `anchor`."""
        m = self._achar(anchor)
        depois = self.xml[m.end():]
        c = re.search(r"</w:tc>\s*<w:tc>.*?(<w:p[ >][^>]*>?(?:<w:pPr>.*?</w:pPr>)?" + VAZIO + r")(</w:p>)", depois, re.S)
        if not c:
            raise KeyError(f"célula seguinte a {anchor!r} não encontrada")
        run = f'<w:r><w:rPr>{RPR_BASE}</w:rPr><w:t xml:space="preserve">{esc(texto)}</w:t></w:r>'
        depois = depois[: c.start(2)] + run + depois[c.start(2):]
        self.xml = self.xml[: m.end()] + depois

    def apos_rotulo(self, rotulo, texto):
        """Último parágrafo cujo texto é exatamente `rotulo` (ex.: EMPREGADORA): escreve `texto` no parágrafo vazio seguinte."""
        m = self._achar(rotulo, exato=True, indice=-1)
        depois = self.xml[m.end():]
        c = re.match(r"\s*(<w:p[ >][^>]*>?(?:<w:pPr>.*?</w:pPr>)?" + VAZIO + r")(</w:p>)", depois, re.S)
        if not c:
            # não há parágrafo vazio: acrescenta ao próprio rótulo
            self.substituir(rotulo, [(rotulo, True), (": " + texto, False)], exato=True, indice=-1)
            return
        run = f'<w:r><w:rPr>{RPR_BASE}</w:rPr><w:t xml:space="preserve">{esc(texto)}</w:t></w:r>'
        depois = depois[: c.end(1)] + run + depois[c.end(1):]
        self.xml = self.xml[: m.end()] + depois

    def remover_comentarios(self):
        self.xml = re.sub(r'<w:commentRangeStart w:id="\d+"/>', "", self.xml)
        self.xml = re.sub(r'<w:commentRangeEnd w:id="\d+"/>', "", self.xml)
        self.xml = re.sub(r'<w:r>(?:(?!</w:r>).)*?<w:commentReference w:id="\d+"/></w:r>', "", self.xml)


# ----------------------------------------------------------------------------
# montagem dos textos a partir dos dados
# ----------------------------------------------------------------------------

def g(d, *ks, default=""):
    for k in ks:
        if not isinstance(d, dict) or k not in d or d[k] in (None, ""):
            return default
        d = d[k]
    return d


def seg_empregado(e):
    """Linha de qualificação do empregado no quadro sintético."""
    docs = [f"CPF nº {e['cpf']}"]
    if e.get("rg"):
        docs.append(f"RG nº {e['rg']}")
    if e.get("ctps"):
        docs.append(f"CTPS nº {e['ctps']}")
    docs_txt = ", ".join(docs[:-1]) + (" e " if len(docs) > 1 else "") + docs[-1]
    return [(e["nome"].upper(), True),
            (f", portador(a) do {docs_txt}, residente e domiciliado(a) na {e['endereco']}, "
             f"doravante denominado(a) simplesmente “", False),
            ("EMPREGADO(A)", True), ("”,", False)]


def seg_empresa(emp):
    return [(emp["nome"].upper(), True),
            (f", estabelecida na {emp['endereco']}, inscrita no CNPJ sob nº {emp['cnpj']}, "
             f"neste ato denominada simplesmente “", False),
            ("EMPREGADORA", True), ("”", False)]


def txt_remuneracao(c):
    if c.get("remuneracao_texto"):
        return c["remuneracao_texto"]
    sal = float(c["salario"])
    t = f"Salário mensal de {moeda(sal)} ({extenso(sal)})"
    dia = c.get("dia_pagamento", "5º (quinto) dia útil")
    t += f", pago até o {dia} do mês subsequente ao trabalhado, mediante depósito em conta bancária de titularidade do(a) EMPREGADO(A)"
    if c.get("gorjeta_texto"):
        t += ". " + c["gorjeta_texto"].rstrip(".")
    if c.get("remuneracao_complemento"):
        t += ". " + c["remuneracao_complemento"].rstrip(".")
    return t + "."


def txt_descricao(c):
    d = c.get("descricao")
    if isinstance(d, list):
        d = "; ".join(x.rstrip(".;") for x in d) + "."
    return "- " + d


def txt_vigencia(ct):
    if ct.get("vigencia_texto"):
        return ct["vigencia_texto"]
    ini = ct["data_inicio"]
    exp = int(ct.get("experiencia_dias", 45))
    pro = int(ct.get("prorrogacao_dias", 45))
    fim1 = soma_dias(ini, exp - 1)
    t = (f"O presente contrato vigora a título de experiência, com início em {data_br(ini)}, "
         f"pelo período de {exp} ({extenso(exp).replace(' reais', '').replace(' real', '')}) dias, vencendo em {data_br(fim1)}.")
    if pro:
        fim2 = soma_dias(ini, exp + pro - 1)
        t += (f" Caso o presente não seja extinto em seu termo final, estará automaticamente prorrogado por mais "
              f"{pro} ({extenso(pro).replace(' reais', '').replace(' real', '')}) dias, até {data_br(fim2)}, totalizando o máximo de "
              f"{exp + pro} dias permitido por lei, e não sendo extinto no prazo final, passará a viger por prazo "
              f"indeterminado, nos termos do art. 443 da CLT.")
    else:
        t += " Não sendo extinto no prazo final, passará a viger por prazo indeterminado, nos termos do art. 443 da CLT."
    return t


def txt_horario(c):
    h = c["horario"]
    if c.get("regime") == "hibrido" and not c.get("horario_inclui_regime"):
        h = h.rstrip(".") + (". As atividades serão prestadas em regime híbrido, alternando trabalho presencial "
                             "no estabelecimento da EMPREGADORA e teletrabalho (home office) na residência do(a) "
                             "EMPREGADO(A), nos dias definidos pela EMPREGADORA, com controle de jornada em ambas as "
                             "modalidades, nos termos dos arts. 75-A a 75-F da CLT.")
    return h


def txt_ajuda_custo(c):
    v = float(c.get("ajuda_custo_home_office", 100))
    return (f"Ajusta-se a quantia de {moeda(v)} por mês a título indenizatório pelos insumos de aumento de consumo "
            f"de água, luz e internet decorrentes do home office ajustados neste instrumento.")


def txt_contato(e):
    partes = []
    if e.get("email"):
        partes.append(e["email"])
    if e.get("whatsapp"):
        partes.append("WhatsApp " + e["whatsapp"])
    return " / ".join(partes)


def txt_data(ct):
    return f"{ct.get('cidade', 'São Paulo')}, {data_extenso(ct['data_assinatura'])}."


# ----------------------------------------------------------------------------
# regras de preenchimento por modelo
# ----------------------------------------------------------------------------

def preencher_clt(doc, d, modelo):
    emp, e, c, ct = d["empresa"], d["empregado"], d["cargo"], d["contrato"]

    # qualificação das partes
    if modelo in ("contrato-padrao",):
        doc.substituir("Indicado(a) na assinatura deste instrumento", seg_empregado(e))
    else:
        doc.substituir("portador(a) do CPF No.", seg_empregado(e))
    doc.substituir("inscrita no CNPJ (", seg_empresa(emp))

    # quadro sintético
    doc.substituir("nomenclatura da função", [c["funcao"].upper() + (f" (CBO {c['cbo']})" if c.get("cbo") else "")])
    doc.substituir("Informação sobre salário básico", [txt_remuneracao(c)])
    if modelo == "contrato-hibrido":
        doc.substituir("HOME OFFICE / TELETRABALHO", [(c.get("titulo_regime", "TELETRABALHO EM REGIME HÍBRIDO"), True)])
        doc.substituir("Contratado nos moldes do Artigo 62", [txt_horario(c)])
        doc.substituir("Ajusta-se a quantia de R$", [txt_ajuda_custo(c)])
    elif modelo == "contrato-atividade-externa":
        pass  # mantém "Artigo 62, inciso I" — é a essência do modelo
    else:
        doc.substituir("08:00 às 12:00 e das 13:00 às 17:48", [txt_horario(c)])
    doc.substituir("descrever os trabalhos que serão executados", [txt_descricao(c)])
    doc.limpar_destaque("nclusive todas as demais atividades")
    if modelo == "contrato-prazo-determinado":
        doc.substituir("(.....)", [ct.get("vigencia_texto") or txt_vigencia(ct)], exato=True)
    else:
        doc.substituir("O período de vigência deste contrato é de 45 dias", [txt_vigencia(ct)])
    doc.preencher_celula_seguinte("para contato/assinatura", txt_contato(e))

    # Plano de saúde: o grupo NÃO trabalha com plano de saúde em NENHUMA hipótese —
    # a cláusula 1.1.4 é SEMPRE removida e as seguintes renumeradas.
    if True:
        try:
            m = doc._achar("não terá direito ao benefício do convênio/plano de saúde")
            doc.xml = doc.xml[: m.start()] + doc.xml[m.end():]
            def _renum(mm):
                n = int(mm.group(2))
                return mm.group(1) + (f"1.1.{n - 1})" if n > 4 else f"1.1.{n})")
            doc.xml = re.sub(r"(<w:t[^>]*>)1\.1\.(\d+)\)", _renum, doc.xml)
        except KeyError:
            pass

    # data e assinaturas
    if modelo == "contrato-padrao":
        doc.substituir("Data: (", [txt_data(ct)])
        doc.apagar("Se for assinatura digital, retirar este texto")
        doc.substituir("EMPREGADORA: Indicada na qualificação", [("EMPREGADORA: ", True), (emp["nome"].upper(), False)])
        doc.substituir("EMPREGADO: Indicada na qualificação", [("EMPREGADO(A): ", True), (e["nome"].upper(), False)])
    else:
        doc.substituir(") de 20(", [txt_data(ct)])
        doc.apos_rotulo("EMPREGADORA", emp["nome"].upper())
        doc.apos_rotulo("EMPREGADO", e["nome"].upper())


def preencher_aditivo_confidencialidade(doc, d):
    emp, e, ct = d["empresa"], d["empregado"], d["contrato"]
    doc.substituir("portador(a) do CPF No.", seg_empregado(e))
    doc.substituir("inscrita no CNPJ (", seg_empresa(emp))
    doc.preencher_celula_seguinte("para contato/assinatura", txt_contato(e))
    doc.substituir(") de 20(", [txt_data(ct)])
    doc.apos_rotulo("EMPREGADORA", emp["nome"].upper())
    doc.apos_rotulo("EMPREGADO", e["nome"].upper())


def preencher_aditivo_hibrido(doc, d):
    emp, e, c, ct = d["empresa"], d["empregado"], d["cargo"], d.get("contrato", {})
    doc.substituir("Indicado(a) na assinatura deste instrumento", seg_empregado(e))
    doc.substituir("inscrita no CNPJ (", seg_empresa(emp))
    doc.substituir("(.....)", [c["presencial_dias_horarios"]], exato=True, indice=0)
    doc.substituir("(.....)", [c["home_office_dias_horarios"]], exato=True, indice=0)
    doc.substituir("Ajusta-se a quantia de R$", [txt_ajuda_custo(c)])
    doc.preencher_celula_seguinte("para contato/assinatura", txt_contato(e))
    if ct.get("data_assinatura"):
        doc.substituir("DATA: O presente termo passa a vigorar", [("DATA: ", True), (f"{txt_data(ct)} O presente termo passa a vigorar a partir desta data.", False)])
    doc.substituir("EMPREGADORA: Indicado(a) na qualificação", [("EMPREGADORA: ", True), (emp["nome"].upper(), False)])
    doc.substituir("EMPREGADO: Indicado(a) na assinatura", [("EMPREGADO(A): ", True), (e["nome"].upper(), False)])


def preencher_autonomo(doc, d):
    emp, c, a = d["empresa"], d["contratado"], d["autonomo"]
    doc.substituir("representada neste ato por", [
        (c["nome"].upper(), True),
        (f", CPF nº {c['cpf']}" + (f", RG nº {c['rg']}" if c.get("rg") else "") + f", com endereço na {c['endereco']}", False)])
    doc.substituir("inscrita no CNPJ nº", [
        (emp["nome"].upper(), True),
        (f", inscrita no CNPJ nº {emp['cnpj']}, situada na {emp['endereco']}, neste ato representada nos moldes de seu contrato social.", False)])
    ativ = a["atividades"] if isinstance(a["atividades"], list) else [a["atividades"]]
    doc.substituir("descrever todas as atividades", [ativ[0]])
    for i in range(1, 4):
        if i < len(ativ):
            doc.substituir("(....)", [ativ[i]], exato=True)
        else:
            doc.apagar("(....)", exato=True)
    val = float(a["valor_mensal"])
    doc.substituir("mensais fixos, depositados", [f"{moeda(val)} ({extenso(val)}) mensais fixos, depositados na seguinte conta bancária:"])
    doc.substituir("(......)", [a.get("dados_bancarios", "")], exato=True)
    doc.substituir("até o (....)º dia do mês", [f"Mediante apresentação de RPA que deve ser enviada ao setor de compras da CONTRATANTE até o {a.get('dia_rpa', '25')}º dia do mês, relativos aos serviços prestados naquela mesma competência mensal;"])
    doc.substituir("ocorra até a data de (", [f"Tal procedimento deverá ser feito para que o pagamento ocorra até {a.get('data_pagamento', 'o 5º dia útil do mês subsequente')}."])
    doc.substituir(") às (", [a.get("horario_funcionamento", "")])
    doc.substituir("será por prazo (", [f"O prazo de vigência do presente CONTRATO será por prazo {a.get('prazo', 'indeterminado')}, com início em {data_br(a['data_inicio'])}."])
    doc.substituir("entra em vigor na data de", [f"O presente instrumento entra em vigor na data de {data_extenso(a['data_inicio'])}."])
    doc.substituir(") de 20(", [f"{a.get('cidade', 'São Paulo')}, {data_extenso(a.get('data_assinatura', a['data_inicio']))}."])
    doc.apos_rotulo("CONTRATANTE", emp["nome"].upper())
    doc.apos_rotulo("CONTRATADO", c["nome"].upper())


MODELOS = {
    "contrato-padrao": ("Contrato CLT padrão (presencial, jornada controlada)", lambda doc, d: preencher_clt(doc, d, "contrato-padrao")),
    "contrato-hibrido": ("Contrato CLT com teletrabalho híbrido ou integral (jornada controlada)", lambda doc, d: preencher_clt(doc, d, "contrato-hibrido")),
    "contrato-atividade-externa": ("Contrato CLT art. 62, I — atividade externa sem controle de jornada", lambda doc, d: preencher_clt(doc, d, "contrato-atividade-externa")),
    "contrato-prazo-determinado": ("Contrato por prazo determinado (art. 443 §2º 'a' — serviço transitório)", lambda doc, d: preencher_clt(doc, d, "contrato-prazo-determinado")),
    "contrato-autonomo": ("Prestação de serviços autônomo (RPA) — sem subordinação", preencher_autonomo),
    "aditivo-confidencialidade": ("Aditivo para contratos antigos: confidencialidade / LGPD / afastamento / gravação", preencher_aditivo_confidencialidade),
    "aditivo-hibrido": ("Aditivo para contratos antigos: passagem para regime híbrido / home office", preencher_aditivo_hibrido),
}

VARIAVEIS = {
    "clt": "empresa{nome,endereco,cnpj} empregado{nome,cpf,rg,ctps,endereco,email,whatsapp} "
           "cargo{funcao,cbo,salario|remuneracao_texto,dia_pagamento,gorjeta_texto,descricao,horario,regime,ajuda_custo_home_office} "
           "contrato{data_inicio,experiencia_dias,prorrogacao_dias|vigencia_texto,cidade,data_assinatura}",
    "aditivo-confidencialidade": "empresa{nome,endereco,cnpj} empregado{nome,cpf,rg,ctps,endereco,email,whatsapp} contrato{cidade,data_assinatura}",
    "aditivo-hibrido": "empresa{...} empregado{...} cargo{presencial_dias_horarios,home_office_dias_horarios,ajuda_custo_home_office} contrato{cidade,data_assinatura}",
    "contrato-autonomo": "empresa{...} contratado{nome,cpf,rg,endereco} autonomo{atividades[],valor_mensal,dados_bancarios,dia_rpa,data_pagamento,horario_funcionamento,prazo,data_inicio,cidade,data_assinatura}",
}


# ----------------------------------------------------------------------------
# empacotar / converter
# ----------------------------------------------------------------------------

def preencher(modelo, dados, saida):
    src = os.path.join(TEMPLATES, modelo + ".docx")
    if not os.path.exists(src):
        sys.exit(f"modelo não encontrado: {src}")
    work = tempfile.mkdtemp()
    with zipfile.ZipFile(src) as z:
        z.extractall(work)
    p = os.path.join(work, "word", "document.xml")
    doc = Doc(open(p, encoding="utf8").read())
    doc.remover_comentarios()
    MODELOS[modelo][1](doc, dados)
    open(p, "w", encoding="utf8").write(doc.xml)
    out_docx = saida + ".docx"
    if os.path.exists(out_docx):
        os.remove(out_docx)
    with zipfile.ZipFile(out_docx, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(work):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, work))
    shutil.rmtree(work)

    # PDF (LibreOffice); usa o wrapper da skill docx se existir, senão soffice direto
    pdf = None
    wrapper = "/mnt/skills/public/docx/scripts/office/soffice.py"
    outdir = os.path.dirname(os.path.abspath(out_docx))
    try:
        if os.path.exists(wrapper):
            subprocess.run([sys.executable, wrapper, "--headless", "--convert-to", "pdf", "--outdir", outdir, out_docx],
                           check=True, capture_output=True, timeout=180)
        else:
            subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", outdir, out_docx],
                           check=True, capture_output=True, timeout=180)
        pdf = saida + ".pdf"
    except Exception as ex:  # noqa
        print(f"[aviso] PDF não gerado: {ex}", file=sys.stderr)
    return out_docx, pdf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", choices=MODELOS.keys())
    ap.add_argument("--dados", help="JSON com os blocos empresa/empregado/cargo/contrato")
    ap.add_argument("--saida", help="caminho de saída SEM extensão")
    ap.add_argument("--listar-modelos", action="store_true")
    ap.add_argument("--variaveis", metavar="MODELO")
    a = ap.parse_args()
    if a.listar_modelos:
        for k, (desc, _) in MODELOS.items():
            print(f"{k:28s} {desc}")
        return
    if a.variaveis:
        k = a.variaveis if a.variaveis in VARIAVEIS else "clt"
        print(VARIAVEIS[k])
        return
    if not (a.modelo and a.dados and a.saida):
        ap.error("--modelo, --dados e --saida são obrigatórios")
    dados = json.load(open(a.dados, encoding="utf8"))
    docx, pdf = preencher(a.modelo, dados, a.saida)
    print("docx:", docx)
    print("pdf:", pdf or "(não gerado)")


if __name__ == "__main__":
    main()
