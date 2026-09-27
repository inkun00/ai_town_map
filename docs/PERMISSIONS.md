# 1단계 권한과 공개 범위

## 1. 판정 순서

모든 요청에서 `세션 → principal 상태 → 지도 존재·상태 → membership → 기능 설정 → 콘텐츠 상태·작성자 → 입력값` 순서로 검사한다. 서버가 읽은 membership을 기준으로 하고 body의 actor/role/mapId를 신뢰하지 않는다.

- `owner`: maps.owner_principal_id와 현재 계정 principal 일치.
- `admin`: active membership.role=admin이며 Google 계정 principal.
- `participant`: active membership, account 또는 guest.
- `visitor`: 세션이 없거나 해당 지도의 membership이 없는 사람. Google 로그인만으로 참여 권한을 얻지 않는다.
- 해당 지도에서 blocked/left인 identity는 초대로 자동 복구하지 않는다. 차단된 사용자의 공개 지도 읽기는 방문자와 동일하며 쓰기는 금지한다. 로그아웃으로 공개 읽기를 막을 수 있다고 주장하지 않는다.
- 서비스 운영자는 일반 요청의 superuser가 아니다. 신고 사건별 지원 도구로 필요한 자료만 열람하고 사유·이력을 남긴다. MVP 일반 UI에 운영자 전역 열람 기능을 제공하지 않는다.

## 2. 역할별 동작

아래 허용은 지도 상태·기능 조건을 추가로 충족해야 한다. 본인=현재 principal의 해당 지도 membership.

| 동작 | 방문자 | 참여자 | 관리자 | 소유자 |
|---|---|---|---|---|
| 공개 지도·게시 기록 읽기 | 가능 | 가능 | 가능 | 가능 |
| 초대 전용 지도 읽기 | 불가 | 가능 | 가능 | 가능 |
| 지도 개설 | Google 로그인 필요 | account만 | account만 | account만 |
| 포인트 작성 | 불가 | invited 모드 | invited/admin_only | invited/admin_only |
| 본인 draft/pending 읽기·수정 | 불가 | 가능 | 가능 | 가능 |
| 게시 기록 본문 수정 | 불가 | 본인만 | 본인만 | 본인만 |
| 타인 본문 변경 | 불가 | 불가 | MVP에서는 수정 요청 | MVP에서는 수정 요청 |
| 기록 숨김·승인·복구 | 불가 | 불가 | 가능 | 가능 |
| 본인 기록 soft delete | 불가 | 가능 | 가능 | 가능 |
| 댓글 작성·본인 수정·삭제 | 불가 | 가능 | 가능 | 가능 |
| 댓글 숨김·복구 | 불가 | 불가 | 가능 | 가능 |
| 신고 | 불가 | 가능 | 가능 | 가능 |
| 제안 초안 작성·본인 수정 | 불가 | 가능 | 가능 | 가능 |
| 제안 검토·확정·공유 해제 | 불가 | 불가 | 가능 | 가능 |
| 일반 통계 | 공개 게시분 | 게시분 | 게시분 | 게시분 |
| 검수함·본인함 | 불가 | 본인함 | 지도 전체 검수함 | 지도 전체 검수함 |
| CSV·export 다운로드 | 불가 | 불가 | 가능 | 가능 |
| 초대 생성·폐기 | 불가 | 불가 | 가능 | 가능 |
| 참여자 차단·복구 | 불가 | 불가 | participant만 | admin·participant |
| 관리자 지정·해제 | 불가 | 불가 | 불가 | active account 대상 |
| 주제 설정·질문 편집 | 불가 | 불가 | 잠금 규칙 안에서 가능 | 잠금 규칙 안에서 가능 |
| 공개 범위 변경·보관·재개·지도 삭제·복구 | 불가 | 불가 | 불가 | 가능 |

`participation=closed`는 관리자·소유자도 신규 포인트 등록을 금지한다. 다시 열려면 owner가 설정을 바꾼다. 기존 기록 수정은 active 지도에서 작성자에게 허용한다. `admin_only`에서 일반 참여자는 본인 기존 기록 수정이 가능하지만 새 기록은 만들 수 없다. 댓글·제안은 별도 기능 플래그로 제어하며 closed가 자동으로 댓글을 닫지는 않는다. archived는 모든 일반 콘텐츠 작성을 막는다. 개인정보 삭제 요청을 위해 본인 콘텐츠 삭제와 관리자 숨김은 archived에서도 허용한다.

## 3. 기록 상태별 열람

| 기록 상태 | 작성자 | 다른 참여자·방문자 | 관리자·소유자 | 기본 통계 |
|---|---|---|---|---|
| draft | 가능 | 불가 | 작성자 본인인 경우만 | 제외 |
| pending | 가능 | 불가 | 가능 | 제외 |
| published | 지도 읽기 권한 필요 | 지도 읽기 권한 필요 | 가능 | 포함 |
| hidden | 숨김 상태·사유만, 본문 불가 | 불가 | 가능 | 제외 |
| deleted | 삭제 상태만 | 불가 | 복구 기간 내 보관 조회 | 제외 |

