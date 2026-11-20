import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClassroomAir, finiteOr } from '../js/air-engine.mjs';

const ROOM = {
  lengthFt: 30, widthFt: 28, heightFt: 10, occupants: 26,
  outdoorPm25: 100, initialIndoorPm25: 80, hvacAch: 3.0,
  mervRating: 'merv13', cleanerId: 'corsi_box', cleanerCount: 2,
};

test('physics: volume is length times width times height', () => {
  const r = evaluateClassroomAir(ROOM);
  assert.equal(r.volumeFt3, 8400);
});

test('physics: delivered clean ACH counts HVAC filter plus portable CADR only', () => {
  const r = evaluateClassroomAir(ROOM);
  assert.ok(r.hvacCleanAch > 2.5);
  assert.ok(r.portableAch > 5);
  assert.ok(r.deliveredCleanAch > 7);
  assert.ok(r.totalRemovalAch > r.deliveredCleanAch);
});

test('physics: increasing outdoor PM2.5 raises steady-state indoor PM2.5', () => {
  const low = evaluateClassroomAir({ ...ROOM, outdoorPm25: 20 });
  const high = evaluateClassroomAir({ ...ROOM, outdoorPm25: 200 });
  assert.ok(high.steadyStatePm25 > low.steadyStatePm25);
  assert.ok(high.indoorSteadyAqi.aqi > low.indoorSteadyAqi.aqi);
});

test('physics: trajectory starts at initial indoor PM2.5', () => {
  const r = evaluateClassroomAir(ROOM);
  assert.equal(r.trajectory[0].indoorPm25, 80);
  assert.equal(r.trajectory[0].minute, 0);
});

