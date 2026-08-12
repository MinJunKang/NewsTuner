import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Actions에서 빌드하면 저장소 이름을 base 경로로 자동 사용합니다.
// (예: github.com/<아이디>/news-tuner → /news-tuner/)
// 로컬이나 다른 호스팅에서는 상대 경로를 씁니다.
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : "./";

export default defineConfig({
  plugins: [react()],
  base,
  // 오류 기록 머리에 찍는 빌드 시각입니다. 보고가 어느 배포에서 나온 것인지
  // 추측하지 않아도 되게 합니다.
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16) + "Z") },
});
