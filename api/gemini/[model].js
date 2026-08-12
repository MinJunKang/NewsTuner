// Gemini 중계입니다. 키가 폰이 아니라 Vercel 환경변수에 삽니다.
// 앱은 프록시 주소를 https://<프로젝트>.vercel.app/api 로 넣습니다.
import { gate, ALLOWED_MODELS } from "../_shared.js";

export default async function handler(req, res) {
  if (gate(req, res)) return;

  const model = req.query.model;
  if (!ALLOWED_MODELS.has(model)) {
    res.status(400).json({ error: { message: `허용되지 않은 모델입니다: ${model}` } });
    return;
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Vercel 이 JSON 본문을 객체로 파싱해 두므로 다시 문자열로 만듭니다.
      body: JSON.stringify(req.body ?? {}),
    }
  );
  const text = await upstream.text();
  res.status(upstream.status).setHeader("Content-Type", "application/json").send(text);
}
