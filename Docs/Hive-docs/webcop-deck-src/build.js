/**
 * WebCoP session deck: GraphQL Federation with Hive — 12 slides, ~20 minutes.
 * Regenerate:  NODE_PATH="$PWD/node_modules" PPTX_SKILL=<skill dir> node build.js
 *
 * Terminology and API detail follow the official Hive documentation:
 *   - CDN artifacts:  /artifacts/v1/<TARGET_ID>/{sdl,services,supergraph,metadata}
 *                     header X-Hive-CDN-Key; response x-hive-schema-version-id
 *   - Hive Gateway (Node, MIT): response cache, JWT, @authenticated/@requiresScope,
 *     @cacheControl, @rateLimit, persisted documents, OTel/Prometheus
 *   - Hive Router (Rust, MIT): query_planner, traffic_shaping, jwt, authorization,
 *     limits, persisted_documents, storages, subscriptions, telemetry.
 *     Its `cache` key tunes IN-MEMORY caches only — there is no response cache.
 *   - Change severity is Hive's own enum SeverityLevelType { SAFE, DANGEROUS, BREAKING }
 *
 * Layout discipline: every coordinate derives from GRID and every font size
 * from TYPE. Content spans GRID.BODY_Y .. GRID.BODY_BOTTOM on every slide.
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
const TINT_GREY = 'F3F4F6';
const HAIRLINE = 'D5D8DE';
const CODE_BG = '1B1B26';
const CODE_FG = 'D9DDE4';
const MONO = 'Courier New';

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
  BODY_Y: 1.74,
  BODY_BOTTOM: 6.3,
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
  CODE: 9.5,
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Web Community of Practice';
pres.title = 'GraphQL Federation with Hive';
pres.subject = 'Federation architecture, schema lifecycle and runtime request flow';

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
    // No shadow: a shadow on a pale tint reads as a floating box rather than as
    // the background zone these panels are for.
    fill: { color: fill }, line: { type: 'none' },
    objectName: name,
  });
}

/** Dashed-outline region, used to mark product/ownership boundaries. */
function zone(slide, { x, y, w, h, color, fill = 'FFFFFF', name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.04,
    fill: { color: fill },
    line: { color, width: 1, dashType: 'dash' },
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
  color = K.dk2, bold = false, mono = false, size = TYPE.NODE, name,
}) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill },
    line: border === 'none' ? { type: 'none' } : { color: border, width: 1 },
    objectName: name,
  });
  const head = { fontSize: size, bold: bold || Boolean(sub) };
  if (mono) head.fontFace = MONO;
  const runs = sub
    ? [{ text: label, options: { ...head, breakLine: true } },
       { text: sub, options: { fontSize: TYPE.NODE_SUB } }]
    : [{ text: label, options: head }];
  slide.addText(runs, {
    x, y, w, h, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', color,
  });
}

