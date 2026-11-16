/* Blackjack Duel – client.js (desktop-first)
   Fixes/Features:
   - Robust Play Now: opens intro dialog injected into document.body (visible in pregame)
   - Hit/Stand disabled after Stand or bust (you)
   - DONE strap for your hand when finished/busted (normal + sudden death)
   - Fan cards from 3 cards
   - Result overlay & Double dialog centered between rows
   - Hides/removes the floating bottom-right “New Match” button
*/

let socket;
try {
  socket = io();
} catch (e) {
  // Server is offline or socket.io script failed to load
  const errBanner = document.createElement("div");
  Object.assign(errBanner.style, {
    position: "fixed", top: "0", left: "0", width: "100%",
    backgroundColor: "#ff4444", color: "white", textAlign: "center",
    padding: "10px", zIndex: "9999", fontWeight: "bold"
  });
  errBanner.textContent = "Server is Offline. Please start the server to play.";
  document.body.prepend(errBanner);
  throw new Error("Server offline: socket.io not loaded");
}
const $ = (s) => document.querySelector(s);

/* ---------- Core DOM ---------- */
const pregame = $("#pregame"),
  table = $("#table"),
  statusEl = $("#status");
const phaseEl = $("#phase"),
  aiArea = $("#aiArea"),
  playerArea = $("#playerArea"),
  resultsEl = $("#results");
const logArea = $("#logArea"),
  opponentCue = $("#opponentCue");
const redrawBar = $("#redrawBar"),
  redrawStatus = $("#redrawStatus"),
  skipBtn = $("#skipBtn");

/* Remove/Hide the floating bottom-right new match button if present */
(() => {
  const floatingNewMatchBtn = $("#newMatchBtn");
  if (floatingNewMatchBtn) floatingNewMatchBtn.remove();
})();

/* Inject (score chip, mobile carousel, sudden pane) if missing */
// --- GLOBAL STATE ---
let isTutorial = false;
let tutorialStarted = false;
let roomId = null;

/* Inject (score chip, mobile carousel, sudden pane) if missing */
let scoreChip = $("#scoreChip");
if (!scoreChip) {
  scoreChip = document.createElement("div");
  scoreChip.id = "scoreChip";
  scoreChip.textContent = "SCORE 0–0";
  table.insertBefore(scoreChip, playerArea);
}
let mobileEl = $("#mobile");
if (!mobileEl) {
  mobileEl = document.createElement("div");
  mobileEl.id = "mobile";
  mobileEl.innerHTML = `<div id="handCarousel"></div><div id="dots"></div><div id="mobileOverlayHost"></div>`;
  table.insertBefore(mobileEl, resultsEl);

  let _swipeStartX = 0;
  mobileEl.addEventListener("touchstart", (e) => {
    const car = handCarousel();
    if (car) _swipeStartX = e.touches[0].clientX;
  }, { passive: true });
  mobileEl.addEventListener("touchend", (e) => {
    const car = handCarousel();
    if (!car) return;
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    if (Math.abs(dx) > 40) {
      const cur = Math.round(car.scrollLeft / car.clientWidth);
      const next = dx < 0 ? Math.min(2, cur + 1) : Math.max(0, cur - 1);
      car.scrollTo({ left: next * car.clientWidth, behavior: "smooth" });
    }
  }, { passive: true });
}
let suddenPane = $("#suddenPane");
if (!suddenPane) {
  suddenPane = document.createElement("div");
  suddenPane.id = "suddenPane";
  table.insertBefore(suddenPane, resultsEl);
}
const handCarousel = () => $("#handCarousel"),
  dots = () => $("#dots"),
  mobileOverlayHost = () => $("#mobileOverlayHost");

/* ---------- Action Log toggle ---------- */
function urlWantsLog() {
  const p = new URLSearchParams(location.search),
    q = (s) => p.has(s) || ["1", "true"].includes(p.get(s));
  const path = location.pathname.toLowerCase(),
    hash = location.hash.toLowerCase();
  return (
    path.includes("/actionlog") ||
    q("log") ||
    q("actionlog") ||
    q("debug") ||
    hash.includes("actionlog") ||
    hash.includes("log")
  );
}
function applyLogPref() {
  document.body.classList.toggle("show-log", urlWantsLog());
}
applyLogPref();
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l")
    document.body.classList.toggle("show-log");
});

/* ---------- Match state ---------- */
let you = null;
// roomId, isTutorial moved to top
let isBotMatch = false; // bot match flag
let stage = "pregame"; // pregame | strategy | countdown | play | results
let mode = "normal"; // normal | sudden
let activeHand = "A";
let myHands = { A: [], B: [], C: [] },
  oppHands = { A: [], B: [], C: [] };
let handActed = { A: false, B: false, C: false };
let redrawUsed = false,
  opponentFinished = { A: false, B: false, C: false },
  myFinished = { A: false, B: false, C: false };
let meReady = false,
  oppReady = false,
  briefingReady = false;
let myRedrawSeconds = 20,
  myRedrawTotal = 20,
  countdownSeconds = null,
  opponentLeft = false;
let handResults = { A: null, B: null, C: null }; // win | lose | push | null
const seenCards = new Set();
function getCardUid(who, handKey, idx, card) {
  return `${who}-${handKey}-${idx}-${card.r}-${card.s}`;
}

let prevMode = "pregame";
let prevStage = "pregame";

/* Live score */
let scoreYou = 0,
  scoreOpp = 0;

/* Double feature */
let doubleAvailable = true;
let doubleUsedOn = null;
let youDoubled = { A: false, B: false, C: false };
let oppDoubled = { A: false, B: false, C: false };
let myLocked = { A: false, B: false, C: false };
let oppLocked = { A: false, B: false, C: false };
let myNatural = { A: false, B: false, C: false };
let oppNatural = { A: false, B: false, C: false };
let doubleTarget = null;
let redrawTarget = null;
let handOutcomeServer = { A: null, B: null, C: null };

/* ---------- Helpers ---------- */
const orderIndex = (k) => ({ A: 0, B: 1, C: 2 }[k] ?? 0);
function rankToCode(r) {
  return r === "10" ? "0" : r;
}
function cardImgUrl(c) {
  if (!c || c.r === "?")
    return "https://deckofcardsapi.com/static/img/back.png";
  return `https://deckofcardsapi.com/static/img/${rankToCode(c.r)}${c.s}.png`;
}

function createHandHeader(titleText, totalValue) {
  const header = document.createElement("div");
  header.className = "hand-header";

  const title = document.createElement("h3");
  title.textContent = titleText;
  header.appendChild(title);

  if (typeof totalValue === "number") {
    const pill = document.createElement("div");
    pill.className = "hand-total";
    pill.textContent = `Total: ${totalValue}`;
    header.appendChild(pill);
  }

  return header;
}

