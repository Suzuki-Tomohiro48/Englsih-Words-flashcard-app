(() => {
  'use strict';
  const LS = { words: 'wc_words', state: 'wc_state', queue: 'wc_queue' };
  const $ = id => document.getElementById(id);
  const card = $('card');

  let words = load(LS.words, []);              // 全単語
  // status: 'todo'(まだ) | 'done'(覚えた) | 'all' / source: '' = すべて / shuffle + seed: ランダム順
  let state = Object.assign({ en: null, status: 'todo', source: '', shuffle: false, seed: 1, autoSpeak: false }, load(LS.state, {}));
  if ('unlearnedOnly' in state) { state.status = state.unlearnedOnly ? 'todo' : 'all'; delete state.unlearnedOnly; }
  let queue = load(LS.queue, []);              // 未送信のStatus更新
  let list = [];                               // 表示対象
  let idx = 0;
  let busy = false;

  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ストレージ不可でも動作継続 */ } }
  function fatal(where, e) {
    const msg = '[' + where + '] ' + ((e && e.message) || e) + (e && e.stack ? '\n' + e.stack : '');
    if (window.__showError) window.__showError(msg);
  }
  if (!Array.isArray(words)) words = [];
  if (!Array.isArray(queue)) queue = [];

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------- 音声発話 (Web Speech API / 端末内TTS・外部通信なし) ---------- */
  // 未対応環境(ウォッチ等)では何もせず、発音ボタンを隠して続行する
  let synth = null;
  try {
    if (typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined') synth = window.speechSynthesis;
  } catch (e) { synth = null; }
  let enVoice = null;
  function pickVoice() {
    try {
      if (!synth) return;
      const vs = (synth.getVoices() || []).filter(v => /^en[-_]/i.test(v.lang));
      // 端末内(localService)の米国英語を最優先 → 他の英語
      enVoice = vs.find(v => /en[-_]US/i.test(v.lang) && v.localService) ||
                vs.find(v => /en[-_]US/i.test(v.lang)) ||
                vs.find(v => v.localService) || vs[0] || null;
    } catch (e) { enVoice = null; }
  }
  try { if (synth) { pickVoice(); if (synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice); } } catch (e) {}

  function speak(text) {
    try {
      if (!synth || !text) return;
      synth.cancel();                      // 連打・連続移動時に溜めない
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      if (enVoice) u.voice = enVoice;
      u.rate = 0.9;
      synth.speak(u);
    } catch (e) { if (window.__showError) window.__showError('[speech] ' + e.message); }
  }
  if (!synth) document.querySelectorAll('.speak').forEach(b => { b.style.display = 'none'; });
  $('speakEn').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speak(w.en); };
  $('speakEx').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speak(w.example); };
  $('autoSpeak').checked = !!state.autoSpeak && !!synth;
  $('autoSpeak').onchange = e => { state.autoSpeak = e.target.checked; save(LS.state, state); };

  /* ---------- スマートウォッチ判定 (本体は index.html 先頭の __applyWatch) ---------- */
  function applyWatchMode() {
    try {
      if (window.__applyWatch) window.__applyWatch();
      else document.documentElement.classList.toggle('watch', Math.min(window.innerWidth, screen.width || 9999) <= 450);
    } catch (e) { /* 失敗しても通常UIで続行 */ }
  }
  applyWatchMode();
  window.addEventListener('resize', () => { applyWatchMode(); try { buildList(list[idx] && list[idx].en); render(); } catch (e) { fatal('resize', e); } });

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
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'music.youtube.com') {
      id = u.searchParams.get('v');
      const p = u.pathname.split('/');
      if (!id && ['shorts', 'live', 'embed'].includes(p[1])) id = p[2];
    }
    if (!id) return null;
    const hashT = (u.hash.match(/[#&]t=([^&]+)/) || [])[1];
    const t = parseTime(u.searchParams.get('t') ?? u.searchParams.get('start') ?? hashT);
    return { id, t };
  }

  // 戻り値: { href, external } 。開始位置は「指定秒の5秒前」
  function buildLink(w) {
    const url = w.sourceUrl;
    if (!url) return null;
    const yt = parseYouTube(url);
    if (!yt) return { href: url };
    // H列(開始秒)があれば URL内のtより優先
    const base = parseTime(w.startSec) ?? yt.t;
    const start = base != null ? Math.max(0, base - 5) : null;
    const q = `v=${yt.id}` + (start != null ? `&t=${start}s` : '');
    const web = `https://www.youtube.com/watch?${q}`;
    if (!isAndroid) return { href: web };
    return {
      href: `intent://www.youtube.com/watch?${q}#Intent;scheme=https;package=com.google.android.youtube;` +
            `S.browser_fallback_url=${encodeURIComponent(web)};end`
    };
  }

  /* ---------- 絞り込み ---------- */
  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function buildList(keepEn) {
    list = words.filter(w =>
      (state.status === 'all' || (state.status === 'done') === w.done) &&
      (!state.source || w.source === state.source));
    if (state.shuffle) list.sort((a, b) => hash(a.en + state.seed) - hash(b.en + state.seed));
    // ウォッチ(極小UI)は絞り込みUIが無いので、結果が空なら保存済みフィルターを無視して全単語を出す
    if (!list.length && words.length && isWatch()) list = words.slice();
    const i = keepEn ? list.findIndex(w => w.en === keepEn) : -1;
    idx = i >= 0 ? i : Math.min(idx, Math.max(list.length - 1, 0));
    updateBadge();
  }

  function updateBadge() {
    $('filterBadge').hidden = !(state.status !== 'todo' || state.source || state.shuffle);
  }

  function refreshSourceOptions() {
    const sel = $('sourceSel');
    const sources = [...new Set(words.map(w => w.source).filter(Boolean))];
    sel.innerHTML = '';
    sel.add(new Option('すべての出典', ''));
    sources.forEach(s => sel.add(new Option(s, s)));   // 表示名はシートの文字列そのまま
    sel.value = sources.includes(state.source) ? state.source : '';
    if (sel.value !== state.source) { state.source = ''; save(LS.state, state); }
  }

  function syncSheetUI() {
    document.querySelectorAll('#statusSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === state.status));
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
    state.status = 'todo'; state.source = ''; state.shuffle = false;
    syncSheetUI(); applyFilter();
  };

  /* ---------- 表示 ---------- */
  function setEmpty(msg) {
    const e = $('empty');
    e.textContent = msg; e.hidden = false; e.style.whiteSpace = 'pre-line'; e.style.textAlign = 'center';
    card.hidden = true;
  }
  const isWatch = () => document.documentElement.classList.contains('watch');
  $('empty').onclick = () => { if (!words.length) { setEmpty('読み込み中…'); sync(true); } };

  function render() {
    const w = list[idx];
    $('empty').hidden = !!w;
    card.hidden = !w;
    $('done').disabled = !w;
    $('progress').textContent = w ? `${idx + 1} / ${list.length}` : '0 / 0';
    if (!w) {
      // 単語データ自体が未取得のときは「読み込み中/失敗」の表示を上書きしない
      if (words.length) setEmpty('表示できる単語がありません 🎉\n(絞り込みを確認)');
      return;
    }
    $('en').textContent = w.en;
    $('ipa').textContent = w.ipa;
    $('ja').textContent = w.ja;

    // ① 例文・備考（空なら項目ごと非表示）
    $('example').textContent = w.example;
    $('exampleBox').hidden = !w.example;
    $('note').textContent = w.note;
    $('noteBox').hidden = !w.note;

    // ②③ 出典: 表示名はシートの文字列そのまま / リンクがあればタップ可能
    const a = $('sourceLink');
    $('sourceBox').hidden = !w.source;
    a.textContent = w.source;
    const link = buildLink(w);
    if (link) {
      a.href = link.href;
      a.classList.remove('nolink');
      if (link.href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
      else { a.removeAttribute('target'); a.removeAttribute('rel'); }
    } else {
      a.removeAttribute('href'); a.removeAttribute('target');
      a.classList.add('nolink');
    }

    card.classList.toggle('is-done', w.done);
    $('done').textContent = w.done ? '未学習に戻す' : '覚えた ✓';
    state.en = w.en; save(LS.state, state);   // 位置を保存 → 次回続きから
  }

  function go(delta) {
    if (busy || !list.length) return;
    const next = idx + delta;
    if (next < 0 || next >= list.length) { toast(next < 0 ? '最初の単語です' : '最後の単語です'); return; }
    busy = true;
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
      if (state.autoSpeak && list[idx]) speak(list[idx].en);
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
      moved = true; stage.setPointerCapture(e.pointerId);
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

  /* ---------- 覚えた（楽観的更新 + 非同期送信） ---------- */
  $('done').onclick = () => {
    const w = list[idx];
    if (!w || busy) return;
    w.done = !w.done;
    queue = queue.filter(q => q.en !== w.en);
    queue.push({ row: w.row, en: w.en, done: w.done });
    save(LS.words, words); save(LS.queue, queue);
    toast(w.done ? '覚えた！' : '未学習に戻しました');
    // 現在のフィルターから外れる場合はリストから除去（同じindexに次の単語が来る）
    if (state.status !== 'all' && (state.status === 'done') !== w.done) {
      card.classList.remove('flipped');
      list.splice(idx, 1);
      if (idx >= list.length) idx = Math.max(list.length - 1, 0);
    }
    render();
    flushQueue();
  };

  let flushing = false;
  async function flushQueue() {
    if (flushing || !queue.length || !navigator.onLine) return;
    flushing = true;
    try {
      while (queue.length) {
        const item = queue[0];
        const res = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // プリフライト回避
          body: JSON.stringify({ ...item, token: CONFIG.TOKEN })
        });
        const j = await res.json();
        if (!j.ok && j.error !== 'word not found') throw new Error(j.error);
        queue.shift(); save(LS.queue, queue);
      }
    } catch (e) {
      toast('同期失敗: 後で再送します');
    } finally { flushing = false; }
  }

  /* ---------- 同期 ---------- */
  async function sync(manual) {
    $('reload').classList.add('spin');
    try {
      await flushQueue();
      const url = `${CONFIG.API_URL}?token=${encodeURIComponent(CONFIG.TOKEN)}`;
      // 制限の多いWebViewでハングしないようタイムアウトを設ける(AbortController未対応なら無し)
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
      let res;
      try { res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined); }
      finally { if (timer) clearTimeout(timer); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      let j;
      try { j = JSON.parse(text); }
      catch { throw new Error('JSONではない応答: ' + text.slice(0, 80)); }
      if (!j.ok) throw new Error(j.error || 'API error');
      const pending = new Map(queue.map(q => [q.en, q.done]));
      words = j.words.map(w => pending.has(w.en) ? Object.assign({}, w, { done: pending.get(w.en) }) : w);
      save(LS.words, words);
      const cur = list[idx] && list[idx].en;
      refreshSourceOptions();
      buildList(cur || state.en);
      render();
      if (manual) toast('同期しました');
    } catch (e) {
      const msg = (e && e.name === 'AbortError') ? 'タイムアウト' : (e && e.message) || String(e);
      if (window.__showError) window.__showError('[sync] ' + msg + (e && e.stack ? '\n' + e.stack : ''));
      if (!words.length) setEmpty('読み込み失敗\n' + msg + '\n(タップで⟳再試行)');
      toast(words.length ? 'オフライン: 保存データを表示中' : '読み込み失敗: ' + msg);
    } finally { $('reload').classList.remove('spin'); }
  }

  $('reload').onclick = () => sync(true);
  window.addEventListener('online', () => flushQueue());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushQueue(); });

  /* ---------- 起動: キャッシュで即表示 → 裏で同期 ---------- */
  try {
    if (!words.length) setEmpty('読み込み中…');
    refreshSourceOptions();
    buildList(state.en);
    render();
  } catch (e) { fatal('起動', e); }
  sync(false).catch(e => fatal('同期', e));

  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => fatal('SW', e));
  } catch (e) { /* ウォッチ等で未対応でも無視 */ }
})();
