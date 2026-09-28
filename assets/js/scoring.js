/*!
 * Audit Desk — scoring, risk banding and report generation (pure logic, no DOM).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./checks.js'));
  else root.AuditCore = factory(root.AuditData);
})(typeof self !== 'undefined' ? self : this, function (Data) {
  'use strict';

  const { CHECKS, STEPS, OS_LABEL } = Data;

  const BANDS = [
    { id: 'critical', label: 'Critical', min: 9.0, plan: 'Fix now' },
    { id: 'high', label: 'High', min: 7.0, plan: 'This week' },
    { id: 'medium', label: 'Medium', min: 4.0, plan: 'This month' },
    { id: 'low', label: 'Low', min: 0.1, plan: 'Backlog' },
  ];

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const round1 = (n) => Math.round(n * 10) / 10;

  /** CVSS qualitative rating for a 0–10 score. */
  function band(score) {
    return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
  }

  function defaultState() {
    return {
      os: 'win',
      meta: { auditor: '', device: '', osVersion: '', date: new Date().toISOString().slice(0, 10) },
      baseline: {},
      items: {},
      report: { include: null, verification: '' },
    };
  }

  const itemOf = (state, id) => (state.items && state.items[id]) || {};

  /** Severity after the user's contextual adjustment (−1 / 0 / +1). */
  function effectiveScore(check, item) {
    const adj = Number(item && item.adj) || 0;
    return round1(clamp(check.score + adj, 0.1, 10));
  }

  function applicable(os) {
    return CHECKS.filter((c) => c.os.includes(os));
  }

  /**
   * Posture summary. `before` treats remediated findings as still failing;
   * `after` counts them as fixed. Both are severity-weighted percentages.
   */
  function summarize(state) {
    const checks = applicable(state.os);
    const counts = { pass: 0, fail: 0, na: 0, todo: 0, fixed: 0 };
    let passW = 0; let assessedW = 0; let fixedW = 0; let failW = 0;
    const byStep = {};
    STEPS.filter((s) => s.id !== 'baseline').forEach((s) => { byStep[s.id] = { total: 0, done: 0, fail: 0 }; });

    checks.forEach((c) => {
      const it = itemOf(state, c.id);
      const st = it.state || 'todo';
      const w = effectiveScore(c, it);
      byStep[c.step].total++;
      if (st === 'todo') { counts.todo++; return; }
      byStep[c.step].done++;
      if (st === 'na') { counts.na++; return; }
      assessedW += w;
      if (st === 'pass') { counts.pass++; passW += w; return; }
      counts.fail++; byStep[c.step].fail++; failW += w;
      if (it.fixed) { counts.fixed++; fixedW += w; }
    });

    const pct = (x) => (assessedW ? Math.round((x / assessedW) * 100) : null);
    const before = pct(passW);
    const after = pct(passW + fixedW);
    const assessed = counts.pass + counts.fail;
    const total = checks.length;
    const grade = after == null ? null : after >= 90 ? 'A' : after >= 80 ? 'B' : after >= 70 ? 'C' : after >= 60 ? 'D' : 'F';
    return {
      counts, total, assessed, before, after, grade,
      coverage: total ? Math.round(((total - counts.todo) / total) * 100) : 0,
      exposure: round1(failW - fixedW), exposureBefore: round1(failW), byStep,
    };
  }

  /** All failed checks, highest severity first. */
  function findings(state) {
    return applicable(state.os)
      .map((check) => ({ check, item: itemOf(state, check.id) }))
      .filter((f) => f.item.state === 'fail')
      .map((f) => { const score = effectiveScore(f.check, f.item); return { ...f, score, band: band(score), fixed: !!f.item.fixed }; })
      .sort((a, b) => b.score - a.score || a.check.title.localeCompare(b.check.title));
  }

  /** Group open (not yet remediated) findings into a time-boxed roadmap. */
  function roadmap(state) {
    const open = findings(state).filter((f) => !f.fixed);
    return BANDS.map((b) => ({ band: b, items: open.filter((f) => f.band.id === b.id) }));
  }

  /** Findings that go into the one-page report (user selection, else top five). */
  function reportFlaws(state) {
    const all = findings(state);
    const inc = state.report && state.report.include;
    if (Array.isArray(inc)) return all.filter((f) => inc.includes(f.check.id));
    return all.slice(0, 5);
  }

  /** Check the report against the deliverable rules in the project brief. */
  function validateReport(state) {
    const flaws = reportFlaws(state);
    const problems = [];
    if (flaws.length < 3) problems.push(`Document at least 3 flaws (you have ${flaws.length}).`);
    const noAction = flaws.filter((f) => !(f.item.action || '').trim());
    if (flaws.length && noAction.length) problems.push(`Describe the remediation for: ${noAction.map((f) => f.check.title).join(', ')}.`);
    const unfixed = flaws.filter((f) => !f.fixed);
    if (flaws.length && unfixed.length) problems.push(`Mark as remediated once fixed: ${unfixed.map((f) => f.check.title).join(', ')}.`);
    if (!((state.report && state.report.verification) || '').trim()) problems.push('Paste the final terminal output that proves the hardened state (Section 3).');
    if (!(state.meta.auditor || '').trim()) problems.push('Add the auditor name.');
    return { ok: problems.length === 0, problems, flawCount: flaws.length };
  }

  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

  /** Markdown version of the one-page Vulnerability Report. */
  function buildMarkdown(state) {
    const s = summarize(state);
    const flaws = reportFlaws(state);
    const m = state.meta;
    const L = [];
    L.push('# Vulnerability Report', '');
    L.push(`**Device:** ${m.device || '—'}  `, `**Operating system:** ${OS_LABEL[state.os]}${m.osVersion ? ' ' + m.osVersion : ''}  `, `**Auditor:** ${m.auditor || '—'}  `, `**Date:** ${m.date || '—'}`, '');
    if (s.after != null) {
      L.push(`**Security posture:** ${s.before}/100 before remediation → **${s.after}/100 (grade ${s.grade})** after remediation. ` +
        `${s.counts.pass} controls passed, ${s.counts.fail} failed (${s.counts.fixed} fixed), ${s.counts.na} not applicable. Coverage ${s.coverage}%.`, '');
    }
    L.push('## 1. Flaws found (the diagnosis)', '');
    if (!flaws.length) L.push('_No flaws selected._', '');
    else {
      L.push('| # | Flaw | Severity | Evidence |', '| --- | --- | --- | --- |');
      flaws.forEach((f, i) => L.push(`| ${i + 1} | ${cell(f.check.title)} | ${f.score.toFixed(1)} ${f.band.label} | ${cell(f.item.evidence || f.check.why)} |`));
      L.push('');
    }
    L.push('## 2. Remediation actions (the treatment)', '');
    if (!flaws.length) L.push('_None._', '');
    flaws.forEach((f, i) => L.push(`${i + 1}. **${f.check.title}** (${f.fixed ? 'fixed' : 'OPEN'}): ${(f.item.action || f.check.fix).trim()}`));
    if (flaws.length) L.push('');
    L.push('## 3. Hardened verification (the proof)', '');
    const v = ((state.report && state.report.verification) || '').trim();
    L.push(v ? '```text\n' + v + '\n```' : '_Paste the terminal output that proves the fix._', '');
    const open = findings(state).filter((f) => !f.fixed);
    if (open.length) {
      L.push('## Remaining risks', '');
      open.forEach((f) => L.push(`- ${f.check.title}: ${f.score.toFixed(1)} ${f.band.label} (${f.band.plan})`));
      L.push('');
    }
    L.push('---', '_Severity values are indicative ratings on the CVSS qualitative scale (Critical 9.0–10, High 7.0–8.9, Medium 4.0–6.9, Low 0.1–3.9), not calculated CVSS vectors._');
    return L.join('\n');
  }

  return { BANDS, band, defaultState, effectiveScore, applicable, summarize, findings, roadmap, reportFlaws, validateReport, buildMarkdown };
});
