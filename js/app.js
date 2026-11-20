import {
  computeEpaNowCast, evaluateClassroomAir, buildSchoolGuidance,
  compareCleanerOptions, schoolBudgetProjection,
} from './air-engine.mjs';
import { SCHOOL_PRESETS } from './scenarios.mjs';
import { runCleanAirBenchmark } from './benchmark.mjs';

const state = {
  preset: structuredClone(SCHOOL_PRESETS[0]),
  lastOutput: null,
  demoActive: true,
};

const els = {
  presetSelect: document.getElementById('preset-select'),
  presetSubtitle: document.getElementById('preset-subtitle'),
  hourlyInput: document.getElementById('hourly-input'),
  roomLen: document.getElementById('room-len'),
  roomWid: document.getElementById('room-wid'),
  roomHgt: document.getElementById('room-hgt'),
  roomOcc: document.getElementById('room-occ'),
  hvacAch: document.getElementById('hvac-ach'),
  mervSelect: document.getElementById('merv-select'),
  cleanerCount: document.getElementById('cleaner-count'),
  cleanerSelect: document.getElementById('cleaner-select'),
  filterDays: document.getElementById('filter-days'),
  budgetRooms: document.getElementById('budget-rooms'),
  deratesToggle: document.getElementById('derates-toggle'),
  inputStatus: document.getElementById('input-status'),
  kpiOutdoorAqi: document.getElementById('kpi-outdoor-aqi'),
  kpiOutdoorCat: document.getElementById('kpi-outdoor-cat'),
  kpiIndoorPm: document.getElementById('kpi-indoor-pm'),
  kpiIndoorDrop: document.getElementById('kpi-indoor-drop'),
  kpiAch: document.getElementById('kpi-ach'),
  kpiUnitsNeeded: document.getElementById('kpi-units-needed'),
  kpiCfmPerson: document.getElementById('kpi-cfm-person'),
  kpiAshraeStatus: document.getElementById('kpi-ashrae-status'),
  decaySvg: document.getElementById('decay-svg'),
  alertBadge: document.getElementById('alert-badge'),
  guideRecess: document.getElementById('guide-recess'),
  guideSports: document.getElementById('guide-sports'),
  guideAsthma: document.getElementById('guide-asthma'),
  noticeEn: document.getElementById('notice-en'),
  noticeEs: document.getElementById('notice-es'),
  compareBars: document.getElementById('compare-bars'),
  budgetBreakdown: document.getElementById('budget-breakdown'),
  budgetNote: document.getElementById('budget-note'),
  benchPanel: document.getElementById('bench-panel'),
  benchSummary: document.getElementById('bench-summary'),
  benchTbody: document.getElementById('bench-tbody'),
  heroAqi: document.getElementById('hero-aqi'),
  heroCat: document.getElementById('hero-cat'),
  heroIndoorAqi: document.getElementById('hero-indoor-aqi'),
  heroIndoorPm: document.getElementById('hero-indoor-pm'),
  heroStatus: document.getElementById('hero-status'),
  btnDemo: document.getElementById('btn-demo'),
  btnHeroDemo: document.getElementById('btn-hero-demo'),
  btnRunBench: document.getElementById('btn-run-bench'),
  btnCloseBench: document.getElementById('btn-close-bench'),
  btnExportJson: document.getElementById('btn-export-json'),
  btnPrint: document.getElementById('btn-print'),
};

function init() {
  for (const p of SCHOOL_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    els.presetSelect.appendChild(opt);
  }
  els.presetSelect.addEventListener('change', () => {
    state.demoActive = false;
    loadPreset(els.presetSelect.value);
  });

  const inputs = [
    els.hourlyInput, els.roomLen, els.roomWid, els.roomHgt,
    els.roomOcc, els.hvacAch, els.mervSelect, els.cleanerCount, els.cleanerSelect,
    els.filterDays, els.budgetRooms, els.deratesToggle,
  ];
  for (const el of inputs) {
    el.addEventListener('change', readInputsAndCompute);
    el.addEventListener('input', readInputsAndCompute);
  }

  els.btnDemo.addEventListener('click', runDemo);
  els.btnHeroDemo.addEventListener('click', runDemo);
  els.btnRunBench.addEventListener('click', renderBenchmark);
  els.btnCloseBench.addEventListener('click', () => { els.benchPanel.hidden = true; });
  els.btnExportJson.addEventListener('click', downloadPlanJson);
  els.btnPrint.addEventListener('click', () => window.print());

  loadPreset(SCHOOL_PRESETS[0].id);
}

