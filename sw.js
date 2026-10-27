// 앱 파일을 기기에 저장해서 인터넷 없이도 열리게 하는 파일
// 화면(index.html)은 인터넷이 되면 항상 최신을 받아옴 → index.html만 올려도 바로 반영
// 아이콘·manifest를 바꿨을 때만 아래 버전 숫자를 올려 주세요
const CACHE = "robot-pad-v14";

const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];
// 허브에 넣는 조종 프로그램과 펌웨어: 따로 저장 (이 파일들이 없어도 앱의 오프라인 저장은 성공하게)
// 펌웨어 파일 이름에 버전이 들어 있어서, 새 펌웨어는 새 이름으로 올리면 돼요
const OPTIONAL_FILES = [
  "./hub_program.bin",
  "./fw/primehub-f4-v4.1.1.bin",
  "./fw/primehub-h5-v4.1.1.bin",
  // 레고 펌웨어가 든 허브에 처음 설치할 때 필요한 2단계 부트로더 (Pybricks 공식 저장소, 앱이 해시로 확인)
  "https://raw.githubusercontent.com/pybricks/pybricks-micropython/v4.1.1/bricks/primehub_f4/mboot.bin",
];

const NETWORK_WAIT_MS = 3000;   // 인터넷이 느리면 3초 뒤 저장된 화면으로

// 설치: 파일을 기기에 저장 (브라우저에 남은 예전 파일 말고 서버에서 새로)
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })));
      for (const f of OPTIONAL_FILES) {
        try { await c.add(new Request(f, { cache: "reload" })); } catch (err) { /* 없어도 계속 */ }
      }
    })
  );
  self.skipWaiting();
});

// 새 버전이 오면 옛날 저장본 삭제
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isPage(req) {
  if (req.mode === "navigate") return true;
  const path = new URL(req.url, self.location.href).pathname;
  return path.endsWith("/") || path.endsWith("/index.html");
}

// 화면: 인터넷 먼저 (최신) → 실패하거나 3초 넘으면 저장된 화면
async function pageFromNetworkFirst() {
  const cache = await caches.open(CACHE);
  try {
    // ?t= 를 붙여서 GitHub의 10분 캐시도 건너뜀
    const url = new URL("./index.html", self.location.href);
    url.searchParams.set("t", Date.now());
    const res = await Promise.race([
      fetch(new Request(url.href, { cache: "no-store" })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("느림")), NETWORK_WAIT_MS)),
    ]);
    if (!res || !res.ok) throw new Error("서버 응답 이상");
    await cache.put("./index.html", res.clone());
    await cache.put("./", res.clone());
    return res;
  } catch (err) {
    const saved = (await cache.match("./index.html")) || (await caches.match("./index.html"));
    if (saved) {
      // 저장본이라는 표시를 붙여서 돌려줌 (앱이 "서버에 접속됐다"고 착각하지 않게)
      const headers = new Headers(saved.headers);
      headers.set("X-Robot-Pad-Cache", "1");
      return new Response(await saved.blob(), { status: 200, headers });
    }
    throw err;
  }
}

// 조종 프로그램 파일: 인터넷 먼저 (최신) → 안 되면 저장본
async function programFromNetworkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const url = new URL("./hub_program.bin", self.location.href);
    url.searchParams.set("t", Date.now());
    const res = await Promise.race([
      fetch(new Request(url.href, { cache: "no-store" })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("느림")), NETWORK_WAIT_MS)),
    ]);
    if (!res || !res.ok) throw new Error("서버 응답 이상");
    await cache.put("./hub_program.bin", res.clone());
    return res;
  } catch (err) {
    const saved = (await cache.match("./hub_program.bin")) || (await caches.match("./hub_program.bin"));
    if (saved) return saved;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (isPage(e.request)) {
    e.respondWith(pageFromNetworkFirst());
    return;
  }
  if (new URL(e.request.url).pathname.endsWith("/hub_program.bin")) {
    e.respondWith(programFromNetworkFirst(e.request));
    return;
  }
  // 펌웨어·부트로더 조각: 저장본 먼저, 없으면 인터넷에서 받아 저장 (처음 저장 때 놓쳐도 나중에 채워짐)
  if (OPTIONAL_FILES.some((f) => f.startsWith("http") ? e.request.url === f : e.request.url === new URL(f, self.location.href).href)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const fresh = e.request.cache === "reload" || e.request.cache === "no-store";   // 앱이 '새로 받아' 달라고 한 경우
      const saved = await cache.match(e.request.url);
      if (saved && !fresh) return saved;
      try {
        const res = await fetch(e.request.url, { cache: fresh ? "reload" : "default" });
        if (res && res.ok) { await cache.put(e.request.url, res.clone()); return res; }
        if (saved) return saved;
        return res;
      } catch (err) {
        if (saved) return saved;   // 인터넷이 안 되면 저장본 (앱이 해시로 다시 확인)
        throw err;
      }
    })());
    return;
  }
  // 아이콘 등: 저장본 먼저, 없으면 인터넷에서
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))
  );
});
