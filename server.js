// Ludo with Landmines — online server
// Runs the game for everyone in a room. No extra installs: just Node.js.
// Start:  node server.js      then open http://localhost:3000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

/* ============================== RULES ============================== */
const N = 39, SEC = 13, HOME0 = 39, END = 42;          // field steps 0..38, home lane 39..42
const abs = (p, rel) => (p * SEC + rel) % N;
const isStart = a => a % SEC === 0;
const isOE = a => a % SEC === 6;                          // odds/evens: 6 steps after each start
const d6 = () => 1 + crypto.randomInt(6);
const range = (a, b) => { const r = []; if (b >= a) for (let x = a; x <= b; x++) r.push(x); else for (let x = a; x >= b; x--) r.push(x); return r; };

const z3 = () => [0, 0, 0];
function newStats() {
  return { rolls: [0, 1, 2].map(() => [0, 0, 0, 0, 0, 0]), steps: z3(), kills: [z3(), z3(), z3()], mineKills: [z3(), z3(), z3()], planted: z3(), oeRight: z3(), oeWrong: z3() };
}
function newGame() {
  return {
    pawns: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]], mines: {},
    cur: 0, phase: 'opening', die: null, rollsLeft: 0, bonus: false, moves: [], oe: null, winner: null,
    open: { contenders: [0, 1, 2], vals: {}, done: false, winner: null }, startedAt: Date.now(), endedAt: null, stats: newStats(),
  };
}
function fieldPawnsAt(G, a) { const r = []; G.pawns.forEach((ps, p) => ps.forEach((rel, i) => { if (rel >= 0 && rel <= 38 && abs(p, rel) === a) r.push({ p, i }); })); return r; }
function noField(G, p) { return !G.pawns[p].some(r => r >= 0 && r <= 38); }
function homeTidy(G, p) { const h = G.pawns[p].filter(r => r >= HOME0).sort((a, b) => a - b), k = h.length; for (let j = 0; j < k; j++) if (h[j] !== END - k + 1 + j) return false; return true; }
function rollsAllowed(G, p) { return noField(G, p) ? (homeTidy(G, p) ? 3 : 1) : 1; }

function legal(G, p, r) {
  const ps = G.pawns[p], moves = [];
  if (r === 6 && ps.includes(-1)) moves.push({ t: 'enter' });
  const seen = new Set();
  for (const rel of ps) {
    if (rel < 0 || seen.has(rel)) continue; seen.add(rel);
    const t = rel + r;
    if (t <= 38) { moves.push({ t: 'move', from: rel, to: t }); continue; }
    if (t > END) continue;
    let ok = true;
    for (let k = Math.max(rel + 1, HOME0); k <= t; k++) if (ps.includes(k)) { ok = false; break; }
    if (ok) moves.push({ t: 'move', from: rel, to: t });
  }
  if (r === 6) {
    const seenA = new Set();
    for (const rel of ps) {
      if (rel < 0 || rel > 38) continue;
      const a = abs(p, rel);
      if (isStart(a) || G.mines[a] !== undefined || seenA.has(a)) continue;
      seenA.add(a); moves.push({ t: 'mine', from: rel, at: a });
    }
  }
  return moves;
}

// resolve a pawn landing on the field; fx(event) reports what happened (null while bots think)
const vcount = list => { const o = {}; list.forEach(v => o[v.p] = (o[v.p] || 0) + 1); return o; };
function land(G, p, i, fx) {
  const a = abs(p, G.pawns[p][i]);
  if (G.mines[a] !== undefined) {
    const owner = G.mines[a];
    const guards = fieldPawnsAt(G, a).filter(v => v.p === owner && !(v.p === p && v.i === i));
    if (owner === p && guards.length) { fx && fx({ t: 'log', m: 'Safe: your own pawn guards that mine.' }); return; }
    const victims = fieldPawnsAt(G, a);
    victims.forEach(v => G.pawns[v.p][v.i] = -1);
    delete G.mines[a];
    fx && fx({ t: 'boom', a, owner, n: victims.length, vic: vcount(victims) });
    return;
  }
  const en = fieldPawnsAt(G, a).filter(v => v.p !== p);
  if (en.length) { en.forEach(v => G.pawns[v.p][v.i] = -1); fx && fx({ t: 'capture', a, p, victim: en[0].p, n: en.length, vic: vcount(en) }); }
}

