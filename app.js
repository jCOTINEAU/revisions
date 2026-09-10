'use strict';
(() => {

/* ================= données & modèle ================= */

const STORAGE_KEY = 'revisions-v1';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// ordre d'introduction des tables : des plus simples aux plus dures
const TABLE_ORDER = [1, 2, 10, 5, 11, 3, 4, 6, 7, 8, 9, 12];
const LOG_MAX = 20000;

const DEFAULT_SETTINGS = {
  mult:    { newPerDay: 24, fast: 4000, ok: 9000, practiceSize: 20 },
  letters: { newPerDay: 25, fast: 3000, ok: 6000, practiceSize: 20 },
};

let db = load();

function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* données corrompues → repart à zéro */ }
  if (!d || typeof d !== 'object') d = {};
  d.cards = d.cards || {};
  d.log = Array.isArray(d.log) ? d.log : [];
  d.days = d.days || {};
  d.settings = d.settings || {};
  for (const m of ['mult', 'letters']) {
    d.settings[m] = Object.assign({}, DEFAULT_SETTINGS[m], d.settings[m]);
  }
  // migration : anciens défauts (10/8 nouvelles par jour) → nouveaux défauts
  if (d.settings.mult.newPerDay === 10) d.settings.mult.newPerDay = 24;
  if (d.settings.letters.newPerDay === 8) d.settings.letters.newPerDay = 25;
  return d;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db.log.length > LOG_MAX) db.log = db.log.slice(-LOG_MAX);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* quota plein */ }
  }, 150);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const [y, m, dd] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, dd + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* catalogue de cartes */
function catalog(mode) {
  const ids = [];
  if (mode === 'mult') {
    for (const t of TABLE_ORDER) for (let i = 1; i <= 12; i++) ids.push(`m-${t}x${i}`);
  } else {
    for (let i = 0; i < 25; i++) ids.push(`l-${ALPHABET[i]}`);
  }
  return ids;
}
function cardInfo(id) {
  if (id[0] === 'm') {
    const [a, b] = id.slice(2).split('x').map(Number);
    return { mode: 'mult', a, b, prompt: `${a} × ${b}`, answer: String(a * b) };
  }
  const ch = id.slice(2);
  return { mode: 'letters', letter: ch, prompt: ch, answer: ALPHABET[ALPHABET.indexOf(ch) + 1] };
}
function getCard(id) {
  if (!db.cards[id]) {
    db.cards[id] = {
      reps: 0, ok: 0, msSum: 0, msN: 0, best: null, lapses: 0,
      ease: 2.5, interval: 0, state: 'new', due: null, last: null,
    };
  }
  return db.cards[id];
}

/* ================= répétition espacée (SM-2 simplifié) =================
   La note vient de la justesse ET du temps de réaction :
   faux → 1 ; juste & rapide → 5 ; juste → 4 ; juste mais lent → 3 */
function quality(mode, correct, ms) {
  if (!correct) return 1;
  const cfg = db.settings[mode];
  if (ms <= cfg.fast) return 5;
  if (ms <= cfg.ok) return 4;
  return 3;
}

function schedule(id, q) {
  const c = getCard(id);
  const t = today();
  if (q === 1) {
    if (c.state === 'review') c.lapses++;
    c.state = 'learning';
    c.interval = 0;
    c.ease = Math.max(1.3, c.ease - 0.3);
    c.due = t; // reste dans la file du jour
    return;
  }
  if (c.state !== 'review') {
    // nouvelle carte ou carte en réapprentissage qui vient d'être réussie
    c.state = 'review';
    c.interval = q === 5 ? 3 : 1;
    if (q === 5) c.ease = Math.min(3, c.ease + 0.05);
  } else {
    let next;
    if (q === 3)      { next = c.interval * 1.2;          c.ease = Math.max(1.3, c.ease - 0.15); }
    else if (q === 4) { next = c.interval * c.ease; }
    else              { next = c.interval * c.ease * 1.3; c.ease = Math.min(3, c.ease + 0.1); }
    c.interval = Math.min(365, Math.max(c.interval + 1, Math.round(next)));
  }
  c.due = addDays(t, c.interval);
}

