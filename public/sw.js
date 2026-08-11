// v1 은 index.html 까지 캐시 우선으로 돌려주는 바람에, 한 번 설치한 기기가
// 새로 배포한 버전을 영영 받지 못했습니다. 이름을 바꿔 옛 캐시를 버립니다.
const CACHE = "news-tuner-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

const putIfOk = (request, res) => {
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return res;
};

// 앱 셸만 캐시합니다. API 호출은 항상 네트워크로 나갑니다.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // 문서는 네트워크 우선. 배포한 새 버전이 다음 실행에 바로 반영됩니다.
  // 오프라인이면 캐시에 넣어 둔 마지막 index.html 로 떨어집니다.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => putIfOk("./index.html", res))
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // 나머지는 파일 이름에 해시가 붙은 정적 자산이라 캐시 우선이 안전합니다.
  e.respondWith(
    caches
      .match(e.request)
      .then((hit) => hit || fetch(e.request).then((res) => putIfOk(e.request, res)))
  );
});