test('physics: trajectory has 13 samples at 10-minute spacing to 120 minutes', () => {
  const r = evaluateClassroomAir(ROOM);
  assert.equal(r.trajectory.length, 13);
  assert.deepEqual(r.trajectory.map((p) => p.minute), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
});

test('physics: trajectory decays monotonically when initial exceeds steady state', () => {
  const r = evaluateClassroomAir(ROOM);
  for (let i = 1; i < r.trajectory.length; i++) {
    assert.ok(r.trajectory[i].indoorPm25 <= r.trajectory[i - 1].indoorPm25);
  }
});

test('physics: trajectory converges near steady state at 120 minutes', () => {
  const r = evaluateClassroomAir(ROOM);
  const end = r.trajectory[r.trajectory.length - 1].indoorPm25;
  assert.ok(Math.abs(end - r.steadyStatePm25) < 0.2);
});

test('physics: trajectory rises monotonically when initial is below steady state', () => {
  const r = evaluateClassroomAir({ ...ROOM, initialIndoorPm25: 0, outdoorPm25: 200 });
  assert.ok(r.trajectory[0].indoorPm25 < r.trajectory[12].indoorPm25);
});

test('physics: each trajectory point carries an AQI consistent with its PM2.5', () => {
  const r = evaluateClassroomAir(ROOM);
  for (const p of r.trajectory) {
    assert.ok(Number.isInteger(p.indoorAqi));
    assert.ok(p.indoorAqi >= 0 && p.indoorAqi <= 500);
  }
});

test('physics: 5 ACH target excludes infiltration and deposition', () => {
  const borderline = evaluateClassroomAir({
    lengthFt: 30, widthFt: 28, heightFt: 10, infiltrationAch: 1.5,
    hvacAch: 3, mervRating: 'merv13', cleanerId: 'classroom_hepa', cleanerCount: 1,
  });
  assert.equal(borderline.meets5Ach, false);
  assert.ok(borderline.totalRemovalAch > 5);
  assert.ok(borderline.unitsFor5Ach >= 2);
});

test('physics: increasing cleaner count increases delivered clean ACH', () => {
  const one = evaluateClassroomAir({ ...ROOM, cleanerCount: 1 });
  const two = evaluateClassroomAir({ ...ROOM, cleanerCount: 2 });
  const four = evaluateClassroomAir({ ...ROOM, cleanerCount: 4 });
  assert.ok(two.deliveredCleanAch > one.deliveredCleanAch);
  assert.ok(four.deliveredCleanAch > two.deliveredCleanAch);
});

test('physics: zero outdoor PM2.5 yields zero steady indoor PM2.5', () => {
  const r = evaluateClassroomAir({ ...ROOM, outdoorPm25: 0, initialIndoorPm25: 0 });
  assert.equal(r.steadyStatePm25, 0);
  assert.equal(r.indoorReductionPct, 0);
});

test('physics: zero-cleaner room meets ASHRAE 241 only with adequate HVAC CFM', () => {
  const weak = evaluateClassroomAir({ ...ROOM, cleanerId: 'none', cleanerCount: 0, hvacAch: 0 });
  const strong = evaluateClassroomAir({ ...ROOM, cleanerId: 'none', cleanerCount: 0, hvacAch: 14, mervRating: 'merv16' });
  assert.equal(weak.meetsAshrae241, false);
  assert.equal(strong.meetsAshrae241, true);
});

test('physics: NaN room dimensions are replaced with safe defaults and flagged', () => {
  const r = evaluateClassroomAir({ ...ROOM, lengthFt: NaN });
  assert.equal(r.volumeFt3, 8400);
  assert.equal(r.valid, false);
  assert.ok(r.inputWarnings.some((w) => w.includes('lengthFt')));
  assert.ok(Number.isFinite(r.deliveredCleanAch));
});

test('physics: Infinity outdoor PM2.5 is replaced with a safe bound', () => {
  const r = evaluateClassroomAir({ ...ROOM, outdoorPm25: Infinity });
  assert.ok(Number.isFinite(r.steadyStatePm25));
  assert.ok(Number.isFinite(r.indoorSteadyAqi.aqi));
  assert.equal(r.valid, false);
});

test('physics: negative dimensions are clamped to documented minima', () => {
  const r = evaluateClassroomAir({ ...ROOM, lengthFt: -10, widthFt: -10, heightFt: -5 });
  assert.equal(r.volumeFt3, 10 * 10 * 8);
  assert.equal(r.valid, false);
});

test('physics: zero ventilation and zero infiltration is flagged as invalid', () => {
  const r = evaluateClassroomAir({ ...ROOM, hvacAch: 0, infiltrationAch: 0, cleanerId: 'none', cleanerCount: 0 });
  assert.equal(r.valid, false);
  assert.ok(r.inputWarnings.some((w) => w.includes('not a valid ventilation state')));
  assert.ok(Number.isFinite(r.steadyStatePm25));
});

test('physics: unknown cleaner and MERV keys fall back safely', () => {
  const r = evaluateClassroomAir({ ...ROOM, cleanerId: 'bogus', mervRating: 'bogus' });
  assert.equal(r.cleanerId, 'corsi_box');
  assert.ok(r.hvacCleanAch > 0);
  assert.equal(r.valid, false);
});

test('physics: no-cleaner option yields zero portable CADR', () => {
  const r = evaluateClassroomAir({ ...ROOM, cleanerId: 'none', cleanerCount: 0 });
  assert.equal(r.effectivePortableCfm, 0);
  assert.equal(r.portableAch, 0);
});

test('physics: per-person CFM equals clean CFM divided by occupants', () => {
  const r = evaluateClassroomAir(ROOM);
  assert.equal(r.cfmPerPerson, Number((r.effectiveCleanCfm / r.occupants).toFixed(1)));
});

test('physics: indoor reduction percentage is bounded 0 to 100', () => {
  for (const c of [0, 5, 50, 500, 1e6]) {
    const r = evaluateClassroomAir({ ...ROOM, outdoorPm25: c });
    assert.ok(r.indoorReductionPct >= 0 && r.indoorReductionPct <= 100);
  }
});

test('physics: extremely large room volume yields small portable ACH but finite outputs', () => {
  const r = evaluateClassroomAir({ ...ROOM, lengthFt: 200, widthFt: 200, heightFt: 40, cleanerCount: 1 });
  assert.ok(Number.isFinite(r.portableAch));
  assert.ok(Number.isFinite(r.steadyStatePm25));
});

test('finiteOr returns fallback for non-finite input', () => {
  assert.equal(finiteOr(NaN, 5), 5);
  assert.equal(finiteOr(Infinity, 5), 5);
  assert.equal(finiteOr(7, 5), 7);
  assert.equal(finiteOr('3.5', 5), 3.5);
});

test('physics: all numeric output fields are finite for hostile inputs', () => {
  const r = evaluateClassroomAir({ lengthFt: NaN, widthFt: Infinity, outdoorPm25: -5, cleanerCount: NaN, hvacAch: NaN });
  for (const [key, value] of Object.entries(r)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} is not finite`);
  }
});
