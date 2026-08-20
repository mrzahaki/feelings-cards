  // ---- Our Story: illustrated storybook ----
  (function(){
    const stage = document.getElementById('storyStage');
    if(!stage) return;

    const C = window.SITE_CONFIG;
    const chapters = (C && C.story && C.story.chapters) || [];

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function rand(min, max){ return min + Math.random() * (max - min); }

    // ---- build the chapter <article> scenes + nav dots from config ----
    // (this used to be hand-written HTML in index.html; now it's generic
    // over however many chapters config.js -> story.chapters defines)
    const dotsContainer = document.getElementById('storyDots');
    chapters.forEach((ch, i) => {
      const article = document.createElement('article');
      article.className = 'scene scene--' + (i + 1) + (i === 0 ? ' is-active' : '');
      article.dataset.scene = String(i + 1);
      article.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');

      const illustration = document.createElement('div');
      illustration.className = 'scene-illustration';
      const photo = document.createElement('div');
      photo.className = 'scene-photo';
      photo.dataset.bg = ch.image;
      photo.setAttribute('role', 'img');
      photo.setAttribute('aria-label', ch.imageAlt || '');
      illustration.appendChild(photo);
      article.appendChild(illustration);

      const ambient = document.createElement('div');
      ambient.className = 'story-ambient';
      ambient.setAttribute('data-ambient', '');
      ambient.setAttribute('aria-hidden', 'true');
      article.appendChild(ambient);

      if(ch.rays){
        const rays = document.createElement('div');
        rays.className = 'rays';
        rays.innerHTML =
          '<span class="story-ray" style="left:14%; transform:rotate(12deg);"></span>' +
          '<span class="story-ray" style="left:46%; transform:rotate(-6deg);"></span>' +
          '<span class="story-ray" style="left:78%; transform:rotate(16deg);"></span>';
        article.appendChild(rays);
      }

      (ch.weather || []).forEach(kind => {
        const w = document.createElement('div');
        w.className = 'weather';
        w.setAttribute('data-weather', kind);
        article.appendChild(w);
      });

      const copy = document.createElement('div');
      copy.className = 'scene-copy';
      copy.innerHTML =
        '<span class="scene-count">Chapter ' + (i + 1) + ' of ' + chapters.length + '</span>' +
        '<h3 class="scene-title"></h3>' +
        '<p class="scene-text"></p>';
      copy.querySelector('.scene-title').textContent = ch.title;
      copy.querySelector('.scene-text').innerHTML = ch.text;
      article.appendChild(copy);

      stage.appendChild(article);

      if(dotsContainer){
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'story-seg' + (i === 0 ? ' active' : '');
        seg.setAttribute('role', 'tab');
        seg.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
        seg.setAttribute('aria-label', 'Chapter ' + (i + 1) + ': ' + ch.title);
        dotsContainer.appendChild(seg);
      }
    });

    const frameEl = document.getElementById('storyFrame');
    if(frameEl) frameEl.setAttribute('aria-label', 'Our story, ' + chapters.length + ' chapters');

    function spawnRain(container, count){
      if(prefersReduced) return;
      for(let i = 0; i < count; i++){
        const d = document.createElement('span');
        d.className = 'story-drop';
        d.style.left = rand(2, 96) + '%';
        d.style.animationDuration = rand(0.9, 1.7).toFixed(2) + 's';
        d.style.animationDelay = '-' + rand(0, 1.7).toFixed(2) + 's';
        container.appendChild(d);
      }
    }
    function spawnStars(container, count){
      for(let i = 0; i < count; i++){
        const s = document.createElement('span');
        s.className = 'story-star';
        s.style.left = rand(4, 96) + '%';
        s.style.top = rand(4, 42) + '%';
        if(prefersReduced){
          s.style.opacity = '.7';
        } else {
          s.style.animationDuration = rand(1.8, 3.4).toFixed(2) + 's';
          s.style.animationDelay = '-' + rand(0, 3).toFixed(2) + 's';
        }
        container.appendChild(s);
      }
    }
    function spawnMotes(container, count){
      for(let i = 0; i < count; i++){
        const m = document.createElement('span');
        m.className = 'story-mote';
        m.style.left = rand(8, 92) + '%';
        m.style.top = rand(26, 74) + '%';
        if(prefersReduced){
          m.style.opacity = '.8';
        } else {
          m.style.animationDuration = rand(2.4, 4).toFixed(2) + 's';
          m.style.animationDelay = '-' + rand(0, 4).toFixed(2) + 's';
        }
        container.appendChild(m);
      }
    }
    function spawnHearts(container, count){
      if(prefersReduced) return;
      for(let i = 0; i < count; i++){
        const h = document.createElement('span');
        h.className = 'story-heart';
        h.style.left = rand(28, 68) + '%';
        h.style.animationDuration = rand(3, 4.6).toFixed(2) + 's';
        h.style.animationDelay = '-' + rand(0, 4.6).toFixed(2) + 's';
        h.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.2C.6 8.6 2.2 5 6 5c2 0 3.4 1 4 2.4C10.6 6 12 5 14 5c3.8 0 5.4 3.6 4 6.8-2.5 4.6-10 9.2-10 9.2z" fill="#F3AB8B"/></svg>';
        container.appendChild(h);
      }
    }

    stage.querySelectorAll('.weather[data-weather]').forEach(el => {
      const kind = el.dataset.weather;
      if(kind === 'rain')   spawnRain(el, 22);
      if(kind === 'stars')  spawnStars(el, 9);
      if(kind === 'motes')  spawnMotes(el, 6);
      if(kind === 'hearts') spawnHearts(el, 4);
    });

    // Always-on ambient bokeh, independent of per-chapter weather — this
    // is the low-key "living background" layer every scene gets.
    function spawnBokeh(container, count){
      for(let i = 0; i < count; i++){
        const b = document.createElement('span');
        b.className = 'story-bokeh';
        const size = rand(10, 30);
        b.style.width = size + 'px';
        b.style.height = size + 'px';
        b.style.left = rand(4, 92) + '%';
        b.style.top = rand(8, 88) + '%';
        b.style.setProperty('--peak', rand(.25, .55).toFixed(2));
        b.style.setProperty('--dx', rand(-24, 24).toFixed(0) + 'px');
        b.style.setProperty('--dy', rand(-30, -12).toFixed(0) + 'px');
        if(prefersReduced){
          b.style.opacity = '.35';
        } else {
          b.style.animationDuration = rand(6, 11).toFixed(2) + 's';
          b.style.animationDelay = '-' + rand(0, 10).toFixed(2) + 's';
        }
        container.appendChild(b);
      }
    }
    stage.querySelectorAll('.story-ambient[data-ambient]').forEach(el => spawnBokeh(el, 5));

    // ---- lazy background loading ----
    // Photos are set as CSS backgrounds only when needed (current slide +
    // its neighbours). Nothing is ever wired up as a plain <img>, so there's
    // no element for a long-press / drag gesture to save or drag out — and
    // slides that are never viewed never even get requested.
    const scenes = Array.from(stage.querySelectorAll('.scene'));
    function loadScene(i){
      const scene = scenes[i];
      if(!scene) return;
      const photo = scene.querySelector('.scene-photo');
      if(!photo || photo.dataset.loaded) return;
      const url = photo.dataset.bg;
      if(!url) return;
      photo.style.backgroundImage = "url('" + url + "')";
      photo.dataset.loaded = '1';
    }
    function preloadAround(i){
      loadScene(i);
      loadScene(i - 1);
      loadScene(i + 1);
    }

    // ---- navigation ----
    const segs    = Array.from(document.querySelectorAll('#storyDots .story-seg'));
    const prevBtn = document.getElementById('storyPrev');
    const nextBtn = document.getElementById('storyNext');
    const frame   = document.getElementById('storyFrame');
    const hint    = document.getElementById('storyHint');
    const countEl = document.getElementById('storyCount');
    const playBtn = document.getElementById('storyPlayToggle');
    const total   = scenes.length;
    let storyIdx  = 0;

    const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    const ICON_PLAY  = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';

    function hideHint(){ if(hint) hint.classList.add('is-hidden'); }

    function renderStory(){
      stage.style.setProperty('--idx', storyIdx);
      stage.style.setProperty('--dragpx', '0px');
      scenes.forEach((s, i) => {
        const active = i === storyIdx;
        s.classList.toggle('is-active', active);
        s.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      segs.forEach((d, i) => {
        const active = i === storyIdx;
        d.classList.toggle('active', active);
        d.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      prevBtn.disabled = storyIdx === 0;
      nextBtn.disabled = storyIdx === total - 1;
      if(countEl) countEl.textContent = (storyIdx + 1) + ' / ' + total;
      preloadAround(storyIdx);
    }
    function goToScene(n, userInitiated){
      const clamped = Math.max(0, Math.min(total - 1, n));
      const changed = clamped !== storyIdx;
      storyIdx = clamped;
      renderStory();
      if(userInitiated){ hideHint(); restartAutoplay(); }
      return changed;
    }

    prevBtn.addEventListener('click', () => goToScene(storyIdx - 1, true));
    nextBtn.addEventListener('click', () => goToScene(storyIdx + 1, true));
    segs.forEach((d, i) => d.addEventListener('click', () => goToScene(i, true)));

    frame.addEventListener('keydown', e => {
      if(e.key === 'ArrowRight'){ e.preventDefault(); goToScene(storyIdx + 1, true); }
      if(e.key === 'ArrowLeft'){ e.preventDefault(); goToScene(storyIdx - 1, true); }
    });

    // Block the browser's own "save/copy image" and drag-out affordances
    // at the frame level too, belt-and-suspenders alongside the CSS.
    frame.addEventListener('contextmenu', e => e.preventDefault());
    frame.addEventListener('dragstart', e => e.preventDefault());

    // ---- drag-to-swipe (mouse + touch, unified via Pointer Events) ----
    // The stage really slides under the finger/cursor in real time, then
    // snaps to the nearest chapter on release — no separate "grab the
    // image" gesture involved, since pointer events target the frame.
    let dragging = false, dragStartX = 0, dragDx = 0, frameWidth = 0;

    // ---- touch controls: chevrons/expand stay dim until touched ----
    // On touch devices the arrows would otherwise sit on top of the
    // artwork at full opacity forever. Instead they wake up on the
    // first touch/drag of the *current* frame in the DOM (works the
    // same whether that's the inline card or the widescreen popup),
    // then fade back out after a short idle period.
    let wakeTimer = null;
    function wakeControls(){
      frame.classList.add('controls-awake');
      if(wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => frame.classList.remove('controls-awake'), 2600);
    }
    function markTouch(e){
      if(e.pointerType === 'touch' || e.pointerType === 'pen'){
        frame.classList.add('is-touch');
        wakeControls();
      }
    }

    function onPointerDown(e){
      if(e.target.closest('.story-arrow') || e.target.closest('.story-expand')){
        markTouch(e);
        return; // let the buttons handle their own clicks
      }
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      markTouch(e);
      dragging = true;
      dragDx = 0;
      dragStartX = e.clientX;
      frameWidth = frame.getBoundingClientRect().width || 1;
      frame.classList.add('is-dragging');
      stopAutoplay();
      if(frame.setPointerCapture){ try{ frame.setPointerCapture(e.pointerId); }catch(err){} }
    }
    function onPointerMove(e){
      if(!dragging) return;
      dragDx = e.clientX - dragStartX;
      const atStart = storyIdx === 0 && dragDx > 0;
      const atEnd   = storyIdx === total - 1 && dragDx < 0;
      const eased   = (atStart || atEnd) ? dragDx * 0.35 : dragDx;
      stage.style.setProperty('--dragpx', eased.toFixed(1) + 'px');
    }
    function onPointerUp(){
      if(!dragging) return;
      dragging = false;
      frame.classList.remove('is-dragging');
      const threshold = Math.min(90, frameWidth * 0.18);
      let moved = false;
      if(dragDx <= -threshold)      moved = goToScene(storyIdx + 1, true);
      else if(dragDx >= threshold)  moved = goToScene(storyIdx - 1, true);
      else { stage.style.setProperty('--dragpx', '0px'); hideHint(); restartAutoplay(); }
      dragDx = 0;
      wakeControls();
    }
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('pointercancel', onPointerUp);

    // ---- autoplay (paused by interaction, off-screen, or reduced motion) ----
    const AUTOPLAY_MS = 6000;
    let autoplayTimer = null;
    let isPlaying = !prefersReduced;
    let inView = true;

    function updatePlayIcon(){
      if(!playBtn) return;
      playBtn.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute('aria-label', isPlaying ? 'Pause story autoplay' : 'Play story autoplay');
      playBtn.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
    }
    function stopAutoplay(){
      if(autoplayTimer){ clearInterval(autoplayTimer); autoplayTimer = null; }
    }
    function startAutoplay(){
      stopAutoplay();
      if(!isPlaying || !inView) return;
      autoplayTimer = setInterval(() => {
        goToScene(storyIdx + 1 >= total ? 0 : storyIdx + 1);
      }, AUTOPLAY_MS);
    }
    function restartAutoplay(){ startAutoplay(); }

    if(playBtn){
      updatePlayIcon();
      playBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        updatePlayIcon();
        isPlaying ? startAutoplay() : stopAutoplay();
      });
    }
    frame.addEventListener('mouseenter', stopAutoplay);
    frame.addEventListener('mouseleave', startAutoplay);
    frame.addEventListener('focusin', stopAutoplay);
    frame.addEventListener('focusout', startAutoplay);
    document.addEventListener('visibilitychange', () => {
      document.hidden ? stopAutoplay() : startAutoplay();
    });
    if('IntersectionObserver' in window){
      new IntersectionObserver(entries => {
        entries.forEach(entry => {
          inView = entry.isIntersecting;
          inView ? startAutoplay() : stopAutoplay();
        });
      }, {threshold:0.35}).observe(frame);
    }

    // fallback: fade the swipe hint on its own after a few seconds
    if(hint) setTimeout(hideHint, 5000);

    // ---- gentle parallax tilt on hover (desktop only) ----
    const canHover = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if(canHover && !prefersReduced){
      let rafId = null, targetX = 0, targetY = 0, curX = 0, curY = 0;

      function tick(){
        curX += (targetX - curX) * 0.12;
        curY += (targetY - curY) * 0.12;
        const activePhoto = scenes[storyIdx] && scenes[storyIdx].querySelector('.scene-photo');
        if(activePhoto){
          activePhoto.style.setProperty('--px', curX.toFixed(2) + 'px');
          activePhoto.style.setProperty('--py', curY.toFixed(2) + 'px');
        }
        rafId = requestAnimationFrame(tick);
      }

      frame.addEventListener('mousemove', e => {
        const rect = frame.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width - 0.5;
        const relY = (e.clientY - rect.top) / rect.height - 0.5;
        targetX = relX * -14;
        targetY = relY * -10;
        if(rafId === null) tick();
      });
      frame.addEventListener('mouseleave', () => {
        targetX = 0; targetY = 0;
      });
    }

    renderStory();
    startAutoplay();

    // ---- widescreen popup: move the real .storybook node into the
    // modal on open, move it back on close. Every id/listener above
    // keeps working untouched, since it's the same elements. ----
    const expandBtn   = document.getElementById('storyExpand');
    const modal        = document.getElementById('storyModal');
    const modalSlot     = document.getElementById('storyModalSlot');
    const modalClose    = document.getElementById('storyModalClose');
    const modalBackdrop = document.getElementById('storyModalBackdrop');
    const storybookRoot = document.getElementById('storybookRoot');

    if(expandBtn && modal && modalSlot && storybookRoot){
      let homeParent = storybookRoot.parentNode;
      let homeNext   = storybookRoot.nextSibling;
      let lastFocused = null;

      function openModal(){
        homeParent = storybookRoot.parentNode;
        homeNext   = storybookRoot.nextSibling;
        lastFocused = document.activeElement;
        modalSlot.appendChild(storybookRoot);
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        stopAutoplay();
        restartAutoplay();
        modalClose.focus();
      }
      function closeModal(){
        if(!modal.classList.contains('open')) return;
        homeParent.insertBefore(storybookRoot, homeNext);
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        stopAutoplay();
        restartAutoplay();
        if(lastFocused && lastFocused.focus) lastFocused.focus();
        else expandBtn.focus();
      }

      expandBtn.addEventListener('click', openModal);
      modalClose.addEventListener('click', closeModal);
      modalBackdrop.addEventListener('click', closeModal);
      document.addEventListener('keydown', e => {
        if(e.key === 'Escape' && modal.classList.contains('open')) closeModal();
      });
    }
  })();