/* ============================== BOTS ============================== */
const PV = rel => rel < 0 ? 0 : rel <= 38 ? 12 + rel : 62 + (rel - 38) * 2;
const cloneState = st => ({ pawns: st.pawns.map(a => a.slice()), mines: { ...st.mines } });
function moverAt(st, p, m) {
  const c = cloneState(st); let oe = null;
  if (m.t === 'mine') c.mines[m.at] = p;
  else if (m.t === 'enter') { const i = c.pawns[p].indexOf(-1); c.pawns[p][i] = 0; land(c, p, i, null); }
  else { const i = c.pawns[p].indexOf(m.from); c.pawns[p][i] = m.to; if (m.to <= 38) { if (isOE(abs(p, m.to))) oe = i; else land(c, p, i, null); } }
  return { st: c, oe };
}
function oeValue(st, p, i, g) {
  let tot = 0;
  for (let d = 1; d <= 6; d++) { const c = cloneState(st); const right = (g === 'odd') === (d % 2 === 1); c.pawns[p][i] += right ? d : -d; land(c, p, i, null); tot += evalFor(p, c); }
  return tot / 6;
}
function evalFor(p, st) {
  const own = st.pawns[p];
  if (own.every(r => r >= HOME0)) return 1e4;
  let score = 0;
  own.forEach(r => score += PV(r));
  st.pawns.forEach((ps, q) => { if (q !== p) ps.forEach(r => score -= 0.45 * PV(r)); });
  if (!homeTidy(st, p)) score -= 5;
  const myAt = {};
  own.forEach(r => { if (r >= 0 && r <= 38) { const a = abs(p, r); myAt[a] = (myAt[a] || 0) + PV(r); } });
  for (const a in myAt) {
    const A = +a, hits = new Set();
    st.pawns.forEach((ps, q) => {
      if (q === p) return;
      ps.forEach(r => { if (r < 0 || r > 38) return; const d = (A - abs(q, r) + N) % N; if (d >= 1 && d <= 6 && r + d <= 38) hits.add(d); });
      if (A === q * SEC && ps.includes(-1)) hits.add('bench' + q);
    });
    score -= Math.min(1, hits.size / 6) * myAt[a] * 0.9;
    for (let d = 1; d <= 6; d++) { const m = st.mines[(A + d) % N]; if (m !== undefined && m !== p) score -= myAt[a] * 0.05; }
  }
  for (const a in st.mines) {
    if (st.mines[a] !== p) continue; const A = +a;
    st.pawns.forEach((ps, q) => { if (q === p) return; ps.forEach(r => { if (r < 0 || r > 38) return; const d = (A - abs(q, r) + N) % N; if (d >= 1 && d <= 6 && r + d <= 38) score += PV(r) * 0.55 / 6; }); });
  }
  return score;
}
function botPick(G) {
  let best = null, bv = -Infinity;
  for (const m of G.moves) {
    const r = moverAt(G, G.cur, m);
    const v = (r.oe !== null ? Math.max(oeValue(r.st, G.cur, r.oe, 'odd'), oeValue(r.st, G.cur, r.oe, 'even')) : evalFor(G.cur, r.st)) + Math.random() * 0.01;
    if (v > bv) { bv = v; best = m; }
  }
  if (G.moves.every(m => m.t === 'mine') && evalFor(G.cur, cloneState(G)) >= bv) return null;   // planting is optional
  return best;
}
function botGuess(G) { const st = cloneState(G); return oeValue(st, G.cur, G.oe.i, 'odd') >= oeValue(st, G.cur, G.oe.i, 'even') ? 'odd' : 'even'; }

/* ============================== ROOMS ============================== */
const rooms = new Map();
const FACTIONS = { elves: { name: 'Elves', c: '#45c463' }, dwarves: { name: 'Dwarves', c: '#6fb3ff' }, orcs: { name: 'Orcs', c: '#e2622c' } };
const FKEYS = ['elves', 'dwarves', 'orcs'];
const PALETTE = [['Red', '#e5484d'], ['Blue', '#3e8ef7'], ['Yellow', '#f2c94c'], ['Green', '#3fb950'], ['Purple', '#a371f7'], ['Orange', '#f0883e'], ['Pink', '#f778ba'], ['Teal', '#2bc4c4']];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';                      // no I or O: easy to read out loud
const DUR = { tick: 0, roll: 750, hop: 200, capture: 820, boom: 880, guess: 1300, log: 0, state: 0, opening: 0 };

