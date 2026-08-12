// 기사 주소를 받아 본문 문단을 돌려줍니다. 모델이 검색 발췌 조각 대신 기사
// 전문을 놓고 쓰게 하는 용도입니다. 브라우저는 CORS 때문에 남의 사이트를
// 직접 읽을 수 없어 서버가 대신 가져옵니다.
import { gate, allowedHost } from "./_shared.js";

const entity = (t) =>
  t
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(apos|#39);/g, "'")
    .replace(/&nbsp;/g, " ");

const stripTags = (t) => entity(t.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// 의존성 없이 하는 단순 추출입니다. <article> 이 있으면 그 안을, 없으면 문서
// 전체를 대상으로 <p> 를 모읍니다. 스크립트·메뉴·캡션 껍데기는 먼저 걷어냅니다.
export function extractArticle(html) {
  let scope = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    // aside 는 다시 걷어냅니다. 살려 보니 매체에 따라 관련 기사 티저가 그 안에
    // 살아서, 단일 출처 보장을 추출 단계에서 다시 깨는 통로가 됩니다. 곁상자
    // 몇 개를 잃는 것보다 다른 기사가 섞이지 않는 쪽이 값집니다. 본문 안의
    // 목록(li)은 계속 받습니다.
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|figure|button)\b[\s\S]*?<\/\1>/gi, " ");

  const articles = [...scope.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((m) => m[0]);
  if (articles.length) scope = articles.sort((a, b) => b.length - a.length)[0];

  // p 만 모으면 목록으로 쓰인 섹션이 통째로 사라집니다. li 도 문서 순서대로
  // 함께 받습니다. 안쪽에 다른 태그가 겹치면 짧은 쪽 짝을 먼저 무는 정규식
  // 특성상 중복이 생길 수 있어 아래에서 연속 중복을 걷어냅니다.
  const items = [...scope.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    tag: m[1].toLowerCase(),
    // 첫 글자를 장식용으로 떼어 놓는 매체가 있어 "O ne might" 처럼 붙어 나옵니다.
    text: stripTags(m[2]).replace(/^([A-Za-z])\s+(?=[a-z]{2})/, "$1"),
  }));

  // 메뉴와 헤드라인 목록은 Title Case 라 대문자로 시작하는 단어 비율이 높고,
  // 본문 목록 항목은 소문자 위주입니다. li 는 이 비율로 산문만 받습니다.
  const capRatio = (t) => {
    const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
    if (!words.length) return 1;
    return words.filter((w) => /^[A-Z]/.test(w)).length / words.length;
  };

  const paragraphs = items
    .filter(({ tag, text }) => {
      const w = text.split(/\s+/).filter(Boolean).length;
      if (w < 4) return false;
      if (tag === "p") return text.length >= 60 || /[.!?]["'’]?$/.test(text);
      // li: 문장으로 끝나거나 충분히 길고, 산문답게 소문자 위주여야 합니다.
      return (/[.!?]["'’]?$/.test(text) || text.length >= 80) && capRatio(text) <= 0.5;
    })
    .map(({ text }) => text);

  // 겹쳐 잡힌 연속 중복을 걷어냅니다.
  for (let i = paragraphs.length - 1; i > 0; i--) {
    if (paragraphs[i] === paragraphs[i - 1]) paragraphs.splice(i, 1);
  }

  // 본문 끝에 달리는 상용구(댓글 정책, 저작권, 구독 권유)를 꼬리에서 걷어냅니다.
  const TAIL = /moderates comments|all rights reserved|sign up for|originally (appeared|published)|newsletter|delivered to your (e-?mail |in)?box|get highlights of|recommended citation|^(watch|listen)( now)?:|isn't possible without your support|journalism changes lives|already a subscriber|subscribe to continue/i;
  while (paragraphs.length && TAIL.test(paragraphs[paragraphs.length - 1])) paragraphs.pop();

  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripTags(og?.[1] || titleTag?.[1] || "");

  return { title, paragraphs };
}

export default async function handler(req, res) {
  if (gate(req, res)) return;

  const url = typeof req.body?.url === "string" ? req.body.url : "";
  if (!allowedHost(url)) {
    res.status(400).json({ error: { message: "허용되지 않은 주소입니다." } });
    return;
  }

  let html;
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      // 데이터센터 요청을 봇으로 보고 막는 곳이 있어 보통 브라우저처럼 보냅니다.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!r.ok) {
      res.status(200).json({ error: { message: `원문이 ${r.status} 를 돌려줬습니다.` } });
      return;
    }
    // 통제 못 하는 크기의 응답을 통째로 받지 않습니다.
    html = (await r.text()).slice(0, 2_000_000);
  } catch {
    res.status(200).json({ error: { message: "원문을 가져오지 못했습니다." } });
    return;
  }

  const { title, paragraphs } = extractArticle(html);
  // 모델 입력이 무한정 커지지 않게 문단 기준으로 자릅니다. 넉넉한 상한입니다.
  let total = 0;
  const capped = [];
  for (const p of paragraphs) {
    if (total > 60000) break;
    capped.push(p);
    total += p.length;
  }
  res.status(200).json({ title, paragraphs: capped });
}
