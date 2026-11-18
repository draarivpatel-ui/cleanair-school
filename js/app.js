import { computeEpaNowCast, evaluateClassroomAir, buildSchoolGuidance } from './air-engine.mjs';
import { SCHOOL_PRESETS } from './scenarios.mjs';
import { runCleanAirBenchmark } from './benchmark.mjs';

const state = {
  preset: structuredClone(SCHOOL_PRESETS[0]),
  lastOutput: null,
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
  benchPanel: document.getElementById('bench-panel'),
  benchSummary: document.getElementById('bench-summary'),
  benchTbody: document.getElementById('bench-tbody'),
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
  els.presetSelect.addEventListener('change', () => loadPreset(els.presetSelect.value));

  const inputs = [
    els.hourlyInput, els.roomLen, els.roomWid, els.roomHgt,
    els.roomOcc, els.hvacAch, els.mervSelect, els.cleanerCount, els.cleanerSelect,
  ];
  for (const el of inputs) {
    el.addEventListener('change', readInputsAndCompute);
    el.addEventListener('input', readInputsAndCompute);
  }

  els.btnRunBench.addEventListener('click', renderBenchmark);
  els.btnCloseBench.addEventListener('click', () => {
    els.benchPanel.hidden = true;
  });
  els.btnExportJson.addEventListener('click', downloadPlanJson);
  els.btnPrint.addEventListener('click', () => window.print());

  loadPreset(SCHOOL_PRESETS[0].id);
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
  const parsed = els.hourlyInput.value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parsed.length >= 2) state.preset.hourlyPm25 = parsed;
  state.preset.room.lengthFt = Number(els.roomLen.value || 30);
  state.preset.room.widthFt = Number(els.roomWid.value || 28);
  state.preset.room.heightFt = Number(els.roomHgt.value || 10);
  state.preset.room.occupants = Number(els.roomOcc.value || 26);
  state.preset.room.hvacAch = Number(els.hvacAch.value || 3);
  state.preset.room.mervRating = els.mervSelect.value;
  state.preset.room.cleanerCount = Number(els.cleanerCount.value || 0);
  state.preset.room.cleanerId = els.cleanerSelect.value;
  recompute();
}

function recompute() {
  const nowCast = computeEpaNowCast(state.preset.hourlyPm25);
  if (!nowCast) {
    state.lastOutput = null;
    els.kpiOutdoorAqi.textContent = '-';
    els.kpiOutdoorCat.textContent = 'Need >= 2 valid readings in last 3 hours';
    els.kpiIndoorPm.textContent = '-';
    els.kpiIndoorDrop.textContent = '-';
    els.kpiAch.textContent = '-';
    els.kpiUnitsNeeded.textContent = '-';
    els.kpiCfmPerson.textContent = '-';
    els.kpiAshraeStatus.textContent = '-';
    els.alertBadge.textContent = '-';
    els.guideRecess.textContent = '-';
    els.guideSports.textContent = '-';
    els.guideAsthma.textContent = '-';
    els.noticeEn.textContent = '';
    els.noticeEs.textContent = '';
    els.decaySvg.textContent = '';
    return;
  }
  const baseline = evaluateClassroomAir({
    ...state.preset.room,
    cleanerId: 'none',
    cleanerCount: 0,
    outdoorPm25: nowCast.nowCastPm25,
  });
  const upgraded = evaluateClassroomAir({
    ...state.preset.room,
    outdoorPm25: nowCast.nowCastPm25,
  });
  const guidance = buildSchoolGuidance(nowCast, upgraded);
  state.lastOutput = { nowCast, baseline, upgraded, guidance };

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

  renderDecayChart(baseline.trajectory, upgraded.trajectory);
}

function renderDecayChart(baseTraj, upTraj) {
  const svg = els.decaySvg;
  svg.textContent = '';
  const ns = 'http://www.w3.org/2000/svg';
  const W = 480;
  const H = 260;
  const PAD = 38;
  const maxY = Math.max(10, ...baseTraj.map((p) => p.indoorPm25), ...upTraj.map((p) => p.indoorPm25));
  const mapX = (min) => PAD + (min / 120) * (W - 2 * PAD);
  const mapY = (val) => H - PAD - (val / maxY) * (H - 2 * PAD);

  for (let i = 0; i <= 4; i++) {
    const y = PAD + (i / 4) * (H - 2 * PAD);
    svg.appendChild(svgEl(ns, 'line', { x1: PAD, y1: y, x2: W - PAD, y2: y, stroke: '#e2ece8', 'stroke-width': 1 }));
    const labelVal = (maxY * (1 - i / 4)).toFixed(0);
    const t = svgEl(ns, 'text', { x: PAD - 6, y: y + 4, 'text-anchor': 'end', 'font-size': '10', fill: '#4b5d55' });
    t.textContent = labelVal;
    svg.appendChild(t);
  }

  const basePts = baseTraj.map((p) => `${mapX(p.minute).toFixed(1)},${mapY(p.indoorPm25).toFixed(1)}`).join(' ');
  const upPts = upTraj.map((p) => `${mapX(p.minute).toFixed(1)},${mapY(p.indoorPm25).toFixed(1)}`).join(' ');

  svg.appendChild(svgEl(ns, 'polyline', {
    points: basePts, fill: 'none', stroke: '#94a3b8', 'stroke-width': 2.2, 'stroke-dasharray': '6 4',
  }));
  svg.appendChild(svgEl(ns, 'polyline', {
    points: upPts, fill: 'none', stroke: '#0f766e', 'stroke-width': 3,
  }));

  for (const min of [0, 30, 60, 90, 120]) {
    const t = svgEl(ns, 'text', { x: mapX(min), y: H - 14, 'text-anchor': 'middle', 'font-size': '10', fill: '#4b5d55' });
    t.textContent = `${min}m`;
    svg.appendChild(t);
  }
}

function svgEl(ns, tag, attrs) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
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
      row.title,
      `${row.nowCastPm25} ug/m3`,
      `${row.outdoorAqi} (${row.alertLevel})`,
      `${row.baselineAch}`,
      `${row.upgradedAch}`,
      `${row.baselineSteadyPm25} -> ${row.upgradedSteadyPm25} ug/m3 (-${row.pm25DropPct}%)`,
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
    version: '1.0.0',
    modelScope: 'EPA 2024 breakpoints + well-mixed single-room steady/transient model; no live sensor feed.',
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