function attachDoubleToken(handEl, isMine = false) {
  if (!handEl || !handEl.querySelector) return;
  const header = handEl.querySelector(".hand-header");
  if (!header) return;

  header.querySelectorAll(".strap.x2").forEach((el) => el.remove());

  const token = document.createElement("div");
  token.className = `strap x2${isMine ? " mine" : ""}`;
  token.textContent = "×2";

  const total = header.querySelector(".hand-total");
  header.insertBefore(token, total || null);
}
function log(t) {
  const d = document.createElement("div");
  d.textContent = t;
  logArea?.appendChild(d);
  if (logArea) logArea.scrollTop = logArea.scrollHeight;
}
function showCue(t) {
  if (!opponentCue) return;
  opponentCue.textContent = t;
  opponentCue.classList.remove("hidden");
  setTimeout(() => opponentCue.classList.add("hidden"), 1600);
}
function handValue(cs = []) {
  let total = 0,
    aces = 0;
  for (const c of cs) {
    if (!c || !c.r) continue;
    if (c.r === "A") {
      total += 11;
      aces++;
    } else if (["K", "Q", "J", "10"].includes(c.r)) total += 10;
    else total += parseInt(c.r, 10) || 0;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function canUseDouble(handKey) {
  if (mode !== "normal") return false;
  if (stage !== "strategy") return false;
  if (!roomId || !handKey) return false;
  if (!doubleAvailable) return false;
  if (youDoubled[handKey]) return false;
  if (myLocked[handKey]) return false;
  if (meReady) return false;
  if (redrawTarget === handKey) return false;
  return true;
}

function triggerDouble(handKey) {
  if (!canUseDouble(handKey)) return;
  youDoubled[handKey] = true;
  myLocked[handKey] = true;
  myFinished[handKey] = true;
  doubleAvailable = false;
  doubleUsedOn = handKey;
  doubleTarget = handKey;
  socket.emit("double_choice", { roomId, handKey, choice: true });
  render();
}
function outcomeText(o) {
  return o === "win" ? "WIN" : o === "lose" ? "LOSS" : "PUSH";
}

function scrollCarouselTo(idx) {
  const car = handCarousel();
  if (car) car.scrollTo({ left: idx * car.clientWidth, behavior: "smooth" });
}

/* ---------- Mobile mode (desktop is primary) ---------- */
const mqMobile =
  matchMedia?.("(max-width: 860px)") || { matches: false, addEventListener() { } };
function isMobile() {
  return document.body.classList.contains("mobile-mode");
}
function applyMobileMode() {
  document.body.classList.toggle("mobile-mode", !!mqMobile.matches);
  render();
  setTimeout(scheduleOverlayUpdate, 120);
}
mqMobile.addEventListener?.("change", applyMobileMode);

/* ---------- Overlays (declare first to avoid TDZ) ---------- */
let overlayEl = null; // defined before helpers

/* Redraw/wait/countdown overlay */
/* Redraw/wait/countdown overlay */
function overlayHost() {
  if (isMobile()) return mobileOverlayHost() || aiArea;
  return aiArea; // ring and countdown float centered over opponent area
}
function purgeOverlays() {
  document.querySelectorAll("#overlay").forEach((el) => { el.classList.remove("countdown-active"); el.remove(); });
  overlayEl = null;
}
function ensureOverlay() {
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "overlay";
    overlayEl.className = "overlay hidden";
  }
  const host = overlayHost();
  if (!overlayEl.isConnected || overlayEl.parentElement !== host) {
    // If hosting in a hand box, make sure it has relative positioning
    if (host.id && host.id.startsWith("hand-")) host.style.position = "relative";
    host.appendChild(overlayEl);
  }
}
function hideOverlay() {
  if (overlayEl) { overlayEl.classList.remove("countdown-active"); overlayEl.remove(); }
  overlayEl = null;
}

/* Update result banners (Win/Loss/Push) directly on hands */
function updateResultOverlays() {
  // Clear existing banners
  document.querySelectorAll(".result-banner").forEach((el) => el.remove());

  // Opponent banners (inverted perspective if we wanted, but "WIN" means I won)
  // Actually, standard is: result logic is from MY perspective.
  // If I WIN, my hand gets "WIN", opp gets "LOSS" (or nothing? usually just mark my side)
  // Let's mark BOTH sides for clarity.
  ["A", "B", "C"].forEach((k) => {
    const res = handResults[k];
    if (!res) return;

    // My Hand
    const myBox = document.getElementById(`hand-you-${k}`);
    if (myBox) {
      const b = document.createElement("div");
      b.className = `result-banner ${res}`;

      const doubled = youDoubled && youDoubled[k];
      const pts = res === "win" ? (doubled ? 2 : 1) : 0;
      const ptsText = res === "win"
        ? `${pts} Point${pts > 1 ? "s" : ""} Awarded`
        : "";

      let html = `<div class="result-title">${res === "win" ? "WIN" : res === "lose" ? "LOSE" : "PUSH"}</div>`;
      if (ptsText) html += `<div class="points-sub">${ptsText}</div>`;
      if (doubled) html += `<div class="double-badge">2x</div>`;

      b.innerHTML = html;
      myBox.appendChild(b);
    }

    // Opponent Hand (inverse)
    const oppBox = document.getElementById(`hand-opp-${k}`);
    if (oppBox) {
      const b = document.createElement("div");
      const oppRes = res === "win" ? "lose" : res === "lose" ? "win" : "push";
      b.className = `result-banner ${oppRes}`;

      const doubled = oppDoubled && oppDoubled[k];
      const pts = oppRes === "win" ? (doubled ? 2 : 1) : 0; /* Opponent gets pts if they win */

      // Usually we don't show "Points Awarded" for opponent in the same detailed way? 
      // User request implied "the overlay" (singular view), but generally symmetry is good.
      // I'll add it for opponent too for clarity, or just keep it simple.
      // User request: "add a points awarded to the 'win' result overlay". 
      // I'll focus on Player's win primarily, but consistency suggests both.

      let html = `<div class="result-title">${oppRes === "win" ? "WIN" : oppRes === "lose" ? "LOSE" : "PUSH"}</div>`;
      // Start with just title for opponent unless asked, to reduce clutter? 
      // Actually, knowing if opponent got 2 points is important.
      if (oppRes === "win") html += `<div class="points-sub">${doubled ? 2 : 1} Point${doubled ? "s" : ""} Awarded</div>`;
      if (doubled) html += `<div class="double-badge">2x</div>`;

      b.innerHTML = html;
      oppBox.appendChild(b);
    }
  });
}
function clearResultLayer() {
  document.querySelectorAll(".result-banner").forEach(el => el.remove());
}
function ringColor(sec, total) {
  if (sec <= 1) return "#ff3a3a";
  const t = Math.max(0, Math.min(1, sec / total));
  const hue = Math.round(120 * t);
  return `hsl(${hue} 90% 55%)`;
}
function overlayDims() {
  const s = Math.min(innerWidth, innerHeight);
  const size = Math.max(96, Math.min(220, Math.round(s * 0.26)));
  return {
    size,
    inset: Math.round(size * 0.18),
    num: Math.round(size * 0.34),
    cta: Math.round(size * 0.18),
  };
}
function showRing(seconds, total = 20) {
  ensureOverlay();
  const { size, inset, num } = overlayDims();
  const sec = Math.max(0, seconds | 0);
  const deg = Math.max(0, Math.min(360, Math.round((360 * sec) / total)));
  const col = ringColor(sec, total);
  overlayEl.innerHTML = `<div class="ringTimer" style="--deg:${deg};--ring:${col};width:${size}px;height:${size}px;"><div class="ringInner" style="inset:${inset}px;font-size:${num}px;">${sec}</div></div>`;
  overlayEl.classList.remove("hidden");
}
function showWaiting() {
  ensureOverlay();
  const { cta } = overlayDims();
  overlayEl.innerHTML = `<div class="waitFlash" style="font-size:${cta}px">Waiting for opponent…</div>`;
  overlayEl.classList.remove("hidden");
}
function showCountdown(n) {
  ensureOverlay();
  overlayEl.classList.add("countdown-active");
  overlayEl.innerHTML = `<div class="countdown">${Math.max(0, n | 0)}</div>`;
  overlayEl.classList.remove("hidden");
}
/* Briefing overlay */
function renderBriefingOverlay() {
  ensureOverlay();
  const { cta } = overlayDims();

  if (briefingReady) {
    overlayEl.innerHTML = `<div class="waitFlash" style="font-size:${cta}px">Waiting for opponent...</div>`;
    overlayEl.classList.remove("hidden");
    return;
  }

  // Briefing card content
  overlayEl.innerHTML = `
    <div class="briefing-card">
      <h2>Strategy Phase</h2>
      <p>You have <strong>20 seconds</strong> to:</p>
      <ul>
        <li><strong>Redraw</strong> one card (click it) to improve a hand.</li>
        <li><strong>Double Down</strong> on one hand to double its point value.</li>
      </ul>
      <p><em>(You can verify these options now. Timer starts when you click ready.)</em></p>
      <button id="briefingStartBtn" class="primary big-btn">Start Strategy Timer</button>
    </div>
  `;
  overlayEl.classList.remove("hidden");

  const btn = overlayEl.querySelector("#briefingStartBtn");
  if (btn) btn.onclick = () => socket.emit("dismiss_briefing", { roomId });
}

function renderOverlay() {
  purgeOverlays();
  if (mode === "sudden" && stage !== "strategy") {
    hideOverlay();
    return;
  }
  if (stage === "briefing") {
    if (!isTutorial) renderBriefingOverlay();
    else hideOverlay();
    return;
  }
  if (stage === "strategy") {
    if (isTutorial && !tutorialStarted) {
      hideOverlay();
      return;
    }
    if (!meReady) showRing(myRedrawSeconds ?? 20, myRedrawTotal ?? 20);
    else if (!oppReady) showWaiting();
    else hideOverlay();
  } else if (stage === "countdown") {
    if (typeof countdownSeconds === "number" && countdownSeconds > 0)
      showCountdown(countdownSeconds);
    else hideOverlay();
  } else hideOverlay();
}

/* Result banner layer removed - using direct hand overlays */
let _overlayTick = false;
function scheduleOverlayUpdate() {
  if (_overlayTick) return;
  _overlayTick = true;
  requestAnimationFrame(() => {
    _overlayTick = false;
    updateResultOverlays();
  });
}

/* ---------- Card sizing + fan ---------- */
function sizingConfig() {
  const w = innerWidth || 1024;
  if (w <= 400) return { MIN_W: 48, MAX_W: 96, GAP: 6 };
  if (w <= 600) return { MIN_W: 54, MAX_W: 110, GAP: 7 };
  if (w <= 820) return { MIN_W: 58, MAX_W: 120, GAP: 8 };
  return { MIN_W: 60, MAX_W: 130, GAP: 8 };
}
let SIZE = sizingConfig();
function sizeHandCards(handEl) {
  const row = handEl.querySelector(".cards");
  if (!row) return;
  const cards = [...row.children];
  const n = cards.length;
  if (n <= 0) return;
  const w = Math.max(
    SIZE.MIN_W,
    Math.min(SIZE.MAX_W, Math.round((table.clientWidth - 120) / 7))
  );
  cards.forEach((el) => el.style.setProperty("--cardW", `${w}px`));
  const shouldFan = n >= 3;
  row.classList.toggle("fan", shouldFan);
  if (shouldFan) {
    const usable = row.clientWidth - 16;
    const needed = n * w;
    const overlap = Math.min(
      w * 0.6,
      Math.max(18, Math.round((needed - usable) / (n - 1)))
    );
    row.style.setProperty("--fanOverlap", `-${overlap}px`);
  } else row.style.removeProperty("--fanOverlap");
}
function sizeAllHands() {
  document.querySelectorAll(".hand").forEach(sizeHandCards);
  updateResultOverlays();
}
addEventListener("resize", () => {
  SIZE = sizingConfig();
  sizeAllHands();
  renderOverlay();
  scheduleOverlayUpdate();
});
addEventListener("orientationchange", () =>
  setTimeout(() => {
    SIZE = sizingConfig();
    sizeAllHands();
    renderOverlay();
    scheduleOverlayUpdate();
  }, 120)
);

/* ---------- Intro (Welcome) dialog ---------- */
let introEl = null;
function ensureIntro() {
  if (introEl) return introEl;
  introEl = document.createElement("div");
  introEl.id = "introDialog";
  introEl.innerHTML = `
    <div class="intro-card">
      <h2>Welcome to Blackjack Duel</h2>
      <p>This is a multiplayer tech demo built as a rapid prototype. Its purpose is to showcase the game concept and gather your feedback. You may encounter bugs or rough edges, but we hope you still have fun!</p>

      <h3>How to Play</h3>
      <p><b>Blackjack Duel</b> is a head-to-head game against another player—there's no "house" involved. The overall winner is the player with the highest score after three hands.</p>

      <h3>Game Flow</h3>
      <p><b>The Strategy Phase (20 seconds):</b> Right after dismissing this screen, you'll be dealt three hands. You have 20 seconds to redraw one card from any hand <em>and</em> optionally double a different hand. This is the only window to use either ability.</p>
      <p><b>The Play Phase:</b> You and your opponent play through your hands (A, B, and C) sequentially, aiming for a total of 21 or less.</p>

      <h3>Scoring</h3>
      <ul>
        <li><b>Win:</b> Highest total ≤ 21 gets 1 point.</li>
        <li><b>Loss:</b> Bust or lower total gets 0 points.</li>
        <li><b>Push (Tie):</b> Same result → both get 1 point.</li>
      </ul>

      <h3>Special Rule: Double Down</h3>
      <p>You have one chance to Double Down across all three hands. You must double before you hit or stand on that hand—win the doubled hand and you earn 2 points instead of 1.</p>

      <p><b>Good luck! We hope you enjoy the duel.</b></p>

      <div class="intro-actions">
        <button id="introPlay" class="primary">Play</button>
      </div>
    </div>`;
  introEl.style.display = "none"; // start hidden
  document.body.appendChild(introEl);
  return introEl;
}
function openIntro() { ensureIntro(); introEl.style.display = ""; introEl.classList.add("open"); document.body.classList.add("modal-open"); }
function closeIntro() { if (introEl) introEl.classList.remove("open"); document.body.classList.remove("modal-open"); }


/* ---------- Sudden death renderer ---------- */
function renderSudden() {
  document.body.classList.add("sudden-mode", "sudden-single");
  suddenPane.innerHTML = "";
  const pane = document.createElement("div");

  // Opponent (face-down, correct card count from server)
  const oppBox = document.createElement("div");
  oppBox.className = "hand opp-hand";
  oppBox.appendChild(createHandHeader("Opponent Hand"));
  const oppCards = Object.assign(document.createElement("div"), { className: "cards" });
  const sdOppShow = oppHands.A || [{ r: "?", s: "?" }, { r: "?", s: "?" }];
  sdOppShow.forEach((c) => oppCards.appendChild(renderCard(c, c.r === "?")));
  oppBox.appendChild(oppCards);
  if (stage === "play" && !opponentFinished.A && !handResults.A) {
    oppBox.appendChild(Object.assign(document.createElement("div"), { className: "strap thinking", textContent: "thinking..." }));
  }
  if (stage === "play" && opponentFinished.A && !handResults.A) {
    oppBox.appendChild(Object.assign(document.createElement("div"), { className: "strap done", textContent: "DONE" }));
  }

  // You
  const meBox = document.createElement("div");
  meBox.className = "hand player-hand active";
  meBox.appendChild(createHandHeader("Your Hand", handValue(myHands.A || [])));
  const meCards = Object.assign(document.createElement("div"), { className: "cards" });
  (myHands.A || []).forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "card";
    if (stage === "strategy" && !redrawUsed && !meReady) {
      d.classList.add("redrawable");
      d.title = "Click to redraw this card";
      d.tabIndex = 0;
      d.onclick = () => socket.emit("redraw_card", { roomId, handKey: "A", cardIndex: i });
      d.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); socket.emit("redraw_card", { roomId, handKey: "A", cardIndex: i }); }
      };
    }
    const img = document.createElement("img");
    img.src = cardImgUrl(c);
    img.alt = "card";
    d.appendChild(img);
    meCards.appendChild(d);
  });
  meBox.appendChild(meCards);

  if (stage === "play") {
    const actions = document.createElement("div");
    actions.className = "actions";
    const hitBtn = document.createElement("button");
    hitBtn.textContent = "Hit";
    hitBtn.classList.add("hit-btn");
    const standBtn = document.createElement("button");
    standBtn.textContent = "Stand";
    standBtn.classList.add("stand-btn");
    hitBtn.onclick = () => {
      handActed.A = true;
      renderSudden();
      socket.emit("hit", { roomId });
    };
    standBtn.onclick = () => {
      handActed.A = true;
      myFinished.A = true;
      renderSudden();
      socket.emit("stand", { roomId });
    };
    const val = handValue(myHands.A);
    const busted = val > 21;
    if (busted || myFinished.A) {
      hitBtn.disabled = true;
      standBtn.disabled = true;
    }
    actions.appendChild(hitBtn);
    actions.appendChild(standBtn);
    meBox.appendChild(actions);
    if (busted) {
      const tag = document.createElement("div");
      tag.className = "statusTag bust";
      tag.textContent = "BUST";
      meBox.appendChild(tag);
    }
    if (myFinished.A && !busted) {
      const strap = document.createElement("div");
      strap.className = "strap done";
      strap.textContent = "DONE";
      meBox.appendChild(strap);
    }
  }

  pane.appendChild(oppBox);
  pane.appendChild(meBox);
  suddenPane.appendChild(pane);
  clearResultLayer();
  hideOverlay();
  sizeAllHands();
}

