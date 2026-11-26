/**
 * CleanAirSchool pure physics and EPA 2024 AQI engine.
 * Implements:
 *  1) US EPA 2024 Revised PM2.5 AQI Breakpoints (40 CFR Part 58, effective May 2024)
 *  2) US EPA 12-hour NowCast weighted concentration algorithm
 *  3) Single-compartment classroom indoor PM2.5 mass-balance + ASHRAE 241 ECAi sizing
 *  4) Filter-loading lifecycle, multi-unit derate, and cost-per-CADR comparisons
 *  5) School recess / PE / athletics / asthma-care guidance + EN/ES parent alerts
 *
 * All classroom dimensions, HVAC filters, and hourly concentrations are explicit model inputs;
 * no live sensor feed or medical diagnosis is claimed. Every projection is an engineering
 * model output, not a measured school pilot result.
 */

export const EPA_PM25_2024_BREAKPOINTS = Object.freeze([
  { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50, category: 'Good', color: '#15803d', key: 'good', chipBg: '#dcfce7', chipText: '#166534' },
  { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100, category: 'Moderate', color: '#ca8a04', key: 'moderate', chipBg: '#fef9c3', chipText: '#854d0e' },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, category: 'Unhealthy for Sensitive Groups', color: '#ea580c', key: 'usg', chipBg: '#ffedd5', chipText: '#9a3412' },
  { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200, category: 'Unhealthy', color: '#dc2626', key: 'unhealthy', chipBg: '#fee2e2', chipText: '#991b1b' },
  { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300, category: 'Very Unhealthy', color: '#7e22ce', key: 'very_unhealthy', chipBg: '#f3e8ff', chipText: '#6b21a8' },
  { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 500, category: 'Hazardous', color: '#7f1d1d', key: 'hazardous', chipBg: '#7f1d1d', chipText: '#ffffff' },
]);

/** Catalog of modeled portable cleaner options. Costs are engineering assumptions in USD. */
export const CLEANER_CATALOG = Object.freeze({
  none: { id: 'none', name: 'No Portable Cleaner', cadrCfm: 0, unitCostUsd: 0, annualFilterUsd: 0, replacementDays: 0 },
  corsi_box: {
    id: 'corsi_box', name: 'Corsi-Rosenthal 4x MERV-13 Box', cadrCfm: 380,
    unitCostUsd: 90, annualFilterUsd: 60, replacementDays: 90,
  },
  classroom_hepa: {
    id: 'classroom_hepa', name: 'Classroom True-HEPA Tower', cadrCfm: 260,
    unitCostUsd: 380, annualFilterUsd: 110, replacementDays: 365,
  },
  gym_commercial: {
    id: 'gym_commercial', name: 'Commercial HEPA Scrubber', cadrCfm: 650,
    unitCostUsd: 950, annualFilterUsd: 220, replacementDays: 365,
  },
});

export const MERV_REMOVAL_EFF = Object.freeze({
  merv8: 0.2,
  merv11: 0.5,
  merv13: 0.85,
  merv16: 0.95,
});

/** Multi-unit placement/mixing derate: first unit at full CADR, each subsequent unit at 0.92. */
export const ADDITIONAL_UNIT_EFFICIENCY = 0.92;
/** A fully loaded filter is modeled to deliver 60% of clean-filter CADR. */
export const LOADED_FILTER_CADR_FRACTION = 0.6;
/** Default filter service life for the CR box when no timeline is given (days). */
export const DEFAULT_REPLACEMENT_DAYS = 90;
/** Upper display-safety bound on a school budget request; the count input allows at most 200. */
export const MAX_BUDGET_CLASSROOMS = 100000;

/** Coerce any input to a finite number or return the supplied fallback. Never leaks NaN/Infinity. */
export function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute US EPA 2024 PM2.5 AQI from concentration (ug/m3, truncated to 0.1).
 * Non-finite or negative inputs are treated as 0 with inputValid: false.
 * Concentrations above 325.4 ug/m3 are Beyond Index (capped at 500 with beyondIndex: true).
 */
