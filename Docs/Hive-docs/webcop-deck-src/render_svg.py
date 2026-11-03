"""
Render a .pptx to one HTML page of SVG slides, so layout can actually be
looked at in a browser. Not pixel-exact typography, but shape geometry,
fills, borders and text placement are read straight from the package.
"""
import html
import sys
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.dml import MSO_THEME_COLOR

EMU = 914400.0
SCALE = 96.0  # px per inch

THEME = {
    MSO_THEME_COLOR.TEXT_1: '1B1B26',
    MSO_THEME_COLOR.DARK_1: '1B1B26',
    MSO_THEME_COLOR.BACKGROUND_1: 'FFFFFF',
    MSO_THEME_COLOR.LIGHT_1: 'FFFFFF',
    MSO_THEME_COLOR.TEXT_2: '3C4656',
    MSO_THEME_COLOR.DARK_2: '3C4656',
    MSO_THEME_COLOR.BACKGROUND_2: 'F3F4F6',
    MSO_THEME_COLOR.LIGHT_2: 'F3F4F6',
    MSO_THEME_COLOR.ACCENT_1: 'D8912F',
    MSO_THEME_COLOR.ACCENT_2: '21737A',
    MSO_THEME_COLOR.ACCENT_3: 'B05A22',
    MSO_THEME_COLOR.ACCENT_4: '6B7688',
    MSO_THEME_COLOR.ACCENT_5: '2E7D52',
    MSO_THEME_COLOR.ACCENT_6: '9B2C2C',
}


def resolve(color):
    try:
        if color.type is None:
            return None
        if str(color.type).startswith('SCHEME'):
            return '#' + THEME.get(color.theme_color, '888888')
        return '#' + str(color.rgb)
    except Exception:
        return None


def fill_of(sh):
    try:
        f = sh.fill
        if f.type is None:
            return None
        if str(f.type) == 'BACKGROUND (5)':
            return None
        return resolve(f.fore_color)
    except Exception:
        return None


def line_of(sh):
    try:
        ln = sh.line
        if ln.fill.type is None or str(ln.fill.type) == 'BACKGROUND (5)':
            return None, 0
        w = ln.width.pt if ln.width else 1
        return resolve(ln.color), w
    except Exception:
        return None, 0


ALIGN = {PP_ALIGN.CENTER: 'middle', PP_ALIGN.RIGHT: 'end'}


def geom(sh, x, y, w, h, fc, lc, lw, name):
    st = f'fill="{fc or "none"}" stroke="{lc or "none"}" stroke-width="{lw}"'
    try:
        s = sh.shape_type
    except Exception:
        s = None
    auto = None
    try:
        auto = sh.auto_shape_type
    except Exception:
        pass
    if auto == MSO_SHAPE.HEXAGON:
        cx, cy, rx, ry = x + w / 2, y + h / 2, w / 2, h / 2
        pts = []
        for ang in (0, 60, 120, 180, 240, 300):
            import math
            a = math.radians(ang + 90)
            pts.append(f'{cx + rx * math.cos(a):.1f},{cy + ry * math.sin(a):.1f}')
        return f'<polygon points="{" ".join(pts)}" {st}/>'
    if auto == MSO_SHAPE.RIGHT_ARROW:
        hh = h / 2
        p = f'{x},{y+h*0.25} {x+w*0.6},{y+h*0.25} {x+w*0.6},{y} {x+w},{y+hh} {x+w*0.6},{y+h} {x+w*0.6},{y+h*0.75} {x},{y+h*0.75}'
        return f'<polygon points="{p}" {st}/>'
    if auto == MSO_SHAPE.DOWN_ARROW:
        p = f'{x+w*0.25},{y} {x+w*0.75},{y} {x+w*0.75},{y+h*0.6} {x+w},{y+h*0.6} {x+w/2},{y+h} {x},{y+h*0.6} {x+w*0.25},{y+h*0.6}'
        return f'<polygon points="{p}" {st}/>'
    r = 6 if auto == MSO_SHAPE.ROUNDED_RECTANGLE else 0
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" {st}/>'


