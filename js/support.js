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
  const maximizeBtn = document.getElementById('supportMaximize');
  const resizeHandle = document.getElementById('supportResizeHandle');
  const grabber = document.getElementById('supportGrabber');
  const messagesEl = document.getElementById('supportMessages');
  const scrollLatestBtn = document.getElementById('supportScrollLatest');
  const quickRepliesEl = document.getElementById('supportQuickReplies');
  const form = document.getElementById('supportForm');
  const input = document.getElementById('supportInput');
  const charCountEl = document.getElementById('supportCharCount');
  const sendBtn = document.getElementById('supportSendBtn');
  const statusEl = document.getElementById('supportStatus');
  const attachBtn = document.getElementById('supportAttachBtn');
  const fileInput = document.getElementById('supportFileInput');
  // supportAttachPreview is an empty container now — one chip per staged
  // attachment (with its own thumbnail/name and remove button) is built
  // and torn down dynamically in renderAttachmentChips_ below, since a
  // message can carry more than one file.
  const attachPreview = document.getElementById('supportAttachPreview');
  const dropHint = document.getElementById('supportDropHint');
  const emojiBtn = document.getElementById('supportEmojiBtn');
  const emojiPopover = document.getElementById('supportEmojiPopover');
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

  // ---- staged attachments (paste / drag-drop / file picker) ----
  // Array of { blob, mimeType, previewUrl, kind, fileName }, where kind is
  // 'image' | 'video' | 'file'. previewUrl is only set for image/video
  // (an object URL the browser can render directly); a generic file just
  // shows its name. Holds up to ATTACH_MAX_COUNT attachments for the next
  // message, and only exists client-side until send — support.js never
  // persists it, and the server never persists it either (see
  // apps-script-support.gs's constants block).
  let pendingAttachments = [];

  // ---- attachments arriving FROM support (Telegram) ----
  // A 'support' message can carry an attachmentId (see
  // apps-script-support.gs's v4 notes) instead of an inline attachments
  // array — the file itself was never sent to us, just a pointer into
  // the server's short-lived cache. remoteAttachmentCache holds whatever
  // we've fetched so far this session (id -> {status, mimeType,
  // fileName, category, data}); nothing here is ever written to
  // localStorage/sessionStorage, same no-persistence rule as the rest of
  // this file. attachmentFetchesInFlight just prevents kicking off a
  // second fetch for the same id while the first is still in flight
  // (e.g. a re-render before it resolves).
  const remoteAttachmentCache = new Map();
  const attachmentFetchesInFlight = new Set();

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
      // Belt-and-suspenders: also clear the stale number itself, not just
      // the hidden attribute. If `hidden` ever fails to actually hide the
      // element again (e.g. a future CSS change reintroduces the same
      // display:flex-beats-[hidden] specificity fight fixed in
      // styles.css), this stops it from silently showing a leftover
      // count like "9+" instead of just doing nothing.
      badge.textContent = '';
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

    // m.attachments[].url only ever exists in this tab's own memory (an
    // object URL over the buyer's own blob) — the server never sends
    // attachment bytes back, so a message loaded fresh from poll/history
    // (e.g. after a refresh) has no attachments array at all and just
    // shows its stored text placeholder instead. See
    // apps-script-support.gs's constants block for why attachments
    // aren't persisted server-side. A message can carry several.
    if (m.attachments && m.attachments.length) {
      const attWrap = document.createElement('div');
      attWrap.className = 'support-msg-attachments';
      m.attachments.forEach(att => {
        if (att.kind === 'image' && att.url) {
          const imgEl = document.createElement('img');
          imgEl.className = 'support-msg-img';
          imgEl.src = att.url;
          imgEl.alt = 'Image attached to message';
          attWrap.appendChild(imgEl);
        } else if (att.kind === 'video' && att.url) {
          const videoEl = document.createElement('video');
          videoEl.className = 'support-msg-video';
          videoEl.src = att.url;
          videoEl.controls = true;
          videoEl.setAttribute('aria-label', 'Video attached to message');
          attWrap.appendChild(videoEl);
        } else if (att.kind === 'file' && att.name) {
          const chip = document.createElement('span');
          chip.className = 'support-msg-file-chip';
          const icon = document.createElement('span');
          icon.className = 'support-attach-file-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = '📎';
          const name = document.createElement('span');
          name.className = 'support-attach-file-name';
          name.textContent = att.name;
          chip.appendChild(icon);
          chip.appendChild(name);
          attWrap.appendChild(chip);
        }
      });
      wrap.appendChild(attWrap);
    } else if (m.attachmentId) {
      // A support reply that came with a photo/video/document — see
      // apps-script-support.gs's v4 notes. Nothing arrives with the
      // message itself; this kicks off (or reuses) a one-time fetch and
      // renders whatever state that fetch is currently in.
      wrap.appendChild(renderRemoteAttachment_(m.attachmentId));
    }

    if (m.text) {
      const textEl = document.createElement('span');
      textEl.className = 'support-msg-text';
      textEl.textContent = m.text; // textContent, never innerHTML — see file header
      wrap.appendChild(textEl);
    }

    if (!grouped) {
      const meta = document.createElement('span');
      meta.className = 'support-msg-meta';
      meta.textContent = (m.sender === 'user' ? C.support.youLabel : C.support.supportLabel) + ' · ' + formatTime_(m.createdAt);
      wrap.appendChild(meta);
    }

    return wrap;
  }

  // Renders the current state of a support-side attachment: a small
  // "loading" chip the first time it's seen (while loadRemoteAttachment_
  // fetches it in the background), the real image/video/file once it
  // resolves, or nothing extra (the message's text placeholder still
  // shows) if the fetch failed or the file already expired server-side.
  function renderRemoteAttachment_(attachmentId) {
    const attWrap = document.createElement('div');
    attWrap.className = 'support-msg-attachments';
    const entry = remoteAttachmentCache.get(attachmentId);

    if (entry && entry.status === 'done') {
      attWrap.appendChild(buildRemoteAttachmentEl_(entry));
    } else if (entry && entry.status === 'error') {
      return document.createComment(''); // text placeholder alone is still shown by the caller
    } else {
      const chip = document.createElement('span');
      chip.className = 'support-msg-file-chip';
      chip.textContent = C.support.attachmentLoadingLabel || 'Loading attachment…';
      attWrap.appendChild(chip);
      loadRemoteAttachment_(attachmentId);
    }
    return attWrap;
  }

  function buildRemoteAttachmentEl_(entry) {
    const url = 'data:' + entry.mimeType + ';base64,' + entry.data;
    if (entry.category === 'image') {
      const img = document.createElement('img');
      img.className = 'support-msg-img';
      img.src = url;
      img.alt = 'Image from support';
      return img;
    }
    if (entry.category === 'video') {
      const video = document.createElement('video');
      video.className = 'support-msg-video';
      video.src = url;
      video.controls = true;
      video.setAttribute('aria-label', 'Video from support');
      return video;
    }
    const chip = document.createElement('a');
    chip.className = 'support-msg-file-chip';
    chip.href = url;
    chip.download = entry.fileName || 'attachment';
    const icon = document.createElement('span');
    icon.className = 'support-attach-file-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📎';
    const name = document.createElement('span');
    name.className = 'support-attach-file-name';
    name.textContent = entry.fileName || 'Download attachment';
    chip.appendChild(icon);
    chip.appendChild(name);
    return chip;
  }

  async function loadRemoteAttachment_(attachmentId) {
    if (attachmentFetchesInFlight.has(attachmentId) || remoteAttachmentCache.has(attachmentId)) return;
    attachmentFetchesInFlight.add(attachmentId);
    try {
      const data = await callApi('fetchAttachment', { attachmentId: attachmentId });
      remoteAttachmentCache.set(attachmentId, data.ok
        ? { status: 'done', mimeType: data.mimeType, fileName: data.fileName, category: data.category, data: data.data }
        : { status: 'error' });
    } catch (err) {
      remoteAttachmentCache.set(attachmentId, { status: 'error' });
    } finally {
      attachmentFetchesInFlight.delete(attachmentId);
      // Only worth a re-render if the panel is actually open — a
      // background poll that happened to bring in a support attachment
      // will just show it correctly next time the buyer opens the panel.
      if (isOpen) renderMessages_({ stickToBottom: isNearBottom_() });
    }
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
    applyStoredSize_();
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
    if (emojiBtn) closeEmoji_();
    launcher.focus();
    schedulePoll();
  }

  launcher.addEventListener('click', () => { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closePanel();
  });

  // ---- resize ----
  // Lets a buyer make the panel bigger for a broader view of the
  // conversation — a corner drag handle on desktop/tablet (resizes width
  // + height), a draggable grabber on mobile (resizes the sheet's
  // height), plus a one-tap "maximize" toggle for anyone who'd rather
  // not fiddle with a drag. All three work with mouse, touch, or pen
  // (Pointer Events), and the drag handles are keyboard-operable too.
  //
  // Only the panel's on-screen SIZE is ever remembered, and only for
  // this tab (sessionStorage) — never anything about the conversation
  // itself, consistent with this file's no-persistence rule (see file
  // header). If storage is unavailable (private browsing, etc.) sizing
  // just quietly stops persisting; nothing breaks.
  const SIZE_KEY = 'ff_support_panel_size';
  function readSizePref_() {
    try { return JSON.parse(sessionStorage.getItem(SIZE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeSizePref_(patch) {
    try { sessionStorage.setItem(SIZE_KEY, JSON.stringify(Object.assign(readSizePref_(), patch))); } catch (e) { /* ignore */ }
  }
  function clamp_(v, min, max) {
    if (max < min) return max; // viewport smaller than our nominal minimum — fit the screen, don't overflow it
    return Math.max(min, Math.min(max, v));
  }

  const DESKTOP_MIN_W = 340, DESKTOP_MIN_H = 420;
  const MOBILE_MIN_H = 320;
  function desktopMaxW() { return Math.min(920, window.innerWidth - 24); }
  function desktopMaxH() { return Math.min(920, window.innerHeight - 40); }
  function mobileMaxH() { return window.innerHeight * .96; }

  let isMaximized = false;
  function setMaximized_(on, opts) {
    opts = opts || {};
    isMaximized = on;
    panel.classList.toggle('is-maximized', on);
    if (maximizeBtn) {
      maximizeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      maximizeBtn.setAttribute('aria-label', on ? 'Restore chat window size' : 'Expand chat window');
      const iconExpand = maximizeBtn.querySelector('.support-maximize-icon-expand');
      const iconCollapse = maximizeBtn.querySelector('.support-maximize-icon-collapse');
      if (iconExpand) iconExpand.hidden = on;
      if (iconCollapse) iconCollapse.hidden = !on;
    }
    if (!opts.skipStorage) writeSizePref_({ maximized: on });
  }
  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', () => setMaximized_(!isMaximized));
  }

  // Applied every time the panel opens: restores whatever size (or
  // maximized state) this tab last left it at, re-clamped to the
  // CURRENT viewport in case the window/orientation changed meanwhile.
  function applyStoredSize_() {
    const pref = readSizePref_();
    if (MOBILE_QUERY && MOBILE_QUERY.matches) {
      if (pref.mobileH) panel.style.height = clamp_(pref.mobileH, MOBILE_MIN_H, mobileMaxH()) + 'px';
    } else if (pref.maximized) {
      setMaximized_(true, { skipStorage: true });
    } else if (pref.w && pref.h) {
      panel.style.maxWidth = 'none';
      panel.style.maxHeight = 'none';
      panel.style.width = clamp_(pref.w, DESKTOP_MIN_W, desktopMaxW()) + 'px';
      panel.style.height = clamp_(pref.h, DESKTOP_MIN_H, desktopMaxH()) + 'px';
    }
  }

  function resetSize_() {
    panel.style.width = '';
    panel.style.height = '';
    panel.style.maxWidth = '';
    panel.style.maxHeight = '';
    if (isMaximized) setMaximized_(false, { skipStorage: true });
    writeSizePref_({ w: null, h: null, mobileH: null, maximized: false });
  }

  // Corner handle (desktop/tablet): drag grows the panel toward the
  // top-left, since it's pinned bottom-right on screen.
  if (resizeHandle) {
    let dragging = false, startX = 0, startY = 0, startW = 0, startH = 0;

    resizeHandle.addEventListener('pointerdown', e => {
      if (MOBILE_QUERY && MOBILE_QUERY.matches) return; // hidden on mobile anyway, but just in case
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startW = rect.width; startH = rect.height;
      panel.style.maxWidth = 'none';
      panel.style.maxHeight = 'none';
      // Pin to the current visual size BEFORE dropping the maximized
      // class, so exiting maximize mid-drag can't flash back to the
      // (smaller) default size for a frame.
      panel.style.width = startW + 'px';
      panel.style.height = startH + 'px';
      if (isMaximized) setMaximized_(false, { skipStorage: true });
      panel.classList.add('is-resizing');
      document.body.classList.add('support-resizing');
      resizeHandle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    resizeHandle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const w = clamp_(startW + (startX - e.clientX), DESKTOP_MIN_W, desktopMaxW());
      const h = clamp_(startH + (startY - e.clientY), DESKTOP_MIN_H, desktopMaxH());
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    });
    function endResizeDrag(e) {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('is-resizing');
      document.body.classList.remove('support-resizing');
      const rect = panel.getBoundingClientRect();
      writeSizePref_({ w: Math.round(rect.width), h: Math.round(rect.height), maximized: false });
      if (e && e.pointerId != null && resizeHandle.hasPointerCapture && resizeHandle.hasPointerCapture(e.pointerId)) {
        resizeHandle.releasePointerCapture(e.pointerId);
      }
    }
    resizeHandle.addEventListener('pointerup', endResizeDrag);
    resizeHandle.addEventListener('pointercancel', endResizeDrag);
    resizeHandle.addEventListener('dblclick', resetSize_);

    // Keyboard fallback: arrow keys nudge width/height, Enter/Space
    // toggles maximize, matching what the visible icon button does.
    resizeHandle.addEventListener('keydown', e => {
      if (MOBILE_QUERY && MOBILE_QUERY.matches) return;
      const STEP = 24;
      const rect = panel.getBoundingClientRect();
      let w = rect.width, h = rect.height, changed = true;
      if (e.key === 'ArrowLeft') w += STEP;
      else if (e.key === 'ArrowRight') w -= STEP;
      else if (e.key === 'ArrowUp') h += STEP;
      else if (e.key === 'ArrowDown') h -= STEP;
      else if (e.key === 'Enter' || e.key === ' ') { setMaximized_(!isMaximized); changed = false; }
      else { changed = false; }
      if (!changed) return;
      e.preventDefault();
      if (isMaximized) setMaximized_(false, { skipStorage: true });
      w = clamp_(w, DESKTOP_MIN_W, desktopMaxW());
      h = clamp_(h, DESKTOP_MIN_H, desktopMaxH());
      panel.style.maxWidth = 'none';
      panel.style.maxHeight = 'none';
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      writeSizePref_({ w: Math.round(w), h: Math.round(h), maximized: false });
    });
  }

  // Grabber (mobile): drag adjusts the sheet's height; dragging it down
  // past a threshold dismisses the panel instead of leaving a sliver,
  // matching the familiar bottom-sheet "swipe to close" gesture.
  if (grabber) {
    let dragging = false, startY = 0, startH = 0;

    grabber.addEventListener('pointerdown', e => {
      if (!(MOBILE_QUERY && MOBILE_QUERY.matches)) return;
      dragging = true;
      startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      panel.classList.add('is-resizing');
      document.body.classList.add('support-resizing-y');
      grabber.setPointerCapture(e.pointerId);
    });
    grabber.addEventListener('pointermove', e => {
      if (!dragging) return;
      const h = startH + (startY - e.clientY);
      panel.style.height = clamp_(h, 140, mobileMaxH()) + 'px'; // allowed to go small here so the close-threshold check below can see it
    });
    function endGrabberDrag(e) {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('is-resizing');
      document.body.classList.remove('support-resizing-y');
      const h = panel.getBoundingClientRect().height;
      if (h < MOBILE_MIN_H * 0.55) {
        panel.style.height = '';
        closePanel();
      } else {
        const clamped = clamp_(h, MOBILE_MIN_H, mobileMaxH());
        panel.style.height = clamped + 'px';
        writeSizePref_({ mobileH: Math.round(clamped) });
      }
      if (e && e.pointerId != null && grabber.hasPointerCapture && grabber.hasPointerCapture(e.pointerId)) {
        grabber.releasePointerCapture(e.pointerId);
      }
    }
    grabber.addEventListener('pointerup', endGrabberDrag);
    grabber.addEventListener('pointercancel', endGrabberDrag);
    grabber.addEventListener('dblclick', resetSize_);

    grabber.addEventListener('keydown', e => {
      if (!(MOBILE_QUERY && MOBILE_QUERY.matches)) return;
      const STEP = 32;
      let h = panel.getBoundingClientRect().height, changed = true;
      if (e.key === 'ArrowUp') h += STEP;
      else if (e.key === 'ArrowDown') h -= STEP;
      else if (e.key === 'Home') h = MOBILE_MIN_H;
      else if (e.key === 'End') h = mobileMaxH();
      else { changed = false; }
      if (!changed) return;
      e.preventDefault();
      h = clamp_(h, MOBILE_MIN_H, mobileMaxH());
      panel.style.height = h + 'px';
      writeSizePref_({ mobileH: Math.round(h) });
    });
  }

  // Keep the panel from getting stranded off-screen (or absurdly large)
  // if the window is resized, or the phone rotates, while it's open.
  window.addEventListener('resize', () => {
    if (!isOpen) return;
    if (MOBILE_QUERY && MOBILE_QUERY.matches) {
      if (panel.style.height) panel.style.height = clamp_(parseFloat(panel.style.height), MOBILE_MIN_H, mobileMaxH()) + 'px';
    } else {
      if (isMaximized) return; // the .is-maximized CSS rule already tracks the viewport on its own
      if (panel.style.width) panel.style.width = clamp_(parseFloat(panel.style.width), DESKTOP_MIN_W, desktopMaxW()) + 'px';
      if (panel.style.height) panel.style.height = clamp_(parseFloat(panel.style.height), DESKTOP_MIN_H, desktopMaxH()) + 'px';
    }
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

  // ---- attachment: staging, validation, client-side image compression ----
  // Three categories, each with its own size cap — kept in sync with
  // apps-script-support.gs's ALLOWED_*_MIME_TYPES / MAX_*_BYTES. Images
  // get compressed client-side (see compressImage_); videos and
  // documents can't be shrunk in the browser, so they're just checked
  // against their cap directly and rejected if over.
  const ATTACH_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ATTACH_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
  const ATTACH_DOC_TYPES = [
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ];
  const ATTACH_ALLOWED_TYPES = ATTACH_IMAGE_TYPES.concat(ATTACH_VIDEO_TYPES, ATTACH_DOC_TYPES);

  const ATTACH_MAX_BYTES_IMAGE = C.support.attachMaxBytesImage || 3500000;
  const ATTACH_MAX_BYTES_VIDEO = C.support.attachMaxBytesVideo || 15000000;
  const ATTACH_MAX_BYTES_DOC = C.support.attachMaxBytesDoc || 8000000;
  const ATTACH_MAX_DIMENSION = C.support.attachMaxDimension || 1440;
  // How many files one message can carry, and a combined-size ceiling on
  // top of the per-file caps above — both must stay in sync with
  // apps-script-support.gs's MAX_ATTACHMENTS_PER_MESSAGE /
  // MAX_TOTAL_ATTACHMENT_BYTES. This is purely a fast, friendly
  // client-side check: the server enforces the same limits itself and
  // never trusts this one, since a request can always be sent by
  // something other than this exact script.
  const ATTACH_MAX_COUNT = C.support.attachMaxCount || 4;
  const ATTACH_MAX_VIDEOS = C.support.attachMaxVideos || 1;
  const ATTACH_MAX_BYTES_TOTAL = C.support.attachMaxBytesTotal || 20000000;

  function categoryForType_(mimeType) {
    if (ATTACH_IMAGE_TYPES.indexOf(mimeType) !== -1) return 'image';
    if (ATTACH_VIDEO_TYPES.indexOf(mimeType) !== -1) return 'video';
    if (ATTACH_DOC_TYPES.indexOf(mimeType) !== -1) return 'file';
    return null;
  }

  function pendingBytesTotal_() {
    return pendingAttachments.reduce((sum, a) => sum + a.blob.size, 0);
  }
  function pendingVideoCount_() {
    return pendingAttachments.reduce((n, a) => n + (a.kind === 'video' ? 1 : 0), 0);
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) stageFiles_(fileInput.files);
    fileInput.value = ''; // so picking the exact same file(s) again still fires 'change'
  });

  // Paste image(s) directly into the message box. Only images (not
  // video/documents) are wired up for paste — that's the one clipboard
  // interaction browsers actually support well, and it matches what
  // people expect from pasting a screenshot. A paste can carry more than
  // one image (e.g. copying several files from a file manager), so every
  // image item is collected and staged together as one batch.
  input.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && ATTACH_IMAGE_TYPES.indexOf(items[i].type) !== -1) {
        files.push(items[i].getAsFile());
      }
    }
    if (files.length) {
      e.preventDefault(); // don't also drop garbage image bytes into the text
      stageFiles_(files);
    }
  });

  // Drag-and-drop anywhere on the open panel — dropping a multi-file
  // selection stages all of them as one batch (subject to the same
  // count/size checks as picking them from the file dialog).
  let dragDepth = 0; // dragenter/dragleave can nest over child elements — count them so leave doesn't fire early
  panel.addEventListener('dragenter', e => {
    if (!hasFilesInDrag_(e)) return;
    e.preventDefault();
    dragDepth++;
    panel.classList.add('support-panel-dragging');
  });
  panel.addEventListener('dragover', e => {
    if (!hasFilesInDrag_(e)) return;
    e.preventDefault(); // required to allow a drop at all
  });
  panel.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) panel.classList.remove('support-panel-dragging');
  });
  panel.addEventListener('drop', e => {
    if (!hasFilesInDrag_(e)) return;
    e.preventDefault();
    dragDepth = 0;
    panel.classList.remove('support-panel-dragging');
    if (e.dataTransfer.files && e.dataTransfer.files.length) stageFiles_(e.dataTransfer.files);
  });

  function hasFilesInDrag_(e) {
    return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;
  }

  // Stages a batch of files (from the picker, a drop, or a multi-image
  // paste) as new pending attachments, on top of whatever's already
  // staged. Enforces the per-message count/video/combined-size caps up
  // front — before any file is read or compressed — and, if the batch
  // would push past a cap, stages as many as still fit and reports a
  // single short error for the rest rather than silently dropping them
  // or accepting an unbounded pile of files.
  function stageFiles_(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const availableSlots = ATTACH_MAX_COUNT - pendingAttachments.length;
    if (availableSlots <= 0) {
      statusEl.className = 'status-msg support-status error';
      statusEl.textContent = attachErrorTooMany_();
      return;
    }

    const toProcess = incoming.slice(0, availableSlots);
    const overflow = incoming.length - toProcess.length;

    let runningBytes = pendingBytesTotal_();
    let runningVideos = pendingVideoCount_();
    let skippedForLimits = 0;

    // Validate/stage sequentially (rather than in parallel) so the
    // running byte/video totals used for the combined-size and
    // one-video caps are checked against every file staged so far,
    // including ones earlier in this same batch — not just what was
    // already pending before this call started.
    let chain = Promise.resolve();
    toProcess.forEach(file => {
      chain = chain.then(() => {
        const category = categoryForType_(file.type);
        if (!category) {
          statusEl.className = 'status-msg support-status error';
          statusEl.textContent = C.support.errorAttachType;
          skippedForLimits++;
          return;
        }
        if (category === 'video' && runningVideos + 1 > ATTACH_MAX_VIDEOS) {
          statusEl.className = 'status-msg support-status error';
          statusEl.textContent = C.support.errorAttachTooManyVideos || ('Only ' + ATTACH_MAX_VIDEOS + ' video per message, please.');
          skippedForLimits++;
          return;
        }

        if (category === 'image') {
          // Sanity cap on the ORIGINAL file before decode/draw — an
          // absurdly large source image (e.g. a 100MP photo) is still
          // expensive to load into a canvas even though the compressed
          // OUTPUT would be small. 25MB is generous for any real
          // phone/camera photo.
          if (file.size > 25 * 1024 * 1024) {
            statusEl.className = 'status-msg support-status error';
            statusEl.textContent = C.support.errorAttachTooLarge;
            skippedForLimits++;
            return;
          }
          return compressImage_(file).then(result => {
            if (runningBytes + result.blob.size > ATTACH_MAX_BYTES_TOTAL) {
              statusEl.className = 'status-msg support-status error';
              statusEl.textContent = attachErrorTooLargeCombined_();
              skippedForLimits++;
              return;
            }
            runningBytes += result.blob.size;
            addAttachment_(result.blob, result.mimeType, 'image', file.name);
          }).catch(() => {
            statusEl.className = 'status-msg support-status error';
            statusEl.textContent = C.support.errorAttachGeneric;
            skippedForLimits++;
          });
        }

        // Video and documents can't be shrunk client-side the way images
        // can, so they're just checked directly against their category's
        // cap and either staged as-is or rejected — nothing about the
        // file is read, decoded, or transformed until the buyer actually
        // hits send.
        const maxBytes = category === 'video' ? ATTACH_MAX_BYTES_VIDEO : ATTACH_MAX_BYTES_DOC;
        if (file.size > maxBytes) {
          statusEl.className = 'status-msg support-status error';
          statusEl.textContent = category === 'video' ? C.support.errorAttachTooLargeVideo : C.support.errorAttachTooLargeDoc;
          skippedForLimits++;
          return;
        }
        if (runningBytes + file.size > ATTACH_MAX_BYTES_TOTAL) {
          statusEl.className = 'status-msg support-status error';
          statusEl.textContent = attachErrorTooLargeCombined_();
          skippedForLimits++;
          return;
        }
        runningBytes += file.size;
        if (category === 'video') runningVideos++;
        addAttachment_(file, file.type, category, file.name);
      });
    });

    chain.then(() => {
      // A clean, successful batch (nothing skipped, nothing left over
      // from the count cap) clears any earlier error rather than leaving
      // a stale one on screen.
      if (overflow > 0) {
        statusEl.className = 'status-msg support-status error';
        statusEl.textContent = attachErrorTooMany_();
      } else if (!skippedForLimits) {
        statusEl.textContent = '';
      }
    });
  }

  function attachErrorTooMany_() {
    return (C.support.errorAttachTooMany || 'You can attach up to {max} files per message.').replace('{max}', ATTACH_MAX_COUNT);
  }
  function attachErrorTooLargeCombined_() {
    return (C.support.errorAttachTooLargeCombined || 'Those files are too large combined (max ~{max}MB total per message).').replace('{max}', Math.floor(ATTACH_MAX_BYTES_TOTAL / 1e6));
  }

  // Resizes to ATTACH_MAX_DIMENSION on the longest side and re-encodes as
  // JPEG. This is what keeps a typical phone screenshot/photo (often
  // several MB) well under ATTACH_MAX_BYTES / the server's decoded cap —
  // shrinking client-side means the upload is faster for the buyer AND
  // cheaper (bytes, execution time) for the Apps Script backend that
  // relays it. Always outputting JPEG keeps this simple and predictable;
  // transparency (rare for a support screenshot) is flattened to white.
  function compressImage_(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        if (width <= 0 || height <= 0) { reject(new Error('bad image')); return; }
        const scale = Math.min(1, ATTACH_MAX_DIMENSION / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // flatten any transparency onto white before JPEG encoding
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('encode failed')); return; }
          if (blob.size > ATTACH_MAX_BYTES_IMAGE) {
            reject(new Error('too large even after compression'));
            return;
          }
          resolve({ blob, mimeType: 'image/jpeg' });
        }, 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('decode failed')); };
      img.src = objectUrl;
    });
  }

  // Only image/video are things a browser can render straight from an
  // object URL; a generic document just shows its name instead.
  function addAttachment_(blob, mimeType, kind, fileName) {
    const previewUrl = (kind === 'image' || kind === 'video') ? URL.createObjectURL(blob) : null;
    pendingAttachments.push({ blob, mimeType, previewUrl, kind, fileName: fileName || 'attachment' });
    renderAttachmentChips_();
    input.focus();
  }

  function removeAttachmentAt_(index) {
    const att = pendingAttachments[index];
    if (!att) return;
    if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    pendingAttachments.splice(index, 1);
    renderAttachmentChips_();
  }

  function clearAttachments_() {
    pendingAttachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
    pendingAttachments = [];
    renderAttachmentChips_();
  }

  // Rebuilds the staged-attachment preview row from scratch to match
  // pendingAttachments — simple and cheap enough given how rarely this
  // runs (a handful of adds/removes before hitting send, never on every
  // keystroke). Every filename is set via textContent, never innerHTML,
  // so a maliciously-named file can't inject markup into the composer.
  function renderAttachmentChips_() {
    attachPreview.innerHTML = '';
    attachPreview.hidden = pendingAttachments.length === 0;

    pendingAttachments.forEach((att, i) => {
      const chip = document.createElement('div');
      chip.className = 'support-attach-chip';

      if (att.kind === 'image') {
        const img = document.createElement('img');
        img.src = att.previewUrl;
        img.alt = 'Image attached to your message';
        chip.appendChild(img);
      } else if (att.kind === 'video') {
        const video = document.createElement('video');
        video.className = 'support-attach-preview-video';
        video.src = att.previewUrl;
        video.muted = true;
        video.playsInline = true;
        chip.appendChild(video);
      } else {
        const fileChip = document.createElement('span');
        fileChip.className = 'support-attach-chip-file';
        const icon = document.createElement('span');
        icon.className = 'support-attach-file-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '📎';
        const name = document.createElement('span');
        name.className = 'support-attach-file-name';
        name.textContent = att.fileName;
        fileChip.appendChild(icon);
        fileChip.appendChild(name);
        chip.appendChild(fileChip);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'support-attach-remove';
      removeBtn.setAttribute('aria-label', ((C.support.attachRemoveLabel || 'Remove attachment') + ': ' + att.fileName));
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      removeBtn.addEventListener('click', () => removeAttachmentAt_(i));
      chip.appendChild(removeBtn);

      attachPreview.appendChild(chip);
    });
  }

  function blobToBase64_(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ---- emoji picker ----
  // Built once from config.js -> support.emojis. Inserting at the
  // textarea's actual cursor position (not just appending) so it behaves
  // the same whether someone's mid-sentence or starting fresh — matters
  // most on desktop where people click back into the middle of what
  // they've typed.
  let emojiOpen = false;
  if (emojiBtn && emojiPopover && C.support.emojis && C.support.emojis.length) {
    C.support.emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'support-emoji-option';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = emoji;
      // mousedown (not click) so the textarea never loses focus/selection
      // first — on a touch device this still fires fine on tap.
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => insertEmoji_(emoji));
      emojiPopover.appendChild(btn);
    });

    emojiBtn.addEventListener('click', () => { emojiOpen ? closeEmoji_() : openEmoji_(); });
    document.addEventListener('pointerdown', e => {
      if (!emojiOpen) return;
      if (emojiPopover.contains(e.target) || emojiBtn.contains(e.target)) return;
      closeEmoji_();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && emojiOpen) { closeEmoji_(); emojiBtn.focus(); }
    });
  }

  function openEmoji_() {
    emojiOpen = true;
    emojiPopover.hidden = false;
    emojiBtn.setAttribute('aria-expanded', 'true');
  }
  function closeEmoji_() {
    emojiOpen = false;
    emojiPopover.hidden = true;
    emojiBtn.setAttribute('aria-expanded', 'false');
  }
  function insertEmoji_(emoji) {
    const start = input.selectionStart != null ? input.selectionStart : input.value.length;
    const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const caret = start + emoji.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    autoGrow_();
    updateCharCount_();
    // Stay open on desktop (mouse users often drop in a few in a row);
    // close after picking on touch, where the popover eats more of the
    // limited screen and a second tap to reopen costs little.
    if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) closeEmoji_();
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
    const attachments = pendingAttachments; // snapshot — clearAttachments_ below would otherwise revoke these URLs out from under us
    if (!text && !attachments.length) return;
    if (text.length > CHAR_LIMIT) {
      statusEl.className = 'status-msg support-status error';
      statusEl.textContent = C.support.errorTooLong;
      return;
    }

    sending = true;
    sendBtn.disabled = true;
    attachBtn.disabled = true;
    sendBtn.classList.add('support-send-busy');
    sendBtn.setAttribute('aria-label', C.support.sendingLabel || 'Sending…');
    statusEl.className = 'status-msg support-status';
    statusEl.textContent = '';

    // Optimistic append so sending feels instant; if the request turns
    // out to have failed, that optimistic bubble is removed again below.
    // Each attachment's url here is the buyer's own blob (compressed, for
    // images), shown purely client-side — the server never echoes
    // attachment bytes back (see apps-script-support.gs), so this is the
    // only place this preview ever comes from, including for the bubble
    // that stays on screen after a successful send. Documents have no
    // url (nothing to render inline), so they just carry a name.
    const optimisticAttachments = attachments.map(a => ({ kind: a.kind, url: a.previewUrl, name: a.fileName }));
    const optimistic = {
      id: 'pending-' + Date.now(),
      sender: 'user',
      text: text,
      createdAt: new Date().toISOString(),
      attachments: optimisticAttachments
    };
    messages.push(optimistic);
    renderMessages_();
    input.value = '';
    autoGrow_();
    updateCharCount_();
    if (attachments.length) { pendingAttachments = []; renderAttachmentChips_(); } // detach without revoking — optimistic bubble owns the URLs now

    let payload = { text: text };
    if (attachments.length) {
      try {
        const encoded = await Promise.all(attachments.map(async a => ({
          data: await blobToBase64_(a.blob), mimeType: a.mimeType, fileName: a.fileName
        })));
        payload.attachments = encoded;
      } catch (err) {
        attachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
        messages = messages.filter(m => m !== optimistic);
        renderMessages_();
        sending = false;
        sendBtn.disabled = false;
        attachBtn.disabled = false;
        sendBtn.classList.remove('support-send-busy');
        statusEl.className = 'status-msg support-status error';
        statusEl.textContent = C.support.errorAttachGeneric;
        return;
      }
    }

    const data = await callApi('send', payload);

    sending = false;
    sendBtn.disabled = false;
    attachBtn.disabled = false;
    sendBtn.classList.remove('support-send-busy');
    sendBtn.setAttribute('aria-label', C.support.sendLabel || 'Send message');

    if (data.ok && data.message) {
      const idx = messages.indexOf(optimistic);
      if (idx !== -1) messages.splice(idx, 1); // drop the optimistic placeholder
      // Carry the local attachment previews over onto the server's
      // message record — the server itself never returns attachment bytes.
      if (attachments.length) {
        data.message.attachments = optimisticAttachments;
      }
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
      attachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
      messages = messages.filter(m => m !== optimistic);
      renderMessages_();
      statusEl.className = 'status-msg support-status error';
      statusEl.textContent = data.error || C.support.errorGeneric;
      input.value = text; // hand the text back so nothing typed is lost
      // Give the attachments back too — re-add without re-compressing or
      // re-checking caps, since these already passed staging once.
      attachments.forEach(a => addAttachment_(a.blob, a.mimeType, a.kind, a.fileName));
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
    clearAttachments_(); // don't carry staged attachments over to whoever logs in next on a shared computer
    if (emojiBtn) closeEmoji_();
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
