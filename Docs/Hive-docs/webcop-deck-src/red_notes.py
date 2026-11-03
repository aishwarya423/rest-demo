"""
Colour every speaker-notes run red, so notes stand out in presenter view.

pptxgenjs addNotes() takes plain text only and writes each run as
<a:rPr lang="en-US" dirty="0"/>, so this rewrites those runs in the notes
body to carry an explicit solid fill. The slide-number field on the notes page
uses a different rPr and is left alone. Run after build-intro.js.
"""
import shutil
import sys
import zipfile

RED = 'C00000'
PLAIN = '<a:rPr lang="en-US" dirty="0"/>'
COLOURED = f'<a:rPr lang="en-US" dirty="0"><a:solidFill><a:srgbClr val="{RED}"/></a:solidFill></a:rPr>'
END_PLAIN = '<a:endParaRPr lang="en-US" dirty="0"/>'
END_COLOURED = f'<a:endParaRPr lang="en-US" dirty="0"><a:solidFill><a:srgbClr val="{RED}"/></a:solidFill></a:endParaRPr>'


def main(path):
    tmp = path + '.tmp'
    changed = 0
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.startswith('ppt/notesSlides/') and item.filename.endswith('.xml'):
                xml = data.decode('utf-8')
                changed += xml.count(PLAIN)
                xml = xml.replace(PLAIN, COLOURED).replace(END_PLAIN, END_COLOURED)
                data = xml.encode('utf-8')
            dst.writestr(item, data)
    shutil.move(tmp, path)
    print(f'speaker notes coloured red in {changed} run(s)')


main(sys.argv[1] if len(sys.argv) > 1 else '../Intro-GraphQL-Federation-Hive.pptx')