/* ---------- Render (desktop-first; mobile carousel when narrow) ---------- */
function renderCard(c, facedown = false) {
  const d = document.createElement("div");
  d.className = "card";
  if (facedown) d.classList.add("facedown");
  const img = document.createElement("img");
  img.src = facedown
    ? "https://deckofcardsapi.com/static/img/back.png"
    : cardImgUrl(c);
  img.alt = "card";
  d.appendChild(img);
  return d;
}

function render() {
  purgeOverlays();

  // labels, scoreboard, redraw bar
  document.body.classList.toggle("sudden-mode", mode === "sudden");
  document.body.classList.toggle("sudden-single", mode === "sudden");
  phaseEl.textContent =
    mode === "sudden" && stage === "strategy"
      ? "Sudden Death · Strategy"
      : mode === "sudden"
      ? "Sudden Death"
      : stage === "play"
      ? `Hand ${activeHand}`
      : "";

  const inStrategy = stage === "strategy";
  const shouldPulse = inStrategy && !meReady;
  redrawBar?.classList.toggle("hidden", !inStrategy);
  redrawBar?.classList.toggle("pulse", shouldPulse);
  document.body.classList.toggle("is-redraw-phase", inStrategy && !meReady);
  if (inStrategy && mode === "sudden") {
    const helperEl = redrawBar?.querySelector(".helper");
    if (helperEl) helperEl.textContent = "Sudden Death: you may redraw one card before play begins.";
  }
  if (redrawStatus) {
    if (!inStrategy) redrawStatus.textContent = "";
    else if (meReady) redrawStatus.textContent = "Strategy locked.";
    else if (mode === "sudden") {
      redrawStatus.textContent = redrawUsed ? "Redraw used. Lock when ready." : "Redraw a card or lock strategy.";
    } else if (redrawUsed && !doubleAvailable)
      redrawStatus.textContent = "Abilities spent. Lock strategy when ready.";
    else if (redrawUsed)
      redrawStatus.textContent = "Redraw used — double another hand or lock strategy.";
    else if (!doubleAvailable)
      redrawStatus.textContent = "Double used — redraw a card or lock strategy.";
    else redrawStatus.textContent = "Use redraw, double, or lock strategy when ready.";
  }

  scoreChip.textContent = `SCORE ${scoreYou} – ${scoreOpp}`;

  // Sudden death single-pane
  if (mode === "sudden") {
    aiArea.innerHTML = "";
    playerArea.innerHTML = "";
    renderSudden();
    return;
  }

  aiArea.innerHTML = "";
  playerArea.innerHTML = "";

  const aiLabel = Object.assign(document.createElement("div"), { className: "area-label", textContent: "Opponent" });
  aiArea.appendChild(aiLabel);
  const youLabel = Object.assign(document.createElement("div"), { className: "area-label yours", textContent: "Your Hands" });
  playerArea.appendChild(youLabel);

  /* === MOBILE CAROUSEL START === */
  if (isMobile()) {
    const keys = ["A", "B", "C"];
    const car = handCarousel();
    if (car) car.innerHTML = "";

    const activeIdx = orderIndex(activeHand);

    keys.forEach(k => {
      const idx = orderIndex(k);
      const isActive = (stage === "play" && idx === activeIdx);
      const isFuture = (stage === "play" && idx > activeIdx);
      const isPast = (stage === "play" && idx < activeIdx);

      const pane = document.createElement("div");
      pane.className = "pane";
      pane.dataset.key = k;
      if (isActive) pane.classList.add("active");
      if (isFuture) pane.classList.add("future");
      if (isPast) pane.classList.add("past");

      const stack = document.createElement("div");
      stack.className = "stack";

      // Opponent
      const oppBox = document.createElement("div");
      oppBox.className = "hand opp-hand";
      oppBox.appendChild(createHandHeader(`Opponent Hand ${k}`));
      const oppCards = Object.assign(document.createElement("div"), { className: "cards" });
      const oppShow = oppHands[k] || [];
      oppShow.forEach(c => oppCards.appendChild(renderCard(c, c.r === "?")));
      oppBox.appendChild(oppCards);
      if (stage === "play" && activeHand === k && !opponentFinished[k] && !handResults[k]) {
        oppBox.appendChild(Object.assign(document.createElement("div"), { className: "strap thinking", textContent: "thinking..." }));
      }
      if (stage === "play" && opponentFinished[k] && !handResults[k] && !oppDoubled[k]) {
        oppBox.appendChild(Object.assign(document.createElement("div"), { className: "strap done", textContent: "DONE" }));
      }
      if (oppNatural[k]) {
        oppBox.appendChild(
          Object.assign(document.createElement("div"), {
            className: "strap natural",
            textContent: "BLACKJACK!",
          })
        );
      }

      // You
      const meBox = document.createElement("div");
      meBox.className = "hand player-hand";
      meBox.appendChild(createHandHeader(`Your Hand ${k}`, handValue(myHands[k] || [])));
      const meCards = Object.assign(document.createElement("div"), { className: "cards" });
      (myHands[k] || []).forEach((c, i) => {
        const d = document.createElement("div");
        d.className = "card";
        if (stage === "strategy" && !redrawUsed && !meReady && !myLocked[k]) {
          d.classList.add("redrawable");
          d.title = "Click to redraw this card";
          d.tabIndex = 0;
          d.onclick = () => socket.emit("redraw_card", { roomId, handKey: k, cardIndex: i });
          d.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              socket.emit("redraw_card", { roomId, handKey: k, cardIndex: i });
            }
          };
        }
        const img = document.createElement("img");
        img.src = cardImgUrl(c);
        img.alt = "card";
        d.appendChild(img);
        meCards.appendChild(d);
      });
      meBox.appendChild(meCards);
      if (youDoubled[k]) {
        attachDoubleToken(meBox, true);
      }
      if (myNatural[k]) {
        meBox.appendChild(
          Object.assign(document.createElement("div"), {
            className: "strap natural",
            textContent: "BLACKJACK!",
          })
        );
      }

      if (stage === "strategy" && mode !== "sudden") {
        const controls = document.createElement("div");
        controls.className = "strategy-actions";
        const doubleBtn = document.createElement("button");
        doubleBtn.textContent = youDoubled[k] ? "Doubled" : "Double";
        doubleBtn.classList.add("double-btn");
        doubleBtn.disabled = !canUseDouble(k);
        doubleBtn.onclick = () => triggerDouble(k);
        if (youDoubled[k]) doubleBtn.disabled = true;
        controls.appendChild(doubleBtn);
        meBox.appendChild(controls);
      }

      if (stage === "play" && activeHand === k && !myLocked[k]) {
        const actions = document.createElement("div");
        actions.className = "actions";
        const hitBtn = document.createElement("button");
        hitBtn.textContent = "Hit";
        hitBtn.classList.add("hit-btn");
        const standBtn = document.createElement("button");
        standBtn.textContent = "Stand";
        standBtn.classList.add("stand-btn");

        hitBtn.onclick = () => {
          handActed[k] = true;
          render();
          socket.emit("hit", { roomId });
        };
        standBtn.onclick = () => {
          handActed[k] = true;
          myFinished[k] = true;
          render();
          socket.emit("stand", { roomId });
        };

        const myVal = handValue(myHands[k]);
        const busted = myVal > 21;
        if (myFinished[k]) {
          hitBtn.disabled = true;
          standBtn.disabled = true;
        }
        if (busted) {
          meBox.appendChild(
            Object.assign(document.createElement("div"), {
              className: "statusTag bust",
              textContent: "BUST",
            })
          );
        }

        actions.appendChild(hitBtn);
        actions.appendChild(standBtn);
        meBox.appendChild(actions);

        if ((myFinished[k] || busted) && !handResults[k]) {
          meBox.appendChild(
            Object.assign(document.createElement("div"), {
              className: "strap done",
              textContent: "DONE",
            })
          );
        }
      }

      stack.appendChild(oppBox);
      stack.appendChild(meBox);
      pane.appendChild(stack);
      handCarousel()?.appendChild(pane);
    });

    // dots + scroll
    const d = dots();
    if (d) {
      d.innerHTML = "";
      ["A", "B", "C"].forEach((_, i) => {
        const b = document.createElement("button");
        if (i === activeIdx) b.classList.add("active");
        b.onclick = () => { const c = handCarousel(); if (c) c.scrollLeft = i * c.clientWidth; };
        d.appendChild(b);
      });
    }
    if (handCarousel()) {
      handCarousel().onscroll = () => {
        const i = Math.round(handCarousel().scrollLeft / handCarousel().clientWidth) || 0;
        dots()?.querySelectorAll("button").forEach((b, idx) => b.classList.toggle("active", idx === i));
        scheduleOverlayUpdate();
      };
      if (stage === "play") {
        handCarousel().scrollLeft = activeIdx * handCarousel().clientWidth;
        setTimeout(scheduleOverlayUpdate, 180);
      }
    }

    sizeAllHands();
    renderOverlay();
    return; // IMPORTANT: prevent desktop rows from rendering too
  }
  /* === MOBILE CAROUSEL END === */

  /* === MOBILE CAROUSEL END === */


  // Opponent row
  ["A", "B", "C"].forEach((k) => {
    const box = document.createElement("div");
    box.className = `hand opp-hand${stage === "play" && activeHand === k ? " active active-turn" : ""}`;
    box.id = `hand-opp-${k}`; // Stable ID for targeting
    box.style.position = "relative"; // Ensure relative for overlays (explicit JS > CSS)

    const header = createHandHeader(`Opponent Hand ${k}`);
    const row = document.createElement("div");
    row.className = "cards";
    const show = oppHands[k] || [];
    show.forEach((c, i) => {
      const facedown = c.r === "?";
      const cardEl = renderCard(c, facedown);
      const uid = getCardUid("opp", k, i, c);
      if (!seenCards.has(uid)) {
        cardEl.classList.add("deal-anim");
        seenCards.add(uid);
      }
      row.appendChild(cardEl);
    });
    box.appendChild(header);
    box.appendChild(row);
    if (stage === "play" && activeHand === k && !opponentFinished[k] && !handResults[k]) {
      box.appendChild(
        Object.assign(document.createElement("div"), {
          className: "strap thinking",
          textContent: "thinking...",
        })
      );
    }
    if (stage === "play" && opponentFinished[k] && !handResults[k] && !oppDoubled[k]) {
      box.appendChild(
        Object.assign(document.createElement("div"), {
          className: "strap done",
          textContent: "DONE",
        })
      );
    }
    if (oppNatural[k]) {
      box.appendChild(
        Object.assign(document.createElement("div"), {
          className: "strap natural",
          textContent: "BLACKJACK!",
        })
      );
    }
    aiArea.appendChild(box);
  });

  // Your row
  ["A", "B", "C"].forEach((k) => {
    const box = document.createElement("div");
    box.className = `hand player-hand${stage === "play" && activeHand === k ? " active active-turn" : ""}`;
    box.id = `hand-you-${k}`; // Stable ID for targeting
    box.style.position = "relative"; // Ensure relative for overlays (explicit JS > CSS)
    if (stage === "play" && orderIndex(k) > orderIndex(activeHand))
      box.classList.add("muted");

    const header = createHandHeader(
      `Your Hand ${k}`,
      handValue(myHands[k] || [])
    );

    const row = document.createElement("div");
    row.className = "cards";
    (myHands[k] || []).forEach((c, i) => {
      const d = document.createElement("div");
      d.className = "card";

      const uid = getCardUid("you", k, i, c);
      if (!seenCards.has(uid)) {
        // Sparkle if this is the redrawn card
        const isRedrawTarget =
          redrawUsed &&
          redrawTarget &&
          redrawTarget.handKey === k &&
          redrawTarget.cardIndex === i;

        if (isRedrawTarget) {
          d.classList.add("sparkle-anim");
        } else {
          d.classList.add("deal-anim");
        }
        seenCards.add(uid);
      }

      if (stage === "strategy" && !redrawUsed && !meReady && !myLocked[k] && (!isTutorial || (k === "A" && i === 0))) {
        d.classList.add("redrawable");
        d.title = "Click to redraw this card";
        d.tabIndex = 0;
        d.onclick = () =>
          socket.emit("redraw_card", { roomId, handKey: k, cardIndex: i });
        d.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            socket.emit("redraw_card", { roomId, handKey: k, cardIndex: i });
          }
        };
      }
      const img = document.createElement("img");
      img.src = cardImgUrl(c);
      img.alt = "card";
      d.appendChild(img);
      row.appendChild(d);
    });
    box.appendChild(header);
    box.appendChild(row);
    if (youDoubled[k]) {
      const dt = document.createElement("div");
      dt.className = "double-token";
      dt.textContent = "2x";
      row.appendChild(dt);
    }
    if (myNatural[k]) {
      box.appendChild(
        Object.assign(document.createElement("div"), {
          className: "strap natural",
          textContent: "BLACKJACK!",
        })
      );
    }

    if (stage === "strategy" && mode !== "sudden") {
      const stratControls = document.createElement("div");
      stratControls.className = "strategy-actions";

      if (!youDoubled[k] && canUseDouble(k) && (!isTutorial || k === "C")) {
        const doubleBtn = document.createElement("button");
        doubleBtn.textContent = "Double";
        doubleBtn.classList.add("double-btn");
        doubleBtn.onclick = () => triggerDouble(k);
        stratControls.appendChild(doubleBtn);
        box.appendChild(stratControls);
      }
    }

    if (stage === "play" && activeHand === k) {
      const actions = document.createElement("div");
      actions.className = "actions";
      const hitBtn = document.createElement("button");
      hitBtn.textContent = "Hit";
      const standBtn = document.createElement("button");
      standBtn.textContent = "Stand";
      hitBtn.onclick = () => {
        handActed[k] = true;
        render();
        socket.emit("hit", { roomId });
      };
      standBtn.onclick = () => {
        handActed[k] = true;
        myFinished[k] = true;
        render();
        socket.emit("stand", { roomId });
      };
      const myVal = handValue(myHands[k]);
      const busted = myVal > 21;
      if (myFinished[k]) {
        hitBtn.disabled = true;
        standBtn.disabled = true;
      }

      if (busted) {
        const tag = document.createElement("div");
        tag.className = "statusTag bust";
        tag.textContent = "BUST";
        box.appendChild(tag);
      }

      actions.appendChild(hitBtn);
      actions.appendChild(standBtn);
      box.appendChild(actions);

      if (myFinished[k] && !busted && !handResults[k]) {
        const strap = document.createElement("div");
        strap.className = "strap done";
        strap.textContent = "DONE";
        box.appendChild(strap);
      }
    }
    playerArea.appendChild(box);
  });

  sizeAllHands();
  renderOverlay();
  checkTutorial();
}

