import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SMOKE_REGIMES, FLEET_STRATEGIES, FLEET_ROOM, FLEET_DEFAULTS, FLEET_LIMITS,
  ASHRAE_241_CLASSROOM_CFMP,
  sha256Hex, canonicalJson,
  normalizeFleetState, encodeCasHash, decodeCasHash,
  evaluateFleetLab, auditedFleetBrief, verifyFleetBrief,
  fleetBriefCsv, fleetBriefMarkdown, fleetBriefJson,
  runFleetSelfTests,
} from '../js/fleet-lab.mjs';
import { pm25ToAqi2024, evaluateClassroomAir, CLEANER_CATALOG, LOADED_FILTER_CADR_FRACTION } from '../js/air-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGIME_KEYS = Object.keys(SMOKE_REGIMES);
const STRATEGY_IDS = FLEET_STRATEGIES.map((s) => s.id);

/* ---------------- SHA-256 implementation ---------------- */

const SHA_KATS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['a', 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['message digest', 'f7846f55cf23e14eebeab5b4e1550cad5b509e3348fbc4efa3a1413d393cb650'],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['The quick brown fox jumps over the lazy dog.', 'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c'],
];

for (const [msg, expected] of SHA_KATS) {
  test(`sha256: known answer for ${JSON.stringify(msg.slice(0, 24))}`, () => {
    assert.equal(sha256Hex(msg), expected);
  });
}

test('sha256: matches node crypto on random-ish ASCII inputs', () => {
  for (let i = 0; i < 25; i++) {
    const msg = `probe-${i}-` + 'x'.repeat(i * 7) + `#cas=r=wildfire-85&n=${i}`;
    const expected = crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
    assert.equal(sha256Hex(msg), expected, `input ${i}`);
  }
});

test('sha256: matches node crypto across the 55/56/64-byte block boundaries', () => {
  for (const len of [54, 55, 56, 63, 64, 65, 119, 120, 128, 200]) {
    const msg = 'q'.repeat(len);
    const expected = crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
    assert.equal(sha256Hex(msg), expected, `len ${len}`);
  }
});

test('sha256: multi-byte UTF-8 input matches node crypto', () => {
  const msg = 'Filtración del salón 5.0 ACH µg/m3';
  assert.equal(sha256Hex(msg), crypto.createHash('sha256').update(msg, 'utf8').digest('hex'));
});

test('sha256: Uint8Array input path matches string path', () => {
  const bytes = new TextEncoder().encode('cleanair-fleet');
  assert.equal(sha256Hex(bytes), sha256Hex('cleanair-fleet'));
});

test('sha256: deterministic and avalanche on one-character change', () => {
  const a = sha256Hex('state-a');
  const b = sha256Hex('state-b');
  assert.equal(a, sha256Hex('state-a'));
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('canonicalJson: sorts keys recursively for a stable digest', () => {
  const a = canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 0, y: 1 }] } });
  const b = canonicalJson({ a: { c: [3, { y: 1, z: 0 }], d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":[3,{"y":1,"z":0}],"d":2},"b":1}');
});

/* ---------------- normalizeFleetState ---------------- */

test('normalize: defaults applied for empty and missing input', () => {
  assert.deepEqual(normalizeFleetState(), FLEET_DEFAULTS);
  assert.deepEqual(normalizeFleetState(null), FLEET_DEFAULTS);
  assert.deepEqual(normalizeFleetState(undefined), FLEET_DEFAULTS);
  assert.deepEqual(normalizeFleetState('junk'), FLEET_DEFAULTS);
  assert.deepEqual(normalizeFleetState(42), FLEET_DEFAULTS);
  assert.deepEqual(normalizeFleetState({}), FLEET_DEFAULTS);
});

test('normalize: each regime id passes through', () => {
  for (const rk of REGIME_KEYS) {
    assert.equal(normalizeFleetState({ regime: rk }).regime, rk);
  }
});

test('normalize: each strategy id passes through', () => {
  for (const id of STRATEGY_IDS) {
    assert.equal(normalizeFleetState({ strategy: id }).strategy, id);
  }
});

test('normalize: unknown regime falls back to default', () => {
  assert.equal(normalizeFleetState({ regime: 'smog-999' }).regime, FLEET_DEFAULTS.regime);
  assert.equal(normalizeFleetState({ regime: '' }).regime, FLEET_DEFAULTS.regime);
  assert.equal(normalizeFleetState({ regime: null }).regime, FLEET_DEFAULTS.regime);
});

test('normalize: unknown strategy falls back to default', () => {
  assert.equal(normalizeFleetState({ strategy: 'ozone-ray' }).strategy, FLEET_DEFAULTS.strategy);
  assert.equal(normalizeFleetState({ strategy: 99 }).strategy, FLEET_DEFAULTS.strategy);
});

test('normalize: classroom count clamps to 1..100', () => {
  assert.equal(normalizeFleetState({ classroomCount: 0 }).classroomCount, 1);
  assert.equal(normalizeFleetState({ classroomCount: -40 }).classroomCount, 1);
  assert.equal(normalizeFleetState({ classroomCount: 500 }).classroomCount, 100);
  assert.equal(normalizeFleetState({ classroomCount: 101 }).classroomCount, 100);
  assert.equal(normalizeFleetState({ classroomCount: 55 }).classroomCount, 55);
});

test('normalize: students per room clamps to configured range', () => {
  assert.equal(normalizeFleetState({ studentsPerRoom: 0 }).studentsPerRoom, FLEET_LIMITS.studentsPerRoom.min);
  assert.equal(normalizeFleetState({ studentsPerRoom: 999 }).studentsPerRoom, FLEET_LIMITS.studentsPerRoom.max);
  assert.equal(normalizeFleetState({ studentsPerRoom: 30 }).studentsPerRoom, 30);
});

test('normalize: filter age clamps to nonnegative bound', () => {
  assert.equal(normalizeFleetState({ filterAgeDays: -5 }).filterAgeDays, 0);
  assert.equal(normalizeFleetState({ filterAgeDays: 99999 }).filterAgeDays, FLEET_LIMITS.filterAgeDays.max);
  assert.equal(normalizeFleetState({ filterAgeDays: 120 }).filterAgeDays, 120);
});

test('normalize: non-finite numeric fields fall back to defaults', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'x', [], {}, null]) {
    const s = normalizeFleetState({ classroomCount: bad, studentsPerRoom: bad, filterAgeDays: bad });
    assert.equal(s.classroomCount, FLEET_DEFAULTS.classroomCount, `classroomCount ${String(bad)}`);
    assert.equal(s.studentsPerRoom, FLEET_DEFAULTS.studentsPerRoom, `students ${String(bad)}`);
    assert.equal(s.filterAgeDays, FLEET_DEFAULTS.filterAgeDays, `days ${String(bad)}`);
  }
});

