import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

function logToFile(msg) {
  try {
    fs.appendFileSync(path.join(__dirname, "server_debug.log"), new Date().toISOString() + " " + msg + "\n");
  } catch (e) {
    console.error("Log error", e);
  }
}

/* ---------- Boilerplate ---------- */
/* ---------- Boilerplate ---------- */

/* ---------- Boilerplate ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.get("/actionlog", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

const PORT = process.env.PORT || 3000;

/* ---------- Game helpers ---------- */
const SUITS = ["C", "D", "H", "S"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const rankVal = (r) => (r === "A" ? 11 : (["J", "Q", "K"].includes(r) ? 10 : Number(r)));

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function ensureDeck(room, need = 20) {
  if (room.deck.length >= need) return;
  room.deck = room.deck.concat(makeDeck()); // simple top-up; we can re-shuffle if you like
}
function handScore(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += rankVal(c.r); if (c.r === "A") aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function isNatural(cards = []) {
  if (!cards || cards.length !== 2) return false;
  const ranks = cards.map((c) => c.r);
  const hasAce = ranks.includes("A");
  const hasTenValue = ranks.some((r) => ["10", "J", "Q", "K"].includes(r));
  return hasAce && hasTenValue && handScore(cards) === 21;
}
const REVEAL_HOLD_MS = 4500; // the client reveal runs about 3.5 seconds
const MAX_HAND_CARDS = 11; // no 21-or-under hand needs more; stops endless bluff hitting
const mask = (arr) => Array(arr.length).fill({ r: "?", s: "?" });

/* ---------- Match registry ---------- */
let waiting = null;                 // socket id waiting
const rooms = new Map();            // roomId -> state
const rid = () => Math.random().toString(36).slice(2, 8);
const other = (room, me) => (room.players[0] === me ? room.players[1] : room.players[0]);
const HAND_ORDER = ["A", "B", "C"];

/* ---------- Room model ----------

room = {
  id, players:[p1,p2], deck,
  mode: 'normal' | 'sudden',
  stage: 'strategy'|'countdown'|'play'|'results',
  activeHand: 'A'|'B'|'C',             // always 'A' during sudden death
  hands: { pid: {A:[],B:[],C:[]} },    // normal match hands
  sdHands: { pid: {A:[]} },            // sudden death hands
  finished: { pid: {A:false,B:false,C:false} },
  ready:    { pid: false },            // for strategy phase only
  redrawUsed: { pid:false },
  redrawRemaining: { pid:20 },         // seconds left in strategy timer
  scores: { pid:0 },                   // live points
  doubleAvailable: { pid:true },
  doubled: { pid: {A:false,B:false,C:false} },
  timers: {
    redrawInterval:null,
    countdownInterval:null
  }
}
----------------------------------- */

function createRoom(p1, p2, { scripted = false } = {}) {
  const id = rid();
  const deck = makeDeck();

  // deal 2x3 hands
  const hands = { [p1]: { A: [], B: [], C: [] }, [p2]: { A: [], B: [], C: [] } };
  for (const pid of [p1, p2]) for (const h of ["A", "B", "C"]) hands[pid][h].push(deck.pop(), deck.pop());

  const state = {
    id,
    players: [p1, p2],
    deck,
    mode: "normal",
    hands,
    sdHands: { [p1]: { A: [] }, [p2]: { A: [] } },

    stage: "briefing",
    activeHand: "A",

    finished: { [p1]: { A: false, B: false, C: false }, [p2]: { A: false, B: false, C: false } },
    ready: { [p1]: false, [p2]: false },
    briefingReady: { [p1]: false, [p2]: false },
    redrawUsed: { [p1]: false, [p2]: false },
    redrawRemaining: { [p1]: 20, [p2]: 20 },

    scores: { [p1]: 0, [p2]: 0 },

    doubleAvailable: { [p1]: true, [p2]: true },
    doubled: { [p1]: { A: false, B: false, C: false }, [p2]: { A: false, B: false, C: false } },
    doubleTarget: { [p1]: null, [p2]: null },

    natural: { [p1]: { A: false, B: false, C: false }, [p2]: { A: false, B: false, C: false } },
    locked: { [p1]: { A: false, B: false, C: false }, [p2]: { A: false, B: false, C: false } },
    redrawTarget: { [p1]: null, [p2]: null },
    handOutcomes: { A: null, B: null, C: null },

    timers: { redrawInterval: null, countdownInterval: null },
  };

  rooms.set(id, state);
  // A scripted deal (the tutorial) replaces these hands, so don't score or announce them.
  if (!scripted) handleNaturals(state);
  // startStrategyTimer(state); // Deferred until briefing done
  return state;
}

/* ---------- Sanitize & broadcast ---------- */
function getHandsObj(room) { return room.mode === "sudden" ? room.sdHands : room.hands; }

// Returns the player's hand for handKey, or null if the key doesn't name one of their hands.
function playerHand(room, pid, handKey) {
  const hands = getHandsObj(room)[pid];
  if (typeof handKey !== "string" || !hands || !Object.prototype.hasOwnProperty.call(hands, handKey)) return null;
  return hands[handKey];
}

function sanitizeFor(room, pid) {
  const opp = other(room, pid);
  const packHands = getHandsObj(room);
  const myHands = packHands[pid];
  const revealOpp = (key) =>
    room.stage === "results" || room.natural[opp]?.[key] || room.handOutcomes[key]
      ? packHands[opp][key]
      : mask(packHands[opp][key]);
  const oppHands = Object.fromEntries(
    Object.keys(packHands[opp]).map((k) => [k, revealOpp(k)])
  );

  return {
    roomId: room.id,
    you: pid,
    mode: room.mode,
    stage: room.stage,
    activeHand: room.activeHand,
    myHands,
    oppHands,
    redrawUsed: room.redrawUsed[pid],
    opponentFinished: room.finished[opp],
    myFinished: room.finished[pid],
    meReady: room.ready[pid],
    oppReady: room.ready[opp],
    briefingReady: room.briefingReady[pid],
    scoreYou: room.scores[pid],
    scoreOpp: room.scores[opp],
    doubleAvailable: room.doubleAvailable[pid],
    myLocked: room.locked[pid],
    oppLocked: room.locked[opp],
    myNatural: room.natural[pid],
    oppNatural: room.natural[opp],
    handOutcomes: room.handOutcomes,
    // The same outcomes from this player's side: win | lose | push.
    myOutcomes: Object.fromEntries(Object.entries(room.handOutcomes).map(([k, r]) => [
      k, !r ? null : r === "tie" ? "push" : r === (room.players[0] === pid ? "p1" : "p2") ? "win" : "lose",
    ])),
    myDoubled: room.doubled[pid],
    oppDoubled: room.doubled[opp],
    doubleTarget: room.doubleTarget[pid],
    redrawTarget: room.redrawTarget[pid],
    tiePending: room.tiePending,
    tieMsg: room.tieMsg,
  };
}

function broadcast(room) {
  for (const pid of room.players) io.to(pid).emit("state", sanitizeFor(room, pid));
}

function recordHandOutcome(room, handKey, result, { announce = true } = {}) {
  if (!result || room.handOutcomes[handKey]) return;
  room.handOutcomes[handKey] = result;
  const [p1, p2] = room.players;

  if (result === "p1") {
    room.scores[p1] += 1 + (room.doubled[p1][handKey] ? 1 : 0);
  } else if (result === "p2") {
    room.scores[p2] += 1 + (room.doubled[p2][handKey] ? 1 : 0);
  }

  if (announce) {
    io.to(p1).emit("hand_result", {
      handKey,
      outcome: result === "p1" ? "win" : result === "p2" ? "lose" : "push",
    });
    io.to(p2).emit("hand_result", {
      handKey,
      outcome: result === "p2" ? "win" : result === "p1" ? "lose" : "push",
    });
  }

  io.to(p1).emit("score_update", { you: room.scores[p1], opp: room.scores[p2] });
  io.to(p2).emit("score_update", { you: room.scores[p2], opp: room.scores[p1] });
}

function ensureActiveHand(room) {
  const next = HAND_ORDER.find((k) => !room.handOutcomes[k]);
  if (!next) {
    finishMatch(room);
    return false;
  }

  // Check for pre-determined Natural Blackjack results
  const [p1, p2] = room.players;
  if (room.finished[p1][next] && room.finished[p2][next]) {
    const n1 = room.natural[p1][next];
    const n2 = room.natural[p2][next];
    // Only auto-resolve if at least one is natural (which implies handleNaturals ran on it)
    if (n1 || n2) {
      const winner = n1 && n2 ? "tie" : n1 ? "p1" : "p2";
      recordHandOutcome(room, next, winner, { announce: true });
      // Recurse to find the *next* active hand (or finish if done)
      return ensureActiveHand(room);
    }
  }

  room.activeHand = next;

  // Auto-resolve any Doubled hands (player receives 1 card then finishes)
  autoResolveDoubledHands(room, next);

  return true;
}

function autoResolveDoubledHands(room, handKey) {
  let changed = false;
  const hands = getHandsObj(room); // Handles sudden death check if needed

  for (const pid of room.players) {
    if (room.doubled[pid][handKey] && !room.finished[pid][handKey]) {
      // Deal exactly one card
      ensureDeck(room, 1);
      const card = room.deck.pop();
      hands[pid][handKey].push(card);

      // Finish the hand
      room.finished[pid][handKey] = true;
      changed = true;

      // Notify (optional, broadcast covers it)
      io.to(pid).emit("cue", { text: `Doubled Hand ${handKey} resolved: ${card.r}${card.s}` });
    }
  }

  if (changed) {
    broadcast(room);
    // If both finished (e.g. both doubled, or one doubled and other finished previous), advance
    // But ensureActiveHand already found 'next' because others were done? 
    // No, 'next' is the CURRENT active hand.
    if (bothFinishedCurrent(room, handKey)) {
      // Short delay to let users see the card?
      // For now, immediate recursion is robust.
      setTimeout(() => advance(room, handKey), 4500);
    }
  }
}

function finishMatch(room) {
  if (room.mode !== "normal") return;
  if (room.stage === "results") return;

  const [p1, p2] = room.players;
  if (HAND_ORDER.some((k) => !room.handOutcomes[k])) return;

  const s1 = room.scores[p1];
  const s2 = room.scores[p2];

  if (s1 === s2) {
    if (room.timers.transition) return;

    io.to(p1).emit("cue", { text: "Tie Game! Entering Sudden Death..." });
    io.to(p2).emit("cue", { text: "Tie Game! Entering Sudden Death..." });

    // Small delay to ensure clients process final hand results
    room.timers.transition = setTimeout(() => {
      room.timers.transition = null;
      if (!rooms.has(room.id)) return;
      try {
        startSuddenDeath(room);
      } catch (e) {
        console.error("Sudden Death Error:", e);
      }
    }, 3000);
    return;
  }

  room.stage = "results";

  const finaleP1 = {
    yourHands: room.hands[p1],
    oppHands: room.hands[p2],
    yourScores: {
      A: handScore(room.hands[p1].A),
      B: handScore(room.hands[p1].B),
      C: handScore(room.hands[p1].C),
    },
    oppScores: {
      A: handScore(room.hands[p2].A),
      B: handScore(room.hands[p2].B),
      C: handScore(room.hands[p2].C),
    },
  };

  io.to(p1).emit("final", {
    ...finaleP1,
    perHand: room.handOutcomes,
    points: s1,
    oppPoints: s2,
    result: s1 > s2 ? "win" : "lose",
    bySuddenDeath: false,
  });

  const finaleP2 = {
    yourHands: room.hands[p2],
    oppHands: room.hands[p1],
    yourScores: {
      A: handScore(room.hands[p2].A),
      B: handScore(room.hands[p2].B),
      C: handScore(room.hands[p2].C),
    },
    oppScores: {
      A: handScore(room.hands[p1].A),
      B: handScore(room.hands[p1].B),
      C: handScore(room.hands[p1].C),
    },
  };

  io.to(p2).emit("final", {
    ...finaleP2,
    perHand: room.handOutcomes,
    points: s2,
    oppPoints: s1,
    result: s2 > s1 ? "win" : "lose",
    bySuddenDeath: false,
  });

  broadcast(room);
}

function handleNaturals(room) {
  const [p1, p2] = room.players;
  for (const key of HAND_ORDER) {
    const n1 = isNatural(room.hands[p1][key]);
    const n2 = isNatural(room.hands[p2][key]);
    if (!n1 && !n2) continue;

    room.natural[p1][key] = n1;
    room.natural[p2][key] = n2;

    room.locked[p1][key] = true;
    room.locked[p2][key] = true;
    room.finished[p1][key] = true;
    room.finished[p2][key] = true;

    if (n1) {
      io.to(p1).emit("cue", { text: `Hand ${key}: Natural Blackjack!` });
      io.to(p2).emit("cue", { text: `Opponent revealed a Natural Blackjack on Hand ${key}.` });
    }
    if (n2) {
      io.to(p2).emit("cue", { text: `Hand ${key}: Natural Blackjack!` });
      io.to(p1).emit("cue", { text: `Opponent revealed a Natural Blackjack on Hand ${key}.` });
    }

    // DEFERRED SCORING: Do NOT record outcome here.
    // ensureActiveHand will pick it up when it's time (or immediately if it's the first hand).
  }

  // Skip past any resolved natural hands before play begins
  ensureActiveHand(room);
}

/* ---------- Resolving ---------- */
function resolveHand(room, key, sudden = false) {
  const [p1, p2] = room.players;
  const pack = sudden ? room.sdHands : room.hands;
  const s1 = handScore(pack[p1][key]);
  const s2 = handScore(pack[p2][key]);
  const b1 = s1 > 21, b2 = s2 > 21;

  if (b1 && b2) return "tie";
  if (b1) return "p2";
  if (b2) return "p1";
  if (s1 > s2) return "p1";
  if (s2 > s1) return "p2";
  return "tie";
}

/* ---------- Timers ---------- */
function startStrategyTimer(room) {
  const [p1, p2] = room.players;
  const timerTotal = room.mode === "sudden" ? 10 : 20;

  io.to(p1).emit("redraw_timer", { seconds: room.redrawRemaining[p1], total: timerTotal });
  io.to(p2).emit("redraw_timer", { seconds: room.redrawRemaining[p2], total: timerTotal });

  room.timers.redrawInterval = setInterval(() => {
    let changed = false;

    for (const pid of room.players) {
      if (room.stage !== "strategy") break;

      if (!room.ready[pid] && room.redrawRemaining[pid] > 0) {
        if (!room.isTutorial && !room.timerPaused) {
          room.redrawRemaining[pid] -= 1;
          io.to(pid).emit("redraw_timer", { seconds: room.redrawRemaining[pid], total: timerTotal });
        }
      }

      if (!room.ready[pid] && room.redrawRemaining[pid] <= 0) {
        room.ready[pid] = true; // auto-skip
        changed = true;
        io.to(pid).emit("cue", { text: "Timer up: locking in strategy." });
        io.to(other(room, pid)).emit("cue", { text: "Opponent locked strategy." });
      }
    }

    if (changed) broadcast(room);

    // If both are ready, advance to countdown and stop this interval
    if (room.ready[p1] && room.ready[p2]) {
      clearInterval(room.timers.redrawInterval);
      room.timers.redrawInterval = null;
      startPreplayCountdown(room, 3);
    }
  }, 1000);
}

function startPreplayCountdown(room, seconds = 3) {
  room.stage = "countdown";
  broadcast(room);

  let t = seconds;
  for (const pid of room.players) io.to(pid).emit("preplay_countdown", { seconds: t });

  room.timers.countdownInterval = setInterval(() => {
    t -= 1;
    for (const pid of room.players) io.to(pid).emit("preplay_countdown", { seconds: t });

    if (t <= 0) {
      clearInterval(room.timers.countdownInterval);
      room.timers.countdownInterval = null;
      room.stage = "play";
      if (!ensureActiveHand(room)) return;
      broadcast(room);
    }
  }, 1000);
}

/* ---------- Sudden death ---------- */
function startSuddenDeath(room) {
  room.mode = "sudden";
  room.stage = "strategy"; // 10-second redraw window before play
  room.activeHand = "A";

  const [p1, p2] = room.players;
  room.sdHands[p1].A = [];
  room.sdHands[p2].A = [];
  ensureDeck(room, 10);
  room.sdHands[p1].A.push(room.deck.pop(), room.deck.pop());
  room.sdHands[p2].A.push(room.deck.pop(), room.deck.pop());

  room.ready[p1] = false;
  room.ready[p2] = false;

  room.finished[p1] = { A: false, B: false, C: false };
  room.finished[p2] = { A: false, B: false, C: false };
  room.locked[p1] = { A: false, B: false, C: false };
  room.locked[p2] = { A: false, B: false, C: false };
  room.doubleAvailable[p1] = false; // no doubling in sudden death
  room.doubleAvailable[p2] = false;
  room.redrawUsed[p1] = false;      // one redraw each allowed
  room.redrawUsed[p2] = false;
  room.redrawRemaining[p1] = 10;
  room.redrawRemaining[p2] = 10;
  room.redrawTarget[p1] = null;
  room.redrawTarget[p2] = null;
  room.doubleTarget[p1] = null;
  room.doubleTarget[p2] = null;
  room.handOutcomes = { A: null, B: null, C: null };
  room.tiePending = false;
  room.tieMsg = null;
  room.nextSuddenReady = { [p1]: false, [p2]: false };
  // Main-round Doubles and Naturals don't carry into Sudden Death.
  room.doubled[p1] = { A: false, B: false, C: false };
  room.doubled[p2] = { A: false, B: false, C: false };
  room.natural[p1] = { A: false, B: false, C: false };
  room.natural[p2] = { A: false, B: false, C: false };

  // A Natural dealt in Sudden Death wins outright; two Naturals are a draw and the hand is replayed.
  const n1 = isNatural(room.sdHands[p1].A);
  const n2 = isNatural(room.sdHands[p2].A);
  if (n1 || n2) {
    for (const [pid, natural] of [[p1, n1], [p2, n2]]) {
      room.natural[pid].A = natural;
      room.locked[pid].A = true;
      room.finished[pid].A = true;
      if (natural) {
        io.to(pid).emit("cue", { text: "Sudden Death: Natural Blackjack!" });
        io.to(other(room, pid)).emit("cue", { text: "Opponent revealed a Natural Blackjack." });
      }
    }
    room.stage = "play";
    broadcast(room);
    room.timers.transition = setTimeout(() => {
      room.timers.transition = null;
      if (rooms.has(room.id)) advance(room, "A");
    }, 2000);
    return;
  }

  broadcast(room);
  startStrategyTimer(room);
}

/* ---------- Sockets ---------- */
io.on("connection", (socket) => {
  // Legacy queue_play (optional, keeping for compatibility if needed, but UI uses new flow)
  socket.on("queue_play", () => {
    if (!waiting) {
      waiting = socket.id;
      socket.emit("waiting");
    } else if (waiting !== socket.id) {
      const opp = waiting; waiting = null;
      const room = createRoom(opp, socket.id);
      io.to(opp).emit("match_start", { roomId: room.id, you: opp });
      io.to(socket.id).emit("match_start", { roomId: room.id, you: socket.id });
      broadcast(room);
    }
  });

  /* --- New Onboarding Flow --- */

  socket.on("create_private_match", () => {
    const roomId = rid();
    // Create a "pending" room or just store it? 
    // We'll create a room structure but with only 1 player initially.
    // Actually, createRoom expects 2 players. We need a way to support 1 player waiting.
    // Let's store a pending invite.
    rooms.set(roomId, {
      id: roomId,
      pending: true,
      owner: socket.id,
      players: [socket.id]
    });
    socket.emit("session_created", { roomId, url: `?room=${roomId}` });
  });

  socket.on("join_private_match", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("error_msg", { text: "Session not found or expired." });
      return;
    }
    if (!room.pending) {
      // already full?
      socket.emit("error_msg", { text: "Session is full." });
      return;
    }

    // Convert from pending to real room
    const p1 = room.owner;
    const p2 = socket.id;
    if (p1 === p2) return; // prevent self-join if same socket?

    // Re-create as full room
    const realRoom = createRoom(p1, p2);
    realRoom.id = roomId; // keep same ID
    rooms.set(roomId, realRoom);

    io.to(p1).emit("match_start", { roomId, you: p1 });
    io.to(p2).emit("match_start", { roomId, you: p2 });
    broadcast(realRoom);
  });

  /* --- Tutorial & Bot --- */
  socket.on("request_tutorial", () => {
    // Create a room with a "Bot" but strictly scripted
    const roomId = rid();
    const botId = "BOT_TUTORIAL";
    const room = createRoom(socket.id, botId, { scripted: true });
    room.isTutorial = true;

    // Override deck with deterministic tutorial deck
    room.deck = [
      // Player Hand A: Needs to be decent but improvable. e.g. 6 + 5 = 11 (Good for double)
      { r: "6", s: "H" }, { r: "5", s: "C" },
      // Player Hand B: Weak, needs redraw. e.g. 2 + 3 = 5
      { r: "2", s: "D" }, { r: "3", s: "S" },
      // Player Hand C: Natural BJ? Or just normal. Let's say K + 9 = 19
      { r: "K", s: "C" }, { r: "9", s: "D" },

      // Bot Hands (Hidden initially)
      // Bot A: 10 + 7 = 17 (Stand)
      { r: "10", s: "S" }, { r: "7", s: "H" },
      // Bot B: 10 + 5 = 15 (Hit -> Bust)
      { r: "10", s: "D" }, { r: "5", s: "H" },
      // Bot C: 10 + 8 = 18
      { r: "10", s: "H" }, { r: "8", s: "C" },

      // Extra cards for hits/redraws
      // Redraw for Player B: get a 10 => 15 (Hit -> 5 => 20)
      // Let's seed the deck stack for draws. 
      // pop() takes from END.
      // We need to stack them in reverse order of drawing.

      // ... logic for deck construction is tricky with pop().
      // Let's just hardcode the hands in createRoom if isTutorial logic exists, but here we are patching.
      // Simpler: Just set the hands directly.
    ];

    // Set specific hands for tutorial
    room.hands[socket.id].A = [{ r: "6", s: "H" }, { r: "5", s: "C" }]; // 11
    room.hands[socket.id].B = [{ r: "10", s: "D" }, { r: "5", s: "S" }]; // 15
    room.hands[socket.id].C = [{ r: "8", s: "C" }, { r: "3", s: "D" }]; // 11 (Double)

    room.hands[botId].A = [{ r: "10", s: "S" }, { r: "7", s: "H" }]; // 17
    room.hands[botId].B = [{ r: "10", s: "D" }, { r: "5", s: "H" }]; // 15
    room.hands[botId].C = [{ r: "10", s: "H" }, { r: "Q", s: "C" }]; // 20

    // IMPORTANT: Clear "Natural" flags and "Finished/Locked" states from initial random deal
    room.natural[socket.id] = { A: false, B: false, C: false };
    room.natural[botId] = { A: false, B: false, C: false };
    room.finished[socket.id] = { A: false, B: false, C: false };
    room.finished[botId] = { A: false, B: false, C: false };
    room.locked[socket.id] = { A: false, B: false, C: false };
    room.locked[botId] = { A: false, B: false, C: false };
    room.redrawUsed[socket.id] = false;
    room.redrawUsed[botId] = false;

    // Reset Outcomes and Scores to prevent pre-mature advancement
    room.handOutcomes = { A: null, B: null, C: null };
    room.scores = { [socket.id]: 0, [botId]: 0 };
    room.doubled[socket.id] = { A: false, B: false, C: false };
    room.doubled[socket.id] = { A: false, B: false, C: false };
    room.doubled[botId] = { A: false, B: false, C: false };

    // CRITICAL: Reset active hand pointer in case initial deal advanced it
    room.activeHand = "A";
    logToFile(`[Init Tutorial ${room.id}] Forced Active=A. P1_FinA=${room.finished[socket.id].A}`);

    // Stack deck for predictable draws (Reverse order):
    // 4. Hand C Double: 10 => 21.
    // 3. Hand B Hit: 10 => 25.
    // 2. Hand A Hit: 5 => 21.
    // 1. Hand A Redraw: 10 => 16.
    room.deck = [
      { r: "K", s: "H" }, // 5. Hand C Double (10)
      { r: "Q", s: "D" }, // 4. Bot Hand B Hit (10) => Bust
      { r: "J", s: "S" }, // 3. Player Hand B Hit (10) => Bust
      { r: "5", s: "D" }, // 2. Player Hand A Hit (5) => 21
      { r: "10", s: "C" } // 1. Player Hand A Redraw (10) => 16
    ];


    rooms.set(roomId, room);
    socket.emit("match_start", { roomId, you: socket.id, isTutorial: true });

    // Auto-ready bot
    room.briefingReady[botId] = true;
    room.ready[botId] = true;
    broadcast(room);

    // Bot logic loop
    startBotLoop(room, botId);
  });

  socket.on("request_bot_match", () => {
    const roomId = rid();
    const botId = "BOT_OPPONENT";
    const room = createRoom(socket.id, botId);
    room.isBotMatch = true;
    rooms.set(roomId, room);

    socket.emit("match_start", { roomId, you: socket.id, isBotMatch: true });

    // Auto-ready bot for briefing
    room.briefingReady[botId] = true;
    broadcast(room);

    // Bot logic loop
    startBotLoop(room, botId);
  });

  socket.on("dismiss_briefing", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;

    room.briefingReady[socket.id] = true;

    // Notify opponent (optional, but good for UI "Waiting..." status)
    const opp = other(room, socket.id);
    io.to(opp).emit("cue", { text: "Opponent is ready." });

    // Check if both ready
    const [p1, p2] = room.players;
    if (room.briefingReady[p1] && room.briefingReady[p2]) {
      room.stage = "strategy";
      startStrategyTimer(room);
    }
    broadcast(room);
  });

  socket.on("redraw_card", ({ roomId, handKey, cardIndex }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    if (room.stage !== "strategy" || room.ready[socket.id]) return;

    if (room.redrawUsed[socket.id]) return;

    // Only a real card in one of this player's own hands can be redrawn.
    const hand = playerHand(room, socket.id, handKey);
    if (!hand || !Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= hand.length) return;
    // A Doubled hand, or a Natural that has already been scored, is locked.
    if (room.locked[socket.id][handKey] || room.doubled[socket.id][handKey]) {
      socket.emit("cue", { text: `Hand ${handKey} is locked and can't be redrawn.` });
      return;
    }

    ensureDeck(room, 5);
    const newCard = room.deck.pop();
    hand.splice(cardIndex, 1, newCard);

    room.redrawUsed[socket.id] = true;
    room.redrawTarget[socket.id] = { handKey, cardIndex };

    io.to(other(room, socket.id)).emit("cue", { text: "Opponent redrew a card." });
    broadcast(room);
  });

  socket.on("double_choice", ({ roomId, handKey }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    if (room.stage !== "strategy" || room.ready[socket.id]) return;

    if (!room.doubleAvailable[socket.id]) return;
    if (room.mode !== "normal" || !HAND_ORDER.includes(handKey)) return;
    // A Natural is already a win, and a Redrawn hand can't also be Doubled.
    if (room.natural[socket.id][handKey] || room.locked[socket.id][handKey] ||
        room.redrawTarget[socket.id]?.handKey === handKey) {
      socket.emit("cue", { text: `Hand ${handKey} can't be doubled.` });
      return;
    }

    room.doubleAvailable[socket.id] = false;
    room.doubled[socket.id][handKey] = true;
    room.locked[socket.id][handKey] = true;
    room.doubleTarget[socket.id] = handKey;

    io.to(other(room, socket.id)).emit("cue", { text: `Opponent doubled Hand ${handKey}.` });
    broadcast(room);
  });

  socket.on("tutorial_pause", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    console.log(`[tutorial_pause] Room ${roomId} paused`);
    room.timerPaused = true;
  });

  socket.on("tutorial_resume", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    console.log(`[tutorial_resume] Room ${roomId} resumed`);
    room.timerPaused = false;
  });

  socket.on("start_play", ({ roomId }) => {
    console.log(`[start_play] received from ${socket.id} for room ${roomId}`);
    const room = rooms.get(roomId);
    if (!room) { console.log(`[start_play] room not found`); return; }
    if (!room.players.includes(socket.id)) { console.log(`[start_play] not in room`); return; }
    console.log(`[start_play] stage=${room.stage}, ready=${room.ready[socket.id]}`);
    if (room.stage !== "strategy" || room.ready[socket.id]) return;

    room.ready[socket.id] = true;
    io.to(other(room, socket.id)).emit("cue", { text: "Opponent locked strategy." });

    const [p1, p2] = room.players;

    // Robustness: For tutorial, ensure bot is ready immediately if not already
    if (room.isTutorial) {
      const opp = other(room, socket.id);
      if (!room.ready[opp]) room.ready[opp] = true;
    }

    console.log(`[start_play] p1 ready=${room.ready[p1]}, p2 ready=${room.ready[p2]}`);
    if (room.ready[p1] && room.ready[p2]) {
      if (room.timers.redrawInterval) { clearInterval(room.timers.redrawInterval); room.timers.redrawInterval = null; }
      startPreplayCountdown(room, 3);
    }
    broadcast(room);
  });


  socket.on("hit", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    if (room.stage !== "play") return;

    const handKey = room.mode === "sudden" ? "A" : room.activeHand;
    if (room.finished[socket.id][handKey]) return;

    socket_emit_hit_logic(room, socket.id, handKey);
  });

  socket.on("stand", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    if (room.stage !== "play") return;

    const handKey = room.mode === "sudden" ? "A" : room.activeHand;
    if (room.finished[socket.id][handKey]) return;

    room.finished[socket.id][handKey] = true;
    io.to(other(room, socket.id)).emit("cue", { text: "Opponent STAND." });

    if (bothFinishedCurrent(room, handKey)) advance(room, handKey);
    broadcast(room);
  });

  socket.on("next_sudden_round", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.includes(socket.id)) return;
    if (room.mode !== "sudden" || !room.tiePending) return;

    room.nextSuddenReady[socket.id] = true;
    const opp = other(room, socket.id);
    if (room.nextSuddenReady[opp] || opp.startsWith("BOT_")) {
      startSuddenDeath(room);
    } else {
      io.to(opp).emit("cue", { text: "Opponent is ready for the next Sudden Death hand." });
    }
  });

  socket.on("disconnect", () => {
    if (waiting === socket.id) waiting = null;
    for (const [id, room] of rooms.entries()) {
      if (room.pending && room.owner === socket.id) {
        rooms.delete(id);
        continue;
      }
      if (room.players && room.players.includes(socket.id)) {
        const opp = other(room, socket.id);
        if (room.timers.redrawInterval) clearInterval(room.timers.redrawInterval);
        if (room.timers.countdownInterval) clearInterval(room.timers.countdownInterval);
        if (room.timers.transition) clearTimeout(room.timers.transition);

        // If other is bot, just kill room
        if (opp.startsWith("BOT_")) {
          rooms.delete(id);
        } else {
          io.to(opp).emit("opponent_left");
          rooms.delete(id);
        }
      }
    }
  });
});

