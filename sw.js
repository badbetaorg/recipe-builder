// Offline support. Everything the app needs is cached on install, so it
// opens with no signal. Online, files come from the network first (so a new
// deploy shows up straight away) unless the network is slow, in which case
// the cached copy is used. Google Fonts are cached the first time they load.
const CACHE = "recipe-grid-v2";
const FONT_CACHE = "recipe-grid-fonts";
const SHELL = [
  "./",
  "index.html",
  "walkthrough.html",
  "manifest.webmanifest",
  "css/styles.css",
  "data/recipes.js",
  "js/layout.js",
  "js/store.js",
  "js/render.js",
  "js/editor.js",
  "js/app.js",
  "js/import-core.js",
  "js/importer.js",
  "js/pwa.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-64.png",
];
const SLOW_NETWORK_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return caches.open(CACHE).then((cache) => {
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
    const cached = cache.match(request, { ignoreSearch: true }).then(
      (hit) => hit || (request.mode === "navigate" ? cache.match("index.html") : undefined)
    );
    const slow = new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_MS)).then(() => cached);
    // Whichever answers first with something usable wins; fall back to the other.
    return Promise.race([network.catch(() => cached), slow.then((hit) => hit || network)]).then(
      (response) => response || network.catch(() => cached)
    );
  });
}

function cacheFirst(request) {
  return caches.open(FONT_CACHE).then((cache) =>
    cache.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok || response.type === "opaque") cache.put(request, response.clone());
          return response;
        })
    )
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") event.respondWith(cacheFirst(request));
});
