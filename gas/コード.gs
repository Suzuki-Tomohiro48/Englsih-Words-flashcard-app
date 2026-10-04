/**
 * 英単語カード API (Google Apps Script)
 * シート列: A 英単語 / B 発音記号 / C 日本語 / D 暗記状況(Yes/No) / E 出典 / F 例文 / G 備考
 * 1行目はヘッダー、2行目以降がデータ。
 */
const SPREADSHEET_ID = '1rc_XBOocKZBGJPWeiwlwJFfhpx_0ietrTcNHbIIoQiA';
const SHEET_NAME = ''; // 空なら先頭シート。特定のシートを使う場合はシート名を入力
const DONE_VALUE = 'Yes';  // 覚えた
const TODO_VALUE = 'No';   // 未学習
const TOKEN = '';      // 任意: 設定すると web/config.js の TOKEN と一致しないと拒否

function getSheet_() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorized_(token) {
  return !TOKEN || token === TOKEN;
}

function isDone_(v) {
  return String(v).trim().toLowerCase() === DONE_VALUE.toLowerCase();
}

/** 全単語取得: GET ?token=xxx */
function doGet(e) {
  try {
    if (!authorized_(e && e.parameter && e.parameter.token)) return json_({ ok: false, error: 'unauthorized' });
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return json_({ ok: true, words: [] });
    const n = last - 1;
    // 見た目どおりの文字列を取得。H列(開始秒・任意)は存在すれば読む
    const cols = Math.min(8, sheet.getMaxColumns());
    const values = sheet.getRange(2, 1, n, cols).getDisplayValues();
    const richE = sheet.getRange(2, 5, n, 1).getRichTextValues();   // 出典セルのリンク
    const formE = sheet.getRange(2, 5, n, 1).getFormulas();         // =HYPERLINK() 対応
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
      words.push({
        row: i + 2,
        en: String(r[0]),
        ipa: String(r[1]),
        ja: String(r[2]),
        done: isDone_(r[3]),
        source: srcText,            // シートに表示されている名前そのまま
        sourceUrl: url,
        example: String(r[5]),
        note: String(r[6]),
        startSec: cols >= 8 ? String(r[7]).trim() : ''   // H列: 再生開始秒(任意)
      });
    });
    return json_({ ok: true, words: words });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * Status更新: POST (Content-Type: text/plain) body={"token":"","row":2,"en":"apple","done":true}
 * 行ずれ防止のため、行のA列が en と一致するか検証する。
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    if (!authorized_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    lock.waitLock(10000);
    const sheet = getSheet_();
    let row = Number(body.row);
    if (!row || String(sheet.getRange(row, 1).getValue()) !== String(body.en)) {
      const col = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
      row = 0;
      for (let i = 1; i < col.length; i++) {
        if (String(col[i][0]) === String(body.en)) { row = i + 1; break; }
      }
      if (!row) return json_({ ok: false, error: 'word not found' });
    }
    sheet.getRange(row, 4).setValue(body.done ? DONE_VALUE : TODO_VALUE);
    return json_({ ok: true, row: row });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
