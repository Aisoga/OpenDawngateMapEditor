// Map > Rules... : map.json's optional "rules" section (mapc's format 1: how a match on the map is won, the start
// level, respawn, minions, gold, XP, Bindings coming back, wells, surrender) and "tuning" (which of the game's maps the
// balance starts from), made as easy as the user asked: top to bottom
// 1. Based on: Dawngate pace (SM_Map_v5) or Anshavar Pass pace (MM_Map_v3), writing "tuning";
// 2. the preset cards: one click writes the whole section as one undo step (Classic removes it); the card that matches
//    is lit, and after an edit "Custom (from <the last card>)";
// 3. What players will read: the summary and the short text players see (mapc's DescribeRules through POST
//    /api/rules/<map>, after each edit), and an Unrated badge when the victory changes;
// 4. plain fields in groups (How to win, Players, Economy, Minions, Bindings, Wells, Surrender), each with its unit and
//    the game's value as placeholder and beside it (GET /api/tuning?level=); an emptied field removes its member;
// 5. live previews under each group (the respawn at two moments, the waves by the time limit, the gold by 10:00, ...);
// 6. the check's rules.* findings at their fields (and refs.tuning at Based on); a finding's jump opens the window there.
// Also Advanced > Gameplay Constants... (read only: every member of the map's compiled tuning with the level's value
// and this map's, bold when changed) and Help > Making Maps' "Try it" (a kill race of 3, then Test).
//
// With a backend whose mapc has no `tuning` command (or an older backend without the routes) the page uses its own copy
// of the shipped values (FALLBACK) and of the summary's wording (describe: mapc's DescribeRules in JavaScript; the
// self-test checks both against server/testdata/maprules/describe.json).
//
// It uses app.js's globals (S, ED, edit, undo, h, log, api, snapshot, runCheck, testMap, $) and its hooks:
// ED.on('doc' | 'open' | 'checked' | 'started' | 'window' | 'focus-rules'), ED.rulesText (the map inspector's line),
// ED.selftests.rules and rules-save.
'use strict';

