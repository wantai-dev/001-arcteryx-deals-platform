import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type AssetExpectation = {
  path: string;
  width: number;
  height: number;
  alpha: boolean;
};

function verifyPng(expectation: AssetExpectation) {
  const png = readFileSync(join(process.cwd(), expectation.path));
  assert.ok(png.subarray(0, 8).equals(pngSignature), `${expectation.path} must be a PNG file`);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR', `${expectation.path} must contain a valid IHDR chunk`);

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png[25];
  const chunks: string[] = [];

  for (let offset = 8; offset + 12 <= png.length; ) {
    const chunkLength = png.readUInt32BE(offset);
    const chunkType = png.toString('ascii', offset + 4, offset + 8);
    chunks.push(chunkType);
    offset += chunkLength + 12;
    if (chunkType === 'IEND') break;
  }

  const hasAlpha = colorType === 4 || colorType === 6 || chunks.includes('tRNS');
  assert.equal(width, expectation.width, `${expectation.path} width must be ${expectation.width}px`);
  assert.equal(height, expectation.height, `${expectation.path} height must be ${expectation.height}px`);
  assert.equal(hasAlpha, expectation.alpha, `${expectation.path} alpha must be ${expectation.alpha}`);

  return `${expectation.path}=${width}x${height}/alpha:${hasAlpha}`;
}

const assets: AssetExpectation[] = [
  { path: 'assets/icon.png', width: 1024, height: 1024, alpha: false },
  { path: 'assets/splash-icon.png', width: 1024, height: 1024, alpha: true },
  { path: 'assets/favicon.png', width: 48, height: 48, alpha: false },
  { path: 'assets/android-icon-background.png', width: 512, height: 512, alpha: false },
  { path: 'assets/android-icon-foreground.png', width: 512, height: 512, alpha: true },
  { path: 'assets/android-icon-monochrome.png', width: 432, height: 432, alpha: true },
  { path: 'assets/brand/geardrop-logo.png', width: 1200, height: 340, alpha: true },
  { path: 'assets/brand/zhide-logo.png', width: 840, height: 340, alpha: true },
  { path: 'assets/brand/geardrop-mark.png', width: 512, height: 512, alpha: true },
];

console.log(`release_assets_ok ${assets.map(verifyPng).join(' ')}`);
