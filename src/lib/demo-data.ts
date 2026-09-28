import source from "../../docs/contracts/theme-presets.json";

export type ThemeKey = "universal_design" | "safety" | "ecology" | "weather_life" | "custom";
export type PinMode = "rating" | "category" | "single";
export type TabKey = "map" | "record" | "analysis" | "proposal" | "more";
export type ScreenKey = "home" | "create" | "workspace";

export type EmojiOption = { key: string; glyph: string; label: string };
export type Category = { key: string; label: string; color: string; defaultEmojiKey: string; emojiOptions: EmojiOption[] };
export type RatingOption = { key: string; label: string; color: string; symbol: string };
export type Question = {
  key: string;
  label: string;
  type: "rating3" | "boolean" | "single" | "multi" | "text";
  required: boolean;
  allowUnknown: boolean;
  allowNotApplicable: boolean;
  options?: { key: string; label: string }[];
  maxLength?: number;
};
export type Theme = {
  key: ThemeKey;
  label: string;
  version: number;
  requiresConfiguration?: boolean;
  features: { ratingEnabled: boolean; ideasEnabled: boolean; proposalsEnabled: boolean; commentsEnabled: boolean };
  pin: { mode: PinMode };
  rating: { key: string; label: string; options: RatingOption[] } | null;
  categories: Category[];
  questions: Question[];
};

export const themes = source.templates as Theme[];
export const themeByKey = Object.fromEntries(themes.map((theme) => [theme.key, theme])) as Record<ThemeKey, Theme>;

export type DemoMap = {
  id: string;
  title: string;
  description: string;
  themeKey: ThemeKey;
  location: string;
  author: string;
  isMine?: boolean;
  visibility: "public" | "invite_only";
  accent: string;
  coverEmoji: string;
};

export const initialMaps: DemoMap[] = [
  { id: "access", title: "우리 동네 모두의 길", description: "누구나 편리하게 이동할 수 있는 길과 시설을 기록해요.", themeKey: "universal_design", location: "군산시 수송동", author: "수송동 탐험대", isMine: true, visibility: "invite_only", accent: "mint", coverEmoji: "♿" },
  { id: "ecology", title: "공원에서 만난 생명", description: "산책하며 발견한 식물과 작은 생물을 모아요.", themeKey: "ecology", location: "군산시 은파호수", author: "초록 관찰단", visibility: "public", accent: "lime", coverEmoji: "🌳" },
  { id: "safety", title: "안전한 통학길 지도", description: "학교 주변의 좋은 점과 바꿔야 할 곳을 살펴봐요.", themeKey: "safety", location: "군산시 조촌동", author: "우리 반 안전팀", visibility: "public", accent: "peach", coverEmoji: "🚸" },
  { id: "weather", title: "날씨생활 발자국", description: "더위와 비, 바람이 일상에 남긴 흔적을 기록해요.", themeKey: "weather_life", location: "군산시 나운동", author: "날씨 탐험가", visibility: "public", accent: "sky", coverEmoji: "☀️" },
];

export type DemoPoint = {
  id: string;
  mapId: string;
  title: string;
  categoryKey: string;
  emojiKey: string;
  ratingKey: string | null;
  body: string;
  idea?: string;
  link?: string;
  imageName?: string;
  x: number;
  y: number;
  author: string;
  date: string;
  answers?: Record<string, string>;
  comments?: string[];
  location?: { lat: number; lng: number };
  locationLabel?: string;
  locationSource?: "gps" | "search" | "manual";
  photoUrl?: string | null;
  status?: "pending" | "published" | "hidden" | "deleted";
  version?: string;
  canEdit?: boolean;
  canDelete?: boolean;
  rawAnswers?: Record<string, string[]>;
};

