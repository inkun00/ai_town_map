# 1단계 API 계약 v1

상태: 전체 제품 API 계약. 3단계 인증·지도·초대와 4단계의 간소화된 관찰 기록·사진 경로가 구현됐다. 관찰 기록 구현은 생성 시 완전한 JSON을 한 번에 제출하고 사진은 별도 POST로 첨부한다. 아래 초안/제출 분리·다중 첨부 계약은 후속 구현 목표다. JSON 필드명은 camelCase, DB는 snake_case. 모든 경로는 별도 표기 외 `/api/v1` 기준이다.

## 1. 공통 규칙

- 같은 출처 HTTPS. 인증은 HttpOnly 앱 세션 쿠키이며 클라이언트가 actor ID·role을 보내지 않는다.
- JSON 성공: `{ "data": ..., "meta": { "requestId": "..." } }`. 목록은 `data.items`, `data.nextCursor`. 파일 응답·302·204는 예외.
- 실패: `{ "error": { "code": "...", "message": "...", "fields": [{"path":"title","code":"too_short"}] }, "meta": {"requestId":"..."} }`.
- 알 수 없는 쓰기 필드는 422. 최대 JSON 본문 256KB. 첨부는 별도 업로드. 문자열·URL·좌표 제한은 DATA_MODEL 및 PRD를 따른다.
- 로그인/입장 이후 변경 API는 `X-CSRF-Token`과 Origin 검사. 로그인 시작/초대 입장은 same-origin JSON, OAuth callback은 PKCE·상관관계 검사로 별도 처리한다.
- 기존 루트 변경은 `If-Match: "<version>"` 필수(미전달 428, 불일치 412). 지도 설정 revision 불일치는 `409 CONFIG_CHANGED`.
- 세션이 있는 POST 개설·draft 생성·제출·댓글·제안 생성·검수 명령·export 요청에는 `Idempotency-Key` UUID를 요구한다. 24시간 내 같은 body 재시도는 동일 결과, 다른 body면 `409 IDEMPOTENCY_CONFLICT`. 로그인과 최초 게스트 입장은 예외이며 아래 입장 재시도 규칙을 따른다.
- 201은 신규 생성, 200은 조회·수정·상태 전이 및 이미 완료된 제출 재시도, 202는 작업 접수, 204는 logout/폐기 성공. pending은 실패가 아니라 성공 응답의 상태다.
- 권한에 따른 401/403/404는 PERMISSIONS의 규칙을 따른다. 413 본문·파일 초과, 415 지원하지 않는 파일, 422 입력/기능 미사용, 429 요청 제한, 503 외부 서비스 장애. 429는 Retry-After 포함.
- 주요 업무 오류: `INVITE_INVALID`(만료·폐기·잘못된 코드 통합), `INVITE_EXHAUSTED`, `MEMBERSHIP_BLOCKED`, `FEATURE_DISABLED`, `MAP_CLOSED`, `THEME_LOCKED`, `CONFIG_CHANGED`, `INVALID_EMOJI`, `RATING_NOT_ALLOWED`, `ATTACHMENT_NOT_READY`, `EVIDENCE_CHANGED`.

## 2. 인증·지도 생성·참여