function runDemo() {
  state.demoActive = true;
  loadPreset(SCHOOL_PRESETS[0].id);
  els.heroStatus.textContent =
    'Demo running: outdoor smoke spike loaded. Indoor values are modeled steady states with one Corsi-Rosenthal box. No school pilot is claimed.';
  document.getElementById('workspace').scrollIntoView();
}

function loadPreset(id) {
  const found = SCHOOL_PRESETS.find((p) => p.id === id) || SCHOOL_PRESETS[0];
  state.preset = structuredClone(found);
  els.presetSelect.value = found.id;
  els.presetSubtitle.textContent = found.subtitle;
  els.hourlyInput.value = found.hourlyPm25.join(', ');
  els.roomLen.value = String(found.room.lengthFt);
  els.roomWid.value = String(found.room.widthFt);
  els.roomHgt.value = String(found.room.heightFt);
  els.roomOcc.value = String(found.room.occupants);
  els.hvacAch.value = String(found.room.hvacAch);
  els.mervSelect.value = found.room.mervRating;
  els.cleanerCount.value = String(found.room.cleanerCount);
  els.cleanerSelect.value = found.room.cleanerId;
  recompute();
}

function readInputsAndCompute() {
  const parsed = els.hourlyInput.value.split(',').map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parsed.length >= 2) state.preset.hourlyPm25 = parsed;
  const room = state.preset.room;
  room.lengthFt = Number(els.roomLen.value || 30);
  room.widthFt = Number(els.roomWid.value || 28);
  room.heightFt = Number(els.roomHgt.value || 10);
  room.occupants = Number(els.roomOcc.value || 26);
  room.hvacAch = Number(els.hvacAch.value || 3);
  room.mervRating = els.mervSelect.value;
  room.cleanerCount = Number(els.cleanerCount.value || 0);
  room.cleanerId = els.cleanerSelect.value;
  room.daysSinceReplacement = Number(els.filterDays.value || 0);
  room.applyDerates = els.deratesToggle.checked;
  recompute();
}

function blankResults(message) {
  state.lastOutput = null;
  for (const el of [
    els.kpiOutdoorAqi, els.kpiOutdoorCat, els.kpiIndoorPm, els.kpiIndoorDrop,
    els.kpiAch, els.kpiUnitsNeeded, els.kpiCfmPerson, els.kpiAshraeStatus,
    els.alertBadge, els.guideRecess, els.guideSports, els.guideAsthma,
  ]) el.textContent = '-';
  els.noticeEn.textContent = '';
  els.noticeEs.textContent = '';
  els.decaySvg.textContent = '';
  els.heroAqi.textContent = '-';
  els.heroIndoorAqi.textContent = '-';
  els.heroStatus.textContent = message;
}

