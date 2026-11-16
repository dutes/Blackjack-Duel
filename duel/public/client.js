/* Blackjack Duel client.
   One layout for every screen size: three lanes (A, B, C), each with the opponent's hand at
   the top and yours at the bottom. On a phone the lanes stand side by side so the whole game
   is played one-handed; on a desktop they sit on an oval casino table.
   The server owns the rules; this file only draws its state and sends the player's choices. */

"use strict";

const $ = (s) => document.querySelector(s);
const SUITS = { H: "♥", D: "♦", C: "♣", S: "♠" };
const SUIT_NAMES = { H: "hearts", D: "diamonds", C: "clubs", S: "spades" };
const KEYS = ["A", "B", "C"];

// Reveal timeline in ms after both players finish a hand. The server holds the hand for 4.5 s.
const REVEAL = { slide: 60, razzle: 800, flip: 1900, result: 2700, settle: 3700 };

let socket;
try {
  socket = io();
} catch (e) {
  document.body.insertAdjacentHTML("afterbegin",
    '<div class="offline">The game server is offline. Start it with <code>npm start</code> and reload.</div>');
  throw e;
}

/* ---------- State ---------- */
let S = null;                 // last state from the server
let roomId = null;
let isTutorial = false;
let isBotMatch = false;
let timer = { sec: 20, total: 20 };
let countdown = null;
let reveals = {};             // key -> { step, outcome, timers[] }
let realScore = { you: 0, opp: 0 };
let shownScore = { you: 0, opp: 0 };
let afterReveal = [];         // callbacks to run once no reveal is playing
let matchOver = false;
let tutorialStarted = false;
let tutorialStep = 0;

/* ---------- Helpers ---------- */
function handValue(cards = []) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (!c || c.r === "?") continue;
    if (c.r === "A") { total += 11; aces++; }
    else if (["K", "Q", "J", "10"].includes(c.r)) total += 10;
    else total += parseInt(c.r, 10) || 0;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
