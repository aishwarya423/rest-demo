/**
 * WebCoP session deck: GraphQL Hive — Federation, Schema Lifecycle, Runtime
 * Regenerate:  NODE_PATH="$PWD/node_modules" PPTX_SKILL=<skill dir> node build.js
 *
 * Terminology follows the official Hive documentation. Where the docs are
 * thinner than the API, the Hive Console source is authoritative:
 *   enum SeverityLevelType { SAFE, DANGEROUS, BREAKING }
 *
 * Layout discipline: every coordinate derives from GRID and every font size
 * from TYPE. No ad-hoc numbers, so titles, subtitles and body tops align
 * across all slides.
 */
const pptxgen = require('pptxgenjs');
const { applyTheme } = require(process.env.PPTX_SKILL + '/scripts/apply_theme.js');

// ---------------------------------------------------------------- theme
const THEME = {
  name: 'HiveWebCoP',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1B1B26',
    lt1: 'FFFFFF',
    dk2: '3C4656',
    lt2: 'F3F4F6',
    accent1: 'D8912F', // honey — Hive / design time
    accent2: '21737A', // teal  — runtime / gateway
    accent3: 'B05A22', // burnt — subgraphs / developer
    accent4: '6B7688', // muted — captions
    accent5: '2E7D52', // green — safe
    accent6: '9B2C2C', // red   — breaking
    hlink: 'D8912F',
    folHlink: 'B05A22',
  },
};
const K = THEME.colors;
const AMBER_DARK = 'C98A1B'; // dangerous — between safe and breaking
const TINT_TEAL = 'E9F1F2';
const TINT_AMBER = 'FBF3E4';
const HAIRLINE = 'D5D8DE';

// ---------------------------------------------------------- layout grid
const W = 13.3333;
const H = 7.5;
const M = 0.62;
const GRID = {
  M,
  CW: W - 2 * M, // 12.093
  RIGHT: W - M, // 12.713
  TITLE_Y: 0.46,
  TITLE_H: 0.72,
  SUB_Y: 1.22,
  SUB_H: 0.34,
  BODY_Y: 1.74, // identical body top on every content slide
  BODY_BOTTOM: 6.3, // identical body bottom: content fills the slide, not the top third
  FOOT_Y: H - 0.48,
  GAP: 0.4,
};
const TYPE = {
  TITLE: 30,
  SUB: 14,
  H3: 15,
  BODY: 12.5,
  SMALL: 11.5,
  TINY: 10,
  CAPTION: 9.5,
  LABEL: 9,
  NODE: 11.5,
  NODE_SUB: 9,
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Web Community of Practice';
pres.title = 'GraphQL Hive';
pres.subject = 'GraphQL Federation, schema lifecycle and runtime request flow';

const C = pres.SchemeColor;

// ------------------------------------------------------------- helpers
function subtitle(slide, text) {
  slide.addText(text, {
    x: GRID.M, y: GRID.SUB_Y, w: GRID.CW, h: GRID.SUB_H,
    isTextBox: true, margin: 0, fontSize: TYPE.SUB, italic: true, color: C.accent4,
  });
}

function panel(slide, { x, y, w, h, fill = C.background2, name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.07,
    // No shadow. A drop shadow on a pale tint reads as a floating box rather
    // than as a background zone, which is what these panels are for.
    fill: { color: fill }, line: { type: 'none' },
    objectName: name,
  });
}

function bandLabel(slide, { x, y, text, color = C.accent4, w = 2.8 }) {
  slide.addText(text, {
    x, y, w, h: 0.26, isTextBox: true, margin: 0,
    fontSize: TYPE.LABEL, bold: true, charSpacing: 2, color,
  });
}

/** One node function, so every diagram box in the deck matches. */
function node(slide, {
  x, y, w, h = 0.6, label, sub, fill = 'FFFFFF', border = HAIRLINE,
  color = K.dk2, bold = false, name,
}) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill },
    line: border === 'none' ? { type: 'none' } : { color: border, width: 1 },
    objectName: name,
  });
  const runs = sub
    ? [{ text: label, options: { fontSize: TYPE.NODE, bold: true, breakLine: true } },
       { text: sub, options: { fontSize: TYPE.NODE_SUB } }]
    : [{ text: label, options: { fontSize: TYPE.NODE, bold } }];
  slide.addText(runs, {
    x, y, w, h, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', color,
  });
}

function arrowR(slide, { x, y, w = 0.4, color = K.accent4, name }) {
  slide.addShape(pres.ShapeType.rightArrow, {
    x, y, w, h: 0.17, fill: { color }, line: { type: 'none' }, objectName: name,
  });
}
function arrowD(slide, { x, y, h = 0.26, color = K.accent4, name }) {
  slide.addShape(pres.ShapeType.downArrow, {
    x, y, w: 0.17, h, fill: { color }, line: { type: 'none' }, objectName: name,
  });
}

function caption(slide, { x, y, w, text, align = 'center', color = C.accent4, h = 0.26 }) {
  slide.addText(text, {
    x, y, w, h, isTextBox: true, margin: 0,
    fontSize: TYPE.CAPTION, align, color,
  });
}

function stepRow(slide, { x, y, w, n, head, body }) {
  slide.addShape(pres.ShapeType.hexagon, {
    x, y, w: 0.46, h: 0.46, rotate: 90,
    fill: { color: K.accent1 }, line: { type: 'none' }, objectName: `srow-hex-${n}` },
  );
  slide.addText(String(n), {
    x, y, w: 0.46, h: 0.46, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontSize: 12, bold: true, color: 'FFFFFF',
  });
  slide.addText(head, {
    x: x + 0.64, y: y - 0.03, w: w - 0.64, h: 0.28,
    isTextBox: true, margin: 0, fontSize: TYPE.H3 - 1, bold: true, color: C.text1,
  });
  slide.addText(body, {
    x: x + 0.64, y: y + 0.25, w: w - 0.64, h: 0.42,
    isTextBox: true, margin: 0, fontSize: TYPE.SMALL, color: C.accent4,
  });
}