function recompute() {
  const nowCast = computeEpaNowCast(state.preset.hourlyPm25);
  if (!nowCast) {
    blankResults('Need at least 2 valid readings in the last 3 hours.');
    return;
  }
  const roomInput = {
    ...state.preset.room,
    outdoorPm25: nowCast.nowCastPm25,
    applyDerates: els.deratesToggle.checked,
    daysSinceReplacement: Number(els.filterDays.value || 0),
  };
  const baseline = evaluateClassroomAir({ ...roomInput, cleanerId: 'none', cleanerCount: 0 });
  const upgraded = evaluateClassroomAir(roomInput);
  const guidance = buildSchoolGuidance(nowCast, upgraded);
  state.lastOutput = { nowCast, baseline, upgraded, guidance };

  els.inputStatus.textContent = upgraded.valid
    ? 'All inputs valid.'
    : `Using safe defaults: ${upgraded.inputWarnings.join('; ')}.`;

  els.kpiOutdoorAqi.textContent = nowCast.beyondIndex ? 'AQI 500+' : `AQI ${nowCast.aqi}`;
  els.kpiOutdoorCat.textContent = `${nowCast.category} (NowCast ${nowCast.nowCastPm25} ug/m3)`;
  els.kpiIndoorPm.textContent = `${upgraded.steadyStatePm25} ug/m3`;
  els.kpiIndoorDrop.textContent = `Indoor AQI ${upgraded.indoorSteadyAqi.aqi} (-${upgraded.indoorReductionPct}% vs outdoors)`;
  els.kpiAch.textContent = `${upgraded.deliveredCleanAch} ACH`;
  const unitSuffix = state.preset.room.cleanerId === 'none' ? ' (Corsi-class)' : '';
  els.kpiUnitsNeeded.textContent = upgraded.meets5Ach
    ? 'Meets 5.0+ ACH clean-air target'
    : `Needs ${upgraded.unitsFor5Ach} units total${unitSuffix} for 5.0 ACH`;
  els.kpiCfmPerson.textContent = `${upgraded.cfmPerPerson} CFM/p`;
  els.kpiAshraeStatus.textContent = upgraded.meetsAshrae241
    ? 'Meets ASHRAE 241 (40 CFM/person)'
    : 'Below 40 CFM/person ASHRAE 241 target';
  els.alertBadge.textContent = `${guidance.alertLevel} ALERT`;
  els.alertBadge.style.color = nowCast.color;
  els.guideRecess.textContent = guidance.recessAction;
  els.guideSports.textContent = guidance.sportsAction;
  els.guideAsthma.textContent = guidance.asthmaProtocol;
  els.noticeEn.textContent = guidance.enNotice;
  els.noticeEs.textContent = guidance.esNotice;

  els.heroAqi.textContent = nowCast.beyondIndex ? 'AQI 500+' : `AQI ${nowCast.aqi}`;
  els.heroCat.textContent = nowCast.category;
  els.heroAqi.style.color = nowCast.color;
  els.heroIndoorAqi.textContent = `AQI ${upgraded.indoorSteadyAqi.aqi}`;
  els.heroIndoorPm.textContent = `${upgraded.steadyStatePm25} ug/m3 modeled steady state`;
  if (state.demoActive) {
    els.heroStatus.textContent = 'Modeled scenario: wildfire smoke plume arriving before morning recess. Every displayed value is an engineering projection, not a measured school pilot.';
  }

  renderDecayChart(baseline.trajectory, upgraded.trajectory);
  renderComparison(roomInput);
  renderBudget();
}