| 메서드·경로 | 입력 | 결과·권한 |
|---|---|---|
| GET `/auth/google` | 허용 상대 returnTo | Google 로그인 리다이렉트, 로그인 요청 상관정보 생성 |
| GET `/auth/callback` | 공급자 code·상관정보 | 검증 후 앱 세션 발급, 허용 경로로 302 |
| GET `/session` | 없음 | principal kind, 만료 시각, csrfToken. 비로그인은 data=null |
| DELETE `/session` | CSRF | 토큰 폐기·쿠키 제거, 204 |
| GET `/themes` | 없음 | 게시된 주제 key·version·이름·기본 기능·이모지 예시 |
| GET `/themes/{key}/versions/{version}` | 없음 | 불변 template definition |
| GET `/maps` | scope=public/mine, q?, themeKey?, cursor?, limit? | public active 또는 본인의 active membership 지도. mine은 세션 필요 |
| POST `/maps` | 아래 CreateMap | active account만, 201 Map + configuration |
| GET `/maps/{mapId}` | 없음 | 읽기 권한, MapSummary + capabilities |
| GET `/maps/{mapId}/configuration` | 없음 | 읽기 권한, configRevision·features·pin·categories·emojis·rating·questions |
| PATCH `/maps/{mapId}` | title?, description?, visibility?, participation?, moderation?, status? | If-Match. 공개·참여·status는 owner, 일반 소개·검수 설정은 admin도 가능 |
| PUT `/maps/{mapId}/configuration` | 전체 설정 + configRevision | admin/owner, If-Match. 주제 잠금·불변 항목 검증 |
| GET `/maps/{mapId}/publication-preview` | 없음 | owner. 공개 시 노출할 게시 기록·사진·제안 수, 민감 항목 점검 안내 |
| DELETE `/maps/{mapId}` | 없음 | owner, If-Match, soft delete |
| POST `/maps/{mapId}/restore` | 없음 | owner, If-Match, 복구 기간 내 이전 상태로 복구 |
| POST `/maps/{mapId}/invites` | expiresAt?, maxUses | admin/owner, 원문 code·join URL·만료를 한 번 반환 |
| GET `/maps/{mapId}/invites` | 없음 | admin/owner, ID·만료·uses만, 원문 없음 |
| DELETE `/maps/{mapId}/invites/{inviteId}` | 없음 | admin/owner, 신규 입장만 중단 |
| POST `/invites/redeem` | code, nickname | 회원이 없으면 guest 생성, session·membership·mapId 반환. raw session은 cookie에만 |
| GET `/maps/{mapId}/members` | cursor?, limit? | admin/owner만. 일반 화면은 기록에 붙은 닉네임만 제공 |
| PATCH `/maps/{mapId}/members/{memberId}` | nickname? 또는 status? 또는 role? | 본인 nickname, admin은 participant 차단, owner만 admin 지정. If-Match용 membership version 사용 |

```json
{
  "themeKey": "ecology",
  "themeVersion": 1,
  "title": "우리 동네 생태 관찰",
  "description": "공원 주변 생물을 함께 기록합니다.",
  "activityContext": "school",
  "center": {"lat": 35.9677, "lng": 126.7369},
  "initialZoom": 5,
  "visibility": "invite_only",
  "participation": "invited",
  "moderation": "approval",
  "configurationOverrides": {"proposalsEnabled": false}
}
```

CreateMap은 저장된 템플릿 version을 복사한다. 직접 만들기에는 완전한 categories/emojiOptions/questions/pin/features 설정을 함께 보낸다. 요청에 UUID를 임의 지정하지 않고 템플릿 key를 서버가 실제 지도별 ID로 바꾼다. owner는 세션에서 결정한다. 생성 마법사의 미완성 내용은 로컬 초안이며 POST 성공 때 active 지도가 된다.

3단계 구현 입력은 위 제품 계약의 일부다. `center`는 4단계 위치 선택 전까지 `null`을 허용하고, 제안서 활성화는 `proposalsEnabled`, 직접 만들기는 `custom: { categories, pinMode }`로 전달한다. 현재 `GET /maps`의 응답은 `data: { items, nextCursor }`이며, 편집·삭제·회원 관리와 관찰 기록 경로는 아직 구현되지 않았다.

`capabilities`는 `canCreateObservation`, `canModerate`, `canManageMap`, `canCreateProposal`, `canComment` 등 UI용 boolean이다. API 서버는 이를 클라이언트로부터 다시 받지 않고 매번 권한을 계산한다.

입장 재시도 시 유효한 기존 세션·membership이 있으면 그 참여자를 반환하고 초대 uses를 늘리지 않는다. 최초 응답과 쿠키를 모두 받지 못했다면 같은 닉네임만으로 기존 guest를 되찾지 않는다. 다시 입장하면 새 identity가 생길 수 있으며, 초대 한도가 소진된 경우 관리자에게 재발급을 요청한다. 이 한계는 작성자 도용 방지를 위한 MVP 복구 범위다.

## 3. 기록 작성·제출·검수

