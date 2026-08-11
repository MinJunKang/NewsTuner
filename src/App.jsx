import { useState, useEffect, useRef, useCallback } from "react";
import { fetchArticle, lookupWord, lookupSentence, discuss, safeUrl } from "./api.js";

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
      { id: "npr", label: "NPR", short: "NPR", freq: "88.5",
        window: "the last few days", note: "방송 원고라 말하는 리듬에 가까움" },
      { id: "ap", label: "AP News", short: "AP", freq: "89.7",
        window: "the last few days", note: "짧고 명확한 통신사 문체" },
    ],
  },
  {
    id: "world",
    label: "World",
    topic: "international affairs and foreign policy",
    sources: [
      { id: "pbs", label: "PBS NewsHour", short: "PBS", freq: "90.9",
        window: "the last few days", note: "깊이 있으면서 문장이 정갈함" },
      { id: "csm", label: "The Christian Science Monitor", short: "CSM", freq: "91.5",
        window: "the last week", note: "국제 보도가 강하고 산문이 좋음" },
    ],
  },
  {
    id: "tech",
    label: "Tech · Science",
    topic: "science, mathematics or technology research",
    sources: [
      { id: "quanta", label: "Quanta Magazine", short: "QUANTA", freq: "93.1",
        window: "the last two weeks", note: "어려운 개념을 명료한 영어로 푸는 교본" },
      { id: "mittr", label: "MIT Technology Review", short: "MIT TR", freq: "94.7",
        window: "the last week", note: "AI·기술 정책, 연구자 어휘" },
    ],
  },
  {
    id: "health",
    label: "Health",
    topic: "health, medicine or biotechnology",
    sources: [
      { id: "stat", label: "STAT News", short: "STAT", freq: "96.3",
        window: "the last few days", note: "바이오·의학 저널리즘" },
      { id: "shots", label: "NPR Shots", short: "SHOTS", freq: "97.1",
        window: "the last week", note: "일반 독자용 건강 보도" },
    ],
  },
  {
    id: "economy",
    label: "Economy",
    topic: "the economy, markets or business",
    sources: [
      { id: "pmoney", label: "NPR Planet Money", short: "PMONEY", freq: "98.7",
        window: "the last two weeks", note: "경제 개념을 이야기로 풀어냄, 구어체" },
      { id: "mktpl", label: "Marketplace", short: "MKTPL", freq: "99.5",
        window: "the last week", note: "비즈니스 뉴스를 쉽게" },
    ],
  },
  {
    id: "culture",
    label: "Culture",
    topic: "culture, society, media or sports",
    sources: [
      { id: "atlantic", label: "The Atlantic", short: "ATLNTIC", freq: "101.1",
        window: "the last week", note: "에세이형 장문, 어휘 수준 높음" },
      { id: "ringer", label: "The Ringer", short: "RINGER", freq: "102.3",
        window: "the last week", note: "스포츠·팝컬처, 관용표현이 살아 있음" },
    ],
  },
  {
    id: "art",
    label: "Art",
    topic: "art, design, museums or architecture",
    sources: [
      { id: "smith", label: "Smithsonian Magazine", short: "SMITH", freq: "104.5",
        window: "the last two weeks", note: "읽기 편하고 소재가 넓음" },
      { id: "hyper", label: "Hyperallergic", short: "HYPER", freq: "105.9",
        window: "the last week", note: "현대미술 비평, 관점이 뚜렷함" },
    ],
  },
];

const LEVELS = [
  { id: "easy", label: "쉽게", hint: "A2–B1 · 짧은 문장" },
  { id: "mid", label: "보통", hint: "B2 · 자연스러운 뉴스체" },
  { id: "hard", label: "원문 수준", hint: "C1 · 인용·관계절 등 실제 기사 문체" },
];

const TABS = [
  ["read", "읽기"],
  ["talk", "대화"],
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
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 저장 공간이 없어도 이번 세션은 계속 씁니다 */
  }
};

/* ---------------- text utils ---------------- */

