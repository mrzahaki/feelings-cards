// Support chat widget — logged-in buyers only. Talks to
// apps-script-support.gs (config.js -> support.endpoint), which relays
// messages to/from a Telegram bot. Wrapped in its own IIFE (same reason
// as account.js) so top-level consts don't collide across files.
//
// GATING: the launcher button only ever becomes visible once
// Account.isLoggedIn() is true (via Account.onChange — see account.js).
// It's also `hidden` by default in the markup itself, so there's no
// flash of a chat button before account.js has resolved a session
// either way. Logging out (or a stored session turning out to be
// expired) immediately hides and resets the widget — see the onChange
// handler near the bottom.
//
// DATA HANDLING: nothing about a conversation is kept in localStorage —
// only ever fetched fresh from the server for the currently logged-in
// account, and reset in memory on logout — so a shared/public computer
// can't leak one person's messages to the next person who opens the
// site. Every message rendered from the server goes through
// escapeHtml_ / textContent rather than innerHTML with raw text, so a
// reply can never inject markup into the page.
(function () {
  const C = window.SITE_CONFIG;
  if (!C || !C.support) { console.error('support.js: window.SITE_CONFIG.support not found — make sure config.js loads first.'); return; }
  if (!window.Account) { console.error('support.js: window.Account not found — make sure account.js loads first.'); return; }

  const ENDPOINT = C.support.endpoint;
  if (!ENDPOINT || ENDPOINT.indexOf('PUT_YOUR') === 0) return; // not configured yet — stay fully inert rather than hitting a dead URL

  const launcher = document.getElementById('supportLauncher');
  const badge = document.getElementById('supportBadge');
  const panel = document.getElementById('supportPanel');
  const closeBtn = document.getElementById('supportClose');
  const messagesEl = document.getElementById('supportMessages');
  const form = document.getElementById('supportForm');
  const input = document.getElementById('supportInput');
  const sendBtn = document.getElementById('supportSendBtn');
  const statusEl = document.getElementById('supportStatus');
  if (!launcher || !panel || !form || !input) return;

  let messages = [];       // in-memory only — see file header
  let lastSeen = '';       // ISO timestamp of the newest message we've rendered
  let unread = 0;
  let isOpen = false;
  let sending = false;

  // ---- polling ----
  // Open + focused: poll often for a responsive feel. Closed (but still
  // logged in): poll much less often, just to surface the unread badge
  // without hammering the endpoint. Tab hidden: pause entirely.
  const POLL_MS_OPEN = 4000;
  const POLL_MS_BACKGROUND = 25000;
  let pollTimer = null;

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (document.hidden) return; // resumes via the visibilitychange listener below
    pollTimer = setTimeout(pollNow, isOpen ? POLL_MS_OPEN : POLL_MS_BACKGROUND);
  }

  async function pollNow() {
    if (!window.Account.isLoggedIn()) return;
    try {
      const data = await callApi('poll', { since: lastSeen });
      if (data.ok && data.messages && data.messages.length) {
        appendMessages_(data.messages);
      }
    } catch (err) { /* transient network hiccup — next scheduled poll retries */ }
    schedulePoll();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollNow();
  });

  function appendMessages_(newOnes) {
    let addedUnread = 0;
    // Dedupe by id: a background poll can race a send's own response (see
    // the submit handler below) and fetch the same just-saved message
    // before that response swaps out its optimistic placeholder. Without
    // this check that message would get added twice — the "echo" bug.
    const existingIds = new Set(messages.map(m => m.id));
    newOnes.forEach(m => {
      if (existingIds.has(m.id)) {
        if (m.createdAt > lastSeen) lastSeen = m.createdAt;
        return;
      }
      messages.push(m);
      existingIds.add(m.id);
      if (m.createdAt > lastSeen) lastSeen = m.createdAt;
      if (m.sender === 'support' && !isOpen) addedUnread++;
    });
    if (addedUnread) setUnread_(unread + addedUnread);
    if (isOpen) renderMessages_();
  }

  function setUnread_(n) {
    unread = n;
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // ---- rendering ----
  function renderMessages_() {
    if (!messages.length) {
      messagesEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'support-empty';
      p.textContent = C.support.emptyStateText;
      messagesEl.appendChild(p);
      return;
    }
    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
    messagesEl.innerHTML = '';
    messages.forEach(m => messagesEl.appendChild(renderBubble_(m)));
    if (wasAtBottom || true) messagesEl.scrollTop = messagesEl.scrollHeight; // always land on the latest message
  }

  function renderBubble_(m) {
    const wrap = document.createElement('div');
    wrap.className = 'support-msg ' + (m.sender === 'user' ? 'support-msg-user' : 'support-msg-support');

    const textEl = document.createElement('span');
    textEl.textContent = m.text; // textContent, never innerHTML — see file header
    wrap.appendChild(textEl);

    const meta = document.createElement('span');
    meta.className = 'support-msg-meta';
    meta.textContent = (m.sender === 'user' ? C.support.youLabel : C.support.supportLabel) + ' · ' + formatTime_(m.createdAt);
    wrap.appendChild(meta);

    return wrap;
  }

  function formatTime_(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ---- open/close ----
  function openPanel() {
    isOpen = true;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    launcher.setAttribute('aria-expanded', 'true');
    setUnread_(0);
    renderMessages_();
    // First open (or reopen): make sure we have the full thread, not
    // just whatever's trickled in since the last background poll.
    loadHistory_();
    input.focus();
    schedulePoll();
  }
  function closePanel() {
    isOpen = false;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
    schedulePoll();
  }

  launcher.addEventListener('click', () => { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closePanel();
  });

  async function loadHistory_() {
    try {
      const data = await callApi('poll', { since: '' });
      if (data.ok && data.messages) {
        messages = data.messages;
        lastSeen = messages.length ? messages[messages.length - 1].createdAt : '';
        renderMessages_();
      }
    } catch (err) { /* keep whatever's already rendered; next poll will retry */ }
  }

  // ---- sending ----
  const CHAR_LIMIT = C.support.charLimit || 1500;
  input.addEventListener('input', () => {
    autoGrow_();
  });
  function autoGrow_() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;
    const text = input.value.trim();
    if (!text) return;
    if (text.length > CHAR_LIMIT) {
      statusEl.className = 'status-msg support-status error';
      statusEl.textContent = C.support.errorTooLong;
      return;
    }

    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = C.support.sendingLabel;
    statusEl.className = 'status-msg support-status';
    statusEl.textContent = '';

    // Optimistic append so sending feels instant; if the request turns
    // out to have failed, that optimistic bubble is removed again below.
    const optimistic = { id: 'pending-' + Date.now(), sender: 'user', text: text, createdAt: new Date().toISOString() };
    messages.push(optimistic);
    renderMessages_();
    input.value = '';
    autoGrow_();

    const data = await callApi('send', { text: text });

    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = C.support.sendLabel;

    if (data.ok && data.message) {
      const idx = messages.indexOf(optimistic);
      if (idx !== -1) messages.splice(idx, 1); // drop the optimistic placeholder
      // If a background poll already pulled in this exact message (same id)
      // while this request was still in flight, don't add a second copy —
      // see appendMessages_ for the matching half of this fix.
      const already = messages.some(m => m.id === data.message.id);
      if (!already) {
        messages.push(data.message);
        messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      }
      if (data.message.createdAt > lastSeen) lastSeen = data.message.createdAt;
      renderMessages_();
    } else {
      messages = messages.filter(m => m !== optimistic);
      renderMessages_();
      statusEl.className = 'status-msg support-status error';
      statusEl.textContent = data.error || C.support.errorGeneric;
      input.value = text; // hand the text back so nothing typed is lost
      autoGrow_();
    }
  });

  // ---- API ----
  async function callApi(action, payload) {
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight against Apps Script — same reasoning as account.js/main.js
        body: JSON.stringify(Object.assign({ action: action, sessionToken: window.Account.getToken() }, payload))
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: C.support.errorGeneric };
    }
  }

  // ---- account gating ----
  function resetWidget_() {
    isOpen = false;
    messages = [];
    lastSeen = '';
    setUnread_(0);
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    statusEl.textContent = '';
    input.value = '';
    clearTimeout(pollTimer);
  }

  window.Account.onChange(state => {
    if (state.loggedIn) {
      launcher.hidden = false;
      schedulePoll();
    } else {
      launcher.hidden = true;
      resetWidget_();
    }
  });

  // Boot: account.js may have already resolved (e.g. a fast, valid
  // stored session) by the time this file runs, so check once directly
  // rather than waiting only on the next onChange firing.
  if (window.Account.isLoggedIn()) {
    launcher.hidden = false;
    schedulePoll();
  }
})();