/** Dark card of monospaced lines — SDL, CLI, query plans, HTTP. */
function codeCard(slide, { x, y, w, h, head, lines, fill = CODE_BG, name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill }, line: { type: 'none' }, objectName: name,
  });
  let top = y + 0.16;
  if (head) {
    slide.addText(head, {
      x: x + 0.22, y: top, w: w - 0.44, h: 0.24, isTextBox: true, margin: 0,
      fontSize: TYPE.LABEL, bold: true, charSpacing: 2, color: K.accent1,
    });
    top += 0.3;
  }
  slide.addText(lines.join('\n'), {
    x: x + 0.22, y: top, w: w - 0.44, h: y + h - top - 0.12,
    isTextBox: true, margin: 0, fontFace: MONO, fontSize: TYPE.CODE,
    color: CODE_FG, lineSpacingMultiple: 1.18,
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

/** Monospaced annotation sitting beside an arrow, as on a network diagram. */
function edgeLabel(slide, { x, y, w, text, color = C.accent4, align = 'left' }) {
  slide.addText(text, {
    x, y, w, h: 0.22, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 8.5, color, align, valign: 'middle',
  });
}

function caption(slide, { x, y, w, text, align = 'center', color = C.accent4, h = 0.26 }) {
  slide.addText(text, {
    x, y, w, h, isTextBox: true, margin: 0,
    fontSize: TYPE.CAPTION, align, color,
  });
}

/** Numbered badge, used for lifecycle steps. */
function badge(slide, { x, y, n, size = 0.3, fill = K.accent1, color = 'FFFFFF', name }) {
  slide.addShape(pres.ShapeType.ellipse, {
    x, y, w: size, h: size, fill: { color: fill }, line: { type: 'none' },
    objectName: name,
  });
  slide.addText(String(n), {
    x, y, w: size, h: size, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontSize: 9, bold: true, color,
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
      fontSize: 42, bold: true, color: K.lt1, fontFace: THEME.headFontFace,
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
    { text: { text: 'WebCoP · GraphQL Federation with Hive', options: {
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
  s.addText('GraphQL Federation with Hive', { placeholder: 'title' });
  s.addText('Architecture, schema lifecycle and the runtime request path',
    { placeholder: 'body' });
  s.addText('20 minutes  ·  Engineers and technical leads  ·  Hive Console · Gateway · Router', {
    x: M, y: 5.3, w: 9.0, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 12, color: K.accent4,
  });
  s.addNotes(
    'Twenty minutes, four parts. First, why a federated GraphQL layer exists at all, and the four '
    + 'adoption patterns teams actually use. Second, the mechanics of federation: subgraphs, entities '
    + 'and the composed supergraph. Third, the Hive ecosystem and a reference architecture you could '
    + 'draw on a whiteboard for our own platform. Fourth, the runtime path: query planning, entity '
    + 'resolution, caching, security and observability. '
    + 'Everything here follows the official Hive documentation. Hive Console, Hive Gateway and Hive '
    + 'Router are all MIT licensed and can be self-hosted.',
  );
}

// =====================================================================
// 2 — Beyond REST
// =====================================================================
pres.addSection({ title: 'Why GraphQL' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Why GraphQL' });
  s.addText('Beyond REST: what the client pays for', { placeholder: 'title' });
  subtitle(s, 'One screen that needs an account, its policies and their funds.');

  const colW = (GRID.CW - GRID.GAP) / 2;
  const colX2 = M + colW + GRID.GAP;
  const cardH = 2.62;

  bandLabel(s, { x: M, y: GRID.BODY_Y, text: 'REST — 4 SEQUENTIAL ROUND TRIPS', color: K.accent6, w: 4.2 });
  codeCard(s, {
    x: M, y: GRID.BODY_Y + 0.3, w: colW, h: cardH, name: 'rest-card',
    lines: [
      'GET /accounts/A-1001               1.8 KB',
      'GET /accounts/A-1001/policies      6.4 KB',
      'GET /policies/P-77/funds           3.1 KB',
      'GET /funds/F-12                    2.2 KB',
      '',
      '-> 13.5 KB on the wire, 4x RTT',
      '-> the client joins the three payloads',
      '-> the server decides the field set',
    ],
  });

  bandLabel(s, { x: colX2, y: GRID.BODY_Y, text: 'GRAPHQL — 1 ROUND TRIP', color: K.accent5, w: 4.2 });
  codeCard(s, {
    x: colX2, y: GRID.BODY_Y + 0.3, w: colW, h: cardH, name: 'gql-card',
    lines: [
      'POST /graphql',
      'query AccountOverview($id: ID!) {',
      '  account(id: $id) {',
      '    name',
      '    policies { id premium',
      '      funds { name nav } } } }',
      '',
      '-> 2.1 KB, 1x RTT, exactly these fields',
    ],
  });

  const defs = [
    ['Over-fetching', 'The endpoint returns fields the screen never renders. Cost is bandwidth and parse time on the device.'],
    ['Under-fetching', 'One endpoint is not enough, so the client issues a dependent call per related object — the classic N+1 over HTTP.'],
    ['Typed contract', 'The schema is introspectable and checked at build time. Fields are deprecated with @deprecated rather than the API being versioned.'],
  ];
  const dW = (GRID.CW - 2 * 0.3) / 3;
  defs.forEach(([head, body], i) => {
    const x = M + i * (dW + 0.3);
    panel(s, { x, y: 4.76, w: dW, h: 1.54, name: `def-${i}` });
    s.addText(head, {
      x: x + 0.24, y: 4.9, w: dW - 0.48, h: 0.28, isTextBox: true, margin: 0,
      fontSize: TYPE.H3 - 2, bold: true, color: C.text1,
    });
    s.addText(body, {
      x: x + 0.24, y: 5.22, w: dW - 0.48, h: 0.92, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2,
    });
  });

  s.addNotes(
    'Start concrete. This is one screen in our own domain: an account, the policies on it, and the funds '
    + 'inside those policies. Over REST that is four calls, and three of them cannot start until the previous '
    + 'one returns, because you do not know the policy ids until you have fetched the account. So the latency '
    + 'is four serial round trips, not four parallel ones. '
    + 'The payload numbers are illustrative but the shape is real: you pull about thirteen kilobytes to render '
    + 'maybe two, because each endpoint returns its full representation. '
    + 'The GraphQL version is one POST with a selection set. The server walks the graph on the server side, '
    + 'where the hops are cheap, and returns a response shaped exactly like the query. '
    + 'The three terms at the bottom are the vocabulary for the rest of the session. The one people under-rate '
    + 'is the typed contract: because the schema is introspectable, tooling can tell you at build time that a '
    + 'change will break a client. That is the hook for the schema-checks slide later.',
  );
}

// =====================================================================
// 3 — Adoption patterns
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Why GraphQL' });
  s.addText('Four GraphQL adoption patterns', { placeholder: 'title' });
  subtitle(s, 'The question is always the same: where does composition happen, and who pays for it?');

  const pW = (GRID.CW - 0.34) / 2;
  const pH = 2.12;
  const cells = [
    { n: 1, title: 'Client-based GraphQL', color: K.accent4, tint: TINT_GREY,
      row: ['Client + GraphQL layer', 'REST A', 'REST B'],
      verdict: 'Composition runs on the device. Developer experience improves; the aggregation cost, and every round trip, stays on the client.' },
    { n: 2, title: 'GraphQL with BFFs', color: K.accent3, tint: TINT_GREY,
      row: ['Web / iOS clients', 'BFF per client', 'REST services'],
      verdict: 'A GraphQL layer per client surface. Payloads are tuned per client, but you now build, deploy and operate N backends-for-frontends.' },
    { n: 3, title: 'Monolithic GraphQL', color: K.accent2, tint: TINT_GREY,
      row: ['All clients', 'One GraphQL server', 'All services'],
      verdict: 'One schema, one codebase, one deploy. Simple until several teams contribute: then it is a merge bottleneck and a shared blast radius.' },
    { n: 4, title: 'GraphQL Federation', color: K.accent1, tint: TINT_AMBER,
      row: ['All clients', 'Router / gateway', 'Subgraph per domain'],
      verdict: 'Composition moves into the platform. Domain teams own and deploy their slice; the cost is a schema registry and a composition pipeline.' },
  ];

  cells.forEach((cell, i) => {
    const x = M + (i % 2) * (pW + 0.34);
    const y = GRID.BODY_Y + Math.floor(i / 2) * (pH + 0.3);
    panel(s, { x, y, w: pW, h: pH, fill: cell.tint, name: `pat-${i}` });
    badge(s, { x: x + 0.26, y: y + 0.2, n: cell.n, fill: cell.color, name: `pat-badge-${i}` });
    s.addText(cell.title, {
      x: x + 0.66, y: y + 0.18, w: pW - 0.92, h: 0.34, isTextBox: true, margin: 0,
      fontSize: TYPE.H3, bold: true, color: C.text1, valign: 'middle',
    });

    // mini flow: three stages, two arrows
    const sw = (pW - 0.52 - 2 * 0.34) / 3;
    cell.row.forEach((label, j) => {
      const nx = x + 0.26 + j * (sw + 0.34);
      node(s, {
        x: nx, y: y + 0.66, w: sw, h: 0.5, label, size: TYPE.TINY,
        fill: 'FFFFFF', border: j === 1 ? cell.color : HAIRLINE,
        color: j === 1 ? cell.color : K.dk2, bold: j === 1,
        name: `pat-${i}-n${j}`,
      });
      if (j < 2) {
        arrowR(s, { x: nx + sw + 0.06, y: y + 0.825, w: 0.22,
          color: cell.color, name: `pat-${i}-a${j}` });
      }
    });

    s.addText(cell.verdict, {
      x: x + 0.26, y: y + 1.26, w: pW - 0.52, h: 0.72, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2,
    });
  });

  s.addNotes(
    'Most teams walk this ladder rather than jumping to the bottom right, and it is worth naming where we are. '
    + 'Pattern one puts a GraphQL layer inside the client. It is the cheapest thing to try and it does improve the '
    + 'developer experience, but it is a lie in performance terms: the device still makes every call. '
    + 'Pattern two, backend-for-frontends, moves that layer server-side and tunes it per client surface. Real win, '
    + 'real cost — each BFF is a service somebody has to own, and logic duplicates across them. '
    + 'Pattern three is the single GraphQL server. This is where most organisations get stuck. It works beautifully '
    + 'for one team. With five teams in one schema you get merge conflicts, a release train, and one bad deploy '
    + 'taking down fields nobody on that team owns. '
    + 'Pattern four is federation. Composition moves into the platform layer, so each domain team ships its own '
    + 'subgraph on its own cadence. Be honest about the price: you are now running a schema registry and a '
    + 'composition pipeline, and that infrastructure is exactly what Hive provides. '
    + 'If someone asks which one we should pick: the answer is driven by team count, not traffic.',
  );
}

// =====================================================================
// 4 — Subgraphs, entities, supergraph
// =====================================================================
pres.addSection({ title: 'Federation mechanics' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Federation mechanics' });
  s.addText('Subgraphs, entities and the supergraph', { placeholder: 'title' });
  subtitle(s, 'Two subgraphs, one type. @key is the join.');

  const cw = 3.78;
  const gap = 0.36;
  const x1 = M;
  const x2 = M + cw + gap;
  const x3 = M + 2 * (cw + gap);

  bandLabel(s, { x: x1, y: GRID.BODY_Y, text: 'SUBGRAPH: ACCOUNTS', color: K.accent3, w: 3.4 });
  codeCard(s, {
    x: x1, y: GRID.BODY_Y + 0.3, w: cw, h: 2.0, name: 'sdl-accounts',
    lines: [
      'type Account @key(fields: "id") {',
      '  id: ID!',
      '  name: String!',
      '  balance: Float!',
      '}',
    ],
  });

  bandLabel(s, { x: x2, y: GRID.BODY_Y, text: 'SUBGRAPH: POLICIES', color: K.accent3, w: 3.4 });
  codeCard(s, {
    x: x2, y: GRID.BODY_Y + 0.3, w: cw, h: 2.0, name: 'sdl-policies',
    lines: [
      'type Account @key(fields: "id") {',
      '  id: ID!            # stub, not owned',
      '  policies: [Policy!]!',
      '}',
      'type Policy @key(fields: "id") { ... }',
    ],
  });

  bandLabel(s, { x: x3, y: GRID.BODY_Y, text: 'COMPOSED SUPERGRAPH', color: K.accent1, w: 3.4 });
  codeCard(s, {
    x: x3, y: GRID.BODY_Y + 0.3, w: cw, h: 2.0, fill: '2A2236', name: 'sdl-super',
    lines: [
      'type Account',
      '  @join__type(graph: ACCOUNTS, key: "id")',
      '  @join__type(graph: POLICIES, key: "id")',
      '{ id: ID!',
      '  name: String! @join__field(graph: ACCOUNTS)',
      '  policies: [Policy!]! @join__field(',
      '      graph: POLICIES) }',
    ],
  });

  caption(s, { x: x1, y: 4.1, w: cw, align: 'left', color: K.accent3,
    text: 'Owns name and balance' });
  caption(s, { x: x2, y: 4.1, w: cw, align: 'left', color: K.accent3,
    text: 'Extends Account with policies' });
  caption(s, { x: x3, y: 4.1, w: cw, align: 'left', color: K.accent1,
    text: 'Generated by composition — never written by hand' });

  const entY = 4.56;
  panel(s, { x: M, y: entY, w: GRID.CW, h: GRID.BODY_BOTTOM - entY, fill: TINT_TEAL, name: 'entity-band' });
  bandLabel(s, { x: M + 0.34, y: entY + 0.16, text: 'HOW THE JOIN IS EXECUTED AT RUNTIME', color: K.accent2, w: 5.0 });
  codeCard(s, {
    x: M + 0.34, y: entY + 0.48, w: 6.4, h: 1.1, fill: '14343A', name: 'entities-call',
    lines: [
      'POST policies-subgraph/graphql',
      'query($reps: [_Any!]!) { _entities(representations: $reps)',
      '  { ... on Account { policies { id premium } } } }',
      'variables: [{ "__typename": "Account", "id": "A-1001" }]',
    ],
  });
  s.addText(
    [{ text: 'The gateway never guesses.  ', options: { bold: true, color: K.dk1 } },
     { text: 'The supergraph records which subgraph can resolve each field and which ', options: { color: K.dk2 } },
     { text: '@key', options: { fontFace: MONO, color: K.accent2 } },
     { text: ' fields identify the entity. Every subgraph implements the federation ', options: { color: K.dk2 } },
     { text: '_entities', options: { fontFace: MONO, color: K.accent2 } },
     { text: ' root field, so the gateway can hand it a list of representations and ask for the rest.',
       options: { color: K.dk2 } }],
    { x: 7.62, y: entY + 0.4, w: 5.09, h: 1.3, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, valign: 'middle' },
  );

  s.addNotes(
    'This is the mechanic everything else rests on, so spend a minute here. '
    + 'Accounts owns the Account type: id, name, balance. Policies also declares Account, but only as a stub — '
    + 'it brings the id it needs to identify one, plus the field it actually owns, policies. Neither team edited '
    + 'the other team\'s code. '
    + 'The @key directive is the primary key for the join. It says: give me these fields and I can produce this '
    + 'object. The middle card is what makes Account an entity rather than a plain type. '
    + 'Composition merges the two into the supergraph on the right. Note the join__type and join__field '
    + 'directives: that annotation is literally the routing table the query planner reads. Nobody writes this file; '
    + 'Hive generates it on publish. '
    + 'The bottom band is the runtime half. When a query asks for account name and policies together, the gateway '
    + 'fetches name from Accounts, then calls Policies with a representation — typename plus key fields — through '
    + 'the standard _entities root field. That is an API-side join, the same idea as a foreign key join in a '
    + 'database, executed over HTTP. '
    + 'If you remember one thing: @key plus _entities is the whole of federation. Everything else is tooling.',
  );
}

// =====================================================================
// 5 — The Hive ecosystem
// =====================================================================
pres.addSection({ title: 'Hive ecosystem' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive ecosystem' });
  s.addText('The Hive ecosystem', { placeholder: 'title' });
  subtitle(s, 'Five components, all MIT licensed, all self-hostable.');

  const comps = [
    { name: 'Hive CLI', tag: 'npm · binary · docker', color: K.accent3,
      lines: ['schema:check', 'schema:push', 'schema:publish', '--github, --commit'],
      note: 'Runs in CI. The only thing a product team touches.' },
    { name: 'Hive Console', tag: 'schema registry', color: K.accent1,
      lines: ['versions + history', 'composition', 'checks + approvals', 'usage analytics'],
      note: 'The system of record for every schema version.' },
    { name: 'Artifact store', tag: 'CDN or object storage', color: K.accent1,
      lines: ['/artifacts/v1/<id>/', '  supergraph', '  sdl | services', 'X-Hive-CDN-Key'],
      note: 'What the runtime polls. Cloud CDN, or your own endpoint.' },
    { name: 'Hive Gateway', tag: 'Node · MIT', color: K.accent2,
      lines: ['response cache', 'JWT + RBAC dirs.', 'persisted docs', 'OTel + Prometheus'],
      note: 'Federation router with response caching built in.' },
    { name: 'Hive Router', tag: 'Rust · MIT', color: K.accent2,
      lines: ['query_planner', 'traffic_shaping', 'plugins + coproc.', 'subscriptions'],
      note: 'Throughput-first runtime. In-memory caches only.' },
  ];

  const cW = (GRID.CW - 4 * 0.24) / 5;
  comps.forEach((c, i) => {
    const x = M + i * (cW + 0.24);
    panel(s, { x, y: GRID.BODY_Y, w: cW, h: 4.0, name: `comp-${i}` });
    s.addShape(pres.ShapeType.roundRect, {
      x, y: GRID.BODY_Y, w: cW, h: 0.08, rectRadius: 0.03,
      fill: { color: c.color }, line: { type: 'none' }, objectName: `comp-rule-${i}`,
    });
    s.addText(c.name, {
      x: x + 0.2, y: GRID.BODY_Y + 0.2, w: cW - 0.4, h: 0.3, isTextBox: true, margin: 0,
      fontSize: TYPE.H3 - 1, bold: true, color: C.text1,
    });
    s.addText(c.tag, {
      x: x + 0.2, y: GRID.BODY_Y + 0.52, w: cW - 0.4, h: 0.24, isTextBox: true, margin: 0,
      fontSize: TYPE.LABEL, bold: true, charSpacing: 1, color: c.color,
    });
    codeCard(s, {
      x: x + 0.2, y: GRID.BODY_Y + 0.86, w: cW - 0.4, h: 1.26,
      lines: c.lines, name: `comp-code-${i}`,
    });
    s.addText(c.note, {
      x: x + 0.2, y: GRID.BODY_Y + 2.26, w: cW - 0.4, h: 1.5, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2,
    });
  });

  caption(s, { x: M, y: 5.92, w: GRID.CW, align: 'left', color: K.accent6,
    text: 'Gateway or Router — pick one. Response caching exists only in Hive Gateway; the Router\'s cache setting tunes in-memory parse, validation and query-plan caches.' });

  s.addNotes(
    'Five boxes. Learn these names and the rest of the deck reads easily. '
    + 'The CLI is the only piece a product engineer runs, and it runs in CI, not on a laptop. '
    + 'The Console is the registry: every version of every subgraph, the composition result, the check history, '
    + 'and usage analytics. This is the system of record. '
    + 'The artifact store is the handoff point between design time and runtime. The composed supergraph is published '
    + 'there, and the runtime fetches it over HTTP with a CDN key. In Hive Cloud that is a global CDN on Cloudflare '
    + 'with an AWS mirror; self-hosted, you expose the same routes from your own Hive API. '
    + 'Then two runtimes, and this is the main architectural choice. Hive Gateway is Node, and it has the response '
    + 'cache, backed by memory or Redis. Hive Router is Rust, built for throughput, with a plugin system and '
    + 'coprocessors, but its cache setting tunes parse, validation and query-plan caches only. '
    + 'Say the red line out loud, because it has caught people out: if you need to serve an identical GraphQL '
    + 'response without touching the subgraphs, that is Gateway, or a cache in front of the Router. '
    + 'Everything on this slide is MIT and runs in our own infrastructure.',
  );
}

// =====================================================================
// 6 — Reference architecture
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive ecosystem' });
  s.addText('Reference architecture for a modern API platform', { placeholder: 'title' });
  subtitle(s, 'Design time on the left, the request path down the middle, telemetry on the right.');

  const zTop = 1.9;
  const zBot = 5.78;
  const zH = zBot - zTop;

  const lX = M, lW = 2.7;
  const cX = 3.74, cW = 5.6;
  const rX = 9.76, rW = 2.95;

  // ---- design-time zone
  zone(s, { x: lX, y: zTop, w: lW, h: zH, color: K.accent1, name: 'z-design' });
  bandLabel(s, { x: lX + 0.02, y: GRID.BODY_Y - 0.1, text: 'DESIGN TIME · HIVE CONSOLE', color: K.accent1, w: 2.9 });
  ['CI/CD · Hive CLI', 'Schema registry', 'Federation composition', 'Schema checks', 'Usage analytics']
    .forEach((label, i) => {
      node(s, {
        x: lX + 0.14, y: 2.12 + i * 0.58, w: lW - 0.28, h: 0.48, label,
        size: TYPE.TINY, border: K.accent1, name: `ra-l${i}`,
      });
    });
  caption(s, { x: lX + 0.14, y: 5.16, w: lW - 0.28, align: 'left', color: K.accent1, h: 0.5,
    text: 'Self-hosted or Hive Cloud.\nSchemas never leave your network.' });

  // ---- runtime zone
  zone(s, { x: cX, y: zTop, w: cW, h: zH, color: K.accent2, fill: TINT_TEAL, name: 'z-runtime' });
  bandLabel(s, { x: cX + 0.02, y: GRID.BODY_Y - 0.1, text: 'REQUEST PATH', color: K.accent2, w: 2.9 });

  const iX = cX + 0.14, iW = cW - 0.28;
  const triW = (iW - 2 * 0.14) / 3;

  ['Web', 'Mobile', 'Partner API'].forEach((label, i) => {
    node(s, { x: iX + i * (triW + 0.14), y: 2.12, w: triW, h: 0.42, label,
      size: TYPE.TINY, border: HAIRLINE, name: `ra-client-${i}` });
  });
  arrowD(s, { x: cX + 0.7, y: 2.62, h: 0.2, color: K.accent2, name: 'ra-ad1' });
  edgeLabel(s, { x: cX + 1.0, y: 2.6, w: 4.4, color: K.accent2,
    text: 'HTTPS POST /graphql   Authorization: Bearer <JWT>' });

  node(s, { x: iX, y: 2.88, w: iW, h: 0.42, label: 'Edge gateway / ingress  ·  TLS · routing · WAF · rate limit',
    size: TYPE.TINY, border: K.accent2, name: 'ra-edge' });
  arrowD(s, { x: cX + 0.7, y: 3.38, h: 0.2, color: K.accent2, name: 'ra-ad2' });
  edgeLabel(s, { x: cX + 1.0, y: 3.36, w: 4.4, color: K.accent2,
    text: 'forwarded to the supergraph runtime' });

  node(s, { x: iX, y: 3.64, w: iW, h: 0.56,
    label: 'Hive Gateway  /  Hive Router',
    sub: 'parse · validate · authz · query plan · execute · merge',
    fill: K.accent2, border: 'none', color: 'FFFFFF', name: 'ra-runtime' });
  arrowD(s, { x: cX + 0.7, y: 4.28, h: 0.2, color: K.accent3, name: 'ra-ad3' });
  edgeLabel(s, { x: cX + 1.0, y: 4.26, w: 4.4, color: K.accent3,
    text: 'query plan -> subgraph fetches + _entities joins' });

  ['Accounts subgraph', 'Policies subgraph', 'Funds subgraph'].forEach((label, i) => {
    node(s, { x: iX + i * (triW + 0.14), y: 4.54, w: triW, h: 0.42, label,
      size: TYPE.TINY, border: K.accent3, name: `ra-sg-${i}` });
  });
  arrowD(s, { x: cX + 0.7, y: 5.04, h: 0.2, color: K.accent3, name: 'ra-ad4' });
  edgeLabel(s, { x: cX + 1.0, y: 5.02, w: 4.4, color: K.accent3,
    text: 'REST / gRPC / SQL to domain services' });

  ['Accounts API', 'Policies API', 'Funds API'].forEach((label, i) => {
    node(s, { x: iX + i * (triW + 0.14), y: 5.3, w: triW, h: 0.4, label,
      size: TYPE.TINY, border: HAIRLINE, name: `ra-svc-${i}` });
  });

  // ---- observability zone
  zone(s, { x: rX, y: zTop, w: rW, h: zH, color: K.accent4, name: 'z-obs' });
  bandLabel(s, { x: rX + 0.02, y: GRID.BODY_Y - 0.1, text: 'OBSERVABILITY & GOVERNANCE', color: K.accent4, w: rW });
  ['Usage reporting → Hive', 'OpenTelemetry (OTLP)', 'Prometheus metrics', 'Traces: Jaeger / Tempo', 'Field-level insights']
    .forEach((label, i) => {
      node(s, {
        x: rX + 0.14, y: 2.12 + i * 0.58, w: rW - 0.28, h: 0.48, label,
        size: TYPE.TINY, border: HAIRLINE, name: `ra-r${i}` });
    });
  caption(s, { x: rX + 0.14, y: 5.16, w: rW - 0.28, align: 'left', h: 0.5,
    text: 'Usage data is what makes a breaking\nchange judgeable rather than guessed.' });

  // ---- cross-zone flows
  arrowR(s, { x: lX + lW + 0.04, y: 3.83, w: 0.34, color: K.accent1, name: 'ra-x1' });
  badge(s, { x: lX + lW + 0.08, y: 3.44, n: 2, size: 0.26, fill: K.accent1, name: 'ra-b2' });
  arrowR(s, { x: cX + cW + 0.04, y: 3.83, w: 0.34, color: K.accent4, name: 'ra-x2' });
  badge(s, { x: cX + cW + 0.08, y: 3.44, n: 3, size: 0.26, fill: K.accent4, name: 'ra-b3' });
  badge(s, { x: lX + 0.14, y: 1.98, n: 1, size: 0.26, fill: K.accent1, name: 'ra-b1' });

  // ---- legend
  const legY = 5.9;
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: legY, w: GRID.CW, h: GRID.BODY_BOTTOM - legY, rectRadius: 0.06,
    fill: { color: K.dk1 }, line: { type: 'none' }, objectName: 'ra-legend',
  });
  const legW = (GRID.CW - 0.68) / 3;
  [[1, 'hive schema:publish --service accounts', 'registry composes, stores an immutable version'],
   [2, 'GET /artifacts/v1/<target>/supergraph', 'runtime polls and hot-reloads; no redeploy'],
   [3, 'usage reports + OTLP traces / metrics', 'field-level insights feed conditional checks']]
    .forEach(([n, code, note], i) => {
      const x = M + 0.34 + i * legW;
      badge(s, { x, y: legY + 0.1, n, size: 0.22, fill: K.accent1, name: `leg-b${i}` });
      s.addText(
        [{ text: code, options: { fontFace: MONO, fontSize: 8.5, color: K.accent1, breakLine: true } },
         { text: note, options: { fontSize: 8.5, color: 'C9CDD4' } }],
        { x: x + 0.3, y: legY + 0.06, w: legW - 0.44, h: 0.32, isTextBox: true, margin: 0 },
      );
    });

  s.addNotes(
    'This is the slide to photograph. It is the same shape as any modern API platform blueprint, with Hive in the '
    + 'federation role. '
    + 'Read it in three columns. Left is design time: CI runs the Hive CLI, the registry stores versions, composition '
    + 'and checks run there, and usage analytics accumulate. Nothing on the left is in the request path — if the '
    + 'Console is down, traffic keeps flowing. That property is why the artifact handoff matters. '
    + 'The middle column is the request path, top to bottom. Clients post an operation. It hits our existing edge '
    + 'gateway first, which still does TLS, routing, WAF and coarse rate limiting — federation does not replace the '
    + 'edge, it sits behind it. The supergraph runtime parses, validates, applies authorization, builds a query plan, '
    + 'executes it against subgraphs, and merges. Subgraphs then talk to the domain services in whatever protocol '
    + 'those services already speak: REST, gRPC, SQL. That last hop is the important one for us, because our REST '
    + 'services do not change at all. '
    + 'The right column is telemetry, and it flows in two directions worth distinguishing. OTLP traces and Prometheus '
    + 'metrics go to our normal APM. Usage reports go back to Hive specifically, and that is what powers field-level '
    + 'insights and conditional breaking changes. '
    + 'The three numbered flows at the bottom are the only integration points: publish, poll, report. '
    + 'Security and observability are cross-cutting here, the same as in any defence-in-depth design — every layer '
    + 'enforces something, rather than one layer enforcing everything.',
  );
}

// =====================================================================
// 7 — Schema delivery pipeline
// =====================================================================
pres.addSection({ title: 'Schema lifecycle' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Schema lifecycle' });
  s.addText('Schema delivery pipeline', { placeholder: 'title' });
  subtitle(s, 'Three CLI commands, each at a different point in the pipeline.');

  const stages = [
    { n: 1, when: 'ON PULL REQUEST', color: K.accent3,
      cmd: 'hive schema:check \\\n  schema.graphql \\\n  --service accounts \\\n  --github',
      note: 'Composes against every other registered subgraph and diffs against the last published version. Reports back to the PR as a GitHub check suite.' },
    { n: 2, when: 'ON MERGE', color: K.accent1,
      cmd: 'hive schema:push \\\n  schema.graphql \\\n  --service accounts \\\n  --revision $GIT_SHA',
      note: 'Uploads an immutable revision keyed by commit SHA. Nothing is served yet — this separates "code is merged" from "service is deployed".' },
    { n: 3, when: 'ON DEPLOY', color: K.accent2,
      cmd: 'hive schema:publish \\\n  --service accounts \\\n  --revision $GIT_SHA \\\n  --fail-on-composition-error',
      note: 'Publishes that exact revision. Hive composes, stores a new version, and pushes the supergraph artifact.' },
  ];

  const sW = (GRID.CW - 2 * 0.36) / 3;
  stages.forEach((st, i) => {
    const x = M + i * (sW + 0.36);
    panel(s, { x, y: GRID.BODY_Y, w: sW, h: 3.3, name: `pipe-${i}` });
    badge(s, { x: x + 0.24, y: GRID.BODY_Y + 0.2, n: st.n, fill: st.color, name: `pipe-b${i}` });
    s.addText(st.when, {
      x: x + 0.64, y: GRID.BODY_Y + 0.22, w: sW - 0.9, h: 0.28, isTextBox: true, margin: 0,
      fontSize: TYPE.LABEL, bold: true, charSpacing: 2, color: st.color, valign: 'middle',
    });
    codeCard(s, {
      x: x + 0.24, y: GRID.BODY_Y + 0.64, w: sW - 0.48, h: 1.3,
      lines: st.cmd.split('\n'), name: `pipe-code-${i}`,
    });
    s.addText(st.note, {
      x: x + 0.24, y: GRID.BODY_Y + 2.06, w: sW - 0.48, h: 1.1, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2,
    });
    if (i < 2) {
      arrowR(s, { x: x + sW + 0.06, y: GRID.BODY_Y + 1.56, w: 0.24,
        color: K.accent4, name: `pipe-a${i}` });
    }
  });

  const afterY = 5.26;
  panel(s, { x: M, y: afterY, w: GRID.CW, h: GRID.BODY_BOTTOM - afterY, fill: TINT_AMBER, name: 'pipe-after' });
  bandLabel(s, { x: M + 0.34, y: afterY + 0.12, text: 'WHAT HIVE DOES AFTER PUBLISH — NO HUMAN IN THE LOOP', color: K.accent1, w: 6.0 });
  const afterSteps = ['Validate SDL', 'Compose supergraph', 'Store immutable version', 'Publish artifact', 'Runtime polls & reloads'];
  const aW = (GRID.CW - 0.68 - 4 * 0.26) / 5;
  afterSteps.forEach((label, i) => {
    const x = M + 0.34 + i * (aW + 0.26);
    node(s, { x, y: afterY + 0.46, w: aW, h: 0.42, label, size: TYPE.TINY,
      border: K.accent1, name: `after-${i}` });
    if (i < 4) {
      arrowR(s, { x: x + aW + 0.04, y: afterY + 0.585, w: 0.18,
        color: K.accent1, name: `after-a${i}` });
    }
  });

  s.addNotes(
    'Three commands, and the distinction between them is the part people get wrong. '
    + 'Check runs on the pull request. It is read-only: it composes the proposed schema against every other '
    + 'registered subgraph and diffs it against what is published today. With the github flag the result lands on '
    + 'the PR as a check suite, so review happens where review already happens. '
    + 'Push runs on merge. It uploads an immutable revision keyed by the commit SHA, and nothing starts serving. '
    + 'That matters because merged is not deployed. If you publish at merge time, the registry claims fields exist '
    + 'that no running service can resolve yet. '
    + 'Publish runs on deploy, and references the revision by SHA, so you publish the exact bytes that were reviewed. '
    + 'Fail-on-composition-error is worth defaulting to: without it Hive records an invalid version and keeps serving '
    + 'the last valid supergraph, which is a safe default but silent. With it, a bad deploy fails loudly in CI. '
    + 'The amber band is everything after publish, and there is no human in it. Validate, compose, version, publish '
    + 'the artifact, and the runtime picks it up by polling. A schema change does not need a gateway redeploy — that '
    + 'is the operational payoff of the artifact handoff on the previous slide.',
  );
}

// =====================================================================
// 8 — Schema checks
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Schema lifecycle' });
  s.addText('Schema checks and change classification', { placeholder: 'title' });
  subtitle(s, 'Breakage is caught in review, not in an incident channel.');

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
    text: 'Any failure blocks the pull request, not production.' });

  const rx = M + lw + GRID.GAP;
  const rw = GRID.CW - lw - GRID.GAP;
  bandLabel(s, { x: rx, y: GRID.BODY_Y, text: 'HOW A CHANGE IS CLASSIFIED', w: 4.2 });
  const sevPitch = 1.06, sevH = 0.92;
  [['SAFE', 'Adding a field, a type, or an optional argument. No existing operation changes shape.', K.accent5],
   ['DANGEROUS', 'May break clients that are not future-proof — the textbook case is a new enum value an older client does not handle.', AMBER_DARK],
   ['BREAKING', 'Removing or renaming a field, narrowing a type, making an argument required. Existing operations stop working.', K.accent6]]
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
        fontSize: TYPE.SMALL, color: C.text2, valign: 'middle',
      });
    });

  const cbcY = COL_Y + 3 * sevPitch + 0.18;
  panel(s, { x: rx, y: cbcY, w: rw, h: GRID.BODY_BOTTOM - cbcY, fill: TINT_AMBER, name: 'cbc-note' });
  s.addText(
    [{ text: 'Conditional breaking changes:  ', options: { bold: true } },
     { text: 'because the runtime reports field-level usage, Hive can downgrade a removal that no client has requested in the retention window from BREAKING to safe-to-ship.', options: {} }],
    { x: rx + 0.3, y: cbcY, w: rw - 0.6, h: GRID.BODY_BOTTOM - cbcY,
      isTextBox: true, margin: 0, valign: 'middle', fontSize: TYPE.BODY, color: C.text2 },
  );

  s.addNotes(
    'Checks are the governance payoff, and the reason a registry is worth running at all. '
    + 'Four stages on the left: parse, validate against the spec, compose against the other subgraphs, then diff '
    + 'against the last published version. Composition is the one that catches cross-team breakage — a change that '
    + 'is valid in isolation can still make the supergraph uncomposable. '
    + 'The three severities on the right are Hive\'s own classification, the enum SeverityLevelType: SAFE, DANGEROUS, '
    + 'BREAKING. DANGEROUS is the one worth explaining, because people assume it means "probably breaking". It does '
    + 'not. It means the change only breaks clients that were not written defensively. The canonical example is '
    + 'adding an enum value: a client with an exhaustive switch and no default will fall over; a future-proof client '
    + 'will not. '
    + 'The amber box is the part that makes this better than a naive schema diff. Because the runtime reports which '
    + 'fields were actually queried, by which client, Hive can tell you that removing a field is safe because nothing '
    + 'has touched it in the retention window. Without usage data, every removal is breaking and teams stop removing '
    + 'anything. That is how schemas rot. '
    + 'A genuinely breaking change can still be approved deliberately in the Console, with the approval recorded.',
  );
}

