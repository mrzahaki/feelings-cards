/**
 * ============================================================
 *  STORE CONFIG — edit this file to relaunch the template as
 *  a brand new product. Nothing below this file should need
 *  to change for a normal reskin (copy, images, price, story,
 *  cards, FAQ, payment link, etc all live here).
 *
 *  Things that stay in index.html on purpose (not here):
 *  - The og:image / twitter:image URLs and the ld+json blocks
 *    in <head>, because crawlers read those before any JS runs.
 *    Keep them lined up with meta.* below by hand when you
 *    relaunch. 
 * ============================================================
 */
window.SITE_CONFIG = {

  // ---- brand / nav -------------------------------------------------
  brand: {
    name: "Feelings & Friends",
  },
  nav: {
    links: [
      { label: "Our story", href: "#our-story" },
      { label: "Sample cards", href: "#gallery" },
      { label: "What's inside", href: "#feelings-wheel" },
    ],
    ctaLabel: "Get the PDF",
    ctaHref: "#checkout",
  },

  // ---- <head> meta (mirror these into index.html's <head> by hand) -
  meta: {
    pageTitle: "Feelings & Friends — 60 Printable Animal Emotion Cards (PDF Download)",
    description: "60 printable animal feelings cards for kids — each pairs a cozy animal fact with a gentle question that opens up real conversations about emotions. Instant PDF download, includes both a 30-page and 60-page print layout. $9.99, pay with crypto.",
    keywords: "feelings cards printable, emotion cards for kids, animal feelings flashcards, SEL cards printable, social emotional learning cards, feelings flashcards PDF, printable conversation cards kids",
    canonical: "https://zahak.me/feelings-cards/",
    ogImage: "https://zahak.me/feelings-cards/images/grid/card-01.jpg",
    ogImageAlt: "Sample feelings cards: Oopsie Armadillo and Grumpy Bear",
    price: "9.99",
    currency: "USD",
  },

  // ---- hero ----------------------------------------------------------
  hero: {
    eyebrow: "✦ Instant PDF Download ✦",
    headingLine1: "Sixty animal friends,",
    headingHighlight: "question",
    headingRest: "one gentle {hl} each.", // {hl} = headingHighlight, wrapped in a styled span
    sub: "A printable deck of feelings cards — each one pairs a cozy animal fact with a question kids actually want to answer. Great for bedtime, the car, or the classroom circle.",
    buyLabel: "Get the deck —",
    price: "$9.99",
    ghostLabel: "Peek inside ↓",
    ghostHref: "#gallery",
    noteText: "See the 8 feeling families it covers →",
    noteHref: "#feelings-wheel",
  },

  // ---- "our story" section --------------------------------------------
  story: {
    eyebrow: "✦ A note from the maker ✦",
    heading: "Why Feelings &amp; Friends exists",
    lede: "A true, short story about a closed door, a little sister, and the one question that finally got through. Swipe, drag, or tap {icon} to go widescreen.",
    skipLabel: "Skip to the cards →",
    skipHref: "#checkout",
    // weather options per chapter: "rain" | "stars" | "motes" | "hearts" (0+)
    // rays: true adds the light-beam effect (used for the "reunion" chapter)
    chapters: [
      {
        title: "Two of Us",
        image: "images/story/01.jpeg",
        imageAlt: "The brother walking through their sunlit home with his little sister trailing close behind, reaching for his sleeve",
        text: "She trailed me through every room — kitchen, porch, whatever hallway I wandered into. Sunlit days, small footsteps close behind. I didn't yet know what quiet would sound like without them.",
        weather: ["motes"],
      },
      {
        title: "Then, Overnight",
        image: "images/story/02.jpeg",
        imageAlt: "The brother standing alone in a dim doorway with storm clouds gathering outside the window, tense and worried",
        text: "One test result, and the house rearranged itself around a line neither of us could cross. Clouds gathered over the doorway. Outside, everything looked exactly the same.",
        weather: [],
      },
      {
        title: "The Door Between Us",
        image: "images/story/03.jpeg",
        imageAlt: "The little sister crying alone on one side of a closed door at night while her brother sits silently on the other side, a sliver of warm light between them",
        text: "Quarantine meant nothing to her. A closed door meant everything. Some nights the rain slipped in anyway, under the door, into the space between us — and we each sat with it, one on either side.",
        weather: ["stars", "rain"],
      },
      {
        title: "No Words For It",
        image: "images/story/04.jpeg",
        imageAlt: "The little sister sitting alone at night, puzzled, with scribbled thought-clouds and a glowing question mark above her head",
        text: "She had no word yet for missing, or fear, or a house that stopped making sense. Just static — small hands over small ears, a question mark where an answer should be.",
        weather: [],
      },
      {
        title: "A Different Way In",
        image: "images/story/05.jpeg",
        imageAlt: "The brother listening to his little sister as she talks through her plush elephant, lamp glowing warmly beside them",
        text: "One night, out of questions, I asked her elephant how he was doing instead. The room went still. Then she told me everything — through him, at length, completely true.",
        weather: ["stars"],
      },
      {
        title: "Coming Back Together",
        image: "images/story/06.jpeg",
        imageAlt: "The brother and sister standing together in an open doorway with warm light streaming in and plush animals around their feet",
        text: "When the door opened, the house let out a breath it had been holding. We kept the animals anyway — small worries wearing fur and feathers, easier to hold than our own.",
        weather: ["hearts"],
        rays: true,
      },
      {
        title: "Why These Cards Exist",
        image: "images/story/07.jpeg",
        imageAlt: "Small plush animal toys arranged on a table, with the faded silhouette of the brother and sister walking hand in hand in the hazy background",
        text: "Feelings &amp; Friends began behind that door. Every card still asks its question through an animal — the same doorway I found by accident, propped open now for anyone else who needs it.",
        weather: ["motes"],
      },
    ],
  },

  // ---- gallery (sample cards grid + lightbox) -------------------------
  gallery: {
    heading: "A peek inside the deck",
    sub: "Tap any card to zoom in — there are 30 double-sided pages (60 animal feelings cards!) waiting in the full download.",
    moreTextHtml: "…plus <strong>51 more cards</strong> covering everything from brave lion cubs to jealous jaguars — <a href=\"#feelings-wheel\">see the full feelings wheel ↓</a>",
    // id = filename suffix, expects images/grid/card-{id}.jpg and images/zoom/card-{id}.jpg
    cards: [
      { id: "01", names: "Oopsie Armadillo & Grumpy Bear" },
      { id: "05", names: "Courageous Chimpanzee & Busy Chipmunk" },
      { id: "09", names: "Soaring Eagle & Jumpy Elephant" },
      { id: "13", names: "Sharing Gorilla & Cozy Hedgehog" },
      { id: "17", names: "Contented Koala & Cuddly Lamb" },
      { id: "21", names: "Surprised Owl & Munchy Panda" },
      { id: "24", names: "Bouncy Puppy & Hopeful Rabbit" },
      { id: "27", names: "Determined Salmon & Anxious Squirrel" },
      { id: "30", names: "Affectionate Alpaca & Busy Ant" },
    ],
  },

  // ---- feelings wheel ---------------------------------------------------
  feelingsWheel: {
    eyebrow: "✦ What's inside ✦",
    heading: "A whole wheel of feelings",
    sub: "The 60 cards sort into 8 feeling families. Tap a petal to see what each one covers — no spoilers on the cards themselves.",
    hintText: "👆 Tap any petal on the wheel — you'll see how many cards are in that family and the range of feelings it opens up.",
    totalCount: 60,
    totalLabel: "feelings",
    families: [
      { key: "joy", icon: "🦚", name: "Joyful & Proud", color: "#F6D077", count: 10,
        blurb: "Big smiles and big energy — proud, excited, silly, confident feelings.",
        words: ["Proud","Excited","Silly","Happy","Ready","Hopeful","Hardworking","Confident","Eager","Giggly"] },
      { key: "love", icon: "🐑", name: "Loving & Kind", color: "#F2B9C4", count: 8,
        blurb: "Warm, connected feelings about family, friends, sharing, and making things right.",
        words: ["Loved","Kind","Loyal","Gentle","Sharing","Affectionate","Sorry","Open-hearted"] },
      { key: "calm", icon: "🐨", name: "Calm & Cozy", color: "#A3C48F", count: 8,
        blurb: "Slow-breathing, settled feelings — for naptime, quiet time, and taking it easy.",
        words: ["Cozy","Calm","Peaceful","Patient","Thoughtful","Relaxed","Content"] },
      { key: "brave", icon: "🦁", name: "Brave & Bold", color: "#E3B778", count: 6,
        blurb: "Chin-up feelings for trying hard things and not giving up.",
        words: ["Brave","Free","Determined","Courageous","Resilient","Persistent"] },
      { key: "curious", icon: "🐱", name: "Curious & Wondering", color: "#95D2E0", count: 6,
        blurb: "Wide-eyed, imaginative feelings about new places, ideas, and questions.",
        words: ["Curious","Wonder","Imaginative","Resourceful","Adventurous"] },
      { key: "nervous", icon: "🐿️", name: "Nervous & Worried", color: "#C7B7E8", count: 7,
        blurb: "Fluttery-tummy feelings — for when things feel too big, too fast, or too new.",
        words: ["Worried","Nervous","Shy","Careful","Startled","Overwhelmed","Anxious"] },
      { key: "sad", icon: "🐧", name: "Sad & Lonely", color: "#BFE3D0", count: 5,
        blurb: "Quiet, low feelings — for missing someone, or a day that didn't go as planned.",
        words: ["Alone","Bored","Lonely","Disappointed"] },
      { key: "big", icon: "🐻", name: "Big Feelings", color: "#F3AB8B", count: 10,
        blurb: "The tricky ones — grumpy, jealous, embarrassed — named gently, without judgment.",
        words: ["Grumpy","Surprised","Jealous","Embarrassed","Regretful","Frustrated","Angry","Confused","Guilty"] },
    ],
  },

  // ---- "about" / feature strip ------------------------------------------
  about: {
    items: [
      { icon: "🖨️", iconClass: "a", title: "Print at home", text: "High-resolution PDF, ready for any home or office printer — no trimming required." },
      { icon: "💬", iconClass: "b", title: "Real conversations", text: "Each card pairs a relatable animal fact with a question that invites kids to open up." },
      { icon: "⚡", iconClass: "c", title: "Instant delivery", text: "Pay with crypto, get your download link right after — no accounts, no waiting." },
    ],
  },

  // ---- FAQ (also mirror into the FAQPage ld+json in <head>) -------------
  faq: {
    heading: "Frequently asked questions",
    items: [
      { q: "What do I get?", a: "Two printable PDFs: a 30-page version (2 cards/page, saves paper) and a 60-page version (1 card/page, bigger cards, easier to cut). Same 60 animal feelings cards in both." },
      { q: "How does delivery work?", a: "Automatic after a confirmed crypto payment. If it doesn't arrive, email your payment confirmation and it'll be sent manually." },
      { q: "What payment methods work?", a: "Bitcoin, Monero, Ethereum, and 300+ other cryptocurrencies via NOWPayments." },
    ],
  },

  // ---- checkout -----------------------------------------------------------
  checkout: {
    heading: "Get your copy",
    formatNoteHtml: "You'll get <strong>2 PDF files</strong>: a 30-page version (2 cards/page, saves paper) and a 60-page version (1 card/page, bigger cards, easier to cut). Print whichever suits you.",
    emailPlaceholder: "you@example.com",
    payButtonLabel: "Pay $9.99 & get the deck",
    price: "9.99",
    coins: ["Bitcoin", "Monero", "Ethereum", "+300 more"],
    fallbackNoteDefault: "Enter your email and click Pay — checkout will appear right here on the page.",
    // Google Apps Script endpoint that creates a fresh NOWPayments invoice
    invoiceEndpoint: "https://script.google.com/macros/s/AKfycbxr-m6hBArXqw3AhbFNUs2xxgOsNifYK7hK4jpuhI2QHw4vOMQoIgPVn0CE2QaMTrw/exec",
  },

  // ---- footer -------------------------------------------------------------
  footer: {
    supportEmail: "mrzahaki2@gmail.com",
    deliveryTextHtml: "After paying, email your payment confirmation to <strong>{email}</strong> and you'll receive both PDFs (30-page and 60-page versions) right away.",
    note: "Printer cropping a card oddly, or want the raw images instead of a PDF? Just reply to your delivery email and ask — happy to send those over.",
  },
};