function makeCode() { let c; do { c = ''; for (let k = 0; k < 4; k++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; } while (rooms.has(c)); return c; }
const token = () => crypto.randomBytes(12).toString('hex');
const clean = s => String(s || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);

function createRoom(name) {
  const code = makeCode();
  const room = {
    code, theme: 'fantasy', game: null, seq: 0, events: [], waiters: [], busyUntil: 0, botTimer: null, lastActive: Date.now(),
    seats: FKEYS.map((f, i) => ({ token: null, name: '', bot: false, open: true, faction: f, c: PALETTE[i][1], lastSeen: 0 })),
    hostToken: null, log: [], chat: [], chatId: 0, timeLimit: 0, turnTimer: null, timerKey: '', hints: false, swap: null, cool: {},
  };
  rooms.set(code, room);
  const t = token(); room.hostToken = t;
  takeSeat(room, 0, t, name);
  return { room, t };
}
function defaultName(room, i) { const s = room.seats[i]; return room.theme === 'fantasy' ? FACTIONS[s.faction].name : (PALETTE.find(([, c]) => c === s.c) || ['Player'])[0]; }
function seatName(room, i) { const s = room.seats[i]; return s.name || defaultName(room, i); }
function takeSeat(room, i, t, name) { const s = room.seats[i]; s.token = t; s.open = false; s.bot = false; s.name = clean(name); s.lastSeen = Date.now(); }
function seatOf(room, t) { return t ? room.seats.findIndex(s => s.token === t) : -1; }
function colorOf(room, i) { return room.theme === 'fantasy' ? FACTIONS[room.seats[i].faction].c : room.seats[i].c; }

function publicState(room) {
  const G = room.game;
  return {
    code: room.code, theme: room.theme, timeLimit: room.timeLimit, hints: !!room.hints, swap: room.swap && { from: room.swap.from, to: room.swap.to },
    seats: room.seats.map((s, i) => ({ name: seatName(room, i), bot: s.bot, open: s.open, human: !!s.token, faction: s.faction, c: colorOf(room, i), online: !!s.token && Date.now() - s.lastSeen < 15000 })),
    host: seatOf(room, room.hostToken),
    game: G && { stats: G.stats, feed: (G.feed || []).slice(0, 40), elapsed: (G.endedAt || Date.now()) - (G.startedAt || Date.now()), auto: room.auto != null && room.auto === G.turnId, pawns: G.pawns, mines: G.mines, cur: G.cur, phase: G.phase, die: G.die, rollsLeft: G.rollsLeft, moves: G.phase === 'choose' ? G.moves : [], oe: G.oe, winner: G.winner, open: G.open },
    log: room.log.slice(0, 30),
    chat: room.chat.slice(-40),
  };
}
function chatMsg(room, seat, text, sys, extra) {
  const c = seat >= 0 ? colorOf(room, seat) : '#9aa3b5';
  room.chat.push({ id: ++room.chatId, ts: Date.now(), seat, sys: !!sys, name: seat >= 0 ? seatName(room, seat) : 'Spectator', c, text: String(text).slice(0, 200), ...(extra || {}) });
  if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
}
function logMsg(room, m) { room.log.unshift(m); room.log = room.log.slice(0, 60); }
const nm = (room, p) => seatName(room, p);
const poss = (room, p) => /s$/i.test(nm(room, p)) ? nm(room, p) + "'" : nm(room, p) + "'s";

// every change is an event with a snapshot; clients replay them in order with animations
function feedAdd(room, ev) {
  const G = room.game; if (!G) return;
  let e = null;
  if (ev.t === 'roll') e = { k: 'roll', p: ev.p, v: ev.v, ...(ev.kind === 'open' ? { o: 1 } : {}), ...(ev.kind === 'guess' ? { g: ev.g, ok: (ev.g === 'odd') === (ev.v % 2 === 1) } : {}) };
  else if (ev.t === 'capture') e = { k: 'cap', p: ev.p, vic: ev.vic };
  else if (ev.t === 'boom') e = { k: 'boom', o: ev.owner, vic: ev.vic };
  else if (ev.win != null) e = { k: 'win', p: ev.win };
  if (e) { e.t = Date.now(); G.feed = [e, ...(G.feed || [])].slice(0, 60); }
  const st = G.stats || (G.stats = newStats());
  if (ev.t === 'roll' && ev.v >= 1 && ev.v <= 6) {
    st.rolls[ev.p][ev.v - 1]++;
    if (ev.kind === 'guess') ((ev.g === 'odd') === (ev.v % 2 === 1) ? st.oeRight : st.oeWrong)[ev.p]++;
  }
  if (ev.t === 'hop' && ev.from >= 0) st.steps[ev.p] += ev.path.length;
  if (ev.t === 'capture') for (const q in ev.vic) st.kills[ev.p][q] += ev.vic[q];
  if (ev.t === 'boom') for (const q in ev.vic) st.mineKills[ev.owner][q] += ev.vic[q];
  if (ev.planted != null) st.planted[ev.planted]++;
}
function emit(room, ev) {
  if (ev.m) logMsg(room, ev.m);
  feedAdd(room, ev);
  const now = Date.now();
  const dur = ev.t === 'hop' ? DUR.hop * ev.path.length + 100 : ev.t === 'pause' ? ev.ms : (DUR[ev.t] || 0);
  room.busyUntil = Math.max(now, room.busyUntil) + dur;
  ev.seq = ++room.seq; ev.s = JSON.parse(JSON.stringify(publicState(room)));
  room.events.push(ev); if (room.events.length > 400) room.events.splice(0, room.events.length - 400);
  room.lastActive = now;
  const w = room.waiters; room.waiters = [];
  w.forEach(fn => fn());
}

/* ---------- game flow ---------- */
function startGame(room) {
  room.swap = null;
  room.seats.forEach(s => { if (!s.token) { s.bot = true; s.open = false; } });
  room.game = newGame(); room.busyUntil = 0;
  emit(room, { t: 'state', m: 'New game! Everyone rolls their own dice. Highest starts.' });
  tickBots(room);
}
function openRoll(room, p) {
  const G = room.game, O = G && G.open;
  if (!G || G.phase !== 'opening' || O.done || !O.contenders.includes(p) || O.vals[p] != null) return;
  O.vals[p] = d6();
  emit(room, { t: 'roll', kind: 'open', p, v: O.vals[p], m: `${nm(room, p)} rolled ${O.vals[p]}.` });
  if (O.contenders.some(q => O.vals[q] == null)) return;
  const max = Math.max(...O.contenders.map(q => O.vals[q])), top = O.contenders.filter(q => O.vals[q] === max);
  if (top.length > 1) {
    emit(room, { t: 'pause', ms: 1500, banner: `Tie! ${top.map(q => nm(room, q)).join(' & ')} roll again`, m: `Tie: ${top.map(q => nm(room, q)).join(' & ')} roll again.` });
    O.contenders = top; top.forEach(q => delete O.vals[q]);
    emit(room, { t: 'state' });
    return;
  }
  O.done = true; O.winner = top[0];
  emit(room, { t: 'pause', ms: 1900, banner: `${nm(room, top[0])} go${/s$/i.test(nm(room, top[0])) ? '' : 'es'} first!`, m: `${nm(room, top[0])} goes first.` });
  startTurn(room, top[0]);
}
function startTurn(room, p) {
  const G = room.game;
  G.cur = p; G.bonus = false; G.moves = []; G.die = null; G.oe = null; G.turnId = (G.turnId || 0) + 1; room.auto = null;
  G.rollsLeft = rollsAllowed(G, p); G.phase = 'roll';
  emit(room, { t: 'state', m: `${poss(room, p)} turn` + (G.rollsLeft === 3 ? ' (3 tries to roll a 6)' : '') });
}
function doRoll(room, p) {
  const G = room.game;
  if (G && G.phase === 'choose' && G.cur === p && G.moves.length && G.moves.every(m => m.t === 'mine')) {   // mines are optional: roll again instead
    G.moves = []; G.bonus = false; G.rollsLeft = 1; G.phase = 'roll'; logMsg(room, `${nm(room, p)} rolls again without planting.`);
  }
  if (!G || G.phase !== 'roll' || G.cur !== p) return;
  const r = d6(); G.die = r; G.rollsLeft--;
  if (r === 6) G.bonus = true;
  const mv = legal(G, p, r);
  if (!mv.length) {
    if (r === 6) { G.bonus = false; G.rollsLeft = Math.max(G.rollsLeft, 1); emit(room, { t: 'roll', kind: 'turn', p, v: r, m: `${nm(room, p)} rolled 6: no move, but roll again.` }); return; }
    if (G.rollsLeft > 0) { emit(room, { t: 'roll', kind: 'turn', p, v: r, m: `${nm(room, p)} rolled ${r}. No move, ${G.rollsLeft} ${G.rollsLeft === 1 ? 'try' : 'tries'} left.` }); return; }
    G.bonus = false; G.phase = 'wait';
    emit(room, { t: 'roll', kind: 'turn', p, v: r, m: `${nm(room, p)} rolled ${r}. No legal move.` });
    emit(room, { t: 'pause', ms: 900 });
    return endTurn(room);
  }
  G.moves = mv; G.phase = 'choose';
  emit(room, { t: 'roll', kind: 'turn', p, v: r, m: `${nm(room, p)} rolled ${r}.` });
}
function doMove(room, p, want) {
  const G = room.game;
  if (!G || G.phase !== 'choose' || G.cur !== p || !want) return;
  const m = G.moves.find(x => x.t === want.t && (x.t === 'enter' || x.from === want.from));
  if (!m) return;
  G.moves = []; G.phase = 'anim';
  const fx = ev => emit(room, ev);
  if (m.t === 'mine') { G.mines[m.at] = p; emit(room, { t: 'state', planted: p, m: `${nm(room, p)} planted a landmine.`, sfx: 'mine' }); return afterAction(room); }
  if (m.t === 'enter') {
    const i = G.pawns[p].indexOf(-1);                                  // pawns always come out in order 1, 2, 3, 4
    G.pawns[p][i] = 0; emit(room, { t: 'hop', p, i, from: -1, path: [0], m: `${nm(room, p)} brought pawn ${i + 1} out.` });
    land(G, p, i, ev => fx(withMsg(room, ev))); return afterAction(room);
  }
  const i = Number.isInteger(want.i) && G.pawns[p][want.i] === m.from ? want.i : G.pawns[p].indexOf(m.from);
  G.pawns[p][i] = m.to;
  emit(room, { t: 'hop', p, i, from: m.from, path: range(m.from + 1, m.to), m: m.to > 38 ? `${nm(room, p)} moved pawn ${i + 1} ${m.from > 38 ? 'along' : 'into'} the home lane.` : null });
  if (m.to > 38) return afterAction(room);
  if (isOE(abs(p, m.to))) { G.bonus = false; G.oe = { i }; G.phase = 'guess'; emit(room, { t: 'state', m: `${nm(room, p)} landed on odds or evens. Call it!` }); return; }
  land(G, p, i, ev => fx(withMsg(room, ev)));
  afterAction(room);
}
function withMsg(room, ev) {
  if (ev.t === 'boom') ev.m = `💥 BOOM! ${nm(room, ev.owner)}'s mine blew up ${ev.n} pawn${ev.n > 1 ? 's' : ''}.`;
  if (ev.t === 'capture') ev.m = `${nm(room, ev.p)} captured ${ev.n} ${nm(room, ev.victim)} pawn${ev.n > 1 ? 's' : ''}!`;
  return ev;
}
function doGuess(room, p, g) {
  const G = room.game;
  if (!G || G.phase !== 'guess' || G.cur !== p || (g !== 'odd' && g !== 'even')) return;
  const i = G.oe.i, r = d6(); G.die = r;
  const right = (g === 'odd') === (r % 2 === 1);
  const rel = G.pawns[p][i], to = right ? rel + r : rel - r;
  G.phase = 'anim';
  emit(room, { t: 'roll', kind: 'guess', p, v: r, g, m: `${nm(room, p)} called ${g}s, rolled ${r}: ${right ? 'right, forward' : 'wrong, back'} ${r}.` });
  G.pawns[p][i] = to; G.oe = null;
  emit(room, { t: 'hop', p, i, from: rel, path: right ? range(rel + 1, to) : range(rel - 1, to) });
  G.bonus = (r === 6);
  land(G, p, i, ev => emit(room, withMsg(room, ev)));
  afterAction(room);
}
function afterAction(room) {
  const G = room.game, p = G.cur;
  if (G.pawns[p].every(r => r >= HOME0)) { G.winner = p; G.phase = 'over'; G.endedAt = Date.now(); emit(room, { t: 'state', win: p, m: `🏆 ${nm(room, p)} win${/s$/i.test(nm(room, p)) ? '' : 's'}!` }); return; }
  if (G.bonus) { G.bonus = false; G.rollsLeft = 1; G.phase = 'roll';   // a bonus roll is always one roll; 3 tries only at the start of a turn
  emit(room, { t: 'state', m: 'A 6: roll again.' }); return; }
  endTurn(room);
}
function endTurn(room) { startTurn(room, (room.game.cur + 1) % 3); }

// optional turn timer: one countdown per turn. When it runs out, an autopilot (the bot brain)
// finishes that player's turn; any action from the player takes control back with a fresh countdown.
function armTimer(room) {
  const G = room.game;
  if (!G) return;
  let key = '';
  if (room.timeLimit && G.phase !== 'over') {
    if (G.phase === 'opening' && !G.open.done) {
      if (G.open.contenders.some(q => !room.seats[q].bot && G.open.vals[q] == null)) key = 'open:' + G.open.contenders.join() + ':' + (room.treset || 0);
    } else if (!room.seats[G.cur].bot && !(room.auto != null && room.auto === G.turnId)) key = 'turn:' + G.turnId + ':' + (room.treset || 0);
  }
  if (key === room.timerKey) return;
  room.timerKey = key; clearTimeout(room.turnTimer); room.turnTimer = null;
  if (!key) { emit(room, { t: 'tick', off: true }); return; }
  const wait = Math.max(0, room.busyUntil - Date.now()) + room.timeLimit * 1000;
  emit(room, { t: 'tick', ms: room.timeLimit * 1000 });
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null; room.timerKey = '';
    try {
      if (G.phase === 'opening') G.open.contenders.filter(q => !room.seats[q].bot && G.open.vals[q] == null).forEach(q => openRoll(room, q));
      else if (!room.seats[G.cur].bot) { room.auto = G.turnId; emit(room, { t: 'state', m: `⏱ Time is up: autopilot plays for ${nm(room, G.cur)}.` }); }
    } catch (e) { console.error(e); }
    tickBots(room);
  }, wait);
}
function wakeUp(room, seat) {        // the player is back: stop the autopilot
  const G = room.game;
  if (!G || seat !== G.cur || room.auto == null || room.auto !== G.turnId) return;
  room.auto = null; room.treset = (room.treset || 0) + 1; clearTimeout(room.botTimer); room.botTimer = null;
  emit(room, { t: 'state', m: `${nm(room, seat)} took over again.` });
}
function tickBots(room) {
  armTimer(room);
  if (room.botTimer || !room.game) return;
  const G = room.game; let act = null, think = 600;
  if (G.phase === 'opening' && !G.open.done) {
    const bp = G.open.contenders.find(q => room.seats[q].bot && G.open.vals[q] == null);
    if (bp !== undefined) { think = 500 + Math.random() * 500; act = () => openRoll(room, bp); }
  } else if (room.seats[G.cur].bot || (room.auto != null && room.auto === G.turnId)) {
    if (G.phase === 'roll') act = () => doRoll(room, G.cur);
    else if (G.phase === 'choose') { think = 750; act = () => { const m = botPick(G); if (m) doMove(room, G.cur, m); else doRoll(room, G.cur); }; }
    else if (G.phase === 'guess') { think = 800; act = () => doGuess(room, G.cur, botGuess(G)); }
  }
  if (!act) return;
  const wait = Math.max(0, room.busyUntil - Date.now()) + think;
  room.botTimer = setTimeout(() => { room.botTimer = null; try { act(); } catch (e) { console.error(e); } tickBots(room); }, wait);
}

