#!/usr/bin/env node
/**
 * One-time repair tool: build.js on main got corrupted by a bad push (only a
 * fraction of the file landed). Since GitHub's file-update API chokes on
 * ~200KB of content in one call, the correct file was instead pushed here as
 * 24 small, individually-verified chunks under data/build-parts/. This
 * script concatenates them back into build.js, byte-exact, right before the
 * real build runs (see package.json's "build" script).
 *
 * Safe to leave in place permanently — it's a no-op in the sense that it
 * always regenerates build.js from the same source-of-truth part files, so
 * future edits should go through the normal build.js edit flow; this script
 * doesn't need touching again unless build.js needs to be split into parts
 * like this a second time.
 *
 * Second job: reconstruct venue photos. Our file-writing tooling round-trips
 * text content byte-exact (see above) but not arbitrary binary — bytes above
 * 0x7F get re-encoded as UTF-8 multi-byte sequences somewhere in the
 * request/REST-API path, which silently corrupts a raw PNG. So new venue
 * images are committed as base64 text (pure ASCII, round-trips fine) under
 * data/venue-images-b64/<image-filename>/part-NN.txt — chunked the same way
 * build.js is, since a single ~80KB base64 blob in one file-write call is
 * itself unreliable to send in one piece. Each subdirectory's parts get
 * concatenated, base64-decoded, and written to assets/venues/<dirname>
 * here, before build.js copies it into dist/. No-op when the folder doesn't
 * exist or is empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const partsDir = path.join(__dirname, 'data', 'build-parts');

const files = fs.readdirSync(partsDir)
  .filter((f) => /^part-\d+\.txt$/.test(f))
  .sort();

if (files.length === 0) {
  console.log('No build-parts found; leaving build.js as-is.');
} else {
  const content = files.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8')).join('');
  fs.writeFileSync(path.join(__dirname, 'build.js'), content);
  console.log(`assemble.js: wrote build.js from ${files.length} part(s), ${content.length} chars.`);
}

const b64Dir = path.join(__dirname, 'data', 'venue-images-b64');
if (fs.existsSync(b64Dir)) {
  const venuesDir = path.join(__dirname, 'assets', 'venues');
  fs.mkdirSync(venuesDir, { recursive: true });
  const imageDirs = fs.readdirSync(b64Dir).filter((f) =>
    fs.statSync(path.join(b64Dir, f)).isDirectory()
  );
  for (const imageName of imageDirs) {
    const partsDirForImage = path.join(b64Dir, imageName);
    const parts = fs.readdirSync(partsDirForImage)
      .filter((f) => /^part-\d+\.txt$/.test(f))
      .sort();
    const b64 = parts.map((f) => fs.readFileSync(path.join(partsDirForImage, f), 'utf8')).join('').trim();
    fs.writeFileSync(path.join(venuesDir, imageName), Buffer.from(b64, 'base64'));
  }
  if (imageDirs.length) {
    console.log(`assemble.js: reconstructed ${imageDirs.length} venue image(s) from base64.`);
  }
}
