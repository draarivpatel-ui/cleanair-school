# CleanAirSchool

**US EPA 2024 NowCast AQI school outdoor-activity planner and ASHRAE 241 classroom CADR ventilation sizer.**

CleanAirSchool helps school nurses, teachers, coaches, and families turn raw hourly PM2.5 readings into clear outdoor recess/PE decisions, ASHRAE 241 classroom air-cleaner sizing, and bilingual English/Spanish parent notices.

## Key Capabilities

- **US EPA 2024 PM2.5 AQI & 12-Hour NowCast Engine (`js/air-engine.mjs`):** Implements all 6 published May 2024 federal PM2.5 breakpoint tiers (`0.0-9.0` Good through `225.5-325.4` Hazardous for AQI `301-500`, plus explicit Beyond Index flagging above `325.4 ug/m3`) and standard 12-hour NowCast weighted response (`w* = max(0.5, 1 - range/max)`).
- **Classroom Mass-Balance & ASHRAE 241 Sizing:** Models single-compartment indoor PM2.5 decay over 120 minutes combining envelope infiltration (`0.45 h^-1`, `0.75` penetration), HVAC MERV filtration (`MERV 8/11/13/16`), surface deposition (`0.20 h^-1` in mass balance), and portable HEPA / Corsi-Rosenthal CADR units, reporting active delivered clean ACH (HVAC filtration + portable CADR), CFM/person vs the 40 CFM/person ASHRAE 241 classroom target (Standard 241 ages 9+ rate; conservative for ages 5-8), and exact portable unit counts needed for `5.0 ACH`.
- **School Guidance & Bilingual Notices:** Generates color-coded recess, athletics, and asthma-care guidance alongside ready-to-paste English and Spanish parent notices and a printable nurse sheet (`@media print`).
- **Offline & Zero Dependencies:** Static HTML, CSS, and ES modules with `connect-src 'none'` CSP.

## Scope & Guardrails

- Hourly PM2.5 inputs, room dimensions, and filter assumptions are synthetic or user-entered values; no live sensor feed or medical diagnosis is claimed.
- Classroom decay assumes well-mixed single-zone air without localized drafts, open-door surges, or indoor dust sources.

## Verification & Calibration

Run with Node 18+:

```sh
npm test
npm run eval:check
npm run eval:json
```

Observed calibration output:
- **EPA 2024 exact edge checks:** `13/13` breakpoint checks pass across all 6 federal tiers (`0.0`, `9.0`, `9.1`, `35.4`, `35.5`, `55.4`, `55.5`, `125.4`, `125.5`, `225.4`, `225.5`, `325.4`) plus Beyond Index (`325.5`).
- **Four classroom scenarios:** Mean additional steady-state indoor PM2.5 reduction of `-49.0%` when adding portable HEPA/Corsi-Rosenthal filtration over baseline HVAC.