/* ---------- Bot Logic ---------- */
function startBotLoop(room, botId) {
  // Simple periodic check
  const interval = setInterval(() => {
    if (!rooms.has(room.id)) {
      clearInterval(interval);
      return;
    }

    // DEBUG: Persistent State Logger
    if (room.isTutorial) {
      const [p1, p2] = room.players;
      const msg = `[Tick ${room.id}] Stage=${room.stage}, Active=${room.activeHand}, P1_FinA=${room.finished[p1].A}, P2_FinA=${room.finished[p2].A}`;
      logToFile(msg);
      console.log(msg);
    }

    // Strategy Phase
    if (room.stage === "strategy" && !room.ready[botId]) {
      // Wait a random bit then ready up
      if (room.redrawRemaining[botId] < 18 && Math.random() > 0.5) {
        // Maybe redraw?
        if (!room.isTutorial && !room.redrawUsed[botId] && Math.random() > 0.7) {
          ensureDeck(room, 5);
          const availHands = room.mode === "sudden" ? ["A"] : ["A", "B", "C"];
          const h = availHands[Math.floor(Math.random() * availHands.length)];
          const handPack = getHandsObj(room);
          const hand = handPack[botId][h];
          if (hand) {
            hand.splice(0, 1, room.deck.pop());
            room.redrawUsed[botId] = true;
            io.to(other(room, botId)).emit("cue", { text: "Opponent redrew a card." });
            broadcast(room);
          }
        } else {
          room.ready[botId] = true;
          io.to(other(room, botId)).emit("cue", { text: "Opponent locked strategy." });
          broadcast(room);

          // Check if both ready
          const [p1, p2] = room.players;
          if (room.ready[p1] && room.ready[p2]) {
            if (room.timers.redrawInterval) { clearInterval(room.timers.redrawInterval); room.timers.redrawInterval = null; }
            startPreplayCountdown(room, 3);
          }
        }
      }
    }

    // Play Phase
    if (room.stage === "play" && room.activeHand) {
      // Is it bot's turn?
      // Actually turns are parallel, but we need to act if not finished
      const k = room.activeHand;
      if (!room.finished[botId][k]) {
        // Delay decision
        // Delay decision (skip if not tutorial, to simulate thinking)
        if (!room.isTutorial && Math.random() > 0.4) return;

        const hand = room.hands[botId][k];
        const val = handScore(hand);
        if (val < 16) {
          // Hit
          ensureDeck(room, 2);
          hand.push(room.deck.pop());
          const oppId = other(room, botId);
          io.to(oppId).emit("cue", { text: `Opponent HIT on Hand ${k}.` });
          // A bust stays hidden: the bot stands on its next decision, like a bluffing player.
          broadcast(room);
        } else {
          // Stand
          room.finished[botId][k] = true;
          io.to(other(room, botId)).emit("cue", { text: `Opponent STAND on Hand ${k}.` });
          broadcast(room);
        }

        if (bothFinishedCurrent(room, k)) advance(room, k);
      }
    }

    // Sudden Death
    if (room.mode === "sudden" && room.stage === "play") {
      const k = "A";
      if (!room.finished[botId][k]) {
        if (Math.random() > 0.1) return;
        const hand = room.sdHands[botId][k];
        if (handScore(hand) < 17) {
          // Hit (socket_emit_hit_logic draws the card)
          socket_emit_hit_logic(room, botId, k);
        } else {
          room.finished[botId][k] = true;
          if (bothFinishedCurrent(room, k)) advance(room, k);
          broadcast(room);
        }
      }
    }

  }, 1000);
}