/* ============================== RESTORE ============================== */
// After a server restart the rooms are gone. Every browser keeps the last snapshot of its game,
// so the first one to come back rebuilds the room, and the others reclaim their own seats.
function validSnap(snap) {
  try {
    if (!snap || !Array.isArray(snap.seats) || snap.seats.length !== 3) return false;
    const g = snap.game;
    if (g) {
      if (!Array.isArray(g.pawns) || g.pawns.length !== 3) return false;
      for (const ps of g.pawns) if (!Array.isArray(ps) || ps.length !== 4 || ps.some(r => !Number.isInteger(r) || r < -1 || r > END)) return false;
    }
    return true;
  } catch (e) { return false; }
}
function rebuildRoom(code, snap) {
  const room = {
    code, theme: snap.theme === 'classic' ? 'classic' : 'fantasy', game: null, seq: 0, events: [], waiters: [], busyUntil: 0, botTimer: null, lastActive: Date.now(),
    seats: snap.seats.map((x, i) => {
      const bot = !!x.bot, human = !!x.human && !bot;
      return { token: null, name: clean(x.name), bot, open: !bot && !human, reserved: human, faction: FKEYS.includes(x.faction) ? x.faction : FKEYS[i],
               c: PALETTE.some(([, c]) => c === x.c) ? x.c : PALETTE[i][1], lastSeen: 0 };
    }),
    hostToken: null, hostSeat: Number.isInteger(snap.host) ? snap.host : -1,
    log: (Array.isArray(snap.log) ? snap.log : []).filter(l => typeof l === 'string').slice(0, 60).map(l => l.slice(0, 200)),
    hints: !!snap.hints, swap: null, cool: {},
    chat: [], chatId: 0, timeLimit: Number.isInteger(snap.timeLimit) && snap.timeLimit >= 0 && snap.timeLimit <= 60 ? snap.timeLimit : 0, turnTimer: null, timerKey: '',
  };
  (Array.isArray(snap.chat) ? snap.chat : []).slice(-40).forEach(m => {
    if (m && typeof m.text === 'string') room.chat.push({ id: ++room.chatId, ts: Number.isFinite(m.ts) ? m.ts : Date.now(), emote: !!m.emote, point: !!m.point, seat: Number.isInteger(m.seat) ? m.seat : -1, sys: !!m.sys, name: clean(m.name) || 'Player', c: typeof m.c === 'string' ? m.c.slice(0, 9) : '#9aa3b5', text: m.text.slice(0, 200) });
  });
  rooms.set(code, room);
  const g = snap.game;
  if (g) {
    const G = newGame();
    G.pawns = g.pawns.map(a => a.slice());
    for (const k in (g.mines || {})) { const a = +k, o = +g.mines[k]; if (Number.isInteger(a) && a >= 0 && a < N && [0, 1, 2].includes(o)) G.mines[a] = o; }
    G.cur = [0, 1, 2].includes(g.cur) ? g.cur : 0;
    G.die = Number.isInteger(g.die) && g.die >= 1 && g.die <= 6 ? g.die : null;
    G.rollsLeft = Number.isInteger(g.rollsLeft) ? Math.max(0, Math.min(3, g.rollsLeft)) : 1;
    G.winner = [0, 1, 2].includes(g.winner) ? g.winner : null;
    if (g.open && typeof g.open === 'object') {
      const cont = (Array.isArray(g.open.contenders) ? g.open.contenders : [0, 1, 2]).filter(x => [0, 1, 2].includes(x));
      const vals = {}; for (const k in (g.open.vals || {})) { const v = +g.open.vals[k]; if ([0, 1, 2].includes(+k) && v >= 1 && v <= 6) vals[+k] = v; }
      G.open = { contenders: cont.length ? cont : [0, 1, 2], vals, done: !!g.open.done, winner: [0, 1, 2].includes(g.open.winner) ? g.open.winner : null };
    }
    if (Number.isFinite(g.elapsed) && g.elapsed >= 0) G.startedAt = Date.now() - g.elapsed;
    const okP = x => [0, 1, 2].includes(x), okV = v => v && typeof v === 'object' && Object.keys(v).every(k => okP(+k) && Number.isInteger(v[k]) && v[k] > 0 && v[k] < 13);
    G.feed = (Array.isArray(g.feed) ? g.feed : []).filter(e => e && Number.isFinite(e.t) && (
      (e.k === 'roll' && okP(e.p) && e.v >= 1 && e.v <= 6) || (e.k === 'cap' && okP(e.p) && okV(e.vic)) || (e.k === 'boom' && okP(e.o) && okV(e.vic)) || (e.k === 'win' && okP(e.p))))
      .slice(0, 40).map(e => ({ k: e.k, t: e.t, p: e.p, o: e.o, v: e.v, vic: e.vic, g: e.g === 'odd' || e.g === 'even' ? e.g : undefined, ok: !!e.ok }));
    const st = g.stats, num = x => Number.isInteger(x) && x >= 0 && x < 1e5;
    if (st && typeof st === 'object') {
      const ok3 = a => Array.isArray(a) && a.length === 3 && a.every(num), ok33 = a => Array.isArray(a) && a.length === 3 && a.every(ok3);
      if (Array.isArray(st.rolls) && st.rolls.length === 3 && st.rolls.every(r => Array.isArray(r) && r.length === 6 && r.every(num)) && ['steps', 'planted', 'oeRight', 'oeWrong'].every(k => ok3(st[k])) && ok33(st.kills) && ok33(st.mineKills))
        G.stats = { rolls: st.rolls, steps: st.steps, kills: st.kills, mineKills: st.mineKills, planted: st.planted, oeRight: st.oeRight, oeWrong: st.oeWrong };
    }
    room.game = G;
    const ph = g.phase;
    if (ph === 'over' && G.winner !== null) G.phase = 'over';
    else if (ph === 'opening' && !G.open.done) G.phase = 'opening';
    else if (ph === 'choose' && G.die) { G.phase = 'choose'; G.moves = legal(G, G.cur, G.die); if (!G.moves.length) { startTurn(room, G.cur); } }
    else if (ph === 'guess' && g.oe && Number.isInteger(g.oe.i) && G.pawns[G.cur][g.oe.i] >= 0 && G.pawns[G.cur][g.oe.i] <= 38 && isOE(abs(G.cur, G.pawns[G.cur][g.oe.i]))) { G.phase = 'guess'; G.oe = { i: g.oe.i }; }
    else if (ph === 'roll') G.phase = 'roll';
    else startTurn(room, G.open.done && G.open.winner !== null && ph === 'opening' ? G.open.winner : G.cur);
  }
  logMsg(room, '♻️ The server restarted: game restored.');
  emit(room, { t: 'state' });
  return room;
}
function handleRestore(res, body) {
  const code = String(body.room || '').toUpperCase(), t = body.token, want = body.seat;
  if (!/^[A-Z]{4}$/.test(code) || typeof t !== 'string' || t.length < 8 || t.length > 64) return send(res, 400, { error: 'bad request' });
  let room = rooms.get(code);
  if (!room) {
    if (!validSnap(body.snap)) return send(res, 404, { error: 'Room not found' });
    room = rebuildRoom(code, body.snap);
  }
  if (seatOf(room, t) >= 0) return send(res, 200, { room: code, token: t });
  if (Number.isInteger(want) && want >= 0 && want < 3 && room.seats[want].reserved && !room.seats[want].token) {
    const st = room.seats[want]; st.token = t; st.reserved = false; st.lastSeen = Date.now();
    if (want === room.hostSeat || !room.hostToken) room.hostToken = t;
    emit(room, { t: 'state', m: `${seatName(room, want)} reconnected.` });
    tickBots(room);
  }
  return send(res, 200, { room: code, token: t });
}

