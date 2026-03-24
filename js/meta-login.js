// ===== PageGrowthPro — Facebook Meta Login (OAuth) =====
// Handles: FB SDK init, login status check, page connection, posting

const META_APP_ID = '921569880480344';
const META_API_VERSION = 'v22.0';

// --- Load Facebook SDK + check login status on page load ---
let _fbSDKReady = false;
let _fbLoginStatus = null; // 'connected' | 'not_authorized' | 'unknown'

function initFacebookSDK() {
  return new Promise((resolve) => {
    if (_fbSDKReady && window.FB) { resolve(); return; }

    window.fbAsyncInit = function () {
      FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: true,
        version: META_API_VERSION,
      });

      // Check login status immediately after init
      FB.getLoginStatus(function (response) {
        _fbLoginStatus = response.status;
        _fbSDKReady = true;
        console.log('[FB SDK] Login status:', response.status);

        if (response.status === 'connected') {
          // Already logged in — auto-refresh connection
          handleFbStatusConnected(response.authResponse);
        }

        // Fire custom event so pages can react
        window.dispatchEvent(new CustomEvent('fb-sdk-ready', { detail: response }));
        resolve();
      });

      FB.AppEvents.logPageView();
    };

    // Load SDK script
    (function (d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) { return; }
      js = d.createElement(s); js.id = id;
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));
  });
}

// --- Handle already-connected status (auto-refresh tokens silently) ---
async function handleFbStatusConnected(authResponse) {
  const token = authResponse.accessToken;
  const userId = authResponse.userID;

  try {
    const pages = await getConnectedPages(token, userId);
    if (pages && pages.length > 0) {
      // Check if we already have a page stored
      const s = JSON.parse(localStorage.getItem('vpro_dashboard_settings') || '{}');
      const storedPageId = s.fbPageId;

      // Find the stored page or use first
      const page = storedPageId
        ? pages.find(p => p.id === storedPageId) || pages[0]
        : pages[0];

      // Silently update the token (it may have refreshed)
      storePageConnection(page, token);
      updateFbStatusUI(page.name, true);
      console.log('[FB] Auto-refreshed connection for:', page.name);
    }
  } catch (e) {
    console.warn('[FB] Auto-refresh failed:', e.message);
  }
}