// =====================================================================
// 9 — Request lifecycle
// =====================================================================
pres.addSection({ title: 'Runtime' });
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('The request lifecycle, end to end', { placeholder: 'title' });
  subtitle(s, 'Eight stages from client to response. Every one of them is a place to enforce policy.');

  const steps = [
    ['Edge gateway', 'TLS termination, route match, WAF, coarse rate limiting. The GraphQL body is opaque here.'],
    ['Parse & validate', 'The operation is parsed and validated against the public API schema. @inaccessible fields are not part of it.'],
    ['Authentication', 'JWT signature and claims verified. Claims are placed in the request context for later stages.'],
    ['Policy & limits', 'Field-level authz via @authenticated and @requiresScope; depth, height and cost limits; persisted-document safelist.'],
    ['Query planning', 'The planner reads join__ directives in the supergraph and emits a plan of parallel and sequential fetches.'],
    ['Execution', 'Fetches run in parallel where independent, in sequence where an _entities join needs an upstream key.'],
    ['Merge & shape', 'Subgraph results are flattened into the exact shape of the client selection set.'],
    ['Report', 'Usage reported to Hive; OTLP spans and Prometheus metrics emitted for the whole path.'],
  ];

  const colW = (GRID.CW - 0.4) / 2;
  const rowH = 0.52;
  steps.forEach(([head, body], i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x = M + col * (colW + 0.4);
    const y = GRID.BODY_Y + row * (rowH + 0.55);
    badge(s, { x, y: y + 0.04, n: i + 1, size: 0.32,
      fill: i < 4 ? K.accent2 : K.accent3, name: `lc-b${i}` });
    s.addText(head, {
      x: x + 0.44, y, w: colW - 0.44, h: 0.3, isTextBox: true, margin: 0,
      fontSize: TYPE.H3 - 1, bold: true, color: C.text1,
    });
    s.addText(body, {
      x: x + 0.44, y: y + 0.3, w: colW - 0.44, h: 0.74, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2,
    });
  });

  s.addNotes(
    'Eight stages. Walk them quickly, but land three points. '
    + 'One: the edge gateway cannot see inside a GraphQL request. To it, every operation is the same POST to the '
    + 'same path, which is why traditional per-endpoint rate limiting stops working and why cost-based limits move '
    + 'into the supergraph layer at stage four. '
    + 'Two: validation at stage two is against the public API schema, not the full supergraph. Fields marked '
    + '@inaccessible exist internally for composition but are not part of the contract clients can query. '
    + 'Three: stages three and four are where federation earns its keep for security. Because the runtime knows the '
    + 'schema, authorization is field-level — @authenticated and @requiresScope let the router work out the claims a '
    + 'given query needs and strip unauthorized fields with a field-level error, rather than rejecting the whole '
    + 'request. Persisted documents go here too: if only known operation ids are accepted, arbitrary queries cannot '
    + 'be sent at all. '
    + 'Stages five and six are the next slide, so do not pre-empt them. Stage eight is the loop back to the Console '
    + 'that makes conditional breaking changes possible. '
    + 'The framing to leave them with: this is defence in depth. Every layer enforces something, rather than one '
    + 'layer trying to enforce everything.',
  );
}

