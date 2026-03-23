// ===== PageGrowthPro — Facebook Meta Login (OAuth) =====
// Handles: Connect Facebook Page, get long-lived token, store in Supabase

// TODO: Replace with your Meta Developer App ID after creating at developers.facebook.com
const META_APP_ID = 'YOUR_META_APP_ID';
const META_APP_SECRET_WARNING = 'App Secret should NEVER be in client-side code. Token exchange must happen server-side in production.';

// --- Load Facebook SDK ---
function initFacebookSDK() {
  return new Promise((resolve) => {
    if (window.FB) { resolve(); return; }
    window.fbAsyncInit = function () {
      FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v22.0',
      });
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

// --- Connect Facebook Page (full flow) ---
async function connectFacebookPage() {
  if (META_APP_ID === 'YOUR_META_APP_ID') {
    throw new Error('Meta App ID not configured. Create a Meta Developer App at developers.facebook.com and set META_APP_ID in js/meta-login.js');
  }

  await initFacebookSDK();

  // Step 1: Trigger FB Login popup
  const authResponse = await new Promise((resolve, reject) => {
    FB.login((response) => {
      if (response.authResponse) {
        resolve(response.authResponse);
      } else {
        reject(new Error('Facebook login cancelled'));
      }
    }, {
      scope: 'pages_manage_posts,pages_read_engagement,pages_show_list',
      return_scopes: true,
    });
  });

  const shortLivedToken = authResponse.accessToken;
  const fbUserId = authResponse.userID;

  // Step 2: Get pages the user manages
  const pages = await getConnectedPages(shortLivedToken, fbUserId);
  if (!pages || pages.length === 0) {
    throw new Error('No Facebook Pages found. Make sure you manage at least one Facebook Page.');
  }

  // If multiple pages, let user pick (for now, take the first one)
  // TODO: Show a picker modal if multiple pages
  const selectedPage = pages[0];

  // Step 3: The page access token from /accounts is already a long-lived token
  // when derived from a long-lived user token, but from FB.login it's short-lived.
  // For now, use the page token directly — it works for 1-2 hours.
  // In production, exchange for long-lived token via server-side call.

  // Step 4: Store in Supabase
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

  return {
    pageId: selectedPage.id,
    pageName: selectedPage.name,
    pageToken: selectedPage.access_token,
  };
}

// --- Get pages user manages ---
async function getConnectedPages(accessToken, userId) {
  const res = await fetch(`https://graph.facebook.com/v22.0/${userId}/accounts?access_token=${accessToken}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to fetch Facebook pages');
  }
  const data = await res.json();
  return data.data || [];
}

// --- Disconnect Page ---
async function disconnectFacebookPage() {
  const user = await getUser();
  if (user) {
    await saveUserSettings(user.id, {
      fb_page_token: null,
      fb_page_id: null,
      fb_page_name: null,
      fb_user_token: null,
      fb_connected_at: null,
    });
  }
}

// --- Check if page is connected ---
async function checkFacebookConnection() {
  const user = await getUser();
  if (!user) return null;
  const settings = await getUserSettings(user.id);
  if (settings.fb_page_id && settings.fb_page_token) {
    return {
      pageId: settings.fb_page_id,
      pageName: settings.fb_page_name,
      pageToken: settings.fb_page_token,
      connectedAt: settings.fb_connected_at,
    };
  }
  return null;
}

// --- Post to Facebook Page (schedule or immediate) ---
async function postToFacebookPage(pageId, pageToken, { message, imageDataUri, scheduledTime }) {
  let endpoint, body;

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

    const res = await fetch(`https://graph.facebook.com/v22.0/${pageId}/photos`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to post to Facebook');
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

    const res = await fetch(`https://graph.facebook.com/v22.0/${pageId}/feed`, {
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