| 메서드·경로 | 입력 | 결과·권한 |
|---|---|---|
| POST `/maps/{mapId}/observations` | configRevision, 선택적 초안 필드 | 작성 가능 멤버, draft 생성. ID·version 반환 |
| PATCH `/maps/{mapId}/observations/{id}` | configRevision + 변경할 관찰 필드 | 본인 draft/pending/published, If-Match. published 수정은 검수 정책 적용 |
| POST `/maps/{mapId}/observations/{id}/submit` | configRevision | 본인 draft, If-Match, 완전성 검사 후 pending/published |
| GET `/maps/{mapId}/observations/{id}` | 없음 | 읽기 권한에 맞는 기록 DTO·첨부 ID·이모지·평가·질문 응답 |
| DELETE `/maps/{mapId}/observations/{id}` | 없음 | 본인 또는 admin, If-Match, soft delete |
| POST `/maps/{mapId}/observations/{id}/moderation` | action=approve/hide/restore/request_changes, reason? | admin, If-Match. hide/request_changes는 reason 필수 |

초안 작성과 포인트 제출은 구분한다. 첫 제출 전에는 theme lock이 걸리지 않는다. 관리자 검수 상태는 참여자가 PATCH로 직접 바꿀 수 없다. 제출 재시도는 이미 결정된 상태와 같은 ID를 반환한다.

관찰 PATCH 필드:

```json
{
  "configRevision": 1,
  "title": "공원 입구의 나무",
  "body": "공원 입구에서 잎이 넓은 나무를 관찰했습니다.",
  "location": {"lat": 35.9677, "lng": 126.7369},
  "locationLabel": "공원 입구",
  "locationSource": "manual",
  "accuracyMeters": null,
  "observedAt": "2026-09-27T01:00:00Z",
  "categoryId": "<해당 지도 식물 분류 UUID>",
  "emojiOptionId": "<해당 분류 🌳 이모지 UUID>",
  "ratingOptionId": null,
  "answers": [
    {"questionVersionId": "<생물명 질문 버전 UUID>", "state": "answered", "value": "이름을 모르는 나무"}
  ],
  "links": []
}
```

위 UUID 자리표시는 설명용이다. 실제 API는 UUID 형식을 검증한다. 생태 기본형에서 ratingOptionId=null은 정상이며 임의 편의 평가 ID는 422다. emojiOptionId가 비어 있으면 서버는 선택 분류의 활성 기본 이모지를 확정해 저장한다. draft에서는 category 미선택이 가능하지만 제출 시에는 이모지가 반드시 존재해야 한다.

`answers`를 보내면 현재 활성 질문에 대한 응답 집합으로 처리하고 비활성 과거 응답은 보존한다. 변경하지 않을 때는 필드를 생략한다. `links`는 요청 배열로 교체한다. 서버는 질문별 타입·허용 선택지·unknown/NA를 검사한다.

## 4. 목록·핀·집계의 공통 필터

| 필드 | 의미 |
|---|---|
| q | 제목·본문 검색, 최대 100자 |
| categoryIds | 같은 지도 분류 ID 배열 |
| ratingOptionIds | 종합평가 사용 시만 허용 |
| observedFrom / observedTo | ISO 시각, [from,to) 범위. UI의 날짜 종료는 다음 날 00:00으로 변환 |
| bbox | [west,south,east,north]. 없으면 지도 전체. MVP는 날짜변경선 교차 미지원 |
| answers | 최대 10개 `{questionVersionId,state?,optionKeys?}`. boolean은 value 사용. text는 차트 필터 미지원 |
| scope | published(기본)/mine/moderation. 기본 통계는 published만 |

GET에는 `filter=<URL-encoded JSON>` 하나로 전달한다. 최대 8KB. 필터는 키·배열 정렬 후 정규화하여 fingerprint를 계산한다. 비활성 평가 필터를 무시하지 않고 422로 알린다.

| 경로 | 추가 입력 | 응답 |
|---|---|---|
| GET `/maps/{mapId}/observations` | filter, limit=30(최대100), cursor? | items, nextCursor, totalCount, filterFingerprint, dataRevision |
| GET `/maps/{mapId}/points` | filter, zoom | mode=points/clusters, items, totalCount, dataRevision, filterFingerprint |
| GET `/maps/{mapId}/stats` | filter(scope=published만) | total, byCategory, byRating 또는 null, questions, observedRange, dataRevision, filterFingerprint |

