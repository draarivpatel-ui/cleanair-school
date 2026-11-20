import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pm25ToAqi2024, computeEpaNowCast, evaluateClassroomAir, buildSchoolGuidance,
  compareCleanerOptions, schoolBudgetProjection, portableCadrWithDerates,
  filterLifecycle, CLEANER_CATALOG, EPA_PM25_2024_BREAKPOINTS,
} from '../js/air-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// WCAG relative luminance + contrast helpers for chip-palette checks.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('wave2: evaluateClassroomAir never throws on null or non-object input', () => {
  for (const bad of [null, undefined, 'x', 5, true]) {
    const r = evaluateClassroomAir(bad);
    assert.equal(typeof r, 'object');
    assert.ok(Number.isFinite(r.volumeFt3));
    assert.ok(Number.isFinite(r.steadyStatePm25));
  }
});

test('wave2: buildSchoolGuidance never throws on null arguments', () => {
  const g = buildSchoolGuidance(null, null);
  assert.equal(typeof g.alertLevel, 'string');
  assert.equal(g.alertLevel, 'GREEN');
  assert.ok(g.enNotice.length > 10);
  const g2 = buildSchoolGuidance(undefined, evaluateClassroomAir({}));
  assert.equal(g2.alertLevel, 'GREEN');
});

test('wave2: Hazardous AQI (301+) is labeled MAROON, not PURPLE', () => {
  const room = evaluateClassroomAir({});
  for (const c of [225.5, 250, 300, 325.4, 500]) {
    const g = buildSchoolGuidance(pm25ToAqi2024(c), room);
    assert.equal(g.alertLevel, 'MAROON', `pm25=${c} aqi=${pm25ToAqi2024(c).aqi}`);
    assert.match(g.enNotice, /MAROON/);
  }
  const purple = buildSchoolGuidance(pm25ToAqi2024(150), room);
  assert.equal(pm25ToAqi2024(150).aqi, 225);
  assert.equal(purple.alertLevel, 'PURPLE');
});

test('wave2: unitsFor5Ach under derates recommends a count that actually meets 5 ACH', () => {
  const room = { lengthFt: 30, widthFt: 28, heightFt: 10, hvacAch: 6.5, mervRating: 'merv8', cleanerId: 'classroom_hepa', applyDerates: true, outdoorPm25: 50 };
  const r = evaluateClassroomAir({ ...room, cleanerCount: 0 });
  assert.equal(r.unitsFor5Ach, 3);
  const two = evaluateClassroomAir({ ...room, cleanerCount: 2 });
  const three = evaluateClassroomAir({ ...room, cleanerCount: 3 });
  assert.equal(two.meets5Ach, false);
  assert.equal(three.meets5Ach, true);
});

test('wave2: unitsFor5Ach without derates keeps the canonical nameplate estimate', () => {
  const room = { lengthFt: 30, widthFt: 28, heightFt: 10, hvacAch: 6.5, mervRating: 'merv8', cleanerId: 'classroom_hepa', outdoorPm25: 50 };
  const r = evaluateClassroomAir({ ...room, cleanerCount: 0 });
  assert.equal(r.unitsFor5Ach, 2);
});

test('wave2: derated unitsFor5Ach accounts for filter loading', () => {
  const room = { lengthFt: 30, widthFt: 28, heightFt: 10, hvacAch: 1, mervRating: 'merv13', cleanerId: 'corsi_box', applyDerates: true, outdoorPm25: 50 };
  const fresh = evaluateClassroomAir({ ...room, cleanerCount: 0, daysSinceReplacement: 0 });
  const loaded = evaluateClassroomAir({ ...room, cleanerCount: 0, daysSinceReplacement: 90 });
  assert.ok(loaded.unitsFor5Ach >= fresh.unitsFor5Ach);
  const check = evaluateClassroomAir({ ...room, cleanerCount: loaded.unitsFor5Ach, daysSinceReplacement: 90 });
  assert.equal(check.meets5Ach, true);
});

test('wave2: whitespace-only AQI input is invalid, not a valid zero', () => {
  for (const s of [' ', '   ', '  \t  ']) {
    const out = pm25ToAqi2024(s);
    assert.equal(out.inputValid, false);
    assert.equal(out.aqi, 0);
  }
});

test('wave2: EPA truncation matches idealized decimal truncation on a dense sweep', () => {
  for (let i = 0; i <= 4000; i += 7) {
    const x = i / 1000;
    const ideal = Math.floor(parseFloat(x.toFixed(3)) * 10) / 10;
    const out = pm25ToAqi2024(x);
    assert.ok(Math.abs(out.pm25 - ideal) < 1e-9, `truncation mismatch at ${x}: ${out.pm25} vs ${ideal}`);
  }
});

test('wave2: sub-edge truncations land in the correct tier', () => {
  assert.equal(pm25ToAqi2024(9.05).aqi, 50);
  assert.equal(pm25ToAqi2024(55.45).aqi, 150);
  assert.equal(pm25ToAqi2024(125.45).aqi, 200);
  assert.equal(pm25ToAqi2024(225.45).aqi, 300);
  assert.equal(pm25ToAqi2024(9.049).aqi, 50);
  assert.equal(pm25ToAqi2024(55.55).aqi, 151);
});

test('wave2: trajectory AQI is consistent with the displayed (rounded) PM2.5', () => {
  const r = evaluateClassroomAir({ lengthFt: 30, widthFt: 28, heightFt: 10, outdoorPm25: 100, initialIndoorPm25: 80, hvacAch: 3, mervRating: 'merv13', cleanerId: 'corsi_box', cleanerCount: 2 });
  for (const p of r.trajectory) {
    assert.equal(p.indoorAqi, pm25ToAqi2024(p.indoorPm25).aqi, `minute ${p.minute}`);
  }
});