export function pm25ToAqi2024(pm25Raw) {
  if (pm25Raw === null || pm25Raw === undefined || pm25Raw === '' || (typeof pm25Raw !== 'number' && typeof pm25Raw !== 'string')
    || (typeof pm25Raw === 'string' && pm25Raw.trim() === '')) {
    return { pm25: 0, aqi: 0, category: 'Good', key: 'good', color: '#15803d', chipBg: '#dcfce7', chipText: '#166534', beyondIndex: false, inputValid: false };
  }
  const raw = Number(pm25Raw);
  const inputValid = Number.isFinite(raw) && raw >= 0;
  const bounded = inputValid ? Math.min(raw, 1e6) : 0;
  const c = Math.max(0, Math.floor(bounded * 10) / 10);
  for (const bp of EPA_PM25_2024_BREAKPOINTS) {
    if (c >= bp.cLow && c <= bp.cHigh) {
      const aqi = Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.iLow);
      return { pm25: c, aqi, category: bp.category, key: bp.key, color: bp.color, chipBg: bp.chipBg, chipText: bp.chipText, beyondIndex: false, inputValid };
    }
  }
  const last = EPA_PM25_2024_BREAKPOINTS[EPA_PM25_2024_BREAKPOINTS.length - 1];
  return {
    pm25: c, aqi: 500, category: 'Hazardous (Beyond Index)', key: last.key,
    color: last.color, chipBg: last.chipBg, chipText: last.chipText, beyondIndex: true, inputValid,
  };
}

/**
 * Compute US EPA 12-hour NowCast weighted PM2.5 from hourly array [oldest ... newest].
 * Uses standard EPA weight factor w* = max(0.5, 1 - range/max).
 * Returns null if fewer than 2 of the latest 3 hours are valid. Non-finite and negative
 * entries are ignored; at most 12 entries are considered.
 */
export function computeEpaNowCast(hourlySeries) {
  const arr = (Array.isArray(hourlySeries) ? hourlySeries : []).slice(-12);
  if (arr.length === 0) return null;
  const isHourValid = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e6;
  const recent3 = arr.slice(-3).filter(isHourValid);
  if (recent3.length < 2) return null;

  const valid = arr.filter(isHourValid);
  const maxVal = Math.max(...valid);
  const minVal = Math.min(...valid);
  if (maxVal === 0) {
    return { nowCastPm25: 0, weightFactor: 1, ...pm25ToAqi2024(0) };
  }
  const scaledRate = (maxVal - minVal) / maxVal;
  const wStar = Math.max(0.5, 1 - scaledRate);

  let weightedSum = 0;
  let weightTotal = 0;
  for (let idx = 0; idx < arr.length; idx++) {
    const val = arr[arr.length - 1 - idx]; // idx=0 is most recent hour
    if (!isHourValid(val)) continue;
    const w = Math.pow(wStar, idx);
    weightedSum += val * w;
    weightTotal += w;
  }
  const nowCastPm25 = Math.floor((weightedSum / weightTotal) * 10) / 10;
  return { nowCastPm25, weightFactor: Number(wStar.toFixed(4)), ...pm25ToAqi2024(nowCastPm25) };
}

/**
 * Effective portable CADR in CFM after placement derate and filter loading.
 * - First unit delivers full nameplate CADR; units 2+ deliver ADDITIONAL_UNIT_EFFICIENCY.
 * - filterLoadFraction: 0 = fresh, 1 = fully loaded; CADR derates linearly to
 *   LOADED_FILTER_CADR_FRACTION at full load.
 */
export function portableCadrWithDerates(cleaner, count, filterLoadFraction = 0) {
  const units = Number(count);
  if (!cleaner || !Number.isFinite(cleaner.cadrCfm) || cleaner.cadrCfm <= 0 || !Number.isFinite(units) || units <= 0) {
    return { effectiveCfm: 0, nameplateCfm: 0, placementFactor: 1, loadingFactor: 1 };
  }
  const load = Math.min(1, Math.max(0, finiteOr(filterLoadFraction, 0)));
  const loadingFactor = 1 - load * (1 - LOADED_FILTER_CADR_FRACTION);
  const placementFactor = units === 1 ? 1 : (1 + (units - 1) * ADDITIONAL_UNIT_EFFICIENCY) / units;
  const nameplateCfm = cleaner.cadrCfm * units;
  const effectiveCfm = Number((nameplateCfm * placementFactor * loadingFactor).toFixed(1));
  if (!Number.isFinite(nameplateCfm) || !Number.isFinite(placementFactor) || !Number.isFinite(effectiveCfm)) {
    return { effectiveCfm: 0, nameplateCfm: 0, placementFactor: 1, loadingFactor: 1 };
  }
  return {
    effectiveCfm,
    nameplateCfm,
    placementFactor: Number(placementFactor.toFixed(4)),
    loadingFactor: Number(loadingFactor.toFixed(4)),
  };
}

