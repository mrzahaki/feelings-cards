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

  // ---- client-side validation helpers ----
  // These exist purely for fast, friendly feedback — they never replace
  // the real checks in apps-script-auth.gs, which re-validates everything
  // from scratch since a client can always be bypassed. Their only job
  // here is to stop obviously-empty or obviously-malformed submissions
  // from ever reaching the network, and to tell the person exactly which
  // field needs fixing instead of a generic "something went wrong" after
  // a round trip.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function isValidEmailClient_(email) { return EMAIL_RE.test(email); }

  function setFieldError_(fieldId, errorId, msg) {
    const field = document.getElementById(fieldId);
    const err = document.getElementById(errorId);
    if (err) err.textContent = msg || '';
    if (field) {
      field.classList.toggle('invalid', !!msg);
      if (msg) {
        field.classList.remove('shake');
        // restart the shake animation even if it's already mid-run
        void field.offsetWidth;
        field.classList.add('shake');
      }
    }
  }
  function clearFieldErrors_(...pairs) {
    pairs.forEach(([fieldId, errorId]) => setFieldError_(fieldId, errorId, ''));
  }

  // Rough client-side password strength estimate (0-4). Not trying to be
  // a real entropy calculator — just enough to give someone a visual nudge
  // while they type. The actual floor (8 chars, common-password blocklist)
  // is enforced server-side regardless of what this shows.
  function computeStrength_(password) {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    const varietyCount = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
    if (varietyCount >= 2) score++;
    if (varietyCount >= 3) score++;
    return Math.min(score, 4);
  }

  function updatePasswordUI_(password) {
    const meter = document.getElementById('signupPwStrength');
    const bar = document.getElementById('signupPwStrengthBar');
    const label = document.getElementById('signupPwStrengthLabel');
    const ruleLen = document.getElementById('ruleLen');
    const ruleVariety = document.getElementById('ruleVariety');
    const labels = C.account.pwStrengthLabels || { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' };

    meter.hidden = !password;
    if (password) {
      const score = computeStrength_(password);
      const pct = [10, 35, 65, 85, 100][score];
      const tiers = ['weak', 'weak', 'fair', 'good', 'strong'];
      const tier = tiers[score];
      bar.style.width = pct + '%';
      bar.className = 'pw-strength-bar tier-' + tier;
      label.textContent = labels[tier] || '';
    }

    const lenOk = password.length >= 8;
    const varietyOk = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length >= 2;
    ruleLen.classList.toggle('met', lenOk);
    ruleVariety.classList.toggle('met', varietyOk);
  }

  const signupPasswordEl = document.getElementById('signupPassword');
  const signupPasswordConfirmEl = document.getElementById('signupPasswordConfirm');
  if (signupPasswordEl) {
    signupPasswordEl.addEventListener('input', () => {
      updatePasswordUI_(signupPasswordEl.value);
      if (signupPasswordConfirmEl.value) checkPasswordsMatch_();
    });
  }
  function checkPasswordsMatch_() {
    if (!signupPasswordConfirmEl.value) return true;
    const match = signupPasswordConfirmEl.value === signupPasswordEl.value;
    setFieldError_('signupPasswordConfirm', 'signupPasswordConfirmError', match ? '' : C.account.errorPasswordConfirmMismatch);
    return match;
  }
  if (signupPasswordConfirmEl) signupPasswordConfirmEl.addEventListener('input', checkPasswordsMatch_);

  // ---- client-side login-attempt throttle ----
  // A soft, purely-cosmetic cooldown layered on top of the real,
  // server-enforced rate limit + account lockout in apps-script-auth.gs.
  // This just means someone mashing the login button gets instant,
  // local feedback instead of firing a request every click — it can't be
  // trusted as the actual defense (a bot skips the browser entirely) but
  // it cuts down on wasted round trips and reads as more considered UX.
  const THROTTLE_KEY = 'ff_login_throttle';
  function getThrottleState_() {
    try {
      const raw = localStorage.getItem(THROTTLE_KEY);
      if (!raw) return { fails: 0, until: 0 };
      const parsed = JSON.parse(raw);
      return { fails: Number(parsed.fails) || 0, until: Number(parsed.until) || 0 };
    } catch (e) { return { fails: 0, until: 0 }; }
  }
  function setThrottleState_(state) {
    try { localStorage.setItem(THROTTLE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function registerLoginFailure_() {
    const state = getThrottleState_();
    state.fails += 1;
    // Progressive backoff: 3rd fail = 5s, 4th = 15s, 5th+ = 30s. Kept short
    // on purpose — the real ceiling is the server's 8-attempt lockout.
    if (state.fails >= 5) state.until = Date.now() + 30000;
    else if (state.fails === 4) state.until = Date.now() + 15000;
    else if (state.fails === 3) state.until = Date.now() + 5000;
    setThrottleState_(state);
  }
  function registerLoginSuccess_() { setThrottleState_({ fails: 0, until: 0 }); }
  function throttleSecondsLeft_() {
    const state = getThrottleState_();
    return Math.max(0, Math.ceil((state.until - Date.now()) / 1000));
  }

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
    clearFieldErrors_(
      ['loginEmail', 'loginEmailError'], ['loginPassword', 'loginPasswordError'],
      ['signupEmail', 'signupEmailError'], ['signupPassword', 'signupPasswordError'],
      ['signupPasswordConfirm', 'signupPasswordConfirmError']
    );
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
    const hp = document.getElementById('loginHp').value;
    const status = document.getElementById('loginStatus');
    const btn = document.getElementById('loginSubmitBtn');

    status.className = 'status-msg';
    status.textContent = '';
    resendBtn.hidden = true;
    clearFieldErrors_(['loginEmail', 'loginEmailError'], ['loginPassword', 'loginPasswordError']);

    // A filled honeypot means a script filled every input on the form —
    // no real visitor can see or reach it. Fail the same way a wrong
    // password would, without ever calling the API, so nothing about the
    // response tips the bot off that it was caught by this specific check.
    if (hp) {
      status.className = 'status-msg error';
      status.textContent = 'Incorrect email or password.';
      return;
    }

    let hasError = false;
    if (!email) { setFieldError_('loginEmail', 'loginEmailError', C.account.errorEmailRequired); hasError = true; }
    else if (!isValidEmailClient_(email)) { setFieldError_('loginEmail', 'loginEmailError', C.account.errorEmailInvalid); hasError = true; }
    if (!password) { setFieldError_('loginPassword', 'loginPasswordError', C.account.errorPasswordRequired); hasError = true; }
    if (hasError) return;

    const waitSec = throttleSecondsLeft_();
    if (waitSec > 0) {
      status.className = 'status-msg error';
      status.textContent = (C.account.errorTooManyClientAttempts || 'Too many attempts — please wait {sec}s before trying again.').replace('{sec}', waitSec);
      return;
    }

    btn.disabled = true;
    const recaptchaToken = await getRecaptchaToken_('login');
    const data = await callApi('login', { email: email, password: password, recaptchaToken: recaptchaToken, hp: hp });
    btn.disabled = false;

    if (data.ok) {
      registerLoginSuccess_();
      setSession(data.sessionToken, data.email);
      closeAuthModal();
      authPaneLogin.reset();
    } else {
      registerLoginFailure_();
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
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    const hp = document.getElementById('signupHp').value;
    const status = document.getElementById('signupStatus');
    const btn = document.getElementById('signupSubmitBtn');

    status.className = 'status-msg';
    status.textContent = '';
    clearFieldErrors_(
      ['signupEmail', 'signupEmailError'],
      ['signupPassword', 'signupPasswordError'],
      ['signupPasswordConfirm', 'signupPasswordConfirmError']
    );

    if (hp) {
      // Same honeypot logic as login — fail quietly, no network call,
      // no hint that a hidden field was the reason.
      status.className = 'status-msg error';
      status.textContent = 'Could not sign up — please try again.';
      return;
    }

    let hasError = false;
    if (!email) { setFieldError_('signupEmail', 'signupEmailError', C.account.errorEmailRequired); hasError = true; }
    else if (!isValidEmailClient_(email)) { setFieldError_('signupEmail', 'signupEmailError', C.account.errorEmailInvalid); hasError = true; }

    if (!password) {
      setFieldError_('signupPassword', 'signupPasswordError', C.account.errorPasswordRequired); hasError = true;
    } else if (password.length < 8) {
      setFieldError_('signupPassword', 'signupPasswordError', C.account.errorPasswordTooShort); hasError = true;
    } else if (password.length > 256) {
      setFieldError_('signupPassword', 'signupPasswordError', C.account.errorPasswordTooLong); hasError = true;
    } else if (computeStrength_(password) === 0) {
      setFieldError_('signupPassword', 'signupPasswordError', C.account.errorPasswordWeak); hasError = true;
    }

    if (!checkPasswordsMatch_()) hasError = true;
    if (hasError) return;

    btn.disabled = true;
    const recaptchaToken = await getRecaptchaToken_('signup');
    const data = await callApi('signup', { email: email, password: password, recaptchaToken: recaptchaToken, hp: hp });
    btn.disabled = false;

    if (data.ok) {
      status.className = 'status-msg';
      status.innerHTML = C.account.signupSuccessNoteHtml.replace('{email}', email);
      document.getElementById('loginEmail').value = email;
      authPaneSignup.reset();
      updatePasswordUI_('');
      document.getElementById('ruleLen').classList.remove('met');
      document.getElementById('ruleVariety').classList.remove('met');
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
