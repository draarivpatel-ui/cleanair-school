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
  hourlyWarn: '',
  chart: null,
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
  decayMinute: document.getElementById('decay-minute'),
  decayReadout: document.getElementById('decay-readout'),
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
  heroScale: document.getElementById('hero-scale'),
  heroMarkOut: document.getElementById('hero-mark-out'),
  heroMarkIn: document.getElementById('hero-mark-in'),
  btnDemo: document.getElementById('btn-demo'),
  btnHeroDemo: document.getElementById('btn-hero-demo'),
  btnRunBench: document.getElementById('btn-run-bench'),
  btnCloseBench: document.getElementById('btn-close-bench'),
  btnExportJson: document.getElementById('btn-export-json'),
  btnPrint: document.getElementById('btn-print'),
};

// EPA 2024 AQI tier edges; the hero band draws six equal-width tiers.
const AQI_EDGES = [0, 50, 100, 150, 200, 300, 500];
const NARROW_QUERY = window.matchMedia('(max-width: 520px)');
const MID_QUERY = window.matchMedia('(max-width: 1080px)');

function aqiBandPct(aqi) {
  const a = Math.min(500, Math.max(0, Number(aqi) || 0));
  for (let i = 1; i < AQI_EDGES.length; i++) {
    if (a <= AQI_EDGES[i]) {
      const lo = AQI_EDGES[i - 1];
      return (((i - 1) + (a - lo) / (AQI_EDGES[i] - lo)) / (AQI_EDGES.length - 1)) * 100;
    }
  }
  return 100;
}

function placeMark(mark, aqi) {
  const pct = aqiBandPct(aqi);
  mark.hidden = false;
  mark.style.left = `${pct.toFixed(2)}%`;
  if (pct < 12) mark.dataset.edge = 'start';
  else if (pct > 88) mark.dataset.edge = 'end';
  else delete mark.dataset.edge;
}

function setCardState(valueEl, attrs) {
  const card = valueEl.closest('.kpi-card');
  if (!card) return;
  delete card.dataset.state;
  delete card.dataset.tone;
  Object.assign(card.dataset, attrs);
}

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
  initChartControls();

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
  const rerenderChart = () => {
    const out = state.lastOutput;
    if (out) renderDecayChart(out.baseline.trajectory, out.upgraded.trajectory);
  };
  NARROW_QUERY.addEventListener('change', rerenderChart);
  MID_QUERY.addEventListener('change', rerenderChart);

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
  if (!state.demoActive) {
    els.heroStatus.textContent = `${found.subtitle}. Modeled engineering projection, not a measured school pilot.`;
  }
  recompute();
}

