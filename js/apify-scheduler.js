// ===== PageGrowthPro — Scraping via Server-Side API =====
// All Apify calls go through /api/scrape (token stays server-side)

const SCRAPE_API = '/api/scrape';

// --- Trigger a scrape for a set of URLs ---
async function triggerScrapeNow(userId, urls) {
  const res = await fetch(SCRAPE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, userId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Scrape failed: ${res.status}`);
  }

  const result = await res.json();

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

// --- Scrape and refresh data for current user ---
async function scrapeAndRefresh(userId, urls, onProgress) {
  if (onProgress) onProgress('Starting scrape...');

  const result = await triggerScrapeNow(userId, urls);

  if (onProgress) onProgress(`Scraped ${result.postCount} posts. Loading...`);

  // Reload data from Supabase
  if (typeof loadUserDataFromSupabase === 'function') {
    const data = await loadUserDataFromSupabase();
    if (data && data.length > 0) {
      posts = typeof reclassifyPosts === 'function' ? reclassifyPosts(data) : data;
    }
  }

  return result;
}

// --- Scrape a single page (for analytics "your page" data) ---
async function scrapeMyPage(userId, pageUrl) {
  const result = await triggerScrapeNow(userId, [pageUrl]);
  return result.posts || [];
}