// --- Connect Facebook Page (user-initiated flow) ---
async function connectFacebookPage() {
  await initFacebookSDK();

  // Step 1: Check current status first
  const statusResponse = await new Promise((resolve) => {
    FB.getLoginStatus(function (response) { resolve(response); });
  });

  let authResponse;

  if (statusResponse.status === 'connected') {
    // Already logged in — use existing token
    authResponse = statusResponse.authResponse;
  } else {
    // Need to trigger login popup
    authResponse = await new Promise((resolve, reject) => {
      FB.login((response) => {
        if (response.authResponse) {
          resolve(response.authResponse);
        } else {
          reject(new Error('Facebook login cancelled or failed'));
        }
      }, {
        scope: 'pages_manage_posts,pages_read_engagement,pages_show_list,pages_read_user_content',
        return_scopes: true,
      });
    });
  }

  const shortLivedToken = authResponse.accessToken;
  const fbUserId = authResponse.userID;

  // Step 2: Get pages the user manages
  const pages = await getConnectedPages(shortLivedToken, fbUserId);
  if (!pages || pages.length === 0) {
    throw new Error('No Facebook Pages found. Make sure you manage at least one Facebook Page.');
  }

  // Step 3: Let user pick if multiple pages
  let selectedPage;
  if (pages.length === 1) {
    selectedPage = pages[0];
  } else {
    selectedPage = await showPagePicker(pages);
  }

  // Step 4: Store everything
  storePageConnection(selectedPage, shortLivedToken);

  // Step 5: Try to save to Supabase too
  try {
    if (typeof getUser === 'function') {
      const user = await getUser();
      if (user) {
        await saveUserSettings(user.id, {
          fb_page_token: selectedPage.access_token,
          fb_page_id: selectedPage.id,
          fb_page_name: selectedPage.name,
          fb_user_token: shortLivedToken,
          fb_connected_at: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.warn('[FB] Supabase save skipped:', e.message);
  }

  return {
    pageId: selectedPage.id,
    pageName: selectedPage.name,
    pageToken: selectedPage.access_token,
  };
}

// --- Page picker for multiple pages ---
function showPagePicker(pages) {
  return new Promise((resolve, reject) => {
    // Create modal
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
        <h3 class="font-bold text-lg mb-1">Select a Facebook Page</h3>
        <p class="text-sm text-gray-500 mb-4">You manage ${pages.length} pages. Choose the one to connect:</p>
        <div class="space-y-2 max-h-64 overflow-y-auto" id="pagePickerList"></div>
        <button onclick="this.closest('.fixed').remove()" class="mt-4 text-sm text-gray-400 hover:text-gray-600 transition">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const list = overlay.querySelector('#pagePickerList');
    pages.forEach((page, i) => {
      const btn = document.createElement('button');
      btn.className = 'w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition flex items-center gap-3';
      btn.innerHTML = `
        <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">${page.name[0]}</div>
        <div>
          <div class="font-medium text-sm">${page.name}</div>
          <div class="text-xs text-gray-400">ID: ${page.id}</div>
        </div>
      `;
      btn.onclick = () => {
        overlay.remove();
        resolve(page);
      };
      list.appendChild(btn);
    });

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) { overlay.remove(); reject(new Error('Selection cancelled')); }
    };
  });
}

// --- Store page connection locally ---
function storePageConnection(page, userToken) {
  const s = JSON.parse(localStorage.getItem('vpro_dashboard_settings') || '{}');
  s.fbPageToken = page.access_token;
  s.fbPageId = page.id;
  s.fbPageName = page.name;
  s.fbUserToken = userToken;
  s.fbConnectedAt = new Date().toISOString();
  localStorage.setItem('vpro_dashboard_settings', JSON.stringify(s));

  // Update any settings inputs on the page
  const tokenInput = document.getElementById('settingFbToken');
  const pageIdInput = document.getElementById('settingFbPageId');
  if (tokenInput) tokenInput.value = page.access_token;
  if (pageIdInput) pageIdInput.value = page.id;
}

// --- Update FB connection status UI ---
function updateFbStatusUI(pageName, connected) {
  const statusEl = document.getElementById('fbConnectionStatus');
  const btn = document.getElementById('fbConnectBtn');
  if (!statusEl) return;

  if (connected) {
    statusEl.innerHTML = `<span class="text-xs text-green-400 flex items-center gap-1">
      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/></svg>
      Connected: <strong>${pageName}</strong>
    </span>`;
    if (btn) {
      btn.innerHTML = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> Reconnect`;
      btn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      btn.classList.add('bg-green-600', 'hover:bg-green-700');
    }
  } else {
    statusEl.innerHTML = `<span class="text-xs text-gray-400">Not connected</span>`;
    if (btn) {
      btn.innerHTML = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> Connect Facebook Page`;
      btn.classList.remove('bg-green-600', 'hover:bg-green-700');
      btn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
  }
}

// --- Get pages user manages ---
async function getConnectedPages(accessToken, userId) {
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${userId}/accounts?access_token=${accessToken}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to fetch Facebook pages');
  }
  const data = await res.json();
  return data.data || [];
}

// --- Disconnect Page ---
async function disconnectFacebookPage() {
  // Clear localStorage
  const s = JSON.parse(localStorage.getItem('vpro_dashboard_settings') || '{}');
  delete s.fbPageToken;
  delete s.fbPageId;
  delete s.fbPageName;
  delete s.fbUserToken;
  delete s.fbConnectedAt;
  localStorage.setItem('vpro_dashboard_settings', JSON.stringify(s));

  // Clear Supabase
  try {
    if (typeof getUser === 'function') {
      const user = await getUser();
      if (user) {
        await saveUserSettings(user.id, {
          fb_page_token: null, fb_page_id: null, fb_page_name: null,
          fb_user_token: null, fb_connected_at: null,
        });
      }
    }
  } catch (e) { console.warn('[FB] Supabase disconnect skipped:', e.message); }

  // Logout from FB SDK
  if (window.FB) {
    try { FB.logout(); } catch (e) {}
  }

  updateFbStatusUI(null, false);
}

// --- Check if page is connected (from localStorage) ---
function isPageConnected() {
  const s = JSON.parse(localStorage.getItem('vpro_dashboard_settings') || '{}');
  return !!(s.fbPageToken && s.fbPageId);
}

function getStoredPageConnection() {
  const s = JSON.parse(localStorage.getItem('vpro_dashboard_settings') || '{}');
  if (s.fbPageToken && s.fbPageId) {
    return { pageId: s.fbPageId, pageName: s.fbPageName, pageToken: s.fbPageToken };
  }
  return null;
}

// --- Post to Facebook Page (schedule or immediate) ---
async function postToFacebookPage(pageId, pageToken, { message, imageDataUri, scheduledTime }) {
  if (imageDataUri) {
    // Photo post — upload image as blob
    const blob = await (await fetch(imageDataUri)).blob();
    const formData = new FormData();
    formData.append('source', blob, 'post-image.png');
    if (message) formData.append('caption', message);
    if (scheduledTime) {
      formData.append('published', 'false');
      formData.append('scheduled_publish_time', Math.floor(new Date(scheduledTime).getTime() / 1000).toString());
    }
    formData.append('access_token', pageToken);

    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pageId}/photos`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to post photo to Facebook');
    }
    return res.json();
  } else {
    // Text-only post
    const params = new URLSearchParams({ access_token: pageToken });
    if (message) params.append('message', message);
    if (scheduledTime) {
      params.append('published', 'false');
      params.append('scheduled_publish_time', Math.floor(new Date(scheduledTime).getTime() / 1000).toString());
    }

    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pageId}/feed`, {
      method: 'POST',
      body: params,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to post to Facebook');
    }
    return res.json();
  }
}

// --- Auto-init SDK on script load ---
// This starts the FB SDK loading immediately and checks login status
initFacebookSDK().catch(e => console.warn('[FB SDK] Init failed:', e.message));