function dueIds(mode) {
  const t = today();
  return catalog(mode).filter(id => {
    const c = db.cards[id];
    return c && c.state !== 'new' && c.due && c.due <= t;
  });
}
function newIntroducedToday(mode) {
  return (db.days[today()] || {})[mode] || 0;
}
function newAllowance(mode) {
  return Math.max(0, db.settings[mode].newPerDay - newIntroducedToday(mode));
}
function newIds(mode, limit) {
  if (limit <= 0) return [];
  return catalog(mode).filter(id => !db.cards[id] || db.cards[id].state === 'new').slice(0, limit);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ================= navigation ================= */

const views = ['home', 'drill', 'summary', 'stats', 'settings'];
const $ = sel => document.querySelector(sel);

function show(view) {
  for (const v of views) $(`#view-${v}`).hidden = (v !== view);
  $('#btn-back').hidden = (view === 'home');
  $('#nav-stats').hidden = $('#nav-settings').hidden = (view === 'drill');
  $('#topbar-title').textContent = {
    home: 'Révisions', drill: session ? MODE_LABEL[session.mode] : 'Session',
    summary: 'Résultats', stats: 'Statistiques', settings: 'Réglages',
  }[view];
  if (view === 'home') renderHome();
  if (view === 'stats') renderStats();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

const MODE_LABEL = { mult: 'Multiplications', letters: 'Alphabet' };

function goto(view) {
  const target = view === 'home' ? '' : `#${view}`;
  if ((location.hash || '') === target) { show(view); return; }
  location.hash = target;
}
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '') || 'home';
  if (h === 'drill' && !session) { show('home'); return; }
  if (h === 'summary' && !lastSummary) { show('home'); return; }
  show(views.includes(h) ? h : 'home');
});

/* ================= accueil ================= */

function renderHome() {
  for (const mode of ['mult', 'letters']) {
    const due = dueIds(mode).length;
    const nw = Math.min(newAllowance(mode), newIds(mode, Infinity).length);
    $(`#${mode}-due`).textContent = due;
    $(`#${mode}-new`).textContent = nw;
    $(`#start-${mode}`).disabled = (due + nw === 0);
    $(`#start-${mode}`).textContent = (due + nw === 0) ? 'Terminé pour aujourd’hui ✓' : 'Réviser';
  }
  const s = streak();
  $('#home-streak').textContent = s > 0 ? `🔥 ${s} jour${s > 1 ? 's' : ''} d'affilée` : '';
}

function streak() {
  const daysWithReviews = new Set(db.log.map(e => dayKey(e.t)));
  let s = 0, d = today();
  while (daysWithReviews.has(d)) { s++; d = addDays(d, -1); }
  return s;
}

/* ================= session ================= */

let session = null;
let lastSummary = null;

function startSession(mode, practice) {
  let queue;
  if (practice) {
    // session étendue, rejouable à volonté : ~60 % de cartes faibles
    // (précision basse, temps lents), le reste pioché dans tout le paquet
    const size = db.settings[mode].practiceSize;
    const all = catalog(mode);
    const seen = all.filter(id => db.cards[id] && db.cards[id].reps > 0);
    const scored = seen.map(id => {
      const c = db.cards[id];
      const acc = c.ok / c.reps;
      const slow = c.msN ? Math.min(1, (c.msSum / c.msN) / db.settings[mode].ok) : 1;
      return { id, w: (1 - acc) * 2 + slow };
    }).sort((a, b) => b.w - a.w);
    const weak = scored.slice(0, Math.min(seen.length, Math.ceil(size * 0.6))).map(s => s.id);
    const picked = new Set(weak);
    const rest = shuffle(all.filter(id => !picked.has(id))).slice(0, Math.max(0, size - weak.length));
    queue = shuffle(weak.concat(rest));
  } else {
    const due = shuffle(dueIds(mode));
    const news = newIds(mode, newAllowance(mode));
    // insère les nouvelles cartes réparties dans la file
    queue = due.slice();
    news.forEach((id, i) => {
      const pos = news.length ? Math.min(queue.length, Math.round((i + 1) * (queue.length + news.length) / (news.length + 1))) : 0;
      queue.splice(pos, 0, id);
    });
  }
  if (!queue.length) return;
  session = { mode, practice, queue, total: queue.length, done: 0, correct: 0, wrong: 0, msList: [], current: null, qStart: 0, busy: false };
  buildKeypad(mode);
  goto('drill');
  nextCard();
}

