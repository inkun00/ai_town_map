# Vercel 배포 설정

이 문서는 [운영 앱](https://ai-town-map.vercel.app), `ai-town-map` Vercel 프로젝트와 [GitHub 저장소](https://github.com/inkun00/ai_town_map)의 배포 체크리스트다. 2026-09-28 현재 CLI로 운영 배포하고 DB 연결을 검증했다. 비밀번호와 API 비밀값은 Git 저장소에 넣지 않는다.

1. Vercel Production의 `APP_ORIGIN`은 실제 고정 프로덕션 도메인의 HTTPS origin으로 설정한다. `NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY`는 카카오 Developers의 JavaScript 키이며 브라우저 공개 변수다. 카카오 키의 JavaScript SDK 도메인에도 같은 origin과 로컬 `http://localhost:3001`을 각각 등록한다.
2. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INVITE_CODE_PEPPER`를 Production 환경 변수에 등록한다. 공개 키만 `SUPABASE_ANON_KEY`에 넣는다. 관리자 DB 연결 문자열은 배포하지 않는다.
3. Production `DATABASE_URL`은 `app_backend.<project-ref>` 역할의 Supabase **Transaction pooler** (`:6543`) 주소를 사용한다. 로컬 마이그레이션 관리자 주소를 배포 환경에 복사하지 않는다. 풀러 호스트는 Supabase Dashboard의 Connect 창에서 직접 확인한다. 이 앱의 `pg` 쿼리는 이름 있는 prepared statement를 사용하지 않는다.
4. Supabase Auth URL Configuration의 Site URL을 `https://ai-town-map.vercel.app`로 설정한다. Redirect URLs에는 운영 `https://ai-town-map.vercel.app/api/v1/auth/callback**`와 로컬 `http://localhost:3001/api/v1/auth/callback**`을 등록한다. 콜백 뒤에 요청 식별자 쿼리가 붙을 수 있으므로 끝의 `**`가 필요하다. Google 공급자는 기존 Supabase callback 설정을 유지한다.
5. 배포 후 `/api/v1/status`가 `configured: true`인지 확인하고, 공개 지도 조회·Google 로그인·초대 참여·카카오 타일·장소 검색·포인트 등록/사진을 점검한다. 검수 정책 지도에서는 미승인 기록과 사진이 익명 사용자에게 노출되지 않아야 한다.

2026-10-13 참여 상한 제거 배포: 새 앱을 배포하기 전에 `npm run db:migrate`로 `011_unlimited_map_invites.sql`을 적용한다. 기존 `max_uses` 숫자는 배포 전 앱과의 호환을 위해 보존하며 새 앱에서는 무시한다. 신규 코드는 `max_uses=NULL`, 초대 생성·목록 API는 기존 코드도 `maxUses:null`을 반환한다. 사용 통계·만료·폐기 상태는 유지한다. 운영 확인 시 과거 한도에 도달한 유효 코드로 새 참여가 가능한지 점검한다. 이 변경은 인원 상한 제거이며 실제 동시 처리 성능은 별도 부하 검증으로 확인한다.

새 코드가 생성된 뒤의 롤백도 `max_uses=NULL`을 지원하는 앱 버전을 사용한다. 무제한 초대를 지원하기 전 버전은 NULL 한도를 소진으로 판단하므로 그대로 되돌리면 새 코드 참여가 막힌다.

운영 환경에는 `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INVITE_CODE_PEPPER`, transaction pooler 기반 `DATABASE_URL`, Kakao JavaScript 키를 설정했다. ‘생태지도’ Kakao 앱의 기존 SDK 도메인 3개를 유지하고 로컬·운영 도메인을 추가했다. 두 환경에서 실제 지도 타일을 확인했다. Vercel Git 설정에서 GitHub `inkun00/ai_town_map` 연결도 확인했다. 운영·로컬 OAuth Redirect URLs와 운영 Site URL을 저장했다. 운영 앱에서 Google 로그인 후 세션이 발급되고 새로고침 후에도 유지되는 것을 확인했다.

참고: [Vercel 환경 변수](https://vercel.com/docs/environment-variables), [Supabase 서버리스 DB 연결](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

2026-10-01 기능 점검: Vercel 런타임(`VERCEL=1`)에서는 초대 입장 제한에 플랫폼의 `x-vercel-forwarded-for` 헤더를 사용한다. 다른 운영 호스트는 기존대로 신뢰 프록시의 `TRUSTED_CLIENT_IP_HEADER` 설정이 필요하다. [Vercel 요청 헤더](https://vercel.com/docs/headers/request-headers). 수정·삭제·검수 요청은 CDN의 HTTP 조건부 처리와 충돌하지 않도록 `X-Resource-Version`을 보낸다.
