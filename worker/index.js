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
const ALLOWED_MODELS = new Set([
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
]);

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
