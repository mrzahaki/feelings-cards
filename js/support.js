// Support chat widget — logged-in buyers only. Talks to
// apps-script-support.gs (config.js -> support.endpoint), which relays
// messages to/from a Telegram bot (Telegram replies now arrive via
// polling on that script's side — see apps-script-support.gs's POLLING
// section — but that's invisible from here; this file just keeps calling
// 'poll' the same way it always has). Wrapped in its own IIFE (same
// reason as account.js) so top-level consts don't collide across files.
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
  const backdrop = document.getElementById('supportBackdrop');
  const panel = document.getElementById('supportPanel');
  const closeBtn = document.getElementById('supportClose');
  const messagesEl = document.getElementById('supportMessages');
  const scrollLatestBtn = document.getElementById('supportScrollLatest');
  const quickRepliesEl = document.getElementById('supportQuickReplies');
  const form = document.getElementById('supportForm');
  const input = document.getElementById('supportInput');
  const charCountEl = document.getElementById('supportCharCount');
  const sendBtn = document.getElementById('supportSendBtn');
  const statusEl = document.getElementById('supportStatus');
  if (!launcher || !panel || !form || !input) return;

  let messages = [];       // in-memory only — see file header
  let lastSeen = '';       // ISO timestamp of the newest message we've ever fetched (poll cursor)
  // lastReadAt is the badge cursor. It's seeded from the SERVER on every
  // load (see loadHistory_) rather than assumed — the server persists it
  // per account (SupportReadState sheet in apps-script-support.gs), so a
  // buyer who goes offline, comes back later, and refreshes still sees an
  // accurate unread count instead of the badge silently resetting to 0
  // just because this tab's in-memory state is fresh.
  let lastReadAt = '';
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

  // Dedupe by id: a background poll can race a send's own response (see
  // the submit handler below) and fetch the same just-saved message
  // before that response swaps out its optimistic placeholder. Without
  // this check that message would get added twice — visually looking
  // like the widget "echoed" what you just typed.
  function appendMessages_(newOnes) {
    const existingIds = new Set(messages.map(m => m.id));
    let added = false;
    newOnes.forEach(m => {
      if (m.createdAt > lastSeen) lastSeen = m.createdAt;
      if (existingIds.has(m.id)) return;
      messages.push(m);
      existingIds.add(m.id);
      added = true;
    });
    if (!added) return;
    messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (isOpen) {
      renderMessages_({ stickToBottom: isNearBottom_() });
    }
    recomputeUnread_();
  }

  // ---- unread badge ----
  // Always a pure recompute from (messages, lastReadAt) rather than an
  // incrementing counter — that means it can never drift out of sync
  // with reality no matter what order polls/opens/sends land in.
  function recomputeUnread_() {
    if (isOpen) { setUnread_(0); return; }
    const n = messages.filter(m => m.sender === 'support' && m.createdAt > lastReadAt).length;
    setUnread_(n);
  }

  function setUnread_(n) {
    const wasZero = unread === 0;
    unread = n;
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = false;
      if (wasZero) {
        // Small pop-in whenever the badge goes from nothing to something,
        // rather than on every re-render — see the matching @keyframes.
        badge.classList.remove('support-badge-pop');
        void badge.offsetWidth; // restart the animation if it's already mid-flight
        badge.classList.add('support-badge-pop');
      }
    } else {
      badge.hidden = true;
    }
  }

  // ---- rendering ----
  function isNearBottom_() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
  }

  function renderMessages_(opts) {
    opts = opts || {};
    quickRepliesEl.hidden = messages.length > 0;

    if (!messages.length) {
      messagesEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'support-empty';
      p.textContent = C.support.emptyStateText;
      messagesEl.appendChild(p);
      renderQuickReplies_();
      return;
    }

    const stick = opts.stickToBottom !== false; // default true — most callers want "land on latest"
    messagesEl.innerHTML = '';

    let prevMsg = null;
    let prevDayKey = null;
    messages.forEach(m => {
      const dayKey = dayKeyFor_(m.createdAt);
      if (dayKey !== prevDayKey) {
        messagesEl.appendChild(renderDaySeparator_(m.createdAt));
        prevDayKey = dayKey;
        prevMsg = null; // a new day always starts a fresh group
      }
      const grouped = !!(prevMsg && prevMsg.sender === m.sender && (new Date(m.createdAt) - new Date(prevMsg.createdAt)) < 3 * 60 * 1000);
      messagesEl.appendChild(renderBubble_(m, grouped));
      prevMsg = m;
    });

    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
    updateScrollLatestVisibility_();
  }

  function renderQuickReplies_() {
    if (!C.support.quickReplies || !C.support.quickReplies.length) { quickRepliesEl.hidden = true; return; }
    quickRepliesEl.innerHTML = '';
    if (C.support.quickRepliesLabel) {
      const label = document.createElement('span');
      label.className = 'support-quick-replies-label';
      label.textContent = C.support.quickRepliesLabel;
      quickRepliesEl.appendChild(label);
    }
    const row = document.createElement('div');
    row.className = 'support-quick-replies-row';
    C.support.quickReplies.forEach(text => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'support-chip';
      chip.textContent = text;
      chip.addEventListener('click', () => {
        input.value = text;
        autoGrow_();
        updateCharCount_();
        input.focus();
        // Put the cursor at the end rather than leaving it wherever the
        // click landed, so a buyer who wants to add detail can just keep typing.
        input.setSelectionRange(text.length, text.length);
      });
      row.appendChild(chip);
    });
    quickRepliesEl.appendChild(row);
  }

  function renderDaySeparator_(iso) {
    const el = document.createElement('div');
    el.className = 'support-day-sep';
    const span = document.createElement('span');
    span.textContent = dayLabel_(iso);
    el.appendChild(span);
    return el;
  }

  function renderBubble_(m, grouped) {
    const wrap = document.createElement('div');
    wrap.className = 'support-msg ' + (m.sender === 'user' ? 'support-msg-user' : 'support-msg-support') + (grouped ? ' support-msg-grouped' : '');
    if (String(m.id).indexOf('pending-') === 0) wrap.classList.add('support-msg-pending');

    const textEl = document.createElement('span');
    textEl.className = 'support-msg-text';
    textEl.textContent = m.text; // textContent, never innerHTML — see file header
    wrap.appendChild(textEl);

    if (!grouped) {
      const meta = document.createElement('span');
      meta.className = 'support-msg-meta';
      meta.textContent = (m.sender === 'user' ? C.support.youLabel : C.support.supportLabel) + ' · ' + formatTime_(m.createdAt);
      wrap.appendChild(meta);
    }

    return wrap;
  }

  function dayKeyFor_(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function dayLabel_(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startOfToday - startOfThat) / 86400000);
    if (diffDays === 0) return C.support.todayLabel || 'Today';
    if (diffDays === 1) return C.support.yesterdayLabel || 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function formatTime_(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // ---- scroll-to-latest ----
  // Don't force-scroll on every incoming message — if the buyer's
  // scrolled up reading earlier messages, surface the pill instead of the
  // whole view jumping; if they're already near the bottom, follow along
  // as normal.
  function updateScrollLatestVisibility_() {
    scrollLatestBtn.hidden = isNearBottom_();
  }
  messagesEl.addEventListener('scroll', () => {
    if (isNearBottom_()) scrollLatestBtn.hidden = true;
  });
  scrollLatestBtn.addEventListener('click', () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    scrollLatestBtn.hidden = true;
  });

  // ---- open/close ----
  const MOBILE_QUERY = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;

  function openPanel() {
    isOpen = true;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    launcher.setAttribute('aria-expanded', 'true');
    if (MOBILE_QUERY && MOBILE_QUERY.matches) {
      backdrop.hidden = false;
      document.body.classList.add('support-scroll-lock');
    }
    // Zero the badge immediately for a snappy feel. loadHistory_({markRead:
    // true}) below persists "read up to now" to the server as part of the
    // very same request that refreshes history — no separate round trip —
    // so a later refresh, relogin, or a second device still reflects this
    // accurately instead of only ever resetting the badge in this tab.
    setUnread_(0);
    renderMessages_();
    // First open (or reopen): make sure we have the full thread, not
    // just whatever's trickled in since the last background poll.
    loadHistory_({ markRead: true });
    input.focus();
    schedulePoll();
  }
  function closePanel() {
    isOpen = false;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
    document.body.classList.remove('support-scroll-lock');
    launcher.focus();
    schedulePoll();
  }

  launcher.addEventListener('click', () => { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closePanel();
  });

  // opts.markRead (bool): piggyback "mark read up to now" onto this same
  // request instead of firing a second call — pass true only when the
  // buyer is actually opening the panel (see openPanel), never on a
  // silent background/boot load, or a message they haven't looked at yet
  // would get marked read without them ever seeing it.
  async function loadHistory_(opts) {
    opts = opts || {};
    try {
      const data = await callApi('poll', { since: '', markRead: !!opts.markRead });
      if (data.ok && data.messages) {
        messages = data.messages;
        if (messages.length) lastSeen = messages[messages.length - 1].createdAt;
        // Trust the server's persisted read cursor over any local guess —
        // it's per-account (not per-tab/per-session), so this is what
        // makes the badge survive a refresh, a new tab, going offline and
        // back, etc. and still show the real unread count. See
        // apps-script-support.gs's SupportReadState / handlePoll_.
        if (typeof data.lastReadAt === 'string') lastReadAt = data.lastReadAt;
        if (isOpen) renderMessages_();
        recomputeUnread_();
      }
    } catch (err) { /* keep whatever's already rendered; next poll will retry */ }
  }

  // ---- sending ----
  const CHAR_LIMIT = C.support.charLimit || 1500;
  const CHAR_WARN_AT = Math.round(CHAR_LIMIT * 0.85);
  input.addEventListener('input', () => {
    autoGrow_();
    updateCharCount_();
  });
  function autoGrow_() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  }
  function updateCharCount_() {
    const len = input.value.length;
    if (len >= CHAR_WARN_AT) {
      charCountEl.hidden = false;
      charCountEl.textContent = len + ' / ' + CHAR_LIMIT;
      charCountEl.classList.toggle('support-char-count-over', len > CHAR_LIMIT);
    } else {
      charCountEl.hidden = true;
    }
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
    sendBtn.classList.add('support-send-busy');
    sendBtn.setAttribute('aria-label', C.support.sendingLabel || 'Sending…');
    statusEl.className = 'status-msg support-status';
    statusEl.textContent = '';

    // Optimistic append so sending feels instant; if the request turns
    // out to have failed, that optimistic bubble is removed again below.
    const optimistic = { id: 'pending-' + Date.now(), sender: 'user', text: text, createdAt: new Date().toISOString() };
    messages.push(optimistic);
    renderMessages_();
    input.value = '';
    autoGrow_();
    updateCharCount_();

    const data = await callApi('send', { text: text });

    sending = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove('support-send-busy');
    sendBtn.setAttribute('aria-label', C.support.sendLabel || 'Send message');

    if (data.ok && data.message) {
      const idx = messages.indexOf(optimistic);
      if (idx !== -1) messages.splice(idx, 1); // drop the optimistic placeholder
      // If a background poll already pulled in this exact message (same
      // id) while this request was in flight, don't add a second copy.
      if (!messages.some(m => m.id === data.message.id)) {
        messages.push(data.message);
        messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      }
      if (data.message.createdAt > lastSeen) lastSeen = data.message.createdAt;
      lastReadAt = lastSeen; // it's the buyer's own message — obviously already "read"
      renderMessages_();
    } else {
      messages = messages.filter(m => m !== optimistic);
      renderMessages_();
      statusEl.className = 'status-msg support-status error';
      statusEl.textContent = data.error || C.support.errorGeneric;
      input.value = text; // hand the text back so nothing typed is lost
      autoGrow_();
      updateCharCount_();
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
    lastReadAt = '';
    setUnread_(0);
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
    document.body.classList.remove('support-scroll-lock');
    statusEl.textContent = '';
    input.value = '';
    charCountEl.hidden = true;
    clearTimeout(pollTimer);
  }

  window.Account.onChange(state => {
    if (state.loggedIn) {
      launcher.hidden = false;
      // Not markRead: this is a background/boot load, not the buyer
      // actually opening and looking at the panel. lastReadAt comes back
      // from the server as whatever it was last set to (possibly on a
      // different device/session, possibly never) — see loadHistory_ —
      // so the badge reflects true unread state, including messages that
      // arrived while they were away.
      loadHistory_();
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
    loadHistory_();
    schedulePoll();
  }
})();
