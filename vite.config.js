import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Actions에서 빌드하면 저장소 이름을 base 경로로 자동 사용합니다.
// (예: github.com/minjun/news-tuner → /news-tuner/)
// 로컬이나 다른 호스팅에서는 상대 경로를 씁니다.
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : "./";

export default defineConfig({
  plugins: [react()],
  base,
});
