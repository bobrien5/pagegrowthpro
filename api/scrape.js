// Vercel Serverless Function — Triggers Apify scrape (keeps token server-side)
// POST /api/scrape
// Body: { urls: ["https://facebook.com/page1", ...], userId: "..." }

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_API = 'https://api.apify.com/v2';
const APIFY_ACTOR = 'apify~facebook-posts-scraper';
const MAX_SCRAPES_PER_DAY = 25;
const MAX_URLS_PER_SCRAPE = 25;

// Simple in-memory rate limiting (resets on cold start, but good enough)
const rateLimits = {};

module.exports = async (req, res) => {
  // CORS
  const allowedOrigins = ['https://pagegrowthpro.com', 'https://www.pagegrowthpro.com', 'http://localhost:3001'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { urls, userId } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Missing urls array' });
    }

    if (urls.length > MAX_URLS_PER_SCRAPE) {
      return res.status(400).json({ error: `Maximum ${MAX_URLS_PER_SCRAPE} URLs per scrape` });
    }

    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: 'Scraping service not configured' });
    }

    // Rate limiting per user
    if (userId) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `${userId}:${today}`;
      rateLimits[key] = (rateLimits[key] || 0) + 1;
      if (rateLimits[key] > MAX_SCRAPES_PER_DAY) {
        return res.status(429).json({ error: `Rate limit: ${MAX_SCRAPES_PER_DAY} scrapes per day` });
      }
    }

    // Start Apify actor run (wait up to 5 min)
    const startRes = await fetch(`${APIFY_API}/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&waitForFinish=300`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: urls.map(url => ({ url })),
        resultsLimit: 50,
      }),
    });

    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
      return res.status(502).json({ error: `Scraper error: ${err.error?.message || startRes.status}` });
    }

    const runData = (await startRes.json()).data;
    let datasetId = runData.defaultDatasetId;

    // Poll if not finished yet
    if (runData.status !== 'SUCCEEDED') {
      let attempts = 0;
      while (attempts < 60) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch(`${APIFY_API}/actor-runs/${runData.id}?token=${APIFY_TOKEN}`);
        const pollData = (await pollRes.json()).data;
        if (pollData.status === 'SUCCEEDED') {
          datasetId = pollData.defaultDatasetId;
          break;
        }
        if (pollData.status === 'FAILED' || pollData.status === 'ABORTED') {
          return res.status(502).json({ error: `Scrape ${pollData.status}` });
        }
        attempts++;
      }
    }

    // Download results
    const dataRes = await fetch(`${APIFY_API}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&clean=true`);
    const rawPosts = await dataRes.json();

    return res.status(200).json({
      success: true,
      runId: runData.id,
      datasetId,
      postCount: rawPosts.length,
      posts: rawPosts,
    });
  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
