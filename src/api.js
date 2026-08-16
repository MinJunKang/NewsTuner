/* ------------------------------------------------------------------ *
 * 모델 이름은 여기서만 바꾸면 전체에 적용됩니다. 전부 Gemini 를 씁니다.
 * ------------------------------------------------------------------ */
export const MODELS = {
  // 뉴스 수집: Google 검색 그라운딩이 필요하고 한 번에 긴 글을 씁니다.
  news: "gemini-3.7-flash",
  // 단어·문장 풀이: 짧고 잦은 호출이라 thinking 기본값이 minimal 인 lite 를 씁니다.
  lookup: "gemini-3.5-flash-lite",
  // 기사 토론: 맥락 이해가 필요한 쪽.
  chat: "gemini-3.7-flash",
  // 후보 목록: 검색 결과에서 제목과 주소를 추리는 일이라 작은 모델로 충분합니다.
  // 단가가 입력 1/5, 출력 1/3이라 기사당 비용의 ~30% 가 여기서 빠집니다.
  // 재시도는 큰 모델로 올라가므로 lite 가 부실해도 뒷받침이 있습니다.
  list: "gemini-3.5-flash-lite",
};

// 붐빌 때 갈아탈 모델입니다. 3.7 은 나온 지 얼마 안 돼 몰리는 시간대가 있는데,
// 3.6 은 이 앱이 얼마 전까지 쓰던 모델이라 품질이 검증돼 있고 단가도 같습니다.
// 서버의 허용 목록(api/_shared.js)에 3.6 이 남아 있어야 이 우회가 동작합니다.
const FALLBACK_MODEL = {
  "gemini-3.7-flash": "gemini-3.6-flash",
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

// 모델이 검색 결과의 주소를 JSON 으로 옮겨 적다가 슬러그 한 구간을 두 번 적는
// 일이 있습니다(실제 사례: ...falling-to-erdos-problems-are-falling-to-ai...).
// 이런 주소는 404 인데, 매체의 CDN 이 서버 IP 를 봇으로 보고 403 을 주는 시간대
// 에는 생존 검사가 죽음을 증명하지 못해 화면까지 갑니다. 검사에 기대는 대신
// 여기서 반복 구간을 접어 고칩니다. 진짜 제목에 세 단어 이상이 연이어 두 번
// 나오는 일은 사실상 없으므로, 긴 반복만 접으면 오탐 없이 원래 주소가 나옵니다.
// 고친 주소가 틀렸더라도 잃는 것은 없습니다. 어차피 원래 주소는 404 이고,
// 고친 주소는 이후의 전문 추출·생존 검사를 그대로 다시 통과해야 합니다.
export function collapseRepeatedSlug(u) {
  const safe = safeUrl(u);
  if (!safe) return u;
  try {
    const url = new URL(safe);
    const segs = url.pathname.split("/");
    let changed = false;
    const fixed = segs.map((seg) => {
      const tokens = seg.split("-");
      if (tokens.length < 6) return seg;
      // 긴 반복부터 접어야 부분 반복을 잘못 접지 않습니다.
      for (let len = Math.floor(tokens.length / 2); len >= 3; len--) {
        for (let i = 0; i + 2 * len <= tokens.length; i++) {
          const a = tokens.slice(i, i + len).join("-");
          const b = tokens.slice(i + len, i + 2 * len).join("-");
          if (a === b && a.length >= 12) {
            tokens.splice(i + len, len);
            changed = true;
            len = Math.floor(tokens.length / 2) + 1; // 다시 처음부터
            break;
          }
        }
      }
      return tokens.join("-");
    });
    if (!changed) return safe;
    url.pathname = fixed.join("/");
    logIssue("주소중복교정", "", `${safe} → ${url.href}`);
    return url.href;
  } catch {
    return u;
  }
}

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
// 상태 코드를 읽을 수 없으므로 서버를 거쳐야만 확인됩니다. 서버가 없으면 확인을
// 건너뜁니다. 확인하지 못한 것을 죽었다고 볼 수는 없습니다.
async function deadUrls(urls, proxy, proxyToken, signal) {
  if (!proxy || !urls.length) return null;
  const headers = { "Content-Type": "application/json" };
  if (proxyToken?.trim()) headers["X-App-Token"] = proxyToken.trim();
  try {
    const res = await fetch(`${proxy.replace(/\/$/, "")}/check`, {
      method: "POST", signal,
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
async function fetchFullText(url, proxy, proxyToken, signal) {
  if (!proxy || !url) return null;
  const headers = { "Content-Type": "application/json" };
  if (proxyToken?.trim()) headers["X-App-Token"] = proxyToken.trim();
  try {
    const res = await fetch(`${proxy.replace(/\/$/, "")}/extract`, {
      method: "POST", signal,
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

// 피드 제목만 놓고 "이 주제와 관련 있는 것"을 고르게 합니다. 검색 그라운딩을 쓰지
// 않으니 쿼리 과금이 없고, 작은 모델에 제목 수십 줄이라 호출 값이 거의 안 나갑니다.
const PICKS_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: { type: "integer" },
      description:
        "Index numbers of the stories that are about the reader's topic, best match first. " +
        "Empty array if none of them are.",
    },
  },
  required: ["picks"],
};

async function pickByMeaning({ geminiKey, proxy, proxyToken, focus, list, tally, signal }) {
  // 여러 주제 피드를 합치면 100건이 넘습니다. 30건만 보면 앞쪽 피드만 훑는 셈이라
  // 확장한 값이 사라집니다. 제목 한 줄은 20토큰 남짓이라 60건이어도 lite 호출
  // 하나에 다 들어갑니다.
  const pool = list.slice(0, 60);
  const lines = pool
    .map((s, i) => `${i}. ${s.title}${s.summaryKo ? ` — ${s.summaryKo.slice(0, 120)}` : ""}`)
    .join("\n");

  const { text } = await gemini({
    geminiKey,
    proxy,
    proxyToken,
    model: MODELS.list,
    purpose: "feedpick",
    thinkingLevel: "minimal",
    maxOutputTokens: 300,
    schema: PICKS_SCHEMA,
    tally,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `The reader wants to read about: ${focus}

That topic is often written in Korean while the headlines below are in English, so
do not look for shared words. Judge by meaning.

Pick the stories that are about that topic or about something closely connected to
it — the same event, the same field, the same people, companies or countries. Be
reasonably generous: if someone interested in that topic would want to read it, it
counts. Leave out stories that only mention it in passing or have nothing to do
with it. If none qualify, return an empty list rather than reaching.

Answer with index numbers only, best match first.

${lines}`,
          },
        ],
      },
    ],
  });

  const picks = extractJson(text)?.picks;
  if (!Array.isArray(picks)) return [];
  return picks
    .map((i) => pool[i])
    .filter(Boolean)
    // 같은 번호를 두 번 적어 오는 일이 있어 걸러 냅니다.
    .filter((s, i, a) => a.indexOf(s) === i);
}

// 언론사가 직접 발행하는 RSS/Atom 피드에서 후보 목록을 만듭니다. 여기서 나온
// 주소는 전부 발행사가 적은 실존 주소라 모델이 목록을 지어낼 여지가 원천적으로
// 없고, 목록 모델 호출이 통째로 빠져 더 싸고 빠릅니다. 피드가 없거나 빈손이면
// null 을 돌려주고 기존 검색 경로가 이어받습니다.
async function feedStories({ geminiKey, proxy, proxyToken, source, focus, exclude, tally, signal }) {
  if (!source.feed || !proxy) return null;
  const headers = { "Content-Type": "application/json" };
  if (proxyToken?.trim()) headers["X-App-Token"] = proxyToken.trim();
  // 한 매체가 여러 주제 피드를 낼 수 있습니다(IEEE Spectrum 이 그렇습니다).
  // 그때는 전부 받아 합칩니다. 피드 받기는 서버 호출이라 과금이 없어서, 주제를
  // 넓히는 값이 사실상 공짜입니다. 서로 겹치는 기사는 주소로 한 번만 남깁니다.
  const feeds = (Array.isArray(source.feed) ? source.feed : [source.feed]).filter(Boolean);

  // 이 함수의 실패는 검색 경로가 조용히 이어받으므로 화면에는 안 보입니다.
  // 어느 지점에서 왜 넘어갔는지는 기록에 남겨야 다음 보고에서 진단이 됩니다.
  const one = async (url) => {
    try {
      const res = await fetch(`${proxy.replace(/\/$/, "")}/feed`, {
        method: "POST", signal,
        headers,
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        logIssue("피드실패", source?.id, `서버 응답 ${res.status}`);
        return [];
      }
      const data = await res.json();
      if (data?.error?.message) logIssue("피드실패", source?.id, data.error.message);
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      logIssue("피드실패", source?.id, String(e?.message || e));
      return [];
    }
  };

  // 순서대로 받으면 피드 수만큼 기다립니다. 동시에 받습니다.
  const batches = await Promise.all(feeds.map(one));
  const seenUrl = new Set();
  const items = [];
  for (const b of batches)
    for (const it of b) {
      const key = String(it?.url || "").split("?")[0];
      if (!key || seenUrl.has(key)) continue;
      seenUrl.add(key);
      items.push(it);
    }

  if (!items.length) {
    logIssue("피드실패", source?.id, "항목 0건");
    return null;
  }

  const wanted = (focus || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  let list = items
    .map((it) => {
      const t = Date.parse(it?.date);
      // 피드 링크의 추적 쿼리(?at_medium=RSS 등)는 뗍니다. BBC 는 피드 링크를
      // bbc.co.uk 로 적지만 같은 기사가 bbc.com 에 그대로 있어(확인함) 도메인
      // 검사에 걸리지 않게 바꿔 적습니다.
      const raw = String(it?.url || "")
        .split("?")[0]
        .replace("://www.bbc.co.uk/", "://www.bbc.com/");
      return {
        title: stripMarkers(it?.title),
        published: Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10),
        summaryKo: stripMarkers(it?.desc || ""),
        url: onDomain(raw, source.domain) || "",
        matchesRequest: true,
        relevance: 0,
        // 어느 매체에서 온 후보인지 붙여 둡니다. 키워드가 빈손일 때 같은 분야의
        // 다른 매체를 훑는데, 그때 고른 기사를 원래 매체 기준으로 다루면 도메인
        // 검사와 프롬프트의 매체 이름이 전부 어긋납니다.
        srcId: source.id,
        // 발행사 피드에서 온 주소는 실존이 증명된 것입니다. 표시 단계가 생존
        // 확인 없이 원문 링크로 믿고 쓸 수 있습니다.
        proven: true,
      };
    })
    .filter((s) => s.title && s.url);

  // 피드를 여러 개 합쳤으면 순서가 "피드1 전부 → 피드2 전부" 입니다. 그대로 두면
  // 아래에서 앞쪽만 잘라 보게 되어 뒤 주제가 통째로 빠집니다. 먼저 최신순으로
  // 섞어, 어느 주제든 최근 것부터 검토되게 합니다.
  list.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));

  // 1차는 글자 그대로 겹치는지 봅니다. 겹치면 모델을 부를 필요가 없어 공짜입니다.
  const all = list;
  let byMeaning = false;
  if (wanted.length)
    list = all.filter((s) =>
      wanted.every((w) => (s.title + " " + s.summaryKo).toLowerCase().includes(w))
    );

  // 글자로 못 찾았을 때 예전에는 여기서 포기하고 비싼 검색 경로로 넘어갔습니다.
  // 그 조건이 지나치게 셌습니다. 피드 제목은 영어인데 키워드는 한국어로 적는 일이
  // 많아(앱의 예시부터 "반도체 수출 규제"입니다) 글자 겹침이 아예 일어날 수 없고,
  // 영어로 적어도 낱말을 전부 포함해야 해서 조금만 달리 쓰면 빠집니다.
  // 그래서 뜻으로 골라 달라고 작은 모델에게 한 번 물어봅니다. 검색을 쓰지 않으므로
  // 그라운딩 과금이 없고, 실패하면 예전처럼 검색 경로가 이어받습니다.
  if (wanted.length && !list.length && all.length) {
    try {
      list = await pickByMeaning({ geminiKey, proxy, proxyToken, focus, list: all, tally, signal });
      byMeaning = true;
      logIssue("피드의미검색", source?.id, `"${focus}" → ${list.length}건`);
    } catch (e) {
      // 중지는 여기서 삼키면 안 됩니다. 삼키면 "빈손" 으로 보여서 다음 매체까지
      // 훑고, 끝내는 멈춘 게 아니라 못 찾은 것처럼 오류가 뜹니다.
      if (e?.name === "AbortError") throw e;
      logIssue("피드의미검색실패", source?.id, String(e?.message || e));
      list = [];
    }
  }

  const fresh = list.filter((s) => !exclude?.includes(s.url));
  if (fresh.length) list = fresh;
  if (!list.length)
    logIssue(
      "피드빈손",
      source?.id,
      `${items.length}건 중 조건 일치 0건${focus ? ` (키워드 "${focus}"${byMeaning ? ", 뜻으로도 없음" : ""})` : ""}`
    );
  // 뜻으로 고른 결과는 관련도 순으로 옵니다. 그걸 날짜로 다시 세우면 가장 잘 맞는
  // 기사가 뒤로 밀립니다. 키워드가 없을 때만 최신순이 맞습니다.
  if (!byMeaning)
    list.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return list.slice(0, 5);
}

// 전문을 쥐고 쓴 기사는 원문과 코드로 대조할 수 있습니다. 프롬프트에 "지어내지
// 말라"고 적는 것과 달리 이쪽은 무시될 수 없습니다. 큰따옴표 안의 말과 두 자리
// 이상의 수치는 원문에 실제로 있어야 합니다. Quanta 의 에르되시 기사에서 없는
// 문제 번호와 없는 발언이 실려 나온 뒤에 넣었습니다.
const normForMatch = (t) =>
  String(t || "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();

function fidelityIssues(article, full) {
  const src = normForMatch(`${full.title || ""} ${full.paragraphs.join(" ")}`);
  const body = normForMatch((article?.paragraphs || []).join("\n"));

  // 네 단어 이상의 직접 인용만 봅니다. 한두 단어를 따옴표로 감싼 것은 인용이
  // 아니라 용어 표시일 때가 많습니다.
  const quotes = [];
  for (const m of body.matchAll(/"([^"]{12,400})"/g)) {
    const q = m[1].trim().replace(/^[\s,.;:]+|[\s,.;:]+$/g, "");
    if (q.split(" ").length < 4) continue;
    if (!src.includes(q)) quotes.push(q);
  }

  // 원문에 없는 숫자는 대개 기억에서 온 것입니다(문제 번호, 반올림한 총계).
  // 한 자리 수는 표현 차이가 잦아 제외합니다.
  const srcNums = new Set((src.match(/\d[\d,]*/g) || []).map((n) => n.replace(/,/g, "")));
  const numbers = [
    ...new Set(
      (body.match(/\d[\d,]*/g) || []).map((n) => n.replace(/,+$/, "")).filter((n) => {
        const clean = n.replace(/,/g, "");
        return clean.length >= 2 && !srcNums.has(clean);
      })
    ),
  ];
  return { quotes: quotes.slice(0, 6), numbers: numbers.slice(0, 8) };
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

// 호출 한 건이 실제로 몇 토큰을 썼는지 기기에 남깁니다. 어느 단계(purpose)가
// 비용을 먹는지는 추정으로는 알 수 없고, 특히 생각 토큰(thoughts)과 검색 주입
// 입력(toolUse)은 화면 어디에도 드러나지 않습니다. 기사 본문이나 검색어 같은
// 내용은 단 한 글자도 담지 않습니다. 숫자와 모델 이름뿐입니다. 400건 상한.
export function logUsage(model, purpose, u) {
  if (!u) return;
  try {
    const key = "nt-usagelog";
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    arr.unshift({
      t: new Date().toISOString(),
      m: model, // 모델 이름
      p: purpose || "", // 어느 단계에서 부른 호출인지
      in: u.promptTokenCount || 0, // 입력
      cache: u.cachedContentTokenCount || 0, // 그중 캐시로 할인된 몫
      tool: u.toolUsePromptTokenCount || 0, // 검색 결과가 입력으로 주입된 몫
      think: u.thoughtsTokenCount || 0, // 생각 (출력 단가로 청구됩니다)
      out: u.candidatesTokenCount || 0, // 본문 출력
      total: u.totalTokenCount || 0,
    });
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 400)));
  } catch {
    /* 기록 실패가 본 작업을 막으면 안 됩니다 */
  }
}

