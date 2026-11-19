import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHourlySeries, pm25ToAqi2024, computeEpaNowCast, evaluateClassroomAir, buildSchoolGuidance } from '../js/air-engine.mjs';
import { EPA_BREAKPOINT_CASES } from '../js/scenarios.mjs';
import { runCleanAirBenchmark } from '../js/benchmark.mjs';

test('EPA 2024 PM2.5 AQI breakpoints match all 6 federal tiers (12 edges) and flag Beyond Index (>325.4)', () => {
  for (const c of EPA_BREAKPOINT_CASES) {
    const out = pm25ToAqi2024(c.pm25);
    assert.equal(out.aqi, c.expectedAqi, `PM2.5=${c.pm25}`);
    assert.equal(out.category, c.expectedCategory, `PM2.5=${c.pm25}`);
    assert.equal(Boolean(out.beyondIndex), Boolean(c.expectedBeyondIndex), `beyondIndex PM2.5=${c.pm25}`);
  }
  assert.equal(pm25ToAqi2024(275).aqi, 400);
});

test('EPA NowCast requires 2 of 3 most recent hours and weights rapid spikes heavily', () => {
  assert.equal(computeEpaNowCast([]), null);
  assert.equal(computeEpaNowCast([15, null, null]), null);

  const steady = computeEpaNowCast([20, 20, 20, 20, 20, 20]);
  assert.equal(steady.nowCastPm25, 20.0);
  assert.equal(steady.weightFactor, 1);

  const spike = computeEpaNowCast([10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 60, 100]);
  assert.ok(spike.weightFactor === 0.5, 'Large range should clamp w* to 0.5');
  assert.ok(spike.nowCastPm25 > 65 && spike.nowCastPm25 < 75, `Spike NowCast (${spike.nowCastPm25}) should respond toward recent hours`);
});

test('classroom mass-balance trajectory converges monotonically and 5.0 ACH target counts delivered filtration only', () => {
  const room = evaluateClassroomAir({
    lengthFt: 30,
    widthFt: 28,
    heightFt: 10,
    occupants: 26,
    outdoorPm25: 100,
    initialIndoorPm25: 80,
    hvacAch: 3.0,
    mervRating: 'merv13',
    cleanerId: 'corsi_box',
    cleanerCount: 2,
  });
  assert.ok(room.deliveredCleanAch > 7);
  assert.ok(room.totalRemovalAch > room.deliveredCleanAch);
  assert.equal(room.meets5Ach, true);

  const borderline = evaluateClassroomAir({
    lengthFt: 30,
    widthFt: 28,
    heightFt: 10,
    infiltrationAch: 1.5,
    hvacAch: 3.0,
    mervRating: 'merv13',
    cleanerId: 'classroom_hepa',
    cleanerCount: 1,
  });
  // HVAC (2.55) + 1 HEPA (1.86) = 4.41 delivered clean ACH (< 5.0 despite 1.5 infiltration + 0.2 deposition)
  assert.equal(borderline.meets5Ach, false);
  assert.ok(borderline.unitsFor5Ach >= 2);
  assert.equal(room.trajectory.length, 13);
  for (let i = 1; i < room.trajectory.length; i++) {
    assert.ok(room.trajectory[i].indoorPm25 <= room.trajectory[i - 1].indoorPm25);
  }
  const endDiff = Math.abs(room.trajectory[room.trajectory.length - 1].indoorPm25 - room.steadyStatePm25);
  assert.ok(endDiff < 0.2, `120-min decay should converge near steady state (diff=${endDiff})`);
});

test('school guidance generates both EN and ES notices across AQI alert bands', () => {
  const room = evaluateClassroomAir({ outdoorPm25: 90, cleanerId: 'corsi_box', cleanerCount: 1 });
  const red = buildSchoolGuidance(pm25ToAqi2024(90), room);
  assert.equal(red.alertLevel, 'RED');
  assert.ok(red.enNotice.includes('AQI'));
  assert.ok(red.esNotice.includes('ICA'));

  const green = buildSchoolGuidance(pm25ToAqi2024(5), room);
  assert.equal(green.alertLevel, 'GREEN');
});

test('CleanAirSchool calibration benchmark passes deterministically', () => {
  const b1 = runCleanAirBenchmark();
  const b2 = runCleanAirBenchmark();
  assert.deepEqual(b1, b2);
  assert.equal(b1.allBreakpointsPass, true);
  assert.ok(b1.meanIndoorDropPct > 30);
});

test('hourly text parsing keeps missing hours as gaps instead of zero readings', () => {
  assert.deepEqual(parseHourlySeries('12, 13.5, 14'), [12, 13.5, 14]);
  assert.deepEqual(parseHourlySeries('40, , 42, n/a, -3, 44'), [40, null, 42, null, null, 44]);
  assert.deepEqual(parseHourlySeries('40, 42, 44, '), [40, 42, 44]);
  assert.deepEqual(parseHourlySeries(''), [null]);

  // A blank hour must not be read as 0 ug/m3, which would drag a smoky NowCast toward Good.
  const withGap = computeEpaNowCast(parseHourlySeries('80, 82, , 85, 88'));
  const complete = computeEpaNowCast([80, 82, 84, 85, 88]);
  assert.ok(Math.abs(withGap.nowCastPm25 - complete.nowCastPm25) < 1);
  assert.equal(withGap.key, 'unhealthy');
  assert.equal(computeEpaNowCast(parseHourlySeries('80, 82, 85, , ,')).key, 'unhealthy');
  assert.equal(computeEpaNowCast(parseHourlySeries('80, 82, 85, x, y')), null);
});
