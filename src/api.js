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
  return JSON.parse(stripped.slice(start, end + 1));
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

export async function fetchArticle({ geminiKey, proxy, proxyToken, source, topic, level }) {
  const levelSpec = {
    easy: "CEFR A2-B1. Sentences of 12 words or fewer. Common vocabulary only.",
    mid: "CEFR B2. Natural news register, moderate sentence length.",
    hard: "CEFR C1. Keep the register and vocabulary of professional US news writing.",
  }[level];

  const prompt = `Use Google Search to find a real news story published in the last few days by ${source.label} on the topic: ${topic}.

Then write YOUR OWN English article reporting that story.

Rules
- Never copy sentences or distinctive phrases from the source. Re-report the facts in fresh wording.
- 4 to 5 paragraphs, 170-210 words total.
- Reading level: ${levelSpec}
- Factual and neutral. Only state what you actually found.

Reply with JSON and nothing else. No markdown fences, no preamble.
{
 "title": "the English headline you wrote",
 "titleKo": "한국어 제목",
 "outlet": "${source.label}",
 "url": "URL of the original story you found",
 "published": "YYYY-MM-DD",
 "summaryKo": "한 문장 한국어 요약",
 "paragraphs": ["...", "...", "..."],
 "keywords": [{"word": "...", "ko": "...", "note": "기사 속 쓰임 한 줄"}]
}
Exactly 5 keywords, chosen for a Korean learner of English.`;

  // 검색 그라운딩과 스키마를 함께 쓰는 건 아직 미리보기 단계라, 기사 쪽은
  // 프롬프트로 형식을 지시하고 아래에서 모양을 검사합니다.
  const { text, cand } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.news,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });

  const article = extractJson(text);

  // 화면은 paragraphs 를 그대로 렌더링하므로, 여기서 모양을 보장하지 않으면
  // 모델이 형식을 어겼을 때 렌더링 도중 터져 빈 화면이 됩니다.
  article.paragraphs = (Array.isArray(article.paragraphs) ? article.paragraphs : [])
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.trim());
  if (article.paragraphs.length === 0)
    throw new Error("기사 형식이 올바르지 않습니다. 다시 시도해 보세요.");

  article.keywords = (Array.isArray(article.keywords) ? article.keywords : []).filter(
    (k) => k && typeof k.word === "string"
  );

  // 그라운딩 출처가 있으면 원문 링크로 함께 보관
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  article.sources = chunks
    .map((c) => c.web && { title: c.web.title, uri: c.web.uri })
    .filter(Boolean)
    .slice(0, 4);

  return article;
}

/* ------------------------------------------------------------------ *
 * 사전 · 문장 해석 · 대화
 * ------------------------------------------------------------------ */

const WORD_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string" },
    base: { type: "string" },
    pos: { type: "string" },
    ipa: { type: "string" },
    ko: { type: "string" },
    en: { type: "string" },
    inContext: { type: "string" },
    example: { type: "string" },
    exampleKo: { type: "string" },
    related: { type: "array", items: { type: "string" } },
  },
  required: ["word", "base", "pos", "ipa", "ko", "en", "inContext", "example", "exampleKo", "related"],
};

const SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    translation: { type: "string" },
    literal: { type: "string" },
    structure: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
    expressions: {
      type: "array",
      items: {
        type: "object",
        properties: { phrase: { type: "string" }, meaning: { type: "string" } },
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
      "ko, inContext, exampleKo, and related are written in Korean; en and example in English.",
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
      "You explain English sentences to an advanced Korean learner. Answer in Korean, " +
      "except when quoting the English itself.",
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
      "If the learner writes in English, end with one short line naming any awkward phrasing and a better version.\n\n" +
      "ARTICLE\n" +
      body,
  });

  return text;
}
