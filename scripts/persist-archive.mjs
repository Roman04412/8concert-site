#!/usr/bin/env node
/**
 * Runs as the LAST step of `npm run build`, after build.js has written
 * data/archive.json and data/images/<slug>.<ext> to disk for this build.
 *
 * Why this exists: Netlify's build environment is thrown away after every
 * build. build.js's own comments call archive.json "persistent, git-
 * committed history" — but nothing was ever actually committing it back to
 * GitHub, so that was never true in production. Every build started
 * loadArchive() from a MISSING file, silently got `{}`, and rebuilt the
 * archive from whatever was live in Airtable at that exact moment. The
 * instant a record was deleted or replaced in Airtable (e.g. an event
 * rescheduled by deleting the old row and adding a new one), its page
 * vanished on the very next rebuild — a 404, breaking the "concert pages
 * never disappear" promise the whole archive mechanism exists for.
 *
 * This script closes that gap: it commits any changes to data/archive.json
 * and data/images/ straight back to the `main` branch, so the NEXT build
 * (whether triggered by an Airtable edit or the daily 03:00 UTC cron in
 * netlify/functions/daily-rebuild.mjs) starts from the real, accumulated
 * history instead of an empty one.
 *
 * Requires an ARCHIVE_PUSH_TOKEN environment variable in Netlify's site
 * settings — a GitHub fine-grained personal access token scoped to ONLY
 * this repo, with "Contents: Read and write" permission and nothing else.
 * Netlify's own repo checkout is read-only, so without this token there's
 * no way to push. If the token isn't set (e.g. running `npm run build`
 * locally), this script logs why and exits without touching git — the
 * build itself is never blocked by a missing token, only archive
 * persistence is skipped for that run.
 *
 * The commit message includes "[skip ci]", which Netlify recognizes and
 * will NOT trigger another deploy for — otherwise every real content
 * update would trigger a second, redundant build (the archive commit
 * itself never contains new Airtable data, just this run's own output).
 */

import { execSync } from 'node:child_process';

const TOKEN = process.env.ARCHIVE_PUSH_TOKEN;
const REPO = 'Roman04412/8concert-site';
const BRANCH = process.env.BRANCH || 'main';

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

if (!TOKEN) {
  console.log(
    'ARCHIVE_PUSH_TOKEN not set — skipping archive persistence for this build ' +
    '(expected when building locally; on Netlify this means the env var still ' +
    'needs to be added in Site settings → Environment variables).'
  );
  process.exit(0);
}

try {
  run('git add data/archive.json data/images');

  let hasChanges = true;
  try {
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    hasChanges = false; // exit 0 = nothing staged
  } catch {
    hasChanges = true; // exit 1 = there ARE staged changes
  }

  if (!hasChanges) {
    console.log('Archive unchanged this build — nothing to persist.');
    process.exit(0);
  }

  run('git config user.email "archive-bot@8concert.com"');
  run('git config user.name "8concert archive bot"');
  run('git commit -m "Persist concert archive [skip ci]"');

  // Token only ever lives in this one process's env + this one push
  // command's argv — never printed, never written to a file.
  execSync(`git push https://x-access-token:${TOKEN}@github.com/${REPO}.git HEAD:${BRANCH}`, {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  console.log('Archive changes pushed to ' + BRANCH + '.');
} catch (err) {
  // Never fail the whole site build over this — this run's dist/ already
  // built and deploys fine either way. Worst case, this run's new archive
  // entries just aren't persisted yet and get picked up on a later push.
  console.error('Could not persist archive (non-fatal):', err.message);
  process.exit(0);
}