/* ============================== HTTP ============================== */
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function you(room, t) { const seat = seatOf(room, t); return { seat, host: !!t && t === room.hostToken }; }

function handleApi(req, res, body) {
  const op = body.op, room = body.room ? rooms.get(String(body.room).toUpperCase()) : null, t = body.token;
  if (op === 'restore') return handleRestore(res, body);
  if (op === 'create') { const { room: r, t: tk } = createRoom(body.name); chatMsg(r, -1, `${seatName(r, 0)} created the room. Share the code with your friends!`, true); emit(r, { t: 'state', m: `${seatName(r, 0)} created the room.` }); return send(res, 200, { room: r.code, token: tk }); }
  if (!room) return send(res, 404, { error: 'Room not found. Check the code.' });
  room.lastActive = Date.now();
  const seat = seatOf(room, t), isHost = !!t && t === room.hostToken;
  if (seat >= 0) room.seats[seat].lastSeen = Date.now();

  if (op === 'chat') {
    const text = String(body.text || '').trim(); if (!text) return send(res, 200, { ok: true });
    chatMsg(room, seat, text, false); emit(room, { t: 'chat' }); return send(res, 200, { ok: true });
  }
  if (op === 'emote' && seat >= 0) {
    const E = ['🙏', '😠', '😒', '⏳', '😂'];
    if (!E.includes(body.e) || Date.now() - (room.cool['e' + seat] || 0) < 900) return send(res, 200, { ok: false });
    room.cool['e' + seat] = Date.now();
    chatMsg(room, seat, body.e, false, { emote: true }); emit(room, { t: 'emote', p: seat, e: body.e }); return send(res, 200, { ok: true });
  }
  if (op === 'point' && seat >= 0 && room.game && room.game.phase !== 'over') {
    const q = body.p, i = body.i, G = room.game;
    if (![0, 1, 2].includes(q) || ![0, 1, 2, 3].includes(i) || G.pawns[q][i] < 0 || Date.now() - (room.cool['p' + seat] || 0) < 4800) return send(res, 200, { ok: false });
    room.cool['p' + seat] = Date.now();
    const whose = q === seat ? 'their own pawn' : `${poss(room, q)} pawn`;
    chatMsg(room, seat, `pointed at ${whose} ${i + 1}`, false, { point: true });
    emit(room, { t: 'point', from: seat, p: q, i }); return send(res, 200, { ok: true });
  }
  if (op === 'join') {
    if (seat >= 0) return send(res, 200, { room: room.code, token: t });           // already in (page reload)
    const free = room.game && room.game.phase !== 'over' ? -1 : room.seats.findIndex(s => s.open && !s.token);
    const tk = token();
    if (free < 0) return send(res, 200, { room: room.code, token: tk, spectator: true });
    takeSeat(room, free, tk, body.name);
    chatMsg(room, -1, `${seatName(room, free)} joined the room.`, true);
    emit(room, { t: 'state', m: `${seatName(room, free)} joined.` });
    return send(res, 200, { room: room.code, token: tk });
  }
  if (op === 'leave' && seat >= 0 && (!room.game || room.game.phase === 'over')) {
    const s = room.seats[seat]; s.token = null; s.open = true; s.name = '';
    if (room.swap && (room.swap.from === seat || room.swap.to === seat)) room.swap = null;
    chatMsg(room, -1, `${seatName(room, seat) || 'A player'} left the room.`, true);
    if (isHost) { const other = room.seats.find(x => x.token); room.hostToken = other ? other.token : null; }
    emit(room, { t: 'state' }); return send(res, 200, { ok: true });
  }
  // ----- lobby -----
  if (!room.game || room.game.phase === 'over') {
    const target = Number.isInteger(body.seat) ? body.seat : seat;
    const canEdit = target >= 0 && target < 3 && (target === seat || (isHost && !room.seats[target].token));
    if (op === 'name' && target === seat && seat >= 0) { room.seats[seat].name = clean(body.name); emit(room, { t: 'state' }); }
    if (op === 'theme' && isHost && (body.theme === 'fantasy' || body.theme === 'classic')) { room.theme = body.theme; emit(room, { t: 'state' }); }
    if (op === 'faction' && canEdit && FKEYS.includes(body.faction)) {
      const o = room.seats.findIndex(s => s.faction === body.faction);
      if (o >= 0 && o !== target) room.seats[o].faction = room.seats[target].faction;
      room.seats[target].faction = body.faction; emit(room, { t: 'state' });
    }
    if (op === 'color' && canEdit && PALETTE.some(([, c]) => c === body.color)) {
      const o = room.seats.findIndex(s => s.c === body.color);
      if (o >= 0 && o !== target) room.seats[o].c = room.seats[target].c;
      room.seats[target].c = body.color; emit(room, { t: 'state' });
    }
    if (op === 'seat' && isHost && target >= 0 && !room.seats[target].token) {        // open seat <-> bot
      const s = room.seats[target]; s.bot = !!body.bot; s.open = !s.bot; emit(room, { t: 'state' });
    }
    if (op === 'hints' && isHost) { room.hints = !!body.on; emit(room, { t: 'state' }); }
    if (op === 'take' && Number.isInteger(body.seat) && body.seat >= 0 && body.seat < 3 && body.seat !== seat) {   // sit in an open seat, or take over a bot
      const to = room.seats[body.seat];
      if (!to.token && (to.open || to.bot)) {
        const wasBot = to.bot;
        if (seat >= 0) { const fr = room.seats[seat]; to.token = fr.token; to.name = fr.name; to.lastSeen = fr.lastSeen; fr.token = null; fr.name = ''; fr.bot = wasBot; fr.open = !wasBot; }
        else { to.token = t; to.name = clean(body.name); to.lastSeen = Date.now(); }
        to.bot = false; to.open = false;
        if (room.swap) room.swap = null;
        emit(room, { t: 'state' });
      }
    }
    if (op === 'swapask' && seat >= 0 && Number.isInteger(body.seat) && body.seat >= 0 && body.seat < 3 && body.seat !== seat && room.seats[body.seat].token && !room.swap) {
      room.swap = { from: seat, to: body.seat, at: Date.now() };
      chatMsg(room, -1, `${seatName(room, seat)} asked ${seatName(room, body.seat)} to swap places.`, true);
      emit(room, { t: 'state' });
      const sw = room.swap; setTimeout(() => { if (room.swap === sw) { room.swap = null; emit(room, { t: 'state' }); } }, 30000);
    }
    if (op === 'swapcancel' && room.swap && room.swap.from === seat) { room.swap = null; emit(room, { t: 'state' }); }
    if (op === 'swapans' && room.swap && room.swap.to === seat) {
      const a = room.seats[room.swap.from], b = room.seats[room.swap.to], an = seatName(room, room.swap.from), bn = seatName(room, room.swap.to);
      if (body.ok) {
        for (const k of ['token', 'name', 'lastSeen']) { const x = a[k]; a[k] = b[k]; b[k] = x; }
        chatMsg(room, -1, `${bn} and ${an} swapped places.`, true);
      } else chatMsg(room, -1, `${bn} said no to swapping.`, true);
      room.swap = null; emit(room, { t: 'state' });
    }
    if (op === 'timer' && isHost && Number.isInteger(body.s) && body.s >= 0 && body.s <= 60) { room.timeLimit = body.s && body.s < 5 ? 5 : body.s; emit(room, { t: 'state' }); }
    if (op === 'start' && isHost && (!room.game || room.game.phase === 'over')) startGame(room);
    return send(res, 200, { ok: true });
  }
  // ----- game -----
  if (seat < 0) return send(res, 200, { ok: true });
  wakeUp(room, seat);
  if (op === 'openroll') openRoll(room, seat);
  else if (op === 'roll') doRoll(room, seat);
  else if (op === 'move') doMove(room, seat, body.m);
  else if (op === 'guess') doGuess(room, seat, body.g);
  tickBots(room);
  return send(res, 200, { ok: true });
}

