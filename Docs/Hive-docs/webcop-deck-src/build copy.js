/**
 * WebCoP session deck: GraphQL Hive
 * Regenerate:  node build.js   ->  WebCoP-Hive-GraphQL.pptx
 *
 * All figures come from the two POCs in this repo (hive-poc, hive-router-poc)
 * and were measured, not estimated.
 */
const pptxgen = require('pptxgenjs');
const { applyTheme } = require(process.env.PPTX_SKILL + '/scripts/apply_theme.js');

// ---------------------------------------------------------------- theme
// Honey/amber against near-black: the "hive" motif, deliberately not default blue.
const THEME = {
  name: 'HiveWebCoP',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1B1B26', // near-black, dominant on dark slides
    lt1: 'FFFFFF',
    dk2: '3C4656', // slate, body text on light
    lt2: 'F3F4F6', // light grey, card fills
    accent1: 'D8912F', // honey  — the motif colour
    accent2: '21737A', // teal   — Router
    accent3: 'B05A22', // burnt  — Gateway
    accent4: '6B7688', // muted  — captions
    accent5: '2E7D52', // green  — benefits / verified
    accent6: '9B2C2C', // red    — limitations
    hlink: 'D8912F',
    folHlink: 'B05A22',
  },
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.3 x 7.5 — must be set before any addSlide
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Web Community of Practice';
pres.title = 'GraphQL Hive';
pres.subject = 'Hive Gateway, Router and Console — evaluation findings';

const C = pres.SchemeColor;
const W = 13.3;
const H = 7.5;
const M = 0.62; // page margin

// ------------------------------------------------------------- helpers
/** A honeycomb cluster, used as the recurring motif. Fresh objects each call. */
function hexCluster(slide, x, y, size, color, opts = {}) {
  const { count = 7, transparency = 0 } = opts;
  const dx = size * 0.86;
  const dy = size * 0.75;
  const cells = [
    [0, 0], [1, 0], [2, 0],
    [0.5, 1], [1.5, 1],
    [1, 2], [2, 2],
  ].slice(0, count);
  cells.forEach(([cx, cy], i) => {
    slide.addShape(pres.ShapeType.hexagon, {
      x: x + cx * dx,
      y: y + cy * dy,
      w: size,
      h: size,
      fill: { color, transparency: transparency + (i % 3) * 12 },
      line: { type: 'none' },
      rotate: 90,
      objectName: `motif-hex-${i}`,
    });
  });
}

/** Numbered hexagon badge + heading + supporting line. */
function hexRow(slide, { x, y, w, badge, head, body, badgeColor = C.accent1 }) {
  slide.addShape(pres.ShapeType.hexagon, {
    x, y, w: 0.52, h: 0.52, rotate: 90,
    fill: { color: badgeColor }, line: { type: 'none' },
    objectName: `row-badge-${badge}`,
  });
  slide.addText(badge, {
    x, y, w: 0.52, h: 0.52, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontSize: 13, bold: true, color: C.background1,
  });
  slide.addText(head, {
    x: x + 0.72, y: y - 0.04, w: w - 0.72, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 15, bold: true, color: C.text1,
  });
  slide.addText(body, {
    x: x + 0.72, y: y + 0.26, w: w - 0.72, h: 0.52, isTextBox: true, margin: 0,
    fontSize: 12, color: C.accent4,
  });
}

/** Soft card with a subtle tint and shadow — no edge stripes. */
function card(slide, { x, y, w, h, fill = C.background2, name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: fill },
    line: { type: 'none' },
    shadow: { type: 'outer', color: '1B1B26', opacity: 0.08, blur: 8, offset: 1, angle: 90 },
    objectName: name,
  });
}

/** Big number + small label. */
function stat(slide, { x, y, w, value, label, color = C.accent1, size = 40 }) {
  slide.addText(value, {
    x, y, w, h: 0.66, isTextBox: true, margin: 0,
    fontSize: size, bold: true, color, align: 'center', fontFace: THEME.headFontFace,
  });
  slide.addText(label, {
    x, y: y + 0.68, w, h: 0.46, isTextBox: true, margin: 0,
    fontSize: 11, color: C.accent4, align: 'center',
  });
}

// ------------------------------------------------------------- layouts
const FOOTER = 'WebCoP · GraphQL Hive · internal evaluation';

pres.defineSlideMaster({
  title: 'TITLE_DARK',
  background: { color: THEME.colors.dk1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: 2.35, w: 8.2, h: 1.5,
      fontSize: 44, bold: true, color: THEME.colors.lt1, fontFace: THEME.headFontFace,
    }, text: '' } },
    { placeholder: { options: {
      name: 'body', type: 'body', x: M, y: 3.95, w: 7.9, h: 1.0,
      fontSize: 16, color: 'C9CDD4',
    }, text: '' } },
  ],
});

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: THEME.colors.lt1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: 0.46, w: W - 2 * M, h: 0.72,
      fontSize: 30, bold: true, color: THEME.colors.dk1, fontFace: THEME.headFontFace,
      align: 'left', valign: 'middle',
    }, text: '' } },
    { text: { text: FOOTER, options: {
      x: M, y: H - 0.48, w: 7.5, h: 0.3, isTextBox: true, margin: 0,
      fontSize: 9, color: THEME.colors.accent4,
    } } },
  ],
  slideNumber: { x: W - M - 0.5, y: H - 0.48, w: 0.5, h: 0.3,
    fontSize: 9, color: THEME.colors.accent4, align: 'right' },
});

