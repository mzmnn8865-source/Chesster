/* ═══════════════════════════════════════════════════════════════════
   script.js — منطق کامل «شطرنج کاغذی»

   ┌─ ساختار ──────────────────────────────────────────────────────┐
   │  ۱. ثابت‌ها                                                    │
   │  ۲. کش DOM                                                     │
   │  ۳. state واحد                                                 │
   │  ۴. ابزارهای کمکی (opposite, formatTime, ...)                  │
   │  ۵. صدا (Web Audio)                                            │
   │  ۶. تم (روز/شب)                                                │
   │  ۷. رندر (صفحه، بازیکن‌ها، تاریخچه، گرفته‌ها)                  │
   │  ۸. وضعیت (status)                                             │
   │  ۹. منطق حرکت (tryMove, applyMove, promotion)                  │
   │  ۱۰. نوبت هوش مصنوعی                                           │
   │  ۱۱. پایان بازی (checkEnd, end modal)                          │
   │  ۱۲. ساعت                                                      │
   │  ۱۳. Undo / Redo / Flip / Hint / Resign                        │
   │  ۱۴. مودال‌ها (متن/PGN/FEN/ذخیره/بارگذاری)                     │
   │  ۱۵. کانفتی                                                    │
   │  ۱۶. ناوبری کیبورد                                             │
   │  ۱۷. اتصال رویدادها                                            │
   │  ۱۸. Init                                                     │
   └───────────────────────────────────────────────────────────────┘
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ═══ ۱. ثابت‌ها ═══════════════════════════════════════════════ */

  const SYM = Object.freeze({
    k: '\u265A', q: '\u265B', r: '\u265C',
    b: '\u265D', n: '\u265E', p: '\u265F',
  });

  // نام‌های فارسی — به‌جای «وزیر» همیشه «ملکه» استفاده می‌شود
  const NAME_FA = Object.freeze({
    k: 'شاه', q: 'ملکه', r: 'رخ', b: 'فیل', n: 'اسب', p: 'سرباز',
  });

  const FILES = 'abcdefgh';
  const RANKS = '12345678';
  const KEY_STATE = 'paper-chess:state:v2';
  const KEY_THEME = 'paper-chess:theme';
  const KEY_SOUND = 'paper-chess:sound';

  /* ═══ ۲. کش DOM ═══════════════════════════════════════════════ */

  const $ = (id) => document.getElementById(id);

  const ui = {
    // FAB
    themeBtn: $('themeBtn'), themeIcon: $('themeIcon'),
    soundBtn: $('soundBtn'), soundIcon: $('soundIcon'),
    fullBtn: $('fullBtn'),
    // بازیکن‌ها
    playerTop: $('playerTop'), playerBottom: $('playerBottom'),
    avatarTop: $('avatarTop'), avatarBottom: $('avatarBottom'),
    nameTop: $('nameTop'), nameBottom: $('nameBottom'),
    capTop: $('capTop'), capBottom: $('capBottom'),
    clockTop: $('clockTop'), clockBottom: $('clockBottom'),
    // صفحه
    board: $('board'), ranks: $('ranks'), files: $('files'),
    // وضعیت
    status: $('status'),
    // تنظیمات
    level: $('level'), color: $('color'), timeControl: $('timeControl'),
    // کنترل‌ها
    newBtn: $('new'), undoBtn: $('undo'), redoBtn: $('redo'),
    flipBtn: $('flip'), hintBtn: $('hint'), resignBtn: $('resign'),
    // تاریخچه
    moves: $('moves'),
    // ابزارها
    saveBtn: $('save'), loadBtn: $('load'),
    pgnBtn: $('pgnBtn'), fenBtn: $('fenBtn'),
    // مودال ارتقا
    promo: $('promo'), promoBtns: $('promoBtns'), promoCancel: $('promoCancel'),
    // مودال پایان
    end: $('end'), endIcon: $('endIcon'), endTitle: $('endTitle'),
    endMsg: $('endMsg'), again: $('again'), review: $('review'),
    // مودال متن
    textModal: $('textModal'), textTitle: $('textTitle'),
    textArea: $('textArea'), textCopy: $('textCopy'),
    textOk: $('textOk'), textCancel: $('textCancel'),
    // کانفتی
    confetti: $('confetti'),
  };

  /* ═══ ۳. state واحد ═══════════════════════════════════════════ */

  const state = {
    game: null,          // نمونه‌ی Chess
    engine: null,        // نمونه‌ی Engine (تنبل)
    human: 'w',          // رنگ بازیکن
    flipped: false,      // چرخش صفحه
    selected: null,      // خانه‌ی انتخاب‌شده
    hints: [],           // حرکات قانونی مهره‌ی انتخاب‌شده
    hintMove: null,      // حرکت پیشنهادی راهنما
    lastMove: null,      // آخرین حرکت (برای highlight)
    animateNextMove: false,
    busy: false,         // در حال فکر / عملیات
    over: false,         // بازی تمام
    reviewMode: false,   // حالت مرور (هوش مصنوعی حرکت نمی‌کند)
    // ساعت
    clocks: { w: 0, b: 0 },
    clockRunningFor: null,
    lastTick: 0,
    clockInterval: null,
    timeControl: 0,
    // تنظیمات پایدار
    soundOn: true,
    theme: 'light',
    // redo
    redoStack: [],
    // کیبورد
    cursorSq: null,
    // مودال متن
    textMode: 'view',
  };

  /* ═══ ۴. ابزارهای کمکی ════════════════════════════════════════ */

  const opposite = (c) => (c === 'w' ? 'b' : 'w');

  const formatTime = (s) => {
    if (s <= 0) return '0:00';
    const total = Math.ceil(s);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return m + ':' + String(sec).padStart(2, '0');
  };

  const squareOf = (r, c) => FILES[c] + (8 - r);

  const isHumanTurn = () =>
    !state.busy && !state.over && !state.reviewMode &&
    state.game && state.game.turn() === state.human;

  /* ═══ ۵. صدا ══════════════════════════════════════════════════ */

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  function initAudio() {
    if (audioCtx || !AudioCtx) return;
    try { audioCtx = new AudioCtx(); }
    catch (_) { audioCtx = null; }
  }

  function tone(freq, dur, type, vol) {
    if (!audioCtx || !state.soundOn) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.18, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (_) { /* ignore */ }
  }

  function playMoveSound(move) {
    if (move.captured) tone(200, 0.16, 'sawtooth', 0.14);
    else if (move.promotion) tone(720, 0.22, 'sine', 0.22);
    else if (move.flags && (move.flags.includes('k') || move.flags.includes('q')))
      tone(480, 0.14, 'triangle', 0.18);
    else tone(340, 0.10, 'sine', 0.14);

    if (state.game.in_checkmate()) {
      setTimeout(() => tone(240, 0.32, 'triangle', 0.28), 90);
      setTimeout(() => tone(160, 0.55, 'triangle', 0.28), 430);
    } else if (state.game.in_check()) {
      setTimeout(() => tone(880, 0.14, 'square', 0.18), 90);
    }
  }

  /* ═══ ۶. تم ═══════════════════════════════════════════════════ */

  function applyTheme(theme) {
    state.theme = theme;
    document.body.dataset.theme = theme;
    ui.themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
    try { localStorage.setItem(KEY_THEME, theme); } catch (_) {}
  }

  function toggleTheme() {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
  }

  /* ═══ ۷. رندر ═════════════════════════════════════════════════ */

  function render() {
    renderBoard();
    renderPlayers();
    renderHistory();
    renderCaptured();
  }

  function renderBoard() {
    const board = ui.board;
    board.innerHTML = '';

    // خانه‌ی پادشاه در کیش — برای رنگ قرمز
    let kingSq = null;
    if (state.game.in_check()) {
      const turn = state.game.turn();
      const b = state.game.board();
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (p && p.type === 'k' && p.color === turn) {
          kingSq = squareOf(r, c);
          break;
        }
      }
    }

    const rows = state.flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = state.flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const grid = state.game.board();

    for (const r of rows) {
      for (const c of cols) {
        const sq = squareOf(r, c);
        const piece = grid[r][c];
        const div = document.createElement('div');
        div.className = 'sq ' + ((r + c) % 2 === 1 ? 'd' : 'l');
        div.dataset.sq = sq;
        div.setAttribute('role', 'gridcell');
        div.setAttribute('aria-label', ariaFor(sq, piece));

        if (state.lastMove && (sq === state.lastMove.from || sq === state.lastMove.to))
          div.classList.add('last');
        if (sq === state.selected) div.classList.add('sel');
        if (sq === kingSq) div.classList.add('chk');
        if (state.cursorSq === sq) div.classList.add('cursor');

        const hint = state.hints.find((m) => m.to === sq);
        if (hint) {
          div.classList.add('hint');
          if (hint.captured || (hint.flags && hint.flags.includes('e')))
            div.classList.add('cap');
        }
        if (state.hintMove && state.hintMove.to === sq) div.classList.add('hint-target');

        if (piece) {
          const span = document.createElement('span');
          span.className = 'p ' + piece.color;
          span.textContent = SYM[piece.type] + '\uFE0E';
          // درگ فقط برای مهره‌های بازیکن و در نوبتش
          if (piece.color === state.human && isHumanTurn()) {
            span.draggable = true;
            span.addEventListener('dragstart', onDragStart(sq));
            span.addEventListener('dragend', onDragEnd);
          }
          div.appendChild(span);
          if (state.animateNextMove && state.lastMove && sq === state.lastMove.to)
            div.classList.add('just-moved');
        }

        div.addEventListener('click', () => onSquareClick(sq));
        div.addEventListener('dragover', (e) => e.preventDefault());
        div.addEventListener('drop', onDrop(sq));

        board.appendChild(div);
      }
    }
    state.animateNextMove = false;

    // مختصات
    renderCoords();
  }

  function ariaFor(sq, piece) {
    let label = sq;
    if (piece) {
      const side = piece.color === 'w' ? 'سفید' : 'سیاه';
      label += ' — ' + NAME_FA[piece.type] + ' ' + side;
    } else {
      label += ' — خالی';
    }
    return label;
  }

  function renderCoords() {
    ui.ranks.innerHTML = '';
    ui.files.innerHTML = '';
    const rows = state.flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const cols = state.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    for (const r of rows) {
      const s = document.createElement('span');
      s.textContent = r;
      ui.ranks.appendChild(s);
    }
    for (const f of cols) {
      const s = document.createElement('span');
      s.textContent = f;
      ui.files.appendChild(s);
    }
  }

  function renderPlayers() {
    const isHumanTurnNow = state.game.turn() === state.human;
    ui.playerBottom.classList.toggle('active', isHumanTurnNow);
    ui.playerTop.classList.toggle('active', !isHumanTurnNow);

    const humanColorFa = state.human === 'w' ? 'سفید' : 'سیاه';
    const aiColorFa = state.human === 'w' ? 'سیاه' : 'سفید';

    ui.nameBottom.textContent = 'شما (' + humanColorFa + ')';
    ui.nameTop.textContent = 'حریف (' + aiColorFa + ')';

    ui.avatarBottom.textContent = state.human === 'w' ? '♔' : '♚';
    ui.avatarTop.textContent = state.human === 'w' ? '♚' : '♔';
  }

  function renderHistory() {
    ui.moves.innerHTML = '';
    const sans = state.game.history();
    for (let i = 0; i < sans.length; i += 2) {
      const li = document.createElement('li');
      const white = sans[i];
      const black = sans[i + 1];
      li.textContent = black ? white + ' ' + black : white;
      ui.moves.appendChild(li);
    }
    ui.moves.scrollTop = ui.moves.scrollHeight;
  }

  function renderCaptured() {
    const hist = state.game.history({ verbose: true });
    const byWhite = []; // مهره‌های سیاه که سفید گرفته
    const byBlack = [];
    for (const m of hist) {
      if (!m.captured) continue;
      if (m.color === 'w') byWhite.push(m.captured);
      else byBlack.push(m.captured);
    }

    // مهره‌های گرفته‌شده توسط انسان = مهره‌های رنگ مقابل
    const byHuman = state.human === 'w' ? byWhite : byBlack;
    const byAI = state.human === 'w' ? byBlack : byWhite;

    fillCaptured(ui.capBottom, byHuman, opposite(state.human));
    fillCaptured(ui.capTop, byAI, state.human);
  }

  function fillCaptured(el, arr, color) {
    el.innerHTML = '';
    const order = 'qrbnp';
    const sorted = arr.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const type of sorted) {
      const s = document.createElement('span');
      s.className = 'p ' + color;
      s.textContent = SYM[type] + '\uFE0E';
      el.appendChild(s);
    }
  }

  /* ═══ ۸. وضعیت ═══════════════════════════════════════════════ */

  function setStatus(text, cls) {
    ui.status.textContent = text;
    ui.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function updateStatus() {
    if (state.over) return; // مودال پایان خودش پیام می‌دهد
    if (state.busy) {
      setStatus('حریف در حال فکر کردن…', 'thinking');
      return;
    }
    const inCheck = state.game.in_check();
    if (state.game.turn() === state.human) {
      if (inCheck) setStatus('کیش! نوبت شماست', 'check');
      else setStatus('نوبت شماست');
    } else {
      setStatus(inCheck ? 'کیش! نوبت حریف' : 'نوبت حریف');
    }
  }

  /* ═══ ۹. منطق حرکت ═══════════════════════════════════════════ */

  function onSquareClick(sq) {
    if (state.busy || state.over || state.reviewMode) return;
    if (state.game.turn() !== state.human) return;

    if (state.selected) {
      if (sq === state.selected) {
        clearSelection();
        return;
      }
      if (state.hints.some((m) => m.to === sq)) {
        tryMove(state.selected, sq);
        return;
      }
    }
    const piece = state.game.get(sq);
    if (piece && piece.color === state.human) {
      state.selected = sq;
      state.hints = state.game.moves({ square: sq, verbose: true });
      state.cursorSq = sq;
      render();
    } else {
      clearSelection();
    }
  }

  function clearSelection() {
    state.selected = null;
    state.hints = [];
    state.hintMove = null;
    render();
  }

  function tryMove(from, to) {
    const moves = state.game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!moves.length) { clearSelection(); return; }

    if (moves[0].promotion) {
      state.selected = null;
      state.hints = [];
      showPromotion(from, to);
      return;
    }
    applyMove({ from, to });
  }

  function applyMove(moveObj) {
    const result = state.game.move(moveObj);
    if (!result) {
      console.error('حرکت نامعتبر:', moveObj);
      return false;
    }
    state.lastMove = result;
    state.selected = null;
    state.hints = [];
    state.hintMove = null;
    state.redoStack = [];
    state.animateNextMove = true;
    playMoveSound(result);
    switchClock();
    render();
    saveState();
    if (!checkEnd()) updateStatus();
    return true;
  }

  function showPromotion(from, to) {
    ui.promoBtns.innerHTML = '';
    const order = ['q', 'r', 'b', 'n'];
    for (const type of order) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'ارتقا به ' + NAME_FA[type]);
      btn.title = NAME_FA[type];
      const span = document.createElement('span');
      span.className = 'p ' + state.human;
      span.textContent = SYM[type] + '\uFE0E';
      btn.appendChild(span);
      btn.addEventListener('click', () => {
        closeModal(ui.promo);
        applyMove({ from, to, promotion: type });
      });
      ui.promoBtns.appendChild(btn);
    }
    openModal(ui.promo);
  }

  /* ═══ ۱۰. نوبت هوش مصنوعی ═════════════════════════════════════ */

  async function aiTurn() {
    if (state.over || state.reviewMode) return;
    if (state.game.turn() === state.human) return;
    if (state.game.game_over()) return checkEnd();

    const fenBefore = state.game.fen();
    state.busy = true;
    updateStatus();
    render();

    let move = null;
    try {
      if (!state.engine) state.engine = new window.Engine();
      move = await state.engine.think(fenBefore, +ui.level.value);
    } catch (err) {
      console.error('[AI] خطا:', err);
    }

    // گارد: اگر موقعیت در این فاصله عوض شد، جواب را دور بریز
    if (!state.game || state.game.fen() !== fenBefore) {
      state.busy = false;
      return;
    }
    if (state.over || state.reviewMode) {
      state.busy = false;
      return;
    }

    // اگر موتور جوابی نداد، یک حرکت تصادفی قانونی
    if (!move) {
      const legal = state.game.moves({ verbose: true });
      if (!legal.length) {
        state.busy = false;
        return checkEnd();
      }
      move = legal[Math.floor(Math.random() * legal.length)];
    }

    state.busy = false;
    applyMove(move);
  }

  /* ═══ ۱۱. پایان بازی ══════════════════════════════════════════ */

  function checkEnd() {
    if (!state.game.game_over()) return false;
    state.over = true;
    stopClock();

    let msg, icon, win = false;
    if (state.game.in_checkmate()) {
      if (state.game.turn() === state.human) {
        msg = 'کیش و مات! شما باختید';
        icon = '😔';
      } else {
        msg = 'کیش و مات! شما بردید 🎉';
        icon = '🏆';
        win = true;
      }
    } else if (state.game.in_stalemate()) {
      msg = 'پات — تساوی';
      icon = '🤝';
    } else if (state.game.in_threefold_repetition && state.game.in_threefold_repetition()) {
      msg = 'تکرار سه‌باره — تساوی';
      icon = '🤝';
    } else if (state.game.insufficient_material && state.game.insufficient_material()) {
      msg = 'مهره‌ی کافی نیست — تساوی';
      icon = '🤝';
    } else {
      msg = 'تساوی';
      icon = '🤝';
    }

    ui.endIcon.textContent = icon;
    ui.endMsg.textContent = msg;
    openModal(ui.end);
    setStatus(msg, win ? 'win' : 'lose');
    if (win) launchConfetti();
    tone(win ? 600 : 260, 0.4, 'sine', 0.25);
    return true;
  }

  /* ═══ ۱۲. ساعت ════════════════════════════════════════════════ */

  function startClock() {
    stopClock();
    if (state.timeControl === 0) return;
    state.clockInterval = setInterval(tickClock, 100);
    state.lastTick = Date.now();
  }

  function stopClock() {
    if (state.clockInterval) {
      clearInterval(state.clockInterval);
      state.clockInterval = null;
    }
  }

  function switchClock() {
    state.clockRunningFor = state.game.turn();
    state.lastTick = Date.now();
    updateClocks();
  }

  function tickClock() {
    if (!state.clockRunningFor || state.over || state.timeControl === 0) return;
    const now = Date.now();
    const dt = (now - state.lastTick) / 1000;
    state.lastTick = now;
    state.clocks[state.clockRunningFor] -= dt;
    if (state.clocks[state.clockRunningFor] <= 0) {
      state.clocks[state.clockRunningFor] = 0;
      state.over = true;
      stopClock();
      updateClocks();
      const loser = state.clockRunningFor;
      const playerLost = loser === state.human;
      ui.endIcon.textContent = playerLost ? '⏰' : '🏆';
      ui.endMsg.textContent = playerLost
        ? 'زمان شما تمام شد — باختید'
        : 'زمان حریف تمام شد — بردید 🎉';
      openModal(ui.end);
      setStatus(ui.endMsg.textContent, playerLost ? 'lose' : 'win');
      if (!playerLost) launchConfetti();
      return;
    }
    updateClocks();
  }

  function updateClocks() {
    const humanClock = state.human === 'w' ? ui.clockBottom : ui.clockTop;
    const aiClock = state.human === 'w' ? ui.clockTop : ui.clockBottom;

    if (state.timeControl === 0) {
      humanClock.textContent = '—';
      aiClock.textContent = '—';
      humanClock.classList.remove('active', 'low');
      aiClock.classList.remove('active', 'low');
      return;
    }

    humanClock.textContent = formatTime(state.clocks[state.human]);
    aiClock.textContent = formatTime(state.clocks[opposite(state.human)]);

    humanClock.classList.toggle('active', state.clockRunningFor === state.human);
    aiClock.classList.toggle('active', state.clockRunningFor === opposite(state.human));

    humanClock.classList.toggle('low',
      state.clocks[state.human] < 30 && state.clocks[state.human] > 0);
    aiClock.classList.toggle('low',
      state.clocks[opposite(state.human)] < 30 && state.clocks[opposite(state.human)] > 0);
  }

  /* ═══ ۱۳. Undo / Redo / Flip / Hint / Resign ═════════════════ */

  function undo() {
    if (!state.game.history().length) return;
    if (state.busy) {
      if (state.engine) state.engine.stop();
      state.busy = false;
    }
    // undo تا رسیدن به نوبت انسان
    const lastMove = state.game.history({ verbose: true }).slice(-1)[0];
    state.game.undo();
    if (lastMove) state.redoStack.push({
      from: lastMove.from, to: lastMove.to, promotion: lastMove.promotion,
    });

    if (state.game.turn() !== state.human) {
      const prev = state.game.history({ verbose: true }).slice(-1)[0];
      state.game.undo();
      if (prev) state.redoStack.push({
        from: prev.from, to: prev.to, promotion: prev.promotion,
      });
    }

    state.over = false;
    state.selected = null;
    state.hints = [];
    state.hintMove = null;
    const hist = state.game.history({ verbose: true });
    state.lastMove = hist.length ? hist[hist.length - 1] : null;

    state.clockRunningFor = state.game.turn();
    state.lastTick = Date.now();
    render();
    updateStatus();
    saveState();
  }

  function redo() {
    if (!state.redoStack.length) return;
    if (state.busy) return;
    // redo دو حرکت (خودمان + هوش مصنوعی) اگر ممکن
    const m1 = state.redoStack.pop();
    if (!m1) return;
    applyMove(m1);
    // اگر بعدش نوبت هوش مصنوعی است و حرکت بعدی در redoStack هست
    if (state.redoStack.length && state.game.turn() !== state.human && !state.over) {
      const m2 = state.redoStack.pop();
      if (m2) applyMove(m2);
    }
  }

  function flipBoard() {
    state.flipped = !state.flipped;
    render();
    saveState();
  }

  async function hint() {
    if (state.busy || state.over || state.reviewMode) return;
    if (state.game.turn() !== state.human) return;
    if (state.hintMove) { state.hintMove = null; render(); return; }

    const fen = state.game.fen();
    state.busy = true;
    setStatus('در حال یافتن راهنما…', 'thinking');

    let move = null;
    try {
      if (!state.engine) state.engine = new window.Engine();
      move = await state.engine.think(fen, 1);
    } catch (_) {}
    state.busy = false;

    if (state.game.fen() !== fen) { updateStatus(); return; }
    if (!move) { updateStatus(); return; }

    state.selected = move.from;
    state.hints = state.game.moves({ square: move.from, verbose: true });
    state.hintMove = move;
    render();
    updateStatus();
    // auto-clear after 4s
    setTimeout(() => {
      if (state.hintMove === move) {
        state.hintMove = null;
        state.selected = null;
        state.hints = [];
        render();
      }
    }, 4000);
  }

  function resign() {
    if (state.over) return;
    if (!confirm('آیا از تسلیم شدن مطمئن هستید؟')) return;
    state.over = true;
    stopClock();
    ui.endIcon.textContent = '🏳️';
    ui.endMsg.textContent = 'شما تسلیم شدید';
    openModal(ui.end);
    setStatus('شما تسلیم شدید', 'lose');
  }

  /* ═══ ۱۴. مودال‌ها و ذخیره ════════════════════════════════════ */

  function openModal(el) { el.classList.add('show'); }
  function closeModal(el) { el.classList.remove('show'); }

  function openTextModal(title, content, mode) {
    ui.textTitle.textContent = title;
    ui.textArea.value = content;
    ui.textArea.readOnly = (mode === 'view');
    ui.textOk.textContent = (mode === 'load') ? 'بارگذاری' : 'تأیید';
    state.textMode = mode;
    openModal(ui.textModal);
    if (mode === 'load') ui.textArea.focus();
  }

  function exportPortable() {
    const moves = state.game.history({ verbose: true }).map((m) => ({
      from: m.from, to: m.to, promotion: m.promotion,
    }));
    const payload = {
      v: 2,
      moves,
      human: state.human,
      flipped: state.flipped,
      clocks: { w: state.clocks.w, b: state.clocks.b },
      timeControl: state.timeControl,
      level: +ui.level.value,
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  function importPortable(code) {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const data = JSON.parse(json);
    if (data.v !== 2) throw new Error('نسخه پشتیبانی نمی‌شود');

    const g = new window.Chess();
    for (const m of data.moves) {
      if (!g.move(m)) throw new Error('تاریخچه نامعتبر');
    }

    if (state.busy && state.engine) state.engine.stop();
    state.game = g;
    state.human = data.human === 'b' ? 'b' : 'w';
    state.flipped = !!data.flipped;
    state.clocks = { w: +data.clocks.w || 0, b: +data.clocks.b || 0 };
    state.timeControl = +data.timeControl || 0;
    ui.level.value = String(data.level || 2);
    ui.color.value = state.human === 'w' ? 'w' : 'b';
    ui.timeControl.value = String(state.timeControl);

    const hist = g.history({ verbose: true });
    state.lastMove = hist.length ? hist[hist.length - 1] : null;
    state.selected = null;
    state.hints = [];
    state.hintMove = null;
    state.redoStack = [];
    state.over = g.game_over();
    state.reviewMode = false;
    state.busy = false;

    state.clockRunningFor = g.turn();
    state.lastTick = Date.now();
    startClock();
    render();
    updateStatus();
    if (state.over) checkEnd();
    else if (g.turn() !== state.human) aiTurn();
  }

  function saveState() {
    try {
      const payload = {
        v: 2,
        code: exportPortable(),
        ts: Date.now(),
      };
      localStorage.setItem(KEY_STATE, JSON.stringify(payload));
    } catch (_) {}
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(KEY_STATE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 2 || !data.code) return null;
      return data.code;
    } catch (_) { return null; }
  }

  function clearSaved() {
    try { localStorage.removeItem(KEY_STATE); } catch (_) {}
  }

  /* ═══ ۱۵. کانفتی ══════════════════════════════════════════════ */

  function launchConfetti() {
    const canvas = ui.confetti;
    canvas.classList.add('active');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const palette = ['#b58863', '#8a5a2b', '#f4ebd9', '#f0d9b5', '#d4a373', '#4ade80', '#f87171'];
    const particles = [];
    for (let i = 0; i < 140; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.5,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 3,
        size: 4 + Math.random() * 6,
        color: palette[Math.floor(Math.random() * palette.length)],
        rot: Math.random() * Math.PI * 2,
        rotSpd: (Math.random() - 0.5) * 0.25,
      });
    }

    const t0 = performance.now();
    function frame(now) {
      const elapsed = now - t0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      const alpha = Math.max(0, 1 - elapsed / 4500);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.vx *= 0.99;
        p.rot += p.rotSpd;
        if (p.y < canvas.height + 30 && alpha > 0) {
          alive++;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        }
      }
      if (alive > 0 && alpha > 0) requestAnimationFrame(frame);
      else {
        canvas.classList.remove('active');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    requestAnimationFrame(frame);
  }

  /* ═══ ۱۶. ناوبری کیبورد ═══════════════════════════════════════ */

  ui.board.addEventListener('keydown', (e) => {
    if (!state.cursorSq) {
      state.cursorSq = state.flipped ? 'h1' : 'a8';
      render();
      e.preventDefault();
      return;
    }
    const file = state.cursorSq[0];
    const rank = state.cursorSq[1];
    const fIdx = FILES.indexOf(file);
    const rIdx = parseInt(rank, 10) - 1;
    let nf = fIdx, nr = rIdx;

    const step = state.flipped ? -1 : 1;
    if (e.key === 'ArrowLeft')  nf = fIdx - step;
    else if (e.key === 'ArrowRight') nf = fIdx + step;
    else if (e.key === 'ArrowUp')    nr = rIdx + step;
    else if (e.key === 'ArrowDown')  nr = rIdx - step;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (state.cursorSq) onSquareClick(state.cursorSq);
      return;
    } else if (e.key === 'Escape') {
      clearSelection();
      return;
    } else return;

    e.preventDefault();
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) return;
    state.cursorSq = FILES[nf] + (nr + 1);
    render();
  });

  /* ═══ ۱۷. اتصال رویدادها ══════════════════════════════════════ */

  // درگ — فقط ثبت مبدا (بدون رندر تا DOM نشکند)
  function onDragStart(sq) {
    return function (e) {
      if (!isHumanTurn()) { e.preventDefault(); return; }
      state.draggedFrom = sq;
      try { e.dataTransfer.setData('text/plain', sq); } catch (_) {}
      e.dataTransfer.effectAllowed = 'move';
      // پاک‌سازی هیچ رندری انجام نمی‌شود — DOM سالم می‌ماند
    };
  }
  function onDragEnd() { state.draggedFrom = null; }
  function onDrop(toSq) {
    return function (e) {
      e.preventDefault();
      let from = state.draggedFrom;
      if (!from) { try { from = e.dataTransfer.getData('text/plain'); } catch (_) {} }
      state.draggedFrom = null;
      if (!from || !isHumanTurn()) return;
      if (from === toSq) return;
      tryMove(from, toSq);
    };
  }

  // دکمه‌های کنترل
  ui.newBtn.addEventListener('click', () => newGame());
  ui.again.addEventListener('click', () => { closeModal(ui.end); newGame(); });
  ui.review.addEventListener('click', () => {
    closeModal(ui.end);
    state.reviewMode = true;
    setStatus('حالت مرور — با «برگشت» حرکت‌ها را ببینید');
  });
  ui.undoBtn.addEventListener('click', undo);
  ui.redoBtn.addEventListener('click', redo);
  ui.flipBtn.addEventListener('click', flipBoard);
  ui.hintBtn.addEventListener('click', hint);
  ui.resignBtn.addEventListener('click', resign);

  // تم / صدا / fullscreen
  ui.themeBtn.addEventListener('click', toggleTheme);
  ui.soundBtn.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    ui.soundIcon.textContent = state.soundOn ? '🔊' : '🔇';
    try { localStorage.setItem(KEY_SOUND, state.soundOn ? '1' : '0'); } catch (_) {}
  });
  ui.fullBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  });

  // تغییر تنظیمات → بازی جدید
  ui.color.addEventListener('change', () => newGame());
  ui.timeControl.addEventListener('change', () => newGame());

  // مودال ارتقا — انصراف
  ui.promoCancel.addEventListener('click', () => {
    closeModal(ui.promo);
    state.selected = null;
    state.hints = [];
    render();
  });

  // ابزارها
  ui.pgnBtn.addEventListener('click', () => {
    openTextModal('PGN بازی', state.game.pgn() || '(خالی)', 'view');
  });
  ui.fenBtn.addEventListener('click', () => {
    openTextModal('FEN موقعیت', state.game.fen(), 'view');
  });
  ui.saveBtn.addEventListener('click', () => {
    saveState();
    openTextModal('کد بازی (قابل کپی)', exportPortable(), 'view');
  });
  ui.loadBtn.addEventListener('click', () => {
    const saved = loadSaved();
    openTextModal('بارگذاری بازی', saved || '', 'load');
  });

  // مودال متن
  ui.textCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.textArea.value);
      ui.textCopy.textContent = '✓ کپی شد';
      setTimeout(() => (ui.textCopy.textContent = '📋 کپی'), 1600);
    } catch (_) {}
  });
  ui.textOk.addEventListener('click', () => {
    if (state.textMode === 'load') {
      try {
        importPortable(ui.textArea.value);
        closeModal(ui.textModal);
      } catch (err) {
        alert('کد نامعتبر است: ' + err.message);
      }
    } else {
      closeModal(ui.textModal);
    }
  });
  ui.textCancel.addEventListener('click', () => closeModal(ui.textModal));

  // بستن مودال با کلیک روی overlay
  [ui.promo, ui.end, ui.textModal].forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m) closeModal(m);
    });
  });

  // Escape برای بستن مودال
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    [ui.promo, ui.end, ui.textModal].forEach((m) => {
      if (m.classList.contains('show')) closeModal(m);
    });
  });

  // اولین تعامل → init صدا
  document.addEventListener('pointerdown', initAudio, { once: true });
  document.addEventListener('keydown', initAudio, { once: true });

  // ذخیره قبل از بستن
  window.addEventListener('beforeunload', saveState);

  // بزرگ‌شدن پنجره → کانفتی را اندازه بده
  window.addEventListener('resize', () => {
    if (ui.confetti.classList.contains('active')) {
      ui.confetti.width = window.innerWidth;
      ui.confetti.height = window.innerHeight;
    }
  });

  /* ═══ ۱۸. Init ════════════════════════════════════════════════ */

  function newGame() {
    // آزادسازی موتور قبلی
    if (state.engine) {
      try { state.engine.stop(); } catch (_) {}
    }
    closeModal(ui.end);
    closeModal(ui.promo);

    const colorChoice = ui.color.value;
    const human = colorChoice === 'r'
      ? (Math.random() < 0.5 ? 'w' : 'b')
      : colorChoice;

    state.game = new window.Chess();
    state.human = human;
    state.flipped = human === 'b';
    state.selected = null;
    state.hints = [];
    state.hintMove = null;
    state.lastMove = null;
    state.busy = false;
    state.over = false;
    state.reviewMode = false;
    state.redoStack = [];
    state.cursorSq = null;
    state.timeControl = +ui.timeControl.value || 0;
    state.clocks = {
      w: state.timeControl,
      b: state.timeControl,
    };
    state.clockRunningFor = 'w';
    state.lastTick = Date.now();

    stopClock();
    startClock();
    render();
    updateStatus();
    updateClocks();

    // اگر انسان سیاه است، هوش مصنوعی شروع می‌کند
    if (state.game.turn() !== state.human) aiTurn();

    // موتور را برای بازی جدید آماده کن (در پس‌زمینه)
    if (state.engine) state.engine.newGame?.();
  }

  // راه‌اندازی
  (function boot() {
    // تم
    try {
      const savedTheme = localStorage.getItem(KEY_THEME);
      const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
    } catch (_) { applyTheme('light'); }

    // صدا
    try {
      const s = localStorage.getItem(KEY_SOUND);
      state.soundOn = s === null ? true : s === '1';
    } catch (_) { state.soundOn = true; }
    ui.soundIcon.textContent = state.soundOn ? '🔊' : '🔇';

    // تلاش برای بازیابی ذخیره‌شده
    const saved = loadSaved();
    if (saved) {
      try {
        importPortable(saved);
        return;
      } catch (_) {
        clearSaved();
      }
    }
    // در غیر این صورت بازی جدید
    newGame();
  })();
})();
