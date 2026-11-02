"""
Geometry audit, standing in for visual QA.

This environment has no LibreOffice and no pdftoppm, so slides cannot be
rendered to images. Instead we read every shape's real position and size from
the package and check what rendering would otherwise reveal:

  1. shapes off the slide, or crossing the 0.5" margin
  2. text boxes whose estimated wrapped height exceeds the box
  3. overlapping text boxes (text running through other text)

Estimates are conservative: Calibri/Cambria average ~0.50 em per character.
"""
import sys
from pptx import Presentation
from pptx.util import Emu

EMU = 914400.0
SLIDE_W, SLIDE_H = 13.3333, 7.5
MARGIN = 0.5

deck = sys.argv[1] if len(sys.argv) > 1 else "WebCoP-Hive-GraphQL.pptx"
prs = Presentation(deck)

problems = []


def box(sh):
    try:
        return (sh.left / EMU, sh.top / EMU, sh.width / EMU, sh.height / EMU)
    except TypeError:
        return None


def est_text_height(text, width_in, font_pt, bullet=False):
    """Rough wrapped height in inches."""
    if not text.strip():
        return 0.0
    char_w = font_pt * 0.50 / 72.0
    usable = max(width_in - (0.22 if bullet else 0.0), 0.3)
    per_line = max(int(usable / char_w), 8)
    lines = 0
    for para in text.split("\n"):
        lines += max(1, -(-len(para) // per_line))
    line_h = font_pt * 1.22 / 72.0
    return lines * line_h


for idx, slide in enumerate(prs.slides, start=1):
    text_boxes = []
    for sh in slide.shapes:
        b = box(sh)
        if b is None:
            continue
        x, y, w, h = b
        name = sh.name or sh.shape_type

        # 1. off-slide / margin
        if x < -0.01 or y < -0.01 or x + w > SLIDE_W + 0.01 or y + h > SLIDE_H + 0.01:
            problems.append(
                f"slide {idx}: OFF-SLIDE  {name}  "
                f"x={x:.2f} y={y:.2f} w={w:.2f} h={h:.2f} "
                f"(right={x+w:.2f} bottom={y+h:.2f})"
            )
        elif not str(name).startswith("motif-hex") and not str(name).startswith("take-hex"):
            if x < MARGIN - 0.01 or x + w > SLIDE_W - MARGIN + 0.01:
                problems.append(
                    f"slide {idx}: MARGIN     {name}  "
                    f"x={x:.2f} right={x+w:.2f} (want {MARGIN}..{SLIDE_W-MARGIN:.2f})"
                )

        if not sh.has_text_frame:
            continue
        txt = sh.text_frame.text
        if not txt.strip():
            continue

        # biggest font in the shape, else assume 12
        sizes = [
            r.font.size.pt
            for p in sh.text_frame.paragraphs
            for r in p.runs
            if r.font.size is not None
        ]
        font_pt = max(sizes) if sizes else 12.0
        bullet = any(
            p._pPr is not None and p._pPr.find(
                "{http://schemas.openxmlformats.org/drawingml/2006/main}buChar"
            ) is not None
            for p in sh.text_frame.paragraphs
        )

        # 2. overflow
        need = est_text_height(txt, w, font_pt, bullet)
        if need > h + 0.14:
            problems.append(
                f"slide {idx}: OVERFLOW?  {name}  "
                f"needs ~{need:.2f}\" in h={h:.2f}\" (font {font_pt:.0f}pt, w={w:.2f}\")"
                f"  text={txt[:52]!r}"
            )

        text_boxes.append((name, x, y, w, h, txt[:28]))

    # 3. text-on-text overlap
    for i in range(len(text_boxes)):
        for j in range(i + 1, len(text_boxes)):
            n1, x1, y1, w1, h1, t1 = text_boxes[i]
            n2, x2, y2, w2, h2, t2 = text_boxes[j]
            ox = min(x1 + w1, x2 + w2) - max(x1, x2)
            oy = min(y1 + h1, y2 + h2) - max(y1, y2)
            if ox > 0.10 and oy > 0.10:
                area = ox * oy
                if area > 0.06:
                    problems.append(
                        f"slide {idx}: TEXT OVERLAP  {n1!r} x {n2!r}  "
                        f"{ox:.2f}x{oy:.2f}\"  ({t1!r} / {t2!r})"
                    )

print(f"slides: {len(prs.slides)}   size: {prs.slide_width/EMU:.2f} x {prs.slide_height/EMU:.2f} in")
print(f"issues: {len(problems)}\n")
for p in problems:
    print(" ", p)
if not problems:
    print("  no geometry problems found")