export const initialPoints: DemoPoint[] = [
  { id: "a1", mapId: "access", title: "입구 옆 경사로", categoryKey: "entrance", emojiKey: "entrance-2", ratingKey: "positive", body: "엘리베이터와 완만한 경사로가 있어서 이동하기 편리해요.", x: 63, y: 27, author: "초록이", date: "9월 25일", answers: { mobility: "편리", information: "편리", audio_guidance: "있음", rest_area: "없음", safety: "편리" }, comments: ["이곳은 유아차도 지나가기 좋아요!"] },
  { id: "a2", mapId: "access", title: "횡단보도 앞 높은 턱", categoryKey: "walkway", emojiKey: "walkway-1", ratingKey: "improve", body: "보도 턱이 높아서 휠체어나 유아차가 돌아가야 해요.", idea: "보도와 차도의 높이를 맞추고 경사로를 연결해주세요.", x: 30, y: 35, author: "다람쥐", date: "9월 24일", answers: { mobility: "개선 필요", information: "확인 못함", safety: "개선 필요" }, comments: ["비 오는 날은 더 위험해 보여요."] },
  { id: "a3", mapId: "access", title: "공원 벤치와 그늘", categoryKey: "rest", emojiKey: "rest-1", ratingKey: "positive", body: "그늘 아래 벤치가 여러 개 있고 쉬기 좋아요.", x: 72, y: 63, author: "토리", date: "9월 23일" },
  { id: "a4", mapId: "access", title: "안내판 글씨가 작아요", categoryKey: "public_facility", emojiKey: "public_facility-2", ratingKey: "caution", body: "방향 안내판은 있지만 글씨가 작아 멀리서 읽기 어려워요.", idea: "글씨 크기를 키우고 소리 안내를 추가하면 좋겠어요.", x: 45, y: 55, author: "모모", date: "9월 22일" },
  { id: "a5", mapId: "access", title: "화장실 입구", categoryKey: "restroom", emojiKey: "restroom-1", ratingKey: "caution", body: "입구까지는 평평하지만 문이 무거워 열기가 힘들어요.", x: 80, y: 39, author: "노랑", date: "9월 20일" },
  { id: "e1", mapId: "ecology", title: "큰 느티나무", categoryKey: "plants", emojiKey: "plants-1", ratingKey: null, body: "나무 아래가 시원하고 작은 새들이 쉬어가요.", x: 36, y: 30, author: "나무지기", date: "9월 24일", answers: { organism_name: "느티나무", habitat: "공원·녹지" } },
  { id: "e2", mapId: "ecology", title: "호수 옆 물새", categoryKey: "birds", emojiKey: "birds-2", ratingKey: null, body: "물가에서 여러 마리의 물새를 관찰했어요.", x: 65, y: 36, author: "파랑", date: "9월 23일", answers: { organism_name: "이름을 모르는 물새" } },
  { id: "e3", mapId: "ecology", title: "꽃밭의 나비", categoryKey: "insects", emojiKey: "insects-1", ratingKey: null, body: "노란 꽃 주변에서 나비 두 마리를 봤어요.", x: 29, y: 68, author: "초록이", date: "9월 22일" },
  { id: "e4", mapId: "ecology", title: "작은 습지", categoryKey: "water", emojiKey: "water-1", ratingKey: null, body: "비 온 뒤 물이 모여 있고 작은 생물들이 보여요.", x: 77, y: 70, author: "민들레", date: "9월 20일" },
  { id: "s1", mapId: "safety", title: "학교 앞 신호등", categoryKey: "traffic", emojiKey: "traffic-1", ratingKey: "positive", body: "보행 신호가 길어 아이들이 안전하게 건널 수 있어요.", x: 60, y: 32, author: "별이", date: "9월 25일" },
  { id: "s2", mapId: "safety", title: "어두운 골목", categoryKey: "daily", emojiKey: "daily-1", ratingKey: "improve", body: "저녁에는 조명이 약해서 바닥이 잘 보이지 않아요.", idea: "가로등을 추가해 주세요.", x: 25, y: 55, author: "하늘", date: "9월 24일" },
  { id: "s3", mapId: "safety", title: "공사장 옆 좁은 길", categoryKey: "pedestrian", emojiKey: "pedestrian-2", ratingKey: "caution", body: "공사 펜스 때문에 통학길이 좁아요.", x: 70, y: 66, author: "솔", date: "9월 22일" },
  { id: "w1", mapId: "weather", title: "버스 정류장 그늘", categoryKey: "heat", emojiKey: "heat-2", ratingKey: "positive", body: "큰 나무 덕분에 한낮에도 잠시 쉴 수 있어요.", x: 32, y: 42, author: "햇살", date: "9월 25일" },
  { id: "w2", mapId: "weather", title: "비 오면 고이는 물", categoryKey: "rain", emojiKey: "rain-2", ratingKey: "improve", body: "비가 오면 인도에 물이 오래 고여 걷기 불편해요.", idea: "배수구를 정비해 주세요.", x: 68, y: 33, author: "구름", date: "9월 23일" },
  { id: "w3", mapId: "weather", title: "바람이 센 모퉁이", categoryKey: "wind", emojiKey: "wind-1", ratingKey: "caution", body: "건물 사이에서 바람이 세게 불어요.", x: 58, y: 71, author: "바람", date: "9월 21일" },
];

export function getPointEmoji(theme: Theme, point: Pick<DemoPoint, "categoryKey" | "emojiKey">): EmojiOption | undefined {
  return theme.categories.find((item) => item.key === point.categoryKey)?.emojiOptions.find((item) => item.key === point.emojiKey);
}

export function getPinColor(theme: Theme, point: DemoPoint): string {
  if (theme.pin.mode === "rating" && theme.rating) return theme.rating.options.find((item) => item.key === point.ratingKey)?.color ?? "#475569";
  if (theme.pin.mode === "category") return theme.categories.find((item) => item.key === point.categoryKey)?.color ?? "#475569";
  return "#285943";
}
