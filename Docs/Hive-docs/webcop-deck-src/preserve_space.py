"""
Add xml:space="preserve" to every <a:t> that has leading or trailing spaces.

pptxgenjs writes the text verbatim but never sets the attribute, so PowerPoint
is free to collapse the leading whitespace. That silently destroys the
indentation in every code card in this deck. Run this after apply_theme.
"""
import re
import shutil
import sys
import zipfile

A_T = re.compile(r'<a:t>([^<]*)</a:t>')


def needs_preserve(text):
    return text != text.strip() and text.strip() != ''


def fix(xml):
    def sub(m):
        inner = m.group(1)
        if needs_preserve(inner):
            return f'<a:t xml:space="preserve">{inner}</a:t>'
        return m.group(0)
    return A_T.sub(sub, xml)


def main(path):
    tmp = path + '.tmp'
    changed = 0
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.startswith('ppt/slides/') and item.filename.endswith('.xml'):
                xml = data.decode('utf-8')
                fixed = fix(xml)
                if fixed != xml:
                    changed += fixed.count('xml:space="preserve"')
                data = fixed.encode('utf-8')
            dst.writestr(item, data)
    shutil.move(tmp, path)
    print(f'xml:space="preserve" added to {changed} run(s)')


main(sys.argv[1] if len(sys.argv) > 1 else 'WebCoP-Hive-GraphQL.pptx')
