'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/js/checks.js');
const A = require('../assets/js/scoring.js');

const fresh = (os = 'win') => { const s = A.defaultState(); s.os = os; return s; };

test('CVSS qualitative bands match the brief', () => {
  assert.equal(A.band(10).id, 'critical'); assert.equal(A.band(9.0).id, 'critical');
  assert.equal(A.band(8.9).id, 'high');    assert.equal(A.band(7.0).id, 'high');
  assert.equal(A.band(6.9).id, 'medium');  assert.equal(A.band(4.0).id, 'medium');
  assert.equal(A.band(3.9).id, 'low');     assert.equal(A.band(0.1).id, 'low');
});

test('checklist data is well-formed', () => {
  const ids = new Set();
  for (const c of D.CHECKS) {
    assert.ok(!ids.has(c.id), 'duplicate id ' + c.id); ids.add(c.id);
    assert.ok(D.STEPS.some((s) => s.id === c.step), c.id);
    assert.ok(c.score > 0 && c.score <= 10, c.id);
    assert.ok(c.q && c.why && c.fix && c.how && c.refs.length, c.id);
    assert.ok(c.os.length && c.os.every((o) => ['win', 'mac', 'linux'].includes(o)), c.id);
    if (c.cmd) for (const k of Object.keys(c.cmd)) assert.ok(c.os.includes(k), `${c.id} has a ${k} command but is not a ${k} check`);
  }
  assert.ok(D.CHECKS.length >= 30);
});

test('every check applies to at least one OS and each OS has all four steps', () => {
  for (const os of ['win', 'mac', 'linux']) {
    const steps = new Set(A.applicable(os).map((c) => c.step));
    for (const s of ['identity', 'patch', 'human', 'network']) assert.ok(steps.has(s), os + ' ' + s);
  }
});

test('commands are read-only (no destructive verbs)', () => {
  const bad = /\b(rm|del|format|Remove-|Set-|Disable-|Enable-|Install-|Uninstall-|kill|Stop-|chmod|chown|mkfs|dd|shutdown|reboot|sudo (?:ufw|systemsetup) (?:enable|disable|-setremotelogin))\b/i;
  const scan = (s) => s && assert.ok(!bad.test(s), 'unsafe command: ' + s);
  D.CHECKS.forEach((c) => c.cmd && Object.values(c.cmd).forEach(scan));
  D.MATRIX.forEach((m) => ['win', 'mac', 'linux'].forEach((o) => scan(m[o])));
  D.BASELINE.forEach((b) => Object.values(b.cmd).forEach(scan));
});

test('posture score is severity-weighted', () => {
  const s = fresh();
  const w = A.applicable('win').filter((c) => ['nw-fw', 'id-mfa'].includes(c.id));
  s.items['nw-fw'] = { state: 'pass' }; s.items['id-mfa'] = { state: 'fail' };
  const sum = A.summarize(s);
  const fw = w.find((c) => c.id === 'nw-fw').score, mfa = w.find((c) => c.id === 'id-mfa').score;
  assert.equal(sum.before, Math.round((fw / (fw + mfa)) * 100));
  assert.equal(sum.counts.pass, 1); assert.equal(sum.counts.fail, 1);
});

test('N/A and unchecked items do not affect the score', () => {
  const s = fresh(); s.items['nw-fw'] = { state: 'pass' }; s.items['id-mfa'] = { state: 'na' };
  const sum = A.summarize(s);
  assert.equal(sum.before, 100); assert.equal(sum.counts.na, 1);
});

test('remediation lifts "after" but not "before"', () => {
  const s = fresh(); s.items['nw-fw'] = { state: 'pass' }; s.items['nw-fde'] = { state: 'fail', fixed: true };
  const sum = A.summarize(s);
  assert.ok(sum.after > sum.before); assert.equal(sum.after, 100); assert.equal(sum.grade, 'A');
  assert.equal(sum.counts.fixed, 1); assert.equal(sum.exposure, 0);
});

test('empty audit has no score and zero coverage', () => {
  const sum = A.summarize(fresh());
  assert.equal(sum.before, null); assert.equal(sum.coverage, 0); assert.equal(sum.grade, null);
});

test('OS filtering: macOS stealth mode and Windows SMBv1', () => {
  assert.ok(A.applicable('mac').some((c) => c.id === 'nw-stealth'));
  assert.ok(!A.applicable('win').some((c) => c.id === 'nw-stealth'));
  assert.ok(A.applicable('win').some((c) => c.id === 'pt-smb1'));
  assert.ok(!A.applicable('linux').some((c) => c.id === 'pt-av'));
});

test('severity adjustment is clamped and moves the band', () => {
  const c = D.CHECKS.find((x) => x.id === 'id-defaults');
  assert.equal(A.effectiveScore(c, { adj: 1 }), 10);
  assert.equal(A.effectiveScore(c, { adj: -1 }), 8.1);
  assert.equal(A.band(A.effectiveScore(c, { adj: -1 })).id, 'high');
});

test('findings are sorted by severity and roadmap excludes fixed items', () => {
  const s = fresh();
  s.items['id-defaults'] = { state: 'fail' }; s.items['pt-old'] = { state: 'fail' }; s.items['nw-fw'] = { state: 'fail', fixed: true };
  const f = A.findings(s);
  assert.equal(f[0].check.id, 'id-defaults'); assert.equal(f[f.length - 1].check.id, 'pt-old');
  const rm = A.roadmap(s);
  assert.equal(rm.find((g) => g.band.id === 'critical').items.length, 1);
  assert.equal(rm.flatMap((g) => g.items).some((x) => x.check.id === 'nw-fw'), false);
});

test('report validation enforces the deliverable rules', () => {
  const s = fresh(); s.meta.auditor = 'Sam';
  assert.equal(A.validateReport(s).ok, false);
  ['id-defaults', 'nw-fw', 'nw-fde'].forEach((id) => { s.items[id] = { state: 'fail', fixed: true, action: 'Did the fix' }; });
  let v = A.validateReport(s);
  assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /Section 3/.test(p)));
  s.report.verification = 'FileVault is On.';
  v = A.validateReport(s);
  assert.equal(v.ok, true, v.problems.join('|'));
});

test('markdown report contains all three sections and escapes table pipes', () => {
  const s = fresh(); s.meta.auditor = 'Sam'; s.meta.device = 'Laptop';
  s.items['nw-fw'] = { state: 'fail', fixed: true, action: 'Enabled the firewall', evidence: 'Enabled | False' };
  s.report.verification = 'Enabled : True';
  const md = A.buildMarkdown(s);
  for (const h of ['## 1. Flaws found', '## 2. Remediation actions', '## 3. Hardened verification']) assert.ok(md.includes(h), h);
  assert.ok(md.includes('Enabled \\| False')); assert.ok(md.includes('Enabled : True'));
  assert.ok(md.includes('7.5 High'));
});

test('report selection overrides the default top five', () => {
  const s = fresh();
  ['id-defaults', 'pt-eol', 'id-admin', 'nw-remote', 'nw-fde', 'hu-least'].forEach((id) => { s.items[id] = { state: 'fail' }; });
  assert.equal(A.reportFlaws(s).length, 5);
  s.report.include = ['hu-least'];
  assert.deepEqual(A.reportFlaws(s).map((f) => f.check.id), ['hu-least']);
});