/* ---------- Boot ---------- */
applyMobileMode();
render();

/* ---------- Robust UI events ---------- */
// Delegation so it works even if the button is rendered later
document.addEventListener("click", (e) => {
  const t = e.target;

  // Play Now -> Start matching/queue
  if (t.closest && t.closest("#playBtn")) {
    e.preventDefault();
    statusEl.textContent =
      "Waiting for an opponent… (share the link in the address bar)";
    socket.emit("queue_play");
  }

  // Intro "Play" CTA -> Just close intro to reveal Play Now button
  if (t.id === "introPlay") {
    e.preventDefault();
    closeIntro();
  }
});

// Optional: Skip redraw button (if present)
if (skipBtn) {
  skipBtn.onclick = () => {
    console.log("[client] Lock Strategy clicked. Room:", roomId);
    socket.emit("start_play", { roomId });
  };
}

// Open intro immediately on load? No, use new landing flow.
// setTimeout(openIntro, 500); 
initLanding();

/* ---------- Onboarding Logic ---------- */
// Variables moved to top


function initLanding() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get("room");

  if (roomId) {
    // Joining existing session
    $("#landingContent").classList.add("hidden");
    $("#waitingState").classList.remove("hidden");
    $(".status-text").textContent = "Joining session...";
    socket.emit("join_private_match", { roomId });
  } else {
    // Fresh landing
    $("#startSessionBtn").onclick = () => {
      socket.emit("create_private_match");
      $("#landingContent").classList.add("hidden");
      $("#waitingState").classList.remove("hidden");
    };

    const tutBtn = $("#startTutorialBtnMain");
    if (tutBtn) {
      tutBtn.onclick = () => {
        // Use existing flow: request tutorial room
        isTutorial = true;
        tutorialStarted = false; // Reset just in case
        socket.emit("request_tutorial");
        $("#landingContent").classList.add("hidden");
        $(".status-text").textContent = "Starting tutorial...";
      };
    }
    // Check for tutorial seen
    if (!localStorage.getItem("bjd_tutorial_seen")) {
      // We could highlight the tutorial button later?
    }
  }

  $("#openTabBtn").onclick = () => {
    window.open(window.location.href, "_blank");
  };

  $("#copyLinkBtn").onclick = copyInvite;
  $("#copyLinkBtnWait").onclick = copyInvite;
}

