/**
 * CleanAirSchool Fleet Retrofit & Lifecycle Resilience Lab.
 *
 * Pure-JS deterministic module (zero dependencies) that compares five modeled
 * classroom retrofit strategies across four outdoor PM2.5 smoke regimes by
 * evaluating every combination directly through js/air-engine.mjs.
 *
 * Contents:
 *  1) Smoke regime and retrofit strategy catalogs
 *  2) FIPS 180-4 SHA-256 implementation used for the audited school-air brief
 *  3) #cas= URL-hash bookmark codec (fail-closed, hasOwnProperty guarded)
 *  4) Fleet evaluation model (steady state, decay, lifecycle floor, Pareto, cost)
 *  5) Audited exporters (JSON, formula-safe CSV, Markdown) with one cached
 *     digest-stamped payload per canonical state key
 *  6) In-page deterministic self-test runner
 *  7) DOM initializer (no-ops cleanly when markup or module is absent)
 *
 * All outputs are modeled engineering projections. No live sensor feed,
 * measured school pilot, purchase, or medical outcome is claimed.
 */

import {
  pm25ToAqi2024,
  computeEpaNowCast,
  evaluateClassroomAir,
  portableCadrWithDerates,
  CLEANER_CATALOG,
  LOADED_FILTER_CADR_FRACTION,
  ADDITIONAL_UNIT_EFFICIENCY,
} from './air-engine.mjs';

/* ------------------------------------------------------------------ */
/* 1) Catalogs                                                         */
/* ------------------------------------------------------------------ */

/** Four outdoor PM2.5 smoke regimes used as constant outdoor concentrations. */
export const SMOKE_REGIMES = Object.freeze({
  'moderate-20': Object.freeze({ id: 'moderate-20', label: 'Moderate smoke', outdoorPm25: 20 }),
  'usg-45': Object.freeze({ id: 'usg-45', label: 'Sensitive-groups smoke', outdoorPm25: 45 }),
  'wildfire-85': Object.freeze({ id: 'wildfire-85', label: 'Wildfire plume', outdoorPm25: 85 }),
  'hazardous-260': Object.freeze({ id: 'hazardous-260', label: 'Hazardous plume', outdoorPm25: 260 }),
});

/**
 * Five retrofit strategies. Fleet strategies are sized so the fresh-filter
 * configuration delivers at least 5.0 delivered clean ACH in the reference
 * classroom. hvacUpgradeAnnualUsd is the modeled incremental per-classroom
 * annual cost of stepping the central filter grade up (engineering assumption).
 */
export const FLEET_STRATEGIES = Object.freeze([
  Object.freeze({
    id: 'merv8-baseline', name: 'MERV 8 status quo',
    mervRating: 'merv8', cleanerId: 'none', hvacUpgradeAnnualUsd: 0,
    note: 'No portable units; existing minimum-efficiency HVAC filter.',
  }),
  Object.freeze({
    id: 'merv13-hvac', name: 'MERV 13 central upgrade',
    mervRating: 'merv13', cleanerId: 'none', hvacUpgradeAnnualUsd: 160,
    note: 'Central filter grade raised; no portable units.',
  }),
  Object.freeze({
    id: 'cr-box-fleet', name: 'Corsi-Rosenthal box fleet',
    mervRating: 'merv11', cleanerId: 'corsi_box', hvacUpgradeAnnualUsd: 0,
    note: 'DIY MERV-13 box cleaners sized to 5.0 clean ACH.',
  }),
  Object.freeze({
    id: 'classroom-hepa-fleet', name: 'Classroom HEPA tower fleet',
    mervRating: 'merv11', cleanerId: 'classroom_hepa', hvacUpgradeAnnualUsd: 0,
    note: 'Commercial classroom HEPA towers sized to 5.0 clean ACH.',
  }),
  Object.freeze({
    id: 'hybrid-merv13-cr', name: 'MERV 13 + CR box hybrid',
    mervRating: 'merv13', cleanerId: 'corsi_box', hvacUpgradeAnnualUsd: 160,
    note: 'Central upgrade plus fewer CR boxes to reach 5.0 clean ACH.',
  }),
]);

/** Reference classroom shared by every strategy so rows are comparable. */
export const FLEET_ROOM = Object.freeze({
  lengthFt: 30,
  widthFt: 28,
  heightFt: 10,
  infiltrationAch: 0.45,
  penetrationFactor: 0.75,
  hvacAch: 3.0,
});

export const FLEET_DEFAULTS = Object.freeze({
  regime: 'wildfire-85',
  classroomCount: 20,
  studentsPerRoom: 26,
  filterAgeDays: 0,
  applyDerates: true,
  strategy: 'cr-box-fleet',
});

export const FLEET_LIMITS = Object.freeze({
  classroomCount: { min: 1, max: 100 },
  studentsPerRoom: { min: 1, max: 60 },
  filterAgeDays: { min: 0, max: 3650 },
});

export const ASHRAE_241_CLASSROOM_CFMP = 40;

