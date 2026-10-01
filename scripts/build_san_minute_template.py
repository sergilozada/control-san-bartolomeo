"""Derive a public, de-identified financed-minute template from the supplied H-04 Word.

Run with the bundled document runtime, passing the private source DOCX and
public output path. The source is never copied into the repository.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.shared import Pt


EXPECTED_SHA256 = "42236a865f1b8af534ffd83ed303a6cf230280e3437a6a82356efe398f9987ac"


def rewrite(paragraph, pieces: list[tuple[str, bool]]) -> None:
    paragraph.clear()  # keeps original paragraph properties, tabs and spacing
    for value, bold in pieces:
        run = paragraph.add_run(value)
        run.bold = bold
        run.font.name = "Times New Roman"


def discard(element) -> None:
    element.getparent().remove(element)


def build(source: Path, output: Path) -> None:
    if hashlib.sha256(source.read_bytes()).hexdigest() != EXPECTED_SHA256:
        raise ValueError("La fuente no coincide con el Word H-04 revisado.")
    doc = Document(source)
    p = doc.paragraphs
    private_tokens = [p[index].text.strip() for index in (50, 56)]
    private_tokens.extend(re.findall(r"\b\d{7,}\b", p[5].text + " " + p[21].text + " " + p[51].text + " " + p[57].text))

    # P3 contains the seller, RUC and representative: keep the source runs
    # unchanged for every future client.
    rewrite(p[5], [("{{BUYERS_INTRO}}", False)])
    rewrite(p[9], [
        ("EL TRANSFERENTE", True),
        (" manifiesta que sobre el Fundo Bartolomeo ha realizado la desmembración de una porción del área matriz, la cual tiene una superficie de {{AREA_M2}} m² ({{AREA_WORDS}} metros cuadrados) y es identificado como Fundo Bartolomeo Mz: {{BLOCK}} Lte: {{LOT}}, Distrito, Provincia y Departamento de Ica. ==================", False),
    ])
    # H-04's boundary measures, UTM diagram and alleged plano annex cannot be
    # reused for another lot. The user explicitly requested their removal.
    for index in range(10, 17):
        discard(p[index]._element)

    rewrite(p[18], [
        ("Por el presente acto jurídico, ", False), ("EL TRANSFERENTE", True),
        (" transfiere y cede en forma perpetua, irrevocable y definitiva a favor de ", False),
        ("LOS ADQUIRENTES", True),
        (", los derechos posesorios del lote desmembrado, que cuenta con una extensión superficial de ", False),
        ("{{AREA_HA}} hectáreas ({{AREA_M2}} metros cuadrados)", True),
        (", antes descrita, junto con los accesos, usos, servidumbres, aires y demás derechos inherentes. ==========================================", False),
    ])
    rewrite(p[20], [
        ("El precio total de la transferencia de derechos posesorios es de ", False),
        ("{{TOTAL_MONEY}} ({{TOTAL_WORDS}})", True),
        (". Dicho precio será abonado por LOS ADQUIRENTES a favor de EL TRANSFERENTE de la siguiente manera: ===============================", False),
    ])
    rewrite(p[21], [
        ("{{PAYMENT_PARAGRAPH}} ===============================", False),
    ])
    discard(doc.tables[0]._element)  # receipts of the example purchasers

    # Replace only the date values; the source's city and legal wording stay put.
    p[46].runs[1].text = "{{SIGNATURE_DAY}}"
    p[46].runs[3].text = "{{SIGNATURE_MONTH}} "
    p[46].runs[4].text = "del {{SIGNATURE_YEAR}}"
    p[50].runs[-1].text = "{{BUYER_1_NAME}}"
    p[51].runs[-2].text = "{{BUYER_1_DOCUMENT_LABEL}} N° "
    p[51].runs[-1].text = "{{BUYER_1_DOCUMENT}}"
    p[55].runs[-1].text = "{{BUYER_2_LINE}}"
    p[56].runs[-1].text = "{{BUYER_2_NAME}}"
    p[57].runs[-2].text = "{{BUYER_2_DOCUMENT_LABEL}} N° "
    p[57].runs[-1].text = "{{BUYER_2_DOCUMENT}}"

    annex_heading = doc.add_paragraph("ANEXO 01: CRONOGRAMA DE CUOTAS", style="Normal")
    annex_heading.runs[0].bold = True
    annex_heading.paragraph_format.keep_with_next = True
    annex_heading.paragraph_format.page_break_before = True
    table = doc.add_table(rows=2, cols=3)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for cell, label in zip(table.rows[0].cells, ("Cuota N.°", "Vencimiento", "Importe")):
        cell.text = label
        for run in cell.paragraphs[0].runs:
            run.bold = True
            run.font.name = "Times New Roman"
            run.font.size = Pt(10)
    for cell, label in zip(table.rows[1].cells, ("{{QUOTA_NUMBER}}", "{{QUOTA_DUE}}", "{{QUOTA_AMOUNT}}")):
        cell.text = label
        for run in cell.paragraphs[0].runs:
            run.font.name = "Times New Roman"
            run.font.size = Pt(10)
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    props = doc.core_properties
    props.author = "San Bartolomeo"
    props.last_modified_by = "San Bartolomeo"
    props.comments = ""
    props.keywords = ""
    props.subject = "Modelo financiado de transferencia de derechos posesorios"
    props.title = "Minuta financiada San Bartolomeo"
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)

    private_media = {"word/media/image2.png", "word/media/image3.png", "word/media/image4.png"}
    staged = output.with_suffix(".staged.docx")
    with ZipFile(output) as source_zip, ZipFile(staged, "w") as clean_zip:
        for part in source_zip.infolist():
            if part.filename in private_media:
                continue
            data = source_zip.read(part.filename)
            if part.filename == "word/_rels/document.xml.rels":
                relationships = etree.fromstring(data)
                for relationship in list(relationships):
                    if "word/" + relationship.get("Target", "") in private_media:
                        relationships.remove(relationship)
                data = etree.tostring(relationships, encoding="UTF-8", xml_declaration=True, standalone=True)
            clean_zip.writestr(part, data)
    os.replace(staged, output)

    # Fail closed: a public template must never carry example purchasers' receipts.
    with ZipFile(output) as zipped:
        raw = b"".join(zipped.read(name) for name in zipped.namelist())
        if any(term.encode("utf-8") in raw for term in private_tokens if term):
            raise ValueError("El modelo todavía contiene datos del expediente H-04.")
        media = [name for name in zipped.namelist() if name.startswith("word/media/")]
        if len(media) > 2:
            raise ValueError(f"Quedaron imágenes no autorizadas en el modelo: {media}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Uso: build_san_minute_template.py fuente.docx salida.docx")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
