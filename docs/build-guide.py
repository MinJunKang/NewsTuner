#!/usr/bin/env python3
"""사용 설명서 PDF 를 만듭니다.

본문은 src/guide.json 한 곳에만 있습니다. 앱 안의 설명서 화면도 같은 파일을
읽으므로, 문구를 고칠 때는 그 JSON 만 고치고 이 스크립트를 다시 돌리면 됩니다.
두 벌로 나눠 두면 한쪽만 고쳐져 설명이 어긋납니다.

    pip install fpdf2
    python3 docs/build-guide.py

한글 폰트가 필요합니다. 나눔고딕 TTF 를 아래 FONT_DIR 에 두거나 경로를 바꾸세요.
(https://hangeul.naver.com/font 에서 받을 수 있습니다.)
"""

import json
import pathlib
import sys

from fpdf import FPDF
from fpdf.enums import XPos, YPos

ROOT = pathlib.Path(__file__).resolve().parent.parent
GUIDE = json.loads((ROOT / "src" / "guide.json").read_text(encoding="utf-8"))
OUT = ROOT / "public" / "NewsTuner-Guide-KR.pdf"

FONT_DIR = pathlib.Path(
    sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/nanum"
)

INK = (26, 29, 33)
DIM = (110, 116, 124)
ACCENT = (13, 122, 106)
RULE = (216, 210, 196)
BOXBG = (246, 244, 238)


class Guide(FPDF):
    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-15)
        self.set_font("Nanum", "", 8)
        self.set_text_color(*DIM)
        self.cell(0, 5, f"{GUIDE['title']} · {self.page_no()}", align="C")


pdf = Guide(format="A4", unit="mm")
pdf.add_font("Nanum", "", str(FONT_DIR / "NanumGothic.ttf"))
pdf.add_font("Nanum", "B", str(FONT_DIR / "NanumGothicBold.ttf"))
pdf.set_margins(22, 20, 22)
pdf.set_auto_page_break(True, margin=20)
W = 210 - 44


def space(h):
    pdf.ln(h)


def body(text, size=10.5, color=INK, style=""):
    pdf.set_font("Nanum", style, size)
    pdf.set_text_color(*color)
    # 한글은 양쪽 정렬을 하면 낱말 사이가 들쭉날쭉해집니다. 왼쪽 정렬로 둡니다.
    pdf.multi_cell(W, 6.2, text, align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    space(2)


def render(b):
    t = b.get("type")

    if t == "pagebreak":
        pdf.add_page()

    elif t == "part":
        if pdf.get_y() > 215:
            pdf.add_page()
        space(7)
        pdf.set_draw_color(*ACCENT)
        pdf.set_line_width(1.1)
        y = pdf.get_y()
        pdf.line(22, y, 22 + W, y)
        space(3.5)
        body(b["title"], 18, INK, "B")

    elif t == "section":
        if pdf.get_y() > 235:
            pdf.add_page()
        space(6)
        pdf.set_font("Nanum", "B", 15)
        pdf.set_text_color(*ACCENT)
        pdf.multi_cell(W, 8, f"{b['n']}. {b['title']}", align="L",
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        y = pdf.get_y() + 1
        pdf.set_draw_color(*RULE)
        pdf.set_line_width(0.3)
        pdf.line(22, y, 22 + W, y)
        space(4)

    elif t == "sub":
        space(1)
        body(b["title"], 11.5, INK, "B")

    elif t == "body":
        body(b["text"])

    elif t == "step":
        y0 = pdf.get_y()
        pdf.set_font("Nanum", "B", 10.5)
        pdf.set_text_color(*ACCENT)
        pdf.set_xy(22, y0)
        pdf.cell(7, 6.2, str(b["n"]))
        pdf.set_font("Nanum", "", 10.5)
        pdf.set_text_color(*INK)
        pdf.set_xy(29, y0)
        pdf.multi_cell(W - 7, 6.2, b["text"], align="L",
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        space(1.5)

    elif t == "bullet":
        # 제목과 설명을 한 덩어리로 흘립니다. 제목이 길어도 줄이 어긋나지 않습니다.
        pdf.set_font("Nanum", "", 10.5)
        pdf.set_text_color(*INK)
        pdf.set_x(22)
        pdf.multi_cell(W, 6.2, f"**· {b['label']}**  {b['text']}", markdown=True,
                       align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        space(1.5)

    elif t == "box":
        pdf.set_font("Nanum", "", 10.5)
        h = 5
        for text, _ in b["lines"]:
            lines = pdf.multi_cell(W - 12, 6.2, text, dry_run=True, output="LINES")
            h += 6.2 * max(1, len(lines))
        if pdf.get_y() + h > 270:
            pdf.add_page()
        y0 = pdf.get_y()
        pdf.set_fill_color(*BOXBG)
        pdf.rect(22, y0, W, h, style="F")
        pdf.set_draw_color(*ACCENT)
        pdf.set_line_width(1.2)
        pdf.line(22, y0, 22, y0 + h)
        pdf.set_xy(28, y0 + 2.5)
        for text, strong in b["lines"]:
            pdf.set_x(28)
            pdf.set_font("Nanum", "B" if strong else "", 10.5)
            pdf.set_text_color(*(INK if strong else DIM))
            pdf.multi_cell(W - 12, 6.2, text, align="L",
                           new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_y(y0 + h)
        space(4)


pdf.add_page()
space(14)
body(GUIDE["title"], 26, INK, "B")
space(2)
body(GUIDE["subtitle"], 11.5, DIM)
space(8)

for block in GUIDE["blocks"]:
    render(block)

pdf.output(str(OUT))
print(f"만들었습니다: {OUT} ({pdf.page_no()}쪽)")