/** Filter lifecycle: estimate load fraction from days since replacement and flag due service. */
export function filterLifecycle(cleaner, daysSinceReplacement = 0) {
  if (!cleaner || !cleaner.replacementDays || cleaner.replacementDays <= 0) {
    return { loadFraction: 0, replacementDue: false, daysRemaining: null };
  }
  const days = Math.max(0, finiteOr(daysSinceReplacement, 0));
  const loadFraction = Math.min(1, days / cleaner.replacementDays);
  return {
    loadFraction: Number(loadFraction.toFixed(4)),
    replacementDue: days >= cleaner.replacementDays,
    daysRemaining: Math.max(0, Math.ceil(cleaner.replacementDays - days)),
  };
}

/**
 * Single-compartment well-mixed classroom PM2.5 decay & ASHRAE 241 ECAi sizing.
 * - Volume V = lengthFt * widthFt * heightFt (ft3)
 * - Outdoor infiltration rate lambda_inf (h^-1), envelope penetration factor p_env (0.75 default)
 * - HVAC recirculation clean airflow = hvacAch * mervEff * V / 60 (CFM)
 * - Portable CADR = count * cleaner.cadrCfm * placement derate * filter loading derate
 * - Surface deposition k_dep = 0.20 h^-1 (PM2.5 indoor settling, used only for decay mass balance)
 *
 * Degenerate or non-finite inputs are replaced by validated defaults and surfaced via
 * inputWarnings plus valid: false. The function never returns NaN or Infinity.
 */
