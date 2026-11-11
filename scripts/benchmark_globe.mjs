#!/usr/bin/env node
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(pageUrl, { waitUntil: 'load' });
await page.waitForFunction(() => typeof updateMapVisuals === 'function' && state?.states?.length > 1000);

const stats = await page.evaluate(() => {
  const sample = (fn, n = 28) => {
    const samples = [];
    let t0 = performance.now();
    for (let i = 0; i < n; i++) {
      fn(i);
      samples.push(performance.now() - t0);
      t0 = performance.now();
    }
    samples.sort((a, b) => a - b);
    return { p50Ms: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)] };
  };
  state.mapProjection = 'flat';
  const flat = sample(i => {
    state.mapTransform.scale = 0.8 + i * 0.45;
    updateMapVisuals();
  });
  state.mapProjection = 'globe';
  const globeFull = sample(i => {
    state.globe.lon = (state.globe.lon + 9) % 360;
    state.globe.lat = Math.sin(i / 3) * 18;
    updateMapVisuals();
  }, 30);
  const globeLite = sample(i => {
    state.globe.lon = (state.globe.lon + 9) % 360;
    state.globe.lat = Math.sin(i / 3) * 18;
    state.mapTransform.isDragging = true;
    updateMapVisualsLite();
    state.mapTransform.isDragging = false;
  }, 30);
  return {
    landRegions: ORBIS_STATES_DB.filter(s => !s.isSea).length,
    flat,
    globeFull,
    globeLite,
  };
});

console.log(JSON.stringify({ scene: 'phase_m', ...stats, flatFpsP50: +(1000 / stats.flat.p50Ms).toFixed(1), globeFpsP50: +(1000 / stats.globeFull.p50Ms).toFixed(1), globeLiteFpsP50: +(1000 / stats.globeLite.p50Ms).toFixed(1) }, null, 2));
await browser.close();
