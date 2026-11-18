/**
 * CleanAirSchool verification & benchmark suite comparing baseline HVAC vs HEPA/CR-Box upgrade.
 */

import { pm25ToAqi2024, computeEpaNowCast, evaluateClassroomAir, buildSchoolGuidance } from './air-engine.mjs';
import { SCHOOL_PRESETS, EPA_BREAKPOINT_CASES } from './scenarios.mjs';

export function runCleanAirBenchmark() {
  const breakpointChecks = EPA_BREAKPOINT_CASES.map((c) => {
    const out = pm25ToAqi2024(c.pm25);
    return {
      pm25: c.pm25,
      expectedAqi: c.expectedAqi,
      actualAqi: out.aqi,
      expectedCategory: c.expectedCategory,
      actualCategory: out.category,
      expectedBeyondIndex: Boolean(c.expectedBeyondIndex),
      actualBeyondIndex: Boolean(out.beyondIndex),
      pass:
        out.aqi === c.expectedAqi &&
        out.category === c.expectedCategory &&
        Boolean(out.beyondIndex) === Boolean(c.expectedBeyondIndex),
    };
  });

  const scenarioComparisons = SCHOOL_PRESETS.map((preset) => {
    const nowCast = computeEpaNowCast(preset.hourlyPm25);
    const baselineRoom = evaluateClassroomAir({
      ...preset.room,
      cleanerId: 'none',
      cleanerCount: 0,
      outdoorPm25: nowCast.nowCastPm25,
    });
    const upgradedRoom = evaluateClassroomAir({
      ...preset.room,
      outdoorPm25: nowCast.nowCastPm25,
    });
    const guidance = buildSchoolGuidance(nowCast, upgradedRoom);
    return {
      id: preset.id,
      title: preset.title,
      nowCastPm25: nowCast.nowCastPm25,
      outdoorAqi: nowCast.aqi,
      alertLevel: guidance.alertLevel,
      baselineAch: baselineRoom.deliveredCleanAch,
      upgradedAch: upgradedRoom.deliveredCleanAch,
      baselineTotalAch: baselineRoom.totalRemovalAch,
      upgradedTotalAch: upgradedRoom.totalRemovalAch,
      baselineSteadyPm25: baselineRoom.steadyStatePm25,
      upgradedSteadyPm25: upgradedRoom.steadyStatePm25,
      pm25DropPct: Number((((baselineRoom.steadyStatePm25 - upgradedRoom.steadyStatePm25) / Math.max(0.1, baselineRoom.steadyStatePm25)) * 100).toFixed(1)),
      unitsFor5Ach: upgradedRoom.unitsFor5Ach,
      meets5Ach: upgradedRoom.meets5Ach,
    };
  });

  const allBreakpointsPass = breakpointChecks.every((b) => b.pass);
  const meanIndoorDropPct = Number(
    (scenarioComparisons.reduce((s, r) => s + r.pm25DropPct, 0) / scenarioComparisons.length).toFixed(1)
  );

  return {
    version: '1.0.0',
    breakpointCount: breakpointChecks.length,
    breakpointPassCount: breakpointChecks.filter((b) => b.pass).length,
    allBreakpointsPass,
    scenarioCount: scenarioComparisons.length,
    meanIndoorDropPct,
    breakpointChecks,
    scenarioComparisons,
    guardrails: [
      'EPA 2024 breakpoints and 12-hour NowCast implement published federal equations against authored hourly inputs.',
      'Classroom decay assumes well-mixed single-zone air without localized drafts, open-door surges, or indoor dust sources.',
    ],
  };
}
