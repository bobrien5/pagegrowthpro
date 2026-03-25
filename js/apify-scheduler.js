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

// --- Save scraped posts to Supabase ---
async function saveScrapedPostsToSupabase(userId, urls, rawPosts) {
  if (typeof saveScrapedPosts !== 'function') return;

  // Analyze all posts first
  const analyzed = rawPosts.map(p => typeof analyzePost === 'function' ? analyzePost(p) : p);

  // Try to match posts to competitors
  let competitors = [];
  try {
    if (typeof getCompetitors === 'function') {
      competitors = await getCompetitors(userId);
    }
  } catch (e) { console.warn('Could not load competitors:', e); }

  if (competitors.length > 0) {
    // Match posts to competitors by pageName, pageUrl, or profile ID
    for (const comp of competitors) {
      // Extract the identifier from the competitor URL
      let compId = comp.page_url.toLowerCase()
        .replace('https://www.facebook.com/', '')
        .replace('https://facebook.com/', '')
        .replace(/\/$/, '');

      // Handle profile.php?id=XXX format
      const idMatch = comp.page_url.match(/[?&]id=(\d+)/);
      if (idMatch) compId = idMatch[1];

      const compPosts = analyzed.filter(p => {
        const pageName = (p.pageName || '').toLowerCase();
        const pageUrl = (p.pageUrl || p.postUrl || '').toLowerCase();
        // Also check Apify's inputUrl field which shows which URL was requested
        const inputUrl = (p.inputUrl || '').toLowerCase();
        const compUrlLower = comp.page_url.toLowerCase();
        // Match by: inputUrl matches, page name contains comp name, OR URL contains comp ID
        return inputUrl.includes(compId) ||
               inputUrl === compUrlLower ||
               pageUrl.includes(compId) ||
               pageName.includes(compId) ||
               (comp.page_name && comp.page_name.toLowerCase() !== 'profile' && pageName.includes(comp.page_name.toLowerCase()));
      });

      if (compPosts.length > 0) {
        try {
          await replaceScrapedPosts(userId, comp.id, compPosts);
        } catch (e) { console.warn(`Failed to save posts for ${comp.page_name}:`, e); }
      }
    }
  }

  // Also save any unmatched posts with null competitor_id (catch-all)
  const allSaved = new Set();
  for (const comp of competitors) {
    try {
      const sb = typeof getSupabase === 'function' ? getSupabase() : null;
      if (!sb) break;
      const { data } = await sb.from('scraped_posts')
        .select('post_data')
        .eq('user_id', userId)
        .eq('competitor_id', comp.id);
      if (data) data.forEach(r => {
        const url = r.post_data?.postUrl || r.post_data?.pageUrl;
        if (url) allSaved.add(url);
      });
    } catch {}
  }

  const unsaved = analyzed.filter(p => {
    const url = p.postUrl || p.pageUrl;
    return url && !allSaved.has(url);
  });

  if (unsaved.length > 0) {
    try {
      // Save unmatched posts with first competitor as fallback
      const fallbackCompId = competitors[0]?.id || null;
      await saveScrapedPosts(userId, fallbackCompId, unsaved);
    } catch (e) { console.warn('Failed to save unmatched posts:', e); }
  }

  console.log(`[Scrape] Saved ${analyzed.length} posts to Supabase`);
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