function hexCluster(slide, x, y, size, color, { count = 7, transparency = 55 } = {}) {
  const dx = size * 0.86, dy = size * 0.75;
  [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1], [1, 2], [2, 2]]
    .slice(0, count)
    .forEach(([cx, cy], i) => {
      slide.addShape(pres.ShapeType.hexagon, {
        x: x + cx * dx, y: y + cy * dy, w: size, h: size, rotate: 90,
        fill: { color, transparency: transparency + (i % 3) * 12 },
        line: { type: 'none' }, objectName: `motif-hex-${i}`,
      });
    });
}

// ------------------------------------------------------------- layouts
pres.defineSlideMaster({
  title: 'TITLE_DARK',
  background: { color: K.dk1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: 2.32, w: 8.2, h: 1.5,
      fontSize: 44, bold: true, color: K.lt1, fontFace: THEME.headFontFace,
    }, text: '' } },
    { placeholder: { options: {
      name: 'body', type: 'body', x: M, y: 3.92, w: 8.0, h: 1.0,
      fontSize: 16, color: 'C9CDD4',
    }, text: '' } },
  ],
});

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: K.lt1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: GRID.TITLE_Y, w: GRID.CW, h: GRID.TITLE_H,
      fontSize: TYPE.TITLE, bold: true, color: K.dk1, fontFace: THEME.headFontFace,
      align: 'left', valign: 'middle',
    }, text: '' } },
    { text: { text: 'WebCoP · GraphQL Hive', options: {
      x: M, y: GRID.FOOT_Y, w: 6.0, h: 0.3, isTextBox: true, margin: 0,
      fontSize: TYPE.LABEL, color: K.accent4,
    } } },
  ],
  slideNumber: { x: GRID.RIGHT - 0.5, y: GRID.FOOT_Y, w: 0.5, h: 0.3,
    fontSize: TYPE.LABEL, color: K.accent4, align: 'right' },
});

pres.defineSlideMaster({
  title: 'CLOSE_DARK',
  background: { color: K.dk1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: 0.52, w: GRID.CW, h: 0.8,
      fontSize: TYPE.TITLE, bold: true, color: K.lt1, fontFace: THEME.headFontFace,
      valign: 'middle',
    }, text: '' } },
  ],
});

// =====================================================================
// 1 — Title
// =====================================================================
pres.addSection({ title: 'Opening' });
{
  const s = pres.addSlide({ masterName: 'TITLE_DARK', sectionTitle: 'Opening' });
  hexCluster(s, 9.8, 1.6, 0.9, K.accent1);
  s.addText('WEB COMMUNITY OF PRACTICE', {
    x: M, y: 1.76, w: 6, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 11, bold: true, charSpacing: 3, color: K.accent1,
  });
  s.addText('GraphQL Hive', { placeholder: 'title' });
  s.addText('GraphQL Federation, the schema lifecycle, and how a request is served',
    { placeholder: 'body' });
  s.addText('10–15 minutes  ·  Developers & technical leads', {
    x: M, y: 5.3, w: 7, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 12, color: K.accent4,
  });
  s.addNotes(
    'Three things in this session. One, what GraphQL Federation is and why you would want it. '
    + 'Two, the schema lifecycle: what a developer publishes and what Hive does automatically. '
    + 'Three, what happens at runtime when a query arrives, including caching. '
    + 'Terminology follows the official Hive documentation throughout.',
  );
}

// =====================================================================
// 2 — Why federation
// =====================================================================
pres.addSection({ title: 'Federation' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Federation' });
  s.addText('What GraphQL Federation solves', { placeholder: 'title' });
  subtitle(s, 'Many teams, many services — one schema for the client.');

  const colW = (GRID.CW - GRID.GAP) / 2;
  const colX2 = M + colW + GRID.GAP;

  // Panels run from the body top to just above the definition strip, and the
  // bullets are vertically centred inside them, so neither panel has an empty
  // lower half.
  const panelH = 2.84;
  const bulletOpts = (x) => ({
    x: x + 0.34, y: GRID.BODY_Y + 0.56, w: colW - 0.68, h: panelH - 0.9,
    isTextBox: true, margin: 0, fontSize: 13.5, color: C.text2,
    valign: 'middle', paraSpaceAfter: 11,
  });

  panel(s, { x: M, y: GRID.BODY_Y, w: colW, h: panelH, name: 'p-without' });
  bandLabel(s, { x: M + 0.34, y: GRID.BODY_Y + 0.22, text: 'WITHOUT FEDERATION' });
  s.addText(
    [
      { text: 'One large graph owned by everyone, or several separate graphs', options: { bullet: true, breakLine: true } },
      { text: 'Clients call several endpoints and join the data themselves', options: { bullet: true, breakLine: true } },
      { text: 'One team\'s deploy can break another team\'s fields', options: { bullet: true } },
    ],
    bulletOpts(M),
  );

  panel(s, { x: colX2, y: GRID.BODY_Y, w: colW, h: panelH, fill: TINT_AMBER, name: 'p-with' });
  bandLabel(s, { x: colX2 + 0.34, y: GRID.BODY_Y + 0.22, text: 'WITH FEDERATION', color: K.accent3 });
  s.addText(
    [
      { text: 'Each team owns and deploys its own subgraph independently', options: { bullet: true, breakLine: true } },
      { text: 'Clients see one unified API at a single endpoint', options: { bullet: true, breakLine: true } },
      { text: 'Composition rejects a change that would break the graph', options: { bullet: true } },
    ],
    bulletOpts(colX2),
  );

  const stripY = 4.98;
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: stripY, w: GRID.CW, h: 1.32, rectRadius: 0.07,
    fill: { color: K.dk1 }, line: { type: 'none' }, objectName: 'def-strip',
  });
  s.addText(
    [{ text: 'Federation  ', options: { bold: true, color: K.accent1, fontSize: TYPE.H3 + 1 } },
     { text: 'is an open specification for splitting one GraphQL API across independently deployed services, and resolving a single client query across them at runtime.',
       options: { fontSize: 13.5, color: 'FFFFFF' } }],
    { x: M + 0.4, y: stripY, w: GRID.CW - 0.8, h: 1.32,
      isTextBox: true, margin: 0, valign: 'middle' },
  );

  s.addNotes(
    'The problem is organisational before it is technical. Once more than one team contributes to a graph, '
    + 'a single shared schema becomes both a bottleneck and a shared risk. '
    + 'Federation lets each team own a slice, deploy on its own cadence, and still present one API to clients. '
    + 'The key phrase in the definition is "at runtime" — the gateway resolves one query across several services, '
    + 'so the client never knows how many are behind it.',
  );
}

