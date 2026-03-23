// ===== PageGrowthPro — Apify Scheduled Scraping =====
// Handles: on-demand scraping, weekly scheduled tasks, pulling results

const APIFY_API = 'https://api.apify.com/v2';
const APIFY_ACTOR = 'apify~facebook-posts-scraper';

// --- Get Apify token from user settings or localStorage ---
async function getApifyToken() {
  // Try Supabase user settings first
  try {
    const user = await getUser();
    if (user) {
      const settings = await getUserSettings(user.id);
      if (settings.apify_token) return settings.apify_token;
    }
  } catch {}
  // Fallback to localStorage
  const local = JSON.parse(localStorage.getItem('vpro_dashboard_settings') || '{}');
  if (local.apifyToken) return local.apifyToken;
  // Fallback to .env-stored token (for dev)
  return null;
}

// --- Trigger an on-demand scrape for a set of URLs ---
async function triggerScrapeNow(userId, urls) {
  const token = await getApifyToken();
  if (!token) throw new Error('Apify API token not configured. Add it in Settings.');

  // Start the actor run
  const startRes = await fetch(`${APIFY_API}/acts/${APIFY_ACTOR}/runs?token=${token}&waitForFinish=300`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: urls.map(url => ({ url })),
      resultsLimit: 50,
    }),
  });

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(`Apify error: ${err.error?.message || startRes.status}`);
  }

  const runData = (await startRes.json()).data;
  let datasetId = runData.defaultDatasetId;

  // Poll if not finished
  if (runData.status !== 'SUCCEEDED') {
    let attempts = 0;
    while (attempts < 60) { // Max 5 min polling
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch(`${APIFY_API}/actor-runs/${runData.id}?token=${token}`);
      const pollData = (await pollRes.json()).data;
      if (pollData.status === 'SUCCEEDED') {
        datasetId = pollData.defaultDatasetId;
        break;
      }
      if (pollData.status === 'FAILED' || pollData.status === 'ABORTED') {
        throw new Error(`Scrape ${pollData.status}`);
      }
      attempts++;
    }
  }

  // Download results
  const dataRes = await fetch(`${APIFY_API}/datasets/${datasetId}/items?token=${token}&format=json&clean=true`);
  const rawPosts = await dataRes.json();

  // Save to Supabase if we have user context
  if (userId && typeof saveScrapedPosts === 'function') {
    try {
      const user = await getUser();
      const competitors = await getCompetitors(userId);

      // Match posts to competitors by URL
      for (const comp of competitors) {
        const compPosts = rawPosts.filter(p => {
          const postUrl = (p.pageUrl || p.url || '').toLowerCase();
          const compUrl = comp.page_url.toLowerCase();
          // Match by page name or URL fragment
          return postUrl.includes(compUrl.replace('https://www.facebook.com/', '').replace('https://facebook.com/', ''));
        });
        if (compPosts.length > 0) {
          // Analyze posts before saving
          const analyzed = compPosts.map(p => typeof analyzePost === 'function' ? analyzePost(p) : p);
          await replaceScrapedPosts(userId, comp.id, analyzed);
        }
      }
    } catch (err) {
      console.warn('Failed to save scraped posts to Supabase:', err);
    }
  }

  return { runId: runData.id, datasetId, postCount: rawPosts.length, posts: rawPosts };
}

// --- Create or update a weekly Apify schedule ---
async function createOrUpdateSchedule(userId, urls) {
  const token = await getApifyToken();
  if (!token) throw new Error('Apify token required');

  const user = await getUser();
  const settings = await getUserSettings(userId);

  const scheduleInput = {
    startUrls: urls.map(url => ({ url })),
    resultsLimit: 50,
  };

  if (settings.apify_schedule_id) {
    // Update existing schedule
    try {
      const res = await fetch(`${APIFY_API}/schedules/${settings.apify_schedule_id}?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: [{
            type: 'RUN_ACTOR',
            actorId: APIFY_ACTOR,
            runInput: { body: JSON.stringify(scheduleInput), contentType: 'application/json' },
          }],
        }),
      });
      if (res.ok) return (await res.json()).data;
    } catch {}
  }

  // Create new schedule (Sunday at 11pm UTC)
  const res = await fetch(`${APIFY_API}/schedules?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `pgp-${userId.slice(0, 8)}-weekly`,
      cronExpression: '0 23 * * 0', // Sunday 11pm UTC
      isEnabled: true,
      isExclusive: true,
      actions: [{
        type: 'RUN_ACTOR',
        actorId: APIFY_ACTOR,
        runInput: { body: JSON.stringify(scheduleInput), contentType: 'application/json' },
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to create schedule: ${err.error?.message || res.status}`);
  }

  const schedule = (await res.json()).data;

  // Save schedule ID to user settings
  await saveUserSettings(userId, { apify_schedule_id: schedule.id });

  return schedule;
}

// --- Check latest Apify run and pull new data if available ---
async function checkAndPullLatestData(userId) {
  const token = await getApifyToken();
  if (!token) return null;

  const settings = await getUserSettings(userId);
  if (!settings.apify_schedule_id) return null;

  // Get latest runs for the schedule
  const res = await fetch(`${APIFY_API}/schedules/${settings.apify_schedule_id}?token=${token}`);
  if (!res.ok) return null;

  const schedule = (await res.json()).data;
  const lastRunAt = schedule.lastRunAt;

  // Compare with our latest scraped_at
  const latestScrape = await getLatestScrapeDate(userId);
  if (latestScrape && lastRunAt && new Date(lastRunAt) <= new Date(latestScrape)) {
    return null; // No new data
  }

  // There's new data — trigger a fresh pull
  const competitors = await getCompetitors(userId);
  const activeUrls = competitors.filter(c => c.active).map(c => c.page_url);
  if (activeUrls.length === 0) return null;

  return triggerScrapeNow(userId, activeUrls);
}
