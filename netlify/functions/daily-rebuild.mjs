// Runs once a day on Netlify's own infrastructure and pings this site's Build
// Hook, so the site rebuilds every morning even if nobody touched Airtable —
// that's what makes past-event filtering (see build.js) actually take effect
// daily instead of only when someone remembers to click "Trigger deploy".
//
// No Airtable Automation needed: Airtable's free plan doesn't include the
// "Run a script" / outbound webhook actions, so this replaces that entirely
// and costs nothing extra.

const BUILD_HOOK_URL = 'https://api.netlify.com/build_hooks/6a7dcbaa7c689728ea6e1875';

export default async () => {
  const res = await fetch(BUILD_HOOK_URL, { method: 'POST' });
  console.log('Daily rebuild trigger:', res.status);
};

export const config = {
  schedule: '0 3 * * *', // 03:00 UTC ≈ 06:00 Kyiv time (EEST)
};