function renderDecayChart(baseTraj, upTraj) {
  const svg = els.decaySvg;
  svg.textContent = '';
  const ns = 'http://www.w3.org/2000/svg';
  const W = 480, H = 260, PAD = 38;
  const maxY = Math.max(10, ...baseTraj.map((p) => p.indoorPm25), ...upTraj.map((p) => p.indoorPm25));
  const mapX = (min) => PAD + (min / 120) * (W - 2 * PAD);
  const mapY = (val) => H - PAD - (val / maxY) * (H - 2 * PAD);

  for (let i = 0; i <= 4; i++) {
    const y = PAD + (i / 4) * (H - 2 * PAD);
    svg.appendChild(svgEl(ns, 'line', { x1: PAD, y1: y, x2: W - PAD, y2: y, stroke: '#e2ece8', 'stroke-width': 1 }));
    const t = svgEl(ns, 'text', { x: PAD - 6, y: y + 4, 'text-anchor': 'end', 'font-size': '10', fill: '#43584f' });
    t.textContent = (maxY * (1 - i / 4)).toFixed(0);
    svg.appendChild(t);
  }
  const basePts = baseTraj.map((p) => `${mapX(p.minute).toFixed(1)},${mapY(p.indoorPm25).toFixed(1)}`).join(' ');
  const upPts = upTraj.map((p) => `${mapX(p.minute).toFixed(1)},${mapY(p.indoorPm25).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl(ns, 'polyline', { points: basePts, fill: 'none', stroke: '#94a3b8', 'stroke-width': 2.2, 'stroke-dasharray': '6 4' }));
  svg.appendChild(svgEl(ns, 'polyline', { points: upPts, fill: 'none', stroke: '#0f766e', 'stroke-width': 3 }));
  for (const min of [0, 30, 60, 90, 120]) {
    const t = svgEl(ns, 'text', { x: mapX(min), y: H - 14, 'text-anchor': 'middle', 'font-size': '10', fill: '#43584f' });
    t.textContent = `${min}m`;
    svg.appendChild(t);
  }
}

function svgEl(ns, tag, attrs) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function renderComparison(roomInput) {
  const rows = compareCleanerOptions(roomInput).filter((r) => r.id !== 'none');
  els.compareBars.textContent = '';
  const bestCfm = Math.max(...rows.map((r) => r.effectivePortableCfm || r.cadrCfm));
  const bestCost = Math.max(...rows.map((r) => r.threeYearCostUsd || 0));
  for (const row of rows) {
    const wrapper = document.createElement('div');
    wrapper.className = 'compare-row';
    const caption = document.createElement('div');
    caption.className = 'compare-caption';
    const name = document.createElement('strong');
    name.textContent = row.name;
    const detail = document.createElement('span');
    detail.textContent = `indoor AQI ${row.indoorAqi} / ${row.deliveredCleanAch} ACH`;
    caption.append(name, detail);
    const track = document.createElement('div');
    track.className = 'compare-track';
    const fill = document.createElement('div');
    fill.className = 'compare-fill';
    fill.style.width = `${Math.round((row.effectivePortableCfm / bestCfm) * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'compare-value';
    value.textContent = `$${row.threeYearCostUsd} / 3y`;
    wrapper.append(caption, track, value);
    els.compareBars.appendChild(wrapper);
  }
}

function renderBudget() {
  const rooms = Number(els.budgetRooms.value || 20);
  const cleanerId = els.cleanerSelect.value;
  const p = schoolBudgetProjection(rooms, cleanerId === 'none' ? 'corsi_box' : cleanerId);
  els.budgetBreakdown.textContent = '';
  const rows = [
    ['Classrooms equipped', String(p.classroomCount)],
    ['Portable units (hardware)', `$${p.hardwareUsd}`],
    ['Filter replacements, year 1', `$${p.filtersYear1Usd}`],
    ['Filter replacements, 3 years', `$${p.filters3YearUsd}`],
  ];
  for (const [label, value] of rows) {
    const div = document.createElement('div');
    div.className = 'budget-row';
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('strong'); v.textContent = value;
    div.append(l, v);
    els.budgetBreakdown.appendChild(div);
  }
  const total = document.createElement('div');
  total.className = 'budget-row total';
  const l = document.createElement('span'); l.textContent = 'Modeled 3-year total';
  const v = document.createElement('strong'); v.textContent = `$${p.total3YearUsd}`;
  total.append(l, v);
  els.budgetBreakdown.appendChild(total);
  els.budgetNote.textContent = p.projectionNote;
}

function renderBenchmark() {
  const report = runCleanAirBenchmark();
  els.benchPanel.hidden = false;
  els.benchSummary.textContent =
    `EPA 2024 exact edge checks: ${report.breakpointPassCount}/${report.breakpointCount}. `
    + `Across ${report.scenarioCount} school scenarios, adding portable filtration lowers modeled steady indoor PM2.5 by a mean of ${report.meanIndoorDropPct}%.`;
  els.benchTbody.textContent = '';
  for (const row of report.scenarioComparisons) {
    const tr = document.createElement('tr');
    const cells = [
      row.title, `${row.nowCastPm25} ug/m3`, `${row.outdoorAqi} (${row.alertLevel})`,
      `${row.baselineAch}`, `${row.upgradedAch}`,
      `${row.baselineSteadyPm25} to ${row.upgradedSteadyPm25} ug/m3 (-${row.pm25DropPct}%)`,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    els.benchTbody.appendChild(tr);
  }
}

function downloadPlanJson() {
  if (!state.lastOutput) return;
  const payload = {
    tool: 'CleanAirSchool',
    version: '2.0.0',
    modelScope: 'EPA 2024 breakpoints + single-room steady/transient model with optional derates. All outputs are modeled projections; no live sensor feed or measured school pilot.',
    preset: state.preset,
    output: state.lastOutput,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.preset.id}-cleanair-plan.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

init();
