import test from 'node:test';
import assert from 'node:assert/strict';
import {
  portableCadrWithDerates, filterLifecycle, compareCleanerOptions,
  schoolBudgetProjection, evaluateClassroomAir, CLEANER_CATALOG,
  ADDITIONAL_UNIT_EFFICIENCY, LOADED_FILTER_CADR_FRACTION,
} from '../js/air-engine.mjs';

const ROOM = {
  lengthFt: 30, widthFt: 28, heightFt: 10, occupants: 26,
  outdoorPm25: 90, hvacAch: 3, mervRating: 'merv13',
};

test('derates: fresh single unit delivers full nameplate CADR', () => {
  const d = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 1, 0);
  assert.equal(d.effectiveCfm, 380);
  assert.equal(d.placementFactor, 1);
  assert.equal(d.loadingFactor, 1);
});

test('derates: two units apply the documented placement factor', () => {
  const d = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 2, 0);
  assert.equal(d.nameplateCfm, 760);
  assert.equal(d.placementFactor, Number(((1 + ADDITIONAL_UNIT_EFFICIENCY) / 2).toFixed(4)));
  assert.ok(d.effectiveCfm < 760 && d.effectiveCfm > 700);
});

test('derates: fully loaded filter caps CADR at the documented fraction', () => {
  const d = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 1, 1);
  assert.equal(d.loadingFactor, LOADED_FILTER_CADR_FRACTION);
  assert.equal(d.effectiveCfm, Number((380 * LOADED_FILTER_CADR_FRACTION).toFixed(1)));
});

test('derates: zero cleaner or zero count yields zero effective CADR', () => {
  assert.equal(portableCadrWithDerates(CLEANER_CATALOG.none, 1, 0).effectiveCfm, 0);
  assert.equal(portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 0, 0).effectiveCfm, 0);
  assert.equal(portableCadrWithDerates(null, 3, 0).effectiveCfm, 0);
});

test('derates: load fraction is clamped to 0..1', () => {
  const low = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 1, -5);
  const high = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 1, 9);
  assert.equal(low.effectiveCfm, 380);
  assert.equal(high.effectiveCfm, Number((380 * LOADED_FILTER_CADR_FRACTION).toFixed(1)));
});

test('lifecycle: fresh filter has zero load and no replacement due', () => {
  const l = filterLifecycle(CLEANER_CATALOG.corsi_box, 0);
  assert.equal(l.loadFraction, 0);
  assert.equal(l.replacementDue, false);
  assert.equal(l.daysRemaining, 90);
});

test('lifecycle: filter reaches full load at replacement interval', () => {
  const l = filterLifecycle(CLEANER_CATALOG.corsi_box, 90);
  assert.equal(l.loadFraction, 1);
  assert.equal(l.replacementDue, true);
  assert.equal(l.daysRemaining, 0);
});

test('lifecycle: filter beyond interval stays clamped and due', () => {
  const l = filterLifecycle(CLEANER_CATALOG.corsi_box, 200);
  assert.equal(l.loadFraction, 1);
  assert.equal(l.replacementDue, true);
});

test('lifecycle: no-filter cleaner has no lifecycle obligations', () => {
  const l = filterLifecycle(CLEANER_CATALOG.none, 1000);
  assert.equal(l.loadFraction, 0);
  assert.equal(l.replacementDue, false);
  assert.equal(l.daysRemaining, null);
});

test('lifecycle: negative days are treated as zero', () => {
  assert.equal(filterLifecycle(CLEANER_CATALOG.corsi_box, -30).loadFraction, 0);
});

test('room with derates: loaded filter lowers delivered ACH versus fresh filter', () => {
  const fresh = evaluateClassroomAir({ ...ROOM, cleanerId: 'corsi_box', cleanerCount: 1, applyDerates: true, daysSinceReplacement: 0 });
  const loaded = evaluateClassroomAir({ ...ROOM, cleanerId: 'corsi_box', cleanerCount: 1, applyDerates: true, daysSinceReplacement: 90 });
  assert.equal(fresh.replacementDue, false);
  assert.equal(loaded.replacementDue, true);
  assert.ok(loaded.deliveredCleanAch < fresh.deliveredCleanAch);
  assert.ok(loaded.steadyStatePm25 > fresh.steadyStatePm25);
});

test('room without derates: canonical output is unchanged by filter days', () => {
  const a = evaluateClassroomAir({ ...ROOM, cleanerId: 'corsi_box', cleanerCount: 1, daysSinceReplacement: 0 });
  const b = evaluateClassroomAir({ ...ROOM, cleanerId: 'corsi_box', cleanerCount: 1, daysSinceReplacement: 90 });
  assert.equal(a.deliveredCleanAch, b.deliveredCleanAch);
  assert.equal(a.filterLoadFraction, 0);
});

test('cost: CR box is cheaper per delivered CFM than commercial HEPA', () => {
  const rows = compareCleanerOptions(ROOM);
  const cr = rows.find((r) => r.id === 'corsi_box');
  const hepa = rows.find((r) => r.id === 'gym_commercial');
  assert.ok(cr.costPerCfm < hepa.costPerCfm);
  assert.ok(cr.threeYearCostUsd < hepa.threeYearCostUsd);
});

test('cost: comparison includes all four catalog entries', () => {
  const rows = compareCleanerOptions(ROOM);
  assert.deepEqual(rows.map((r) => r.id), ['none', 'corsi_box', 'classroom_hepa', 'gym_commercial']);
});

test('cost: no-cleaner cost per CFM is null, not NaN', () => {
  const none = compareCleanerOptions(ROOM).find((r) => r.id === 'none');
  assert.equal(none.costPerCfm, null);
  assert.ok(Number.isFinite(none.costPerStudent));
});

test('cost: cost per student divides three-year cost by occupants', () => {
  const r = evaluateClassroomAir({ ...ROOM, cleanerId: 'corsi_box', cleanerCount: 1 });
  assert.equal(r.costPerStudent, Number((r.threeYearCostUsd / r.occupants).toFixed(2)));
});

test('cost: three-year cost includes hardware and three years of filters', () => {
  const r = evaluateClassroomAir({ ...ROOM, cleanerId: 'corsi_box', cleanerCount: 2 });
  assert.equal(r.threeYearCostUsd, 2 * 90 + 2 * 60 * 3);
});

test('budget: hardware and filters scale linearly with classroom count', () => {
  const a = schoolBudgetProjection(10, 'corsi_box');
  const b = schoolBudgetProjection(20, 'corsi_box');
  assert.equal(b.hardwareUsd, 2 * a.hardwareUsd);
  assert.equal(b.filtersYear1Usd, 2 * a.filtersYear1Usd);
  assert.equal(b.total3YearUsd, 2 * a.total3YearUsd);
});

test('budget: unknown cleaner falls back to Corsi-Rosenthal box', () => {
  const p = schoolBudgetProjection(20, 'unknown');
  assert.equal(p.cleanerId, 'corsi_box');
});

test('budget: projection note explicitly denies a school pilot claim', () => {
  const p = schoolBudgetProjection(20);
  assert.match(p.projectionNote, /No school pilot/i);
  assert.match(evaluateClassroomAir(ROOM).costBasis, /Not a quoted bid/i);
});

test('budget: per-classroom three-year cost equals hardware plus filter share', () => {
  const p = schoolBudgetProjection(20, 'classroom_hepa');
  assert.equal(p.perClassroom3YearUsd, 380 + 110 * 3);
});

test('budget: degenerate classroom count clamps to one', () => {
  const p = schoolBudgetProjection(0);
  assert.equal(p.classroomCount, 1);
});