function nextCard() {
  if (!session.queue.length) return endSession();
  session.current = session.queue.shift();
  session.input = '';
  const info = cardInfo(session.current);
  const q = $('#question');
  if (info.mode === 'mult') {
    q.innerHTML = '';
    q.textContent = `${info.prompt} = ?`;
    $('#answer-display').hidden = false;
  } else {
    q.innerHTML = `<span class="q-hint">Quelle lettre vient après…</span>${info.letter} → ?`;
    $('#answer-display').hidden = true;
  }
  renderInput();
  const isNew = getCard(session.current).state === 'new';
  $('#drill-tag').textContent = session.practice ? 'entraînement' : (isNew ? 'nouveau' : '');
  $('#drill-count').textContent = `${session.done + 1} / ${session.total}`;
  $('#progress-bar').style.width = `${(session.done / session.total) * 100}%`;
  $('#feedback').hidden = true;
  session.busy = false;
  session.qStart = performance.now();
}

function renderInput() {
  const el = $('#answer-display');
  el.textContent = session.input;
  el.classList.toggle('empty', !session.input);
}

function fmtSec(ms) {
  return (ms / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';
}

function submit(ans) {
  if (session.busy || !ans) return;
  session.busy = true;
  const ms = Math.round(performance.now() - session.qStart);
  const id = session.current;
  const info = cardInfo(id);
  const correct = ans === info.answer;
  const c = getCard(id);
  const wasNew = c.state === 'new';

  // agrégats par carte
  c.reps++;
  c.last = Date.now();
  if (correct) {
    c.ok++;
    c.msSum += ms; c.msN++;
    if (c.best === null || ms < c.best) c.best = ms;
  }
  // journal
  db.log.push({ t: Date.now(), id, m: info.mode, ok: correct ? 1 : 0, ms, p: session.practice ? 1 : 0 });

  if (!session.practice) {
    if (wasNew) {
      const t = today();
      db.days[t] = db.days[t] || {};
      db.days[t][info.mode] = (db.days[t][info.mode] || 0) + 1;
    }
    schedule(id, quality(info.mode, correct, ms));
  }
  save();

  session.done++;
  session.msList.push(ms);
  const fb = $('#feedback');
  if (correct) {
    session.correct++;
    fb.className = 'feedback ok';
    fb.innerHTML = `<span>✓ ${info.prompt}${info.mode === 'mult' ? ' = ' : ' → '}${info.answer}</span><span class="fb-sub">${fmtSec(ms)}</span>`;
    fb.hidden = false;
    setTimeout(nextCard, 800);
  } else {
    session.wrong++;
    // la carte revient un peu plus tard dans la session
    session.queue.splice(Math.min(3, session.queue.length), 0, id);
    session.total++;
    fb.className = 'feedback ko';
    fb.innerHTML = `<span>✗ ${info.prompt}${info.mode === 'mult' ? ' = ' : ' → '}${info.answer}</span><span class="fb-sub">On la reverra dans un instant</span>`;
    fb.hidden = false;
    setTimeout(nextCard, 2000);
  }
}

function endSession() {
  const s = session;
  const okMs = s.msList.length ? s.msList : [0];
  lastSummary = {
    mode: s.mode,
    tiles: [
      [s.done, 'réponses'],
      [`${s.done ? Math.round((s.correct / s.done) * 100) : 0} %`, 'de réussite'],
      [fmtSec(okMs.reduce((a, b) => a + b, 0) / okMs.length), 'temps moyen'],
      [fmtSec(Math.min(...okMs)), 'meilleur temps'],
    ],
  };
  session = null;
  $('#summary-tiles').innerHTML = lastSummary.tiles
    .map(([v, l]) => `<div class="tile"><div class="tile-value">${v}</div><div class="tile-label">${l}</div></div>`)
    .join('');
  location.hash = '#summary';
}

/* ================= claviers intégrés ================= */

function buildKeypad(mode) {
  const kp = $('#keypad');
  kp.innerHTML = '';
  kp.className = 'keypad' + (mode === 'letters' ? ' letters' : '');
  if (mode === 'mult') {
    const rows = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], ['⌫', '0', 'OK']];
    for (const row of rows) {
      const r = document.createElement('div');
      r.className = 'keypad-row';
      for (const k of row) {
        const b = document.createElement('button');
        b.className = 'key' + (k === '⌫' ? ' action' : k === 'OK' ? ' validate' : '');
        b.textContent = k;
        b.addEventListener('pointerdown', e => { e.preventDefault(); pressNum(k); });
        r.appendChild(b);
      }
      kp.appendChild(r);
    }
  } else {
    // AZERTY : ordre non alphabétique pour ne pas donner la réponse
    for (const row of ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN']) {
      const r = document.createElement('div');
      r.className = 'keypad-row';
      for (const ch of row) {
        const b = document.createElement('button');
        b.className = 'key letter';
        b.textContent = ch;
        b.addEventListener('pointerdown', e => { e.preventDefault(); if (session && !session.busy) submit(ch); });
        r.appendChild(b);
      }
      kp.appendChild(r);
    }
  }
}

