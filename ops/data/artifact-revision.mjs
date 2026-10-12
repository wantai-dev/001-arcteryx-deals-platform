import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

export function artifactRevision(data, code) {
  const contractFiles = [
    fileURLToPath(import.meta.url),
    path.join(REPO_ROOT, 'ops', 'data', 'build-data-release.mjs'),
    path.join(REPO_ROOT, 'api', 'catalog.mjs'),
    path.join(REPO_ROOT, 'api', 'seo-index.mjs'),
    path.join(REPO_ROOT, 'tools', 'generate_geo_catalog.py'),
    path.join(REPO_ROOT, 'seo-index-policy.json'),
    path.join(REPO_ROOT, 'product-detail.html'),
  ];
  const digest = crypto.createHash('sha256');
  digest.update(`data:${data}\ncode:${code}\n`);
  for (const filename of contractFiles.sort()) {
    digest.update(`${path.relative(REPO_ROOT, filename)}:${sha256(filename)}\n`);
  }
  return digest.digest('hex').slice(0, 20);
}
