// Accounts: signup, login, session, and order history — talks to
// apps-script-auth.gs (config.js -> account.endpoint). Wrapped in its
// own IIFE (unlike main.js) specifically so its top-level `const C`
// etc. don't collide with main.js's identically-named top-level
// consts in the shared global script scope.
//
// Exposes window.Account for main.js's checkout button to use:
//   Account.isLoggedIn(), Account.getEmail(), Account.getToken()
//   Account.onChange(cb)         — cb({loggedIn, email, token})
//   Account.openModal(mode)      — mode: 'login' | 'signup'
(function () {
  const C = window.SITE_CONFIG;
  if (!C || !C.account) { console.error('account.js: window.SITE_CONFIG.account not found — make sure config.js loads first.'); return; }

  const ENDPOINT = C.account.endpoint;
  const STORAGE_KEY = 'ff_session_token';

  let sessionToken = null;
  try { sessionToken = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage blocked (private mode etc.) — user just stays logged out each visit */ }
  let sessionEmail = null;
  let checking = !!sessionToken; // true while we're verifying a stored token on first load

  const listeners = [];
  function notify() {
    const state = { loggedIn: !!sessionEmail, email: sessionEmail, token: sessionToken };
    listeners.forEach(cb => { try { cb(state); } catch (e) { /* a listener throwing shouldn't break the others */ } });
  }

  window.Account = {
    getToken: () => sessionToken,
    getEmail: () => sessionEmail,
    isLoggedIn: () => !!sessionEmail,
    onChange: (cb) => { listeners.push(cb); },
    openModal: (mode) => openAuthModal(mode || 'login'),
  };

  async function callApi(action, payload) {
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight against Apps Script — same reasoning as main.js's invoice call
        body: JSON.stringify(Object.assign({ action: action }, payload))
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: 'Network error — please try again.' };
    }
  }

  // Gets a reCAPTCHA v3 token for the given action, or null if reCAPTCHA
  // isn't configured yet (still the placeholder site key) or the widget
  // failed to load — apps-script-auth.gs treats a missing token as "not
  // configured" too, so the site keeps working end-to-end either way.
  async function getRecaptchaToken_(action) {
    const siteKey = C.account.recaptchaSiteKey;
    if (!siteKey || siteKey.indexOf('PUT_YOUR') === 0 || typeof grecaptcha === 'undefined') return null;
    try {
      await new Promise(resolve => grecaptcha.ready(resolve));
      return await grecaptcha.execute(siteKey, { action: action });
    } catch (err) {
      return null;
    }
  }

  function setSession(token, email) {
    sessionToken = token;
    sessionEmail = email;
    try {
      if (token) localStorage.setItem(STORAGE_KEY, token);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* storage blocked — session just won't survive a reload */ }
    renderAccountUI();
    notify();
  }

  // ---- nav account button + dropdown ----
  const navAccountBtn = document.getElementById('navAccountBtn');
  const navAccountMenu = document.getElementById('navAccountMenu');
  const navMyOrdersBtn = document.getElementById('navMyOrdersBtn');
  const navLogoutBtn = document.getElementById('navLogoutBtn');
  const navAccount = document.getElementById('navAccount');
  const navAccountMenuEmail = document.getElementById('navAccountMenuEmail');

  function renderAccountUI() {
    if (checking) {
      navAccountBtn.textContent = '…';
      navAccountBtn.disabled = true;
      navAccountBtn.removeAttribute('title');
    } else {
      navAccountBtn.disabled = false;
      // Short, fixed label on the pill itself — the actual email lives in
      // the dropdown (navAccountMenuEmail below) and as a hover tooltip /
      // accessible name here, so it never has to fit inside the button.
      navAccountBtn.textContent = sessionEmail ? C.account.loggedInLabel : C.account.signedOutLabel;
      navAccountBtn.classList.toggle('is-loggedin', !!sessionEmail);
      if (sessionEmail) {
        navAccountBtn.title = sessionEmail;
        navAccountBtn.setAttribute('aria-label', C.account.loggedInLabel + ': ' + sessionEmail);
      } else {
        navAccountBtn.removeAttribute('title');
        navAccountBtn.removeAttribute('aria-label');
      }
      if (!sessionEmail) navAccountMenu.hidden = true;
    }
    if (navAccountMenuEmail) {
      navAccountMenuEmail.textContent = sessionEmail ? (C.account.menuSignedInAsPrefix + ' ' + sessionEmail) : '';
    }

    const loggedOutEl = document.getElementById('checkoutLoggedOut');
    const loggedInEl = document.getElementById('checkoutLoggedIn');
    const asLabel = document.getElementById('checkoutAsLabel');
    if (loggedOutEl && loggedInEl) {
      loggedOutEl.hidden = !!sessionEmail;
      loggedInEl.hidden = !sessionEmail;
      if (sessionEmail && asLabel) asLabel.textContent = C.account.checkoutAsPrefix + ' ' + sessionEmail;
    }
  }

  navAccountBtn.addEventListener('click', () => {
    if (checking) return;
    if (sessionEmail) {
      navAccountMenu.hidden = !navAccountMenu.hidden;
    } else {
      openAuthModal('login');
    }
  });
  document.addEventListener('click', (e) => {
    if (!navAccountMenu.hidden && !navAccount.contains(e.target)) navAccountMenu.hidden = true;
  });

  navLogoutBtn.addEventListener('click', async () => {
    navAccountMenu.hidden = true;
    const tokenToRevoke = sessionToken;
    setSession(null, null); // reflect logout immediately in the UI
    await callApi('logout', { sessionToken: tokenToRevoke });
  });

  navMyOrdersBtn.addEventListener('click', () => {
    navAccountMenu.hidden = true;
    openOrdersModal();
  });

  // ---- auth modal (sign up / log in) ----
  const authModal = document.getElementById('authModal');
  const authModalBackdrop = document.getElementById('authModalBackdrop');
  const authModalClose = document.getElementById('authModalClose');
  const authTabLogin = document.getElementById('authTabLogin');
  const authTabSignup = document.getElementById('authTabSignup');
  const authPaneLogin = document.getElementById('authPaneLogin');
  const authPaneSignup = document.getElementById('authPaneSignup');
  const resendBtn = document.getElementById('resendVerificationBtn');

  // ---- Google button: rendered to fill its container's real width -----
  // Google Identity Services draws the button as a cross-origin iframe at
  // a fixed pixel width, so a hardcoded data-width (the old markup used
  // 320) overflows on narrower phones and looks too small on wider modals.
  // Rendering it ourselves lets us measure the actual container and keep
  // it correctly sized whenever the modal opens or the viewport changes.
  const googleContainer = document.getElementById('googleSignInContainer');
  let googleButtonRendered = false;

  function renderGoogleButton_() {
    if (!googleContainer || typeof google === 'undefined' || !google.accounts || !google.accounts.id) return false;
    const width = Math.max(200, Math.min(400, Math.round(googleContainer.getBoundingClientRect().width)));
    if (!width) return false; // container not laid out yet (e.g. modal still hidden)
    googleContainer.innerHTML = '';
    google.accounts.id.renderButton(googleContainer, {
      type: 'standard', theme: 'outline', shape: 'pill',
      text: 'continue_with', size: 'large', logo_alignment: 'left',
      width: width
    });
    googleButtonRendered = true;
    return true;
  }

  // The gsi/client script loads async/defer, so it may not be ready the
  // instant the modal first opens — retry briefly until it is.
  function ensureGoogleButton_() {
    if (renderGoogleButton_()) return;
    let attempts = 0;
    const retry = setInterval(() => {
      attempts++;
      if (renderGoogleButton_() || attempts > 20) clearInterval(retry);
    }, 250);
  }

  let googleResizeTimer = null;
  window.addEventListener('resize', () => {
    if (!authModal.classList.contains('open')) return;
    clearTimeout(googleResizeTimer);
    googleResizeTimer = setTimeout(renderGoogleButton_, 150);
  });

  function openAuthModal(mode) {
    switchAuthTab(mode);
    document.getElementById('googleAuthStatus').textContent = '';
    authModal.classList.add('open');
    authModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const firstInput = mode === 'signup' ? document.getElementById('signupEmail') : document.getElementById('loginEmail');
    if (firstInput) firstInput.focus();
    ensureGoogleButton_();
  }
  function closeAuthModal() {
    authModal.classList.remove('open');
    authModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.querySelectorAll('.toggle-password').forEach(btn => {
      const input = document.getElementById(btn.dataset.target);
      if (input) input.type = 'password';
      btn.textContent = C.account.showPasswordLabel;
      btn.setAttribute('aria-label', 'Show password');
    });
  }
  function switchAuthTab(mode) {
    const isLogin = mode !== 'signup';
    authTabLogin.classList.toggle('active', isLogin);
    authTabSignup.classList.toggle('active', !isLogin);
    authPaneLogin.hidden = !isLogin;
    authPaneSignup.hidden = isLogin;
    resendBtn.hidden = true;
  }

  authModalClose.addEventListener('click', closeAuthModal);
  authModalBackdrop.addEventListener('click', closeAuthModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && authModal.classList.contains('open')) closeAuthModal(); });
  authTabLogin.addEventListener('click', () => switchAuthTab('login'));
  authTabSignup.addEventListener('click', () => switchAuthTab('signup'));
  document.getElementById('switchToSignupLink').addEventListener('click', (e) => { e.preventDefault(); switchAuthTab('signup'); });
  document.getElementById('switchToLoginLink').addEventListener('click', (e) => { e.preventDefault(); switchAuthTab('login'); });

  authPaneLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const status = document.getElementById('loginStatus');
    const btn = document.getElementById('loginSubmitBtn');

    status.className = 'status-msg';
    status.textContent = '';
    resendBtn.hidden = true;
    btn.disabled = true;

    const recaptchaToken = await getRecaptchaToken_('login');
    const data = await callApi('login', { email: email, password: password, recaptchaToken: recaptchaToken });
    btn.disabled = false;

    if (data.ok) {
      setSession(data.sessionToken, data.email);
      closeAuthModal();
      authPaneLogin.reset();
    } else {
      status.className = 'status-msg error';
      status.textContent = data.error || 'Could not log in — please try again.';
      if (data.error && data.error.indexOf('verify your email') !== -1) {
        resendBtn.hidden = false;
        resendBtn.dataset.email = email;
      }
    }
  });

  resendBtn.addEventListener('click', async () => {
    const email = resendBtn.dataset.email || document.getElementById('loginEmail').value.trim();
    const status = document.getElementById('loginStatus');
    resendBtn.disabled = true;
    const recaptchaToken = await getRecaptchaToken_('resend');
    const data = await callApi('resend_verification', { email: email, recaptchaToken: recaptchaToken });
    resendBtn.disabled = false;
    resendBtn.hidden = true;
    status.className = 'status-msg';
    status.textContent = data.message || 'If that account needs verifying, a new link was just sent.';
  });

  authPaneSignup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const status = document.getElementById('signupStatus');
    const btn = document.getElementById('signupSubmitBtn');

    status.className = 'status-msg';
    status.textContent = '';
    btn.disabled = true;

    const recaptchaToken = await getRecaptchaToken_('signup');
    const data = await callApi('signup', { email: email, password: password, recaptchaToken: recaptchaToken });
    btn.disabled = false;

    if (data.ok) {
      status.className = 'status-msg';
      status.innerHTML = C.account.signupSuccessNoteHtml.replace('{email}', email);
      document.getElementById('loginEmail').value = email;
      authPaneSignup.reset();
    } else {
      status.className = 'status-msg error';
      status.textContent = data.error || 'Could not sign up — please try again.';
    }
  });

  // ---- Sign in with Google ----
  // Google Identity Services calls this by name (see index.html's
  // data-callback="handleGoogleCredentialResponse") once someone completes
  // the Google button/prompt — response.credential is a signed ID token,
  // verified server-side in apps-script-auth.gs before any session is issued.
  async function handleGoogleCredentialResponse(response) {
    const status = document.getElementById('googleAuthStatus');
    status.className = 'status-msg';
    status.textContent = '';

    const data = await callApi('google_auth', { idToken: response.credential });
    if (data.ok) {
      setSession(data.sessionToken, data.email);
      closeAuthModal();
    } else {
      status.className = 'status-msg error';
      status.textContent = data.error || 'Could not sign in with Google — please try again.';
    }
  }
  window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;

  // ---- order history modal ----
  const ordersModal = document.getElementById('ordersModal');
  const ordersModalBackdrop = document.getElementById('ordersModalBackdrop');
  const ordersModalClose = document.getElementById('ordersModalClose');
  const ordersList = document.getElementById('ordersList');

  async function openOrdersModal() {
    ordersList.innerHTML = '<p class="status-msg">Loading…</p>';
    ordersModal.classList.add('open');
    ordersModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const data = await callApi('list_orders', { sessionToken: sessionToken });

    if (!data.ok) {
      ordersList.innerHTML = '<p class="status-msg error">' + escapeHtml_(data.error || 'Could not load orders.') + '</p>';
      return;
    }
    if (!data.orders.length) {
      ordersList.innerHTML = '<p class="status-msg">' + escapeHtml_(C.account.ordersEmptyText) + '</p>';
      return;
    }
    ordersList.innerHTML = data.orders.map(renderOrderRow_).join('');
  }

  function renderOrderRow_(o) {
    const date = new Date(o.createdAt);
    const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const status = String(o.status || '');
    return (
      '<div class="order-row">' +
        '<div class="order-row-top">' +
          '<span class="order-id">' + escapeHtml_(o.orderId || '—') + '</span>' +
          '<span class="order-date">' + escapeHtml_(dateStr) + '</span>' +
        '</div>' +
        '<div class="order-row-bottom">' +
          '<span class="order-amount">' + escapeHtml_(String(o.priceAmount)) + ' ' + escapeHtml_(String(o.priceCurrency || '').toUpperCase()) + '</span>' +
          '<span class="order-status">' + escapeHtml_(C.account.ordersStatusLabel) + ': ' + escapeHtml_(status) + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function closeOrdersModal() {
    ordersModal.classList.remove('open');
    ordersModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  ordersModalClose.addEventListener('click', closeOrdersModal);
  ordersModalBackdrop.addEventListener('click', closeOrdersModal);

  function escapeHtml_(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- show/hide password toggles ----
  document.querySelectorAll('.toggle-password').forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? C.account.showPasswordLabel : C.account.hidePasswordLabel;
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });

  // ---- checkout "sign in to check out" shortcut ----
  const checkoutSignInBtn = document.getElementById('checkoutSignInBtn');
  if (checkoutSignInBtn) checkoutSignInBtn.addEventListener('click', () => openAuthModal('login'));

  // ---- boot: verify any stored session before trusting it ----
  renderAccountUI();
  if (sessionToken) {
    callApi('check_session', { sessionToken: sessionToken }).then(data => {
      checking = false;
      if (data.ok) {
        sessionEmail = data.email;
        renderAccountUI();
        notify();
      } else {
        setSession(null, null); // stored token was invalid/expired — quietly log out
      }
    });
  } else {
    checking = false;
    renderAccountUI();
  }
})();
