// Renders every static text block from window.SITE_CONFIG into the page.
// Dynamic/repeating pieces (gallery cards, feelings wheel, story chapters,
// checkout wiring) are handled in main.js / story.js — this file just
// fills in headings, paragraphs, and one-off buttons.
(function () {
  const C = window.SITE_CONFIG;
  if (!C) { console.error('render.js: window.SITE_CONFIG not found — make sure config.js loads first.'); return; }

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  // ---- brand / nav ----
  set('navBrandName', C.brand.name);
  const navLinks = document.getElementById('navLinks');
  C.nav.links.forEach(l => {
    const a = document.createElement('a');
    a.className = 'nav-link';
    a.href = l.href;
    a.textContent = l.label;
    navLinks.appendChild(a);
  });
  set('navCta', C.nav.ctaLabel);
  document.getElementById('navCta').href = C.nav.ctaHref;

  // ---- hero ----
  set('heroEyebrow', C.hero.eyebrow);
  setHtml('heroHeading', `${C.hero.headingLine1}<br>${C.hero.headingRest.replace('{hl}', `<span class="hl">${C.hero.headingHighlight}</span>`)}`);
  set('heroSub', C.hero.sub);
  setHtml('heroBuyBtn', `${C.hero.buyLabel} <span class="price-tag">${C.hero.price}</span>`);
  set('heroGhostBtn', C.hero.ghostLabel);
  document.getElementById('heroGhostBtn').href = C.hero.ghostHref;
  setHtml('heroNote', `<a href="${C.hero.noteHref}">${C.hero.noteText}</a>`);

  // ---- story section head ----
  set('storyEyebrow', C.story.eyebrow);
  setHtml('storyHeading', C.story.heading);
  setHtml('storyLede', C.story.lede.replace('{icon}', '<span class="story-lede-icon" aria-hidden="true">⤢</span>'));
  set('storySkip', C.story.skipLabel);
  document.getElementById('storySkip').href = C.story.skipHref;

  // ---- gallery head ----
  set('galleryHeading', C.gallery.heading);
  set('gallerySub', C.gallery.sub);
  setHtml('galleryMore', C.gallery.moreTextHtml);

  // ---- feelings wheel head ----
  set('wheelEyebrow', C.feelingsWheel.eyebrow);
  set('wheelHeading', C.feelingsWheel.heading);
  set('wheelSub', C.feelingsWheel.sub);
  set('wheelHint', C.feelingsWheel.hintText);
  document.querySelector('#wheelHub .hub-num').textContent = C.feelingsWheel.totalCount;
  document.querySelector('#wheelHub .hub-label').textContent = C.feelingsWheel.totalLabel;

  // ---- about strip ----
  const aboutGrid = document.getElementById('aboutGrid');
  C.about.items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'reveal';
    div.innerHTML = `<div class="icon ${item.iconClass}">${item.icon}</div><h3>${item.title}</h3><p>${item.text}</p>`;
    aboutGrid.appendChild(div);
  });

  // ---- FAQ ----
  set('faqHeading', C.faq.heading);
  const faqGrid = document.getElementById('faqGrid');
  C.faq.items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'reveal';
    div.innerHTML = `<h3>${item.q}</h3><p>${item.a}</p>`;
    faqGrid.appendChild(div);
  });

  // ---- account / auth modal / orders modal ----
  // navAccountBtn's actual label (email vs. "Sign in") is set live by
  // account.js once it knows whether a session exists — this just seeds
  // the logged-out default so there's no flash of empty text before JS runs.
  set('navAccountBtn', C.account.signedOutLabel);
  set('navMyOrdersBtn', C.account.myOrdersLabel);
  set('navLogoutBtn', C.account.logoutLabel);

  set('authTabLogin', C.account.loginButtonLabel);
  set('authTabSignup', C.account.signupButtonLabel);
  set('authDividerText', C.account.authDividerText);

  set('authLoginTitle', C.account.loginTitle);
  set('authLoginSub', C.account.loginSub);
  document.getElementById('loginEmail').placeholder = C.account.emailPlaceholder;
  document.getElementById('loginPassword').placeholder = C.account.passwordPlaceholder;
  set('loginSubmitBtn', C.account.loginButtonLabel);
  set('switchToSignupText', C.account.switchToSignupText);
  set('switchToSignupLink', C.account.switchToSignupLink);
  set('resendVerificationBtn', C.account.resendLabel);

  set('authSignupTitle', C.account.signupTitle);
  set('authSignupSub', C.account.signupSub);
  document.getElementById('signupEmail').placeholder = C.account.emailPlaceholder;
  document.getElementById('signupPassword').placeholder = C.account.passwordPlaceholder;
  set('signupSubmitBtn', C.account.signupButtonLabel);
  set('switchToLoginText', C.account.switchToLoginText);
  set('switchToLoginLink', C.account.switchToLoginLink);

  set('ordersHeading', C.account.ordersHeading);

  // ---- checkout ----
  set('checkoutHeading', C.checkout.heading);
  setHtml('checkoutFormatNote', C.checkout.formatNoteHtml);
  set('checkoutLoggedOutNote', C.account.checkoutLoggedOutNote);
  set('checkoutSignInBtn', C.account.checkoutSignInButtonLabel);
  set('payBtn', C.checkout.payButtonLabel);
  const coinRow = document.getElementById('coinRow');
  C.checkout.coins.forEach(coin => {
    const span = document.createElement('span');
    span.className = 'coin-pill';
    span.textContent = coin;
    coinRow.appendChild(span);
  });
  set('fallbackNote', C.checkout.fallbackNoteDefault);

  // ---- footer ----
  setHtml('footerDelivery', C.footer.deliveryTextHtml.replace('{email}', C.footer.supportEmail));
  set('footerNote', C.footer.note);
})();