function pressNum(k) {
  if (!session || session.busy) return;
  if (k === 'OK') { submit(session.input); return; }
  if (k === '⌫') session.input = session.input.slice(0, -1);
  else if (session.input.length < 3) session.input += k;
  renderInput();
}

// clavier physique (desktop)
document.addEventListener('keydown', e => {
  if (!session || $('#view-drill').hidden) return;
  if (session.mode === 'mult') {
    if (/^[0-9]$/.test(e.key)) pressNum(e.key);
    else if (e.key === 'Backspace') pressNum('⌫');
    else if (e.key === 'Enter') pressNum('OK');
  } else if (/^[a-zA-Z]$/.test(e.key) && !session.busy) {
    submit(e.key.toUpperCase());
  }
});

/* ================= statistiques ================= */

let statsMode = 'mult';
// rampe séquentielle (bleu, clair → foncé) : maîtrise croissante
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

function accuracyStep(c) {
  const acc = c.ok / c.reps;
  if (acc < 0.5) return 0;
  if (acc < 0.7) return 1;
  if (acc < 0.8) return 2;
  if (acc < 0.9) return 3;
  if (acc < 1) return 4;
  return 5;
}

function renderStats() {
  const mode = statsMode;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  const all = catalog(mode);
  const seen = all.filter(id => db.cards[id] && db.cards[id].reps > 0);
  const mastered = seen.filter(id => db.cards[id].interval >= 21);
  let reps = 0, ok = 0, msSum = 0, msN = 0;
  for (const id of seen) {
    const c = db.cards[id];
    reps += c.reps; ok += c.ok; msSum += c.msSum; msN += c.msN;
  }
  const t = today();
  const todayCount = db.log.filter(e => e.m === mode && dayKey(e.t) === t).length;

  $('#stats-tiles').innerHTML = [
    [`${seen.length} / ${all.length}`, 'cartes vues'],
    [mastered.length, 'maîtrisées (≥ 3 sem.)'],
    [reps ? `${Math.round((ok / reps) * 100)} %` : '—', 'précision globale'],
    [msN ? fmtSec(msSum / msN) : '—', 'temps moyen (justes)'],
    [todayCount, 'réponses aujourd’hui'],
    [dueIds(mode).length, 'à revoir maintenant'],
  ].map(([v, l]) => `<div class="tile"><div class="tile-value">${v}</div><div class="tile-label">${l}</div></div>`).join('');

  renderActivity(mode);
  if (mode === 'mult') renderMultMap(); else renderLettersMap();
  $('#map-title').textContent = mode === 'mult' ? 'Maîtrise par multiplication' : 'Maîtrise par lettre';
  $('#mastery-legend').innerHTML =
    `<span class="legend-item"><span class="swatch" style="background:var(--hairline)"></span>pas encore vue</span>` +
    RAMP.map((h, i) => i % 2 ? '' : `<span class="legend-item"><span class="swatch" style="background:${h}"></span>${['< 50 %', '70–80 %', '90–99 %'][i / 2]}</span>`).join('') +
    `<span class="legend-item"><span class="swatch" style="background:${RAMP[5]}"></span>100 %</span>`;
  $('#card-detail').hidden = true;
}

