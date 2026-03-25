// Vercel Serverless Function — Apify Scrape (async pattern)
// POST /api/scrape — starts scrape, returns runId (fast, no timeout)
// POST /api/scrape?action=status&runId=XXX — check if run is done
// POST /api/scrape?action=results&datasetId=XXX — get results

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_API = 'https://api.apify.com/v2';
const APIFY_ACTOR = 'apify~facebook-posts-scraper';
const MAX_SCRAPES_PER_DAY = 25;
const MAX_URLS_PER_SCRAPE = 25;

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

  const action = req.query.action || 'start';

  try {
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: 'Scraping service not configured' });
    }

    // === ACTION: START — kick off scrape, return immediately ===
    if (action === 'start') {
      const { urls, userId } = req.body;

      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'Missing urls array' });
      }
      if (urls.length > MAX_URLS_PER_SCRAPE) {
        return res.status(400).json({ error: `Maximum ${MAX_URLS_PER_SCRAPE} URLs per scrape` });
      }

      // Rate limiting
      if (userId) {
        const today = new Date().toISOString().slice(0, 10);
        const key = `${userId}:${today}`;
        rateLimits[key] = (rateLimits[key] || 0) + 1;
        if (rateLimits[key] > MAX_SCRAPES_PER_DAY) {
          return res.status(429).json({ error: `Rate limit: ${MAX_SCRAPES_PER_DAY} scrapes per day` });
        }
      }

      // Start actor — DON'T wait for finish (returns in ~1-2 seconds)
      const startRes = await fetch(`${APIFY_API}/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}`, {
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
      return res.status(200).json({
        success: true,
        runId: runData.id,
        datasetId: runData.defaultDatasetId,
        status: runData.status,
      });
    }

    // === ACTION: STATUS — check if run is done ===
    if (action === 'status') {
      const { runId } = req.body;
      if (!runId) return res.status(400).json({ error: 'Missing runId' });

      const pollRes = await fetch(`${APIFY_API}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
      if (!pollRes.ok) return res.status(502).json({ error: 'Failed to check status' });

      const pollData = (await pollRes.json()).data;
      return res.status(200).json({
        status: pollData.status,
        datasetId: pollData.defaultDatasetId,
      });
    }

    // === ACTION: RESULTS — download dataset ===
    if (action === 'results') {
      const { datasetId } = req.body;
      if (!datasetId) return res.status(400).json({ error: 'Missing datasetId' });

      const dataRes = await fetch(`${APIFY_API}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&clean=true`);
      if (!dataRes.ok) return res.status(502).json({ error: 'Failed to fetch results' });

      const posts = await dataRes.json();
      return res.status(200).json({
        success: true,
        postCount: posts.length,
        posts,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