function copyInvite() {
  const url = $("#shareLinkInput").value || window.location.href;
  navigator.clipboard.writeText(url);
  const btn = this; // button clicked
  const orig = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => btn.textContent = orig, 1500);
}

socket.on("session_created", ({ roomId, url }) => {
  const fullUrl = window.location.origin + window.location.pathname + url;
  window.history.pushState({}, "", url);
  $("#shareLinkInput").value = fullUrl;
});

socket.on("error_msg", ({ text }) => {
  alert(text);
  window.location.href = window.location.pathname; // reset
});

/* --- Tutorial & Bot UI --- */
const tutorialModal = $("#tutorialModal");
const botModal = $("#botModal");
const tutorialSuccessModal = $("#tutorialSuccessModal");

// Obsolete listeners removed (start/skip handled by tutorialSteps or landing)

$("#finishTutorialBtn").onclick = () => {
  tutorialSuccessModal.classList.add("hidden");
  window.location.href = window.location.pathname; // Reset to landing
};

$("#playBotBtn").onclick = () => {
  botModal.classList.add("hidden");
  socket.emit("request_bot_match");
};

$("#playHumanBtn").onclick = () => {
  botModal.classList.add("hidden");
  // Reset to landing
  window.location.href = window.location.pathname;
};

/* --- Tutorial Manager --- */
let isTutorialMode = false; // distinct from logic flag if needed, using scope var 'isTutorial'
let currentStepIdx = 0;