export function evaluateClassroomAir(input = {}) {
  if (input === null || typeof input !== 'object') input = {};
  const warnings = [];
  const numeric = (key, fallback, min, max) => {
    if (input[key] === undefined || input[key] === null || input[key] === '') return fallback;
    let v = finiteOr(input[key], fallback);
    if (!Number.isFinite(Number(input[key]))) warnings.push(`${key} was not finite; used ${fallback}`);
    if (v < min) { warnings.push(`${key} clamped to ${min}`); v = min; }
    if (max !== undefined && v > max) { warnings.push(`${key} clamped to ${max}`); v = max; }
    return v;
  };

  const lengthFt = numeric('lengthFt', 30, 10, 200);
  const widthFt = numeric('widthFt', 28, 10, 200);
  const heightFt = numeric('heightFt', 10, 8, 40);
  const volumeFt3 = lengthFt * widthFt * heightFt;
  const occupants = Math.max(1, Math.round(numeric('occupants', 26, 1, 400)));
  const outdoorPm25 = numeric('outdoorPm25', 45, 0, 1e6);
  const initialIndoorPm25 = numeric('initialIndoorPm25', outdoorPm25 * 0.72, 0, 1e6);
  const infiltrationAch = numeric('infiltrationAch', 0.45, 0, 10);
  const penetrationFactor = numeric('penetrationFactor', 0.75, 0, 1);
  const hvacAch = numeric('hvacAch', 3.0, 0, 15);
  const mervKey = MERV_REMOVAL_EFF[input.mervRating] !== undefined ? input.mervRating : 'merv11';
  if (input.mervRating !== undefined && MERV_REMOVAL_EFF[input.mervRating] === undefined) warnings.push('mervRating unknown; used merv11');
  const mervEff = MERV_REMOVAL_EFF[mervKey];
  const cleaner = CLEANER_CATALOG[input.cleanerId] || CLEANER_CATALOG.corsi_box;
  if (input.cleanerId !== undefined && !CLEANER_CATALOG[input.cleanerId]) warnings.push('cleanerId unknown; used corsi_box');
  const cleanerCount = Math.max(0, Math.round(numeric('cleanerCount', 1, 0, 12)));

  // Diminishing-returns derates are opt-in so the canonical 13-point EPA 2024 benchmark and its
  // published scenario drops remain byte-identical to the originally cited model.
  const useDerates = input.applyDerates === true;
  const daysSinceReplacement = Math.max(0, finiteOr(input.daysSinceReplacement, 0));
  const lifecycle = filterLifecycle(cleaner, daysSinceReplacement);
  const rawLoadFraction = useDerates ? finiteOr(input.filterLoadFraction, lifecycle.loadFraction) : 0;
  const loadFraction = Math.min(1, Math.max(0, rawLoadFraction));
  if (useDerates && rawLoadFraction !== loadFraction) {
    warnings.push('filterLoadFraction clamped to the 0..1 service-life domain');
  }
  const derates = useDerates
    ? portableCadrWithDerates(cleaner, cleanerCount, loadFraction)
    : { effectiveCfm: cleaner.cadrCfm * cleanerCount, nameplateCfm: cleaner.cadrCfm * cleanerCount, placementFactor: 1, loadingFactor: 1 };

  if (infiltrationAch === 0 && hvacAch === 0 && cleanerCount === 0) {
    warnings.push('No outdoor air or filtration; deposition-only decay is not a valid ventilation state');
  }

  const depositionAch = 0.2;
  const hvacCleanAch = hvacAch * mervEff;
  const portableAch = (derates.effectiveCfm * 60) / volumeFt3;
  const deliveredCleanAch = hvacCleanAch + portableAch;
  const totalRemovalAch = infiltrationAch + depositionAch + deliveredCleanAch;

  // Equivalent Clean Air Flow (CFM) from active filtration only (unfiltered envelope infiltration is excluded).
  const effectiveCleanCfm = deliveredCleanAch * volumeFt3 / 60;
  const cfmPerPerson = effectiveCleanCfm / occupants;
  const ashrae241ClassroomTargetCfmPerPerson = 40;

  // Steady-state indoor PM2.5 under constant outdoor concentration:
  // dC/dt = (infiltrationAch * penetrationFactor * C_out) - totalRemovalAch * C_in
  const sourceRate = infiltrationAch * penetrationFactor * outdoorPm25;
  const steadyStatePm25 = totalRemovalAch > 0 ? sourceRate / totalRemovalAch : outdoorPm25;

  // Analytical 0..120 minute curve at 10-min intervals
  const trajectory = [];
  for (let min = 0; min <= 120; min += 10) {
    const tHours = min / 60;
    const cAtT = Number((steadyStatePm25 + (initialIndoorPm25 - steadyStatePm25) * Math.exp(-totalRemovalAch * tHours)).toFixed(1));
    trajectory.push({ minute: min, indoorPm25: cAtT, indoorAqi: pm25ToAqi2024(cAtT).aqi });
  }

  // Units of a fresh selected cleaner needed to reach 5.0 delivered clean ACH.
  // With derates off this is the closed-form nameplate estimate; with derates on we count
  // up until the derated delivery actually meets 5.0 ACH so the advice never under-counts.
  const sizingCleaner = cleaner.cadrCfm > 0 ? cleaner : CLEANER_CATALOG.corsi_box;
  const unitCfm = sizingCleaner.cadrCfm;
  const gapAch5 = Math.max(0, 5.0 - hvacCleanAch);
  let unitsFor5Ach = Math.ceil(((gapAch5 * volumeFt3) / 60) / unitCfm);
  let unitsFor5AchCapped = false;
  if (useDerates) {
    unitsFor5Ach = 0;
    while (unitsFor5Ach <= 64) {
      const d = portableCadrWithDerates(sizingCleaner, unitsFor5Ach, loadFraction);
      if (hvacCleanAch + (d.effectiveCfm * 60) / volumeFt3 >= 5.0) break;
      unitsFor5Ach += 1;
    }
    if (unitsFor5Ach > 64) {
      unitsFor5Ach = 64;
      unitsFor5AchCapped = true;
      warnings.push('5 ACH unit sizing reached the 64-unit feasibility cap');
    }
  }

  const indoorSteadyAqi = pm25ToAqi2024(steadyStatePm25);
  const outdoorAqi = pm25ToAqi2024(outdoorPm25);
  const indoorReductionPct = outdoorPm25 > 0
    ? Number((((outdoorPm25 - steadyStatePm25) / outdoorPm25) * 100).toFixed(1)) : 0;

  // Cost comparison: unit up-front, annual filters, and 3-year total, all engineering assumptions.
  const years = 3;
  const threeYearCostUsd = Number((cleaner.unitCostUsd * cleanerCount + cleaner.annualFilterUsd * cleanerCount * years).toFixed(0));
  const costPerCfm = derates.effectiveCfm > 0
    ? Number((threeYearCostUsd / derates.effectiveCfm).toFixed(2)) : null;
  const costPerStudent = Number((threeYearCostUsd / occupants).toFixed(2));

  return {
    valid: warnings.length === 0,
    inputWarnings: warnings,
    volumeFt3,
    occupants,
    outdoorPm25,
    outdoorAqi,
    hvacCleanAch: Number(hvacCleanAch.toFixed(2)),
    portableAch: Number(portableAch.toFixed(2)),
    deliveredCleanAch: Number(deliveredCleanAch.toFixed(2)),
    totalRemovalAch: Number(totalRemovalAch.toFixed(2)),
    effectiveCleanCfm: Number(effectiveCleanCfm.toFixed(1)),
    cfmPerPerson: Number(cfmPerPerson.toFixed(1)),
    meets5Ach: deliveredCleanAch >= 5.0,
    meetsAshrae241: cfmPerPerson >= ashrae241ClassroomTargetCfmPerPerson,
    unitsFor5Ach,
    unitsFor5AchCapped,
    steadyStatePm25: Number(steadyStatePm25.toFixed(1)),
    indoorSteadyAqi,
    indoorReductionPct,
    trajectory,
    cleanerId: cleaner.id,
    cleanerCount,
    filterLoadFraction: Number(loadFraction.toFixed(4)),
    replacementDue: lifecycle.replacementDue,
    daysRemaining: lifecycle.daysRemaining,
    nameplatePortableCfm: derates.nameplateCfm,
    effectivePortableCfm: derates.effectiveCfm,
    placementFactor: derates.placementFactor,
    loadingFactor: derates.loadingFactor,
    threeYearCostUsd,
    costPerCfm,
    costPerStudent,
    costBasis: 'Modeled engineering assumptions (USD, 3-year horizon). Not a quoted bid or measured school purchase.',
  };
}

