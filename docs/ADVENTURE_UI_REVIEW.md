# 탐험 게임 스타일 UI · 2026-10-01

## 변경 범위

기존 지도·기록·평가·댓글·초대·통계·제안서 기능 위에 탐험 게임 스타일을 적용했다. 홈은 여우 탐험대장과 동네 풍경을 담은 출발 카드, 지도 만들기 버튼, 초대 합류 링크로 구성한다. 지도 목록은 탐험 지도 카드, 하단 메뉴는 탐험 지도·발견 기록·탐험 통계·개선 제안·탐험 가방으로 표시한다. 지도 만들기·기록 입력에는 작은 캐릭터 안내를 제공하고 초대 화면은 초대장 형태로 꾸몄다.

노란 입체 버튼, 나침반·일지·깃발·가방의 자체 SVG 아이콘, 크림색 일지 배경과 청록색 강조를 사용한다. 실제 지도 위에는 캐릭터를 추가하지 않았다. 지도 영역을 넓게 유지하고 조건·범례·목록과 하단 현재 위치 버튼에 스타일을 적용했다. 평가 핀과 이모지의 의미·주제별 기능·현재 위치 동작은 유지한다. 경험치·순위·미션 같은 기능은 추가하지 않았다.

## 제작한 이미지

내장 image_gen 도구로 두 이미지를 새로 생성했다. 특정 모델명은 도구가 제공하지 않아 별도로 지정하거나 보장하지 않았다. 외부 게임 소스나 캐릭터 이미지를 사용하지 않았고 메뉴 아이콘은 프로젝트에서 직접 구현했다.

| 파일 | 크기 | 용도 |
|---|---:|---|
| public/adventure/neighborhood-quest.webp | 1280×853 · 286,312 bytes | 홈 탐험 풍경 |
| public/adventure/explorer-fox.webp | 320×384 · 35,452 bytes · alpha 보존 | 안내·초대·데스크톱 캐릭터 |

원본 생성 이미지는 Codex generated_images에 유지하고, 프로젝트에서는 WebP로 변환한 최종 파일을 참조한다. 텍스트와 버튼은 이미지에 합치지 않고 실제 HTML로 렌더링한다.

## 검증

- TypeScript 검사, 기존 테스트 43개, production build 통과.
- 390×844 홈·실제 지도·기록·통계 화면 및 메뉴 이동 확인.
- 320×740 주제 선택·생태 지도 설정·초대 화면 확인. DOM 가로 너비와 scrollWidth가 일치했다.
- 생태 지도 설정의 6유형·144개 이모지 표시 유지.
- 초대 화면에서 잘못된 코드의 입력 검증 메시지 확인.
- 브라우저 확인 과정에서 지도 생성·기록 제출·기존 데이터 수정은 실행하지 않았다.
- 키보드 초점 표시·감소된 모션 설정을 유지한다. 실제 초등학생 사용성 평가를 수행한 것은 아니다.

## 생성 프롬프트

### 탐험 풍경

Use case: illustration-story. Asset type: a landscape hero illustration for a Korean community mapping mobile web app for children age 10-12. Create an original adventure-game world: a charming orange fox explorer with large triangular ears, a teal scout vest, small mustard backpack and a tiny compass pendant, standing at the lower right with a folded map. Behind it, a colorful miniature Korean neighborhood discovery landscape with a winding cream walking trail, small houses, a school, a blue stream, leafy trees, flowers, a bench, and a footbridge, implying everyday neighborhood exploration. Rounded hand-painted 2.5D storybook game art, crisp illustrated shapes with deep forest-navy outlines, warm cream, emerald teal and sunny amber accents, playful but sophisticated enough for preteens, no baby style. Composition wide landscape: sky at top, complete integrated background, visual action mostly center and right; landscape fills the bottom; usable calm sky area at upper left. Clear readable silhouette at small mobile scale, warm morning light, subtle paper texture. No text, no typography, no letters, no logo, no watermark, no UI panels, no existing franchise characters. The fox is an original mascot, confident and friendly. Entire background opaque.

### 여우 캐릭터

Use case: illustration-story. Asset type: original transparent mascot illustration for an elementary-school neighborhood exploration mobile app. Generate a single friendly orange fox explorer, large triangular ears with dark brown ear tips, cream muzzle and fluffy cream chest, big expressive dark brown eyes, teal explorer vest, small mustard-yellow backpack, round brass compass pendant, brown hiking boots. Standing full body and waving one paw inviting the viewer on an adventure; holding a rolled paper map in the other paw. Warm hand-painted storybook game illustration with clear deep forest-navy contours, rounded simple forms, orange teal amber palette; polished, joyful, confident, appropriate for ages 10-12, not infant style. One character only, easy to recognize at 64 pixels. Full body centered, entire tail visible, no cropping; modest padding around silhouette. Actual transparent background, no scene, no ground plane, no text, no symbols outside character, no logo, no watermark, no existing franchise character. Generate a usable cutout asset with clean alpha.

