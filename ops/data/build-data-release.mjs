#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  codeRevision,
  dataRevision,
  fetchCatalogRows,
} from '../../api/catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEALER_LABELS = {
  backcountry: 'Backcountry',
  burton: 'Burton',
  evo: 'EVO',
  mec: 'MEC',
  rei: 'REI',
};

function usage() {
  console.error('Usage: build-data-release.mjs --output EMPTY_DIRECTORY');
  process.exit(2);
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) usage();
  return path.resolve(argv[1]);
}

function ensureEmptyDirectory(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.length) throw new Error(`Output directory is not empty: ${directory}`);
}

function writeFile(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, value);
}

function publicProduct(product) {
  const { _search, _brand, _platform, _series, _category, ...value } = product;
  return value;
}

function dealerItem(product) {
  return {
    source_id: product.sku_id,
    name: product.full_name || product.model || '',
    brand: product.brand || '',
    category: product.category || '',
    gender: product.gender || 'unknown',
    region: product.region || 'us',
    currency: product.currency || 'USD',
    original_price: product.original_price,
    sale_price: product.sale_price,
    color: product.color || '',
    sizes: product.sizes || [],
    size_stock: product.size_stock || {},
    url: product.url || '',
    image: product.image_url || '',
  };
}

function buildDealerSnapshot(rows, generatedAt) {
  const groups = new Map();
  for (const product of rows) {
    const dealer = String(product.dealer || 'arcteryx_outlet').toLowerCase();
    if (dealer === 'arcteryx_outlet' || dealer === 'ssense') continue;
    if (!groups.has(dealer)) groups.set(dealer, []);
    groups.get(dealer).push(product);
  }
  const dealers = {};
  for (const [dealer, products] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const regions = [...new Set(products.map((product) => product.region).filter(Boolean))];
    const refreshedAt = products.reduce(
      (latest, product) => String(product.last_updated || '') > latest ? String(product.last_updated) : latest,
      '',
    );
    dealers[dealer] = {
      name: DEALER_LABELS[dealer] || dealer,
      region: regions.length === 1 ? regions[0] : 'multi',
      count: products.length,
      items: products.map(dealerItem),
      refreshed_at: refreshedAt || generatedAt,
    };
  }
  return {
    generated_at: generatedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ''),
    dealers,
    total: Object.values(dealers).reduce((sum, dealer) => sum + dealer.count, 0),
    rejected_dealers: {},
    retained_dealers: {},
    retired_dealers: ['ssense'],
    fresh_dealers: [],
  };
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function artifactRevision(data) {
  const contractFiles = [
    fileURLToPath(import.meta.url),
    path.join(REPO_ROOT, 'api', 'catalog.mjs'),
    path.join(REPO_ROOT, 'api', 'seo-index.mjs'),
    path.join(REPO_ROOT, 'tools', 'generate_geo_catalog.py'),
    path.join(REPO_ROOT, 'seo-index-policy.json'),
    path.join(REPO_ROOT, 'product-detail.html'),
  ];
  const digest = crypto.createHash('sha256');
  digest.update(`data:${data}\n`);
  for (const filename of contractFiles.sort()) {
    digest.update(`${path.relative(REPO_ROOT, filename)}:${sha256(filename)}\n`);
  }
  return digest.digest('hex').slice(0, 20);
}

function listFiles(directory, relative = '') {
  const values = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) values.push(...listFiles(directory, child));
    else if (entry.isFile()) values.push(child);
  }
  return values.sort();
}

function precompress(publicRoot) {
  const extensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.webmanifest', '.xml']);
  for (const relative of listFiles(publicRoot)) {
    const filename = path.join(publicRoot, relative);
    if (!extensions.has(path.extname(filename)) || fs.statSync(filename).size <= 1023) continue;
    writeFile(`${filename}.gz`, zlib.gzipSync(fs.readFileSync(filename), { level: 9, mtime: 0 }));
  }
}

