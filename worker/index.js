/**
 * 선택 사항입니다. 이 워커를 쓰면 API 키가 폰이 아니라 Cloudflare에 저장됩니다.
 *
 * 배포
 *   npx wrangler deploy worker/index.js --name news-tuner-proxy
 *   npx wrangler secret put GEMINI_KEY --name news-tuner-proxy
 *   npx wrangler secret put CLAUDE_KEY --name news-tuner-proxy
 *   npx wrangler secret put SHARED_TOKEN --name news-tuner-proxy   # 아무 긴 문자열
 *
 * 그다음 앱 설정의 "프록시 주소"에 https://news-tuner-proxy.<계정>.workers.dev 를 넣습니다.
 * ALLOW_ORIGIN 은 본인 앱 주소로 바꾸세요.
 */

const ALLOW_ORIGIN = "*"; // 예: "https://news-tuner.pages.dev"
const GEMINI_MODEL = "gemini-3.6-flash";

const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const path = new URL(request.url).pathname;

    // 공개 URL이므로 남이 내 크레딧을 쓰지 못하게 막습니다.
    if (env.SHARED_TOKEN && request.headers.get("X-App-Token") !== env.SHARED_TOKEN) {
      return json({ error: { message: "토큰이 맞지 않습니다." } }, 401);
    }

    const body = await request.text();

    if (path.endsWith("/gemini")) {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body }
      );
      return relay(upstream);
    }

    if (path.endsWith("/claude")) {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.CLAUDE_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
      });
      return relay(upstream);
    }

    return json({ error: { message: "없는 경로입니다." } }, 404);
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
