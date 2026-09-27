# 모두의 지도

동네의 장소와 환경을 주제별 이모지 포인트로 기록하는 모바일 커뮤니티 지도 웹앱입니다. 지도 개설자는 Google 계정으로 로그인하고, 참여자는 초대 코드와 닉네임으로 입장합니다. [PRD](docs/PRD.md)와 [개발 계획](docs/DEVELOPMENT_PLAN.md)에 기능 범위와 단계별 모델 권장을 기록했습니다.

## 로컬 실행

Node.js 22 이상에서 `npm install` 후 [`.env.example`](.env.example)을 참고해 `.env.local`을 만듭니다. Supabase와 Google OAuth 설정은 [3단계 설정 안내](docs/STAGE3_SETUP.md)를 따릅니다. 카카오맵 JavaScript 키에 로컬 주소를 등록해야 실제 지도가 표시됩니다.

```bash
npm run db:migrate
npm run dev -- -p 3001
```

`http://localhost:3001`에서 지도를 엽니다. 서버 설정이 없으면 샘플 UX가 표시됩니다. 서버 설정이 있으면 지도·회원·기록·사진이 DB에 저장됩니다. 카카오 키가 없으면 실제 지도 대신 설정 안내가 표시됩니다.

검증 명령은 `npm run db:check-schema`, `npm test`, `npm run typecheck`, `npm run build`입니다. 실제 DB API 연동은 합성 자료를 생성·삭제하는 `RUN_LIVE_PHASE4=1 node scripts/check-live-phase4.mjs`로 검사할 수 있습니다.

## 배포

Vercel 환경 변수, Supabase DB 풀러, OAuth 리다이렉트, 카카오 SDK 도메인은 [배포 안내](docs/DEPLOYMENT.md)를 따릅니다. 현재 구현·검증 범위와 남은 항목은 [4단계 검토](docs/STAGE4_REVIEW.md)에 있습니다. 댓글·검수 관리·영구 분석·제안서 저장은 후속 단계입니다.