const known = (cards = []) => cards.length > 0 && cards.every((c) => c.r !== "?");
const isRed = (c) => c.s === "H" || c.s === "D";
const cardName = (c) => `${c.r === "A" ? "Ace" : c.r === "K" ? "King" : c.r === "Q" ? "Queen" : c.r === "J" ? "Jack" : c.r} of ${SUIT_NAMES[c.s]}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
function setHTML(el, html) {
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}
// Like setHTML, but cards that weren't there before get the deal animation.
function setCards(el, html, sig) {
  if (!el || el._html === html) return;
  const prev = el._sig || [];
  el.innerHTML = html;
  el._html = html;
  el._sig = sig;
  [...el.children].forEach((child, i) => {
    if (prev[i] !== sig[i]) (child.classList.contains("card") ? child : child.querySelector(".card"))?.classList.add("deal");
  });
}
const sigOf = (cards) => cards.map((c) => c.r + c.s);
function laneKeys() { return S && S.mode === "sudden" ? ["A"] : KEYS; }
function anyRevealPlaying() { return Object.values(reveals).some((r) => r.step < 5); }

function faceHTML(c, extra = "") {
  return `<span class="card face ${isRed(c) ? "red" : ""} ${extra}">` +
    `<span class="corner"><b>${esc(c.r)}</b><i>${SUITS[c.s] || ""}</i></span>` +
    `<span class="pip">${SUITS[c.s] || ""}</span></span>`;
}
const BACK = '<span class="card back" aria-hidden="true"></span>';

/* ---------- Toasts ---------- */
let toastTimer = null;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------- Modal ---------- */
function showModal(html, { onOpen } = {}) {
  setHTML($("#modalCard"), html);
  $("#modal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  onOpen?.($("#modalCard"));
}
function hideModal() {
  $("#modal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  $("#modalCard")._html = null;
}

const RULES_HTML = `
  <h2 id="modalTitle">How to play</h2>
  <div class="rules">
    <p>You play blackjack <strong>against another player</strong>, not the house. You each get three hands, A, B and C, and the best total of 21 or under takes each hand.</p>
    <h3>Strategy Phase: 20 seconds</h3>
    <p>Before play starts you may <strong>redraw one card</strong> and <strong>double one different hand</strong>. A doubled hand gets exactly one more card and is worth two points.</p>
    <h3>The hidden bust</h3>
    <p>When you go over 21, your opponent isn't told. Keep hitting to bluff, or stand and act confident. Busts are only revealed when both hands are turned over.</p>
    <h3>Scoring</h3>
    <ul><li>Win a hand: 1 point (2 if doubled)</li><li>A natural blackjack wins outright</li><li>Tied after three hands: Sudden Death</li></ul>
  </div>`;

/* ---------- Lobby ---------- */
function showLobby(view) {
  $("#lobby").classList.remove("hidden");
  $("#game").classList.add("hidden");
  $("#lobbyMain").classList.toggle("hidden", view !== "main");
  $("#lobbyWaiting").classList.toggle("hidden", view !== "waiting");
}

function initLobby() {
  const joinId = new URLSearchParams(location.search).get("room");
  if (joinId) {
    showLobby("waiting");
    $("#waitingText").textContent = "Joining your friend's match…";
    socket.emit("join_private_match", { roomId: joinId });
  } else {
    showLobby("main");
  }
  $("#friendBtn").onclick = () => {
    showLobby("waiting");
    $("#waitingText").textContent = "Waiting for your friend to join…";
    socket.emit("create_private_match");
  };
  $("#botBtn").onclick = () => {
    showLobby("waiting");
    $("#waitingText").textContent = "Shuffling up…";
    socket.emit("request_bot_match");
  };
  $("#tutorialBtn").onclick = () => {
    showLobby("waiting");
    $("#waitingText").textContent = "Setting up the tutorial…";
    isTutorial = true;
    socket.emit("request_tutorial");
  };
  $("#rulesBtn").onclick = () => showModal(RULES_HTML + `<div class="modal-actions"><button class="btn gold" id="closeModal">Got it</button></div>`,
    { onOpen: (m) => (m.querySelector("#closeModal").onclick = hideModal) });
  $("#cancelBtn").onclick = () => (location.href = location.pathname);
  $("#copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText($("#inviteInput").value); $("#copyBtn").textContent = "Copied"; }
    catch { $("#inviteInput").select(); }
    setTimeout(() => ($("#copyBtn").textContent = "Copy"), 1500);
  };
  $("#openTabBtn").onclick = () => window.open($("#inviteInput").value, "_blank");
}

/* ---------- Lanes ---------- */
function buildLanes(keys) {
  const lanes = $("#lanes");
  if (lanes.dataset.keys === keys.join("")) return;
  lanes.dataset.keys = keys.join("");
  lanes.classList.toggle("single", keys.length === 1);
  lanes.innerHTML = keys.map((k) => `
    <div class="lane" id="lane-${k}" data-key="${k}">
      <div class="group opp">
        <span class="who"></span>
        <div class="cards"></div>
        <span class="total"></span>
        <div class="stamp-slot"></div>
      </div>
      <div class="mid"><span class="key"></span><span class="tag"></span></div>
      <div class="group me">
        <div class="cards"></div>
        <div class="meta"><span class="total"></span><span class="dbl-slot"></span></div>
        <div class="stamp-slot"></div>
      </div>
    </div>`).join("");
}

function canDouble(k) {
  return S.mode === "normal" && S.stage === "strategy" && S.doubleAvailable && !S.meReady &&
    !S.myDoubled?.[k] && !S.myLocked?.[k] && !S.myNatural?.[k] && S.redrawTarget?.handKey !== k &&
    (!isTutorial || k === "C");
}
function canRedraw(k, i) {
  return S.stage === "strategy" && !S.redrawUsed && !S.meReady && !S.myLocked?.[k] && !S.myDoubled?.[k] &&
    (!isTutorial || (k === "A" && i === 0));
}

function renderLane(k) {
  const lane = document.getElementById(`lane-${k}`);
  if (!lane) return;
  const sudden = S.mode === "sudden";
  const rv = reveals[k];
  const play = S.stage === "play";
  const idx = KEYS.indexOf(k), activeIdx = KEYS.indexOf(S.activeHand);
  const active = !rv && play && (sudden || S.activeHand === k) && !S.myOutcomes?.[k];
  const future = !sudden && play && idx > activeIdx && !rv;

  lane.classList.toggle("is-active", active);
  lane.classList.toggle("is-future", future);
  lane.classList.toggle("is-strategy", S.stage === "strategy" || S.stage === "briefing");

  const opp = S.oppHands?.[k] || [];
  const mine = S.myHands?.[k] || [];
  const oppG = lane.querySelector(".group.opp"), meG = lane.querySelector(".group.me");

  // Opponent label
  let who = sudden ? "OPPONENT" : "OPP";
  if (active) who += S.opponentFinished?.[k] ? " · STOOD" : ' · PLAYING<span class="dots"></span>';
  setHTML(oppG.querySelector(".who"), who + (S.oppDoubled?.[k] ? ' <span class="chip-mini">×2</span>' : ""));

  // Opponent cards: flip cards during a reveal so they can turn over
  let oppHTML;
  if (rv) {
    oppHTML = opp.map((c, i) => `<span class="flip" style="--d:${i * 140}ms">` +
      `<span class="flip-inner">${c.r === "?" ? BACK : faceHTML(c)}${BACK.replace("card back", "card back flip-back")}</span></span>`).join("");
  } else {
    oppHTML = opp.map((c) => (c.r === "?" ? BACK : faceHTML(c))).join("");
  }
  setCards(oppG.querySelector(".cards"), oppHTML, sigOf(opp));
  const oppKnown = known(opp);
  const oppTotalEl = oppG.querySelector(".total");
  const showOppTotal = oppKnown && (!rv || rv.step >= 3);
  setHTML(oppTotalEl, showOppTotal ? String(handValue(opp)) : "");
  oppTotalEl.classList.toggle("bust", showOppTotal && handValue(opp) > 21);
  oppTotalEl.classList.toggle("pop", !!rv);

  // Middle label
  setHTML(lane.querySelector(".key"), sudden ? "SD" : k);
  let tag = "";
  if (S.myNatural?.[k] || S.oppNatural?.[k]) tag = "BLACKJACK";
  else if (S.stage === "strategy" && S.myDoubled?.[k]) tag = "DOUBLED";
  else if (active && S.myFinished?.[k] && S.opponentFinished?.[k]) tag = "BOTH STOOD";
  else if (active) tag = "YOUR TURN";
  else if (future && idx === activeIdx + 1) tag = "NEXT";
  setHTML(lane.querySelector(".tag"), tag);
  lane.querySelector(".tag").classList.toggle("hidden", !tag);

  // Your cards
  const rt = S.redrawTarget;
  setCards(meG.querySelector(".cards"), mine.map((c, i) => {
    const redrawn = rt && rt.handKey === k && rt.cardIndex === i && S.stage === "strategy";
    const inner = faceHTML(c, redrawn ? "redrawn" : "");
    if (canRedraw(k, i)) {
      return `<button type="button" class="card-btn" data-act="redraw" data-k="${k}" data-i="${i}" aria-label="Redraw the ${cardName(c)} in hand ${k}">${inner}</button>`;
    }
    return redrawn ? `<span class="redrawn-wrap"><span class="redrawn-tag">Redrawn</span>${inner}</span>` : inner;
  }).join(""), sigOf(mine));
  const myTotal = handValue(mine);
  const myTotalEl = meG.querySelector(".total");
  setHTML(myTotalEl, mine.length ? String(myTotal) : "");
  myTotalEl.classList.toggle("bust", myTotal > 21);

  // Double chip
  let dbl = "";
  if (S.myDoubled?.[k]) dbl = '<span class="chip" aria-label="Doubled">×2</span>';
  else if (canDouble(k)) dbl = `<button type="button" class="chip dbl" data-act="double" data-k="${k}" aria-label="Double hand ${k}">×2</button>`;
  setHTML(meG.querySelector(".dbl-slot"), dbl);

  // Reveal classes and stamps
  lane.classList.toggle("rv", !!rv);
  lane.classList.toggle("rv-slid", !!rv && rv.step >= 1);
  lane.classList.toggle("rv-razzle", !!rv && rv.step === 2);
  lane.classList.toggle("rv-flipped", !!rv && rv.step >= 3);
  lane.classList.toggle("rv-result", !!rv && rv.step >= 4);
  lane.classList.toggle("rv-settled", !!rv && rv.step >= 5);
  const myKind = rv ? stampKind(rv.outcome, myTotal, "win") : "";
  const oppKind = rv ? stampKind(rv.outcome, handValue(opp), "lose") : "";
  lane.classList.toggle("rv-bust", !!rv && rv.step >= 4 && myKind === "BUST");
  setHTML(meG.querySelector(".stamp-slot"), rv && rv.step >= 4 ? stampHTML(myKind) : "");
  setHTML(oppG.querySelector(".stamp-slot"), rv && rv.step >= 4 ? stampHTML(oppKind) : "");
  oppG.classList.toggle("loser", !!rv && rv.step >= 4 && rv.outcome === "win");
  meG.classList.toggle("loser", !!rv && rv.step >= 4 && rv.outcome === "lose" && myKind !== "BUST");
}

function stampKind(outcome, total, winWhen) {
  if (outcome === winWhen) return "WIN";
  if (total > 21) return "BUST";
  return outcome === "push" ? "PUSH" : "LOSS";
}
function stampHTML(kind) {
  const rings = kind === "WIN" || kind === "BUST" ? '<i class="ring r1"></i><i class="ring r2"></i>' : "";
  return `${rings}<span class="stamp ${kind.toLowerCase()}">${kind}</span>`;
}

/* Squeeze fanned cards so a long hand still fits its lane */
function fitCards() {
  document.querySelectorAll(".lane .cards").forEach((row) => {
    const cards = row.querySelectorAll(".card:not(.flip-back)");
    const n = row.children.length;
    if (!n || !cards.length) return;
    const w = cards[0].offsetWidth;
    const avail = row.closest(".lane").clientWidth - 10;
    const base = parseFloat(getComputedStyle(row).getPropertyValue("--ov-base")) || 0;
    const need = n > 1 ? (n * w - avail) / (n - 1) : 0;
    row.style.setProperty("--ov", `${Math.max(base, Math.ceil(need))}px`);
  });
}

/* ---------- Reveal ---------- */
function measureSlide(k) {
  const lane = document.getElementById(`lane-${k}`);
  if (!lane) return;
  const wasSlid = lane.classList.contains("rv-slid");
  lane.classList.add("measuring");                     // no transitions while measuring
  lane.classList.remove("rv-slid");                    // measure from the resting position
  const mid = lane.querySelector(".mid").getBoundingClientRect();
  const o = lane.querySelector(".group.opp").getBoundingClientRect();
  const m = lane.querySelector(".group.me").getBoundingClientRect();
  const centre = mid.top + mid.height / 2;
  const gap = 6;
  lane.style.setProperty("--opp-shift", `${Math.round(centre - gap - o.height - o.top)}px`);
  lane.style.setProperty("--my-shift", `${Math.round(centre + gap - m.top)}px`);
  if (wasSlid) lane.classList.add("rv-slid");
  void lane.offsetWidth;
  lane.classList.remove("measuring");
}

function startReveal(k, outcome, animate = true) {
  if (reveals[k]) return;
  const rv = { step: animate ? 0 : 5, outcome, timers: [] };
  reveals[k] = rv;
  render();
  measureSlide(k);
  if (!animate) { render(); return; }
  const go = (ms, step) => rv.timers.push(setTimeout(() => {
    rv.step = step;
    if (step === 4) shownScore = { ...realScore };
    render();
    if (step === 5) flushAfterReveal();
  }, ms));
  go(REVEAL.slide, 1); go(REVEAL.razzle, 2); go(REVEAL.flip, 3); go(REVEAL.result, 4); go(REVEAL.settle, 5);
}

function clearReveals() {
  for (const rv of Object.values(reveals)) rv.timers.forEach(clearTimeout);
  reveals = {};
}

function whenRevealsDone(fn) {
  if (anyRevealPlaying()) afterReveal.push(fn);
  else fn();
}
function flushAfterReveal() {
  if (anyRevealPlaying()) return;
  const queue = afterReveal; afterReveal = [];
  queue.forEach((fn) => fn());
}

/* ---------- Header, overlay and controls ---------- */
function renderHeader() {
  const inMatch = !!S;
  $("#scoreline").classList.toggle("hidden", !inMatch);
  $("#phaseBox").classList.toggle("hidden", !inMatch);
  if (!inMatch) return;
  if (!anyRevealPlaying()) shownScore = { ...realScore };
  $("#scoreText").textContent = `${shownScore.opp} – ${shownScore.you}`;

  const sudden = S.mode === "sudden";
  let phase = "";
  if (S.stage === "briefing") phase = "GET READY";
  else if (S.stage === "strategy") phase = sudden ? "SUDDEN DEATH · STRATEGY" : "STRATEGY";
  else if (S.stage === "countdown") phase = "GET READY";
  else if (S.stage === "play") phase = sudden ? "SUDDEN DEATH" : `HAND ${S.activeHand}`;
  else if (S.stage === "results") phase = "MATCH OVER";
  $("#phaseText").textContent = phase;

  const timed = S.stage === "strategy" && !S.meReady && !isTutorial;
  $("#timer").classList.toggle("hidden", !timed);
  $("#timerText").classList.toggle("hidden", !timed);
  if (timed) {
    $("#timerFill").style.width = `${Math.max(0, Math.min(100, (timer.sec / timer.total) * 100))}%`;
    $("#timerFill").classList.toggle("low", timer.sec <= 5);
    $("#timerText").textContent = `${timer.sec}s`;
  }
}

function renderOverlay() {
  const el = $("#feltOverlay");
  if (S.stage === "countdown" && countdown > 0) {
    setHTML(el, `<span class="count">${countdown}</span>`);
    el.firstChild.style.animation = "none"; void el.firstChild.offsetWidth; el.firstChild.style.animation = "";
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderControls() {
  const c = $("#controls");
  const sudden = S.mode === "sudden";
  const k = sudden ? "A" : S.activeHand;
  let html = "";

  if (S.stage === "briefing") {
    html = isTutorial ? "" : S.briefingReady
      ? `<p class="caption">Waiting for your opponent to get ready…</p>`
      : `<p class="caption">You get <strong>20 seconds</strong> to redraw one card and double one other hand.</p>
         <button type="button" class="btn gold wide" data-act="ready">I'm ready</button>`;
  } else if (S.stage === "strategy") {
    if (S.meReady) {
      html = `<p class="caption">Strategy locked. Waiting for your opponent…</p>`;
    } else {
      let cap;
      if (sudden) cap = S.redrawUsed ? "Redraw used. Lock in when you're ready." : "Sudden Death: tap a card to redraw it, then lock in.";
      else if (!S.redrawUsed && S.doubleAvailable) cap = 'Tap a card to redraw it, or a <strong class="gold-t">×2</strong> chip to double a different hand.';
      else if (!S.redrawUsed) cap = "Doubled. You can still redraw a card in another hand.";
      else if (S.doubleAvailable) cap = 'Redraw used. You can still <strong class="gold-t">×2</strong> a different hand.';
      else cap = "Both moves used. Lock in your strategy.";
      html = `<p class="caption">${cap}</p><button type="button" class="btn gold wide" id="lockBtn" data-act="lock">Lock strategy</button>`;
    }
  } else if (S.stage === "countdown") {
    html = `<p class="caption">Strategy locked. Play starts in a moment…</p>`;
  } else if (S.stage === "play") {
    const rv = reveals[k];
    const total = handValue(S.myHands?.[k]);
    if (rv && rv.step < 5) {
      html = `<p class="caption">Revealing ${sudden ? "the Sudden Death hand" : `Hand ${k}`}…</p>`;
    } else if (rv || S.myOutcomes?.[k]) {
      html = `<p class="caption">Next hand coming up…</p>`;
    } else if (S.myFinished?.[k]) {
      html = `<p class="caption">${S.myDoubled?.[k] ? `Hand ${k} is doubled: one card dealt.` : `You're done on ${sudden ? "this hand" : `Hand ${k}`}.`} Waiting for your opponent…</p>`;
    } else {
      const label = sudden ? "Sudden Death" : `Hand ${k}`;
      const cap = total > 21
        ? `${label}: <strong class="red-t">${total}, you're bust</strong>, but your opponent can't see it. Keep hitting to bluff, or stand.`
        : `${label}: <strong>${total}</strong>. Hit or stand?`;
      html = `<p class="caption">${cap}</p>
        <div class="btn-row">
          <button type="button" class="btn light wide" id="hitBtn" data-act="hit">Hit</button>
          <button type="button" class="btn outline wide" id="standBtn" data-act="stand">Stand</button>
        </div>`;
    }
  } else if (S.stage === "results") {
    html = `<p class="caption">Match over.</p>`;
  }
  setHTML(c, html);
}

