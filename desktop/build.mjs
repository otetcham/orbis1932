#!/usr/bin/env node
/**
 * デスクトップ包装のローカル検証ビルド（未署名）。
 * 署名・公証・ストア提出・アップロードは行わない。
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { buildDist } from '../scripts/build_dist.mjs';
import { createZipFromDirectory } from '../scripts/zip_util.mjs';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktopDir, '..');
const appDir = path.join(desktopDir, 'app');
const releaseDir = path.join(desktopDir, 'release');
const verifyDir = '/workspace/pm/orbis1932/m7';

const dist = await buildDist({ root });
await rm(appDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });
await cp(dist.outDir, appDir, { recursive: true });
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const appPaths = await packager({
  dir: desktopDir,
  name: 'ORBIS-1932',
  platform: 'linux',
  arch: 'x64',
  out: releaseDir,
  overwrite: true,
  asar: true,
  prune: true,
  appVersion: dist.version,
  ignore: [
    /^\/release($|\/)/,
    /^\/node_modules($|\/)/,
    /^\/build\.mjs$/,
    /^\/README\.md$/
  ]
});

await mkdir(verifyDir, { recursive: true });
const verifyZip = path.join(verifyDir, `ORBIS-1932-${dist.version}-linux-x64-unsigned.zip`);
await createZipFromDirectory(appPaths[0], verifyZip, { prefix: path.basename(appPaths[0]) });
console.log(`未署名デスクトップビルド: ${appPaths[0]}`);
console.log(`検証用ZIP: ${verifyZip}`);
console.log('署名・公開・ストア提出は行っていません。');
