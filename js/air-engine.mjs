/**
 * CleanAirSchool pure physics and EPA 2024 AQI engine.
 * Implements:
 *  1) US EPA 2024 Revised PM2.5 AQI Breakpoints (40 CFR Part 58, effective May 2024)
 *  2) US EPA 12-hour NowCast weighted concentration algorithm
 *  3) Single-compartment classroom indoor PM2.5 mass-balance + ASHRAE 241 ECAi sizing
 *  4) School recess / PE / athletics / asthma-care guidance + EN/ES parent alerts
 *
 * All classroom dimensions, HVAC filters, and hourly concentrations are explicit model inputs;
 * no live sensor feed or medical diagnosis is claimed.
 */

export const EPA_PM25_2024_BREAKPOINTS = Object.freeze([
  { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50, category: 'Good', color: '#15803d', key: 'good' },
  { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100, category: 'Moderate', color: '#ca8a04', key: 'moderate' },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, category: 'Unhealthy for Sensitive Groups', color: '#ea580c', key: 'usg' },
  { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200, category: 'Unhealthy', color: '#dc2626', key: 'unhealthy' },
  { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300, category: 'Very Unhealthy', color: '#7e22ce', key: 'very_unhealthy' },
  { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 400, category: 'Hazardous', color: '#7f1d1d', key: 'hazardous' },
  { cLow: 325.5, cHigh: 500.4, iLow: 401, iHigh: 500, category: 'Hazardous', color: '#7f1d1d', key: 'hazardous' },
]);

export const CLEANER_CATALOG = Object.freeze({
  none: { id: 'none', name: 'No Portable Cleaner', cadrCfm: 0 },
  corsi_box: { id: 'corsi_box', name: 'Corsi-Rosenthal 4x MERV-13 Box', cadrCfm: 380 },
  classroom_hepa: { id: 'classroom_hepa', name: 'Classroom True-HEPA Tower', cadrCfm: 260 },
  gym_commercial: { id: 'gym_commercial', name: 'Commercial HEPA Scrubber', cadrCfm: 650 },
});

export const MERV_REMOVAL_EFF = Object.freeze({
  merv8: 0.2,
  merv11: 0.5,
  merv13: 0.85,
  merv16: 0.95,
});

/**
 * Compute US EPA 2024 PM2.5 AQI from concentration (ug/m3, truncated to 0.1).
 */
export function pm25ToAqi2024(pm25Raw) {
  const c = Math.max(0, Math.floor(Number(pm25Raw || 0) * 10) / 10);
  const clamped = Math.min(500.4, c);
  for (const bp of EPA_PM25_2024_BREAKPOINTS) {
    if (clamped >= bp.cLow && clamped <= bp.cHigh) {
      const aqi = Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (clamped - bp.cLow) + bp.iLow);
      return { pm25: c, aqi, category: bp.category, key: bp.key, color: bp.color };
    }
  }
  const last = EPA_PM25_2024_BREAKPOINTS[EPA_PM25_2024_BREAKPOINTS.length - 1];
  return { pm25: c, aqi: 500, category: last.category, key: last.key, color: last.color };
}

/**
 * Compute US EPA 12-hour NowCast weighted PM2.5 from hourly array [oldest ... newest].
 * Uses standard EPA weight factor w* = max(0.5, 1 - range/max).
 * Returns null if fewer than 2 of the latest 3 hours are valid.
 */
export function computeEpaNowCast(hourlySeries) {
  const arr = (Array.isArray(hourlySeries) ? hourlySeries : []).slice(-12);
  if (arr.length === 0) return null;
  const recent3 = arr.slice(-3).filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (recent3.length < 2) return null;

  const valid = arr.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
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
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) continue;
    const w = Math.pow(wStar, idx);
    weightedSum += val * w;
    weightTotal += w;
  }
  const nowCastPm25 = Math.floor((weightedSum / weightTotal) * 10) / 10;
  return {
    nowCastPm25,
    weightFactor: Number(wStar.toFixed(4)),
    ...pm25ToAqi2024(nowCastPm25),
  };
}

/**
 * Single-compartment well-mixed classroom PM2.5 decay & ASHRAE 241 ECAi sizing.
 * - Volume V = lengthFt * widthFt * heightFt (ft3)
 * - Outdoor infiltration rate lambda_inf (h^-1), envelope penetration factor p_env (0.75 default)
 * - HVAC recirculation clean airflow = hvacAch * mervEff * V / 60 (CFM)
 * - Portable CADR = cleanerCount * cleaner.cadrCfm (CFM)
 * - Surface deposition k_dep = 0.20 h^-1 (PM2.5 indoor settling, used only for decay mass balance)
 */
