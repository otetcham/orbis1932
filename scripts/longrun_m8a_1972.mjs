#!/usr/bin/env node
/**
 * M8a 公式長時間ラン: 1932-03 .. 1972-12（980半月）。
 * モックHTTPのみ。実APIは呼ばない。公式レポートはリポジトリ外の m8a/ に保存する。
 * M7b の戦後・脱植民地化チェックに、台湾の中華民国復帰とイタリア植民地の再割当を加える。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runLongRun } from './longrun_m6_1972.mjs';

const DEFAULT_REPORT = '/workspace/pm/orbis1932/m8a/long-run-report.json';
const CHECKPOINTS = [379, 571, 979];

export async function runM8aLongRun(options = {}) {
  return runLongRun({
    totalHalves: 980,
    nations: ['japan', 'usa', 'uk'],
    reportPath: DEFAULT_REPORT,
    requireArcs: true,
    postwarChecks: true,
    m8aChecks: true,
    checkpointHalves: CHECKPOINTS,
    ...options
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  try {
    const report = await runM8aLongRun();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