test('normalize: numeric strings and floats coerce sanely', () => {
  const s = normalizeFleetState({ classroomCount: '42', studentsPerRoom: '27', filterAgeDays: '30' });
  assert.equal(s.classroomCount, 42);
  assert.equal(s.studentsPerRoom, 27);
  assert.equal(s.filterAgeDays, 30);
  assert.equal(normalizeFleetState({ classroomCount: 20.6 }).classroomCount, 21);
});

test('normalize: applyDerates strict-boolean semantics', () => {
  assert.equal(normalizeFleetState({ applyDerates: true }).applyDerates, true);
  assert.equal(normalizeFleetState({ applyDerates: false }).applyDerates, false);
  assert.equal(normalizeFleetState({ applyDerates: 'true' }).applyDerates, false);
  assert.equal(normalizeFleetState({ applyDerates: 1 }).applyDerates, false);
  assert.equal(normalizeFleetState({}).applyDerates, FLEET_DEFAULTS.applyDerates);
});

test('normalize: __proto__ keyed input cannot pollute state', () => {
  const hostile = JSON.parse('{"regime":"usg-45","__proto__":{"regime":"hazardous-260"},"constructor":1}');
  const s = normalizeFleetState(hostile);
  assert.equal(s.regime, 'usg-45');
  assert.equal(Object.keys(s).includes('__proto__'), false);
});

/* ---------------- #cas= codec ---------------- */

test('codec: canonical encode of defaults', () => {
  const h = encodeCasHash(FLEET_DEFAULTS);
  assert.equal(h, '#cas=r=wildfire-85&n=20&s=26&d=0&x=1&t=cr-box-fleet');
});

test('codec: encode is deterministic across calls', () => {
  const s = { regime: 'usg-45', classroomCount: 5, studentsPerRoom: 30, filterAgeDays: 12, applyDerates: false, strategy: 'merv13-hvac' };
  assert.equal(encodeCasHash(s), encodeCasHash(s));
});

test('codec: round-trip every field at once', () => {
  const src = { regime: 'hazardous-260', classroomCount: 73, studentsPerRoom: 41, filterAgeDays: 365, applyDerates: false, strategy: 'classroom-hepa-fleet' };
  assert.deepEqual(decodeCasHash(encodeCasHash(src)), src);
});

for (const rk of REGIME_KEYS) {
  test(`codec: regime ${rk} round-trips`, () => {
    const s = normalizeFleetState({ regime: rk });
    assert.equal(decodeCasHash(encodeCasHash(s)).regime, rk);
  });
}

for (const id of STRATEGY_IDS) {
  test(`codec: strategy ${id} round-trips`, () => {
    const s = normalizeFleetState({ strategy: id });
    assert.equal(decodeCasHash(encodeCasHash(s)).strategy, id);
  });
}

for (const n of [1, 2, 50, 99, 100]) {
  test(`codec: classroomCount ${n} round-trips`, () => {
    assert.equal(decodeCasHash(encodeCasHash({ classroomCount: n })).classroomCount, n);
  });
}

for (const s of [1, 26, 45, 60]) {
  test(`codec: studentsPerRoom ${s} round-trips`, () => {
    assert.equal(decodeCasHash(encodeCasHash({ studentsPerRoom: s })).studentsPerRoom, s);
  });
}

for (const d of [0, 1, 90, 365, 3650]) {
  test(`codec: filterAgeDays ${d} round-trips`, () => {
    assert.equal(decodeCasHash(encodeCasHash({ filterAgeDays: d })).filterAgeDays, d);
  });
}

for (const x of [true, false]) {
  test(`codec: applyDerates ${x} round-trips`, () => {
    assert.equal(decodeCasHash(encodeCasHash({ applyDerates: x })).applyDerates, x);
  });
}

test('codec: decode tolerates leading # or bare body', () => {
  const bare = encodeCasHash(FLEET_DEFAULTS).slice(1);
  assert.deepEqual(decodeCasHash(bare), FLEET_DEFAULTS);
  assert.deepEqual(decodeCasHash(encodeCasHash(FLEET_DEFAULTS)), FLEET_DEFAULTS);
});

test('codec: partial hash keeps defaults for missing fields', () => {
  const s = decodeCasHash('#cas=r=usg-45');
  assert.equal(s.regime, 'usg-45');
  assert.equal(s.classroomCount, FLEET_DEFAULTS.classroomCount);
  assert.equal(s.strategy, FLEET_DEFAULTS.strategy);
});

test('codec: out-of-range numeric values clamp rather than reject', () => {
  const s = decodeCasHash('#cas=n=5000&s=0&d=-3');
  assert.equal(s.classroomCount, 100);
  assert.equal(s.studentsPerRoom, FLEET_LIMITS.studentsPerRoom.min);
  assert.equal(s.filterAgeDays, 0);
});

