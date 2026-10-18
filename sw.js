const CACHE = 'wordcard-v8';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'common.js', 'quotes.js', 'config.js', 'stats.html', 'stats.css', 'stats.js', 'manifest.json', 'manifest-stats.json', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 静的ファイル: キャッシュ優先(クエリ無視) + 裏で更新 / API(GAS): ネットワークに任せる
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const cleanUrl = url.origin + url.pathname;
  e.respondWith(caches.match(cleanUrl, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(cleanUrl, copy)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
