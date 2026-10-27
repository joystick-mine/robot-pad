// 파이브릭스 단어블록 오프라인 지원
// 인터넷이 되면 항상 최신 파일을 먼저 받고(업데이트가 바로 반영돼요), 안 되면 저장해 둔 파일을 써요.
const CACHE = "pb-wordblocks-v18";
const FILES = [
  "./", "index.html", "manifest.json",
  "js/blocks.js", "js/hub.js", "js/ml.js", "js/app.js", "js/firmware.js", "js/sound.js", "js/recorder.js", "js/hubs.js", "js/stage.js", "js/project.js",
  "fw/primehub-f4.bin", "fw/primehub-h5.bin", "fw/primehub.json", "fw/ev3.bin", "fw/ev3.json",
  "lib/mpy-cross-v6.js", "lib/mpy-cross-v6.wasm", "lib/tf.min.js", "lib/mobilenet.min.js",
  "lib/blockly_compressed.js", "lib/blocks_compressed.js", "lib/python_compressed.js", "lib/msg/ko.js",
  "media/sprites.png", "media/sprites.svg", "media/handopen.cur", "media/handclosed.cur",
  "media/handdelete.cur", "media/1x1.gif", "media/dropdown-arrow.svg",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // 같은 사이트 파일은 브라우저 캐시를 건너뛰고 서버에 새 버전이 있는지 확인해요 (GitHub Pages는 10분 캐시가 있어요)
  const same = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    fetch(e.request, same ? { cache: "no-cache" } : undefined)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) =>
        r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
