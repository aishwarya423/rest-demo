/**
 * Intro session deck: Introduction to GraphQL Federation and how Hive supports it.
 * 19 slides, for frontend and backend developers. Same theme, grid and helper
 * vocabulary as build.js, so the two decks read as one series.
 *
 * Regenerate:
 *   NODE_PATH=<dir with pptxgenjs + jszip> PPTX_SKILL=<skill dir> node build-intro.js
 *   python3 preserve_space.py ../Intro-GraphQL-Federation-Hive.pptx
 *
 * Every coordinate derives from GRID and every font size from TYPE.
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
const AMBER_DARK = 'C98A1B';
const TINT_TEAL = 'E9F1F2';
const TINT_AMBER = 'FBF3E4';
const TINT_GREY = 'F3F4F6';
const TINT_RED = 'F7EBEB';
const TINT_GREEN = 'EAF3EE';
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
  CW: W - 2 * M,
  RIGHT: W - M,
  TITLE_Y: 0.46,
  TITLE_H: 0.72,
  SUB_Y: 1.22,
  SUB_H: 0.34,
  BODY_Y: 1.74,
  BODY_BOTTOM: 6.3,
  FOOT_Y: H - 0.48,
  GAP: 0.3,
};
const TYPE = {
  TITLE: 30,
  SUB: 14,
  H3: 15,
  BODY: 14,
  SMALL: 12.5,
  TINY: 11,
  CAPTION: 10.5,
  LABEL: 9.5,
  NODE: 12,
  NODE_SUB: 10,
  CODE: 10.5,
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Web Community of Practice';
pres.title = 'Introduction to GraphQL Federation and How Hive Supports It';
pres.subject = 'GraphQL fundamentals, federation, schema lifecycle, Hive tooling and caching';

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
    fill: { color: fill }, line: { type: 'none' }, objectName: name,
  });
}

/** Dashed-outline region, used to mark process/ownership boundaries. */
function zone(slide, { x, y, w, h, color, fill = 'FFFFFF', name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.04,
    fill: { color: fill },
    line: { color, width: 1, dashType: 'dash' },
    objectName: name,
  });
}

function bandLabel(slide, { x, y, text, color = C.accent4, w = 4 }) {
  slide.addText(text, {
    x, y, w, h: 0.26, isTextBox: true, margin: 0,
    fontSize: TYPE.LABEL, bold: true, charSpacing: 2, color,
  });
}

/** One node function, so every diagram box in the deck matches. */
function node(slide, {
  x, y, w, h = 0.6, label, sub, fill = 'FFFFFF', border = HAIRLINE,
  color = K.dk2, bold = false, mono = false, size = TYPE.NODE, subSize = TYPE.NODE_SUB, name,
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
       { text: sub, options: { fontSize: subSize } }]
    : [{ text: label, options: head }];
  slide.addText(runs, {
    x: x + 0.06, y, w: w - 0.12, h, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', color,
  });
}

/** Dark card of monospaced lines — SDL, CLI, query plans. */
function codeCard(slide, { x, y, w, h, head, lines, size = TYPE.CODE, name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: CODE_BG }, line: { type: 'none' }, objectName: name,
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
    isTextBox: true, margin: 0, fontFace: MONO, fontSize: size,
    color: CODE_FG, lineSpacingMultiple: 1.15, valign: 'top',
  });
}

/** Straight connector with an arrowhead at (x2, y2). */
function conn(slide, {
  x1, y1, x2, y2, color = K.accent4, width = 1.5, dash, head = 'triangle', tail, name,
}) {
  const line = { color, width, endArrowType: head };
  if (dash) line.dashType = dash;
  if (tail) line.beginArrowType = tail;
  slide.addShape(pres.ShapeType.line, {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    flipH: x2 < x1, flipV: y2 < y1,
    line, objectName: name,
  });
}

/** Monospaced annotation beside a connector. */
function edgeLabel(slide, { x, y, w, text, color = C.accent4, align = 'left', mono = true }) {
  const o = {
    x, y, w, h: 0.22, isTextBox: true, margin: 0,
    fontSize: 9.5, color, align, valign: 'middle',
  };
  if (mono) o.fontFace = MONO;
  slide.addText(text, o);
}

function caption(slide, { x, y, w, text, align = 'left', color = C.accent4, h = 0.28, italic = true }) {
  slide.addText(text, {
    x, y, w, h, isTextBox: true, margin: 0,
    fontSize: TYPE.CAPTION, align, color, italic,
  });
}

/** Hexagon badge — the deck's motif (Hive). */
function hexBadge(slide, { x, y, n, size = 0.42, fill = K.accent1, color = 'FFFFFF', fontSize = 12, name }) {
  slide.addShape(pres.ShapeType.hexagon, {
    x, y, w: size, h: size, rotate: 90,
    fill: { color: fill }, line: { type: 'none' }, objectName: name,
  });
  slide.addText(String(n), {
    x, y, w: size, h: size, isTextBox: true, margin: 0,
    align: 'center', valign: 'middle', fontSize, bold: true, color,
  });
}

/** Bulleted runs for addText. */
function bullets(items, { size = TYPE.SMALL, after = 5, color } = {}) {
  return items.map((t, i) => {
    const options = { bullet: { indent: 13 }, breakLine: i < items.length - 1, paraSpaceAfter: after, fontSize: size };
    if (color) options.color = color;
    if (Array.isArray(t)) {
      return { text: t[0] + ' ', options: { ...options, bold: true, breakLine: false } };
    }
    return { text: t, options };
  });
}

/** Bullet list where each item may be [boldLead, rest]. */
function richBullets(items, { size = TYPE.SMALL, after = 6 } = {}) {
  const runs = [];
  items.forEach((it, i) => {
    const last = i === items.length - 1;
    if (Array.isArray(it)) {
      runs.push({ text: it[0] + ' ', options: { bullet: { indent: 13 }, bold: true, fontSize: size, color: K.dk1 } });
      runs.push({ text: it[1], options: { fontSize: size, breakLine: !last, paraSpaceAfter: after } });
    } else {
      runs.push({ text: it, options: { bullet: { indent: 13 }, fontSize: size, breakLine: !last, paraSpaceAfter: after } });
    }
  });
  return runs;
}

function card(slide, {
  x, y, w, h, head, body, fill = TINT_GREY, headColor = C.text1, size = TYPE.SMALL, name,
}) {
  panel(slide, { x, y, w, h, fill, name });
  slide.addText(head, {
    x: x + 0.22, y: y + 0.16, w: w - 0.44, h: 0.3, isTextBox: true, margin: 0,
    fontSize: TYPE.H3, bold: true, color: headColor,
  });
  slide.addText(body, {
    x: x + 0.22, y: y + 0.52, w: w - 0.44, h: h - 0.64, isTextBox: true, margin: 0,
    fontSize: size, color: C.text2, valign: 'top',
  });
}

function chip(slide, { x, y, w, text, fill, color = 'FFFFFF', h = 0.3 }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.15, fill: { color: fill }, line: { type: 'none' },
  });
  slide.addText(text, {
    x, y, w, h, isTextBox: true, margin: 0, align: 'center', valign: 'middle',
    fontSize: TYPE.LABEL, bold: true, charSpacing: 1, color,
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
      name: 'title', type: 'title', x: M, y: 2.2, w: 8.6, h: 1.7,
      fontSize: 40, bold: true, color: K.lt1, fontFace: THEME.headFontFace, valign: 'bottom',
    }, text: '' } },
    { placeholder: { options: {
      name: 'body', type: 'body', x: M, y: 4.05, w: 8.2, h: 0.9,
      fontSize: 18, color: 'C9CDD4', valign: 'top',
    }, text: '' } },
  ],
});

