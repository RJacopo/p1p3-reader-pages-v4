// sw.js - simple offline cache
const CACHE = "p1p3-reader-v3";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./data/subjects.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // cache-first for same-origin
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(resp => resp || fetch(e.request).then(net => {
        const copy = net.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
        return net;
      }).catch(()=>resp))
    );
  }
});