목록 정렬은 observedAt DESC,id DESC(초안이 있는 mine scope는 createdAt 사용). cursor는 정렬값·map·filter fingerprint·dataRevision을 담은 변조 방지 토큰이며 다른 필터에 사용하면 400, revision이 바뀌면 `409 RESULT_CHANGED`로 첫 페이지부터 갱신한다. 반환 수가 totalCount와 같아야 한다고 가정하지 않는다.

핀 결과가 500개 초과면 DB가 전체 필터 결과를 격자로 묶는다. cluster item은 `clusterKey, center, bounds, count, byCategory, byRating`을 반환한다. rating 미사용이면 byRating=null. 군집 상세는 bounds로 다시 조회하되 같은 좌표가 겹치면 목록 페이지네이션으로 모든 기록에 접근한다.

통계 응답 예시(생태):

```json
{
  "data": {
    "total": 3,
    "byCategory": [{"categoryId":"<식물 UUID>","count":2},{"categoryId":"<새 UUID>","count":1}],
    "byRating": null,
    "questions": [],
    "dataRevision": 7,
    "filterFingerprint": "<정규화 필터 해시>"
  },
  "meta": {"requestId":"<요청 ID>"}
}
```

질문 통계는 `{questionVersionId, answeredCount, unknownCount, notApplicableCount, missingCount, options:[{key,count,percent}]}`. percent 분모는 answeredCount. 다중 선택은 비율 합이 100%를 넘을 수 있음을 표시한다. 0 분모는 percent=null. 질문 의미가 다른 버전은 별도 집계한다.

## 5. 사진

| 메서드·경로 | 입력 | 결과 |
|---|---|---|
| POST `/maps/{mapId}/observations/{id}/attachments` | filename, mimeType, byteSize, description | 본인 기록, 업로드 예약. attachmentId, uploadUrl, expiresAt |
| POST `/attachments/{id}/complete` | 없음 | 실제 객체 확인 후 처리 작업 접수, 202 |
| GET `/attachments/{id}` | 없음 | 부모 기록 권한 내 status·description·크기. 저장소 key 미노출 |
| PATCH `/attachments/{id}` | description?, sortOrder? | 작성자, 부모 If-Match. 게시 기록은 관찰 수정과 같은 재검수 적용 |
| DELETE `/attachments/{id}` | 없음 | 작성자 또는 관리자, 부모 If-Match. 즉시 읽기 차단·정리 작업 |
| GET `/attachments/{id}/content` | variant=thumb/display | 현재 권한 검사 후 파일 스트림, private/no-store |

초기 업로드 URL 유효시간은 10분, 첨부 수는 reserved도 포함해 5개를 넘지 않게 잠금 안에서 계산한다. 사진 ready 이전에는 content가 409 ATTACHMENT_NOT_READY. 이미지 유형 위장·디코딩 실패는 failed와 안전한 오류 코드로 처리한다. private content에 외부 CDN URL을 반환하지 않는다.

게시 기록에 사진을 추가할 때도 업로드 예약 트랜잭션에서 부모를 approval 지도면 pending으로 전환하고 version을 증가시킨다. 부모가 hidden/deleted/archived이면 일반 사진 변경을 거부한다. 소유자라도 타인 사진을 새로 업로드하지 않는다.

## 6. 댓글·신고·제안서·내보내기

