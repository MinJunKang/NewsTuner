/**
 * 선택 사항입니다. 이 워커를 쓰면 API 키가 폰이 아니라 Cloudflare에 저장됩니다.
 *
 * 배포
 *   npx wrangler deploy worker/index.js --name news-tuner-proxy
 *   npx wrangler secret put GEMINI_KEY   --name news-tuner-proxy
 *   npx wrangler secret put SHARED_TOKEN --name news-tuner-proxy   # 아무 긴 문자열
 *
 * 그다음 앱 설정의 "프록시 주소"에 https://news-tuner-proxy.<계정>.workers.dev 를,
 * "프록시 토큰"에 SHARED_TOKEN 과 같은 값을 넣습니다.
 * ALLOW_ORIGIN 은 본인 앱 주소로 바꾸세요.
 */

const ALLOW_ORIGIN = "*"; // 예: "https://<아이디>.github.io"

// 앱이 모델 이름을 경로로 보냅니다. 아무 문자열이나 통과시키면 이 워커가
// 남의 요청을 대신 보내주는 통로가 되므로, 아는 이름만 받습니다.
// 3.6 은 앱에서 더 이상 부르지 않지만 목록에 남겨 둡니다. 사용자가 열어 둔 탭이
// 옛 빌드를 실행 중이면 여전히 3.6 을 보내는데, 여기서 빼면 그 화면이 통째로
// 막힙니다. 새로고침이 퍼질 때까지 두었다가 나중에 지우세요.
const ALLOWED_MODELS = new Set([
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
]);

// /check 로 아무 주소나 받으면 이 워커가 남의 서버를 두드리는 도구가 됩니다.
// 앱이 쓰는 매체만 받습니다. src/App.jsx 의 domain 값과 같게 유지하세요.
const ALLOWED_HOSTS = new Set([
  "npr.org",
  "theguardian.com",
  // AP 는 매체 목록에서 뺐지만(피드 없음 → 지어낸 주소 문제) 여기서는 지우지
  // 않습니다. 허용 목록에 없는 도메인은 /check 가 검사 없이 통과시키므로, 옛
  // 빌드를 실행 중인 기기에서 지어낸 AP 주소가 오히려 화면까지 갈 수 있습니다.
  "apnews.com",
  "propublica.org",
  "scotusblog.com",
  "bbc.com",
  "pbs.org",
  "theconversation.com",
  "quantamagazine.org",
  "technologyreview.com",
  "arstechnica.com",
  "sciencenews.org",
  "marketplace.org",
  "theatlantic.com",
  "theringer.com",
  "thisiscolossal.com",
  "defector.com",
  "hyperallergic.com",
]);

const allowedHost = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol !== "https:" && protocol !== "http:") return false;
    const host = hostname.replace(/^www\./, "");
    return [...ALLOWED_HOSTS].some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

// 링크가 살아 있는지는 실제로 불러 봐야 압니다. 다만 뉴스 사이트는 데이터센터
// IP 를 봇으로 보고 403 을 주는 일이 흔합니다. 그것을 죽은 링크로 처리하면
// 멀쩡한 기사를 버리게 되므로, 404 와 410 만 확실한 사망으로 봅니다.
async function isDead(url) {
  const opts = { redirect: "follow", signal: AbortSignal.timeout(6000) };
  try {
    let res = await fetch(url, { method: "HEAD", ...opts });
    // HEAD 를 막아 둔 곳이 있어 그때만 GET 으로 한 바이트만 받아 봅니다.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, ...opts });
    }
    return res.status === 404 || res.status === 410;
  } catch {
    // 시간 초과나 네트워크 오류는 죽었다는 근거가 못 됩니다.
    return false;
  }
}

const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // 매 요청마다 프리플라이트가 한 번 더 나가지 않게 합니다.
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // 공개 URL이므로 남이 내 크레딧을 쓰지 못하게 막습니다.
    if (env.SHARED_TOKEN && request.headers.get("X-App-Token") !== env.SHARED_TOKEN) {
      return json({ error: { message: "토큰이 맞지 않습니다." } }, 401);
    }

    // /check — 링크가 살아 있는지 확인합니다. 확실히 죽은 것만 돌려줍니다.
    if (new URL(request.url).pathname.endsWith("/check")) {
      let urls = [];
      try {
        urls = JSON.parse(await request.text())?.urls || [];
      } catch {
        return json({ error: { message: "urls 를 읽지 못했습니다." } }, 400);
      }
      const targets = urls.filter((u) => typeof u === "string" && allowedHost(u)).slice(0, 12);
      const flags = await Promise.all(targets.map(isDead));
      return json({ dead: targets.filter((_, i) => flags[i]) }, 200);
    }

    // /gemini/<모델>
    const match = new URL(request.url).pathname.match(/\/gemini\/([^/]+)$/);
    if (!match) return json({ error: { message: "없는 경로입니다." } }, 404);

    const model = decodeURIComponent(match[1]);
    if (!ALLOWED_MODELS.has(model)) {
      return json({ error: { message: `허용되지 않은 모델입니다: ${model}` } }, 400);
    }

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await request.text(),
      }
    );
    return relay(upstream);
  },
};

async function relay(upstream) {
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