/** Compare cleaner options on equivalent delivered CADR, cost, and AQI outcome. */
export function compareCleanerOptions(baseInput = {}) {
  const input = { ...baseInput };
  const options = Object.values(CLEANER_CATALOG);
  return options.map((cleaner) => {
    const result = evaluateClassroomAir({ ...input, cleanerId: cleaner.id, cleanerCount: cleaner.id === 'none' ? 0 : (input.cleanerCount || 1) });
    return {
      id: cleaner.id,
      name: cleaner.name,
      cadrCfm: cleaner.cadrCfm,
      deliveredCleanAch: result.deliveredCleanAch,
      effectivePortableCfm: result.effectivePortableCfm,
      indoorSteadyPm25: result.steadyStatePm25,
      indoorAqi: result.indoorSteadyAqi.aqi,
      costPerCfm: result.costPerCfm,
      costPerStudent: result.costPerStudent,
      threeYearCostUsd: result.threeYearCostUsd,
    };
  });
}

/**
 * School budget projection for equipping N classrooms with one portable unit each.
 * Every field is a modeled assumption, not an actual procurement.
 */
export function schoolBudgetProjection(classroomCount, cleanerId = 'corsi_box') {
  const rooms = Math.max(1, Math.min(MAX_BUDGET_CLASSROOMS, Math.round(finiteOr(classroomCount, 20))));
  const cleaner = CLEANER_CATALOG[cleanerId] || CLEANER_CATALOG.corsi_box;
  const hardware = cleaner.unitCostUsd * rooms;
  const filtersYear1 = cleaner.annualFilterUsd * rooms;
  const filters3Year = filtersYear1 * 3;
  return {
    classroomCount: rooms,
    cleanerId: cleaner.id,
    hardwareUsd: hardware,
    filtersYear1Usd: filtersYear1,
    filters3YearUsd: filters3Year,
    total3YearUsd: hardware + filters3Year,
    perClassroom3YearUsd: hardware / rooms + cleaner.annualFilterUsd * 3,
    projectionNote: 'Engineering projection using catalog assumptions. No school pilot, purchase, or measured outcome is claimed.',
  };
}