pres.defineSlideMaster({
  title: 'SECTION_DARK',
  background: { color: K.dk1 },
  objects: [
    { placeholder: { options: {
      name: 'title', type: 'title', x: M, y: 2.9, w: 9.0, h: 1.0,
      fontSize: 36, bold: true, color: K.lt1, fontFace: THEME.headFontFace, valign: 'middle',
    }, text: '' } },
    { placeholder: { options: {
      name: 'body', type: 'body', x: M, y: 3.95, w: 9.0, h: 0.6,
      fontSize: 16, color: 'C9CDD4', valign: 'top',
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
    { text: { text: 'Introduction to GraphQL Federation · Hive', options: {
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

function section(sectionTitle, title, sub, n) {
  const s = pres.addSlide({ masterName: 'SECTION_DARK', sectionTitle });
  hexCluster(s, 9.9, 1.9, 0.9, K.accent1);
  s.addText(`PART ${n}`, {
    x: M, y: 2.5, w: 4, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 12, bold: true, charSpacing: 3, color: K.accent1,
  });
  s.addText(title, { placeholder: 'title' });
  s.addText(sub, { placeholder: 'body' });
  return s;
}

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
  s.addText('Introduction to GraphQL Federation', { placeholder: 'title' });
  s.addText('…and how Hive supports building and managing a federated graph',
    { placeholder: 'body' });
  s.addText('For frontend and backend developers  ·  GraphQL basics → Federation → Hive', {
    x: M, y: 5.3, w: 9.0, h: 0.3, isTextBox: true, margin: 0,
    fontSize: 12, color: K.accent4,
  });
  s.addNotes(
    'Hi everyone! Today I am going to introduce GraphQL Federation and explain how Hive supports '
    + 'building and managing a federated GraphQL architecture. Before jumping into federation I want to '
    + 'spend a few minutes on GraphQL fundamentals. This session is for both frontend and backend '
    + 'developers, so we start with the basics and gradually move towards federation.',
  );
}

// =====================================================================
// 2 — Agenda
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Opening' });
  s.addText('Where we are going today', { placeholder: 'title' });
  subtitle(s, 'From a single GraphQL API to a federated graph managed with Hive.');

  const parts = [
    { t: 'GraphQL fundamentals', q: 'What does a schema promise — and who keeps it?', c: K.accent4, items: ['Queries, mutations, subscriptions', 'Schema, server and resolvers', 'Why GraphQL over REST'] },
    { t: 'Why federation', q: 'Why split one API across many services?', c: K.accent3, items: ['When one GraphQL service gets too big', 'Subgraphs and the supergraph', 'Schema composition'] },
    { t: 'Hive toolchain', q: 'How do schema changes ship safely?', c: K.accent1, items: ['Schema check → publish → compose', 'CLI, Console, Gateway, Router, Yoga', 'Monitoring and observability'] },
    { t: 'Runtime deep-dive', q: 'What happens on every single request?', c: K.accent2, items: ['How a federated request runs', 'Plugins vs coprocessors', 'Caching and invalidation'] },
  ];
  const cw = (GRID.CW - 3 * GRID.GAP) / 4;
  const top = GRID.BODY_Y + 0.25;
  const ch = GRID.BODY_BOTTOM - top;
  parts.forEach((p, i) => {
    const x = M + i * (cw + GRID.GAP);
    panel(s, { x, y: top, w: cw, h: ch, name: `agenda-${i}` });
    hexBadge(s, { x: x + 0.24, y: top + 0.3, n: i + 1, size: 0.62, fill: p.c, fontSize: 18 });
    s.addText(p.t, {
      x: x + 0.24, y: top + 1.1, w: cw - 0.48, h: 0.5, isTextBox: true, margin: 0,
      fontSize: 17, bold: true, color: C.text1, fontFace: THEME.headFontFace, valign: 'top',
    });
    s.addText(bullets(p.items, { size: TYPE.SMALL, after: 8 }), {
      x: x + 0.24, y: top + 1.75, w: cw - 0.48, h: 1.35, isTextBox: true, margin: 0,
      color: C.text2, valign: 'top',
    });
    s.addText(p.q, {
      x: x + 0.24, y: top + ch - 0.95, w: cw - 0.48, h: 0.7, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, italic: true, color: p.c, valign: 'bottom',
    });
    if (i < 3) {
      conn(s, { x1: x + cw + 0.04, y1: top + 0.61, x2: x + cw + GRID.GAP - 0.04, y2: top + 0.61, width: 1.25 });
    }
  });
  s.addNotes(
    'Four parts. First the GraphQL fundamentals everyone needs. Then why we need federation at all. '
    + 'Then the Hive toolchain that manages the schema lifecycle. And finally the runtime: how a '
    + 'federated request runs, how we customise the router, and how caching works.',
  );
}

// =====================================================================
// 3 — Section: fundamentals
// =====================================================================
pres.addSection({ title: 'GraphQL fundamentals' });
section('GraphQL fundamentals', 'GraphQL fundamentals', 'Prerequisites: the vocabulary we need before talking about federation.', 1)
  .addNotes('Before jumping into federation, let us spend a few minutes on GraphQL fundamentals. If you already '
    + 'work with GraphQL every day, this is a quick refresher; if you mostly work with REST, this gives us the '
    + 'shared vocabulary for the rest of the session. We will cover three things: what GraphQL is and its three '
    + 'operation types, what a schema, a server and resolvers are, and why we would choose GraphQL over REST.');

// =====================================================================
// 4 — What is GraphQL
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'GraphQL fundamentals' });
  s.addText('What is GraphQL?', { placeholder: 'title' });
  subtitle(s, 'A query language for APIs and a runtime for executing those queries — an alternative to REST.');

  // Left: REST vs GraphQL topology
  const lx = M;
  bandLabel(s, { x: lx, y: GRID.BODY_Y, text: 'REST — MANY ENDPOINTS', color: K.accent6 });
  node(s, { x: lx, y: 2.3, w: 1.55, h: 1.0, label: 'Client', sub: 'React app', name: 'rest-client' });
  const eps = ['GET /users/101', 'GET /users/101/posts', 'GET /posts/7/comments'];
  eps.forEach((e, i) => {
    const y = 2.08 + i * 0.5;
    node(s, { x: 3.15, y, w: 2.7, h: 0.4, label: e, mono: true, size: 10.5, name: `rest-ep-${i}` });
    conn(s, { x1: lx + 1.55, y1: 2.8, x2: 3.15, y2: y + 0.2, width: 1.25 });
  });

  bandLabel(s, { x: lx, y: 3.95, text: 'GRAPHQL — ONE ENDPOINT', color: K.accent5 });
  node(s, { x: lx, y: 4.35, w: 1.55, h: 1.0, label: 'Client', sub: 'React app', name: 'gql-client' });
  node(s, {
    x: 3.15, y: 4.5, w: 2.7, h: 0.7, label: 'POST /graphql', sub: 'operation describes the data',
    fill: TINT_AMBER, border: K.accent1, name: 'gql-ep',
  });
  conn(s, { x1: lx + 1.55, y1: 4.85, x2: 3.15, y2: 4.85, color: K.accent1, width: 1.75 });
  caption(s, {
    x: lx, y: 5.6, w: 5.3, h: 0.6,
    text: 'Example: fetch a user and their posts in one query instead of two endpoint calls.',
  });

  // Right: the three operation types
  const rx = 6.45;
  const rw = GRID.RIGHT - rx;
  const ops = [
    { t: 'Query', tag: '≈ GET', d: 'Fetch data', c: K.accent2, tint: TINT_TEAL, code: 'query { user(id: "101") { name } }' },
    { t: 'Mutation', tag: '≈ POST / PUT / DELETE', d: 'Create, update or delete data', c: K.accent3, tint: TINT_AMBER, code: 'mutation { updateUser(id: "101", name: "Asha") { id } }' },
    { t: 'Subscription', tag: 'real-time', d: 'Receive live updates pushed by the server', c: K.accent1, tint: TINT_AMBER, code: 'subscription { newComment(postId: "7") { message } }' },
  ];
  const oh = (GRID.BODY_BOTTOM - GRID.BODY_Y - 2 * GRID.GAP) / 3;
  ops.forEach((o, i) => {
    const y = GRID.BODY_Y + i * (oh + GRID.GAP);
    panel(s, { x: rx, y, w: rw, h: oh, fill: TINT_GREY, name: `op-${i}` });
    hexBadge(s, { x: rx + 0.22, y: y + 0.2, n: o.t[0], size: 0.46, fill: o.c, fontSize: 14 });
    s.addText([
      { text: o.t + '  ', options: { fontSize: TYPE.H3 + 1, bold: true, color: K.dk1 } },
      { text: o.tag, options: { fontSize: TYPE.TINY, color: K.accent4 } },
    ], { x: rx + 0.85, y: y + 0.18, w: rw - 1.05, h: 0.3, isTextBox: true, margin: 0, valign: 'middle' });
    s.addText(o.d, {
      x: rx + 0.85, y: y + 0.5, w: rw - 1.05, h: 0.28, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2,
    });
    s.addText(o.code, {
      x: rx + 0.85, y: y + 0.88, w: rw - 1.05, h: 0.28, isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 10, color: o.c,
    });
  });

  s.addNotes(
    'GraphQL is a query language for APIs and a runtime for executing those queries — think of it as an '
    + 'alternative to REST. In REST we expose multiple endpoints and the client calls each one. In GraphQL '
    + 'we generally expose a single endpoint and the client sends an operation describing exactly what it '
    + 'needs. Three operation types: Query to fetch data, similar in purpose to GET; Mutation to create, '
    + 'update or delete, similar to POST, PUT or DELETE; and Subscription for real-time updates from the server. '
    + 'For example, instead of calling separate endpoints for a user and their posts, one query gets both.',
  );
}

// =====================================================================
// 5 — Schema, server, resolvers
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'GraphQL fundamentals' });
  s.addText('Schema, server and resolvers', { placeholder: 'title' });
  subtitle(s, 'The schema is the contract; the server and its resolvers do the actual work.');

  // Diagram band
  node(s, { x: M, y: 2.3, w: 1.75, h: 1.0, label: 'Client', sub: 'sends an operation', name: 'srv-client' });
  zone(s, { x: 3.0, y: GRID.BODY_Y, w: 5.75, h: 2.15, color: K.accent2, name: 'srv-zone' });
  bandLabel(s, { x: 3.2, y: GRID.BODY_Y + 0.12, text: 'GRAPHQL SERVER · APOLLO SERVER / GRAPHQL YOGA', color: K.accent2, w: 5.4 });
  node(s, {
    x: 3.25, y: 2.3, w: 2.45, h: 1.25, label: 'Schema', sub: 'types, fields, operations, arguments',
    fill: TINT_AMBER, border: K.accent1, name: 'srv-schema',
  });
  node(s, {
    x: 6.05, y: 2.3, w: 2.45, h: 1.25, label: 'Resolvers', sub: 'functions that fetch the data per field',
    fill: TINT_TEAL, border: K.accent2, name: 'srv-resolvers',
  });
  conn(s, { x1: M + 1.75, y1: 2.8, x2: 3.0, y2: 2.8, color: K.accent2 });
  conn(s, { x1: 5.7, y1: 2.92, x2: 6.05, y2: 2.92, color: K.accent2, width: 1.25 });

  const ds = ['Database', 'REST API', 'Other microservice'];
  ds.forEach((d, i) => {
    const y = 1.95 + i * 0.62;
    node(s, { x: 9.65, y, w: 3.06, h: 0.48, label: d, name: `srv-ds-${i}` });
    conn(s, { x1: 8.75, y1: 2.82, x2: 9.65, y2: y + 0.24, width: 1.25 });
  });
  caption(s, { x: 9.65, y: 3.6, w: 3.06, text: 'Resolvers can call anything.' });

  // Bottom band
  const by = 4.25;
  codeCard(s, {
    x: M, y: by, w: 4.6, h: GRID.BODY_BOTTOM - by, head: 'SCHEMA (SDL)', name: 'srv-sdl',
    lines: [
      'type User {',
      '  id: ID!',
      '  name: String!',
      '  email: String!',
      '}',
      'type Query { user(id: ID!): User }',
    ],
  });
  const tx = M + 4.6 + GRID.GAP;
  const tw = GRID.RIGHT - tx;
  const terms = [
    ['Schema', 'Defines what data is available — like Swagger / OpenAPI for REST.', K.accent1],
    ['Server', 'Receives GraphQL requests — like Express, Koa or Fastify for REST.', K.accent2],
    ['Resolvers', 'Contain the logic that fetches the actual data.', K.accent3],
  ];
  const th = (GRID.BODY_BOTTOM - by - 0.55 - 2 * 0.12) / 3;
  terms.forEach(([t, d, c], i) => {
    const y = by + i * (th + 0.12);
    panel(s, { x: tx, y, w: tw, h: th, fill: TINT_GREY, name: `term-${i}` });
    hexBadge(s, { x: tx + 0.18, y: y + (th - 0.36) / 2, n: i + 1, size: 0.36, fill: c, fontSize: 11 });
    s.addText([
      { text: t + '  ', options: { bold: true, color: K.dk1 } },
      { text: d, options: { color: K.dk2 } },
    ], { x: tx + 0.7, y, w: tw - 0.9, h: th, isTextBox: true, margin: 0, fontSize: TYPE.SMALL, valign: 'middle' });
  });
  s.addText('A schema is only a contract — it describes the API, it does not fetch or serve data.', {
    x: tx, y: GRID.BODY_BOTTOM - 0.4, w: tw, h: 0.4, isTextBox: true, margin: 0,
    fontSize: TYPE.SMALL, italic: true, bold: true, color: K.accent6, valign: 'middle',
  });

  s.addNotes(
    'In REST we commonly use Swagger or OpenAPI to describe our APIs. GraphQL has the schema. It defines what '
    + 'types exist, what fields they have, what operations clients can perform and what arguments they accept. '
    + 'This example says a client can request a user by ID and get name and email back. Important: a schema is '
    + 'only a contract — it does not fetch data. For that we need a server, like Apollo Server or GraphQL Yoga, '
    + 'similar to Express or Fastify for REST. The server receives operations, runs the resolvers, and returns '
    + 'the data. Remember three terms: schema, server, resolvers.',
  );
}

// =====================================================================
// 6 — Why GraphQL
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'GraphQL fundamentals' });
  s.addText('Why GraphQL? One screen, one request', { placeholder: 'title' });
  subtitle(s, 'A React page that shows a user profile, their posts and the comments on those posts.');

  // Left: REST waterfall
  bandLabel(s, { x: M, y: GRID.BODY_Y, text: 'REST — DEPENDENT CALLS, MERGED IN THE CLIENT', color: K.accent6, w: 5.8 });
  node(s, { x: M, y: 2.1, w: 1.5, h: 2.15, label: 'React app', sub: 'merges 3 responses', name: 'why-react' });
  const apis = [
    ['User API', 'GET /users/101', '1 → returns user id'],
    ['Posts API', 'GET /posts?userId=101', '2 → returns post ids'],
    ['Comments API', 'GET /comments?postIds=…', '3 → returns comments'],
  ];
  apis.forEach(([n, ep, lab], i) => {
    const y = 2.1 + i * 0.78;
    node(s, { x: 3.4, y, w: 2.95, h: 0.6, label: n, sub: ep, name: `why-api-${i}` });
    conn(s, { x1: M + 1.5, y1: y + 0.3, x2: 3.4, y2: y + 0.3, color: K.accent6, width: 1.25 });
    edgeLabel(s, { x: M + 1.58, y: y + 0.04, w: 1.2, text: `call ${i + 1}`, color: K.accent6 });
  });
  caption(s, { x: M, y: 4.38, w: 5.75, text: 'Each call waits for IDs from the previous one, then the UI stitches it all together.' });

  // Right: GraphQL query
  const rx = 6.95;
  bandLabel(s, { x: rx, y: GRID.BODY_Y, text: 'GRAPHQL — ONE NESTED QUERY', color: K.accent5, w: 5.5 });
  codeCard(s, {
    x: rx, y: 2.1, w: GRID.RIGHT - rx, h: 2.55, name: 'why-query',
    lines: [
      'query {',
      '  user(id: "101") {',
      '    name                # only what the UI needs',
      '    posts {',
      '      title',
      '      comments { message }',
      '    }',
      '  }',
      '}',
    ],
  });

  // Bottom: benefits + caveat
  const by = 4.95;
  const bw = (GRID.CW - 2 * GRID.GAP) / 3;
  const bh = GRID.BODY_BOTTOM - by;
  card(s, {
    x: M, y: by, w: bw, h: bh, fill: TINT_GREEN, head: 'One round trip',
    body: 'The server and its resolvers handle the underlying fetching — no merging logic in the client.',
  });
  card(s, {
    x: M + bw + GRID.GAP, y: by, w: bw, h: bh, fill: TINT_GREEN, head: 'Exactly the fields you need',
    body: 'Need only the name? Ask only for the name. Less over-fetching and under-fetching.',
  });
  card(s, {
    x: M + 2 * (bw + GRID.GAP), y: by, w: bw, h: bh, fill: TINT_RED, head: 'But not magic',
    body: 'GraphQL does not guarantee fewer backend calls — resolvers still need efficient data fetching.',
  });

  s.addNotes(
    'Imagine our React app shows a profile, posts and the comments on those posts. In REST: call the User '
    + 'API, take the user id, call Posts, take the post ids, call Comments, then combine everything in the '
    + 'frontend. Multiple network calls and extra merging logic in the client. With GraphQL the client asks '
    + 'for nested fields in a single operation; the server and resolvers do the fetching. The client also '
    + 'selects only the fields it needs, which reduces over-fetching and under-fetching. But remember: '
    + 'GraphQL does not automatically guarantee fewer backend calls — the server still needs efficient '
    + 'resolvers and data-fetching strategies.',
  );
}