// =====================================================================
// 3 — Subgraphs and supergraph
// =====================================================================
pres.addSection({ title: 'Composition' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Composition' });
  s.addText('Subgraphs and the supergraph', { placeholder: 'title' });
  subtitle(s, 'Each service publishes its own schema. Hive composes them into one.');

  // The three columns share one top (ROW_Y) and one bottom (ROW_Y + ROW_H), so
  // the composition box spans the whole subgraph stack and every arrow lands on
  // it instead of pointing into empty space.
  const ROW_Y = 2.14;
  const ROW_H = 2.42;
  const CAP_Y = ROW_Y + ROW_H + 0.14;
  const sgPitch = 0.86;
  const sgH = 0.7;

  bandLabel(s, { x: M, y: GRID.BODY_Y, text: 'SUBGRAPHS', color: K.accent3 });
  [['Accounts', 'type Account @key'], ['Policies', 'type Policy @key'], ['Funds', 'type Fund @key']]
    .forEach(([name, key], i) => {
      const y = ROW_Y + i * sgPitch;
      node(s, {
        x: M, y, w: 2.9, h: sgH,
        label: name, sub: key, border: K.accent3, name: `sg-${i}`,
      });
      arrowR(s, { x: M + 3.0, y: y + sgH / 2 - 0.085, w: 0.46,
        color: K.accent3, name: `sg-arrow-${i}` });
    });
  caption(s, { x: M, y: CAP_Y, w: 2.9, align: 'left',
    text: 'Independently owned and deployed' });

  node(s, {
    x: 4.2, y: ROW_Y, w: 2.5, h: ROW_H,
    label: 'Hive composition', sub: 'validates and merges',
    fill: K.accent1, border: 'none', color: 'FFFFFF', name: 'compose',
  });
  caption(s, { x: 4.2, y: CAP_Y, w: 2.5, text: 'Automatic, on publish' });

  arrowR(s, { x: 6.84, y: ROW_Y + ROW_H / 2 - 0.085, w: 0.52,
    color: K.accent1, name: 'compose-arrow' });

  bandLabel(s, { x: 7.56, y: GRID.BODY_Y, text: 'SUPERGRAPH', color: K.accent1 });
  // Sized to its text and centred on the row, rather than stretched to the full
  // row height, which would leave a large empty tint.
  const supH = 1.7;
  node(s, {
    x: 7.56, y: ROW_Y + (ROW_H - supH) / 2, w: 5.15, h: supH,
    label: 'supergraph.graphql',
    sub: 'one schema · every field · which subgraph owns it',
    fill: TINT_AMBER, border: K.accent1, name: 'supergraph',
  });
  caption(s, { x: 7.56, y: CAP_Y, w: 5.15, align: 'left',
    text: 'What the gateway serves. Clients never see it directly.' });

  const noteY = 5.16;
  panel(s, { x: M, y: noteY, w: GRID.CW, h: GRID.BODY_BOTTOM - noteY, name: 'entity-note' });
  s.addText(
    [{ text: 'Entities join the graph.  ', options: { bold: true, color: K.dk1 } },
     { text: 'A type marked ', options: { color: K.dk2 } },
     { text: '@key', options: { fontFace: 'Courier New', color: K.accent3 } },
     { text: ' can be referenced by another subgraph using only that key. The gateway then fetches the remaining fields from whichever subgraph owns them.',
       options: { color: K.dk2 } }],
    { x: M + 0.4, y: noteY, w: GRID.CW - 0.8, h: GRID.BODY_BOTTOM - noteY,
      isTextBox: true, margin: 0, valign: 'middle', fontSize: 13.5 },
  );

  s.addNotes(
    'A subgraph is a normal GraphQL service that adds a few federation directives. It exposes its own schema and nothing else. '
    + 'The supergraph is the composed result: every field from every subgraph, annotated with which subgraph can resolve it. '
    + 'That annotation is exactly what makes query planning possible. '
    + 'The @key directive is the join mechanism — think of it as a primary key other subgraphs can refer to. '
    + 'Stress this: composition happens inside Hive automatically on publish. Nobody writes the supergraph by hand.',
  );
}

// =====================================================================
// 4 — Schema publishing flow
// =====================================================================
pres.addSection({ title: 'Publishing' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Publishing' });
  s.addText('Schema publishing flow', { placeholder: 'title' });
  subtitle(s, 'One command from the developer. Everything after it is automatic.');

  panel(s, { x: M, y: GRID.BODY_Y, w: GRID.CW, h: 1.2, name: 'dev-band' });
  bandLabel(s, { x: M + 0.34, y: GRID.BODY_Y + 0.17, text: 'DEVELOPER', color: K.accent3 });
  node(s, {
    x: M + 0.34, y: GRID.BODY_Y + 0.5, w: 3.2, h: 0.52,
    label: 'hive schema:publish', fill: 'FFFFFF', border: K.accent3,
    color: K.accent3, bold: true, name: 'cli-publish',
  });
  s.addText('Runs in CI after merge, for one subgraph: its SDL and its service URL.', {
    x: M + 3.76, y: GRID.BODY_Y + 0.5, w: GRID.CW - 4.1, h: 0.52,
    isTextBox: true, margin: 0, fontSize: TYPE.BODY, color: C.text2, valign: 'middle',
  });

  arrowD(s, { x: W / 2 - 0.085, y: 3.06, h: 0.22, color: K.accent1, name: 'to-hive' });

  const hiveY = 3.4;
  const hiveH = 1.86;
  panel(s, { x: M, y: hiveY, w: GRID.CW, h: hiveH, fill: TINT_AMBER, name: 'hive-band' });
  bandLabel(s, { x: M + 0.34, y: hiveY + 0.17, text: 'HIVE — AUTOMATIC', color: K.accent1, w: 3.2 });

  const steps = [
    ['Validate', 'parse SDL,\ncheck the spec'],
    ['Compose', 'federation\ncomposition'],
    ['Version', 'store version\n+ history'],
    ['Publish artifact', 'supergraph to CDN\nor artifact endpoint'],
  ];
  const stepW = 2.6, stepGap = 0.48;
  const stepStart = M + 0.32;
  const stepY = hiveY + 0.52;
  const stepH = 1.02;
  steps.forEach(([label, sub], i) => {
    const x = stepStart + i * (stepW + stepGap);
    node(s, {
      x, y: stepY, w: stepW, h: stepH, label, sub,
      fill: 'FFFFFF', border: K.accent1, name: `pub-step-${i}`,
    });
    if (i < steps.length - 1) {
      arrowR(s, { x: x + stepW + 0.04, y: stepY + stepH / 2 - 0.085, w: stepGap - 0.08,
        color: K.accent1, name: `pub-arrow-${i}` });
    }
  });

  arrowD(s, { x: W / 2 - 0.085, y: hiveY + hiveH + 0.1, h: 0.22, color: K.accent2, name: 'to-runtime' });
  node(s, {
    x: 3.9, y: 5.74, w: 5.53, h: 0.56,
    label: 'Gateway or Router polls the artifact and reloads itself',
    fill: 'FFFFFF', border: K.accent2, color: K.accent2, name: 'runtime-pull',
  });

  caption(s, { x: M, y: 6.52, w: GRID.CW, align: 'left', color: K.accent6, h: 0.3,
    text: 'If composition fails, the version is recorded as invalid and the last valid supergraph keeps serving.' });

  s.addNotes(
    'This slide answers "what do I actually do". The developer does one thing: run hive schema:publish from CI, for their subgraph only. '
    + 'Hive then validates the SDL, runs federation composition against every other registered subgraph, '
    + 'stores a new immutable schema version, and publishes the composed supergraph as an artifact. '
    + 'Gateways poll that artifact and reload, so a schema change needs no gateway redeploy. '
    + 'Note the red line: a failed composition does not take production down. Hive records the invalid version for history '
    + 'and keeps serving the last valid supergraph. '
    + 'Accuracy point: the high-availability CDN is a Hive Cloud feature. A self-hosted install serves the same artifacts from its own endpoint.',
  );
}

// =====================================================================
// 5 — Schema checks
// =====================================================================
pres.addSection({ title: 'Schema checks' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Schema checks' });
  s.addText('Schema checks', { placeholder: 'title' });
  subtitle(s, 'Run on the pull request, before anything is published.');

  const lw = 5.2;
  const COL_Y = 2.14;

  bandLabel(s, { x: M, y: GRID.BODY_Y, text: 'WHAT A CHECK RUNS' });
  const chkPitch = 0.96, chkH = 0.66;
  ['Parse the SDL',
   'Validate against the GraphQL spec',
   'Run federation composition',
   'Diff against the last published version']
    .forEach((t, i) => {
      const y = COL_Y + i * chkPitch;
      node(s, {
        x: M, y, w: lw, h: chkH,
        label: t, fill: i === 3 ? TINT_AMBER : 'FFFFFF',
        border: i === 3 ? K.accent1 : HAIRLINE, name: `chk-${i}`,
      });
      if (i < 3) {
        arrowD(s, { x: M + lw / 2 - 0.085, y: y + chkH + 0.07, h: 0.16,
          name: `chk-arrow-${i}` });
      }
    });
  caption(s, { x: M, y: COL_Y + 4 * chkPitch - 0.14, w: lw, align: 'left',
    text: 'Triggered by hive schema:check in CI' });

  const rx = M + lw + GRID.GAP;
  const rw = GRID.CW - lw - GRID.GAP;
  bandLabel(s, { x: rx, y: GRID.BODY_Y, text: 'HOW A CHANGE IS CLASSIFIED', w: 4.2 });
  const sevPitch = 1.06, sevH = 0.92;
  [['SAFE', 'Does not break existing clients.', K.accent5],
   ['DANGEROUS', 'May break clients that are not future-proof, such as an unhandled new enum value.', AMBER_DARK],
   ['BREAKING', 'Will break existing client operations.', K.accent6]]
    .forEach(([name, desc, col], i) => {
      const y = COL_Y + i * sevPitch;
      panel(s, { x: rx, y, w: rw, h: sevH, name: `sev-${i}` });
      s.addShape(pres.ShapeType.roundRect, {
        x: rx + 0.24, y: y + 0.24, w: 1.5, h: 0.44, rectRadius: 0.06,
        fill: { color: col }, line: { type: 'none' }, objectName: `sev-chip-${i}`,
      });
      s.addText(name, {
        x: rx + 0.24, y: y + 0.24, w: 1.5, h: 0.44, isTextBox: true, margin: 0,
        align: 'center', valign: 'middle', fontSize: TYPE.TINY, bold: true, color: 'FFFFFF',
      });
      s.addText(desc, {
        x: rx + 1.94, y: y + 0.12, w: rw - 2.18, h: sevH - 0.24, isTextBox: true, margin: 0,
        fontSize: TYPE.BODY, color: C.text2, valign: 'middle',
      });
    });

  const cbcY = COL_Y + 3 * sevPitch + 0.18;
  panel(s, { x: rx, y: cbcY, w: rw, h: GRID.BODY_BOTTOM - cbcY, fill: TINT_AMBER, name: 'cbc-note' });
  s.addText(
    [{ text: 'Conditional breaking changes:  ', options: { bold: true } },
     { text: 'Hive can use collected usage data, so removing a field that no client requests is not reported as breaking.', options: {} }],
    { x: rx + 0.3, y: cbcY, w: rw - 0.6, h: GRID.BODY_BOTTOM - cbcY,
      isTextBox: true, margin: 0, valign: 'middle', fontSize: TYPE.BODY, color: C.text2 },
  );

  s.addNotes(
    'Checks are the governance payoff. They run on the pull request, so a breaking change is caught in review rather than in an incident. '
    + 'Four stages: parse, validate against the spec, compose against the other subgraphs, then diff against the last published version. '
    + 'The three severities are Hive\'s own classification: SAFE, DANGEROUS and BREAKING. '
    + 'DANGEROUS is the one worth explaining — a change that only breaks clients that were not written defensively, '
    + 'the textbook case being a new enum value an older client does not handle. '
    + 'Conditional breaking changes is the clever part: because Hive collects usage, it can tell you a field removal is safe '
    + 'because nothing has actually queried it. A breaking change can also be approved deliberately in the Console.',
  );
}

// =====================================================================
// 6 — Hive Console workflow
// =====================================================================
pres.addSection({ title: 'Console' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Console' });
  s.addText('Working in Hive Console', { placeholder: 'title' });
  subtitle(s, 'Where schema governance happens day to day.');

  const lw = 7.1;
  [[1, 'Register the subgraph', 'Create the project and target, then publish the first schema from CI.'],
   [2, 'Review schema checks', 'Each pull request gets a check result with the classified change list.'],
   [3, 'Confirm composition', 'See whether the subgraph still composes with every other subgraph.'],
   [4, 'Browse schema history', 'Every published version, diffable, with who changed what and when.'],
   [5, 'Monitor usage', 'Per-field and per-client traffic, which shows what is safe to retire.']]
    .forEach(([n, head, body], i) => {
      stepRow(s, { x: M, y: GRID.BODY_Y + i * 0.94, w: lw, n, head, body });
    });

  const rx = M + lw + GRID.GAP;
  const rw = GRID.CW - lw - GRID.GAP;
  panel(s, { x: rx, y: GRID.BODY_Y, w: rw, h: GRID.BODY_BOTTOM - GRID.BODY_Y,
    name: 'console-mock' });
  s.addText('Schema history', {
    x: rx + 0.3, y: GRID.BODY_Y + 0.24, w: rw - 0.6, h: 0.32,
    isTextBox: true, margin: 0, fontSize: TYPE.H3, bold: true, color: C.text1,
  });
  const rowW = rw - 0.6;
  [['v14', 'accounts', 'SAFE', K.accent5],
   ['v13', 'policies', 'DANGEROUS', AMBER_DARK],
   ['v12', 'funds', 'SAFE', K.accent5],
   ['v11', 'accounts', 'BREAKING', K.accent6]]
    .forEach(([v, sub, sev, col], i) => {
      const y = GRID.BODY_Y + 0.72 + i * 0.68;
      s.addShape(pres.ShapeType.roundRect, {
        x: rx + 0.3, y, w: rowW, h: 0.52, rectRadius: 0.05,
        fill: { color: 'FFFFFF' }, line: { color: 'E3E5E9', width: 1 },
        objectName: `hist-${i}`,
      });
      s.addText(v, { x: rx + 0.48, y, w: 0.56, h: 0.52, isTextBox: true, margin: 0,
        valign: 'middle', fontSize: TYPE.SMALL, bold: true, color: C.text1 });
      s.addText(sub, { x: rx + 1.06, y, w: 1.2, h: 0.52, isTextBox: true, margin: 0,
        valign: 'middle', fontSize: TYPE.TINY, color: C.accent4 });
      s.addText(sev, { x: rx + 2.26, y, w: rowW - 2.14, h: 0.52, isTextBox: true, margin: 0,
        valign: 'middle', align: 'right', fontSize: TYPE.TINY, bold: true, color: col });
    });
  caption(s, { x: rx + 0.3, y: GRID.BODY_Y + 3.5, w: rw - 0.6, align: 'left',
    text: 'Illustrative. Every version is kept and diffable.' });
  s.addText('Self-hosted and MIT licensed, so schemas and usage data can stay on your own infrastructure.', {
    x: rx + 0.3, y: GRID.BODY_Y + 3.88, w: rw - 0.6, h: 0.62, isTextBox: true, margin: 0,
    fontSize: TYPE.SMALL, bold: true, color: K.accent1,
  });

  s.addNotes(
    'The Console is the human side of the registry. Walk the five steps quickly — the audience will recognise a normal PR workflow. '
    + 'Steps 2 and 3 are what change behaviour: the check result appears on the pull request, and composition is verified against every '
    + 'other subgraph, not only the one being changed. '
    + 'Step 5 closes the loop, because usage data is what makes conditional breaking changes work and what lets you retire a field with confidence. '
    + 'The history panel is illustrative, not a screenshot.',
  );
}

// =====================================================================
// 7 — Federation request flow
// =====================================================================
pres.addSection({ title: 'Runtime' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('Federation request flow', { placeholder: 'title' });
  subtitle(s, 'One query in, one response out. The client sees a single API.');

  // The gateway panel is the tallest element; everything else is centred on its
  // mid-line (MID) so the whole flow reads as one horizontal band. The panel is
  // sized from its contents, so no inner box pokes out of the bottom.
  const gwY = 1.94;
  const gwH = 3.24;
  const MID = gwY + gwH / 2;
  const AY = MID - 0.085; // arrow centre-line

  node(s, { x: M, y: MID - 0.36, w: 1.6, h: 0.72, label: 'Client', sub: '1 query',
    name: 'f-client' });
  arrowR(s, { x: M + 1.72, y: AY, w: 0.42, name: 'f-a1' });

  panel(s, { x: 2.8, y: gwY, w: 3.4, h: gwH, fill: TINT_TEAL, name: 'f-gw-panel' });
  bandLabel(s, { x: 2.98, y: gwY + 0.16, text: 'GATEWAY OR ROUTER', color: K.accent2, w: 3.1 });
  node(s, { x: 2.98, y: gwY + 0.52, w: 3.04, h: 0.56, label: 'Parse & validate',
    fill: 'FFFFFF', border: K.accent2, name: 'f-parse' });
  arrowD(s, { x: 4.41, y: gwY + 1.16, h: 0.16, color: K.accent2, name: 'f-a2' });
  node(s, { x: 2.98, y: gwY + 1.4, w: 3.04, h: 0.74, label: 'Query planning',
    sub: 'which subgraph, in what order', fill: K.accent2, border: 'none',
    color: 'FFFFFF', name: 'f-plan' });
  arrowD(s, { x: 4.41, y: gwY + 2.22, h: 0.16, color: K.accent2, name: 'f-a3' });
  node(s, { x: 2.98, y: gwY + 2.46, w: 3.04, h: 0.56, label: 'Merge into one response',
    fill: 'FFFFFF', border: K.accent2, name: 'f-merge' });

  arrowR(s, { x: 6.32, y: AY, w: 0.46, color: K.accent2, name: 'f-a4' });
  caption(s, { x: 6.2, y: AY - 0.32, w: 0.78, text: 'fetches' });

  const sgPitch = 0.92, sgH = 0.64;
  ['Accounts', 'Policies', 'Funds'].forEach((name, i) => {
    node(s, { x: 6.98, y: MID - 1.5 * sgPitch + 0.14 + i * sgPitch, w: 2.4, h: sgH,
      label: name, border: K.accent3, name: `f-sg-${i}` });
  });

  arrowR(s, { x: 9.52, y: AY, w: 0.44, color: K.accent3, name: 'f-a5' });
  node(s, { x: 10.1, y: MID - 0.72, w: 2.61, h: 1.44,
    label: 'Combined response', sub: 'exactly the fields\nthe client asked for',
    fill: TINT_AMBER, border: K.accent1, name: 'f-response' });

  const fnY = 5.42;
  panel(s, { x: M, y: fnY, w: GRID.CW, h: GRID.BODY_BOTTOM - fnY, name: 'f-note' });
  s.addText(
    [{ text: 'Query planning is the core of it.  ', options: { bold: true, color: K.dk1 } },
     { text: 'The gateway reads the supergraph to work out which subgraphs resolve which fields, fetches entity data across them, and assembles one result.',
       options: { color: K.dk2 } }],
    { x: M + 0.4, y: fnY, w: GRID.CW - 0.8, h: GRID.BODY_BOTTOM - fnY,
      isTextBox: true, margin: 0, valign: 'middle', fontSize: 13.5 },
  );

  s.addNotes(
    'Follow the arrows left to right. A query arrives at the gateway, and is parsed and validated against the supergraph. '
    + 'The planner then decides which subgraphs are needed and in what order. Order matters, because resolving an entity '
    + 'often needs a key that came back from an earlier fetch. '
    + 'The gateway issues those subgraph fetches, merges the results, and returns one response shaped exactly like the query. '
    + 'Either runtime does this: Hive Gateway on Node, or Hive Router in Rust. '
    + 'The point to stress is that all of this fan-out is invisible to the client, which made exactly one request.',
  );
}

// =====================================================================
// 8 — Caching architecture
// =====================================================================
pres.addSection({ title: 'Caching' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Caching' });
  s.addText('Caching architecture', { placeholder: 'title' });
  subtitle(s, 'Two different caches, at two different layers.');

  panel(s, { x: M, y: GRID.BODY_Y, w: GRID.CW, h: 2.68, fill: TINT_TEAL, name: 'cache-l1' });
  bandLabel(s, { x: M + 0.34, y: GRID.BODY_Y + 0.14,
    // w sized to the text, not the panel: a wider box runs under the HIT node.
    text: 'LAYER 1 — GATEWAY RESPONSE CACHE', color: K.accent2, w: 3.5 });

  const rowH = 0.56;
  const missY = 3.3;          // the miss path, and the main request row
  const hitY = missY - 1.08;  // the hit path, one row above
  const reqY = (hitY + missY) / 2;

  node(s, { x: M + 0.34, y: reqY, w: 1.4, h: rowH, label: 'Request', name: 'c-req' });
  arrowR(s, { x: M + 1.86, y: reqY + rowH / 2 - 0.085, w: 0.36, color: K.accent2, name: 'c-a1' });
  node(s, { x: 2.56, y: reqY, w: 1.72, h: rowH, label: 'Cache lookup',
    fill: K.accent2, border: 'none', color: 'FFFFFF', name: 'c-lookup' });

  // HIT
  arrowR(s, { x: 4.4, y: hitY + rowH / 2 - 0.085, w: 0.36, color: K.accent5, name: 'c-hit-a' });
  node(s, { x: 4.88, y: hitY, w: 1.3, h: rowH, label: 'HIT',
    fill: K.accent5, border: 'none', color: 'FFFFFF', name: 'c-hit' });
  s.addText('Returns immediately. No query planning, no subgraph calls.', {
    x: 6.34, y: hitY, w: 6.04, h: rowH, isTextBox: true, margin: 0,
    fontSize: TYPE.BODY, color: K.accent5, valign: 'middle',
  });

  // MISS
  arrowR(s, { x: 4.4, y: missY + rowH / 2 - 0.085, w: 0.36, color: K.accent6, name: 'c-miss-a' });
  node(s, { x: 4.88, y: missY, w: 1.3, h: rowH, label: 'MISS',
    fill: K.accent6, border: 'none', color: 'FFFFFF', name: 'c-miss' });
  arrowR(s, { x: 6.3, y: missY + rowH / 2 - 0.085, w: 0.32, color: K.accent6, name: 'c-miss-a2' });
  node(s, { x: 6.74, y: missY, w: 2.1, h: rowH, label: 'Execute query plan',
    border: K.accent2, name: 'c-exec' });
  arrowR(s, { x: 8.96, y: missY + rowH / 2 - 0.085, w: 0.32, color: K.accent2, name: 'c-miss-a3' });
  node(s, { x: 9.4, y: missY, w: 3.0, h: rowH, label: 'Store in cache, then return',
    fill: TINT_AMBER, border: K.accent1, name: 'c-store' });

  caption(s, { x: M + 0.34, y: 4.02, w: GRID.CW - 0.68, align: 'left',
    color: C.text2,
    text: 'Caches the whole GraphQL response, keyed per operation and variables, with a TTL and entity-aware invalidation.' });

  const l2Y = 4.66;
  panel(s, { x: M, y: l2Y, w: GRID.CW, h: GRID.BODY_BOTTOM - l2Y, name: 'cache-l2' });
  bandLabel(s, { x: M + 0.34, y: l2Y + 0.14,
    text: 'LAYER 2 — SUBGRAPH / BACKEND DATA CACHE', color: K.accent3, w: 5.4 });
  ['Accounts', 'Policies', 'Funds'].forEach((name, i) => {
    node(s, { x: M + 0.34 + i * 2.4, y: l2Y + 0.56, w: 2.2, h: 0.62,
      label: name, border: K.accent3, name: `c-sg-${i}` });
  });
  s.addText('Each service caches its own data in its own store. Owned by that team, invisible to the gateway, and untouched by a gateway cache purge.', {
    x: M + 7.5, y: l2Y + 0.48, w: GRID.CW - 7.84, h: 0.78,
    isTextBox: true, margin: 0, fontSize: TYPE.SMALL, color: C.text2, valign: 'middle',
  });

  caption(s, { x: M, y: 6.44, w: GRID.CW, align: 'left', color: K.accent6, h: 0.3,
    text: 'Response caching is a Hive Gateway feature. Hive Router does not cache responses today.' });

  s.addNotes(
    'Keep the two layers apart, because people conflate them. '
    + 'Layer one lives in the gateway and caches the finished GraphQL response. A hit returns before query planning and before any subgraph '
    + 'is touched, so this is the layer that actually removes load from your backends. Keyed by operation and variables, with a TTL, '
    + 'and invalidatable per entity when the underlying data changes. '
    + 'Layer two is whatever each subgraph does internally — its own Redis, its own query cache. The gateway cannot see it, and purging '
    + 'the gateway cache does not clear it. '
    + 'One accuracy point worth being explicit about: response caching is a Hive Gateway capability. Hive Router has no response cache today. '
    + 'Its cache settings cover parsing, validation and query plans, which make planning cheaper but do not remove a single subgraph call.',
  );
}

// =====================================================================
// 9 — End-to-end architecture
// =====================================================================
pres.addSection({ title: 'End to end' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'End to end' });
  s.addText('End-to-end architecture', { placeholder: 'title' });
  subtitle(s, 'Design time on the left, Hive in the middle, runtime on the right.');

  const colW = 3.6;
  const c1 = M;
  const c2 = M + colW + 0.62;
  const c3 = M + 2 * (colW + 0.62);

  // All three columns are the same height and bottom out on the body baseline,
  // and every box inside them sits on the same row pitch.
  const panH = GRID.BODY_BOTTOM - GRID.BODY_Y;
  const inX = 0.26;
  const inW = colW - 2 * inX;
  const rowY = GRID.BODY_Y + 0.56;
  const rowPitch = 0.76;
  const rowH = 0.62;
  const capY = GRID.BODY_BOTTOM - 0.6;
  const arrowY = GRID.BODY_Y + panH / 2 - 0.085;

  // design time
  panel(s, { x: c1, y: GRID.BODY_Y, w: colW, h: panH, name: 'e2e-design' });
  bandLabel(s, { x: c1 + inX, y: GRID.BODY_Y + 0.17, text: 'DESIGN TIME', color: K.accent3 });
  ['Accounts subgraph', 'Policies subgraph', 'Funds subgraph'].forEach((n, i) => {
    node(s, { x: c1 + inX, y: rowY + i * rowPitch, w: inW, h: rowH,
      label: n, border: K.accent3, name: `e2e-sg-${i}` });
  });
  node(s, { x: c1 + inX, y: rowY + 3 * rowPitch, w: inW, h: rowH,
    label: 'CI: publish + check', fill: 'FFFFFF', border: K.accent3,
    color: K.accent3, bold: true, name: 'e2e-ci' });
  caption(s, { x: c1 + inX, y: capY, w: inW, align: 'left',
    text: 'Teams own and deploy these' });

  arrowR(s, { x: c1 + colW + 0.08, y: arrowY, w: 0.46, color: K.accent1, name: 'e2e-a1' });

  // hive
  panel(s, { x: c2, y: GRID.BODY_Y, w: colW, h: panH, fill: TINT_AMBER, name: 'e2e-hive' });
  bandLabel(s, { x: c2 + inX, y: GRID.BODY_Y + 0.17, text: 'HIVE', color: K.accent1 });
  ['Schema registry', 'Composition', 'Supergraph artifact', 'Console & analytics']
    .forEach((n, i) => {
      node(s, { x: c2 + inX, y: rowY + i * rowPitch, w: inW, h: rowH,
        label: n, fill: 'FFFFFF', border: K.accent1, name: `e2e-hive-${i}` });
    });
  caption(s, { x: c2 + inX, y: capY, w: inW, align: 'left',
    text: 'Validates and composes automatically' });

  arrowR(s, { x: c2 + colW + 0.08, y: arrowY, w: 0.46, color: K.accent2, name: 'e2e-a2' });

  // runtime
  panel(s, { x: c3, y: GRID.BODY_Y, w: colW, h: panH, fill: TINT_TEAL, name: 'e2e-runtime' });
  bandLabel(s, { x: c3 + inX, y: GRID.BODY_Y + 0.17, text: 'RUNTIME', color: K.accent2 });
  [['Gateway / Router', K.accent2, 'FFFFFF', 'none'],
   ['Response cache', 'FFFFFF', K.dk2, K.accent1],
   ['Clients', 'FFFFFF', K.dk2, K.accent2]]
    .forEach(([label, fill, color, border], i) => {
      node(s, { x: c3 + inX, y: rowY + i * rowPitch, w: inW, h: rowH,
        label, fill, color, border, name: `e2e-rt-${i}` });
    });
  s.addText('Usage reports flow back to Hive, feeding analytics and conditional breaking changes.', {
    x: c3 + inX, y: rowY + 3 * rowPitch, w: inW, h: rowH, isTextBox: true, margin: 0,
    fontSize: TYPE.SMALL, color: K.accent2, valign: 'middle',
  });
  caption(s, { x: c3 + inX, y: capY, w: inW, align: 'left',
    text: 'Pulls the supergraph, serves queries' });

  s.addNotes(
    'This is the whole picture on one slide. Use it to recap. '
    + 'Left: teams own their subgraphs, and CI publishes and checks them. '
    + 'Middle: Hive validates, composes, versions and publishes the supergraph artifact, and surfaces all of it in the Console. '
    + 'Right: the gateway pulls that artifact, serves client queries, and caches responses. '
    + 'The loop closes with usage reports flowing back from the gateway into Hive, which is what powers analytics '
    + 'and lets Hive judge whether a change is genuinely breaking. '
    + 'Nothing in the middle column is manual.',
  );
}

// =====================================================================
// 10 — Takeaways
// =====================================================================
pres.addSection({ title: 'Close' });
{
  const s = pres.addSlide({ masterName: 'CLOSE_DARK', sectionTitle: 'Close' });
  s.addText('Takeaways', { placeholder: 'title' });
  hexCluster(s, 11.3, 5.0, 0.6, K.accent1, { count: 5, transparency: 62 });

  [['Federation splits the graph, not the API',
    'Each team owns a subgraph and deploys independently. Clients still see one endpoint.'],
   ['Publishing is one command; Hive does the rest',
    'Validation, composition, versioning and artifact publishing all happen automatically.'],
   ['Checks move breakage left',
    'Changes are classified SAFE, DANGEROUS or BREAKING on the pull request, using real usage data.'],
   ['Caching belongs at the gateway',
    'A response-cache hit returns before planning and before any subgraph is called.']]
    .forEach(([head, body], i) => {
      const y = 1.82 + i * 1.14;
      s.addShape(pres.ShapeType.hexagon, {
        x: M, y, w: 0.46, h: 0.46, rotate: 90,
        fill: { color: K.accent1 }, line: { type: 'none' }, objectName: `t-hex-${i}` },
      );
      s.addText(String(i + 1), {
        x: M, y, w: 0.46, h: 0.46, isTextBox: true, margin: 0,
        align: 'center', valign: 'middle', fontSize: 13, bold: true, color: K.dk1,
      });
      s.addText(head, {
        x: M + 0.68, y: y - 0.04, w: 9.9, h: 0.32, isTextBox: true, margin: 0,
        fontSize: TYPE.H3 + 1, bold: true, color: 'FFFFFF',
      });
      s.addText(body, {
        x: M + 0.68, y: y + 0.3, w: 9.9, h: 0.44, isTextBox: true, margin: 0,
        fontSize: TYPE.BODY, color: 'C9CDD4',
      });
    });

  s.addText('Documentation:  the-guild.dev/graphql/hive/docs', {
    x: M, y: 6.5, w: 8, h: 0.3, isTextBox: true, margin: 0,
    fontSize: TYPE.SMALL, color: K.accent1,
  });

  s.addNotes(
    'Four takeaways, one per concept. '
    + 'One: federation is about team autonomy without fragmenting the client experience. '
    + 'Two: the developer workflow is genuinely one command, and everything downstream is automatic. '
    + 'Three: schema checks are the governance payoff, and the usage-data angle makes them more accurate than a naive diff. '
    + 'Four: the gateway response cache is the layer that removes backend load. A subgraph\'s own cache is a separate concern. '
    + 'Then open for questions.',
  );
}

// ------------------------------------------------------------- write
(async () => {
  const out = 'WebCoP-Hive-GraphQL.pptx';
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log('wrote', out);
})();