function readInputsAndCompute() {
  const parsed = els.hourlyInput.value.split(',').map((s) => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
  if (parsed.filter((n) => n !== null).length >= 2) {
    state.preset.hourlyPm25 = parsed;
    state.hourlyWarn = parsed.some((n) => n === null)
      ? 'Blank or invalid hourly entries count as missing hours in the NowCast window.'
      : '';
  } else {
    state.hourlyWarn = 'Hourly readings ignored: enter at least 2 valid PM2.5 numbers.';
  }
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
  state.chart = null;
  for (const el of [
    els.kpiOutdoorAqi, els.kpiOutdoorCat, els.kpiIndoorPm, els.kpiIndoorDrop,
    els.kpiAch, els.kpiUnitsNeeded, els.kpiCfmPerson, els.kpiAshraeStatus,
    els.alertBadge, els.guideRecess, els.guideSports, els.guideAsthma,
  ]) el.textContent = '-';
  els.alertBadge.style.color = '';
  els.alertBadge.style.background = '';
  els.noticeEn.textContent = '';
  els.noticeEs.textContent = '';
  els.decaySvg.textContent = '';
  els.decayMinute.disabled = true;
  els.decayMinute.removeAttribute('aria-valuetext');
  els.decayReadout.textContent = `Chart readings unavailable. ${message}`;
  els.compareBars.textContent = '';
  els.heroAqi.textContent = '-';
  els.heroAqi.style.color = '';
  els.heroCat.textContent = '';
  els.heroCat.style.color = '';
  els.heroCat.style.background = '';
  els.heroIndoorAqi.textContent = '-';
  els.heroIndoorPm.textContent = '';
  delete els.heroAqi.dataset.tone;
  delete els.heroIndoorAqi.dataset.tone;
  els.heroMarkOut.hidden = true;
  els.heroMarkIn.hidden = true;
  els.heroScale.setAttribute('aria-label', 'EPA 2024 AQI scale. No reading available.');
  for (const v of [els.kpiOutdoorAqi, els.kpiIndoorPm, els.kpiAch, els.kpiCfmPerson]) setCardState(v, {});
  els.inputStatus.textContent = state.hourlyWarn || message;
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

  const statusNotes = [];
  if (upgraded.valid) statusNotes.push('All inputs valid.');
  else statusNotes.push(`Using safe defaults: ${upgraded.inputWarnings.join('; ')}.`);
  if (state.hourlyWarn) statusNotes.push(state.hourlyWarn);
  if (Number(els.filterDays.value || 0) > 0 && !els.deratesToggle.checked) {
    statusNotes.push('Filter age has no effect until real-world derates are enabled.');
  }
  if (upgraded.replacementDue) statusNotes.push('Filter replacement is due (modeled load).');
  els.inputStatus.textContent = statusNotes.join(' ');

  els.kpiOutdoorAqi.textContent = nowCast.beyondIndex ? 'AQI 500+' : `AQI ${nowCast.aqi}`;
  els.kpiOutdoorCat.textContent = `${nowCast.category} (NowCast ${nowCast.nowCastPm25} ug/m3)`;
  els.kpiIndoorPm.textContent = `${upgraded.steadyStatePm25} ug/m3`;
  els.kpiIndoorDrop.textContent = nowCast.nowCastPm25 > 0
    ? `Indoor AQI ${upgraded.indoorSteadyAqi.aqi} (-${upgraded.indoorReductionPct}% vs outdoors)`
    : `Indoor AQI ${upgraded.indoorSteadyAqi.aqi} (no outdoor PM2.5)`;
  els.kpiAch.textContent = `${upgraded.deliveredCleanAch} ACH`;
  const unitSuffix = state.preset.room.cleanerId === 'none' ? ' (Corsi-class)' : '';
  els.kpiUnitsNeeded.textContent = upgraded.meets5Ach
    ? 'Meets 5.0+ ACH clean-air target'
    : upgraded.unitsFor5AchCapped
      ? `Exceeds the 64-unit feasibility cap${unitSuffix} for 5.0 ACH`
      : `Needs ${upgraded.unitsFor5Ach} units total${unitSuffix} for 5.0 ACH`;
  els.kpiCfmPerson.textContent = `${upgraded.cfmPerPerson} CFM/p`;
  els.kpiAshraeStatus.textContent = upgraded.meetsAshrae241
    ? 'Meets ASHRAE 241 (40 CFM/person)'
    : 'Below 40 CFM/person ASHRAE 241 target';
  els.alertBadge.textContent = `${guidance.alertLevel} ALERT`;
  els.alertBadge.style.color = nowCast.chipText;
  els.alertBadge.style.background = nowCast.chipBg;
  els.guideRecess.textContent = guidance.recessAction;
  els.guideSports.textContent = guidance.sportsAction;
  els.guideAsthma.textContent = guidance.asthmaProtocol;
  els.noticeEn.textContent = guidance.enNotice;
  els.noticeEs.textContent = guidance.esNotice;

  els.heroAqi.textContent = nowCast.beyondIndex ? 'AQI 500+' : `AQI ${nowCast.aqi}`;
  els.heroCat.textContent = nowCast.category;
  els.heroCat.style.color = nowCast.chipText;
  els.heroCat.style.background = nowCast.chipBg;
  els.heroAqi.style.color = '';
  els.heroIndoorAqi.textContent = `AQI ${upgraded.indoorSteadyAqi.aqi} ${upgraded.indoorSteadyAqi.category}`;
  els.heroIndoorPm.textContent = `${upgraded.steadyStatePm25} ug/m3 modeled steady state`;
  els.heroAqi.dataset.tone = nowCast.key;
  els.heroIndoorAqi.dataset.tone = upgraded.indoorSteadyAqi.key;
  placeMark(els.heroMarkOut, nowCast.aqi);
  placeMark(els.heroMarkIn, upgraded.indoorSteadyAqi.aqi);
  els.heroScale.setAttribute('aria-label',
    `EPA 2024 AQI scale: outdoor ${nowCast.beyondIndex ? '500+' : nowCast.aqi} ${nowCast.category}, modeled indoor ${upgraded.indoorSteadyAqi.aqi} ${upgraded.indoorSteadyAqi.category}.`);
  setCardState(els.kpiOutdoorAqi, { tone: nowCast.key });
  setCardState(els.kpiIndoorPm, { tone: upgraded.indoorSteadyAqi.key });
  setCardState(els.kpiAch, { state: upgraded.meets5Ach ? 'ok' : 'warn' });
  setCardState(els.kpiCfmPerson, { state: upgraded.meetsAshrae241 ? 'ok' : 'warn' });
  if (state.demoActive) {
    els.heroStatus.textContent = 'Modeled scenario: wildfire smoke plume arriving before morning recess. Every displayed value is an engineering projection, not a measured school pilot.';
  }

  renderDecayChart(baseline.trajectory, upgraded.trajectory);
  renderComparison(roomInput);
  renderBudget();
}

// Round axis maximum and step (1, 2, 2.5, 5 x 10^n) so ticks read as plain numbers.
function niceAxis(rawMax, target = 4) {
  const raw = Math.max(rawMax, 1e-6) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw - 1e-9);
  const count = Math.max(1, Math.ceil(rawMax / step - 1e-9));
  return { step, max: count * step, count };
}

