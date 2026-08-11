# News Tuner

VOA·NPR 뉴스를 라디오 주파수처럼 맞춰 읽고, 단어를 눌러 뜻을 보고, 기사에 대해 대화하는 개인용 앱입니다.
아이폰 홈 화면에 설치되는 PWA라 개발자 계정(연 $99)이 필요 없습니다.

키는 Gemini 하나만 있으면 됩니다.

- **뉴스 수집** — Gemini 3.6 Flash + Google 검색 그라운딩
- **단어·문장 풀이** — Gemini 3.5 Flash-Lite
- **기사 토론** — Gemini 3.6 Flash

---

## 1. GitHub에 올리기

저장소는 **public**이어야 GitHub Pages가 무료입니다. 키는 코드에 없고 앱 설정 화면에서 입력받아
각자의 기기에만 저장되므로, 코드가 공개돼도 크레딧이 새지 않습니다.

```bash
cd news-tuner
git init
git add .
git commit -m "News Tuner"
git branch -M main
git remote add origin https://github.com/<아이디>/news-tuner.git
git push -u origin main
```

## 2. Pages 켜기

저장소 → **Settings** → **Pages** → Source를 **GitHub Actions**로 바꿉니다.

그러면 Actions 탭에서 배포가 돌기 시작하고, 1~2분 뒤 주소가 나옵니다.

```
https://<아이디>.github.io/news-tuner/
```

`vite.config.js`가 저장소 이름을 읽어 base 경로를 맞추므로, 저장소 이름을 바꿔도 손댈 곳이 없습니다.

이후로는 `git push` 할 때마다 자동 배포됩니다.

## 3. 아이폰에 설치

1. **사파리로** 위 주소를 엽니다 — 크롬에는 "홈 화면에 추가"가 없습니다
2. 하단 공유 버튼 → 아래로 스크롤 → **홈 화면에 추가**
3. 아이콘이 생기고, 주소창 없는 전체화면으로 실행됩니다

## 4. 키 넣기

앱을 처음 열면 **설정** 탭이 먼저 뜹니다.

| | 발급처 | 비용 |
|---|---|---|
| Gemini | aistudio.google.com | 무료 티어 |

Gemini는 Flash 계열이 무료 티어에 있고, Google 검색 그라운딩도 월 5,000 프롬프트까지 무료 한도가 있습니다.
한도는 수시로 바뀌니 AI Studio의 rate limit 화면에서 본인 프로젝트 실제 수치를 확인하세요.

단어 클릭과 대화도 같은 키를 쓰므로, 개인 사용이면 대체로 무료 티어 안에서 끝납니다.

키는 그 기기의 localStorage에만 저장됩니다. 한 번 넣으면 계속 유지됩니다.

## 로컬에서 고쳐볼 때

```bash
npm install
npm run dev
```

---

## 설계 메모

**원문을 긁어오지 않습니다.** Gemini가 검색으로 실제 기사를 찾은 뒤, 사실만 가져와 새로 씁니다.
저작권 문제를 피하고 난이도(A2~C1)를 조절할 수 있게 하는 선택입니다.
원문 링크와 그라운딩 출처는 기사 하단에 함께 표시됩니다.

**모델을 나눠 씁니다.** 단어 클릭은 짧고 잦으니 Flash-Lite(생각 기본값이 minimal 이라 빠릅니다),
뉴스 수집과 토론은 Flash를 씁니다. 모델명은 자주 바뀌므로 `src/api.js`의 `MODELS` 객체
한 곳에서만 고치면 전체에 적용됩니다. 워커를 쓴다면 `worker/index.js`의 `ALLOWED_MODELS`도 함께 고치세요.

**기사와 단어장은 기기에 남습니다.** 앱을 껐다 켜도 마지막 기사가 그대로 있습니다.

## 구조

```
src/api.js               두 API 호출과 프롬프트
src/App.jsx              화면 전체
src/styles.css           스타일
public/                  아이콘, manifest, 서비스 워커
.github/workflows/       Pages 자동 배포
worker/                  선택 사항. 키를 기기에 두지 않는 프록시
```

## 부록 — 키를 기기에 두지 않으려면

`worker/index.js`를 Cloudflare Workers에 올리면 키가 폰이 아니라 Cloudflare에 저장됩니다.

```bash
npx wrangler deploy worker/index.js --name news-tuner-proxy
npx wrangler secret put GEMINI_KEY   --name news-tuner-proxy
npx wrangler secret put SHARED_TOKEN --name news-tuner-proxy
```

배포된 주소를 앱 설정의 "프록시 주소"에 넣고, `worker/index.js` 상단의 `ALLOW_ORIGIN`을
`https://<아이디>.github.io` 로 바꿔 주세요.

`SHARED_TOKEN`을 넣었다면 **같은 값을 앱 설정의 "프록시 토큰"에도 넣어야 합니다.**
프록시 주소를 채우면 토큰 칸이 나타납니다. 값이 다르면 워커가 모든 요청을 401로 막습니다.
