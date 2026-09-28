/* Audit Desk — UI layer. Scoring and report logic live in scoring.js; data in checks.js.
 * Everything a user types is inserted with textContent (never innerHTML). */
(function () {
  'use strict';

  const D = window.AuditData;
  const A = window.AuditCore;
  const KEY = 'auditdesk.v1';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const SVG = 'http://www.w3.org/2000/svg';
  const VIEWS = ['overview', 'checklist', 'toolkit', 'report'];
  const OSES = [['win', 'Windows'], ['mac', 'macOS'], ['linux', 'Linux']];

  /* --------------------------------------------------------------- helpers */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  function toast(msg) { const el = h('div', { class: 'toast', text: msg }); $('#toasts').appendChild(el); setTimeout(() => el.remove(), 2400); }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); } catch (e) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (err) { /* ignore */ } ta.remove();
    }
    toast(msg || 'Copied');
  }
  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ----------------------------------------------------------------- state */
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  function sanitize(raw) {
    const s = A.defaultState();
    if (!raw || typeof raw !== 'object') return s;
    if (['win', 'mac', 'linux'].includes(raw.os)) s.os = raw.os;
    if (raw.meta && typeof raw.meta === 'object') ['auditor', 'device', 'osVersion', 'date'].forEach((k) => { if (typeof raw.meta[k] === 'string') s.meta[k] = str(raw.meta[k], 120); });
    if (raw.baseline && typeof raw.baseline === 'object') D.BASELINE.forEach((b) => { if (typeof raw.baseline[b.id] === 'string') s.baseline[b.id] = str(raw.baseline[b.id], 8000); });
    if (raw.items && typeof raw.items === 'object') {
      D.CHECKS.forEach((c) => {
        const it = raw.items[c.id]; if (!it || typeof it !== 'object') return;
        const o = {};
        if (['pass', 'fail', 'na'].includes(it.state)) o.state = it.state;
        if (typeof it.evidence === 'string') o.evidence = str(it.evidence, 8000);
        if (typeof it.action === 'string') o.action = str(it.action, 4000);
        if (it.fixed === true) o.fixed = true;
        if ([-1, 1].includes(Number(it.adj))) o.adj = Number(it.adj);
        s.items[c.id] = o;
      });
    }
    if (raw.report && typeof raw.report === 'object') {
      if (Array.isArray(raw.report.include)) s.report.include = raw.report.include.filter((x) => D.CHECKS.some((c) => c.id === x));
      s.report.verification = str(raw.report.verification, 12000);
    }
    return s;
  }
  function load() { try { return sanitize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return A.defaultState(); } }
  let S = load();
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
  const item = (id) => (S.items[id] = S.items[id] || {});
  const ui = { view: 'overview', step: 'identity', filter: 'all' };

  /* ----------------------------------------------------------------- theme */
  const theme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('#theme-toggle').addEventListener('click', () => {
    const next = theme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next;
    try { localStorage.setItem('auditdesk.theme', next); } catch (e) { /* ignore */ }
  });

  /* ------------------------------------------------------------ navigation */
  const tabBtns = $$('.topbar .tab');
  function show(view, focus) {
    if (!VIEWS.includes(view)) view = 'overview';
    ui.view = view;
    tabBtns.forEach((b) => { const on = b.dataset.view === view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    VIEWS.forEach((v) => { $('#v-' + v).hidden = v !== view; });
    if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
    ({ overview: renderOverview, checklist: renderChecklist, toolkit: renderToolkit, report: renderReport })[view]();
    window.scrollTo({ top: 0 });
  }
  tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => show(b.dataset.view));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      show(tabBtns[(i + (e.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length].dataset.view, true);
    });
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  function updateChrome() {
    const s = A.summarize(S);
    $('#top-chip').textContent = s.after == null ? 'Posture —' : `Posture ${s.after} · ${s.grade}`;
    $('#top-chip').className = 'badge ' + (s.after == null ? 'info' : s.after >= 80 ? 'ok' : s.after >= 60 ? 'warn' : 'bad');
  }

  /* -------------------------------------------------------------- pieces */
  function ring(pct, grade) {
    const r = 54; const c = 2 * Math.PI * r;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 140 140'); svg.setAttribute('class', 'ring'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', pct == null ? 'No score yet' : `Security posture ${pct} out of 100, grade ${grade}`);
    const mk = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    svg.append(mk('circle', { cx: 70, cy: 70, r, class: 'ring-bg' }));
    const tone = pct == null ? 'none' : pct >= 80 ? 'ok' : pct >= 60 ? 'warn' : 'bad';
    const arc = mk('circle', { cx: 70, cy: 70, r, class: 'ring-fg ' + tone, 'stroke-dasharray': `${c}`, 'stroke-dashoffset': `${c}`, transform: 'rotate(-90 70 70)' });
    svg.append(arc);
    requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', String(c * (1 - (pct || 0) / 100))));
    const t = mk('text', { x: 70, y: 74, class: 'ring-num' }); t.textContent = pct == null ? '—' : pct; svg.append(t);
    const g = mk('text', { x: 70, y: 96, class: 'ring-sub' }); g.textContent = pct == null ? 'not scored' : `grade ${grade}`; svg.append(g);
    return svg;
  }
  const sevChip = (score) => { const b = A.band(score); return h('span', { class: `sev band-${b.id}`, text: `${score.toFixed(1)} ${b.label}` }); };
  function cmdBlock(cmd) {
    return h('div', { class: 'cmd' }, h('code', { text: cmd }), h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy', onclick: () => copyText(cmd, 'Command copied') }));
  }
  function goToCheck(c) {
    ui.step = c.step; ui.filter = 'all'; show('checklist');
    const el = document.getElementById('chk-' + c.id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
  }

  /* ------------------------------------------------------------- overview */
  function renderOverview() {
    const root = clear($('#v-overview'));
    const s = A.summarize(S);
    const started = s.assessed > 0;

    const osSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Operating system' }, OSES.map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(S.os === id), text: label, onclick: () => { S.os = id; persist(); updateChrome(); renderOverview(); } })));
    const field = (label, key, ph, type) => h('div', null, h('label', { for: 'm-' + key, text: label }),
      h('input', { id: 'm-' + key, type: type || 'text', value: S.meta[key], placeholder: ph || '', autocomplete: 'off', maxlength: '120',
        oninput: (e) => { S.meta[key] = e.target.value; persist(); } }));

    root.append(
      h('div', { class: 'hero' },
        h('div', { class: 'hero-copy' },
          h('h1', { text: 'Audit your own machine. Then prove it is hardened.' }),
          h('p', { class: 'muted lead', text: 'Work through four short checks on your own computer, see each risk scored by severity, fix what fails, and export a one-page vulnerability report with evidence.' }),
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-primary', type: 'button', text: started ? 'Continue the audit' : 'Start the audit', onclick: () => { ui.step = started ? ui.step : 'baseline'; show('checklist'); } }),
            h('button', { class: 'btn', type: 'button', text: 'Open the report', onclick: () => show('report') }))),
        h('div', { class: 'card ring-card' }, ring(s.after, s.grade),
          h('div', { class: 'ring-meta' },
            h('div', null, h('b', { text: String(s.counts.pass) }), ' passed'),
            h('div', null, h('b', { text: String(s.counts.fail) }), ' failed', s.counts.fixed ? ` (${s.counts.fixed} fixed)` : ''),
            h('div', null, h('b', { text: String(s.counts.todo) }), ' to check'),
            h('div', null, h('b', { text: s.coverage + '%' }), ' coverage')),
          s.counts.fixed && s.before != null ? h('p', { class: 'ba' }, 'Before fixes ', h('b', { text: String(s.before) }), '  →  after ', h('b', { text: String(s.after) })) : h('p', { class: 'muted small', style: 'margin:.5rem 0 0', text: 'Score is weighted by severity: a failed critical control costs far more than a low one.' }))),

      h('div', { class: 'card setup' },
        h('h2', { text: 'Your machine' }),
        h('div', { class: 'setup-grid' },
          h('div', null, h('span', { class: 'label', text: 'Operating system' }), osSeg,
            h('p', { class: 'hint', text: 'Only checks and commands for this OS are shown.' })),
          field('Device name', 'device', 'e.g. Ayesha\'s laptop'),
          field('OS version', 'osVersion', 'e.g. Windows 11 23H2'),
          field('Auditor', 'auditor', 'Your name'),
          field('Audit date', 'date', '', 'date'))),

      h('div', null, h('h2', { class: 'sec', text: 'The four-step checklist' }),
        h('div', { class: 'steps' }, D.STEPS.map((st) => {
          let done; let total;
          if (st.id === 'baseline') { total = D.BASELINE.length; done = D.BASELINE.filter((b) => (S.baseline[b.id] || '').trim()).length; } else { total = s.byStep[st.id].total; done = s.byStep[st.id].done; }
          const fails = st.id === 'baseline' ? 0 : s.byStep[st.id].fail;
          return h('button', { class: 'step-card', type: 'button', onclick: () => { ui.step = st.id; show('checklist'); } },
            h('span', { class: 'step-no', text: st.short }),
            h('span', { class: 'step-body' }, h('b', { text: st.label }), h('span', { class: 'muted small', text: st.blurb }),
              h('span', { class: 'prog' }, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
              h('span', { class: 'small' }, `${done}/${total} done`, fails ? h('span', { class: 'badge bad', style: 'margin-left:.5rem', text: `${fails} failed` }) : null)));
        }))),

      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h2', { text: 'Top risks' }), topRisks()),
        h('div', { class: 'card' }, h('h2', { text: 'Fix order' }), roadmapView())),

      h('div', { class: 'card' },
        h('h2', { text: 'Your data' }),
        h('p', { class: 'muted', text: 'Everything is saved in this browser only. Export a backup, move it to another device, or start over.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', text: 'Export JSON', onclick: () => download('audit-desk-data.json', JSON.stringify(S, null, 2), 'application/json') }),
          h('label', { class: 'btn file-btn', for: 'import-file' }, 'Import JSON', h('input', { id: 'import-file', class: 'sr-only', type: 'file', accept: 'application/json,.json', onchange: importFile })),
          h('button', { class: 'btn btn-danger', type: 'button', text: 'Reset everything', onclick: () => { if (confirm('Delete all audit data stored in this browser?')) { S = A.defaultState(); persist(); updateChrome(); renderOverview(); toast('Audit data cleared'); } } }))),

      h('div', { class: 'card ent' },
        h('h2', { text: 'Why this scales up' }),
        h('p', { class: 'muted', text: 'The habits you practise here are the base level of enterprise assurance. Companies use formal versions of the same checklist to prove their security posture:' }),
        h('div', { class: 'ent-grid' },
          h('div', null, h('b', { text: 'ISO 27001:2022' }), h('span', { text: 'Annex A 8.9 Configuration management, 8.8 Technical vulnerabilities, 8.24 Cryptography.' })),
          h('div', null, h('b', { text: 'SOC 2' }), h('span', { text: 'CC6 logical and physical access, CC7 system operations and patching.' })),
          h('div', null, h('b', { text: 'CIS Controls v8' }), h('span', { text: 'Control 1 and 2: know your assets and software. Each check here lists its mapping.' })))));
  }

  function topRisks() {
    const f = A.findings(S).filter((x) => !x.fixed).slice(0, 5);
    if (!f.length) return h('p', { class: 'muted', text: A.summarize(S).assessed ? 'No open failed checks. Nice work.' : 'Failed checks will appear here, ranked by severity.' });
    return h('ol', { class: 'risk-list' }, f.map((x) => h('li', null,
      h('button', { class: 'link-btn', type: 'button', text: x.check.title, onclick: () => goToCheck(x.check) }), sevChip(x.score))));
  }
  function roadmapView() {
    const rm = A.roadmap(S);
    if (!rm.some((g) => g.items.length)) return h('p', { class: 'muted', text: 'Your remediation roadmap builds itself as you mark checks as failed.' });
    return h('div', { class: 'roadmap' }, rm.filter((g) => g.items.length).map((g) => h('div', { class: 'rm band-' + g.band.id },
      h('div', { class: 'rm-head' }, h('b', { text: g.band.plan }), h('span', { class: 'badge', text: g.band.label })),
      h('ul', null, g.items.map((x) => h('li', { text: x.check.title }))))));
  }

  function importFile(e) {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('That file is too large'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      try { S = sanitize(JSON.parse(String(rd.result))); persist(); updateChrome(); renderOverview(); toast('Audit data imported'); } catch (err) { toast('Could not read that file'); }
    };
    rd.readAsText(f); e.target.value = '';
  }

  /* ------------------------------------------------------------ checklist */
  function renderChecklist() {
    const root = clear($('#v-checklist'));
    root.append(h('div', { class: 'cl-layout' }, h('nav', { class: 'stepnav card', id: 'stepnav', 'aria-label': 'Checklist steps' }), h('div', { id: 'cl-body' })));
    renderStepNav(); renderBody();
  }

  function renderStepNav() {
    const nav = $('#stepnav'); if (!nav) return; clear(nav);
    const s = A.summarize(S);
    D.STEPS.forEach((st) => {
      let done; let total;
      if (st.id === 'baseline') { total = D.BASELINE.length; done = D.BASELINE.filter((b) => (S.baseline[b.id] || '').trim()).length; } else { total = s.byStep[st.id].total; done = s.byStep[st.id].done; }
      const fails = st.id === 'baseline' ? 0 : s.byStep[st.id].fail;
      nav.append(h('button', { type: 'button', class: 'nav-btn', 'aria-current': String(ui.step === st.id), onclick: () => { ui.step = st.id; renderStepNav(); renderBody(); window.scrollTo({ top: 0 }); } },
        h('span', { class: 'step-no sm', text: st.short }), h('span', { class: 'nav-label', text: st.label }),
        fails ? h('span', { class: 'badge bad', text: String(fails) }) : null,
        h('span', { class: 'nav-count', text: `${done}/${total}` })));
    });
  }

  function renderBody() {
    const body = clear($('#cl-body'));
    const st = D.STEPS.find((x) => x.id === ui.step) || D.STEPS[1];
    body.append(h('div', { class: 'step-head' }, h('h1', { text: st.id === 'baseline' ? 'Step 0 · Establish the baseline' : `Step ${st.short} · ${st.label}` }), h('p', { class: 'muted', text: st.blurb })));

    if (st.id === 'baseline') {
      D.BASELINE.forEach((b) => {
        const cmd = b.cmd[S.os];
        body.append(h('div', { class: 'card stack', style: '--gap:.6rem' },
          h('h3', { text: b.label }), h('p', { class: 'muted small', style: 'margin:0', text: b.hint }),
          cmd ? cmdBlock(cmd) : null,
          h('textarea', { rows: '4', class: 'mono small', placeholder: 'Paste the output or your notes here…', 'aria-label': b.label, oninput: (e) => { S.baseline[b.id] = e.target.value; persist(); debounceNav(); } }, S.baseline[b.id] || '')));
      });
      body.lastChild.querySelector('textarea').value = S.baseline.accounts || '';
      $$('textarea', body).forEach((t, i) => { t.value = S.baseline[D.BASELINE[i].id] || ''; });
      return;
    }

    const all = A.applicable(S.os).filter((c) => c.step === st.id);
    const match = (c) => { const v = item(c.id).state || 'todo'; return ui.filter === 'all' || (ui.filter === 'todo' && v === 'todo') || ui.filter === v; };
    const counts = { all: all.length, todo: 0, fail: 0, pass: 0 };
    all.forEach((c) => { const v = item(c.id).state; if (!v) counts.todo++; else if (v === 'fail') counts.fail++; else if (v === 'pass') counts.pass++; });
    body.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter checks' }, [['all', 'All'], ['todo', 'To check'], ['fail', 'Failed'], ['pass', 'Passed']].map(([k, l]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(ui.filter === k), onclick: () => { ui.filter = k; renderBody(); } }, l, h('span', { class: 'chip-n', text: String(counts[k]) })))));
    const list = all.filter(match);
    if (!list.length) body.append(h('div', { class: 'card empty-state' }, h('p', { class: 'muted', style: 'margin:0', text: ui.filter === 'all' ? 'No checks in this step for your operating system.' : 'Nothing matches this filter.' })));
    list.forEach((c) => body.append(checkCard(c)));

    const idx = D.STEPS.findIndex((x) => x.id === st.id);
    const nxt = D.STEPS[idx + 1];
    body.append(h('div', { class: 'row step-foot' }, nxt ? h('button', { class: 'btn btn-primary', type: 'button', text: `Next: ${nxt.label}`, onclick: () => { ui.step = nxt.id; ui.filter = 'all'; renderStepNav(); renderBody(); window.scrollTo({ top: 0 }); } })
      : h('button', { class: 'btn btn-primary', type: 'button', text: 'Build the report', onclick: () => show('report') })));
  }

  let navTimer;
  function debounceNav() { clearTimeout(navTimer); navTimer = setTimeout(() => { renderStepNav(); updateChrome(); }, 300); }

  function checkCard(c) {
    const it = item(c.id);
    const card = h('article', { class: 'check', id: 'chk-' + c.id, 'data-state': it.state || 'todo' });
    const sevSlot = h('span', { class: 'sev-slot' }, sevChip(A.effectiveScore(c, it)));
    const setState = (val) => {
      const cur = item(c.id);
      if (cur.state === val) delete cur.state; else cur.state = val;
      card.dataset.state = cur.state || 'todo'; syncAnswer(); persist(); renderStepNav(); updateChrome();
    };
    const mk = (val, label) => h('button', { type: 'button', role: 'radio', 'data-val': val, onclick: () => setState(val) }, label);
    const answer = h('div', { class: 'seg answer', role: 'radiogroup', 'aria-label': `Result for ${c.title}` }, mk('pass', 'Pass'), mk('fail', 'Fail'), mk('na', 'N/A'));
    function syncAnswer() { $$('button', answer).forEach((b) => { const on = b.dataset.val === (item(c.id).state || ''); b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); }); }

    const cmd = c.cmd && c.cmd[S.os];
    const more = h('details', { class: 'more' }, h('summary', { text: 'How to check · why it matters · how to fix' }),
      h('div', { class: 'more-body' },
        h('div', null, h('b', { text: 'How to check' }), h('p', { text: c.how }), cmd ? cmdBlock(cmd) : null),
        h('div', null, h('b', { text: 'Why it matters' }), h('p', { text: c.why })),
        h('div', null, h('b', { text: 'How to fix' }), h('p', { text: c.fix })),
        h('div', { class: 'refs' }, c.refs.map((r) => h('span', { class: 'badge', text: r })))));

    const adjSel = h('select', { id: 'adj-' + c.id, 'aria-label': 'Adjust severity for your context', onchange: (e) => { const v = Number(e.target.value); const cur = item(c.id); if (v) cur.adj = v; else delete cur.adj; persist(); clear(sevSlot).append(sevChip(A.effectiveScore(c, cur))); renderStepNav(); updateChrome(); } },
      [[-1, 'Lower by 1 (low impact on my setup)'], [0, 'As rated'], [1, 'Higher by 1 (sensitive data or shared network)']].map(([v, l]) => h('option', { value: String(v), text: l, selected: (Number(it.adj) || 0) === v })));
    const failBox = h('div', { class: 'fail-box' },
      h('div', null, h('label', { for: 'ev-' + c.id, text: 'Evidence (paste the terminal output or describe what you saw)' }),
        h('textarea', { id: 'ev-' + c.id, rows: '3', class: 'mono small', oninput: (e) => { item(c.id).evidence = e.target.value; persist(); } }, it.evidence || '')),
      h('div', { class: 'fb-row' },
        h('div', null, h('label', { for: 'adj-' + c.id, text: 'Severity in your context' }), adjSel),
        h('label', { class: 'check fixed' }, h('input', { type: 'checkbox', checked: !!it.fixed, onchange: (e) => { const cur = item(c.id); if (e.target.checked) cur.fixed = true; else delete cur.fixed; persist(); updateChrome(); renderStepNav(); } }), 'I have fixed this')),
      h('div', null, h('label', { for: 'ac-' + c.id, text: 'What did you do to fix it? (goes into the report)' }),
        h('textarea', { id: 'ac-' + c.id, rows: '2', placeholder: c.fix, oninput: (e) => { item(c.id).action = e.target.value; persist(); } }, it.action || '')));
    failBox.querySelector('textarea').value = it.evidence || ''; failBox.querySelectorAll('textarea')[1].value = it.action || '';

    card.append(h('div', { class: 'check-head' }, h('h3', { text: c.title }), sevSlot), h('p', { class: 'q', text: c.q }), answer, more, failBox);
    syncAnswer();
    return card;
  }

  /* -------------------------------------------------------------- toolkit */
  function renderToolkit() {
    const root = clear($('#v-toolkit'));
    const col = (k) => (S.os === k ? 'cur' : '');
    root.append(
      h('div', { class: 'intro' }, h('h1', { text: 'The auditor\'s toolkit' }), h('p', { class: 'muted lead', text: 'Command-line checks give evidence, not opinions. Every command here only reads system state: nothing is changed or installed.' })),
      h('div', { class: 'card' }, h('h2', { text: 'Execution matrix' }),
        h('p', { class: 'muted small', text: `Highlighted column: ${D.OS_LABEL[S.os]} (change it on the Overview). Some commands need Administrator or sudo.` }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
          h('thead', null, h('tr', null, h('th', { text: 'Security check' }), h('th', { class: col('win'), text: 'Windows (PowerShell)' }), h('th', { class: col('mac'), text: 'macOS (Terminal)' }), h('th', { class: col('linux'), text: 'Linux (Bash)' }))),
          h('tbody', null, D.MATRIX.map((m) => h('tr', null, h('td', null, h('b', { text: m.name })),
            ['win', 'mac', 'linux'].map((k) => h('td', { class: col(k) }, h('div', { class: 'cmd tight' }, h('code', { text: m[k] }), h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Copy ${m.name} command for ${D.OS_LABEL[k]}`, text: 'Copy', onclick: () => copyText(m[k], 'Command copied') })))))))))),
      h('div', { class: 'card' }, h('h2', { text: 'One-click evidence collectors' }),
        h('p', { class: 'muted', text: 'Each script runs the read-only checks for one OS and saves a text file you can paste from. Read a script before you run it. That is good audit practice.' }),
        h('div', { class: 'scripts' }, [['win', 'audit-windows.ps1', 'Run in PowerShell. Use "Run as Administrator" for BitLocker and SMBv1 results.'], ['mac', 'audit-macos.sh', 'Run with: bash audit-macos.sh. A few sections ask for your password.'], ['linux', 'audit-linux.sh', 'Run with: bash audit-linux.sh. Some sections need sudo.']].map(([k, f, note]) =>
          h('div', { class: 'script ' + col(k) }, h('b', { text: D.OS_LABEL[k] }), h('code', { text: f }), h('span', { class: 'muted small', text: note }),
            h('a', { class: 'btn btn-sm', href: 'scripts/' + f, download: f, text: 'Download' }))))),
      h('div', { class: 'card' }, h('h2', { text: 'The auditor\'s eye' }),
        h('p', { class: 'muted', text: 'A tool can tell you a port is open. Only you can decide whether that port is a business need or a dangerous exception. Paste evidence into each failed check, then explain your judgement in the report.' })));
  }

  /* --------------------------------------------------------------- report */
  function renderReport() {
    const root = clear($('#v-report'));
    root.append(h('div', { class: 'intro no-print' }, h('h1', { text: 'One-page vulnerability report' }),
      h('p', { class: 'muted lead', text: 'Diagnosis, treatment, proof. Select the flaws to include, describe the fixes and paste the terminal output that shows the hardened state.' })),
      h('div', { class: 'rep-layout' }, h('div', { class: 'rep-form no-print', id: 'rep-form' }), h('div', { id: 'paper-wrap' }, h('article', { class: 'paper', id: 'paper' }))));
    renderReportForm(); renderPaper();
  }

  function renderReportForm() {
    const f = clear($('#rep-form'));
    const findings = A.findings(S);
    const included = new Set(A.reportFlaws(S).map((x) => x.check.id));

    f.append(h('div', { class: 'card', id: 'rep-valid' }));
    updateValidation();

    f.append(h('div', { class: 'card stack', style: '--gap:.75rem' }, h('h2', { text: 'Section 1 & 2 · Flaws and fixes' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Tick the flaws for the one-page report (at least three are required). Evidence and fixes are shared with the Checklist.' }),
      !findings.length ? h('p', { class: 'empty-state', text: 'No failed checks yet. Mark checks as Fail in the Checklist and they will appear here.' }) : null,
      findings.map((x) => {
        const it = item(x.check.id);
        return h('div', { class: 'flaw' },
          h('div', { class: 'flaw-head' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: included.has(x.check.id), onchange: (e) => { const cur = new Set(A.reportFlaws(S).map((y) => y.check.id)); if (e.target.checked) cur.add(x.check.id); else cur.delete(x.check.id); S.report.include = Array.from(cur); persist(); updateValidation(); renderPaper(); } }), h('b', { text: x.check.title })),
            sevChip(x.score)),
          h('textarea', { rows: '2', class: 'mono small', 'aria-label': `Evidence for ${x.check.title}`, placeholder: 'Evidence: command output or observation', oninput: (e) => { item(x.check.id).evidence = e.target.value; persist(); renderPaper(); } }, it.evidence || ''),
          h('textarea', { rows: '2', 'aria-label': `Fix for ${x.check.title}`, placeholder: 'Fix applied: ' + x.check.fix, oninput: (e) => { item(x.check.id).action = e.target.value; persist(); updateValidation(); renderPaper(); } }, it.action || ''),
          h('label', { class: 'check fixed' }, h('input', { type: 'checkbox', checked: !!it.fixed, onchange: (e) => { const cur = item(x.check.id); if (e.target.checked) cur.fixed = true; else delete cur.fixed; persist(); updateValidation(); renderPaper(); updateChrome(); } }), 'Fixed and re-tested'));
      })));
    $$('#rep-form .flaw textarea').forEach((t) => { /* values set via children text; ensure exact */ });
    $$('#rep-form .flaw').forEach((el, i) => { const it = item(findings[i].check.id); const ts = $$('textarea', el); ts[0].value = it.evidence || ''; ts[1].value = it.action || ''; });

    const ver = h('textarea', { id: 'verif', rows: '7', class: 'mono small', placeholder: 'Paste the final terminal outputs, e.g.\n[OK] FileVault is On.\nSystem Integrity Protection status: enabled.\nGet-NetFirewallProfile → Enabled : True', oninput: (e) => { S.report.verification = e.target.value; persist(); updateValidation(); renderPaper(); } });
    ver.value = S.report.verification || '';
    f.append(h('div', { class: 'card stack', style: '--gap:.6rem' }, h('h2', { text: 'Section 3 · Hardened verification' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Re-run the checks after fixing and paste the outputs that prove a secure state.' }), ver));

    const meta = (label, key) => h('div', null, h('label', { text: label, for: 'r-' + key }), h('input', { id: 'r-' + key, type: key === 'date' ? 'date' : 'text', value: S.meta[key], maxlength: '120', oninput: (e) => { S.meta[key] = e.target.value; persist(); updateValidation(); renderPaper(); } }));
    f.append(h('div', { class: 'card' }, h('h2', { text: 'Report details' }), h('div', { class: 'meta-grid' }, meta('Auditor', 'auditor'), meta('Device', 'device'), meta('OS version', 'osVersion'), meta('Date', 'date'))));

    f.append(h('div', { class: 'card' }, h('h2', { text: 'Export' }), h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Print / Save as PDF', onclick: () => window.print() }),
      h('button', { class: 'btn', type: 'button', text: 'Copy Markdown', onclick: () => copyText(A.buildMarkdown(S), 'Report copied as Markdown') }),
      h('button', { class: 'btn', type: 'button', text: 'Download .md', onclick: () => download('vulnerability-report.md', A.buildMarkdown(S)) })),
      h('p', { class: 'hint', text: 'In the print dialog choose "Save as PDF" and turn off headers and footers for the cleanest page.' })));
  }

  function updateValidation() {
    const box = $('#rep-valid'); if (!box) return; clear(box);
    const v = A.validateReport(S);
    box.className = 'card valid ' + (v.ok ? 'ok' : 'todo');
    box.append(h('h2', { text: v.ok ? 'Ready to submit' : 'Before you submit' }));
    if (v.ok) box.append(h('p', { style: 'margin:0', text: 'The report meets the deliverable rules: three or more flaws, remediation described, and proof of the hardened state.' }));
    else box.append(h('ul', { class: 'plain' }, v.problems.map((p) => h('li', { text: p }))));
  }

  function renderPaper() {
    const p = $('#paper'); if (!p) return; clear(p);
    const s = A.summarize(S); const flaws = A.reportFlaws(S); const m = S.meta;
    p.append(h('header', { class: 'paper-head' }, h('h2', { text: 'Vulnerability Report' }),
      h('dl', { class: 'paper-meta' },
        h('div', null, h('dt', { text: 'Device' }), h('dd', { text: m.device || '—' })),
        h('div', null, h('dt', { text: 'Operating system' }), h('dd', { text: D.OS_LABEL[S.os] + (m.osVersion ? ' ' + m.osVersion : '') })),
        h('div', null, h('dt', { text: 'Auditor' }), h('dd', { text: m.auditor || '—' })),
        h('div', null, h('dt', { text: 'Date' }), h('dd', { text: m.date || '—' })))));
    if (s.after != null) p.append(h('p', { class: 'paper-score' }, 'Security posture: ', h('b', { text: `${s.before}/100` }), ' before remediation → ', h('b', { text: `${s.after}/100 (grade ${s.grade})` }), ` after. ${s.counts.pass} passed, ${s.counts.fail} failed (${s.counts.fixed} fixed), ${s.counts.na} n/a. Coverage ${s.coverage}%.`));

    p.append(h('h3', { text: '1. Flaws found (the diagnosis)' }));
    if (!flaws.length) p.append(h('p', { class: 'paper-empty', text: 'No flaws selected yet.' }));
    else p.append(h('table', { class: 'paper-table' }, h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Flaw' }), h('th', { text: 'Severity' }), h('th', { text: 'Evidence' }))),
      h('tbody', null, flaws.map((x, i) => h('tr', null, h('td', { text: String(i + 1) }), h('td', { text: x.check.title }), h('td', null, sevChip(x.score)), h('td', { class: 'ev', text: clip(x.item.evidence || x.check.why, 170) }))))));

    p.append(h('h3', { text: '2. Remediation actions (the treatment)' }));
    if (!flaws.length) p.append(h('p', { class: 'paper-empty', text: 'None yet.' }));
    else p.append(h('ol', { class: 'paper-list' }, flaws.map((x) => h('li', null, h('b', { text: x.check.title }), ' ', h('span', { class: 'badge ' + (x.fixed ? 'ok' : 'warn'), text: x.fixed ? 'fixed' : 'open' }), ' ', clip((x.item.action || x.check.fix).trim(), 220)))));

    p.append(h('h3', { text: '3. Hardened verification (the proof)' }));
    const v = (S.report.verification || '').trim();
    p.append(v ? h('pre', { class: 'paper-pre', text: clip(v, 900) }) : h('p', { class: 'paper-empty', text: 'Paste the terminal output that proves the fix.' }));

    const open = A.findings(S).filter((x) => !x.fixed);
    if (open.length) p.append(h('p', { class: 'paper-rem' }, h('b', { text: 'Remaining risks: ' }), open.map((x) => `${x.check.title} (${x.score.toFixed(1)} ${x.band.label})`).join('; ')));
    p.append(h('p', { class: 'paper-note', text: 'Severity values are indicative CVSS-style ratings (Critical 9.0–10, High 7.0–8.9, Medium 4.0–6.9, Low 0.1–3.9), not calculated vectors.' }));
  }
  const clip = (t, n) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ------------------------------------------------------------------ init */
  updateChrome();
  show(location.hash.slice(1));
})();