test('wave2: NowCast treats blank entries as missing hours, changing the value vs packed input', () => {
  const sparse = computeEpaNowCast([12, null, 14, 16]);
  const packed = computeEpaNowCast([12, 14, 16]);
  assert.notEqual(sparse.nowCastPm25, packed.nowCastPm25);
  assert.equal(sparse.nowCastPm25, 14.5);
  assert.equal(packed.nowCastPm25, 14.3);
});

test('wave2: utility functions tolerate null arguments', () => {
  assert.equal(portableCadrWithDerates(null, 3, 0).effectiveCfm, 0);
  assert.equal(filterLifecycle(null, 100).replacementDue, false);
  assert.equal(schoolBudgetProjection(null).classroomCount, 1);
  const rows = compareCleanerOptions(null);
  assert.equal(rows.length, 4);
});

test('wave2: every EPA tier ships a chip palette at or above 4.5:1 contrast', () => {
  for (const bp of EPA_PM25_2024_BREAKPOINTS) {
    assert.ok(contrast(bp.chipText, bp.chipBg) >= 4.5, `${bp.key} chip ${contrast(bp.chipText, bp.chipBg).toFixed(2)}`);
    const out = pm25ToAqi2024((bp.cLow + bp.cHigh) / 2);
    assert.equal(out.chipBg, bp.chipBg);
    assert.equal(out.chipText, bp.chipText);
  }
});

test('wave2-dom: decay chart has a readout element and hover wiring', () => {
  assert.match(html, /id="decay-readout"/);
  assert.match(appJs, /addEventListener\('pointermove'/);
  assert.match(appJs, /addEventListener\('pointerleave'/);
  assert.match(appJs, /data-hover-layer/);
  assert.match(appJs, /data-hit-layer/);
  assert.match(appJs, /<title>|svgEl\(ns, 'title'/);
});

test('wave2-dom: hourly field has no decimal-only keyboard mode and label documents blanks', () => {
  const field = html.match(/<input id="hourly-input"[^>]*>/)[0];
  assert.equal(/inputmode="decimal"/.test(field), false);
  assert.match(html, /blanks count as missing/);
});

test('wave2-dom: app preserves blank hourly entries as missing hours and warns', () => {
  assert.match(appJs, /if \(t === ''\) return null/);
  assert.match(appJs, /count as missing hours/);
  assert.match(appJs, /at least 2 valid PM2\.5 numbers/);
});

test('wave2-dom: preset changes refresh the hero status line', () => {
  const idx = appJs.indexOf("els.presetSelect.addEventListener('change'");
  assert.match(appJs, /if \(!state\.demoActive\)[\s\S]*heroStatus\.textContent/);
  assert.ok(idx >= 0);
});

test('wave2-dom: blank results clear stale hero, badge, and compare output', () => {
  const fn = appJs.slice(appJs.indexOf('function blankResults'), appJs.indexOf('function recompute'));
  assert.match(fn, /heroCat\.textContent = ''/);
  assert.match(fn, /compareBars\.textContent = ''/);
  assert.match(fn, /alertBadge\.style\.(color|background) = ''/);
});

test('wave2-dom: hero category is rendered as a contrast-safe chip', () => {
  assert.match(html, /id="hero-cat" class="hero-chip"/);
  assert.match(appJs, /heroCat\.style\.background = nowCast\.chipBg/);
  assert.match(appJs, /alertBadge\.style\.background = nowCast\.chipBg/);
});

test('wave2-dom: connector glyph is an arrow, not a rotated word', () => {
  const arrow = html.match(/<div class="hero-arrow"[^>]*>([^<]+)<\/div>/)[1];
  assert.ok(arrow.includes('&#8594;') || arrow.includes('\u2192'), arrow);
  assert.match(css, /\.hero-arrow[^}]*rotate|hero-arrow \{[^}]*font-size:\s*1\.5rem/s);
});

test('wave2-dom: badge text cannot wrap mid-alert', () => {
  assert.match(css, /\.badge\s*\{[^}]*white-space:\s*nowrap/s);
});

test('wave2-dom: link-styled buttons are not underlined', () => {
  assert.match(css, /\.btn\s*\{[^}]*text-decoration:\s*none/s);
});

test('wave2-dom: mobile compare rows stack caption over bar and value', () => {
  assert.match(css, /\.compare-caption\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(css, /\.compare-value\s*\{[^}]*white-space:\s*nowrap/s);
});

test('wave2-dom: export payload version matches package version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(appJs, new RegExp(`version: '${pkg.version.replace('.', '\\.')}'`));
});

test('wave2-dom: filter age shows a hint when derates are off and due when due', () => {
  assert.match(appJs, /Filter age has no effect until real-world derates are enabled/);
  assert.match(appJs, /Filter replacement is due/);
});

test('wave2-dom: page ships a meta description', () => {
  assert.match(html, /<meta name="description" content="[^"]{50,}">/);
});

test('wave2: zero-outdoor KPI copy avoids a -0% display', () => {
  assert.match(appJs, /no outdoor PM2\.5/);
});

test('wave2: compare caption documents effective CADR scaling', () => {
  assert.match(html, /effective CADR against the strongest option/);
});

test('wave2: budget note discloses the none-selected CR reference', () => {
  assert.match(appJs, /No cleaner selected above; shown as a Corsi-Rosenthal reference/);
});