const RU = (() => {
  const URLQ = new URLSearchParams(location.search); // read at load: opening a map rewrites the URL
  const clone = v => JSON.parse(JSON.stringify(v));
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const X = '\u00d7', SEP = ' \u00b7 ';

  // the levels a map's balance can start from (map.json "tuning")
  const LEVELS = [
    { id: 'SM_Map_v5', name: 'Dawngate pace', tip: 'The balance of the game\'s main map (SM_Map_v5)' },
    { id: 'MM_Map_v3', name: 'Anshavar Pass pace', tip: 'The balance of Anshavar Pass (MM_Map_v3): quicker respawns' },
  ];
  // the shipped values (the levels' LevelGameplayTuning and RewardsTuning), for a backend that can't say them
  const SHIPPED = {
    startLevel: 1, minions: { firstWave: 60, every: 30 }, gold: { start: 500, perMinute: 100, from: 60, kills: 1 },
    xp: { speed: 1 }, bindings: { respawn: 0 }, wells: { opensAt: 900, relock: 240, gold: 1 }, surrender: { after: 20, allowed: true },
  };
  const FALLBACK = {
    SM_Map_v5: Object.assign(clone(SHIPPED), { respawn: { base: 15, perLevel: 0.5, perMinute: 1.25 } }),
    MM_Map_v3: Object.assign(clone(SHIPPED), { respawn: { base: 10, perLevel: 0.5, perMinute: 0.5 } }),
  };
  // the cards (their rules: describe.json's cases of the same name)
  const PRESETS = [
    { id: 'classic', name: 'Classic', line: 'Destroy the Guardian: the game\'s own rules.', rules: null },
    { id: 'brawl', name: 'Brawl', line: 'Level 6, 1,500 gold, quick respawns, first to 25 kills (or most after 20 min), no surrender.',
      rules: { victory: { kills: 25, minutes: 20 }, startLevel: 6, respawn: { base: 6, perLevel: 0.25 }, gold: { start: 1500, kills: 1.5 }, surrender: { allowed: false } } },
    { id: 'race', name: 'Kill Race', line: 'The first team to 20 kills wins, or the one with more after 25 minutes.', rules: { victory: { kills: 20, minutes: 25 } } },
    { id: 'sudden', name: 'Sudden Death 15', line: '15 minutes, then the team with more kills wins.', rules: { victory: { minutes: 15 } } },
    { id: 'goldrush', name: 'Gold Rush', line: '1,500 gold, 300 a minute, double kill gold, wells open at 5:00.',
      rules: { gold: { start: 1500, perMinute: 300, kills: 2 }, wells: { opensAt: 300 } } },
    { id: 'siege', name: 'Siege', line: 'Bindings come back 4 min after they fall; a wave every 25 s.',
      rules: { bindings: { respawn: 240 }, minions: { every: 25 } } },
    { id: 'late', name: 'Late Game Now', line: 'Everyone starts at level 10 with 4,000 gold.', rules: { startLevel: 10, gold: { start: 4000 } } },
  ];
  // the format's order of the members (a new member is written at its place)
  const ORDER = {
    '': ['victory', 'startLevel', 'respawn', 'minions', 'gold', 'xp', 'bindings', 'wells', 'surrender', 'lobbyPreset'],
    victory: ['kills', 'minutes', 'bindings'], respawn: ['base', 'perLevel', 'perMinute'], minions: ['firstWave', 'every'],
    gold: ['start', 'perMinute', 'from', 'kills'], xp: ['speed'], bindings: ['respawn'], wells: ['opensAt', 'relock', 'gold'],
    surrender: ['after', 'allowed'],
  };
  // Advanced > Gameplay Constants' rows when mapc can't list them: the members the rules set
  const CONSTANTS = [
    ['LevelGameplayTuning', 'deathTimeBase', 'respawn', 'base'], ['LevelGameplayTuning', 'deathTimePerLevel', 'respawn', 'perLevel'],
    ['LevelGameplayTuning', 'deathTimePerMinute', 'respawn', 'perMinute'], ['LevelGameplayTuning', 'minionSpawnDelay1', 'minions', 'firstWave'],
    ['LevelGameplayTuning', 'minionSpawnInterval1', 'minions', 'every'], ['LevelGameplayTuning', 'towerRespawnEnabled', 'bindings', 'on'],
    ['LevelGameplayTuning', 'tower[].respawnTime', 'bindings', 'respawn'],
    ['LevelGameplayTuning', 'goldMineLockedDurationFirstInSeconds', 'wells', 'opensAt'],
    ['LevelGameplayTuning', 'goldMineLockedDurationInSeconds', 'wells', 'relock'],
    ['LevelGameplayTuning', 'surrenderEnableOn_MatchTimeInMinutes', 'surrender', 'after'],
    ['RewardsTuning', 'startingGold', 'gold', 'start'], ['RewardsTuning', 'passiveGold', 'gold', 'perMinute'],
    ['RewardsTuning', 'passiveStartDelayInSeconds', 'gold', 'from'],
  ];

  const R = {
    defaults: {}, loading: {}, // level -> {values, source: 'mapc' | 'page', error}
    read: null, readKey: '', readSeq: 0, readP: null, readTimer: 0, // what players read: {summary, short, victoryChanged, balanceChanged, constants, source}
    from: '', fromPkg: '', // the last card clicked (Custom (from ...))
    lobbyMode: null, // the suggested lobby setup's choice the value alone can't tell ({pkg, mode, value}: Custom... before a change, a server's preset before its id; only while the value is the one it was chosen with, so an undo shows the value's own)
  };

  // ---- the suggested lobby setup (map.json rules.lobbyPreset, not compiled): a custom game on the map starts its
  // lobby with it; the lobby's catalog (the server's server/internal/rules, kept equal by mapedit's Go test) ----
  const LOBBY = [
    { id: 'pick', name: 'Shaper pick', def: 'blind', opts: [['blind', 'Blind pick'], ['random', 'All Random'], ['draft', 'Draft'], ['army', 'Army Pick'], ['clone', 'Clone Pick']] },
    { id: 'shaperPool', name: 'Shaper pool', def: 'all', opts: [['all', 'All shapers'], ['melee', 'Melee shapers'], ['ranged', 'Ranged shapers'], ['tank', 'Tanks'],
      ['bruiser', 'Bruisers'], ['carry', 'Carries'], ['mage', 'Mages'], ['support', 'Supports']] },
    { id: 'shop', name: 'Shop access', def: 'normal', opts: [['normal', 'Normal shop'], ['onDeath', 'Shop on Death']] },
    { id: 'itemPool', name: 'Item pool', def: 'all', opts: [['all', 'All items'], ['noLegendary', 'No legendary items'], ['basics', 'Basic items only'], ['lightning', 'Lightning items only']] },
    { id: 'victory', name: 'Win condition', def: 'guardian', opts: [['guardian', 'Guardian only'], ['race10', 'Kill race 10'], ['race20', 'Kill race 20'], ['race30', 'Kill race 30'],
      ['time15', 'Most kills after 15 min'], ['race20time20', 'Race 20 or 20 min'], ['bind1', 'First Binding'], ['bind3', 'First to 3 Bindings']] },
  ];
  // the built-in presets (the server's rules.presets): their options away from the defaults
  const LOBBY_PRESETS = { standard: {}, draft: { pick: 'draft' }, aram: { pick: 'random', shop: 'onDeath' }, allrandom: { pick: 'random' } };
  // lobbyOf reads the value: {mode: none | standard | draft | custom | server, opts: {category: option}, id (a server's preset)}
  function lobbyOf(v) {
    if (typeof v !== 'string' || !v.trim()) return { mode: 'none', opts: {} };
    v = v.trim();
    if (v.startsWith('{')) { let o = null; try { o = JSON.parse(v); } catch (e) { o = null; } return { mode: 'custom', opts: isObj(o) ? o : {} }; }
    if (v.includes('=')) {
      const o = {};
      for (const kv of v.split(',')) { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
      return { mode: 'custom', opts: o };
    }
    const id = v.toLowerCase();
    if (id === 'standard' || id === 'draft') return { mode: id, opts: clone(LOBBY_PRESETS[id]) };
    if (LOBBY_PRESETS[id]) return { mode: 'custom', opts: clone(LOBBY_PRESETS[id]) };
    return { mode: 'server', opts: {}, id: v };
  }
  // lobbySpec writes the options away from their defaults as the short form, in the catalog's order ("standard" for none)
  function lobbySpec(opts) {
    const parts = LOBBY.filter(c => opts[c.id] && opts[c.id] !== c.def).map(c => c.id + '=' + opts[c.id]);
    return parts.length ? parts.join(',') : 'standard';
  }
  // lobbyWords: the options' names away from the defaults ("All Random, First Binding"), "Standard" for none
  function lobbyWords(opts) {
    const parts = LOBBY.filter(c => opts[c.id] && opts[c.id] !== c.def).map(c => { const o = c.opts.find(x => x[0] === opts[c.id]); return o ? o[1] : c.name + ' ' + opts[c.id]; });
    return parts.length ? parts.join(', ') : 'Standard';
  }
  function lobbyModeNow(lo) {
    const L = R.lobbyMode, m = L && L.pkg === S.pkg && L.value === (get('lobbyPreset') || '') ? L.mode : '';
    if (m === 'custom' && (lo.mode === 'standard' || lo.mode === 'custom')) return 'custom';
    if (m === 'server' && (lo.mode === 'none' || lo.mode === 'server')) return 'server';
    return lo.mode;
  }
  // setLobby writes the value (empty removes it); mode: the choice shown with it
  function setLobby(v, mode) {
    R.lobbyMode = mode ? { pkg: S.pkg, mode, value: v || '' } : null;
    edit(d => setRule(d, 'lobbyPreset', null, v ? v : undefined));
  }

  // ---- the words players read: mapc's DescribeRules (rules.go) in JavaScript, for a backend that can't say them ----
  const set = v => v !== undefined && v !== null;
  function num(v) {
    v = +v;
    if (Number.isInteger(v) && Math.abs(v) >= 1000 && Math.abs(v) < 1e15) return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return String(v);
  }
  const plural = (n, unit) => (+n === 1 ? '1 ' + unit : n + ' ' + unit + 's');
  function duration(s) {
    s = +s;
    if (s < 60) return num(s) + ' s';
    const m = Math.floor(s / 60), rest = s - 60 * m;
    return rest > 0 ? `${num(m)} min ${num(rest)} s` : num(m) + ' min';
  }
  function clock(s) {
    s = +s;
    if (!Number.isInteger(s)) return num(s) + ' s';
    return Math.trunc(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  const has = (o, ...ks) => isObj(o) && ks.some(k => set(o[k]));
  function balanceChanged(r) {
    if (!isObj(r)) return false;
    return has(r.respawn, 'base', 'perLevel', 'perMinute') || has(r.minions, 'firstWave', 'every') || has(r.bindings, 'respawn') ||
      has(r.wells, 'opensAt', 'relock', 'gold') || has(r.surrender, 'after', 'allowed') || has(r.gold, 'start', 'perMinute', 'from', 'kills') ||
      has(r.xp, 'speed');
  }
  const victoryChanged = r => isObj(r) && has(r.victory, 'kills', 'minutes', 'bindings');
  // the victory's words, one part however many conditions add up (rules.go victoryText)
  function victoryText(v) {
    const race = [];
    if (set(v.kills)) race.push('to ' + plural(v.kills, 'kill'));
    if (set(v.bindings)) race.push('to destroy ' + (+v.bindings === 1 ? 'a Binding' : plural(v.bindings, 'Binding')));
    const first = race.length ? 'first ' + race.join(' or ') : '';
    if (!set(v.minutes)) return first + ' wins';
    const most = set(v.bindings) ? `most Bindings after ${plural(v.minutes, 'minute')} wins (then kills)` : `most kills after ${plural(v.minutes, 'minute')} wins`;
    return !race.length ? most : race.length > 1 ? first + ', or ' + most : first + ' or ' + most;
  }
  const SHORTMAX = 30; // rules.go ShortMax
  function describe(r) {
    const out = { summary: '', short: '', victoryChanged: victoryChanged(r), balanceChanged: balanceChanged(r) };
    if (!isObj(r)) return out;
    const parts = [], tags = [];
    const v = r.victory;
    if (has(v, 'kills', 'minutes', 'bindings')) {
      parts.push(victoryText(v));
      if (set(v.kills)) tags.push('Race ' + v.kills);
      if (set(v.bindings)) tags.push('Bind ' + v.bindings);
      if (set(v.minutes)) tags.push(v.minutes + ' min');
    }
    let lvTag = '';
    if (set(r.startLevel)) { parts.push('everyone starts at level ' + r.startLevel); lvTag = 'Lv ' + r.startLevel; tags.push(lvTag); }
    if (isObj(r.respawn)) {
      const p = r.respawn, grow = [];
      if (set(p.perLevel)) grow.push(num(p.perLevel) + ' s a level');
      if (set(p.perMinute)) grow.push(num(p.perMinute) + ' s a minute');
      if (set(p.base)) parts.push(['respawn ' + num(p.base) + ' s', ...grow].join(' + '));
      else if (grow.length) parts.push('respawn time grows ' + grow.join(' and '));
    }
    if (isObj(r.minions)) {
      const m = r.minions;
      if (set(m.firstWave) && set(m.every)) parts.push(`minions at ${clock(m.firstWave)}, then every ${duration(m.every)}`);
      else if (set(m.firstWave)) parts.push('minions at ' + clock(m.firstWave));
      else if (set(m.every)) parts.push('a minion wave every ' + duration(m.every));
    }
    if (isObj(r.gold)) {
      const g = r.gold, w = [];
      if (set(g.start)) w.push(num(g.start) + ' starting gold');
      if (set(g.perMinute) && set(g.from)) w.push(`${num(g.perMinute)} gold a minute from ${clock(g.from)}`);
      else if (set(g.perMinute)) w.push(num(g.perMinute) + ' gold a minute');
      else if (set(g.from)) w.push('passive gold from ' + clock(g.from));
      if (set(g.kills)) w.push('kill gold x' + num(g.kills));
      if (w.length) parts.push(w.join(', '));
    }
    if (has(r.xp, 'speed')) parts.push('XP x' + num(r.xp.speed));
    if (has(r.bindings, 'respawn')) parts.push('Bindings return ' + duration(r.bindings.respawn) + ' after they fall');
    if (isObj(r.wells)) {
      const p = r.wells, w = [];
      if (set(p.opensAt)) w.push('wells open at ' + clock(p.opensAt));
      if (set(p.relock)) w.push('relock ' + duration(p.relock) + ' after a capture');
      if (set(p.gold)) w.push('well gold x' + num(p.gold));
      if (w.length) {
        if (!set(p.opensAt) && set(p.relock)) w[0] = 'wells ' + w[0];
        parts.push(w.join(', '));
      }
    }
    if (isObj(r.surrender)) {
      const p = r.surrender;
      if (set(p.allowed) && !p.allowed) parts.push('no surrender (only when a player is gone)');
      else if (set(p.after)) parts.push('surrender from minute ' + num(p.after));
      else if (set(p.allowed)) parts.push('surrender allowed');
    }
    if (!parts.length) return out;
    const s = parts.join('; ') + '.';
    out.summary = s[0].toUpperCase() + s.slice(1);
    if (out.balanceChanged) tags.push('Tuned');
    // the short text's room: "Tuned" goes first, then the start level (the summary names both)
    for (const drop of ['Tuned', lvTag]) {
      const i = drop ? tags.indexOf(drop) : -1;
      if (i >= 0 && tags.length > 1 && tags.join(SEP).length > SHORTMAX) tags.splice(i, 1);
    }
    out.short = tags.join(SEP);
    return out;
  }

  // ---- the document ---------------------------------------------------------------------------------------------
  const rules = () => (S.doc && isObj(S.doc.rules) ? S.doc.rules : null);
  function get(g, k) {
    const r = rules();
    if (!r) return undefined;
    if (k == null) return r[g];
    return isObj(r[g]) ? r[g][k] : undefined;
  }
  // ordered returns o with k set to v; a new member goes before the first later member of the format's order
  function ordered(o, k, v, order) {
    if (k in o) { o[k] = v; return o; }
    const out = {}, at = order.indexOf(k);
    let put = false;
    for (const [kk, vv] of Object.entries(o)) {
      if (!put && at >= 0 && order.indexOf(kk) > at) { out[k] = v; put = true; }
      out[kk] = vv;
    }
    if (!put) out[k] = v;
    return out;
  }
  // setRule writes rules[g][k] (k null: rules[g]) into the document d; undefined removes it, and an emptied member and
  // an emptied section go with it
  function setRule(d, g, k, v) {
    let r = isObj(d.rules) ? d.rules : {};
    if (k == null) {
      if (v === undefined) delete r[g]; else r = ordered(r, g, v, ORDER['']);
    } else {
      let o = isObj(r[g]) ? r[g] : {};
      if (v === undefined) delete o[k]; else o = ordered(o, k, v, ORDER[g] || []);
      if (Object.keys(o).length) r = ordered(r, g, o, ORDER['']); else delete r[g];
    }
    if (Object.keys(r).length) d.rules = r; else delete d.rules;
  }
  // canon: a value's JSON with sorted keys (a card matches the section whatever its order)
  const canon = v => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));
  // the cards' part of the section: every member but the suggested lobby setup (a card keeps it)
  function cardRules(r) {
    if (!isObj(r)) return r;
    const o = Object.assign({}, r);
    delete o.lobbyPreset;
    return o;
  }
  function presetNow() {
    const r = cardRules(rules());
    if (!r || !Object.keys(r).length) return 'classic';
    const c = canon(r), p = PRESETS.find(q => q.rules && canon(q.rules) === c);
    return p ? p.id : '';
  }

  // ---- the level's values ---------------------------------------------------------------------------------------
  const level = () => (S.doc && LEVELS.some(l => l.id === S.doc.tuning) ? S.doc.tuning : 'SM_Map_v5');
  function deepMerge(a, b) {
    const out = clone(a);
    for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    return out;
  }
  function loadDefaults(l) {
    if (R.defaults[l]) return Promise.resolve(R.defaults[l]);
    if (R.loading[l]) return R.loading[l];
    R.loading[l] = (async () => {
      let res = null;
      try { res = await api('GET', '/api/tuning?level=' + encodeURIComponent(l)); } catch (e) { res = null; }
      const ok = !!res && res.ok === true && isObj(res.defaults);
      R.defaults[l] = { values: ok ? deepMerge(FALLBACK[l] || FALLBACK.SM_Map_v5, res.defaults) : (FALLBACK[l] || FALLBACK.SM_Map_v5),
        source: ok ? 'mapc' : 'page', from: ok ? res.source || '' : '', error: ok ? '' : (res && res.error) || 'no answer' };
      delete R.loading[l];
      paneKey = '';
      later();
      return R.defaults[l];
    })();
    return R.loading[l];
  }
  function defaults() {
    const l = level();
    if (!R.defaults[l]) loadDefaults(l);
    return R.defaults[l] ? R.defaults[l].values : FALLBACK[l];
  }
  function def(g, k) {
    const d = defaults();
    return k == null ? d[g] : isObj(d[g]) ? d[g][k] : undefined;
  }
  // eff: the value a match plays: the map's, else the level's
  function eff(g, k) { const v = get(g, k); return set(v) ? v : def(g, k); }

  // ---- what players read ----------------------------------------------------------------------------------------
  async function refreshRead() {
    if (!S.doc || !S.pkg) return;
    const key = JSON.stringify([S.pkg, S.doc.tuning, rules()]);
    if (key === R.readKey && R.read) return;
    R.readKey = key;
    const seq = ++R.readSeq, local = describe(rules());
    let res = null;
    try { res = await api('POST', '/api/rules/' + encodeURIComponent(S.pkg), snapshot()); } catch (e) { res = null; }
    if (seq !== R.readSeq) return;
    const ok = !!res && res.ok === true && typeof res.summary === 'string';
    R.read = ok
      ? { summary: res.summary, short: res.short || '', victoryChanged: !!res.victoryChanged, balanceChanged: !!res.balanceChanged,
        constants: Array.isArray(res.constants) ? res.constants : null, source: 'mapc', from: res.source || '', key }
      : Object.assign(local, { constants: null, source: 'page', error: (res && res.error) || 'no answer', key });
    renderRead();
    if (ED.isOpen('constants')) renderConstants();
  }
  // readNow asks at once (the self-test); the panel asks 150 ms after an edit
  function readNow() {
    clearTimeout(R.readTimer);
    R.readP = refreshRead();
    return R.readP;
  }
  function readLater() { clearTimeout(R.readTimer); R.readTimer = setTimeout(readNow, 150); }

  // ---- the window -----------------------------------------------------------------------------------------------
  const pane = ED.addPane('window:rules', 'Map Rules'); // Map > Rules...
  pane.id = 'paneRules';
  const cpane = ED.addPane('window:constants', 'Gameplay Constants'); // Advanced > Gameplay Constants...
  cpane.id = 'paneConstants';
  ED.actions['map.rules'] = () => ED.openWindow('rules');
  ED.actions['map.constants'] = () => ED.openWindow('constants');
  let slots = {}, readBox = null;

  const fmtVal = (v, unit) => (unit === X ? X + num(v) : unit ? num(v) + ' ' + unit : num(v));
  function field(path, label, control, hint) {
    const f = h('div', { class: 'vfind' });
    slots[path] = f;
    return h('div', { class: 'rfield', 'data-path': path }, h('label', { class: 'rl' }, h('span', { class: 'rlab' }, label), control),
      hint ? h('div', { class: 'hint' }, hint) : null, f);
  }
  // numField: a number for rules[g][k] (k null: rules[g]), with its unit and the level's value as placeholder and
  // beside it; empty removes the member; o: {min, max, step, int, hint, list, none (the text for a level value of 0),
  // ph and side (the placeholder and the text beside it for a member the level doesn't have: the Binding race's
  // enemy Bindings)}
  function numField(g, k, label, unit, o) {
    const path = 'rules.' + g + (k == null ? '' : '.' + k), v = get(g, k), dv = def(g, k);
    const shown = set(dv) && !(o.none && !dv);
    const inp = h('input', { type: 'number', step: o.step || 'any', min: o.min, max: o.max, 'data-v': path, list: o.list,
      placeholder: set(o.ph) ? String(o.ph) : shown ? String(dv) : '',
      title: set(o.side) ? o.side : 'Empty: the game\'s value' + (shown ? ' (' + fmtVal(dv, unit) + ')' : '') });
    if (set(v)) inp.value = v;
    inp.onchange = () => {
      const s = inp.value.trim(), n = Number(s);
      if (s !== '' && (!Number.isFinite(n) || (o.int && !Number.isInteger(n)))) {
        inp.value = set(v) ? v : '';
        log(`${label}: ${o.int ? 'a whole number' : 'a number'}, please`, 'err');
        return;
      }
      edit(d => setRule(d, g, k, s === '' ? undefined : n));
    };
    return field(path, label, h('span', { class: 'rin' }, inp, unit && unit !== X ? h('span', { class: 'runit' }, unit) : null,
      unit === X ? h('span', { class: 'runit' }, X) : null,
      h('span', { class: 'rdef' }, set(o.side) ? o.side : shown ? 'game: ' + fmtVal(dv, unit) : o.none ? 'game: ' + o.none : '')), o.hint);
  }
  function group(id, title, ...kids) {
    const f = h('div', { class: 'vfind' });
    slots['rules.' + id] = slots['rules.' + id] || f;
    return h('div', { class: 'rgrp', 'data-group': id }, h('div', { class: 'rgh' }, title), f, ...kids);
  }
  const prev = (id, ...lines) => h('div', { class: 'rprev', 'data-prev': id }, ...lines.filter(Boolean).map(t => h('div', {}, t)));
  const round1 = x => Math.round(x * 10) / 10;

  // the previews (the host's formulas: the death timer base + perLevel x level + perMinute x minutes, the waves at
  // firstWave + k x every, the passive gold perMinute a minute from its start)
  function respawnAt(lv, sec) { return round1(eff('respawn', 'base') + eff('respawn', 'perLevel') * lv + eff('respawn', 'perMinute') * sec / 60); }
  function wavesBy(t) { const f = eff('minions', 'firstWave'), e = eff('minions', 'every'); return f > t ? 0 : Math.floor((t - f) / e) + 1; }
  function goldBy(t) { return eff('gold', 'start') + eff('gold', 'perMinute') * Math.max(0, t - eff('gold', 'from')) / 60; }
  // How to win: the win conditions add up (whichever is met first ends the match; the Guardian always wins), each a
  // checkbox writing its member: the kill race victory.kills, the Binding race victory.bindings, the time limit
  // victory.minutes
  const WINS = { race: 'kills', bindings: 'bindings', time: 'minutes' };
  const winOn = id => has(get('victory'), WINS[id]);
  // enemyBindings: how many Bindings each team has (mapc BindingsPerTeam): "auto" 3 a lane, else the places per lane
  function enemyBindings() {
    const b = S.doc && S.doc.base ? S.doc.base.bindings : null, lanes = (S.doc && Array.isArray(S.doc.lanes)) ? S.doc.lanes : [];
    if (b === 'auto') return 3 * lanes.length;
    if (!isObj(b)) return 0;
    return lanes.reduce((n, ln) => n + (Array.isArray(b[String(ln.id)]) ? b[String(ln.id)].length : 0), 0);
  }
  const bindingsBack = () => eff('bindings', 'respawn') > 0;
  function setWin(id, on) {
    const k = WINS[id], nB = enemyBindings();
    // a new condition's start: a race of 20, 3 Bindings (fewer on a map with fewer), 25 minutes (after the surrender's unlock)
    const start = { kills: 20, minutes: 25, bindings: bindingsBack() || nB >= 3 || !nB ? 3 : nB }[k];
    edit(d => setRule(d, 'victory', k, on ? start : undefined));
  }
  const timeLimit = () => (has(get('victory'), 'minutes') ? +get('victory', 'minutes') : 0);

  function applyPreset(p) {
    if (!S.doc) return;
    R.from = p.id;
    R.fromPkg = S.pkg;
    edit(d => {
      const lp = isObj(d.rules) ? d.rules.lobbyPreset : undefined;
      if (p.rules) d.rules = clone(p.rules); else delete d.rules;
      if (lp !== undefined) setRule(d, 'lobbyPreset', null, lp);
    });
    log(`rules: ${p.name}${p.rules ? '' : ' (the map\'s rules removed)'}; Undo takes it back`, 'ok');
  }

  function renderPane() {
    const focused = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.dataset.v : '';
    const scroll = pane.scrollTop;
    pane.textContent = '';
    slots = {};
    if (!S.doc) { pane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    const top = h('div', { class: 'vfind' });
    slots.rules = top;
    const l = level(), lv = LEVELS.find(x => x.id === l), dsrc = R.defaults[l];
    // 1. Based on
    pane.append(h('div', { class: 'rgrp', 'data-group': 'tuning', 'data-path': 'tuning' }, h('div', { class: 'rgh' }, 'Based on'),
      h('div', { class: 'rseg' }, ...LEVELS.map(x => h('button', { class: x.id === l ? 'on' : '', 'data-level': x.id, title: x.tip,
        onclick: () => { if (S.doc.tuning !== x.id) edit(d => { d.tuning = x.id; }); } }, x.name))),
      h('div', { class: 'hint' }, `Respawn ${num(def('respawn', 'base'))} s + ${num(def('respawn', 'perLevel'))} s a level + ${num(def('respawn', 'perMinute'))} s a minute; ` +
        `minions from ${clock(def('minions', 'firstWave'))}, every ${duration(def('minions', 'every'))}; ${num(def('gold', 'start'))} starting gold. ` +
        'Every field below starts from these.' + (dsrc && dsrc.source === 'page' ? ' (The shipped values: this editor\'s backend can\'t read them.)' : '')),
      (slots.tuning = h('div', { class: 'vfind' })), top));
    // 2. the cards
    const now = presetNow(), from = R.fromPkg === S.pkg && R.from ? PRESETS.find(p => p.id === R.from) : null;
    pane.append(h('div', { class: 'rgrp', 'data-group': 'presets' }, h('div', { class: 'rgh' }, 'Start from a preset'),
      h('div', { class: 'rcards' }, ...PRESETS.map(p => h('button', { class: 'rcard' + (now === p.id ? ' on' : ''), 'data-preset': p.id, title: p.rules ? 'One click sets every rule of this card (one undo step)' : 'Removes the map\'s rules',
        onclick: () => applyPreset(p) }, h('b', {}, p.name), h('span', {}, p.line))),
      now ? null : h('div', { class: 'rcard on custom', 'data-preset': 'custom' }, h('b', {}, 'Custom' + (from && from.rules ? ' (from ' + from.name + ')' : '')),
        h('span', {}, 'Your own: the fields below.')))));
    // 3. what players read
    readBox = h('div', { class: 'rread', 'data-read': '' });
    pane.append(h('div', { class: 'rgrp' }, h('div', { class: 'rgh' }, 'What players will read'), readBox));
    renderRead();
    // 4. and 5. the fields and their previews
    const W = { race: winOn('race'), bindings: winOn('bindings'), time: winOn('time') }, nB = enemyBindings(), back = bindingsBack();
    const winBox = (id, t, tip) => h('label', { class: 'rcheck', title: tip }, h('input', { type: 'checkbox', checked: W[id], 'data-win': id,
      onchange: ev => setWin(id, ev.target.checked) }), ' ' + t);
    const winKids = [h('div', { class: 'hint' }, 'Destroying the enemy Guardian always wins. Tick more ways to win: whichever comes first ends the match.'),
      winBox('race', 'Kill race', 'The first team to so many kills wins')];
    if (W.race) {
      winKids.push(numField('victory', 'kills', 'Kills to win', 'kills', { min: 1, max: 200, step: 1, int: true, list: 'rulesKills',
        hint: '10 to 50 makes a good race; any number from 1 to 200.' }));
    }
    winKids.push(winBox('bindings', 'Binding race', 'The first team to destroy so many enemy Bindings wins'));
    if (W.bindings) {
      const most = back ? 12 : Math.min(12, nB || 12);
      winKids.push(numField('victory', 'bindings', 'Bindings to destroy', 'Bindings', { min: 1, max: most, step: 1, int: true, ph: nB,
        side: `of the enemy's ${nB}`,
        hint: back ? `This map gives each team ${plural(nB, 'Binding')}; they come back, and each one destroyed counts, so up to 12.`
          : `This map gives each team ${plural(nB, 'Binding')}: 1 to ${most}.` }));
    }
    winKids.push(winBox('time', 'Time limit', 'When the time is up the team ahead wins'));
    if (W.time) {
      winKids.push(numField('victory', 'minutes', 'Time limit', 'min', { min: 3, max: 90, step: 1, int: true, hint: '3 to 90 minutes.' }));
    }
    const kills = get('victory', 'kills'), minutes = get('victory', 'minutes'), nb = get('victory', 'bindings');
    const any = W.race || W.bindings || W.time;
    winKids.push(prev('win', !any ? 'Destroy the enemy Guardian to win.' : '',
      W.race ? `The first team to ${plural(kills, 'kill')} wins.` : '',
      W.bindings ? `The first team to destroy ${+nb === 1 ? 'an enemy Binding' : plural(nb, 'enemy Binding')} wins${back ? ' (a Binding that came back counts again)' : ''}.` : '',
      W.time ? (W.bindings ? `At ${clock(minutes * 60)} the team that destroyed more Bindings wins, then the one with more kills.` : `At ${clock(minutes * 60)} the team with more kills wins.`) : '',
      !any ? '' : 'The Guardian still wins at any time' + (W.time ? `; a tie goes to sudden death (the next ${W.bindings ? 'Binding or kill' : 'kill'} wins)` : '') + '. The game is unrated.'));
    pane.append(group('victory', 'How to win', ...winKids), h('datalist', { id: 'rulesKills' }, ...[10, 15, 20, 25, 30, 40, 50].map(n => h('option', { value: n }))));
    pane.append(lobbyGroup(any));

    const sl = eff('startLevel'), lv2 = sl < 10 ? 10 : Math.min(20, sl + 5), speed = eff('xp', 'speed');
    pane.append(group('players', 'Players',
      numField('startLevel', null, 'Everyone starts at level', '', { min: 1, max: 20, step: 1, int: true, hint: 'Bots too. 1 to 20.' }),
      numField('respawn', 'base', 'Respawn time', 's', { min: 0, max: 120, step: 0.5 }),
      numField('respawn', 'perLevel', '+ each level', 's', { min: 0, max: 10, step: 0.05 }),
      numField('respawn', 'perMinute', '+ each match minute', 's', { min: 0, max: 10, step: 0.05 }),
      numField('xp', 'speed', 'Levelling speed', X, { min: 0.25, max: 5, step: 0.25, hint: '2 levels twice as fast (0.25 to 5).' }),
      prev('players', sl > 1 ? `Everyone, bots too, starts at level ${sl}.` : '',
        `Respawn: level ${sl} at 0:00: ${num(respawnAt(sl, 0))} s${SEP}level ${lv2} at 20:00: ${num(respawnAt(lv2, 1200))} s.`,
        speed !== 1 ? `Levels come ${num(speed)} times as fast.` : '')));
    const kg = eff('gold', 'kills');
    pane.append(group('gold', 'Economy',
      numField('gold', 'start', 'Starting gold', 'gold', { min: 0, max: 20000, step: 50 }),
      numField('gold', 'perMinute', 'Passive gold', 'a minute', { min: 0, max: 5000, step: 10 }),
      numField('gold', 'from', 'Passive gold from', 's', { min: 0, max: 3600, step: 5, hint: 'Seconds into the match.' }),
      numField('gold', 'kills', 'Kill gold', X, { min: 0, max: 10, step: 0.25, hint: 'Scales the gold for kills, streaks and first blood.' }),
      prev('gold', `About ${num(Math.round(goldBy(600) / 10) * 10)} gold by 10:00 without kills.`, kg !== 1 ? `Kills pay ${X}${num(kg)} the gold.` : '')));
    const T = timeLimit() ? timeLimit() * 60 : 900;
    pane.append(group('minions', 'Minions',
      numField('minions', 'firstWave', 'First wave at', 's', { min: 0, max: 600, step: 5 }),
      numField('minions', 'every', 'A wave every', 's', { min: 10, max: 300, step: 5, hint: '10 to 300; under 15 s the waves crowd the lanes.' }),
      prev('minions', `${wavesBy(T)} waves by ${clock(T)} (the first at ${clock(eff('minions', 'firstWave'))}).`)));
    const bOn = set(get('bindings', 'respawn'));
    pane.append(group('bindings', 'Bindings',
      h('label', { class: 'rcheck' }, h('input', { type: 'checkbox', checked: bOn, 'data-v': 'rules.bindings:on',
        onchange: ev => edit(d => setRule(d, 'bindings', null, ev.target.checked ? { respawn: 300 } : undefined)) }), ' Destroyed Bindings come back'),
      bOn ? numField('bindings', 'respawn', 'Back after', 's', { min: 30, max: 3600, step: 10, none: 'never', hint: '30 s to 1 hour after they fall.' }) : null,
      prev('bindings', bOn ? `Bindings return ${duration(get('bindings', 'respawn'))} after they fall.` : 'A destroyed Binding stays down (the game\'s own rule).')));
    const wg = eff('wells', 'gold');
    pane.append(group('wells', 'Wells',
      numField('wells', 'opensAt', 'First open at', 's', { min: 0, max: 3600, step: 15, hint: 'Seconds into the match.' }),
      numField('wells', 'relock', 'Locked after a capture', 's', { min: 30, max: 3600, step: 15 }),
      numField('wells', 'gold', 'Well gold', X, { min: 0, max: 10, step: 0.25 }),
      prev('wells', `The wells first open at ${clock(eff('wells', 'opensAt'))}, then lock for ${duration(eff('wells', 'relock'))} after each capture.`,
        wg !== 1 ? `They pay ${X}${num(wg)} the gold.` : '')));
    const allowed = eff('surrender', 'allowed') !== false;
    pane.append(group('surrender', 'Surrender',
      h('label', { class: 'rcheck' }, h('input', { type: 'checkbox', checked: allowed, 'data-v': 'rules.surrender.allowed',
        onchange: ev => edit(d => setRule(d, 'surrender', 'allowed', ev.target.checked ? undefined : false)) }), ' Teams may surrender'),
      allowed ? numField('surrender', 'after', 'From minute', 'min', { min: 5, max: 60, step: 1 }) : null,
      prev('surrender', allowed ? `A vote to surrender unlocks at minute ${num(eff('surrender', 'after'))}, or sooner by a big lead in gold or kills, or when a player is gone.`
        : 'No surrender, only when a player is gone for 5 minutes.')));
    pane.append(h('p', { class: 'hint' }, 'Empty a field for the game\'s value (shown grey). Advanced > Gameplay Constants... lists every value the map\'s rules change.'));
    placeFindings();
    if (focused) { const el = pane.querySelector(`[data-v="${focused}"]`); if (el) el.focus(); }
    pane.scrollTop = scroll;
  }

  // lobbyGroup: Suggested lobby setup: none, Standard, Draft, Custom... (the five categories' choices) or a server's
  // preset (its id); a custom game on this map starts its lobby with it, the lobby's admin may change it. mapVictory: the
  // map has its own win condition, so the lobby's is greyed.
  function lobbyGroup(mapVictory) {
    const v = get('lobbyPreset'), lo = lobbyOf(v), mode = lobbyModeNow(lo);
    const choose = m => {
      if (m === 'none') setLobby('');
      else if (m === 'standard' || m === 'draft') setLobby(m);
      else if (m === 'custom') setLobby(lo.mode === 'server' || lo.mode === 'none' ? 'standard' : lobbySpec(lo.opts), m);
      else if (m === 'server') setLobby(lo.mode === 'server' ? v : '', m);
      later();
    };
    const modes = [['none', 'None (the server decides)'], ['standard', 'Standard'], ['draft', 'Draft'], ['custom', 'Custom...'], ['server', 'A server\'s preset...']];
    const sel = h('select', { 'data-v': 'rules.lobbyPreset', onchange: ev => choose(ev.target.value) },
      ...modes.map(([id, t]) => h('option', { value: id, selected: id === mode }, t)));
    const kids = [h('div', { class: 'hint' }, 'A custom game on this map starts its lobby with these rules; the lobby\'s admin can still change them. Not part of the map\'s files.'),
      field('rules.lobbyPreset', 'Suggested lobby setup', sel)];
    if (mode === 'custom') {
      for (const c of LOBBY) {
        const off = c.id === 'victory' && mapVictory, cur = off ? c.def : (lo.opts[c.id] || c.def);
        const cs = h('select', { 'data-lobby': c.id, disabled: off, title: off ? 'This map has its own win condition.' : '',
          onchange: ev => {
            const o = Object.assign({}, lo.opts, { [c.id]: ev.target.value });
            if (mapVictory) delete o.victory; // the map decides: a change here drops the lobby's
            setLobby(lobbySpec(o), 'custom');
          } },
        ...c.opts.map(([id, t]) => h('option', { value: id, selected: id === cur }, t)));
        kids.push(h('div', { class: 'rfield' }, h('label', { class: 'rl' }, h('span', { class: 'rlab' }, c.name), cs),
          off ? h('div', { class: 'hint' }, 'This map has its own win condition (How to win above).') : null));
      }
    } else if (mode === 'server') {
      const inp = h('input', { type: 'text', 'data-lobby': 'id', value: lo.id || '', placeholder: 'e.g. brawl', maxlength: 24,
        title: 'The id of a preset a server defines in its presets file', onchange: ev => setLobby(ev.target.value.trim(), 'server') });
      kids.push(h('div', { class: 'rfield' }, h('label', { class: 'rl' }, h('span', { class: 'rlab' }, 'Preset id'), inp),
        h('div', { class: 'hint' }, 'A server that defines this preset starts the lobby with it; the others start it as usual.')));
    }
    let line = 'The lobby starts as the server decides (usually Standard).';
    if (mode === 'standard') line = 'The lobby starts on Standard.';
    else if (mode === 'draft') line = 'The lobby starts on Draft.';
    else if (mode === 'custom') line = 'The lobby starts on Custom: ' + lobbyWords(lo.opts) + '.';
    else if (mode === 'server') line = lo.id ? `The lobby starts with the server's preset "${lo.id}" where the server has it.` : 'Type the preset\'s id.';
    kids.push(prev('lobby', line));
    return group('lobby', 'Lobby setup (suggested)', ...kids);
  }

  function renderRead() {
    if (!readBox || !readBox.isConnected) return;
    readBox.textContent = '';
    const rd = R.read && R.read.key === JSON.stringify([S.pkg, S.doc && S.doc.tuning, rules()]) ? R.read : Object.assign(describe(rules()), { source: 'page', pending: true });
    if (!rd.summary) {
      readBox.append(h('p', { 'data-summary': '' }, 'Nothing: the game\'s own rules. Destroy the enemy Guardian to win.'),
        h('div', { class: 'hint' }, 'Players see no rules line.'));
      return;
    }
    readBox.append(h('div', { class: 'rtags' }, h('span', { class: 'rshort', 'data-short': '', title: 'The lobby\'s Map line and the game browser show this' }, rd.short),
      rd.victoryChanged ? h('span', { class: 'badge fail', 'data-unrated': '', title: 'A kill race or a time limit makes the game unrated; the balance values stay rated' }, 'Unrated') : null),
    h('p', { 'data-summary': '' }, rd.summary),
    h('div', { class: 'hint' }, 'In the lobby, and in the chat 10 s into the match.'));
  }

  // placeFindings puts each of the check's rules.* findings (and the tuning's) at the field whose path is the longest
  // prefix of its own; names.tuning (the map's name) at the top
  function placeFindings() {
    const fs = ((S.report && S.report.findings) || []).filter(f => (f.path || '').startsWith('rules') || f.path === 'tuning' || f.rule === 'names.tuning');
    for (const f of fs) {
      let best = f.path === 'tuning' ? 'tuning' : 'rules';
      for (const k of Object.keys(slots)) {
        if ((f.path === k || (f.path || '').startsWith(k + '.')) && k.length > best.length) best = k;
      }
      slots[best].append(h('div', { class: 'vf ' + (f.severity || 'error'), 'data-rule': f.rule, 'data-at': f.path },
        (f.severity === 'warning' ? 'Warning: ' : 'Problem: ') + (f.message || f.rule)));
    }
  }

  function renderConstants() {
    cpane.textContent = '';
    if (!S.doc) { cpane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    const l = level(), lv = LEVELS.find(x => x.id === l);
    let rows;
    const fromMapc = R.read && R.read.source === 'mapc' && R.read.constants;
    // mapc names "value" only where the map's rules change a member
    if (fromMapc) rows = R.read.constants.map(c => ({ asset: c.asset, member: c.member, def: c.default, val: 'value' in c ? c.value : c.default }));
    else {
      rows = CONSTANTS.map(([asset, member, g, k]) => {
        if (k === 'on') return { asset, member, def: def(g, 'respawn') > 0, val: eff(g, 'respawn') > 0 };
        return { asset, member, def: def(g, k), val: eff(g, k) };
      });
    }
    const fmt = v => (typeof v === 'boolean' ? String(v) : typeof v === 'number' ? num(Math.round(v * 1000) / 1000) : JSON.stringify(v));
    appendAll(cpane, h('p', { class: 'small' }, `Read only. ${lv.name} (${l}): the game's values; this map: with its rules. Bold: changed. Change them in `,
      h('a', { class: 'lnk', onclick: () => ED.openWindow('rules') }, 'Map > Rules...'), '.'),
    h('table', { class: 'rct' }, h('tr', {}, h('th', {}, 'asset'), h('th', {}, 'member'), h('th', {}, l), h('th', {}, 'this map')),
      ...rows.map(r => {
        const chg = fmt(r.def) !== fmt(r.val);
        return h('tr', { class: chg ? 'chg' : '', 'data-member': r.member }, h('td', {}, r.asset), h('td', {}, r.member), h('td', {}, fmt(r.def)),
          h('td', {}, chg ? h('b', {}, fmt(r.val)) : fmt(r.val)));
      })),
    fromMapc ? null : h('p', { class: 'hint' }, 'The members the rules set. ' + (R.read && R.read.source === 'mapc'
      ? 'The editor lists every member of the map\'s tuning when it has the game\'s files (Start-Client\'s game copy).'
      : 'A newer editor backend (Start-Client) lists every member of the map\'s tuning.')));
  }

  // ---- events ---------------------------------------------------------------------------------------------------
  let paneKey = '', laterTimer = 0;
  const key = () => JSON.stringify([S.pkg, S.doc && S.doc.tuning, rules(), R.from, R.lobbyMode, ((S.report && S.report.findings) || [])
    .filter(f => (f.path || '').startsWith('rules') || f.path === 'tuning' || f.rule === 'names.tuning').map(f => f.rule + f.path + f.message)]);
  // flush re-renders the window when what it shows changed; later does it after the event (an input's change may be
  // a Tab to the next field: the window keeps the focus on the field it went to)
  function flush() {
    clearTimeout(laterTimer);
    const k = key();
    if (k !== paneKey) { paneKey = k; renderPane(); }
    if (ED.isOpen('constants')) renderConstants();
  }
  function later() { clearTimeout(laterTimer); laterTimer = setTimeout(flush, 0); }
  ED.on('doc', () => { later(); readLater(); });
  ED.on('checked', later);
  ED.on('open', () => { paneKey = ''; R.read = null; R.readKey = ''; flush(); readNow(); });
  ED.on('window', (id, on) => { if (on && id === 'rules') { flush(); readLater(); } if (on && id === 'constants') { renderConstants(); readLater(); } });
  ED.on('focus-rules', path => {
    ED.openWindow('rules');
    flush();
    let best = null;
    for (const el of pane.querySelectorAll('[data-path]')) {
      const p = el.dataset.path;
      if ((path === p || path.startsWith(p + '.')) && (!best || p.length > best.dataset.path.length)) best = el;
    }
    if (best) best.scrollIntoView({ block: 'nearest' });
    const inp = best && best.querySelector('input, button.on');
    if (inp) inp.focus();
  });
  // the map inspector's line (app.js mapInspector): the short text, or the game's own rules
  ED.rulesText = () => {
    const d = describe(rules());
    return d.short || (d.summary ? 'set' : 'the game\'s own');
  };
  // the URL's state for pictures: &rpreset=<card> applies a card, &rset=<path>:<value>[,...] sets fields, &rlobby=<value>
  // the suggested lobby setup
  ED.on('started', () => {
    const p = PRESETS.find(x => x.id === URLQ.get('rpreset'));
    if (p && S.doc) applyPreset(p);
    for (const it of (URLQ.get('rset') || '').split(',').filter(Boolean)) {
      const [path, v] = it.split(':'), [g, k] = path.split('.');
      if (S.doc && ORDER[''].includes(g)) edit(d => setRule(d, g, k == null ? null : k, v === '' ? undefined : Number(v)));
    }
    if (URLQ.get('rlobby') && S.doc) setLobby(URLQ.get('rlobby'), lobbyOf(URLQ.get('rlobby')).mode);
  });
  renderPane();

  // tryIt: Help > Making Maps' Try it: the map's victory a kill race of 3 (one undo step), the window, then Test
  // (opts: {ask: false} without the question, {test: false} without Test)
  function tryIt(opts) {
    opts = opts || {};
    if (!S.doc) { log('Try it: open a map first', 'err'); return false; }
    if (opts.ask !== false && !confirm('Try a kill race of 3 on this map: the first team to 3 kills wins. Undo takes it back. Then Test starts the game on it (Test plays the saved map: it asks to save).')) return false;
    R.from = '';
    edit(d => setRule(d, 'victory', null, { kills: 3 }));
    if ($('dlgHelp') && $('dlgHelp').open) $('dlgHelp').close();
    ED.openWindow('rules');
    log('Try it: a kill race of 3 (Map > Rules...); Test shows the end quickly', 'ok');
    if (opts.test !== false) {
      if ($('btnTest').disabled) log('Test is off here: ' + ((S.config && S.config.test && S.config.test.reason) || 'no game'), 'err');
      else testMap();
    }
    return true;
  }

  // ---- the self-test (?selftest=rules on CM_Ring; =rules-save saves the map with Brawl's rules at the end) ----------
  // &vectors=<describe.json's cases as JSON> (server/testdata/maprules/describe.json of the server's repository; the headless runner passes them): the summary players read for each, from the
  // backend and from the page's own copy of the wording.
  const VECTORS = (() => { try { return URLQ.get('vectors') ? JSON.parse(URLQ.get('vectors')) : null; } catch (e) { return null; } })();

  async function selftest(mode) {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); await readNow(); flush(); };
    const inp = path => pane.querySelector(`[data-v="${path}"]`);
    const setv = (path, value) => { flush(); const el = inp(path); if (!el) return false; if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event('change')); flush(); return true; };
    const click = sel => { flush(); const el = pane.querySelector(sel); if (!el) return false; el.click(); flush(); return true; };
    const shown = (path, rule) => !!pane.querySelector(`[data-path="${path}"] .vf[data-rule="${rule}"]`);
    const findings = () => ((S.report && S.report.findings) || []).map(f => f.rule + '@' + f.path).join(' ');
    const summary = () => { const el = pane.querySelector('[data-summary]'); return el ? el.textContent : ''; };
    const lit = () => [...pane.querySelectorAll('.rcard.on')].map(e => e.dataset.preset + ':' + e.querySelector('b').textContent).join(',');
    const prevText = id => { const el = pane.querySelector(`[data-prev="${id}"]`); return el ? el.textContent : ''; };
    const R0 = () => JSON.stringify(rules());
    let ok = true;
    await settle();
    ok &= say(S.report && S.report.ok && !rules(), `opened ${S.pkg}: ${S.report && S.report.ok ? 'passes' : findings()}, ${rules() ? 'rules ' + R0() : 'no rules section'}`);
    ED.act('map.rules');
    await loadDefaults(level());
    flush();
    const src = R.defaults[level()];
    ok &= say(ED.isOpen('rules') && src && inp('rules.respawn.base') && inp('rules.respawn.base').placeholder === String(def('respawn', 'base')) && def('respawn', 'base') === 15,
      `Map > Rules... opens; the level's values from ${src.source === 'mapc' ? 'mapc (' + (src.from || '?') + ')' : 'the page (' + src.error + ')'}: respawn base placeholder ${inp('rules.respawn.base') && inp('rules.respawn.base').placeholder}`);
    ok &= say(lit() === 'classic:Classic' && /game's own rules/.test(summary()) && !pane.querySelector('[data-unrated]'), `Classic lit (${lit()}), players read: ${summary()}`);
    ok &= say(!/\b(startLevel|perLevel|perMinute|firstWave|opensAt|victory)\b/.test(pane.textContent), 'no member names in the window');
    // describe.json's vectors: the backend's words (or the page's when the backend can't) and the page's own copy
    if (VECTORS) {
      let bad = [];
      for (const c of VECTORS) {
        const loc = describe(c.rules);
        if (loc.summary !== c.summary || loc.short !== c.short) bad.push(`${c.name}: the page's "${loc.summary}" "${loc.short}"`);
        edit(d => { if (c.rules == null) delete d.rules; else d.rules = clone(c.rules); });
        await readNow();
        if (!R.read || R.read.summary !== c.summary || R.read.short !== c.short) bad.push(`${c.name}: read "${R.read && R.read.summary}" "${R.read && R.read.short}"`);
        undo();
      }
      ok &= say(!bad.length, `describe.json's ${VECTORS.length} cases read as their summary and short text (from ${R.read ? R.read.source : '?'})${bad.length ? ': ' + bad.join('; ') : ''}`);
      const presetBad = PRESETS.filter(p => p.rules && !VECTORS.some(c => c.name === p.name && canon(c.rules) === canon(p.rules))).map(p => p.name);
      ok &= say(!presetBad.length, 'the cards\' rules are describe.json\'s cases of the same name' + (presetBad.length ? ': not ' + presetBad.join(', ') : ''));
    } else say(true, 'SKIP describe.json\'s vectors: open with &vectors=<the cases of describe.json as JSON>');
    await settle();
    // a card: one undo step, lit, players' words, Unrated
    const brawl = PRESETS.find(p => p.id === 'brawl'), nUndo = S.undo.length;
    click('[data-preset="brawl"]');
    await settle();
    ok &= say(canon(rules()) === canon(brawl.rules) && S.undo.length === nUndo + 1 && lit() === 'brawl:Brawl' && S.report.ok,
      `Brawl: ${R0()}, ${S.undo.length - nUndo} undo step, lit ${lit()}, ${S.report.ok ? 'passes' : findings()}`);
    const want = describe(brawl.rules);
    ok &= say(summary() === want.summary && !!pane.querySelector('[data-unrated]') && pane.querySelector('[data-short]').textContent === want.short,
      `players read: ${summary()} [${pane.querySelector('[data-short]') && pane.querySelector('[data-short]').textContent}] Unrated`);
    const ticked = () => ['race', 'bindings', 'time'].filter(id => { const el = pane.querySelector(`[data-win="${id}"]`); return el && el.checked; }).join('+');
    ok &= say(inp('rules.victory.kills').value === '25' && inp('rules.victory.minutes').value === '20' && inp('rules.startLevel').value === '6' &&
      ticked() === 'race+time' && !inp('rules.victory.bindings'), `the fields: ${ticked()}, 25 kills, 20 minutes, level 6`);
    renderInspector();
    const link = document.querySelector('#inspector [data-rules-link]');
    ok &= say(link && /Race 25/.test(link.textContent), 'the map inspector: ' + (link ? link.textContent : 'no rules line'));
    // the previews, against the host's formulas computed here
    const rb = 6, rl = 0.25, rm = def('respawn', 'perMinute'), r0 = round1(rb + rl * 6), r1 = round1(rb + rl * 10 + rm * 20);
    ok &= say(prevText('players').includes(`level 6 at 0:00: ${num(r0)} s`) && prevText('players').includes(`level 10 at 20:00: ${num(r1)} s`) &&
      prevText('players').includes('Everyone, bots too, starts at level 6'), 'the players\' preview: ' + prevText('players'));
    const g10 = 1500 + def('gold', 'perMinute') * (600 - def('gold', 'from')) / 60;
    ok &= say(prevText('gold').includes(`About ${num(Math.round(g10 / 10) * 10)} gold by 10:00`) && prevText('gold').includes(X + '1.5'), 'the economy\'s preview: ' + prevText('gold'));
    // an edit: Custom (from Brawl); undo: Brawl again
    setv('rules.respawn.base', '7');
    await settle();
    ok &= say(get('respawn', 'base') === 7 && lit() === 'custom:Custom (from Brawl)' && /respawn 7 s/.test(summary()), `respawn 7: lit ${lit()}, players read: ${summary()}`);
    undo();
    await settle();
    ok &= say(lit() === 'brawl:Brawl', 'undo: ' + lit());
    // an emptied field removes its member, the last one its group
    setv('rules.gold.start', '');
    ok &= say(JSON.stringify(get('gold')) === '{"kills":1.5}', 'starting gold emptied: gold ' + JSON.stringify(get('gold')));
    setv('rules.gold.kills', '');
    ok &= say(get('gold') === undefined && Object.keys(rules()).join() === 'victory,startLevel,respawn,surrender', 'kill gold emptied: no gold, the rules ' + Object.keys(rules()).join());
    undo(); undo();
    ok &= say(canon(rules()) === canon(brawl.rules), 'two undos: Brawl');
    // a finding at its field: 500 kills (an error), 3 kills (a warning)
    setv('rules.victory.kills', '500');
    await settle();
    ok &= say(!S.report.ok && shown('rules.victory.kills', 'rules.victory'), 'kills 500: ' + findings() + ', shown at Kills to win');
    setv('rules.victory.kills', '3');
    await settle();
    ok &= say(S.report.ok && shown('rules.victory.kills', 'rules.victory'), 'kills 3: ' + findings() + ', the warning at Kills to win');
    setv('rules.startLevel', '6.5');
    ok &= say(get('startLevel') === 6, 'level 6.5 refused (a whole number): ' + get('startLevel'));
    undo(); undo();
    await settle();
    // how to win: the conditions add up, each a checkbox
    const tick = (id, on) => { flush(); const el = pane.querySelector(`[data-win="${id}"]`); if (!el) return false; el.checked = on; el.dispatchEvent(new Event('change')); flush(); return true; };
    tick('race', false);
    tick('time', false);
    ok &= say(get('victory') === undefined && !pane.querySelector('[data-unrated]') && /Guardian to win/.test(prevText('win')) && ticked() === '',
      'the kill race and the time limit unticked: no victory, rated; ' + prevText('win'));
    const nB = enemyBindings();
    tick('bindings', true);
    await settle();
    const bf = inp('rules.victory.bindings');
    ok &= say(JSON.stringify(get('victory')) === '{"bindings":3}' && nB === 6 && bf && bf.placeholder === '6' && /of the enemy's 6/.test(bf.closest('.rfield').textContent) &&
      /^First to destroy 3 Bindings wins;/.test(summary()) && /\bBind 3\b/.test(pane.querySelector('[data-short]').textContent) && !!pane.querySelector('[data-unrated]') && S.report.ok,
    `Binding race: ${JSON.stringify(get('victory'))}, the field's placeholder ${bf && bf.placeholder} (CM_Ring: ${nB} a team); players read: ${summary()} [${pane.querySelector('[data-short]').textContent}]`);
    setv('rules.victory.bindings', '7');
    await settle();
    ok &= say(!S.report.ok && shown('rules.victory.bindings', 'rules.victory'), 'a Binding race to 7 of 6: ' + findings() + ', shown at Bindings to destroy');
    setv('rules.bindings:on', true);
    await settle();
    ok &= say(S.report.ok && /came back counts again/.test(prevText('win')), 'with Bindings coming back it passes: ' + prevText('win'));
    undo(); undo();
    tick('time', true);
    ok &= say(JSON.stringify(get('victory')) === '{"minutes":25,"bindings":3}' && /25:00 the team that destroyed more Bindings wins, then the one with more kills/.test(prevText('win')) &&
      /next Binding or kill wins/.test(prevText('win')), 'and a time limit: ' + JSON.stringify(get('victory')) + '; ' + prevText('win'));
    const waves = Math.floor((1500 - def('minions', 'firstWave')) / def('minions', 'every')) + 1;
    ok &= say(prevText('minions').includes(`${waves} waves by 25:00`), 'the minions\' preview: ' + prevText('minions'));
    tick('race', true);
    await settle();
    ok &= say(JSON.stringify(get('victory')) === '{"kills":20,"minutes":25,"bindings":3}' && ticked() === 'race+bindings+time' && /tie goes to sudden death/.test(prevText('win')) &&
      /^First to 20 kills or to destroy 3 Bindings, or most Bindings after 25 minutes wins \(then kills\);/.test(summary()) && S.report.ok &&
      pane.querySelector('[data-short]').textContent === ['Race 20', 'Bind 3', '25 min'].join(SEP) && describe(rules()).short === ['Race 20', 'Bind 3', '25 min'].join(SEP),
    'all three: ' + JSON.stringify(get('victory')) + '; ' + summary() + ' [' + pane.querySelector('[data-short]').textContent + ', the page\'s ' + describe(rules()).short + ': "Tuned", then "Lv 6" make room]' +
      (S.report.ok ? '' : ' ' + findings()));
    undo(); undo(); undo(); undo(); undo();
    await settle();
    ok &= say(canon(rules()) === canon(brawl.rules) && ticked() === 'race+time', 'five undos: Brawl');
    // Bindings
    setv('rules.bindings:on', true);
    ok &= say(get('bindings', 'respawn') === 300 && /return 5 min after they fall/.test(prevText('bindings')), 'Bindings on: ' + JSON.stringify(get('bindings')) + '; ' + prevText('bindings'));
    setv('rules.bindings.respawn', '20');
    await settle();
    ok &= say(!S.report.ok && shown('rules.bindings.respawn', 'rules.bindings'), 'Bindings back after 20 s: ' + findings() + ', at its field');
    undo(); undo();
    // surrender
    setv('rules.surrender.allowed', true);
    ok &= say(get('surrender') === undefined && !!inp('rules.surrender.after'), 'surrender allowed: the member gone, From minute shown');
    undo();
    // Based on: Anshavar Pass's pace
    click('[data-level="MM_Map_v3"]');
    await loadDefaults('MM_Map_v3');
    flush();
    const mm = round1(6 + 0.25 * 10 + def('respawn', 'perMinute') * 20);
    ok &= say(S.doc.tuning === 'MM_Map_v3' && def('respawn', 'perMinute') === 0.5 && inp('rules.respawn.perMinute').placeholder === '0.5' &&
      prevText('players').includes(`level 10 at 20:00: ${num(mm)} s`), `Anshavar Pass pace: tuning ${S.doc.tuning}, + each minute ${inp('rules.respawn.perMinute').placeholder}; ${prevText('players')}`);
    undo();
    flush();
    ok &= say(S.doc.tuning === 'SM_Map_v5' && pane.querySelector('[data-level="SM_Map_v5"]').classList.contains('on'), 'undo: Dawngate pace');
    // a finding's jump: the window opens at the field
    ED.closeWindow('rules');
    selectPath('rules.startLevel');
    ok &= say(ED.isOpen('rules') && document.activeElement === inp('rules.startLevel'), 'a finding at rules.startLevel opens Map Rules at its field');
    // Advanced > Gameplay Constants
    await settle();
    ED.act('map.constants');
    const row = cpane.querySelector('tr[data-member="deathTimeBase"]');
    const nRows = cpane.querySelectorAll('tr').length - 1, nChg = cpane.querySelectorAll('tr.chg').length;
    const fromRead = R.read && R.read.source === 'mapc' ? 'mapc (' + (R.read.from || '?') + (R.read.constants ? '' : ', no constants') + ')' : 'the page';
    ok &= say(ED.isOpen('constants') && row && row.classList.contains('chg') && /\b6\b/.test(row.lastChild.textContent) && nRows > 1 && nChg < nRows,
      `Gameplay Constants: ${nRows} rows from ${fromRead}, ${nChg} changed, deathTimeBase ${row ? row.textContent : 'none'}`);
    ED.closeWindow('constants');
    // Map > Properties no longer writes the tuning
    ED.act('map.properties');
    const props = ED.windows.props.body;
    ok &= say(![...props.querySelectorAll('label')].some(l => /^tuning/.test(l.textContent)) && /Map > Rules/.test(props.textContent), 'Map Properties: no tuning field, a link to Map > Rules...');
    ED.closeWindow('props');
    // Help > Making Maps: Try it
    FR.help('guide');
    const tb = document.querySelector('#helpBody [data-try-rules]');
    ok &= say(!!tb && /Map rules/.test($('helpBody').textContent), 'Help > Making Maps: the Map rules section and its Try it button');
    $('dlgHelp').close();
    const nu = S.undo.length;
    tryIt({ ask: false, test: false });
    ok &= say(JSON.stringify(get('victory')) === '{"kills":3}' && S.undo.length === nu + 1 && ED.isOpen('rules'), 'Try it: ' + JSON.stringify(get('victory')) + ', one undo step');
    undo();
    // Classic removes the section; undo
    click('[data-preset="classic"]');
    await settle();
    ok &= say(S.doc.rules === undefined && lit() === 'classic:Classic' && S.report.ok, 'Classic: no rules section, passes');
    undo(); undo();
    await settle();
    ok &= say(!rules() && S.report.ok && lit() === 'classic:Classic', 'undone: the map as opened, passes');
    // the suggested lobby setup (RULES6): Draft, Custom..., a server's preset; a card keeps it; on a map with its own
    // win condition the lobby's is greyed and a suggested one is a problem at the field
    const lobbySel = (id, v) => { flush(); const el = pane.querySelector(`[data-lobby="${id}"]`); if (!el) return false; el.value = v; el.dispatchEvent(new Event('change')); flush(); return true; };
    const nl = S.undo.length;
    setv('rules.lobbyPreset', 'draft');
    await settle();
    ok &= say(get('lobbyPreset') === 'draft' && lit() === 'classic:Classic' && S.report.ok && /starts on Draft/.test(prevText('lobby')),
      `Lobby setup Draft: ${R0()}, lit ${lit()}, ${S.report.ok ? 'passes' : findings()}; ${prevText('lobby')}`);
    setv('rules.lobbyPreset', 'custom');
    lobbySel('pick', 'random');
    lobbySel('victory', 'bind1');
    await settle();
    ok &= say(get('lobbyPreset') === 'pick=random,victory=bind1' && S.report.ok && prevText('lobby') === 'The lobby starts on Custom: All Random, First Binding.' &&
      pane.querySelectorAll('select[data-lobby]').length === 5, `Custom: ${R0()}, ${pane.querySelectorAll('select[data-lobby]').length} choices; ${prevText('lobby')}`);
    click('[data-preset="brawl"]');
    await settle();
    const wsel = pane.querySelector('[data-lobby="victory"]');
    ok &= say(get('lobbyPreset') === 'pick=random,victory=bind1' && lit() === 'brawl:Brawl' && !S.report.ok && shown('rules.lobbyPreset', 'rules.lobby-preset') && wsel && wsel.disabled,
      `Brawl keeps it: ${findings()}, the problem at the field, the win condition greyed`);
    lobbySel('shop', 'onDeath');
    await settle();
    ok &= say(get('lobbyPreset') === 'pick=random,shop=onDeath' && S.report.ok, `a change there drops the lobby's win condition: ${get('lobbyPreset')}, ${S.report.ok ? 'passes' : findings()}`);
    setv('rules.lobbyPreset', 'server');
    lobbySel('id', 'brawl');
    await settle();
    ok &= say(get('lobbyPreset') === 'brawl' && S.report.ok && shown('rules.lobbyPreset', 'rules.lobby-preset') && /server's preset "brawl"/.test(prevText('lobby')),
      `a server's preset: ${get('lobbyPreset')}, the warning at the field; ${prevText('lobby')}`);
    while (S.undo.length > nl) undo();
    await settle();
    ok &= say(!rules() && S.report.ok && lit() === 'classic:Classic' && /server decides/.test(prevText('lobby')), 'undone: no suggestion, ' + prevText('lobby'));
    if (mode === 'rules-save') {
      click('[data-preset="brawl"]');
      await settle();
      const r = await save();
      const back = await api('GET', '/api/map/' + S.pkg);
      let saved = null;
      try { saved = JSON.parse(back.text).rules; } catch (e) { saved = null; }
      ok &= say(r && r.ok && canon(saved) === canon(brawl.rules), 'saved with Brawl: ' + JSON.stringify(r && { written: r.written, sha256: r.sha256 }) + ', reads back ' + JSON.stringify(saved));
    }
    say(ok, ok ? 'selftest rules passed' : 'selftest rules failed');
    document.title = ok ? 'selftest rules passed' : 'selftest rules failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.rules = selftest;
  ED.selftests['rules-save'] = selftest;

  return { R, PRESETS, FALLBACK, describe, setRule, presetNow, loadDefaults, readNow, flush, tryIt, renderPane };
})();
