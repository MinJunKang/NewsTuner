import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchArticle,
  findStories,
  findPhrases,
  lookupWord,
  lookupPhrase,
  lookupSentence,
  discuss,
  safeUrl,
  logIssue,
} from "./api.js";
// 설명서 본문. 앱 화면과 PDF 가 같은 파일을 읽습니다(docs/build-guide.py 참고).
import GUIDE from "./guide.json";

/* ---------------- config ---------------- */

// 분야마다 그 분야를 잘 쓰는 매체를 짝지어 둡니다. 매체와 주제를 따로 고르게
// 하면 "미술 잡지에서 경제 기사" 같은 빈 조합이 생깁니다.
// window 는 매체의 발행 주기입니다. 주간지에 "며칠 내"를 요구하면 기사가 없습니다.
const FIELDS = [
  {
    id: "news",
    label: "News",
    topic: "the day's main US or international news story",
    sources: [
      { id: "npr", length: "mid", label: "NPR", short: "NPR", freq: "88.5",
        domain: "npr.org",
        feed: "https://feeds.npr.org/1001/rss.xml",
        window: "the last few days", note: "방송 원고라 말하는 리듬에 가까움" },
      // 원래 이 자리는 AP 였습니다. AP 는 RSS 를 공식 폐지해 피드를 붙일 수 없고,
      // 그래서 늘 검색 경로로 떨어지는데 그라운딩이 apnews.com 에서 결과를 못 가져와
      // 모델이 주소를 지어냈습니다(2026-08 기록에 "목록전멸 — 지어낸 목록으로 봄"
      // 4회). 피드가 있는 매체로 바꿔야 이 자리가 제 몫을 합니다.
      { id: "guardian", length: "mid", label: "The Guardian US", short: "GUARD", freq: "89.7",
        domain: "theguardian.com",
        feed: "https://www.theguardian.com/us-news/rss",
        window: "the last few days", note: "미국 뉴스 전반, 평이하고 또렷한 문장" },
      { id: "propub", length: "long", label: "ProPublica", short: "PROPUB", freq: "90.1",
        domain: "propublica.org",
        feed: "https://www.propublica.org/feeds/propublica/main",
        window: "the last week", note: "탐사보도 장문, CC 라이선스" },
    ],
  },
  {
    id: "world",
    label: "World",
    topic: "international affairs and foreign policy",
    sources: [
      { id: "pbs", length: "mid", label: "PBS NewsHour", short: "PBS", freq: "90.9",
        domain: "pbs.org",
        feed: "https://www.pbs.org/newshour/feeds/rss/headlines",
        window: "the last few days", note: "깊이 있으면서 문장이 정갈함" },
      { id: "tconv", length: "mid", label: "The Conversation US", short: "CONV", freq: "91.5",
        domain: "theconversation.com",
        feed: "https://theconversation.com/us/articles.atom",
        window: "the last few days", note: "학자가 직접 쓰는 해설, 문장 밀도 높음" },
      { id: "bbc", length: "mid", label: "BBC News", short: "BBC", freq: "92.3",
        domain: "bbc.com",
        feed: "https://feeds.bbci.co.uk/news/world/rss.xml",
        window: "the last few days", note: "세계 보도의 표준, 평이하고 명확한 문장" },
    ],
  },
  {
    id: "tech",
    label: "Tech · Science",
    topic: "science, mathematics or technology research",
    sources: [
      { id: "quanta", length: "long", label: "Quanta Magazine", short: "QUANTA", freq: "93.1",
        domain: "quantamagazine.org",
        feed: "https://www.quantamagazine.org/feed/",
        window: "the last two weeks", note: "어려운 개념을 명료한 영어로 푸는 교본" },
      { id: "mittr", length: "long", label: "MIT Technology Review", short: "MIT TR", freq: "94.7",
        domain: "technologyreview.com",
        feed: "https://www.technologyreview.com/feed/",
        window: "the last week", note: "AI·기술 정책, 연구자 어휘" },
      { id: "ars", length: "mid", label: "Ars Technica", short: "ARS", freq: "95.5",
        domain: "arstechnica.com",
        feed: "https://feeds.arstechnica.com/arstechnica/index",
        window: "the last few days", note: "IT·과학 실무 보도, 뉴스는 짧고 특집은 김" },
    ],
  },
  {
    id: "health",
    label: "Health",
    topic: "health, medicine or biotechnology",
    sources: [
      { id: "shots", length: "mid", label: "NPR Shots", short: "SHOTS", freq: "96.3",
        domain: "npr.org",
        feed: "https://feeds.npr.org/103537970/rss.xml",
        window: "the last week", note: "일반 독자용 건강 보도" },
      { id: "scinews", length: "mid", label: "Science News", short: "SCINEWS", freq: "97.1",
        domain: "sciencenews.org",
        feed: "https://www.sciencenews.org/feed",
        // lite 가 이 매체의 기사 주소를 상습적으로 지어내는 것이 확인되어,
        // 목록만 큰 모델로 만듭니다.
        heavyList: true,
        window: "the last few days", note: "짧고 명확한 연구 뉴스, 매일 발행" },
    ],
  },
  {
    id: "economy",
    label: "Economy",
    topic: "the economy, markets or business",
    sources: [
      { id: "pmoney", length: "mid", label: "NPR Planet Money", short: "PMONEY", freq: "98.7",
        domain: "npr.org",
        feed: "https://feeds.npr.org/93559255/rss.xml",
        window: "the last two weeks", note: "경제 개념을 이야기로 풀어냄, 구어체" },
      { id: "mktpl", length: "short", label: "Marketplace", short: "MKTPL", freq: "99.5",
        domain: "marketplace.org",
        feed: "https://feeds.publicradio.org/public_feeds/marketplace/rss/rss",
        window: "the last week", note: "비즈니스 뉴스를 쉽게" },
    ],
  },
  {
    id: "law",
    label: "Law",
    // The Conversation 은 법을 별도 섹션 없이 정치·사회 아래 흩어 두므로,
    // 검색이 걸리도록 그들이 실제로 쓰는 표현(대법원, 판결, 소송, 헌법)을 넓게 겁니다.
    topic: "court rulings, the Supreme Court, lawsuits, legal disputes and constitutional questions",
    sources: [
      { id: "scotus", length: "mid", label: "SCOTUSblog", short: "SCOTUS", freq: "100.1",
        domain: "scotusblog.com",
        feed: "https://www.scotusblog.com/feed/",
        window: "the last week", note: "연방대법원 전문, 법률가가 일반 독자용으로 풀어 씀" },
      { id: "tclaw", length: "mid", label: "The Conversation · Law", short: "TC LAW", freq: "100.7",
        domain: "theconversation.com",
        // 토픽 피드 주소는 슬러그가 아니라 뒤의 숫자로 해석됩니다. 아무 슬러그나
        // 붙여도 200 이 오고 엉뚱한 주제가 오므로(us-supreme-court-1163 은 실제로
        // 미생물 법의학입니다), 숫자를 바꾸면 반드시 내용을 확인해야 합니다.
        // 78 = Law. 미국판 외 기사도 섞여 옵니다.
        feed: "https://theconversation.com/us/topics/law-78/articles.atom",
        // 법 섹션은 주간 발행량이 적어 1주 창으로는 검색이 빈손이 됩니다.
        window: "the last month", note: "법학 교수의 해설, 배경 설명이 친절함" },
    ],
  },
  {
    id: "culture",
    label: "Culture",
    topic: "culture, society, media or sports",
    sources: [
      { id: "atlantic", length: "long", label: "The Atlantic", short: "ATLNTIC", freq: "101.1",
        domain: "theatlantic.com",
        feed: "https://www.theatlantic.com/feed/all/",
        window: "the last week", note: "에세이형 장문, 어휘 수준 높음" },
      { id: "ringer", length: "long", label: "The Ringer", short: "RINGER", freq: "102.3",
        domain: "theringer.com",
        window: "the last week", note: "스포츠·팝컬처, 관용표현이 살아 있음" },
      { id: "defector", length: "long", label: "Defector", short: "DFCTR", freq: "103.3",
        domain: "defector.com",
        feed: "https://defector.com/feed",
        window: "the last few days", note: "전직 Deadspin 기자들, 구어체가 생생함" },
    ],
  },
  {
    id: "art",
    label: "Art",
    topic: "art, design, museums or architecture",
    sources: [
      { id: "hyper", length: "short", label: "Hyperallergic", short: "HYPER", freq: "104.5",
        domain: "hyperallergic.com",
        feed: "https://hyperallergic.com/feed/",
        window: "the last week", note: "현대미술 비평, 관점이 뚜렷함" },
      { id: "colossal", length: "short", label: "Colossal", short: "CLSSL", freq: "105.9",
        domain: "thisiscolossal.com",
        feed: "https://www.thisiscolossal.com/feed/",
        window: "the last week", note: "현대 시각예술·공예, 짧은 소개글 형식" },
    ],
  },
];

// paste 는 생성 난이도가 아니라 "원문을 직접 붙여넣어 읽기" 모드입니다.
const LEVELS = [
  { id: "easy", label: "쉽게", hint: "B2 · 자연스러운 뉴스체" },
  { id: "hard", label: "원문 수준", hint: "C1 · 실제 기사 문체, 표현은 새로 씀" },
  { id: "paste", label: "원문", hint: "직접 붙여넣어 원문 그대로 읽기" },
];

// 통신사 단신이 400~900단어, Quanta·Atlantic 같은 장문 매체는 1,500~3,000단어입니다.
// 예전 기준(200/400/800)은 장문 매체를 골라도 단신 분량밖에 안 나왔습니다.
const LENGTHS = [
  { id: "short", label: "짧게", hint: "약 400단어 · 통신사 단신 분량" },
  { id: "mid", label: "보통", hint: "약 800단어 · 일반 웹기사 분량" },
  { id: "long", label: "길게", hint: "약 1,500단어 · 장문 매체 분량" },
];