// =====================================================================
// 10 — Query planning and entity resolution
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('Query planning and entity resolution', { placeholder: 'title' });
  subtitle(s, 'One operation becomes a dependency graph of subgraph fetches.');

  const lW = 5.4;
  bandLabel(s, { x: M, y: GRID.BODY_Y, text: 'CLIENT OPERATION', color: K.accent2, w: 3.4 });
  codeCard(s, {
    x: M, y: GRID.BODY_Y + 0.3, w: lW, h: 1.54, name: 'qp-op',
    lines: [
      'query AccountOverview($id: ID!) {',
      '  account(id: $id) {',
      '    name                 # Accounts',
      '    policies {           # Policies',
      '      premium',
      '      funds { nav } } } }  # Funds',
    ],
  });

  bandLabel(s, { x: M, y: 3.74, text: 'GENERATED QUERY PLAN', color: K.accent1, w: 3.4 });
  codeCard(s, {
    x: M, y: 4.04, w: lW, h: 1.74, fill: '2A2236', name: 'qp-plan',
    lines: [
      'Sequence {',
      '  Fetch(service: "accounts")',
      '  Flatten(path: "account") {',
      '    Fetch(service: "policies")  # _entities',
      '  }',
      '  Flatten(path: "account.policies.@") {',
      '    Fetch(service: "funds")     # _entities',
      '  } }',
    ],
  });

  const rx = M + lW + GRID.GAP;
  const rw = GRID.CW - lW - GRID.GAP;
  bandLabel(s, { x: rx, y: GRID.BODY_Y, text: 'WHAT ACTUALLY GOES OVER THE WIRE', color: K.accent3, w: 4.6 });

  const hops = [
    ['Fetch 1', 'accounts', 'account(id:) { __typename id name }', K.accent3],
    ['Fetch 2', 'policies', '_entities([{__typename:"Account", id}])', K.accent3],
    ['Fetch 3', 'funds', '_entities([{__typename:"Policy", id}, …])', K.accent3],
  ];
  hops.forEach(([n, svc, call, col], i) => {
    const y = GRID.BODY_Y + 0.32 + i * 0.88;
    panel(s, { x: rx, y, w: rw, h: 0.76, name: `hop-${i}` });
    s.addText(
      [{ text: `${n}  ·  `, options: { bold: true, color: C.text1, fontSize: TYPE.SMALL } },
       { text: svc, options: { fontFace: MONO, color: col, fontSize: TYPE.SMALL, breakLine: true } },
       { text: call, options: { fontFace: MONO, color: K.dk2, fontSize: 8.5 } }],
      { x: rx + 0.26, y, w: rw - 0.52, h: 0.76, isTextBox: true, margin: 0, valign: 'middle' },
    );
    if (i < 2) {
      arrowD(s, { x: rx + 0.5, y: y + 0.78, h: 0.1, color: K.accent3, name: `hop-a${i}` });
    }
  });

  const noteY = 4.7;
  panel(s, { x: rx, y: noteY, w: rw, h: GRID.BODY_BOTTOM - noteY, fill: TINT_TEAL, name: 'qp-note' });
  s.addText(
    [{ text: 'Sequential because of data dependency.  ', options: { bold: true, color: K.dk1 } },
     { text: 'Fetch 2 needs the account id that Fetch 1 returned; Fetch 3 needs the policy ids from Fetch 2. '
         + 'Independent branches of a plan run in parallel. Batching one ', options: { color: K.dk2 } },
     { text: '_entities', options: { fontFace: MONO, color: K.accent2 } },
     { text: ' call per subgraph per level is what stops federation becoming an N+1 machine.',
       options: { color: K.dk2 } }],
    { x: rx + 0.3, y: noteY, w: rw - 0.6, h: GRID.BODY_BOTTOM - noteY,
      isTextBox: true, margin: 0, valign: 'middle', fontSize: TYPE.SMALL },
  );

  s.addNotes(
    'This slide answers "what does the gateway actually do", and it is the one engineers ask about. '
    + 'Top left is the client operation. Four fields, three different owners, and the client has no idea. '
    + 'Bottom left is the plan the router generates from the join directives in the supergraph. The vocabulary is '
    + 'worth knowing: Sequence means do these in order, Parallel means fan out, Fetch is one HTTP call to one '
    + 'subgraph, and Flatten walks into the response to collect the keys for the next hop. The @ in the last path '
    + 'means "every element of this list". '
    + 'The right column is what leaves the box. Three HTTP calls, and notice fetches two and three go through the '
    + '_entities root field with a list of representations. '
    + 'Why sequential? Pure data dependency. You cannot ask Policies about an account until Accounts has told you '
    + 'the id, and you cannot ask Funds about policies until Policies has returned them. Independent branches do run '
    + 'in parallel — if the query also asked for something owned only by Funds at the top level, that fetch would be '
    + 'issued concurrently with fetch one. '
    + 'The sentence to emphasise is the last one. The planner batches: one call per subgraph per level, carrying all '
    + 'the representations at that level. Without batching this would be a per-row call and federation would be '
    + 'slower than the REST version. With it, depth costs you round trips but width costs you nothing. '
    + 'If someone asks how to debug this: both runtimes can expose the generated plan.',
  );
}

