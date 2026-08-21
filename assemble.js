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
  process.exit(0);
}

const content = files.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8')).join('');
fs.writeFileSync(path.join(__dirname, 'build.js'), content);
console.log(`assemble.js: wrote build.js from ${files.length} part(s), ${content.length} chars.`);