function render() {
  renderHeader();
  if (!S) return;
  buildLanes(laneKeys());
  laneKeys().forEach(renderLane);
  renderOverlay();
  renderControls();
  fitCards();
  checkTutorial();
}

/* ---------- Player actions ---------- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t || !roomId) return;
  const act = t.dataset.act;
  if (act === "redraw") socket.emit("redraw_card", { roomId, handKey: t.dataset.k, cardIndex: Number(t.dataset.i) });
  else if (act === "double") socket.emit("double_choice", { roomId, handKey: t.dataset.k, choice: true });
  else if (act === "lock") socket.emit("start_play", { roomId });
  else if (act === "ready") socket.emit("dismiss_briefing", { roomId });
  else if (act === "hit") socket.emit("hit", { roomId });
  else if (act === "stand") { t.disabled = true; socket.emit("stand", { roomId }); }
});

/* ---------- Socket events ---------- */
socket.on("session_created", ({ url }) => {
  const full = location.origin + location.pathname + url;
  history.replaceState({}, "", url);
  $("#inviteInput").value = full;
  $("#inviteBox").classList.remove("hidden");
});

socket.on("error_msg", ({ text }) => {
  showModal(`<h2 id="modalTitle">Can't join</h2><p>${esc(text)}</p>
    <div class="modal-actions"><button class="btn gold" id="backBtn">Back to the menu</button></div>`,
    { onOpen: (m) => (m.querySelector("#backBtn").onclick = () => (location.href = location.pathname)) });
});

