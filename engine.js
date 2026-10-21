/* ═══════════════════════════════════════════════════════════════════
   engine.js — موتور شطرنج مقاوم برای «شطرنج کاغذی»

   ┌─ معماری ─────────────────────────────────────────────────────┐
   │  Engine (کلاس اصلی)                                          │
   │  ├─ init()       → بارگذاری تنبل Stockfish از یکی از CDNها    │
   │  ├─ think()      → Promise<{from,to,promotion}|null>          │
   │  ├─ stop()       → Promise<void> (انتظار تا idle شدن موتور)   │
   │  ├─ newGame()    → Promise<void> (ucinewgame + isready)       │
   │  ├─ destroy()    → terminate + revokeObjectURL                │
   │  └─ status      → {state, engine: 'stockfish'|'fallback'}     │
   │                                                              │
   │  Fallback Engine (در صورت شکست Stockfish)                     │
   │  ├─ ارزیابی: material + piece-square tables                   │
   │  └─ جستجو: negamax + alpha-beta + MVV-LVA                     │
   │                                                              │
   │  ماشین حالت:                                                 │
   │    idle → loading → ready ⇄ thinking → stopping → ready       │
   │         ↘ failed (پس از سه شکست متوالی → fallback)           │
   └──────────────────────────────────────────────────────────────┘

   API عمومی (global):
   ──────────────────────────────────────────────────────────────
     const engine = new Engine();
     await engine.init();                    // اختیاری (think خودش صدا می‌زند)
     await engine.newGame();                 // reset state
     const move = await engine.think(fen, 2);// → {from,to,promotion}|null
     await engine.stop();                    // cancel + wait idle
     engine.destroy();                       // cleanup
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ═══ ۱. تنظیمات ═══════════════════════════════════════════════ */

  // پیکربندی سطوح — هر سطح: skill (0-20), depth, movetime (ms)
  // تایم و depth با هم ترکیب می‌شوند: هرکدام زودتر تمام شد، تمام است
  const LEVELS = Object.freeze([
    Object.freeze({ name: 'مبتدی',   skill: 1,  depth: 2,  movetime: 200  }),
    Object.freeze({ name: 'متوسط',   skill: 8,  depth: 8,  movetime: 500  }),
    Object.freeze({ name: 'حرفه‌ای', skill: 15, depth: 14, movetime: 1200 }),
    Object.freeze({ name: 'استاد',   skill: 20, depth: 22, movetime: 2500 }),
  ]);

  // سه CDN — اگر اولی در دسترس نبود، دومی، سپس سومی
  const CDNS = Object.freeze([
    'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
    'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.js',
    'https://unpkg.com/stockfish@10.0.2/src/stockfish.js',
  ]);

  const T_INIT  = 10_000;  // حداکثر انتظار برای آماده‌شدن موتور
  const T_THINK = 15_000;  // حداکثر انتظار برای پاسخ یک جستجو
  const T_STOP  =  2_000;  // حداکثر انتظار برای readyok پس از stop

  /* ═══ ۲. جدول‌های ارزیابی (برای موتور پشتیبان) ═════════════════ */

  // ارزش ساده‌ی مهره‌ها بر حسب «سنت‌پاون» (100 = یک سرباز)
  const PIECE_VAL = Object.freeze({
    p: 100, n: 320, b: 330, r: 500, q: 900, k: 20_000,
  });

  // Piece-Square Tables — اعداد در بازه ‎-50..+50‎
  // ایندکس ۰ = a8 ، ایندکس ۶۳ = h1 (یعنی از بالا-چپ)
  // مقادیر مثبت = خانه‌ی خوب برای سفید
  const PST = Object.freeze({
    p: Object.freeze([
        0,   0,   0,   0,   0,   0,   0,   0,
       50,  50,  50,  50,  50,  50,  50,  50,
       10,  10,  20,  30,  30,  20,  10,  10,
        5,   5,  10,  25,  25,  10,   5,   5,
        0,   0,   0,  20,  20,   0,   0,   0,
        5,  -5, -10,   0,   0, -10,  -5,   5,
        5,  10,  10, -20, -20,  10,  10,   5,
        0,   0,   0,   0,   0,   0,   0,   0,
    ]),
    n: Object.freeze([
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20,   0,   0,   0,   0, -20, -40,
      -30,   0,  10,  15,  15,  10,   0, -30,
      -30,   5,  15,  20,  20,  15,   5, -30,
      -30,   0,  15,  20,  20,  15,   0, -30,
      -30,   5,  10,  15,  15,  10,   5, -30,
      -40, -20,   0,   5,   5,   0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ]),
    b: Object.freeze([
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10,   0,   0,   0,   0,   0,   0, -10,
      -10,   0,   5,  10,  10,   5,   0, -10,
      -10,   5,   5,  10,  10,   5,   5, -10,
      -10,   0,  10,  10,  10,  10,   0, -10,
      -10,  10,  10,  10,  10,  10,  10, -10,
      -10,   5,   0,   0,   0,   0,   5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ]),
    r: Object.freeze([
        0,   0,   0,   0,   0,   0,   0,   0,
        5,  10,  10,  10,  10,  10,  10,   5,
       -5,   0,   0,   0,   0,   0,   0,  -5,
       -5,   0,   0,   0,   0,   0,   0,  -5,
       -5,   0,   0,   0,   0,   0,   0,  -5,
       -5,   0,   0,   0,   0,   0,   0,  -5,
       -5,   0,   0,   0,   0,   0,   0,  -5,
        0,   0,   0,   5,   5,   0,   0,   0,
    ]),
    q: Object.freeze([
      -20, -10, -10,  -5,  -5, -10, -10, -20,
      -10,   0,   0,   0,   0,   0,   0, -10,
      -10,   0,   5,   5,   5,   5,   0, -10,
       -5,   0,   5,   5,   5,   5,   0,  -5,
        0,   0,   5,   5,   5,   5,   0,  -5,
      -10,   5,   5,   5,   5,   5,   0, -10,
      -10,   0,   5,   0,   0,   0,   0, -10,
      -20, -10, -10,  -5,  -5, -10, -10, -20,
    ]),
    k: Object.freeze([
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
       20,  20,   0,   0,   0,   0,  20,  20,
       20,  30,  10,   0,   0,  10,  30,  20,
    ]),
  });

  /* ═══ ۳. ابزارهای کمکی ═════════════════════════════════════════ */

  /**
   * آینه‌کردن ایندکس PST برای مهره‌ی سیاه.
   * یک قرینه‌ی عمودی (نه افقی): ایندکس r×8+c ← (7−r)×8+c
   * با XOR 56 (0b111000) سریع‌ترین راه است.
   */
  function mirrorIndex(i) {
    return ((7 - (i >> 3)) << 3) | (i & 7);
  }

  /* ═══ ۴. موتور پشتیبان (MiniMax) ═══════════════════════════════ */

  const Fallback = {
    /**
     * ارزیابی ایستا از دید سفید (مثبت = سفید بهتر).
     * جمع (ارزش مهره + امتیاز PST) با علامتِ رنگ.
     */
    evaluate(game) {
      let score = 0;
      const board = game.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          if (!piece) continue;
          const idx = r * 8 + c;
          const pstIdx = piece.color === 'w' ? idx : mirrorIndex(idx);
          const val = PIECE_VAL[piece.type] + PST[piece.type][pstIdx];
          score += piece.color === 'w' ? val : -val;
        }
      }
      return score;
    },

    /**
     * Minimax با هرس آلفا-بتا.
     * زاویه‌ی دید: مهره‌ی نوبت (side-to-move) از دید خودش maximize می‌کند.
     */
    negamax(game, depth, alpha, beta) {
      if (depth <= 0 || game.game_over()) {
        if (game.in_checkmate()) return -100_000 + (10 - depth); // مات = بدترین
        if (game.in_draw()) return 0;
        const s = this.evaluate(game);
        return game.turn() === 'w' ? s : -s;
      }

      const moves = game.moves({ verbose: true });
      // مرتب‌سازی حرکات: گرفتن‌ها اول، از باارزش‌ترین قربانی به کم‌ارزش‌ترین مهاجم (MVV-LVA)
      moves.sort((a, b) => {
        const av = a.captured ? PIECE_VAL[a.captured] : 0;
        const bv = b.captured ? PIECE_VAL[b.captured] : 0;
        return bv - av;
      });

      let best = -Infinity;
      for (const m of moves) {
        game.move(m);
        const score = -this.negamax(game, depth - 1, -beta, -alpha);
        game.undo();
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break; // هرس
      }
      return best;
    },

    /**
     * بهترین حرکت از یک FEN.
     * @returns {{from:string,to:string,promotion?:string}|null}
     */
    bestMove(fen, maxDepth) {
      if (typeof Chess !== 'function') {
        console.error('[Fallback] chess.js در دسترس نیست');
        return null;
      }
      let game;
      try { game = new Chess(fen); }
      catch (e) { console.error('[Fallback] FEN نامعتبر:', e); return null; }

      const moves = game.moves({ verbose: true });
      if (!moves.length) return null;

      // خلاص‌شدن از «تصادفی بودن همیشگی»: ترتیب تصادفی
      // (وقتی چند حرکت امتیاز یکسان دارند، این باعث تنوع می‌شود)
      for (let i = moves.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [moves[i], moves[j]] = [moves[j], moves[i]];
      }

      // در ریشه، عمق را کمی کمتر از negamax درونی می‌گیریم تا
      // کل درخت جستجو از عمقِ `maxDepth` بیشتر نشود
      const searchDepth = Math.max(1, maxDepth - 1);

      let bestMove = moves[0];
      let bestScore = -Infinity;

      for (const m of moves) {
        game.move(m);
        const score = -this.negamax(game, searchDepth, -Infinity, Infinity);
        game.undo();
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
      }

      const result = { from: bestMove.from, to: bestMove.to };
      if (bestMove.promotion) result.promotion = bestMove.promotion;
      return result;
    },
  };

  /* ═══ ۵. کلاس Engine ══════════════════════════════════════════ */

  class Engine {
    constructor() {
      this.state = 'idle';
      this.worker = null;
      this.blobUrl = null;

      // promise راه‌اندازی (برای جلوگیری از init هم‌زمان)
      this._initPromise = null;

      // قول و کنترل جستجوی فعلی
      this._resolve = null;
      this._reject = null;
      this._timeout = null;

      // منتظرِ readyok (پس از stop)
      this._readyResolver = null;

      // قول پایان stop (برای انتظار در think بعدی)
      this._stoppingPromise = null;
    }

    /** وضعیت عمومی — برای نمایش در رابط کاربری */
    get status() {
      return {
        state: this.state,
        engine: this.state === 'failed' ? 'fallback' : 'stockfish',
      };
    }

    /* ── راه‌اندازی ─────────────────────────────────────────── */

    async init() {
      if (this.state === 'ready' || this.state === 'failed') return;
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._doInit();
      return this._initPromise;
    }

    async _doInit() {
      this.state = 'loading';
      for (const cdn of CDNS) {
        try {
          await this._tryLoadCdn(cdn);
          this.state = 'ready';
          return;
        } catch (e) {
          console.warn('[Engine] CDN ناموفق:', cdn, '—', e.message);
        }
      }
      console.warn('[Engine] همه‌ی CDNها شکست خوردند — استفاده از موتور پشتیبان');
      this.state = 'failed';
    }

    _tryLoadCdn(cdn) {
      return new Promise((resolve, reject) => {
        let blobUrl, worker;
        try {
          const blob = new Blob(
            [`importScripts(${JSON.stringify(cdn)});`],
            { type: 'application/javascript' }
          );
          blobUrl = URL.createObjectURL(blob);
          worker = new Worker(blobUrl);
        } catch (e) {
          reject(e);
          return;
        }

        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(blobUrl);
        };

        const fail = (err) => {
          if (settled) return;
          cleanup();
          reject(err);
        };

        const timeout = setTimeout(
          () => fail(new Error('init timeout')),
          T_INIT
        );

        worker.onerror = (e) =>
          fail(new Error(e.message || 'worker error'));

        worker.onmessage = (e) => {
          const line = String(e.data);
          if (line.startsWith('readyok') && !settled) {
            settled = true;
            clearTimeout(timeout);
            // موفق: نگه‌داری worker و اتصال هندلرهای عادی
            this.worker = worker;
            this.blobUrl = blobUrl;
            worker.onerror = null;
            worker.onmessage = (ev) => this._onMessage(String(ev.data));
            worker.onerror = (ev) => this._onWorkerError(ev);
            resolve();
          }
        };

        worker.postMessage('uci');
        worker.postMessage('isready');
      });
    }

    _onWorkerError(e) {
      console.error('[Engine] worker crash:', e);
      this.state = 'failed';
      if (this._reject) {
        const rej = this._reject;
        this._clearPending();
        rej(new Error('worker crashed'));
      }
    }

    /* ── حلقه‌ی پیام‌ها ─────────────────────────────────────── */

    _onMessage(line) {
      // readyok → پایان stop یا init
      if (line.startsWith('readyok')) {
        const r = this._readyResolver;
        this._readyResolver = null;
        if (r) r();
        return;
      }

      // bestmove → پاسخ جستجو
      if (line.startsWith('bestmove')) {
        if (this.state !== 'thinking' || !this._resolve) {
          // bestmove کهنه (از جستجوی متوقف‌شده) — نادیده بگیر
          return;
        }
        const resolve = this._resolve;
        this._clearPending();
        this.state = 'ready';

        const parts = line.split(/\s+/);
        const uci = parts[1];
        if (!uci || uci === '(none)') {
          resolve(null);
        } else {
          resolve(this._parseUci(uci));
        }
        return;
      }
    }

    _parseUci(uci) {
      const move = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
      if (uci.length > 4) move.promotion = uci[4];
      return move;
    }

    _clearPending() {
      clearTimeout(this._timeout);
      this._timeout = null;
      this._resolve = null;
      this._reject = null;
    }

    /* ── API: think ─────────────────────────────────────────── */

    async think(fen, level = 1) {
      // ۱) مطمئن شو راه‌اندازی شده
      await this.init();

      // ۲) اگر در حال متوقف‌کردن هستیم، تا readyok صبر کن
      if (this.state === 'stopping' && this._stoppingPromise) {
        await this._stoppingPromise;
      }

      // ۳) اگر Stockfish در دسترس نیست، پشتیبان
      if (this.state === 'failed') {
        return this._fallbackMove(fen, level);
      }

      // ۴) اگر در حال فکر کردن است، ابتدا متوقف کن
      if (this.state === 'thinking') {
        await this.stop();
      }

      if (this.state !== 'ready') {
        throw new Error('Engine not ready: ' + this.state);
      }

      // ۵) جستجوی واقعی
      return this._search(fen, level);
    }

    _search(fen, level) {
      return new Promise((resolve, reject) => {
        this.state = 'thinking';
        this._resolve = resolve;
        this._reject = reject;

        // تایم‌اوت سخت — حتی اگر worker پاسخ نداد
        this._timeout = setTimeout(() => {
          console.warn('[Engine] timeout — fallback');
          const wasResolve = this._resolve;
          this._clearPending();
          this.state = 'ready';
          // تلاش برای توقف تمیز (بی‌صدا)
          if (this.worker) {
            this.worker.postMessage('stop');
            this.worker.postMessage('isready');
          }
          if (wasResolve) wasResolve(this._fallbackMove(fen, level));
        }, T_THINK);

        const cfg = LEVELS[level] || LEVELS[1];
        this.worker.postMessage('setoption name Skill Level value ' + cfg.skill);
        this.worker.postMessage('position fen ' + fen);
        this.worker.postMessage(
          `go depth ${cfg.depth} movetime ${cfg.movetime}`
        );
      });
    }

    /* ── API: stop ──────────────────────────────────────────── */

    async stop() {
      if (this.state !== 'thinking') return;

      const resolve = this._resolve;
      this._clearPending();
      this.state = 'stopping';

      if (this.worker) {
        this.worker.postMessage('stop');
        this.worker.postMessage('isready');
      }

      // فوراً به مصرف‌کننده‌ی think() جواب بده: «لغو شد»
      if (resolve) resolve(null);

      // منتظر readyok (تأیید واقعی توقف)
      this._stoppingPromise = new Promise((r) => {
        this._readyResolver = r;
        setTimeout(() => {
          if (this._readyResolver === r) {
            this._readyResolver = null;
            r();
          }
        }, T_STOP);
      });

      await this._stoppingPromise;
      this._stoppingPromise = null;
      this.state = 'ready';
    }

    /* ── API: newGame ──────────────────────────────────────── */

    async newGame() {
      if (this.state === 'thinking') await this.stop();
      if (this.state !== 'ready') return;
      this.worker.postMessage('ucinewgame');
      this.worker.postMessage('isready');
    }

    /* ── API: destroy ──────────────────────────────────────── */

    destroy() {
      if (this.state === 'thinking') {
        // لغو سریع، بدون انتظار
        this._clearPending();
      }
      if (this.worker) {
        try { this.worker.terminate(); } catch (_) {}
        this.worker = null;
      }
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
      this.state = 'idle';
    }

    /* ── پشتیبان داخلی ─────────────────────────────────────── */

    _fallbackMove(fen, level) {
      // عمق را با سطح تنظیم کن، اما محدود بگذار تا کل صفحه فریز نشود
      const depth = Math.min(2 + (level | 0), 5);
      try {
        return Fallback.bestMove(fen, depth);
      } catch (e) {
        console.error('[Fallback] خطا:', e);
        // آخرین تلاش: هر حرکت قانونی
        try {
          if (typeof Chess !== 'function') return null;
          const g = new Chess(fen);
          const ms = g.moves({ verbose: true });
          if (!ms.length) return null;
          const m = ms[Math.floor(Math.random() * ms.length)];
          const r = { from: m.from, to: m.to };
          if (m.promotion) r.promotion = m.promotion;
          return r;
        } catch (_) {
          return null;
        }
      }
    }
  }

  /* ═══ ۶. صادرات به scope جهانی ═════════════════════════════════ */

  window.Engine = Engine;
  // برای دیباگ / تست
  window.__EngineInternals = Object.freeze({ LEVELS, CDNS, Fallback });
})();