function renderActivity(mode) {
  const byDay = {};
  for (const e of db.log) {
    if (e.m !== mode) continue;
    const k = dayKey(e.t);
    byDay[k] = byDay[k] || { ok: 0, ko: 0 };
    if (e.ok) byDay[k].ok++; else byDay[k].ko++;
  }
  const days = [];
  let d = addDays(today(), -13);
  for (let i = 0; i < 14; i++) { days.push(d); d = addDays(d, 1); }
  const max = Math.max(4, ...days.map(k => (byDay[k] ? byDay[k].ok + byDay[k].ko : 0)));
  $('#activity-chart').innerHTML = days.map(k => {
    const v = byDay[k] || { ok: 0, ko: 0 };
    const hOk = (v.ok / max) * 100, hKo = (v.ko / max) * 100;
    const title = `${k.slice(8)}/${k.slice(5, 7)} — ${v.ok} ✓ · ${v.ko} ✗`;
    return `<div class="activity-col" data-tip="${title}">
      <div class="seg good" style="height:${hOk}%"></div>
      <div class="seg bad" style="height:${hKo}%"></div>
    </div>`;
  }).join('');
  const labels = days.map(k => `<span>${Number(k.slice(8))}</span>`).join('');
  let lab = $('#activity-chart').parentElement.querySelector('.activity-labels');
  if (!lab) {
    lab = document.createElement('div');
    lab.className = 'activity-labels';
    $('#activity-chart').after(lab);
  }
  lab.innerHTML = labels;
}

function cellColor(id) {
  const c = db.cards[id];
  if (!c || !c.reps) return null;
  return RAMP[accuracyStep(c)];
}

function renderMultMap() {
  const map = $('#mastery-map');
  let html = '<div class="mult-map"><span class="hd"></span>';
  for (let b = 1; b <= 12; b++) html += `<span class="hd">${b}</span>`;
  for (let a = 1; a <= 12; a++) {
    html += `<span class="hd">${a}</span>`;
    for (let b = 1; b <= 12; b++) {
      const id = `m-${a}x${b}`;
      const col = cellColor(id);
      html += `<button class="cell${col ? '' : ' unseen'}" data-id="${id}" aria-label="${a} × ${b}"${col ? ` style="background:${col}"` : ''}></button>`;
    }
  }
  map.innerHTML = html + '</div>';
}

function renderLettersMap() {
  const map = $('#mastery-map');
  map.innerHTML = '<div class="letters-map">' + catalog('letters').map(id => {
    const info = cardInfo(id);
    const col = cellColor(id);
    const c = db.cards[id];
    const cls = col ? (accuracyStep(c) >= 4 ? 'deep' : accuracyStep(c) >= 2 ? 'mid' : '') : 'unseen';
    return `<button class="cell ${cls}" data-id="${id}"${col ? ` style="background:${col}"` : ''}>${info.letter}→${info.answer}</button>`;
  }).join('') + '</div>';
}