// long-polling: the browser asks "anything after event N?" and we answer as soon as there is
function handlePoll(req, res, q) {
  const room = rooms.get(String(q.get('room') || '').toUpperCase());
  if (!room) return send(res, 404, { error: 'Room not found' });
  const t = q.get('token'), since = +q.get('since') || 0;
  const seat = seatOf(room, t); if (seat >= 0) room.seats[seat].lastSeen = Date.now();
  const reply = () => {
    let evs = room.events.filter(e => e.seq > since);
    const resync = since > 0 && room.events.length && room.events[0].seq > since + 1;
    if (since === 0 || resync) evs = evs.length ? [Object.assign({}, evs[evs.length - 1], { t: 'state', resync: true })] : [];
    send(res, 200, { events: evs, you: you(room, t), seq: room.seq });
  };
  if (room.seq > since) return reply();
  let done = false;
  const fn = () => { if (!done) { done = true; clearTimeout(timer); reply(); } };
  const timer = setTimeout(() => { done = true; room.waiters = room.waiters.filter(f => f !== fn); send(res, 200, { events: [], you: you(room, t), seq: room.seq }); }, 25000);
  room.waiters.push(fn);
  req.on('close', () => { if (!done) { done = true; clearTimeout(timer); room.waiters = room.waiters.filter(f => f !== fn); } });
}

