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

  // 英語の勉強時間（分）は、ボタン計測およびCSV引き継ぎで記録した実測時間のみを使用
  const engMin = o => o ? (o.engSec / 60) : 0;
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

    // 数値カード & 勉強時間サマリー
    $('stToday').textContent = fmtMin(minutesOf(today, 'all'));
    const weekStart = WC.addDays(t, -WC.dayOfWeek(t));        // 日曜始まり
    let ww = 0, wm = 0, weekEngSec = 0, totalEngSec = 0;
    for (let i = 0; i < 7; i++) {
      const o = map[WC.addDays(weekStart, i)];
      if (o) { ww += o.words; wm += minutesOf(o, 'all'); weekEngSec += o.engSec; }
    }
    Object.keys(map).forEach(d => { totalEngSec += map[d].engSec || 0; });
    $('stWeekWords').textContent = ww;
    $('stWeekMin').textContent = fmtMin(wm);
    $('stBest').textContent = st.best;
    if ($('tmToday')) $('tmToday').textContent = WC.fmtHm(today ? today.engSec : 0);
    if ($('tmWeek')) $('tmWeek').textContent = WC.fmtHm(weekEngSec);
    if ($('tmTotal')) $('tmTotal').textContent = WC.fmtHm(totalEngSec);

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
      const cachedWords = load(LS.words, []);
      const needWords = manual || !Array.isArray(cachedWords) || !cachedWords.length || !('reps' in cachedWords[0]);
      const [j, wj] = await Promise.all([
        WC.apiGet({ action: 'summary' }),
        needWords ? WC.apiGet({ action: 'words' }).catch(() => null) : Promise.resolve(null)
      ]);
      if (!j.ok) throw new Error(j.error || 'API error');
      if (wj && wj.ok && Array.isArray(wj.words)) save(LS.words, wj.words);
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

  /* ---------- 勉強時間タイマー & Simple Time Tracker CSV引き継ぎ ---------- */
  function renderTimer() {
    if (!$('timerClock')) return;
    const on = !!WC.getTimer();
    const sec = WC.timerElapsed();
    $('timerClock').textContent = WC.fmtClock(sec);
    $('timerClock').classList.toggle('running', on);
    $('timerToggle').classList.toggle('running', on);
    $('timerToggle').textContent = on ? '⏹ 停止して記録' : '▶ 計測を開始';
    $('timerCancel').hidden = !on;
  }
  if ($('timerToggle')) {
    $('timerToggle').onclick = () => {
      if (WC.getTimer()) {
        const sec = WC.stopTimer();
        renderTimer();
        render();
        toast(sec > 0 ? ('⏱ ' + WC.fmtHm(sec) + ' を記録しました') : '計測を終了しました');
      } else {
        WC.startTimer();
        renderTimer();
        toast('⏱ 計測を開始しました');
      }
    };
    $('timerCancel').onclick = () => {
      WC.cancelTimer();
      renderTimer();
      toast('計測を破棄しました');
    };
  }
  setInterval(renderTimer, 1000);
  window.addEventListener('storage', e => { if (!e.key || e.key === LS.timer) renderTimer(); });

  // RFC4180準拠の簡易CSVパーサ（カンマ・タブ自動判定）
  function parseCsvRows(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = (text.split(/\r?\n/)[0] || '');
    const delim = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === delim) {
        row.push(cur.trim()); cur = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur.trim()); cur = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur.trim()); if (row.some(c => c !== '')) rows.push(row); }
    return rows;
  }

  function parseDateTimeMs(s) {
    if (!s) return NaN;
    s = String(s).trim().replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, '$1-$2-$3');
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0).getTime();
    }
    return Date.parse(s);
  }

  function parseDurationSec(durStr, minStr, startMs, endMs) {
    if (durStr) {
      const hm = String(durStr).trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
      if (hm) return hm[3] != null ? (+hm[1] * 3600 + +hm[2] * 60 + +hm[3]) : (+hm[1] * 60 + +hm[2]);
    }
    if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) return Math.round((endMs - startMs) / 1000);
    if (minStr != null && minStr !== '' && !isNaN(Number(minStr))) return Math.round(Number(minStr) * 60);
    if (durStr != null && durStr !== '' && !isNaN(Number(durStr))) return Math.round(Number(durStr) * 60);
    return 0;
  }

  // Simple Time Tracker 等のCSVから { name, spans: [{day, sec}] } の一覧を抽出
  function extractRecordsFromCsv(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    const head = rows[0].map(h => h.toLowerCase());
    const findCol = re => head.findIndex(h => re.test(h));
    let cName = findCol(/activity\s*name|^activity$|^name$|項目|カテゴリ|アクティビティ|名前|種別/);
    let cStart = findCol(/time\s*started|start\s*time|^started$|^start$|開始|日付|^date$/);
    let cEnd = findCol(/time\s*ended|end\s*time|^ended$|^end$|終了/);
    let cDur = findCol(/^duration$|時間|長さ|経過/);
    let cMin = findCol(/duration\s*minutes|minutes|分/);

    // ヘッダーが無い・別名の場合の自動推定
    const sample = rows[1] || [];
    if (cStart < 0) cStart = sample.findIndex(v => /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(v));
    if (cEnd < 0 && cStart >= 0 && /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(sample[cStart + 1] || '')) cEnd = cStart + 1;
    if (cDur < 0) cDur = sample.findIndex(v => /^\d{1,3}:\d{2}(:\d{2})?$/.test(v));
    if (cName < 0) cName = cStart === 0 ? -1 : 0;

    const recs = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = (cName >= 0 && r[cName]) ? r[cName] : '英語';
      const startStr = cStart >= 0 ? r[cStart] : '';
      const endStr = cEnd >= 0 ? r[cEnd] : '';
      const startMs = parseDateTimeMs(startStr);
      const endMs = parseDateTimeMs(endStr);
      const sec = parseDurationSec(cDur >= 0 ? r[cDur] : '', cMin >= 0 ? r[cMin] : '', startMs, endMs);
      if (sec <= 0 || isNaN(startMs)) continue;
      const hasTime = /\d{1,2}:\d{2}/.test(startStr);
      const spans = hasTime
        ? WC.splitSpanByDay(startMs, (!isNaN(endMs) && endMs > startMs) ? endMs : (startMs + sec * 1000))
        : [{ day: WC.dayAt(startMs + 12 * 3600e3), sec: sec }];
      recs.push({ name: name, spans: spans, sec: sec });
    }
    return recs;
  }

  let pendingCsvRecs = [];
  function openCsvPreview(recs) {
    pendingCsvRecs = recs;
    const byAct = {};
    recs.forEach(r => {
      const a = byAct[r.name] || (byAct[r.name] = { count: 0, sec: 0 });
      a.count++; a.sec += r.sec;
    });
    const names = Object.keys(byAct);
    const hasEngKeyword = names.some(n => /英|eng|study|勉強|学習|単語|word|toeic|toefl|ielts/i.test(n));
    const actsEl = $('csvActs');
    actsEl.innerHTML = '';
    names.forEach(n => {
      const checked = names.length === 1 || !hasEngKeyword || /英|eng|study|勉強|学習|単語|word|toeic|toefl|ielts/i.test(n);
      const label = document.createElement('label');
      label.className = 'csv-act';
      const left = document.createElement('span');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = n; cb.checked = checked;
      cb.onchange = updateCsvPreview;
      left.appendChild(cb);
      left.appendChild(document.createTextNode(' ' + n));
      const right = document.createElement('small');
      right.textContent = `${WC.fmtHm(byAct[n].sec)} (${byAct[n].count}件)`;
      label.appendChild(left);
      label.appendChild(right);
      actsEl.appendChild(label);
    });
    $('csvBox').hidden = false;
    updateCsvPreview();
  }

  function getSelectedCsvDayMap() {
    const selectedNames = new Set(
      Array.from(document.querySelectorAll('#csvActs input:checked')).map(c => c.value)
    );
    const daySec = {};
    pendingCsvRecs.forEach(r => {
      if (!selectedNames.has(r.name)) return;
      r.spans.forEach(sp => { daySec[sp.day] = (daySec[sp.day] || 0) + sp.sec; });
    });
    return daySec;
  }

  function updateCsvPreview() {
    const daySec = getSelectedCsvDayMap();
    const days = Object.keys(daySec);
    const totalSec = days.reduce((s, d) => s + daySec[d], 0);
    $('csvPreview').textContent = days.length
      ? `対象: ${days.length}日分 ・ 合計 ${WC.fmtHm(totalSec)}`
      : '取り込む項目にチェックを入れてください';
    $('csvApply').disabled = !days.length;
  }

  if ($('csvBtn')) {
    $('csvBtn').onclick = () => { $('csvFile').value = ''; $('csvFile').click(); };
    $('csvCancel').onclick = () => { $('csvBox').hidden = true; pendingCsvRecs = []; };
    $('csvFile').onchange = async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.indexOf('\uFFFD') >= 0) {
          try { text = new TextDecoder('shift_jis').decode(buf); } catch (err) {}
        }
        const recs = extractRecordsFromCsv(text);
        if (!recs.length) { toast('CSVから日時・時間データを読み取れませんでした'); return; }
        openCsvPreview(recs);
      } catch (err) {
        console.error('CSV load', err);
        toast('CSVの読み込みに失敗しました');
      }
    };
    $('csvApply').onclick = () => {
      const daySec = getSelectedCsvDayMap();
      const imported = load(LS.imported, {});
      let addedDays = 0, addedSec = 0;
      Object.keys(daySec).sort().forEach(day => {
        const target = Math.round(daySec[day]);
        const prev = imported[day] || 0;
        const delta = target - prev;
        if (delta <= 0) return;
        imported[day] = target;
        addedDays++;
        addedSec += delta;
        WC.enqueue({
          kind: 'session', id: WC.uid(), day: day, activeSec: delta,
          cards: 0, swipes: 0, flips: 0, speaks: 0, device: 'csv-import'
        });
      });
      save(LS.imported, imported);
      $('csvBox').hidden = true;
      pendingCsvRecs = [];
      render();
      if (!addedDays) {
        toast('すでに同じデータが取り込み済みです');
        return;
      }
      toast(`${addedDays}日分（${WC.fmtHm(addedSec)}）を引き継ぎました`);
      WC.flush().then(() => sync(false)).catch(() => {});
    };
  }

  function showQuote() { WC.fillQuote(WC.quoteOfDay(WC.today(), summary.quotes)); }

  /* ---------- 起動: キャッシュで即表示 → 裏で更新 ---------- */
  try { showQuote(); renderTimer(); render(); } catch (e) { console.error('init', e); }
  sync(false);
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.error('SW', e));
  } catch (e) { /* 未対応でも無視 */ }
})();

