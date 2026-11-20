import test from 'node:test';
import assert from 'node:assert/strict';
import { runCleanAirBenchmark } from '../js/benchmark.mjs';
import { buildSchoolGuidance, pm25ToAqi2024, evaluateClassroomAir } from '../js/air-engine.mjs';
import { SCHOOL_PRESETS } from '../js/scenarios.mjs';

const ROOM = evaluateClassroomAir({ outdoorPm25: 90, cleanerId: 'corsi_box', cleanerCount: 1 });

test('benchmark: 13 of 13 EPA breakpoints pass', () => {
  const b = runCleanAirBenchmark();
  assert.equal(b.breakpointCount, 13);
  assert.equal(b.breakpointPassCount, 13);
  assert.equal(b.allBreakpointsPass, true);
});

test('benchmark: every individual breakpoint check passes', () => {
  for (const check of runCleanAirBenchmark().breakpointChecks) {
    assert.equal(check.pass, true, `failed at PM2.5=${check.pm25}`);
  }
});

test('benchmark: four school scenarios are evaluated', () => {
  const b = runCleanAirBenchmark();
  assert.equal(b.scenarioCount, 4);
  assert.equal(b.scenarioComparisons.length, 4);
});

test('benchmark: scenario IDs match the canonical preset set', () => {
  const ids = runCleanAirBenchmark().scenarioComparisons.map((s) => s.id);
  assert.deepEqual(ids, SCHOOL_PRESETS.map((p) => p.id));
});

test('benchmark: mean indoor drop is exactly 49 percent as cited in packets', () => {
  assert.equal(runCleanAirBenchmark().meanIndoorDropPct, 49);
});

test('benchmark: all scenario drops are positive improvements', () => {
  for (const s of runCleanAirBenchmark().scenarioComparisons) {
    assert.ok(s.pm25DropPct > 0, `${s.id} was not an improvement`);
  }
});

test('benchmark: upgraded ACH strictly exceeds baseline in all scenarios', () => {
  for (const s of runCleanAirBenchmark().scenarioComparisons) {
    assert.ok(s.upgradedAch > s.baselineAch, `${s.id} ACH did not improve`);
  }
});

test('benchmark: deterministic across repeated calls', () => {
  assert.deepEqual(runCleanAirBenchmark(), runCleanAirBenchmark());
});

test('benchmark: guardrails explain modeled scope', () => {
  const g = runCleanAirBenchmark().guardrails;
  assert.equal(g.length, 2);
  assert.match(g[0], /authored hourly inputs/);
  assert.match(g[1], /well-mixed single-zone/);
});

test('guidance: GREEN band has normal recess', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(5), ROOM);
  assert.equal(g.alertLevel, 'GREEN');
  assert.match(g.recessAction, /Normal outdoor recess/);
});

test('guidance: YELLOW band watches sensitive students', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(15), ROOM);
  assert.equal(g.alertLevel, 'YELLOW');
  assert.match(g.recessAction, /watch sensitive students/);
});

test('guidance: ORANGE band shortens vigorous play', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(40), ROOM);
  assert.equal(g.alertLevel, 'ORANGE');
  assert.match(g.recessAction, /Shorten vigorous outdoor play/);
});

test('guidance: RED band moves recess indoors', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(90), ROOM);
  assert.equal(g.alertLevel, 'RED');
  assert.match(g.recessAction, /indoors to rooms with >= 5 ACH/);
});

test('guidance: PURPLE band cancels outdoor recess', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(250), ROOM);
  assert.equal(g.alertLevel, 'PURPLE');
  assert.match(g.recessAction, /Cancel all outdoor recess/);
});

test('guidance: Beyond Index shows 500+ in both notices', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(500), ROOM);
  assert.match(g.enNotice, /AQI 500\+/);
  assert.match(g.esNotice, /ICA 500\+/);
});

test('guidance: English notice includes modeled steady-state label', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(90), ROOM);
  assert.match(g.enNotice, /modeled steady-state indoor PM2.5/);
});

test('guidance: Spanish notice includes filtration detail', () => {
  const g = buildSchoolGuidance(pm25ToAqi2024(90), ROOM);
  assert.match(g.esNotice, /filtraci/);
});

test('guidance: all bands provide sports and asthma actions', () => {
  for (const c of [5, 70, 120, 90, 250, 500]) {
    const g = buildSchoolGuidance(pm25ToAqi2024(c), ROOM);
    assert.ok(g.sportsAction.length > 10);
    assert.ok(g.asthmaProtocol.length > 10);
  }
});

test('scenarios: each preset has 12 hourly readings and positive room dimensions', () => {
  for (const p of SCHOOL_PRESETS) {
    assert.equal(p.hourlyPm25.length, 12, p.id);
    assert.ok(p.room.lengthFt > 0 && p.room.widthFt > 0 && p.room.heightFt > 0);
    assert.ok(p.room.occupants > 0);
  }
});

test('scenarios: wildfire preset has a rising smoke spike', () => {
  const wildfire = SCHOOL_PRESETS.find((p) => p.id === 'wildfire-smoke-plume');
  assert.ok(wildfire.hourlyPm25[11] > wildfire.hourlyPm25[0] * 5);
});