// 오류 기록을 받을 주소. 스팸 수집기는 "아이디@도메인" 패턴을 정규식으로
// 긁으므로, 조각으로 쪼개 클릭 순간에만 조립합니다. 소스와 빌드 결과물과
// 화면 어디에도 완성된 주소가 문자열로 존재하지 않습니다.
// (직전 커밋 히스토리에는 평문이 남아 있어 완전한 은닉은 아닙니다.)
// 개발자에게 전송용 구글 폼. 만들어서 두 ID 를 채우면 "개발자에게 전송" 버튼이 나타납니다.
// 브라우저는 메일을 직접 발송할 수 없으므로, 폼으로 무음 POST 하고
// 폼의 "새 응답 이메일 알림"이 Gmail 로 알려주는 방식입니다. README 부록 참고.
const REPORT_FORM = {
  formId: "1FAIpQLScYfITPzPO2iDUAqhUMk94PzzlHzWOgt-m4dQoVRuKPlRqyvg",
  entryId: "2050914000",
};

// 사용량 기록을 받을 폼. 오류 기록과 섞이면 둘 다 읽기 어려워지므로 폼을 따로
// 씁니다. 새 구글 폼을 만들어 두 ID 를 채우면 설정에 전송 버튼이 나타납니다.
// (폼 편집 화면에서 미리보기 → 개발자 도구로 entry.XXXX 를 확인하면 됩니다.)
// entryId 는 폼 주소에 없습니다. 폼 편집 화면 오른쪽 위 ⋮ → "미리 채워진 링크
// 가져오기" 로 아무 값이나 넣고 링크를 만들면, 그 주소에 entry.<숫자> 가 나옵니다.
// 그 숫자만 아래에 넣으면 설정 탭에 "개발자에게 전송" 버튼이 나타납니다.
// 폼 "NewsTuner Statistics" 의 유일한 항목(Statistics, 장문 답변)입니다.
// 설정의 "서버 주소" 기본값입니다. 토큰을 받은 사람은 토큰만 넣으면 되도록 미리
// 채워 둡니다. 주소만으로는 아무것도 못 합니다 — 서버가 토큰 없는 요청을 401 로
// 막습니다(api/_shared.js 의 gate). 자기 서버를 따로 띄운 사람은 이 칸을 고치면 됩니다.
const DEFAULT_SERVER = "https://news-tuner.vercel.app/api";

const USAGE_FORM = {
  formId: "1FAIpQLSeo5oTVRiTbMq5pd9VSpQDN6bGRCrIzESIJmXisCp8IchXWEA",
  entryId: "627572218",
};

// 최근 기록을 전송용 한 줄 요약으로 만듭니다.
function summarizeErrLog(maxChars) {
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem("nt-errlog") || "[]");
  } catch {
    entries = [];
  }
  if (!entries.length) return null;
  const lines = entries
    .slice(0, 30)
    .map((e) => `${(e.t || "").slice(0, 16)} [${e.kind}] ${e.where}: ${e.msg}`);
  let body = `News Tuner 오류 기록 (빌드 ${__BUILD_ID__}, 최근 ${lines.length}건)\n\n`;
  for (const l of lines) {
    if ((body + l).length > maxChars) break;
    body += l + "\n";
  }
  return body;
}

function usageEntries() {
  try {
    const arr = JSON.parse(localStorage.getItem("nt-usagelog") || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 100만 토큰당 단가입니다(2026년 8월 기준). 3.7 Flash 는 2027-01-01 에 $1.50/$7.50
// 로 오르므로 그때 여기를 고쳐야 합니다. 생각 토큰은 출력 단가로 청구됩니다.
//
// 금액은 사용량 기록에만 씁니다. 이 요약은 화면에 그려지지 않고 "복사"와
// "개발자에게 전송" 으로만 나갑니다. README 와 화면에는 청구액을 적지 않습니다.
const PRICE = {
  "gemini-3.7-flash": { in: 0.75, cached: 0.15, out: 3.75 },
  "gemini-3.5-flash-lite": { in: 0.3, cached: 0.06, out: 2.5 },
};

// 호출 한 건의 값. 입력 토큰 수에는 캐시로 할인된 몫이 포함돼 있으므로 빼고 셉니다.
function callCost(e) {
  const p = PRICE[e?.m] || PRICE["gemini-3.7-flash"];
  const cache = e?.cache || 0;
  const plain = Math.max(0, (e?.in || 0) - cache);
  return (plain * p.in + cache * p.cached + ((e?.out || 0) + (e?.think || 0)) * p.out) / 1e6;
}

// 단계 이름에서 매체를 떼어 냅니다. "news:full·guardian" → "guardian".
const outletOf = (p) => (typeof p === "string" && p.includes("·") ? p.split("·").pop() : "");

// 토큰 사용량을 한 장으로 만듭니다. 개별 호출을 그대로 보내면 수백 줄이 되고,
// 정작 알고 싶은 것은 안 보입니다. 알고 싶은 것은 셋입니다 — 어느 단계가 비용을
// 먹나, 매체마다 기사 한 편이 얼마인가, 글자당 얼마인가.
// 숫자와 모델 이름만 담습니다. 기사 본문, 검색어, 단어, 주소는 담지 않습니다.
function summarizeUsageLog(maxChars) {
  const entries = usageEntries();
  if (!entries.length) return null;
  const calls = entries.filter((e) => e?.kind !== "article");
  const articles = entries.filter((e) => e?.kind === "article");

  const groups = new Map();
  for (const e of calls) {
    const key = `${e?.p || "?"} · ${e?.m || "?"}`;
    const g = groups.get(key) || { n: 0, in: 0, cache: 0, tool: 0, think: 0, out: 0, total: 0, usd: 0 };
    g.n += 1;
    for (const f of ["in", "cache", "tool", "think", "out", "total"]) g[f] += e?.[f] || 0;
    g.usd += callCost(e);
    groups.set(key, g);
  }

  // 매체별로 비용·토큰(호출 기록)과 글자수(기사 기록)를 모읍니다. 100자당 단가가
  // 나오면 분량만으로 생성 전에 청구액을 가늠할 수 있습니다.
  const byOutlet = new Map();
  const bucket = (k) => {
    if (!byOutlet.has(k)) byOutlet.set(k, { usd: 0, tok: 0, chars: 0, arts: 0, calls: 0, full: 0 });
    return byOutlet.get(k);
  };
  for (const e of calls) {
    const o = outletOf(e?.p);
    if (!o) continue;
    const b = bucket(o);
    b.usd += callCost(e);
    b.tok += e?.total || 0;
    b.calls += 1;
  }
  for (const a of articles) {
    const b = bucket(a?.src || "?");
    b.chars += a?.chars || 0;
    b.arts += 1;
    if (a?.path === "full") b.full += 1;
  }

  const times = entries.map((e) => (e?.t || "").slice(0, 10)).filter(Boolean).sort();
  const grand = [...groups.values()].reduce((a, g) => a + g.total, 0);
  const grandUsd = [...groups.values()].reduce((a, g) => a + g.usd, 0);
  let body =
    `News Tuner 사용량 (빌드 ${__BUILD_ID__}, ${times[0] || "?"}~${times[times.length - 1] || "?"}, ` +
    `호출 ${calls.length}회 / 기사 ${articles.length}편, 합계 ${grand.toLocaleString()} 토큰 = $${grandUsd.toFixed(4)})\n\n` +
    `[매체별] 매체 | 기사 | 글자 | 토큰 | 비용 | 기사당 | 100자당 | 호출/기사 | 전문경로\n`;

  const outlets = [...byOutlet.entries()].sort((a, b) => b[1].usd - a[1].usd);
  for (const [name, b] of outlets) {
    const per = b.arts ? `$${(b.usd / b.arts).toFixed(4)}` : "—";
    // 자당 단가는 0 이 너무 많이 붙어 100자 기준으로 보여 줍니다.
    const per100 = b.chars ? `$${((b.usd / b.chars) * 100).toFixed(5)}` : "—";
    const cpa = b.arts ? (b.calls / b.arts).toFixed(1) : "—";
    body +=
      `${name} | ${b.arts} | ${b.chars.toLocaleString()} | ${b.tok.toLocaleString()} | $${b.usd.toFixed(4)} | ${per} | ${per100} | ${cpa} | ${b.full}/${b.arts}\n`;
  }

  body += `\n[기사별] 매체 | 난이도·분량 | 글자 | 단어 | 호출 | 경로\n`;
  for (const a of articles.slice(0, 20)) {
    const line = `${a?.src || "?"} | ${a?.level || "?"}·${a?.len || "?"} | ${(a?.chars || 0).toLocaleString()} | ${(a?.words || 0).toLocaleString()} | ${a?.calls ?? "?"} | ${a?.path || "?"}\n`;
    if ((body + line).length > maxChars) break;
    body += line;
  }

  body += `\n[단계별] 단계·모델 | 호출 | 입력(캐시/검색주입) | 생각 | 출력 | 회당합계 | 비용\n`;
  const rows = [...groups.entries()].sort((a, b) => b[1].usd - a[1].usd);
  for (const [key, g] of rows) {
    const line =
      `${key} | ${g.n} | ${g.in.toLocaleString()}(${g.cache.toLocaleString()}/${g.tool.toLocaleString()})` +
      ` | ${g.think.toLocaleString()} | ${g.out.toLocaleString()} | ${Math.round(g.total / g.n).toLocaleString()}` +
      ` | $${g.usd.toFixed(4)}\n`;
    if ((body + line).length > maxChars) break;
    body += line;
  }
  return body;
}

// 구글 폼으로 무음 POST 합니다. no-cors 라 성공 여부는 알 수 없습니다.
async function postToForm(form, body) {
  if (!form.formId || !form.entryId || !body) return false;
  try {
    await fetch(`https://docs.google.com/forms/d/e/${form.formId}/formResponse`, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ [`entry.${form.entryId}`]: body }),
    });
    return true;
  } catch {
    return false;
  }
}

const TABS = [
  ["read", "읽기"],
  ["talk", "질의응답"],
  ["vocab", "단어장"],
  ["set", "설정"],
];

/* ---------------- storage ---------------- */

const load = (k, fb) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? fb : JSON.parse(v);
  } catch {
    return fb;
  }
};
// 실패를 삼키면 화면에는 저장된 것처럼 보이는데 앱을 껐다 켜면 사라집니다.
// 성공 여부를 돌려주어 부르는 쪽에서 알릴 수 있게 합니다.
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

