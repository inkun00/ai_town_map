# Vercel 배포 설정

이 문서는 `ai-town-map` Vercel 프로젝트와 `inkun00/ai_town_map` GitHub 저장소의 배포 체크리스트다. 비밀번호와 API 비밀값은 Git 저장소에 넣지 않는다.

1. Vercel Production의 `APP_ORIGIN`은 실제 고정 프로덕션 도메인의 HTTPS origin으로 설정한다. `NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY`는 카카오 Developers의 JavaScript 키이며 브라우저 공개 변수다. 카카오 키의 JavaScript SDK 도메인에도 같은 origin과 로컬 `http://localhost:3001`을 각각 등록한다.
2. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INVITE_CODE_PEPPER`를 Production 환경 변수에 등록한다. 공개 키만 `SUPABASE_ANON_KEY`에 넣는다. 관리자 DB 연결 문자열은 배포하지 않는다.
3. Production `DATABASE_URL`은 `app_backend.<project-ref>` 역할의 Supabase **Transaction pooler** (`:6543`) 주소를 사용한다. 로컬 마이그레이션 관리자 주소를 배포 환경에 복사하지 않는다. 풀러 호스트는 Supabase Dashboard의 Connect 창에서 직접 확인한다. 이 앱의 `pg` 쿼리는 이름 있는 prepared statement를 사용하지 않는다.
4. Supabase Auth URL Configuration의 Redirect URLs에 `https://<production-domain>/api/v1/auth/callback`을 정확히 추가한다. Google 공급자는 기존 Supabase callback 설정을 유지한다.
5. 배포 후 `/api/v1/status`가 `configured: true`인지 확인하고, 공개 지도 조회·Google 로그인·초대 참여·카카오 타일·장소 검색·포인트 등록/사진을 점검한다. 검수 정책 지도에서는 미승인 기록과 사진이 익명 사용자에게 노출되지 않아야 한다.

참고: [Vercel 환경 변수](https://vercel.com/docs/environment-variables), [Supabase 서버리스 DB 연결](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