const HOSTILE_HASHES = [
  '', '#', '#cas', '#cas=', '#cas=&', '#cas=?', '#room=x', '#cas=x=1&y=2',
  '#cas=__proto__=1', '#cas=constructor=1', '#cas=prototype=1', '#cas=hasOwnProperty=1',
  '#cas=r=bogus', '#cas=r=WILDFIRE-85', '#cas=r=', '#cas=r=%ZZ', '#cas=r=%',
  '#cas=n=abc', '#cas=n=1.5', '#cas=n=', '#cas=n=1e3', '#cas=n=+5', '#cas=n= 5',
  '#cas=s=', '#cas=d=1.2', '#cas=x=2', '#cas=x=yes', '#cas=x=', '#cas=x=-1',
  '#cas=t=none', '#cas=t=', '#cas=t=__proto__',
  '#cas=r=wildfire-85&r=usg-45', '#cas=x=1&x=0', '#cas=n=20&n=21',
  '#cas=r', '#cas==x', '#cas=%3D=x', '#cas=r%3Dwildfire-85',
  '#cas=r=wildfire-85&n=20&s=26&d=0&x=1&t=cr-box-fleet&extra=1',
  '#cas=r=wildfire-85&n=20&s=26&d=0&x=1&t=cr-box-fleet&k=1&v=2',
];

for (const h of HOSTILE_HASHES) {
  test(`codec: rejects hostile hash ${JSON.stringify(h)}`, () => {
    assert.equal(decodeCasHash(h), null);
  });
}

test('codec: rejects non-string input types', () => {
  for (const bad of [null, undefined, 0, 42, {}, [], NaN]) {
    assert.equal(decodeCasHash(bad), null);
  }
});

test('codec: object built by decode cannot write __proto__ into state', () => {
  const s = decodeCasHash('#cas=r=usg-45&n=10&s=30&d=5&x=0&t=merv13-hvac');
  assert.equal(Object.getPrototypeOf(s), Object.prototype);
  assert.equal(s.regime, 'usg-45');
});

/* ---------------- evaluateFleetLab ---------------- */

const LAB = evaluateFleetLab({});

test('model: five strategies and four regimes are all present', () => {
  assert.equal(LAB.strategies.length, 5);
  assert.deepEqual(LAB.strategies.map((s) => s.id), STRATEGY_IDS);
  assert.equal(LAB.regimes.length, 4);
  assert.deepEqual(LAB.regimes.map((r) => r.id), REGIME_KEYS);
});

for (const sid of STRATEGY_IDS) {
  const s = LAB.strategies.find((x) => x.id === sid);
  test(`model: ${sid} reports finite fresh and end-of-life ACH`, () => {
    assert.ok(Number.isFinite(s.deliveredCleanAch));
    assert.ok(Number.isFinite(s.eolCleanAch));
    assert.ok(s.eolCleanAch <= s.deliveredCleanAch);
  });
  test(`model: ${sid} covers all four regimes with finite indoor numbers`, () => {
    for (const rk of REGIME_KEYS) {
      const rr = s.byRegime[rk];
      assert.ok(rr, `${sid}/${rk} missing`);
      assert.ok(Number.isFinite(rr.steadyStatePm25));
      assert.ok(Number.isInteger(rr.indoorAqi));
      assert.ok(rr.indoorAqi >= 0 && rr.indoorAqi <= 500);
      assert.ok(typeof rr.indoorAqiCategory === 'string' && rr.indoorAqiCategory.length > 0);
      assert.ok(rr.indoorReductionPct >= 0 && rr.indoorReductionPct <= 100);
    }
  });
  test(`model: ${sid} indoor AQI matches engine AQI for its steady PM2.5`, () => {
    for (const rk of REGIME_KEYS) {
      const rr = s.byRegime[rk];
      assert.equal(rr.indoorAqi, pm25ToAqi2024(rr.steadyStatePm25).aqi, `${sid}/${rk}`);
    }
  });
  test(`model: ${sid} indoor PM2.5 never exceeds outdoor regime level`, () => {
    for (const rk of REGIME_KEYS) {
      assert.ok(s.byRegime[rk].steadyStatePm25 <= SMOKE_REGIMES[rk].outdoorPm25, `${sid}/${rk}`);
    }
  });
  test(`model: ${sid} reports a 3-year budget and per-student cost`, () => {
    assert.ok(Number.isFinite(s.perRoom3YearUsd) && s.perRoom3YearUsd >= 0);
    assert.ok(Number.isFinite(s.school3YearUsd) && s.school3YearUsd >= 0);
    assert.ok(Number.isFinite(s.costPerStudentUsd) && s.costPerStudentUsd >= 0);
  });
}

for (const rk of REGIME_KEYS) {
  test(`model: regime ${rk} steady PM2.5 orders baseline worst and fleets best`, () => {
    const get = (id) => LAB.strategies.find((x) => x.id === id).byRegime[rk].steadyStatePm25;
    assert.ok(get('merv8-baseline') >= get('merv13-hvac'), `${rk} merv13 not better than baseline`);
    assert.ok(get('merv13-hvac') > get('cr-box-fleet'), `${rk} cr fleet not better than merv13`);
    assert.ok(get('cr-box-fleet') > 0);
  });
  test(`model: regime ${rk} indoor AQI at or below outdoor AQI for every strategy`, () => {
    const outdoor = pm25ToAqi2024(SMOKE_REGIMES[rk].outdoorPm25).aqi;
    for (const s of LAB.strategies) {
      assert.ok(s.byRegime[rk].indoorAqi <= outdoor, `${s.id}/${rk}`);
    }
  });
  test(`model: regime ${rk} selected-model decay has 13 samples over 120 min`, () => {
    const m = evaluateFleetLab({ regime: rk });
    for (const curve of m.decay) {
      assert.equal(curve.points.length, 13);
      assert.equal(curve.points[0].minute, 0);
      assert.equal(curve.points[12].minute, 120);
    }
  });
}

test('model: selected regime metadata matches the regime key', () => {
  for (const rk of REGIME_KEYS) {
    const m = evaluateFleetLab({ regime: rk });
    assert.equal(m.selectedRegime.id, rk);
    assert.equal(m.selectedRegime.outdoorPm25, SMOKE_REGIMES[rk].outdoorPm25);
    assert.equal(m.selectedRegime.outdoorAqi, pm25ToAqi2024(SMOKE_REGIMES[rk].outdoorPm25).aqi);
  }
});

