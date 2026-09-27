# 4단계 진행 검토 — 카카오맵과 현장 기록

작성일: 2026-09-28

## 구현한 내용

- 카카오 지도 SDK를 불러오는 모바일 지도 컴포넌트. 키가 없거나 로드에 실패하면 설정 안내를 표시한다. 실제 지도에서 장소 검색, 현재 위치(GPS), 지도 탭으로 좌표를 고른다. GPS 거부 시 검색·수동 지정을 계속 사용할 수 있다.
- 주제의 이모지와 핀 모드에 따라 마커를 표시한다. 기록이 20개를 넘으면 카카오 MarkerClusterer로 군집화한다. 평가 3색은 해당 평가 핀 모드의 지도에만 적용된다.
- 관찰 기록 생성·목록·작성자 수정 API와 DB 마이그레이션. 서버에서 주제별 분류·이모지·평가·질문 답변·좌표·링크·참여 권한을 검사한다. 공개 기록은 지도 독자가, 검수 대기 기록은 작성자와 지도 관리자가 볼 수 있다.
- 생성 시 `Idempotency-Key`, 수정 시 `If-Match`를 검사한다. 화면에서도 저장 중 두 번 제출을 막고 네트워크 재시도에 같은 요청 키를 사용한다.
- 사진 한 장을 최대 10MB까지 업로드한다. 서버가 방향을 바로잡고 최대 1600px WebP로 재인코딩하므로 원본 EXIF 위치정보는 배포되지 않는다. 서버 DB에 최대 2MB 결과물을 저장하고 읽기 권한을 검사한다. 업로드 실패 시 기록은 유지되며 화면에서 사진만 다시 시도할 수 있다.
- `002_observations.sql`을 실제 Supabase DB에 적용했다. 기존 지도·회원 자료는 그대로 유지했다.

## 검증

- `npm run typecheck`, `npm run build` 통과.
- `RUN_LIVE_PHASE4=1 node scripts/check-live-phase4.mjs` 통과. 합성 계정과 지도 2개로 평가 미사용 지도, 타 지도 이모지 거부, 동일 요청 재시도, 지도 간 기록·사진 격리, 검수 대기 기록·사진의 익명 접근 차단, 수정 버전 충돌, 사진 WebP 변환을 확인하고 합성 자료를 삭제했다.
- `http://localhost:3001`의 실제 지도 화면을 확인했다. 현재 카카오 키가 없으므로 설정 안내가 표시되며 지도 타일·검색·GPS·마커는 아직 실사용 검증을 하지 못했다.
- 코드를 [GitHub 저장소](https://github.com/inkun00/ai_town_map)에 커밋·푸시하고 [Vercel 운영 주소](https://ai-town-map.vercel.app)에 배포했다. 운영 `/api/v1/status`가 `configured: true`를 반환하고, 주제·공개 지도 API가 실제 Supabase DB에서 응답하는 것을 확인했다. Vercel `DATABASE_URL`은 `app_backend.<project-ref>` 계정의 transaction pooler 연결을 별도로 검증해 사용한다.

## 완료 전 필요한 설정과 확인

1. 카카오 Developers의 ‘우리마을지도’ 앱은 현재 지도 기능이 꺼져 있다. 이 앱에서 켜려면 월렛 연결과 사용량 요금제가 필요하다는 안내가 나왔다. 이미 무료 쿼터로 사용 중인 ‘생태지도’ 앱의 키·쿼터를 공유할지 사용자 답변을 기다린다. 선택한 앱의 JavaScript SDK 도메인에 `http://localhost:3001`과 `https://ai-town-map.vercel.app`을 등록하고 로컬·Vercel에 해당 JavaScript 키를 설정한다.
2. Supabase Auth Redirect URLs에 `https://ai-town-map.vercel.app/api/v1/auth/callback`을 추가하고 운영 Google 로그인을 확인한다.
3. Vercel 프로젝트 소유 계정에서 GitHub `inkun00` 연결을 완료한다. CLI 수동 배포는 성공했으나 `vercel git connect`는 Vercel 계정의 GitHub Login Connection이 없어 실패했다.
4. 두 브라우저에서 지도 타일, 장소 검색, GPS 허용/거부 대안, 이모지 마커, 군집, 모바일 터치 선택을 확인한다. 실제 Google 계정·초대 게스트 각 1명으로 기록 등록·검수 대기·수정·사진 표시도 확인한다.

## 다음 단계 경계

댓글, 검수 승인·숨김, 통계 API, 제안서 영구 저장은 각각 5·6단계 범위다. 현재 분석·제안 탭은 임시 UI이며 실집계나 영구 저장으로 간주하지 않는다. 제품 API 계약의 다중 사진·초안/제출 분리·첨부 작업 큐도 이번 구현에는 포함되지 않았다. 사진은 MVP에서 단일 WebP를 DB에 저장하며 사용량이 늘기 전에 private object storage와 작업 큐로 옮겨야 한다.
