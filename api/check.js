// 링크가 실제로 열리는지 확인합니다. 확실히 죽은 것(404, 410)만 돌려줍니다.
import { gate, allowedHost, isDead } from "./_shared.js";

export default async function handler(req, res) {
  if (gate(req, res)) return;

  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const targets = urls.filter((u) => typeof u === "string" && allowedHost(u)).slice(0, 12);
  const flags = await Promise.all(targets.map(isDead));
  res.status(200).json({ dead: targets.filter((_, i) => flags[i]) });
}
