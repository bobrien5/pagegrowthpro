// ===== PageGrowthPro — Scraping via Server-Side API (async) =====
// Start → Poll → Get Results pattern to avoid Vercel timeout

const SCRAPE_API = '/api/scrape';

// --- Trigger a scrape and wait for results ---
async function triggerScrapeNow(userId, urls, onProgress) {
  // Step 1: Start the scrape (returns immediately)
  if (onProgress) onProgress('Starting scrape...');
  const startRes = await fetch(SCRAPE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, userId }),
  });

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error || `Scrape failed: ${startRes.status}`);
  }

  const { runId, datasetId, status } = await startRes.json();

  // Step 2: Poll until done (if not already succeeded)
  if (status !== 'SUCCEEDED') {
    if (onProgress) onProgress('Scraping competitor pages...');
    let attempts = 0;
    while (attempts < 60) { // Max ~5 min
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
      if (onProgress) onProgress(`Scraping... (${attempts * 5}s)`);

      const pollRes = await fetch(`${SCRAPE_API}?action=status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });

      if (!pollRes.ok) continue;
      const poll = await pollRes.json();

      if (poll.status === 'SUCCEEDED') break;
      if (poll.status === 'FAILED' || poll.status === 'ABORTED') {
        throw new Error(`Scrape ${poll.status}`);
      }
    }
  }

  // Step 3: Get results
  if (onProgress) onProgress('Downloading results...');
  const resultsRes = await fetch(`${SCRAPE_API}?action=results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId }),
  });

  if (!resultsRes.ok) {
    const err = await resultsRes.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to get results');
  }

  const result = await resultsRes.json();

  // Save posts to Supabase matched to competitors
  if (userId && result.posts && result.posts.length > 0) {
    try {
      await saveScrapedPostsToSupabase(userId, urls, result.posts);
    } catch (err) {
      console.warn('Failed to save scraped posts to Supabase:', err);
    }
  }

  return result;
}

// --- Save scraped posts to Supabase, matched to competitors ---
async function saveScrapedPostsToSupabase(userId, urls, rawPosts) {
  if (typeof getCompetitors !== 'function' || typeof replaceScrapedPosts !== 'function') return;

  const competitors = await getCompetitors(userId);

  for (const comp of competitors) {
    const compUrl = comp.page_url.toLowerCase()
      .replace('https://www.facebook.com/', '')
      .replace('https://facebook.com/', '')
      .replace(/\/$/, '');

    const compPosts = rawPosts.filter(p => {
      const postUrl = (p.pageUrl || p.url || '').toLowerCase();
      return postUrl.includes(compUrl);
    });

    if (compPosts.length > 0) {
      const analyzed = compPosts.map(p => typeof analyzePost === 'function' ? analyzePost(p) : p);
      await replaceScrapedPosts(userId, comp.id, analyzed);
    }
  }
}

// --- Scrape and refresh dashboard data ---
async function scrapeAndRefresh(userId, urls, onProgress) {
  const result = await triggerScrapeNow(userId, urls, onProgress);

  if (onProgress) onProgress('Loading data...');

  // Reload from Supabase
  if (typeof loadUserDataFromSupabase === 'function') {
    const data = await loadUserDataFromSupabase();
    if (data && data.length > 0) {
      posts = typeof reclassifyPosts === 'function' ? reclassifyPosts(data) : data;
    }
  }

  return result;
}

// --- Scrape a single page (for analytics) ---
async function scrapeMyPage(userId, pageUrl, onProgress) {
  return triggerScrapeNow(userId, [pageUrl], onProgress);
}
