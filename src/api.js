/* ------------------------------------------------------------------ *
 * 모델 이름은 여기서만 바꾸면 전체에 적용됩니다. 전부 Gemini 를 씁니다.
 * ------------------------------------------------------------------ */
export const MODELS = {
  // 뉴스 수집: Google 검색 그라운딩이 필요하고 한 번에 긴 글을 씁니다.
  news: "gemini-3.6-flash",
  // 단어·문장 풀이: 짧고 잦은 호출이라 thinking 기본값이 minimal 인 lite 를 씁니다.
  lookup: "gemini-3.5-flash-lite",
  // 기사 토론: 맥락 이해가 필요한 쪽.
  chat: "gemini-3.6-flash",
  // 후보 목록: 검색 결과에서 제목과 주소를 추리는 일이라 작은 모델로 충분합니다.
  // 단가가 입력 1/5, 출력 1/3이라 기사당 비용의 ~30% 가 여기서 빠집니다.
  // 재시도는 큰 모델로 올라가므로 lite 가 부실해도 뒷받침이 있습니다.
  list: "gemini-3.5-flash-lite",
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/* ------------------------------------------------------------------ *
 * 공통
 * ------------------------------------------------------------------ */

export function extractJson(text) {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("모델이 JSON 형식으로 답하지 않았습니다.");
  const body = stripped.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // 스키마 없이 받은 응답에서 자주 나오는 실수 하나만 고쳐 다시 시도합니다.
    // 마지막 항목 뒤에 쉼표를 남기는 것인데, JSON 에서는 허용되지 않습니다.
    try {
      return JSON.parse(body.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      // JSON.parse 의 "Unexpected token" 메시지를 그대로 보여주면 사용자가 할 수
      // 있는 일이 없습니다. 다시 시도하면 대개 풀립니다.
      throw new Error("모델 응답을 읽지 못했습니다. 다시 시도해 주세요.");
    }
  }
}

// 링크 주소는 모델이 만든 값입니다. 검사 없이 href 에 넣으면 javascript: 스킴이
// 클릭 한 번에 실행되고, 그 코드는 localStorage 의 API 키를 읽어 갈 수 있습니다.
// 절대 주소이면서 http/https 인 것만 통과시킵니다. (React 는 막아주지 않습니다.)
export const safeUrl = (u) => {
  if (typeof u !== "string") return null;
  try {
    const { protocol, href } = new URL(u);
    return protocol === "http:" || protocol === "https:" ? href : null;
  } catch {
    return null;
  }
};

// 모델은 실제로 열어본 적 없는 주소를 그럴듯하게 지어낼 수 있습니다. 브라우저는
// CORS 때문에 살아있는 주소인지 확인할 수 없으므로, 최소한 발행사 도메인인지는
// 검사합니다. 남의 도메인이면 지어낸 것으로 봅니다.
export const onDomain = (url, domain) => {
  const u = safeUrl(url);
  if (!u) return null;
  if (!domain) return u;
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`) ? u : null;
  } catch {
    return null;
  }
};

// 그라운딩은 본문에 [2.1.1] 같은 인용 마커를 남깁니다. 화면에 그대로 보이므로
// 사용자에게 내보내는 모든 문자열에서 걷어냅니다.
const stripMarkers = (t) =>
  typeof t === "string" ? t.replace(/\s*\[[\d.]+\]/g, "").trim() : "";

// 기사가 아닌 페이지는 주소 모양만으로도 상당수 걸러집니다. 모델에게 판단을
// 맡기는 대신 여기서 규칙으로 거릅니다. 실제 8개 매체 주소로 확인했습니다.
// live 와 series 는 하이픈 슬러그를 달고 나와(/live/russia-ukraine-war-updates)
// 날짜·슬러그 검사를 통과합니다. 확실한 허브 이름이므로 여기서 막습니다.
// section 과 archive 는 기사 경로에도 쓰여(NPR, The Atlantic) 넣으면 안 됩니다.
const HARD_HUB =
  /^(tag|tags|topic|topics|hub|hubs|live|series|collection|collections|index|category|categories|search|author|authors|people|video|videos|watch|listen|podcast|podcasts|gallery|galleries|photos|photo|newsletter|newsletters|about|subscribe|donate)$/i;

export function looksLikeArticleUrl(u) {
  const safe = safeUrl(u);
  if (!safe) return false;
  let path;
  try {
    path = new URL(safe).pathname;
  } catch {
    return false;
  }
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) return false; // 홈페이지
  // section 이나 archive 는 허브 이름이기도 하고 기사 경로의 일부이기도 합니다.
  // NPR Shots 기사가 /sections/health-shots/2026/08/11/... 이라, 그런 말까지
  // 막으면 그 매체 기사가 통째로 사라집니다. 확실한 것만 막고, 나머지는 아래의
  // 날짜와 슬러그 검사로 가립니다.
  if (segs.some((seg) => HARD_HUB.test(seg))) return false;

  const last = segs[segs.length - 1];
  if (/\.(jpg|jpeg|png|gif|webp|pdf|mp3|mp4)$/i.test(last)) return false;

  // BBC 신형 주소(/news/articles/c20dqd9qwq4o)는 날짜도 하이픈 슬러그도 없이
  // 무작위 식별자를 씁니다. article/story 구간 뒤에 식별자가 오면 기사입니다.
  for (let i = 0; i < segs.length - 1; i++) {
    if (/^(articles?|stor(y|ies))$/i.test(segs[i]) && segs[i + 1]) return true;
  }

  // 그 외 기사 주소는 날짜를 담거나, 제목에서 온 하이픈 슬러그를 답니다.
  const hasDate = /\/(19|20)\d{2}\/\d{1,2}\//.test(path);
  const hasSlug = (last.match(/-/g) || []).length >= 2;
  return hasDate || hasSlug;
}

// 링크가 실제로 살아 있는지는 그 주소를 불러 봐야 압니다. 브라우저는 CORS 때문에
// 상태 코드를 읽을 수 없으므로 워커를 거쳐야만 확인됩니다. 워커가 없으면 확인을
// 건너뜁니다. 확인하지 못한 것을 죽었다고 볼 수는 없습니다.
async function deadUrls(urls, proxy, proxyToken) {
  if (!proxy || !urls.length) return null;
  const headers = { "Content-Type": "application/json" };
  if (proxyToken?.trim()) headers["X-App-Token"] = proxyToken.trim();
  try {
    const res = await fetch(`${proxy.replace(/\/$/, "")}/check`, {
      method: "POST",
      headers,
      body: JSON.stringify({ urls }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.dead) ? new Set(data.dead) : null;
  } catch {
    // 확인에 실패했다고 기사를 버리면 안 됩니다.
    return null;
  }
}

// 응답이 실제 검색에 근거했는지와, 깨졌을 수 있는 JSON 을 조용히 받아 보는
// 판별입니다. 목록과 집필 양쪽이 같은 판별을 써야 정책이 어긋나지 않습니다.
const grounded = (c) => (c?.groundingMetadata?.groundingChunks || []).length > 0;
// 검색이 실행됐다는 증거는 두 가지입니다. groundingChunks 는 문장에 붙는 인용이라
// 산문에는 잘 붙지만 JSON 목록 출력에는 빠질 수 있습니다. webSearchQueries 는
// 실행된 검색어 기록이라 출력 형태와 무관합니다. 둘 중 하나면 검색은 한 것입니다.
const searched = (c) =>
  grounded(c) || (c?.groundingMetadata?.webSearchQueries || []).length > 0;
const tryParse = (t) => {
  try {
    return extractJson(t);
  } catch {
    return null;
  }
};

// 기사 전문을 서버(/extract)로 가져옵니다. 성공하면 모델이 검색 발췌 대신
// 전문을 놓고 쓰므로 분량과 정확도가 함께 좋아지고, 출처가 하나로 고정됩니다.
// 허브나 차단 페이지는 문단이 거의 없어 여기서 걸러지고, 그때는 검색 경로로
// 돌아갑니다.
async function fetchFullText(url, proxy, proxyToken) {
  if (!proxy || !url) return null;
  const headers = { "Content-Type": "application/json" };
  if (proxyToken?.trim()) headers["X-App-Token"] = proxyToken.trim();
  try {
    const res = await fetch(`${proxy.replace(/\/$/, "")}/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // 원문 서버가 404/410 을 줬다면 이 주소는 확실히 죽은 것입니다. 검색으로
    // 우회해 쓰면 죽은 링크 밑에 기사가 붙으므로, 후보 폐기 신호를 돌려줍니다.
    if (/40[41]|410/.test(data?.error?.message || "")) return { dead: true };
    const paragraphs = (Array.isArray(data?.paragraphs) ? data.paragraphs : [])
      .map(stripMarkers)
      .filter(Boolean);
    const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
    if (paragraphs.length < 5 || words < 250) return null;
    return { title: stripMarkers(data.title || ""), paragraphs };
  } catch {
    return null;
  }
}

