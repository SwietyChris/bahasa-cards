const prefix = `bahasa-cards:${new URL(self.registration.scope).pathname}:`;
const cacheName = prefix + "3";
const assets = [
  "./", "./index.html", "./style.css", "./app.mjs", "./cards.mjs", "./capture.mjs",
  "./autoscan.mjs", "./exports.mjs", "./pdf.mjs", "./xlsx.mjs", "./manifest.webmanifest", "./icon-192.png",
  "./icon-512.png", "./vendor/jszip.min.js", "./vendor/pdf-lib.min.js",
];
const allowed = new Set(assets.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(prefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const address = new URL(event.request.url);
  const key = address.origin + address.pathname;
  if (!allowed.has(key)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(key) ?? Response.error();
  }));
});
