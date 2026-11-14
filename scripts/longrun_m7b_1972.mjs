#!/usr/bin/env node
/**
 * M7b 公式長時間ラン: 1932-03 .. 1972-12（980半月）。
 * モックHTTPのみ。実APIは呼ばない。公式レポートはリポジトリ外の m7b/ に保存する。
 * 1947年・1955年・1972年のチェックポイントと、戦後処理・脱植民地化の地図反映を検証する。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLongRun } from './longrun_m6_1972.mjs';

const DEFAULT_REPORT = '/workspace/pm/orbis1932/m7b/long-run-report.json';
const CHECKPOINTS = [379, 571, 979];

export async function runM7bLongRun(options = {}) {
  return runLongRun({
    totalHalves: 980,
    nations: ['japan', 'usa', 'uk'],
    reportPath: DEFAULT_REPORT,
    requireArcs: true,
    postwarChecks: true,
    checkpointHalves: CHECKPOINTS,
    ...options
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  try {
    const report = await runM7bLongRun();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
