// The shareable flipbook: one self-contained HTML file — page images embedded, no scripts or fonts
// fetched — that opens in any browser, offline. It turns pages like the editor's Preview: the
// front cover closed, spreads with a page turn, the back cover last. On a phone held upright it
// shows one page at a time. Swipe, tap a page, use the arrow keys or the slider.

export interface FlipbookPage {
  /** Image (data: URI), trimmed to the page. */
  src: string;
  pageNumber: number;
}

export interface FlipbookData {
  title: string;
  /** Page and cover-board sizes in mm (only the ratios matter). */
  pageW: number;
  pageH: number;
  coverW: number;
  coverH: number;
  front: string | null;
  back: string | null;
  pages: FlipbookPage[];
  /** Each spread as indexes into `pages`; null where the inside of a cover board shows. */
  spreads: [number | null, number | null][];
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function flipbookHtml(data: FlipbookData): string {
  // JSON inside a <script>: escape "<" so no string can close the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="Photobook Studio">
<title>${escapeHtml(data.title || 'Photobook')}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top"><span class="title">${escapeHtml(data.title || 'Photobook')}</span><span class="where" id="where"></span><button class="icon" id="fs" title="Full screen" aria-label="Full screen" hidden>⤢</button></header>
<main class="stage" id="stage">
<button class="arrow" id="prev" aria-label="Previous page">‹</button>
<div class="book" id="book" role="img"></div>
<button class="arrow" id="next" aria-label="Next page">›</button>
</main>
<footer class="bottom"><input type="range" id="slider" min="0" value="0" aria-label="Page"><span class="hint" id="hint"></span></footer>
<script id="data" type="application/json">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden}
body{background:radial-gradient(ellipse at center,#3a3a40 0%,#141416 75%);color:#ececf0;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;-webkit-user-select:none;user-select:none}
.top{display:flex;align-items:center;gap:14px;padding:12px max(18px,env(safe-area-inset-right)) 12px max(18px,env(safe-area-inset-left))}
.title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.where{color:#a4a4ad;font-size:13px;white-space:nowrap}
.icon{background:none;border:0;color:#ececf0;font-size:18px;cursor:pointer;padding:4px 6px}
.stage{flex:1;display:flex;align-items:center;justify-content:center;gap:18px;min-height:0;touch-action:pan-y pinch-zoom}
.arrow{flex:none;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#fff;font-size:26px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 0 3px}
.arrow:disabled{opacity:.25;cursor:default}
.single .arrow{display:none}
.book{position:relative;perspective:2600px;flex:none}
.pages{position:absolute;inset:0;transform-style:preserve-3d}
.slot{position:absolute;top:0;cursor:pointer;box-shadow:0 18px 50px rgba(0,0,0,.55);background:#fff;overflow:hidden}
.slot img,.face img{display:block;width:100%;height:100%;-webkit-user-drag:none;pointer-events:none}
.board{background:#2c2c30}
.gutter{position:absolute;top:0;bottom:0;width:40px;margin-left:-20px;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.18) 45%,rgba(0,0,0,.28) 50%,rgba(0,0,0,.18) 55%,rgba(0,0,0,0) 100%)}
.leaf{position:absolute;top:0;transform-style:preserve-3d;z-index:3}
.face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#fff;overflow:hidden}
.face.back{transform:rotateY(180deg)}
.face.board{background:#2c2c30}
.shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.25),rgba(0,0,0,0));animation:shade var(--turn) ease-in-out forwards}
@keyframes fwd{from{transform:rotateY(0)}to{transform:rotateY(-180deg)}}
@keyframes back{from{transform:rotateY(0)}to{transform:rotateY(180deg)}}
@keyframes shade{0%{opacity:0}50%{opacity:1}100%{opacity:0}}
@keyframes peel-out{from{transform:rotateY(0);opacity:1}to{transform:rotateY(-110deg);opacity:0}}
@keyframes peel-in{from{transform:rotateY(-110deg);opacity:0}to{transform:rotateY(0);opacity:1}}
.bottom{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 16px max(20px,env(safe-area-inset-bottom))}
.bottom input{width:min(520px,80vw)}
.hint{color:#a4a4ad;font-size:12px;text-align:center}
@media (prefers-reduced-motion:reduce){.leaf,.shade{animation-duration:1ms!important}}
`;

// Plain ES2017, no dependencies: it runs in whatever browser the file is opened in.
const SCRIPT = `
(function(){
var D = JSON.parse(document.getElementById('data').textContent);
var TURN = 650;
var book = document.getElementById('book'), slider = document.getElementById('slider');
var prev = document.getElementById('prev'), next = document.getElementById('next');
var where = document.getElementById('where'), hint = document.getElementById('hint');
var single = false, views = [], at = 0, turning = false, scale = 1;
document.documentElement.style.setProperty('--turn', TURN + 'ms');

function el(tag, cls, style) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) for (var k in style) e.style[k] = style[k];
  return e;
}
function img(src, alt) { var i = new Image(); i.src = src; i.alt = alt; i.draggable = false; i.decoding = 'async'; return i; }

function buildViews() {
  var v = [];
  if (D.front) v.push({ kind: 'front' });
  if (single) D.pages.forEach(function (_, i) { v.push({ kind: 'page', i: i }); });
  else D.spreads.forEach(function (_, i) { v.push({ kind: 'spread', i: i }); });
  if (D.back) v.push({ kind: 'back' });
  return v;
}
/** What a view shows, to keep the place when switching between one page and spreads. */
function anchor(v) {
  if (!v) return 'front';
  if (v.kind === 'page') return v.i;
  if (v.kind === 'spread') { var s = D.spreads[v.i]; return s[0] != null ? s[0] : s[1]; }
  return v.kind;
}
function find(a) {
  for (var i = 0; i < views.length; i++) {
    var v = views[i];
    if (v.kind === a) return i;
    if (v.kind === 'page' && v.i === a) return i;
    if (v.kind === 'spread' && (D.spreads[v.i][0] === a || D.spreads[v.i][1] === a)) return i;
  }
  return 0;
}
function label(v) {
  if (v.kind === 'front') return 'Front cover';
  if (v.kind === 'back') return 'Back cover';
  if (v.kind === 'page') return 'Page ' + D.pages[v.i].pageNumber;
  var n = D.spreads[v.i].filter(function (p) { return p != null; }).map(function (p) { return D.pages[p].pageNumber; });
  return n.length > 1 ? 'Pages ' + n[0] + '–' + n[n.length - 1] : 'Page ' + n[0];
}

function layout() {
  var a = anchor(views[at]);
  single = innerWidth < innerHeight && innerWidth < 900;
  document.body.classList.toggle('single', single);
  views = buildViews();
  at = find(a);
  var stage = document.getElementById('stage');
  var w = stage.clientWidth - (single ? 24 : 160), h = stage.clientHeight - 16;
  var bookW = single ? Math.max(D.pageW, D.coverW * D.pageH / D.coverH) : 2 * D.pageW;
  scale = Math.max(0.1, Math.min(w / bookW, h / D.pageH));
  book.style.width = bookW * scale + 'px';
  book.style.height = D.pageH * scale + 'px';
  slider.max = String(views.length - 1);
  hint.textContent = single ? 'Swipe or tap a page to turn' : 'Arrow keys, swipe or click a page to turn';
  render();
}

var PW = function () { return D.pageW * scale; }, PH = function () { return D.pageH * scale; };
var CW = function () { return D.coverW * D.pageH / D.coverH * scale; };

/** One side of a view: 'left'/'right' page of a spread, a cover board, or a single page. */
function face(v, side, cls) {
  var box = el('div', cls);
  if (v.kind === 'front' || v.kind === 'back') {
    box.style.width = CW() + 'px'; box.style.height = PH() + 'px';
    box.appendChild(img(v.kind === 'front' ? D.front : D.back, label(v)));
    return box;
  }
  var p = v.kind === 'page' ? v.i : D.spreads[v.i][side === 'left' ? 0 : 1];
  box.style.width = PW() + 'px'; box.style.height = PH() + 'px';
  if (p == null) box.classList.add('board');
  else box.appendChild(img(D.pages[p].src, 'Page ' + D.pages[p].pageNumber));
  return box;
}
function place(node, left) { node.style.left = left + 'px'; return node; }

/** x of a single page or board, centred in the book. */
function centre(v) { return ((parseFloat(book.style.width) || 0) - (v.kind === 'front' || v.kind === 'back' ? CW() : PW())) / 2; }

/** Swap in new pages once their images are decoded (up to 400 ms), so a jump never flashes white. */
var shown = 0;
function show(pages, then) {
  var token = ++shown;
  var imgs = [].slice.call(pages.querySelectorAll('img'));
  var ready = Promise.all(imgs.map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; }));
  Promise.race([ready, new Promise(function (r) { setTimeout(r, 400); })]).then(function () {
    if (token !== shown) return;
    book.innerHTML = '';
    book.appendChild(pages);
    if (then) then();
  });
}

function render() {
  var v = views[at];
  var pages = el('div', 'pages');
  if (single) {
    pages.appendChild(place(face(v, 'left', 'slot'), centre(v)));
  } else if (v.kind === 'front') {
    pages.appendChild(place(face(v, 'right', 'slot'), PW()));
  } else if (v.kind === 'back') {
    pages.appendChild(place(face(v, 'left', 'slot'), PW() - CW()));
  } else {
    pages.appendChild(place(face(v, 'left', 'slot'), 0));
    pages.appendChild(place(face(v, 'right', 'slot'), PW()));
    pages.appendChild(place(el('div', 'gutter'), PW()));
  }
  show(pages, function () { book.setAttribute('aria-label', label(v)); where.textContent = label(v); });
  slider.value = String(at);
  prev.disabled = at === 0;
  next.disabled = at === views.length - 1;
  preload(at + 1); preload(at - 1);
}

function preload(i) {
  var v = views[i];
  if (!v) return;
  var srcs = v.kind === 'front' ? [D.front] : v.kind === 'back' ? [D.back] : v.kind === 'page' ? [D.pages[v.i].src]
    : D.spreads[v.i].filter(function (p) { return p != null; }).map(function (p) { return D.pages[p].src; });
  srcs.forEach(function (s) { var i = new Image(); i.src = s; if (i.decode) i.decode().catch(function () {}); });
}

function finish(to) { setTimeout(function () { at = to; turning = false; render(); }, TURN); }

function go(to) {
  if (turning || to < 0 || to >= views.length || to === at) return;
  var from = views[at], dest = views[to], forward = to > at;
  if (Math.abs(to - at) !== 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) { at = to; return render(); }
  turning = true;
  var pages = el('div', 'pages');
  if (single) {
    // One page: the page peels away to the left, or back in from it.
    var under = forward ? dest : from, over = forward ? from : dest;
    pages.appendChild(place(face(under, 'left', 'slot'), centre(under)));
    var leaf = place(el('div', 'leaf', { width: (over.kind === 'front' || over.kind === 'back' ? CW() : PW()) + 'px', height: PH() + 'px', transformOrigin: 'left center', animation: (forward ? 'peel-out ' : 'peel-in ') + TURN + 'ms ease-in-out forwards' }), centre(over));
    leaf.appendChild(face(over, 'left', 'face'));
    pages.appendChild(leaf);
  } else if (from.kind === 'spread' && dest.kind === 'spread') {
    // The leaf turns about the spine; its back shows the next page.
    pages.appendChild(place(face(forward ? from : dest, 'left', 'slot'), 0));
    pages.appendChild(place(face(forward ? dest : from, 'right', 'slot'), PW()));
    var leaf2 = place(el('div', 'leaf', { width: PW() + 'px', height: PH() + 'px', transformOrigin: forward ? 'left center' : 'right center', animation: (forward ? 'fwd ' : 'back ') + TURN + 'ms ease-in-out forwards' }), forward ? PW() : 0);
    leaf2.appendChild(face(from, forward ? 'right' : 'left', 'face'));
    leaf2.appendChild(face(dest, forward ? 'left' : 'right', 'face back'));
    leaf2.appendChild(el('div', 'shade'));
    pages.appendChild(leaf2);
    pages.appendChild(place(el('div', 'gutter'), PW()));
  } else {
    // Opening or closing the cover: no turn, just show it.
    turning = false; at = to; return render();
  }
  show(pages, function () { where.textContent = label(dest); finish(to); });
}

prev.onclick = function () { go(at - 1); };
next.onclick = function () { go(at + 1); };
slider.oninput = function () { var to = Number(slider.value); if (turning) return; at = to; render(); };
addEventListener('keydown', function (e) {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(at + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); }
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(views.length - 1);
});

// Swipe left or right to turn; a tap on the left half goes back, anywhere else goes on.
var down = null;
var stage = document.getElementById('stage');
stage.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('button')) return; down = { x: e.clientX, y: e.clientY }; });
stage.addEventListener('pointerup', function (e) {
  if (!down) return;
  var dx = e.clientX - down.x, dy = e.clientY - down.y;
  down = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return go(at + (dx < 0 ? 1 : -1));
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return;
  var r = book.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  var v = views[at];
  if (v.kind === 'front') return go(at + 1);
  if (v.kind === 'back') return go(at - 1);
  go(at + (e.clientX < r.left + r.width / (single ? 3 : 2) ? -1 : 1));
});
stage.addEventListener('pointercancel', function () { down = null; });

var fs = document.getElementById('fs');
if (document.documentElement.requestFullscreen) {
  fs.hidden = false;
  fs.onclick = function () { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(function () {}); };
}
var t = 0;
addEventListener('resize', function () { clearTimeout(t); t = setTimeout(layout, 80); });
layout();
})();
`;
