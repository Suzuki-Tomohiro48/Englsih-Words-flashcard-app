/**
 * 英単語カード API (Google Apps Script)
 *
 * ■ 単語シート（先頭シート or SHEET_NAME）
 *   A 英単語 / B 発音記号 / C 日本語 / D 暗記状況(Yes/No) / E 出典 / F 例文 / G 備考 / H 開始秒(任意)
 *   I 段階 / J 次回出題日 / K 最終学習日 / L 連続正解 / M 誤答数 / N 学習回数   ← 間隔反復用（自動で見出しを作成）
 *
 * ■ ActivityLog シート（自動作成・追記専用）
 *   event_id / timestamp / day / app / type / ref / value / duration_sec / meta / device
 *
 * ■ DailySummary シート（自動作成・1日×アプリごとに1行）
 *   day / app / words / new / review / remembered / again / active_sec / swipes / updated
 *
 * ■ 名言 シート（任意・手動作成）
 *   A 名言 / B 日本語訳 / C 人物 / D 出典 / E 言語コード(en, ja, es …)
 *
 * GET  ?action=words   単語一覧（既定）
 * GET  ?action=summary 日別集計＋名言シート
 * GET  ?action=widget  KWGT等向けの軽量サマリー
 * POST {items:[...]}   review / session / activity / status をまとめて記録
 */
const SPREADSHEET_ID = '1rc_XBOocKZBGJPWeiwlwJFfhpx_0ietrTcNHbIIoQiA';
const SHEET_NAME = '';      // 空なら先頭シート（ログ用シートは除外）
const DONE_VALUE = 'Yes';   // 覚えた
const TODO_VALUE = 'No';    // 未学習
const TOKEN = '';           // 任意: 設定すると config.js の TOKEN と一致しないと拒否
const DAY_START_HOUR = 4;   // 1日の区切り（午前4時）。config.js と合わせる

const SRS_COL = 9;          // I列から6列を間隔反復用に使う
const SRS_HEADERS = ['段階', '次回出題日', '最終学習日', '連続正解', '誤答数', '学習回数'];
const LOG_SHEET = 'ActivityLog';
const LOG_HEADERS = ['event_id', 'timestamp', 'day', 'app', 'type', 'ref', 'value', 'duration_sec', 'meta', 'device'];
const SUM_SHEET = 'DailySummary';
const SUM_FIELDS = ['words', 'new', 'review', 'remembered', 'again', 'active_sec', 'swipes'];
const SUM_HEADERS = ['day', 'app'].concat(SUM_FIELDS, ['updated']);
const QUOTE_SHEET = '名言';
const SYSTEM_SHEETS = [LOG_SHEET, SUM_SHEET, QUOTE_SHEET];

/* ======================= 共通 ======================= */
let ss__ = null;
function ss_() {
  if (!ss__) ss__ = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return ss__;
}
function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Tokyo'; }

function getSheet_() {
  const ss = ss_();
  if (SHEET_NAME) return ss.getSheetByName(SHEET_NAME);
  return ss.getSheets().filter(s => SYSTEM_SHEETS.indexOf(s.getName()) < 0)[0] || ss.getSheets()[0];
}

function getOrCreate_(name, headers, textCols) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 日付列を文字列として保持（自動で日付型に変換されるのを防ぐ）
    (textCols || []).forEach(c => sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'));
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function authorized_(token) { return !TOKEN || token === TOKEN; }
function isDone_(v) { return String(v).trim().toLowerCase() === DONE_VALUE.toLowerCase(); }
function num_(v) { return Number(v) || 0; }

function todayStr_() {
  return Utilities.formatDate(new Date(Date.now() - DAY_START_HOUR * 3600000), tz_(), 'yyyy-MM-dd');
}
function addDays_(day, n) {
  const p = day.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)), 'UTC', 'yyyy-MM-dd');
}
/** Date / "2026/10/14" / "2026-10-14" → "2026-10-14"。それ以外は '' */
function toDay_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz || tz_(), 'yyyy-MM-dd');
  const m = String(v || '').trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** I〜N列の見出しを用意。別の用途で使われていたら止める */