socket.on("waiting", () => showLobby("waiting"));

socket.on("match_start", (d) => {
  roomId = d.roomId;
  isTutorial = !!d.isTutorial;
  isBotMatch = !!d.isBotMatch;
  clearReveals();
  realScore = { you: 0, opp: 0 };
  shownScore = { you: 0, opp: 0 };
  matchOver = false;
  tutorialStep = 0;
  tutorialStarted = false;
  $("#lobby").classList.add("hidden");
  $("#game").classList.remove("hidden");
  document.body.classList.add("in-match");

  if (isTutorial) {
    showModal(`<h2 id="modalTitle">Welcome to Blackjack Duel</h2>
      <p>This tutorial walks you through one match against a bot. Scoring is normal blackjack, but you play another player, best of three hands.</p>
      <p>The twist is the <strong>hidden bust</strong>: you won't know if your opponent has gone over 21 until the hands are revealed, and they won't know about yours.</p>
      <div class="modal-actions"><button class="btn gold" id="tutStart">Start the tutorial</button></div>`,
      { onOpen: (m) => (m.querySelector("#tutStart").onclick = () => {
        hideModal();
        tutorialStarted = true;
        socket.emit("dismiss_briefing", { roomId });
      }) });
  } else if (!isBotMatch && !localStorage.getItem("bjd_rules_seen")) {
    showModal(RULES_HTML + `<div class="modal-actions"><button class="btn gold" id="closeModal">Let's play</button></div>`,
      { onOpen: (m) => (m.querySelector("#closeModal").onclick = () => { localStorage.setItem("bjd_rules_seen", "1"); hideModal(); }) });
  }
});