// =====================================================================
// 11 — Runtime policy
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('Caching, security and traffic policy', { placeholder: 'title' });
  subtitle(s, 'Declared on the schema, enforced at the supergraph layer.');

  const cols = [
    { label: 'CACHING', color: K.accent1, tint: TINT_AMBER,
      items: [
        ['Response cache', 'Hive Gateway only. In-memory or Redis. Keyed per operation and variables; a hit returns before planning and before any subgraph call.'],
        ['@cacheControl', 'Per-type and per-field TTL declared in the subgraph schema rather than configured centrally.'],
        ['Entity invalidation', 'Cached responses are tagged by the entities they contain, so a mutation can purge exactly what it changed.'],
        ['Plan & parse caches', 'In both runtimes. These remove CPU, not subgraph calls — do not confuse them with a response cache.'],
      ] },
    { label: 'SECURITY', color: K.accent6, tint: TINT_GREY,
      items: [
        ['JWT authentication', 'Verified between client and gateway, and optionally re-signed between gateway and subgraph.'],
        ['@authenticated / @requiresScope', 'Field-level authorization. Unauthorized fields are removed from the plan with a field-level error.'],
        ['Persisted documents', 'Clients send an operation id, not a query string. An effective safelist, and a smaller request.'],
        ['Depth, height & cost limits', 'The defence against a single deeply nested query that fans out into thousands of subgraph calls.'],
      ] },
    { label: 'TRAFFIC', color: K.accent2, tint: TINT_TEAL,
      items: [
        ['Request batching', 'Automatic batching and deduplication of subgraph calls within one operation.'],
        ['Traffic shaping', 'Connection pooling, per-subgraph timeouts and retry behaviour.'],
        ['@rateLimit', 'Declarative per-field rate limiting — the GraphQL-aware replacement for per-endpoint limits.'],
        ['Compression', 'End-to-end HTTP compression from client through to subgraph.'],
      ] },
  ];

  const cW = (GRID.CW - 2 * 0.3) / 3;
  cols.forEach((col, i) => {
    const x = M + i * (cW + 0.3);
    panel(s, { x, y: GRID.BODY_Y, w: cW, h: 4.06, fill: col.tint, name: `rt-${i}` });
    bandLabel(s, { x: x + 0.26, y: GRID.BODY_Y + 0.18, text: col.label, color: col.color, w: cW - 0.5 });
    col.items.forEach(([head, body], j) => {
      const y = GRID.BODY_Y + 0.56 + j * 0.86;
      s.addText(head, {
        x: x + 0.26, y, w: cW - 0.52, h: 0.24, isTextBox: true, margin: 0,
        fontSize: TYPE.SMALL, bold: true, color: C.text1,
      });
      s.addText(body, {
        x: x + 0.26, y: y + 0.24, w: cW - 0.52, h: 0.58, isTextBox: true, margin: 0,
        fontSize: 9.5, color: C.text2,
      });
    });
  });

  caption(s, { x: M, y: 5.94, w: GRID.CW, align: 'left', color: K.accent6, h: 0.3,
    text: 'Runtime choice: Hive Gateway has the response cache. Hive Router has the Rust plugin system, coprocessors and higher throughput — but no response cache.' });

  s.addNotes(
    'Three families of policy, and the thing they share is that they are declared on the schema and enforced in one '
    + 'place, instead of being reimplemented in every service. '
    + 'Caching first, because it is the one most often misunderstood. The response cache lives in Hive Gateway. A hit '
    + 'returns the finished GraphQL response before query planning and before any subgraph is touched, which is why '
    + 'it is the layer that actually removes backend load. TTLs come from @cacheControl in the subgraph schema, so '
    + 'the team that owns the data decides how stale it may be. Entity tagging means a mutation can purge precisely '
    + 'the cached responses containing that entity, rather than flushing everything. '
    + 'The fourth item is the trap. Both runtimes have parse, validation and query-plan caches. Those make planning '
    + 'cheaper on repeat operations. They do not save a single subgraph call. If someone says "the Router has '
    + 'caching", that is what they mean. '
    + 'Security: the two directives are the headline. Because the router understands the schema, authorization is '
    + 'per field, and an unauthorized field is removed from the plan with a field-level error while the rest of the '
    + 'query still returns. Persisted documents are worth pushing for in production — the client sends an id, the '
    + 'server resolves it to a known operation, and arbitrary queries simply cannot be submitted. '
    + 'Traffic: the point of @rateLimit is that per-endpoint limits are meaningless when every request is a POST to '
    + '/graphql. Limits have to be field-aware or cost-aware. '
    + 'The red line is the architectural decision this session should leave open for discussion.',
  );
}