/* ------------------------------------------------------------------ */
/* 2) FIPS 180-4 SHA-256 (pure JS, no dependency)                      */
/* ------------------------------------------------------------------ */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr32(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Compute lowercase hex SHA-256 of a string or Uint8Array. */
export function sha256Hex(message) {
  const bytes = message instanceof Uint8Array ? message : new TextEncoder().encode(String(message));
  const bitLenHi = Math.floor(bytes.length / 0x20000000);
  const bitLenLo = (bytes.length * 8) >>> 0;
  const totalLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(totalLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(totalLen - 8, bitLenHi);
  dv.setUint32(totalLen - 4, bitLenLo);

  const H = new Uint32Array(SHA256_H0);
  const w = new Uint32Array(64);
  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0');
  return out;
}

/** Deterministic JSON: recursively sorts object keys so digests are stable. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/* ------------------------------------------------------------------ */
/* 3) #cas= bookmark codec                                             */
/* ------------------------------------------------------------------ */

const CAS_KEYS = Object.freeze({
  r: 'regime',
  n: 'classroomCount',
  s: 'studentsPerRoom',
  d: 'filterAgeDays',
  x: 'applyDerates',
  t: 'strategy',
});

const INT_RE = /^-?\d+$/;

/** Coerce state input into the canonical normalized shape, clamping ranges. */
export function normalizeFleetState(input) {
  const src = input && typeof input === 'object' ? input : {};
  const pick = (key) => (Object.prototype.hasOwnProperty.call(src, key) ? src[key] : undefined);
  const clampInt = (value, fallback, min, max) => {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const regime = Object.prototype.hasOwnProperty.call(SMOKE_REGIMES, pick('regime')) ? pick('regime') : FLEET_DEFAULTS.regime;
  const strategy = FLEET_STRATEGIES.some((s) => s.id === pick('strategy')) ? pick('strategy') : FLEET_DEFAULTS.strategy;
  return {
    regime,
    classroomCount: clampInt(pick('classroomCount'), FLEET_DEFAULTS.classroomCount, FLEET_LIMITS.classroomCount.min, FLEET_LIMITS.classroomCount.max),
    studentsPerRoom: clampInt(pick('studentsPerRoom'), FLEET_DEFAULTS.studentsPerRoom, FLEET_LIMITS.studentsPerRoom.min, FLEET_LIMITS.studentsPerRoom.max),
    filterAgeDays: clampInt(pick('filterAgeDays'), FLEET_DEFAULTS.filterAgeDays, FLEET_LIMITS.filterAgeDays.min, FLEET_LIMITS.filterAgeDays.max),
    applyDerates: pick('applyDerates') === undefined ? FLEET_DEFAULTS.applyDerates : pick('applyDerates') === true,
    strategy,
  };
}

/** Encode a normalized state into the canonical `#cas=` bookmark fragment. */
export function encodeCasHash(stateInput) {
  const s = normalizeFleetState(stateInput);
  const params = [
    ['r', s.regime],
    ['n', String(s.classroomCount)],
    ['s', String(s.studentsPerRoom)],
    ['d', String(s.filterAgeDays)],
    ['x', s.applyDerates ? '1' : '0'],
    ['t', s.strategy],
  ];
  return `#cas=${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * Decode a `#cas=` hash. Returns null on any malformed or hostile input so the
 * caller falls back to defaults; never throws, never partially applies.
 */
export function decodeCasHash(hash) {
  if (typeof hash !== 'string') return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('cas=')) return null;
  const body = raw.slice(4);
  if (body === '') return null;
  const seen = Object.create(null);
  const parts = body.split('&');
  if (parts.length > CAS_KEY_COUNT()) return null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    if (!Object.prototype.hasOwnProperty.call(CAS_KEYS, key)) return null;
    if (Object.prototype.hasOwnProperty.call(seen, key)) return null;
    seen[key] = true;
    let val;
    try {
      val = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
    const field = CAS_KEYS[key];
    if (field === 'regime') {
      if (!Object.prototype.hasOwnProperty.call(SMOKE_REGIMES, val)) return null;
    } else if (field === 'strategy') {
      if (!FLEET_STRATEGIES.some((s) => s.id === val)) return null;
    } else if (field === 'applyDerates') {
      if (val !== '0' && val !== '1') return null;
    } else {
      if (!INT_RE.test(val)) return null;
    }
    seen[key] = val;
  }
  const state = {};
  for (const [k, field] of Object.entries(CAS_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(seen, k)) continue;
    const val = seen[k];
    if (field === 'applyDerates') state.applyDerates = val === '1';
    else if (field === 'regime' || field === 'strategy') state[field] = val;
    else state[field] = Number(val);
  }
  return normalizeFleetState(state);
}

function CAS_KEY_COUNT() {
  return Object.keys(CAS_KEYS).length;
}

/* ------------------------------------------------------------------ */
/* 4) Fleet evaluation model                                           */
/* ------------------------------------------------------------------ */

function engineInputFor(strategy, state, overrides = {}) {
  return {
    ...FLEET_ROOM,
    occupants: state.studentsPerRoom,
    outdoorPm25: SMOKE_REGIMES[state.regime].outdoorPm25,
    mervRating: strategy.mervRating,
    cleanerId: strategy.cleanerId,
    cleanerCount: overrides.cleanerCount !== undefined ? overrides.cleanerCount : 0,
    applyDerates: overrides.applyDerates !== undefined ? overrides.applyDerates : state.applyDerates,
    daysSinceReplacement: overrides.daysSinceReplacement !== undefined ? overrides.daysSinceReplacement : state.filterAgeDays,
    filterLoadFraction: overrides.filterLoadFraction,
  };
}

/** Fresh-filter fleet size (units per classroom) needed to reach 5.0 clean ACH. */
function fleetUnitsFor5Ach(strategy, state) {
  if (strategy.cleanerId === 'none') {
    const probe = evaluateClassroomAir(engineInputFor(strategy, state, {
      cleanerCount: 0, daysSinceReplacement: 0, filterLoadFraction: 0, applyDerates: state.applyDerates,
    }));
    return probe.unitsFor5Ach;
  }
  const probe = evaluateClassroomAir(engineInputFor(strategy, state, {
    cleanerId: strategy.cleanerId, cleanerCount: 1, daysSinceReplacement: 0, filterLoadFraction: 0,
  }));
  return probe.unitsFor5Ach;
}

/**
 * Evaluate the full 5-strategy x 4-regime comparator plus lifecycle floors,
 * 120-minute trajectories for the selected regime, the cost-vs-ACH Pareto
 * frontier, and the 3-year school-wide budget for `state.classroomCount` rooms.
 */
export function evaluateFleetLab(stateInput) {
  const state = normalizeFleetState(stateInput);
  const regimeKeys = Object.keys(SMOKE_REGIMES);
  const strategies = [];

  for (const strategy of FLEET_STRATEGIES) {
    const isFleet = strategy.cleanerId !== 'none';
    const unitsFor5 = isFleet
      ? Math.max(1, fleetUnitsFor5Ach(strategy, state))
      : fleetUnitsFor5Ach(strategy, state);
    const configuredCount = isFleet ? unitsFor5 : 0;

    const fresh = evaluateClassroomAir(engineInputFor(strategy, state, { cleanerCount: configuredCount }));
    const eol = evaluateClassroomAir(engineInputFor(strategy, state, {
      cleanerCount: configuredCount, applyDerates: true, filterLoadFraction: 1,
    }));

    const cleaner = CLEANER_CATALOG[strategy.cleanerId] || CLEANER_CATALOG.none;
    const perRoomHardwareUsd = cleaner.unitCostUsd * configuredCount;
    const perRoomFilters3YearUsd = cleaner.annualFilterUsd * configuredCount * 3;
    const perRoomHvac3YearUsd = strategy.hvacUpgradeAnnualUsd * 3;
    const perRoom3YearUsd = perRoomHardwareUsd + perRoomFilters3YearUsd + perRoomHvac3YearUsd;
    const school3YearUsd = perRoom3YearUsd * state.classroomCount;
    const costPerStudentUsd = Number((school3YearUsd / (state.classroomCount * state.studentsPerRoom)).toFixed(2));

    const byRegime = {};
    for (const rk of regimeKeys) {
      const r = evaluateClassroomAir({ ...engineInputFor(strategy, state, { cleanerCount: configuredCount }), outdoorPm25: SMOKE_REGIMES[rk].outdoorPm25 });
      const displayAqi = pm25ToAqi2024(r.steadyStatePm25);
      byRegime[rk] = {
        steadyStatePm25: r.steadyStatePm25,
        indoorAqi: displayAqi.aqi,
        indoorAqiCategory: displayAqi.category,
        indoorReductionPct: r.indoorReductionPct,
      };
    }

    strategies.push({
      id: strategy.id,
      name: strategy.name,
      note: strategy.note,
      mervRating: strategy.mervRating,
      cleanerId: strategy.cleanerId,
      cleanerCount: configuredCount,
      unitsFor5Ach: unitsFor5,
      deliveredCleanAch: fresh.deliveredCleanAch,
      cfmPerPerson: fresh.cfmPerPerson,
      meetsAshrae241: fresh.meetsAshrae241,
      meets5Ach: fresh.meets5Ach,
      eolCleanAch: eol.deliveredCleanAch,
      eolCfmPerPerson: eol.cfmPerPerson,
      eolMeetsAshrae241: eol.meetsAshrae241,
      placementFactor: fresh.placementFactor,
      loadingFactor: fresh.loadingFactor,
      filterLoadFraction: fresh.filterLoadFraction,
      replacementDue: fresh.replacementDue,
      perRoom3YearUsd: Number(perRoom3YearUsd.toFixed(2)),
      school3YearUsd: Number(school3YearUsd.toFixed(2)),
      costPerStudentUsd,
      byRegime,
    });
  }

  const regime = SMOKE_REGIMES[state.regime];
  const outdoorAqi = pm25ToAqi2024(regime.outdoorPm25);
  const decay = strategies.map((s) => {
    const strategy = FLEET_STRATEGIES.find((x) => x.id === s.id);
    const r = evaluateClassroomAir(engineInputFor(strategy, state, { cleanerCount: s.cleanerCount }));
    return { strategyId: s.id, name: s.name, points: r.trajectory };
  });

  const paretoPoints = strategies.map((s) => ({
    strategyId: s.id,
    name: s.name,
    cleanAch: s.deliveredCleanAch,
    school3YearUsd: s.school3YearUsd,
  }));
  // Pareto frontier for "more clean ACH at less cost": scan descending ACH and
  // keep each point that is cheaper than everything with equal or higher ACH.
  const sortedDesc = [...paretoPoints].sort((a, b) => (b.cleanAch - a.cleanAch) || (a.school3YearUsd - b.school3YearUsd));
  const frontier = [];
  let bestCost = Infinity;
  for (const p of sortedDesc) {
    if (p.school3YearUsd < bestCost) {
      frontier.push(p);
      bestCost = p.school3YearUsd;
    }
  }
  frontier.reverse();
  const ashrae241EquivAch = Number(((ASHRAE_241_CLASSROOM_CFMP * state.studentsPerRoom * 60) / freshVolumeFt3()).toFixed(2));

  return {
    state,
    room: { ...FLEET_ROOM, volumeFt3: freshVolumeFt3(), occupants: state.studentsPerRoom },
    regimes: regimeKeys.map((rk) => ({
      id: rk,
      label: SMOKE_REGIMES[rk].label,
      outdoorPm25: SMOKE_REGIMES[rk].outdoorPm25,
      aqi: pm25ToAqi2024(SMOKE_REGIMES[rk].outdoorPm25).aqi,
      category: pm25ToAqi2024(SMOKE_REGIMES[rk].outdoorPm25).category,
    })),
    selectedRegime: {
      id: regime.id,
      label: regime.label,
      outdoorPm25: regime.outdoorPm25,
      outdoorAqi: outdoorAqi.aqi,
      outdoorCategory: outdoorAqi.category,
    },
    strategies,
    decay,
    pareto: { points: paretoPoints, frontier, ashrae241EquivAch },
  };
}

function freshVolumeFt3() {
  return FLEET_ROOM.lengthFt * FLEET_ROOM.widthFt * FLEET_ROOM.heightFt;
}

/* ------------------------------------------------------------------ */
/* 5) Audited exporters with cached digest-stamped payload             */
/* ------------------------------------------------------------------ */

const briefCache = new Map();

/** One canonical digest-stamped payload per normalized state key. */
export function auditedFleetBrief(stateInput, now = new Date()) {
  const state = normalizeFleetState(stateInput);
  const key = encodeCasHash(state);
  if (briefCache.has(key)) return briefCache.get(key);
  const model = evaluateFleetLab(state);
  const payload = {
    format: 'cas-fleet-brief-v1',
    tool: 'CleanAirSchool',
    lab: 'fleet-retrofit-lifecycle',
    generatedUtc: now.toISOString(),
    scope: 'Modeled engineering projection from EPA 2024 breakpoints, 12-hour NowCast inputs held constant, and a single-compartment mass-balance classroom model. Not a live sensor feed, measured school pilot, procurement record, or medical advice.',
    state,
    room: model.room,
    selectedRegime: model.selectedRegime,
    regimes: model.regimes,
    strategies: model.strategies,
    pareto: model.pareto,
    assumptions: [
      `Reference classroom ${FLEET_ROOM.lengthFt}x${FLEET_ROOM.widthFt}x${FLEET_ROOM.heightFt} ft, infiltration ${FLEET_ROOM.infiltrationAch} h^-1, envelope penetration ${FLEET_ROOM.penetrationFactor}, HVAC ${FLEET_ROOM.hvacAch} ACH.`,
      `Fleet strategies are sized to 5.0 delivered clean ACH with fresh filters; end-of-life rows apply the ${LOADED_FILTER_CADR_FRACTION} loaded-filter CADR fraction.`,
      `Additional-unit placement factor ${ADDITIONAL_UNIT_EFFICIENCY}; ASHRAE 241 classroom target ${ASHRAE_241_CLASSROOM_CFMP} CFM/person.`,
      'Costs are 3-year engineering assumptions in USD, not vendor quotes or purchases.',
    ],
  };
  const digest = sha256Hex(canonicalJson(payload));
  const brief = { payload, digest };
  briefCache.set(key, brief);
  return brief;
}

/** Verify a payload object against its stamped digest. */
export function verifyFleetBrief(payload, digest) {
  if (!payload || typeof payload !== 'object' || typeof digest !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(digest)) return false;
  return sha256Hex(canonicalJson(payload)) === digest;
}

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Formula-safe CSV: provenance comment lines plus one row per strategy. */
export function fleetBriefCsv(brief) {
  const { payload, digest } = brief;
  const lines = [
    '# CleanAirSchool fleet retrofit brief (modeled engineering projection)',
    `# sha256: ${digest}`,
    `# generatedUtc: ${payload.generatedUtc}`,
    `# regime: ${payload.state.regime} | classrooms: ${payload.state.classroomCount} | studentsPerRoom: ${payload.state.studentsPerRoom} | filterAgeDays: ${payload.state.filterAgeDays} | applyDerates: ${payload.state.applyDerates}`,
    [
      'strategy', 'merv', 'cleaner', 'units_per_room', 'clean_ach_fresh', 'clean_ach_end_of_life',
      'cfm_per_person', 'meets_ashrae_241', 'indoor_pm25_steady', 'indoor_aqi', 'indoor_aqi_category',
      'per_room_3yr_usd', 'school_3yr_usd', 'cost_per_student_usd',
    ].map(csvCell).join(','),
  ];
  const regime = payload.state.regime;
  for (const s of payload.strategies) {
    const rr = s.byRegime[regime];
    lines.push([
      s.id, s.mervRating, s.cleanerId, s.cleanerCount, s.deliveredCleanAch, s.eolCleanAch,
      s.cfmPerPerson, s.meetsAshrae241 ? 'yes' : 'no', rr.steadyStatePm25, rr.indoorAqi,
      rr.indoorAqiCategory, s.perRoom3YearUsd, s.school3YearUsd, s.costPerStudentUsd,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Markdown brief: state block, comparator table, footer digest. */
export function fleetBriefMarkdown(brief) {
  const { payload, digest } = brief;
  const s = payload.state;
  const lines = [
    '# CleanAirSchool Fleet Retrofit Brief',
    '',
    'Modeled engineering projection. No live sensor feed, measured school pilot, purchase, or medical advice.',
    '',
    `- Regime: ${payload.selectedRegime.label} (outdoor ${payload.selectedRegime.outdoorPm25} ug/m3, AQI ${payload.selectedRegime.outdoorAqi} ${payload.selectedRegime.outdoorCategory})`,
    `- Classrooms: ${s.classroomCount} | Students per room: ${s.studentsPerRoom} | Filter age: ${s.filterAgeDays} days | Derates: ${s.applyDerates ? 'on' : 'off'}`,
    `- Generated (UTC): ${payload.generatedUtc}`,
    '',
    '| Strategy | Units/room | Clean ACH (fresh) | Clean ACH (end of life) | Indoor PM2.5 | Indoor AQI | CFM/person | ASHRAE 241 | School 3-yr USD | USD/student |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const st of payload.strategies) {
    const rr = st.byRegime[s.regime];
    lines.push(`| ${st.name} | ${st.cleanerCount} | ${st.deliveredCleanAch} | ${st.eolCleanAch} | ${rr.steadyStatePm25} | ${rr.indoorAqi} (${rr.indoorAqiCategory}) | ${st.cfmPerPerson} | ${st.meetsAshrae241 ? 'meets' : 'below'} | ${st.school3YearUsd} | ${st.costPerStudentUsd} |`);
  }
  lines.push('', `SHA-256 integrity digest: ${digest}`, '');
  return lines.join('\n');
}

/** JSON brief text with the stamped digest embedded. */
export function fleetBriefJson(brief) {
  return JSON.stringify({ ...brief.payload, sha256: brief.digest }, null, 2);
}

/* ------------------------------------------------------------------ */
/* 6) In-page deterministic self-tests                                 */
/* ------------------------------------------------------------------ */

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

export function runFleetSelfTests() {
  const out = [];
  const t = (name, fn) => {
    try {
      const detail = fn();
      out.push({ name, pass: true, detail: detail || '' });
    } catch (err) {
      out.push({ name, pass: false, detail: String(err && err.message ? err.message : err).slice(0, 160) });
    }
  };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'mismatch'}: ${a} !== ${b}`); return `${a}`; };

  t('SHA-256 empty-string KAT', () => eq(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  t('SHA-256 "abc" KAT', () => eq(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  t('SHA-256 quick-brown-fox KAT', () => eq(sha256Hex('The quick brown fox jumps over the lazy dog'), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'));
  t('SHA-256 multi-block KAT', () => eq(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'));
  t('EPA Good tier edge 9.0 -> AQI 50', () => eq(pm25ToAqi2024(9.0).aqi, 50));
  t('EPA Moderate edge 35.4 -> AQI 100', () => eq(pm25ToAqi2024(35.4).aqi, 100));
  t('EPA USG edge 55.4 -> AQI 150', () => eq(pm25ToAqi2024(55.4).aqi, 150));
  t('EPA Unhealthy edge 125.4 -> AQI 200', () => eq(pm25ToAqi2024(125.4).aqi, 200));
  t('EPA Very Unhealthy edge 225.4 -> AQI 300', () => eq(pm25ToAqi2024(225.4).aqi, 300));
  t('EPA Hazardous edge 325.4 -> AQI 500', () => eq(pm25ToAqi2024(325.4).aqi, 500));
  t('EPA Beyond Index above 325.4', () => { const r = pm25ToAqi2024(325.5); if (!r.beyondIndex || r.aqi !== 500) throw new Error('beyond-index flag missing'); return 'beyondIndex true, AQI 500'; });
  t('NowCast weight within [0.5, 1.0]', () => {
    for (const series of [[5, 5, 5, 5, 5], [10, 20, 40, 90, 200], [0, 0, 0, 0, 500], [50, 49, 48, 50, 51]]) {
      const r = computeEpaNowCast(series);
      if (r && (r.weightFactor < 0.5 || r.weightFactor > 1)) throw new Error(`w* ${r.weightFactor} out of bounds`);
    }
    return 'bounds hold';
  });
  t('NowCast weight floors at 0.5 on extreme spike', () => eq(computeEpaNowCast([5, 5, 5, 5, 500]).weightFactor, 0.5));
  t('Decay converges monotonically to steady state', () => {
    const m = evaluateFleetLab({ regime: 'wildfire-85' });
    for (const curve of m.decay) {
      for (let i = 1; i < curve.points.length; i++) {
        if (curve.points[i].indoorPm25 > curve.points[i - 1].indoorPm25 + 0.05) throw new Error(`${curve.strategyId} non-monotonic at minute ${curve.points[i].minute}`);
      }
      const last = curve.points[curve.points.length - 1].indoorPm25;
      const first = curve.points[0].indoorPm25;
      const steady = m.strategies.find((s) => s.id === curve.strategyId).byRegime['wildfire-85'].steadyStatePm25;
      const remaining = Math.abs(last - steady);
      const span = Math.abs(first - steady);
      if (remaining > Math.max(0.35 * span, 0.3)) throw new Error(`${curve.strategyId} did not converge (${last} vs ${steady})`);
    }
    return 'monotonic + converged';
  });
  t('ASHRAE 241 verdict exact at 40 CFM/person boundary', () => {
    const room = { lengthFt: 10, widthFt: 10, heightFt: 8, occupants: 1, hvacAch: 6, infiltrationAch: 0.45, mervRating: 'merv11', cleanerId: 'none', cleanerCount: 0 };
    const at = evaluateClassroomAir(room);
    if (at.cfmPerPerson !== 40 || at.meetsAshrae241 !== true) throw new Error(`at boundary: ${at.cfmPerPerson} -> ${at.meetsAshrae241}`);
    const below = evaluateClassroomAir({ ...room, hvacAch: 5.9 });
    if (below.cfmPerPerson >= 40 || below.meetsAshrae241 !== false) throw new Error(`below boundary: ${below.cfmPerPerson} -> ${below.meetsAshrae241}`);
    return `40.0 meets, ${below.cfmPerPerson} below`;
  });
  t('Placement derate factor is 0.92 per extra unit', () => {
    const d = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 3, 0);
    if (!approx(d.placementFactor, (1 + 2 * 0.92) / 3, 1e-4)) throw new Error(`placement ${d.placementFactor}`);
    return `factor ${d.placementFactor}`;
  });
  t('Loaded filter floor is 0.60 of CADR', () => {
    const d = portableCadrWithDerates(CLEANER_CATALOG.corsi_box, 1, 1);
    if (!approx(d.loadingFactor, LOADED_FILTER_CADR_FRACTION, 1e-9)) throw new Error(`loading ${d.loadingFactor}`);
    return `loading ${d.loadingFactor}`;
  });
  t('CSV escapes formula-prefixed cells', () => {
    const cell = csvCell('=CMD()');
    if (!cell.startsWith("'")) throw new Error('formula cell unescaped');
    for (const v of ['+1', '-2', '@x', '\t9']) {
      if (!csvCell(v).startsWith("'")) throw new Error(`unescaped ${JSON.stringify(v)}`);
    }
    return 'escaped';
  });
  t('Tamper detection flips brief verification', () => {
    const b = auditedFleetBrief({ regime: 'usg-45' });
    if (!verifyFleetBrief(b.payload, b.digest)) throw new Error('clean brief failed verify');
    const forged = JSON.parse(JSON.stringify(b.payload));
    forged.strategies[0].school3YearUsd += 1;
    if (verifyFleetBrief(forged, b.digest)) throw new Error('tampered payload still verified');
    return 'mismatch detected';
  });
  t('#cas= bookmark round-trips every field', () => {
    const src = { regime: 'hazardous-260', classroomCount: 37, studentsPerRoom: 31, filterAgeDays: 88, applyDerates: false, strategy: 'hybrid-merv13-cr' };
    const back = decodeCasHash(encodeCasHash(src));
    if (!back) throw new Error('decode returned null');
    for (const k of Object.keys(src)) eq(back[k], src[k], `field ${k}`);
    return 'round-trip equal';
  });
  t('#cas= rejects hostile and malformed hashes', () => {
    for (const h of ['#cas=__proto__=x', '#cas=r=bogus', '#cas=n=abc', '#cas=x=7', '#cas=t=nope', '#cas=', '#cas', 'cas=r=', '#cas=r=wildfire-85&r=usg-45', '#cas=constructor=x']) {
      if (decodeCasHash(h) !== null) throw new Error(`accepted ${h}`);
    }
    return 'all rejected';
  });
  t('Digest parity across JSON, CSV and Markdown exports', () => {
    const b = auditedFleetBrief({ regime: 'moderate-20' });
    if (!fleetBriefJson(b).includes(b.digest)) throw new Error('json missing digest');
    if (!fleetBriefCsv(b).includes(`# sha256: ${b.digest}`)) throw new Error('csv missing digest');
    if (!fleetBriefMarkdown(b).includes(`SHA-256 integrity digest: ${b.digest}`)) throw new Error('md missing digest');
    return 'parity holds';
  });
  t('Fleet units for 5 ACH are positive integers', () => {
    const m = evaluateFleetLab({});
    for (const s of m.strategies) {
      if (!Number.isInteger(s.unitsFor5Ach) || s.unitsFor5Ach < 0) throw new Error(`${s.id}: ${s.unitsFor5Ach}`);
      if (s.cleanerId !== 'none' && s.unitsFor5Ach < 1) throw new Error(`${s.id} under-sized`);
    }
    return 'sizes valid';
  });
  t('Comparator matrix is complete and finite', () => {
    const m = evaluateFleetLab({});
    eq(m.strategies.length, 5, 'strategy count');
    for (const s of m.strategies) {
      for (const rk of Object.keys(SMOKE_REGIMES)) {
        const rr = s.byRegime[rk];
        if (!rr || !Number.isFinite(rr.steadyStatePm25) || !Number.isFinite(rr.indoorAqi)) throw new Error(`${s.id}/${rk} not finite`);
      }
    }
    return '5x4 finite';
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 7) DOM initializer                                                  */
/* ------------------------------------------------------------------ */

// Phone-width Pareto labels; the full names stay in the point tooltips and the table.
const SHORT_STRATEGY_NAMES = Object.freeze({
  'merv8-baseline': 'MERV 8',
  'merv13-hvac': 'MERV 13',
  'cr-box-fleet': 'CR boxes',
  'classroom-hepa-fleet': 'HEPA towers',
  'hybrid-merv13-cr': 'Hybrid',
});

const STRATEGY_COLORS = Object.freeze({
  'merv8-baseline': '#64748b',
  'merv13-hvac': '#ca8a04',
  'cr-box-fleet': '#0f766e',
  'classroom-hepa-fleet': '#7e22ce',
  'hybrid-merv13-cr': '#0369a1',
});

// Round axis maximum and step (1, 2, 2.5, 5 x 10^n) so ticks read as plain numbers.
function niceAxis(rawMax, target = 4) {
  const raw = Math.max(rawMax, 1e-6) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw - 1e-9);
  const count = Math.max(1, Math.ceil(rawMax / step - 1e-9));
  return { step, max: count * step, count };
}

function svgEl(doc, tag, attrs) {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Wire the Fleet Retrofit & Lifecycle Lab section. Returns a handle for tests
 * and audits, or null when the host markup is absent (section stays hidden).
 */
export function initFleetLab(doc = document, win = window) {
  const root = doc.getElementById('fleet-lab');
  if (!root) return null;
  const $ = (id) => doc.getElementById(id);
  const ui = {
    regimeBar: $('fl-regimes'),
    classrooms: $('fl-classrooms'),
    students: $('fl-students'),
    filterDays: $('fl-filter-days'),
    derates: $('fl-derates'),
    tbody: $('fl-tbody'),
    paretoSvg: $('fl-pareto-svg'),
    decaySvg: $('fl-decay-svg'),
    decayLegend: $('fl-decay-legend'),
    digest: $('fl-digest'),
    verifyBtn: $('fl-verify'),
    tamperBtn: $('fl-tamper'),
    verifyOut: $('fl-verify-out'),
    shareBtn: $('fl-share'),
    shareOut: $('fl-share-url'),
    jsonBtn: $('fl-export-json'),
    csvBtn: $('fl-export-csv'),
    mdBtn: $('fl-export-md'),
    testBtn: $('fl-run-tests'),
    testSummary: $('fl-test-summary'),
    testList: $('fl-test-list'),
    status: $('fl-status'),
  };
  if (!ui.tbody || !ui.paretoSvg || !ui.decaySvg) return null;

  const handle = { state: normalizeFleetState(FLEET_DEFAULTS), model: null, doc };
  // Phones get a narrower chart viewBox so axis text stays legible after scaling.
  const narrowQuery = typeof win.matchMedia === 'function' ? win.matchMedia('(max-width: 520px)') : null;
  const isNarrow = () => !!(narrowQuery && narrowQuery.matches);
  const seeded = typeof win.location?.hash === 'string' ? decodeCasHash(win.location.hash) : null;
  if (seeded) handle.state = seeded;

  function syncControls() {
    const s = handle.state;
    if (ui.classrooms) ui.classrooms.value = String(s.classroomCount);
    if (ui.students) ui.students.value = String(s.studentsPerRoom);
    if (ui.filterDays) ui.filterDays.value = String(s.filterAgeDays);
    if (ui.derates) ui.derates.checked = s.applyDerates;
    if (ui.regimeBar) {
      for (const btn of ui.regimeBar.querySelectorAll('[data-regime]')) {
        btn.setAttribute('aria-pressed', btn.dataset.regime === s.regime ? 'true' : 'false');
      }
    }
  }

  function updateHash() {
    try {
      const h = encodeCasHash(handle.state);
      if (win.history && typeof win.history.replaceState === 'function' && win.location.hash !== h) {
        win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}${h}`);
      }
    } catch { /* hash sync is best effort */ }
  }

  function renderTable(model) {
    ui.tbody.textContent = '';
    const rk = model.state.regime;
    for (const s of model.strategies) {
      const rr = s.byRegime[rk];
      const tr = doc.createElement('tr');
      tr.dataset.strategy = s.id;
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-pressed', s.id === model.state.strategy ? 'true' : 'false');
      if (s.id === model.state.strategy) tr.classList.add('fl-selected');
      const cells = [
        s.name,
        s.cleanerId === 'none' ? '0' : String(s.cleanerCount),
        String(s.deliveredCleanAch),
        String(s.eolCleanAch),
        `${rr.steadyStatePm25}`,
        `${rr.indoorAqi}`,
        `${s.cfmPerPerson}`,
        s.meetsAshrae241 ? 'meets' : 'below',
        `$${s.school3YearUsd.toLocaleString('en-US')}`,
        `$${s.costPerStudentUsd.toFixed(2)}`,
      ];
      cells.forEach((c, i) => {
        const td = doc.createElement('td');
        if (i === 5) {
          const chip = doc.createElement('span');
          chip.className = 'fl-chip';
          chip.style.background = pm25ToAqi2024(rr.steadyStatePm25).chipBg;
          chip.style.color = pm25ToAqi2024(rr.steadyStatePm25).chipText;
          chip.textContent = `${rr.indoorAqi} ${rr.indoorAqiCategory}`;
          td.appendChild(chip);
        } else {
          td.textContent = c;
        }
        tr.appendChild(td);
      });
      const pick = () => { handle.state = normalizeFleetState({ ...handle.state, strategy: s.id }); render(); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      ui.tbody.appendChild(tr);
    }
  }

  function renderPareto(model) {
    const svg = ui.paretoSvg;
    svg.textContent = '';
    const narrow = isNarrow();
    const W = narrow ? 340 : 580, H = narrow ? 300 : 340;
    const L = narrow ? 46 : 56, R = narrow ? 14 : 22, T = 40, B = 48;
    const FS = narrow ? 11 : 12;
    const LFS = narrow ? 10.5 : 11.5;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pts = model.pareto.points;
    const xAxis = niceAxis(Math.max(8, ...pts.map((p) => p.cleanAch), model.pareto.ashrae241EquivAch) * 1.04);
    const yAxis = niceAxis(Math.max(1000, ...pts.map((p) => p.school3YearUsd)) * 1.08);
    const maxX = xAxis.max, maxY = yAxis.max;
    const mx = (v) => L + (v / maxX) * (W - L - R);
    const my = (v) => H - B - (v / maxY) * (H - T - B);
    const usd = (v) => (v < 1000 ? `$${Math.round(v)}` : `$${Number((v / 1000).toFixed(1))}k`);

    svg.appendChild(svgEl(doc, 'text', { x: L - 6, y: T - 18, 'font-size': FS, 'font-weight': 650, fill: '#4a5753' })).textContent = 'USD, 3-year school total';
    for (let i = 0; i <= yAxis.count; i++) {
      const v = yAxis.step * i;
      const y = my(v);
      svg.appendChild(svgEl(doc, 'line', { x1: L, y1: y, x2: W - R, y2: y, stroke: i === 0 ? '#9aa9a4' : '#e3e9e7', 'stroke-width': 1 }));
      const t = svgEl(doc, 'text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': FS, fill: '#4a5753' });
      t.textContent = usd(v);
      svg.appendChild(t);
    }
    for (let i = 0; i <= xAxis.count; i++) {
      const v = xAxis.step * i;
      const x = mx(v);
      svg.appendChild(svgEl(doc, 'line', { x1: x, y1: H - B, x2: x, y2: H - B + 4, stroke: '#9aa9a4', 'stroke-width': 1 }));
      const xt = svgEl(doc, 'text', { x, y: H - B + 17, 'text-anchor': 'middle', 'font-size': FS, fill: '#4a5753' });
      xt.textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
      svg.appendChild(xt);
    }
    const axl = svgEl(doc, 'text', { x: L + (W - L - R) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': FS, 'font-weight': 650, fill: '#4a5753' });
    axl.textContent = 'Delivered clean ACH (fresh filters)';
    svg.appendChild(axl);

    // ASHRAE 241 target: dashed vertical line with its label at the top of the plot.
    const targetX = mx(model.pareto.ashrae241EquivAch);
    svg.appendChild(svgEl(doc, 'line', {
      x1: targetX, y1: T - 6, x2: targetX, y2: H - B, stroke: '#a85d0a', 'stroke-width': 1.6, 'stroke-dasharray': '5 4',
    }));
    const targetText = narrow
      ? `ASHRAE 241 ~ ${model.pareto.ashrae241EquivAch} ACH`
      : `ASHRAE 241: 40 CFM/person ~ ${model.pareto.ashrae241EquivAch} ACH`;
    const targetW = targetText.length * LFS * 0.56;
    const targetAnchorEnd = targetX - 6 - targetW >= L || targetX + 6 + targetW > W - R;
    const tl = svgEl(doc, 'text', {
      x: targetAnchorEnd ? targetX - 6 : targetX + 6,
      y: T + 6, 'font-size': LFS, fill: '#8a4b06', 'font-weight': 700,
      'text-anchor': targetAnchorEnd ? 'end' : 'start',
    });
    tl.textContent = targetText;
    tl.appendChild(svgEl(doc, 'title', {})).textContent =
      `ASHRAE 241: 40 CFM/person ~ ${model.pareto.ashrae241EquivAch} ACH`;
    svg.appendChild(tl);

    const fr = model.pareto.frontier;
    if (fr.length > 1) {
      const line = fr.map((p) => `${mx(p.cleanAch).toFixed(1)},${my(p.school3YearUsd).toFixed(1)}`).join(' ');
      svg.appendChild(svgEl(doc, 'polyline', { points: line, fill: 'none', stroke: '#0d6b63', 'stroke-width': 2, 'stroke-dasharray': '7 4', opacity: 0.7 }));
    }
    // Real rendered width when the SVG is laid out; a conservative estimate otherwise.
    const measureText = (text, weight) => {
      const probe = svgEl(doc, 'text', { x: 0, y: -20, 'font-size': LFS, 'font-weight': weight, visibility: 'hidden' });
      probe.textContent = text;
      svg.appendChild(probe);
      let w = 0;
      try { w = typeof probe.getComputedTextLength === 'function' ? probe.getComputedTextLength() : 0; } catch { w = 0; }
      probe.remove();
      return (w > 0 ? w : text.length * LFS * 0.62) + 2;
    };
    const selectedId = model.state.strategy;
    const pick = (id) => { handle.state = normalizeFleetState({ ...handle.state, strategy: id }); render(); };
    const labels = [];
    const dots = [];
    for (const p of pts) {
      const cx = mx(p.cleanAch), cy = my(p.school3YearUsd);
      const isSel = p.strategyId === selectedId;
      if (isSel) {
        svg.appendChild(svgEl(doc, 'circle', {
          cx, cy, r: 11, fill: 'none', stroke: STRATEGY_COLORS[p.strategyId] || '#0f766e', 'stroke-width': 2, opacity: 0.55,
          'data-selected-ring': 'true', 'pointer-events': 'none',
        }));
      }
      const c = svgEl(doc, 'circle', {
        cx, cy, r: 6.5,
        fill: STRATEGY_COLORS[p.strategyId] || '#0f766e', stroke: '#ffffff', 'stroke-width': 2,
        tabindex: 0, role: 'img', 'data-strategy': p.strategyId,
        'aria-pressed': isSel ? 'true' : 'false',
      });
      c.appendChild(svgEl(doc, 'title', {})).textContent =
        `${p.name}: ${p.cleanAch} clean ACH, $${p.school3YearUsd.toLocaleString('en-US')} over 3 years`;
      c.addEventListener('click', () => pick(p.strategyId));
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.strategyId); }
      });
      svg.appendChild(c);
      const name = narrow ? (SHORT_STRATEGY_NAMES[p.strategyId] || p.name) : p.name;
      dots.push({ x: cx, y: cy, name, isSel, w: measureText(name, isSel ? 750 : 600) });
    }
    // Place each label at the first free spot around its own point (above,
    // below, then beside), inside the plot, clear of other labels, points and
    // the target label. With no free spot, take the least-overlapping one.
    const boxOf = (c) => {
      const left = c.anchor === 'end' ? c.x - c.w : c.x;
      return { l: left, r: left + c.w, t: c.y - LFS + 1, b: c.y + 3 };
    };
    const overlap = (p, q) => Math.max(0, Math.min(p.r, q.r) - Math.max(p.l, q.l)) * Math.max(0, Math.min(p.b, q.b) - Math.max(p.t, q.t));
    const tBox = { l: targetAnchorEnd ? targetX - 6 - targetW : targetX + 6, r: targetAnchorEnd ? targetX - 6 : targetX + 6 + targetW, t: T + 6 - LFS, b: T + 9 };
    const dotBoxes = dots.map((d) => ({ l: d.x - 8, r: d.x + 8, t: d.y - 8, b: d.y + 8 }));
    const placed = [];
    const order = dots.map((d, i) => i).sort((i, j) => (dots[j].isSel - dots[i].isSel));
    for (const i of order) {
      const d = dots[i];
      const cands = [];
      for (const lift of [0, LFS + 2, 2 * (LFS + 2)]) {
        cands.push(
          { x: d.x + 9, y: d.y - 9 - lift, anchor: 'start' },
          { x: d.x - 9, y: d.y - 9 - lift, anchor: 'end' },
          { x: d.x + 9, y: d.y + 6 + LFS + lift, anchor: 'start' },
          { x: d.x - 9, y: d.y + 6 + LFS + lift, anchor: 'end' },
        );
        if (lift === 0) cands.push({ x: d.x + 12, y: d.y + LFS * 0.35, anchor: 'start' }, { x: d.x - 12, y: d.y + LFS * 0.35, anchor: 'end' });
      }
      let best = null;
      for (const c of cands) {
        const bx = boxOf({ ...c, w: d.w });
        const outside = Math.max(0, L + 2 - bx.l) + Math.max(0, bx.r - (W - R)) + Math.max(0, T - 4 - bx.t) + Math.max(0, bx.b - (H - B));
        let cost = outside * 1000;
        for (const q of [tBox, ...dotBoxes.filter((_, k) => k !== i), ...placed]) cost += overlap(bx, q);
        if (!best || cost < best.cost) best = { ...c, cost, box: bx };
        if (cost === 0) break;
      }
      placed.push(best.box);
      labels.push({ name: d.name, isSel: d.isSel, x: best.x, y: best.y, anchor: best.anchor });
    }
    for (const lbData of labels) {
      const lb = svgEl(doc, 'text', {
        x: lbData.x, y: lbData.y, 'font-size': LFS, fill: lbData.isSel ? '#08433e' : '#0e1b18',
        'font-weight': lbData.isSel ? 750 : 600, 'text-anchor': lbData.anchor, 'pointer-events': 'none',
      });
      lb.textContent = lbData.name;
      svg.appendChild(lb);
    }
  }

  function renderDecay(model) {
    const svg = ui.decaySvg;
    svg.textContent = '';
    const narrow = isNarrow();
    const W = narrow ? 340 : 580, H = narrow ? 270 : 320;
    const L = narrow ? 40 : 48, R = narrow ? 14 : 22, T = 36, B = 36;
    const FS = narrow ? 11 : 12;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const all = model.decay.flatMap((d) => d.points.map((p) => p.indoorPm25));
    const yAxis = niceAxis(Math.max(10, ...all));
    const maxY = yAxis.max;
    const mx = (min) => L + (min / 120) * (W - L - R);
    const my = (v) => H - B - (v / maxY) * (H - T - B);

    svg.appendChild(svgEl(doc, 'text', { x: L - 6, y: T - 16, 'font-size': FS, 'font-weight': 650, fill: '#4a5753' })).textContent = 'Indoor PM2.5, ug/m3';
    for (let i = 0; i <= yAxis.count; i++) {
      const v = yAxis.step * i;
      const y = my(v);
      svg.appendChild(svgEl(doc, 'line', { x1: L, y1: y, x2: W - R, y2: y, stroke: i === 0 ? '#9aa9a4' : '#e3e9e7', 'stroke-width': 1 }));
      const t = svgEl(doc, 'text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': FS, fill: '#4a5753' });
      t.textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
      svg.appendChild(t);
    }
    for (const min of [0, 30, 60, 90, 120]) {
      svg.appendChild(svgEl(doc, 'line', { x1: mx(min), y1: H - B, x2: mx(min), y2: H - B + 4, stroke: '#9aa9a4', 'stroke-width': 1 }));
      const t = svgEl(doc, 'text', { x: mx(min), y: H - B + 17, 'text-anchor': 'middle', 'font-size': FS, fill: '#4a5753' });
      t.textContent = `${min}m`;
      svg.appendChild(t);
    }
    // Draw the selected strategy last so it sits on top of overlapping curves.
    const ordered = [...model.decay].sort((a, b) =>
      (a.strategyId === model.state.strategy) - (b.strategyId === model.state.strategy));
    for (const curve of ordered) {
      const color = STRATEGY_COLORS[curve.strategyId] || '#0f766e';
      const isSel = curve.strategyId === model.state.strategy;
      const dash = curve.strategyId === 'merv8-baseline' ? { 'stroke-dasharray': '6 4' } : {};
      const pts = curve.points.map((p) => `${mx(p.minute).toFixed(1)},${my(p.indoorPm25).toFixed(1)}`).join(' ');
      svg.appendChild(svgEl(doc, 'polyline', {
        points: pts, fill: 'none', stroke: color,
        'stroke-width': isSel ? 3.6 : 2,
        opacity: isSel ? 1 : 0.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...dash,
      }));
      for (const p of curve.points) {
        const c = svgEl(doc, 'circle', {
          cx: mx(p.minute), cy: my(p.indoorPm25), r: isSel ? 3.6 : 2.4,
          fill: color, tabindex: 0, role: 'img',
          ...(isSel ? { stroke: '#ffffff', 'stroke-width': 1 } : { opacity: 0.75 }),
        });
        c.appendChild(svgEl(doc, 'title', {})).textContent =
          `${curve.name} at ${p.minute} min: ${p.indoorPm25} ug/m3 (AQI ${p.indoorAqi})`;
        svg.appendChild(c);
      }
    }
    if (ui.decayLegend) {
      ui.decayLegend.textContent = '';
      for (const curve of model.decay) {
        const li = doc.createElement('li');
        if (curve.strategyId === model.state.strategy) li.className = 'is-selected';
        const sw = doc.createElement('span');
        sw.className = 'fl-legend-swatch';
        if (curve.strategyId === 'merv8-baseline') sw.classList.add('fl-legend-swatch-dash');
        sw.style.background = STRATEGY_COLORS[curve.strategyId] || '#0f766e';
        li.appendChild(sw);
        li.appendChild(doc.createTextNode(curve.name));
        ui.decayLegend.appendChild(li);
      }
    }
  }

  function renderDigest() {
    const brief = auditedFleetBrief(handle.state);
    if (ui.digest) ui.digest.textContent = brief.digest;
    return brief;
  }

  function render() {
    handle.model = evaluateFleetLab(handle.state);
    syncControls();
    renderTable(handle.model);
    renderPareto(handle.model);
    renderDecay(handle.model);
    renderDigest();
    updateHash();
    if (ui.shareOut) {
      ui.shareOut.value = `${win.location.origin}${win.location.pathname}${encodeCasHash(handle.state)}`;
    }
    if (ui.status) {
      const m = handle.model;
      ui.status.textContent =
        `${m.selectedRegime.label}: outdoor ${m.selectedRegime.outdoorPm25} ug/m3 (AQI ${m.selectedRegime.outdoorAqi} ${m.selectedRegime.outdoorCategory}). ` +
        `${m.state.classroomCount} classrooms, ${m.state.studentsPerRoom} students per room, filters ${m.state.filterAgeDays} days old, derates ${m.state.applyDerates ? 'on' : 'off'}. Modeled projection, not a measured pilot.`;
    }
  }

  function bindControls() {
    if (ui.regimeBar) {
      for (const btn of ui.regimeBar.querySelectorAll('[data-regime]')) {
        btn.addEventListener('click', () => {
          handle.state = normalizeFleetState({ ...handle.state, regime: btn.dataset.regime });
          render();
        });
      }
    }
    const num = (el, field) => {
      if (!el) return;
      const apply = () => {
        handle.state = normalizeFleetState({ ...handle.state, [field]: el.value });
        render();
      };
      el.addEventListener('change', apply);
      el.addEventListener('input', apply);
    };
    num(ui.classrooms, 'classroomCount');
    num(ui.students, 'studentsPerRoom');
    num(ui.filterDays, 'filterAgeDays');
    if (ui.derates) {
      ui.derates.addEventListener('change', () => {
        handle.state = normalizeFleetState({ ...handle.state, applyDerates: ui.derates.checked });
        render();
      });
    }
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function bindExports() {
    if (ui.jsonBtn) ui.jsonBtn.addEventListener('click', () => download('cleanair-fleet-brief.json', fleetBriefJson(auditedFleetBrief(handle.state)), 'application/json'));
    if (ui.csvBtn) ui.csvBtn.addEventListener('click', () => download('cleanair-fleet-brief.csv', fleetBriefCsv(auditedFleetBrief(handle.state)), 'text/csv'));
    if (ui.mdBtn) ui.mdBtn.addEventListener('click', () => download('cleanair-fleet-brief.md', fleetBriefMarkdown(auditedFleetBrief(handle.state)), 'text/markdown'));
    if (ui.shareBtn) ui.shareBtn.addEventListener('click', async () => {
      const url = `${win.location.origin}${win.location.pathname}${encodeCasHash(handle.state)}`;
      if (ui.shareOut) ui.shareOut.value = url;
      try {
        await win.navigator.clipboard.writeText(url);
        if (ui.verifyOut) ui.verifyOut.textContent = 'Share link copied to clipboard.';
      } catch {
        if (ui.verifyOut) ui.verifyOut.textContent = 'Share link shown below; copy it manually.';
        if (ui.shareOut) { ui.shareOut.hidden = false; ui.shareOut.select(); }
      }
    });
    if (ui.verifyBtn) ui.verifyBtn.addEventListener('click', () => {
      const brief = auditedFleetBrief(handle.state);
      const ok = verifyFleetBrief(brief.payload, brief.digest);
      if (ui.verifyOut) {
        ui.verifyOut.textContent = ok
          ? `Integrity verified: payload matches stamped SHA-256 ${brief.digest.slice(0, 16)}...`
          : 'Verification failed: payload does not match its stamped digest.';
        ui.verifyOut.dataset.state = ok ? 'ok' : 'bad';
      }
    });
    if (ui.tamperBtn) ui.tamperBtn.addEventListener('click', () => {
      const brief = auditedFleetBrief(handle.state);
      const forged = JSON.parse(JSON.stringify(brief.payload));
      forged.strategies[0].school3YearUsd += 1;
      const caught = !verifyFleetBrief(forged, brief.digest);
      if (ui.verifyOut) {
        ui.verifyOut.textContent = caught
          ? 'Tamper test passed: a modified copy fails the digest check, so edits are detectable.'
          : 'Tamper test failed: modified copy still verified.';
        ui.verifyOut.dataset.state = caught ? 'ok' : 'bad';
      }
    });
  }

  function runTests() {
    const results = runFleetSelfTests();
    const passed = results.filter((r) => r.pass).length;
    if (ui.testSummary) {
      ui.testSummary.textContent = `${passed}/${results.length} checks pass`;
      ui.testSummary.dataset.state = passed === results.length ? 'ok' : 'bad';
    }
    if (ui.testList) {
      ui.testList.textContent = '';
      for (const r of results) {
        const li = doc.createElement('li');
        li.className = `fl-test ${r.pass ? 'pass' : 'fail'}`;
        const mark = doc.createElement('span');
        mark.className = `fl-test-mark ${r.pass ? 'pass' : 'fail'}`;
        mark.textContent = r.pass ? 'PASS' : 'FAIL';
        const body = doc.createElement('span');
        body.textContent = r.detail ? `${r.name} (${r.detail})` : r.name;
        li.append(mark, body);
        ui.testList.appendChild(li);
      }
    }
    handle.selfTests = results;
    return results;
  }

  if (ui.testBtn) ui.testBtn.addEventListener('click', runTests);

  if (typeof win.addEventListener === 'function') {
    win.addEventListener('hashchange', () => {
      const decoded = decodeCasHash(win.location.hash);
      if (decoded) {
        handle.state = decoded;
        render();
      }
    });
  }

  bindControls();
  bindExports();
  syncControls();
  render();
  if (narrowQuery && typeof narrowQuery.addEventListener === 'function') narrowQuery.addEventListener('change', () => render());
  runTests();
  root.hidden = false;
  handle.runTests = runTests;
  handle.render = render;
  return handle;
}