초안은 작성자의 미제출 자료이므로 지도 관리자도 다른 사람 초안의 본문·사진을 열람하지 않는다. PRD의 ‘관리자 검수’ 범위는 제출된 기록부터 적용한다.

첨부·링크·댓글은 부모 기록보다 넓게 보이지 않는다. 댓글은 published 기록에만 새로 작성하며, 부모가 pending/hidden/deleted로 바뀌면 일반 댓글 조회도 중단한다. 타인 댓글은 visible만 반환하고 삭제 흔적에는 본문·닉네임을 노출하지 않는다.

## 4. 함수 계약

인가 계층의 순수 판정 함수와 데이터 조회는 분리한다. 아래 이름은 구현 계약이며 현재 실행 코드는 아니다.

```text
canReadMap(actor, map, membership)
canCreateObservation(actor, map, membership)
canReadObservation(actor, map, membership, observation)
canEditObservation(actor, map, membership, observation)
canModerate(actor, map, membership)
canManageOwnershipSettings(actor, map)
canReadProposalVersion(actor, map, membership, proposal, version)
canReadAttachment(actor, map, membership, parentObservation)
```

`canReadMap`은 public인 active/archived 지도 또는 active 멤버에게만 true다. private의 blocked/left는 false. draft 지도는 owner만. deleted 지도는 owner 복구 경로에서만 접근한다.

파일 권한은 DB에서 attachment→observation→map을 읽어 결정하며 URL의 mapId는 검증 보조값일 뿐이다. 관리자가 전달받은 파일 URL을 방문자가 열어도 현재 권한을 검사한다.

## 5. 제안서와 근거

- 초안·검토 중 버전은 작성자·관리자·소유자만 열람한다.
- 확정·공유된 버전은 해당 지도 읽기 권한을 가진 사람만 열람한다. 초대 전용 지도 공유 링크는 초대 코드를 포함하지 않는다.
- proposal 기능을 끄면 일반 조회·쓰기·공유 링크를 막고 관리자 보관 API만 제공한다. 다시 켜면 저장된 상태를 복원한다.
- 근거 선택은 현재 published 기록만 가능하다. 근거가 수정되면 버전 차이, 숨김·삭제면 접근 불가를 표시한다. 근거가 바뀌면 확정 전 재검토가 필수다.
- 근거의 원본·집계 스냅샷은 매번 현재 권한을 재검사한다. 원본 권한이 좁아지면 연결된 제안서가 노출 우회 경로가 되어서는 안 된다.

## 6. 직접 접근과 실패 응답

- 존재를 알 권한이 없는 지도·기록·사진: 404. 공개 지도에서 로그인 없이 쓰기 시도: 401. 알려진 자원에 작업 권한이 없음: 403.
- 권한 회수 후 세션에 저장된 오래된 역할을 사용하지 않는다. DB membership을 다시 조회한다.
- 클라이언트가 게시·승인·owner ID를 직접 설정하면 422, 별도 권한 있는 명령 API만 해당 값을 변경한다.
- 비공개 지도 정보가 들어간 OG·검색 색인·오류 로그·HTML preload·공유 캐시를 만들지 않는다. 공개 탐색 목록에는 public active 지도만 노출한다.
- 서버만 Storage 비밀키를 가지므로 직접 Storage 호출로 사진을 읽을 수 없어야 한다. 실제 bucket 정책과 API 우회 테스트는 4단계 필수다.

## 7. 구현 시 검증할 권한 시나리오

1. 같은 닉네임의 A/B가 서로의 기록을 수정하지 못한다.
2. 지도 X의 참여자가 Y의 포인트·사진·CSV·제안 근거에 접근하지 못한다.
3. 공개 지도 방문자는 published만 읽고 pending·draft ID를 알아도 접근하지 못한다.
4. 관리자는 타인 draft를 읽지 못하지만 제출된 pending은 검수할 수 있다.
5. 게스트가 role=admin 또는 authorMemberId를 요청 body에 넣어도 권한을 얻지 못한다.
6. 공개→비공개 전환 직후 방문자의 API·파일·export 접근이 끊긴다.
7. 마지막 초대 사용권에 동시 요청해도 max_uses를 넘지 않는다.
8. 댓글·제안 기능을 끈 지도는 API 직접 호출로도 새 자료를 만들 수 없다.
9. guest 세션 만료 후 같은 닉네임으로 입장해도 기존 작성권이 복구되지 않는다.
10. 잘못된 Origin·CSRF 토큰과 만료·폐기 세션을 거부한다.
11. anonymous/일반 Supabase 키로 업무 schema·storage 원본을 조회하지 못한다.
12. 관리자 강등·멤버 차단 이후 기존 탭에서 쓰기 권한을 유지하지 못한다.