// 브라우저는 배경으로 넘어간 탭의 통신을 끊습니다(iOS Safari 가 특히 공격적이고,
// 안드로이드도 메모리가 모자라면 같은 일을 합니다). 그런데 그렇게 끊긴 요청은
// fetch 에서 연결 끊김과 완전히 같은 모양으로 도착합니다. 구분하지 않으면 화면이
// "연결을 확인하세요" 라고 안내하고, 사용자는 멀쩡한 와이파이를 붙들고 헤맵니다.
// 리스너를 요청마다 붙였다 떼면 새기 쉬우므로, 한 번만 걸어 두고 시각만 남깁니다.
let lastHiddenAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") lastHiddenAt = Date.now();
  });
}
// 이 요청이 나가 있는 동안 화면이 한 번이라도 숨겨졌는지. 지금 숨어 있는 중이면
// visibilitychange 가 아직 안 왔을 수도 있으므로 현재 상태도 함께 봅니다.
const wentAway = (since) =>
  lastHiddenAt >= since ||
  (typeof document !== "undefined" && document.visibilityState === "hidden");

// 기사 한 편을 만드는 데 든 토큰을 한곳에 모읍니다. 호출 단위 기록만으로는
// "이 매체의 이 분량이 얼마짜리인가"를 알 수 없습니다. 목록·집필·교정이 각각
// 몇 번 나갔는지는 기사마다 다르기 때문입니다.
const newTally = () => ({ calls: 0, in: 0, cache: 0, think: 0, out: 0, total: 0 });
function addTally(tally, u) {
  if (!tally || !u) return;
  tally.calls += 1;
  tally.in += u.promptTokenCount || 0;
  tally.cache += u.cachedContentTokenCount || 0;
  tally.think += u.thoughtsTokenCount || 0;
  tally.out += u.candidatesTokenCount || 0;
  tally.total += u.totalTokenCount || 0;
}