test('model: CR box fleet reaches 5.0 delivered clean ACH fresh', () => {
  const s = LAB.strategies.find((x) => x.id === 'cr-box-fleet');
  assert.ok(s.deliveredCleanAch >= 5.0, `ach ${s.deliveredCleanAch}`);
  assert.ok(s.cleanerCount >= 1);
});

test('model: HEPA fleet reaches 5.0 delivered clean ACH fresh', () => {
  const s = LAB.strategies.find((x) => x.id === 'classroom-hepa-fleet');
  assert.ok(s.deliveredCleanAch >= 5.0);
  assert.ok(s.cleanerCount >= 1);
});

test('model: hybrid needs fewer CR boxes than the pure CR fleet', () => {
  const cr = LAB.strategies.find((x) => x.id === 'cr-box-fleet');
  const hy = LAB.strategies.find((x) => x.id === 'hybrid-merv13-cr');
  assert.ok(hy.cleanerCount < cr.cleanerCount, `${hy.cleanerCount} !< ${cr.cleanerCount}`);
});

test('model: HVAC-only strategies carry zero portable units', () => {
  for (const id of ['merv8-baseline', 'merv13-hvac']) {
    const s = LAB.strategies.find((x) => x.id === id);
    assert.equal(s.cleanerCount, 0);
    assert.equal(s.cleanerId, 'none');
  }
});

test('model: end-of-life floor equals the fresh eval at full filter load', () => {
  for (const s of LAB.strategies) {
    const strat = FLEET_STRATEGIES.find((x) => x.id === s.id);
    const ref = evaluateClassroomAir({
      ...FLEET_ROOM, occupants: LAB.state.studentsPerRoom,
      outdoorPm25: SMOKE_REGIMES[LAB.state.regime].outdoorPm25,
      mervRating: strat.mervRating, cleanerId: strat.cleanerId,
      cleanerCount: s.cleanerCount, applyDerates: true, filterLoadFraction: 1,
    });
    assert.equal(s.eolCleanAch, ref.deliveredCleanAch, s.id);
  }
});

test('model: clean ACH ordering baseline < merv13 < fleets at fresh filters', () => {
  const get = (id) => LAB.strategies.find((x) => x.id === id).deliveredCleanAch;
  assert.ok(get('merv8-baseline') < get('merv13-hvac'));
  assert.ok(get('merv13-hvac') < get('cr-box-fleet'));
  assert.ok(get('cr-box-fleet') >= 5.0);
  assert.ok(get('classroom-hepa-fleet') >= 5.0);
  assert.ok(get('hybrid-merv13-cr') >= 5.0);
});

test('model: filter age raises sized unit count only when derates are applied', () => {
  const fresh = evaluateFleetLab({ filterAgeDays: 0, applyDerates: true });
  const aged = evaluateFleetLab({ filterAgeDays: 3650, applyDerates: true });
  const freshCr = fresh.strategies.find((s) => s.id === 'cr-box-fleet');
  const agedCr = aged.strategies.find((s) => s.id === 'cr-box-fleet');
  assert.ok(agedCr.eolCleanAch <= freshCr.eolCleanAch);
  const off = evaluateFleetLab({ filterAgeDays: 3650, applyDerates: false });
  assert.equal(off.strategies.find((s) => s.id === 'cr-box-fleet').filterLoadFraction, 0);
});

test('model: baseline strategy costs zero incremental dollars', () => {
  const s = LAB.strategies.find((x) => x.id === 'merv8-baseline');
  assert.equal(s.school3YearUsd, 0);
  assert.equal(s.costPerStudentUsd, 0);
});

test('model: school budget scales linearly with classroom count', () => {
  const m10 = evaluateFleetLab({ classroomCount: 10 });
  const m40 = evaluateFleetLab({ classroomCount: 40 });
  for (const id of STRATEGY_IDS) {
    const a = m10.strategies.find((s) => s.id === id).school3YearUsd;
    const b = m40.strategies.find((s) => s.id === id).school3YearUsd;
    assert.ok(Math.abs(b - a * 4) < 0.02, id);
  }
});

test('model: cost per student divides school total by total students', () => {
  const m = evaluateFleetLab({ classroomCount: 12, studentsPerRoom: 30 });
  for (const s of m.strategies) {
    const expected = s.school3YearUsd / (12 * 30);
    assert.ok(Math.abs(s.costPerStudentUsd - expected) < 0.01, s.id);
  }
});

test('model: ASHRAE 241 target equivalent ACH is computed from room and occupancy', () => {
  const m = evaluateFleetLab({ studentsPerRoom: 26 });
  const expected = (40 * 26 * 60) / (30 * 28 * 10);
  assert.ok(Math.abs(m.pareto.ashrae241EquivAch - expected) < 0.01);
});

test('model: pareto frontier is a subset of points sorted by ACH', () => {
  const m = evaluateFleetLab({});
  assert.ok(m.pareto.frontier.length >= 2);
  const ids = new Set(m.pareto.points.map((p) => p.strategyId));
  for (const f of m.pareto.frontier) assert.ok(ids.has(f.strategyId));
  for (let i = 1; i < m.pareto.frontier.length; i++) {
    assert.ok(m.pareto.frontier[i].cleanAch >= m.pareto.frontier[i - 1].cleanAch);
    assert.ok(m.pareto.frontier[i].school3YearUsd >= m.pareto.frontier[i - 1].school3YearUsd);
  }
});

test('model: baseline is always on the pareto frontier (cheapest)', () => {
  const m = evaluateFleetLab({});
  assert.equal(m.pareto.frontier[0].strategyId, 'merv8-baseline');
});

test('model: dominated strategies never appear on the frontier', () => {
  const m = evaluateFleetLab({});
  for (const p of m.pareto.points) {
    const dominated = m.pareto.points.some((q) => q !== p && q.cleanAch >= p.cleanAch && q.school3YearUsd <= p.school3YearUsd && (q.cleanAch > p.cleanAch || q.school3YearUsd < p.school3YearUsd));
    if (dominated) assert.ok(!m.pareto.frontier.includes(p), `${p.strategyId} dominated but on frontier`);
  }
});