function ensureSrsColumns_(sheet) {
  const need = SRS_COL + SRS_HEADERS.length - 1;
  if (sheet.getMaxColumns() < need) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
  const head = sheet.getRange(1, SRS_COL, 1, SRS_HEADERS.length).getDisplayValues()[0];
  if (head.join('') === SRS_HEADERS.join('')) return;
  head.forEach((h, i) => {
    if (h && h !== SRS_HEADERS[i]) throw new Error('列' + (SRS_COL + i) + 'は「' + h + '」として使用中です。SRS_COL を空いている列に変更してください');
  });
  sheet.getRange(1, SRS_COL, 1, SRS_HEADERS.length).setValues([SRS_HEADERS]).setFontWeight('bold');
  sheet.getRange(1, SRS_COL + 1, sheet.getMaxRows(), 2).setNumberFormat('@');   // 次回出題日・最終学習日
}

/* ======================= GET ======================= */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!authorized_(p.token)) return json_({ ok: false, error: 'unauthorized' });
    const action = p.action || 'words';
    if (action === 'summary') return json_(getSummary_());
    if (action === 'widget') return json_(getWidget_());
    return json_(getWords_());
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function getWords_() {
  const sheet = getSheet_();
  ensureSrsColumns_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, words: [] };
  const n = last - 1;
  const tz = tz_();
  const values = sheet.getRange(2, 1, n, 8).getDisplayValues();          // A〜H 見た目どおり
  const srs = sheet.getRange(2, SRS_COL, n, SRS_HEADERS.length).getValues();
  const richE = sheet.getRange(2, 5, n, 1).getRichTextValues();           // 出典セルのリンク
  const formE = sheet.getRange(2, 5, n, 1).getFormulas();                 // =HYPERLINK() 対応

  migrateLegacy_(sheet, values, srs);

  const words = [];
  values.forEach((r, i) => {
    if (!String(r[0]).trim()) return;
    const srcText = String(r[4]);
    let url = '';
    const rt = richE[i][0];
    if (rt) {
      url = rt.getLinkUrl() || '';
      if (!url) rt.getRuns().some(run => { url = run.getLinkUrl() || ''; return !!url; });
    }
    if (!url && formE[i][0]) {
      const m = String(formE[i][0]).match(/HYPERLINK\(\s*"([^"]+)"/i);
      if (m) url = m[1];
    }
    if (!url && /^https?:\/\//i.test(srcText.trim())) url = srcText.trim();
    const s = srs[i];
    words.push({
      row: i + 2,
      en: String(r[0]),
      ipa: String(r[1]),
      ja: String(r[2]),
      done: isDone_(r[3]),
      source: srcText,
      sourceUrl: url,
      example: String(r[5]),
      note: String(r[6]),
      startSec: String(r[7]).trim(),
      stage: num_(s[0]),
      due: toDay_(s[1], tz),
      last: toDay_(s[2], tz),
      streak: num_(s[3]),
      wrong: num_(s[4]),
      reps: num_(s[5])
    });
  });
  return { ok: true, words: words };
}

/**
 * 既に「Yes」だが間隔反復の情報が無い単語を、段階1・次回出題日を今後14日に分散して登録する。
 * （一斉に復習が戻ってくるのを防ぐ。初回の GET 時に自動で1度だけ実行される）
 */
function migrateLegacy_(sheet, values, srs) {
  const t = todayStr_();
  let k = 0, changed = false;
  values.forEach((r, i) => {
    if (!String(r[0]).trim()) return;
    if (isDone_(r[3]) && !num_(srs[i][5]) && !num_(srs[i][0])) {
      srs[i][0] = 1;                          // 段階
      srs[i][1] = addDays_(t, 1 + (k++ % 14)); // 次回出題日
      srs[i][3] = 1;                          // 連続正解
      srs[i][5] = 1;                          // 学習回数
      changed = true;
    }
  });
  if (!changed) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { sheet.getRange(2, SRS_COL, srs.length, SRS_HEADERS.length).setValues(srs); }
  finally { lock.releaseLock(); }
}

