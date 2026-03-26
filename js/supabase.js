// ===== PageGrowthPro — Supabase Client + Auth + DB Helpers =====

const SUPABASE_URL = 'https://xhyhrigvkdusfxpajjki.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_e9U-PnzD3E0nR9kImMHZiw_W4g1eS8g';

// --- Initialize Supabase Client ---
// Load via CDN: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    throw new Error('Supabase JS SDK not loaded. Add the CDN script tag.');
  }
  _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ==================== AUTH ====================

async function signUp(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const sb = getSupabase();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
  window.location.href = '/login';
}

async function getUser() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function getSession() {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

// Redirect to login if not authenticated
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/login';
    return null;
  }
  return session.user;
}

// Redirect to onboarding if user has no competitors
async function checkOnboarding() {
  const user = await getUser();
  if (!user) return;
  const competitors = await getCompetitors(user.id);
  if (!competitors || competitors.length === 0) {
    window.location.href = '/onboarding';
  }
}

// ==================== COMPETITORS ====================

const MAX_COMPETITORS = 25;

async function saveCompetitors(userId, urls) {
  const sb = getSupabase();
  // Validate limit
  const existing = await getCompetitors(userId);
  const total = (existing?.length || 0) + urls.length;
  if (total > MAX_COMPETITORS) {
    throw new Error(`Maximum ${MAX_COMPETITORS} competitors allowed. You have ${existing?.length || 0}, trying to add ${urls.length}.`);
  }
  const rows = urls.map(url => ({
    user_id: userId,
    page_url: url.trim(),
    page_name: extractPageName(url),
    active: true,
  }));
  const { data, error } = await sb.from('competitors').insert(rows).select();
  if (error) throw error;
  return data;
}

async function addCompetitor(userId, url, pageName) {
  const sb = getSupabase();
  const existing = await getCompetitors(userId);
  if (existing.length >= MAX_COMPETITORS) {
    throw new Error(`Maximum ${MAX_COMPETITORS} competitors allowed`);
  }
  // Check for duplicate
  if (existing.some(c => c.page_url === url.trim())) {
    throw new Error('Competitor already tracked');
  }
  const { data, error } = await sb.from('competitors').insert({
    user_id: userId,
    page_url: url.trim(),
    page_name: pageName || extractPageName(url),
    active: true,
  }).select();
  if (error) throw error;
  return data?.[0];
}

async function getCompetitors(userId) {
  const sb = getSupabase();
  const { data, error } = await sb.from('competitors')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function updateCompetitor(id, updates) {
  const sb = getSupabase();
  const { data, error } = await sb.from('competitors')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeCompetitor(id) {
  const sb = getSupabase();
  // Also remove associated scraped posts
  await sb.from('scraped_posts').delete().eq('competitor_id', id);
  const { error } = await sb.from('competitors').delete().eq('id', id);
  if (error) throw error;
}

function extractPageName(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (path.startsWith('profile.php')) {
      const id = u.searchParams.get('id');
      return id ? `Profile ${id.slice(-6)}` : 'Unknown';
    }
    return path || 'Unknown';
  } catch {
    return url.slice(0, 30);
  }
}

// ==================== SCRAPED POSTS ====================

async function saveScrapedPosts(userId, competitorId, postsData) {
  const sb = getSupabase();
  const rows = postsData.map(p => ({
    user_id: userId,
    competitor_id: competitorId,
    post_data: p,
  }));
  // Batch insert (Supabase handles up to 1000 rows)
  const { data, error } = await sb.from('scraped_posts').insert(rows).select();
  if (error) throw error;
  return data;
}

async function getScrapedPosts(userId) {
  const sb = getSupabase();
  const { data, error } = await sb.from('scraped_posts')
    .select('post_data, scraped_at, competitor_id')
    .eq('user_id', userId)
    .order('scraped_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getLatestScrapeDate(userId) {
  const sb = getSupabase();
  const { data } = await sb.from('scraped_posts')
    .select('scraped_at')
    .eq('user_id', userId)
    .order('scraped_at', { ascending: false })
    .limit(1);
  return data?.[0]?.scraped_at || null;
}

// Clear old posts and replace with fresh scrape
async function replaceScrapedPosts(userId, competitorId, postsData) {
  const sb = getSupabase();
  await sb.from('scraped_posts').delete().eq('user_id', userId).eq('competitor_id', competitorId);
  return saveScrapedPosts(userId, competitorId, postsData);
}

// ==================== USER SETTINGS ====================

async function getUserSettings(userId) {
  const sb = getSupabase();
  const { data, error } = await sb.from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || {};
}

async function saveUserSettings(userId, settings) {
  const sb = getSupabase();
  const { data, error } = await sb.from('user_settings')
    .upsert({ user_id: userId, ...settings })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ==================== HELPERS ====================

// Convert Supabase scraped_posts rows into the `posts` array format the dashboard expects
function convertScrapedPostsToAnalyzed(scrapedRows) {
  return scrapedRows.map(row => {
    const p = row.post_data;
    // If already analyzed, return as-is
    if (p.totalEngagement !== undefined) return p;
    // Otherwise analyze raw post
    return typeof analyzePost === 'function' ? analyzePost(p) : p;
  });
}

// Load all user data into the global `posts` array (replaces file-based loading)
async function loadUserDataFromSupabase() {
  const user = await getUser();
  if (!user) return [];

  // Get user's connected page info (to exclude from competitor data)
  const settings = await getUserSettings(user.id);
  const myPageId = settings?.fb_page_id || '';
  const myPageName = (settings?.fb_page_name || '').toLowerCase();
  const myPageUrl = (settings?.fb_page_url || '').toLowerCase();

  const scrapedRows = await getScrapedPosts(user.id);
  const analyzed = convertScrapedPostsToAnalyzed(scrapedRows);

  // Filter OUT the user's own page — insights should only show competitor data
  const filtered = analyzed.filter(p => {
    const pn = (p.pageName || '').toLowerCase();
    const pu = (p.pageUrl || p.postUrl || '').toLowerCase();
    // Exclude if it matches the user's own page
    if (myPageName && pn.includes(myPageName)) return false;
    if (myPageId && pu.includes(myPageId)) return false;
    // Also check common patterns
    if (myPageUrl && pu.includes(myPageUrl.replace('https://www.facebook.com/', '').replace('https://facebook.com/', '').split('/')[0])) return false;
    return true;
  });

  return filtered.sort((a, b) => (b.totalEngagement || 0) - (a.totalEngagement || 0));
}

// Load ONLY user's own page data (for analytics page)
async function loadMyPageDataFromSupabase() {
  const user = await getUser();
  if (!user) return [];

  const settings = await getUserSettings(user.id);
  const myPageId = settings?.fb_page_id || '';
  const myPageName = (settings?.fb_page_name || '').toLowerCase();

  const scrapedRows = await getScrapedPosts(user.id);
  const analyzed = convertScrapedPostsToAnalyzed(scrapedRows);

  // Filter TO only the user's own page
  const filtered = analyzed.filter(p => {
    const pn = (p.pageName || '').toLowerCase();
    const pu = (p.pageUrl || p.postUrl || '').toLowerCase();
    if (myPageName && pn.includes(myPageName)) return true;
    if (myPageId && pu.includes(myPageId)) return true;
    return false;
  });

  return filtered.sort((a, b) => (b.totalEngagement || 0) - (a.totalEngagement || 0));
}