// 남이 준 파일일 수도 있으므로 모양을 검사하고 길이를 자릅니다.
const cleanEntry = (e) => {
  const word = typeof e?.word === "string" ? e.word.trim().slice(0, 100) : "";
  if (!word) return null;
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return {
    word,
    ko: str(e.ko, 300),
    example: str(e.example, 500),
    kind: str(e.kind, 20),
    at: Number.isFinite(e.at) ? e.at : Date.now(),
  };
};

/* ---------------- text utils ---------------- */

const splitSentences = (p) => p.match(/[^.!?]+[.!?]+["'’)\]]*\s*|[^.!?]+$/g) || [p];
// 악센트 라틴 글자(café, Beyoncé)까지 단어의 일부로 봅니다. A-Za-z 만 두면
// 끝의 é 가 잘려 "caf" 를 사전에 찾게 됩니다.
const cleanWord = (t) =>
  t.replace(/^[^A-Za-z\u00C0-\u024F'’-]+|[^A-Za-z\u00C0-\u024F'’-]+$/g, "");

// 키워드 카드에는 원문 문장이 없으므로, 본문에서 그 단어가 실제로 나오는
// 문장을 찾아 사전에 넘깁니다. 한국어 쓰임 메모를 문장 자리에 넣으면 모델이
// 그 메모를 원문 문장으로 알고 풀이합니다.
const sentenceWith = (word, paragraphs) => {
  const needle = word.toLowerCase();
  for (const p of paragraphs || []) {
    if (!p.toLowerCase().includes(needle)) continue;
    for (const sent of splitSentences(p)) {
      if (sent.toLowerCase().includes(needle)) return sent.trim();
    }
  }
  return "";
};

// 찾아낸 표현이 이 문장의 몇 번째 토큰에 걸쳐 있는지 계산합니다.
// 토큰은 공백까지 포함해 이어 붙이면 원문 문장이 되므로, 문자 위치로 맞춥니다.
function markPhrases(toks, phrases) {
  const marks = new Map();
  if (!phrases.length) return marks;

  const lower = toks.join("").toLowerCase();
  const starts = [];
  let pos = 0;
  for (const t of toks) {
    starts.push(pos);
    pos += t.length;
  }

  for (const p of phrases) {
    const needle = p.text.toLowerCase();
    let from = 0;
    let at;
    while ((at = lower.indexOf(needle, from)) !== -1) {
      const end = at + needle.length;
      for (let i = 0; i < toks.length; i++) {
        const s = starts[i];
        if (s + toks[i].length > at && s < end) marks.set(i, p.text);
      }
      from = at + needle.length;
    }
  }
  return marks;
}

const NO_MARKS = new Map();

/* ---------------- 붙여넣기 본문 추리기 ---------------- */

// 페이지를 통째로 복사하면 메뉴, 공유 버튼, 캡션, 푸터가 함께 딸려옵니다.
// 처음에는 이 단어로 시작하는 줄을 길이와 무관하게 버렸는데, "Home prices
// rose..." "Search teams recovered..." 같은 멀쩡한 문장까지 잘려 나갔습니다.
// 메뉴와 캡션은 짧다는 성질을 함께 써서, 여섯 단어 이하일 때만 크롬으로 봅니다.
const CHROME_WORD =
  /^(share|tweet|save|print|copy link|subscribe|sign ?in|log ?in|menu|search|skip to|read more|related|more from|most popular|follow|comments?|photo|image|credit|getty|copyright|©|advertisement|sponsored|newsletter|watch|listen|live|donate|support|home|sections?|terms|privacy|cookie)\b/i;

// 줄 어디에 있든 광고인 문구들. 여기에는 본문에 나올 수 있는 낱말(newsletter,
// advertisement 단독)을 두지 않습니다. "newsletter business" 같은 보도가
// 잘려 나갑니다. 그런 낱말은 위의 짧은 줄 검사가 잡습니다.
const PROMO =
  /sign up for (our|the|a)|subscribe (to|now|today|for)|delivered to your inbox|promoted content|partner content|click here|tap here|follow us on|download (our|the) app|get the app|free trial|\d+% off|unlimited access|support (our|independent) journalism|become a (member|subscriber)|make a (gift|donation)|all rights reserved|terms of (use|service)|privacy policy|cookie (policy|settings|preferences)|we use cookies|enable javascript|your browser (does not|doesn't) support|share this (story|article)/i;

const wordsIn = (l) => l.split(/\s+/).filter(Boolean).length;
const endsSentence = (l) => /[.!?]["'’)\]]?$/.test(l);
const isChrome = (l) => (CHROME_WORD.test(l) && wordsIn(l) <= 6) || PROMO.test(l);

// 문장처럼 생긴 줄만 본문 구간의 기둥으로 삼습니다.
const looksLikeBody = (l) =>
  !isChrome(l) && wordsIn(l) >= 12 && (endsSentence(l) || wordsIn(l) >= 25);

function extractBody(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const flags = lines.map(looksLikeBody);
  if (!flags.includes(true)) return null;

  // 본문처럼 보이는 줄이 이어지는 구간을 나눠 가장 두꺼운 것을 씁니다. 하단
  // 관련 기사 요약이 문장처럼 생겨도 별도의 얇은 구간이 되어 탈락합니다.
  // 캡션이나 광고 한두 줄로 구간을 끊으면 기사 후반부가 통째로 사라지므로,
  // 본문 아닌 줄 셋까지는 같은 구간으로 참습니다. 푸터 크롬은 여럿이 연달아
  // 나와 어차피 끊깁니다.
  const runs = [];
  let cur = null;
  let gap = 0;
  for (let i = 0; i < lines.length; i++) {
    if (flags[i]) {
      if (!cur) cur = { start: i, end: i };
      cur.end = i;
      gap = 0;
    } else if (cur && ++gap > 3) {
      runs.push(cur);
      cur = null;
      gap = 0;
    }
  }
  if (cur) runs.push(cur);

  let best = runs[0];
  let bestWords = 0;
  for (const r of runs) {
    let w = 0;
    for (let i = r.start; i <= r.end; i++) if (flags[i]) w += wordsIn(lines[i]);
    if (w > bestWords) {
      bestWords = w;
      best = r;
    }
  }

  // 고른 구간 안에서는 관대하게 남깁니다. 짧아도 마침표가 있으면 "No," she
  // said. 같은 인용 문단입니다. 크롬만 뺍니다.
  const paragraphs = lines
    .slice(best.start, best.end + 1)
    .filter(
      (l, i) =>
        flags[best.start + i] ||
        (!isChrome(l) && (wordsIn(l) >= 8 || (wordsIn(l) >= 2 && endsSentence(l))))
    );

  // 제목은 본문 바로 위에서 찾습니다. 너무 멀리 올라가면 메뉴를 집습니다.
  let title = "";
  for (let i = best.start - 1; i >= 0 && i >= best.start - 6; i--) {
    const l = lines[i];
    if (!isChrome(l) && wordsIn(l) >= 3 && wordsIn(l) <= 20) {
      title = l;
      break;
    }
  }

  return { title, paragraphs, removed: lines.length - paragraphs.length };
}

// 화면이 paragraphs 를 그대로 그리므로, 모양이 깨진 기사는 아예 들이지 않습니다.
const isArticle = (a) =>
  !!a && Array.isArray(a.paragraphs) && a.paragraphs.length > 0;

/* ---------------- pieces ---------------- */

// FM 대역에 맞춰 바늘 위치를 잡습니다. 매체 주파수는 88.5~105.9 사이라
// 양쪽에 여유를 두면 바늘이 가장자리에 붙지 않습니다.
const FREQ_MIN = 87.5;
const FREQ_MAX = 107.5;
const needleAt = (freq) => {
  const f = parseFloat(freq);
  if (!Number.isFinite(f)) return 50;
  const pct = ((f - FREQ_MIN) / (FREQ_MAX - FREQ_MIN)) * 100;
  return Math.min(97, Math.max(3, pct));
};

function Dial({ source, tuning }) {
  return (
    <div className={"dial" + (tuning ? " dial--tuning" : "")}>
      <div className="dial__ticks">
        {Array.from({ length: 41 }).map((_, i) => (
          <span key={i} className={"dial__tick" + (i % 5 === 0 ? " dial__tick--major" : "")} />
        ))}
      </div>
      <div className="dial__needle" style={{ left: `${needleAt(source.freq)}%` }} />
      <div className="dial__row">
        <span className="dial__freq">
          <span className={"led" + (tuning ? " led--live" : "")} />
          {source.freq} {source.short}
        </span>
      </div>
    </div>
  );
}

const Chip = ({ on, children, ...rest }) => (
  <button {...rest} className={"chip" + (on ? " chip--on" : "")} aria-pressed={!!on}>
    {children}
  </button>
);

const Spinner = ({ label }) => <p className="spinner">{label}</p>;

// 예문에서 그 단어가 실제로 쓰인 자리를 찾아 [앞, 쓰인 부분, 뒤] 로 잘라 줍니다.
// 저장된 형태와 예문 속 형태가 다를 수 있어(surge 를 저장했는데 예문은 surged),
// 그대로 못 찾으면 어간으로 한 번 더 찾습니다. 구(phrase)는 자리표시자가 섞여
// 있으므로(take (something) for granted) 괄호를 걷어내고도 시도합니다.
// 끝내 못 찾으면 null 을 돌려주고 문장을 그대로 씁니다. 강조가 빠지는 것보다
// 문장이 깨지는 쪽이 훨씬 나쁩니다.
function markUsage(example, word) {
  if (typeof example !== "string" || typeof word !== "string" || !example || !word) return null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = word.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const stem = bare.replace(/(ies|ied|es|ed|ing|s|d)$/i, "");

  const tries = [word, bare].filter(Boolean).map((w) => new RegExp(`\\b${esc(w)}\\b`, "i"));

  // "take (something) for granted" 는 예문에서 목적어가 사이에 끼어 들어옵니다
  // ("take clean water for granted"). 자리표시자 자리를 몇 단어까지 건너뛰게 둡니다.
  if (/\([^)]*\)/.test(word)) {
    const segs = word.split(/\([^)]*\)/).map((s) => s.trim()).filter(Boolean);
    if (segs.length >= 2)
      tries.push(new RegExp(`\\b${segs.map(esc).join("[\\w\\s'’-]{1,40}?")}\\b`, "i"));
  }

  if (stem.length >= 4 && !stem.includes(" ")) tries.push(new RegExp(`\\b${esc(stem)}\\w*\\b`, "i"));

  for (const re of tries) {
    const m = example.match(re);
    if (m && m.index != null)
      return [example.slice(0, m.index), m[0], example.slice(m.index + m[0].length)];
  }
  return null;
}

// 설명서를 앱 안에서 그립니다. PDF 로 내보내면 홈 화면에 설치한 상태에서는
// 미리보기에 갇혀 앱으로 돌아올 방법이 없습니다(주소창도 뒤로 가기도 없습니다).
// 본문은 src/guide.json 한 곳에만 두고 PDF 생성기도 같은 파일을 읽습니다.
// 두 벌로 나누면 한쪽만 고쳐져 설명이 어긋납니다.
function GuideBlock({ b }) {
  if (b.type === "part") return <h2 className="guide__part">{b.title}</h2>;
  if (b.type === "section")
    return (
      <h3 className="guide__section">
        {b.n}. {b.title}
      </h3>
    );
  if (b.type === "sub") return <h4 className="guide__sub">{b.title}</h4>;
  if (b.type === "body") return <p className="guide__body">{b.text}</p>;
  if (b.type === "step")
    return (
      <p className="guide__step">
        <span className="guide__num">{b.n}</span>
        {b.text}
      </p>
    );
  if (b.type === "bullet")
    return (
      <p className="guide__bullet">
        <b>· {b.label}</b> {b.text}
      </p>
    );
  if (b.type === "box")
    return (
      <div className="guide__box">
        {b.lines.map(([text, strong], i) =>
          strong ? <b key={i}>{text}</b> : <span key={i}>{text}</span>
        )}
      </div>
    );
  return null; // pagebreak 는 PDF 에만 쓰입니다
}

function Guide({ onClose, dark }) {
  return (
    <section className={"guide" + (dark ? "" : " on-paper")}>
      <div className="guide__head">
        <p className="guide__title">{GUIDE.title}</p>
        <button className="sheet__close" onClick={onClose}>
          닫기 ✕
        </button>
      </div>
      <p className="guide__sub-title">{GUIDE.subtitle}</p>
      {GUIDE.blocks.map((b, i) => (
        <GuideBlock key={i} b={b} />
      ))}
      <div className="guide__closebar">
        <button onClick={onClose}>닫기</button>
      </div>
    </section>
  );
}

// 기기에 내장된 음성 합성으로 읽어줍니다. API 호출이 없어 비용이 들지 않고
// 오프라인에서도 됩니다. 사용자 탭에서 불러야 iOS 에서 소리가 납니다.
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
function speak(text) {
  if (!canSpeak || !text) return;
  window.speechSynthesis.cancel(); // 연타하면 겹치지 않고 새로 읽습니다
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9; // 학습용이라 살짝 천천히
  window.speechSynthesis.speak(u);
}

// 예문 한 줄입니다. 그 단어가 실제로 쓰인 자리를 밑줄과 굵기로 드러내고, 끝에
// 작은 스피커를 답니다. 사전 시트와 단어장이 같은 모양이어야 해서 한곳에 둡니다.
function ExampleLine({ example, word, className = "k-ex" }) {
  if (!example) return null;
  const cut = markUsage(example, word);
  return (
    <p className={className}>
      {cut ? (
        <>
          {cut[0]}
          <b className="ex__hit">{cut[1]}</b>
          {cut[2]}
        </>
      ) : (
        example
      )}
      {canSpeak && (
        <button
          className="speak speak--sm"
          onClick={() => speak(example)}
          aria-label="예문 듣기"
        >
          🔊
        </button>
      )}
    </p>
  );
}

// 모델에게 마크다운을 쓰지 말라고 해도 가끔 **강조** 를 섞어 보내고, 그러면
// 별표가 글자로 그대로 보입니다. HTML 로 해석하지 않고 React 요소로만 바꾸므로
// 주입 위험은 없습니다.
const renderText = (text) =>
  String(text ?? "")
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

/* ---------------- app ---------------- */

export default function App() {
  // 저장된 값이 있으면 그것이 이깁니다. 그래서 칸을 비워 둔 사람은 계속 비어 있고,
  // 처음 설치한 사람만 기본 서버 주소를 받습니다.
  const [keys, setKeys] = useState(() => ({
    gemini: "",
    proxy: DEFAULT_SERVER,
    token: "",
    ...load("nt-keys", {}),
  }));
  const [vocab, setVocab] = useState(() => load("nt-vocab", []));

  const [field, setField] = useState(FIELDS[0]);
  const [source, setSource] = useState(FIELDS[0].sources[0]);
  const [level, setLevel] = useState(LEVELS[1]);
  const [length, setLength] = useState(LENGTHS[1]);

  // 매체마다 통상 분량이 달라서(콜로살 300단어, 프로퍼블리카 4,000단어),
  // 매체를 고르면 그에 맞는 길이를 자동으로 맞춥니다. 이후 직접 바꾸면
  // 그 선택이 쓰입니다.
  const pickSource = (src) => {
    setSource(src);
    const auto = LENGTHS.find((l) => l.id === src.length);
    if (auto) setLength(auto);
  };
  const [focus, setFocus] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const [clean, setClean] = useState(true);
  const [stories, setStories] = useState([]);
  const [finding, setFinding] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const [article, setArticle] = useState(() => {
    const a = load("nt-article", null);
    return isArticle(a) ? a : null;
  });
  const [tuning, setTuning] = useState(false);
  // 수신이 최대 1분까지 걸리므로, 멈춘 게 아니라는 것을 단계 문구로 보여줍니다.
  const [progress, setProgress] = useState("");

  // 수신 대기 중 화면이 저절로 잠기면 iOS 가 페이지를 동결해 작업이 끊깁니다.
  // 수신 동안만 화면 잠금을 붙잡습니다. 다른 앱으로 직접 나가는 것까지 막지는
  // 못하고(그건 웹앱의 한계), 지원 안 되는 브라우저에서는 조용히 건너뜁니다.
  const wakeRef = useRef(null);
  const holdAwake = async () => {
    try {
      wakeRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      /* 미지원·거부 시 그냥 진행 */
    }
  };
  const releaseAwake = () => {
    try {
      wakeRef.current?.release();
    } catch {
      /* noop */
    }
    wakeRef.current = null;
  };
  const [error, setError] = useState("");

  const [tab, setTab] = useState(() => {
    const k = load("nt-keys", {});
    return k.proxy || k.gemini ? "read" : "set";
  });
  const [mode, setMode] = useState("word");
  const [dark, setDark] = useState(() => load("nt-dark", false));
  const [sheet, setSheet] = useState(null);
  // 표현 모드에서 처음 누른 단어. 두 번째 단어를 누르면 그 구간이 표현이 됩니다.
  const [anchor, setAnchor] = useState(null);
  // 기사에서 찾아낸 관용구·구동사. 밑줄로 표시하고 한 번 탭으로 열립니다.
  const [phrases, setPhrases] = useState([]);
  const [findingPhrases, setFindingPhrases] = useState(false);

  // 같은 단어를 다시 누르는 일이 잦습니다. 그때마다 API 를 부르면 하루 한도가
  // 금방 닳으므로, 이번 세션 동안 본 결과는 기억해 둡니다.
  const lookupCache = useRef(new Map());

  // 최근에 읽은 기사 주소입니다. 같은 조건으로 다시 눌렀을 때 같은 글이
  // 나오지 않도록, 검색 단계에서 이 목록을 빼고 고릅니다.
  const [seen, setSeen] = useState(() => load("nt-seen", []));

  const [saveFailed, setSaveFailed] = useState(false);
  const [logMsg, setLogMsg] = useState("");
  const [usageMsg, setUsageMsg] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [ioMsg, setIoMsg] = useState("");
  const fileRef = useRef(null);

  const [chat, setChat] = useState([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEnd = useRef(null);

  // useEffect 의 반환값은 정리 함수로 쓰입니다. save 가 boolean 을 돌려주므로
  // 축약 본문으로 쓰면 React 가 true() 를 호출하려다 앱 전체가 죽습니다.
  useEffect(() => {
    save("nt-keys", keys);
  }, [keys]);
  useEffect(() => {
    setSaveFailed(!save("nt-vocab", vocab));
  }, [vocab]);
  useEffect(() => {
    save("nt-dark", dark);
  }, [dark]);
  useEffect(() => {
    save("nt-seen", seen);
  }, [seen]);
  // 붙여넣은 글은 기기에 남기지 않습니다. 앱을 닫으면 사라집니다.
  useEffect(() => {
    if (article && !article.pasted) save("nt-article", article);
  }, [article]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatBusy]);

  const ready = keys.proxy || !!keys.gemini;

  /* ---- actions ---- */

  // story 를 주면 새로 찾지 않고 그 기사를 다룹니다. 관련 기사 목록에서 씁니다.
  const tuneIn = useCallback(
    async (story) => {
    setTuning(true);
    holdAwake();
    setProgress("기사 찾는 중…");
    setError("");
    setSheet(null);
    setChat([]);
    try {
      const a = await fetchArticle({
        geminiKey: keys.gemini,
        proxy: keys.proxy,
        proxyToken: keys.token,
        source,
        topic: field.topic,
        focus: focus.trim(),
        level: level.id,
        length: length.id,
        story,
        exclude: seen,
        onProgress: setProgress,
      });
      setArticle(a);
      setPhrases([]);
      // 60개까지만 남깁니다. 더 쌓이면 고를 후보가 없어집니다.
      if (a.url) setSeen((prev) => [a.url, ...prev.filter((u) => u !== a.url)].slice(0, 60));
      // 원하는 내용을 찾았으니 키워드는 비웁니다. 남겨 두면 다음에 아무 생각 없이
      // 눌렀을 때 지난번 조건으로 또 찾게 되고, 매번 지우고 다시 써야 합니다.
      // 실패했을 때는 그대로 둡니다. 조건을 고쳐 다시 눌러야 하기 때문입니다.
      // 관련 기사에서 고른 경우(story)는 키워드로 찾은 것이 아니므로 건드리지
      // 않습니다. 목록을 훑는 중에 검색어가 사라지면 오히려 당황스럽습니다.
      if (!story) setFocus("");
      setPanelOpen(false);
      setTab("read");
    } catch (e) {
      setError(e.message);
      logIssue("수신오류", `${field.id}/${source.id}`, e.message);
    } finally {
      releaseAwake();
      setTuning(false);
      setProgress("");
    }
    },
    [keys, source, field, level, length, focus, seen]
  );

  // 응답이 돌아왔을 때 사용자가 이미 다른 것을 열었거나 닫았을 수 있습니다.
  // 요청마다 번호를 매겨, 마지막 요청의 응답만 화면에 씁니다. 닫기도 번호를
  // 올려서 닫은 시트가 뒤늦게 되살아나지 않게 합니다.
  const sheetReq = useRef(0);

  function closeSheet() {
    sheetReq.current += 1;
    setSheet(null);
  }

  async function open(kind, term, key, fetcher) {
    const id = ++sheetReq.current;
    const cached = lookupCache.current.get(key);
    if (cached) {
      setSheet({ kind, term, data: cached });
      return;
    }
    setSheet({ kind, term, loading: true });
    try {
      const data = await fetcher();
      lookupCache.current.set(key, data);
      if (sheetReq.current === id) setSheet({ kind, term, data });
    } catch (e) {
      if (sheetReq.current === id) setSheet({ kind, term, error: e.message });
    }
  }

  const openWord = (word, sentence) =>
    open("word", word, `w:${word}|${sentence}`, () =>
      lookupWord({
        geminiKey: keys.gemini,
        proxy: keys.proxy,
        proxyToken: keys.token,
        word,
        sentence,
      })
    );

  // 표현 모드로 바꿀 때 기사에서 관용구를 한 번 찾아 둡니다.
  async function enterPhraseMode() {
    setMode("phrase");
    setAnchor(null);
    if (phrases.length || findingPhrases || !article) return;
    setFindingPhrases(true);
    try {
      setPhrases(
        await findPhrases({
          geminiKey: keys.gemini,
          proxy: keys.proxy,
          proxyToken: keys.token,
          paragraphs: article.paragraphs,
        })
      );
    } catch {
      // 못 찾아도 직접 구간을 골라 쓸 수 있으므로 조용히 넘어갑니다.
      setPhrases([]);
    } finally {
      setFindingPhrases(false);
    }
  }

  // 단어 모드는 한 번 탭이면 끝이고, 표현 모드는 시작과 끝 두 번을 받습니다.
  // 다만 찾아 둔 표현 위를 누르면 그 표현이 바로 열립니다.
  function tapWord({ pi, si, ti, toks, w, s, marked }) {
    if (mode !== "phrase") {
      openWord(w, s);
      return;
    }
    if (marked && !anchor) {
      openPhrase(marked, s);
      return;
    }
    // 다른 문장을 누르면 이전 선택은 버리고 거기서 다시 시작합니다.
    if (!anchor || anchor.pi !== pi || anchor.si !== si) {
      setAnchor({ pi, si, ti });
      return;
    }
    const [a, b] = ti < anchor.ti ? [ti, anchor.ti] : [anchor.ti, ti];
    const phrase = cleanWord(toks.slice(a, b + 1).join("").trim());
    setAnchor(null);
    if (phrase) openPhrase(phrase, s);
  }

  const openPhrase = (phrase, sentence) =>
    open("phrase", phrase, `p:${phrase}|${sentence}`, () =>
      lookupPhrase({
        geminiKey: keys.gemini,
        proxy: keys.proxy,
        proxyToken: keys.token,
        phrase,
        sentence,
      })
    );

  const openSentence = (sentence) =>
    open("sentence", sentence, `s:${sentence}`, () =>
      lookupSentence({
        geminiKey: keys.gemini,
        proxy: keys.proxy,
        proxyToken: keys.token,
        sentence,
      })
    );

  async function send() {
    const q = draft.trim();
    if (!q || chatBusy) return;
    const next = [...chat, { role: "user", content: q }];
    setChat(next);
    setDraft("");
    setChatBusy(true);
    try {
      const reply = await discuss({
        geminiKey: keys.gemini,
        proxy: keys.proxy,
        proxyToken: keys.token,
        article,
        // 화면에 남은 오류 안내는 모델이 본 적 없는 말이라 대화 기록에서 뺍니다.
        messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
      });
      // 응답을 기다리는 사이 다른 기사를 받아 대화가 비워졌을 수 있습니다.
      // 그때 이 응답을 붙이면 이전 기사의 대화가 새 기사 밑에 되살아납니다.
      // 대화가 보낸 시점 그대로일 때만 붙입니다.
      setChat((prev) => (prev === next ? [...next, { role: "assistant", content: reply }] : prev));
    } catch (e) {
      setChat((prev) =>
        prev === next ? [...next, { role: "assistant", content: e.message, error: true }] : prev
      );
    } finally {
      setChatBusy(false);
    }
  }

  // 요청이 나간 뒤에는 설정을 바꿔도 그 요청에 반영되지 않습니다. 잠가 두지
  // 않으면 고른 것과 다른 기사가 온 것처럼 보입니다.
  const busy = tuning || finding;
  const articleUrl = safeUrl(article?.url);
  // 단어장에는 본문에 나온 형태가 아니라 사전형으로 넣습니다. 복습할 때
  // "took many by surprise" 보다 "take (someone) by surprise" 가 쓸모 있습니다.
  const phraseHead = sheet?.data?.base || sheet?.data?.phrase || sheet?.term || "";
  // 원문 모드에서도 "오늘 뭘 읽지" 는 앱이 풀어줘야 합니다. 본문은 가져오지
  // 않고 제목과 링크만 찾아옵니다.
  async function findList() {
    setFinding(true);
    setError("");
    setPasteMsg("");
    try {
      setStories(
        await findStories({
          geminiKey: keys.gemini,
          proxy: keys.proxy,
          proxyToken: keys.token,
          source,
          topic: field.topic,
          focus: focus.trim(),
        })
      );
    } catch (e) {
      setStories([]);
      setPasteMsg(e.message);
      logIssue("목록오류", `${field.id}/${source.id}`, e.message);
    } finally {
      setFinding(false);
    }
  }

  // 가져오기와 읽기를 한 번에 합니다. 단축어로 본문을 복사해 온 경우
  // 앱에서는 이 버튼 한 번이면 끝납니다.
  async function pasteFromClipboard() {
    setPasteMsg("");
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setPasteMsg("클립보드가 비어 있습니다.");
        return;
      }
      setPasteText(t);
      readPasted(t);
    } catch {
      setPasteMsg("클립보드를 읽지 못했습니다. 아래 칸에 직접 붙여넣어 주세요.");
    }
  }

  // 붙여넣은 글을 기사와 같은 모양으로 감싸면 단어·문장·토론 기능이 그대로 돕니다.
  // onClick={readPasted} 로 연결하면 첫 인자에 클릭 이벤트가 들어옵니다.
  // 문자열이 아니면 무시하고 입력칸 내용을 씁니다.
  function readPasted(arg) {
    const raw = typeof arg === "string" ? arg : pasteText;

    let title = "붙여넣은 글";
    let paragraphs = [];
    let note = "";

    // 페이지를 통째로 복사한 경우 메뉴와 푸터가 섞여 있습니다. 먼저 추려봅니다.
    const picked = clean ? extractBody(raw) : null;
    if (picked) {
      if (picked.title) title = picked.title;
      paragraphs = picked.paragraphs;
      if (picked.removed > 0) note = `본문이 아닌 ${picked.removed}줄을 걸러냈습니다.`;
    } else {
      // 추리기를 껐거나 본문을 못 찾으면 빈 줄 기준으로만 나눕니다.
      const blocks = raw
        .split(/\n\s*\n/)
        .map((b) => b.trim().replace(/\s*\n\s*/g, " "))
        .filter(Boolean);
      paragraphs = blocks;
      if (blocks.length > 1 && blocks[0].length <= 120) {
        title = blocks[0];
        paragraphs = blocks.slice(1);
      }
      if (clean) note = "본문을 가려내지 못해 붙여넣은 그대로 보여줍니다.";
    }

    if (!paragraphs.length) {
      setPasteMsg("읽을 내용이 없습니다.");
      return;
    }

    setSheet(null);
    setChat([]);
    setError("");
    setArticle({
      pasted: true,
      title,
      titleKo: "",
      outlet: "붙여넣은 글",
      url: "",
      published: "",
      summaryKo: "",
      paragraphs,
      keywords: [],
      related: [],
      sources: [],
    });
    setPhrases([]);
    setPasteMsg(note);
    setPanelOpen(false);
    setTab("read");
  }

  function exportVocab() {
    const body = JSON.stringify(
      { app: "news-tuner", version: 1, exportedAt: new Date().toISOString(), vocab },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `news-tuner-vocab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIoMsg(`${vocab.length}개를 파일로 내보냈습니다.`);
  }

  async function importVocab(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 동작하게 비웁니다
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed?.vocab;
      if (!Array.isArray(list)) throw new Error("shape");

      // 덮어쓰지 않고 합칩니다. 파일을 잘못 골라도 기존 단어장이 남습니다.
      const have = new Set(vocab.map((v) => v.word));
      const added = [];
      for (const raw of list) {
        const entry = cleanEntry(raw);
        if (entry && !have.has(entry.word)) {
          have.add(entry.word);
          added.push(entry);
        }
      }
      setVocab([...added, ...vocab]);
      setIoMsg(
        added.length
          ? `${added.length}개를 더했습니다. ${list.length - added.length}개는 이미 있거나 형식이 맞지 않아 건너뛰었습니다.`
          : "새로 더할 단어가 없습니다."
      );
    } catch {
      setIoMsg("단어장 파일이 아니거나 내용이 깨져 있습니다.");
    }
  }

  const saved = (w) => vocab.some((v) => v.word === w);
  const addWord = (e) => !saved(e.word) && setVocab([{ ...e, at: Date.now() }, ...vocab]);

  /* ---- render ---- */

  return (
    <div className="app">
      <Dial source={source} tuning={tuning} />

      {tab === "read" && (
        <div className="console">
          <div className="console__head">
            <h1 className="console__title">NEWS TUNER</h1>
            <button className="link" onClick={() => setPanelOpen((v) => !v)}>
              {panelOpen ? "접기" : "다른 글 보기"}
            </button>
          </div>

          {panelOpen && (
            <>
              <details className="howto howto--guide">
                <summary>사용방법</summary>
                <ul>
                  <li>
                    <b>분야</b> — 어떤 종류의 글을 읽을지 고릅니다. 고르면 그 분야를 잘 쓰는
                    매체 두 곳이 아래 줄에 나옵니다.
                  </li>
                  <li>
                    <b>매체</b> — 어느 언론사에서 기사를 찾을지 고릅니다. 앞의 숫자는 라디오
                    주파수처럼 붙여 둔 것일 뿐 의미는 없습니다.
                  </li>
                  <li>
                    <b>난이도</b> — <b>쉽게</b>와 <b>원문 수준</b>은 새로 쓴 글의 영어
                    난이도입니다. <b>원문</b>은 새로 쓰지 않고, 기사를 직접 붙여넣어 그대로
                    읽는 모드입니다.
                  </li>
                  <li>
                    <b>길이</b> — 새로 쓸 글의 분량입니다. 매체를 고르면 그 매체의 통상
                    분량에 맞게 자동으로 맞춰지고, 직접 바꾸면 그 선택이 우선합니다. 원문
                    모드에서는 쓰지 않습니다.
                  </li>
                  <li>
                    <b>찾고 싶은 내용</b> — 비워도 됩니다. 적으면 고른 분야·매체 안에서 그쪽에
                    가까운 기사를 고릅니다.
                  </li>
                </ul>
              </details>

              <div className="row">
                <span className="row__label">분야</span>
                <div className="row__chips">
                  {FIELDS.map((f) => (
                    <Chip
                      key={f.id}
                      on={f.id === field.id}
                      disabled={busy}
                      onClick={() => {
                        setField(f);
                        pickSource(f.sources[0]);
                      }}
                    >
                      {f.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="row">
                <span className="row__label">매체</span>
                <div className="row__chips">
                  {field.sources.map((s) => (
                    <Chip
                      key={s.id}
                      on={s.id === source.id}
                      disabled={busy}
                      onClick={() => pickSource(s)}
                    >
                      {s.short}
                    </Chip>
                  ))}
                  <span className="hint">{source.note}</span>
                </div>
              </div>
              <div className="row">
                <span className="row__label">난이도</span>
                <div className="row__chips">
                  {LEVELS.map((l) => (
                    <Chip
                      key={l.id}
                      on={l.id === level.id}
                      disabled={busy}
                      onClick={() => setLevel(l)}
                    >
                      {l.label}
                    </Chip>
                  ))}
                  <span className="hint">{level.hint}</span>
                </div>
              </div>
              <div className="row" hidden={level.id === "paste"}>
                <span className="row__label">길이</span>
                <div className="row__chips">
                  {LENGTHS.map((l) => (
                    <Chip
                      key={l.id}
                      on={l.id === length.id}
                      disabled={busy}
                      onClick={() => setLength(l)}
                    >
                      {l.label}
                    </Chip>
                  ))}
                  <span className="hint">{length.hint}</span>
                </div>
              </div>

              {level.id === "paste" ? (
                <div className="paste">
                  <p className="hint">
                    기사를 복사한 뒤 아래 버튼을 누르면 바로 읽습니다. 붙여넣은 글은 기기에
                    저장되지 않습니다.
                  </p>

                  <details className="howto">
                    <summary>본문만 한 번에 복사하는 법</summary>

                    <p className="howto__h">아이폰 — 단축어로 한 번에 (권장)</p>
                    <p>
                      한 번만 만들어 두면 그다음부터는 탭 두 번이고, 본문을 선택할 필요가 아예
                      없습니다. 단축어 앱에서 새 단축어를 만들고 액션 세 개를 순서대로 넣으세요.
                    </p>
                    <ol>
                      <li>웹페이지에서 기사 가져오기</li>
                      <li>기사 세부사항 가져오기 — 항목을 <b>본문</b>으로</li>
                      <li>클립보드에 복사</li>
                    </ol>
                    <p>
                      단축어 정보에서 <b>공유 시트에 표시</b>를 켭니다. 이제 기사에서 공유 버튼 →
                      이 단축어를 고르면 본문만 클립보드에 담기고, 여기서 아래 버튼만 누르면
                      됩니다. 사파리와 크롬 모두 같은 공유 시트를 쓰므로 그대로 동작합니다.
                    </p>
                    <p>
                      단축어를 안 만들 거라면, 사파리 주소창 왼쪽 <b>aA</b> → <b>읽기 도구 표시</b>
                      를 켜고 길게 눌러 전체 선택하세요. 본문만 남아서 훨씬 쉽습니다.
                    </p>

                    <p className="howto__h">갤럭시 · 안드로이드</p>
                    <p>
                      안드로이드에는 단축어에 해당하는 기본 기능이 없어서, 읽기 모드를 켜고 직접
                      선택하는 방식이 가장 확실합니다. 광고와 메뉴가 빠지므로 본문만 깔끔하게
                      잡힙니다.
                    </p>
                    <ul>
                      <li>
                        <b>크롬</b> — 오른쪽 위 <b>⋮</b> → <b>간소화된 보기</b>(또는 읽기 모드) →
                        본문을 길게 눌러 <b>전체 선택</b> → 복사
                      </li>
                      <li>
                        <b>삼성 인터넷</b> — 주소창의 <b>리더 모드</b> 아이콘을 켜고 같은 방식으로
                        선택해 복사
                      </li>
                    </ul>
                    <p>메뉴 이름은 기기와 브라우저 버전에 따라 조금 다를 수 있습니다.</p>

                    <p className="howto__h">컴퓨터</p>
                    <p>기사 본문을 클릭하고 Ctrl+A(맥은 ⌘+A) 후 복사하면 됩니다.</p>
                  </details>
                  <button className="btn" onClick={findList} disabled={finding || !ready}>
                    {finding ? "찾는 중…" : ready ? "읽을 기사 찾기" : "설정에서 키를 먼저 넣으세요"}
                  </button>

                  {stories.length > 0 && (
                    <ul className="stories">
                      {stories.map((s, i) => (
                        <li key={i}>
                          <a href={s.url} target="_blank" rel="noreferrer">
                            <span className="stories__en">{s.title}</span>
                            {s.summaryKo && <span className="stories__sum">{s.summaryKo}</span>}
                          </a>
                          <span className="stories__date">{s.published}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <textarea
                    className="paste__area"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="여기에 붙여넣거나, 아래 버튼으로 클립보드에서 가져오세요"
                    rows={6}
                  />
                  {pasteMsg && <p className="io-msg">{pasteMsg}</p>}
                  <div className="paste__row">
                    <button className="paste__btn" onClick={pasteFromClipboard}>
                      클립보드에서 가져오기
                    </button>
                    {pasteText && (
                      <button className="paste__btn" onClick={() => setPasteText("")}>
                        지우기
                      </button>
                    )}
                    <Chip on={clean} onClick={() => setClean((v) => !v)}>
                      본문만 추리기
                    </Chip>
                  </div>
                  <p className="hint">
                    페이지를 통째로 복사하면 메뉴와 푸터가 섞입니다. 켜 두면 문장처럼 생긴 줄만
                    남깁니다. 잘못 걸러내면 끄고 다시 읽으세요.
                  </p>
                  <button
                    className="btn"
                    onClick={() => readPasted()}
                    disabled={!pasteText.trim()}
                  >
                    이 글 읽기
                  </button>
                </div>
              ) : (
                <>
              {/* 한글 조합 중 Enter 는 글자를 확정하는 키라, 조합 중에는 검색하지 않습니다. */}
              <input
                className="focus"
                value={focus}
                disabled={busy}
                maxLength={200}
                onChange={(e) => setFocus(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  if (!tuning && ready) tuneIn();
                }}
                placeholder="찾고 싶은 내용 (선택) — 예: 반도체 수출 규제, AI 저작권 소송"
              />
              <button className="btn" onClick={() => tuneIn()} disabled={tuning || !ready}>
                {tuning ? "수신 중…" : ready ? "기사 찾기" : "설정에서 키를 먼저 넣으세요"}
              </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* 기사 배경 설정이 대화·단어장·설정 화면까지 함께 따라갑니다. 예전에는
          기사만 밝아지고 나머지는 늘 어두워서 탭을 옮길 때마다 눈이 놀랐습니다. */}
      <main className={"main" + (dark ? "" : " on-paper")}>
        {/* ---------- read ---------- */}
        {tab === "read" && (
          <>
            {tuning && (
              <div style={{ padding: "48px 20px" }}>
                <Spinner label={progress || "검색하고 기사를 다시 쓰는 중…"} />
              </div>
            )}
            {error && !tuning && <p className="error">{error}</p>}
            {!article && !tuning && !error && (
              <div className="empty">
                <p className="empty__code">NO SIGNAL</p>
                <p className="empty__text">
                  분야와 매체를 고르고 기사 찾기를 누르면
                  <br />
                  오늘 기사가 도착합니다.
                </p>
              </div>
            )}

            {article && !tuning && (
              <article className={"article" + (dark ? " article--dark" : "")}>
                <div className="article__meta">
                  <span className="article__outlet">{article.outlet}</span>
                  {article.published && (
                    <>
                      <span>·</span>
                      <span>{article.published}</span>
                    </>
                  )}
                </div>
                <h2 className="article__title">{article.title}</h2>
                {article.titleKo && <p className="article__titleko">{article.titleKo}</p>}

                {!article.pasted &&
                  (articleUrl ? (
                    <a
                      className="article__origin"
                      href={articleUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      원문 기사 열기 →
                    </a>
                  ) : (
                    // 링크는 그라운딩 출처에서만 옵니다. 비어 있다는 것은 검색 결과에
                    // 근거하지 않았을 수 있다는 뜻이라, 단순한 빈칸이 아닙니다.
                    <span className="article__origin article__origin--none">
                      출처를 확인하지 못했습니다 · 실제 기사가 아닐 수 있으니 내용을 믿지 마세요
                    </span>
                  ))}

                <div className="article__modes">
                  <span className="hint">탭하면</span>
                  <Chip
                    on={mode === "word"}
                    onClick={() => {
                      setMode("word");
                      setAnchor(null);
                    }}
                  >
                    단어 뜻
                  </Chip>
                  <Chip on={mode === "phrase"} onClick={enterPhraseMode}>
                    표현·관용구
                  </Chip>
                  <Chip
                    on={mode === "sentence"}
                    onClick={() => {
                      setMode("sentence");
                      setAnchor(null);
                    }}
                  >
                    문장 해석
                  </Chip>
                  <button
                    className="theme"
                    onClick={() => setDark((v) => !v)}
                    aria-label={dark ? "밝은 배경으로" : "어두운 배경으로"}
                  >
                    {dark ? "☀" : "☾"}
                  </button>
                </div>
                {mode === "phrase" && (
                  <p className="hint">
                    {findingPhrases
                      ? "기사에서 표현을 찾는 중…"
                      : anchor
                        ? "끝 단어를 누르세요."
                        : phrases.length
                          ? `밑줄 친 표현 ${phrases.length}개를 찾았습니다. 눌러서 보세요. 밑줄이 없는 곳은 첫 단어와 끝 단어를 차례로 누르면 됩니다.`
                          : "표현의 첫 단어와 끝 단어를 차례로 누르세요."}
                  </p>
                )}

                <div className="body">
                  {article.paragraphs.map((p, pi) => (
                    <p key={pi}>
                      {splitSentences(p).map((sent, si) => {
                        const s = sent.trim();
                        if (mode === "sentence")
                          return (
                            <span key={si} className="s" onClick={() => openSentence(s)}>
                              {sent}
                            </span>
                          );
                        const toks = sent.split(/(\s+)/);
                        const marks =
                          mode === "phrase" ? markPhrases(toks, phrases) : NO_MARKS;
                        return (
                          <span key={si}>
                            {toks.map((tok, ti) => {
                              const w = cleanWord(tok);
                              const marked = marks.get(ti);
                              // 공백도 표현 안쪽이면 함께 칠해야 한 덩어리로 보입니다.
                              // 빼면 단어마다 표시가 끊겨 낱말을 고르는 것처럼 보입니다.
                              if (!w)
                                return marked ? (
                                  <span
                                    key={ti}
                                    className="w w--idiom"
                                    onClick={() => openPhrase(marked, s)}
                                  >
                                    {tok}
                                  </span>
                                ) : (
                                  <span key={ti}>{tok}</span>
                                );
                              const isAnchor =
                                mode === "phrase" &&
                                anchor &&
                                anchor.pi === pi &&
                                anchor.si === si &&
                                anchor.ti === ti;
                              return (
                                <span
                                  key={ti}
                                  className={
                                    "w" +
                                    (marked ? " w--idiom" : "") +
                                    (isAnchor ? " w--anchor" : "")
                                  }
                                  onClick={() => tapWord({ pi, si, ti, toks, w, s, marked })}
                                >
                                  {tok}
                                </span>
                              );
                            })}
                          </span>
                        );
                      })}
                    </p>
                  ))}
                </div>

                {article.summaryKo && <p className="summary">{article.summaryKo}</p>}

                {/* 붙여넣은 원문에는 붙이지 않습니다. 그쪽은 기자가 쓴 글 그대로입니다. */}
                {!article.pasted && (
                  <p className="disclaimer">
                    * AI가 재작성한 글로 원문과 다를 수 있습니다.
                  </p>
                )}

                {article.keywords?.length > 0 && (
                  <div className="keys">
                    <p className="keys__label">KEY WORDS</p>
                    <ul>
                      {article.keywords.map((k, i) => (
                        <li key={i}>
                          <button
                            onClick={() =>
                              openWord(
                                k.word,
                                sentenceWith(k.word, article.paragraphs) || article.paragraphs[0]
                              )
                            }
                          >
                            {k.word}
                          </button>
                          <span>{k.ko}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {article.related?.length > 0 && (
                  <div className="related">
                    <p className="keys__label">관련 기사</p>
                    <ul>
                      {article.related.map((r, i) => (
                        <li key={i}>
                          <button onClick={() => tuneIn(r)} disabled={tuning}>
                            <span className="related__en">{r.title}</span>
                            {r.titleKo && <span className="related__ko">{r.titleKo}</span>}
                          </button>
                          <a href={r.url} target="_blank" rel="noreferrer" className="related__src">
                            원문
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="sources">
                  {article.sources?.map((s, i) => {
                    const href = safeUrl(s?.uri);
                    if (!href) return null;
                    return (
                      <a key={i} href={href} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    );
                  })}
                </div>
              </article>
            )}
          </>
        )}

        {/* ---------- talk ---------- */}
        {tab === "talk" && (
          <div className="chat">
            {!article && (
              <div className="empty">
                <p className="empty__text">기사를 먼저 받아오면 그 내용에 대해 물어볼 수 있습니다.</p>
              </div>
            )}
            {article && chat.length === 0 && (
              <>
                <p className="empty__code">이렇게 물어보세요</p>
                {[
                  "이 기사 핵심을 한국어로 3줄 정리해줘",
                  "Why does this story matter?",
                  "이 기사 표현으로 짧은 글 써볼게, 고쳐줘",
                ].map((s) => (
                  <button key={s} className="seed" onClick={() => setDraft(s)}>
                    {s}
                  </button>
                ))}
              </>
            )}
            {chat.map((m, i) => (
              <div key={i} className={"bubble bubble--" + (m.role === "user" ? "me" : "ai")}>
                {renderText(m.content)}
              </div>
            ))}
            {chatBusy && <Spinner label="쓰는 중…" />}
            <div ref={chatEnd} />
          </div>
        )}

        {/* ---------- vocab ---------- */}
        {tab === "vocab" && (
          <div className="vocab__bar">
            <button onClick={exportVocab} disabled={vocab.length === 0}>
              내보내기
            </button>
            <button onClick={() => fileRef.current?.click()}>불러오기</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={importVocab}
            />
            <span className="hint">{vocab.length}개</span>
          </div>
        )}
        {tab === "vocab" && ioMsg && <p className="io-msg">{ioMsg}</p>}
        {tab === "vocab" && saveFailed && (
          <p className="error">
            저장 공간이 가득 차 단어장이 기기에 저장되지 않았습니다. 내보내기로 백업하세요.
          </p>
        )}

        {tab === "vocab" &&
          (vocab.length === 0 ? (
            <div className="empty">
              <p className="empty__text">기사에서 단어를 눌러 저장하면 여기에 쌓입니다.</p>
            </div>
          ) : (
            <ul className="vocab">
              {vocab.map((v) => (
                <li key={v.word}>
                  <div className="vocab__top">
                    <span className="vocab__word">
                      {v.word}
                      {canSpeak && (
                        <button
                          className="speak"
                          onClick={() => speak(v.word)}
                          aria-label={`${v.word} 발음 듣기`}
                        >
                          🔊
                        </button>
                      )}
                      {v.kind && <span className="vocab__kind">{v.kind}</span>}
                    </span>
                    <button
                      className="vocab__del"
                      onClick={() => setVocab(vocab.filter((x) => x.word !== v.word))}
                    >
                      삭제
                    </button>
                  </div>
                  <p className="vocab__ko">{v.ko}</p>
                  <ExampleLine example={v.example} word={v.word} className="vocab__ex" />
                </li>
              ))}
            </ul>
          ))}

        {/* ---------- settings ---------- */}
        {tab === "set" && (
          <div className="settings">
            {/* public/ 에 함께 배포되므로 앱과 같은 주소에서 열립니다. GitHub 링크로
                내보내면 느리고, 서비스 워커가 캐시하지 못해 오프라인에서 안 열립니다.
                base 경로는 배포 위치마다 달라지므로 BASE_URL 을 붙입니다. */}
            <div className="field">
              <label>사용 설명서</label>
              <div className="row__chips">
                <button className="paste__btn" onClick={() => setGuideOpen(true)}>
                  설명서 열기
                </button>
                {/* 카톡 등으로 남에게 보낼 때 쓰는 파일입니다. 앱 안에서 읽는 것은
                    위 버튼이고, 이쪽은 내려받기 전용이라 헷갈리지 않게 이름을 나눕니다. */}
                <a
                  className="paste__btn"
                  href={`${import.meta.env.BASE_URL}NewsTuner-Guide-KR.pdf`}
                  download="NewsTuner-Guide-KR.pdf"
                >
                  PDF 내려받기
                </a>
              </div>
            </div>

            <div className="field">
              <label htmlFor="gk">GEMINI API KEY</label>
              <input
                id="gk"
                type="password"
                autoComplete="off"
                value={keys.gemini}
                onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
                placeholder="AIza…"
              />
              <small>
                aistudio.google.com 에서 무료로 발급합니다. 이 키 하나로 뉴스 수집, 단어 풀이,
                대화가 모두 돌아갑니다.
              </small>
            </div>

            <div className="field">
              <label htmlFor="px">서버 주소 · 권장</label>
              <input
                id="px"
                type="url"
                autoComplete="off"
                value={keys.proxy}
                onChange={(e) => setKeys({ ...keys, proxy: e.target.value })}
                placeholder="https://…vercel.app/api"
              />
              <small>
                넣으면 키를 기기에 두지 않고 서버가 대신 호출합니다. 비워 두면 브라우저에서 직접
                호출하는데, 기사 품질과 비용이 나빠질 수 있습니다.
              </small>
            </div>

            {keys.proxy && (
              <div className="field">
                <label htmlFor="pt">서버 토큰 · 선택</label>
                <input
                  id="pt"
                  type="password"
                  autoComplete="off"
                  value={keys.token}
                  onChange={(e) => setKeys({ ...keys, token: e.target.value })}
                  placeholder="서버의 SHARED_TOKEN"
                />
                <small>
                  서버에 SHARED_TOKEN 을 넣었다면 같은 값을 여기에도 넣어야 합니다. 넣지 않으면
                  서버가 모든 요청을 401로 막습니다.
                </small>
              </div>
            )}

            <div className="field">
              <label>오류 기록</label>
              <div className="row__chips">
                <button
                  className="paste__btn"
                  onClick={async () => {
                    try {
                      const raw = localStorage.getItem("nt-errlog") || "[]";
                      await navigator.clipboard.writeText(raw);
                      setLogMsg("복사했습니다. 업데이트 요청에 붙여 주세요.");
                    } catch {
                      setLogMsg("복사하지 못했습니다.");
                    }
                  }}
                >
                  복사
                </button>
                {REPORT_FORM.formId && REPORT_FORM.entryId && (
                  <button
                    className="paste__btn"
                    onClick={async () => {
                      const body = summarizeErrLog(4000);
                      if (!body) {
                        setLogMsg("보낼 기록이 없습니다.");
                        return;
                      }
                      // no-cors 라 응답을 읽을 수 없어 성공을 확인하지는 못하지만,
                      // 구글 폼 formResponse 는 이 방식의 전송을 받아 줍니다.
                      setLogMsg(
                        (await postToForm(REPORT_FORM, body))
                          ? "전송했습니다. 폼 응답함으로 들어갑니다."
                          : "전송하지 못했습니다. 연결을 확인한 뒤 다시 시도하거나, 복사해서 직접 전해 주세요."
                      );
                    }}
                  >
                    개발자에게 전송
                  </button>
                )}
                <button
                  className="paste__btn"
                  onClick={() => {
                    localStorage.removeItem("nt-errlog");
                    setLogMsg("비웠습니다.");
                  }}
                >
                  비우기
                </button>
                <span className="hint">
                  {(() => {
                    try {
                      return JSON.parse(localStorage.getItem("nt-errlog") || "[]").length;
                    } catch {
                      return 0;
                    }
                  })()}
                  건
                </span>
              </div>
              {logMsg && <p className="io-msg" style={{ padding: "6px 0 0" }}>{logMsg}</p>}
              <small>
                {/* 이 화면이 어느 배포를 실행 중인지 기기에서 바로 읽을 수 있어야
                    "옛 빌드가 돌고 있는 것 아닌가"를 추측하지 않게 됩니다. */}
                실행 중인 빌드: {__BUILD_ID__} · 새로고침하면 최신 빌드를 받습니다.
              </small>
            </div>

            <div className="field">
              <label>사용량 기록</label>
              <div className="row__chips">
                <button
                  className="paste__btn"
                  onClick={async () => {
                    const body = summarizeUsageLog(8000);
                    if (!body) {
                      setUsageMsg("보낼 기록이 없습니다.");
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(body);
                      setUsageMsg("복사했습니다.");
                    } catch {
                      setUsageMsg("복사하지 못했습니다.");
                    }
                  }}
                >
                  복사
                </button>
                {USAGE_FORM.formId && USAGE_FORM.entryId && (
                  <button
                    className="paste__btn"
                    onClick={async () => {
                      const body = summarizeUsageLog(4000);
                      if (!body) {
                        setUsageMsg("보낼 기록이 없습니다.");
                        return;
                      }
                      setUsageMsg(
                        (await postToForm(USAGE_FORM, body))
                          ? "전송했습니다. 폼 응답함으로 들어갑니다."
                          : "전송하지 못했습니다. 연결을 확인한 뒤 다시 시도하거나, 복사해서 직접 전해 주세요."
                      );
                    }}
                  >
                    개발자에게 전송
                  </button>
                )}
                <button
                  className="paste__btn"
                  onClick={() => {
                    localStorage.removeItem("nt-usagelog");
                    setUsageMsg("비웠습니다.");
                  }}
                >
                  비우기
                </button>
                <span className="hint">{usageEntries().length}건</span>
              </div>
              {usageMsg && <p className="io-msg" style={{ padding: "6px 0 0" }}>{usageMsg}</p>}
              {/* 무엇이 담기고 왜 보내는지는 설명서 9장에 있습니다. 다만 데이터를
                  내보내는 버튼 옆이라, 저절로 나가지 않는다는 사실 한 줄은 남깁니다. */}
              <small>
                이 기기에만 남습니다. "개발자에게 전송"을 눌러야 보내집니다.
              </small>
            </div>

            <div className="field">
              <label>화면 배경</label>
              <div className="row__chips">
                <Chip on={!dark} onClick={() => setDark(false)}>
                  밝게
                </Chip>
                <Chip on={dark} onClick={() => setDark(true)}>
                  어둡게
                </Chip>
              </div>
              <small>
                기사·대화·단어장·설정 화면의 배경입니다. 읽기 화면 오른쪽 위 ☾ 버튼으로도
                바꿀 수 있습니다. 위쪽 다이얼과 아래쪽 탭은 늘 어두운 색입니다.
              </small>
            </div>

            {ready && <p className="ok">준비됐습니다. 읽기 탭에서 기사를 찾아보세요.</p>}
          </div>
        )}
      </main>

      {guideOpen && <Guide dark={dark} onClose={() => setGuideOpen(false)} />}

      {/* ---------- sheet ---------- */}
      {sheet && (
        <section className="sheet">
          <div className="sheet__head">
            <p className="sheet__term">
              {sheet.kind === "sentence" ? "문장 해석" : sheet.term}
              {sheet.kind !== "sentence" && canSpeak && (
                <button
                  className="speak"
                  onClick={() => speak(sheet.data?.base || sheet.term)}
                  aria-label="발음 듣기"
                >
                  🔊
                </button>
              )}
            </p>
            <button className="sheet__close" onClick={closeSheet}>
              닫기 ✕
            </button>
          </div>

          {sheet.loading && <Spinner label="찾는 중…" />}
          {sheet.error && <p className="error" style={{ padding: "8px 0" }}>{sheet.error}</p>}

          {sheet.kind === "phrase" && sheet.data && (
            <>
              <p className="k-mono">
                {sheet.data.kind}
                {sheet.data.base && sheet.data.base !== sheet.term
                  ? ` · ${sheet.data.base}`
                  : ""}
              </p>
              <p className="k-ko">{sheet.data.ko}</p>
              <p className="k-ctx">직역 — {sheet.data.literal}</p>
              <p className="k-ctx">{sheet.data.inContext}</p>
              <ExampleLine example={sheet.data.example} word={phraseHead} />
              <p className="k-en">{sheet.data.exampleKo}</p>
              {sheet.data.related?.length > 0 && (
                <p className="k-mono">{sheet.data.related.join(" · ")}</p>
              )}
              {/* 본문에 나온 형태가 아니라 사전형으로 저장합니다. 나중에 복습할 때
                  "took many by surprise" 보다 "take (someone) by surprise" 가 쓸모 있습니다. */}
              <button
                className="save"
                disabled={saved(phraseHead)}
                onClick={() =>
                  addWord({
                    word: phraseHead,
                    ko: sheet.data.ko,
                    example: sheet.data.example,
                    kind: sheet.data.kind,
                  })
                }
              >
                {saved(phraseHead) ? "단어장에 있음" : "단어장에 넣기"}
              </button>
            </>
          )}

          {sheet.kind === "word" && sheet.data && (
            <>
              <p className="k-mono">
                {sheet.data.ipa} · {sheet.data.pos}
                {sheet.data.base && sheet.data.base !== sheet.term ? ` · ${sheet.data.base}` : ""}
              </p>
              <p className="k-ko">{sheet.data.ko}</p>
              <p className="k-en">{sheet.data.en}</p>
              <p className="k-ctx">{sheet.data.inContext}</p>
              <ExampleLine
                example={sheet.data.example}
                word={sheet.data.base || sheet.data.word || sheet.term}
              />
              <p className="k-en">{sheet.data.exampleKo}</p>
              {sheet.data.related?.length > 0 && (
                <p className="k-mono">{sheet.data.related.join(" · ")}</p>
              )}
              <button
                className="save"
                disabled={saved(sheet.data.word || sheet.term)}
                onClick={() =>
                  addWord({
                    word: sheet.data.word || sheet.term,
                    ko: sheet.data.ko,
                    example: sheet.data.example,
                  })
                }
              >
                {saved(sheet.data.word || sheet.term) ? "단어장에 있음" : "단어장에 넣기"}
              </button>
            </>
          )}

          {sheet.kind === "sentence" && sheet.data && (
            <>
              {/* 단어·관용구 시트에는 발음 듣기가 있는데 문장에만 없었습니다.
                  문장은 오히려 끊어 읽기와 억양을 들어봐야 하는 자리입니다. */}
              <p className="k-ex k-en">
                {sheet.term}
                {canSpeak && (
                  <button
                    className="speak speak--sm"
                    onClick={() => speak(sheet.term)}
                    aria-label="문장 듣기"
                  >
                    🔊
                  </button>
                )}
              </p>
              <p className="k-ko">{sheet.data.translation}</p>
              <p className="k-en">{sheet.data.literal}</p>
              <p className="k-mono">{sheet.data.structure}</p>
              <ul>{sheet.data.notes?.map((n, i) => <li key={i}>{n}</li>)}</ul>
              {sheet.data.expressions?.map((e, i) => (
                <p key={i} className="k-en">
                  <span className="k-ex" style={{ color: "var(--ink)" }}>
                    {e.phrase}
                  </span>{" "}
                  — {e.meaning}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      {/* ---------- composer ---------- */}
      {tab === "talk" && article && (
        // 입력줄은 main 밖에 고정으로 떠 있어서 테마를 따로 걸어 줘야 합니다.
        // 안 그러면 대화창만 밝고 아래 입력줄만 어두운 모양이 됩니다.
        <div className={"composer" + (dark ? "" : " on-paper")}>
          {/* 한글 입력 중 Enter 는 글자를 확정하는 키라, 조합 중에는 보내지 않습니다. */}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              send();
            }}
            placeholder="기사에 대해 물어보기"
          />
          <button onClick={send} disabled={chatBusy}>
            보내기
          </button>
        </div>
      )}

      {/* ---------- nav ---------- */}
      <nav className="nav">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id}
            onClick={() => {
              setTab(id);
              setSheet(null);
            }}
          >
            {label}
            {id === "vocab" && vocab.length ? ` ${vocab.length}` : ""}
          </button>
        ))}
      </nav>
    </div>
  );
}
