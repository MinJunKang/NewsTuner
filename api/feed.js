// 언론사가 직접 발행하는 RSS/Atom 피드를 받아 기사 목록(JSON)으로 돌려줍니다.
// 목록을 모델에게 물으면 지어낸 주소가 섞이는 문제를 원천에서 없애는 경로로,
// 여기서 나온 주소는 전부 발행사가 직접 적은 것입니다. 허용된 매체만 받습니다.
import { gate, allowedHost } from "./_shared.js";

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");

const text = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
};

// RSS 는 <link>주소</link>, Atom 은 <link href="주소"/> 꼴입니다. Atom 은 한
// 항목에 링크가 여럿일 수 있어 본문을 가리키는 rel="alternate" 를 먼저 찾습니다.
const link = (block) => {
  const plain = text(block, "link");
  if (/^https?:/.test(plain)) return plain;
  const m =
    block.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i) ||
    block.match(/<link[^>]+href="([^"]+)"/i);
  return m ? decode(m[1]) : "";
};

export function parseFeed(xml) {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of blocks.slice(0, 30)) {
    const title = text(b, "title");
    const url = link(b);
    if (!title || !/^https?:/.test(url)) continue;
    items.push({
      title,
      url,
      date: text(b, "pubDate") || text(b, "published") || text(b, "updated") || text(b, "dc:date"),
      desc: (text(b, "description") || text(b, "summary")).slice(0, 200),
    });
  }
  return items;
}

export default async function handler(req, res) {
  if (gate(req, res)) return;
  if (req.method !== "POST")
    return res.status(405).json({ error: { message: "POST만 받습니다." } });
  const url = req.body?.url;
  if (!allowedHost(url))
    return res.status(400).json({ error: { message: "허용된 매체의 피드가 아닙니다." } });
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!r.ok)
      return res.status(200).json({ error: { message: `피드 응답 ${r.status}` }, items: [] });
    const xml = (await r.text()).slice(0, 2_000_000);
    return res.status(200).json({ items: parseFeed(xml).slice(0, 20) });
  } catch (e) {
    return res.status(200).json({ error: { message: String(e?.message || e) }, items: [] });
  }
}