function renderDecayChart(baseTraj, upTraj) {
  const svg = els.decaySvg;
  svg.textContent = '';
  const ns = 'http://www.w3.org/2000/svg';
  const narrow = NARROW_QUERY.matches;
  const mid = !narrow && MID_QUERY.matches;
  const W = narrow ? 360 : mid ? 600 : 480, H = narrow ? 250 : mid ? 300 : 260, PAD = narrow ? 36 : 42;
  const FS = narrow ? 11.5 : 11;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const rawMax = Math.max(10, ...baseTraj.map((p) => p.indoorPm25), ...upTraj.map((p) => p.indoorPm25));
  const axis = niceAxis(rawMax);
  const maxY = axis.max;
  const mapX = (min) => PAD + (min / 120) * (W - 2 * PAD);
  const mapY = (val) => H - PAD - (val / maxY) * (H - 2 * PAD);
  state.chart = { baseTraj, upTraj, mapX, mapY, W, PAD };

  const fmtTick = (v) => {
    if (v >= 1000) return `${Number((v / 1000).toFixed(1))}k`;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  const unit = svgEl(ns, 'text', { x: PAD - 6, y: PAD - 14, 'font-size': FS, fill: '#4a5753', 'font-weight': 650 });
  unit.textContent = 'Indoor PM2.5, ug/m3';
  svg.appendChild(unit);
  for (let i = 0; i <= axis.count; i++) {
    const v = axis.step * i;
    const y = mapY(v);
    svg.appendChild(svgEl(ns, 'line', { x1: PAD, y1: y, x2: W - PAD, y2: y, stroke: i === 0 ? '#9aa9a4' : '#e3e9e7', 'stroke-width': 1 }));
    const t = svgEl(ns, 'text', { x: PAD - 6, y: y + 4, 'text-anchor': 'end', 'font-size': FS, fill: '#4a5753' });
    t.textContent = fmtTick(v);
    svg.appendChild(t);
  }
  const basePts = baseTraj.map((p) => `${mapX(p.minute).toFixed(1)},${mapY(p.indoorPm25).toFixed(1)}`).join(' ');
  const upPts = upTraj.map((p) => `${mapX(p.minute).toFixed(1)},${mapY(p.indoorPm25).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl(ns, 'polyline', { points: basePts, fill: 'none', stroke: '#5b6672', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl(ns, 'polyline', { points: upPts, fill: 'none', stroke: '#0d6b63', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  for (const p of baseTraj) {
    const c = svgEl(ns, 'circle', { cx: mapX(p.minute), cy: mapY(p.indoorPm25), r: 2.4, fill: '#5b6672' });
    const tip = svgEl(ns, 'title', {});
    tip.textContent = `${p.minute} min HVAC only: ${p.indoorPm25} ug/m3 (AQI ${p.indoorAqi})`;
    c.appendChild(tip);
    svg.appendChild(c);
  }
  for (const p of upTraj) {
    const c = svgEl(ns, 'circle', { cx: mapX(p.minute), cy: mapY(p.indoorPm25), r: 3, fill: '#0d6b63', stroke: '#ffffff', 'stroke-width': 1 });
    const tip = svgEl(ns, 'title', {});
    tip.textContent = `${p.minute} min with cleaners: ${p.indoorPm25} ug/m3 (AQI ${p.indoorAqi})`;
    c.appendChild(tip);
    svg.appendChild(c);
  }
  // Direct end labels: the 120-minute value of each line, nudged apart when close.
  const lastBase = baseTraj[baseTraj.length - 1];
  const lastUp = upTraj[upTraj.length - 1];
  if (lastBase && lastUp) {
    let yb = mapY(lastBase.indoorPm25) + 4;
    let yu = mapY(lastUp.indoorPm25) + 4;
    if (Math.abs(yb - yu) < FS + 1) {
      const midY = (yb + yu) / 2;
      const half = (FS + 1) / 2;
      if (lastBase.indoorPm25 >= lastUp.indoorPm25) { yb = midY - half; yu = midY + half; } else { yb = midY + half; yu = midY - half; }
    }
    const endX = mapX(120) + 6;
    const eb = svgEl(ns, 'text', { x: endX, y: yb, 'font-size': FS, fill: '#4a5753', 'font-weight': 650, 'data-end-label': 'base' });
    eb.textContent = fmtTick(lastBase.indoorPm25);
    const eu = svgEl(ns, 'text', { x: endX, y: yu, 'font-size': FS, fill: '#08433e', 'font-weight': 750, 'data-end-label': 'up' });
    eu.textContent = fmtTick(lastUp.indoorPm25);
    svg.append(eb, eu);
  }
  for (const min of [0, 30, 60, 90, 120]) {
    svg.appendChild(svgEl(ns, 'line', { x1: mapX(min), y1: H - PAD, x2: mapX(min), y2: H - PAD + 4, stroke: '#9aa9a4', 'stroke-width': 1 }));
    const t = svgEl(ns, 'text', { x: mapX(min), y: H - PAD + 17, 'text-anchor': 'middle', 'font-size': FS, fill: '#4a5753' });
    t.textContent = `${min}m`;
    svg.appendChild(t);
  }
  const xTitle = svgEl(ns, 'text', { x: W - PAD, y: H - 4, 'text-anchor': 'end', 'font-size': FS - 1, fill: '#4a5753' });
  xTitle.textContent = 'minutes after intervention';
  svg.appendChild(xTitle);
  const guide = svgEl(ns, 'g', { visibility: 'hidden', 'data-hover-layer': 'true' });
  guide.appendChild(svgEl(ns, 'line', {
    'data-guide-line': 'true', x1: 0, y1: PAD, x2: 0, y2: H - PAD, stroke: '#08433e', 'stroke-width': 1, 'stroke-dasharray': '3 3',
  }));
  guide.appendChild(svgEl(ns, 'circle', { 'data-guide-base': 'true', r: 5, fill: '#ffffff', stroke: '#6b7785', 'stroke-width': 2 }));
  guide.appendChild(svgEl(ns, 'circle', { 'data-guide-up': 'true', r: 5.5, fill: '#ffffff', stroke: '#08433e', 'stroke-width': 2.5 }));
  svg.appendChild(guide);
  const hit = svgEl(ns, 'rect', {
    x: PAD, y: PAD, width: W - 2 * PAD, height: H - 2 * PAD, fill: 'transparent', 'pointer-events': 'all', 'data-hit-layer': 'true',
  });
  svg.appendChild(hit);
  renderSelectedDecayReading();
  els.decayMinute.disabled = false;
}

function initChartControls() {
  const svg = els.decaySvg;
  const nearest = (evt) => {
    if (!state.chart) return;
    const { W, PAD } = state.chart;
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return;
    const vx = ((evt.clientX - r.left) * W) / r.width;
    const frac = Math.min(1, Math.max(0, (vx - PAD) / (W - 2 * PAD)));
    renderDecayReading(Math.round((frac * 120) / 10) * 10);
  };
  svg.addEventListener('pointermove', nearest);
  svg.addEventListener('pointerdown', nearest);
  svg.addEventListener('pointerleave', renderSelectedDecayReading);
  svg.addEventListener('pointercancel', renderSelectedDecayReading);
  els.decayMinute.addEventListener('input', renderSelectedDecayReading);
}

function renderSelectedDecayReading() {
  const reading = renderDecayReading(els.decayMinute.valueAsNumber);
  if (reading) els.decayMinute.setAttribute('aria-valuetext', reading);
}

function renderDecayReading(minute) {
  if (!state.chart) return;
  const svg = els.decaySvg;
  const { mapX, mapY, baseTraj, upTraj } = state.chart;
  const idx = minute / 10;
  const base = baseTraj[idx];
  const up = upTraj[idx];
  if (!base || !up) return;
  const guide = svg.querySelector('[data-hover-layer]');
  const line = svg.querySelector('[data-guide-line]');
  const cb = svg.querySelector('[data-guide-base]');
  const cu = svg.querySelector('[data-guide-up]');
  const x = mapX(minute);
  guide.setAttribute('visibility', 'visible');
  line.setAttribute('x1', String(x));
  line.setAttribute('x2', String(x));
  cb.setAttribute('cx', String(x));
  cb.setAttribute('cy', String(mapY(base.indoorPm25)));
  cu.setAttribute('cx', String(x));
  cu.setAttribute('cy', String(mapY(up.indoorPm25)));
  const reading = `At ${minute} min: ${up.indoorPm25} ug/m3 with cleaners (AQI ${up.indoorAqi}) vs ${base.indoorPm25} ug/m3 HVAC only (AQI ${base.indoorAqi}).`;
  if (els.decayReadout.textContent !== reading) els.decayReadout.textContent = reading;
  return reading;
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
  els.budgetNote.textContent = cleanerId === 'none'
    ? `${p.projectionNote} No cleaner selected above; shown as a Corsi-Rosenthal reference.`
    : p.projectionNote;
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
    version: '2.1.0',
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

// Fleet Retrofit & Lifecycle Lab loads only when js/fleet-lab.mjs exists; the
// section markup stays hidden when the module or its host element is absent.
import('./fleet-lab.mjs')
  .then((m) => {
    try {
      window.__casFleetLab = m.initFleetLab(document, window);
    } catch {
      window.__casFleetLab = null;
    }
  })
  .catch(() => { window.__casFleetLab = null; });
