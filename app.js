(() => {
  'use strict';
  const LS = { words: 'wc_words', state: 'wc_state', queue: 'wc_queue' };
  const $ = id => document.getElementById(id);
  const card = $('card');

  let words = load(LS.words, []);              // 全単語
  let state = load(LS.state, { en: null, unlearnedOnly: true });
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

  /* ---------- 表示 ---------- */
  function buildList(keepEn) {
    list = state.unlearnedOnly ? words.filter(w => !w.done) : words.slice();
    const i = keepEn ? list.findIndex(w => w.en === keepEn) : -1;
    idx = i >= 0 ? i : Math.min(idx, Math.max(list.length - 1, 0));
  }

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
    $('example').textContent = w.example;
    $('meta').textContent = [w.source && `出典: ${w.source}`, w.note].filter(Boolean).join('\n');
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
      setTimeout(() => { card.classList.remove('slide-in'); busy = false; }, 200);
    }, 150);
  }

  /* ---------- タップ / スワイプ ---------- */
  let sx = 0, sy = 0, dx = 0, tracking = false, moved = false;
  const stage = $('stage');
  stage.addEventListener('pointerdown', e => {
    if (busy) return;
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
    if (w.done && state.unlearnedOnly) {
      toast('覚えた！');
      card.classList.remove('flipped');
      list.splice(idx, 1);
      if (idx >= list.length) idx = Math.max(list.length - 1, 0);
      render();
    } else {
      toast(w.done ? '覚えた！' : '未学習に戻しました');
      render();
    }
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
      buildList(cur || state.en);
      render();
      if (manual) toast('同期しました');
    } catch (e) {
      toast(words.length ? 'オフライン: 保存データを表示中' : '読み込み失敗: ' + e.message);
    } finally { $('reload').classList.remove('spin'); }
  }

  $('reload').onclick = () => sync(true);
  $('unlearnedOnly').checked = state.unlearnedOnly;
  $('unlearnedOnly').onchange = e => {
    state.unlearnedOnly = e.target.checked;
    const cur = list[idx] && list[idx].en;
    card.classList.remove('flipped');
    buildList(cur); render();
  };
  window.addEventListener('online', () => flushQueue());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushQueue(); });

  /* ---------- 起動: キャッシュで即表示 → 裏で同期 ---------- */
  buildList(state.en);
  render();
  sync(false);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