function readSummaryRows_() {
  const sh = ss_().getSheetByName(SUM_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = tz_();
  return sh.getRange(2, 1, sh.getLastRow() - 1, SUM_HEADERS.length).getValues().map(r => {
    const o = { day: toDay_(r[0], tz), app: String(r[1]) };
    SUM_FIELDS.forEach((f, k) => { o[f] = num_(r[2 + k]); });
    return o;
  }).filter(o => o.day);
}

function readQuotes_() {
  const sh = ss_().getSheetByName(QUOTE_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues()
    .filter(r => String(r[0]).trim())
    .map(r => ({ t: r[0], ja: r[1], by: r[2], src: r[3], lang: r[4] || '' }));
}

function getSummary_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('summary');
  if (hit) return JSON.parse(hit);
  const res = { ok: true, today: todayStr_(), days: readSummaryRows_(), quotes: readQuotes_() };
  try { cache.put('summary', JSON.stringify(res), 300); } catch (e) { /* 大きすぎる場合はキャッシュしない */ }
  return res;
}

/** KWGT 等のウィジェット向け: 連続日数と今日の量だけを返す */
function getWidget_() {
  const t = todayStr_();
  const m = {};
  getSummary_().days.forEach(d => {
    const o = m[d.day] || (m[d.day] = { words: 0, eng: 0, other: 0 });
    if (d.app === 'english') { o.words += d.words; o.eng += Math.max(d.active_sec / 60, d.words * 0.5); }
    else o.other += d.active_sec / 60;
  });
  const act = day => !!m[day] && (m[day].words > 0 || m[day].eng > 0 || m[day].other > 0);
  let day = act(t) ? t : addDays_(t, -1), streak = 0;
  while (act(day)) { streak++; day = addDays_(day, -1); }
  const td = m[t] || { words: 0, eng: 0, other: 0 };
  const minutes = Math.round(td.eng + td.other);
  return {
    ok: true, day: t, streak: streak, words: td.words, minutes: minutes,
    englishMin: Math.round(td.eng), workoutMin: Math.round(td.other),
    text: '🔥' + streak + '日 | 今日 ' + td.words + '語 ' + minutes + '分'
  };
}

/* ======================= POST ======================= */
/**
 * body = { token, items: [ {kind:'review'|'session'|'activity'|'status', id, day, ...}, ... ] }
 * 旧形式 { row, en, done } にも対応。
 * 各 item の id で重複を無視するので、再送されても二重計上されない。
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    if (!authorized_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    lock.waitLock(20000);
    const items = Array.isArray(body.items) ? body.items : [Object.assign({ kind: 'status' }, body)];
    const res = processItems_(items);
    CacheService.getScriptCache().remove('summary');
    return json_(Object.assign({ ok: true }, res));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function processItems_(items) {
  const cache = CacheService.getScriptCache();
  const tz = tz_();
  const now = new Date();
  const keys = items.filter(it => it.id).map(it => 'ev_' + it.id);
  const seen = keys.length ? cache.getAll(keys) : {};

  let sheet = null, colA = null;
  function wordSheet() { if (!sheet) { sheet = getSheet_(); ensureSrsColumns_(sheet); } return sheet; }
  function findRow(row, en) {
    const sh = wordSheet();
    row = Number(row);
    if (row >= 2 && String(sh.getRange(row, 1).getValue()) === String(en)) return row;
    if (!colA) colA = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (let i = 1; i < colA.length; i++) if (String(colA[i][0]) === String(en)) return i + 1;
    return 0;
  }

  const logs = [], deltas = {}, failed = [], errors = [], doneKeys = {};
  items.forEach(it => {
    try {
      if (it.id && seen['ev_' + it.id]) return;                 // 再送された重複
      const day = toDay_(it.day, tz) || todayStr_();
      const dev = String(it.device || '');
      if (it.kind === 'status' || it.kind === 'review') {
        const row = findRow(it.row, it.en);
        if (row) {                                               // 単語が削除済みなら破棄
          const sh = wordSheet();
          sh.getRange(row, 4).setValue(it.done ? DONE_VALUE : TODO_VALUE);
          if (it.kind === 'review') {
            const s = it.srs || {};
            sh.getRange(row, SRS_COL, 1, SRS_HEADERS.length)
              .setValues([[num_(s.stage), s.due || '', s.last || '', num_(s.streak), num_(s.wrong), num_(s.reps)]]);
          }
        }
        if (it.kind === 'review') {
          const ok = it.result === 'remembered';
          logs.push([it.id, now, day, 'english', ok ? 'remembered' : 'again', it.en, 1, '',
            JSON.stringify({ stage: num_((it.srs || {}).stage), isNew: !!it.isNew, isReview: !!it.isReview }), dev]);
          addDelta_(deltas, day, 'english', {
            words: 1, new: it.isNew ? 1 : 0, review: it.isReview ? 1 : 0, remembered: ok ? 1 : 0, again: ok ? 0 : 1
          });
        }
      } else if (it.kind === 'session') {
        logs.push([it.id, now, day, 'english', 'session', '', num_(it.cards), num_(it.activeSec),
          JSON.stringify({ swipes: num_(it.swipes), flips: num_(it.flips), speaks: num_(it.speaks) }), dev]);
        addDelta_(deltas, day, 'english', { active_sec: num_(it.activeSec), swipes: num_(it.swipes) });
      } else if (it.kind === 'activity') {                       // 将来の運動アプリ等
        const app = String(it.app || 'workout');
        logs.push([it.id, now, day, app, String(it.type || 'activity'), String(it.ref || ''), num_(it.value),
          num_(it.durationSec), JSON.stringify(it.meta || {}), dev]);
        addDelta_(deltas, day, app, { active_sec: num_(it.durationSec) });
      } else {
        throw new Error('unknown kind: ' + it.kind);
      }
      if (it.id) doneKeys['ev_' + it.id] = '1';
    } catch (err) {
      failed.push(it.id);
      errors.push(String(err));
    }
  });

  if (logs.length) {
    const lg = getOrCreate_(LOG_SHEET, LOG_HEADERS, [1, 3]);
    lg.getRange(lg.getLastRow() + 1, 1, logs.length, LOG_HEADERS.length).setValues(logs);
  }
  if (Object.keys(deltas).length) applyDeltas_(deltas);
  if (Object.keys(doneKeys).length) cache.putAll(doneKeys, 21600);   // 6時間は重複を無視
  return { failed: failed, errors: errors };
}

function addDelta_(deltas, day, app, add) {
  const key = day + '|' + app;
  const d = deltas[key] || (deltas[key] = { day: day, app: app });
  Object.keys(add).forEach(k => { d[k] = (d[k] || 0) + (Number(add[k]) || 0); });
}

function applyDeltas_(deltas) {
  const sh = getOrCreate_(SUM_SHEET, SUM_HEADERS, [1]);
  const tz = tz_();
  const last = sh.getLastRow();
  const data = last > 1 ? sh.getRange(2, 1, last - 1, SUM_HEADERS.length).getValues() : [];
  const index = {};
  data.forEach((r, i) => { r[0] = toDay_(r[0], tz); index[r[0] + '|' + r[1]] = i; });
  const now = new Date();
  Object.keys(deltas).forEach(key => {
    const d = deltas[key];
    let i = index[key];
    if (i == null) {
      const r = [d.day, d.app];
      SUM_FIELDS.forEach(() => r.push(0));
      r.push(now);
      data.push(r);
      i = index[key] = data.length - 1;
    }
    const r = data[i];
    SUM_FIELDS.forEach((f, k) => { r[2 + k] = num_(r[2 + k]) + num_(d[f]); });
    r[2 + SUM_FIELDS.length] = now;
  });
  if (data.length) sh.getRange(2, 1, data.length, SUM_HEADERS.length).setValues(data);
}