async function main() {
  const output = parseArguments(process.argv.slice(2));
  ensureEmptyDirectory(output);
  const publicRoot = path.join(output, 'public');
  fs.mkdirSync(publicRoot);

  const rows = await fetchCatalogRows();
  if (!rows.length) throw new Error('Refusing to publish an empty catalog');
  const publicRows = rows.map(publicProduct);
  const revision = dataRevision(rows);
  const artifact = artifactRevision(revision);
  const code = codeRevision();
  const generatedAt = new Date().toISOString();
  const compactJson = JSON.stringify(publicRows);
  const outletRows = publicRows.filter((product) => product.dealer === 'arcteryx_outlet');
  const outletJson = JSON.stringify(outletRows);

  writeFile(path.join(publicRoot, 'data.js'), `const PRODUCTS = ${compactJson};\n`);
  fs.mkdirSync(path.join(publicRoot, 'h5'));
  fs.linkSync(path.join(publicRoot, 'data.js'), path.join(publicRoot, 'h5', 'data.js'));
  writeFile(path.join(publicRoot, 'global_data.json'), `${outletJson}\n`);
  writeFile(
    path.join(publicRoot, 'dealers', 'results.json'),
    `${JSON.stringify(buildDealerSnapshot(publicRows, generatedAt), null, 2)}\n`,
  );

  const generatorInput = path.join(output, 'catalog-input.json');
  writeFile(generatorInput, compactJson);
  const generated = spawnSync(
    process.env.PYTHON || 'python3',
    [
      path.join(REPO_ROOT, 'tools', 'generate_geo_catalog.py'),
      '--input', generatorInput,
      '--output-dir', publicRoot,
      '--template', path.join(REPO_ROOT, 'product-detail.html'),
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (generated.status !== 0) {
    throw new Error(`GEO asset generation failed:\n${generated.stderr || generated.stdout}`);
  }
  fs.unlinkSync(generatorInput);

  const publication = {
    schema_version: 1,
    generated_at: generatedAt,
    code_revision: code,
    data_revision: revision,
    artifact_revision: artifact,
    active_products: publicRows.length,
    snapshot_observed_at: publicRows.reduce(
      (latest, product) => String(product.last_updated || '') > latest ? String(product.last_updated) : latest,
      '',
    ),
  };
  writeFile(path.join(publicRoot, 'publication.json'), `${JSON.stringify(publication, null, 2)}\n`);
  precompress(publicRoot);

  const files = listFiles(publicRoot).map((relative) => {
    const filename = path.join(publicRoot, relative);
    return { path: relative, bytes: fs.statSync(filename).size, sha256: sha256(filename) };
  });
  const manifest = { ...publication, files };
  writeFile(path.join(output, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFile(path.join(publicRoot, 'data-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFile(path.join(output, 'DATA_REVISION'), `${revision}\n`);
  writeFile(path.join(output, 'ARTIFACT_REVISION'), `${artifact}\n`);
  writeFile(path.join(output, 'CODE_REVISION'), `${code}\n`);

  for (const required of [
    'data.js', 'h5/data.js', 'global_data.json', 'dealers/results.json',
    'sitemap-products.xml', 'sitemap-insights.xml', 'catalog-status.json',
    'sitemap-deals.xml', 'brands/arcteryx.html', 'brands/burton.html',
    'brands/patagonia.html', 'categories/pants.html',
    'publication.json', 'data-manifest.json',
  ]) {
    const filename = path.join(publicRoot, required);
    if (!fs.statSync(filename).isFile() || fs.statSync(filename).size === 0) {
      throw new Error(`Data release is missing ${required}`);
    }
  }

  console.log(
    `data_revision=${revision} artifact_revision=${artifact} code_revision=${code} `
    + `rows=${publicRows.length} outlet_rows=${outletRows.length} files=${files.length}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
