/* ------------------------------------------------------------------ *
 * 모델 이름은 여기서만 바꾸면 전체에 적용됩니다.
 * ------------------------------------------------------------------ */
export const MODELS = {
  // 뉴스 수집: Google 검색 그라운딩을 쓰는 Gemini
  gemini: "gemini-3.6-flash",
  // 단어·문장 풀이: 짧고 잦은 호출이라 가장 싼 모델
  lookup: "claude-haiku-4-5-20251001",
  // 기사 토론: 맥락 이해가 필요한 쪽
  chat: "claude-sonnet-5",
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CLAUDE_BASE = "https://api.anthropic.com/v1/messages";

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

function fail(res, body) {
  const detail = body?.error?.message || body?.message || "";
  if (res.status === 401 || res.status === 403)
    throw new Error("API 키가 거부되었습니다. 설정에서 키를 확인하세요.");
  if (res.status === 429) throw new Error("요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.");
  throw new Error(`요청 실패 (${res.status}) ${detail}`.trim());
}

/* ------------------------------------------------------------------ *
 * Gemini — 뉴스 수집
 * ------------------------------------------------------------------ */

// 프록시를 쓸 때는 워커의 SHARED_TOKEN 과 맞춰 보냅니다.
function proxyHeaders(proxyToken) {
  const headers = { "Content-Type": "application/json" };
  if (proxyToken) headers["X-App-Token"] = proxyToken;
  return headers;
}

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

  const url = proxy
    ? `${proxy.replace(/\/$/, "")}/gemini`
    : `${GEMINI_BASE}/${MODELS.gemini}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: proxy ? proxyHeaders(proxyToken) : { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4 },
    }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) fail(res, data);

  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("빈 응답을 받았습니다. 주제를 바꿔 다시 시도해 보세요.");

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
 * Claude — 사전 · 문장 해석 · 대화
 * ------------------------------------------------------------------ */

async function claude({
  claudeKey,
  proxy,
  proxyToken,
  model,
  system,
  messages,
  maxTokens = 900,
  thinking,
}) {
  const url = proxy ? `${proxy.replace(/\/$/, "")}/claude` : CLAUDE_BASE;
  const headers = proxy ? proxyHeaders(proxyToken) : { "Content-Type": "application/json" };
  if (!proxy) {
    headers["x-api-key"] = claudeKey;
    headers["anthropic-version"] = "2023-06-01";
    // 브라우저에서 직접 부를 때 필요한 헤더입니다.
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  const body = { model, max_tokens: maxTokens, system, messages };
  if (thinking) body.thinking = thinking;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) fail(res, data);
  if (!data) throw new Error("응답을 읽지 못했습니다. 잠시 후 다시 시도하세요.");

  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function lookupWord({ claudeKey, proxy, proxyToken, word, sentence }) {
  const text = await claude({
    claudeKey,
    proxy,
    proxyToken,
    model: MODELS.lookup,
    maxTokens: 600,
    system:
      "You are an English-Korean dictionary for an advanced Korean learner. Reply with JSON only. No markdown fences.",
    messages: [
      {
        role: "user",
        content: `Word: "${word}"
Sentence it appears in: "${sentence}"

{
 "word": "${word}",
 "base": "기본형",
 "pos": "품사 (한국어)",
 "ipa": "/.../",
 "ko": "이 문맥에서의 뜻 (한국어, 짧게)",
 "en": "short English definition",
 "inContext": "이 문장에서 왜 그 뜻이 되는지 한 문장",
 "example": "a different example sentence",
 "exampleKo": "예문 한국어 번역",
 "related": ["동의어 또는 연어 3개"]
}`,
      },
    ],
  });
  return extractJson(text);
}

export async function lookupSentence({ claudeKey, proxy, proxyToken, sentence }) {
  const text = await claude({
    claudeKey,
    proxy,
    proxyToken,
    model: MODELS.lookup,
    maxTokens: 700,
    system:
      "You explain English sentences to an advanced Korean learner. Reply with JSON only. No markdown fences.",
    messages: [
      {
        role: "user",
        content: `Sentence: "${sentence}"

{
 "translation": "자연스러운 한국어 번역",
 "literal": "구조가 드러나는 직역",
 "structure": "문장 구조 한 줄 요약 (예: 주절 + 분사구문)",
 "notes": ["문법 또는 표현 포인트 2-3개, 한국어"],
 "expressions": [{"phrase": "표현", "meaning": "뜻"}]
}`,
      },
    ],
  });
  return extractJson(text);
}

export async function discuss({ claudeKey, proxy, proxyToken, article, messages }) {
  const paragraphs = Array.isArray(article?.paragraphs) ? article.paragraphs : [];
  const body = paragraphs.length ? `${article.title}\n\n${paragraphs.join("\n\n")}` : "";
  return claude({
    claudeKey,
    proxy,
    proxyToken,
    model: MODELS.chat,
    maxTokens: 1024,
    // Sonnet 5 는 thinking 이 기본으로 켜져 있고, max_tokens 는 생각과 답을 합쳐서
    // 제한합니다. 끄지 않으면 짧은 대화 답변이 생각에 밀려 잘립니다.
    thinking: { type: "disabled" },
    system:
      "You discuss a news article with a Korean learner of English. " +
      "Answer in whichever language the learner used. Keep replies under 120 words. " +
      "If the learner writes in English, end with one short line naming any awkward phrasing and a better version.\n\n" +
      "ARTICLE\n" +
      body,
    messages,
  });
}
