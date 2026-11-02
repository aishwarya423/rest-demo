# WebCoP deck source

Regenerates [`../WebCoP-Hive-GraphQL.pptx`](../WebCoP-Hive-GraphQL.pptx) — 10 slides
on GraphQL Federation, Hive's schema lifecycle and runtime request flow.

```bash
npm install pptxgenjs
PPTX_SKILL=<path to the pptx skill dir> \
NODE_PATH="$PWD/node_modules" \
node build.js
python3 audit.py WebCoP-Hive-GraphQL.pptx
python3 render_svg.py WebCoP-Hive-GraphQL.pptx preview.html
```

`NODE_PATH` is required: `apply_theme.js` lives in the skill directory and
resolves `jszip` through it.

## Layout discipline

Every coordinate derives from the `GRID` constant and every font size from
`TYPE`. Nothing is positioned ad hoc, which is what keeps titles, subtitles and
diagram tops aligned across all ten slides. Change the grid, not a slide.

`GRID.BODY_Y` and `GRID.BODY_BOTTOM` are the body band: every content slide
starts its content at the first and bottoms out on the second, so no slide packs
itself into the top two thirds and leaves white space above the footer. Panels
are sized from what they contain, or stretched to `BODY_BOTTOM` — never left at
a height that puts an empty tinted box on the slide. `panel()` deliberately
casts no shadow, because a shadow on a pale tint reads as a floating box rather
than as the background zone these panels are for.

Only two fonts appear explicitly: Cambria for headings (via the theme) and
Courier New for the one code token. Everything else inherits the theme body
font, so font consistency is structural rather than maintained by hand.

## Visual QA: render_svg.py and audit.py

This machine has no LibreOffice and no `pdftoppm`, so PowerPoint cannot be asked
to render the slides. Two scripts cover that gap.

`render_svg.py` reads every shape's real position, size, fill, border and text
out of the package and redraws the whole deck as one HTML page of SVG slides,
with dashed guides on the 0.62" margins. Serve it and open it in a browser:

```bash
python3 -m http.server 8731
```

Typography is approximate — the point is geometry. It is what exposed the
remaining problems in the second build: roughly 1.5" of dead space under the
content on every slide, panels much taller than the content inside them, a box
overflowing the bottom of its panel on the request-flow slide, three arrows
pointing into empty space, and a caption sitting on a panel edge. None of those
show up in a list of coordinates.

`audit.py` is the numeric check that runs alongside it: off-slide shapes, margin
breaches, estimated text overflow and text-on-text overlap.

Neither is a substitute for opening the file once in PowerPoint.

## Content accuracy

Terminology follows the official Hive documentation. Two points worth knowing:

- The three change severities are Hive's own
  `enum SeverityLevelType { SAFE, DANGEROUS, BREAKING }`, taken from the Console
  source. The public schema-checks docs page mentions only breaking and safe.
- The high-availability CDN is a Hive Cloud feature. A self-hosted install
  serves the same artifacts from its own endpoint, which is why slide 4 says
  "CDN or artifact endpoint".