| 메서드·경로 | 주요 입력 | 응답·권한 |
|---|---|---|
| GET `/maps/{mapId}/observations/{id}/comments` | cursor?, limit? | 읽기 가능한 visible 댓글 |
| POST 같은 경로 | body | active 멤버, commentsEnabled, published 부모 |
| PATCH `/maps/{mapId}/comments/{id}` | body | 본인, If-Match |
| DELETE 같은 경로 | 없음 | 본인 또는 admin, If-Match |
| POST `/maps/{mapId}/comments/{id}/moderation` | action=hide/restore, reason | admin, If-Match |
| POST `/maps/{mapId}/reports` | targetType, targetId, reasonCode, detail? | 읽기 가능한 대상, active 멤버 |
| GET `/maps/{mapId}/reports` | status?, cursor? | admin |
| PATCH `/maps/{mapId}/reports/{id}` | status=resolved/dismissed, reason | admin, If-Match |
| GET `/maps/{mapId}/proposals` | scope=published/mine/review/archive | 역할에 맞는 목록. archive는 admin만 |
| POST `/maps/{mapId}/proposals` | title?, problem?, solution?, expectedEffect?, responsibleParty?, followUp? | active 멤버, proposalsEnabled. draft 생성 |
| GET `/maps/{mapId}/proposals/{id}` | version? | 권한에 맞는 버전, 근거별 accessible/changed/deleted 상태 |
| PATCH 같은 경로 | 본문 필드, evidenceIds?, evidenceFilter? | 본인 draft, If-Match. 확정본 수정은 새 draft version 생성 |
| POST `/maps/{mapId}/proposals/{id}/submit` | 없음 | 본인, If-Match, 필수 본문·근거 검증 후 in_review |
| POST `/maps/{mapId}/proposals/{id}/review` | action=approve/request_changes, reason? | admin, If-Match, 근거 버전·접근성 재확인 |
| POST `/maps/{mapId}/proposals/{id}/unpublish` | reason | admin, If-Match. published pointer 해제 |
| DELETE `/maps/{mapId}/proposals/{id}` | 없음 | 본인 또는 admin, If-Match, soft delete |
| POST `/maps/{mapId}/exports` | filter, includeAuthor=false, includeCoordinates=false | admin, 202. CSV 작업 ID·상태 |
| GET `/maps/{mapId}/exports/{id}` | 없음 | admin, 작업 상태·만료 |
| GET `/maps/{mapId}/exports/{id}/content` | 없음 | admin 재검사, CSV 스트림, private/no-store |

댓글 정렬은 createdAt ASC,id ASC. 일반 목록 cursor 공통 규칙을 적용한다. 제안서 공유·인쇄는 `/maps/{mapId}/proposals/{id}` 웹 경로에서 동일 조회 정책을 사용하며 별도 익명 공개 토큰을 만들지 않는다.

export는 처음에 published 필터만 지원한다. 승인 상태는 published임을 명시하고 질문 버전·관찰 시각을 포함한다. 정밀 좌표·작성자 닉네임은 각각 명시적으로 선택한 경우만 포함하고 principal/auth ID는 출력하지 않는다. 셀 수식 주입 방지·UTF-8·따옴표 escaping을 적용한다. 결과 유효기간 24시간, 다운로드 시 현재 dataRevision이 생성 때와 다르면 재생성을 요구해 숨김·삭제된 자료가 옛 파일에서 새로 노출되지 않게 한다.

## 7. 동시성·오류 처리 예시

- 지도 설정이 revision 3으로 바뀐 뒤 revision 2 초안을 제출: `409 CONFIG_CHANGED`, 최신 revision만 전달, 사용자 입력은 브라우저에서 보존.
- A 지도 식물에 B 지도 나무 이모지 사용: `422 INVALID_EMOJI`, 다른 지도 내용은 오류 메시지로 누출하지 않음.
- 사진 complete 응답 유실: 같은 attachment ID로 재호출해 기존 job 상태 반환, 중복 파생 파일 생성 방지.
- 저장 응답 유실 후 submit 재시도: 동일 Idempotency-Key로 같은 기록 반환. 이미 삭제·접근 회수됐다면 현재 권한에 따라 404/403.
- 게시 기록 수정 경합: If-Match 불일치 412, 서버가 임의로 마지막 쓰기를 덮어쓰지 않음.
- 지도 SDK 실패: 목록·기록 조회 API는 사용 가능. 위치가 없는 draft는 submit 불가지만 저장 가능.

구현 전 OpenAPI를 생성할 때 이 계약의 조건부 기능 검사와 권한 표를 설명으로 유지하고, JSON Schema만으로 표현되지 않는 지도 간 참조·상태·동시성 검사를 서버 테스트로 추가한다.
