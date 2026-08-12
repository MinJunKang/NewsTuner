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
} from "./api.js";

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
        window: "the last few days", note: "방송 원고라 말하는 리듬에 가까움" },
      { id: "ap", length: "mid", label: "AP News", short: "AP", freq: "89.7",
        domain: "apnews.com",
        window: "the last few days", note: "짧고 명확한 통신사 문체" },
      { id: "propub", length: "long", label: "ProPublica", short: "PROPUB", freq: "90.1",
        domain: "propublica.org",
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
        window: "the last few days", note: "깊이 있으면서 문장이 정갈함" },
      { id: "tconv", length: "mid", label: "The Conversation US", short: "CONV", freq: "91.5",
        domain: "theconversation.com",
        window: "the last few days", note: "학자가 직접 쓰는 해설, 문장 밀도 높음" },
    ],
  },
  {
    id: "tech",
    label: "Tech · Science",
    topic: "science, mathematics or technology research",
    sources: [
      { id: "quanta", length: "long", label: "Quanta Magazine", short: "QUANTA", freq: "93.1",
        domain: "quantamagazine.org",
        window: "the last two weeks", note: "어려운 개념을 명료한 영어로 푸는 교본" },
      { id: "mittr", length: "long", label: "MIT Technology Review", short: "MIT TR", freq: "94.7",
        domain: "technologyreview.com",
        window: "the last week", note: "AI·기술 정책, 연구자 어휘" },
      { id: "ars", length: "mid", label: "Ars Technica", short: "ARS", freq: "95.5",
        domain: "arstechnica.com",
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
        window: "the last week", note: "일반 독자용 건강 보도" },
      { id: "scinews", length: "mid", label: "Science News", short: "SCINEWS", freq: "97.1",
        domain: "sciencenews.org",
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
        window: "the last two weeks", note: "경제 개념을 이야기로 풀어냄, 구어체" },
      { id: "mktpl", length: "short", label: "Marketplace", short: "MKTPL", freq: "99.5",
        domain: "marketplace.org",
        window: "the last week", note: "비즈니스 뉴스를 쉽게" },
    ],
  },
  {
    id: "culture",
    label: "Culture",
    topic: "culture, society, media or sports",
    sources: [
      { id: "atlantic", length: "long", label: "The Atlantic", short: "ATLNTIC", freq: "101.1",
        domain: "theatlantic.com",
        window: "the last week", note: "에세이형 장문, 어휘 수준 높음" },
      { id: "ringer", length: "long", label: "The Ringer", short: "RINGER", freq: "102.3",
        domain: "theringer.com",
        window: "the last week", note: "스포츠·팝컬처, 관용표현이 살아 있음" },
      { id: "defector", length: "long", label: "Defector", short: "DFCTR", freq: "103.3",
        domain: "defector.com",
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
        window: "the last week", note: "현대미술 비평, 관점이 뚜렷함" },
      { id: "colossal", length: "short", label: "Colossal", short: "CLSSL", freq: "105.9",
        domain: "thisiscolossal.com",
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

// 모델에게 마크다운을 쓰지 말라고 해도 가끔 **강조** 를 섞어 보내고, 그러면
// 별표가 글자로 그대로 보입니다. HTML 로 해석하지 않고 React 요소로만 바꾸므로
// 주입 위험은 없습니다.
const renderText = (text) =>
  String(text ?? "")
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

/* ---------------- app ---------------- */

export default function App() {
  const [keys, setKeys] = useState(() => ({
    gemini: "",
    proxy: "",
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
      setPanelOpen(false);
      setTab("read");
    } catch (e) {
      setError(e.message);
    } finally {
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
                <summary>각 항목이 무슨 뜻인가요?</summary>
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
                {tuning ? "수신 중…" : ready ? "주파수 맞추기" : "설정에서 키를 먼저 넣으세요"}
              </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <main className="main">
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
                  분야와 매체를 고르고 주파수를 맞추면
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
                  {v.example && <p className="vocab__ex">{v.example}</p>}
                </li>
              ))}
            </ul>
          ))}

        {/* ---------- settings ---------- */}
        {tab === "set" && (
          <div className="settings">
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
              <label htmlFor="px">프록시 주소 · 선택</label>
              <input
                id="px"
                type="url"
                autoComplete="off"
                value={keys.proxy}
                onChange={(e) => setKeys({ ...keys, proxy: e.target.value })}
                placeholder="https://…vercel.app/api"
              />
              <small>
                넣으면 키를 기기에 두지 않고 프록시가 대신 호출합니다. 비워 두면 브라우저에서 직접
                호출합니다.
              </small>
            </div>

            {keys.proxy && (
              <div className="field">
                <label htmlFor="pt">프록시 토큰 · 선택</label>
                <input
                  id="pt"
                  type="password"
                  autoComplete="off"
                  value={keys.token}
                  onChange={(e) => setKeys({ ...keys, token: e.target.value })}
                  placeholder="워커의 SHARED_TOKEN"
                />
                <small>
                  워커에 SHARED_TOKEN 을 넣었다면 같은 값을 여기에도 넣어야 합니다. 넣지 않으면
                  워커가 모든 요청을 401로 막습니다.
                </small>
              </div>
            )}

            <div className="field">
              <label>기사 배경</label>
              <div className="row__chips">
                <Chip on={!dark} onClick={() => setDark(false)}>
                  밝게
                </Chip>
                <Chip on={dark} onClick={() => setDark(true)}>
                  어둡게
                </Chip>
              </div>
              <small>
                기사를 읽는 화면의 배경입니다. 읽기 화면 오른쪽 위 ☾ 버튼으로도 바꿀 수
                있습니다. 나머지 화면은 원래 어두운 색입니다.
              </small>
            </div>

            {ready && <p className="ok">준비됐습니다. 읽기 탭에서 주파수를 맞추세요.</p>}
          </div>
        )}
      </main>

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
              <p className="k-ex">{sheet.data.example}</p>
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
              <p className="k-ex">
                {sheet.data.example}
                {canSpeak && (
                  <button
                    className="speak"
                    onClick={() => speak(sheet.data.example)}
                    aria-label="예문 듣기"
                  >
                    🔊
                  </button>
                )}
              </p>
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
              <p className="k-ex k-en">{sheet.term}</p>
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
        <div className="composer">
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
