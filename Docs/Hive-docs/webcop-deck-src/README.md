# WebCoP deck source

Regenerates [`../WebCoP-Hive-GraphQL.pptx`](../WebCoP-Hive-GraphQL.pptx) — 12 slides,
about 20 minutes: why GraphQL beyond REST, the four adoption patterns, federation
mechanics, the Hive ecosystem, a reference architecture, the schema lifecycle and
the runtime request path.

```bash
npm install pptxgenjs
PPTX_SKILL=<path to the pptx skill dir> \
NODE_PATH="$PWD/node_modules" \
node build.js
python3 preserve_space.py WebCoP-Hive-GraphQL.pptx
python3 audit.py WebCoP-Hive-GraphQL.pptx
python3 render_svg.py WebCoP-Hive-GraphQL.pptx preview.html
```

`NODE_PATH` is required: `apply_theme.js` lives in the skill directory and
resolves `jszip` through it.

`preserve_space.py` is **not optional**. Every code card on these slides is
indented SDL, CLI or query-plan text, and pptxgenjs writes those runs without
`xml:space="preserve"`, so PowerPoint is free to strip the leading spaces and
flatten the indentation. The script adds the attribute to the ~50 runs that need
it. Run it after `build.js`, every time.

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

Terminology and API detail follow the official Hive documentation — CDN artifact
paths, CLI flags, gateway and router feature sets are taken from the docs rather
than from memory. Points worth knowing:

- The three change severities are Hive's own
  `enum SeverityLevelType { SAFE, DANGEROUS, BREAKING }`, taken from the Console
  source. The public schema-checks docs page mentions only breaking and safe.
- The high-availability CDN is a Hive Cloud feature (Cloudflare, with an AWS
  mirror at `cdn-mirror.graphql-hive.com`). A self-hosted install exposes the
  same artifact routes from its own Hive API, which is why the deck says
  "CDN or object storage" rather than assuming the CDN.
- Hive Router has **no response cache**. Its `cache` config key tunes in-memory
  parse, validation and query-plan caches only — confirmed against the router
  configuration reference, whose top-level keys are authorization, cache, cors,
  csrf, headers, http, jwt, log, override_subgraph_urls, persisted_documents,
  storages, override_labels, query_planner, response_extensions, supergraph,
  traffic_shaping, telemetry, introspection, limits and subscriptions.
- The deck contains no third-party diagrams. The reference architecture on
  slide 6 is drawn from scratch for the Hive ecosystem; published vendor
  blueprints were read for structure only, not copied.
