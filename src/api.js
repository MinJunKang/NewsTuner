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
  if (badKey) {
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
Treat it as a preference within that outlet and topic. If nothing published in ${recency} by
${source.label} matches it, report the closest real story you actually found instead, and do
not stretch or invent a story to fit the request.
`
    : "";

  // 관련 기사에서 고른 경우에는 새로 찾지 말고 그 기사를 그대로 다룹니다.
  const intro = story
    ? `Use Google Search to open this specific story published by ${source.label}:
Title: ${story.title}
URL: ${story.url}
Report on that exact story, not a different one.
`
    : `Use Google Search to find a real story published in ${recency} by ${source.label} on the topic: ${topic}.

Run several searches with different wording before deciding. site:${source.domain} is one
query worth trying, but do not rely on it alone — if it returns little, search normally by
outlet name and topic. What matters is that the story you end up reporting was published on
${source.domain}; another outlet's coverage of the same event does not count.

You must actually open search results and report from them. If you find nothing usable on
${source.domain}, set "error" — never write the article from memory.
${focusLine}`;

  const prompt = `${intro}
Choosing which story to report
- Discard pages that are not articles at all: election guides, results dashboards, topic or
  tag hubs, category and section pages, live blogs, photo galleries, video pages and podcast
  episode pages. You can usually tell from the title and the address. Move on to the next
  candidate rather than reporting one of these.
- Everything else is fair game. Prefer a story that shows a publication date and, where it
  is shown, a reporter's or wire service's name — but do not reject a story just because the
  search result did not display a byline. Most articles will not show you one.
- Among the candidates left, prefer the one with the most substantial reporting rather than
  the shortest or the most recent.
- "error" is a last resort, not a first response. Use it only after you have run several
  searches with different wording and still found no usable article. If you have any usable
  article at all, report it.

Then write YOUR OWN English article reporting that story.

Rules
- Never copy sentences or distinctive phrases from the source. Re-report the facts in fresh wording.
- Restructure freely. Do not follow the source's paragraph or sentence order, and do not
  rebuild its sentences with words swapped out. Decide for yourself what to lead with and how
  to arrange what you found.
- The first paragraph must say what makes this news now: the specific thing that happened —
  a ruling, a filing, a vote, a finding, an announcement — and who did it. Give its date
  there too when the story supplies one; when it does not, say what happened without a date
  rather than reaching for the article's own date. Do not open with general background on the
  field. Background belongs after the reader knows what happened, and only as much as the
  story itself supplies.
- Length: ${lengthSpec}. Use paragraphs of three to five sentences.
- Every paragraph must carry something no earlier paragraph carried. Before writing each one,
  ask what it adds. If it would make a point you already made, in different words, do not
  write it — write a shorter article instead.
- Ground each paragraph in something specific you actually found: a figure, a date, a named
  person or organisation, a study, a concrete example. A paragraph that only asserts
  something in general terms is the paragraph to cut.
- Do not close by restating your opening. One ending is enough: say what happens next, and
  stop.
- The word count is a target, not a quota. If what you found does not support that much
  material, write less. Never invent detail, speculate, or reproduce the source's own
  sentences to reach the number. Everything must be in your own wording.
- Reading level: ${levelSpec}
- Write plain news English, the way an AP or NPR reporter writes: concrete nouns, active
  verbs, people doing things. If a wire reporter would not write a phrase, do not write it.
- Do not stack abstract nouns. Constructions like "an institutional obligation to adhere to
  evidentiary standards" or "the central narrative surrounding heritage preservation" are not
  journalism, they are padding. Write who did what instead, in the plainest words that are
  still accurate.
- Name the people involved and say what they do. Do not leave them as "officials",
  "researchers", "experts" or "critics" when the story gives you their names.
- Factual and neutral. Only state what you actually found.
- Write only what your sources report. Do not add background, context, analysis or scene
  detail out of your own knowledge, however likely it seems. If a fact is not in what you
  found, it does not go in the article.
- Quote a person directly only if you actually found that exact quote in your sources.
  Never invent a quote or put words in a named person's mouth. When unsure, paraphrase
  with attribution instead.
- Copy the names of people, institutions, journals and instruments exactly as they appear.
  Never reorder, translate, expand, abbreviate or reconstruct a name, and never attach a
  person to a different institution than the one the story gives them.
- Attribute every claim, argument and figure to whoever actually made it. Never merge two
  people's positions into one, and never move one source's argument to a different speaker.
  You are reading several search results; keep them apart.
- The date attached to an article is when it was published, nothing more. Do not turn it into
  the date of an event. If an article dated 7 August reports that researchers announced
  something, that does not mean they announced it on 7 August — the announcement may be
  months older. Give a date for an event only when the story itself states that date. When it
  does not, write the sentence without a date rather than reaching for the one you have.
- If your sources show genuine disagreement, report both positions and say who holds each,
  and give the evidence each side actually cites — the figures, the studies, the documents —
  not just the position it leads them to. Do not manufacture a disagreement your sources do
  not show, and do not dress a fringe claim up as an equal side.
- Every "url" in "related" must be an address you actually saw in your search results, on
  ${source.label}'s own site. Never assemble, guess or complete an address, even if the
  pattern looks obvious — a link that 404s is worse than no link. Drop the entry rather
  than guess its address.

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
Exactly 5 keywords, chosen for a Korean learner of English.

"related" holds up to 5 OTHER real stories you actually found from ${source.label} while
searching, ordered by how closely they match what was asked for. Use each story's own
headline, not one you wrote. Every entry needs a real canonical URL under the same rule as
above. Exclude the story you just reported. If you found no others, use an empty array.`;

  const call = (schema) =>
    gemini({
      geminiKey,
      proxy,
      proxyToken,
      model: MODELS.news,
      // 기본값은 medium 입니다. 생각 토큰은 출력 단가로 과금되고 이 호출이 가장
      // 비싸므로 low 로 낮춥니다. minimal 까지 내리면 검색 결과 종합이 부실해집니다.
      thinkingLevel: "low",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      schema,
    });

  // 검색 그라운딩과 스키마를 함께 쓰는 것은 아직 미리보기 단계라, 거부당하면
  // 스키마 없이 한 번 더 시도합니다. 프롬프트에 형식이 그대로 적혀 있어
  // 그 경로로도 동작합니다.
  const grounded = (c) => (c?.groundingMetadata?.groundingChunks || []).length > 0;
  const tryParse = (t) => {
    try {
      return extractJson(t);
    } catch {
      return null;
    }
  };

  let text, cand;
  try {
    ({ text, cand } = await call(ARTICLE_SCHEMA));
  } catch (e) {
    if (e.status !== 400 || !/schema|response_?format/i.test(e.message)) throw e;
    ({ text, cand } = await call(undefined));
  }
  let article = tryParse(text);

  // 스키마와 검색 그라운딩을 함께 쓰는 것은 아직 미리보기라, 긴 글에서 그라운딩
  // 정보가 빠져 오는 경우가 있습니다. 출처가 없으면 기사를 막게 되어 있으므로,
  // 스키마 없이 한 번 더 불러 봅니다.
  //
  // 다만 스키마를 빼면 형식 보장이 사라져, 긴 본문에 따옴표가 섞이면 JSON 이
  // 깨집니다. 그래서 재시도 결과는 파싱에 성공하고 출처까지 있을 때만 씁니다.
  // 그러지 않으면 멀쩡한 첫 응답을 깨진 재시도로 덮어쓰게 됩니다.
  if (!grounded(cand)) {
    try {
      const plain = await call(undefined);
      const parsed = tryParse(plain.text);
      if (parsed && grounded(plain.cand)) {
        article = parsed;
        cand = plain.cand;
      }
    } catch {
      /* 처음 응답을 그대로 씁니다 */
    }
  }

  if (!article) throw new Error("모델 응답을 읽지 못했습니다. 다시 시도해 주세요.");

  if (article.error)
    throw new Error("조건에 맞는 기사를 찾지 못했습니다. 매체나 조건을 바꿔 보세요.");

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

  // 그라운딩 주소가 1순위입니다. 구글이 실제로 열어본 것이라 존재가 보장됩니다.
  // 그것이 비어 있을 때만 모델이 적어 낸 주소를 발행사 도메인 검사 후 씁니다.
  // 도메인 검사는 지어낸 주소를 다 걸러내지는 못하지만, 아무 링크도 없는 것보다는
  // 낫습니다. 둘 다 없을 때만 기사를 막습니다.
  article.url = article.sources[0]?.uri || onDomain(article.url, source.domain) || "";

  // 여기서 기사를 막아 봤지만, 판단이 그라운딩 정보 하나에 걸려 있고 그 정보가
  // 자주 빠져 와서 정상 기사까지 막혔습니다. 막는 대신 화면에 경고를 띄웁니다.
  // 위험은 알리되 앱은 쓸 수 있어야 합니다.

  article.related = (Array.isArray(article.related) ? article.related : [])
    .map((r) => ({
      title: stripMarkers(r?.title),
      titleKo: stripMarkers(r?.titleKo),
      url: onDomain(r?.url, source.domain) || "",
    }))
    .filter((r) => r.title && r.url && r.url !== article.url)
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
        },
        required: ["title", "url", "published", "summaryKo"],
      },
    },
  },
  required: ["stories"],
};

// 본문은 가져오지 않습니다. 무엇이 있는지 제목과 링크만 알려줍니다.
export async function findStories({ geminiKey, proxy, proxyToken, source, topic, focus }) {
  const recency = source.window || "the last few days";
  const focusLine = focus
    ? `\nPrefer stories about: ${focus}. If none match, list what you did find instead.\n`
    : "";

  const prompt = `Use Google Search to list real stories published in ${recency} by ${source.label} on the topic: ${topic}.

Search ${source.label}'s own site: put site:${source.domain} in your queries and run several
with different wording. Every story you list must live on ${source.domain}. Do not fill the
list out with another outlet's coverage of the same events.
${focusLine}
Skip pages that are not articles: election guides, results dashboards, topic or tag hubs,
category and section pages, live blogs, photo galleries, video pages and podcast episode
pages. Everything else is fair game — do not skip a story just because the search result did
not display a byline.

List up to 5 stories, most relevant first. Use each story's own published headline exactly as
it appears — do not rewrite or translate it in the "title" field. Every story needs a real
canonical URL on the publisher's own site; drop any story you cannot link. Do not summarise
the article body beyond one short Korean sentence saying what it is about.

Reply with JSON and nothing else:
{"stories": [{"title": "...", "url": "...", "published": "YYYY-MM-DD", "summaryKo": "..."}]}`;

  const { text } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.news,
    thinkingLevel: "low",
    maxOutputTokens: 2500,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    schema: STORIES_SCHEMA,
  });

  const parsed = extractJson(text);
  const list = (Array.isArray(parsed?.stories) ? parsed.stories : [])
    .map((s) => ({
      title: stripMarkers(s?.title),
      published: stripMarkers(s?.published),
      summaryKo: stripMarkers(s?.summaryKo),
      url: onDomain(s?.url, source.domain) || "",
    }))
    .filter((s) => s.title && s.url)
    .slice(0, 5);

  if (!list.length) throw new Error("기사를 찾지 못했습니다. 조건을 바꿔 보세요.");
  return list;
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