function checkTutorial() {
  if (!isTutorial) {
    removePopover();
    return;
  }

  const step = tutorialSteps[currentStepIdx];
  if (!step) return; // Done or waiting

  // Check completion
  if (step.isDone && step.isDone()) {
    currentStepIdx++;
    removePopover();
    checkTutorial();
    return;
  }

  // Check visibility
  if (step.canShow && !step.canShow()) {
    removePopover();
    return;
  }

  if (step.onShow && step.id !== lastShownStepId) {
    step.onShow();
    lastShownStepId = step.id;
  }

  renderPopover(step);
}

let lastShownStepId = null;

function removePopover() {
  const existing = document.getElementById("active-popover");
  if (existing) existing.remove();

  // Clean up overlay and highlights
  const overlay = document.querySelector(".tutorial-overlay");
  if (overlay) overlay.remove();

  document.querySelectorAll(".tutorial-highlight").forEach(el => {
    el.classList.remove("tutorial-highlight");
    // Restore original z-index/position if needed, but CSS handles standard cleanup
  });
}

function renderPopover(step) {
  // Always ensure target is highlighted (in case of re-render)
  const target = document.querySelector(step.target);
  if (!target) return; // Target not found

  // Highlight Target
  // The target needs to be > 1999 to be visible/clickable above overlay.
  // .tutorial-highlight in CSS is z-index: 5001.
  document.querySelectorAll(".tutorial-highlight").forEach(el => el.classList.remove("tutorial-highlight"));
  target.classList.add("tutorial-highlight");

  // Ensure relative positioning
  const style = window.getComputedStyle(target);
  if (style.position === "static") {
    target.style.position = "relative";
  }

  if (document.getElementById("active-popover")) return; // already showing popover UI

  // 1. Create Overlay
  let overlay = document.querySelector(".tutorial-overlay");



  const el = document.createElement("div");
  el.id = "active-popover";
  el.className = "tutorial-popover";

  // Sanitize message to remove potential hidden artifacts
  const cleanMsg = (step.msg || "").replace(/[^\x20-\x7E]/g, "").trim();
  let html = `<div class="popover-content">${cleanMsg}</div>`;
  if (step.action) {
    html += `<div class="popover-actions"><button id="popoverBtn" class="popover-btn">${step.action}</button></div>`;
  }

  // Arrow placeholder - we'll append correct one later
  const arrow = document.createElement("div");
  arrow.style.position = "absolute";
  arrow.style.left = "50%";
  arrow.style.marginLeft = "-6px";

  el.innerHTML = html;
  el.appendChild(arrow);

  if (step.action) el.classList.add("interactive");
  document.body.appendChild(el);

  // Position
  const rect = target.getBoundingClientRect();
  const placement = step.placement || "bottom";

  // Dynamic centering based on actual width
  const elWidth = el.offsetWidth;
  const left = rect.left + (rect.width / 2) - (elWidth / 2);
  el.style.left = `${left}px`;

  if (placement === "top") {
    // Place above target
    const bottom = window.innerHeight - rect.top + 15;
    el.style.bottom = `${bottom}px`;
    el.style.top = "auto";
    arrow.className = "popover-arrow-bottom";
    arrow.style.bottom = "-6px";
  } else {
    // Default bottom
    const top = rect.bottom + 15 + window.scrollY;
    el.style.top = `${top}px`;
    el.style.bottom = "auto";
    arrow.className = "popover-arrow-top";
    arrow.style.top = "-6px";
  }

  const btn = el.querySelector("#popoverBtn");
  if (btn) {
    btn.onclick = () => {
      const step = tutorialSteps[currentStepIdx];
      if (step && step.onComplete) step.onComplete();
      currentStepIdx++;
      removePopover();
      checkTutorial();
    };
  }
}

let tutorialTimerStart = 0;

// tutorialStarted moved to top


const tutorialSteps = [
  {
    id: "welcome",
    target: null, // Modal handles UI
    msg: "",
    canShow: () => isTutorial && !tutorialStarted,
    onShow: () => {
      // FORCE HIDE ANY OVERLAY
      if (typeof hideOverlay === "function") { hideOverlay(); setTimeout(hideOverlay, 50); }

      const m = document.getElementById("tutorialModal");
      if (m) {
        m.classList.remove("hidden");
        const btn = m.querySelector("#startTutorialBtn");
        if (btn) btn.onclick = () => {
          m.classList.add("hidden");
          tutorialStarted = true;
          // Signal server we are ready to start strategy (skip briefing)
          socket.emit("dismiss_briefing", { roomId });
          // Advance immediately
          checkTutorial();
        };
      }
    },
    isDone: () => tutorialStarted
  },
  {
    id: "strategy_wait",
    target: "#table",
    msg: "Waiting for Strategy Phase...",
    canShow: () => stage !== "strategy",
    isDone: () => stage === "strategy"
  },
  {
    id: "strategy_intro",
    target: "#hand-you-A",
    placement: "top",
    msg: "Let's start selecting a card to redraw from this hand. Click Next to start the countdown, then select a card to redraw it.",
    action: "Next",
    canShow: () => stage === "strategy",
    onShow: () => {
      console.log("Pausing timer for intro");
      socket.emit("tutorial_pause", { roomId });
    },
    onComplete: () => {
      console.log("Resuming timer for redraw");
      socket.emit("tutorial_resume", { roomId });
      tutorialTimerStart = Date.now();
    },
    isDone: () => false
  },
  {
    id: "double_intro",
    target: "#hand-you-C",
    placement: "top",
    msg: "Tap the double button on this hand to double its score if you win it. Tap next to unpause the timer and advance.",
    action: "Next",
    canShow: () => stage === "strategy" && redrawUsed,
    onShow: () => {
      socket.emit("tutorial_pause", { roomId });
    },
    onComplete: () => {
      socket.emit("tutorial_resume", { roomId });
    },
    isDone: () => false
  },
  {
    id: "lock_explain",
    target: "#skipBtn",
    placement: "top",
    msg: "You have now finished with your strategy session. Click 'Lock Strategy' to proceed.",
    action: "Lock Strategy",
    onAction: () => {
      const btn = document.getElementById("skipBtn");
      if (btn) btn.click();
    },
    canShow: () => stage === "strategy" && youDoubled.C,
    onShow: () => {
      socket.emit("tutorial_pause", { roomId });
    },
    isDone: () => meReady
  },
  {
    id: "play_wait",
    target: "#table",
    msg: "Waiting for Play Phase...",
    canShow: () => stage !== "play",
    isDone: () => stage === "play"
  },
  {
    id: "handA_hit_tut",
    target: "#hand-you-A",
    placement: "top",
    msg: "Hand A is 16. Hit to get closer to 21.",
    canShow: () => stage === "play" && activeHand === "A" && !myFinished.A && (myHands.A || []).length === 2,
    onShow: () => {
      console.log(`[Tutorial] Show Hit Step. activeHand=${activeHand}, room.stage=${stage}`);
      console.log("Hand A element style:", window.getComputedStyle(document.querySelector("#hand-you-A")).zIndex);
    },
    isDone: () => (myHands.A || []).length > 2
  },
  {
    id: "handA_stand",
    target: "#hand-you-A",
    msg: "Hand A is 21! Stand now.",
    canShow: () => stage === "play" && activeHand === "A" && !myFinished.A && (myHands.A || []).length > 2,
    isDone: () => myFinished.A
  },
  {
    id: "handB_hit",
    target: "#hand-you-B",
    msg: "Hand B is 15. Hit to get closer to 21.",
    canShow: () => stage === "play" && activeHand === "B" && !myFinished.B && (myHands.B || []).length === 2,
    isDone: () => (myHands.B || []).length > 2
  },
  {
    id: "handB_stand_hidden",
    target: "#hand-you-B",
    msg: "You busted with 25! But your opponent doesn't know. Stand now to bluff a strong hand.",
    canShow: () => stage === "play" && activeHand === "B" && !myFinished.B && (myHands.B || []).length > 2,
    isDone: () => myFinished.B
  },
  /* Hand C is already finished (Doubled), so no step needed for it */
  {
    id: "finish_wait",
    target: "#aiArea",
    placement: "bottom",
    msg: "You have finished your turn. The opponent is now playing their hands. Please wait...",
    canShow: () => stage === "play" && myFinished.A && myFinished.B && myFinished.C,
    isDone: () => false
  }
];


