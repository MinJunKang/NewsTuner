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

  // 기사 주소는 날짜를 담거나, 제목에서 온 하이픈 슬러그를 답니다.
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
  if (proxyToken) headers["X-App-Token"] = proxyToken;
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
const tryParse = (t) => {
  try {
    return extractJson(t);
  } catch {
    return null;
  }
};

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
  if (proxy && proxyToken) headers["X-App-Token"] = proxyToken;

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
    const res = await fetch(url, { method: "POST", headers, body: payload });
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  };

  let { res, data } = await send();

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
}) {
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
  const lengthSpec =
    {
      short: "about 400 words",
      mid: "about 800 words",
      long: "about 1500 words",
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
  if (!picked) {
    try {
      listed = await findStories({ geminiKey, proxy, proxyToken, source, topic, focus, exclude });
      // 항상 1번을 쓰면 조건이 같을 때 매번 같은 기사가 나옵니다. 상위 후보
      // 안에서 무작위로 고릅니다. 키워드가 있을 때는 관련도 순서가 의미를
      // 가지므로 범위를 좁게 잡습니다.
      const pool = listed.slice(0, focus ? 3 : 5);
      picked = pool[Math.floor(Math.random() * pool.length)];
      // 고른 기사를 목록 맨 앞으로 보내야 나머지가 관련 기사가 됩니다.
      listed = [picked, ...listed.filter((x) => x.url !== picked.url)];
    } catch (e) {
      // 키워드를 주셨을 때 예전 경로로 넘어가면 무관한 기사를 써 오므로 그대로
      // 알립니다. 실패 이유를 키워드 메시지로 덮지 않고 그대로 올립니다.
      // 덮으면 "검색이 수행되지 않았다" 같은 진짜 원인이 안 보입니다.
      if (focus) throw e;
      // 키워드가 없으면 예전처럼 한 번에 찾아 쓰는 경로로 갑니다.
      picked = null;
    }
  }

  // 관련 기사에서 고른 경우에는 새로 찾지 말고 그 기사를 그대로 다룹니다.
  // 기사는 목록 단계에서 이미 정해집니다. 그래서 이 프롬프트에는 "어느 기사를
  // 고를지" 를 넣지 않습니다. 넣어 두면 정해진 기사를 두고 다른 것을 찾으라는
  // 상반된 지시가 됩니다. 고르는 규칙은 목록을 못 받았을 때의 대체 경로에만 둡니다.
  // 프롬프트를 후보마다 다시 만듭니다. 1번 후보를 열지 못하면 다음 후보로
  // 넘어가야 하는데, 프롬프트를 한 번만 만들면 그럴 수가 없습니다.
  const buildPrompt = (chosen) => {
    const intro = chosen
      ? `Report this specific story, published by ${source.label}:
Headline: ${chosen.title}
Address: ${chosen.url}

Search for that headline on ${source.domain} to read the story. Search is how you reach it —
you cannot simply open the address.

This story is already chosen. Do not pick a different one, and do not treat other results
about the same event as sources for this piece. It came from a real search result, so it
exists: report it. Set "error" only if you can find no trace of this story at all, which
should be rare.`
    : `Use Google Search to find a real story published in ${recency} by ${source.label} on
the topic: ${topic}. Run several searches with different wording. site:${source.domain} is
one query worth trying, but if it returns little, search normally by outlet name and topic.
The story must be published on ${source.domain}; another outlet's coverage of the same event
does not count.

Skip pages that are not articles — dashboards, tag and topic hubs, category pages, live
blogs, galleries, video and podcast pages. Among what is left, take the one with the most
substantial reporting. You must open search results and report from them: if you find nothing
usable on ${source.domain}, set "error" rather than writing from memory.
${focusLine}`;
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
- Copy the names of people, institutions, journals and instruments exactly as they appear.
  Never reorder, translate, expand, abbreviate or reconstruct a name, and never attach a
  person to a different institution than the one the story gives them.
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
- If the story shows genuine disagreement, report both positions, say who holds each, and
  give the evidence each side cites — the figures, the studies, the documents — not just the
  position it leads them to. Do not manufacture a disagreement the story does not show, and
  do not dress a fringe claim up as an equal side.

SHAPE — how the article is built
- The first paragraph says what makes this news now: the specific thing that happened — a
  ruling, a filing, a vote, a finding, an announcement — and who did it. Give its date there
  when the story supplies one. Do not open with general background on the field; background
  comes after the reader knows what happened.
- Length: ${lengthSpec}. Use paragraphs of three to five sentences.
- Every paragraph must carry something no earlier paragraph carried. Before writing each one,
  ask what it adds. If it would make a point you already made in different words, do not
  write it — write a shorter article instead.
- Ground each paragraph in something specific: a figure, a date, a named person or
  organisation, a study, a concrete example. A paragraph that only asserts something in
  general terms is the paragraph to cut.
- Do not close by restating your opening. Say what happens next, and stop.
- The word count is a target, not a quota. If the story does not support that much material,
  write less. Never invent detail, speculate, or pad to reach the number.

STYLE — how it should read
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
Exactly 5 keywords, chosen for a Korean learner of English.`;
  };

  const call = (promptText, schema) =>
    gemini({
      geminiKey,
      proxy,
      proxyToken,
      model: MODELS.news,
      // 기본값은 medium 입니다. 생각 토큰은 출력 단가로 과금되고 이 호출이 가장
      // 비싸므로 low 로 낮춥니다. minimal 까지 내리면 검색 결과 종합이 부실해집니다.
      thinkingLevel: "low",
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      tools: [{ google_search: {} }],
      schema,
    });

  // 후보 하나를 놓고 기사를 써 봅니다. 못 쓰면 이유를 돌려주고, 부르는 쪽이
  // 다음 후보로 넘어갑니다.
  async function attempt(chosen) {
    const promptText = buildPrompt(chosen);

    // 검색 그라운딩과 스키마를 함께 쓰는 것은 아직 미리보기라, 거부당하면
    // 스키마 없이 한 번 더 시도합니다. 프롬프트에 형식이 적혀 있어 동작합니다.
    let text, cand;
    try {
      ({ text, cand } = await call(promptText, ARTICLE_SCHEMA));
    } catch (e) {
      if (e.status !== 400 || !/schema|response_?format/i.test(e.message)) throw e;
      ({ text, cand } = await call(promptText, undefined));
    }
    let article = tryParse(text);

    // 그라운딩을 되살리려는 재시도는 호출을 두 배로 늘립니다. 목록에서 고른
    // 기사는 주소를 이미 들고 있으므로 그라운딩이 없어도 아쉬울 것이 없어,
    // 후보 없이 한 번에 찾아 쓰는 경로에서만 재시도합니다.
    if (!chosen && !grounded(cand)) {
      try {
        const plain = await call(promptText, undefined);
        const parsed = tryParse(plain.text);
        if (parsed && grounded(plain.cand)) {
          article = parsed;
          cand = plain.cand;
        }
      } catch {
        /* 처음 응답을 그대로 씁니다 */
      }
    }

    if (!article) return { fail: "parse" };
    if (article.error) return { fail: "error" };
    return { article, cand };
  }

  // 1번 후보를 열지 못하는 일이 있습니다. 유료 장벽이 대표적입니다. 목록에
  // 다른 후보가 있는데 거기서 끝내면 아무것도 못 읽게 되므로 다음 후보로
  // 넘어갑니다. 매번 새로 부르는 비싼 호출이라 두 번까지만 시도합니다.
  const attempts = picked ? (listed.length ? listed.slice(0, 2) : [picked]) : [null];

  let article = null;
  let cand = null;
  let lastFail = "error";
  for (const chosen of attempts) {
    const r = await attempt(chosen);
    if (r.article) {
      article = r.article;
      cand = r.cand;
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
    picked?.url || article.sources[0]?.uri || onDomain(article.url, source.domain) || "";

  // 발행일도 목록 단계 값이 더 믿을 만합니다. 검색 결과에 붙어 오는 값입니다.
  if (picked?.published) article.published = picked.published;

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

Judge each candidate from its headline first. Order the list by how directly the headline is
about ${focus} — closest first, not newest first. Recency barely matters here; a good match
from a few months ago beats a loose one from yesterday. Include a story only if its headline
or subject really is about ${focus}. If only two qualify, list two. If none do, return an
empty list — an unrelated story is not a fallback.`
    : `List what ${source.label} has published most recently on ${topic}, newest first.

Order by publication date, newest first. I want what they have just put out, not their
best-known or most-read pieces. Stay within ${recency}.`;

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

  const listCall = (schema) =>
    gemini({
      geminiKey,
      proxy,
      proxyToken,
      model: MODELS.news,
      // 목록 만들기는 검색 결과에서 제목과 주소를 추리는 일이라 깊이 생각할
      // 필요가 없습니다. 생각 토큰은 출력 단가로 과금됩니다.
      thinkingLevel: "minimal",
      maxOutputTokens: 2500,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      schema,
    });

  // 허위 기사가 목록에 들어오는 경로는 모델이 검색을 하지 않고 기억으로
  // 목록을 지어내는 것이고, 그 경우 응답에 그라운딩 정보가 없습니다. 다만
  // 스키마와 검색을 함께 쓰면 검색을 했는데도 그라운딩이 빠져 오는 일이
  // 있습니다("길게" 오류의 원인이던 그 조합입니다). 그래서 그라운딩이 없으면
  // 바로 실패로 보지 않고 스키마 없이 다시 불러 확인합니다. 그 경로는
  // 그라운딩이 보존되므로, 거기서도 없어야 지어낸 것으로 판단합니다.
  let { text, cand } = await listCall(STORIES_SCHEMA);
  if (!grounded(cand)) {
    const plain = await listCall(undefined);
    if (!grounded(plain.cand))
      throw new Error("검색이 실제로 수행되지 않았습니다. 다시 시도해 주세요.");
    const parsedPlain = tryParse(plain.text);
    // 재시도가 검색에는 근거했는데 파싱이 깨졌다면, 검색 안 한 첫 응답으로
    // 돌아가면 안 됩니다. 그건 이 검사가 막으려는 바로 그 지어낸 목록입니다.
    if (!parsedPlain)
      throw new Error("모델 응답을 읽지 못했습니다. 다시 시도해 주세요.");
    ({ text, cand } = plain);
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

  // 정렬도 부탁만 하면 무시될 수 있으므로 코드에서 다시 세웁니다. 키워드가
  // 있으면 관련도 높은 순, 없으면 발행일 최신순입니다. 판단은 모델이 하지만
  // 순서는 코드가 정합니다.
  const at = (d) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? 0 : t;
  };
  list.sort((a, b) => (focus ? b.relevance - a.relevance : at(b.published) - at(a.published)));

  // 정렬한 뒤 위에서부터 링크가 살아 있는지 확인하고, 확실히 죽은 것만 뺍니다.
  // 자르기 전에 해야 죽은 링크가 빠진 만큼 아래 후보가 올라옵니다.
  const dead = await deadUrls(
    list.map((s) => s.url),
    proxy,
    proxyToken
  );
  const top = (dead ? list.filter((s) => !dead.has(s.url)) : list).slice(0, 5);

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