// =====================================================================
// 7 — Section: federation
// =====================================================================
pres.addSection({ title: 'Federation' });
section('Federation', 'Why we need federation', 'When one GraphQL API has to serve many teams.', 2)
  .addNotes('Now that we understand GraphQL, let us move towards federation. In this part we will look at what '
    + 'goes wrong when one GraphQL service has to serve many teams, how we split it into subgraphs, and how '
    + 'federation brings those subgraphs back together as one API. We will also meet two key terms: the '
    + 'supergraph and schema composition.');

// =====================================================================
// 8 — The monolith problem
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Federation' });
  s.addText('One GraphQL service, three teams', { placeholder: 'title' });
  subtitle(s, 'An insurance app with Accounts, Policies and Funds — fine when small, painful as it grows.');

  const lw = 6.0;
  const teams = [['Accounts team', K.accent3], ['Policies team', K.accent2], ['Funds team', K.accent1]];
  const tw = 1.8;
  const tg = (lw - 3 * tw) / 2;
  const boxY = 3.35;
  teams.forEach(([t, c], i) => {
    const x = M + i * (tw + tg);
    node(s, { x, y: 1.9, w: tw, h: 0.62, label: t, fill: c, border: 'none', color: 'FFFFFF', bold: true, name: `mono-team-${i}` });
    conn(s, { x1: x + tw / 2, y1: 2.52, x2: x + tw / 2, y2: boxY, color: c, width: 1.75 });
  });
  edgeLabel(s, { x: M + tw / 2 + 0.1, y: 2.78, w: 1.6, text: 'schema changes', color: K.accent4 });
  node(s, {
    x: M, y: boxY, w: lw, h: 1.35, label: 'One monolithic GraphQL service',
    sub: 'one schema  ·  one codebase  ·  one deployment pipeline',
    fill: TINT_RED, border: K.accent6, size: 15, subSize: 11.5, name: 'mono-box',
  });
  conn(s, { x1: M + lw / 2, y1: boxY + 1.35, x2: M + lw / 2, y2: 5.25, width: 1.5 });
  node(s, { x: M + lw / 2 - 1.3, y: 5.25, w: 2.6, h: 0.55, label: 'Web & mobile clients', name: 'mono-clients' });
  caption(s, { x: M, y: 5.95, w: lw, text: 'Every release waits for every team.', align: 'center' });

  // Right: pains
  const rx = 7.25;
  const rw = GRID.RIGHT - rx;
  s.addText('As the application grows…', {
    x: rx, y: GRID.BODY_Y + 0.05, w: rw, h: 0.4, isTextBox: true, margin: 0,
    fontSize: 18, bold: true, color: K.dk1, fontFace: THEME.headFontFace,
  });
  const pains = [
    ['The schema keeps getting larger', 'harder to navigate and reason about'],
    ['Teams must coordinate every change', 'one shared contract for everybody'],
    ['Deployments depend on each other', 'one team blocks another\'s release'],
    ['Ownership becomes blurry', 'who maintains which type or field?'],
    ['Changes leak across domains', 'a Funds change can break Accounts'],
  ];
  const ry0 = 2.4;
  const rh = (GRID.BODY_BOTTOM - ry0) / pains.length;
  pains.forEach(([h, d], i) => {
    const y = ry0 + i * rh;
    hexBadge(s, { x: rx, y: y + 0.08, n: '!', size: 0.42, fill: K.accent6, fontSize: 13 });
    s.addText(h, { x: rx + 0.62, y: y, w: rw - 0.62, h: 0.32, isTextBox: true, margin: 0, fontSize: TYPE.BODY, bold: true, color: K.dk1 });
    s.addText(d, { x: rx + 0.62, y: y + 0.32, w: rw - 0.62, h: 0.28, isTextBox: true, margin: 0, fontSize: TYPE.SMALL, color: K.accent4 });
  });

  s.addNotes(
    'Consider an insurance application with three domains: Accounts, Policies and Funds. Initially one '
    + 'GraphQL API can handle all three, and for a small app that works fine. But as the app grows and '
    + 'different teams own each domain, keeping everything in one service means a larger schema, constant '
    + 'coordination, coupled deployments, unclear ownership, and changes in one domain affecting other teams. '
    + 'We need a more distributed architecture.',
  );
}

// =====================================================================
// 9 — Subgraphs
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Federation' });
  s.addText('Split by domain: subgraphs', { placeholder: 'title' });
  subtitle(s, 'Each team owns an independent GraphQL service — but the client should not juggle three endpoints.');

  const cx = W / 2;
  node(s, { x: cx - 1.3, y: 1.85, w: 2.6, h: 0.65, label: 'React app', sub: 'which endpoint has which field?', name: 'sub-client' });

  const cw = 3.65;
  const gap = (GRID.CW - 3 * cw) / 2;
  const cy = 3.2;
  const ch = 2.3;
  const subs = [
    ['Accounts subgraph', 'Accounts team', 'accounts.svc/graphql', 'GraphQL Yoga', K.accent3],
    ['Policies subgraph', 'Policies team', 'policies.svc/graphql', 'Apollo Server', K.accent2],
    ['Funds subgraph', 'Funds team', 'funds.svc/graphql', 'GraphQL Yoga', K.accent1],
  ];
  subs.forEach(([t, team, url, impl, c], i) => {
    const x = M + i * (cw + gap);
    conn(s, { x1: cx, y1: 2.5, x2: x + cw / 2, y2: cy, color: K.accent6, dash: 'dash', width: 1.25 });
    panel(s, { x, y: cy, w: cw, h: ch, fill: TINT_GREY, name: `sub-card-${i}` });
    hexBadge(s, { x: x + 0.22, y: cy + 0.2, n: t[0], size: 0.46, fill: c, fontSize: 14 });
    s.addText([
      { text: t, options: { bold: true, fontSize: TYPE.H3, color: K.dk1, breakLine: true } },
      { text: team + '  ·  built with ' + impl, options: { fontSize: TYPE.TINY, color: K.accent4 } },
    ], { x: x + 0.82, y: cy + 0.1, w: cw - 1.0, h: 0.74, isTextBox: true, margin: 0, valign: 'middle' });
    s.addText(bullets(['Owns its schema, resolvers and business logic', 'Develops, tests and deploys independently'], { size: TYPE.SMALL, after: 3 }), {
      x: x + 0.22, y: cy + 0.92, w: cw - 0.44, h: 0.95, isTextBox: true, margin: 0, color: C.text2, valign: 'top',
    });
    s.addText(url, {
      x: x + 0.22, y: cy + ch - 0.36, w: cw - 0.44, h: 0.24, isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 10, color: c,
    });
  });
  edgeLabel(s, { x: cx + 1.45, y: 2.34, w: 3.5, text: '3 endpoints for the client to know', color: K.accent6 });

  panel(s, { x: M, y: 5.72, w: GRID.CW, h: 0.58, fill: TINT_AMBER, name: 'sub-take' });
  s.addText([
    { text: 'Subgraph', options: { bold: true, color: K.dk1 } },
    { text: ' = an independently managed GraphQL service.   We still want ', options: { color: K.dk2 } },
    { text: 'one unified API', options: { bold: true, color: K.accent3 } },
    { text: ' for the client → this is where federation comes in.', options: { color: K.dk2 } },
  ], { x: M + 0.25, y: 5.72, w: GRID.CW - 0.5, h: 0.58, isTextBox: true, margin: 0, fontSize: TYPE.BODY, valign: 'middle' });

  s.addNotes(
    'Instead of one large GraphQL service we create independent services per domain: Accounts, Policies '
    + 'and Funds. Each owns its schema, resolvers and business logic. In a federation architecture these '
    + 'are called subgraphs. We can build them with Apollo Server or GraphQL Yoga, and each team can '
    + 'develop, test and deploy independently. But there is still a problem: the frontend should not need '
    + 'to know about three GraphQL endpoints. We want one unified API — and that is where federation comes in.',
  );
}

