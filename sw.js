// 오프라인 캐시 + 알림 클릭 처리
const VER = 'tw-2026-10-18f';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'info.html', 'manifest.json', 'config.js', 'icon-192.png', 'icon-512.png', 'lib/leaflet.js', 'lib/leaflet.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== 'tiles').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.hostname.endsWith('tile.openstreetmap.org')) {
    // 지도 타일: 본 적 있는 곳은 캐시에서 (인터넷 없을 때 대비)
    e.respondWith(caches.open('tiles').then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; }).catch(() => r))));
    return;
  }
  if (u.origin === location.origin) {
    // 앱 파일: 네트워크 우선, 실패하면 캐시
    e.respondWith(fetch(e.request).then(res => { const cp = res.clone(); caches.open(VER).then(c => c.put(e.request, cp)); return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    if (cs.length) { cs[0].focus(); cs[0].postMessage({ open: id }); return; }
    return self.clients.openWindow('./#' + (id || ''));
  }));
});
