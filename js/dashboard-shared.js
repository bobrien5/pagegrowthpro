// ===== PageGrowthPro Dashboard — Shared Code =====

// --- Globals ---
let posts = [];
const chartInstances = {};
const generatedImageData = [];

// --- Settings Management ---
const SETTINGS_KEY = 'vpro_dashboard_settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
}

function saveSettings() {
  const settings = {
    geminiApiKey: document.getElementById('settingGeminiKey')?.value.trim(),
    fbPageToken: document.getElementById('settingFbToken')?.value.trim(),
    fbPageId: document.getElementById('settingFbPageId')?.value.trim(),
  };
  // Preserve apifyToken if it was set previously
  const prev = loadSettings();
  if (prev.apifyToken) settings.apifyToken = prev.apifyToken;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const saved = document.getElementById('settingsSaved');
  if (saved) { saved.classList.remove('hidden'); setTimeout(() => saved.classList.add('hidden'), 2000); }
}

function initSettings() {
  const s = loadSettings();
  const gemini = document.getElementById('settingGeminiKey');
  const fbToken = document.getElementById('settingFbToken');
  const fbPage = document.getElementById('settingFbPageId');
  if (gemini && s.geminiApiKey) gemini.value = s.geminiApiKey;
  if (fbToken && s.fbPageToken) fbToken.value = s.fbPageToken;
  if (fbPage && s.fbPageId) fbPage.value = s.fbPageId;
}

function toggleSettings() {
  document.getElementById('settingsPanel')?.classList.toggle('hidden');
}

function getGeminiKey() {
  const s = loadSettings();
  if (s.geminiApiKey) return s.geminiApiKey;
  throw new Error('Gemini API key required — add it in ⚙️ Settings');
}

async function getFbCredentials() {
  // Read from localStorage (set by meta-login.js storePageConnection)
  const s = loadSettings();
  if (s.fbPageToken && s.fbPageId) {
    // Quick validate — token should start with EAA (page/user tokens) and be >20 chars
    if (s.fbPageToken.length > 20) {
      return { token: s.fbPageToken, pageId: s.fbPageId, pageName: s.fbPageName };
    }
  }
  throw new Error('Facebook page not connected. Connect your page in Settings (gear icon).');
}

function getToken() {
  const s = loadSettings();
  if (s.apifyToken) return s.apifyToken;
  const token = prompt('Enter your Apify API token:');
  if (!token) throw new Error('Token required');
  s.apifyToken = token;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  return token;
}