// =====================================================================
// 10 — What is federation (architecture)
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Federation' });
  s.addText('GraphQL Federation: one graph, many services', { placeholder: 'title' });
  subtitle(s, 'Combine independently managed subgraphs into one unified API. The client sees a single endpoint.');

  // Clients
  node(s, { x: M, y: 2.25, w: 1.85, h: 0.65, label: 'Web app', name: 'fed-web' });
  node(s, { x: M, y: 3.15, w: 1.85, h: 0.65, label: 'Mobile app', name: 'fed-mobile' });
  const gx = 3.35, gy = 2.15, gw = 2.6, gh = 1.75;
  conn(s, { x1: M + 1.85, y1: 2.575, x2: gx, y2: 2.8, color: K.accent2 });
  conn(s, { x1: M + 1.85, y1: 3.475, x2: gx, y2: 3.25, color: K.accent2 });
  edgeLabel(s, { x: M, y: 3.95, w: 2.5, text: 'POST /graphql', color: K.accent2 });

  node(s, {
    x: gx, y: gy, w: gw, h: gh, label: 'Gateway / Router', sub: 'plans the query, calls subgraphs, merges the result',
    fill: K.accent2, border: 'none', color: 'FFFFFF', size: 15, subSize: 10.5, name: 'fed-gw',
  });
  node(s, {
    x: gx, y: 4.65, w: gw, h: 0.8, label: 'Supergraph schema', sub: 'the blueprint: who owns what',
    fill: TINT_AMBER, border: K.accent1, name: 'fed-sg',
  });
  conn(s, { x1: gx + gw / 2, y1: 4.65, x2: gx + gw / 2, y2: gy + gh, color: K.accent1, dash: 'dash' });
  edgeLabel(s, { x: gx + gw / 2 + 0.1, y: 4.1, w: 1.5, text: 'loaded by', color: AMBER_DARK });

  // Subgraph zone
  const zx = 6.75;
  zone(s, { x: zx, y: GRID.BODY_Y, w: GRID.RIGHT - zx, h: 3.75, color: K.accent3, name: 'fed-zone' });
  bandLabel(s, { x: zx + 0.2, y: GRID.BODY_Y + 0.12, text: 'OWNED BY DOMAIN TEAMS', color: K.accent3 });
  const rows = [
    ['Accounts subgraph', 'Accounts team', 'Accounts DB'],
    ['Policies subgraph', 'Policies team', 'Policy admin system'],
    ['Funds subgraph', 'Funds team', 'Fund pricing API'],
  ];
  rows.forEach(([sg, team, ds], i) => {
    const y = 2.2 + i * 1.05;
    node(s, { x: zx + 0.25, y, w: 2.55, h: 0.78, label: sg, sub: team, fill: TINT_GREY, border: 'none', name: `fed-sub-${i}` });
    node(s, { x: zx + 3.35, y: y + 0.09, w: 2.3, h: 0.6, label: ds, name: `fed-ds-${i}` });
    conn(s, { x1: gx + gw, y1: gy + gh / 2, x2: zx + 0.25, y2: y + 0.39, color: K.accent2 });
    conn(s, { x1: zx + 2.8, y1: y + 0.39, x2: zx + 3.35, y2: y + 0.39, width: 1.25 });
  });

  const by = 5.7;
  const bw = (GRID.CW - 2 * GRID.GAP) / 3;
  [['One endpoint', 'Clients never need to know which subgraph owns which field.', K.accent2],
   ['Independent teams', 'Each subgraph is built, tested and deployed on its own schedule.', K.accent3],
   ['One unified graph', 'The supergraph tells the gateway how the pieces connect.', K.accent1]]
    .forEach(([h, d, c], i) => {
      const x = M + i * (bw + GRID.GAP);
      hexBadge(s, { x, y: by + 0.05, n: i + 1, size: 0.4, fill: c, fontSize: 11 });
      s.addText([
        { text: h, options: { bold: true, color: K.dk1, breakLine: true, fontSize: TYPE.SMALL + 0.5 } },
        { text: d, options: { color: K.dk2, fontSize: TYPE.TINY } },
      ], { x: x + 0.55, y: by - 0.04, w: bw - 0.55, h: 0.64, isTextBox: true, margin: 0, valign: 'top' });
    });

  s.addNotes(
    'GraphQL Federation is an architecture that combines multiple independently managed GraphQL services '
    + 'into one unified API. The client sees one endpoint even though data is spread across subgraphs. '
    + 'Accounts, Policies and Funds teams each manage their subgraph, and federation makes them work '
    + 'together as one graph. The client does not need to know which subgraph owns which field. '
    + 'The gateway knows that because of the supergraph schema — which we will look at next.',
  );
}

// =====================================================================
// 11 — Supergraph & composition
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Federation' });
  s.addText('Supergraph and schema composition', { placeholder: 'title' });
  subtitle(s, 'Composition combines subgraph schemas into one supergraph — the blueprint the gateway runs on.');

  const sw = 4.25;
  const sh = 1.12;
  const sgap = 0.15;
  const sdl = [
    ['ACCOUNTS SUBGRAPH', ['type Account @key(fields: "id") {', '  id: ID!   name: String!', '}']],
    ['POLICIES SUBGRAPH', ['type Account @key(fields: "id") {', '  id: ID!   policies: [Policy!]!', '}']],
    ['FUNDS SUBGRAPH', ['type Policy @key(fields: "id") {', '  id: ID!   funds: [Fund!]!', '}']],
  ];
  const compX = 5.55, compW = 2.55, compH = 1.9;
  const compY = GRID.BODY_Y + (3 * sh + 2 * sgap - compH) / 2;
  sdl.forEach(([h, lines], i) => {
    const y = GRID.BODY_Y + i * (sh + sgap);
    codeCard(s, { x: M, y, w: sw, h: sh, head: h, lines, size: 10, name: `comp-sdl-${i}` });
    conn(s, { x1: M + sw, y1: y + sh / 2, x2: compX, y2: compY + compH / 2, color: K.accent1 });
  });
  node(s, {
    x: compX, y: compY, w: compW, h: compH, label: 'Schema composition',
    sub: 'Can these schemas work together? Checks entity relationships and field ownership.',
    fill: K.accent1, border: 'none', color: 'FFFFFF', size: 14, subSize: 10.5, name: 'comp-node',
  });
  const sgX = 8.55;
  conn(s, { x1: compX + compW, y1: compY + compH / 2, x2: sgX, y2: compY + compH / 2, color: K.accent1, width: 2 });
  panel(s, { x: sgX, y: GRID.BODY_Y, w: GRID.RIGHT - sgX, h: 3 * sh + 2 * sgap, fill: TINT_AMBER, name: 'comp-sg' });
  s.addText('Supergraph schema', {
    x: sgX + 0.25, y: GRID.BODY_Y + 0.2, w: GRID.RIGHT - sgX - 0.5, h: 0.36, isTextBox: true, margin: 0,
    fontSize: 17, bold: true, color: K.dk1, fontFace: THEME.headFontFace,
  });
  s.addText(bullets([
    'All types and fields from every subgraph',
    'Federation metadata: which subgraph owns which field',
    'How entities like Account connect across services',
    'The blueprint the gateway uses at runtime',
  ], { size: TYPE.SMALL, after: 6 }), {
    x: sgX + 0.25, y: GRID.BODY_Y + 0.72, w: GRID.RIGHT - sgX - 0.5, h: 2.5, isTextBox: true, margin: 0,
    color: C.text2, valign: 'top',
  });

  // Build time vs run time
  const by = 5.6;
  const bw = (GRID.CW - GRID.GAP) / 2;
  panel(s, { x: M, y: by, w: bw, h: GRID.BODY_BOTTOM - by, fill: TINT_AMBER, name: 'comp-build' });
  panel(s, { x: M + bw + GRID.GAP, y: by, w: bw, h: GRID.BODY_BOTTOM - by, fill: TINT_TEAL, name: 'comp-run' });
  s.addText([
    { text: 'COMPOSITION  ', options: { bold: true, color: AMBER_DARK, charSpacing: 2, fontSize: TYPE.LABEL + 1 } },
    { text: 'happens when schemas are built or updated', options: { color: K.dk2 } },
  ], { x: M + 0.25, y: by, w: bw - 0.5, h: GRID.BODY_BOTTOM - by, isTextBox: true, margin: 0, fontSize: TYPE.SMALL, valign: 'middle' });
  s.addText([
    { text: 'DATA FETCHING  ', options: { bold: true, color: K.accent2, charSpacing: 2, fontSize: TYPE.LABEL + 1 } },
    { text: 'happens later, when the gateway serves requests', options: { color: K.dk2 } },
  ], { x: M + bw + GRID.GAP + 0.25, y: by, w: bw - 0.5, h: GRID.BODY_BOTTOM - by, isTextBox: true, margin: 0, fontSize: TYPE.SMALL, valign: 'middle' });

  s.addNotes(
    'We have three subgraphs. How does the gateway know which service owns which fields and how they connect? '
    + 'For that we need a composed schema: the supergraph schema. It contains the combined definitions plus '
    + 'federation metadata, and it is the blueprint the gateway uses at runtime. Schema composition is the '
    + 'process that builds it: each subgraph publishes its schema, composition checks they can work together '
    + '— entity relationships, field ownership — and generates the supergraph. Composition is not data '
    + 'fetching: composition happens when schemas change; data fetching happens later when requests arrive.',
  );
}

// =====================================================================
// 12 — Section: Hive
// =====================================================================
pres.addSection({ title: 'Hive' });
section('Hive', 'Managing the graph with Hive', 'Schema lifecycle, toolchain and observability.', 3)
  .addNotes('We now understand the concepts. Next question: how do we manage all of this in a real project? '
    + 'This is where Hive comes in. In this part we will walk through the schema publishing flow, see the Hive '
    + 'ecosystem on one diagram, and then look at each tool: Hive CLI, Hive Console, Hive Gateway, Hive Router '
    + 'and GraphQL Yoga, plus monitoring and observability.');