export function buildSchoolGuidance(aqiResult, roomResult) {
  const aqiIn = aqiResult && typeof aqiResult === 'object' ? aqiResult : pm25ToAqi2024(0);
  const room = roomResult && typeof roomResult === 'object'
    ? roomResult
    : { deliveredCleanAch: 0, steadyStatePm25: 0, indoorSteadyAqi: pm25ToAqi2024(0) };
  const aqi = aqiIn.aqi;
  let recessAction = 'Normal outdoor recess and PE';
  let sportsAction = 'Full outdoor athletics schedule';
  let asthmaProtocol = 'Standard inhaler availability in nurse office';
  let alertLevel = 'GREEN';

  if (aqi >= 301) {
    alertLevel = 'MAROON';
    recessAction = 'Cancel all outdoor activity; hold students in filtered rooms until conditions drop below Hazardous';
    sportsAction = 'Cancel all outdoor athletics; move any essential conditioning indoors with filtration';
    asthmaProtocol = 'Continuous symptomatic-student monitoring; nurse escalation protocol active';
  } else if (aqi >= 201) {
    alertLevel = 'PURPLE';
    recessAction = 'Cancel all outdoor recess; keep students inside filtered rooms';
    sportsAction = 'Cancel or postpone outdoor practices and games';
    asthmaProtocol = 'Monitor symptomatic students continuously; deploy HEPA rooms';
  } else if (aqi >= 151) {
    alertLevel = 'RED';
    recessAction = 'Move recess indoors to rooms with >= 5 ACH filtration';
    sportsAction = 'Move practices indoors or cancel vigorous outdoor exertion';
    asthmaProtocol = 'Keep sensitive/asthma students indoors; notify nurse and parents';
  } else if (aqi >= 101) {
    alertLevel = 'ORANGE';
    recessAction = 'Shorten vigorous outdoor play; offer filtered indoor quiet room';
    sportsAction = 'Add frequent water/rest breaks; relocate high-exertion drills indoors';
    asthmaProtocol = 'Restrict prolonged exertion for students with asthma or cardiac plans';
  } else if (aqi >= 51) {
    alertLevel = 'YELLOW';
    recessAction = 'Outdoor recess allowed; watch sensitive students for coughing';
    sportsAction = 'Normal outdoor athletics with hydration breaks';
    asthmaProtocol = 'Allow unusually sensitive students indoor option on request';
  }

  const aqiText = aqiIn.beyondIndex ? '500+' : String(aqi);
  const enNotice =
    `[${alertLevel} - AQI ${aqiText} (${aqiIn.category})] School Clean Air Update: ${recessAction}. `
    + `Filtered classroom mode delivers ${room.deliveredCleanAch} clean ACH `
    + `(modeled steady-state indoor PM2.5 ${room.steadyStatePm25} ug/m3, AQI ${room.indoorSteadyAqi.aqi}).`;

  const esNotice =
    `[${alertLevel} - ICA ${aqiText}] Aviso Escolar de Aire Limpio: ${
      aqi >= 151
        ? 'El recreo y las prácticas deportivas pasan al interior con filtración.'
        : aqi >= 101
          ? 'Se acorta la actividad intensa al aire libre y se ofrece salón interior filtrado.'
          : 'Actividades al aire libre permitidas con vigilancia para estudiantes con asma.'
    } La filtración del salón entrega ${room.deliveredCleanAch} cambios/hora.`;

  return { alertLevel, recessAction, sportsAction, asthmaProtocol, enNotice, esNotice };
}
