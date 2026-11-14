#!/usr/bin/env node
/**
 * M8b 公式長時間ラン: 1932-03 .. 1972-12（980半月）。
 * モックHTTPのみ。実APIは呼ばない。公式レポートはリポジトリ外の m8b/ に保存する。
 * M8a の台湾・イタリア植民地チェックに、戦後朝鮮の南北分断を加える。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLongRun } from './longrun_m6_1972.mjs';

const DEFAULT_REPORT = '/workspace/pm/orbis1932/m8b/long-run-report.json';
const CHECKPOINTS = [381, 571, 979];

export async function runM8bLongRun(options = {}) {
  return runLongRun({
    totalHalves: 980,
    nations: ['japan', 'usa', 'uk'],
    reportPath: DEFAULT_REPORT,
    requireArcs: true,
    postwarChecks: true,
    m8aChecks: true,
    m8bChecks: true,
    checkpointHalves: CHECKPOINTS,
    ...options
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  try {
    const report = await runM8bLongRun();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
