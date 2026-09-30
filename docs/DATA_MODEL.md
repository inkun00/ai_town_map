# 1단계 데이터 스키마

상태: PostgreSQL 논리·제약 설계. 실제 migration과 DB 검증은 3단계에서 작성·실행한다.

## 1. 공통 규칙

- PK는 UUID, 시각은 `timestamptz` UTC, 화면은 사용자 시간대로 표시한다. 문자열 길이는 Unicode code point 기준이며 이모지를 길이 1로 제한하지 않는다.
- `?`는 nullable, `jsonb`는 버전 있는 정의나 타입 검증된 데이터에 한해 사용한다. 무제한 사용자 JSON 저장소로 쓰지 않는다.
- 모든 지도 하위 테이블에 `map_id`를 두며 참조는 `(map_id, id)` 복합 외래키로 지도 간 연결을 차단한다. UUID가 유일해도 이 검사를 생략하지 않는다.
- 편집 가능한 루트에는 `version bigint default 1`을 두고 조건부 갱신한다. 자식 편집은 부모 version 증가와 하나의 트랜잭션으로 처리한다.
- soft delete는 `deleted_at`, `deleted_by`로 기록한다. 삭제 후 30일이 지나면 DB 예약 작업이 지도·기록·사진과 종속 자료를 영구 정리한다. [운영 보관 검토](STAGE8_RETENTION_REVIEW.md) 참조.

## 2. 계정·세션·지도

| 테이블 | 주요 열 | 제약 |
|---|---|---|
| `principals` | id, kind(account/guest), auth_user_id?, status(active/blocked/deleted), created_at | account만 auth_user_id 필수·UNIQUE. guest는 null. 계정 이메일을 공개 업무 테이블에 복제하지 않음 |
| `app_private.sessions` | id, principal_id, token_hash, csrf_hash, expires_at, revoked_at?, created_at | token_hash UNIQUE, 원문 토큰 미저장, 만료·차단 확인 필수 |
| `theme_templates` | id, theme_key, version, definition jsonb, published_at | UNIQUE(theme_key,version), 게시 후 수정 금지 |
| `maps` | id, owner_principal_id, template_id, title, description, activity_context(school/community), center_lat/lng, initial_zoom, bounds?, visibility(public/invite_only), participation(invited/admin_only/closed), moderation(immediate/approval), status(draft/active/archived/deleted), pin_mode(rating/category/single), single_color?, rating_enabled, ideas_enabled, proposals_enabled, comments_enabled, theme_locked_at?, config_revision, data_revision, version, deleted_at/by | owner는 active account만 가능. rating pin은 rating_enabled 필수. single 모드 색상 필수. 범위 min<max·좌표 유효성 검사 |
| `map_members` | id, map_id, principal_id, nickname, role(admin/participant), status(active/blocked/left), version, joined_at | UNIQUE(map_id,principal_id), 닉네임은 2~20자, 동일 닉네임 허용. 소유자는 maps.owner_principal_id로 단일 결정 |
| `app_private.invites` | id, map_id, code_hmac, expires_at, revoked_at?, max_uses, uses, created_by, created_at | code_hmac UNIQUE. 난수 Crockford Base32 12자·256bit 서버 pepper로 HMAC. uses 0..max_uses. role은 항상 participant |

소유자도 지도별 닉네임을 위해 active membership을 가진다. 소유권 위임은 MVP에서 제공하지 않는다. 관리자는 Google 계정 principal에게만 부여한다. 관련 계정 조건은 단순 CHECK가 다른 행을 읽을 수 없으므로 트랜잭션 서비스와 DB constraint trigger로 강제한다.

초대 원문은 생성 성공 응답에 한 번 반환한다. 이후 재조회·로그에 원문을 제공하지 않고 필요하면 재발급한다. 복구 불가능한 코드 원문 대신 HMAC 비교를 사용한다. 회원가입 없는 방문자는 principal이 없다.

## 3. 지도별 분류·이모지·평가·질문