const splitSentences = (p) => p.match(/[^.!?]+[.!?]+["'’)\]]*\s*|[^.!?]+$/g) || [p];
const cleanWord = (t) => t.replace(/^[^A-Za-z'’-]+|[^A-Za-z'’-]+$/g, "");

// 화면이 paragraphs 를 그대로 그리므로, 모양이 깨진 기사는 아예 들이지 않습니다.
const isArticle = (a) =>
  !!a && Array.isArray(a.paragraphs) && a.paragraphs.length > 0;

/* ---------------- pieces ---------------- */

function Dial({ source, tuning }) {
  return (
    <div className={"dial" + (tuning ? " dial--tuning" : "")}>
      <div className="dial__ticks">
        {Array.from({ length: 41 }).map((_, i) => (
          <span key={i} className={"dial__tick" + (i % 5 === 0 ? " dial__tick--major" : "")} />
        ))}
      </div>
      <div className="dial__needle" />
      <div className="dial__row">
        <span className="dial__label">SHORTWAVE · EN</span>
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
  const [focus, setFocus] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);

  const [article, setArticle] = useState(() => {
    const a = load("nt-article", null);
    return isArticle(a) ? a : null;
  });
  const [tuning, setTuning] = useState(false);
  const [error, setError] = useState("");

  const [tab, setTab] = useState(() => {
    const k = load("nt-keys", {});
    return k.proxy || k.gemini ? "read" : "set";
  });
  const [mode, setMode] = useState("word");
  const [sheet, setSheet] = useState(null);

  // 같은 단어를 다시 누르는 일이 잦습니다. 그때마다 API 를 부르면 하루 한도가
  // 금방 닳으므로, 이번 세션 동안 본 결과는 기억해 둡니다.
  const lookupCache = useRef(new Map());

  const [chat, setChat] = useState([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEnd = useRef(null);

  useEffect(() => save("nt-keys", keys), [keys]);
  useEffect(() => save("nt-vocab", vocab), [vocab]);
  useEffect(() => article && save("nt-article", article), [article]);
  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), [chat, chatBusy]);

  const ready = keys.proxy || !!keys.gemini;

  /* ---- actions ---- */

  // story 를 주면 새로 찾지 않고 그 기사를 다룹니다. 관련 기사 목록에서 씁니다.
  const tuneIn = useCallback(
    async (story) => {
    setTuning(true);
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
        story,
      });
      setArticle(a);
      setPanelOpen(false);
      setTab("read");
    } catch (e) {
      setError(e.message);
    } finally {
      setTuning(false);
    }
    },
    [keys, source, field, level, focus]
  );

  async function open(kind, term, key, fetcher) {
    const cached = lookupCache.current.get(key);
    if (cached) {
      setSheet({ kind, term, data: cached });
      return;
    }
    setSheet({ kind, term, loading: true });
    try {
      const data = await fetcher();
      lookupCache.current.set(key, data);
      setSheet({ kind, term, data });
    } catch (e) {
      setSheet({ kind, term, error: e.message });
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
      setChat([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setChat([...next, { role: "assistant", content: e.message, error: true }]);
    } finally {
      setChatBusy(false);
    }
  }

  const articleUrl = safeUrl(article?.url);
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
              {panelOpen ? "접기" : "채널 바꾸기"}
            </button>
          </div>

          {panelOpen && (
            <>
              <div className="row">
                {FIELDS.map((f) => (
                  <Chip
                    key={f.id}
                    on={f.id === field.id}
                    onClick={() => {
                      setField(f);
                      setSource(f.sources[0]);
                    }}
                  >
                    {f.label}
                  </Chip>
                ))}
              </div>
              <div className="row">
                {field.sources.map((s) => (
                  <Chip key={s.id} on={s.id === source.id} onClick={() => setSource(s)}>
                    {s.freq} {s.short}
                  </Chip>
                ))}
                <span className="hint">{source.note}</span>
              </div>
              <div className="row">
                {LEVELS.map((l) => (
                  <Chip key={l.id} on={l.id === level.id} onClick={() => setLevel(l)}>
                    {l.label}
                  </Chip>
                ))}
                <span className="hint">{level.hint}</span>
              </div>

              {/* 한글 조합 중 Enter 는 글자를 확정하는 키라, 조합 중에는 검색하지 않습니다. */}
              <input
                className="focus"
                value={focus}
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
        </div>
      )}

      <main className="main">
        {/* ---------- read ---------- */}
        {tab === "read" && (
          <>
            {tuning && (
              <div style={{ padding: "48px 20px" }}>
                <Spinner label="검색하고 기사를 다시 쓰는 중…" />
              </div>
            )}
            {error && !tuning && <p className="error">{error}</p>}
            {!article && !tuning && !error && (
              <div className="empty">
                <p className="empty__code">NO SIGNAL</p>
                <p className="empty__text">
                  채널과 주제를 고르고 주파수를 맞추면
                  <br />
                  오늘 기사가 도착합니다.
                </p>
              </div>
            )}

            {article && !tuning && (
              <article className="article">
                <div className="article__meta">
                  <span className="article__outlet">{article.outlet}</span>
                  <span>·</span>
                  <span>{article.published}</span>
                </div>
                <h2 className="article__title">{article.title}</h2>
                <p className="article__titleko">{article.titleKo}</p>

                <div className="article__modes">
                  <span className="hint">탭하면</span>
                  <Chip on={mode === "word"} onClick={() => setMode("word")}>
                    단어 뜻
                  </Chip>
                  <Chip on={mode === "sentence"} onClick={() => setMode("sentence")}>
                    문장 해석
                  </Chip>
                </div>

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
                        return (
                          <span key={si}>
                            {sent.split(/(\s+)/).map((tok, ti) => {
                              const w = cleanWord(tok);
                              if (!w) return <span key={ti}>{tok}</span>;
                              return (
                                <span key={ti} className="w" onClick={() => openWord(w, s)}>
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

                {article.keywords?.length > 0 && (
                  <div className="keys">
                    <p className="keys__label">KEY WORDS</p>
                    <ul>
                      {article.keywords.map((k, i) => (
                        <li key={i}>
                          <button
                            onClick={() => openWord(k.word, k.note || article.paragraphs[0])}
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
                  {articleUrl ? (
                    <a href={articleUrl} target="_blank" rel="noreferrer">
                      원문 기사 열기 →
                    </a>
                  ) : (
                    <span className="hint">원문 링크를 받지 못했습니다</span>
                  )}
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
                <p className="empty__text">기사를 먼저 받아오면 그 내용으로 대화할 수 있습니다.</p>
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
                {m.content}
              </div>
            ))}
            {chatBusy && <Spinner label="쓰는 중…" />}
            <div ref={chatEnd} />
          </div>
        )}

        {/* ---------- vocab ---------- */}
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
                    <span className="vocab__word">{v.word}</span>
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
                placeholder="https://…workers.dev"
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

            {ready && <p className="ok">준비됐습니다. 읽기 탭에서 주파수를 맞추세요.</p>}
          </div>
        )}
      </main>

      {/* ---------- sheet ---------- */}
      {sheet && (
        <section className="sheet">
          <div className="sheet__head">
            <p className="sheet__term">{sheet.kind === "word" ? sheet.term : "문장 해석"}</p>
            <button className="sheet__close" onClick={() => setSheet(null)}>
              닫기 ✕
            </button>
          </div>

          {sheet.loading && <Spinner label="찾는 중…" />}
          {sheet.error && <p className="error" style={{ padding: "8px 0" }}>{sheet.error}</p>}

          {sheet.kind === "word" && sheet.data && (
            <>
              <p className="k-mono">
                {sheet.data.ipa} · {sheet.data.pos}
                {sheet.data.base && sheet.data.base !== sheet.term ? ` · ${sheet.data.base}` : ""}
              </p>
              <p className="k-ko">{sheet.data.ko}</p>
              <p className="k-en">{sheet.data.en}</p>
              <p className="k-ctx">{sheet.data.inContext}</p>
              <p className="k-ex">{sheet.data.example}</p>
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
