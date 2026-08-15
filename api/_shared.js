// Vercel 함수 공용 조각입니다. 밑줄로 시작하는 파일은 라우트가 되지 않습니다.
// worker/index.js 와 같은 정책을 씁니다. 한쪽을 고치면 다른 쪽도 확인하세요.

export const ALLOW_ORIGIN = "*"; // 예: "https://<아이디>.github.io"

// 3.6 은 앱에서 더 이상 부르지 않지만 목록에 남겨 둡니다. 사용자가 열어 둔 탭이
// 옛 빌드를 실행 중이면 여전히 3.6 을 보내는데, 여기서 빼면 그 화면이 통째로
// 막힙니다. 새로고침이 퍼질 때까지 두었다가 나중에 지우세요.
export const ALLOWED_MODELS = new Set([
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
]);

// /check 로 아무 주소나 받으면 이 함수가 남의 서버를 두드리는 도구가 됩니다.
// 앱이 쓰는 매체만 받습니다. src/App.jsx 의 domain 값과 같게 유지하세요.
export const ALLOWED_HOSTS = new Set([
  "npr.org",
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
  // 아래 둘은 기사 도메인이 아니라 피드 전용 호스트입니다. BBC 와 Marketplace 는
  // 피드를 별도 도메인에서 내보냅니다(/feed 경로가 씁니다).
  "bbci.co.uk",
  "publicradio.org",
]);

export function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// true 를 돌려주면 요청 처리가 끝난 것입니다(프리플라이트 응답 or 토큰 거부).
export function gate(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  const token = process.env.SHARED_TOKEN;
  if (token && req.headers["x-app-token"] !== token) {
    res.status(401).json({ error: { message: "토큰이 맞지 않습니다." } });
    return true;
  }
  return false;
}

export const allowedHost = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol !== "https:" && protocol !== "http:") return false;
    const host = hostname.replace(/^www\./, "");
    return [...ALLOWED_HOSTS].some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

// 뉴스 사이트는 데이터센터 IP 를 봇으로 보고 403 을 주는 일이 흔합니다.
// 그것을 죽은 링크로 처리하면 멀쩡한 기사를 버리게 되므로,
// 404 와 410 만 확실한 사망으로 봅니다.
export async function isDead(url) {
  const opts = { redirect: "follow", signal: AbortSignal.timeout(6000) };
  try {
    let r = await fetch(url, { method: "HEAD", ...opts });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, ...opts });
    }
    return r.status === 404 || r.status === 410;
  } catch {
    return false;
  }
}