// Helper to reuse hit logic for bot
function socket_emit_hit_logic(room, socketId, handKey) {
  const pack = getHandsObj(room);
  const hand = pack[socketId][handKey];
  const oppId = other(room, socketId);

  // Hidden bust: going over 21 doesn't end the turn and the opponent isn't told.
  // The player can keep hitting to bluff, and the bust is revealed when the hand resolves.
  if (hand.length >= MAX_HAND_CARDS) return;

  ensureDeck(room, 2);
  hand.push(room.deck.pop());

  io.to(oppId).emit("cue", { text: "Opponent HIT." });
  broadcast(room);
}


/* helpers */
function bothFinishedCurrent(room, handKey) {
  const [p1, p2] = room.players;
  return !!(room.finished[p1][handKey] && room.finished[p2][handKey]);
}

/* ---------- Advance hand / finish match ---------- */
function advance(room, completedKey) {
  const [p1, p2] = room.players;

  if (room.mode === "sudden") {
    // resolve sudden death
    const res = resolveHand(room, "A", true);
    if (res === "tie") {
      room.ready[p1] = false;
      room.ready[p2] = false;
      const s1 = handScore(room.sdHands[p1].A);
      const s2 = handScore(room.sdHands[p2].A);
      const msg = (s1 > 21 && s2 > 21) ? "BOTH PLAYERS BUST!" : "ROUND DRAW (PUSH)";

      room.tiePending = true;
      room.tieMsg = msg;
      room.handOutcomes.A = "tie"; // reveals both hands so the draw can be shown
      broadcast(room);
      return;
    }

    // final by sudden death (winner takes all; scoreboard unchanged)
    const youView = (pid) => ({
      yourHands: room.sdHands[pid],
      oppHands: room.sdHands[other(room, pid)],
      yourScores: { A: handScore(room.sdHands[pid].A) },
      oppScores: { A: handScore(room.sdHands[other(room, pid)].A) }
    });

    room.stage = "results";
    io.to(p1).emit("final", { ...youView(p1), perHand: { A: res }, points: room.scores[p1], oppPoints: room.scores[p2], result: (res === "p1" ? "win" : "lose"), bySuddenDeath: true });
    io.to(p2).emit("final", { ...youView(p2), perHand: { A: res === "p1" ? "p2" : "p1" }, points: room.scores[p2], oppPoints: room.scores[p1], result: (res === "p2" ? "win" : "lose"), bySuddenDeath: true });
    broadcast(room);
    return;
  }

  if (!room.handOutcomes[completedKey]) {
    const res = resolveHand(room, completedKey);
    recordHandOutcome(room, completedKey, res, { announce: true });
  }

  broadcast(room); // show result before advancing
  // Hold the resolved hand on screen long enough for the client's reveal animation.
  setTimeout(() => {
    if (!rooms.has(room.id)) return;
    if (!ensureActiveHand(room)) return;
    broadcast(room);
  }, REVEAL_HOLD_MS);
}

/* ---------- Run ---------- */
server.listen(PORT, () => {
  console.log(`Blackjack Duel Graphics MVP on http://localhost:${PORT}`);
});
