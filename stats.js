(() => {
  'use strict';
  const { LS, load, save } = WC;
  const $ = id => document.getElementById(id);
  const GOAL = CONFIG.DAILY_GOAL_WORDS || 20;     // 1日の目標語数
  const WEEKS = 20;                               // 草の表示週数

  let summary = load(LS.summary, { days: [], quotes: [] });
  let appFilter = load(LS.metric, 'all');         // all | english | other
  if (['all', 'english', 'other'].indexOf(appFilter) < 0) appFilter = 'all';
  let selected = null;

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------- 日別データ（サーバー集計 + 未送信分） ---------- */
  // m[day] = { words, nw, rv, ok, again, engSec, swipes, otherSec }
  function buildDayMap() {
    const m = {};
    const get = d => m[d] || (m[d] = { words: 0, nw: 0, rv: 0, ok: 0, again: 0, engSec: 0, swipes: 0, otherSec: 0 });
    (summary.days || []).forEach(r => {
      const o = get(r.day);
      if (r.app === 'english') {
        o.words += r.words; o.nw += r.new; o.rv += r.review; o.ok += r.remembered; o.again += r.again;
        o.engSec += r.active_sec; o.swipes += r.swipes;
      } else {
        o.otherSec += r.active_sec;
      }
    });
    // まだサーバーに届いていない記録も反映（オフラインでも今日の分が見える）
    WC.getQueue().forEach(q => {
      const o = get(q.day || WC.today());
      if (q.kind === 'review') {
        o.words++;
        if (q.isNew) o.nw++;
        if (q.isReview) o.rv++;
        if (q.result === 'remembered') o.ok++; else o.again++;
      } else if (q.kind === 'session') {
        o.engSec += +q.activeSec || 0; o.swipes += +q.swipes || 0;
      }
    });
    return m;
  }

  // 英語の「活動分」は、操作時間と、1語0.5分換算の長い方（短時間で多く覚えた日も正しく評価）
  const engMin = o => o ? Math.max(o.engSec / 60, o.words * 0.5) : 0;
  const othMin = o => o ? o.otherSec / 60 : 0;
  const minutesOf = (o, f) => f === 'english' ? engMin(o) : f === 'other' ? othMin(o) : engMin(o) + othMin(o);
  // 連続日数の判定: 1語以上、または1分以上の学習・運動があった日
  const isActive = o => !!o && (o.words > 0 || o.engSec >= 60 || o.otherSec >= 60);
  const level = m => m < 1 ? 0 : m < 10 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4;
  const fmtMin = m => String(Math.round(m));

  /* ---------- ストリーク ---------- */
  function calcStreak(map, t) {
    let day = isActive(map[t]) ? t : WC.addDays(t, -1), n = 0;
    while (isActive(map[day])) { n++; day = WC.addDays(day, -1); }
    // 最長連続
    const days = Object.keys(map).filter(d => isActive(map[d])).sort();
    let best = 0, run = 0, prev = null;
    days.forEach(d => {
      run = (prev && WC.diffDays(prev, d) === 1) ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    return { current: n, best: best, todayDone: isActive(map[t]) };
  }

  /* ---------- 描画 ---------- */
  function render() {
    const t = WC.today();
    const map = buildDayMap();
    const today = map[t];

    // ストリーク
    const st = calcStreak(map, t);
    $('streakNum').textContent = st.current;
    $('flame').classList.toggle('on', st.current > 0);
    $('streakSub').textContent = st.current === 0 ? '今日から始めよう'
      : st.todayDone ? '今日も達成 ✓' : '今日やると +1 日';

    // 今日の進捗リング（語数 / 目標）
    const words = today ? today.words : 0;
    $('ringNum').textContent = words;
    $('ringGoal').textContent = '/ ' + GOAL + '語';
    const frac = Math.min(1, words / GOAL);
    $('ringFg').style.strokeDashoffset = String(326.73 * (1 - frac));
    document.querySelector('.ring-wrap').classList.toggle('full', words >= GOAL);

    // 数値カード
    $('stToday').textContent = fmtMin(minutesOf(today, 'all'));
    const weekStart = WC.addDays(t, -WC.dayOfWeek(t));        // 日曜始まり
    let ww = 0, wm = 0;
    for (let i = 0; i < 7; i++) {
      const o = map[WC.addDays(weekStart, i)];
      if (o) { ww += o.words; wm += minutesOf(o, 'all'); }
    }
    $('stWeekWords').textContent = ww;
    $('stWeekMin').textContent = fmtMin(wm);
    $('stBest').textContent = st.best;

    renderHeatmap(map, t);
    renderWords(t);

    document.querySelectorAll('#appSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === appFilter));
  }

  function renderHeatmap(map, t) {
    const hm = $('heatmap');
    hm.className = 'hm ' + appFilter;
    document.querySelector('.hm-legend').className = 'hm-legend ' + appFilter;
    const start = WC.addDays(t, -WC.dayOfWeek(t) - (WEEKS - 1) * 7);   // 先頭の日曜
    let html = '';
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = WC.addDays(start, i);
      if (d > t) { html += '<div class="future"></div>'; continue; }
      const lv = level(minutesOf(map[d], appFilter));
      html += `<div class="lv${lv}${d === t ? ' today' : ''}${d === selected ? ' sel' : ''}" data-day="${d}"></div>`;
    }
    hm.innerHTML = html;
    showDetail(map, selected || t);
  }

  function showDetail(map, day) {
    const o = map[day];
    const el = $('detail');
    if (!o || (!isActive(o) && !o.words && !o.engSec && !o.otherSec)) {
      el.innerHTML = `<b>${WC.shortDay(day)}</b>　記録なし`;
      return;
    }
    const parts = [`<b>${WC.shortDay(day)}</b>`];
    parts.push(`英語 <b>${o.words}</b>語（新規 ${o.nw}・復習 ${o.rv}／覚えた ${o.ok}・まだ ${o.again}）　<b>${fmtMin(engMin(o))}</b>分　スワイプ ${o.swipes}回`);
    if (o.otherSec) parts.push(`運動 <b>${fmtMin(othMin(o))}</b>分`);
    el.innerHTML = parts.join('<br>');
  }

  // 単語の状況は、カード画面が保存したキャッシュから集計
  function renderWords(t) {
    const words = load(LS.words, []);
    const arr = Array.isArray(words) ? words : [];
    let due = 0, nw = 0, done = 0;
    arr.forEach(w => {
      const reps = +w.reps || 0;
      if (w.done) done++;
      if (reps === 0 && !w.done) nw++;
      else if (reps > 0 && w.due && w.due <= t) due++;
    });
    $('wDue').textContent = arr.length ? due : '-';
    $('wNew').textContent = arr.length ? nw : '-';
    $('wDone').textContent = arr.length ? done : '-';
    $('wTotal').textContent = arr.length ? arr.length : '-';
  }

  /* ---------- 操作 ---------- */
  $('heatmap').addEventListener('click', e => {
    const d = e.target.dataset && e.target.dataset.day;
    if (!d) return;
    selected = d;
    document.querySelectorAll('#heatmap .sel').forEach(x => x.classList.remove('sel'));
    e.target.classList.add('sel');
    showDetail(buildDayMap(), d);
  });
  document.querySelectorAll('#appSeg button').forEach(b => b.onclick = () => {
    appFilter = b.dataset.v; save(LS.metric, appFilter); render();
  });

  async function sync(manual) {
    $('reload').classList.add('spin');
    try {
      try { await WC.flush(); } catch (e) { /* オフライン等は後で再送 */ }
      const j = await WC.apiGet({ action: 'summary' });
      if (!j.ok) throw new Error(j.error || 'API error');
      summary = { days: j.days || [], quotes: j.quotes || [] };
      save(LS.summary, summary);
      $('foot').textContent = '更新: ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      showQuote();
      render();
      if (manual) toast('更新しました');
    } catch (e) {
      console.error('stats sync', e);
      $('foot').textContent = 'オフライン: 保存データを表示中（' + ((e && e.message) || e) + '）';
      if (manual) toast('更新に失敗しました');
    } finally { $('reload').classList.remove('spin'); }
  }
  $('reload').onclick = () => sync(true);
  window.addEventListener('online', () => sync(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(false); });

  function showQuote() { WC.fillQuote(WC.quoteOfDay(WC.today(), summary.quotes)); }

  /* ---------- 起動: キャッシュで即表示 → 裏で更新 ---------- */
  try { showQuote(); render(); } catch (e) { console.error('init', e); }
  sync(false);
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.error('SW', e));
  } catch (e) { /* 未対応でも無視 */ }
})();

