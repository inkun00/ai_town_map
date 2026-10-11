# 3단계 실제 연결 설정

현재 로컬 앱 주소는 `http://localhost:3001`이다. 3000번 포트는 다른 프로젝트가 사용 중이다. 포트가 바뀌면 아래 URL과 `APP_ORIGIN`을 모두 같은 값으로 바꾼다. 비밀번호·키·초대 pepper는 채팅이나 Git에 붙여 넣지 않는다.

## 1. Supabase와 Google 준비

1. [Supabase](https://supabase.com/dashboard)에서 프로젝트를 만들고 Project URL, 공개 키, 관리자용 Postgres 연결 문자열을 확인한다. 공개 키는 프로젝트의 **Connect** 창 또는 **Settings → API Keys**에서 `sb_publishable_…` 키를 찾는다. 이 앱의 환경 변수 이름은 호환성을 위해 `SUPABASE_ANON_KEY`지만 publishable 키를 넣는다. DB 연결 문자열은 **Connect** 메뉴에서 복사한다. 직접 연결이 안 되면 Supabase가 안내하는 session pooler를 사용한다. [Supabase API 키](https://supabase.com/docs/guides/getting-started/api-keys), [DB 연결 가이드](https://supabase.com/docs/guides/database/connecting-to-postgres)
2. [Google Cloud Console](https://console.cloud.google.com/)의 Google Auth Platform에서 동의 화면의 대상(Audience)과 `openid`·이메일·프로필 범위를 설정한다. 테스트 모드라면 로그인에 사용할 Google 계정을 테스트 사용자로 추가한다. OAuth 클라이언트를 **Web application**으로 만들고 Authorized JavaScript origins에 `http://localhost:3001`, Authorized redirect URIs에 Supabase Google 제공자 화면이 안내하는 `https://<project-ref>.supabase.co/auth/v1/callback`을 넣는다. 생성한 Client ID·Secret은 Supabase Dashboard → Authentication → Providers → Google에 입력하고 제공자를 켠다. [Supabase Google 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)
3. Supabase Dashboard → Authentication → URL Configuration에서 Site URL을 `http://localhost:3001`로, Redirect URLs에 `http://localhost:3001/api/v1/auth/callback**`을 추가한다. 앱은 PKCE 콜백에 요청 식별자를 붙이므로 로컬 개발용 경로 와일드카드가 필요하다. 운영 배포 시에는 별도 HTTPS 도메인과 제한된 허용 패턴으로 교체한다. [Redirect URL 가이드](https://supabase.com/docs/guides/auth/redirect-urls)

## 2. 로컬 환경 파일

PowerShell에서 프로젝트 폴더로 이동해 예시 파일을 복사한다.

```powershell
Copy-Item .env.example .env.local
Copy-Item .env.migrate.example .env.migrate.local
```

`.env.local`에 다음을 실제 값으로 입력한다.

| 변수 | 값 |
|---|---|
| `APP_ORIGIN` | `http://localhost:3001` |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | 해당 프로젝트 공개 키 |
| `DATABASE_URL` | 제한된 `app_backend` 역할의 DB 연결 문자열. 직접 연결은 사용자명 `app_backend`, 공유 pooler는 Supabase 안내에 따라 `app_backend.<project-ref>`를 사용한다. 새로 정한 20자 이상 비밀번호를 URL에 넣는다. |
| `INVITE_CODE_PEPPER` | 32자 이상 암호학적 난수. PowerShell에서 `[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`로 생성할 수 있다. |

`DATABASE_URL`은 아직 존재하지 않는 `app_backend` 역할을 가리켜도 된다. 다음 마이그레이션이 역할을 만들고 URL에 지정한 비밀번호를 설정한다. URL의 비밀번호에 `@`, `#`, `?`, `&` 같은 문자가 있으면 URL 인코딩한다. [Supabase 역할 가이드](https://supabase.com/docs/guides/database/postgres/roles)

`.env.migrate.local`에는 관리자용 `DATABASE_ADMIN_URL`만 입력한다. 이 파일은 마이그레이션 도구만 읽으며 Next.js 앱은 읽지 않는다. 관리자 연결 문자열을 `.env.local`이나 배포 환경에 넣지 않는다. 두 환경 파일 모두 Git에서 제외된다.

## 3. 적용과 확인

```powershell
npm run db:migrate
npm run db:check-schema
npm test
npm run typecheck
npm run dev
```

마이그레이션은 업무 테이블을 외부 Data API에 노출되지 않는 `app`·`app_private` schema에 만들고, 제한된 `app_backend` 권한과 RLS를 설정한 뒤 다섯 주제 템플릿을 저장한다. 완료 후 `http://localhost:3001/api/v1/status`의 `configured`가 `true`인지 확인한다. 기존 `npm run dev`가 실행 중이었다면 환경 파일을 읽도록 서버를 재시작한다.

브라우저에서 회원가입 → 교사로 Google 회원가입 → 지도 만들기 → ‘더보기’의 새 초대 코드 생성 → 다른 브라우저 프로필 또는 다른 기기에서 초대 링크 열기 → 닉네임 입장을 차례로 확인한다. 학생으로 Google 회원가입은 학생 유형이 저장되고 지도 만들기 권한이 없는지 확인한다. 기존 계정은 가입 버튼을 다시 눌러도 유형이 바뀌지 않는다. 다른 기기를 쓸 때 `localhost`는 그 기기 자신을 가리키므로 HTTPS 테스트 도메인 또는 안전한 개발 터널과 해당 `APP_ORIGIN`·OAuth 허용 URL이 필요하다.

운영 배포에서는 신뢰하는 프록시가 클라이언트가 보낸 값을 제거한 뒤 설정하는 IP 헤더명을 `TRUSTED_CLIENT_IP_HEADER`에 지정한다. 이 값이 없으면 운영 환경의 초대 입장 API는 503으로 닫힌다. DB 연결은 TLS를 요구하고, 운영 전에는 Supabase DB 인증서를 사용한 호스트 검증도 설정한다. [Supabase 연결 보안](https://supabase.com/docs/guides/database/connecting-to-postgres)

## 학생 일반 이메일 가입

학생은 `/account/register`에서 일반 이메일과 8~128자 비밀번호를 입력하고, 확인 메일의 링크를 누른 다음 `/account/login`에서 로그인한다. Google 가입·로그인과 초대 코드·닉네임 참여도 유지한다.

1. Supabase Authentication의 Email 제공자를 활성화하고 **Confirm email**을 켠다. 확인 메일을 받기 전에는 앱 로그인 세션을 발급하지 않는다.
2. Supabase Authentication의 이메일 SMTP 설정에 발송 서비스의 host·port·username·password와 인증된 발신 주소를 입력한다. 비밀값은 앱 코드나 채팅에 넣지 않는다. Supabase 기본 SMTP는 프로젝트 조직 구성원 주소만 대상으로 하므로 일반 학생 주소에는 **custom SMTP**가 필요하다. [SMTP 설정 안내](https://supabase.com/docs/guides/auth/auth-smtp)
3. 기존 Redirect URLs의 `/api/v1/auth/callback**` 패턴은 이메일 확인에도 사용한다. 확인 링크의 `email_confirm=1` 콜백은 로그인 화면으로 보내며, 비밀번호로 다시 로그인해야 한다. 이메일 템플릿의 확인 링크는 Supabase의 기본 `ConfirmationURL`을 유지한다.
4. 본인이 관리하는 시험 이메일에서 가입 → 확인 메일 → 로그인 → 로그아웃 → 재로그인을 확인한다. 만료된 메일은 로그인 화면에서 다시 요청할 수 있다. 여러 학생이 동시에 가입할 때는 발송 서비스와 Supabase 이메일 발송 제한도 조정한다.

SMTP 설정을 확인할 수 없거나 일반 학생 주소로 확인 메일을 시험하지 않았다면 메일 전달까지 검증됐다고 보고하지 않는다. 메일 발송 문제를 우회하기 위해 이메일 확인을 끄지 않는다. [비밀번호 인증 안내](https://supabase.com/docs/guides/auth/passwords)
