(() => {
  'use strict';
  const { LS, load, save } = WC;
  const $ = id => document.getElementById(id);
  const card = $('card');

  /* ---------- 設定（間隔反復） ---------- */
  const NEW_CAP = CONFIG.NEW_PER_DAY || 20;        // 1日の新規上限
  const REV_CAP = CONFIG.REVIEW_PER_DAY || 20;     // 1日の復習上限
  const INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120]; // 段階ごとの間隔(日)
  const MAX_STAGE = INTERVALS.length - 1;
  const RETRY_GAP = 8;                             // 「まだ」の単語を何枚後にもう一度出すか

  /* ---------- 状態 ---------- */
  // status: today(今日の学習) | new(新規) | due(復習) | done(覚えた) | all(すべて)
  let state = Object.assign({ en: null, status: 'today', source: '', shuffle: false, seed: 1, autoSpeak: false }, load(LS.state, {}));
  if ('unlearnedOnly' in state) { state.status = state.unlearnedOnly ? 'today' : 'all'; delete state.unlearnedOnly; }
  if (state.status === 'todo') state.status = 'today';          // 旧バージョンの値
  if (['today', 'new', 'due', 'done', 'all'].indexOf(state.status) < 0) state.status = 'today';

  const normWord = w => {
    w.stage = +w.stage || 0; w.due = w.due || ''; w.last = w.last || '';
    w.streak = +w.streak || 0; w.wrong = +w.wrong || 0; w.reps = +w.reps || 0; w.done = !!w.done;
    return w;
  };
  let words = load(LS.words, []);
  if (!Array.isArray(words)) words = [];
  words.forEach(normWord);

  let list = [];       // 表示対象
  let idx = 0;
  let busy = false;

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------- 今日の学習量 ---------- */
  function getDaily() {
    let d = load(LS.daily, null);
    const t = WC.today();
    if (!d || d.day !== t) { d = { day: t, new: 0, review: 0 }; save(LS.daily, d); }
    return d;
  }

  /* ---------- 単語の分類 ---------- */
  const isNew = w => w.reps === 0 && !w.done;                              // 一度も回答していない
  const isDue = w => w.reps > 0 && !!w.due && w.due <= WC.today();         // 復習日が来ている

  /* ---------- 音声 ---------- */
  if (!WC.canSpeak) document.querySelectorAll('.speak').forEach(b => { b.style.display = 'none'; });
  const speakWord = (text, lang) => { sess.speaks++; WC.speak(text, lang); };
  $('speakEn').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speakWord(w.en, 'en'); };
  $('speakEx').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speakWord(w.example); };
  $('speakNote').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speakWord(w.note); };
  $('autoSpeak').checked = !!state.autoSpeak && WC.canSpeak;
  $('autoSpeak').onchange = e => { state.autoSpeak = e.target.checked; save(LS.state, state); };

  /* ---------- 学習セッションの記録（時間・スワイプ数など） ---------- */
  const sess = { swipes: 0, flips: 0, speaks: 0, seen: new Set(), active: 0 };
  let lastAct = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
  // 画面が見えていて、直近30秒以内に操作があった時間だけを「学習時間」にする
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastAct < 30000) sess.active++; }, 1000);

  function flushSession() {
    if (!(sess.active || sess.swipes || sess.flips || sess.seen.size)) return;
    WC.enqueue({
      kind: 'session', id: WC.uid(), day: WC.today(),
      cards: sess.seen.size, activeSec: sess.active, swipes: sess.swipes, flips: sess.flips, speaks: sess.speaks,
      device: WC.deviceId()
    });
    sess.swipes = sess.flips = sess.speaks = sess.active = 0;
    sess.seen = new Set();
  }
  function flushAll(keepalive) { flushSession(); WC.flush({ keepalive: !!keepalive }).catch(() => { /* 後で再送 */ }); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(true); });
  window.addEventListener('pagehide', () => flushAll(true));
  setInterval(() => flushAll(false), 5 * 60 * 1000);

  /* ---------- YouTube ディープリンク ---------- */
  const isAndroid = /Android/i.test(navigator.userAgent);

  // "90" / "90s" / "1m30s" / "1h2m3s" → 秒
  function parseTime(s) {
    if (s == null || s === '') return null;
    s = String(s).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
    const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m || !(m[1] || m[2] || m[3])) return null;
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }

  function parseYouTube(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'music.youtube.com') {
      id = u.searchParams.get('v');
      const p = u.pathname.split('/');
      if (!id && ['shorts', 'live', 'embed'].indexOf(p[1]) >= 0) id = p[2];
    }
    if (!id) return null;
    const hashT = (u.hash.match(/[#&]t=([^&]+)/) || [])[1];
    let t = u.searchParams.get('t');
    if (t == null) t = u.searchParams.get('start');
    if (t == null) t = hashT;
    return { id, t: parseTime(t) };
  }

  // 開始位置は「指定秒の5秒前」。H列(開始秒)があればURL内のtより優先
  function buildLink(w) {
    const url = w.sourceUrl;
    if (!url) return null;
    const yt = parseYouTube(url);
    if (!yt) return { href: url };
    const hCol = parseTime(w.startSec);
    const base = hCol != null ? hCol : yt.t;
    const start = base != null ? Math.max(0, base - 5) : null;
    const q = `v=${yt.id}` + (start != null ? `&t=${start}s` : '');
    const web = `https://www.youtube.com/watch?${q}`;
    if (!isAndroid) return { href: web };
    return {
      href: `intent://www.youtube.com/watch?${q}#Intent;scheme=https;package=com.google.android.youtube;` +
            `S.browser_fallback_url=${encodeURIComponent(web)};end`
    };
  }

  /* ---------- 絞り込み・今日のリスト ---------- */
  const hashCmp = (a, b) => WC.hash(a.en + state.seed) - WC.hash(b.en + state.seed);
  const STATUS_NOTE = {
    today: `復習(最大${REV_CAP}語) → 新規(最大${NEW_CAP}語)の順に出題。上限は1日ごとにリセット。`,
    new: '一度も回答していない単語（上限なし）',
    due: '復習日が来た単語（上限なし）。古い順',
    done: '覚えた単語すべて',
    all: 'すべての単語'
  };

  function matches(w) {
    switch (state.status) {
      case 'new': return isNew(w);
      case 'due': return isDue(w);
      case 'done': return w.done;
      default: return true;
    }
  }

  function buildList(keepEn) {
    const base = words.filter(w => !state.source || w.source === state.source);
    if (state.status === 'today') {
      const d = getDaily();
      const due = base.filter(isDue).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
        .slice(0, Math.max(0, REV_CAP - d.review));
      const fresh = base.filter(isNew).slice(0, Math.max(0, NEW_CAP - d.new));
      list = due.concat(fresh);
    } else {
      list = base.filter(matches);
    }
    if (state.shuffle) list.sort(hashCmp);
    const i = keepEn ? list.findIndex(w => w.en === keepEn) : -1;
    idx = i >= 0 ? i : Math.min(idx, Math.max(list.length - 1, 0));
    updateBadge();
  }

  function updateBadge() {
    $('filterBadge').hidden = !(state.status !== 'today' || state.source || state.shuffle);
  }

  function refreshSourceOptions() {
    const sel = $('sourceSel');
    const sources = [];
    words.forEach(w => { if (w.source && sources.indexOf(w.source) < 0) sources.push(w.source); });
    sel.innerHTML = '';
    sel.add(new Option('すべての出典', ''));
    sources.forEach(s => sel.add(new Option(s, s)));   // 表示名はシートの文字列そのまま
    sel.value = sources.indexOf(state.source) >= 0 ? state.source : '';
    if (sel.value !== state.source) { state.source = ''; save(LS.state, state); }
  }

  function syncSheetUI() {
    document.querySelectorAll('#statusSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === state.status));
    $('statusNote').textContent = STATUS_NOTE[state.status] || '';
    $('sourceSel').value = state.source;
    $('shuffle').checked = state.shuffle;
  }

  function applyFilter() {
    save(LS.state, state);
    card.classList.remove('flipped');
    buildList(null);
    idx = 0;
    render();
  }

  function openSheet(open) { $('sheet').hidden = $('sheetBg').hidden = !open; if (open) syncSheetUI(); }
  $('filterBtn').onclick = () => openSheet(true);
  $('filterClose').onclick = $('sheetBg').onclick = () => openSheet(false);
  document.querySelectorAll('#statusSeg button').forEach(b => b.onclick = () => {
    state.status = b.dataset.v; syncSheetUI(); applyFilter();
  });
  $('sourceSel').onchange = e => { state.source = e.target.value; applyFilter(); };
  $('shuffle').onchange = e => {
    state.shuffle = e.target.checked;
    if (state.shuffle) state.seed = Date.now() % 100000;
    applyFilter();
  };
  $('filterReset').onclick = () => {
    state.status = 'today'; state.source = ''; state.shuffle = false;
    syncSheetUI(); applyFilter();
  };

  /* ---------- 表示 ---------- */
  function setEmpty(msg) {
    const e = $('empty');
    e.textContent = msg; e.hidden = false; e.style.whiteSpace = 'pre-line'; e.style.textAlign = 'center';
    card.hidden = true;
  }
  $('empty').onclick = () => { if (!words.length) { setEmpty('読み込み中…'); sync(true); } };

  function renderDaily() {
    const d = getDaily();
    $('daily').textContent = `新規 ${d.new}/${NEW_CAP}・復習 ${d.review}/${REV_CAP}`;
  }

  function render() {
    renderDaily();
    const w = list[idx];
    $('empty').hidden = !!w;
    card.hidden = !w;
    $('done').disabled = $('again').disabled = !w;
    $('progress').textContent = w ? `${idx + 1} / ${list.length}` : '0 / 0';
    if (!w) {
      // 単語データ自体が未取得のときは「読み込み中/失敗」の表示を上書きしない
      if (words.length) {
        if (state.status === 'today') {
          const d = getDaily();
          setEmpty(`今日の分は完了 🎉\n新規 ${d.new}/${NEW_CAP} ・ 復習 ${d.review}/${REV_CAP}\n(「絞り込み」で新規・復習を選ぶと続けられます)`);
        } else {
          setEmpty('表示できる単語がありません\n(絞り込みを確認)');
        }
      }
      return;
    }
    $('en').textContent = w.en;
    $('ipa').textContent = w.ipa;
    $('ja').textContent = w.ja;
    $('tag').textContent = isNew(w) ? 'NEW' : (isDue(w) ? `復習 Lv${w.stage}` : (w.done ? `覚えた Lv${w.stage}` : `学習中`));

    // 例文・備考（空なら項目ごと非表示）
    $('example').textContent = w.example;
    $('exampleBox').hidden = !w.example;
    $('note').textContent = w.note;
    $('noteBox').hidden = !w.note;

    // 出典: 表示名はシートの文字列そのまま / リンクがあればタップ可能
    const a = $('sourceLink');
    $('sourceBox').hidden = !w.source;
    a.textContent = w.source;
    const link = buildLink(w);
    if (link) {
      a.href = link.href;
      a.classList.remove('nolink');
      if (link.href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
      else { a.removeAttribute('target'); a.removeAttribute('rel'); }
    } else {
      a.removeAttribute('href'); a.removeAttribute('target');
      a.classList.add('nolink');
    }

    card.classList.toggle('is-done', w.done);
    sess.seen.add(w.en);
    state.en = w.en; save(LS.state, state);   // 位置を保存 → 次回続きから
  }

  function go(delta) {
    if (busy || !list.length) return;
    const next = idx + delta;
    if (next < 0 || next >= list.length) { toast(next < 0 ? '最初の単語です' : '最後の単語です'); return; }
    busy = true;
    sess.swipes++;
    const dir = delta > 0 ? 'left' : 'right';
    card.classList.remove('dragging');
    card.style.transform = '';
    card.classList.add('slide-out-' + dir);
    setTimeout(() => {
      idx = next;
      card.classList.remove('slide-out-' + dir, 'flipped');
      card.style.setProperty('--from', delta > 0 ? '40px' : '-40px');
      render();
      card.classList.add('slide-in');
      if (state.autoSpeak && list[idx]) WC.speak(list[idx].en, 'en');
      setTimeout(() => { card.classList.remove('slide-in'); busy = false; }, 200);
    }, 150);
  }

  /* ---------- タップ / スワイプ ---------- */
  let sx = 0, sy = 0, dx = 0, tracking = false, moved = false;
  const stage = $('stage');
  stage.addEventListener('pointerdown', e => {
    if (busy || e.target.closest('a, button')) return;   // リンク/発音ボタンのタップではカードを裏返さない
    tracking = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0;
  });
  stage.addEventListener('pointermove', e => {
    if (!tracking) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!moved && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      moved = true;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 未対応でも続行 */ }
    }
    if (moved) {
      card.classList.add('dragging');
      const flip = card.classList.contains('flipped') ? ' rotateY(180deg)' : '';
      card.style.transform = `translateX(${dx}px)${flip}`;
    }
  });
  stage.addEventListener('pointerup', () => {
    if (!tracking) return;
    tracking = false;
    card.classList.remove('dragging');
    card.style.transform = '';
    if (moved) {
      if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1);
    } else if (list.length) {
      card.classList.toggle('flipped');
      sess.flips++;
    }
  });
  stage.addEventListener('pointercancel', () => { tracking = false; card.classList.remove('dragging'); card.style.transform = ''; });

  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === ' ') { card.classList.toggle('flipped'); e.preventDefault(); }
  });

  /* ---------- 回答（覚えた / まだ）: 間隔反復の更新 + 非同期送信 ---------- */
  function intervalDays(w) {
    const base = INTERVALS[Math.min(MAX_STAGE, Math.max(0, w.stage))];
    if (base < 7) return Math.max(1, base);
    const jitter = ((WC.hash(w.en + ':' + w.reps) % 21) - 10) / 100;     // ±10% で復習日が固まるのを防ぐ
    return Math.max(1, Math.round(base * (1 + jitter)));
  }

  function answer(result) {
    const w = list[idx];
    if (!w || busy) return;
    const t = WC.today();
    const ok = result === 'remembered';
    const first = w.last !== t;               // 今日まだ回答していない（同日の再回答では段階を動かさない）
    const wasNew = first && isNew(w);
    const wasDue = first && !wasNew && isDue(w);

    if (first) {
      if (ok) {
        w.stage = Math.min(MAX_STAGE, w.stage + 1);
        w.streak += 1;
        w.due = WC.addDays(t, intervalDays(w));
      } else {
        w.wrong += 1;
        w.streak = 0;
        w.stage = w.stage > 0 ? Math.max(1, w.stage - 2) : 0;   // 1〜2段階だけ戻す（0まで戻さない）
        w.due = WC.addDays(t, 1);
      }
      w.reps += 1;
      w.last = t;
      const d = getDaily();
      if (wasNew) d.new++; else if (wasDue) d.review++;
      save(LS.daily, d);
    } else if (!ok) {
      w.due = WC.addDays(t, 1);
    }
    w.done = ok;

    WC.enqueue({
      kind: 'review', id: WC.uid(), row: w.row, en: w.en, day: t,
      done: w.done, result: result, isNew: wasNew, isReview: wasDue,
      srs: { stage: w.stage, due: w.due, last: w.last, streak: w.streak, wrong: w.wrong, reps: w.reps },
      device: WC.deviceId()
    });
    save(LS.words, words);
    toast(ok ? '覚えた！' : 'もう一度やろう');

    // 現在の表示条件から外れる単語はリストから除去。残る場合は次の単語へ
    const stays = state.status !== 'today' && matches(w);
    if (!stays) {
      card.classList.remove('flipped');
      list.splice(idx, 1);
      if (!ok) list.splice(Math.min(list.length, idx + RETRY_GAP), 0, w);   // 「まだ」は数枚後にもう一度
      if (idx >= list.length) idx = Math.max(list.length - 1, 0);
      render();
      if (state.autoSpeak && list[idx]) WC.speak(list[idx].en, 'en');
    } else if (idx < list.length - 1) {
      render();
      go(1);
    } else {
      render();
    }
    WC.flush().catch(() => toast('同期失敗: 後で再送します'));
  }
  $('done').onclick = () => answer('remembered');
  $('again').onclick = () => answer('again');

  /* ---------- 同期 ---------- */
  async function sync(manual) {
    $('reload').classList.add('spin');
    try {
      try { await WC.flush(); } catch (e) { /* オフライン等は後で再送 */ }
      const j = await WC.apiGet({ action: 'words' });
      if (!j.ok) throw new Error(j.error || 'API error');
      // 未送信の変更はローカル優先
      const pend = new Map();
      WC.getQueue().forEach(q => {
        if (q.kind === 'review') pend.set(q.en, Object.assign({ done: q.done }, q.srs));
        else if (q.kind === 'status') pend.set(q.en, Object.assign({}, pend.get(q.en), { done: q.done }));
      });
      words = j.words.map(w => normWord(pend.has(w.en) ? Object.assign({}, w, pend.get(w.en)) : w));
      save(LS.words, words);
      const cur = list[idx] && list[idx].en;
      refreshSourceOptions();
      buildList(cur || state.en);
      render();
      if (manual) toast('同期しました');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.error('sync', e);
      if (!words.length) setEmpty('読み込み失敗\n' + msg + '\n(タップで再試行)');
      toast(words.length ? 'オフライン: 保存データを表示中' : '読み込み失敗: ' + msg);
    } finally { $('reload').classList.remove('spin'); }
  }

  $('reload').onclick = () => sync(true);
  window.addEventListener('online', () => WC.flush().catch(() => {}));

  /* ---------- 今日の名言（1日1回、最初に表示） ---------- */
  function showQuoteOnce() {
    const t = WC.today();
    if (load(LS.quoteSeen, '') === t) return;
    const extra = (load(LS.summary, {}) || {}).quotes;
    const q = WC.quoteOfDay(t, extra);
    if (!q) return;
    WC.fillQuote(q);
    $('quoteBg').hidden = $('quoteBox').hidden = false;
    $('qClose').onclick = $('quoteBg').onclick = () => {
      $('quoteBg').hidden = $('quoteBox').hidden = true;
      save(LS.quoteSeen, t);
    };
  }

  /* ---------- 起動: キャッシュで即表示 → 裏で同期 ---------- */
  try {
    if (!words.length) setEmpty('読み込み中…');
    refreshSourceOptions();
    buildList(state.en);
    render();
    showQuoteOnce();
  } catch (e) { console.error('init', e); }
  sync(false).catch(e => console.error('sync', e));

  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.error('SW', e));
  } catch (e) { /* 未対応でも無視 */ }
})();