socket.on("state", (s) => {
  const prev = S;
  S = s;
  if (typeof s.scoreYou === "number") realScore = { you: s.scoreYou, opp: s.scoreOpp };

  // A new Sudden Death hand clears the previous reveal
  const newSudden = s.mode === "sudden" && (!prev || prev.mode !== "sudden" || (prev.tiePending && !s.tiePending));
  if (newSudden) { clearReveals(); hideModal(); }

  // Hands that were decided without a reveal (e.g. naturals at the deal) are shown settled
  if (s.mode === "normal") {
    for (const k of KEYS) if (s.myOutcomes?.[k] && !reveals[k]) startReveal(k, s.myOutcomes[k], s.stage === "play");
  }

  // A tied Sudden Death hand: reveal it, then offer the next hand
  if (s.mode === "sudden" && s.tiePending && !reveals.A) {
    startReveal("A", "push", true);
    whenRevealsDone(() => {
      if (!S.tiePending) return;
      showModal(`<h2 id="modalTitle">${esc(S.tieMsg || "Draw")}</h2>
        <p>Sudden Death carries on until somebody wins a hand.</p>
        <div class="modal-actions"><button class="btn gold" id="nextSd">Play the next hand</button></div>`,
        { onOpen: (m) => (m.querySelector("#nextSd").onclick = (e) => {
          e.target.disabled = true; e.target.textContent = "Waiting for your opponent…";
          socket.emit("next_sudden_round", { roomId });
        }) });
    });
  }
  render();
});