function startTutorialFlow() {
  document.body.classList.add("tutorial-active");
  currentStepIdx = 0;
  lastShownStepId = null;
  checkTutorial();
}



/* ---------- Sockets ---------- */
socket.on("waiting", () => {
  pregame.classList.remove("hidden");
  table.classList.add("hidden");
  statusEl.textContent = "Waiting for an opponent…";
});

socket.on("match_start", (d) => {
  document.body.classList.remove("tutorial-active");
  roomId = d.roomId;
  you = d.you;
  mode = "normal";
  isTutorial = !!d.isTutorial;
  isBotMatch = !!d.isBotMatch;
  if (isTutorial) currentStepIdx = 0;

  pregame.classList.add("hidden");
  table.classList.remove("hidden");
  statusEl.textContent = "";
  opponentLeft = false;
  handResults = { A: null, B: null, C: null };
  clearResultLayer();
  if (typeof hideSuddenTieDialog === "function") hideSuddenTieDialog();
  seenCards.clear();
  scoreYou = 0;
  scoreOpp = 0;
  scoreChip.textContent = "SCORE 0–0";
  doubleAvailable = true;
  doubleUsedOn = null;
  youDoubled = { A: false, B: false, C: false };
  oppDoubled = { A: false, B: false, C: false };
  myFinished = { A: false, B: false, C: false }; // reset local finished flags
  handActed = { A: false, B: false, C: false };
  myLocked = { A: false, B: false, C: false };
  oppLocked = { A: false, B: false, C: false };
  myNatural = { A: false, B: false, C: false };
  oppNatural = { A: false, B: false, C: false };
  doubleTarget = null;
  redrawTarget = null;
  handOutcomeServer = { A: null, B: null, C: null };
  renderOverlay();

  // Show rules modal to first-time players
  if (!isTutorial && !isBotMatch && !localStorage.getItem("bjd_intro_seen")) {
    tutorialModal.classList.remove("hidden");
    const btn = tutorialModal.querySelector("#startTutorialBtn");
    if (btn) {
      btn.textContent = "Got it — Let's Play";
      btn.onclick = () => {
        tutorialModal.classList.add("hidden");
        localStorage.setItem("bjd_intro_seen", "1");
      };
    }
  }
});

socket.on("state", (s) => {
  if (typeof showSuddenTieDialog === "function") {
    if (s.tiePending) showSuddenTieDialog(s.tieMsg || "ROUND DRAW");
    else hideSuddenTieDialog();
  }
  const lastStage = stage;
  stage = s.stage;
  activeHand = s.activeHand;
  myHands = s.myHands;
  oppHands = s.oppHands;

  redrawUsed = s.redrawUsed;
  opponentFinished = s.opponentFinished || { A: false, B: false, C: false };
  myFinished = s.myFinished ? { ...s.myFinished } : myFinished;
  meReady = !!s.meReady;
  oppReady = !!s.oppReady;

  doubleAvailable = typeof s.doubleAvailable === "boolean" ? s.doubleAvailable : doubleAvailable;
  myLocked = s.myLocked ? { ...s.myLocked } : myLocked;
  oppLocked = s.oppLocked ? { ...s.oppLocked } : oppLocked;
  myNatural = s.myNatural ? { ...s.myNatural } : myNatural;
  oppNatural = s.oppNatural ? { ...s.oppNatural } : oppNatural;
  doubleTarget = s.doubleTarget ?? doubleTarget;
  redrawTarget = s.redrawTarget ?? redrawTarget;
  handOutcomeServer = s.handOutcomes || handOutcomeServer;

  if (stage !== "play" || lastStage !== "play") {
    handActed = { A: false, B: false, C: false };
  }

  const newMode = s.mode || "normal";

  // Reset local-only flags only when entering SD (or new SD round)
  const enteringSudden = newMode === "sudden" && prevMode !== "sudden";
  const newSdRound =
    newMode === "sudden" && prevStage === "results" && s.stage === "play";

  if (enteringSudden || newSdRound) {
    myFinished = { A: false, B: false, C: false }; // fresh for SD
    handResults = { A: null, B: null, C: null }; // clear banners
    clearResultLayer?.();
    // Hide transition overlay when state is ready
    if (enteringSudden) {
      if (typeof hideSuddenAlert === "function") hideSuddenAlert();
    }
  }

  mode = newMode;
  document.body.classList.toggle("sudden-mode", mode === "sudden");
  document.body.classList.toggle("sudden-single", mode === "sudden");
  if (typeof s.scoreYou === "number") scoreYou = s.scoreYou;
  if (typeof s.scoreOpp === "number") scoreOpp = s.scoreOpp;
  if (stage !== "countdown") countdownSeconds = null;

  render();

  if (isMobile() && stage === "play" && mode !== "sudden") {
    scrollCarouselTo(orderIndex(activeHand));
    setTimeout(scheduleOverlayUpdate, 180);
  }

  prevMode = mode;
  prevStage = stage;
});

socket.on("redraw_timer", ({ seconds, total = 20 }) => {
  myRedrawSeconds = seconds;
  myRedrawTotal = total;
  if (stage === "strategy" && !meReady) renderOverlay();
});
socket.on("preplay_countdown", ({ seconds }) => {
  countdownSeconds = seconds;
  if (stage === "countdown") renderOverlay();
  if (seconds <= 0) {
    countdownSeconds = null;
    hideOverlay();
  }
});

/* Double status */
socket.on("double_status", ({ who, handKey, choice }) => {
  if (!choice) return;
  if (who === you) {
    youDoubled[handKey] = true;
    doubleAvailable = false;
    doubleUsedOn = handKey;
    handActed[handKey] = true;
    myLocked[handKey] = true;
    myFinished[handKey] = true;
    doubleTarget = handKey;
  } else {
    oppDoubled[handKey] = true;
    oppLocked[handKey] = true;
  }
  render();
});

/* Live scoreboard */
socket.on("score_update", ({ you: me, opp }) => {
  scoreYou = me;
  scoreOpp = opp;
  scoreChip.textContent = `SCORE ${scoreYou} – ${scoreOpp}`;
});

/* Per-hand banner */
socket.on("hand_result", ({ handKey, outcome }) => {
  handResults[handKey] = outcome;
  updateResultOverlays();
});