// =====================================================================
// 13 — Schema management flow
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive' });
  s.addText('Schema management and publishing flow', { placeholder: 'title' });
  subtitle(s, 'Maintain, validate, version and publish subgraph schemas whenever a team makes a change.');

  const nw = 2.1;
  const ng = (GRID.CW - 5 * nw) / 4;
  const colX = (i) => M + i * (nw + ng);
  const r1 = 2.05, r2 = 3.55, nh = 0.9;
  const row1 = [
    ['Develop', 'edit subgraph SDL', TINT_GREY, 'none', K.dk2],
    ['Schema check', 'hive schema:check', TINT_AMBER, K.accent1, K.dk2],
    ['Schema publish', 'hive schema:publish', TINT_AMBER, K.accent1, K.dk2],
    ['Schema registry', 'Hive stores the version', TINT_AMBER, K.accent1, K.dk2],
    ['Composition', 'subgraphs validated together', K.accent1, 'none', 'FFFFFF'],
  ];
  row1.forEach(([l, sub, f, b, col], i) => {
    node(s, { x: colX(i), y: r1, w: nw, h: nh, label: l, sub, fill: f, border: b, color: col, name: `flow-r1-${i}` });
    hexBadge(s, { x: colX(i) - 0.1, y: r1 - 0.2, n: i + 1, size: 0.38, fill: i === 4 ? K.dk1 : K.accent1, fontSize: 11 });
    if (i < 4) conn(s, { x1: colX(i) + nw, y1: r1 + nh / 2, x2: colX(i + 1), y2: r1 + nh / 2, color: K.accent1 });
  });

  // Row 2: right to left
  node(s, { x: colX(4), y: r2, w: nw, h: nh, label: '✗ Composition fails', sub: 'review errors — gateway unchanged', fill: TINT_RED, border: K.accent6, color: K.accent6, name: 'flow-fail' });
  conn(s, { x1: colX(4) + nw * 0.7, y1: r1 + nh, x2: colX(4) + nw * 0.7, y2: r2, color: K.accent6, dash: 'dash' });
  edgeLabel(s, { x: colX(4) + nw * 0.7 + 0.08, y: r1 + nh + 0.18, w: 0.55, text: 'failure', color: K.accent6 });
  const row2 = [
    ['Client requests', 'served by new schema', TINT_GREY, 'none', K.dk2],
    ['Gateway / Router', 'loads the supergraph', K.accent2, 'none', 'FFFFFF'],
    ['Schema delivery', 'Hive CDN / artifact', TINT_TEAL, K.accent2, K.dk2],
    ['✓ New supergraph', 'composed artifact', TINT_GREEN, K.accent5, K.accent5],
  ];
  row2.forEach(([l, sub, f, b, col], i) => {
    node(s, { x: colX(i), y: r2, w: nw, h: nh, label: l, sub, fill: f, border: b, color: col, name: `flow-r2-${i}` });
    if (i > 0) conn(s, { x1: colX(i), y1: r2 + nh / 2, x2: colX(i - 1) + nw, y2: r2 + nh / 2, color: K.accent2 });
  });
  conn(s, { x1: colX(4) + nw * 0.25, y1: r1 + nh, x2: colX(3) + nw * 0.8, y2: r2, color: K.accent5 });
  edgeLabel(s, { x: colX(3) + nw - 0.8, y: r1 + nh + 0.18, w: 0.8, text: 'success', color: K.accent5, align: 'right' });

  // Callouts
  const by = 4.85;
  const bw = (GRID.CW - 2 * GRID.GAP) / 3;
  const bh = GRID.BODY_BOTTOM - by;
  card(s, { x: M, y: by, w: bw, h: bh, head: 'Check ≠ Publish', body: 'A check finds breaking or dangerous changes first. Publishing registers the schema with Hive.' });
  card(s, { x: M + bw + GRID.GAP, y: by, w: bw, h: bh, head: 'Published ≠ live', body: 'The gateway still has to load the new supergraph through its schema delivery mechanism.' });
  card(s, { x: M + 2 * (bw + GRID.GAP), y: by, w: bw, h: bh, head: 'Automate it', body: 'Run check + publish in CI/CD. Hive Console shows versions, checks and composition results.' });

  s.addNotes(
    'Schema management is maintaining, validating, versioning and publishing schemas whenever a team makes a '
    + 'change. The flow: 1, the developer changes the subgraph schema. 2, a schema check with Hive CLI compares '
    + 'it to the registered schema and flags breaking or dangerous changes. 3, once reviewed, publish to the '
    + 'Hive Schema Registry. 4 and 5, Hive validates the subgraphs together and composes. If composition '
    + 'succeeds, a new supergraph is generated for the gateway or router to consume; if it fails, we review '
    + 'the errors. Two things to remember: a check and a publish are different activities; and a successful '
    + 'publish does not mean production is already using it — the gateway must load the new supergraph through '
    + 'its delivery mechanism. In real projects we put this in CI/CD, and Hive Console gives a graphical view.',
  );
}

// =====================================================================
// 14 — Reference architecture
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive' });
  s.addText('The Hive ecosystem at a glance', { placeholder: 'title' });
  subtitle(s, 'Design time manages schemas; run time serves requests. Usage data flows back to the Console.');

  // Design-time band
  const dY = GRID.BODY_Y, dH = 1.95;
  panel(s, { x: M, y: dY, w: GRID.CW, h: dH, fill: TINT_AMBER, name: 'arch-design' });
  bandLabel(s, { x: M + 0.25, y: dY + 0.14, text: 'DESIGN TIME — SCHEMA LIFECYCLE', color: AMBER_DARK, w: 5 });
  const nY = dY + 0.55, nH = 1.1;
  const conX = M + 0.3, conW = 2.3;
  const regX = 4.05, regW = 3.4;
  const ciX = 8.55, ciW = 3.85;
  node(s, { x: conX, y: nY, w: conW, h: nH, label: 'Hive Console', sub: 'versions · checks · usage', fill: 'FFFFFF', border: K.accent1, name: 'arch-console' });
  node(s, { x: regX, y: nY, w: regW, h: nH, label: 'Schema Registry + CDN', sub: 'composes, stores and serves the supergraph', fill: K.accent1, border: 'none', color: 'FFFFFF', name: 'arch-registry' });
  node(s, { x: ciX, y: nY, w: ciW, h: nH, label: 'Subgraph CI · Hive CLI', sub: 'schema:check  ·  schema:publish', fill: 'FFFFFF', border: K.accent3, name: 'arch-ci' });
  conn(s, { x1: ciX, y1: nY + nH / 2, x2: regX + regW, y2: nY + nH / 2, color: K.accent3 });
  edgeLabel(s, { x: regX + regW + 0.1, y: nY + nH / 2 - 0.32, w: 1.0, text: 'publish SDL', color: K.accent3 });
  conn(s, { x1: regX, y1: nY + nH / 2, x2: conX + conW, y2: nY + nH / 2, color: AMBER_DARK, tail: 'triangle' });

  // Run-time band
  const rY = dY + dH + 0.3, rH = GRID.BODY_BOTTOM - rY;
  panel(s, { x: M, y: rY, w: GRID.CW, h: rH, fill: TINT_TEAL, name: 'arch-run' });
  bandLabel(s, { x: M + 0.25, y: rY + 0.14, text: 'RUN TIME — REQUEST PATH', color: K.accent2, w: 5 });
  const gY = rY + 0.6, gH = 1.4;
  node(s, { x: conX, y: gY + 0.2, w: conW, h: 1.0, label: 'Clients', sub: 'web · mobile', fill: 'FFFFFF', border: 'none', name: 'arch-clients' });
  node(s, { x: regX, y: gY, w: regW, h: gH, label: 'Hive Gateway  or  Hive Router', sub: 'plan · execute · merge · auth · cache', fill: K.accent2, border: 'none', color: 'FFFFFF', size: 14, name: 'arch-gw' });
  conn(s, { x1: conX + conW, y1: gY + gH / 2, x2: regX, y2: gY + gH / 2, color: K.accent2 });
  const subs = ['Accounts  ·  GraphQL Yoga', 'Policies  ·  Apollo Server', 'Funds  ·  GraphQL Yoga'];
  const sh = 0.46, sg = 0.13;
  const s0 = gY + gH / 2 - (3 * sh + 2 * sg) / 2;
  subs.forEach((t, i) => {
    const y = s0 + i * (sh + sg);
    node(s, { x: ciX, y, w: ciW, h: sh, label: t, fill: 'FFFFFF', border: 'none', size: 11.5, name: `arch-sub-${i}` });
    conn(s, { x1: regX + regW, y1: gY + gH / 2, x2: ciX, y2: y + sh / 2, color: K.accent2, width: 1.25 });
  });

  // Cross-band connectors
  conn(s, { x1: regX + regW / 2, y1: nY + nH, x2: regX + regW / 2, y2: gY, color: AMBER_DARK, width: 2 });
  edgeLabel(s, { x: regX + regW / 2 + 0.1, y: nY + nH + 0.2, w: 1.6, text: 'load supergraph', color: AMBER_DARK });
  conn(s, { x1: regX + 0.3, y1: gY, x2: conX + conW - 0.3, y2: nY + nH, color: K.accent2, dash: 'dash', width: 1.25 });
  edgeLabel(s, { x: conX, y: nY + nH + 0.38, w: 1.75, text: 'usage & traces', color: K.accent2, align: 'right' });

  s.addNotes(
    'Here is the whole picture. At design time, each subgraph team uses Hive CLI in CI to check and publish its '
    + 'schema to the Hive Schema Registry. Hive composes the supergraph and serves it as an artifact, for example '
    + 'from the Hive CDN. Hive Console is where we see versions, checks and usage. At run time, clients call one '
    + 'endpoint on Hive Gateway or Hive Router, which loads the supergraph, calls subgraphs built with Yoga or '
    + 'Apollo Server, and merges the response. The gateway reports usage and traces back to Hive.',
  );
}

// =====================================================================
// 15 — Hive CLI
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive' });
  s.addText('Hive CLI: check, publish, fetch', { placeholder: 'title' });
  subtitle(s, 'A command-line tool for developers and CI/CD pipelines to talk to the Hive Schema Registry.');

  const cw = (GRID.CW - 2 * GRID.GAP) / 3;
  const top = GRID.BODY_Y;
  const ch = GRID.BODY_BOTTOM - top;
  const cols = [
    {
      t: 'Schema check', c: K.accent1, desc: 'Compare a proposed change against the registered schema before publishing.',
      code: ['hive schema:check \\', '  --service accounts \\', '  accounts.graphql'],
      out: 'chips',
    },
    {
      t: 'Schema publish', c: K.accent3, desc: 'Register the subgraph schema. Hive validates it and runs composition.',
      code: ['hive schema:publish \\', '  --service accounts \\', '  --url http://accounts/graphql \\', '  accounts.graphql'],
      out: 'Compatible schemas → a new valid supergraph artifact.',
    },
    {
      t: 'Schema fetch', c: K.accent2, desc: 'Retrieve published schemas and supergraph artifacts.',
      code: ['hive artifact:fetch \\', '  --artifact supergraph \\', '  --outputFile supergraph.graphql'],
      out: 'Use for local development or to configure the gateway.',
    },
  ];
  cols.forEach((col, i) => {
    const x = M + i * (cw + GRID.GAP);
    panel(s, { x, y: top, w: cw, h: ch, fill: TINT_GREY, name: `cli-${i}` });
    hexBadge(s, { x: x + 0.22, y: top + 0.22, n: i + 1, size: 0.5, fill: col.c, fontSize: 14 });
    s.addText(col.t, {
      x: x + 0.88, y: top + 0.22, w: cw - 1.1, h: 0.5, isTextBox: true, margin: 0,
      fontSize: 18, bold: true, color: K.dk1, fontFace: THEME.headFontFace, valign: 'middle',
    });
    s.addText(col.desc, {
      x: x + 0.22, y: top + 0.9, w: cw - 0.44, h: 0.72, isTextBox: true, margin: 0,
      fontSize: TYPE.SMALL, color: C.text2, valign: 'top',
    });
    codeCard(s, { x: x + 0.22, y: top + 1.72, w: cw - 0.44, h: 1.38, lines: col.code, size: 10.5, name: `cli-code-${i}` });
    const oy = top + 3.35;
    if (col.out === 'chips') {
      s.addText('Hive classifies every change:', {
        x: x + 0.22, y: oy, w: cw - 0.44, h: 0.3, isTextBox: true, margin: 0, fontSize: TYPE.SMALL, color: K.dk2,
      });
      const cpw = (cw - 0.44 - 0.2) / 3;
      [['SAFE', K.accent5], ['DANGEROUS', AMBER_DARK], ['BREAKING', K.accent6]].forEach(([t, c], j) => {
        chip(s, { x: x + 0.22 + j * (cpw + 0.1), y: oy + 0.42, w: cpw, text: t, fill: c });
      });
    } else {
      s.addText(col.out, {
        x: x + 0.22, y: oy, w: cw - 0.44, h: 0.72, isTextBox: true, margin: 0,
        fontSize: TYPE.SMALL, color: K.dk2, italic: true, valign: 'top',
      });
    }
  });

  s.addNotes(
    'Hive CLI is how developers and CI/CD interact with the registry. Three activities. Schema check: before '
    + 'publishing, check the change against the existing schema; Hive classifies changes as breaking, dangerous '
    + 'or safe so we catch issues before production. Schema publish: register the subgraph schema; Hive validates '
    + 'it and runs composition for federated projects, producing a new supergraph if compatible. Schema fetch: '
    + 'retrieve published schemas and supergraph artifacts for local development or gateway configuration. '
    + 'Instead of managing versions by hand, we integrate these into pipelines.',
  );
}