socket.on("redraw_timer", ({ seconds, total = 20 }) => {
  timer = { sec: seconds, total };
  if (S) renderHeader();
});

socket.on("preplay_countdown", ({ seconds }) => {
  countdown = seconds;
  if (S) renderOverlay();
});

socket.on("score_update", ({ you, opp }) => {
  realScore = { you, opp };
  if (S) renderHeader();
});

socket.on("hand_result", ({ handKey, outcome }) => {
  // Hands resolved before play (naturals at the deal) appear without the animation
  startReveal(handKey, outcome, !!S && S.stage === "play");
});

socket.on("final", (data) => {
  matchOver = true;
  if (data.bySuddenDeath) startReveal("A", data.result, true);
  whenRevealsDone(() => showFinal(data));
});

function showFinal(data) {
  const won = data.result === "win";
  const title = data.bySuddenDeath
    ? (won ? "You win in Sudden Death" : "You lose in Sudden Death")
    : won ? "You win the duel" : data.result === "lose" ? "You lose the duel" : "It's a draw";
  const score = `<p class="final-score"><span>You</span> ${data.points ?? realScore.you} – ${data.oppPoints ?? realScore.opp} <span>Opponent</span></p>`;
  if (isTutorial) {
    localStorage.setItem("bjd_tutorial_seen", "1");
    showModal(`<h2 id="modalTitle">Tutorial complete</h2>${score}
      <p>That's everything: redraw, double, the hidden bust and the reveal. Ready for a real opponent?</p>
      <div class="modal-actions"><button class="btn gold" id="botAgain">Play the bot</button><button class="btn outline" id="menuBtn">Back to the menu</button></div>`,
      { onOpen: (m) => {
        m.querySelector("#botAgain").onclick = () => { hideModal(); isTutorial = false; socket.emit("request_bot_match"); };
        m.querySelector("#menuBtn").onclick = () => (location.href = location.pathname);
      } });
  } else {
    showModal(`<h2 id="modalTitle" class="${won ? "win-t" : ""}">${title}</h2>${score}
      <div class="modal-actions"><button class="btn gold" id="againBtn">${isBotMatch ? "Play the bot again" : "New match"}</button><button class="btn outline" id="menuBtn">Menu</button></div>`,
      { onOpen: (m) => {
        m.querySelector("#againBtn").onclick = () => { if (isBotMatch) { hideModal(); socket.emit("request_bot_match"); } else location.href = location.pathname; };
        m.querySelector("#menuBtn").onclick = () => (location.href = location.pathname);
      } });
  }
  if (won) celebrate();
}