// 같은 매체·키워드로 연달아 받을 때, 후보 목록을 매번 새로 검색하면 매번
// 10초 안팎과 검색 호출 하나를 다시 냅니다. 목록은 몇 분 안에는 그대로이므로
// 세션 메모리에 잠깐 들고 있다가 재사용합니다. 다 소진되거나 10분이 지나면
// 새로 찾습니다. 비용은 오히려 줄고 반복 수신이 목록 단계를 통째로 건너뜁니다.
const listCache = new Map();
const LIST_TTL = 10 * 60 * 1000;

// 언제 어떤 매체에서 무슨 오류가 났는지 기기에 남깁니다. 어디로도 전송하지
// 않으며, 설정 탭에서 복사해 업데이트 요청에 붙일 수 있습니다. 200건 상한.
export function logIssue(kind, where, message) {
  try {
    const key = "nt-errlog";
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    arr.unshift({
      t: new Date().toISOString(),
      kind,
      where: where || "",
      msg: String(message ?? "").slice(0, 300),
    });
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
  } catch {
    /* 기록 실패가 본 작업을 막으면 안 됩니다 */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findDetail = (details, type) =>
  (details || []).find((d) => String(d?.["@type"] || "").includes(type));

// 429 는 "분당 한도"와 "하루 한도"와 "검색 그라운딩 한도"가 전부 같은 코드로 옵니다.
// 무엇에 걸렸는지 알려주지 않으면 사용자가 할 수 있는 일이 없습니다.
function apiError(res, body) {
  const err = body?.error;
  const detail = err?.message || body?.message || "";
  const details = err?.details || [];

  const violation = findDetail(details, "QuotaFailure")?.violations?.[0];
  const quotaId = violation?.quotaId || "";
  const raw = findDetail(details, "RetryInfo")?.retryDelay || "";
  const secs = /^([\d.]+)s$/.exec(raw);
  const retryMs = secs ? Math.ceil(parseFloat(secs[1]) * 1000) : 0;

  const badKey =
    res.status === 401 ||
    res.status === 403 ||
    details.some((d) => d?.reason === "API_KEY_INVALID") ||
    /API key not valid/i.test(detail);

  let message;
  if (res.status === 401 && /토큰/.test(detail)) {
    // 워커의 SHARED_TOKEN 불일치입니다. API 키 문제로 안내하면 사용자가
    // 엉뚱한 칸을 고칩니다.
    message = "프록시 토큰이 맞지 않습니다. 설정에서 프록시 토큰을 확인하세요.";
  } else if (badKey) {
    message = "API 키가 거부되었습니다. 설정에서 키를 확인하세요.";
  } else if (res.status === 429) {
    const haystack = `${quotaId} ${detail}`;
    if (/search|grounding/i.test(haystack)) {
      message =
        "뉴스 검색(그라운딩) 한도에 걸렸습니다. " +
        "무료 티어에서는 검색 그라운딩을 쓸 수 없어, AI Studio에서 결제를 연결해야 합니다.";
    } else if (/perday|daily/i.test(quotaId)) {
      const cap = violation?.quotaValue ? ` (하루 ${violation.quotaValue}회)` : "";
      message =
        `오늘 쓸 수 있는 양을 다 썼습니다${cap}. ` +
        "한도는 태평양 시간 자정, 한국 시간으로 대략 오후 4~5시에 초기화됩니다.";
    } else {
      const wait = retryMs ? `${Math.ceil(retryMs / 1000)}초` : "잠시";
      message = `짧은 시간에 너무 많이 불렀습니다. ${wait} 후 다시 시도하세요.`;
    }
    // 어떤 한도였는지 남겨야 나중에 원인을 짚을 수 있습니다.
    if (quotaId) message += ` [${quotaId}]`;
  } else if (res.status === 504 || res.status === 502) {
    // 중계(Vercel)나 상류가 제한 시간 안에 응답을 못 받은 것입니다. 요청이
    // 길수록 잘 나므로, 재시도와 함께 길이를 줄이는 우회도 알려줍니다.
    message =
      "응답 시간이 초과됐습니다. 자동으로 다시 시도했지만 실패했습니다. 다시 시도하거나 길이를 줄여 보세요.";
  } else if (res.status === 503 || res.status === 529 || res.status === 500) {
    // 모델 쪽 혼잡·일시 장애입니다. 요청 자체가 처리되지 않은 것이라 기다렸다
    // 다시 부르면 대개 풀립니다. 영어 원문을 그대로 보여줄 이유가 없습니다.
    message = "모델이 혼잡합니다. 잠시 후 자동으로 다시 시도했지만 실패했습니다. 조금 뒤에 다시 눌러 주세요.";
  } else {
    message = `요청 실패 (${res.status}) ${detail}`.trim();
  }

  const e = new Error(message);
  e.status = res.status;
  e.quotaId = quotaId;
  e.retryMs = retryMs;
  return e;
}

/* ------------------------------------------------------------------ *
 * Gemini 호출 한 곳
 * ------------------------------------------------------------------ */

async function gemini({
  geminiKey,
  proxy,
  proxyToken,
  model,
  system,
  contents,
  tools,
  schema,
  maxOutputTokens,
  thinkingLevel,
}) {
  const url = proxy
    ? `${proxy.replace(/\/$/, "")}/gemini/${model}`
    : `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const headers = { "Content-Type": "application/json" };
  // 프록시를 쓸 때는 워커의 SHARED_TOKEN 과 맞춰 보냅니다.
  if (proxy && proxyToken?.trim()) headers["X-App-Token"] = proxyToken.trim();

  const generationConfig = {};
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;
  // Gemini 3.x 는 기본으로 생각을 합니다. 짧은 호출은 최소로 낮춥니다.
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  // 스키마를 주면 모델이 반드시 그 모양의 JSON 으로만 답합니다.
  // mimeType 은 MIME 문자열이 아니라 enum 입니다. "application/json" 을 넣으면
  // 400 이 납니다. APPLICATION_JSON 그대로 두세요.
  if (schema)
    generationConfig.responseFormat = {
      text: { mimeType: "APPLICATION_JSON", schema },
    };

  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools) body.tools = tools;

  const payload = JSON.stringify(body);
  const send = async () => {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: payload });
    } catch {
      // Safari 는 "Load failed" 같은 영어 한 줄만 남깁니다. 연결 끊김, 프록시
      // 무응답, CORS 실패가 전부 이 모양으로 옵니다.
      throw new Error("네트워크 오류로 요청이 전달되지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    }
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  };

  let { res, data } = await send();

  // 503/529 는 혼잡, 502/504 는 시간 초과입니다. 어느 쪽이든 잠깐 기다렸다
  // 다시 부르면 풀리는 일이 많습니다. 두 번까지, 간격을 늘려 가며.
  // (504 는 상류에서 처리가 끝났는데 응답만 놓쳤을 수 있어 재과금 위험이
  //  있지만, 결과 없이 끝나는 것보다 낫습니다.)
  for (
    let wait = 1500;
    (res.status === 503 || res.status === 529 || res.status === 502 || res.status === 504) &&
    wait <= 3000;
    wait += 1500
  ) {
    await sleep(wait);
    ({ res, data } = await send());
  }

  // 분당 한도는 몇 초만 기다리면 풀립니다. 하루 한도는 기다려도 소용없으니
  // 그대로 알립니다. 사용자가 버튼을 다시 누르게 하면 한도만 더 깎입니다.
  if (res.status === 429) {
    const e = apiError(res, data);
    if (e.retryMs > 0 && e.retryMs <= 15000 && !/perday|daily/i.test(e.quotaId)) {
      await sleep(e.retryMs + 250);
      ({ res, data } = await send());
    }
  }

  if (!res.ok) throw apiError(res, data);
  if (!data) throw new Error("응답을 읽지 못했습니다. 잠시 후 다시 시도하세요.");

  // 실제 토큰 사용량입니다. 비용 추정이 아니라 실측을 보려면 브라우저 콘솔에서
  // [nt-usage] 를 찾으면 됩니다. 화면이나 요청에는 아무 영향이 없습니다.
  if (data.usageMetadata) console.debug("[nt-usage]", model, data.usageMetadata);

  const cand = data.candidates?.[0];
  // 잘린 응답은 JSON 이 깨져서 파싱 단계에서 엉뚱한 오류로 보입니다. 여기서 먼저 알립니다.
  if (cand?.finishReason === "MAX_TOKENS")
    throw new Error("답이 너무 길어 잘렸습니다. 다시 시도해 보세요.");

  const text = (cand?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("빈 응답을 받았습니다. 잠시 후 다시 시도해 보세요.");

  return { text, cand };
}

/* ------------------------------------------------------------------ *
 * 뉴스 수집
 * ------------------------------------------------------------------ */

// 기사도 스키마로 형식을 강제합니다. 프롬프트로만 JSON 을 지시하면 본문에 따옴표나
// 괄호가 섞였을 때 파싱이 깨집니다.
const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    // 조건에 맞는 기사를 못 찾았을 때 쓰는 자리입니다. 스키마가 강제되므로
    // error 만 담은 객체는 돌려줄 수 없고, 나머지는 빈 값으로 채워 옵니다.
    error: {
      type: "string",
      description:
        'Last resort only. Leave this out entirely whenever you have any usable article. ' +
        'Set it to "no suitable article found" only after several searches with different ' +
        'wording turned up nothing, and then leave every other field empty.',
    },
    url: {
      type: "string",
      description:
        "The exact address of the story as it appeared in your search results. Never " +
        "assemble, guess or complete an address — leave it as an empty string instead.",
    },
    title: { type: "string", description: "The English headline you wrote." },
    titleKo: { type: "string", description: "KOREAN ONLY. The headline in Korean." },
    outlet: { type: "string", description: "The publication the story came from." },
    published: { type: "string", description: "Publication date as YYYY-MM-DD." },
    summaryKo: { type: "string", description: "KOREAN ONLY. One sentence summarising the story." },
    paragraphs: {
      type: "array",
      items: { type: "string" },
      description: "The article you wrote, in English, one string per paragraph.",
    },
    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string", description: "An English word or phrase from the article." },
          ko: { type: "string", description: "KOREAN ONLY. What it means." },
          note: { type: "string", description: "KOREAN ONLY. One line on how it is used here." },
        },
        required: ["word", "ko", "note"],
      },
    },
    related: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The story's own English headline." },
          titleKo: { type: "string", description: "KOREAN ONLY. That headline in Korean." },
          url: { type: "string", description: "Required. Canonical URL, same rule as above." },
        },
        required: ["title", "titleKo", "url"],
      },
    },
  },
  // url 을 필수로 두면 실제 주소를 모를 때도 반드시 채워야 해서 지어냅니다.
  // 빈 값을 허용하는 편이 틀린 주소보다 낫습니다.
  required: [
    "title", "titleKo", "outlet", "published",
    "summaryKo", "paragraphs", "keywords", "related",
  ],
};

export async function fetchArticle({
  geminiKey,
  proxy,
  proxyToken,
  source,
  topic,
  focus,
  level,
  length,
  story, // 관련 기사 목록에서 고른 특정 기사. 없으면 새로 찾습니다.
  exclude, // 최근에 읽은 기사 주소. 같은 글이 다시 나오지 않게 합니다.
  onProgress, // 진행 단계를 화면에 알리는 콜백. API 호출과 무관합니다.
}) {
  const tick = (m) => {
    try {
      onProgress?.(m);
    } catch {
      /* 진행 표시가 죽어도 본 작업은 계속합니다 */
    }
  };
  const levelSpec = {
    easy: "CEFR B2. Natural news register, moderate sentence length.",
    // 이 단계는 학습자용으로 눅여 쓰지 말라고 구체적으로 지시해야 실제 기사 문체가 나옵니다.
    // 문체만 실제 기사 수준이고, 표현은 어디까지나 새로 쓴 것이어야 합니다.
    hard:
      "CEFR C1, written the way a wire reporter actually writes. " +
      "Sentences carry a lot of information but stay direct — somebody does something, with " +
      "attribution appended the way reporters do (officials said, according to the filing). " +
      "Vocabulary is a working adult's, and the field's own terms are used without stopping " +
      "to explain them. " +
      "What makes this level C1 is density and precision, not long or ornate sentences: more " +
      "facts, exact figures, real names, specific terms. It is not more abstraction. " +
      "If your sources supply background on why this matters now, give it a paragraph. " +
      "Do not use textbook connectors such as moreover, furthermore, or in conclusion.",
  }[level];

  // 길이를 못박아 두면 원문이 아무리 길어도 그만큼만 나옵니다.
  const targetWords = { short: 400, mid: 800, long: 1500 }[length] || 800;
  const lengthSpec =
    {
      short: "about 400 words",
      mid: "about 800 words",
      long:
        "about 1500 words. A target this size cannot be filled from one or two searches — " +
        "expect to run at least four or five different searches on this same story before " +
        "you have enough of its content to write from",
    }[length] || "about 800 words";

  // 주간지에 "며칠 내"를 요구하면 해당 기사가 없어 모델이 헤맵니다.
  const recency = source.window || "the last few days";

  // 사용자가 방향을 적어 넣을 수 있습니다. 다만 요청에 맞는 기사가 없을 때
  // 억지로 지어내면 "실제 뉴스를 읽는다"는 앱의 전제가 무너집니다.
  const focusLine = focus
    ? `
The reader is looking for this in particular: ${focus}
The story you report must be about this, or clearly connected to it. A related angle is fine;
something unrelated is not. If ${source.label} published nothing on it in ${recency}, set
"error" rather than reporting an unrelated story, and never stretch or invent a story to fit.
`
    : "";

  // 검색과 집필을 한 번에 시키면, 모델이 무엇을 읽었는지 확인할 방법이 없고
  // 출처도 함께 사라집니다. 먼저 후보 목록을 받아 실재하는 기사를 하나 고른 뒤,
  // 그 기사만 놓고 쓰게 합니다. 목록의 나머지는 관련 기사로 씁니다.
  let picked = story;
  let listed = [];
  if (picked) tick("고른 기사를 읽고 다시 쓰는 중…");
  if (!picked) {
    const cacheKey = `${source.id}|${(focus || "").trim()}`;
    const hit = listCache.get(cacheKey);
    const fresh =
      hit && Date.now() - hit.at < LIST_TTL
        ? hit.items.filter((it) => !exclude?.includes(it.url))
        : [];
    try {
      if (fresh.length) {
        tick("이전 검색의 후보에서 고르는 중…");
        listed = fresh;
      } else {
        tick("기사 찾는 중…");
        listed = await findStories({ geminiKey, proxy, proxyToken, source, topic, focus, exclude });
        listCache.set(cacheKey, { at: Date.now(), items: listed });
      }
      // 항상 1번을 쓰면 조건이 같을 때 매번 같은 기사가 나옵니다. 상위 후보
      // 안에서 무작위로 고릅니다. 키워드가 있을 때는 관련도 순서가 의미를
      // 가지므로 범위를 좁게 잡습니다.
      const pool = listed.slice(0, focus ? 3 : 5);
      picked = pool[Math.floor(Math.random() * pool.length)];
      // 고른 기사를 목록 맨 앞으로 보내야 나머지가 관련 기사가 됩니다.
      listed = [picked, ...listed.filter((x) => x.url !== picked.url)];
      tick(`후보 ${listed.length}건 · 기사를 읽고 다시 쓰는 중…`);
    } catch (e) {
      // 키워드를 주셨을 때 예전 경로로 넘어가면 무관한 기사를 써 오므로 그대로
      // 알립니다. 실패 이유를 키워드 메시지로 덮지 않고 그대로 올립니다.
      if (focus) throw e;
      // 키워드가 없으면 옛 경로로 떨어지는데, 그러면 왜 목록이 실패했는지가
      // 화면에서 사라집니다. 진단할 수 있게 콘솔에 남깁니다.
      console.warn("[nt-listfail]", source?.id, e?.message || e);
      logIssue("목록실패", source?.id, e?.message || e);
      picked = null;
      tick("기사를 찾아 다시 쓰는 중…");
    }
  }

  // 관련 기사에서 고른 경우에는 새로 찾지 말고 그 기사를 그대로 다룹니다.
  // 기사는 목록 단계에서 이미 정해집니다. 그래서 이 프롬프트에는 "어느 기사를
  // 고를지" 를 넣지 않습니다. 넣어 두면 정해진 기사를 두고 다른 것을 찾으라는
  // 상반된 지시가 됩니다. 고르는 규칙은 목록을 못 받았을 때의 대체 경로에만 둡니다.
  // 프롬프트를 후보마다 다시 만듭니다. 1번 후보를 열지 못하면 다음 후보로
  // 넘어가야 하는데, 프롬프트를 한 번만 만들면 그럴 수가 없습니다.
  const buildPrompt = (chosen, full) => {
    let intro = chosen
      ? `Report this specific story, published by ${source.label}:
Headline: ${chosen.title}
Address: ${chosen.url}

Search for that headline on ${source.domain} to read the story. Search is how you reach it —
you cannot simply open the address. One search shows you only fragments of the story, so run
several: the full headline, then distinctive phrases from it, each with site:${source.domain}.
Different queries surface different passages of the same article. Gather as much of THIS
story as you can before you start writing.

This story is already chosen. Do not pick a different one, and do not treat other results
about the same event as sources for this piece. It came from a real search result, so it
exists: report it. Set "error" only if you can find no trace of this story at all, which
should be rare.`
    : `Use Google Search to find a real story published in ${recency} by ${source.label} on
the topic: ${topic}. Run several searches with different wording. site:${source.domain} is
one query worth trying, but if it returns little, search normally by outlet name and topic.
Prefer ${recency}, but if that window has nothing, take the most recent story you can find
rather than declaring error — a low-volume section publishes slowly.
The story must be published on ${source.domain}; another outlet's coverage of the same event
does not count.

Skip pages that are not articles — dashboards, tag and topic hubs, category pages, live
blogs, galleries, video and podcast pages. Among what is left, take the one with the most
substantial reporting. You must open search results and report from them: if you find nothing
usable on ${source.domain}, set "error" rather than writing from memory.
${focusLine}`;

    // 전문이 있으면 검색이 아니라 아래 본문이 유일한 재료입니다.
    if (full)
      intro = `Report this story, published by ${source.label}:
Headline: ${chosen.title}
Address: ${chosen.url}

The complete text of the story appears at the end of this message under SOURCE TEXT.
Work only from that text. Do not search, and do not bring in anything the text does not say.`;

    const srcWords = full
      ? full.paragraphs.join(" ").split(/\s+/).filter(Boolean).length
      : 0;
    const quotaRule = full
      ? srcWords >= targetWords
        ? `- The target is about ${targetWords} words, and the source below runs about ${srcWords}
  words — it comfortably supports the target, so deliver it. Coming in far under
  ${targetWords} words from a source this size means you summarized instead of re-reporting.
  Never invent detail or pad; the material is all below.`
        : `- The target is about ${targetWords} words but the source below runs only about
  ${srcWords} words. Do not stretch it — cover everything it says and stop. Never invent
  detail, speculate, or pad to reach a number the source cannot support.`
      : `- The word count is a target, not a quota — but falling short of it usually means you have
  not read enough of the story, not that the story is thin. Before settling for less, search
  again for more of this same story: its headline, its distinctive phrases, names it
  mentions, each scoped to ${source.domain}. Only when that still leaves you without
  material, write less. Never invent detail, speculate, or pad to reach the number.`;

    return `${intro}

Write YOUR OWN English article reporting that story.

SOURCE — what you may draw on
- Build the article from one source article, the one you opened. Other search results will
  cover the same event; do not fold their details, figures or framing into it. If they say
  something different, that is not yours to merge or reconcile.
- Write only what your source reports. Do not add background, context, analysis or scene
  detail out of your own knowledge, however likely it seems. If a fact is not in what you
  read, it does not go in the article.
- Never copy sentences or distinctive phrases from the source. Re-report the facts in fresh
  wording.
- Restructure freely. Do not follow the source's paragraph or sentence order, and do not
  rebuild its sentences with words swapped out. Decide for yourself what to lead with.

FACTS — what has to be exactly right
- Copy the names of people, institutions, journals and instruments exactly as they appear,
  accents and diacritics included — Börk, not Bork. Never reorder, translate, expand,
  abbreviate or reconstruct a name, and never attach a person to a different institution
  than the one the story gives them.
- Copy figures exactly as the source states them. "50 years" must not soften into "more than
  40 years"; a number the source commits to is not yours to round or hedge.
- Whenever one party does something to another — demands, refuses, sanctions, sues, rejects,
  pays — name both parties and check which way round it goes before writing the sentence.
  Reversing who demanded and who refused is a factual error, not a wording choice.
- Attribute every claim, argument and figure to whoever actually made it. Never merge two
  people's positions into one, and never move one source's argument to a different speaker.
- The date on an article is when it was published, nothing more. Do not turn it into the date
  of an event. If an article dated 7 August reports that researchers announced something,
  that does not mean they announced it on 7 August — the announcement may be months older.
  Give a date for an event only when the story states that date; otherwise write the sentence
  without a date rather than reaching for the one you have.
- Quote a person directly only if you found that exact quote. Never invent a quote or put
  words in a named person's mouth. When unsure, paraphrase with attribution.
- Keep each quotation in the context where it appears. A quote said about one topic must not
  be moved next to a different topic, where it would seem to be about that instead.
- Keep the source's degree of certainty exactly. If researchers are "considering" or
  "wondering about" something, do not upgrade it to "developing" or "building"; a "may" or
  "could" must not become a "will". Firming up a hedge is a factual error.
- The same in the other direction: what has already happened must not slide into the future
  tense. Lawsuits that were filed are not lawsuits that "are expected"; a completed decision
  is not "planned". Demoting a done fact to a forecast is a factual error too.
- If the story shows genuine disagreement, report both positions, say who holds each, and
  give the evidence each side cites — the figures, the studies, the documents — not just the
  position it leads them to. Do not manufacture a disagreement the story does not show, and
  do not dress a fringe claim up as an equal side.

SHAPE — how the article is built
- Before writing, work out what the story is about — not its topic, but its tension: who
  wants what, who is resisting, what is at stake, what changed. Say it to yourself in one
  sentence. Then make the article serve that sentence: a reader who finishes your version
  should answer "so what is the dispute, and between whom?" the same way a reader of the
  original would. An article that lists correct facts but loses this is a failed rewrite.
- Keep each actor attached to their stake. Who demanded, who refused, who opposes, who is
  blamed, whose money or land or job is on the line — these relationships are the story.
  A fact that does not serve the story's own question is the fact to cut, even if true.
- The first paragraph says what makes this news now: the specific thing that happened — a
  ruling, a filing, a vote, a finding, an announcement — and who did it. Give its date there
  when the story supplies one. Do not open with general background on the field; background
  comes after the reader knows what happened.
- Length: ${lengthSpec}. Use paragraphs of three to five sentences.
- Cover the source from start to END. Before writing, map its sections in order and budget
  your paragraphs across all of them — at least one for each major section, and never spend
  more than half your article on the first half of the source. The back half of a long piece
  is usually where its news lives (unpublished results, this year's developments), so
  reaching it is not optional. Running out of room having covered only the opening is a
  failed article, not a shorter one.
- If the headline joins ideas with "or", "and", "but" or "vs", every element it names must
  appear in your article. A piece titled "Pain or Pleasure" that never mentions pleasure has
  failed, whatever else it got right.
- If the headline poses a question or stakes a claim — "why X", "how Y", "X won't hold up" —
  answering it IS the assignment. At least half your paragraphs must deliver the source's own
  answer: the named cases, laws, filings, actors and mechanisms it cites. "Experts think it
  is vulnerable" is a one-line nod, not an answer; which law, which provision, violated how —
  that is where the information lives.
- Every paragraph must carry something no earlier paragraph carried. Before writing each one,
  ask what it adds. If it would make a point you already made in different words, do not
  write it — write a shorter article instead.
- Ground each paragraph in something specific: a figure, a date, a named person or
  organisation, a study, a concrete example. A paragraph that only asserts something in
  general terms is the paragraph to cut.
- When you do have to cut, keep every quantitative comparison and contrast the source
  draws — X is high while Y is low, estimates range from A to B, one result agrees and
  another conflicts. Those carry the findings. Equipment specifications and dimensions are
  the first thing to drop, not the last.
- Do not close by restating your opening. Say what happens next, and stop.
${quotaRule}

STYLE — how it should read
- First identify what the source IS. The plain-news register below applies to news
  reporting. If the source is a satirical column, a humor piece or a voiced essay, match
  ITS register instead: say what it is up front (a satirical column by X), keep its jokes
  as jokes and its irony as irony, and follow the piece's own arc rather than forcing a
  news lead onto it. A deliberately absurd example — a gag that breaks its own list — must
  never be flattened into a neutral factual claim; converted that way, a joke reads as an
  error. Satire re-reported as straight news has lost the story.
- Reading level: ${levelSpec}
- Write plain news English, the way an AP or NPR reporter writes: concrete nouns, active
  verbs, people doing things. If a wire reporter would not write a phrase, do not write it.
- Do not stack abstract nouns. Constructions like "an institutional obligation to adhere to
  evidentiary standards" or "the central narrative surrounding heritage preservation" are not
  journalism, they are padding. Write who did what instead, in the plainest words that are
  still accurate.
- Name the people involved and say what they do. Do not leave them as "officials",
  "researchers", "experts" or "critics" when the story gives you their names.

OUTPUT
- Plain text in every field. No markdown, no bold, no headings, and no citation markers such
  as [1] or [2.1.1] — those are search artefacts, not part of an article.
- "url" is the exact address of the story you reported. Never assemble, guess or complete an
  address; leave it empty instead.
- "related" holds up to 5 OTHER real stories you saw from ${source.label}, each with its own
  published headline and a real address you actually saw. Exclude the story you reported.
  Drop an entry rather than guess its address. If you saw none, use an empty array.

Reply with JSON and nothing else. No markdown fences, no preamble.
{
 "title": "the English headline you wrote",
 "titleKo": "한국어 제목",
 "outlet": "${source.label}",
 "url": "exact address of the story, or an empty string if you do not have it",
 "published": "YYYY-MM-DD",
 "summaryKo": "한 문장 한국어 요약",
 "paragraphs": ["...", "...", "..."],
 "keywords": [{"word": "...", "ko": "...", "note": "기사 속 쓰임 한 줄"}],
 "related": [{"title": "original headline", "titleKo": "한국어 제목", "url": "canonical URL"}]
}
Exactly 5 keywords, chosen for a Korean learner of English.${
      full
        ? `

SOURCE TEXT — the complete story. Work only from this:

${full.paragraphs.join("\n\n")}`
        : ""
    }`;
  };

  const call = (promptText, schema, useSearch) =>
    gemini({
      geminiKey,
      proxy,
      proxyToken,
      model: MODELS.news,
      // 긴 분량은 검색 경로에서는 여러 번 캐야 하고, 전문 경로에서도 1500단어를
      // 원문 전 구간에 배분하는 설계가 필요합니다. 둘 다 생각이 드는 일이라
      // 길게일 때는 경로와 무관하게 medium 을 씁니다.
      thinkingLevel: length === "long" ? "medium" : "low",
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      // 전문이 있으면 검색을 끕니다. 다른 기사가 섞일 통로가 사라지고, 검색
      // 주입 입력과 그라운딩 호출 비용도 함께 사라집니다.
      tools: useSearch ? [{ google_search: {} }] : undefined,
      schema,
    });

  // 후보 하나를 놓고 기사를 써 봅니다. 못 쓰면 이유를 돌려주고, 부르는 쪽이
  // 다음 후보로 넘어갑니다.
  async function attempt(chosen) {
    // 프록시가 있으면 기사 전문을 먼저 가져와 봅니다. 실패하면 검색 경로입니다.
    let full = null;
    if (chosen?.url && proxy) {
      tick("기사 전문을 가져오는 중…");
      full = await fetchFullText(chosen.url, proxy, proxyToken);
      if (full?.dead) {
        // 주소가 죽어 있으면 이 후보로는 기사를 쓰지 않습니다. 다음 후보로.
        logIssue("후보주소사망", source?.id, chosen.url);
        return { fail: "error" };
      }
      tick(
        full
          ? `전문 ${full.paragraphs.length}문단 확보 · 다시 쓰는 중…`
          : "전문을 가져오지 못해 검색으로 읽는 중…"
      );
    }
    const useSearch = !full;
    const promptText = buildPrompt(chosen, full);

    // 검색 그라운딩과 스키마를 함께 쓰는 것은 아직 미리보기라, 거부당하면
    // 스키마 없이 한 번 더 시도합니다. 프롬프트에 형식이 적혀 있어 동작합니다.
    let text, cand;
    try {
      ({ text, cand } = await call(promptText, ARTICLE_SCHEMA, useSearch));
    } catch (e) {
      if (e.status !== 400 || !/schema|response_?format/i.test(e.message)) throw e;
      ({ text, cand } = await call(promptText, undefined, useSearch));
    }
    let article = tryParse(text);

    // 그라운딩을 되살리려는 재시도는 호출을 두 배로 늘립니다. 목록에서 고른
    // 기사는 주소를 이미 들고 있으므로 그라운딩이 없어도 아쉬울 것이 없어,
    // 후보 없이 한 번에 찾아 쓰는 경로에서만 재시도합니다.
    if (!chosen && !grounded(cand)) {
      try {
        const plain = await call(promptText, undefined, useSearch);
        const parsed = tryParse(plain.text);
        if (parsed && grounded(plain.cand)) {
          article = parsed;
          cand = plain.cand;
        }
      } catch {
        /* 처음 응답을 그대로 씁니다 */
      }
    }

    if (!article) {
      console.warn("[nt-attemptfail]", source?.id, full ? "전문" : "검색", chosen?.url, "parse");
      logIssue("응답파싱실패", source?.id, (full ? "전문 " : "검색 ") + (chosen?.url || ""));
      return { fail: "parse" };
    }
    // 전문 모드에서는 검색이 없으므로 "찾지 못했다"는 error 선언이 성립하지
    // 않습니다. 본문을 써 놓고 습관적으로 error 를 채우는 경우가 있어, 본문이
    // 있으면 선언을 무시하고 진행합니다.
    if (article.error && full && (article.paragraphs || []).length) {
      console.warn("[nt-attemptfail]", source?.id, "전문 모드의 무의미한 error 선언 무시", chosen?.url);
      logIssue("무의미한error무시", source?.id, chosen?.url || "");
      article.error = "";
    }
    if (article.error) {
      console.warn("[nt-attemptfail]", source?.id, full ? "전문" : "검색", chosen?.url, "error:", article.error);
      logIssue("기사열기실패", source?.id, (full ? "전문 " : "검색 ") + article.error);
      return { fail: "error" };
    }
    // 전문을 실제로 받아왔다면 그 주소는 살아 있음이 증명된 것입니다.
    return { article, cand, aliveUrl: full ? chosen?.url : null };
  }

  // 1번 후보를 열지 못하는 일이 있습니다. 유료 장벽이 대표적입니다. 목록에
  // 다른 후보가 있는데 거기서 끝내면 아무것도 못 읽게 되므로 다음 후보로
  // 넘어갑니다. 매번 새로 부르는 비싼 호출이라 두 번까지만 시도합니다.
  const attempts = picked ? (listed.length ? listed.slice(0, 2) : [picked]) : [null];

  let article = null;
  let cand = null;
  let aliveUrl = null;
  let lastFail = "error";
  let nth = 0;
  for (const chosen of attempts) {
    if (nth++ > 0) tick("첫 기사를 열지 못해 다음 후보로 넘어가는 중…");
    const r = await attempt(chosen);
    if (r.article) {
      article = r.article;
      cand = r.cand;
      aliveUrl = r.aliveUrl || null;
      // 실제로 쓴 기사를 기준으로 주소와 관련 기사를 정합니다.
      if (chosen) {
        picked = chosen;
        listed = [chosen, ...listed.filter((x) => x.url !== chosen.url)];
      }
      break;
    }
    lastFail = r.fail;
  }

  if (!article) {
    throw new Error(
      lastFail === "parse"
        ? "모델 응답을 읽지 못했습니다. 다시 시도해 주세요."
        : "기사를 열지 못했습니다. 다시 시도하거나 매체를 바꿔 보세요."
    );
  }

  // 화면은 paragraphs 를 그대로 렌더링하므로, 여기서 모양을 보장하지 않으면
  // 모델이 형식을 어겼을 때 렌더링 도중 터져 빈 화면이 됩니다.
  article.title = stripMarkers(article.title);
  article.titleKo = stripMarkers(article.titleKo);
  article.summaryKo = stripMarkers(article.summaryKo);

  article.paragraphs = (Array.isArray(article.paragraphs) ? article.paragraphs : [])
    .map(stripMarkers)
    .filter(Boolean);
  if (article.paragraphs.length === 0)
    throw new Error("기사 형식이 올바르지 않습니다. 다시 시도해 보세요.");

  article.keywords = (Array.isArray(article.keywords) ? article.keywords : [])
    .filter((k) => k && typeof k.word === "string")
    .map((k) => ({ ...k, word: stripMarkers(k.word), ko: stripMarkers(k.ko), note: stripMarkers(k.note) }));

  // 그라운딩이 실제로 열어본 주소입니다. 모델이 적어 낸 것과 달리 존재가 보장됩니다.
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  article.sources = chunks
    .map((c) => c.web && { title: c.web.title, uri: safeUrl(c.web.uri) })
    .filter((c) => c && c.uri)
    .slice(0, 4);

  // 목록 단계에서 고른 기사의 주소가 1순위입니다. 검색 결과에서 나온 실제
  // 주소이고 발행사 도메인 검사까지 통과한 것입니다. 그다음이 그라운딩 주소,
  // 마지막이 모델이 이번 응답에 적어 낸 주소입니다.
  article.url =
    aliveUrl ||
    article.sources[0]?.uri ||
    picked?.url ||
    onDomain(article.url, source.domain) ||
    "";

  // 발행일도 목록 단계 값이 더 믿을 만합니다. 검색 결과에 붙어 오는 값입니다.
  if (picked?.published) article.published = picked.published;

  // 마지막 안전벨트입니다. 표시하려는 주소가 "실제로 열린 적 있음"이 증명되지
  // 않았다면(전문 추출 성공 = 증명, 그라운딩 주소 = 구글이 연 것 = 증명),
  // 표시 직전에 생존을 한 번 확인합니다. 상류 검사 어느 한 겹이 어떤 이유로
  // 건너뛰어져도 죽은 주소가 화면까지 오지 못합니다.
  const urlProven =
    article.url &&
    (article.url === aliveUrl || article.sources.some((c) => c.uri === article.url));
  if (article.url && !urlProven && proxy) {
    const deadOne = await deadUrls([article.url], proxy, proxyToken);
    if (deadOne?.has(article.url)) {
      logIssue("지어낸주소제거", source?.id, article.url);
      article.url = "";
    }
  }

  // 주소가 끝내 비면 화면이 "출처를 확인하지 못했습니다" 경고를 띄웁니다.
  // 여기서 기사를 막지는 않습니다. 위험은 알리되 앱은 쓸 수 있어야 합니다.

  // 목록을 받아 왔다면 나머지 후보가 곧 관련 기사입니다. 검색에서 나온 주소라
  // 모델이 이번 응답에 적어 낸 것보다 믿을 만합니다.
  const leftovers = listed
    .slice(1)
    .map((r) => ({ title: r.title, titleKo: "", url: r.url }))
    .filter((r) => r.url && r.url !== article.url);

  article.related = leftovers.length
    ? leftovers.slice(0, 5)
    : (Array.isArray(article.related) ? article.related : [])
        .map((r) => ({
          title: stripMarkers(r?.title),
          titleKo: stripMarkers(r?.titleKo),
          url: onDomain(r?.url, source.domain) || "",
        }))
        .filter((r) => r.title && r.url && r.url !== article.url && looksLikeArticleUrl(r.url))
        .slice(0, 5);

  return article;
}

/* ------------------------------------------------------------------ *
 * 기사 목록 — 원문을 직접 읽을 때 무엇을 읽을지 고르는 용도
 * ------------------------------------------------------------------ */

const STORIES_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The story's own published headline, in English. Do not rewrite it.",
          },
          url: {
            type: "string",
            description:
              "Required. Canonical URL of the story on the publisher's own site. " +
              "Never a search page, homepage, redirect or guessed address.",
          },
          published: { type: "string", description: "Publication date as YYYY-MM-DD." },
          summaryKo: {
            type: "string",
            description: "KOREAN ONLY. One sentence on what the story is about.",
          },
          relevance: {
            type: "integer",
            description:
              "0 to 100. How directly this headline is about the topic the reader asked " +
              "for: 100 means the headline is squarely about it, 0 means unrelated. " +
              "When the reader asked for nothing in particular, set it to 0 — it is unused.",
          },
          matchesRequest: {
            type: "boolean",
            description:
              "Only meaningful when the reader asked for a particular topic. true if this " +
              "story is about that topic or clearly connected to it, false if it is not. " +
              "Judge honestly: a false here is more useful than a wrong true, because a " +
              "false one is dropped and a wrong true is what the reader ends up reading. " +
              "When the reader asked for nothing in particular, set it to true.",
          },
        },
        required: ["title", "url", "published", "summaryKo", "matchesRequest", "relevance"],
      },
    },
  },
  required: ["stories"],
};

// 본문은 가져오지 않습니다. 무엇이 있는지 제목과 링크만 알려줍니다.
export async function findStories({ geminiKey, proxy, proxyToken, source, topic, focus, exclude }) {
  // 키워드가 있으면 최신순이 아니라 관련순으로 찾아야 합니다. 발행 기간까지
  // 좁게 걸면 그 주제 기사가 그 며칠 안에 없다는 이유로 매번 빈손이 됩니다.
  const recency = source.window || "the last few days";

  const goal = focus
    ? `Find articles on ${source.domain} whose headline is about ${focus}.

Being about ${focus} is a requirement, not a ranking: include a story only if its headline
or subject really is about it, and drop everything else. Among the stories that qualify,
newer is better — order them newest first, and reach back months only when nothing recent
qualifies. If only two qualify, list two. If none do, return an empty list — an unrelated
story is not a fallback.`
    : `List what ${source.label} has published most recently on ${topic}, newest first.

Order by publication date, newest first. I want what they have just put out, not their
best-known or most-read pieces. Prefer ${recency}; if that window turns up almost nothing,
reach further back rather than returning an empty list — for a low-volume section, an older
story beats no story.`;

  const prompt = `Use Google Search on ${source.label}'s own site. ${goal}

FINDING THEM
- Put site:${source.domain} in your queries, and run several queries with different wording
  rather than one. Different phrasings surface different articles.
- Every story must live on ${source.domain}. Another outlet's coverage of the same event does
  not count, however good it is.
- Skip pages that are not articles: dashboards, tag and topic hubs, category and section
  pages, live blogs, galleries, video and podcast pages. Everything else is fair game — do
  not skip a story just because the result did not show a byline. Most will not.

WHAT TO REPORT BACK
- "title" is the story's own published headline, copied exactly. Do not rewrite, shorten or
  translate it.
- "url" is the article's own address as you saw it. Never assemble, guess or complete an
  address — drop the story instead. A link that 404s is worse than a shorter list.
- "published" is when the article was published, not when the events in it happened.
- "summaryKo" is one short Korean sentence on what the story is about. Do not summarise the
  body beyond that; you are not writing the article yet.
- "relevance" and "matchesRequest" are your own judgement about the reader's topic. Answer
  honestly — a story marked false is dropped, but a wrong true is what the reader ends up
  reading.

List up to 8 candidates.

Reply with JSON and nothing else:
{"stories": [{"title": "...", "url": "...", "published": "YYYY-MM-DD", "summaryKo": "...", "matchesRequest": true, "relevance": 0}]}`;

  // 생각을 minimal 로 깎았더니 모델이 검색 도구를 집지 않고 기억으로 목록을
  // 만드는 일이 잦아졌습니다. 도구를 쓸지 말지도 생각의 일부라, 절약이 검색
  // 자체를 없애 버립니다. low 로 둡니다.
  const listCall = (schema, level = "low", preface = "", model = source.heavyList ? MODELS.news : MODELS.list) =>
    gemini({
      geminiKey,
      proxy,
      proxyToken,
      model,
      thinkingLevel: level,
      // 생각 토큰이 출력 상한을 함께 깎을 수 있습니다(공식 문서도 "여유 있게
      // 잡고 finishReason 을 보라"고만 합니다). 재시도에서 생각을 medium 으로
      // 올린 뒤 2500 이 잘리기 시작해 여유를 크게 둡니다. 상한은 안전판일 뿐,
      // 목록 JSON 자체는 1~2천 토큰이면 끝납니다.
      maxOutputTokens: 8000,
      contents: [{ role: "user", parts: [{ text: preface + prompt }] }],
      tools: [{ google_search: {} }],
      schema,
    });

  // 허위 기사가 목록에 들어오는 경로는 모델이 검색을 하지 않고 기억으로
  // 목록을 지어내는 것이고, 그 경우 응답에 그라운딩 정보가 없습니다. 다만
  // 스키마와 검색을 함께 쓰면 검색을 했는데도 그라운딩이 빠져 오는 일이
  // 있습니다("길게" 오류의 원인이던 그 조합입니다). 그래서 그라운딩이 없으면
  // 바로 실패로 보지 않고 스키마 없이 다시 불러 확인합니다. 그 경로는
  // 그라운딩이 보존되므로, 거기서도 없어야 지어낸 것으로 판단합니다.
  // 검색 증거(인용, 검색어 기록)를 하드 조건으로 걸어 봤지만, 증거가 안 붙어
  // 오는 정상 응답이 실전에서 계속 나와 세 번 연속 기능을 막았습니다. 증거가
  // 없으면 조건을 바꿔 한 번 더 시도해 보되, 그래도 없으면 목록을 받아들입니다.
  // 허위 목록은 하류가 잡습니다. 도메인과 주소 모양 검사, 워커 링크 검사,
  // 그리고 집필 단계가 제목을 검색해 흔적이 없으면 다음 후보로 넘어갑니다.
  // lite 에서 스키마와 검색을 함께 쓰는 조합이 거부(400)될 수 있습니다. 집필
  // 쪽에는 이 폴백이 있는데 목록에는 없어서, 거부가 나면 목록이 통째로 실패해
  // 조용히 옛 경로로 떨어졌습니다. "출처를 확인하지 못했습니다" 경고의 유력한
  // 진원지입니다. 스키마 없이 다시 부르면 프롬프트의 형식 지시로 동작합니다.
  let text, cand;
  try {
    ({ text, cand } = await listCall(STORIES_SCHEMA));
  } catch (e) {
    if (e.status !== 400 || !/schema|response_?format/i.test(e.message)) throw e;
    ({ text, cand } = await listCall(undefined));
  }
  if (!searched(cand)) {
    try {
      // 재시도는 조건을 전부 올립니다. 스키마 제거, 생각 상향, 그리고 모델도
      // 큰 쪽으로. 같은 조건으로 다시 부르면 같은 결과가 나오기 쉽습니다.
      const plain = await listCall(
        undefined,
        "medium",
        "Your previous attempt answered from memory without running Google Search. That is " +
          "not acceptable: every story must come from an actual search you run now.\n\n",
        MODELS.news
      );
      // 재시도가 낫다고 볼 근거(검색 증거)가 있고 파싱도 되면 그쪽을 씁니다.
      if (searched(plain.cand) && tryParse(plain.text)) ({ text, cand } = plain);
      else if (!tryParse(text) && tryParse(plain.text)) ({ text, cand } = plain);
    } catch {
      // 재시도가 실패해도 첫 응답으로 계속합니다.
    }
  }

  const parsed = extractJson(text);
  // 8건을 받아 거른 뒤 5건만 남깁니다. 여유를 두지 않으면 주소나 관련성 검사에서
  // 빠진 만큼 목록이 그대로 짧아집니다.
  let list = (Array.isArray(parsed?.stories) ? parsed.stories : [])
    .map((s) => ({
      title: stripMarkers(s?.title),
      published: stripMarkers(s?.published),
      summaryKo: stripMarkers(s?.summaryKo),
      url: onDomain(s?.url, source.domain) || "",
      matchesRequest: s?.matchesRequest !== false,
      relevance: Number.isFinite(s?.relevance) ? s.relevance : 0,
    }))
    .filter((s) => s.title && s.url)
    // 주소 모양으로 기사가 아닌 페이지를 거릅니다. 모델에게 "허브를 쓰지 마라" 고
    // 부탁하는 것과 달리 이쪽은 무시될 수 없습니다.
    .filter((s) => looksLikeArticleUrl(s.url))
    // 관련성 판단을 지시로만 두면 무시될 때 걸러낼 방법이 없습니다. 모델이
    // 항목마다 스스로 내린 판단을 받아 여기서 실제로 걸러냅니다.
    .filter((s) => !focus || s.matchesRequest)
    ;

  // 최근에 읽은 기사는 뺍니다. 같은 조건으로 다시 눌렀을 때 같은 글이 나오지
  // 않게 하는 가장 확실한 방법입니다. 다만 그것 때문에 후보가 전부 사라지면
  // 제외를 포기합니다. 같은 기사를 다시 보는 편이 아무것도 못 읽는 것보다 낫습니다.
  const fresh = list.filter((s) => !exclude?.includes(s.url));
  if (fresh.length) list = fresh;

  // 정렬도 부탁만 하면 무시될 수 있으므로 코드에서 다시 세웁니다. 관련성은
  // matchesRequest 필터로 이미 자격 검사를 통과했으므로, 순위는 키워드가 있든
  // 없든 발행일 최신순입니다. 키워드가 있을 때 관련도 점수는 날짜가 같거나
  // 없을 때의 동률 판정에만 씁니다. 판단은 모델이 하지만 순서는 코드가 정합니다.
  const at = (d) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? 0 : t;
  };
  list.sort((a, b) => {
    const byDate = at(b.published) - at(a.published);
    if (byDate !== 0) return byDate;
    return focus ? b.relevance - a.relevance : 0;
  });

  // 정렬한 뒤 위에서부터 링크가 살아 있는지 확인하고, 확실히 죽은 것만 뺍니다.
  // 자르기 전에 해야 죽은 링크가 빠진 만큼 아래 후보가 올라옵니다.
  const dead = await deadUrls(
    list.map((s) => s.url),
    proxy,
    proxyToken
  );
  // 검사기가 정상 응답으로 전멸을 선고했다면 그것은 진실입니다. 모델이 목록
  // 전체를 지어냈을 때가 그렇습니다(SciNews 에서 실제 발생). 예전에는 오판으로
  // 보고 목록을 살렸는데, 그 가드가 지어낸 주소를 통과시켰습니다. 검사기 자체가
  // 실패하면 dead 가 null 이라 어차피 검사를 건너뜁니다.
  const alive = dead ? list.filter((s) => !dead.has(s.url)) : list;
  if (dead && list.length && !alive.length)
    logIssue("목록전멸", source?.id, `${list.length}건 전부 사망 판정 — 지어낸 목록으로 봄`);
  const top = alive.slice(0, 5);

  if (!top.length) {
    // 다음 보고 때 어느 단계에서 비었는지 바로 알 수 있게 남깁니다.
    const raw = Array.isArray(parsed?.stories) ? parsed.stories.length : 0;
    logIssue(
      "목록상세",
      source?.id,
      `모델 ${raw}건 → 필터 후 ${list.length}건, 검색증거 ${searched(cand) ? "있음" : "없음"}`
    );
  }
  if (!top.length)
    throw new Error(
      focus
        ? `"${focus}" 관련 기사를 찾지 못했습니다. 매체나 조건을 바꿔 보세요.`
        : "기사를 찾지 못했습니다. 조건을 바꿔 보세요."
    );
  return top;
}

/* ------------------------------------------------------------------ *
 * 사전 · 문장 해석 · 대화
 * ------------------------------------------------------------------ */

// 설명은 한국어로 나와야 공부가 됩니다. 시스템 프롬프트만으로는 가끔 영어로
// 새기 때문에, 필드마다 어느 언어인지 스키마에 직접 박아 둡니다.
const WORD_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string", description: "The English word being looked up." },
    base: { type: "string", description: "Dictionary base form, in English." },
    pos: { type: "string", description: "Part of speech, in KOREAN (예: 명사, 타동사, 형용사)." },
    ipa: { type: "string", description: "IPA pronunciation between slashes." },
    ko: {
      type: "string",
      description: "KOREAN ONLY. The meaning this word carries in the given sentence. Must not be English.",
    },
    en: { type: "string", description: "A short definition, in English." },
    inContext: {
      type: "string",
      description: "KOREAN ONLY. One sentence on why it takes that meaning here. Must not be English.",
    },
    example: { type: "string", description: "A different example sentence, in English." },
    exampleKo: {
      type: "string",
      description: "KOREAN ONLY. Translation of the example sentence. Must not be English.",
    },
    related: {
      type: "array",
      items: { type: "string" },
      description: "Three English synonyms or collocations. English words, not Korean.",
    },
  },
  required: ["word", "base", "pos", "ipa", "ko", "en", "inContext", "example", "exampleKo", "related"],
};

const SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    translation: { type: "string", description: "KOREAN ONLY. A natural Korean translation." },
    literal: {
      type: "string",
      description: "KOREAN ONLY. A literal Korean translation that exposes the structure.",
    },
    structure: {
      type: "string",
      description: "KOREAN ONLY. One line on the sentence structure (예: 주절 + 분사구문).",
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "KOREAN ONLY. Two or three grammar or usage points, each a Korean sentence.",
    },
    expressions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          phrase: { type: "string", description: "The English phrase, quoted from the sentence." },
          meaning: { type: "string", description: "KOREAN ONLY. What that phrase means." },
        },
        required: ["phrase", "meaning"],
      },
    },
  },
  required: ["translation", "literal", "structure", "notes", "expressions"],
};

export async function lookupWord({ geminiKey, proxy, proxyToken, word, sentence }) {
  const { text } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.lookup,
    thinkingLevel: "minimal",
    maxOutputTokens: 1200,
    schema: WORD_SCHEMA,
    system:
      "You are an English-Korean dictionary for an advanced Korean learner. " +
      "Every explanation must be written in Korean: pos, ko, inContext and exampleKo are " +
      "Korean and must never come back in English. Only word, base, ipa, en, example and " +
      "related hold English. The learner is studying English, so explaining in English " +
      "defeats the purpose.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Word: "${word}"
Sentence it appears in: "${sentence}"

Give the meaning this word carries in that sentence, not its most common meaning.
"base" is the dictionary form, "pos" is the part of speech in Korean,
"inContext" is one sentence on why it means that here,
"example" is a different example sentence, and "related" is 3 synonyms or collocations.`,
          },
        ],
      },
    ],
  });
  return extractJson(text);
}

