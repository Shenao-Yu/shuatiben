'use strict';

const SRC_NAME = { javaguide: 'JavaGuide', carl: '代码随想录', agentguide: 'AgentGuide' };
const LANGS = ['C++', 'Java', 'Python', 'Go', 'JavaScript', 'TypeScript', 'Rust', 'C'];
const FILTERS = [['all', '全部'], ['todo', '未刷'], ['s1', '不会'], ['s2', '模糊'], ['s3', '掌握'], ['fav', '收藏']];
const RATES = [[1, '不会', 'r1'], [2, '模糊', 'r2'], [3, '掌握', 'r3']];
const HLJS_ALIAS = {
  'c++': 'cpp', cc: 'cpp', golang: 'go', py: 'python', python3: 'python', js: 'javascript', ts: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', yml: 'yaml', 'c#': 'csharp', cs: 'csharp',
  rs: 'rust', kt: 'kotlin', text: '', txt: '', plain: '', plaintext: '',
};
const ICON = {
  home: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 11l8-6.5 8 6.5V20H4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>',
  review: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 16.3l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M14.5 6l-6 6 6 6" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9.5 6l6 6-6 6" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);

const S = {
  data: null,
  byId: new Map(),
  groupIds: new Map(),
  groupOf: new Map(),
  prog: null,
  session: null, // 当前一轮：{ ids, label, back, group }
  list: null, // 当前列表页：{ ids, label, back, group }
  current: null,
  revealed: false,
  view: '',
  ui: { filter: {}, src: {}, star: {} },
  beforeSearch: '#/',
  saveTimer: 0,
  noteTimer: 0,
  dirty: false,
};

// ------------------------------------------------------------------ 进度

function blankProgress() {
  return { v: 1, items: {}, settings: { lang: 'C++', hidden: [] }, log: {}, last: null };
}

function normalizeProgress(p) {
  const b = blankProgress();
  if (!p || typeof p !== 'object' || typeof p.items !== 'object') return b;
  return { ...b, ...p, settings: { ...b.settings, ...(p.settings || {}) }, log: p.log || {} };
}

async function loadProgress() {
  let p = null;
  try {
    const r = await fetch('/api/progress');
    if (r.ok) p = await r.json();
  } catch (e) { /* 服务没开时退回浏览器缓存 */ }
  if (!p || !p.items) {
    try { p = JSON.parse(localStorage.getItem('shuati-progress') || 'null'); } catch (e) { p = null; }
  }
  return normalizeProgress(p);
}

function save() {
  S.dirty = true;
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(saveNow, 400);
}

async function saveNow(keepalive = false) {
  clearTimeout(S.saveTimer);
  if (!S.dirty) return;
  S.dirty = false;
  const body = JSON.stringify(S.prog);
  try { localStorage.setItem('shuati-progress', body); } catch (e) { /* 存储满了也不影响主流程 */ }
  try {
    const r = await fetch('/api/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: keepalive && body.length < 60000,
    });
    if (!r.ok) throw new Error(r.status);
  } catch (e) {
    toast('本地服务没有响应，进度暂存在浏览器里');
  }
}

const rec = (id) => S.prog.items[id];
const status = (id) => (rec(id) && rec(id).s) || 0;
const isFav = (id) => !!(rec(id) && rec(id).f);
const touch = (id) => S.prog.items[id] || (S.prog.items[id] = {});