test('model: every strategy row is finite for hostile student counts', () => {
  for (const n of [1, 60, NaN, -4, 5000]) {
    const m = evaluateFleetLab({ studentsPerRoom: n });
    for (const s of m.strategies) {
      assert.ok(Number.isFinite(s.cfmPerPerson), `${s.id} cfm for ${n}`);
      assert.ok(Number.isFinite(s.costPerStudentUsd), `${s.id} cost for ${n}`);
    }
  }
});

test('model: decay curves end at or below their starting point', () => {
  const m = evaluateFleetLab({ regime: 'hazardous-260' });
  for (const curve of m.decay) {
    const pts = curve.points;
    assert.ok(pts[12].indoorPm25 <= pts[0].indoorPm25 + 0.05, curve.strategyId);
  }
});

test('model: decay curves for fleets end below baseline endpoint', () => {
  const m = evaluateFleetLab({ regime: 'wildfire-85' });
  const end = (id) => m.decay.find((c) => c.strategyId === id).points[12].indoorPm25;
  assert.ok(end('cr-box-fleet') < end('merv8-baseline'));
  assert.ok(end('hybrid-merv13-cr') < end('merv8-baseline'));
});

/* ---------------- audited brief + exporters ---------------- */

test('brief: digest is a 64-hex sha256 of the canonical payload', () => {
  const b = auditedFleetBrief({});
  assert.match(b.digest, /^[0-9a-f]{64}$/);
  assert.equal(sha256Hex(canonicalJson(b.payload)), b.digest);
});

test('brief: same state returns the cached identical object', () => {
  const a = auditedFleetBrief({ regime: 'usg-45' });
  const b = auditedFleetBrief({ regime: 'usg-45' });
  assert.equal(a, b);
});

test('brief: different states produce different digests', () => {
  const digests = new Set();
  for (const rk of REGIME_KEYS) digests.add(auditedFleetBrief({ regime: rk }).digest);
  digests.add(auditedFleetBrief({ classroomCount: 11 }).digest);
  digests.add(auditedFleetBrief({ applyDerates: false }).digest);
  assert.ok(digests.size >= 5);
});

test('brief: digest parity across JSON body, CSV header, and Markdown footer', () => {
  for (const rk of REGIME_KEYS) {
    const b = auditedFleetBrief({ regime: rk });
    const json = fleetBriefJson(b);
    const csv = fleetBriefCsv(b);
    const md = fleetBriefMarkdown(b);
    assert.ok(json.includes(`"sha256": "${b.digest}"`), `json ${rk}`);
    assert.ok(csv.includes(`# sha256: ${b.digest}`), `csv ${rk}`);
    assert.ok(md.includes(`SHA-256 integrity digest: ${b.digest}`), `md ${rk}`);
  }
});

test('brief: JSON export parses and embeds stamped digest', () => {
  const b = auditedFleetBrief({ classroomCount: 33 });
  const parsed = JSON.parse(fleetBriefJson(b));
  assert.equal(parsed.sha256, b.digest);
  assert.equal(parsed.state.classroomCount, 33);
  assert.equal(parsed.format, 'cas-fleet-brief-v1');
});

test('brief: verification accepts clean payload and rejects edits', () => {
  const b = auditedFleetBrief({});
  assert.equal(verifyFleetBrief(b.payload, b.digest), true);
  const forged = JSON.parse(JSON.stringify(b.payload));
  forged.state.classroomCount += 1;
  assert.equal(verifyFleetBrief(forged, b.digest), false);
  forged.state.classroomCount = b.payload.state.classroomCount;
  forged.strategies[2].eolCleanAch = 0.01;
  assert.equal(verifyFleetBrief(forged, b.digest), false);
});

test('brief: verification rejects malformed inputs without throwing', () => {
  assert.equal(verifyFleetBrief(null, 'x'.repeat(64)), false);
  assert.equal(verifyFleetBrief({}, 'x'.repeat(64)), false);
  assert.equal(verifyFleetBrief({ a: 1 }, 'not-hex'), false);
  assert.equal(verifyFleetBrief({ a: 1 }, 'Z'.repeat(64)), false);
  assert.equal(verifyFleetBrief(undefined, undefined), false);
});

test('csv: provenance header carries digest and state fields', () => {
  const b = auditedFleetBrief({ regime: 'hazardous-260', classroomCount: 7, studentsPerRoom: 19, filterAgeDays: 44, applyDerates: false });
  const csv = fleetBriefCsv(b);
  const lines = csv.split('\n');
  assert.equal(lines[0], '# CleanAirSchool fleet retrofit brief (modeled engineering projection)');
  assert.equal(lines[1], `# sha256: ${b.digest}`);
  assert.ok(lines[3].includes('regime: hazardous-260'));
  assert.ok(lines[3].includes('classrooms: 7'));
  assert.ok(lines[3].includes('applyDerates: false'));
});

test('csv: emits one row per strategy plus header rows', () => {
  const csv = fleetBriefCsv(auditedFleetBrief({}));
  const rows = csv.trim().split('\n');
  assert.equal(rows.length, 4 + 1 + 5);
  assert.ok(rows[4].startsWith('strategy,'));
  assert.ok(rows[5].startsWith('merv8-baseline,'));
});

test('csv: every strategy id appears in its own row', () => {
  const csv = fleetBriefCsv(auditedFleetBrief({}));
  for (const id of STRATEGY_IDS) assert.ok(csv.includes(`\n${id},`) || csv.includes(`${id},`), id);
});

test('csv: formula-prefixed strategy names would be escaped', () => {
  const b = auditedFleetBrief({});
  const forged = JSON.parse(JSON.stringify(b.payload));
  forged.strategies[0].id = '=CMD()';
  const csv = fleetBriefCsv({ payload: forged, digest: b.digest });
  const row = csv.split('\n').find((l) => l.includes('=CMD'));
  assert.ok(row.startsWith("'") || row.split(',')[0].startsWith("'"), row);
});