function showCardDetail(id) {
  const info = cardInfo(id);
  const c = db.cards[id];
  const el = $('#card-detail');
  const title = info.mode === 'mult' ? `${info.prompt} = ${info.answer}` : `${info.letter} → ${info.answer}`;
  if (!c || !c.reps) {
    el.innerHTML = `<h4>${title}</h4><p style="margin:0;color:var(--muted)">Pas encore vue.</p>`;
  } else {
    el.innerHTML = `<h4>${title}</h4><dl>
      <dt>Révisions</dt><dd>${c.reps} (${c.lapses} oubli${c.lapses > 1 ? 's' : ''})</dd>
      <dt>Précision</dt><dd>${Math.round((c.ok / c.reps) * 100)} %</dd>
      <dt>Temps moyen</dt><dd>${c.msN ? fmtSec(c.msSum / c.msN) : '—'}</dd>
      <dt>Record</dt><dd>${c.best !== null ? fmtSec(c.best) : '—'}</dd>
      <dt>Prochaine révision</dt><dd>${c.due ? (c.due <= today() ? 'maintenant' : c.due) : '—'}</dd>
      <dt>Intervalle</dt><dd>${c.interval} jour${c.interval > 1 ? 's' : ''}</dd>
    </dl>`;
  }
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* tooltip (survol souris + appui) */
const tooltip = $('#tooltip');
document.addEventListener('pointerover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tooltip.hidden = true; return; }
  tooltip.textContent = t.dataset.tip;
  tooltip.hidden = false;
  const r = t.getBoundingClientRect();
  tooltip.style.left = Math.max(4, Math.min(window.innerWidth - 160, r.left)) + 'px';
  tooltip.style.top = (r.top - 34) + 'px';
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('[data-tip]')) tooltip.hidden = true;
});

/* ================= réglages ================= */

function renderSettings() {
  document.querySelectorAll('.setting-group').forEach(g => {
    const mode = g.dataset.mode;
    g.querySelectorAll('input').forEach(inp => {
      const key = inp.dataset.key;
      inp.value = (key === 'fast' || key === 'ok') ? db.settings[mode][key] / 1000 : db.settings[mode][key];
    });
  });
}

document.querySelectorAll('.setting-group input').forEach(inp => {
  inp.addEventListener('change', () => {
    const mode = inp.closest('.setting-group').dataset.mode;
    const key = inp.dataset.key;
    const v = parseFloat(inp.value);
    if (isNaN(v) || v < 0) return renderSettings();
    db.settings[mode][key] = (key === 'fast' || key === 'ok') ? Math.round(v * 1000) : Math.round(v);
    save();
  });
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `revisions-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btn-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.cards || !Array.isArray(data.log)) throw new Error('format');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    db = load();
    alert('Données importées ✓');
    goto('home');
  } catch (err) {
    alert('Fichier invalide.');
  }
  e.target.value = '';
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer toutes les données (cartes, historique, stats) ?')) return;
  localStorage.removeItem(STORAGE_KEY);
  db = load();
  goto('home');
});

/* ================= branchements ================= */

$('#start-mult').addEventListener('click', () => startSession('mult', false));
$('#start-letters').addEventListener('click', () => startSession('letters', false));
$('#practice-mult').addEventListener('click', () => startSession('mult', true));
$('#practice-letters').addEventListener('click', () => startSession('letters', true));
$('#summary-home').addEventListener('click', () => goto('home'));
$('#summary-again').addEventListener('click', () => {
  const m = lastSummary.mode;
  // s'il reste des cartes dues/nouvelles → session de révision, sinon entraînement libre
  const daily = dueIds(m).length + Math.min(newAllowance(m), newIds(m, Infinity).length);
  startSession(m, daily === 0);
});
$('#nav-stats').addEventListener('click', () => goto('stats'));
$('#nav-settings').addEventListener('click', () => goto('settings'));
$('#btn-back').addEventListener('click', () => {
  if (session && !confirm('Quitter la session en cours ?')) return;
  session = null;
  goto('home');
});
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  statsMode = t.dataset.tab;
  renderStats();
}));
$('#mastery-map').addEventListener('click', e => {
  const cell = e.target.closest('.cell');
  if (cell) showCardDetail(cell.dataset.id);
});

/* démarrage */
history.replaceState(null, '', location.pathname + location.search);
show('home');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

})();
