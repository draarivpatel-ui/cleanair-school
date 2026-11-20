import test from 'node:test';
import assert from 'node:assert/strict';
import { pm25ToAqi2024, EPA_PM25_2024_BREAKPOINTS } from '../js/air-engine.mjs';
import { EPA_BREAKPOINT_CASES } from '../js/scenarios.mjs';

test('AQI: all 13 canonical EPA 2024 breakpoint cases remain exact', () => {
  assert.equal(EPA_BREAKPOINT_CASES.length, 13);
  for (const c of EPA_BREAKPOINT_CASES) {
    const out = pm25ToAqi2024(c.pm25);
    assert.equal(out.aqi, c.expectedAqi, `AQI at ${c.pm25}`);
    assert.equal(out.category, c.expectedCategory, `category at ${c.pm25}`);
    assert.equal(Boolean(out.beyondIndex), Boolean(c.expectedBeyondIndex), `beyondIndex at ${c.pm25}`);
  }
});

test('AQI: breakpoints table has six tiers in ascending order', () => {
  assert.equal(EPA_PM25_2024_BREAKPOINTS.length, 6);
  for (let i = 1; i < EPA_PM25_2024_BREAKPOINTS.length; i++) {
    assert.ok(EPA_PM25_2024_BREAKPOINTS[i].cLow > EPA_PM25_2024_BREAKPOINTS[i - 1].cHigh);
  }
  assert.equal(EPA_PM25_2024_BREAKPOINTS[0].cLow, 0);
  assert.equal(EPA_PM25_2024_BREAKPOINTS[5].cHigh, 325.4);
});

test('AQI: midpoint of a band maps to the midpoint AQI', () => {
  assert.equal(pm25ToAqi2024(4.5).aqi, 25);
  assert.equal(pm25ToAqi2024(22.25).aqi, 75);
  assert.equal(pm25ToAqi2024(90.45).aqi, 175);
  assert.equal(pm25ToAqi2024(175.45).aqi, 250);
  assert.equal(pm25ToAqi2024(275.45).aqi, 400);
});

test('AQI: negative, NaN, null, undefined, and string-non-numeric inputs are safe zeros', () => {
  for (const bad of [-1, -100, NaN, null, undefined, '', 'abc', {}, []]) {
    const out = pm25ToAqi2024(bad);
    assert.equal(out.aqi, 0, `bad input ${String(bad)}`);
    assert.equal(out.pm25, 0);
    assert.equal(out.inputValid, false);
    assert.equal(out.beyondIndex, false);
  }
});

test('AQI: Infinity and -Infinity never leak into results', () => {
  for (const bad of [Infinity, -Infinity]) {
    const out = pm25ToAqi2024(bad);
    assert.ok(Number.isFinite(out.pm25));
    assert.ok(Number.isFinite(out.aqi));
    assert.equal(out.inputValid, false);
  }
});

test('AQI: concentrations above 325.4 are Beyond Index and capped at AQI 500', () => {
  for (const c of [325.5, 400, 500, 1000, 1e9]) {
    const out = pm25ToAqi2024(c);
    assert.equal(out.aqi, 500);
    assert.equal(out.beyondIndex, true);
    assert.equal(out.category, 'Hazardous (Beyond Index)');
    assert.equal(out.inputValid, true);
  }
});

test('AQI: 0.1 ug/m3 truncation is EPA conformant at band edges', () => {
  assert.equal(pm25ToAqi2024(9.099).pm25, 9.0);
  assert.equal(pm25ToAqi2024(35.499).pm25, 35.4);
  assert.equal(pm25ToAqi2024(225.499).pm25, 225.4);
  assert.equal(pm25ToAqi2024(9.099).aqi, 50);
  assert.equal(pm25ToAqi2024(35.499).aqi, 100);
});

test('AQI: numeric string inputs are coerced', () => {
  assert.equal(pm25ToAqi2024('9.1').aqi, 51);
  assert.equal(pm25ToAqi2024('325.5').beyondIndex, true);
  assert.equal(pm25ToAqi2024('35.4').aqi, 100);
});

test('AQI: category colors are stable across tiers', () => {
  assert.equal(pm25ToAqi2024(5).color, '#15803d');
  assert.equal(pm25ToAqi2024(20).color, '#ca8a04');
  assert.equal(pm25ToAqi2024(40).color, '#ea580c');
  assert.equal(pm25ToAqi2024(90).color, '#dc2626');
  assert.equal(pm25ToAqi2024(150).color, '#7e22ce');
  assert.equal(pm25ToAqi2024(250).color, '#7f1d1d');
});

test('AQI: keys are stable tier identifiers', () => {
  const keys = EPA_BREAKPOINT_CASES.slice(0, 12).map((c) => pm25ToAqi2024(c.pm25).key);
  assert.deepEqual(keys, ['good', 'good', 'moderate', 'moderate', 'usg', 'usg', 'unhealthy', 'unhealthy', 'very_unhealthy', 'very_unhealthy', 'hazardous', 'hazardous']);
});

test('AQI: monotonic nondecreasing response across a dense sweep', () => {
  let last = -1;
  for (let c = 0; c <= 500; c += 0.25) {
    const aqi = pm25ToAqi2024(c).aqi;
    assert.ok(aqi >= last, `AQI decreased at concentration ${c}`);
    last = aqi;
  }
});

test('AQI: extreme valid concentration is clamped to a finite pm25 field', () => {
  const out = pm25ToAqi2024(1e12);
  assert.ok(Number.isFinite(out.pm25));
  assert.ok(out.pm25 <= 1e6);
  assert.equal(out.beyondIndex, true);
});
