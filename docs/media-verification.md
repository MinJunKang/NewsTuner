# 매체 검증 기록

매체를 목록에 넣기 전에 거치는 실측 검증의 방법과 결과입니다.
마지막 전수 감사: **2026-08-12** (devbox, 미국 데이터센터 IP 기준).

## 왜 실측인가

정책 지식("이 매체는 무료다")만으로는 부족합니다. 실제로 갈리는 것은:

- **서버가 전문을 받아올 수 있는가** — 무료 매체여도 데이터센터 IP를 봇으로
  보고 403을 주면 전문 모드가 영영 실패합니다 (Smithsonian, Atlas Obscura 사례)
- **유료 장벽이 어느 층에 있는가** — JS/쿠키 미터는 서버 추출에 안 걸리고
  (Atlantic 부류), 서버측 차단은 걸립니다 (Reuters 사례)
- **주소 형태가 판별기를 통과하는가** — BBC 신형 주소(무작위 식별자)는
  규칙을 고치기 전까지 전부 탈락했습니다

## 검증 절차 (매체당 4단계)

1. **기사 주소 수확** — RSS 피드가 가장 안정적. 홈이 JS 렌더링이면 sitemap.
   허브 주소가 아니라 실제 기사 2~3편을 얻어야 합니다.
   (교훈: Quanta 특집 허브를 기사로 잘못 뽑아 0문단이 나온 적 있음)
2. **추출 실측** — `api/extract.js`의 `extractArticle`로 문단 수·단어 수 확인.
   첫 문단과 끝 문단을 눈으로 봐서 본문 전체가 잡혔는지 확인합니다.
3. **장벽 문구 검색** — HTML에서 subscribe to continue / already a subscriber
   류 문구. 문구가 있어도 전문이 오면 "JS 미터 부류"로 채택 가능(위험 표시).
4. **주소 판별 통과 확인** — `src/api.js`의 `looksLikeArticleUrl`에 실제
   주소를 넣어 true인지. false면 규칙 보강이 먼저입니다.

### 재사용 스크립트

```js
// node verify.mjs  (저장소 루트에서)
import { extractArticle } from "./api/extract.js";
import { looksLikeArticleUrl } from "./src/api.js";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", Accept: "text/html,application/rss+xml" };
const get = async (u) => { const r = await fetch(u, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(15000) }); return { status: r.status, html: await r.text() }; };
const GATE = /subscribe to (read|continue)|already a subscriber|to continue reading|register to (read|continue)/i;

const FEED = "https://예시매체.com/feed/";           // ← 바꿔서 실행
const f = await get(FEED);
const urls = [...new Set([...f.html.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/g)].map(m => m[1].trim()))]
  .filter(u => !/feed|\.xml/.test(u)).slice(0, 3);
for (const u of urls) {
  const a = await get(u);
  const { title, paragraphs } = extractArticle(a.html);
  const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  console.log(`${a.status} | ${paragraphs.length}문단 ${words}단어` +
    `${GATE.test(a.html) ? " | 장벽문구" : ""} | 판별:${looksLikeArticleUrl(u)} | ${title.slice(0, 40)}`);
  console.log("  첫:", paragraphs[0]?.slice(0, 70));
  console.log("  끝:", paragraphs.at(-1)?.slice(0, 70));
}
```

## 판정 기준

| 판정 | 조건 |
|---|---|
| ✅ 채택 | 200 + 전문(첫~끝) + 장벽 없음 + 판별 통과 |
| ⚠️ 채택(위험 표시) | 전문은 오지만 장벽 문구 존재 = JS/쿠키 미터. 정책이 서버측 차단으로 바뀌면 끊길 수 있음 |
| ❌ 탈락 | 기사 페이지 403/401 (전문 모드 구조적 불가), 또는 오디오 중심이라 텍스트 없음 |

## 실측 결과 (2026-08-12)

### 채택 — 현재 목록 20개

| 매체 | 실측 (문단/단어) | 비고 |
|---|---|---|
| NPR (News·Shots·Planet Money) | 전문 ~2,588w | 무료 |
| AP News | 전문 2,187~2,338w | 무료 |
| ProPublica | 전문 931~4,000w | 무료, **CC 라이선스** |
| PBS NewsHour | 전문 364~1,111w | 무료 |
| The Conversation US (·Law) | 전문 864~985w | 무료, **CC 라이선스** |
| BBC News | 전문 716~1,131w | ⚠️ 미국향 JS 미터 (서버엔 안 걸림). 신형 주소 규칙 보강함 |
| Quanta | 전문 1,535~3,810w | 무료. HEAD 요청은 묵살(시간초과)하나 안전 |
| MIT Tech Review | 전문 607~2,398w | ⚠️ JS 미터 부류 |
| Ars Technica | 전문 337~633w(단신)~특집 | 무료. 단신·특집 혼재 |
| Science News | 전문 400~1,989w | 무료 |
| Marketplace | 전문 ~473w | 무료. 라디오 대본형이라 원래 짧음 |
| SCOTUSblog | 전문 672~888w | 무료. 꼬리 Recommended Citation 제거 처리 |
| The Atlantic | 전문 1,688~4,795w | ⚠️ JS 미터 부류 |
| The Ringer | 4문단/418w — **부분 추출 의심, 요관찰** | 무료 |
| Defector | 전문 843~2,837w | 일부 게시물 유료, 실측은 전문 |
| Hyperallergic | 전문 346~695w | 무료+후원 모델 |
| Colossal | 전문 169~370w | 무료. 짧은 포토에세이 형식 |

### 탈락

| 매체 | 사유 |
|---|---|
| Smithsonian | 기사 페이지 데이터센터 **403** — 전문 모드 구조적 불가 |
| Atlas Obscura | 동일 403 |
| Reuters (Legal 포함) | 섹션부터 **401** |
| NPR Pop Culture Happy Hour | 오디오 페이지, 텍스트 129단어뿐 |

### 예비 (검증 통과, 대기)

| 매체 | 실측 | 비고 |
|---|---|---|
| Vulture | 전문 1,648~2,179w | ⚠️ JS 미터 부류 |
| Nautilus | 전문 537~2,846w | ⚠️ 멤버십 장벽 확인됨("paywall-free" 문구). 서버엔 안 걸림 |

## 매체 추가 시 체크리스트

1. 위 스크립트로 4단계 실측 → 판정
2. `src/App.jsx` FIELDS에 항목 추가 — `domain`, `window`(발행 주기),
   `length`(실측 분량에 맞는 기본 길이), `note` 필수
3. **허용 목록 3곳 동기화**: `src/App.jsx`(domain) ·
   `api/_shared.js`(ALLOWED_HOSTS) · `worker/index.js`(ALLOWED_HOSTS)
4. 주소가 새 형태면 `looksLikeArticleUrl` 보강 + 기존 기사/허브 회귀 검증
5. 꼬리 상용구(기부·인용·관련영상)가 보이면 `api/extract.js`의 TAIL에 추가
6. `npm run build` 후 push (Vercel이 api/ 를 자동 재배포)