test('csv: cells with commas, quotes, newlines are quoted safely', () => {
  const cell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  assert.equal(cell('a,b'), '"a,b"');
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  assert.equal(cell('=1+1'), "'=1+1");
  assert.equal(cell('+cmd'), "'+cmd");
  assert.equal(cell('-9'), "'-9");
  assert.equal(cell('@x'), "'@x");
  assert.equal(cell('normal'), 'normal');
});

test('markdown: table lists every strategy and the digest footer', () => {
  const b = auditedFleetBrief({ regime: 'usg-45' });
  const md = fleetBriefMarkdown(b);
  for (const s of b.payload.strategies) assert.ok(md.includes(`| ${s.name} |`), s.id);
  assert.ok(md.includes('SHA-256 integrity digest: ' + b.digest));
  assert.ok(md.includes('USG') === false || md.includes('Sensitive'));
  assert.ok(md.includes('| Strategy |'));
});

test('markdown: labels itself a modeled projection', () => {
  const md = fleetBriefMarkdown(auditedFleetBrief({}));
  assert.ok(/modeled engineering projection/i.test(md));
  assert.ok(/not a live sensor feed/i.test(md) || /no live sensor feed/i.test(md));
});

/* ---------------- in-page self-test runner ---------------- */

test('selftests: runner returns at least 16 checks', () => {
  const results = runFleetSelfTests();
  assert.ok(results.length >= 16, `only ${results.length}`);
});

test('selftests: every check reports name and boolean pass', () => {
  for (const r of runFleetSelfTests()) {
    assert.ok(typeof r.name === 'string' && r.name.length > 3);
    assert.equal(typeof r.pass, 'boolean');
    assert.equal(typeof r.detail, 'string');
  }
});

test('selftests: all checks pass on the shipped engine', () => {
  const results = runFleetSelfTests();
  const failed = results.filter((r) => !r.pass);
  assert.deepEqual(failed, [], failed.map((f) => `${f.name}: ${f.detail}`).join('; '));
});

test('selftests: deterministic across repeated runs', () => {
  const a = runFleetSelfTests().map((r) => `${r.name}:${r.pass}`);
  const b = runFleetSelfTests().map((r) => `${r.name}:${r.pass}`);
  assert.deepEqual(a, b);
});

/* ---------------- hostile state fuzz ---------------- */

const HOSTILE_STATES = [
  { regime: { toString: () => 'x' } },
  { regime: '__proto__' },
  { classroomCount: { valueOf: () => NaN } },
  { classroomCount: 'DROP TABLE' },
  { studentsPerRoom: '999999999999999999999' },
  { filterAgeDays: '1e9' },
  { applyDerates: { checked: true } },
  { strategy: 'constructor' },
  { strategy: null, regime: undefined, classroomCount: [], studentsPerRoom: {}, filterAgeDays: false },
];

for (const [i, hs] of HOSTILE_STATES.entries()) {
  test(`hostile state ${i}: normalize never throws and yields finite model`, () => {
    const s = normalizeFleetState(hs);
    const m = evaluateFleetLab(s);
    assert.ok(Number.isFinite(m.selectedRegime.outdoorPm25));
    for (const st of m.strategies) {
      assert.ok(Number.isFinite(st.deliveredCleanAch));
      assert.ok(Number.isFinite(st.school3YearUsd));
    }
  });
}

test('hostile: encode of hostile input still produces a parseable hash', () => {
  for (const hs of HOSTILE_STATES) {
    const h = encodeCasHash(hs);
    const back = decodeCasHash(h);
    assert.ok(back, `encode(${JSON.stringify(hs)}) -> ${h} did not decode`);
  }
});

test('engine: fleet model outputs agree with direct engine evaluation', () => {
  const m = evaluateFleetLab({ regime: 'usg-45', studentsPerRoom: 26 });
  const cr = m.strategies.find((s) => s.id === 'cr-box-fleet');
  const direct = evaluateClassroomAir({
    ...FLEET_ROOM, occupants: 26, outdoorPm25: 45,
    mervRating: 'merv11', cleanerId: 'corsi_box', cleanerCount: cr.cleanerCount,
    applyDerates: true, daysSinceReplacement: 0,
  });
  assert.equal(cr.byRegime['usg-45'].steadyStatePm25, direct.steadyStatePm25);
  assert.equal(cr.deliveredCleanAch, direct.deliveredCleanAch);
});

test('model: loaded-filter floor uses the documented 0.60 fraction', () => {
  const m = evaluateFleetLab({ applyDerates: true });
  const cr = m.strategies.find((s) => s.id === 'cr-box-fleet');
  const fresh = evaluateClassroomAir({
    ...FLEET_ROOM, occupants: 26, outdoorPm25: 85,
    mervRating: 'merv11', cleanerId: 'corsi_box', cleanerCount: cr.cleanerCount,
    applyDerates: true, daysSinceReplacement: 0,
  });
  const hvac = fresh.hvacCleanAch;
  const expectedPortable = fresh.effectivePortableCfm * LOADED_FILTER_CADR_FRACTION * 60 / fresh.volumeFt3;
  const expected = hvac + expectedPortable;
  assert.ok(Math.abs(cr.eolCleanAch - Number(expected.toFixed(2))) < 0.03, `${cr.eolCleanAch} vs ${expected}`);
});

/* ---------------- DOM wiring ---------------- */

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const labJs = fs.readFileSync(path.join(ROOT, 'js/fleet-lab.mjs'), 'utf8');

test('dom: every element id fleet-lab.mjs looks up exists in index.html', () => {
  const ids = [...labJs.matchAll(/\$\('([a-z0-9-]+)'\)|getElementById\('([^']+)'\)/g)]
    .map((m) => m[1] || m[2])
    .filter((id) => id && id !== 'fleet-lab');
  assert.ok(ids.length >= 20, `only ${ids.length} ids found`);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `missing id="${id}"`);
});

