// 번들러(vite)는 문법만 보고, 정의되지 않은 식별자는 잡아 주지 않습니다.
// 실제로 fieldLabel 을 매개변수에 추가하지 않고 참조한 코드가 빌드를 통과해
// 배포됐고, 호출 순간 ReferenceError 로 기사 찾기가 통째로 죽었습니다.
// 그런 종류(미정의 변수, const 재대입, 중복 키)만 잡는 최소 구성입니다.
// 문체 규칙은 넣지 않습니다. 빌드를 막는 것은 고장 나는 코드뿐이어야 합니다.

const globals = Object.fromEntries(
  [
    "window", "document", "navigator", "localStorage", "fetch", "console",
    "URL", "URLSearchParams", "Blob", "setTimeout", "clearTimeout",
    "DOMException", "AbortController", "AbortSignal",
    "SpeechSynthesisUtterance", "speechSynthesis",
    "process", // api/ 는 서버(Node)에서 돕니다
    "__BUILD_ID__", // vite.config.js 의 define 이 채웁니다
  ].map((g) => [g, "readonly"])
);

export default [
  { ignores: ["dist/", "node_modules/", "public/", "docs/", "notes/"] },
  {
    files: ["src/**/*.{js,jsx}", "api/**/*.js", "vite.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals,
    },
    rules: {
      "no-undef": "error",
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-func-assign": "error",
      "no-unreachable": "error",
      "use-isnan": "error",
      // 안 쓰는 변수는 고장이 아니라 냄새라 경고로만 둡니다.
      "no-unused-vars": ["warn", { args: "none" }],
    },
  },
];