// --- Utilities ---
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] ?? 'unknown';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function formatHour(h) {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function avgEngagement(arr) {
  return arr.length ? Math.round(arr.reduce((s, p) => s + p.totalEngagement, 0) / arr.length) : 0;
}

// --- Post Analysis ---
function analyzePost(post) {
  const likes = post.likes || post.likesCount || 0;
  const comments = post.comments || post.commentsCount || 0;
  const shares = post.shares || post.sharesCount || 0;
  const totalEngagement = likes + comments + shares;
  const text = post.text || post.postText || post.message || '';
  const date = post.time || post.date || post.timestamp || post.postDate;
  const parsedDate = date ? new Date(date) : null;
  const postUrl = post.postUrl || post.url || '';

  // Enhanced content type detection
  let contentType = 'text';
  const rawType = (post.type || '').toLowerCase();

  if (rawType === 'reel' || postUrl.includes('/reel/') || postUrl.includes('/reels/')) {
    contentType = 'reel';
  } else if (rawType === 'carousel' || (post.images && post.images.length > 1) || (post.attachments && post.attachments.length > 1)) {
    contentType = 'carousel';
  } else if (rawType === 'story' || postUrl.includes('/stories/')) {
    contentType = 'story';
  } else if (rawType.includes('video') || post.videoUrl || post.video) {
    contentType = 'video';
  } else if (rawType.includes('photo') || rawType === 'image' || post.imageUrl || post.image || (post.images && post.images.length === 1)) {
    contentType = 'static';
  } else if (rawType.includes('link') || post.link || post.linkUrl) {
    contentType = 'link';
  } else if (rawType && rawType !== 'text') {
    contentType = rawType;
  }

  return {
    pageName: post.pageName || post.authorName || post.pageUrl || 'Unknown',
    pageUrl: post.pageUrl || post.url || '',
    inputUrl: post.inputUrl || post.facebookUrl || '',
    postUrl,
    text: text.slice(0, 500),
    fullText: text,
    contentType, likes, comments, shares, totalEngagement,
    date: parsedDate?.toISOString() || null,
    dayOfWeek: parsedDate ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][parsedDate.getDay()] : null,
    hour: parsedDate?.getHours() ?? null,
    textLength: text.length,
    hasEmoji: /[\u{1F300}-\u{1FAFF}]/u.test(text),
    hasHashtag: /#\w+/.test(text),
    hashtagCount: (text.match(/#\w+/g) || []).length,
    emojiCount: (text.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

// Re-classify content type on pre-analyzed data using URL patterns
// Safety net in case data was analyzed by an older version
function reclassifyPosts(postsArr) {
  return postsArr.map(p => {
    const url = p.postUrl || p.pageUrl || '';
    if (url.includes('/reel/') || url.includes('/reels/')) {
      p.contentType = 'reel';
    } else if (url.includes('/videos/')) {
      p.contentType = 'video';
    } else if (url.includes('/photos/')) {
      p.contentType = 'static';
    }
    return p;
  });
}

// --- Data Loading (Supabase only — no hardcoded file fallback) ---
function initDataLoading(onDataLoaded) {
  // Manual file upload (dev/admin only)
  document.getElementById('fileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        posts = reclassifyPosts(JSON.parse(ev.target.result));
        onDataLoaded();
      } catch { alert('Invalid JSON file'); }
    };
    reader.readAsText(file);
  });

  // Load from Supabase (user's own scraped data)
  if (typeof loadUserDataFromSupabase === 'function') {
    loadUserDataFromSupabase()
      .then(data => {
        if (data && data.length > 0) {
          posts = reclassifyPosts(data);
          onDataLoaded();
        } else {
          // No data yet — show empty state or trigger first scrape
          showNoDataState();
        }
      })
      .catch(err => {
        console.warn('Failed to load data from Supabase:', err);
        showNoDataState();
      });
  } else {
    showNoDataState();
  }
}

function showNoDataState() {
  const loading = document.getElementById('loadingState');
  if (loading) {
    loading.innerHTML = `
      <div class="text-center py-12">
        <div class="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        </div>
        <h3 class="text-lg font-bold text-gray-700">Scraping your competitors...</h3>
        <p class="text-sm text-gray-500 mt-2 max-w-md mx-auto">Your competitor data is being scraped. This usually takes 2-3 minutes on first load. The page will refresh automatically.</p>
        <div class="mt-4">
          <svg class="w-6 h-6 animate-spin mx-auto text-purple-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        </div>
        <p class="text-xs text-gray-400 mt-4">If this takes too long, try refreshing the page.</p>
      </div>
    `;
    // Auto-retry loading every 15 seconds
    setTimeout(() => {
      if (typeof loadUserDataFromSupabase === 'function') {
        loadUserDataFromSupabase().then(data => {
          if (data && data.length > 0) {
            posts = reclassifyPosts(data);
            loading.classList.add('hidden');
            document.getElementById('dashboard')?.classList.remove('hidden');
            // Re-trigger the page's render function
            window.location.reload();
          } else {
            // Still no data — keep waiting
            setTimeout(() => window.location.reload(), 15000);
          }
        }).catch(() => setTimeout(() => window.location.reload(), 15000));
      }
    }, 15000);
  }
}

// --- Shared Header/Nav ---
const NAV_PAGES = [
  { id: 'insights', label: 'Insights', href: '/dashboard', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>' },
  { id: 'calendar', label: 'Calendar', href: '/calendar', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
  { id: 'analytics', label: 'Analytics', href: '/analytics', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>' },
];

function renderNav(activePage) {
  return NAV_PAGES.map(p => `
    <a href="${p.href}" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
      p.id === activePage ? 'bg-white/20 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
    }">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">${p.icon}</svg>
      ${p.label}
    </a>
  `).join('');
}

function renderBrandHeader() {
  return `<span class="text-purple-400">Page</span>Growth<span class="text-emerald-400">Pro</span>`;
}

// Inject mobile hamburger menu into any page header
function initMobileNav() {
  const nav = document.getElementById('navBar');
  if (!nav) return;
  // Create mobile menu button (insert after settings button)
  const header = nav.closest('header') || nav.closest('.gradient-bg');
  if (!header) return;

  // Find or create mobile button
  if (document.getElementById('mobileMenuBtn')) return;

  const settingsBtn = header.querySelector('[title="Settings"]');
  if (settingsBtn) {
    const mobileBtn = document.createElement('button');
    mobileBtn.id = 'mobileMenuBtn';
    mobileBtn.className = 'md:hidden bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition';
    mobileBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>';
    mobileBtn.onclick = () => {
      const menu = document.getElementById('mobileNavMenu');
      if (menu) menu.classList.toggle('hidden');
    };
    settingsBtn.parentNode.appendChild(mobileBtn);
  }

  // Create mobile menu dropdown
  const mobileMenu = document.createElement('div');
  mobileMenu.id = 'mobileNavMenu';
  mobileMenu.className = 'hidden md:hidden pb-4 space-y-1 px-4';
  mobileMenu.innerHTML = NAV_PAGES.map(p => `
    <a href="${p.href}" class="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
      nav.innerHTML.includes('bg-white/20') && nav.innerHTML.includes(p.href) ? 'bg-white/20 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
    }">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">${p.icon}</svg>
      ${p.label}
    </a>
  `).join('');

  // Insert after the header's first child div
  const headerInner = header.querySelector('.max-w-7xl') || header.firstElementChild;
  if (headerInner) headerInner.appendChild(mobileMenu);
}

// Sign out button for nav
function renderSignOut() {
  return `<button onclick="handleSignOut()" class="text-xs text-gray-400 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/10">Sign Out</button>`;
}

async function handleSignOut() {
  if (typeof signOut === 'function') {
    await signOut();
  } else {
    window.location.href = '/login';
  }
}

// Auth gate — call at top of each dashboard page
// Checks: logged in → has subscription → completed onboarding
const ADMIN_EMAILS = ['bobrien0222@gmail.com'];

async function authGate() {
  if (typeof requireAuth !== 'function') return; // Supabase not loaded
  const user = await requireAuth();
  if (!user) return null; // redirected to login

  // Admin bypass — skip subscription check
  if (ADMIN_EMAILS.includes(user.email?.toLowerCase())) return user;

  // Check subscription status
  try {
    if (typeof getUserSettings === 'function') {
      const settings = await getUserSettings(user.id);
      const status = settings?.subscription_status;
      const plan = settings?.subscription_plan;
      // Allow: active, trialing, lifetime, or admin role
      const validStatuses = ['active', 'trialing', 'trial', 'lifetime'];
      const isAdmin = user.user_metadata?.role === 'admin';
      if (!isAdmin && status && !validStatuses.includes(status)) {
        // Subscription expired/cancelled — redirect to login with message
        window.location.href = '/login?expired=true';
        return null;
      }
    }
  } catch (e) {
    console.warn('Subscription check failed:', e.message);
    // Don't block on check failure — allow access
  }

  await checkOnboarding();
  return user;
}

// --- Content Type Badge Colors ---
function getTypeBadge(type) {
  const colors = {
    reel: 'bg-pink-100 text-pink-700',
    static: 'bg-blue-100 text-blue-700',
    carousel: 'bg-indigo-100 text-indigo-700',
    video: 'bg-purple-100 text-purple-700',
    story: 'bg-orange-100 text-orange-700',
    link: 'bg-yellow-100 text-yellow-700',
    text: 'bg-gray-100 text-gray-700',
    photo: 'bg-blue-100 text-blue-700',
  };
  return colors[type] || colors.text;
}