def text_svg(sh, x, y, w, h, default_color):
    tf = sh.text_frame
    lines = []
    for p in tf.paragraphs:
        runs = []
        for r in p.runs:
            sz = r.font.size.pt if r.font.size else 12
            col = resolve(r.font.color) or default_color
            runs.append((r.text, sz, bool(r.font.bold), col, r.font.name or ''))
        if not runs:
            runs = [('', 12, False, default_color, '')]
        lines.append((p.alignment, runs))
    if not any(t for _, rs in lines for t, *_ in rs):
        return ''
    # wrap crudely
    out = []
    flat = []
    for align, runs in lines:
        maxsz = max(r[1] for r in runs)
        txt = ''.join(r[0] for r in runs)
        col = runs[0][3]
        bold = runs[0][2]
        # only a run-through code line counts as monospace; a prose paragraph
        # with one inline code token must still wrap normally
        mono = bool(runs) and all('Courier' in (r[4] or '') for r in runs)
        # split explicit newlines
        for piece in txt.split('\n'):
            # wrap by estimated width; monospace lines are pre-wrapped by hand
            cw = maxsz * (0.60 if mono else 0.50) / 72 * SCALE
            per = 10000 if mono else (max(int(w / cw), 6) if cw else 100)
            cur = ''
            words = piece.split(' ')
            buf = []
            for word in words:
                trial = (cur + ' ' + word).strip()
                if len(trial) > per and cur:
                    buf.append(cur)
                    cur = word
                else:
                    cur = trial
            buf.append(cur)
            for b in buf:
                flat.append((align, b, maxsz, bold, col, mono))
    lh = max((f[2] for f in flat), default=12) * 1.3 / 72 * SCALE
    total = len(flat) * lh
    anchor = tf.vertical_anchor
    if anchor == MSO_ANCHOR.MIDDLE:
        ty = y + (h - total) / 2 + lh * 0.78
    elif anchor == MSO_ANCHOR.BOTTOM:
        ty = y + h - total + lh * 0.78
    else:
        ty = y + lh * 0.78
    for align, t, sz, bold, col, mono in flat:
        a = ALIGN.get(align, 'start')
        tx = x if a == 'start' else (x + w / 2 if a == 'middle' else x + w)
        out.append(
            f'<text x="{tx:.1f}" y="{ty:.1f}" font-size="{sz * SCALE / 72:.1f}" '
            f'fill="{col}" text-anchor="{a}" '
            f'font-family="{"Menlo, Courier New, monospace" if mono else "Calibri, Carlito, sans-serif"}" '
            f'xml:space="preserve" style="white-space:pre" '
            f'font-weight="{"bold" if bold else "normal"}">{html.escape(t)}</text>')
        ty += lh
    return ''.join(out)


def main(path, out):
    prs = Presentation(path)
    W = prs.slide_width / EMU * SCALE
    H = prs.slide_height / EMU * SCALE
    body = []
    for idx, slide in enumerate(prs.slides, 1):
        bg = '#FFFFFF'
        try:
            lay = slide.slide_layout
            c = lay.background.fill
            if c.type is not None and str(c.type) != 'BACKGROUND (5)':
                bg = resolve(c.fore_color) or bg
        except Exception:
            pass
        parts = [f'<rect width="{W}" height="{H}" fill="{bg}"/>']
        # guide lines at the 0.62" margins
        for gx in (0.62 * SCALE, W - 0.62 * SCALE):
            parts.append(f'<line x1="{gx}" y1="0" x2="{gx}" y2="{H}" stroke="#ff00ff" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.45"/>')
        shapes = list(slide.slide_layout.shapes) + list(slide.shapes)
        for sh in shapes:
            try:
                x = sh.left / EMU * SCALE
                y = sh.top / EMU * SCALE
                w = sh.width / EMU * SCALE
                h = sh.height / EMU * SCALE
            except TypeError:
                continue
            fc = fill_of(sh)
            lc, lw = line_of(sh)
            is_tb = False
            try:
                is_tb = sh.has_text_frame and sh.shape_type is not None and 'TEXT_BOX' in str(sh.shape_type)
            except Exception:
                pass
            if not is_tb and (fc or lc):
                parts.append(geom(sh, x, y, w, h, fc, lc, lw, sh.name))
            if sh.has_text_frame and sh.text_frame.text.strip():
                dark = bg.upper() in ('#1B1B26',)
                parts.append(text_svg(sh, x, y, w, h, '#FFFFFF' if dark else '#3C4656'))
        body.append(
            f'<div class="s"><div class="n">Slide {idx}</div>'
            f'<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'xmlns="http://www.w3.org/2000/svg">{"".join(parts)}</svg></div>')
    open(out, 'w').write(
        '<!doctype html><meta charset="utf-8"><style>'
        'body{background:#555;margin:0;padding:16px;font-family:system-ui}'
        '.s{margin-bottom:22px}.n{color:#fff;font:600 13px system-ui;margin:4px 0}'
        'svg{display:block;box-shadow:0 2px 12px #0008}</style>' + ''.join(body))
    print('wrote', out, len(prs.slides), 'slides')


main(sys.argv[1], sys.argv[2])
