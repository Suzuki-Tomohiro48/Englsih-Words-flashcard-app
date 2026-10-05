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

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------- 音声発話 (Web Speech API / 端末内TTS・外部通信なし) ---------- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let enVoice = null;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter(v => /^en[-_]/i.test(v.lang));
    // 端末内(localService)の米国英語を最優先 → 他の英語
    enVoice = vs.find(v => /en[-_]US/i.test(v.lang) && v.localService) ||
              vs.find(v => /en[-_]US/i.test(v.lang)) ||
              vs.find(v => v.localService) || vs[0] || null;
  }
  if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

  function speak(text) {
    if (!synth) { toast('この端末は音声読み上げ非対応です'); return; }
    if (!text) return;
    synth.cancel();                      // 連打・連続移動時に溜めない
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (enVoice) u.voice = enVoice;
    u.rate = 0.9;
    synth.speak(u);
  }
  $('speakEn').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speak(w.en); };
  $('speakEx').onclick = e => { e.stopPropagation(); const w = list[idx]; if (w) speak(w.example); };
  $('autoSpeak').checked = state.autoSpeak;
  $('autoSpeak').onchange = e => { state.autoSpeak = e.target.checked; save(LS.state, state); };

  /* ---------- スマートウォッチ判定 ---------- */
  function applyWatchMode() {
    const forced = new URLSearchParams(location.search).get('watch');
    const watch = forced === '1' || (forced !== '0' && window.matchMedia('(max-width: 300px)').matches);
    document.documentElement.classList.toggle('watch', watch);
  }
  applyWatchMode();
  window.addEventListener('resize', applyWatchMode);

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
  function render() {
    const w = list[idx];
    $('empty').hidden = !!w;
    card.hidden = !w;
    $('done').disabled = !w;
    $('progress').textContent = w ? `${idx + 1} / ${list.length}` : '0 / 0';
    if (!w) return;
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
      const res = await fetch(`${CONFIG.API_URL}?token=${encodeURIComponent(CONFIG.TOKEN)}`);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      const pending = new Map(queue.map(q => [q.en, q.done]));
      words = j.words.map(w => pending.has(w.en) ? { ...w, done: pending.get(w.en) } : w);
      save(LS.words, words);
      const cur = list[idx] && list[idx].en;
      refreshSourceOptions();
      buildList(cur || state.en);
      render();
      if (manual) toast('同期しました');
    } catch (e) {
      toast(words.length ? 'オフライン: 保存データを表示中' : '読み込み失敗: ' + e.message);
    } finally { $('reload').classList.remove('spin'); }
  }

  $('reload').onclick = () => sync(true);
  window.addEventListener('online', () => flushQueue());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushQueue(); });

  /* ---------- 起動: キャッシュで即表示 → 裏で同期 ---------- */
  refreshSourceOptions();
  buildList(state.en);
  render();
  sync(false);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