| 테이블 | 주요 열 | 제약 |
|---|---|---|
| `categories` | id, map_id, key, label, color?, default_emoji_id, sort_order, active | UNIQUE(map_id,key), UNIQUE(map_id,id), 활성 분류 1~12개 |
| `emoji_options` | id, map_id, category_id, glyph, label, sort_order, active | UNIQUE(map_id,category_id,id), category 복합 FK. glyph·label은 사용 후 불변 |
| `rating_schemes` | id, map_id, label, version | 지도당 현재 scheme 최대 1개, UNIQUE(map_id,id) |
| `rating_options` | id, map_id, scheme_id, key, label, color, symbol, ordinal | UNIQUE(scheme_id,key), UNIQUE(scheme_id,ordinal), scheme 복합 FK |
| `questions` | id, map_id, key, current_version_id, active, sort_order | UNIQUE(map_id,key), 활성 질문 최대 10개 |
| `question_versions` | id, map_id, question_id, version, label, emoji?, help_text?, type(rating3/boolean/single/multi/text), required, allow_unknown, allow_na, options jsonb, max_length? | UNIQUE(question_id,version), 불변. 선택지는 안정적인 key·label, 중복 key 금지 |
| `map_config_revisions` | map_id, revision, definition jsonb, created_by, created_at | PK(map_id,revision), 불변. 해당 시점에 활성인 질문 버전·분류·이모지·기능의 ID 목록 포함 |

`categories.default_emoji_id`는 `(map_id,id,default_emoji_id)` → `emoji_options(map_id,category_id,id)`의 지연 검사 FK로 연결한다. 지도 생성 트랜잭션에서 분류·이모지를 모두 삽입한 후 commit 시 검사한다. 현재 활성 분류의 default는 활성 emoji여야 한다. 비활성 이모지를 기존 기록이 참조하는 것은 허용한다.

종합평가가 꺼져 있으면 scheme을 두지 않는다. 켜진 경우 3개 option을 요구한다(직접 만들기도 MVP는 3단계). 종합평가는 `rating_options`, 세부 평가항목은 `question_versions`로 분리한다. 유니버설 디자인의 종합 3색과 개별 소리 안내 있음/없음 응답을 같은 필드로 합치지 않는다.

## 4. 관찰과 첨부

| 테이블 | 주요 열 | 제약 |
|---|---|---|
| `observations` | id, map_id, author_member_id, title, body, location geometry(Point,4326)?, location_label?, location_source(gps/search/manual)?, accuracy_m?, observed_at?, category_id?, emoji_option_id?, rating_option_id?, improvement_idea?, config_revision, status(draft/pending/published/hidden/deleted), submitted_at?, published_at?, hidden_reason?, version, created_at, updated_at, deleted_at/by | draft만 미완성 허용. 제출 상태는 위치·제목·본문·분류·이모지·관찰시각 필수. emoji는 같은 map·category에 속해야 함 |
| `observation_answers` | map_id, observation_id, question_version_id, answer_state(answered/unknown/not_applicable), value jsonb? | PK(observation_id,question_version_id), 모두 같은 map. unknown/NA는 value=null |
| `attachments` | id, map_id, observation_id, uploaded_by, object_key?, original_ticket_key?, mime?, byte_size?, width?, height?, description, sort_order, status(reserved/uploaded/processing/ready/failed/deleted), expires_at?, failure_code?, deleted_at | object key UNIQUE·난수, 최대 5장·장당 원본 10MB. private만 허용 |
| `observation_links` | id, map_id, observation_id, title, url, sort_order | 최대 3개, HTTP(S)만. 자격증명 포함 URL 금지 |
| `jobs` | id, map_id?, kind(process_photo/cleanup/export/purge), resource_id, state(queued/running/succeeded/failed), attempts, available_at, lease_until?, last_error_code? | 중복 실행에 안전한 작업, lease 만료 재처리 가능. 비밀·원문 사진을 payload에 넣지 않음 |

좌표는 EPSG:4326, DB 함수 `ST_SetSRID(ST_MakePoint(lng,lat),4326)`. lat -90..90, lng -180..180. 제목 2~60자, 본문 10~2,000자, 아이디어 최대 1,000자. draft에는 이 필수 길이 조건을 지연하되 최대 길이는 항상 검사한다.