/* Final summary / end overlay */
socket.on("final", (data) => {
  const decide = (y, o) => {
    if (y > 21 && o > 21) return "push";
    if (y > 21) return "lose";
    if (o > 21) return "win";
    if (y > o) return "win";
    if (o > y) return "lose";
    return "push";
  };
  if (mode !== "sudden") {
    if (!handResults.A && data.yourScores?.A != null)
      handResults.A = decide(data.yourScores.A, data.oppScores.A);
    if (!handResults.B && data.yourScores?.B != null)
      handResults.B = decide(data.yourScores.B, data.oppScores.B);
    if (!handResults.C && data.yourScores?.C != null)
      handResults.C = decide(data.yourScores.C, data.oppScores.C);
    updateResultOverlays();
  } else {
    clearResultLayer();
  }

  const headline = data.bySuddenDeath
    ? data.result === "win"
      ? "🏆 WINNER BY SUDDEN DEATH!"
      : "😖 LOSER BY SUDDEN DEATH!"
    : data.result === "win"
      ? "🎉 Congrats, you won!"
      : data.result === "lose"
        ? "😬 Oh well, you lost!"
        : "🤝 It's a tie!";
  showMatchOverlay(headline, data.points ?? scoreYou, data.oppPoints ?? scoreOpp);

  oppHands = data.oppHands || oppHands;
  myHands = data.yourHands || myHands;
  stage = "results";
  render();

  if (isTutorial) {
    // Show Tutorial Success Modal
    setTimeout(() => {
      matchOverlay.classList.remove("open");
      tutorialSuccessModal.classList.remove("hidden");
      // Mark tutorial as seen
      localStorage.setItem("bjd_tutorial_seen", "true");
    }, 2000);
  } else if (isBotMatch) {
    // Standard overlay but maybe different text?
  }
});

socket.on("opponent_left", () => {
  opponentLeft = true;
  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = `<p>Opponent disconnected. Match cancelled.</p>`;
  render();
});

/* ---------- Match overlay & confetti (centered) ---------- */
/* ---------- Match overlay & confetti (fixed to body) ---------- */
let matchOverlay = null;
function showMatchOverlay(headline, youScore, oppScore) {
  if (!matchOverlay) {
    matchOverlay = document.createElement("div");
    matchOverlay.id = "matchOverlay";
    // Using class from CSS for styling
    matchOverlay.innerHTML = `
      <div class="mo-card">
        <h2 id="moTitle"></h2>
        <div id="moScore" style="font-size:18px; color:#fff; margin-bottom:20px;"></div>
        <div class="mo-actions">
          <button id="moRematch" class="primary">New Match</button>
          <button class="ghost" id="moCopy">Copy Invite Link</button>
        </div>
      </div>`;
    document.body.appendChild(matchOverlay); // Append to BODY for fixed positioning
    $("#moRematch").onclick = () => location.reload();
    $("#moCopy").onclick = () => {
      navigator.clipboard?.writeText(location.href);
      const btn = $("#moCopy");
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = orig, 2000);
    };
  }
  $("#moTitle").innerHTML = headline; // support emojis
  $("#moScore").textContent = `Final Score: You ${youScore} — Opponent ${oppScore}`;
  matchOverlay.classList.add("open");
  if (/WINNER|Congrats/i.test(headline)) fireConfetti(140);
}

function fireConfetti(burst = 20) {
  // Actually fireworks
  const colors = ["#ff4", "#f44", "#4ff", "#4f4", "#f4f"];
  const count = 40; // particles per burst

  for (let b = 0; b < burst; b++) {
    setTimeout(() => {
      // Random center for this explosion
      const cx = 10 + Math.random() * 80;
      const cy = 10 + Math.random() * 60;
      const color = colors[Math.floor(Math.random() * colors.length)];

      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "firework";
        p.style.left = `${cx}vw`;
        p.style.top = `${cy}vh`;
        p.style.color = color;
        p.style.backgroundColor = color;

        // Random velocity vector
        const angle = Math.random() * Math.PI * 2;
        const velocity = 50 + Math.random() * 150; // distance
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity;

        p.style.setProperty("--tx", `${tx}px`);
        p.style.setProperty("--ty", `${ty}px`);

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1000);
      }
    }, b * 150);
  }
}

/* Keep the overlay layout happy on orientation changes */
addEventListener("orientationchange", () => {
  if (matchOverlay?.classList.contains("open")) {
    matchOverlay.style.display = "none";
    matchOverlay.offsetHeight; // reflow
    matchOverlay.style.display = "flex";
  }
});

/* Standard cue messages */
socket.on("cue", ({ text }) => {
  console.log("CUE RECEIVED:", text);
  showToast(text);
  // Manual trigger for Sudden Death overlay to cover server delay
  if (text && text.includes("Entering Sudden Death")) {
    console.log("TRIGGERING SUDDEN ALERT");
    try { showSuddenAlert(); } catch (e) { console.error(e); }
  }
});

/* Sudden Death Draw/Tie Overlay */
let sdTieOverlay = null;
socket.on("sudden_death_tie", ({ message }) => {
  showSuddenTieDialog(message || "BOTH PLAYERS BUST!");
});

function showSuddenTieDialog(msg) {
  if (!sdTieOverlay) {
    sdTieOverlay = document.createElement("div");
    sdTieOverlay.id = "sdTieOverlay";
    sdTieOverlay.innerHTML = `
      <div class="mo-card" style="border-color:var(--gold-primary);">
        <h2 style="color:#fff; margin-bottom:10px;">ROUND DRAW</h2>
        <p id="sdTieMsg" style="font-size:20px; color:var(--gold-light); margin-bottom:20px; text-transform:uppercase;"></p>
        <p style="font-size:14px; color:#aaa; margin-bottom:30px;">Sudden Death continues until a winner is decided.</p>
        <button id="sdTiePlay" class="primary big-btn" style="width:100%;">PLAY ROUND</button>
      </div>
    `;
    sdTieOverlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:2600; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s; pointer-events:none;";
    document.body.appendChild(sdTieOverlay);

    document.getElementById("sdTiePlay").onclick = () => {
      document.getElementById("sdTiePlay").textContent = "WAITING...";
      document.getElementById("sdTiePlay").disabled = true;
      socket.emit("next_sudden_round", { roomId });
    };
  }

  document.getElementById("sdTieMsg").textContent = msg;
  document.getElementById("sdTiePlay").textContent = "PLAY ROUND";
  document.getElementById("sdTiePlay").disabled = false;

  sdTieOverlay.style.pointerEvents = "auto";
  requestAnimationFrame(() => sdTieOverlay.style.opacity = "1");
}

/* Helper to hide tie overlay */
function hideSuddenTieDialog() {
  if (sdTieOverlay) {
    sdTieOverlay.style.opacity = "0";
    sdTieOverlay.style.pointerEvents = "none";
  }
}


/* Standardized Sudden Death Transition Alert */
let sdAlertEl = null; // Ensure this doesn't conflict with any local var
function showSuddenAlert() {
  if (!sdAlertEl) {
    sdAlertEl = document.createElement("div");
    sdAlertEl.id = "suddenAlert";
    sdAlertEl.innerHTML = `
      <div style="text-align:center;">
        <h1 style="font-size:3rem; margin-bottom:0.5rem; color:#fff;">ROUND IS A DRAW</h1>
        <p style="font-size:1.5rem; letter-spacing:2px; color:#ddd;">MOVING TO SUDDEN DEATH</p>
      </div>
    `;
    document.body.appendChild(sdAlertEl);
  } else {
    sdAlertEl.innerHTML = `
      <div style="text-align:center;">
        <h1 style="font-size:3rem; margin-bottom:0.5rem; color:#fff;">ROUND IS A DRAW</h1>
        <p style="font-size:1.5rem; letter-spacing:2px; color:#ddd;">MOVING TO SUDDEN DEATH</p>
      </div>
    `;
  }

  // Transition background immediately
  document.body.classList.add("sudden-mode");

  // Show overlay
  console.log("SHOWING SUDDEN ALERT ELEMENT", sdAlertEl);
  requestAnimationFrame(() => sdAlertEl.classList.add("active"));
}


function hideSuddenAlert() {
  if (sdAlertEl) {
    sdAlertEl.classList.remove("active");
  }
}

/* Floating toast notifications */
let _activeToast = null;
function showToast(msg) {
  console.log("TOAST:", msg);
  if (_activeToast) { _activeToast.remove(); _activeToast = null; }
  const el = document.createElement("div");
  el.className = "game-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  _activeToast = el;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { if (_activeToast === el) _activeToast = null; el.remove(); }, 350);
  }, 2500);
}