// =====================================================================
// 12 — Takeaways
// =====================================================================
pres.addSection({ title: 'Close' });
{
  const s = pres.addSlide({ masterName: 'CLOSE_DARK', sectionTitle: 'Close' });
  s.addText('What to take away', { placeholder: 'title' });
  hexCluster(s, 11.3, 5.0, 0.6, K.accent1, { count: 5, transparency: 62 });

  [['Federation is an organisational answer with a technical mechanism',
    'Choose it on team count, not traffic. @key plus _entities is the whole mechanism; everything else is tooling.'],
   ['Three integration points, nothing more',
    'publish to the registry, poll the supergraph artifact, report usage. The registry is never in the request path.'],
   ['Checks plus usage data is what makes the schema evolvable',
    'SAFE, DANGEROUS and BREAKING on the pull request, with removals judged against real field-level traffic.'],
   ['Pick the runtime deliberately',
    'Hive Gateway for the response cache; Hive Router for Rust throughput, plugins and coprocessors. All MIT, all self-hostable.']]
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
    'Four takeaways, then questions. '
    + 'One: do not adopt federation because GraphQL is fashionable. Adopt it when more than one team needs to '
    + 'contribute to one API and the single-server pattern has become a bottleneck. The mechanism underneath is '
    + 'small — a key directive and an entities root field. '
    + 'Two: the integration surface is three flows. Publish, poll, report. Worth repeating because it is what makes '
    + 'this safe to trial: the registry is a build-time dependency, not a runtime one, so an outage in the Console '
    + 'does not take down traffic. '
    + 'Three: checks on their own are a schema diff, which any tool can do. Checks plus field-level usage data are '
    + 'what let a team actually delete a field, and that is the difference between a schema that evolves and one '
    + 'that only grows. '
    + 'Four: the runtime choice is real and should be made on evidence, not preference. Response cache, or raw '
    + 'throughput plus extensibility. '
    + 'Likely questions to be ready for: how do existing REST services fit — they do not change, the subgraph is a '
    + 'thin layer in front of them. What does this cost — everything shown is MIT and self-hostable; the cost is '
    + 'operating it. What is the smallest useful first step — one subgraph in front of one existing service, with '
    + 'checks wired into CI.',
  );
}

// ------------------------------------------------------------- write
(async () => {
  const out = 'WebCoP-Hive-GraphQL.pptx';
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log('wrote', out);
})();
