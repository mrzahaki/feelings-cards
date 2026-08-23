  const C = window.SITE_CONFIG;

  // ---- Page-visit ping (config.js -> analytics) ----
  // Fire-and-forget: never awaited, and any failure is swallowed, so a
  // blocked/slow/failed ping can never delay or break the page for a real
  // visitor. Feeds the "👀 Page visits" figure in the Telegram bot's
  // /stats panel (see apps-script-support.gs's handlePageview_). Sent once
  // per page load — this is a visit counter, not a per-visitor tracker: it
  // carries no cookie, id, or fingerprint of any kind.
  if (C.analytics && C.analytics.enabled && C.analytics.endpoint) {
    fetch(C.analytics.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight, same reasoning as the checkout call below
      body: JSON.stringify({ action: 'pageview' })
    }).catch(() => {});
  }

  // ---- Gallery grid + lightbox (cards come from config.js -> gallery.cards) ----
  const cards = C.gallery.cards;

  const grid = document.getElementById('cardGrid');
  cards.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'card-thumb';
    btn.setAttribute('aria-label', 'Zoom in on ' + c.names);
    btn.dataset.index = i;
    btn.innerHTML = `
      <img src="images/grid/card-${c.id}.jpg" alt="${c.names} preview card" loading="lazy">
      <span class="zoom-hint" aria-hidden="true">🔍</span>
    `;
    grid.appendChild(btn);
  });

  // Lightbox logic
  const lightbox = document.getElementById('lightbox');
  const lbImg = document.getElementById('lbImg');
  const lbCaption = document.getElementById('lbCaption');
  let current = 0;

  function openLightbox(i){
    current = i;
    updateLightbox();
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('lbClose').focus();
  }
  function updateLightbox(){
    const c = cards[current];
    lbImg.src = `images/zoom/card-${c.id}.jpg`;
    lbImg.alt = c.names + ' — full card preview';
    lbCaption.textContent = c.names;
  }
  function closeLightbox(){
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  grid.addEventListener('click', e => {
    const btn = e.target.closest('.card-thumb');
    if(!btn) return;
    openLightbox(parseInt(btn.dataset.index, 10));
  });

  document.getElementById('lbClose').addEventListener('click', closeLightbox);
  document.getElementById('lbPrev').addEventListener('click', () => { current = (current - 1 + cards.length) % cards.length; updateLightbox(); });
  document.getElementById('lbNext').addEventListener('click', () => { current = (current + 1) % cards.length; updateLightbox(); });
  lightbox.addEventListener('click', e => { if(e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if(!lightbox.classList.contains('open')) return;
    if(e.key === 'Escape') closeLightbox();
    if(e.key === 'ArrowLeft') { current = (current - 1 + cards.length) % cards.length; updateLightbox(); }
    if(e.key === 'ArrowRight') { current = (current + 1) % cards.length; updateLightbox(); }
  });

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal, .card-thumb');
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach(el => io.observe(el));

  // ---- Feelings wheel (families come from config.js -> feelingsWheel.families) ----
  const feelingFamilies = C.feelingsWheel.families;

  const wheelRing = document.getElementById('wheelRing');
  const wheelHub = document.getElementById('wheelHub');
  const wheelDetail = document.getElementById('wheelDetail');

  feelingFamilies.forEach((f, i) => {
    const petal = document.createElement('button');
    petal.type = 'button';
    petal.className = 'petal';
    petal.style.setProperty('--i', i);
    petal.style.background = f.color;
    petal.dataset.key = f.key;
    petal.setAttribute('aria-label', f.name + ' — ' + f.count + ' of ' + C.feelingsWheel.totalCount + ' cards');
    petal.innerHTML = `<span class="petal-icon" aria-hidden="true">${f.icon}</span><span>${f.name.split(' ')[0]}</span>`;
    petal.addEventListener('click', () => selectFamily(f, petal));
    wheelRing.appendChild(petal);
  });

  function selectFamily(f, petal){
    wheelRing.classList.add('touched');
    document.querySelectorAll('.petal').forEach(p => p.classList.remove('active'));
    petal.classList.add('active');

    wheelHub.innerHTML = `
      <span class="hub-icon" aria-hidden="true">${f.icon}</span>
      <span class="hub-num">${f.count}</span>
      <span class="hub-label">cards</span>`;

    wheelDetail.innerHTML = `
      <div class="detail-card" style="border-top-color:${f.color};">
        <div class="detail-top">
          <span class="detail-icon" aria-hidden="true">${f.icon}</span>
          <div>
            <h3>${f.name}</h3>
            <span class="detail-count">${f.count} of ${C.feelingsWheel.totalCount} cards</span>
          </div>
        </div>
        <p class="detail-blurb">${f.blurb}</p>
        <div class="chip-row">
          ${f.words.map(w => `<span class="chip" style="background:${f.color}66;">${w}</span>`).join('')}
        </div>
      </div>`;
  }

  // ---- Checkout: create a fresh invoice per click, embed it inline ----
  // Endpoint + copy come from config.js -> checkout. As of v3 this requires
  // a logged-in account (account.js) — the buyer's email now comes from
  // their session server-side, not a free-text field on this page.
  const CREATE_INVOICE_ENDPOINT = C.checkout.invoiceEndpoint;
  const payBtn = document.getElementById('payBtn');
  const payStatus = document.getElementById('payStatus');
  const widgetFrame = document.getElementById('widgetFrame');
  const fallbackNote = document.getElementById('fallbackNote');

  payBtn.addEventListener('click', async () => {
    if (!window.Account || !Account.isLoggedIn()) {
      payStatus.className = 'status-msg error';
      payStatus.textContent = 'Please sign in first.';
      return;
    }
    const sessionToken = Account.getToken();

    payBtn.disabled = true;
    payBtn.textContent = 'Fetching checkout…';
    payStatus.className = 'status-msg';
    payStatus.textContent = '';
    widgetFrame.classList.remove('active');
    widgetFrame.innerHTML = '';

    try {
      const resp = await fetch(CREATE_INVOICE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
        body: JSON.stringify({ sessionToken: sessionToken })
      });
      const data = await resp.json();

      if (data.ok && data.id) {
        // Embed the checkout inline using the fresh invoice's id — same
        // embed pattern as the old static widget, just with a dynamic iid.
        widgetFrame.innerHTML =
          '<iframe src="https://nowpayments.io/embeds/payment-widget?iid=' + encodeURIComponent(data.id) + '" ' +
          'width="410" height="696" frameborder="0" scrolling="no" title="NOWPayments checkout">Can\'t load widget</iframe>';
        widgetFrame.classList.add('active');
        payBtn.style.display = 'none';
        payStatus.textContent = 'Complete payment below. Your PDFs will be sent to ' + (data.email || Account.getEmail()) + ' once it confirms.';
        fallbackNote.innerHTML = 'Widget not loading? <a href="' + data.invoice_url + '" target="_blank" rel="noreferrer noopener">Open checkout in a new tab instead</a>.';
        widgetFrame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        payStatus.className = 'status-msg error';
        payStatus.textContent = data.error || "Couldn't start checkout — please try again in a moment.";
        payBtn.disabled = false;
        payBtn.textContent = C.checkout.payButtonLabel;
      }
    } catch (err) {
      payStatus.className = 'status-msg error';
      payStatus.textContent = 'Network error — please try again in a moment.';
    } finally {
      payBtn.disabled = false;
      payBtn.textContent = C.checkout.payButtonLabel;
    }
  });

  // If login state changes (logs out, or a stored session turns out to be
  // expired) reset any in-progress checkout UI so it doesn't show a stale
  // "complete payment" iframe tied to the previous account.
  if (window.Account) {
    Account.onChange(() => {
      widgetFrame.classList.remove('active');
      widgetFrame.innerHTML = '';
      payBtn.style.display = '';
      payBtn.disabled = false;
      payBtn.textContent = C.checkout.payButtonLabel;
      payStatus.textContent = '';
      fallbackNote.textContent = C.checkout.fallbackNoteDefault;
    });
  }