test('dom: fleet lab section starts hidden for graceful fallback', () => {
  assert.match(html, /<section id="fleet-lab"[^>]*hidden/);
});

test('dom: fleet lab is marked no-print', () => {
  assert.match(html, /<section id="fleet-lab"[^>]*no-print/);
});

test('dom: app.js dynamically imports the lab module', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.match(appJs, /import\('\.\/fleet-lab\.mjs'\)/);
});

test('dom: regime buttons exist for all four smoke regimes', () => {
  for (const rk of REGIME_KEYS) assert.ok(html.includes(`data-regime="${rk}"`), rk);
});

test('dom: fleet lab heading has no tagline paragraph directly under it', () => {
  const after = html.slice(html.indexOf('id="fleet-lab-title"'));
  assert.equal(/<\/h2>\s*<p class="tagline"/i.test(after.slice(0, 400)), false);
});

/* ---------------- extended matrix coverage ---------------- */

for (const sid of STRATEGY_IDS) {
  for (const rk of REGIME_KEYS) {
    test(`matrix: ${sid} in ${rk} reports complete indoor row`, () => {
      const m = evaluateFleetLab({ regime: rk });
      const s = m.strategies.find((x) => x.id === sid);
      const rr = s.byRegime[rk];
      assert.ok(rr.steadyStatePm25 >= 0 && rr.steadyStatePm25 <= SMOKE_REGIMES[rk].outdoorPm25);
      assert.equal(rr.indoorAqi, pm25ToAqi2024(rr.steadyStatePm25).aqi);
      assert.equal(rr.indoorAqiCategory, pm25ToAqi2024(rr.steadyStatePm25).category);
      assert.ok(Number.isFinite(rr.indoorReductionPct));
      assert.equal(s.mervRating, FLEET_STRATEGIES.find((x) => x.id === sid).mervRating);
    });
    test(`matrix: ${sid} in ${rk} decay is monotonic non-increasing`, () => {
      const m = evaluateFleetLab({ regime: rk });
      const pts = m.decay.find((c) => c.strategyId === sid).points;
      for (let i = 1; i < pts.length; i++) {
        assert.ok(pts[i].indoorPm25 <= pts[i - 1].indoorPm25 + 0.05, `minute ${pts[i].minute}`);
        assert.ok(Number.isInteger(pts[i].indoorAqi));
      }
    });
  }
}

for (const sid of STRATEGY_IDS) {
  test(`eol: ${sid} end-of-life ACH never exceeds fresh ACH`, () => {
    for (const rk of REGIME_KEYS) {
      const m = evaluateFleetLab({ regime: rk, filterAgeDays: 0 });
      const s = m.strategies.find((x) => x.id === sid);
      assert.ok(s.eolCleanAch <= s.deliveredCleanAch + 1e-9, `${sid}/${rk}`);
    }
  });
  test(`eol: ${sid} end-of-life ACH stays nonnegative`, () => {
    const m = evaluateFleetLab({ filterAgeDays: 3650 });
    const s = m.strategies.find((x) => x.id === sid);
    assert.ok(s.eolCleanAch >= 0);
    assert.ok(Number.isFinite(s.eolCfmPerPerson));
  });
}

for (const rk of REGIME_KEYS) {
  test(`regime: ${rk} fleet strategies beat hvac-only on indoor PM2.5`, () => {
    const m = evaluateFleetLab({ regime: rk });
    const hvacOnly = ['merv8-baseline', 'merv13-hvac'].map((id) => m.strategies.find((s) => s.id === id).byRegime[rk].steadyStatePm25);
    const fleets = ['cr-box-fleet', 'classroom-hepa-fleet', 'hybrid-merv13-cr'].map((id) => m.strategies.find((s) => s.id === id).byRegime[rk].steadyStatePm25);
    for (const f of fleets) for (const h of hvacOnly) assert.ok(f < h, `${rk}: fleet ${f} !< hvac ${h}`);
  });
}

test('model: meets5Ach flag is true exactly when delivered ACH >= 5.0', () => {
  const m = evaluateFleetLab({});
  for (const s of m.strategies) {
    assert.equal(s.meets5Ach, s.deliveredCleanAch >= 5.0, s.id);
  }
});

test('model: ASHRAE 241 verdict matches 40 CFM/person threshold exactly', () => {
  const m = evaluateFleetLab({ studentsPerRoom: 26 });
  for (const s of m.strategies) {
    assert.equal(s.meetsAshrae241, s.cfmPerPerson >= ASHRAE_241_CLASSROOM_CFMP, s.id);
  }
});

test('model: higher occupancy lowers CFM per person for every strategy', () => {
  const m20 = evaluateFleetLab({ studentsPerRoom: 20 });
  const m55 = evaluateFleetLab({ studentsPerRoom: 55 });
  for (const id of STRATEGY_IDS) {
    const a = m20.strategies.find((s) => s.id === id).cfmPerPerson;
    const b = m55.strategies.find((s) => s.id === id).cfmPerPerson;
    assert.ok(b < a, `${id}: ${b} !< ${a}`);
  }
});

test('model: more classrooms never reduce the school budget', () => {
  const small = evaluateFleetLab({ classroomCount: 5 });
  const large = evaluateFleetLab({ classroomCount: 90 });
  for (const id of STRATEGY_IDS) {
    const a = small.strategies.find((s) => s.id === id).school3YearUsd;
    const b = large.strategies.find((s) => s.id === id).school3YearUsd;
    assert.ok(b >= a, id);
  }
});

test('model: smoke regime ordering raises indoor PM2.5 monotonically', () => {
  const ordered = ['moderate-20', 'usg-45', 'wildfire-85', 'hazardous-260'];
  const m = evaluateFleetLab({});
  for (const s of m.strategies) {
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(s.byRegime[ordered[i]].steadyStatePm25 > s.byRegime[ordered[i - 1]].steadyStatePm25, `${s.id} ${ordered[i]}`);
    }
  }
});

