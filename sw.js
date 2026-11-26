/* Service worker: maakt de app offline beschikbaar.
   Verhoog VERSIE bij elke wijziging, zodat toestellen de nieuwe versie ophalen. */
const VERSIE = 'emf-2.2.1';
const BESTANDEN = ['./', 'index.html', 'style.css', 'catalogus.js', 'config.js', 'app.js', 'logo.png', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIE).then(c => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSIE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Apps Script-verkeer niet cachen
  // netwerk eerst (altijd nieuwste versie als er bereik is), anders cache
  // na 3 s zonder antwoord (slecht bereik) de opgeslagen versie gebruiken
  const metTimeout = Promise.race([fetch(e.request), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
  e.respondWith(
    metTimeout.then(r => { const kopie = r.clone(); caches.open(VERSIE).then(c => c.put(e.request, kopie)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