// 관용구는 단어 뜻을 아무리 합쳐도 안 나옵니다. 직역과 실제 뜻을 나란히
// 보여주는 게 핵심이라 사전과 항목을 다르게 잡습니다.
const PHRASE_SCHEMA = {
  type: "object",
  properties: {
    phrase: { type: "string", description: "The English expression, as it appears." },
    base: {
      type: "string",
      description:
        "The dictionary form of the expression in English, with a placeholder where it takes " +
        "an object (e.g. 'take (something) for granted'). Same as phrase if there is none.",
    },
    kind: {
      type: "string",
      description:
        "KOREAN ONLY. What kind of expression it is: 관용구, 구동사, 연어, 비유 표현, " +
        "일반 표현 중 하나로 답하세요.",
    },
    ko: { type: "string", description: "KOREAN ONLY. What it actually means here." },
    literal: {
      type: "string",
      description:
        "KOREAN ONLY. What the words say if taken literally, so the learner can see the gap. " +
        "If it is not figurative, say 직역과 뜻이 거의 같습니다.",
    },
    inContext: {
      type: "string",
      description: "KOREAN ONLY. One sentence on what it is doing in this sentence.",
    },
    example: { type: "string", description: "A different example sentence, in English." },
    exampleKo: { type: "string", description: "KOREAN ONLY. Translation of that example." },
    related: {
      type: "array",
      items: { type: "string" },
      description: "Two or three English expressions with a similar meaning.",
    },
  },
  required: [
    "phrase", "base", "kind", "ko", "literal", "inContext", "example", "exampleKo", "related",
  ],
};