제출 검사에서 rating_enabled=true이면 같은 지도 scheme의 option이 필수, false이면 null 필수다. 비활성 기능 필드는 신규 입력을 거부한다. 이전 기록에 보관된 비활성 아이디어·질문 응답은 관리자 보관 조회에서만 유지할 수 있으며 일반 응답에서 제외한다.

질문 응답 타입: boolean은 JSON boolean, single/rating3는 option key 문자열, multi는 중복 없는 option key 배열, text는 문자열. `required`는 answered/unknown/not_applicable 중 허용된 명시적 상태를 요구한다. 생략은 미응답이며 unknown으로 자동 보정하지 않는다. 필수 질문이라도 해당 질문에서 허용한 unknown/NA를 선택할 수 있다.

게시 기록 수정 시 현재 활성 필수 질문을 다시 검사하고 최신 config revision으로 저장한다. 비활성 과거 답변은 별도 보관되며 새 요청의 전체 교체 때문에 삭제되지 않는다. 현재 분석에서는 활성 질문 및 비교 가능한 버전의 응답만 사용한다.

## 5. 댓글·제안서·운영

| 테이블 | 주요 열 | 제약 |
|---|---|---|
| `comments` | id, map_id, observation_id, author_member_id, body, status(visible/hidden/deleted), version, created_at, updated_at, deleted_at/by | 1~500자, 부모 기록이 published일 때만 작성 |
| `proposals` | id, map_id, author_member_id, current_version_id, published_version_id?, status(draft/in_review/published/archived/deleted), version, created_at, updated_at, deleted_at/by | 제안 기능 활성 시 작성·조회, 꺼지면 관리자 보관 조회만 |
| `proposal_versions` | id, map_id, proposal_id, version, title, problem, solution, expected_effect, responsible_party?, follow_up?, status(draft/in_review/approved), created_by, approved_by?, approved_at? | UNIQUE(proposal_id,version), approved 후 불변. 새 수정은 새 version |
| `proposal_evidence` | id, map_id, proposal_version_id, observation_id, observation_version, filter_snapshot jsonb, aggregate_snapshot jsonb, captured_at | 포인트·제안 모두 같은 지도. 원본 본문·사진·닉네임 복제 금지 |
| `reports` | id, map_id, reporter_member_id, observation_id?, comment_id?, reason_code, detail?, status(open/resolved/dismissed), version, handled_by?, handled_at | 대상은 정확히 하나, 같은 map 검증 |
| `audit_logs` | id, map_id?, actor_principal_id, action, resource_type, resource_id, changed_fields jsonb, reason?, created_at | append-only, 본문·사진·초대 원문·세션 토큰·정밀 좌표 복제 금지 |
| `app_private.idempotency_keys` | principal_id, route_scope, key, request_hash, resource_id?, response_code?, completed_at?, expires_at | PK(principal_id,route_scope,key), 다른 body로 재사용하면 충돌 |
| `exports` | id, map_id, requested_by, filters jsonb, include_author, include_coordinates, state, object_key?, expires_at, created_at | 관리자만 요청·열람. 다운로드마다 권한 재확인 |

제안서 길이 기본값: 제목 2~100자, 문제·해결안 각각 10~5,000자, 기대효과·주체·후속계획 각 최대 2,000자. 제목·문제·해결안·기대효과는 검토 요청 시 필수이며 초안은 미완성 허용한다. 근거 포인트는 1~50개. 근거 없이 초안 저장은 가능하지만 확정은 불가다.

원본 삭제 후 evidence에는 삭제된 ID·버전과 ‘근거 삭제됨’ 표시만 남는다. 캐시된 본문·사진을 계속 공개하지 않는다. 삭제·비공개·숨김 이후 해당 근거에 접근할 수 없는 사용자는 snapshot 통계도 볼 수 없다. 제안 자체에 운영자가 개인정보를 직접 복사해 쓴 경우에는 일반 콘텐츠 검수·삭제 정책을 적용한다.