socket.on("opponent_left", () => {
  if (matchOver) return;
  showModal(`<h2 id="modalTitle">Your opponent left</h2><p>The match has ended.</p>
    <div class="modal-actions"><button class="btn gold" id="menuBtn">Back to the menu</button></div>`,
    { onOpen: (m) => (m.querySelector("#menuBtn").onclick = () => (location.href = location.pathname)) });
});

socket.on("cue", ({ text }) => {
  if (/Entering Sudden Death/i.test(text)) {
    showModal(`<h2 id="modalTitle" class="sd-title">Sudden Death</h2><p>Tied after three hands. One hand each, winner takes the match.</p>`);
    setTimeout(() => { if (!S || !S.tiePending) hideModal(); }, 2600);
    return;
  }
  toast(text);
});

/* ---------- Celebration ---------- */
function celebrate() {
  const colours = ["#E3C77A", "#FFF1C2", "#F4EFE2", "#7FDDA4"];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("i");
    p.className = "confetti";
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = colours[i % colours.length];
    p.style.animationDelay = `${Math.random() * 600}ms`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 160}px`);
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 3200);
  }
}

/* ---------- Tutorial ---------- */
const myTotal = (k) => handValue(S?.myHands?.[k]);
const tutorialSteps = [
  {
    target: "#lane-A .group.me",
    msg: () => "This is the Strategy Phase. Tap the first card in Hand A to swap it for a new one from the deck.",
    show: () => S.stage === "strategy" && !S.redrawUsed,
    done: () => S.redrawUsed || S.stage !== "strategy",
  },
  {
    target: "#lane-C .dbl",
    msg: () => `Hand C is ${myTotal("C")}, a good hand to double. Tap ×2: it gets one more card and a win is worth two points.`,
    show: () => S.stage === "strategy" && S.redrawUsed && !S.myDoubled?.C,
    done: () => S.myDoubled?.C || S.stage !== "strategy",
  },
  {
    target: "#lockBtn",
    msg: () => "Plan set. Lock in your strategy.",
    show: () => S.stage === "strategy" && !S.meReady,
    done: () => S.meReady || S.stage !== "strategy",
  },
  {
    target: "#hitBtn",
    msg: () => `Hand A is ${myTotal("A")}. Hit to get closer to 21.`,
    show: () => S.stage === "play" && S.activeHand === "A" && !S.myFinished?.A && S.myHands.A.length === 2,
    done: () => S.myHands.A.length > 2 || S.myFinished?.A || (S.stage === "play" && S.activeHand !== "A"),
  },
  {
    target: "#standBtn",
    msg: () => `${myTotal("A")}. Stand now and watch the hands get revealed.`,
    show: () => S.stage === "play" && S.activeHand === "A" && !S.myFinished?.A,
    done: () => S.myFinished?.A || (S.stage === "play" && S.activeHand !== "A"),
  },
  {
    target: "#hitBtn",
    msg: () => `Hand B is ${myTotal("B")}. Hit.`,
    show: () => S.stage === "play" && S.activeHand === "B" && !S.myFinished?.B && S.myHands.B.length === 2,
    done: () => S.myHands.B.length > 2 || S.myFinished?.B || (S.stage === "play" && S.activeHand === "C"),
  },
  {
    target: "#standBtn",
    msg: () => myTotal("B") > 21
      ? `Bust on ${myTotal("B")}! Your opponent can't see that. Stand now and bluff a strong hand.`
      : `${myTotal("B")}. Stand.`,
    show: () => S.stage === "play" && S.activeHand === "B" && !S.myFinished?.B,
    done: () => S.myFinished?.B,
  },
];

function checkTutorial() {
  const pop = $("#popover");
  document.querySelectorAll(".tut-hl").forEach((el) => el.classList.remove("tut-hl"));
  if (!isTutorial || !tutorialStarted || !S) { pop.classList.add("hidden"); return; }
  while (tutorialSteps[tutorialStep] && tutorialSteps[tutorialStep].done()) tutorialStep++;
  const step = tutorialSteps[tutorialStep];
  const target = step && step.show() ? document.querySelector(step.target) : null;
  if (!target) { pop.classList.add("hidden"); return; }
  target.classList.add("tut-hl");
  pop.textContent = step.msg();
  pop.classList.remove("hidden");
  const r = target.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
  const above = r.top - ph - 14 > 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${above ? r.top - ph - 14 : r.bottom + 14}px`;
  pop.classList.toggle("below", !above);
  pop.style.setProperty("--arrow-x", `${Math.max(16, Math.min(pw - 16, r.left + r.width / 2 - left))}px`);
}

/* ---------- Boot ---------- */
addEventListener("resize", () => {
  if (!S) return;
  fitCards();
  for (const k of Object.keys(reveals)) measureSlide(k);
  checkTutorial();
});
initLobby();
