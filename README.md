# AI 공부 튜터

유니브 AI처럼 강의자료(PDF·텍스트)를 올리면 AI가 도와주는 공부용 웹앱이에요.

- 💬 **AI 튜터**: 올린 자료를 근거로 질문에 답해요 (대화가 이어져요)
- 📝 **요약**: 시험 대비용 핵심 정리
- ✅ **퀴즈**: 객관식 8문제 + 해설, 점수 표시
- 🃏 **플래시카드**: 뒤집어서 외우는 암기 카드

AI는 Claude API(`claude-opus-5-5`)를 써요. API 키는 서버 함수(`api/study.js`)에만 있고 브라우저로는 보내지 않아요.

## 배포 (Vercel)

1. [console.anthropic.com](https://console.anthropic.com)에서 API 키를 발급받아요 (사용한 만큼 요금이 나가요).
2. [vercel.com](https://vercel.com)에서 이 GitHub 저장소를 Import 해요. Framework Preset은 **Other**로 두면 돼요.
3. Settings → Environment Variables에 `ANTHROPIC_API_KEY`를 추가해요.
4. Deploy 하면 나오는 주소로 접속하면 끝이에요.

로컬에서 실행: `npm install` 후 `ANTHROPIC_API_KEY=... npx vercel dev`

## 참고

- PDF는 약 3MB까지 올릴 수 있어요 (Vercel 요청 크기 한도 4.5MB).
- 같은 자료로 여러 번 질문하면 프롬프트 캐시가 적용돼서 비용이 줄어요.
- 안전 분류기가 요청을 거절하면 서버에서 권장 모델로 자동 재시도해요 (`fallbacks: "default"`).