const PHRASES_SCHEMA = {
  type: "object",
  properties: {
    phrases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "The expression exactly as it appears in the text, copied character for " +
              "character including its inflection. It must be findable in the text as written.",
          },
          ko: { type: "string", description: "KOREAN ONLY. A short meaning, a few words." },
        },
        required: ["text", "ko"],
      },
    },
  },
  required: ["phrases"],
};

// 어디가 관용구인지 알아야 찍을 수 있는데, 모르니까 찾아보는 것입니다.
// 그래서 기사에서 먼저 찾아 표시해 줍니다.
export async function findPhrases({ geminiKey, proxy, proxyToken, paragraphs }) {
  const text = (Array.isArray(paragraphs) ? paragraphs : []).join("\n\n");
  if (!text.trim()) return [];

  const { text: out } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.lookup,
    thinkingLevel: "minimal",
    maxOutputTokens: 1600,
    schema: PHRASES_SCHEMA,
    system:
      "You find English expressions worth learning, for an advanced Korean learner. " +
      "The ko field must be Korean.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Find the expressions in this text that a Korean learner could not work out by
adding up the individual word meanings — idioms, phrasal verbs, figurative expressions and
strong collocations.

Rules
- Only multi-word expressions. Skip single words.
- Skip plain noun phrases and proper nouns that mean exactly what they say.
- Copy each expression exactly as it appears, including its inflection. Do not give the
  dictionary form, because it has to be found in the text as written.
- At most 12, the most useful first. If there are none, return an empty list.

TEXT
${text}`,
          },
        ],
      },
    ],
  });

  const parsed = extractJson(out);
  return (Array.isArray(parsed?.phrases) ? parsed.phrases : [])
    .map((p) => ({
      text: typeof p?.text === "string" ? p.text.trim() : "",
      ko: typeof p?.ko === "string" ? p.ko.trim() : "",
    }))
    // 본문에 실제로 있는 것만 남깁니다. 없는 것은 표시할 자리가 없습니다.
    .filter((p) => p.text.length >= 3 && text.toLowerCase().includes(p.text.toLowerCase()))
    .slice(0, 12);
}

export async function lookupPhrase({ geminiKey, proxy, proxyToken, phrase, sentence }) {
  const { text } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.lookup,
    thinkingLevel: "minimal",
    maxOutputTokens: 1400,
    schema: PHRASE_SCHEMA,
    system:
      "You explain English expressions to an advanced Korean learner. Every explanation must " +
      "be written in Korean and must never come back in English. Only phrase, base, example " +
      "and related hold English.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Expression: "${phrase}"
Sentence it appears in: "${sentence}"

Explain what this expression means here. If the learner could not work it out by adding up
the individual word meanings, that gap is the most important thing to explain.`,
          },
        ],
      },
    ],
  });
  return extractJson(text);
}

