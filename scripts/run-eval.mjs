import { runCleanAirBenchmark } from '../js/benchmark.mjs';

const args = new Set(process.argv.slice(2));
const report = runCleanAirBenchmark();

if (args.has('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

console.log(`CleanAirSchool EPA 2024 & ASHRAE 241 Benchmark v${report.version}`);
console.log(`EPA 2024 Breakpoint Checks: ${report.breakpointPassCount}/${report.breakpointCount} exact edge matches`);
console.log(`Classroom Scenarios: ${report.scenarioCount} (mean additional indoor PM2.5 drop from portable filtration: -${report.meanIndoorDropPct}%)`);
for (const s of report.scenarioComparisons) {
  console.log(
    `  ${s.id}: outdoor NowCast=${s.nowCastPm25} ug/m3 (AQI ${s.outdoorAqi}, ${s.alertLevel}) | `
    + `ACH ${s.baselineAch}->${s.upgradedAch} | steady indoor ${s.baselineSteadyPm25}->${s.upgradedSteadyPm25} ug/m3 (-${s.pm25DropPct}%)`
  );
}

if (args.has('--check')) {
  if (!report.allBreakpointsPass) {
    console.error('FAIL: EPA 2024 breakpoint calibration mismatch.');
    process.exit(1);
  }
  if (report.scenarioComparisons.some((s) => s.upgradedAch <= s.baselineAch)) {
    console.error('FAIL: Upgraded classroom ACH must strictly exceed no-cleaner baseline.');
    process.exit(1);
  }
  console.log('Check: all EPA 2024 and classroom filtration thresholds passed.');
}
