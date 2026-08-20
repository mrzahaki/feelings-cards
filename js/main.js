  const cards = [
    { id:"01", names:"Oopsie Armadillo & Grumpy Bear" },
    { id:"05", names:"Courageous Chimpanzee & Busy Chipmunk" },
    { id:"09", names:"Soaring Eagle & Jumpy Elephant" },
    { id:"13", names:"Sharing Gorilla & Cozy Hedgehog" },
    { id:"17", names:"Contented Koala & Cuddly Lamb" },
    { id:"21", names:"Surprised Owl & Munchy Panda" },
    { id:"24", names:"Bouncy Puppy & Hopeful Rabbit" },
    { id:"27", names:"Determined Salmon & Anxious Squirrel" },
    { id:"30", names:"Affectionate Alpaca & Busy Ant" }
  ];

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

  // ---- Feelings wheel: 60 cards sorted into 8 feeling families ----
  // Counts/words are drawn straight from the deck's own card titles —
  // no card art or animal+question pairings shown, just the feelings.
  const feelingFamilies = [
    { key:'joy', icon:'🦚', name:'Joyful & Proud', color:'#F6D077', count:10,
      blurb:"Big smiles and big energy — proud, excited, silly, confident feelings.",
      words:['Proud','Excited','Silly','Happy','Ready','Hopeful','Hardworking','Confident','Eager','Giggly'] },
    { key:'love', icon:'🐑', name:'Loving & Kind', color:'#F2B9C4', count:8,
      blurb:"Warm, connected feelings about family, friends, sharing, and making things right.",
      words:['Loved','Kind','Loyal','Gentle','Sharing','Affectionate','Sorry','Open-hearted'] },
    { key:'calm', icon:'🐨', name:'Calm & Cozy', color:'#A3C48F', count:8,
      blurb:"Slow-breathing, settled feelings — for naptime, quiet time, and taking it easy.",
      words:['Cozy','Calm','Peaceful','Patient','Thoughtful','Relaxed','Content'] },
    { key:'brave', icon:'🦁', name:'Brave & Bold', color:'#E3B778', count:6,
      blurb:"Chin-up feelings for trying hard things and not giving up.",
      words:['Brave','Free','Determined','Courageous','Resilient','Persistent'] },
    { key:'curious', icon:'🐱', name:'Curious & Wondering', color:'#95D2E0', count:6,
      blurb:"Wide-eyed, imaginative feelings about new places, ideas, and questions.",
      words:['Curious','Wonder','Imaginative','Resourceful','Adventurous'] },
    { key:'nervous', icon:'🐿️', name:'Nervous & Worried', color:'#C7B7E8', count:7,
      blurb:"Fluttery-tummy feelings — for when things feel too big, too fast, or too new.",
      words:['Worried','Nervous','Shy','Careful','Startled','Overwhelmed','Anxious'] },
    { key:'sad', icon:'🐧', name:'Sad & Lonely', color:'#BFE3D0', count:5,
      blurb:"Quiet, low feelings — for missing someone, or a day that didn't go as planned.",
      words:['Alone','Bored','Lonely','Disappointed'] },
    { key:'big', icon:'🐻', name:'Big Feelings', color:'#F3AB8B', count:10,
      blurb:"The tricky ones — grumpy, jealous, embarrassed — named gently, without judgment.",
      words:['Grumpy','Surprised','Jealous','Embarrassed','Regretful','Frustrated','Angry','Confused','Guilty'] }
  ];

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
    petal.setAttribute('aria-label', f.name + ' — ' + f.count + ' of 60 cards');
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
            <span class="detail-count">${f.count} of 60 cards</span>
          </div>
        </div>
        <p class="detail-blurb">${f.blurb}</p>
        <div class="chip-row">
          ${f.words.map(w => `<span class="chip" style="background:${f.color}66;">${w}</span>`).join('')}
        </div>
      </div>`;
  }

  // ---- Checkout: create a fresh invoice per click, embed it inline ----
  const CREATE_INVOICE_ENDPOINT = "https://script.google.com/macros/s/AKfycbxr-m6hBArXqw3AhbFNUs2xxgOsNifYK7hK4jpuhI2QHw4vOMQoIgPVn0CE2QaMTrw/exec";
  const payBtn = document.getElementById('payBtn');
  const payStatus = document.getElementById('payStatus');
  const emailInput = document.getElementById('buyerEmail');
  const widgetFrame = document.getElementById('widgetFrame');
  const fallbackNote = document.getElementById('fallbackNote');

  payBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!emailOk) {
      payStatus.className = 'status-msg error';
      payStatus.textContent = 'Please enter a valid email first — that\'s where your PDFs will be sent.';
      emailInput.focus();
      return;
    }

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
        body: JSON.stringify({ email: email })
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
        emailInput.disabled = true;
        payStatus.textContent = 'Complete payment below. Your PDFs will be sent to ' + email + ' once it confirms.';
        fallbackNote.innerHTML = 'Widget not loading? <a href="' + data.invoice_url + '" target="_blank" rel="noreferrer noopener">Open checkout in a new tab instead</a>.';
        widgetFrame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        payStatus.className = 'status-msg error';
        payStatus.textContent = data.error || "Couldn't start checkout — please try again in a moment.";
        payBtn.disabled = false;
        payBtn.textContent = 'Pay $9.99 & get the deck';
      }
    } catch (err) {
      payStatus.className = 'status-msg error';
      payStatus.textContent = 'Network error — please try again, or email mrzahaki2@gmail.com to order directly.';
    } finally {
      payBtn.disabled = false;
      payBtn.textContent = 'Pay $9.99 & get the deck';
    }
  });