export async function lookupSentence({ geminiKey, proxy, proxyToken, sentence }) {
  const { text } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.lookup,
    thinkingLevel: "minimal",
    maxOutputTokens: 1400,
    schema: SENTENCE_SCHEMA,
    system:
      "You explain English sentences to an advanced Korean learner. Write every field in " +
      "Korean. The only English allowed is expressions[].phrase, which quotes the sentence " +
      "itself. Never explain in English — the learner is studying English, so a Korean " +
      "explanation is the whole point.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Sentence: "${sentence}"

"translation" is a natural Korean translation, "literal" is a literal one that shows the structure,
"structure" is a one-line summary of the sentence structure (예: 주절 + 분사구문),
"notes" is 2-3 grammar or usage points, and "expressions" lists notable phrases with their meanings.`,
          },
        ],
      },
    ],
  });
  return extractJson(text);
}

export async function discuss({ geminiKey, proxy, proxyToken, article, messages }) {
  const paragraphs = Array.isArray(article?.paragraphs) ? article.paragraphs : [];
  const body = paragraphs.length ? `${article.title}\n\n${paragraphs.join("\n\n")}` : "";

  // Gemini 는 어시스턴트 차례를 "model" 이라고 부릅니다. "assistant" 는 거부됩니다.
  const contents = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const { text } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.chat,
    thinkingLevel: "low",
    maxOutputTokens: 1500,
    contents,
    system:
      "You discuss a news article with a Korean learner of English. " +
      "Answer in whichever language the learner used. Keep replies under 120 words. " +
      // 말풍선은 서식 없는 텍스트만 그립니다. 마크다운을 보내면 별표가 글자로 보입니다.
      "Write plain text only. No markdown: no **bold**, no headings, no bullet or list syntax. " +
      "Answer the question directly. Do not open with a preamble announcing what you are " +
      "about to do. " +
      // 고칠 게 없는데 칭찬을 덧붙이면 매번 같은 말이 붙어 잔소리가 됩니다.
      "If the learner wrote in English and something was genuinely awkward or wrong, add one " +
      "short final line with a more natural version. If their English was already fine, add " +
      "nothing at all — do not praise it, do not offer alternatives.\n\n" +
      "ARTICLE\n" +
      body,
  });

  return text;
}