// =====================================================================
// 16 — Hive Console & monitoring
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive' });
  s.addText('Hive Console and observability', { placeholder: 'title' });
  subtitle(s, 'A graphical view of how the graph evolves — and how it is actually used.');

  // Mock console window
  const wx = M, wy = GRID.BODY_Y, ww = 6.7, wh = GRID.BODY_BOTTOM - GRID.BODY_Y;
  s.addShape(pres.ShapeType.roundRect, { x: wx, y: wy, w: ww, h: wh, rectRadius: 0.06, fill: { color: 'FFFFFF' }, line: { color: HAIRLINE, width: 1 }, objectName: 'mock-frame' });
  s.addShape(pres.ShapeType.rect, { x: wx + 0.02, y: wy + 0.02, w: ww - 0.04, h: 0.36, fill: { color: K.dk1 }, line: { type: 'none' }, objectName: 'mock-bar' });
  ['9B2C2C', 'D8912F', '2E7D52'].forEach((c, i) => {
    s.addShape(pres.ShapeType.ellipse, { x: wx + 0.16 + i * 0.2, y: wy + 0.13, w: 0.12, h: 0.12, fill: { color: c }, line: { type: 'none' } });
  });
  s.addText('Hive Console  ·  insurance-graph / production', {
    x: wx + 0.85, y: wy + 0.02, w: ww - 1.0, h: 0.36, isTextBox: true, margin: 0, fontSize: 10, color: 'C9CDD4', valign: 'middle',
  });
  const sbW = 1.75;
  s.addShape(pres.ShapeType.rect, { x: wx + 0.02, y: wy + 0.38, w: sbW, h: wh - 0.4, fill: { color: TINT_GREY }, line: { type: 'none' }, objectName: 'mock-side' });
  ['Projects & targets', 'Schema explorer', 'Subgraphs', 'History', 'Checks', 'Insights'].forEach((t, i) => {
    const active = t === 'History';
    if (active) s.addShape(pres.ShapeType.roundRect, { x: wx + 0.12, y: wy + 0.55 + i * 0.5, w: sbW - 0.2, h: 0.38, rectRadius: 0.05, fill: { color: K.accent1 }, line: { type: 'none' } });
    s.addText(t, {
      x: wx + 0.24, y: wy + 0.55 + i * 0.5, w: sbW - 0.3, h: 0.38, isTextBox: true, margin: 0,
      fontSize: 10.5, bold: active, color: active ? 'FFFFFF' : K.dk2, valign: 'middle',
    });
  });
  const mx = wx + sbW + 0.25, mw = ww - sbW - 0.45;
  s.addText('Schema versions', { x: mx, y: wy + 0.55, w: mw, h: 0.32, isTextBox: true, margin: 0, fontSize: 13, bold: true, color: K.dk1 });
  const vers = [
    ['v42', 'accounts: add Account.nickname', 'SAFE', K.accent5],
    ['v41', 'funds: Fund.nav → Float!', 'DANGEROUS', AMBER_DARK],
    ['v40', 'policies: remove Policy.legacyId', 'BREAKING', K.accent6],
    ['v39', 'policies: add Policy.renewalDate', 'SAFE', K.accent5],
    ['v38', 'composition failed — funds', 'ERROR', K.accent6],
  ];
  vers.forEach(([v, d, sev, c], i) => {
    const y = wy + 1.02 + i * 0.62;
    s.addShape(pres.ShapeType.roundRect, { x: mx, y, w: mw, h: 0.52, rectRadius: 0.05, fill: { color: 'FFFFFF' }, line: { color: HAIRLINE, width: 0.75 } });
    s.addText([
      { text: v + '  ', options: { bold: true, color: K.dk1, fontFace: MONO } },
      { text: d, options: { color: K.dk2 } },
    ], { x: mx + 0.12, y, w: mw - 1.35, h: 0.52, isTextBox: true, margin: 0, fontSize: 10, valign: 'middle' });
    chip(s, { x: mx + mw - 1.15, y: y + 0.12, w: 1.05, h: 0.28, text: sev, fill: c });
  });
  caption(s, { x: mx, y: wy + wh - 0.42, w: mw, text: 'Illustrative mock-up' });

  // Right side
  const rx = wx + ww + 0.45;
  const rw = GRID.RIGHT - rx;
  s.addText('In the Console', { x: rx, y: GRID.BODY_Y, w: rw, h: 0.36, isTextBox: true, margin: 0, fontSize: 17, bold: true, color: K.dk1, fontFace: THEME.headFontFace });
  s.addText(bullets([
    'Registered projects and targets',
    'Published schemas and subgraph details',
    'Schema changes and versions over time',
    'Schema check and composition results',
  ], { size: TYPE.SMALL, after: 4 }), {
    x: rx, y: GRID.BODY_Y + 0.45, w: rw, h: 1.45, isTextBox: true, margin: 0, color: C.text2, valign: 'top',
  });
  s.addText('Monitoring tells you', { x: rx, y: 3.75, w: rw, h: 0.36, isTextBox: true, margin: 0, fontSize: 17, bold: true, color: K.dk1, fontFace: THEME.headFontFace });
  s.addText(bullets([
    'Which operations run most often',
    'Which fields are actually used',
    'How long operations take',
    'Where errors occur',
  ], { size: TYPE.SMALL, after: 4 }), {
    x: rx, y: 4.2, w: rw, h: 1.45, isTextBox: true, margin: 0, color: C.text2, valign: 'top',
  });
  chip(s, { x: rx, y: 5.95, w: 1.7, text: 'OPENTELEMETRY', fill: K.accent2 });
  chip(s, { x: rx + 1.85, y: 5.95, w: 1.45, text: 'PROMETHEUS', fill: K.accent3 });

  s.addNotes(
    'Hive Console is the graphical interface for our GraphQL projects. Instead of relying only on the CLI, teams '
    + 'can view projects and targets, explore published schemas and subgraphs, track changes and versions, review '
    + 'schema checks and inspect composition results. It also covers monitoring: which operations run most, which '
    + 'fields are used, how long operations take and where errors occur. Hive also integrates with OpenTelemetry '
    + 'and Prometheus for monitoring and tracing, which helps us find performance bottlenecks.',
  );
}

// =====================================================================
// 17 — Gateway vs Router vs Yoga
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Hive' });
  s.addText('Gateway, Router and Yoga: where each one fits', { placeholder: 'title' });
  subtitle(s, 'Gateway and Router are the runtime; Yoga builds the subgraphs behind them.');

  const dy = GRID.BODY_Y, dh = 1.95;
  node(s, { x: M, y: dy + 0.5, w: 1.6, h: 0.95, label: 'Clients', fill: TINT_GREY, border: 'none', name: 'fit-clients' });
  const rzx = 2.75, rzw = 4.15;
  zone(s, { x: rzx, y: dy, w: rzw, h: dh, color: K.accent2, name: 'fit-runtime' });
  bandLabel(s, { x: rzx + 0.2, y: dy + 0.1, text: 'RUNTIME — PICK ONE', color: K.accent2 });
  node(s, { x: rzx + 0.25, y: dy + 0.45, w: rzw - 0.5, h: 0.6, label: 'Hive Gateway', sub: 'TypeScript / Node.js', fill: K.accent2, border: 'none', color: 'FFFFFF', name: 'fit-gw' });
  node(s, { x: rzx + 0.25, y: dy + 1.18, w: rzw - 0.5, h: 0.6, label: 'Hive Router', sub: 'Rust · high performance', fill: K.accent2, border: 'none', color: 'FFFFFF', name: 'fit-router' });
  conn(s, { x1: M + 1.6, y1: dy + 0.975, x2: rzx, y2: dy + 0.975, color: K.accent2 });
  const szx = 7.6, szw = GRID.RIGHT - szx;
  zone(s, { x: szx, y: dy, w: szw, h: dh, color: K.accent3, name: 'fit-sub' });
  bandLabel(s, { x: szx + 0.2, y: dy + 0.1, text: 'SUBGRAPHS — MIX AND MATCH', color: K.accent3, w: 4.5 });
  ['Accounts · GraphQL Yoga', 'Policies · Apollo Server', 'Funds · any federation-compatible server'].forEach((t, i) => {
    node(s, { x: szx + 0.25, y: dy + 0.45 + i * 0.47, w: szw - 0.5, h: 0.38, label: t, size: 11, fill: TINT_GREY, border: 'none', name: `fit-sub-${i}` });
  });
  conn(s, { x1: rzx + rzw, y1: dy + 0.975, x2: szx, y2: dy + 0.975, color: K.accent2 });

  const hdr = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: K.dk1 }, fontSize: TYPE.SMALL } });
  const lbl = (t) => ({ text: t, options: { bold: true, color: K.dk1, fill: { color: TINT_GREY } } });
  const rows = [
    [hdr(''), hdr('Hive Gateway'), hdr('Hive Router'), hdr('GraphQL Yoga')],
    [lbl('Layer'), 'Runtime entry point', 'Runtime entry point', 'Subgraph / server'],
    [lbl('Built with'), 'TypeScript ecosystem', 'Rust', 'JavaScript / TypeScript'],
    [lbl('Does'), 'Loads supergraph, plans, executes, merges; auth, caching, rate limiting, observability', 'Reads supergraph, plans, calls subgraphs, builds the response — performance first', 'Builds one GraphQL API, e.g. the Accounts subgraph'],
    [lbl('Customise with'), 'JS/TS plugins', 'Rust plugins or HTTP coprocessors', 'Yoga plugins'],
  ];
  s.addTable(rows, {
    x: M, y: dy + dh + 0.3, w: GRID.CW, colW: [1.9, 3.4, 3.4, 3.393],
    rowH: [0.36, 0.36, 0.36, 0.72, 0.36],
    fontSize: TYPE.TINY + 0.5, color: K.dk2, valign: 'middle', margin: [0.04, 0.12, 0.04, 0.12],
    border: { type: 'solid', pt: 0.75, color: HAIRLINE },
  });

  s.addNotes(
    'Hive Gateway is an open-source gateway built on the TypeScript ecosystem. It is the runtime entry point: '
    + 'it loads the supergraph from Hive CDN or other sources, receives client requests, plans and executes '
    + 'federated queries, merges responses, and handles auth, caching, rate limiting and observability. '
    + 'Hive Router is another runtime, implemented in Rust for high performance; it reads the supergraph, plans '
    + 'requests, calls subgraphs and builds the response. Both can be the runtime — different implementation and '
    + 'customisation models. GraphQL Yoga is a server implementation used to build individual subgraphs. The '
    + 'gateway does not require all subgraphs to use the same server, as long as they expose compatible '
    + 'federation subgraph APIs.',
  );
}

