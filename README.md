# CleanAirSchool

**US EPA 2024 NowCast AQI school outdoor-activity planner and ASHRAE 241 classroom CADR ventilation sizer, with a one-click wildfire classroom intervention demo.**

Live: `https://aariv.me/cleanair-school/`

CleanAirSchool helps school nurses, teachers, coaches, and families turn raw hourly PM2.5 readings into clear outdoor recess/PE decisions, ASHRAE 241 classroom air-cleaner sizing, cost-per-CADR comparisons, and bilingual English/Spanish parent notices. Every displayed result is a labeled **modeled engineering projection**. No live sensor feed, medical diagnosis, school pilot, purchase, or measured outcome is claimed.

## Key Capabilities

- **Immediate 30-second demo:** the above-the-fold "Run the classroom intervention demo" button loads a wildfire smoke spike and shows outdoor AQI 167 (Unhealthy) becoming a modeled indoor AQI inside a filtered classroom, with the 120-minute decay curve, cost bars, and a transparent 3-year school budget breakdown. The projection disclaimer sits next to the numbers, not only in the footer.
- **US EPA 2024 PM2.5 AQI & 12-Hour NowCast Engine (`js/air-engine.mjs`):** all 6 published May 2024 federal PM2.5 breakpoint tiers (`0.0-9.0` Good through `225.5-325.4` Hazardous for AQI `301-500`), explicit Beyond Index flagging above `325.4 ug/m3`, EPA 0.1 ug/m3 concentration truncation, and the standard 12-hour NowCast weighted response (`w* = max(0.5, 1 - range/max)`). Non-finite, negative, and extreme inputs are handled with explicit validity flags and never leak `NaN`/`Infinity`.
- **Classroom Mass-Balance & ASHRAE 241 Sizing:** single-compartment indoor PM2.5 decay over 120 minutes combining envelope infiltration (`0.45 h^-1`, `0.75` penetration), HVAC MERV filtration (`MERV 8/11/13/16`), surface deposition (`0.20 h^-1` in mass balance), and portable HEPA / Corsi-Rosenthal CADR units. Reports delivered clean ACH (HVAC filtration + portable CADR), CFM/person vs the 40 CFM/person ASHRAE 241 classroom target, and the exact portable unit count needed for `5.0 ACH`.
- **Lifecycle, Diminishing Returns & Cost Model:** optional real-world derates (first unit full CADR, additional units at `0.92`, filter load linearly derating CADR to `0.60` at end of life), days-since-filter-change tracking with `replacementDue`, and per-student cost-per-CADR comparisons using explicit engineering cost assumptions (CR box `$90` / `380 CFM`, classroom HEPA `$380` / `260 CFM`, commercial HEPA `$950` / `650 CFM`, 3-year horizon with annual filter lines). Derates are opt-in so the originally cited scenario metrics remain unchanged.
- **Fleet Retrofit & Lifecycle Resilience Lab (`js/fleet-lab.mjs`):** a 5-strategy x 4-regime comparator (MERV 8 baseline, MERV 13 upgrade, Corsi-Rosenthal fleet, classroom HEPA fleet, MERV 13 + CR hybrid across `20`/`45`/`85`/`260` ug/m3 smoke regimes) evaluated directly through the air engine. Reports steady indoor PM2.5 and AQI, fresh and end-of-life (`0.60` loaded filter) clean ACH, CFM/person vs the `40 CFM/person` ASHRAE 241 target, fleet unit counts for `5.0 ACH`, and a 3-year school budget for `1-100` classrooms. Includes a cost-vs-ACH Pareto chart with the ASHRAE 241 equivalent-ACH line, a 5-curve 120-minute decay chart, a pure-JS FIPS 180-4 SHA-256 audited brief (JSON, formula-safe CSV, Markdown, one cached digest-stamped payload per state), an interactive verify/tamper check, a strict fail-closed `#cas=` bookmark codec, and a `24`-check in-page self-test runner.
- **School Guidance & Bilingual Notices:** color-coded recess, athletics, and asthma-care guidance plus ready-to-paste English and Spanish parent notices and a printable nurse sheet (`@media print`).
- **Offline & Zero Dependencies:** static HTML, CSS, and ES modules with `connect-src 'none'` CSP and an inline data-URI favicon so there are no console 404s.

## Scope & Guardrails

- Hourly PM2.5 inputs, room dimensions, filter assumptions, and costs are synthetic or user-entered; all outputs are engineering projections, not measured school results.
- Classroom decay assumes well-mixed single-zone air without localized drafts, open-door surges, or indoor dust sources.
- Cost figures are planning assumptions in USD over a 3-year horizon, not vendor quotes or procurement records.
- The canonical EPA 2024 breakpoint evaluation and its four scenario drops are preserved exactly for existing packet citations.

## Verification & Calibration

Run with Node 18+:

```sh
npm test
npm run eval:check
npm run eval:json
```

**Verified on 2026-11-25:**
- **`npm test`: 426/426 tests passing** across 11 files: EPA 2024 AQI breakpoints and dense truncation sweeps, NowCast edge cases including missing-hour windows, classroom physics, derate-aware unit sizing, filter lifecycle and cost models, benchmark/guidance across GREEN through MAROON bands, DOM wiring, Wave 2 regressions, the fleet lab matrix (SHA-256 KATs vs Node crypto, `#cas=` codec hostile-input rejection, 5x4 comparator correctness, EOL floors, Pareto frontier, digest parity across JSON/CSV/Markdown, tamper detection), and strict repository hygiene (zero em/en dashes, no smooth scrolling, no AI mentions, no private paths).
- **`npm run eval:check`: 13/13 EPA 2024 breakpoint checks passing** across all 6 federal tiers plus Beyond Index, with all 4 classroom scenarios improving (mean steady indoor PM2.5 reduction `-49%`, matching the originally cited packet figure).
- **Headless Chromium:** verified at `1440x900` and `390x844` with real pointer clicks and pointer hovers on the hero demo, decay-chart inspection layer, EPA verification button, preset selector, filter derate toggle, top demo button, fleet regime buttons, strategy table rows, SVG Pareto markers, the verify/tamper buttons, the in-page self-test runner (`24/24`), and a full `#cas=` bookmark reload restoring every encoded field. Zero console errors, zero document-level horizontal overflow, zero external network requests, and no small all-caps eyebrows or em/en dashes. Every alert chip renders at 4.5:1 contrast or better, and blank hourly entries are treated as missing hours in the NowCast window.
