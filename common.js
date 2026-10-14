/* 単語カード / 学習記録 共通モジュール（日付・保存・API・送信キュー・音声・名言） */
(function () {
  'use strict';
  const C = window.CONFIG || {};
  const DAY_START = C.DAY_START_HOUR != null ? C.DAY_START_HOUR : 4;

  const LS = {
    words: 'wc_words', state: 'wc_state', queue: 'wc_queue', daily: 'wc_daily',
    summary: 'wc_summary', quoteSeen: 'wc_quote_seen', device: 'wc_device', metric: 'wc_stats_metric'
  };
  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存不可でも続行 */ } }

  /* ---------- 日付（午前4時区切り / "YYYY-MM-DD" 文字列で扱う） ---------- */
  const pad = n => (n < 10 ? '0' : '') + n;
  const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parts = day => day.split('-').map(Number);
  function today() { return fmt(new Date(Date.now() - DAY_START * 3600e3)); }
  function addDays(day, n) {
    const p = parts(day), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function diffDays(a, b) { const pa = parts(a), pb = parts(b); return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5); }
  function dayOfWeek(day) { const p = parts(day); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); } // 0=日
  function shortDay(day) { const p = parts(day); return p[1] + '/' + p[2] + '(' + '日月火水木金土'[dayOfWeek(day)] + ')'; }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function deviceId() { let d = load(LS.device, null); if (!d) { d = uid(); save(LS.device, d); } return d; }
  function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- API ---------- */
  async function fetchT(url, opt, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 20000) : null;
    try { return await fetch(url, Object.assign({}, opt, ctrl ? { signal: ctrl.signal } : {})); }
    catch (e) { throw (e && e.name === 'AbortError') ? new Error('タイムアウト') : e; }
    finally { if (timer) clearTimeout(timer); }
  }
  async function parseJson(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('JSONではない応答: ' + text.slice(0, 80)); }
  }
  async function apiGet(params) {
    const q = Object.assign({ token: C.TOKEN || '' }, params || {});
    const qs = Object.keys(q).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
    return parseJson(await fetchT(C.API_URL + '?' + qs, {}, 20000));
  }
  async function apiPost(body, keepalive) {
    const payload = JSON.stringify(Object.assign({ token: C.TOKEN || '' }, body));
    return parseJson(await fetchT(C.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // プリフライト回避
      body: payload,
      keepalive: !!keepalive && payload.length < 60000            // 画面を閉じる時も送り切る
    }, 30000));
  }

  /* ---------- 送信キュー（オフラインでも記録し、後でまとめて送る） ---------- */
  function getQueue() {
    let q = load(LS.queue, []);
    if (!Array.isArray(q)) q = [];
    let changed = false;
    q = q.map(it => {                       // 旧形式 {row,en,done} を変換
      if (it && it.kind && it.id) return it;
      changed = true;
      return Object.assign({ kind: 'status', id: uid() }, it);
    });
    if (changed) save(LS.queue, q);
    return q;
  }
  function enqueue(item) { const q = getQueue(); q.push(item); save(LS.queue, q); }

  let flushing = null;
  function flush(opts) {
    if (flushing) return flushing;
    flushing = (async () => {
      for (let guard = 0; guard < 20; guard++) {
        const q = getQueue();
        if (!q.length) return;
        if (navigator.onLine === false) throw new Error('オフライン');
        const batch = q.slice(0, 50);
        const j = await apiPost({ items: batch }, opts && opts.keepalive);
        if (!j.ok) throw new Error(j.error || 'API error');
        const failed = new Set(j.failed || []);
        const sent = new Set(batch.filter(b => !failed.has(b.id)).map(b => b.id));
        save(LS.queue, getQueue().filter(x => !sent.has(x.id)));
        if (failed.size) throw new Error('一部失敗: ' + (j.errors || []).join(' / '));
      }
    })();
    const p = flushing;
    p.then(() => { flushing = null; }, () => { flushing = null; });
    return p;
  }

  /* ---------- 音声（Web Speech API・端末内TTS・外部通信なし） ---------- */
  let synth = null;
  try {
    if (typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined') synth = window.speechSynthesis;
  } catch (e) { synth = null; }
  let voices = [];
  function loadVoices() { try { voices = synth ? (synth.getVoices() || []) : []; } catch (e) { voices = []; } }
  if (synth) { loadVoices(); try { synth.addEventListener('voiceschanged', loadVoices); } catch (e) { /* 古い実装 */ } }

  const PREF = { en: 'en-US', ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ko: 'ko-KR', zh: 'zh-CN' };
  const norm = l => String(l || '').toLowerCase().replace('_', '-');
  function voiceFor(base) {
    const pref = norm(PREF[base] || base);
    const vs = voices.filter(v => norm(v.lang).split('-')[0] === base);
    const exact = vs.filter(v => norm(v.lang) === pref);
    // 端末内(localService)の音声を優先
    return exact.find(v => v.localService) || exact[0] || vs.find(v => v.localService) || vs[0] || null;
  }

  // 日本語(ひらがな/カタカナ/漢字/全角記号)と英字を判定
  const RE_JA = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef\u3000-\u303f々ー]/;
  const RE_EN = /[A-Za-z]/;
  // 言語ごとの連続したかたまりに分割。数字・空白・ASCII記号は直前のかたまりに付ける
  function splitByLang(text) {
    const runs = [];
    let pending = '';
    for (const ch of String(text)) {
      const lang = RE_JA.test(ch) ? 'ja' : RE_EN.test(ch) ? 'en' : null;
      const last = runs[runs.length - 1];
      if (!lang) { if (last) last.text += ch; else pending += ch; continue; }
      if (last && last.lang === lang) last.text += ch;
      else runs.push({ lang: lang, text: (runs.length ? '' : pending) + ch });
    }
    return runs.filter(r => /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(r.text));
  }

  /** lang 省略/en/ja: 日英を自動で切り替え。es 等: その言語の音声で読む */
  function speak(text, lang) {
    try {
      if (!synth || !text) return;
      synth.cancel();                                  // 連打時に溜めない
      const base = norm(lang).split('-')[0];
      const runs = (!base || base === 'en' || base === 'ja') ? splitByLang(text) : [{ lang: base, text: String(text) }];
      runs.forEach(r => {                              // speak() を続けて呼ぶと順に再生される
        const u = new SpeechSynthesisUtterance(r.text);
        u.lang = PREF[r.lang] || r.lang;
        const v = voiceFor(r.lang);
        if (v) u.voice = v;
        u.rate = r.lang === 'en' ? 0.9 : 1.0;
        synth.speak(u);
      });
    } catch (e) { console.error('speech', e); }
  }

  /* ---------- 今日の名言（日付から決定。一巡するまで同じ名言は出ない） ---------- */
  function quoteOfDay(day, extra) {
    const list = (window.QUOTES || []).concat(Array.isArray(extra) ? extra : []).filter(q => q && q.t);
    if (!list.length) return null;
    const n = diffDays('2025-01-01', day);
    const cycle = Math.floor(n / list.length);
    const pos = ((n % list.length) + list.length) % list.length;
    const order = list.map((_, i) => i).sort((a, b) => hash(cycle + ':' + a) - hash(cycle + ':' + b));
    return list[order[pos]];
  }
  /** #qText / #qJa / #qBy / #qSpeak に名言を表示 */
  function fillQuote(q) {
    const $ = id => document.getElementById(id);
    if (!q || !$('qText')) return;
    $('qText').textContent = q.t;
    $('qText').setAttribute('lang', q.lang || '');
    $('qJa').textContent = q.ja || '';
    $('qJa').hidden = !q.ja;
    $('qBy').textContent = '— ' + q.by + (q.src ? '『' + q.src + '』' : '');
    const sp = $('qSpeak');
    if (sp) {
      sp.hidden = !synth;
      sp.onclick = e => { e.stopPropagation(); speak(q.t, q.lang); };
    }
  }

  window.WC = {
    LS, load, save,
    today, addDays, diffDays, dayOfWeek, shortDay, uid, deviceId, hash,
    apiGet, apiPost, getQueue, enqueue, flush,
    canSpeak: !!synth, speak, splitByLang,
    quoteOfDay, fillQuote
  };
})();