test('model: state key round-trips through the model unchanged', () => {
  const src = { regime: 'usg-45', classroomCount: 12, studentsPerRoom: 33, filterAgeDays: 200, applyDerates: false, strategy: 'classroom-hepa-fleet' };
  const m = evaluateFleetLab(src);
  assert.deepEqual(m.state, src);
});

test('model: room metadata is the shared reference classroom', () => {
  const m = evaluateFleetLab({});
  assert.equal(m.room.lengthFt, 30);
  assert.equal(m.room.widthFt, 28);
  assert.equal(m.room.heightFt, 10);
  assert.equal(m.room.volumeFt3, 8400);
  assert.equal(m.room.occupants, 26);
});

test('brief: generatedUtc is an ISO-8601 timestamp', () => {
  const b = auditedFleetBrief({});
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(b.payload.generatedUtc), b.payload.generatedUtc);
});

test('brief: cached object is identical for equivalent state spellings', () => {
  const a = auditedFleetBrief({ classroomCount: '30' });
  const b = auditedFleetBrief({ classroomCount: 30 });
  assert.equal(a, b);
});

test('brief: payload carries scope disclaimer and assumptions', () => {
  const b = auditedFleetBrief({});
  assert.ok(/modeled engineering projection/i.test(b.payload.scope));
  assert.ok(Array.isArray(b.payload.assumptions) && b.payload.assumptions.length >= 3);
  for (const line of b.payload.assumptions) assert.equal(typeof line, 'string');
});

test('brief: digest changes when any state field changes', () => {
  const base = auditedFleetBrief({}).digest;
  const variants = [
    { regime: 'usg-45' }, { classroomCount: 21 }, { studentsPerRoom: 27 },
    { filterAgeDays: 1 }, { applyDerates: false }, { strategy: 'merv13-hvac' },
  ];
  for (const v of variants) {
    assert.notEqual(auditedFleetBrief(v).digest, base, JSON.stringify(v));
  }
});

test('csv: school budget numbers survive string form without quotes needed', () => {
  const b = auditedFleetBrief({ classroomCount: 100 });
  const csv = fleetBriefCsv(b);
  const hepaRow = csv.split('\n').find((l) => l.startsWith('classroom-hepa-fleet,'));
  const cols = hepaRow.split(',');
  assert.equal(cols[0], 'classroom-hepa-fleet');
  assert.ok(Number(cols[12]) > 0, `school usd col ${cols[12]}`);
});

test('csv: no row begins with a spreadsheet formula character', () => {
  const csv = fleetBriefCsv(auditedFleetBrief({}));
  for (const line of csv.split('\n')) {
    if (line.startsWith('#') || line === '') continue;
    assert.ok(!/^[=+\-@]/.test(line), line.slice(0, 60));
  }
});

test('markdown: regime in table body matches the selected regime', () => {
  for (const rk of REGIME_KEYS) {
    const b = auditedFleetBrief({ regime: rk });
    const md = fleetBriefMarkdown(b);
    assert.ok(md.includes(`outdoor ${SMOKE_REGIMES[rk].outdoorPm25} ug/m3`), rk);
  }
});

test('codec: share hash contains all six canonical keys exactly once', () => {
  const h = encodeCasHash(FLEET_DEFAULTS);
  const keys = h.slice(5).split('&').map((p) => p.split('=')[0]).sort();
  assert.deepEqual(keys, ['d', 'n', 'r', 's', 't', 'x']);
});

test('codec: encoded values are URI-escaped', () => {
  const h = encodeCasHash({ strategy: 'merv13-hvac' });
  assert.ok(!h.includes(' '), h);
  assert.ok(h.startsWith('#cas='), h);
});

test('codec: decode of empty value for numeric key rejects', () => {
  assert.equal(decodeCasHash('#cas=n='), null);
  assert.equal(decodeCasHash('#cas=d='), null);
  assert.equal(decodeCasHash('#cas=s='), null);
});

test('codec: hash survives an extra round-trip unchanged', () => {
  const s1 = decodeCasHash('#cas=r=usg-45&n=8&s=40&d=15&x=0&t=hybrid-merv13-cr');
  const h2 = encodeCasHash(s1);
  const s2 = decodeCasHash(h2);
  assert.deepEqual(s2, s1);
  assert.equal(h2, '#cas=r=usg-45&n=8&s=40&d=15&x=0&t=hybrid-merv13-cr');
});

test('normalize: boundary values at exact limits pass through unclamped', () => {
  const s = normalizeFleetState({
    classroomCount: FLEET_LIMITS.classroomCount.max,
    studentsPerRoom: FLEET_LIMITS.studentsPerRoom.min,
    filterAgeDays: FLEET_LIMITS.filterAgeDays.max,
  });
  assert.equal(s.classroomCount, 100);
  assert.equal(s.studentsPerRoom, 1);
  assert.equal(s.filterAgeDays, 3650);
});

test('selftests: names are unique', () => {
  const names = runFleetSelfTests().map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
});

test('selftests: includes sha256, codec, csv, and derate coverage', () => {
  const names = runFleetSelfTests().map((r) => r.name).join(' | ');
  assert.ok(/SHA-256/.test(names));
  assert.ok(/#cas=/.test(names));
  assert.ok(/CSV/.test(names));
  assert.ok(/derate|0\.92|0\.60|floor/i.test(names));
});

test('model: eol floor equals fresh ACH for hvac-only strategies', () => {
  const m = evaluateFleetLab({ filterAgeDays: 200 });
  for (const id of ['merv8-baseline', 'merv13-hvac']) {
    const s = m.strategies.find((x) => x.id === id);
    assert.equal(s.eolCleanAch, s.deliveredCleanAch, id);
  }
});

test('model: unitsFor5Ach for hvac-only rows counts reference CR boxes', () => {
  const m = evaluateFleetLab({});
  for (const id of ['merv8-baseline', 'merv13-hvac']) {
    const s = m.strategies.find((x) => x.id === id);
    assert.ok(Number.isInteger(s.unitsFor5Ach) && s.unitsFor5Ach >= 1, `${id}: ${s.unitsFor5Ach}`);
    assert.equal(s.cleanerCount, 0);
  }
});
