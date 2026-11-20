import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

test('DOM: HTML references only local existing files and has zero inline JS or handlers', () => {
  assert.ok(html.includes('href="styles.css"'));
  assert.ok(html.includes('src="js/app.js"'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  assert.ok(fs.existsSync(path.join(ROOT, 'styles.css')));
  assert.ok(fs.existsSync(path.join(ROOT, 'js/app.js')));
});

test('DOM: all IDs referenced by app.js exist in index.html', () => {
  const ids = [...appJs.matchAll(/document\.getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 30, `only ${ids.length} IDs found`);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `Missing id="${id}"`);
});

test('DOM: hero and one-click demo are above the fold markup', () => {
  assert.match(html, /class="hero" data-hero/);
  assert.match(html, /id="hero-title"/);
  assert.match(html, /id="btn-hero-demo"/);
  assert.match(html, /id="btn-demo"/);
  assert.ok(html.indexOf('class="hero"') < html.indexOf('class="workspace"'));
});

test('DOM: hero status explicitly denies a school pilot claim', () => {
  assert.match(html, /No school pilot is claimed/);
  assert.match(html, /modeled engineering projections/);
});

test('DOM: inline data favicon avoids a 404 console error', () => {
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml/);
});

test('DOM: cost comparison and budget breakdown containers exist', () => {
  assert.match(html, /id="compare-bars"/);
  assert.match(html, /id="budget-breakdown"/);
  assert.match(html, /id="budget-note"/);
  assert.match(html, /id="budget-rooms"/);
});

test('DOM: filter lifecycle and derate controls exist', () => {
  assert.match(html, /id="filter-days"/);
  assert.match(html, /id="derates-toggle"/);
});

test('DOM: benchmark table is inside an overflow scroll container', () => {
  assert.match(html, /class="table-scroll"/);
  const before = html.indexOf('class="table-scroll"');
  const table = html.indexOf('<table class="data-table"');
  assert.ok(before >= 0 && table > before);
});

test('DOM: CSP restricts connections and scripts', () => {
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
});

test('CSS: no smooth scrolling rule exists', () => {
  assert.equal(/scroll-behavior\s*:\s*smooth/.test(css), false);
});

test('CSS: responsive breakpoints cover phone and tablet widths', () => {
  assert.match(css, /@media\s*\(max-width:\s*1080px\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
});

test('CSS: horizontal overflow is guarded on body', () => {
  assert.match(css, /overflow-x:\s*hidden/);
});

test('CSS: print stylesheet hides interactive controls', () => {
  assert.match(css, /@media print/);
  assert.match(css, /\.no-print\s*\{\s*display:\s*none/);
});

test('CSS: benchmark table scroll container is bounded to its parent', () => {
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto[^}]*max-width:\s*100%/s);
});

test('app: demo buttons share one handler and scroll to results', () => {
  assert.match(appJs, /btnDemo\.addEventListener\('click', runDemo\)/);
  assert.match(appJs, /btnHeroDemo\.addEventListener\('click', runDemo\)/);
  assert.match(appJs, /scrollIntoView\(\)/);
});

test('app: derate toggle and filter days feed the model', () => {
  assert.match(appJs, /applyDerates:\s*els\.deratesToggle\.checked/);
  assert.match(appJs, /daysSinceReplacement:\s*Number\(els\.filterDays\.value/);
});

test('app: comparison and budget renderers are wired', () => {
  assert.match(appJs, /renderComparison\(roomInput\)/);
  assert.match(appJs, /renderBudget\(\)/);
});

test('app: no AI mention leaks into exported plan scope', () => {
  assert.equal(/artificial intelligence|\bAI\b|LLM|Claude|ChatGPT|GPT/i.test(appJs), false);
});

test('all JS modules pass syntax check', () => {
  const files = ['js/air-engine.mjs', 'js/scenarios.mjs', 'js/benchmark.mjs', 'js/app.js', 'scripts/run-eval.mjs'];
  for (const rel of files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' }), rel);
  }
});

test('hygiene: zero em dashes, en dashes, smooth-scroll, AI leaks, or private paths', () => {
  const homePrefixRe = new RegExp(String.fromCharCode(47, 85, 115, 101, 114, 115, 47));
  const mailRe = new RegExp(['gmail', 'icloud'].map((d) => `${d}\\.com`).join('|'), 'i');
  const aiRe = /artificial intelligence|\bLLM\b|\bClaude\b|\bChatGPT\b|\bGPT-?\d/i;
  const walk = (dir) => {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(full)); else out.push(full);
    }
    return out;
  };
  const textExts = new Set(['.html', '.css', '.js', '.mjs', '.md', '.json', '.txt']);
  for (const file of walk(ROOT)) {
    const ext = path.extname(file).toLowerCase();
    if (!textExts.has(ext) && path.basename(file) !== 'LICENSE') continue;
    const isTestFile = file.includes(`${path.sep}tests${path.sep}`);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('\u2014'), false, `Em-dash in ${file}`);
    assert.equal(text.includes('\u2013'), false, `En-dash in ${file}`);
    assert.equal(homePrefixRe.test(text), false, `Local path in ${file}`);
    assert.equal(mailRe.test(text), false, `Personal email domain in ${file}`);
    if (!isTestFile) assert.equal(aiRe.test(text), false, `AI mention in ${file}`);
    assert.equal(/scroll-behavior\s*:\s*smooth/.test(text), false, `smooth scroll in ${file}`);
  }
});

test('hygiene: no small all-caps eyebrow class above titles', () => {
  assert.equal(/class="[^"]*(eyebrow|kicker|overline)[^"]*"/i.test(html), false);
  assert.equal(/text-transform\s*:\s*uppercase/i.test(css), false);
});

test('hygiene: no tagline paragraph immediately after the h1', () => {
  const afterH1 = html.slice(html.indexOf('id="hero-title"'));
  assert.match(afterH1, /<\/h1>\s*<p class="hero-lede">/);
  assert.equal(/<h1[^>]*>[^<]*<\/h1>\s*<p class="tagline"/i.test(html), false);
});
