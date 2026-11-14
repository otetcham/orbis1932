#!/usr/bin/env node
/**
 * オフライン配布構築。
 * - CDN（Google Fonts）依存を除去した HTML を出力する
 * - 実行に必要な JS / data / flags / portraits を単一フォルダへまとめる
 * - 追加コマンド不要の ZIP も生成する
 * - 配布物にテスト用キーや実キーらしき文字列が混入したら失敗する
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createZipFromDirectory } from './zip_util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..');
await import(pathToFileURL(path.join(defaultRoot, 'orbis_version.js')).href);
const version = globalThis.ORBIS_VERSION;
if (!version?.version) throw new Error('orbis_version.js からバージョンを取得できません。');

const SECRET_PATTERNS = [
  /TEST_ONLY_NOT_A_REAL_KEY/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
];
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.json', '.css', '.md', '.txt', '']);

async function copyDirectory(source, destination) {
  await cp(source, destination, {
    recursive: true,
    filter: sourcePath => !sourcePath.split(path.sep).includes('raw')
  });
}

async function listFiles(root) {
  const result = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await walk(root);
  return result;
}

async function assertNoSecrets(root) {
  const findings = [];
  for (const file of await listFiles(root)) {
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const text = await readFile(file, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) findings.push(`${path.relative(root, file)}: ${pattern}`);
    }
  }
  if (findings.length) throw new Error(`配布物にキーらしき文字列が含まれています: ${findings.join(', ')}`);
}

function offlineHtml(source) {
  return source
    .replace(/@import\s+url\(['"]https:\/\/fonts\.googleapis\.com[^)]*\);\s*/g, '')
    .replace(/<script\b[^>]*\bsrc=["'](?:https?:)?\/\/[^"']+["'][^>]*><\/script>\s*/gi, '');
}

function assertOfflineHtml(html, name) {
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html)) throw new Error(`${name} に外部フォント参照が残っています。`);
  if (/<script\b[^>]*\bsrc=["'](?:https?:)?\/\//i.test(html)) throw new Error(`${name} に外部スクリプト参照が残っています。`);
  if (!html.includes('orbis_version.js')) throw new Error(`${name} が orbis_version.js を読み込んでいません。`);
  if (!html.includes('orbis_credits.js')) throw new Error(`${name} が orbis_credits.js を読み込んでいません。`);
  if (!html.includes('id="orbis-build-version"')) throw new Error(`${name} にバージョン表示がありません。`);
}

export async function buildDist(options = {}) {
  const root = path.resolve(options.root || defaultRoot);
  const outDir = path.resolve(options.outDir || path.join(root, 'dist', 'orbis1932'));
  const zipPath = path.resolve(options.zipPath || path.join(root, 'dist', `orbis1932-${version.version}-offline.zip`));
  const sourceRoot = path.resolve(options.sourceRoot || root);
  await rm(outDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(path.dirname(zipPath), { recursive: true });

  for (const name of ['index.html', 'orbis_simulator.html']) {
    const source = await readFile(path.join(sourceRoot, name), 'utf8');
    const transformed = offlineHtml(source);
    assertOfflineHtml(transformed, name);
    await writeFile(path.join(outDir, name), transformed);
  }

  const runtimeScripts = (await readdir(sourceRoot))
    .filter(name => /^orbis_[a-z0-9_]+\.js$/i.test(name))
    .sort();
  for (const name of runtimeScripts) await cp(path.join(sourceRoot, name), path.join(outDir, name));

  await copyDirectory(path.join(sourceRoot, 'data'), path.join(outDir, 'data'));
  await copyDirectory(path.join(sourceRoot, 'flags'), path.join(outDir, 'flags'));
  await copyDirectory(path.join(sourceRoot, 'portraits'), path.join(outDir, 'portraits'));
  for (const name of ['CREDITS']) {
    try { await cp(path.join(sourceRoot, name), path.join(outDir, name)); } catch { /* 任意ファイル */ }
  }

  const flags = (await readdir(path.join(outDir, 'flags'))).length;
  const portraits = (await readdir(path.join(outDir, 'portraits'))).length;
  const dataFiles = (await listFiles(path.join(outDir, 'data'))).map(file => path.relative(outDir, file).split(path.sep).join('/')).sort();
  const buildInfo = {
    product: version.product,
    version: version.version,
    display: version.display,
    offline: true,
    builtAt: new Date().toISOString(),
    entry: 'index.html',
    assets: { flags, portraits, data: dataFiles.length },
    externalRuntimeUrls: []
  };
  await writeFile(path.join(outDir, 'BUILD_INFO.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
  await assertNoSecrets(outDir);

  const zip = await createZipFromDirectory(outDir, zipPath, { prefix: `orbis1932-${version.version}` });
  const zipInfo = await stat(zipPath);
  const files = await listFiles(outDir);
  return {
    outDir,
    zipPath,
    version: version.version,
    display: version.display,
    fileCount: files.length,
    zipBytes: zipInfo.size,
    zipEntries: zip.files.length,
    flags,
    portraits,
    dataFiles: dataFiles.length
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = await buildDist();
  console.log(`配布フォルダ: ${result.outDir}`);
  console.log(`配布ZIP: ${result.zipPath} (${(result.zipBytes / 1024 / 1024).toFixed(2)} MiB)`);
  console.log(`バージョン: ${result.display} / ファイル ${result.fileCount} / 国旗 ${result.flags} / 肖像 ${result.portraits} / data ${result.dataFiles}`);
}