function dayKey(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function streak() {
  const d = new Date();
  if (!S.prog.log[dayKey(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (S.prog.log[dayKey(d)]) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function setStatus(id, s) {
  const r = touch(id);
  r.s = s;
  r.t = Date.now();
  r.n = (r.n || 0) + 1;
  const k = dayKey();
  S.prog.log[k] = (S.prog.log[k] || 0) + 1;
  save();
}

function toggleFav(id) {
  const r = touch(id);
  if (r.f) delete r.f;
  else r.f = 1;
  save();
  return !!r.f;
}

function setNote(id, text) {
  const r = touch(id);
  if (text.trim()) r.note = text;
  else delete r.note;
  save();
}

// ------------------------------------------------------------------ 数据查询

const hiddenSet = () => new Set(S.prog.settings.hidden || []);
const idsOf = (gid) => S.groupIds.get(gid) || [];
const groupName = (gid) => (S.groupOf.get(gid) ? S.groupOf.get(gid).group.name : '');

function visibleIds() {
  const h = hiddenSet();
  const out = [];
  for (const b of S.data.banks) for (const g of b.groups) if (!h.has(g.id)) out.push(...idsOf(g.id));
  return out;
}

function tally(ids) {
  const c = { 0: 0, 1: 0, 2: 0, 3: 0, total: ids.length };
  for (const id of ids) c[status(id)] += 1;
  return c;
}

function reviewIds() {
  return visibleIds()
    .filter((id) => status(id) === 1 || status(id) === 2)
    .sort((a, b) => status(a) - status(b) || (rec(a).t || 0) - (rec(b).t || 0));
}

const favIds = () => visibleIds().filter(isFav);

function applyFilter(ids, f) {
  if (f === 'todo') return ids.filter((id) => status(id) === 0);
  if (f === 'fav') return ids.filter(isFav);
  if (f[0] === 's') return ids.filter((id) => status(id) === Number(f[1]));
  return ids;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------ Markdown

if (window.marked) marked.use({ gfm: true, breaks: false });

function highlight(code) {
  const m = /language-([\w+#-]+)/i.exec(code.className);
  let lang = m ? m[1].toLowerCase() : '';
  if (lang in HLJS_ALIAS) lang = HLJS_ALIAS[lang];
  if (!lang || !window.hljs || !hljs.getLanguage(lang)) return;
  try {
    code.innerHTML = hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value;
    code.classList.add('hljs');
  } catch (e) { /* 高亮失败就显示纯文本 */ }
}

function renderMd(md, extraClass = '') {
  const box = document.createElement('div');
  box.className = 'md ' + extraClass;
  box.innerHTML = DOMPurify.sanitize(marked.parse(md || ''));
  for (const a of $$('a[href]', box)) {
    if (/^https?:/i.test(a.getAttribute('href'))) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
  for (const img of $$('img', box)) {
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
  }
  for (const t of $$('table', box)) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.replaceWith(wrap);
    wrap.appendChild(t);
  }
  for (const code of $$('pre code', box)) highlight(code);
  return box;
}

// ------------------------------------------------------------------ 公共渲染

function view(html) {
  $('#view').innerHTML = html;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function stackBar(t) {
  return `<span class="stack">${[3, 2, 1].map((k) => `<i class="k${k}" style="width:${(t[k] * 100) / (t.total || 1)}%"></i>`).join('')}</span>`;
}

function tagsHtml(q, withGroup) {
  let h = '';
  if (withGroup) h += `<span class="tag">${esc(groupName(q.g))}</span>`;
  if (q.star) h += '<span class="tag star">重点</span>';
  if (!q.md && q.src !== 'carl') h += '<span class="tag none">无参考答案</span>';
  if (isFav(q.id)) h += '<span class="fav-mark">★</span>';
  return h;
}

function snippet(q, terms) {
  const plain = q.md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`|_\-[\]()!]+/g, ' ').replace(/\s+/g, ' ');
  const low = plain.toLowerCase();
  const pos = Math.min(...terms.map((t) => low.indexOf(t)).filter((i) => i >= 0));
  if (!Number.isFinite(pos)) return '';
  const start = Math.max(0, pos - 30);
  let s = esc((start ? '…' : '') + plain.slice(start, pos + 70));
  for (const t of terms) {
    s = s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  }
  return s;
}

function listHtml(ids, opts = {}) {
  if (!ids.length) return '<div class="empty">这里没有题目。</div>';
  let html = '<div class="qlist">';
  let lastCat = null;
  const limit = opts.limit || 1000;
  ids.slice(0, limit).forEach((id) => {
    const q = S.byId.get(id);
    if (opts.cats && q.cat !== lastCat) {
      lastCat = q.cat;
      html += `<div class="cat">${esc(q.cat)}</div>`;
    }
    const snip = opts.terms && opts.weak && opts.weak.has(id) ? snippet(q, opts.terms) : '';
    html += `<div class="qrow" data-id="${id}"><span class="dot s${status(id)}"></span>`
      + `<span class="t">${esc(q.title)}${snip ? `<span class="snip">${snip}</span>` : ''}</span>${tagsHtml(q, opts.groupTag)}</div>`;
  });
  html += '</div>';
  if (ids.length > limit) html += `<div class="more">还有 ${ids.length - limit} 题没显示，换个更具体的关键词试试。</div>`;
  return html;
}

// ------------------------------------------------------------------ 侧边栏

function navLink(href, name, icon, count, active) {
  return `<a href="${href}" class="${active ? 'active' : ''}">${icon}<span>${name}</span>${count !== '' ? `<span class="count">${count}</span>` : ''}</a>`;
}

function renderSide() {
  const h = hiddenSet();
  const activeGroup = S.view === 'group' || S.view === 'practice' || S.view === 'done'
    ? (S.view === 'group' ? S.list.group : S.current && S.current.g) : null;
  let html = '<div class="brand"><i></i>刷题本</div><nav class="nav">'
    + navLink('#/', '今日', ICON.home, '', S.view === 'home')
    + navLink('#/review', '待复习', ICON.review, reviewIds().length, S.view === 'review')
    + navLink('#/fav', '收藏', ICON.star, favIds().length, S.view === 'fav')
    + '</nav>';
  for (const b of S.data.banks) {
    const groups = b.groups.filter((g) => !h.has(g.id));
    if (!groups.length) continue;
    html += `<div class="bank-name">${esc(b.name)}</div>`;
    for (const g of groups) {
      const t = tally(idsOf(g.id));
      const done = t.total - t[0];
      html += `<a class="grp${g.id === activeGroup ? ' active' : ''}" href="#/g/${g.id}"><span>${esc(g.name)}</span>`
        + `<span class="count">${done}/${t.total}</span><i class="bar" style="--p:${pct(done, t.total)}%"></i></a>`;
    }
  }
  $('#side').innerHTML = html;
}

// ------------------------------------------------------------------ 页面

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function viewHome() {
  S.view = 'home';
  const ids = visibleIds();
  const t = tally(ids);
  const todayN = S.prog.log[dayKey()] || 0;
  const rv = reviewIds().length;
  const last = S.prog.last && S.byId.get(S.prog.last.id) ? S.prog.last : null;
  const lastQ = last && S.byId.get(last.id);
  const h = hiddenSet();
  let banks = '';
  for (const b of S.data.banks) {
    const groups = b.groups.filter((g) => !h.has(g.id));
    if (!groups.length) continue;
    const bt = tally(groups.flatMap((g) => idsOf(g.id)));
    banks += `<div class="bank-card"><h3>${esc(b.name)}<small>已刷 ${bt.total - bt[0]} / ${bt.total}</small></h3>`;
    for (const g of groups) {
      const gt = tally(idsOf(g.id));
      banks += `<a class="grow" href="#/g/${g.id}"><span>${esc(g.name)}</span>${stackBar(gt)}<span class="num">${gt.total - gt[0]}/${gt.total}</span></a>`;
    }
    banks += '</div>';
  }
  view(`
    <h1 class="page">${greeting()}</h1>
    <p class="sub">${todayN ? `今天已经刷了 ${todayN} 题，继续保持。` : '今天还没开始，先刷几道热热身。'}</p>
    <div class="stats">
      <div class="stat"><b>${todayN}</b><span>今日已刷</span></div>
      <div class="stat"><b>${streak()}</b><span>连续打卡天数</span></div>
      <div class="stat"><b>${t.total - t[0]}</b><span>累计刷过 / ${t.total}</span></div>
      <div class="stat"><b>${pct(t[3], t.total)}%</b><span>掌握率</span></div>
    </div>
    <div class="actions">
      <button class="action" data-act="continue" ${last ? '' : 'disabled'}><b>继续上次</b>
        <span>${last ? esc(`${groupName(lastQ.g)} · ${lastQ.title}`) : '还没有刷题记录'}</span></button>
      <button class="action" data-act="review" ${rv ? '' : 'disabled'}><b>复习待巩固</b>
        <span>${rv ? `${rv} 道标记为不会或模糊` : '暂时没有需要复习的题'}</span></button>
      <button class="action" data-act="random"><b>随机 10 题</b><span>从还没掌握的题里抽</span></button>
    </div>
    <div class="section-title">各题库进度</div>
    <div class="legend"><span><i style="background:var(--good)"></i>掌握</span><span><i style="background:var(--mid)"></i>模糊</span>
      <span><i style="background:var(--bad)"></i>不会</span><span><i style="background:var(--todo)"></i>未刷</span></div>
    ${banks || '<div class="empty">所有题库都被隐藏了，可以在设置里打开。</div>'}`);
}

function startLabel(ids) {
  const todo = ids.filter((id) => status(id) === 0).length;
  if (todo === ids.length) return '开始刷题';
  return todo ? `继续刷题（剩 ${todo}）` : '从头再刷一遍';
}

function viewGroup(gid) {
  S.view = 'group';
  const { group, bank } = S.groupOf.get(gid);
  const all = idsOf(gid);
  const srcs = [...new Set(all.map((id) => S.byId.get(id).src))];
  const src = srcs.includes(S.ui.src[gid]) ? S.ui.src[gid] : 'all';
  let base = src === 'all' ? all : all.filter((id) => S.byId.get(id).src === src);
  const hasStar = base.some((id) => S.byId.get(id).star);
  const starOnly = hasStar && S.ui.star[gid];
  if (starOnly) base = base.filter((id) => S.byId.get(id).star);
  const f = S.ui.filter[gid] || 'all';
  const ids = applyFilter(base, f);
  const t = tally(all);
  S.list = { ids, label: group.name, back: `#/g/${gid}`, group: gid };

  const baseTally = tally(base);
  const counts = { all: base.length, todo: baseTally[0], s1: baseTally[1], s2: baseTally[2], s3: baseTally[3], fav: base.filter(isFav).length };
  let chips = FILTERS.map(([k, name]) => `<button class="chip${f === k ? ' on' : ''}" data-filter="${k}">${name}<em>${counts[k]}</em></button>`).join('');
  if (srcs.length > 1) {
    chips += '<span class="sep"></span>' + [['all', '全部来源'], ...srcs.map((s) => [s, SRC_NAME[s]])]
      .map(([k, name]) => `<button class="chip${src === k ? ' on' : ''}" data-src="${k}">${name}</button>`).join('');
  }
  if (hasStar) chips += `<span class="sep"></span><button class="chip${starOnly ? ' on' : ''}" data-star="1">只看重点</button>`;

  view(`
    <div class="list-head">
      <div><h1 class="page">${esc(group.name)}</h1>
        <p class="sub" style="margin:0">${esc(bank.name)} · ${t.total} 题 · 已刷 ${t.total - t[0]} · 掌握 ${t[3]}</p></div>
      <div class="row">
        <button class="btn" data-act="shuffle" ${ids.length ? '' : 'disabled'}>随机顺序</button>
        <button class="btn primary" data-act="start" ${ids.length ? '' : 'disabled'}>${startLabel(ids)}</button>
      </div>
    </div>
    <div class="filters">${chips}</div>
    ${listHtml(ids, { cats: true })}`);
}

function viewSpecial(kind) {
  S.view = kind;
  const review = kind === 'review';
  const ids = review ? reviewIds() : favIds();
  S.list = { ids, label: review ? '待复习' : '收藏', back: `#/${kind}`, group: null };
  view(`
    <div class="list-head">
      <div><h1 class="page">${review ? '待复习' : '收藏'}</h1>
        <p class="sub" style="margin:0">${review ? '标记为「不会」「模糊」的题，不会的排前面，越久没复习越靠前。' : '刷题时按 F 或点「收藏」，题目会出现在这里。'}</p></div>
      <div class="row"><button class="btn primary" data-act="start" ${ids.length ? '' : 'disabled'}>${review ? '开始复习' : '开始刷题'}</button></div>
    </div>
    ${ids.length ? listHtml(ids, { groupTag: true }) : `<div class="empty">${review ? '没有待复习的题。' : '还没有收藏的题。'}</div>`}`);
}

function searchIds(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const strong = [];
  const weak = [];
  if (!terms.length) return { terms, strong, weak };
  const h = hiddenSet();
  for (const q of S.data.questions) {
    if (h.has(q.g)) continue;
    if (!q._head) q._head = `${q.title} ${q.cat}`.toLowerCase();
    if (terms.every((t) => q._head.includes(t))) {
      strong.push(q.id);
      continue;
    }
    if (!q._body) q._body = `${q.stmt || ''} ${q.md}`.toLowerCase();
    if (terms.every((t) => q._body.includes(t))) weak.push(q.id);
  }
  return { terms, strong, weak };
}

function viewSearch(query) {
  S.view = 'search';
  const input = $('#searchInput');
  if (document.activeElement !== input) input.value = query;
  const { terms, strong, weak } = searchIds(query);
  const ids = strong.concat(weak);
  S.list = { ids, label: '搜索结果', back: `#/search/${encodeURIComponent(query)}`, group: null };
  view(`
    <div class="list-head">
      <div><h1 class="page">搜索「${esc(query)}」</h1>
        <p class="sub" style="margin:0">${ids.length ? `标题命中 ${strong.length} 题，答案内容命中 ${weak.length} 题` : '没有找到，换个关键词试试'}</p></div>
      <div class="row"><button class="btn primary" data-act="start" ${ids.length ? '' : 'disabled'}>刷这些题</button></div>
    </div>
    ${ids.length ? listHtml(ids, { groupTag: true, terms, weak: new Set(weak), limit: 300 }) : ''}`);
}

function startSession(ids, startId, label, back, group) {
  S.session = { ids: ids.slice(), label, back, group: group || null };
  location.hash = `#/q/${startId}`;
}

function chipsHtml(q) {
  let h = `<span class="tag">${SRC_NAME[q.src]}</span>`;
  if (q.star) h += '<span class="tag star">重点</span>';
  const m = q.meta || {};
  if (m['难度']) h += `<span class="tag">难度 ${esc(m['难度'])}</span>`;
  if (m['时间']) h += `<span class="tag">${esc(m['时间'])}</span>`;
  if (m['公司']) h += `<span class="tag" title="${esc(m['公司'])}">${esc(m['公司'].length > 22 ? `${m['公司'].slice(0, 22)}…` : m['公司'])}</span>`;
  return h;
}

function viewPractice(id) {
  const q = S.byId.get(id);
  if (!S.session || !S.session.ids.includes(id)) {
    S.session = { ids: idsOf(q.g), label: groupName(q.g), back: `#/g/${q.g}`, group: q.g };
  }
  if (!S.current || S.current.id !== id || S.view !== 'practice') {
    S.revealed = false;
    window.scrollTo(0, 0);
  }
  S.current = q;
  S.view = 'practice';
  if (S.session.group) {
    S.prog.last = { id, g: S.session.group };
    save();
  }
  const { ids } = S.session;
  const idx = ids.indexOf(id);
  const r = rec(id) || {};
  const lc = q.src === 'carl';
  view(`
    <div class="ptop">
      <a class="back" href="${S.session.back}">${ICON.left}${esc(S.session.label)}</a>
      <span class="pos">${idx + 1} / ${ids.length}</span>
      <button class="icon-btn" data-act="prev" title="上一题（←）" ${idx === 0 ? 'disabled' : ''}>${ICON.left}</button>
      <button class="icon-btn" data-act="next" title="下一题（→）">${ICON.right}</button>
    </div>
    <div class="progress"><i style="--p:${pct(idx + 1, ids.length)}%"></i></div>
    <article class="card">
      <div class="crumb">${esc(groupName(q.g))}${q.cat && q.cat !== groupName(q.g) ? ` · ${esc(q.cat)}` : ''}</div>
      <h1 class="qtitle">${esc(q.title)}</h1>
      <div class="chips">${chipsHtml(q)}</div>
      <div id="stmt"></div>
      ${q.link ? `<a class="btn small" href="${esc(q.link)}" target="_blank" rel="noopener">去${q.link.includes('kamacoder') ? '卡码网' : '力扣'}做题 ↗</a>` : ''}
      <details class="note" ${r.note || !q.md ? 'open' : ''}>
        <summary>${lc ? '我的解法 / 笔记' : '我的回答 / 笔记'}</summary>
        <textarea id="note" placeholder="${lc ? '记下思路、卡住的地方或复杂度分析。' : '先自己说一遍或写下要点，再看答案。'}内容会自动保存。">${esc(r.note || '')}</textarea>
      </details>
      <div id="answer"></div>
      <div class="src">来源：<a href="${esc(q.url)}" target="_blank" rel="noopener">${SRC_NAME[q.src]}${q.doc ? ` · ${esc(q.doc)}` : ''}</a></div>
    </article>
    <div class="ratebar">
      ${RATES.map(([v, name, cls]) => `<button class="rate ${cls}${r.s === v ? ' on' : ''}" data-rate="${v}">${name}<kbd>${v}</kbd></button>`).join('')}
      <button class="rate fav${r.f ? ' on' : ''}" data-act="fav" title="收藏（F）">${r.f ? '★' : '☆'} 收藏</button>
    </div>`);
  if (q.stmt) $('#stmt').append(renderMd(q.stmt, 'stmt'));
  renderAnswer();
  renderSide();
}

function renderAnswer() {
  const q = S.current;
  const box = $('#answer');
  if (!box) return;
  box.innerHTML = '';
  if (!q.md) {
    box.innerHTML = `<div class="noans"><p>源仓库只给了这道题，没有附参考答案。可以先在题库里搜搜相关讲解，再把自己的答案写进上面的笔记。</p>
      <button class="btn small" data-act="related">搜索相关内容</button></div>`;
    return;
  }
  if (!S.revealed) {
    box.innerHTML = `<div class="reveal-wrap"><button class="reveal" data-act="reveal">显示${q.src === 'carl' ? '题解' : '答案'} <kbd>空格</kbd></button></div>`;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'answer';
  let md = q.md;
  let head = '参考答案';
  if (q.src === 'carl') {
    const lang = S.prog.settings.lang || 'C++';
    const have = LANGS.filter((l) => l === 'C++' || (q.langs && q.langs[l]));
    head = `参考题解${lang !== 'C++' && !have.includes(lang) ? `<span>（这题没有 ${esc(lang)} 版本）</span>` : ''}
      <select data-act="lang" title="代码语言">${have.map((l) => `<option${l === lang ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    if (lang !== 'C++' && q.langs && q.langs[lang]) md += `\n\n### ${lang} 版本\n\n${q.langs[lang]}`;
  }
  wrap.innerHTML = `<div class="answer-head">${head}</div>`;
  wrap.append(renderMd(md));
  box.append(wrap);
}

function reveal() {
  if (!S.current || !S.current.md || S.revealed) return false;
  S.revealed = true;
  renderAnswer();
  const a = $('.answer');
  if (a) {
    const y = a.getBoundingClientRect().top + window.scrollY - 80;
    if (y > window.scrollY + window.innerHeight * 0.4) window.scrollTo({ top: y, behavior: 'smooth' });
  }
  return true;
}

function go(delta) {
  const { ids } = S.session;
  const next = ids.indexOf(S.current.id) + delta;
  if (next < 0) return;
  if (next >= ids.length) {
    viewDone();
    return;
  }
  history.replaceState(null, '', `#/q/${ids[next]}`);
  viewPractice(ids[next]);
}

function rateCurrent(v) {
  setStatus(S.current.id, v);
  go(1);
}

function viewDone() {
  S.view = 'done';
  const { ids } = S.session;
  const t = tally(ids);
  const weak = ids.filter((id) => status(id) === 1 || status(id) === 2);
  window.scrollTo(0, 0);
  view(`
    <div class="done">
      <h2>这一轮刷完了</h2>
      <p class="sub">${esc(S.session.label)} · 共 ${ids.length} 题</p>
      <div class="stats">
        <div class="stat"><b style="color:var(--good)">${t[3]}</b><span>掌握</span></div>
        <div class="stat"><b style="color:var(--mid)">${t[2]}</b><span>模糊</span></div>
        <div class="stat"><b style="color:var(--bad)">${t[1]}</b><span>不会</span></div>
      </div>
      <div class="row">
        <a class="btn" href="${S.session.back}">返回列表</a>
        ${weak.length ? `<button class="btn primary" data-act="weak">再刷一遍不会和模糊的（${weak.length}）</button>` : ''}
      </div>
    </div>`);
  renderSide();
}

function relatedQuery(title) {
  const en = title.match(/[A-Za-z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]/g) || [];
  const words = en.filter((w) => w.length > 1 && !/^(and|or|the|vs)$/i.test(w));
  if (words.length) return words.slice(0, 2).join(' ');
  const zh = title
    .replace(/[（(].*?[)）]/g, '')
    .replace(/请|你|如何|怎么|怎样|为什么|什么|哪些|是否|有没有|介绍|解释|一下|谈谈|说说|了解|知道|吗|呢|的|了|和|与|及|在|中|是/g, ' ')
    .split(/[\s，,。？?！!：:、；;“”"'/]+/)
    .filter((w) => w.length >= 2);
  zh.sort((a, b) => b.length - a.length);
  return (zh[0] || title).slice(0, 6);
}

// ------------------------------------------------------------------ 设置

function getTheme() {
  try { return JSON.parse(localStorage.getItem('shuati-theme') || '"auto"'); } catch (e) { return 'auto'; }
}

function setTheme(t) {
  try { localStorage.setItem('shuati-theme', JSON.stringify(t)); } catch (e) { /* 忽略 */ }
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function openModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  m.hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal').innerHTML = '';
}

function openSettings() {
  const st = S.prog.settings;
  const h = hiddenSet();
  const theme = getTheme();
  const groups = S.data.banks.map((b) => `<div class="bank-label">${esc(b.name)}</div>`
    + b.groups.map((g) => `<label><input type="checkbox" data-group="${g.id}" ${h.has(g.id) ? '' : 'checked'}>${esc(g.name)}<span class="count">${idsOf(g.id).length}</span></label>`).join('')).join('');
  const src = Object.values(S.data.sources).map((s) => `<a href="https://github.com/${esc(s.repo)}" target="_blank" rel="noopener">${esc(s.name)}</a>（${esc(s.date)} · ${esc(s.commit)}）`).join('、');
  openModal(`
    <div class="dialog" role="dialog" aria-label="设置">
      <h2>设置<button class="icon-btn" data-act="close" aria-label="关闭">✕</button></h2>
      <div class="field"><span class="label">外观</span>
        <div class="seg">${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, n]) => `<button data-theme="${k}" class="${theme === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="field"><label for="langSel">力扣题解的代码语言</label>
        <select id="langSel">${LANGS.map((l) => `<option${l === st.lang ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <p>代码随想录的讲解自带 C++ 代码，选其他语言时会在讲解后面追加对应版本。</p></div>
      <div class="field"><span class="label">显示哪些题库</span><div class="checks">${groups}</div>
        <p>不打算准备 Java 的话，可以把 Java 相关分组关掉，统计和随机抽题都会跟着排除。</p></div>
      <div class="field"><span class="label">进度备份</span>
        <div class="row"><button class="btn small" data-act="export">导出进度</button><button class="btn small" data-act="import">导入进度</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden></div>
        <p>进度自动保存在 data/progress.json，每天第一次保存时会备份到 data/backups/。</p></div>
      <div class="field"><span class="label">快捷键</span>
        <div class="keys"><kbd>空格</kbd><span>显示答案</span><kbd>1</kbd><span>不会，并进入下一题</span><kbd>2</kbd><span>模糊，并进入下一题</span>
          <kbd>3</kbd><span>掌握，并进入下一题</span><kbd>← →</kbd><span>上一题 / 下一题</span><kbd>F</kbd><span>收藏</span>
          <kbd>Esc</kbd><span>回到列表</span><kbd>/</kbd><span>搜索</span></div></div>
      <div class="field"><span class="label">题库来源</span>
        <p>${src}，生成于 ${esc(S.data.generated)}。想拉取最新内容，在终端运行 <code>python3 app.py --update</code>。内容版权归原作者，仅供个人学习。</p></div>
    </div>`);
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(S.prog, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shuati-progress-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importProgress(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.items !== 'object') throw new Error('格式不对');
    const n = Object.keys(data.items).length;
    if (!window.confirm(`导入后会覆盖当前进度（文件里有 ${n} 道题的记录），确定吗？`)) return;
    S.prog = normalizeProgress(data);
    save();
    closeModal();
    route();
    toast('进度已导入');
  } catch (e) {
    toast(`导入失败：${e.message}`);
  }
}

// ------------------------------------------------------------------ 路由与事件

function route() {
  document.body.classList.remove('side-open');
  const raw = location.hash.replace(/^#\/?/, '');
  const [kind, ...rest] = raw.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (kind !== 'search') {
    S.beforeSearch = location.hash || '#/';
    if (document.activeElement !== $('#searchInput')) $('#searchInput').value = '';
  }
  if (kind === 'q' && S.byId.has(arg)) {
    viewPractice(arg);
    return;
  }
  window.scrollTo(0, 0);
  if (kind === 'g' && S.groupOf.has(arg)) viewGroup(arg);
  else if (kind === 'review' || kind === 'fav') viewSpecial(kind);
  else if (kind === 'search' && arg.trim()) viewSearch(arg.trim());
  else viewHome();
  renderSide();
}

function rerender() {
  if (S.view === 'practice') {
    renderSide();
    return;
  }
  route();
}

function onViewClick(e) {
  const row = e.target.closest('.qrow');
  if (row && S.list) {
    startSession(S.list.ids, row.dataset.id, S.list.label, S.list.back, S.list.group);
    return;
  }
  const el = e.target.closest('[data-act],[data-filter],[data-src],[data-star],[data-rate]');
  if (!el) return;
  if (el.tagName === 'BUTTON') el.blur();
  const d = el.dataset;
  if (d.filter) {
    S.ui.filter[S.list.group] = d.filter;
    viewGroup(S.list.group);
  } else if (d.src) {
    S.ui.src[S.list.group] = d.src;
    viewGroup(S.list.group);
  } else if (d.star) {
    S.ui.star[S.list.group] = !S.ui.star[S.list.group];
    viewGroup(S.list.group);
  } else if (d.rate) {
    rateCurrent(Number(d.rate));
  } else {
    action(d.act, el);
  }
}

function action(act, el) {
  const L = S.list;
  switch (act) {
    case 'start': {
      if (!L.ids.length) return;
      const first = L.ids.find((id) => status(id) === 0) || L.ids[0];
      startSession(L.ids, S.view === 'group' ? first : L.ids[0], L.label, L.back, L.group);
      break;
    }
    case 'shuffle': {
      const ids = shuffle(L.ids);
      startSession(ids, ids[0], `${L.label} · 随机`, L.back, L.group);
      break;
    }
    case 'continue': {
      const { id, g } = S.prog.last;
      startSession(idsOf(g), id, groupName(g), `#/g/${g}`, g);
      break;
    }
    case 'review': {
      const ids = reviewIds();
      if (ids.length) startSession(ids, ids[0], '待复习', '#/review', null);
      break;
    }
    case 'random': {
      let pool = visibleIds().filter((id) => status(id) !== 3);
      if (!pool.length) pool = visibleIds();
      const ids = shuffle(pool).slice(0, 10);
      if (ids.length) startSession(ids, ids[0], '随机 10 题', '#/', null);
      break;
    }
    case 'weak': {
      const ids = S.session.ids.filter((id) => status(id) === 1 || status(id) === 2);
      startSession(ids, ids[0], `${S.session.label.replace(/ · 重刷$/, '')} · 重刷`, S.session.back, S.session.group);
      viewPractice(ids[0]);
      break;
    }
    case 'reveal': reveal(); break;
    case 'prev': go(-1); break;
    case 'next': go(1); break;
    case 'fav': {
      const on = toggleFav(S.current.id);
      el.classList.toggle('on', on);
      el.textContent = `${on ? '★' : '☆'} 收藏`;
      renderSide();
      break;
    }
    case 'related': {
      const q = relatedQuery(S.current.title);
      location.hash = `#/search/${encodeURIComponent(q)}`;
      break;
    }
    default:
  }
}

function onViewChange(e) {
  if (e.target.matches('select[data-act="lang"]')) {
    S.prog.settings.lang = e.target.value;
    save();
    renderAnswer();
  }
}

function onViewInput(e) {
  if (e.target.id !== 'note' || !S.current) return;
  const id = S.current.id;
  const val = e.target.value;
  clearTimeout(S.noteTimer);
  S.noteTimer = setTimeout(() => setNote(id, val), 400);
}

function onModalClick(e) {
  if (e.target.id === 'modal') {
    closeModal();
    return;
  }
  const el = e.target.closest('[data-act],[data-theme]');
  if (!el) return;
  if (el.dataset.theme) {
    setTheme(el.dataset.theme);
    $$('.seg button', $('#modal')).forEach((b) => b.classList.toggle('on', b === el));
    return;
  }
  const act = el.dataset.act;
  if (act === 'close') closeModal();
  else if (act === 'export') exportProgress();
  else if (act === 'import') $('#importFile').click();
}

function onModalChange(e) {
  const t = e.target;
  if (t.id === 'langSel') {
    S.prog.settings.lang = t.value;
    save();
  } else if (t.id === 'importFile' && t.files[0]) {
    importProgress(t.files[0]);
  } else if (t.dataset.group) {
    const h = hiddenSet();
    if (t.checked) h.delete(t.dataset.group);
    else h.add(t.dataset.group);
    S.prog.settings.hidden = [...h];
    save();
    rerender();
  }
}

function onSearchInput(e) {
  const v = e.target.value.trim();
  clearTimeout(onSearchInput.timer);
  onSearchInput.timer = setTimeout(() => {
    if (!v) {
      if (S.view === 'search') location.hash = S.beforeSearch || '#/';
      return;
    }
    const target = `#/search/${encodeURIComponent(v)}`;
    if (location.hash.startsWith('#/search/')) {
      history.replaceState(null, '', target);
      viewSearch(v);
      renderSide();
    } else {
      location.hash = target;
    }
  }, 220);
}

function onSearchKey(e) {
  if (e.key === 'Escape') {
    e.target.value = '';
    e.target.blur();
    if (S.view === 'search') location.hash = S.beforeSearch || '#/';
  } else if (e.key === 'Enter' && S.view === 'search' && S.list && S.list.ids.length) {
    e.target.blur();
    startSession(S.list.ids, S.list.ids[0], S.list.label, S.list.back, null);
  }
}

function onKey(e) {
  const t = e.target;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#searchInput').focus();
    $('#searchInput').select();
    return;
  }
  if (!$('#modal').hidden) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (typing) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    $('#searchInput').focus();
    return;
  }
  if (S.view !== 'practice') return;
  const onControl = t.closest && t.closest('a,button,summary');
  switch (e.key) {
    case ' ':
    case 'Enter':
      if (onControl && e.key === 'Enter') return;
      if (reveal()) e.preventDefault();
      break;
    case '1':
    case '2':
    case '3':
      rateCurrent(Number(e.key));
      break;
    case 'ArrowLeft':
      go(-1);
      break;
    case 'ArrowRight':
      go(1);
      break;
    case 'f':
    case 'F': {
      const btn = $('.rate.fav');
      if (btn) action('fav', btn);
      break;
    }
    case 'Escape':
      location.hash = S.session.back;
      break;
    default:
  }
}

async function init() {
  $('#view').addEventListener('click', onViewClick);
  $('#view').addEventListener('change', onViewChange);
  $('#view').addEventListener('input', onViewInput);
  $('#modal').addEventListener('click', onModalClick);
  $('#modal').addEventListener('change', onModalChange);
  $('#searchInput').addEventListener('input', onSearchInput);
  $('#searchInput').addEventListener('keydown', onSearchKey);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('side-open'));
  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', () => saveNow(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(true); });

  if (!window.marked || !window.DOMPurify) {
    view('<div class="empty">前端依赖没有加载成功。请在终端运行 <code>python3 app.py --update</code> 重新下载。</div>');
    return;
  }
  try {
    const r = await fetch('/api/bank');
    if (!r.ok) throw new Error(r.status);
    S.data = await r.json();
  } catch (e) {
    view('<div class="empty">题库加载失败。请在终端里用 <code>python3 app.py</code> 启动后，再打开它给出的地址。</div>');
    return;
  }
  for (const b of S.data.banks) for (const g of b.groups) {
    S.groupOf.set(g.id, { group: g, bank: b });
    S.groupIds.set(g.id, []);
  }
  for (const q of S.data.questions) {
    S.byId.set(q.id, q);
    if (S.groupIds.has(q.g)) S.groupIds.get(q.g).push(q.id);
  }
  S.prog = await loadProgress();
  window.addEventListener('hashchange', route);
  route();
}

init();