// =====================================================================
// 18 — Section: runtime
// =====================================================================
pres.addSection({ title: 'Runtime' });
section('Runtime', 'Inside the runtime', 'How a federated request runs, how we customise it, and how caching helps.', 4)
  .addNotes('So far we have mostly talked about design time — schemas, checks and composition. In this last part '
    + 'we move to run time: what actually happens when a client request reaches the gateway, how we can '
    + 'customise Hive Router with plugins and coprocessors, and how caching and cache invalidation help us '
    + 'improve performance without serving stale data.');

// =====================================================================
// 19 — Request flow
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('How a federated request runs', { placeholder: 'title' });
  subtitle(s, 'The React app wants account, policy and fund details — in one query.');

  node(s, { x: M, y: 2.3, w: 1.45, h: 1.05, label: 'React app', sub: 'one query', fill: TINT_GREY, border: 'none', name: 'rq-client' });
  const zx = 2.45, zw = 8.25;
  zone(s, { x: zx, y: GRID.BODY_Y, w: zw, h: 2.05, color: K.accent2, name: 'rq-zone' });
  bandLabel(s, { x: zx + 0.2, y: GRID.BODY_Y + 0.1, text: 'GATEWAY / ROUTER  ·  USES THE SUPERGRAPH', color: K.accent2, w: 6 });
  const steps = [
    ['Parse & validate', 'check against schema'],
    ['Query plan', 'which subgraphs, in what order'],
    ['Execute', 'call subgraphs'],
    ['Merge', 'shape like the query'],
  ];
  const sw = 1.75, sgp = (zw - 0.5 - 4 * sw) / 3;
  const sy = 2.3, shh = 1.05;
  const sx = (i) => zx + 0.25 + i * (sw + sgp);
  steps.forEach(([l, sub], i) => {
    node(s, { x: sx(i), y: sy, w: sw, h: shh, label: l, sub, fill: i === 2 ? K.accent2 : TINT_TEAL, border: i === 2 ? 'none' : K.accent2, color: i === 2 ? 'FFFFFF' : K.dk2, name: `rq-step-${i}` });
    hexBadge(s, { x: sx(i) - 0.14, y: sy - 0.2, n: i + 2, size: 0.36, fill: K.accent2, fontSize: 11 });
    if (i < 3) conn(s, { x1: sx(i) + sw, y1: sy + shh / 2, x2: sx(i + 1), y2: sy + shh / 2, color: K.accent2 });
  });
  conn(s, { x1: M + 1.45, y1: sy + shh / 2, x2: sx(0), y2: sy + shh / 2, color: K.accent2 });
  hexBadge(s, { x: M - 0.1, y: sy - 0.2, n: 1, size: 0.36, fill: K.accent2, fontSize: 11 });
  const ox = zx + zw + 0.3;
  node(s, { x: ox, y: sy, w: GRID.RIGHT - ox, h: shh, label: 'One response', sub: 'back to React app', fill: TINT_GREEN, border: K.accent5, color: K.accent5, name: 'rq-out' });
  hexBadge(s, { x: ox - 0.14, y: sy - 0.2, n: 6, size: 0.36, fill: K.accent5, fontSize: 11 });
  conn(s, { x1: sx(3) + sw, y1: sy + shh / 2, x2: ox, y2: sy + shh / 2, color: K.accent5 });

  // Subgraph fan-out from Execute
  const ex = sx(2) + sw / 2;
  const subY = 4.3, subW = 2.3, subH = 0.7;
  const subs = [
    ['Accounts subgraph', 'account details', ex - subW * 1.5 - 0.35, 'solid'],
    ['Policies subgraph', 'policy details', ex - subW / 2, 'solid'],
    ['Funds subgraph', 'fund details', ex + subW / 2 + 0.35, 'dash'],
  ];
  subs.forEach(([l, sub, x, d]) => {
    node(s, { x, y: subY, w: subW, h: subH, label: l, sub, fill: TINT_GREY, border: 'none', name: `rq-sub-${l}` });
    conn(s, { x1: ex, y1: sy + shh, x2: x + subW / 2, y2: subY, color: K.accent3, dash: d === 'dash' ? 'dash' : undefined, width: 1.25 });
  });
  edgeLabel(s, { x: subs[0][2], y: subY + subH + 0.06, w: 4.95, text: 'parallel', color: K.accent3, align: 'center' });
  edgeLabel(s, { x: subs[2][2] - 0.2, y: subY + subH + 0.06, w: subW + 0.4, text: 'can wait on earlier results', color: K.accent3, align: 'center' });

  codeCard(s, {
    x: M, y: 5.4, w: 5.6, h: GRID.BODY_BOTTOM - 5.4 + 0.02, name: 'rq-plan',
    lines: ['Sequence { Parallel { Fetch(accounts) Fetch(policies) }', '           Fetch(funds) }        # simplified plan'],
    size: 10,
  });
  s.addText('The frontend never coordinates the individual subgraph calls — the gateway does.', {
    x: 9.0, y: 5.4, w: GRID.RIGHT - 9.0, h: 0.9, isTextBox: true, margin: 0,
    fontSize: TYPE.SMALL, italic: true, color: K.dk2, valign: 'middle',
  });

  s.addNotes(
    'Step 1, the React app sends one GraphQL query to the gateway, which has the composed supergraph. Step 2, it '
    + 'parses and validates the operation against the schema. Step 3, it creates a query plan: which subgraphs '
    + 'to call and in what order. Some calls run in parallel, others depend on earlier results. Step 4, it sends '
    + 'the requests: Accounts returns account details, Policies returns policy details, Funds returns fund '
    + 'details. Step 5, it merges the results according to the original query. Step 6, one unified response '
    + 'goes back. The frontend does not coordinate subgraph calls — the router or gateway is the runtime '
    + 'component that processes requests using the supergraph.',
  );
}

// =====================================================================
// 20 — Plugins vs coprocessors
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('Customising Hive Router: plugins vs coprocessors', { placeholder: 'title' });
  subtitle(s, 'For custom auth, transformations, tenant rules, logging, extra validation or response redaction.');

  const zx = M, zy = GRID.BODY_Y, zw = 8.35, zh = 2.45;
  zone(s, { x: zx, y: zy, w: zw, h: zh, color: K.accent2, name: 'cp-zone' });
  bandLabel(s, { x: zx + 0.2, y: zy + 0.1, text: 'HIVE ROUTER PROCESS', color: K.accent2 });
  const st = ['Router request', 'Parse & plan', 'Execution', 'Subgraph request'];
  const sw = 1.75, sg = (zw - 0.5 - 4 * sw) / 3;
  const sy = zy + 0.5, sh = 0.62;
  st.forEach((t, i) => {
    const x = zx + 0.25 + i * (sw + sg);
    node(s, { x, y: sy, w: sw, h: sh, label: t, fill: TINT_TEAL, border: K.accent2, size: 11.5, name: `cp-st-${i}` });
    if (i < 3) conn(s, { x1: x + sw, y1: sy + sh / 2, x2: x + sw + sg, y2: sy + sh / 2, color: K.accent2, width: 1.25 });
  });
  const px = zx + 0.25, py = zy + 1.55, pw = 3.8;
  node(s, { x: px, y: py, w: pw, h: 0.7, label: 'Plugin', sub: 'Rust, compiled into the router binary', fill: K.accent1, border: 'none', color: 'FFFFFF', name: 'cp-plugin' });
  conn(s, { x1: px + 0.875, y1: py, x2: px + 0.875, y2: sy + sh, color: K.accent1, tail: 'triangle' });
  conn(s, { x1: px + sw + sg + 0.875, y1: py, x2: px + sw + sg + 0.875, y2: sy + sh, color: K.accent1, tail: 'triangle' });
  edgeLabel(s, { x: px + pw + 0.15, y: py + 0.24, w: 2.5, text: 'in-process hooks', color: AMBER_DARK });

  const cx = zx + zw + 0.95, cw = GRID.RIGHT - cx;
  node(s, { x: cx, y: zy + 0.3, w: cw, h: 1.85, label: 'Coprocessor', sub: 'separate HTTP service · any language · no router rebuild', fill: K.accent3, border: 'none', color: 'FFFFFF', size: 15, subSize: 10.5, name: 'cp-copro' });
  conn(s, { x1: zx + zw, y1: zy + 0.85, x2: cx, y2: zy + 0.85, color: K.accent3, dash: 'dash' });
  conn(s, { x1: cx, y1: zy + 1.6, x2: zx + zw, y2: zy + 1.6, color: K.accent3, dash: 'dash' });
  edgeLabel(s, { x: zx + zw + 0.05, y: zy + 0.6, w: 0.9, text: 'HTTP req', color: K.accent3, align: 'center' });
  edgeLabel(s, { x: zx + zw + 0.05, y: zy + 1.65, w: 0.9, text: 'HTTP res', color: K.accent3, align: 'center' });

  const by = zy + zh + 0.35;
  const bw = (GRID.CW - GRID.GAP) / 2;
  const bh = GRID.BODY_BOTTOM - by;
  card(s, {
    x: M, y: by, w: bw, h: bh, fill: TINT_AMBER, head: 'Plugin = custom logic inside the router',
    body: richBullets([
      ['+', 'No extra network call — runs in-process'],
      ['+', 'Deep integration with router internals; good for performance-sensitive logic'],
      ['−', 'Written in Rust; the router must be rebuilt'],
    ], { size: TYPE.SMALL, after: 4 }),
  });
  card(s, {
    x: M + bw + GRID.GAP, y: by, w: bw, h: bh, fill: TINT_GREY, head: 'Coprocessor = custom logic outside, over HTTP',
    body: richBullets([
      ['+', 'Any language; no change to the router binary'],
      ['+', 'Great for policy checks, request changes, redaction, tenant rules'],
      ['−', 'Every configured stage can add an HTTP round trip — watch latency'],
    ], { size: TYPE.SMALL, after: 4 }),
  });

  s.addNotes(
    'Apart from the standard flow we may have extra requirements: custom auth, transformations, tenant rules, '
    + 'logging, validation or redaction. Hive Router gives us two mechanisms. Plugins run inside the router '
    + 'process; they are written in Rust and compiled into the binary, so there is no extra network call — good '
    + 'for deep integration or performance-sensitive logic. Coprocessors run outside as independent HTTP '
    + 'services; at selected stages the router calls them, they run our logic and respond. We can write them in '
    + 'any language without rebuilding the router, but each configured stage can add an HTTP call, so consider '
    + 'latency. Easy way to remember: plugin is inside the router, coprocessor is outside over HTTP.',
  );
}

