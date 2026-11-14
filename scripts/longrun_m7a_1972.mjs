#!/usr/bin/env node
/**
 * M7a 公式長時間ラン: 1932-03 .. 1972-12（980半月）。
 * モックHTTPのみ。実APIは呼ばない。公式レポートはリポジトリ外の m7a/ に保存する。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLongRun } from './longrun_m6_1972.mjs';

const DEFAULT_REPORT = '/workspace/pm/orbis1932/m7a/long-run-report.json';

export async function runM7aLongRun(options = {}) {
  return runLongRun({
    totalHalves: 980,
    nations: ['japan', 'usa', 'uk'],
    reportPath: DEFAULT_REPORT,
    requireArcs: true,
    ...options
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  try {
    const report = await runM7aLongRun();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