// files live in ./public, or right next to server.js (easier to upload from a phone)
const PUBLIC = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/api') {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { let body; try { body = JSON.parse(data || '{}'); } catch (e) { return send(res, 400, { error: 'bad json' }); } try { handleApi(req, res, body); } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); } });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/poll') return handlePoll(req, res, u.searchParams);
  const STATIC = { '/manifest.webmanifest': 'application/manifest+json', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png' };
  if (req.method === 'GET' && STATIC[u.pathname]) {
    res.writeHead(200, { 'Content-Type': STATIC[u.pathname], 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(path.join(PUBLIC, u.pathname.slice(1))).pipe(res);
  }
  if (req.method === 'GET' && u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(PUBLIC, 'index.html')).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
});

// tidy up rooms nobody has touched for 6 hours
setInterval(() => { const now = Date.now(); for (const [c, r] of rooms) if (now - r.lastActive > 6 * 3600e3) { clearTimeout(r.botTimer); rooms.delete(c); } }, 10 * 60e3);
// refresh "online" dots in the lobby now and then
setInterval(() => { for (const r of rooms.values()) if (!r.game && r.waiters.length) emit(r, { t: 'state' }); }, 10000);

process.on('uncaughtException', e => console.error('Unexpected error (server keeps running):', e));
process.on('unhandledRejection', e => console.error('Unexpected promise error (server keeps running):', e));
server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const lan = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${PORT}`);
  console.log('\n  Ludilo is running!\n');
  console.log(`  On this computer:        http://localhost:${PORT}`);
  lan.forEach(l => console.log(`  Same Wi-Fi (phones etc): ${l}`));
  console.log('\n  For friends over the internet, start the tunnel (see README).');
  console.log('  Keep this window open while you play. Press Ctrl+C to stop.\n');
});