## 6. 핵심 트랜잭션

| 동작 | 같은 트랜잭션에서 보장할 것 |
|---|---|
| 지도 개설 | account 검증 → 템플릿 복사 → 분류·이모지·질문·scheme → owner membership → config revision → active |
| 초대 입장 | invite row lock → 유효성·잔여 사용량 → membership 유일성 → 신규 입장일 때만 uses 증가 → 세션 생성 |
| 기록 제출 | map row lock → 권한·active·config version → 필수·참조·첨부 ready 검증 → 상태 결정 → theme lock → map data revision 증가 |
| 기록 수정 | map → observation 순서 잠금 → X-Resource-Version 검사 → 새 값 검증 → approval 지도면 pending → version/data revision 증가 |
| 검수 | 같은 잠금 순서로 상태 전이·audit·data revision 증가. 숨김 이유 필수 |
| 공개 변경 | owner 확인 → X-Resource-Version → visibility 변경 → data revision 증가·audit. 공개 전환 전 UI에서 노출 요약 조회 |
| 제안 확정 | map → proposal 잠금 → 요청 version과 근거의 현재 접근·버전 검사 → 불변 버전 확정·published pointer 갱신 |
| 기능 변경 | map 잠금 → X-Resource-Version·theme lock 규칙 → config revision 스냅샷 → 기존 데이터 보존·audit |

잠금 순서는 map → 대상 루트 → 자식으로 통일한다. 공개→비공개 변경과 첨부 열람은 파일 스트리밍 시작 시 현재 권한으로 결정하며 이미 전송 중인 바이트 회수는 보장하지 않는다.

idempotency 키는 24시간 보관한다. 같은 actor·route·key·body의 재시도는 기존 resource를 가리키며 동작을 반복하지 않는다. 재시도 응답 전 현재 열람 권한을 다시 검사한다. 키 만료 뒤까지의 exactly-once를 보장하지 않으며 클라이언트는 성공 여부 불명 시 기존 resource ID를 조회한다.

## 7. 인덱스와 상태 전이

필수 인덱스:

- observations: `GiST(location)` + `(map_id,status,observed_at DESC,id)` + `(map_id,category_id,status)` + `(map_id,rating_option_id,status)` + `(map_id,author_member_id,status)`.
- map_members: UNIQUE(map_id,principal_id), `(principal_id,status)`.
- maps: 공개·active 탐색용 `(visibility,status,created_at DESC,id)`.
- answers: `(map_id,question_version_id)`; 의미 있는 선택 질문만 추가 인덱스 검토, 본문 전체에 무차별 GIN 금지.
- comments: `(map_id,observation_id,status,created_at,id)`.
- sessions/invites: token hash/HMAC UNIQUE, 만료 정리 인덱스.
- jobs: `(state,available_at)`; exports: `(map_id,requested_by,created_at)`.

기록 전이: draft → pending 또는 published → hidden 또는 deleted. pending은 승인 시 published, 수정 요청은 pending 유지+메시지. published 수정은 승인형에서 pending, 즉시형에서 published 유지. hidden 복구는 관리자만 가능하며 승인형은 pending으로, 즉시형은 published로 복원한다. deleted 복원도 관리자만 가능하며 동일 규칙을 따른다. 작성자는 숨김·삭제 상태를 편집해 검수를 우회할 수 없다.

지도 archived는 일반 신규 작성·수정을 막고 관리자 검수·복구·재개는 허용한다. archived→active는 owner만 가능하다. deleted 지도는 일반 조회 불가, 30일 권장 복구 기간 내 owner만 복구 가능하다.

## 8. 구현 시 반드시 실행할 DB 검증

다른 지도 category·emoji·rating·question·evidence 연결 거부, 같은 지도라도 다른 category의 emoji 거부, 두 요청의 초대 마지막 사용권 경합, 설정 변경과 첫 제출 경합, version 충돌, 제출 재시도, 지도 간 조회 격리, Data API 직접 접근 거부를 검증한다. 본 문서 작성은 이 테스트들의 통과를 의미하지 않는다.
