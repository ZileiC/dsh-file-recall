"""Generate deterministic test fixtures for the extraction layer.

Run with the bundled python:
  <runtimes>/python/python.exe test/fixtures/generate.py

The generated files are committed assets; this script exists so they can be
regenerated after an extractor change.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

from docx import Document
from docx.shared import Pt
from pptx import Presentation
from pptx.util import Inches, Pt as PPt
import xlsxwriter

HERE = Path(__file__).resolve().parent
OUT = HERE


def pptx_basic() -> None:
    prs = Presentation()
    blank = prs.slide_layouts[5]  # Title Only

    s1 = prs.slides.add_slide(blank)
    s1.shapes.title.text = "2023 年度业务复盘"
    box = s1.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1))
    box.text_frame.text = "第一部分：市场环境"

    s2 = prs.slides.add_slide(blank)
    s2.shapes.title.text = "部门预算的说明"
    box = s2.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(2))
    tf = box.text_frame
    tf.text = "绩效指标：收入增长 12%"
    tf.add_paragraph().text = "成本控制：同比下降 3%"
    s2.notes_slide.notes_text_frame.text = "讲解词：重点看这一页的蓝色架构图。"

    s3 = prs.slides.add_slide(blank)
    s3.shapes.title.text = "下一步计划"
    box = s3.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1))
    box.text_frame.text = "Q4 完成交付"

    prs.save(OUT / "deck-basic.pptx")


def pptx_order() -> None:
    prs = Presentation()
    blank = prs.slide_layouts[5]
    for title, body in [
        ("第一张幻灯片", "阿尔法内容"),
        ("第二张幻灯片", "贝塔内容"),
    ]:
        slide = prs.slides.add_slide(blank)
        slide.shapes.title.text = title
        box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1))
        box.text_frame.text = body
    prs.save(OUT / "deck-order.pptx")


def pptx_notes_only() -> None:
    prs = Presentation()
    blank = prs.slide_layouts[5]
    slide = prs.slides.add_slide(blank)
    slide.shapes.title.text = "封面"
    slide.notes_slide.notes_text_frame.text = "只有备注里才有的关键词：珊瑚礁。"
    prs.save(OUT / "deck-notes-only.pptx")


def docx_headings() -> None:
    doc = Document()
    doc.add_heading("项目背景", level=1)
    doc.add_paragraph("这是项目背景说明，包含市场环境与客户诉求。")
    doc.add_heading("预算", level=2)
    doc.add_paragraph("部门预算的说明与绩效指标都在这一节。")

    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "科目"
    table.cell(0, 1).text = "金额"
    table.cell(1, 0).text = "差旅"
    table.cell(1, 1).text = "12 万"
    doc.save(OUT / "doc-headings.docx")


def docx_long() -> None:
    doc = Document()
    doc.add_heading("长文测试", level=1)
    for index in range(3):
        paragraph = (
            f"第{index + 1}段："
            "这是一段用于验证长文档分块的中文内容，重复出现业务背景、客户诉求、"
            "预算约束、交付节奏与风险控制等要素，确保单段长度超过分块阈值，"
            "从而触发按段落聚合的逻辑。" * 4
        )
        doc.add_paragraph(paragraph)
    doc.save(OUT / "doc-long.docx")


def docx_mixed() -> None:
    doc = Document()
    doc.add_heading("Mixed Content 混排", level=1)
    p = doc.add_paragraph("2023 年度 Budget Plan：收入增长 12%，成本下降 3%。")
    p.runs[0].font.size = Pt(12)
    doc.add_paragraph("Contact: ops@example.com / 400-800-1234")
    doc.save(OUT / "doc-mixed.docx")


def xlsx_formulas() -> None:
    wb = xlsxwriter.Workbook(str(OUT / "sheet-formulas.xlsx"))
    ws = wb.add_worksheet("预算")
    ws.write("A1", "预算科目")
    ws.write("B1", 100)
    ws.write("A2", "绩效指标-收入")
    ws.write_formula("B2", "=B1*2", None, 200)
    ws.write("A3", "成本")
    ws.write_formula("B3", "=B1/4", None, 25)
    wb.close()


def xlsx_multi() -> None:
    wb = xlsxwriter.Workbook(str(OUT / "sheet-multi.xlsx"))
    ws1 = wb.add_worksheet("预算表")
    ws1.write_row("A1", ["项目", "金额", "备注"])
    ws1.write_row("A2", ["差旅", 12, "Q1"])
    ws2 = wb.add_worksheet("人员表")
    ws2.write_row("A1", ["姓名", "角色"])
    ws2.write_row("A2", ["张三", "负责人"])
    wb.close()


def xlsx_wide() -> None:
    wb = xlsxwriter.Workbook(str(OUT / "sheet-wide.xlsx"))
    ws = wb.add_worksheet("明细")
    for row in range(120):
        ws.write(row, 0, f"第{row + 1}行")
        ws.write(row, 1, row * 10)
    wb.close()


def pdf_write(path: Path, page_texts: list[str]) -> None:
    """Write a minimal valid PDF with Helvetica text (ASCII only)."""
    objects: list[bytes] = []

    def add(body: str) -> int:
        objects.append(body.encode("latin-1"))
        return len(objects)

    font_id = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: list[int] = []
    pages_id_placeholder = None
    content_ids: list[int] = []
    for text in page_texts:
        stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET" if text else ""
        content_ids.append(add(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"))
    pages_obj_id = len(objects) + len(page_texts) + 1
    for content_id in content_ids:
        page_ids.append(
            add(
                f"<< /Type /Page /Parent {pages_obj_id} 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
            )
        )
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    pages_id = add(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>")
    catalog_id = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode("latin-1") + body + b"\nendobj\n"
    xref_offset = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode("latin-1")
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("latin-1")
    path.write_bytes(bytes(out))


def pdf_text() -> None:
    pdf_write(OUT / "pdf-text.pdf", ["Budget plan for 2023", "Performance indicators"])


def pdf_blank() -> None:
    pdf_write(OUT / "pdf-blank.pdf", [""])


def pdf_mixed() -> None:
    pdf_write(OUT / "pdf-mixed.pdf", ["Only first page has text", ""])


def pdf_scan() -> None:
    """A scanned-style PDF: pages are a single embedded image, no text layer."""
    from PIL import Image

    source = Image.open(OUT / "ocr-zh.png").convert("RGB")
    second = source.copy()
    source.save(
        OUT / "pdf-scan.pdf",
        "PDF",
        resolution=150,
        save_all=True,
        append_images=[second],
    )


def pdf_mixed_scan() -> None:
    """Page 1 has a real text layer; page 2 is a scanned image (no text layer)."""
    from PIL import Image

    image = Image.open(OUT / "ocr-zh.png").convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=85)
    jpeg = buffer.getvalue()
    width, height = image.size

    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    text_stream = b"BT /F1 24 Tf 72 720 Td (Page one has a text layer) Tj ET"
    text_content = add(
        b"<< /Length %d >>\nstream\n" % len(text_stream) + text_stream + b"\nendstream"
    )
    image_stream = (
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB "
        b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
        % (width, height, len(jpeg))
        + jpeg
        + b"\nendstream"
    )
    image_id = add(image_stream)
    draw = b"q 500 0 0 108 50 400 cm /Im1 Do Q"
    image_content = add(b"<< /Length %d >>\nstream\n" % len(draw) + draw + b"\nendstream")

    pages_obj_id = len(objects) + 3
    page1 = add(
        b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
        % (pages_obj_id, font_id, text_content)
    )
    page2 = add(
        b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /XObject << /Im1 %d 0 R >> >> /Contents %d 0 R >>"
        % (pages_obj_id, image_id, image_content)
    )
    pages_id = add(b"<< /Type /Pages /Kids [%d 0 R %d 0 R] /Count 2 >>" % (page1, page2))
    catalog_id = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % index + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1) + b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += b"%010d 00000 n \n" % offset
    out += (
        b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, catalog_id, xref)
    )
    (OUT / "pdf-mixed-scan.pdf").write_bytes(bytes(out))


def text_files() -> None:
    (OUT / "note-utf8.txt").write_text(
        "部门预算的说明。\n绩效指标：收入增长 12%。\n",
        encoding="utf-8",
    )
    (OUT / "note-gbk.txt").write_text(
        "这是 GBK 编码的中文文本，关键字：珊瑚礁。\n",
        encoding="gbk",
    )
    (OUT / "note-bom.txt").write_text(
        "带 BOM 的 UTF-8 文本，关键字：预算说明。\n",
        encoding="utf-8-sig",
    )
    (OUT / "readme.md").write_text(
        "# 项目说明\n\n这是 Markdown 文档，包含**绩效指标**与预算说明。\n\n## 下一节\n\n更多内容。\n",
        encoding="utf-8",
    )


def unsupported_files() -> None:
    for name in ("legacy.doc", "legacy.xls", "legacy.ppt", "legacy.wps"):
        (OUT / name).write_bytes(b"\xd0\xcf\x11\xe0dummy")


def ocr_images() -> None:
    from PIL import Image, ImageDraw, ImageFont

    cjk_candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    cjk_font_path = next((path for path in cjk_candidates if os.path.exists(path)), None)
    if cjk_font_path is None:
        raise RuntimeError("no CJK font found for OCR fixture")

    image = Image.new("RGB", (1200, 260), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(cjk_font_path, 80)
    draw.text((40, 70), "部门预算的说明", font=font, fill="black")
    image.save(OUT / "ocr-zh.png")

    english = Image.new("RGB", (900, 220), "white")
    english_draw = ImageDraw.Draw(english)
    try:
        english_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 72)
    except OSError:
        english_font = ImageFont.load_default()
    english_draw.text((40, 60), "Budget plan 2023", font=english_font, fill="black")
    english.save(OUT / "ocr-en.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pptx_basic()
    pptx_order()
    pptx_notes_only()
    docx_headings()
    docx_long()
    docx_mixed()
    xlsx_formulas()
    xlsx_multi()
    xlsx_wide()
    pdf_text()
    pdf_blank()
    pdf_mixed()
    pdf_scan()
    pdf_mixed_scan()
    text_files()
    unsupported_files()
    ocr_images()
    print("fixtures written to", OUT)


if __name__ == "__main__":
    main()