pres.defineSlideMaster({
  title: 'CLOSE_DARK',
  background: { color: THEME.colors.dk1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: 0.52, w: W - 2 * M, h: 0.8,
      fontSize: 30, bold: true, color: THEME.colors.lt1, fontFace: THEME.headFontFace,
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
  hexCluster(s, 9.6, 1.5, 0.92, THEME.colors.accent1, { transparency: 55 });

  s.addText('WEB COMMUNITY OF PRACTICE', {
    x: M, y: 1.78, w: 6, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 11, bold: true, charSpacing: 3, color: THEME.colors.accent1,
  });
  s.addText('GraphQL Hive', { placeholder: 'title' });
  s.addText(
    'Schema registry, gateway and router — plus what two hands-on POCs actually showed',
    { placeholder: 'body' },
  );
  s.addText('10–15 minutes  ·  Developers & technical leads', {
    x: M, y: 5.35, w: 7, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 12, color: THEME.colors.accent4,
  });
  s.addNotes(
    'Framing: this is not a product tour. Hive is an open-source GraphQL platform from The Guild. '
    + 'We evaluated it to replace Grafbase for putting one GraphQL API in front of three REST services. '
    + 'I will cover what Hive is, how it works, the Gateway vs Router split, and then the numbers from our own POCs. '
    + 'Everything with a number on it we measured ourselves.',
  );
}

// =====================================================================
// 2 — What is Hive and why
// =====================================================================
pres.addSection({ title: 'Introduction' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Introduction' });
  s.addText('What is GraphQL Hive', { placeholder: 'title' });

  s.addText('An open-source platform for running GraphQL in production — registry, gateway and router.', {
    x: M, y: 1.2, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 14, italic: true, color: C.accent4,
  });

  // left: the problem
  card(s, { x: M, y: 1.78, w: 5.72, h: 2.72, name: 'card-problem' });
  s.addText('The problem we had', {
    x: M + 0.3, y: 1.98, w: 5.1, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 15, bold: true, color: C.text1,
  });
  s.addText(
    [
      { text: 'Three REST APIs: accounts, policies, funds', options: { bullet: true, breakLine: true } },
      { text: 'Clients make three calls and join data themselves', options: { bullet: true, breakLine: true } },
      { text: 'No shared schema, no usage visibility', options: { bullet: true, breakLine: true } },
      { text: 'Repeat reads hit the same REST endpoints', options: { bullet: true } },
    ],
    { x: M + 0.3, y: 2.38, w: 5.12, h: 1.92, isTextBox: true, margin: 0,
      fontSize: 12.5, color: C.text2, paraSpaceAfter: 7 },
  );

  // right: what Hive gives
  card(s, { x: 6.96, y: 1.78, w: 5.72, h: 2.72, fill: 'FBF3E4', name: 'card-hive' });
  s.addText('What Hive gives us', {
    x: 7.26, y: 1.98, w: 5.1, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 15, bold: true, color: C.text1,
  });
  s.addText(
    [
      { text: 'One GraphQL endpoint over all three services', options: { bullet: true, breakLine: true } },
      { text: 'Central schema registry with checks on change', options: { bullet: true, breakLine: true } },
      { text: 'Usage analytics per field and per client', options: { bullet: true, breakLine: true } },
      { text: 'Response caching in Redis or Valkey', options: { bullet: true } },
    ],
    { x: 7.26, y: 2.38, w: 5.12, h: 1.92, isTextBox: true, margin: 0,
      fontSize: 12.5, color: C.text2, paraSpaceAfter: 7 },
  );

  // three facts
  stat(s, { x: M, y: 4.86, w: 3.9, value: 'MIT', label: 'Fully open source, self-hostable' });
  stat(s, { x: 4.7, y: 4.86, w: 3.9, value: 'Federation', label: 'Open spec, no vendor runtime lock-in', size: 30 });
  stat(s, { x: 8.78, y: 4.86, w: 3.9, value: 'The Guild', label: 'Maintainers of Yoga, Mesh, Codegen', size: 30 });

  s.addNotes(
    'Hive is The Guild\'s GraphQL platform. Three things matter for us. '
    + 'One, it is MIT licensed end to end, so we can self-host and keep schemas internal. '
    + 'Two, it speaks standard Apollo Federation, so the supergraph is portable to other routers. '
    + 'Three, it is from the team behind GraphQL Yoga, Mesh and Codegen, which most of us already use. '
    + 'Contrast with Grafbase, which we trialled first: source-available, and its caching could not do what we needed.',
  );
}

// =====================================================================
// 3 — Key components
// =====================================================================
pres.addSection({ title: 'Components' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Components' });
  s.addText('Key components', { placeholder: 'title' });
  s.addText('Six pieces. We only need the ones that fit the job.', {
    x: M, y: 1.2, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 14, italic: true, color: C.accent4,
  });

  const comps = [
    ['Hive Console', 'Web UI: schema registry, checks, usage analytics. MIT, self-hostable.', C.accent1],
    ['Schema Registry', 'Stores every schema version. Serves the supergraph to gateways.', C.accent1],
    ['Hive Gateway', 'Node.js runtime. Serves the supergraph, caches responses, can call REST.', C.accent3],
    ['Hive Router', 'Rust runtime. Fast federation routing. GraphQL subgraphs only.', C.accent2],
    ['GraphQL Mesh', 'Build-time: turns OpenAPI specs into GraphQL. No code written.', C.accent1],
    ['Hive CLI', 'Publishes schemas and runs checks from CI.', C.accent4],
  ];

  const cw = 3.70, ch = 1.52, gx = 0.45, gy = 0.34;
  comps.forEach(([name, desc, col], i) => {
    const cx = M + (i % 3) * (cw + gx);
    const cy = 1.82 + Math.floor(i / 3) * (ch + gy);
    card(s, { x: cx, y: cy, w: cw, h: ch, name: `comp-${i}` });
    s.addShape(pres.ShapeType.hexagon, {
      x: cx + 0.26, y: cy + 0.26, w: 0.4, h: 0.4, rotate: 90,
      fill: { color: col }, line: { type: 'none' }, objectName: `comp-hex-${i}`,
    });
    s.addText(name, {
      x: cx + 0.78, y: cy + 0.24, w: cw - 1.0, h: 0.3, isTextBox: true, margin: 0,
      fontSize: 14, bold: true, color: C.text1,
    });
    s.addText(desc, {
      x: cx + 0.26, y: cy + 0.68, w: cw - 0.52, h: 0.68, isTextBox: true, margin: 0,
      fontSize: 11.5, color: C.text2,
    });
  });

  s.addText('Amber = we used it  ·  Burnt orange = Gateway POC  ·  Teal = Router POC', {
    x: M, y: 5.62, w: W - 2 * M, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 10.5, color: C.accent4,
  });

  s.addNotes(
    'Console and Registry are the platform side: where schemas live and where you see usage. '
    + 'Gateway and Router are two different runtimes that serve traffic — that choice is slide 7 and it matters a lot. '
    + 'Mesh is the piece people miss: it converts our existing OpenAPI files into GraphQL at build time, so we wrote no mapping code in the Gateway POC. '
    + 'CLI is what CI uses to publish and check schemas.',
  );
}

// =====================================================================
// 4 — How Hive works (architecture + flow)
// =====================================================================
pres.addSection({ title: 'Architecture' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Architecture' });
  s.addText('How it works', { placeholder: 'title' });
  s.addText('Two phases: compose once at build time, then serve and cache at runtime.', {
    x: M, y: 1.2, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 14, italic: true, color: C.accent4,
  });

  // ---- build-time band
  card(s, { x: M, y: 1.76, w: W - 2 * M, h: 1.22, name: 'band-build' });
  s.addText('BUILD TIME', {
    x: M + 0.26, y: 1.9, w: 1.8, h: 0.26, isTextBox: true, margin: 0,
    fontSize: 10, bold: true, charSpacing: 2, color: C.accent4,
  });
  const bs = [
    ['openapi.yaml × 3', 2.42],
    ['Mesh Compose', 5.62],
    ['supergraph.graphql', 8.82],
  ];
  bs.forEach(([label, bx], i) => {
    s.addShape(pres.ShapeType.roundRect, {
      x: bx, y: 2.2, w: 2.5, h: 0.6, rectRadius: 0.06,
      fill: { color: i === 1 ? THEME.colors.accent1 : 'FFFFFF' },
      line: { color: i === 1 ? THEME.colors.accent1 : 'D5D8DE', width: 1 },
      objectName: `build-box-${i}`,
    });
    s.addText(label, {
      x: bx, y: 2.2, w: 2.5, h: 0.6, isTextBox: true, margin: 0,
      align: 'center', valign: 'middle', fontSize: 12, bold: i === 1,
      color: i === 1 ? 'FFFFFF' : THEME.colors.dk2,
    });
    if (i < 2) {
      s.addShape(pres.ShapeType.rightArrow, {
        x: bx + 2.6, y: 2.4, w: 0.5, h: 0.2,
        fill: { color: THEME.colors.accent4 }, line: { type: 'none' },
        objectName: `build-arrow-${i}`,
      });
    }
  });
  // Caption sits in the left gutter, clear of the first diagram box at x=2.42.
  s.addText('Runs once, then exits. REST services untouched.', {
    x: M + 0.26, y: 2.18, w: 1.42, h: 0.66, isTextBox: true, margin: 0,
    fontSize: 8.5, color: C.accent4,
  });

  // ---- runtime band
  card(s, { x: M, y: 3.18, w: W - 2 * M, h: 2.42, name: 'band-runtime' });
  s.addText('RUNTIME', {
    x: M + 0.26, y: 3.32, w: 1.8, h: 0.26, isTextBox: true, margin: 0,
    fontSize: 10, bold: true, charSpacing: 2, color: C.accent4,
  });

  // client
  s.addShape(pres.ShapeType.roundRect, {
    x: 1.0, y: 3.92, w: 1.72, h: 0.62, rectRadius: 0.06,
    fill: { color: 'FFFFFF' }, line: { color: 'D5D8DE', width: 1 }, objectName: 'rt-client',
  });
  s.addText('Client', { x: 1.0, y: 3.92, w: 1.72, h: 0.62, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontSize: 12, color: C.text2 });
  s.addShape(pres.ShapeType.rightArrow, { x: 2.84, y: 4.13, w: 0.46, h: 0.2,
    fill: { color: THEME.colors.accent4 }, line: { type: 'none' }, objectName: 'rt-a1' });
  s.addText('1 query', { x: 2.66, y: 3.7, w: 0.86, h: 0.24, isTextBox: true, margin: 0,
    fontSize: 9, align: 'center', color: C.accent4 });

  // gateway
  s.addShape(pres.ShapeType.roundRect, {
    x: 3.44, y: 3.8, w: 2.34, h: 0.86, rectRadius: 0.06,
    fill: { color: THEME.colors.accent3 }, line: { type: 'none' }, objectName: 'rt-gw',
  });
  s.addText([{ text: 'Hive Gateway', options: { fontSize: 12.5, bold: true, breakLine: true } },
             { text: 'plan · execute · cache', options: { fontSize: 9.5 } }],
    { x: 3.44, y: 3.8, w: 2.34, h: 0.86, isTextBox: true, margin: 0,
      align: 'center', valign: 'middle', color: 'FFFFFF' });

  // cache
  s.addShape(pres.ShapeType.roundRect, {
    x: 4.0, y: 4.94, w: 1.22, h: 0.5, rectRadius: 0.06,
    fill: { color: 'FFFFFF' }, line: { color: THEME.colors.accent1, width: 1.25 }, objectName: 'rt-cache',
  });
  s.addText('Valkey', { x: 4.0, y: 4.94, w: 1.22, h: 0.5, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontSize: 11, bold: true, color: THEME.colors.accent1 });
  s.addShape(pres.ShapeType.upDownArrow, { x: 4.46, y: 4.68, w: 0.3, h: 0.24,
    fill: { color: THEME.colors.accent1 }, line: { type: 'none' }, objectName: 'rt-a2' });

  // arrow to REST
  s.addShape(pres.ShapeType.rightArrow, { x: 5.92, y: 4.13, w: 0.56, h: 0.2,
    fill: { color: THEME.colors.accent4 }, line: { type: 'none' }, objectName: 'rt-a3' });
  s.addText('on MISS only', { x: 5.62, y: 3.68, w: 1.2, h: 0.24, isTextBox: true, margin: 0,
    fontSize: 9, align: 'center', color: THEME.colors.accent6 });

  // REST services
  ['Accounts REST', 'Policies REST', 'Funds REST'].forEach((label, i) => {
    const ry = 3.68 + i * 0.64;
    s.addShape(pres.ShapeType.roundRect, {
      x: 6.64, y: ry, w: 2.36, h: 0.52, rectRadius: 0.06,
      fill: { color: 'FFFFFF' }, line: { color: 'D5D8DE', width: 1 }, objectName: `rt-rest-${i}`,
    });
    s.addText(label, { x: 6.64, y: ry, w: 2.36, h: 0.52, isTextBox: true, margin: 0,
      align: 'center', valign: 'middle', fontSize: 11, color: C.text2 });
  });

  // registry / console side
  s.addShape(pres.ShapeType.roundRect, {
    x: 9.72, y: 3.68, w: 2.96, h: 0.86, rectRadius: 0.06,
    fill: { color: 'FBF3E4' }, line: { color: THEME.colors.accent1, width: 1 }, objectName: 'rt-registry',
  });
  s.addText([{ text: 'Schema Registry + Console', options: { fontSize: 11.5, bold: true, breakLine: true } },
             { text: 'supergraph in · usage out', options: { fontSize: 9.5 } }],
    { x: 9.72, y: 3.68, w: 2.96, h: 0.86, isTextBox: true, margin: 0,
      align: 'center', valign: 'middle', color: THEME.colors.dk2 });
  s.addText('usage reports', { x: 9.72, y: 4.62, w: 2.96, h: 0.24, isTextBox: true, margin: 0,
    fontSize: 9, align: 'center', color: C.accent4 });
  s.addShape(pres.ShapeType.leftArrow, { x: 9.1, y: 4.02, w: 0.5, h: 0.18,
    fill: { color: THEME.colors.accent1 }, line: { type: 'none' }, objectName: 'rt-a4' });

  s.addText('Cache hit returns before query planning and before any REST call.', {
    x: M, y: 5.74, w: W - 2 * M, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 12, bold: true, color: C.text1,
  });

  s.addNotes(
    'Walk the two bands. Build time: Mesh reads the three OpenAPI files we already had and emits one supergraph. '
    + 'That is the whole REST-to-GraphQL step, and it is generated, so the specs stay the source of truth. '
    + 'Runtime: one client query arrives, the gateway checks Valkey first. On a hit it returns immediately — no planning, no REST traffic. '
    + 'On a miss it calls whichever REST services the query needs, merges, caches, returns. '
    + 'Separately the gateway reports usage to the registry, which is what fills the Console dashboards.',
  );
}

// =====================================================================
// 5 — Key capabilities
// =====================================================================
pres.addSection({ title: 'Capabilities' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Capabilities' });
  s.addText('Key capabilities', { placeholder: 'title' });

  const rows = [
    ['Schema management', 'Every version stored and diffable. Supergraph served to gateways.', 'Console + Registry'],
    ['Schema checks', 'Breaking-change detection on each publish, runnable in CI.', 'CLI + Console'],
    ['Policy validation', 'Naming and design rules enforced before merge.', 'Console'],
    ['Usage analytics', 'Per-field and per-client traffic. Shows what is safe to remove.', 'Console'],
    ['Caching', 'Response caching with Redis or Valkey, with entity-level invalidation.', 'Gateway'],
    ['Security', 'JWT auth, CORS, CSRF, persisted documents, rate limiting.', 'Gateway + Router'],
  ];

  s.addTable(
    [[
      { text: 'Capability', options: { bold: true, color: 'FFFFFF', fill: { color: THEME.colors.dk1 } } },
      { text: 'What it does', options: { bold: true, color: 'FFFFFF', fill: { color: THEME.colors.dk1 } } },
      { text: 'Where it runs', options: { bold: true, color: 'FFFFFF', fill: { color: THEME.colors.dk1 } } },
    ]].concat(rows.map((r, i) => [
      { text: r[0], options: { bold: true, color: THEME.colors.dk1 } },
      { text: r[1], options: { color: THEME.colors.dk2 } },
      { text: r[2], options: { color: THEME.colors.accent1, bold: true } },
    ].map((c) => ({ ...c, options: { ...c.options, fill: { color: i % 2 ? 'FFFFFF' : THEME.colors.lt2 } } })))),
    {
      x: M, y: 1.46, w: W - 2 * M,
      colW: [3.0, 6.26, 2.8],
      rowH: 0.56,
      fontSize: 12,
      fontFace: THEME.bodyFontFace,
      border: { type: 'solid', color: 'E3E5E9', pt: 1 },
      valign: 'middle',
      margin: 0.1,
    },
  );

  s.addText('Everything above is available self-hosted. No feature is behind a paywall.', {
    x: M, y: 5.5, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 13, bold: true, color: C.accent5,
  });

  s.addNotes(
    'The right-hand column is the one to dwell on. Schema work lives in the Console and CLI; '
    + 'caching lives in the Gateway and nowhere else, which is the single most important fact in this deck. '
    + 'On the closing line: The Guild gate nothing by feature. They charge for support, not capability. '
    + 'So a self-hosted install is functionally the same product as their cloud.',
  );
}

// =====================================================================
// 6 — Hive Console
// =====================================================================
pres.addSection({ title: 'Console' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Console' });
  s.addText('Hive Console', { placeholder: 'title' });
  s.addText('The UI layer: publish, check, and see who actually uses what.', {
    x: M, y: 1.2, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 14, italic: true, color: C.accent4,
  });

  hexRow(s, { x: M, y: 1.82, w: 6.1, badge: '1', head: 'Schema publishing',
    body: 'CI runs hive schema:publish. Every version is kept and diffable.' });
  hexRow(s, { x: M, y: 2.72, w: 6.1, badge: '2', head: 'Schema checks',
    body: 'Breaking changes flagged on the pull request, before merge.' });
  hexRow(s, { x: M, y: 3.62, w: 6.1, badge: '3', head: 'Usage statistics',
    body: 'Per-field and per-client traffic, so dead fields can be retired safely.' });
  hexRow(s, { x: M, y: 4.52, w: 6.1, badge: '4', head: 'Self-hosting',
    body: 'MIT licensed. Schemas and analytics stay on our infrastructure.' });

  // right panel: self-hosting facts
  card(s, { x: 7.1, y: 1.82, w: 5.58, h: 3.6, fill: C.background2, name: 'console-panel' });
  s.addText('Self-hosted, at a glance', {
    x: 7.42, y: 2.04, w: 4.9, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 15, bold: true, color: C.text1,
  });

  const facts = [
    ['Licence', 'MIT — free, no limits'],
    ['Containers', '14 (8 Hive + 6 infra)'],
    ['Data stores', 'PostgreSQL, ClickHouse, Redis'],
    ['Excluded', 'Their CDN and billing only'],
    ['Deployment', 'Docker Compose documented'],
  ];
  facts.forEach(([k, v], i) => {
    const fy = 2.52 + i * 0.52;
    s.addText(k, { x: 7.42, y: fy, w: 1.7, h: 0.32, isTextBox: true, margin: 0,
      fontSize: 11.5, bold: true, color: C.accent4 });
    s.addText(v, { x: 9.16, y: fy, w: 3.3, h: 0.32, isTextBox: true, margin: 0,
      fontSize: 11.5, color: C.text1 });
  });

  s.addText('No official Kubernetes or Helm chart — production is a platform project.', {
    x: 7.42, y: 5.08, w: 5.0, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 11, bold: true, color: C.accent6,
  });

  s.addNotes(
    'The Console is the part a lead cares about most: it is where schema governance actually happens. '
    + 'Checks on the PR is the headline — a breaking change gets caught before merge rather than in production. '
    + 'Usage analytics answers "can we delete this field", which is normally guesswork. '
    + 'On self-hosting: we verified the licence and the container list directly from the repo. '
    + 'The one real caveat is the missing Helm chart. Evaluating is days; running it properly is a platform project. '
    + 'Their own production Pulumi setup is in the repo, so we would port that rather than start from nothing.',
  );
}

// =====================================================================
// 7 — Gateway vs Router
// =====================================================================
pres.addSection({ title: 'Gateway vs Router' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Gateway vs Router' });
  s.addText('Hive Gateway vs Hive Router', { placeholder: 'title' });
  s.addText('Both serve a supergraph. Only one can talk to REST or cache a response.', {
    x: M, y: 1.2, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 14, italic: true, color: C.accent4,
  });

  const colW = 5.78;
  const cols = [
    { x: M, title: 'Hive Gateway', sub: 'Node.js · v2.15', color: THEME.colors.accent3,
      rows: [['Calls REST directly', 'Yes, via Mesh'], ['Response caching', 'Native, Redis/Valkey'],
             ['Subgraph servers needed', 'None'], ['Image size', '141 MB'], ['Warm cache hit', '2.4 ms']] },
    { x: M + colW + 0.5, title: 'Hive Router', sub: 'Rust · v0.3', color: THEME.colors.accent2,
      rows: [['Calls REST directly', 'No'], ['Response caching', 'None — RFC open'],
             ['Subgraph servers needed', 'Three'], ['Image size', '32.5 MB'], ['Warm cache hit', '2.6 ms']] },
  ];

  cols.forEach((col, ci) => {
    card(s, { x: col.x, y: 1.76, w: colW, h: 3.46, name: `vs-card-${ci}` });
    s.addShape(pres.ShapeType.roundRect, {
      x: col.x, y: 1.76, w: colW, h: 0.74, rectRadius: 0.08,
      fill: { color: col.color }, line: { type: 'none' }, objectName: `vs-head-${ci}`,
    });
    s.addText([{ text: col.title, options: { fontSize: 16, bold: true, breakLine: true } },
               { text: col.sub, options: { fontSize: 10 } }],
      { x: col.x, y: 1.78, w: colW, h: 0.7, isTextBox: true, margin: 0,
        align: 'center', valign: 'middle', color: 'FFFFFF' });

    col.rows.forEach(([k, v], i) => {
      const ry = 2.66 + i * 0.5;
      s.addText(k, { x: col.x + 0.28, y: ry, w: 2.92, h: 0.34, isTextBox: true, margin: 0,
        fontSize: 11.5, color: C.accent4 });
      s.addText(v, { x: col.x + 3.22, y: ry, w: colW - 3.5, h: 0.34, isTextBox: true, margin: 0,
        fontSize: 11.5, bold: true, color: C.text1, align: 'right' });
    });
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 5.42, w: W - 2 * M, h: 0.62, rectRadius: 0.08,
    fill: { color: THEME.colors.dk1 }, line: { type: 'none' }, objectName: 'vs-verdict',
  });
  s.addText(
    [{ text: 'For REST-backed APIs: Gateway. ', options: { bold: true } },
     { text: 'Router is excellent at routing GraphQL subgraphs, but it cannot call REST and has no response cache.', options: {} }],
    { x: M + 0.3, y: 5.42, w: W - 2 * M - 0.6, h: 0.62, isTextBox: true, margin: 0,
      valign: 'middle', fontSize: 13, color: 'FFFFFF' },
  );

  s.addNotes(
    'This is the decision slide. Router is genuinely the better router in its own lane: Rust, a quarter of the image size, and warm-hit latency within a fraction of a millisecond of the Gateway. '
    + 'But it only speaks to GraphQL subgraphs, so with REST behind it we had to build and operate three subgraph servers. '
    + 'And it has no response cache at all — there is a config key called cache, but it only caches query plans and parsing, not data. '
    + 'Worth calling out: that is the same trap we hit with Grafbase, where the cache never reduced REST load. '
    + 'If our backends were already GraphQL subgraphs, the answer would flip to Router.',
  );
}

// =====================================================================
// 8 — Our POC
// =====================================================================
pres.addSection({ title: 'Our POC' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Our POC' });
  s.addText('Our POC and what it measured', { placeholder: 'title' });
  s.addText('Two complete stacks, both running locally on Docker Compose, both verified end to end.', {
    x: M, y: 1.2, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 14, italic: true, color: C.accent4,
  });

  // headline stats
  const stats = [
    ['105 ms', 'Cache miss', C.accent4],
    ['2.4 ms', 'Cache hit — 43× faster', THEME.colors.accent5],
    ['0', 'REST calls on a hit', THEME.colors.accent1],
    ['16', 'Keys purged per entity', THEME.colors.accent3],
  ];
  stats.forEach(([v, l, c], i) => {
    const sx = M + i * 3.11;
    card(s, { x: sx, y: 1.76, w: 2.78, h: 1.42, name: `poc-stat-${i}` });
    stat(s, { x: sx, y: 1.92, w: 2.78, value: v, label: l, color: c, size: 32 });
  });

  // what we built
  card(s, { x: M, y: 3.42, w: 6.0, h: 2.0, name: 'poc-built' });
  s.addText('What we built', {
    x: M + 0.28, y: 3.6, w: 5.4, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 15, bold: true, color: C.text1,
  });
  s.addText(
    [
      { text: 'Three REST APIs exposed as one GraphQL endpoint', options: { bullet: true, breakLine: true } },
      { text: 'Schema generated from existing OpenAPI files', options: { bullet: true, breakLine: true } },
      { text: 'Response cache in Valkey with readable keys', options: { bullet: true, breakLine: true } },
      { text: 'Purge-by-entity API, driven from outside the gateway', options: { bullet: true } },
    ],
    { x: M + 0.28, y: 4.0, w: 5.44, h: 1.3, isTextBox: true, margin: 0,
      fontSize: 12, color: C.text2, paraSpaceAfter: 6 },
  );

  // what it proved
  card(s, { x: 6.96, y: 3.42, w: 5.72, h: 2.0, fill: 'FBF3E4', name: 'poc-proved' });
  s.addText('What it proved', {
    x: 7.24, y: 3.6, w: 5.1, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 15, bold: true, color: C.text1,
  });
  s.addText(
    [
      { text: 'REST services needed no changes at all', options: { bullet: true, breakLine: true } },
      { text: 'Cache keys are ours to design and predictable', options: { bullet: true, breakLine: true } },
      { text: 'One entity change invalidates exactly the right entries', options: { bullet: true, breakLine: true } },
      { text: 'Federation entity keys inferred, not hand-written', options: { bullet: true } },
    ],
    { x: 7.24, y: 4.0, w: 5.16, h: 1.3, isTextBox: true, margin: 0,
      fontSize: 12, color: C.text2, paraSpaceAfter: 6 },
  );

  s.addText('Cache key example:   response-cache:gql.AccountOverview.id-acct-1001.737e0759', {
    x: M, y: 5.6, w: W - 2 * M, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 11, fontFace: 'Courier New', color: C.accent4,
  });

  s.addNotes(
    'We built both stacks, not a slide deck of intentions. Gateway POC is seven containers with no subgraph servers; '
    + 'Router POC is ten, because Router needs three subgraphs in front of the REST APIs. '
    + 'The four numbers are measured on the Docker stack. The one that matters is zero REST calls on a hit — that is the business case. '
    + 'The 43x figure flatters us slightly because the mock REST services answer in microseconds; real network hops make the gap wider, not narrower. '
    + 'Show the cache key: operation name, the account id, and a hash of the query shape. Readable in redis-cli, and deletable by hand. '
    + 'One caveat we documented: the key must not contain a colon, or Hive\'s own invalidation silently stops working.',
  );
}

// =====================================================================
// 9 — Benefits and limitations
// =====================================================================
pres.addSection({ title: 'Assessment' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Assessment' });
  s.addText('Benefits and limitations', { placeholder: 'title' });

  card(s, { x: M, y: 1.46, w: 5.9, h: 3.86, name: 'ben-card' });
  s.addShape(pres.ShapeType.hexagon, { x: M + 0.28, y: 1.72, w: 0.4, h: 0.4, rotate: 90,
    fill: { color: THEME.colors.accent5 }, line: { type: 'none' }, objectName: 'ben-hex' });
  s.addText('Benefits', { x: M + 0.8, y: 1.7, w: 4.5, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 17, bold: true, color: C.text1 });
  s.addText(
    [
      { text: 'MIT licensed and fully self-hostable', options: { bullet: true, breakLine: true } },
      { text: 'No REST changes — OpenAPI specs stay the source of truth', options: { bullet: true, breakLine: true } },
      { text: 'Response caching that actually removes REST calls', options: { bullet: true, breakLine: true } },
      { text: 'Cache keys we design, with entity-level purging', options: { bullet: true, breakLine: true } },
      { text: 'Schema checks catch breaking changes before merge', options: { bullet: true, breakLine: true } },
      { text: 'Standard federation — supergraph is portable', options: { bullet: true } },
    ],
    { x: M + 0.3, y: 2.24, w: 5.34, h: 2.9, isTextBox: true, margin: 0,
      fontSize: 12.5, color: C.text2, paraSpaceAfter: 9 },
  );

  card(s, { x: 7.0, y: 1.46, w: 5.68, h: 3.86, name: 'lim-card' });
  s.addShape(pres.ShapeType.hexagon, { x: 7.28, y: 1.72, w: 0.4, h: 0.4, rotate: 90,
    fill: { color: THEME.colors.accent6 }, line: { type: 'none' }, objectName: 'lim-hex' });
  s.addText('Limitations', { x: 7.8, y: 1.7, w: 4.5, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 17, bold: true, color: C.text1 });
  s.addText(
    [
      { text: 'Router cannot call REST and cannot cache', options: { bullet: true, breakLine: true } },
      { text: 'No official Kubernetes or Helm chart for Console', options: { bullet: true, breakLine: true } },
      { text: 'Cache is whole-response, not per field', options: { bullet: true, breakLine: true } },
      { text: 'Cache keys must avoid colons or purging breaks silently', options: { bullet: true, breakLine: true } },
      { text: 'Some packages still pre-1.0; docs trail the code', options: { bullet: true, breakLine: true } },
      { text: 'Community support only unless we buy Enterprise', options: { bullet: true } },
    ],
    { x: 7.3, y: 2.24, w: 5.12, h: 2.9, isTextBox: true, margin: 0,
      fontSize: 12.5, color: C.text2, paraSpaceAfter: 9 },
  );

  s.addText('None of the limitations blocks our use case. The Kubernetes gap is the one to plan for.', {
    x: M, y: 5.52, w: W - 2 * M, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 13, bold: true, color: C.text1,
  });

  s.addNotes(
    'Be straight about the right-hand column — it is what earns trust. '
    + 'The colon constraint is undocumented and fails silently; we found it by reading Hive\'s source, and it is written up in our repo. '
    + 'Whole-response caching means a query touching forty funds is invalidated by any one of them changing, so cache narrow operations and leave wide ad-hoc queries uncached. '
    + 'The Kubernetes gap is the only item with real cost attached. Everything else is a known trade-off we can live with.',
  );
}

// =====================================================================
// 10 — Conclusion
// =====================================================================
pres.addSection({ title: 'Close' });
{
  const s = pres.addSlide({ masterName: 'CLOSE_DARK', sectionTitle: 'Close' });
  s.addText('Takeaways', { placeholder: 'title' });
  hexCluster(s, 11.1, 5.15, 0.64, THEME.colors.accent1, { transparency: 62, count: 5 });

  const takes = [
    ['Hive solved the problem Grafbase could not',
     'Caching that removes REST calls, with keys we control and entity-level purging.'],
    ['Use Gateway, not Router, for REST backends',
     'Router cannot call REST and has no response cache. Seven containers versus ten.'],
    ['Self-hosting keeps our schemas internal',
     'MIT licensed, no feature gating. Budget a platform project for production Kubernetes.'],
  ];
  takes.forEach(([head, body], i) => {
    const ty = 1.72 + i * 1.18;
    s.addShape(pres.ShapeType.hexagon, { x: M, y: ty, w: 0.52, h: 0.52, rotate: 90,
      fill: { color: THEME.colors.accent1 }, line: { type: 'none' }, objectName: `take-hex-${i}` });
    s.addText(String(i + 1), { x: M, y: ty, w: 0.52, h: 0.52, isTextBox: true, margin: 0,
      align: 'center', valign: 'middle', fontSize: 14, bold: true, color: THEME.colors.dk1 });
    s.addText(head, { x: M + 0.78, y: ty - 0.04, w: 9.6, h: 0.34, isTextBox: true, margin: 0,
      fontSize: 16, bold: true, color: 'FFFFFF' });
    s.addText(body, { x: M + 0.78, y: ty + 0.32, w: 9.6, h: 0.5, isTextBox: true, margin: 0,
      fontSize: 12.5, color: 'C9CDD4' });
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 5.42, w: 8.4, h: 1.08, rectRadius: 0.08,
    fill: { color: '2A2A38' }, line: { type: 'none' }, objectName: 'next-steps',
  });
  s.addText('Proposed next steps', {
    x: M + 0.3, y: 5.56, w: 7.8, h: 0.28, isTextBox: true, margin: 0,
    fontSize: 11, bold: true, charSpacing: 2, color: THEME.colors.accent1,
  });
  s.addText('Stand up self-hosted Console internally  ·  Publish the POC supergraph  ·  Decide on production deployment',
    { x: M + 0.3, y: 5.88, w: 7.8, h: 0.5, isTextBox: true, margin: 0,
      fontSize: 12.5, color: 'FFFFFF' });

  s.addNotes(
    'Close on the three takeaways, then the ask. '
    + 'Takeaway one is the reason we looked at Hive at all — Grafbase cached query plans, which never reduced REST load. '
    + 'Takeaway two saves someone repeating our Router detour. '
    + 'Takeaway three is the open question for the team: self-hosting works and keeps schemas internal, but production Kubernetes is real work. '
    + 'The ask is small: let us run the Console internally and publish the POC supergraph to it, then decide with evidence. '
    + 'Both POCs and the full write-ups are in the rest-demo repo under Docs/Hive-docs.',
  );
}

// ------------------------------------------------------------- write
(async () => {
  const out = 'WebCoP-Hive-GraphQL.pptx';
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log('wrote', out);
})();
