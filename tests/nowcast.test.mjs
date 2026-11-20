import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEpaNowCast } from '../js/air-engine.mjs';

test('NowCast: empty or non-array input returns null', () => {
  assert.equal(computeEpaNowCast([]), null);
  assert.equal(computeEpaNowCast(null), null);
  assert.equal(computeEpaNowCast(undefined), null);
  assert.equal(computeEpaNowCast('12,13'), null);
});

test('NowCast: requires at least two valid of the latest three hours', () => {
  assert.equal(computeEpaNowCast([15, null, null]), null);
  assert.equal(computeEpaNowCast([15, 16, NaN]).nowCastPm25, 15.5);
  assert.equal(computeEpaNowCast([15, 16, -1]).nowCastPm25, 15.5);
  assert.equal(computeEpaNowCast([NaN, NaN, 15]), null);
  assert.ok(computeEpaNowCast([15, 16, null]));
  assert.ok(computeEpaNowCast([null, 16, 17]));
});

test('NowCast: steady series returns the concentration with weight 1', () => {
  const out = computeEpaNowCast([20, 20, 20, 20, 20, 20]);
  assert.equal(out.nowCastPm25, 20);
  assert.equal(out.weightFactor, 1);
  assert.equal(out.aqi, 71);
});

test('NowCast: all-zero series returns zero', () => {
  const out = computeEpaNowCast([0, 0, 0, 0]);
  assert.equal(out.nowCastPm25, 0);
  assert.equal(out.aqi, 0);
  assert.equal(out.weightFactor, 1);
});

test('NowCast: large spike clamps w* to 0.5', () => {
  const out = computeEpaNowCast([10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 60, 100]);
  assert.equal(out.weightFactor, 0.5);
  assert.ok(out.nowCastPm25 > 65 && out.nowCastPm25 < 75);
});

test('NowCast: moderate variability yields weight above 0.5', () => {
  const out = computeEpaNowCast([20, 22, 24, 26, 28, 30]);
  assert.ok(out.weightFactor > 0.5 && out.weightFactor <= 1);
  assert.ok(out.nowCastPm25 >= 20 && out.nowCastPm25 <= 30);
});

test('NowCast: only the latest 12 hours are considered', () => {
  const short = computeEpaNowCast([30, 30, 30]);
  const long = computeEpaNowCast([1000, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  assert.equal(short.nowCastPm25, long.nowCastPm25);
  assert.equal(short.weightFactor, long.weightFactor);
});

test('NowCast: ignores invalid values inside the window', () => {
  const mixed = computeEpaNowCast([10, NaN, 20, Infinity, 30, 40, 50]);
  assert.ok(Number.isFinite(mixed.nowCastPm25));
  assert.ok(mixed.nowCastPm25 >= 10 && mixed.nowCastPm25 <= 50);
  assert.ok(mixed.weightFactor >= 0.5);
});

test('NowCast: one valid old hour with two valid recent hours calculates normally', () => {
  const out = computeEpaNowCast([12, null, 14, 16]);
  assert.ok(out.nowCastPm25 >= 12 && out.nowCastPm25 <= 16);
  assert.equal(out.inputValid, true);
});

test('NowCast: output carries complete AQI fields', () => {
  const out = computeEpaNowCast([30, 40, 50]);
  for (const key of ['nowCastPm25', 'weightFactor', 'aqi', 'category', 'key', 'color', 'beyondIndex', 'inputValid']) {
    assert.ok(Object.hasOwn(out, key), `missing field ${key}`);
  }
});

test('NowCast: extreme but finite readings remain Beyond Index safe', () => {
  const out = computeEpaNowCast([1000000, 1000000, 1000000]);
  assert.equal(out.aqi, 500);
  assert.equal(out.beyondIndex, true);
  assert.ok(Number.isFinite(out.nowCastPm25));
});

test('NowCast: negative-only recent hours are rejected', () => {
  assert.equal(computeEpaNowCast([-5, -6, -7]), null);
});