// 완성된 기사 한 편을 매체·분량·글자수와 함께 남깁니다. 호출 기록과 같은 곳에
// 쌓되 kind 로 구분합니다. 본문은 담지 않습니다. 글자수만 셉니다.
export function logArticle(rec) {
  try {
    const key = "nt-usagelog";
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    arr.unshift({ t: new Date().toISOString(), kind: "article", ...rec });
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 400)));
  } catch {
    /* 기록 실패가 본 작업을 막으면 안 됩니다 */
  }
}

// 재시도 사이의 대기입니다. 중지를 눌렀는데 몇 초를 더 기다렸다 멈추면 버튼이
// 안 먹은 것처럼 보이므로, 신호가 오면 기다림 자체를 깹니다.
const aborted = () =>
  typeof DOMException !== "undefined"
    ? new DOMException("중지했습니다.", "AbortError")
    : Object.assign(new Error("중지했습니다."), { name: "AbortError" });

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(aborted());
      },
      { once: true }
    );
  });

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
    // 서버의 SHARED_TOKEN 불일치입니다. API 키 문제로 안내하면 사용자가
    // 엉뚱한 칸을 고칩니다.
    message = "서버 토큰이 맞지 않습니다. 설정에서 서버 토큰을 확인하세요.";
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
    // 내 앱이나 설정 문제가 아니라는 점을 밝혀야 엉뚱한 곳을 고치지 않습니다.
    message =
      "구글 모델 쪽이 붐빕니다. 세 번까지 자동으로 다시 시도했지만 안 됐습니다. " +
      "설정 문제가 아니니 1~2분 뒤에 다시 눌러 주세요.";
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
  purpose, // 사용량 기록에만 쓰입니다. 요청에는 들어가지 않습니다.
  tally, // 주면 이 호출의 토큰을 여기에 더합니다(기사 한 편의 합계용).
  signal, // 사용자가 중지를 누르면 진행 중인 요청까지 끊습니다.
}) {
  // 붐빌 때 갈아탈 수 있으므로 모델을 고정해 두지 않습니다.
  let active = model;
  const urlFor = (m) =>
    proxy
      ? `${proxy.replace(/\/$/, "")}/gemini/${m}`
      : `${GEMINI_BASE}/${m}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const headers = { "Content-Type": "application/json" };
  // 서버를 쓸 때는 서버의 SHARED_TOKEN 과 맞춰 보냅니다.
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
    // 이 시도가 시작된 시각입니다. 재시도마다 새로 잡아야, 초반에 잠깐 화면을
    // 벗어났다 돌아온 뒤 한참 있다 난 진짜 통신 오류까지 배경 탓으로 돌리지 않습니다.
    const sentAt = Date.now();
    try {
      res = await fetch(urlFor(active), { method: "POST", headers, body: payload, signal });
    } catch (e) {
      // 사용자가 중지를 누른 것은 오류가 아닙니다. 네트워크 오류 문구로 덮으면
      // 스스로 멈춰 놓고 연결을 의심하게 됩니다. 그대로 올려 보냅니다.
      if (e?.name === "AbortError") throw e;
      // Safari 는 "Load failed" 같은 영어 한 줄만 남깁니다. 연결 끊김, 프록시
      // 무응답, CORS 실패, 그리고 배경 전환에 의한 중단이 전부 이 모양으로 옵니다.
      throw new Error(
        wentAway(sentAt)
          ? "다른 화면에 다녀오는 동안 요청이 끊겼습니다. 화면을 열어 둔 채로 다시 시도해 주세요."
          : "네트워크 오류로 요청이 전달되지 못했습니다. 연결을 확인하고 다시 시도해 주세요."
      );
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

  // 503/529/500 은 상류가 요청을 아예 처리하지 못한 것이라 토큰이 청구되지
  // 않습니다. 다시 부르는 값이 시간뿐이므로 넉넉히 기다렸다 세 번까지 갑니다.
  // 예전에는 1.5초·3초로 끝나서, 조금만 붐벼도 사용자에게 실패로 떨어졌습니다
  // (기록에 "모델이 혼잡합니다" 가 반복해서 남았습니다).
  // 502/504 는 상류에서 처리가 끝났는데 응답만 놓쳤을 수 있습니다. 다시 부르면
  // 그만큼 다시 과금될 수 있어 한 번만 더 시도합니다.
  const busy = (s) => s === 503 || s === 529 || s === 500;
  const timedOut = (s) => s === 502 || s === 504;
  const waits = [2000, 5000, 10000];
  for (let i = 0; i < waits.length; i++) {
    if (!busy(res.status) && !timedOut(res.status)) break;
    if (timedOut(res.status) && i >= 1) break;
    // 같은 순간에 몰려 다시 부르지 않게 조금 흔들어 줍니다.
    await sleep(waits[i] + Math.floor(Math.random() * 500), signal);
    ({ res, data } = await send());
  }

  // 그래도 붐비면 모델을 갈아타고 한 번 더 갑니다. 새 모델은 나온 지 얼마 안 돼
  // 몰리는 시간대가 있는데, 한 세대 앞 모델은 같은 단가에 같은 일을 하던 것이라
  // 품질을 크게 잃지 않고 우회할 수 있습니다. 503 은 토큰이 청구되지 않으므로
  // 갈아타 보는 값도 시간뿐입니다. 어느 모델이 실제로 응답했는지는 사용량 기록에
  // 그대로 남으므로, 이 우회가 얼마나 자주 쓰이는지 나중에 셀 수 있습니다.
  const alt = FALLBACK_MODEL[active];
  if (busy(res.status) && alt) {
    logIssue("모델우회", purpose || "", `${active} → ${alt} (${res.status})`);
    active = alt;
    ({ res, data } = await send());
  }

  // 분당 한도는 몇 초만 기다리면 풀립니다. 하루 한도는 기다려도 소용없으니
  // 그대로 알립니다. 사용자가 버튼을 다시 누르게 하면 한도만 더 깎입니다.
  if (res.status === 429) {
    const e = apiError(res, data);
    if (e.retryMs > 0 && e.retryMs <= 15000 && !/perday|daily/i.test(e.quotaId)) {
      await sleep(e.retryMs + 250, signal);
      ({ res, data } = await send());
    }
  }

  if (!res.ok) throw apiError(res, data);
  if (!data) throw new Error("응답을 읽지 못했습니다. 잠시 후 다시 시도하세요.");

  // 실제 토큰 사용량입니다. 비용 추정이 아니라 실측을 보려면 브라우저 콘솔에서
  // [nt-usage] 를 찾으면 됩니다. 화면이나 요청에는 아무 영향이 없습니다.
  if (data.usageMetadata) {
    // 갈아탔으면 실제로 응답한 모델로 남깁니다. 요청한 모델로 남기면 단가 계산이
    // 어긋나고, 우회가 얼마나 쓰였는지도 알 수 없습니다.
    console.debug("[nt-usage]", active, purpose, data.usageMetadata);
    logUsage(active, purpose, data.usageMetadata);
    addTally(tally, data.usageMetadata);
  }

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

// 집필 규칙은 매체·난이도·길이와 무관하게 한 글자도 달라지지 않습니다. 그래서
// 사용자 메시지가 아니라 시스템 지시로 보냅니다. 요청의 맨 앞이 매번 완전히
// 같아지므로 Gemini 의 암시적 캐시가 이 3천 토큰 남짓을 계속 할인가로 받습니다.
// 후보 2건 시도, 그라운딩 재시도, 연속 수신이 전부 같은 접두사를 씁니다.
// 바뀌는 것(어느 기사, 어느 매체, 난이도, 분량)은 전부 아래 assignment 로 갑니다.
// 규칙 안에 ${...} 를 하나라도 남기면 캐시가 통째로 깨지므로, 값이 필요한 자리는
// "assignment 에 있다"고만 적습니다.
const ARTICLE_RULES = `You re-report a news story in your own English, for a Korean learner of English.

The assignment — which story, which outlet, what reading level, what length, and the JSON
shape to reply in — comes in the message after these rules. These rules apply to every
assignment.

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
- Findings the story credits to earlier work stay credited to earlier work. If a mechanism
  was established by previous research and a named scientist is quoted saying something
  else about it, do not fold the two together so the quote appears to be that person's
  finding. A quotation supports only what that person actually said.
- Where and when a thing happens is a fact, not a scene-setting phrase. Attach a circumstance
  — during an outbreak, in the body, after a meal, at the plant — only to the step the source
  attaches it to. A toxin that enters people through contaminated food is not a toxin that
  acts "during" the bloom that produced it; sliding the qualifier onto the wrong step invents
  a causal chain the source does not report.
- Do not sharpen a fact with detail you were not given. If the source says "breathing
  support", write breathing support, not "mechanical ventilation"; if it says a toxin gets
  into shellfish, do not explain how it accumulates there. Filling in the plausible specific
  is inventing, even when the specific happens to be true.
- The date on an article is when it was published, nothing more. Do not turn it into the date
  of an event. If an article dated 7 August reports that researchers announced something,
  that does not mean they announced it on 7 August — the announcement may be months older.
  Give a date for an event only when the story states that date; otherwise write the sentence
  without a date rather than reaching for the one you have.
- Quote a person directly only if you found that exact quote. Never invent a quote or put
  words in a named person's mouth. When unsure, paraphrase with attribution.
- An analogy or example belongs to whoever made it in the source. Never compose one and hand
  it to a named person, or build a paragraph around a comparison the source does not contain.
- Never number a problem, case, section or item unless the source gives that number. "Three
  of the problems" stays three of the problems; inventing #146 and #183 to make it concrete
  produces the kind of detail a reader repeats and is wrong about. Same for totals and dates
  you did not read — do not round a count the source states precisely.
- Report a survey, poll or consensus only if the source says one happened. People interviewed
  are not people "surveyed". One named person's view stays theirs — never promote it to
  "experts say", and keep any condition they attached to it.
- Explain why something is so only where the source explains it. If it says one field proved
  more approachable and does not say why, report that — do not supply a mechanism of your own.
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
- Length: the assignment gives a target word count. Use paragraphs of three to five sentences.
- Cover the source from start to END. Before writing, map its sections in order and budget
  your paragraphs across all of them — at least one for each major section, and never spend
  more than half your article on the first half of the source. The back half of a long piece
  is usually where its news lives (unpublished results, this year's developments), so
  reaching it is not optional. Running out of room having covered only the opening is a
  failed article, not a shorter one.
- Limits are part of the finding. When the source says what is still unknown, what has not
  been tested in humans, which harder case the result may not cover, or what makes the
  experiment unlike real conditions, those go in your article — and so does the outside
  researcher, not involved in the work, whom the story brings in to weigh it. Journals and
  reporters put that material near the end, which is exactly where a rewrite that runs out
  of room drops it. Cutting it does not shorten the story, it changes the claim: your
  article must not read as more confident about the result than the source is. Give the
  caveats their own paragraph rather than a trailing clause.
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

STYLE — how it should read
- First identify what the source IS. The plain-news register below applies to news
  reporting. If the source is a satirical column, a humor piece or a voiced essay, match
  ITS register instead: say what it is up front (a satirical column by X), keep its jokes
  as jokes and its irony as irony, and follow the piece's own arc rather than forcing a
  news lead onto it. A deliberately absurd example — a gag that breaks its own list — must
  never be flattened into a neutral factual claim; converted that way, a joke reads as an
  error. Satire re-reported as straight news has lost the story.
- Reading level: the assignment gives it. Write to that level exactly.
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
- "related" holds up to 5 OTHER real stories you saw from the same outlet, each with its own
  published headline and a real address you actually saw. Exclude the story you reported.
  Drop an entry rather than guess its address. If you saw none, use an empty array.
- Exactly 5 keywords, chosen for a Korean learner of English.
- Reply with JSON in the shape the assignment gives, and nothing else. No markdown fences,
  no preamble.`;

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
  siblings, // 같은 분야의 다른 매체들. 키워드가 이 매체에서 빈손일 때 훑습니다.
  fieldLabel, // 실패 문구에 어느 분야를 뒤졌는지 밝히는 데 씁니다.
  signal, // 사용자가 중지를 누르면 진행 중인 요청까지 끊습니다.
}) {
  const tick = (m) => {
    try {
      onProgress?.(m);
    } catch {
      /* 진행 표시가 죽어도 본 작업은 계속합니다 */
    }
  };
  // 이 기사 한 편에 든 토큰을 전부 여기에 모읍니다(목록·집필·교정).
  const tally = newTally();
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
  // 키워드가 빈손이면 같은 분야의 다른 매체로 갈아탈 수 있습니다. 그때 매체에
  // 딸린 값(발행 주기, 프롬프트의 매체 이름)도 함께 바뀌어야 하므로 let 으로 두고
  // 갈아탈 때 다시 만듭니다. const 로 두면 바뀐 매체에 옛 매체 이름이 실려 나갑니다.
  let recency = source.window || "the last few days";

  // 사용자가 방향을 적어 넣을 수 있습니다. 다만 요청에 맞는 기사가 없을 때
  // 억지로 지어내면 "실제 뉴스를 읽는다"는 앱의 전제가 무너집니다.
  const makeFocusLine = () =>
    focus
      ? `
The reader is looking for this in particular: ${focus}
The story you report must be about this, or clearly connected to it. A related angle is fine;
something unrelated is not. If ${source.label} published nothing on it in ${recency}, set
"error" rather than reporting an unrelated story, and never stretch or invent a story to fit.
`
      : "";
  let focusLine = makeFocusLine();

  // 매체를 갈아탑니다. 이 아래에서 만들어지는 프롬프트와 도메인 검사가 전부
  // source 를 보므로, 여기 한 곳만 바꾸면 나머지가 따라옵니다.
  const switchTo = (s) => {
    source = s;
    recency = source.window || "the last few days";
    focusLine = makeFocusLine();
  };

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
        listed = await findStories({
          geminiKey, proxy, proxyToken, source, topic, focus, exclude, tally, signal,
          siblings, onStep: tick, fieldLabel,
        });
        // 다른 매체에서 건져 왔을 수 있습니다. 그러면 이후의 도메인 검사와
        // 프롬프트가 전부 그 매체를 기준으로 돌아야 합니다.
        const from = listed[0]?.srcId;
        if (from && from !== source.id) {
          const sib = siblings?.find((s) => s.id === from);
          if (sib) switchTo(sib);
        }
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
      if (e?.name === "AbortError") throw e;
      // 다른 매체 훑기는 findStories 안에서 끝났습니다. 여기까지 왔다는 것은
      // 그 분야 어디에서도 못 찾았다는 뜻입니다.
      {
        // 키워드를 주셨을 때 옛 경로로 넘어가면 무관한 기사를 써 오므로 그대로
        // 알립니다. 실패 이유를 키워드 메시지로 덮지 않고 올립니다.
        if (focus) throw e;
        // 키워드가 없으면 옛 경로로 떨어지는데, 그러면 왜 목록이 실패했는지가
        // 화면에서 사라집니다. 진단할 수 있게 콘솔에 남깁니다.
        console.warn("[nt-listfail]", source?.id, e?.message || e);
        logIssue("목록실패", source?.id, e?.message || e);
        tick("기사를 찾아 다시 쓰는 중…");
      }
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

    return `ASSIGNMENT

${intro}

Write YOUR OWN English article reporting that story, under the rules you were given.

Outlet: ${source.label}
Reading level: ${levelSpec}
Length: ${lengthSpec}.
${quotaRule}

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

  const call = (promptText, schema, useSearch, opts = {}) =>
    gemini({
      geminiKey,
      proxy,
      proxyToken,
      model: opts.model || MODELS.news,
      // 매체를 붙여 둡니다. 같은 집필 호출이라도 매체마다 원문 길이와 성공률이
      // 달라서, 매체별로 갈라 봐야 어디가 비싼지 보입니다.
      purpose: `${opts.purpose || (useSearch ? "news:search" : "news:full")}·${source.id}`,
      signal,
      tally,
      // 규칙은 매 호출 같은 글자라 시스템 지시로 보냅니다(ARTICLE_RULES 주석 참고).
      // system 에 null 을 주면 규칙 없이 부릅니다. 교정 호출이 그렇습니다.
      system: opts.system === undefined ? ARTICLE_RULES : opts.system || undefined,
      // 긴 분량은 검색 경로에서는 여러 번 캐야 하고, 전문 경로에서도 1500단어를
      // 원문 전 구간에 배분하는 설계가 필요합니다. 둘 다 생각이 드는 일이라
      // 길게일 때는 경로와 무관하게 medium 을 씁니다.
      thinkingLevel: opts.thinkingLevel || (length === "long" ? "medium" : "low"),
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      // 전문이 있으면 검색을 끕니다. 다른 기사가 섞일 통로가 사라지고, 검색
      // 주입 입력과 그라운딩 호출 비용도 함께 사라집니다.
      tools: useSearch ? [{ google_search: {} }] : undefined,
      schema,
    });

  // 후보 하나를 놓고 기사를 써 봅니다. 못 쓰면 이유를 돌려주고, 부르는 쪽이
  // 다음 후보로 넘어갑니다. 전문은 아래 사전 훑기에서 이미 받아 둔 것을 받습니다.
  async function attempt(chosen, full) {
    tick(
      full
        ? `전문 ${full.paragraphs.length}문단 확보 · 다시 쓰는 중…`
        : "검색으로 읽고 다시 쓰는 중…"
    );
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
    // 전문이 있으면 다 쓴 기사를 원문과 대조합니다. 원문에 없는 직접 인용과
    // 수치가 있으면 그 목록을 들고 한 번 고쳐 쓰게 합니다. 위반이 없으면
    // 추가 호출도 없습니다.
    if (full) {
      const bad = fidelityIssues(article, full);
      if (bad.quotes.length || bad.numbers.length) {
        logIssue(
          "원문불일치",
          source?.id,
          [
            bad.quotes.length ? `인용 ${bad.quotes.length}건: ${bad.quotes[0].slice(0, 60)}` : "",
            bad.numbers.length ? `수치: ${bad.numbers.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" / ")
        );
        tick("원문과 대조해 고쳐 쓰는 중…");
        try {
          const fixPrompt = `You wrote the article below from the SOURCE TEXT at the end. A check
against that source found material that is not in it. Every item listed here is either invented
or altered — the source is the only authority, and your memory of this story is not evidence.

${bad.quotes.length ? `Quotations not found in the source:\n${bad.quotes.map((q) => `- "${q}"`).join("\n")}\n` : ""}${bad.numbers.length ? `Numbers not found in the source: ${bad.numbers.join(", ")}\n` : ""}
Fix ONLY these. For each one: if the source supports a corrected version, write that; otherwise
delete the claim, and delete the whole sentence or paragraph if what is left says nothing. Never
swap an invented number for another number, and never keep a quotation by attributing it to
someone else. Leave every other sentence exactly as it is. Do not add new material.

Reply with the same JSON object, corrected, and nothing else.

YOUR ARTICLE:
${JSON.stringify({ ...article, related: undefined })}

SOURCE TEXT:

${full.paragraphs.join("\n\n")}`;
          // 교정은 "여기 적힌 것만 고치고 나머지는 그대로 두라"는 좁은 편집이라
          // 집필보다 쉽습니다. 게다가 고친 결과가 더 낫지 않으면 아래에서 폐기하는
          // 안전망이 이미 있어, 작은 모델이 망쳐도 원래 기사로 계속 갑니다.
          // 입력에 기사와 원문이 통째로 들어가는 큰 호출이라 단가 차이가 큽니다.
          // 집필 규칙(ARTICLE_RULES)은 "새로 써라"는 지시라 여기서는 방해가 되므로
          // system 을 비웁니다.
          const fixed = await call(fixPrompt, ARTICLE_SCHEMA, false, {
            model: MODELS.list,
            system: null,
            thinkingLevel: "low",
            purpose: "news:fix",
          });
          const reparsed = tryParse(fixed.text);
          if (reparsed?.paragraphs?.length) {
            const still = fidelityIssues(reparsed, full);
            // 고친 쪽이 더 낫지 않으면 버립니다. 재작성이 오히려 새로 지어내는
            // 경우를 막습니다.
            if (
              still.quotes.length + still.numbers.length <
              bad.quotes.length + bad.numbers.length
            ) {
              article = { ...reparsed, related: article.related };
              if (still.quotes.length || still.numbers.length)
                logIssue(
                  "불일치잔여",
                  source?.id,
                  `인용 ${still.quotes.length} / 수치 ${still.numbers.join(", ") || "없음"}`
                );
            } else {
              logIssue("교정실패", source?.id, "고쳐 쓴 쪽이 더 낫지 않아 폐기");
            }
          }
        } catch {
          // 교정에 실패해도 원래 기사로 계속합니다. 기록은 이미 남았습니다.
        }
      }
    } else {
      // 전문 없이 검색 발췌로 쓴 기사는 원문 대조가 불가능합니다. 날조 위험이
      // 가장 큰 경로이므로, 조용히 지나가지 않도록 남깁니다.
      logIssue("검색집필", source?.id, chosen?.url || "후보 없음");
    }

    // 전문을 실제로 받아온 주소, 또는 발행사 피드에서 온 주소는 실존이
    // 증명된 것입니다.
    return { article, cand, aliveUrl: full || chosen?.proven ? chosen?.url : null };
  }

  // 전문 경로는 그라운딩 쿼리와 검색 주입 입력이 통째로 빠지고, 원문 대조까지
  // 되므로 품질도 더 낫습니다. 예전에는 1번 후보의 전문 추출이 실패하면 그
  // 후보를 그대로 검색 경로로 넘겨서, 2번 후보의 전문이 멀쩡해도 열어 보지
  // 못한 채 비싼 검색 호출을 냈습니다. 추출은 서버 호출이라 과금이 없으므로
  // 후보 셋까지 먼저 훑어 전문이 나오는 후보를 찾습니다. 유료 장벽에 걸린
  // 1번 후보 때문에 검색 경로로 떨어지는 일이 그만큼 줄어듭니다.
  const candidates = picked ? (listed.length ? listed : [picked]) : [];
  const deadUrl = new Set();
  let opened = null; // { chosen, full }
  if (proxy && candidates.length) {
    tick("기사 전문을 가져오는 중…");
    for (const c of candidates.slice(0, 3)) {
      if (!c?.url) continue;
      const full = await fetchFullText(c.url, proxy, proxyToken, signal);
      if (full?.dead) {
        // 주소가 죽어 있으면 이 후보는 검색 경로로도 쓰지 않습니다.
        logIssue("후보주소사망", source?.id, c.url);
        deadUrl.add(c.url);
        continue;
      }
      if (full) {
        opened = { chosen: c, full };
        break;
      }
    }
    if (!opened && candidates.length)
      logIssue("전문실패", source?.id, `후보 ${Math.min(candidates.length, 3)}건 모두 추출 실패`);
  }

  // 1번 후보를 열지 못하는 일이 있습니다. 유료 장벽이 대표적입니다. 목록에
  // 다른 후보가 있는데 거기서 끝내면 아무것도 못 읽게 되므로 다음 후보로
  // 넘어갑니다. 매번 새로 부르는 비싼 호출이라 두 번까지만 시도합니다.
  const live = candidates.filter((c) => c?.url && !deadUrl.has(c.url));
  const attempts = !picked
    ? [{ chosen: null, full: null }]
    : opened
      ? [
          opened,
          ...live
            .filter((c) => c.url !== opened.chosen.url)
            .slice(0, 1)
            .map((c) => ({ chosen: c, full: null })),
        ]
      : live.slice(0, 2).map((c) => ({ chosen: c, full: null }));

  let article = null;
  let cand = null;
  let aliveUrl = null;
  // 실제로 기사를 쓴 경로입니다. aliveUrl 로는 갈음할 수 없습니다 — 피드에서 온
  // 후보는 전문 추출에 실패해 검색으로 썼어도 aliveUrl 이 채워지기 때문입니다.
  let usedFull = false;
  let lastFail = "error";
  let nth = 0;
  for (const { chosen, full } of attempts) {
    if (nth++ > 0) tick("첫 기사를 열지 못해 다음 후보로 넘어가는 중…");
    const r = await attempt(chosen, full);
    if (r.article) {
      article = r.article;
      cand = r.cand;
      aliveUrl = r.aliveUrl || null;
      usedFull = !!full;
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
  // picked.url 은 목록 단계에서 이미 교정을 거쳤고, 모델이 이번 응답에 적어 낸
  // 주소는 여기서 교정합니다. 옮겨 적다 뭉갠 슬러그는 어느 응답에서든 나옵니다.
  article.url =
    aliveUrl ||
    article.sources[0]?.uri ||
    picked?.url ||
    collapseRepeatedSlug(onDomain(article.url, source.domain) || "") ||
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
    const deadOne = await deadUrls([article.url], proxy, proxyToken, signal);
    if (deadOne?.has(article.url)) {
      logIssue("지어낸주소제거", source?.id, article.url);
      article.url = "";
    }
  }

  // 주소가 끝내 비면 화면이 "출처를 확인하지 못했습니다" 경고를 띄웁니다.
  // 여기서 기사를 막지는 않습니다. 위험은 알리되 앱은 쓸 수 있어야 합니다.

  // 목록을 받아 왔다면 나머지 후보가 곧 관련 기사입니다. 검색에서 나온 주소라
  // 모델이 이번 응답에 적어 낸 것보다 믿을 만합니다.
  // srcId 를 함께 넘깁니다. 다른 매체로 갈아탄 뒤 관련 기사를 누르면, 그 기사를
  // 어느 매체 기준으로 다뤄야 하는지 화면 쪽이 알아야 합니다.
  const leftovers = listed
    .slice(1)
    .map((r) => ({ title: r.title, titleKo: "", url: r.url, srcId: r.srcId || source.id }))
    .filter((r) => r.url && r.url !== article.url);

  article.related = leftovers.length
    ? leftovers.slice(0, 5)
    : (Array.isArray(article.related) ? article.related : [])
        .map((r) => ({
          title: stripMarkers(r?.title),
          titleKo: stripMarkers(r?.titleKo),
          // 관련 기사 주소도 모델이 적어 낸 것이라 같은 교정을 거칩니다.
          url: collapseRepeatedSlug(onDomain(r?.url, source.domain) || "") || "",
          srcId: source.id,
        }))
        .filter((r) => r.title && r.url && r.url !== article.url && looksLikeArticleUrl(r.url))
        .slice(0, 5);

  // 완성된 기사의 크기를 남깁니다. 호출 기록만으로는 "이 매체에서 이만한 글을
  // 뽑으면 얼마인가"를 알 수 없습니다. 매체별 비용을 글자수로 나누면 자당 단가가
  // 나오고, 그러면 생성 전에 대략의 청구액을 짐작할 수 있습니다. 본문은 담지
  // 않습니다. 세어 본 숫자만 남깁니다.
  const bodyText = article.paragraphs.join(" ");
  logArticle({
    src: source.id,
    level,
    len: length,
    chars: bodyText.length,
    words: bodyText.split(/\s+/).filter(Boolean).length,
    calls: tally.calls,
    path: usedFull ? "full" : "search",
  });

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
export async function findStories({
  geminiKey, proxy, proxyToken, source, topic, focus, exclude, tally, signal,
  siblings, // 같은 분야의 다른 매체들. 키워드가 빈손일 때 이쪽 피드를 훑습니다.
  onStep, // 진행 표시 콜백(선택).
  fieldLabel, // 실패 문구에 어느 분야를 뒤졌는지 밝히는 데 씁니다.
}) {
  // 피드가 있는 매체는 발행사 목록이 곧 진실입니다. 성공하면 검색 목록을
  // 아예 부르지 않습니다. 빈손이면(키워드가 최근 목록에 없음, 피드 응답
  // 실패 등) 아래 검색 경로가 그대로 이어받습니다.
  const fed = await feedStories({ geminiKey, proxy, proxyToken, source, focus, exclude, tally, signal });
  if (fed?.length) return fed;

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
      purpose: `list·${source.id}`,
      tally,
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
  // 허위 목록은 하류가 잡습니다. 도메인과 주소 모양 검사, 서버 링크 검사,
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
      srcId: source.id,
    }))
    // 검색 목록의 주소는 모델이 옮겨 적은 것이라 슬러그가 뭉개질 수 있습니다.
    // 피드 주소는 발행사가 적은 것이라 손대지 않습니다.
    .map((s) => ({ ...s, url: s.url ? collapseRepeatedSlug(s.url) : s.url }))
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
    proxyToken,
    signal
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
  if (top.length) return top;

  // 이 매체에서 빈손입니다. 키워드가 있으면 같은 분야의 다른 매체 피드를 훑습니다.
  // 매체마다 다루는 주제가 달라서, 고른 곳에 없을 뿐 옆 매체에는 있는 일이 흔합니다.
  // 검색 그라운딩까지 매체 수만큼 돌리면 값이 그만큼 붙으므로 피드만 봅니다.
  const swept = [];
  if (focus && siblings?.length) {
    for (const sib of siblings) {
      if (!sib?.feed) continue;
      swept.push(sib.label);
      onStep?.(`${sib.label} 쪽도 찾아보는 중…`);
      let alt = null;
      try {
        alt = await feedStories({
          geminiKey, proxy, proxyToken, source: sib, focus, exclude, tally, signal,
        });
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        logIssue("타매체실패", sib?.id, String(err?.message || err));
      }
      if (alt?.length) {
        logIssue("타매체대체", source?.id, `"${focus}" → ${sib.id} 에서 ${alt.length}건`);
        return alt;
      }
    }
    logIssue("타매체빈손", source?.id, `"${focus}" · 훑은 매체: ${swept.join(", ") || "없음"}`);
  }

  throw new Error(
    focus
      ? // 어느 매체에서 못 찾았는지를 밝혀야 합니다. 예전 문구는 "매체나 조건을
        // 바꿔 보라"고만 해서, 그 매체가 원래 그 주제를 다루지 않는다는 것을 모른 채
        // 같은 조합으로 계속 다시 누르게 됩니다. 다른 매체까지 훑었다면 그 사실도
        // 밝혀야 합니다. 안 그러면 훑고도 안 훑은 것처럼 보입니다.
        // 어느 분야를 뒤졌는지도 밝힙니다. 분야가 내가 고른 것과 다르면 그 자리에서
        // 드러나야 합니다(새로고침으로 선택이 되돌아간 적이 있었습니다).
        (swept.length
          ? `${fieldLabel ? `${fieldLabel} 분야의 ` : ""}${source.label}와 ${swept.join(", ")} ` +
            `최근 기사에서 "${focus}" 관련 내용을 찾지 못했습니다. ` +
            `이 분야가 다루지 않는 주제일 수 있으니, 다른 분야를 고르거나 키워드를 비우고 받아 보세요.`
          : `${source.label} 최근 기사에서 "${focus}" 관련 내용을 찾지 못했습니다. ` +
            `이 매체가 다루지 않는 주제일 수 있으니, 다른 매체를 고르거나 키워드를 비우고 받아 보세요.`)
      : "기사를 찾지 못했습니다. 조건을 바꿔 보세요."
  );
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
    purpose: "lookup:word",
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
    purpose: "lookup:phrases",
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
    purpose: "lookup:phrase",
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
    purpose: "lookup:sentence",
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
    purpose: "chat",
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