// =====================================================================
// 21 — Caching layers
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('Caching in a federated gateway', { placeholder: 'title' });
  subtitle(s, 'Different layers cache different things — do not confuse processing artifacts with business data.');

  const st = ['Parse', 'Validate', 'Normalize', 'Query plan', 'Execute subgraphs', 'Response'];
  const nw = 1.78, ng = (GRID.CW - 6 * nw) / 5;
  const ny = 1.95, nh = 0.7;
  const nx = (i) => M + i * (nw + ng);
  st.forEach((t, i) => {
    const run = i === 4;
    node(s, { x: nx(i), y: ny, w: nw, h: nh, label: t, fill: run ? K.dk2 : 'FFFFFF', border: run ? 'none' : HAIRLINE, color: run ? 'FFFFFF' : K.dk2, bold: true, name: `cache-st-${i}` });
    if (i < 5) conn(s, { x1: nx(i) + nw, y1: ny + nh / 2, x2: nx(i + 1), y2: ny + nh / 2, width: 1.25 });
  });
  const cy = ny + nh + 0.32, chh = 0.5;
  ['parsing cache', 'validation cache', 'normalization cache', 'query plan cache'].forEach((t, i) => {
    node(s, { x: nx(i), y: cy, w: nw, h: chh, label: t, fill: TINT_TEAL, border: K.accent2, size: 11, name: `cache-op-${i}` });
    conn(s, { x1: nx(i) + nw / 2, y1: cy, x2: nx(i) + nw / 2, y2: ny + nh, color: K.accent2, width: 1, dash: 'dash' });
  });
  node(s, { x: nx(4), y: cy, w: nw * 2 + ng, h: chh, label: 'response cache · memory / Redis', fill: TINT_AMBER, border: K.accent1, size: 11, name: 'cache-resp' });
  conn(s, { x1: nx(4) + nw + ng / 2, y1: cy, x2: nx(4) + nw + ng / 2, y2: ny + nh, color: K.accent1, width: 1, dash: 'dash' });
  bandLabel(s, { x: nx(0), y: cy + chh + 0.12, text: 'OPERATIONAL CACHES — GATEWAY & ROUTER', color: K.accent2, w: 6 });
  bandLabel(s, { x: nx(4), y: cy + chh + 0.12, text: 'BUSINESS DATA — HIVE GATEWAY', color: AMBER_DARK, w: 3.9 });

  const hdr = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: K.dk1 }, fontSize: TYPE.SMALL } });
  const lbl = (t, c) => ({ text: t, options: { bold: true, color: c } });
  const rows = [
    [hdr('Area'), hdr('What is cached?'), hdr('Why it helps')],
    [lbl('Parsing / validation', K.accent2), 'Parsed documents and validation results', 'Repeated operations skip parsing and validation'],
    [lbl('Query plan / runtime', K.accent2), 'Normalized operations and query plans', 'The router reuses a plan instead of re-planning'],
    [lbl('Response caching', AMBER_DARK), 'The final GraphQL response (TTL, per-session, per type/field)', 'Skips the whole federation flow for repeat requests'],
    [lbl('Entity invalidation', AMBER_DARK), 'References to entities inside cached responses', 'Purges affected entries when data changes'],
  ];
  const ty = 3.95;
  s.addTable(rows, {
    x: M, y: ty, w: GRID.CW, colW: [2.6, 4.9, 4.593],
    rowH: 0.44, fontSize: TYPE.SMALL - 0.5, color: K.dk2, valign: 'middle', margin: [0.04, 0.12, 0.04, 0.12],
    border: { type: 'solid', pt: 0.75, color: HAIRLINE },
  });

  s.addNotes(
    'Every federated request may involve parsing, validation, planning and calls to backend services. Caching '
    + 'reduces repeated work. Hive Gateway has built-in parsing and validation caches. Hive Router keeps '
    + 'in-memory caches for parsing, validation, normalization and query plans — so a repeated operation reuses '
    + 'its plan. These cache GraphQL processing artifacts, not business data. Response caching is different: it '
    + 'stores the actual GraphQL response, for example in Redis, so a matching request can skip the whole '
    + 'federation flow. We configure storage, TTL, session-based caching, field or type policies and '
    + 'invalidation. Hive Gateway supports response caching with in-memory or Redis storage. Separately, the '
    + 'supergraph schema itself must be loaded and refreshed properly — that is its own concern.',
  );
}

// =====================================================================
// 22 — Entity invalidation
// =====================================================================
{
  const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Runtime' });
  s.addText('Entity-based cache invalidation', { placeholder: 'title' });
  subtitle(s, 'Response caching raises a question: what happens when the underlying data changes?');

  const steps = [
    ['Query', 'fetch Account 101', TINT_TEAL, K.accent2],
    ['Cache', 'response stored, tagged Account:101', TINT_AMBER, K.accent1],
    ['Mutation', 'updateAccount(id: 101)', TINT_GREY, K.accent3],
    ['Identify', 'gateway sees entity Account:101', TINT_GREY, K.accent3],
    ['Invalidate', 'entries with Account:101 purged', TINT_RED, K.accent6],
  ];
  const nw = 2.1, ng = (GRID.CW - 5 * nw) / 4;
  const ny = 2.0, nh = 1.15;
  steps.forEach(([l, sub, f, c], i) => {
    const x = M + i * (nw + ng);
    node(s, { x, y: ny, w: nw, h: nh, label: l, sub, fill: f, border: c, name: `inv-${i}` });
    hexBadge(s, { x: x - 0.1, y: ny - 0.2, n: i + 1, size: 0.38, fill: c, fontSize: 11 });
    if (i < 4) conn(s, { x1: x + nw, y1: ny + nh / 2, x2: x + nw + ng, y2: ny + nh / 2, color: c });
  });

  // Cache store mock
  const tx = M, ty = 3.65, tw = 7.6, th = GRID.BODY_BOTTOM - ty;
  panel(s, { x: tx, y: ty, w: tw, h: th, fill: TINT_GREY, name: 'inv-store' });
  bandLabel(s, { x: tx + 0.22, y: ty + 0.14, text: 'RESPONSE CACHE (e.g. REDIS) — AFTER STEP 5', color: K.accent4, w: 6 });
  const entries = [
    ['GetAccount(101)', 'Account:101', true],
    ['AccountPolicies(101)', 'Account:101  Policy:77', true],
    ['GetFund(F-12)', 'Fund:F-12', false],
    ['GetAccount(102)', 'Account:102', false],
  ];
  entries.forEach(([k, tags, gone], i) => {
    const y = ty + 0.5 + i * 0.5;
    s.addShape(pres.ShapeType.roundRect, { x: tx + 0.22, y, w: tw - 0.44, h: 0.4, rectRadius: 0.05, fill: { color: gone ? TINT_RED : 'FFFFFF' }, line: { color: gone ? K.accent6 : HAIRLINE, width: 0.75 } });
    s.addText(k, { x: tx + 0.4, y, w: 2.8, h: 0.4, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 10.5, color: gone ? K.accent6 : K.dk1, valign: 'middle', strike: gone ? 'sngStrike' : undefined });
    s.addText(tags, { x: tx + 3.3, y, w: 2.6, h: 0.4, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 10, color: K.accent4, valign: 'middle' });
    chip(s, { x: tx + tw - 1.45, y: y + 0.07, w: 1.05, h: 0.26, text: gone ? 'PURGED' : 'KEPT', fill: gone ? K.accent6 : K.accent5 });
  });

  const rx = tx + tw + GRID.GAP;
  card(s, {
    x: rx, y: ty, w: GRID.RIGHT - rx, h: th, fill: TINT_AMBER, head: 'What makes it work',
    body: bullets([
      'Hive Gateway tracks which entities each cached response contains',
      'Mutations that touch an entity invalidate matching entries automatically',
      'Needs entity identity in the response (type + id)',
      'Custom invalidation strategies are possible too',
    ], { size: TYPE.SMALL, after: 5 }),
  });

  s.addNotes(
    'We do not want to keep returning stale data. Entity-based invalidation addresses this. A query fetches '
    + 'Account 101 and the response is cached. Later a mutation updates Account 101. The invalidation mechanism '
    + 'identifies the affected entity, and cached responses containing it are invalidated — other entries stay. '
    + 'Hive Gateway response caching supports entity tracking and automatic invalidation through mutations, when '
    + 'the entity identity information is available. We can also implement custom invalidation strategies.',
  );
}

// =====================================================================
// 23 — Conclusion
// =====================================================================
pres.addSection({ title: 'Close' });
{
  const s = pres.addSlide({ masterName: 'CLOSE_DARK', sectionTitle: 'Close' });
  s.addText('The big picture', { placeholder: 'title' });
  const items = [
    ['GraphQL', 'lets clients ask for exactly the data they need.', K.accent4],
    ['Federation', 'splits a large API into independently owned subgraphs behind one endpoint.', K.accent3],
    ['Composition', 'combines subgraph schemas into the supergraph the gateway runs on.', K.accent1],
    ['Hive', 'checks, publishes, composes, serves and monitors the graph.', K.accent1],
    ['Plugins, coprocessors & caching', 'customise and optimise the runtime for our needs.', K.accent2],
  ];
  const y0 = 1.65, rh = 0.78;
  items.forEach(([h, d, c], i) => {
    const y = y0 + i * rh;
    hexBadge(s, { x: M, y: y + 0.04, n: i + 1, size: 0.5, fill: c, fontSize: 14 });
    s.addText([
      { text: h + '  ', options: { bold: true, color: 'FFFFFF' } },
      { text: d, options: { color: 'C9CDD4' } },
    ], { x: M + 0.8, y, w: 8.4, h: 0.58, isTextBox: true, margin: 0, fontSize: 16, valign: 'middle' });
  });
  hexCluster(s, 10.2, 2.0, 0.8, K.accent1);
  s.addText('Thank you — questions?', {
    x: M, y: 5.85, w: 9, h: 0.6, isTextBox: true, margin: 0,
    fontSize: 24, bold: true, color: K.accent1, fontFace: THEME.headFontFace,
  });
  s.addNotes(
    'To summarise: GraphQL gives clients the flexibility to request exactly the data they need. Federation lets '
    + 'us split a large GraphQL API into independently managed subgraphs while exposing one unified API. Schema '
    + 'composition combines those subgraph schemas into a supergraph. Hive provides the tools to manage the '
    + 'schema lifecycle, validate changes, publish schemas, execute federated requests and monitor the graph. '
    + 'And with plugins, coprocessors and caching we can customise and optimise the runtime. That is the overall '
    + 'picture of GraphQL Federation and how Hive fits into it. Thank you!',
  );
}

// ------------------------------------------------------------- write
(async () => {
  const out = process.argv[2] || '../Intro-GraphQL-Federation-Hive.pptx';
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log('wrote', out);
})();