export function evaluateClassroomAir(input) {
  const lengthFt = Math.max(10, Number(input.lengthFt ?? 30));
  const widthFt = Math.max(10, Number(input.widthFt ?? 28));
  const heightFt = Math.max(8, Number(input.heightFt ?? 10));
  const volumeFt3 = lengthFt * widthFt * heightFt;

  const occupants = Math.max(1, Math.round(Number(input.occupants ?? 26)));
  const outdoorPm25 = Math.max(0, Number(input.outdoorPm25 ?? 45));
  const initialIndoorPm25 = Math.max(0, Number(input.initialIndoorPm25 ?? outdoorPm25 * 0.72));
  const infiltrationAch = Math.max(0.1, Number(input.infiltrationAch ?? 0.45));
  const penetrationFactor = Math.min(1, Math.max(0.1, Number(input.penetrationFactor ?? 0.75)));
  const hvacAch = Math.max(0, Number(input.hvacAch ?? 3.0));
  const mervKey = MERV_REMOVAL_EFF[input.mervRating] !== undefined ? input.mervRating : 'merv11';
  const mervEff = MERV_REMOVAL_EFF[mervKey];
  const cleaner = CLEANER_CATALOG[input.cleanerId] || CLEANER_CATALOG.corsi_box;
  const cleanerCount = Math.max(0, Math.round(Number(input.cleanerCount ?? 1)));

  const depositionAch = 0.2;
  const hvacCleanAch = hvacAch * mervEff;
  const portableCfm = cleaner.cadrCfm * cleanerCount;
  const portableAch = (portableCfm * 60) / volumeFt3;
  const deliveredCleanAch = hvacCleanAch + portableAch;
  const totalRemovalAch = infiltrationAch + depositionAch + deliveredCleanAch;

  // Equivalent Clean Air Flow (CFM) from active filtration only (unfiltered envelope infiltration is excluded).
  const effectiveCleanCfm = (deliveredCleanAch * volumeFt3) / 60;
  const cfmPerPerson = effectiveCleanCfm / occupants;
  const ashrae241ClassroomTargetCfmPerPerson = 40; // ASHRAE Standard 241 classroom ECAi target

  // Steady-state indoor PM2.5 under constant outdoor concentration:
  // dC/dt = (infiltrationAch * penetrationFactor * C_out) - totalRemovalAch * C_in
  const sourceRate = infiltrationAch * penetrationFactor * outdoorPm25;
  const steadyStatePm25 = totalRemovalAch > 0 ? sourceRate / totalRemovalAch : outdoorPm25;

  // Analytical 0..120 minute curve at 10-min intervals
  const trajectory = [];
  for (let min = 0; min <= 120; min += 10) {
    const tHours = min / 60;
    const cAtT = steadyStatePm25 + (initialIndoorPm25 - steadyStatePm25) * Math.exp(-totalRemovalAch * tHours);
    trajectory.push({
      minute: min,
      indoorPm25: Number(cAtT.toFixed(1)),
      indoorAqi: pm25ToAqi2024(cAtT).aqi,
    });
  }

  // How many portable units of selected type (or Corsi-Rosenthal fallback) to reach 5.0 delivered clean ACH?
  const unitCfm = cleaner.cadrCfm > 0 ? cleaner.cadrCfm : CLEANER_CATALOG.corsi_box.cadrCfm;
  const gapAch5 = Math.max(0, 5.0 - hvacCleanAch);
  const unitsFor5Ach = Math.ceil(((gapAch5 * volumeFt3) / 60) / unitCfm);

  const indoorSteadyAqi = pm25ToAqi2024(steadyStatePm25);
  const outdoorAqi = pm25ToAqi2024(outdoorPm25);
  const indoorReductionPct = outdoorPm25 > 0
    ? Number((((outdoorPm25 - steadyStatePm25) / outdoorPm25) * 100).toFixed(1))
    : 0;

  return {
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
    steadyStatePm25: Number(steadyStatePm25.toFixed(1)),
    indoorSteadyAqi,
    indoorReductionPct,
    trajectory,
  };
}

export function buildSchoolGuidance(aqiResult, roomResult) {
  const aqi = aqiResult.aqi;
  let recessAction = 'Normal outdoor recess and PE';
  let sportsAction = 'Full outdoor athletics schedule';
  let asthmaProtocol = 'Standard inhaler availability in nurse office';
  let alertLevel = 'GREEN';

  if (aqi >= 201) {
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

  const enNotice =
    `[${alertLevel} - AQI ${aqi} (${aqiResult.category})] School Clean Air Update: ${recessAction}. `
    + `Filtered classroom mode achieves ${roomResult.totalRemovalAch} ACH `
    + `(modeled steady-state indoor PM2.5 ${roomResult.steadyStatePm25} ug/m3, AQI ${roomResult.indoorSteadyAqi.aqi}).`;

  const esNotice =
    `[${alertLevel} - ICA ${aqi}] Aviso Escolar de Aire Limpio: ${
      aqi >= 151
        ? 'El recreo y las practicas deportivas pasan al interior con filtracion.'
        : aqi >= 101
          ? 'Se acorta la actividad intensa al aire libre y se ofrece salon interior filtrado.'
          : 'Actividades al aire libre permitidas con vigilancia para estudiantes con asma.'
    } La ventilacion del salon alcanza ${roomResult.totalRemovalAch} cambios/hora.`;

  return { alertLevel, recessAction, sportsAction, asthmaProtocol, enNotice, esNotice };
}
