"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import KakaoMap, { type Coordinates } from "@/components/KakaoMap";
import { CommentSection,DeletedMaps,ModerationCenter,MyRecords,ObservationActions,ReportAction } from "@/components/CommunityControls";
import {
  Category,
  DemoMap,
  DemoPoint,
  EmojiOption,
  initialMaps,
  initialPoints,
  getPinColor,
  getPointEmoji,
  PinMode,
  Question,
  ScreenKey,
  TabKey,
  Theme,
  ThemeKey,
  themeByKey,
  themes,
} from "@/lib/demo-data";

type MapWithSettings = DemoMap & { categories?: Category[]; features?: Theme["features"]; pinMode?: PinMode; rating?: Theme["rating"]; isOwner?: boolean; canManageMap?: boolean; canCreateObservation?: boolean; canComment?:boolean; center?: Coordinates | null; configRevision?: number; participation?:"invited"|"admin_only"|"closed";moderation?:"immediate"|"approval";commentsEnabled?:boolean;status?:"active"|"archived";version?:string };
type LiveSession = { kind: "account" | "guest"; expiresAt: string; csrfToken: string | null };
type LiveMap = { id: string; title: string; description: string; themeKey: ThemeKey; location: string; center: Coordinates | null; configRevision: number; visibility: "public" | "invite_only"; participation:"invited"|"admin_only"|"closed";moderation:"immediate"|"approval";commentsEnabled:boolean;status:"active"|"archived";version:string;isMine: boolean; isOwner: boolean; capabilities: { canManageMap: boolean; canCreateObservation: boolean;canComment:boolean } };

function asDemoMap(map: LiveMap): MapWithSettings {
  const accent: Record<ThemeKey, string> = { universal_design: "mint", safety: "peach", ecology: "lime", weather_life: "sky", custom: "mint" };
  return { id: map.id, title: map.title, description: map.description, themeKey: map.themeKey, location: map.location, center: map.center, configRevision: map.configRevision, author: map.isOwner ? "내가 만든 지도" : "커뮤니티", isMine: map.isMine, isOwner: map.isOwner, canManageMap: map.capabilities.canManageMap, canCreateObservation: map.capabilities.canCreateObservation,canComment:map.capabilities.canComment, visibility: map.visibility,participation:map.participation,moderation:map.moderation,commentsEnabled:map.commentsEnabled,status:map.status,version:map.version, accent: accent[map.themeKey], coverEmoji: themeSymbol[map.themeKey] };
}
type LiveObservation = { id:string;mapId:string;title:string;body:string;locationLabel:string;locationSource:"gps"|"search"|"manual";location:Coordinates;categoryKey:string;emojiKey:string;ratingKey:string|null;answers:Record<string,string[]>;improvementIdea:string|null;link:string|null;status:"pending"|"published"|"hidden"|"deleted";version:string;createdAt:string;author:string;canEdit:boolean;canDelete:boolean;photoUrl:string|null };
function asDemoPoint(point: LiveObservation, theme: Theme): DemoPoint {
  const answers = Object.fromEntries(Object.entries(point.answers).map(([key,values])=>{
    const question=theme.questions.find((item)=>item.key===key);
    return [key,question?.type==="text"?values.join(" · "):values.map((value)=>(question?answerChoices(question):[]).find((item)=>item.key===value)?.label??value).join(" · ")];
  }));
  return {id:point.id,mapId:point.mapId,title:point.title,body:point.body,categoryKey:point.categoryKey,emojiKey:point.emojiKey,ratingKey:point.ratingKey,idea:point.improvementIdea??undefined,link:point.link??undefined,answers,rawAnswers:point.answers,x:50,y:50,location:point.location,locationLabel:point.locationLabel,locationSource:point.locationSource,author:point.author,date:new Date(point.createdAt).toLocaleDateString("ko-KR"),photoUrl:point.photoUrl,status:point.status,version:point.version,canEdit:point.canEdit,canDelete:point.canDelete,comments:[]};
}
type Draft = {
  title: string;
  body: string;
  categoryKey: string;
  emojiKey: string;
  ratingKey: string;
  location: string;
  idea: string;
  imageName: string;
  link: string;
  answers: Record<string, string[]>;
};

const makeDraft = (): Draft => ({ title: "", body: "", categoryKey: "", emojiKey: "", ratingKey: "", location: "", idea: "", imageName: "", link: "", answers: {} });
const themeSymbol: Record<ThemeKey, string> = { universal_design: "♿", safety: "🚸", ecology: "🌳", weather_life: "☀️", custom: "✨" };
const themeDescription: Record<ThemeKey, string> = {
  universal_design: "누구에게나 편리한 길과 시설",
  safety: "안전한 동네를 위한 발견",
  ecology: "우리 곁의 생명과 자연",
  weather_life: "날씨가 남긴 생활의 흔적",
  custom: "우리만의 새로운 주제",
};

function Icon({ name, size = 21 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    arrow: <><path d="m14 6-6 6 6 6" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    map: <><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z" /><path d="M9 4v14M15 6v14" /></>,
    chart: <><path d="M4 20V11h4v9M10 20V4h4v16M16 20v-7h4v7M3 20h18" /></>,
    note: <><path d="M5 3h11l3 3v15H5V3Z" /><path d="M8 10h8M8 14h8M8 18h5" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></>,
    filter: <><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" /></>,
    share: <><path d="M12 16V3m0 0L7 8m5-5 5 5M5 14v6h14v-6" /></>,
    close: <><path d="M5 5 19 19M19 5 5 19" /></>,
    check: <><path d="m4 12 5 5L20 6" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3V7Z" /><circle cx="12" cy="13.5" r="3.5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3ZM16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.9 4.9l1.5 1.5m11.2 11.2 1.5 1.5M2 12h2m16 0h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.pin}</svg>;
}

function resolveTheme(map: MapWithSettings): Theme {
  const base = themeByKey[map.themeKey];
  return { ...base, categories: map.categories ?? base.categories, features: map.features ?? base.features, pin: { mode: map.pinMode ?? base.pin.mode }, rating: map.rating !== undefined ? map.rating : base.rating };
}

const customRating: NonNullable<Theme["rating"]> = { key: "community", label: "장소 평가", options: [
  { key: "positive", label: "좋아요", color: "#16803D", symbol: "✓" },
  { key: "caution", label: "조금 불편", color: "#B85C00", symbol: "!" },
  { key: "improve", label: "개선 필요", color: "#C62828", symbol: "×" },
] };

function MapArtwork({ theme, points, selectedId, onSelect, compact = false, choosePosition }: { theme: Theme; points: DemoPoint[]; selectedId?: string; onSelect?: (id: string) => void; compact?: boolean; choosePosition?: (x: number, y: number) => void }) {
  return <div className={`map-art ${compact ? "map-art--compact" : ""}`}>
    <svg className="map-art__base" viewBox="0 0 400 580" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="400" height="580" fill="#edf3e9" />
      <path d="M-70 108 92-20l128 117-147 122ZM244 68 405-16l68 119-178 93ZM-28 365 146 250l88 120-180 150ZM240 366l164-124 90 142-165 148Z" fill="#e1ebd9" />
      <path d="M-80 454c99-35 115-23 166-9 56 15 85 58 169 47 58-8 101-49 207-28" stroke="#b5d9e8" strokeWidth="58" fill="none" />
      <path d="M-80 454c99-35 115-23 166-9 56 15 85 58 169 47 58-8 101-49 207-28" stroke="#d2e9ef" strokeWidth="41" fill="none" />
      <g stroke="#fffdf8" strokeWidth="23" fill="none"><path d="M-65 195 464 231M15-45l328 684M187-40l-89 655M438 30-44 364M457 343 97 623" /></g>
      <g stroke="#d5ded0" strokeWidth="1.4" fill="none"><path d="M-65 195 464 231M15-45l328 684M187-40l-89 655M438 30-44 364M457 343 97 623" /></g>
      <g fill="#c9e2b8"><circle cx="40" cy="105" r="10" /><circle cx="60" cy="102" r="8" /><circle cx="276" cy="100" r="12" /><circle cx="296" cy="111" r="10" /><circle cx="351" cy="325" r="13" /><circle cx="366" cy="342" r="11" /><circle cx="44" cy="315" r="13" /><circle cx="58" cy="331" r="9" /><circle cx="120" cy="504" r="10" /><circle cx="142" cy="520" r="13" /></g>
      <g fill="#cad9c7"><rect x="98" y="123" width="45" height="35" rx="5" transform="rotate(-9 98 123)" /><rect x="225" y="273" width="51" height="42" rx="5" transform="rotate(12 225 273)" /><rect x="311" y="154" width="38" height="46" rx="5" transform="rotate(8 311 154)" /><rect x="69" y="399" width="44" height="24" rx="5" transform="rotate(-8 69 399)" /></g>
      <g fontSize="10" fill="#87a18b" fontWeight="700"><text x="17" y="77">푸른공원</text><text x="289" y="140">우리마을</text><text x="143" y="289">문화센터</text><text x="279" y="420">작은광장</text></g>
    </svg>
    {choosePosition && <button className="map-art__tap" type="button" aria-label="지도 가운데를 기록 위치로 선택" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); choosePosition(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100); }} />}
    {points.map((point) => {
      const emoji = getPointEmoji(theme, point);
      const category = theme.categories.find((item) => item.key === point.categoryKey);
      return <button key={point.id} className={`map-pin ${selectedId === point.id ? "map-pin--active" : ""}`} type="button" style={{ left: `${point.x}%`, top: `${point.y}%`, backgroundColor: getPinColor(theme, point) }} aria-label={`${point.title}, ${category?.label ?? "기록"}${theme.rating && point.ratingKey ? `, ${theme.rating.options.find((item) => item.key === point.ratingKey)?.label}` : ""}`} onClick={() => onSelect?.(point.id)}>
        <span aria-hidden="true">{emoji?.glyph ?? "📍"}</span>
      </button>;
    })}
    <div className="map-art__credit">화면 시안 · 지도 배경 예시</div>
  </div>;
}

function ThemePill({ themeKey }: { themeKey: ThemeKey }) {
  return <span className={`theme-pill theme-pill--${themeKey}`}>{themeSymbol[themeKey]} {themeByKey[themeKey].label}</span>;
}

function EmptyState({ emoji, title, children }: { emoji: string; title: string; children?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-state__emoji" aria-hidden="true">{emoji}</span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

const questionIcons: Record<string, string> = { mobility: "♿", information: "ℹ️", audio_guidance: "🔊", rest_area: "🪑", safety: "🛡️", risk_reasons: "⚠️", lighting: "💡", condition: "🛠️", organism_name: "🔎", habitat: "🌿", characteristics: "📝", reason: "☀️", shade: "🌳", drainage: "💧", shelter: "🏠" };

function answerChoices(question: Question) {
  const options = question.type === "boolean" ? [{ key: "yes", label: "있음" }, { key: "no", label: "없음" }] : question.options ?? [];
  return [...options, ...(question.allowUnknown ? [{ key: "unknown", label: "확인 못함" }] : []), ...(question.allowNotApplicable ? [{ key: "na", label: "해당 없음" }] : [])];
}

function QuestionInputs({ questions, answers, onChange }: { questions: Question[]; answers: Draft["answers"]; onChange: (key: string, values: string[]) => void }) {
  return <div className="question-list"><div className="question-list__heading"><strong>이 주제에서 살펴볼 항목</strong><small>모르는 항목은 ‘확인 못함’을 선택할 수 있어요.</small></div>{questions.map((question) => {
    const selected = answers[question.key] ?? [];
    return <div className="question-item" key={question.key}><div className="question-item__title"><span aria-hidden="true">{questionIcons[question.key] ?? "📝"}</span><strong>{question.label} {question.required && <b>*</b>}</strong></div>{question.type === "text" ? <input value={selected[0] ?? ""} maxLength={question.maxLength ?? 500} onChange={(event) => onChange(question.key, event.target.value ? [event.target.value] : [])} placeholder={`${question.label}을(를) 적어주세요`} /> : <div className="answer-choices">{answerChoices(question).map((option) => <button type="button" key={option.key} className={selected.includes(option.key) ? "selected" : ""} aria-pressed={selected.includes(option.key)} onClick={() => {
      if (question.type !== "multi") { onChange(question.key, [option.key]); return; }
      const special = option.key === "unknown" || option.key === "na";
      if (special) { onChange(question.key, selected.includes(option.key) ? [] : [option.key]); return; }
      const ordinary = selected.filter((key) => key !== "unknown" && key !== "na");
      onChange(question.key, ordinary.includes(option.key) ? ordinary.filter((key) => key !== option.key) : [...ordinary, option.key]);
    }}>{option.label}</button>)}</div>}</div>;
  })}</div>;
}

export default function HomePage() {
  const [screen, setScreen] = useState<ScreenKey>("home");
  const [maps, setMaps] = useState<MapWithSettings[]>(initialMaps);
  const [points, setPoints] = useState<DemoPoint[]>(initialPoints);
  const [activeMapId, setActiveMapId] = useState(initialMaps[0].id);
  const [tab, setTab] = useState<TabKey>("map");
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<ThemeKey | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newCenter, setNewCenter] = useState<Coordinates | null>(null);
  const [newVisibility, setNewVisibility] = useState<"public" | "invite_only">("invite_only");
  const [newActivityContext, setNewActivityContext] = useState<"school" | "community">("community");
  const [newParticipation,setNewParticipation]=useState<"invited"|"admin_only"|"closed">("invited");
  const [newModeration,setNewModeration]=useState<"immediate"|"approval">("immediate");
  const [newComments,setNewComments]=useState(true);
  const [newProposals, setNewProposals] = useState<boolean | null>(null);
  const [customPinMode, setCustomPinMode] = useState<PinMode>("single");
  const [customCategories, setCustomCategories] = useState<Category[]>([]);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [customCategoryEmoji, setCustomCategoryEmoji] = useState("");
  const [recordStep, setRecordStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(makeDraft());
  const [draftPosition, setDraftPosition] = useState({ x: 52, y: 49 });
  const [draftCoordinates, setDraftCoordinates] = useState<Coordinates | null>(null);
  const [draftSource, setDraftSource] = useState<"gps" | "search" | "manual">("manual");
  const [draftPhoto, setDraftPhoto] = useState<File | null>(null);
  const [savingPoint, setSavingPoint] = useState(false);
  const saveKeyRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<string | null>(null);
  const [photoRetry, setPhotoRetry] = useState<{ mapId:string; pointId: string; file: File } | null>(null);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalBody, setProposalBody] = useState("");
  const [savedProposal, setSavedProposal] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [commentText, setCommentText] = useState("");
  const [liveMode, setLiveMode] = useState<boolean | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ code: string; joinUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetch("/api/v1/status", { cache: "no-store" }).then((response) => response.json());
        if (!status.data?.configured) { if (!cancelled) setLiveMode(false); return; }
        const sessionResponse = await fetch("/api/v1/session", { cache: "no-store" });
        const sessionPayload = await sessionResponse.json();
        if (!sessionResponse.ok) throw new Error(sessionPayload.error?.message ?? "세션을 불러올 수 없습니다.");
        const session = sessionPayload.data as LiveSession | null;
        const publicResponse = await fetch("/api/v1/maps?scope=public&limit=50", { cache: "no-store" });
        const publicPayload = await publicResponse.json();
        if (!publicResponse.ok) throw new Error(publicPayload.error?.message ?? "지도를 불러올 수 없습니다.");
        const mineResponse = session ? await fetch("/api/v1/maps?scope=mine&limit=50", { cache: "no-store" }) : null;
        const minePayload = mineResponse ? await mineResponse.json() : { data: { items: [] } };
        if (mineResponse && !mineResponse.ok) throw new Error(minePayload.error?.message ?? "참여 지도를 불러올 수 없습니다.");
        const merged = new Map<string, LiveMap>();
        for (const map of [...(publicPayload.data?.items ?? []), ...(minePayload.data?.items ?? [])] as LiveMap[]) merged.set(map.id, map);
        const directMap = new URLSearchParams(window.location.search).get("map");
        if (directMap && !merged.has(directMap)) {
          const response = await fetch(`/api/v1/maps/${encodeURIComponent(directMap)}`, { cache: "no-store" });
          if (response.ok) { const payload = await response.json(); merged.set(directMap, payload.data as LiveMap); }
        }
        if (cancelled) return;
        setMaps([...merged.values()].map(asDemoMap));
        setLiveSession(session);
        setLiveMode(true);
        if (directMap && merged.has(directMap)) { setActiveMapId(directMap); setScreen("workspace"); window.history.replaceState(null, "", "/"); }
      } catch (error) { if (!cancelled) { setLiveMode(true); setMaps([]); setToast(error instanceof Error ? error.message : "서버에 연결할 수 없습니다."); } }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!liveMode || screen !== "workspace") return;
    let cancelled = false;
    void fetch(`/api/v1/maps/${encodeURIComponent(activeMapId)}/configuration`, { cache: "no-store" }).then((response) => response.json()).then((payload) => {
      if (cancelled) return;
      if (!payload.data?.theme) { setScreen("home"); setToast("지도를 열 수 없습니다."); return; }
      const theme = payload.data.theme as Theme;
      setMaps((items) => items.map((item) => item.id === activeMapId ? { ...item, categories: theme.categories, features: theme.features, pinMode: theme.pin.mode, rating: theme.rating, configRevision: payload.data.configRevision } : item));
      void fetch(`/api/v1/maps/${encodeURIComponent(activeMapId)}/observations`, {cache:"no-store"}).then((response)=>response.json()).then((result)=>{
        if(cancelled) return;
        if(!result.data?.items) throw new Error(result.error?.message ?? "기록을 불러오지 못했습니다.");
        setPoints((items)=>[...items.filter((item)=>item.mapId!==activeMapId),...(result.data.items as LiveObservation[]).map((point)=>asDemoPoint(point,theme))]);
      }).catch((error)=>{if(!cancelled) setToast(error instanceof Error?error.message:"기록을 불러오지 못했습니다.");});
    }).catch(() => { if (!cancelled) setToast("지도 설정을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [liveMode, screen, activeMapId]);

  const activeMap = maps.find((item) => item.id === activeMapId) ?? maps[0] ?? initialMaps[0];
  const activeTheme = resolveTheme(activeMap);
  const mapPoints = points.filter((point) => point.mapId === activeMap.id && (!liveMode || point.status === "published"));
  const filteredPoints = mapPoints.filter((point) => {
    if (filter === "all") return true;
    if (filter.startsWith("rating:")) return point.ratingKey === filter.slice(7);
    if (filter.startsWith("category:")) return point.categoryKey === filter.slice(9);
    return true;
  });
  const selectedPoint = points.find((item) => item.id === selectedPointId && item.mapId === activeMap.id) ?? null;
  const createTheme = selectedTheme ? themeByKey[selectedTheme] : null;
  const previewPinMode = selectedTheme === "custom" ? customPinMode : createTheme?.pin.mode;
  const createCategories = selectedTheme === "custom" ? customCategories : createTheme?.categories ?? [];
  const proposalEnabled = activeTheme.features.proposalsEnabled;
  const isCreateValid = createStep === 0 ? !!selectedTheme : createStep === 1 ? newTitle.trim().length >= 2 && newLocation.trim().length > 0 : createStep === 2 ? selectedTheme !== "custom" || customCategories.length > 0 : true;

  const visibleMaps = useMemo(() => maps.filter((map) => map.status!=="archived" && `${map.title} ${map.location} ${themeByKey[map.themeKey].label}`.toLowerCase().includes(search.toLowerCase())), [maps, search]);
  const statusCounts = activeTheme.rating ? activeTheme.rating.options.map((option) => ({ ...option, count: mapPoints.filter((point) => point.ratingKey === option.key).length })) : [];

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3600); }
  async function refreshActiveMap(){
    if(!liveMode)return;
    const [mapResponse,pointsResponse]=await Promise.all([fetch(`/api/v1/maps/${activeMap.id}`,{cache:"no-store"}),fetch(`/api/v1/maps/${activeMap.id}/observations`,{cache:"no-store"})]);
    const [mapPayload,pointsPayload]=await Promise.all([mapResponse.json(),pointsResponse.json()]);
    if(mapResponse.ok)setMaps(items=>items.map(item=>item.id===activeMap.id?{...item,...asDemoMap(mapPayload.data as LiveMap)}:item));
    if(pointsResponse.ok)setPoints(items=>[...items.filter(item=>item.mapId!==activeMap.id),...(pointsPayload.data.items as LiveObservation[]).map(point=>asDemoPoint(point,activeTheme))]);
  }
  function openMap(id: string) { setActiveMapId(id); setSelectedPointId(null); setInviteInfo(null); setFilter("all"); setShowList(false); setTab("map"); setScreen("workspace"); }
  function openCreate() { if (liveMode && liveSession?.kind !== "account") { window.location.assign("/api/v1/auth/google?returnTo=%2F"); return; } setCreateStep(0); setSelectedTheme(null); setNewTitle(""); setNewDescription(""); setNewLocation(""); setNewCenter(null); setNewVisibility("invite_only"); setNewActivityContext("community");setNewParticipation("invited");setNewModeration("immediate");setNewComments(true); setNewProposals(null); setCustomPinMode("single"); setCustomCategories([]); setScreen("create"); }
  function addCustomCategory() {
    const label = customCategoryName.trim();
    const glyph = customCategoryEmoji.trim();
    if (!label || !glyph) return;
    const key = `custom_${customCategories.length + 1}`;
    const emoji: EmojiOption = { key: `${key}-1`, glyph, label };
    setCustomCategories((items) => [...items, { key, label, color: ["#3b8372", "#d06c3a", "#8269ae", "#467ba7"][items.length % 4], defaultEmojiKey: emoji.key, emojiOptions: [emoji, { key: `${key}-2`, glyph: "📍", label: `${label} 위치` }] }]);
    setCustomCategoryName(""); setCustomCategoryEmoji("");
  }
  async function createMap() {
    if (!selectedTheme || !newTitle.trim() || !newLocation.trim() || (selectedTheme === "custom" && !customCategories.length)) return;
    if (liveMode) {
      if (liveSession?.kind !== "account" || !liveSession.csrfToken) { notify("Google 로그인이 필요합니다."); return; }
      try {
        const response = await fetch("/api/v1/maps", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": liveSession.csrfToken, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ themeKey: selectedTheme, themeVersion: 1, title: newTitle.trim(), description: newDescription.trim(), locationLabel: newLocation.trim(), activityContext: newActivityContext, visibility: newVisibility, participation:newParticipation,moderation:newModeration,commentsEnabled:newComments, center: newCenter, proposalsEnabled: newProposals ?? themeByKey[selectedTheme].features.proposalsEnabled, ...(selectedTheme === "custom" ? { custom: { categories: customCategories, pinMode: customPinMode } } : {}) }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "지도를 만들 수 없습니다.");
        const created = asDemoMap(payload.data as LiveMap);
        setMaps((items) => [created, ...items]); openMap(created.id); notify("지도가 저장됐어요. 참여자를 초대해 보세요!");
      } catch (error) { notify(error instanceof Error ? error.message : "지도를 만들 수 없습니다."); }
      return;
    }
    const base = themeByKey[selectedTheme];
    const newMap: MapWithSettings = { id: `demo_${Date.now()}`, title: newTitle.trim(), description: newDescription.trim() || themeDescription[selectedTheme], themeKey: selectedTheme, location: newLocation.trim(), author: "내가 만든 지도", isMine: true, visibility: newVisibility, accent: "mint", coverEmoji: selectedTheme === "custom" ? customCategories[0].emojiOptions[0].glyph : themeSymbol[selectedTheme], categories: selectedTheme === "custom" ? customCategories : undefined, pinMode: selectedTheme === "custom" ? customPinMode : undefined, rating: selectedTheme === "custom" && customPinMode === "rating" ? customRating : undefined, features: { ...base.features, ratingEnabled: selectedTheme === "custom" ? customPinMode === "rating" : base.features.ratingEnabled, proposalsEnabled: newProposals ?? base.features.proposalsEnabled } };
    setMaps((items) => [newMap, ...items]);
    openMap(newMap.id);
    notify("지도가 만들어졌어요. 첫 번째 발견을 기록해 보세요!");
  }
  function beginRecord() {
    if(liveMode && !activeMap.canCreateObservation) { notify("이 지도에서는 새 기록을 남길 수 없습니다."); return; }
    setDraft(makeDraft()); setDraftPhoto(null); setDraftCoordinates(null); setDraftSource("manual"); setEditingPointId(null); setEditingVersion(null); saveKeyRef.current=null; setRecordStep(0); setDraftPosition({ x: 52, y: 49 }); setTab("record"); setSelectedPointId(null);
  }
  function beginEdit(point:DemoPoint) {
    setDraft({title:point.title,body:point.body,categoryKey:point.categoryKey,emojiKey:point.emojiKey,ratingKey:point.ratingKey??"",location:point.locationLabel??activeMap.location,idea:point.idea??"",imageName:"",link:point.link??"",answers:point.rawAnswers??{}});
    setDraftCoordinates(point.location??null);setDraftSource(point.locationSource??"manual");setDraftPhoto(null);setEditingPointId(point.id);setEditingVersion(point.version??null);setRecordStep(0);setSelectedPointId(null);setTab("record");
  }
  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) { saveKeyRef.current=null; setDraft((current) => ({ ...current, [key]: value })); }
  function updateAnswer(key: string, values: string[]) { setDraft((current) => ({ ...current, answers: { ...current.answers, [key]: values } })); }
  function missingRequiredAnswers() { return activeTheme.questions.some((question) => question.required && !(draft.answers[question.key]?.[0] ?? "").trim()); }
  function answerLabels(question: Question, values: string[]) { return question.type === "text" ? values.join(" · ") : values.map((value) => answerChoices(question).find((option) => option.key === value)?.label ?? value).join(" · "); }
  function pickCategory(key: string) {
    const category = activeTheme.categories.find((item) => item.key === key);
    setDraft((current) => ({ ...current, categoryKey: key, emojiKey: category?.defaultEmojiKey ?? "" }));
  }
  async function uploadPhoto(mapId:string,pointId:string,file:File) {
    const response=await fetch(`/api/v1/maps/${encodeURIComponent(mapId)}/observations/${encodeURIComponent(pointId)}/photo`,{method:"POST",headers:{"Content-Type":file.type,"X-CSRF-Token":liveSession!.csrfToken!},body:file});
    const payload=await response.json();if(!response.ok) throw new Error(payload.error?.message??"사진을 저장하지 못했습니다.");return payload.data as {photoUrl:string;status:"pending"|"published";version:string};
  }
  async function retryPhoto() {
    if(!photoRetry) return;
    try {const photo=await uploadPhoto(photoRetry.mapId,photoRetry.pointId,photoRetry.file);setPoints((items)=>items.map((point)=>point.id===photoRetry.pointId?{...point,...photo}:point));setPhotoRetry(null);notify("사진이 저장됐어요.");}
    catch(error){notify(error instanceof Error?error.message:"사진을 다시 저장하지 못했습니다.");}
  }
  async function savePoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recordStep !== 2 || savingRef.current) return;
    if (!draft.location.trim() || !draft.title.trim() || !draft.categoryKey || draft.body.trim().length < 10 || (activeTheme.features.ratingEnabled && !draft.ratingKey) || missingRequiredAnswers()) { notify("필수 항목을 확인해 주세요."); return; }
    if (draft.link.trim()) { try { const url = new URL(draft.link.trim()); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol"); } catch { notify("링크는 http 또는 https 주소로 입력해 주세요."); return; } }
    if(liveMode) {
      if(!draftCoordinates) {notify("지도에서 정확한 위치를 선택해 주세요.");return;}
      if(!liveSession?.csrfToken || (!editingPointId&&!activeMap.canCreateObservation)) {notify("기록 권한을 확인해 주세요.");return;}
      savingRef.current=true;setSavingPoint(true);
      try {
        const payload={configRevision:activeMap.configRevision,title:draft.title.trim(),body:draft.body.trim(),locationLabel:draft.location.trim(),locationSource:draftSource,location:draftCoordinates,categoryKey:draft.categoryKey,emojiKey:draft.emojiKey,ratingKey:activeTheme.features.ratingEnabled?draft.ratingKey:null,answers:draft.answers,improvementIdea:activeTheme.features.ideasEnabled?draft.idea.trim():undefined,link:draft.link.trim()||undefined};
        const response=await fetch(`/api/v1/maps/${encodeURIComponent(activeMap.id)}/observations${editingPointId?`/${encodeURIComponent(editingPointId)}`:""}`,{method:editingPointId?"PATCH":"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":liveSession.csrfToken,...(editingPointId?{"If-Match":`"${editingVersion}"`}:{"Idempotency-Key":saveKeyRef.current??(saveKeyRef.current=crypto.randomUUID())})},body:JSON.stringify(payload)});
        const result=await response.json();if(!response.ok) throw new Error(result.error?.message??"기록을 저장하지 못했습니다.");
        const observation=result.data as LiveObservation;
        let point=asDemoPoint(observation,activeTheme);
        setPoints((items)=>[point,...items.filter((item)=>item.id!==point.id)]);
        saveKeyRef.current=null;
        if(draftPhoto) {
          try {const photo=await uploadPhoto(activeMap.id,point.id,draftPhoto);point={...point,...photo};setPoints((items)=>items.map((item)=>item.id===point.id?point:item));setPhotoRetry(null);}
          catch(error){setPhotoRetry({mapId:activeMap.id,pointId:point.id,file:draftPhoto});notify(`기록은 저장됐습니다. 사진은 다시 시도해 주세요: ${error instanceof Error?error.message:"업로드 실패"}`);}
        }
        setSelectedPointId(point.id);setTab("map");setShowList(false);if(!draftPhoto || point.photoUrl) notify(point.status==="pending"?"기록이 제출됐어요. 검수 후 공개됩니다.":"기록이 지도에 저장됐어요.");
      } catch(error) {notify(error instanceof Error?error.message:"기록을 저장하지 못했습니다.");}
      finally {savingRef.current=false;setSavingPoint(false);}
      return;
    }
    const answers = Object.fromEntries(activeTheme.questions.filter((question) => draft.answers[question.key]?.length).map((question) => [question.key, answerLabels(question, draft.answers[question.key])])) as Record<string, string>;
    const newPoint: DemoPoint = { id: `point_${Date.now()}`, mapId: activeMap.id, title: draft.title.trim(), body: draft.body.trim(), categoryKey: draft.categoryKey, emojiKey: draft.emojiKey, ratingKey: activeTheme.features.ratingEnabled ? draft.ratingKey : null, idea: activeTheme.features.ideasEnabled ? draft.idea.trim() : undefined, link: draft.link.trim() || undefined, imageName: draft.imageName || undefined, answers, x: draftPosition.x, y: draftPosition.y, author: "나", date: "방금", comments: [] };
    setPoints((items) => [newPoint, ...items]);
    setSelectedPointId(newPoint.id); setTab("map"); setShowList(false); notify("기록이 지도에 표시됐어요.");
  }
  function handlePhoto(event: ChangeEvent<HTMLInputElement>) { const file=event.target.files?.[0]??null;if(file && file.size>10*1024*1024){notify("사진은 10MB 이하여야 합니다.");return;}setDraftPhoto(file);updateDraft("imageName", file?.name??""); }
  function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPoint || !commentText.trim()) return;
    setPoints((items) => items.map((point) => point.id === selectedPoint.id ? { ...point, comments: [...(point.comments ?? []), commentText.trim()] } : point));
    setCommentText("");
  }
  function saveProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposalTitle.trim() || !proposalBody.trim()) return;
    setSavedProposal((current) => ({ ...current, [activeMap.id]: proposalTitle.trim() }));
    notify("제안서 초안이 이 화면에 저장됐어요.");
  }
  async function createShareInvite() {
    if (!liveSession?.csrfToken) { notify("다시 로그인해 주세요."); return; }
    try {
      const response = await fetch(`/api/v1/maps/${encodeURIComponent(activeMap.id)}/invites`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": liveSession.csrfToken }, body: "{}" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "초대를 만들 수 없습니다.");
      setInviteInfo({ code: payload.data.code, joinUrl: payload.data.joinUrl });
    } catch (error) { notify(error instanceof Error ? error.message : "초대를 만들 수 없습니다."); }
  }
  async function logout() {
    if (!liveSession?.csrfToken) return;
    try {
      const response = await fetch("/api/v1/session", { method: "DELETE", headers: { "X-CSRF-Token": liveSession.csrfToken } });
      if (!response.ok) throw new Error("로그아웃하지 못했습니다.");
      window.location.assign("/");
    } catch { notify("로그아웃하지 못했습니다."); }
  }

  return <div className="site-shell">
    <aside className="desktop-aside" aria-hidden="true">
      <div className="brand brand--desktop"><span className="brand__mark">✳</span> 모두의 지도</div>
      <div className="desktop-aside__content"><span className="eyebrow">MAP OF ALL · UX PREVIEW</span><h1>작은 발견이<br /><em>동네의 변화</em>가 되도록.</h1><p>주제를 고르고, 지도를 만들고, 우리 동네의 이야기를 함께 남겨요.</p><div className="desktop-aside__decor">🌳 <span>📍</span> 🏡</div></div>
      <div className="desktop-aside__footer">함께 찾고 · 함께 기록하고 · 함께 바꿔요</div>
    </aside>
    <main className="app-frame">
      {screen === "home" && <>
        <header className="home-header"><div className="brand"><span className="brand__mark">✳</span> 모두의 지도</div><button className="round-icon" type="button" aria-label="내 지도 보기" onClick={() => document.getElementById("my-maps")?.scrollIntoView({ behavior: "smooth" })}><Icon name="menu" /></button></header>
        <div className="home-scroll">
          <section className="hero"><div className="hero__text"><span className="eyebrow">우리 동네, 우리의 이야기</span><h1>함께 만드는<br /><em>모두의 지도</em></h1><p>발견한 곳에 이모지 하나씩.<br />여러분의 기록이 동네를 바꿔요.</p><button className="button button--dark" type="button" onClick={openCreate}>새 지도 만들기 <Icon name="chevron" size={18} /></button></div><div className="hero__graphic" aria-hidden="true"><div className="hero__bubble hero__bubble--one">🌳</div><div className="hero__bubble hero__bubble--two">🚸</div><div className="hero__bubble hero__bubble--three">♿</div><div className="hero__road" /></div></section>
          {liveMode && <div className="auth-banner"><div><strong>{liveSession?.kind === "account" ? "Google 계정으로 참여 중" : liveSession?.kind === "guest" ? "초대 지도로 참여 중" : "지도를 만들려면 로그인해 주세요"}</strong><small>지도 개설자는 Google 로그인, 참여자는 초대 코드로 입장해요.</small></div><div>{liveSession?.kind === "account" ? <button type="button" onClick={() => void logout()}>로그아웃</button> : !liveSession ? <a href="/api/v1/auth/google?returnTo=%2F">Google 로그인</a> : null}<a href="/join">초대 코드 입력</a></div></div>}
          <section className="home-section"><div className="section-heading"><div><span className="eyebrow">EXPLORE</span><h2>어떤 지도를 볼까요?</h2></div></div><label className="search-field"><Icon name="search" size={19} /><span className="sr-only">지도 검색</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="지도 이름, 지역, 주제로 찾아요" /></label><div className="map-cards">{visibleMaps.map((map) => <button key={map.id} type="button" className="map-card" onClick={() => openMap(map.id)}><span className={`map-card__art map-card__art--${map.accent}`}><span>{map.coverEmoji}</span><i /><b /></span><span className="map-card__body"><ThemePill themeKey={map.themeKey} /><strong>{map.title}</strong><small>{map.description}</small><span className="map-card__meta"><span><Icon name="pin" size={14} />{map.location}</span><span>{points.filter((point) => point.mapId === map.id).length}개의 발견</span></span></span><span className="map-card__arrow"><Icon name="chevron" size={19} /></span></button>)}</div>{visibleMaps.length === 0 && <EmptyState emoji="🔎" title="지도를 찾지 못했어요">다른 이름이나 지역으로 검색해 보세요.</EmptyState>}</section>
          <section className="home-section home-section--last" id="my-maps"><div className="section-heading"><div><span className="eyebrow">MY MAPS</span><h2>{liveMode ? "내가 참여한 지도" : "내가 만든 지도"}</h2></div></div><div className="my-map-list">{maps.filter((map) => map.isMine).map((map) => <button type="button" key={map.id} onClick={() => openMap(map.id)}><span className="my-map-list__emoji">{map.coverEmoji}</span><span><strong>{map.title}</strong><small>{map.visibility === "invite_only" ? "초대 전용" : "공개 지도"} · {themeByKey[map.themeKey].label}</small></span><Icon name="chevron" size={18} /></button>)}</div></section>{liveMode && liveSession?.kind==="account" && liveSession.csrfToken && <DeletedMaps csrfToken={liveSession.csrfToken} onNotice={notify}/>}</div>
        <nav className="bottom-nav" aria-label="홈 탐색"><button className="bottom-nav__item bottom-nav__item--active" type="button"><Icon name="map" /><span>지도 찾기</span></button><button className="bottom-nav__item" type="button" onClick={openCreate}><Icon name="plus" /><span>지도 만들기</span></button><button className="bottom-nav__item" type="button" onClick={() => document.getElementById("my-maps")?.scrollIntoView({ behavior: "smooth" })}><Icon name="users" /><span>내 지도</span></button></nav>
      </>}

      {screen === "create" && <>
        <header className="screen-header"><button className="round-icon" type="button" aria-label={createStep === 0 ? "홈으로 돌아가기" : "이전 단계"} onClick={() => createStep === 0 ? setScreen("home") : setCreateStep((step) => step - 1)}><Icon name="arrow" /></button><div><span className="screen-header__overline">새 지도 만들기</span><strong>{["주제 선택", "기본 정보", "지도 설정", "참여 설정", "미리보기"][createStep]}</strong></div><span className="step-count">{createStep + 1} / 5</span></header>
        <div className="step-progress" aria-label={`${createStep + 1}단계, 총 5단계`}>{[0,1,2,3,4].map((n) => <span key={n} className={n <= createStep ? "step-progress__active" : ""} />)}</div>
        <div className="flow-scroll">
          {createStep === 0 && <section className="flow-section"><span className="eyebrow">STEP 01 · THEME</span><h1>무엇을 함께<br />기록할까요?</h1><p className="lead">주제를 선택하면 기록 항목과 지도 아이콘이 알맞게 준비돼요.</p><div className="theme-grid">{themes.map((theme) => <button key={theme.key} type="button" className={`theme-card ${selectedTheme === theme.key ? "theme-card--selected" : ""}`} aria-pressed={selectedTheme === theme.key} onClick={() => { setSelectedTheme(theme.key); setNewProposals(null); }}><span className="theme-card__emoji">{themeSymbol[theme.key]}</span><span className="theme-card__copy"><strong>{theme.label}</strong><small>{themeDescription[theme.key]}</small></span><span className="theme-card__select">{selectedTheme === theme.key && <Icon name="check" size={15} />}</span></button>)}</div></section>}
          {createStep === 1 && <section className="flow-section"><span className="eyebrow">STEP 02 · BASICS</span><h1>지도에 이름을<br />붙여주세요.</h1><p className="lead">어떤 동네에서 무엇을 찾을지 알려주세요.</p><label className="field"><span>지도 이름 <b>*</b></span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={60} placeholder="예: 우리 동네 모두의 길" /></label><label className="field"><span>한 줄 소개</span><textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={300} rows={3} placeholder="이 지도에서 함께 기록하고 싶은 것은?" /></label><label className="field"><span>조사할 지역 <b>*</b></span><input value={newLocation} onChange={(event) => setNewLocation(event.target.value)} placeholder="예: 군산시 수송동" /></label>{liveMode ? <><div className="location-preview"><KakaoMap compact center={newCenter} chosen={newCenter} onPick={(location,source,label)=>{setNewCenter(location);if(label) setNewLocation(label);}}/></div><div className="info-card">📍 <span>장소를 검색하거나 지도를 눌러 시작 위치를 고를 수 있어요. 위치를 고르지 않으면 기본 위치에서 지도가 열립니다.</span></div></> : <div className="info-card">📍 <span>화면 시안에서는 지역 이름을 직접 적어요.</span></div>}</section>}
          {createStep === 2 && <section className="flow-section"><span className="eyebrow">STEP 03 · SETTINGS</span><h1>주제에 맞는<br />지도 준비 끝!</h1><p className="lead">기록할 유형과 지도에 보일 이모지를 확인해 주세요.</p>{createTheme && <><div className="summary-card"><ThemePill themeKey={createTheme.key} /><strong>{createTheme.label} 지도</strong><p>{previewPinMode === "rating" ? "핀 색상은 평가 결과를 보여줘요." : previewPinMode === "category" ? "핀 색상은 관찰 유형을 보여줘요." : "핀 색상은 하나로 표시돼요."} 모든 포인트에 주제별 이모지가 들어가요.</p></div>{selectedTheme === "custom" ? <><div className="subheading"><strong>내 분류 만들기</strong><span>1개 이상 필요해요</span></div><div className="custom-add"><input aria-label="분류 이름" placeholder="분류 이름" value={customCategoryName} onChange={(event) => setCustomCategoryName(event.target.value)} /><input aria-label="대표 이모지" placeholder="이모지" value={customCategoryEmoji} onChange={(event) => setCustomCategoryEmoji(event.target.value)} /><button type="button" aria-label="분류 추가" onClick={addCustomCategory}><Icon name="plus" size={19} /></button></div><div className="category-preview">{customCategories.map((category) => <span key={category.key}>{category.emojiOptions[0].glyph} {category.label}</span>)}</div><div className="field"><span>핀 색상 표시</span><div className="pin-mode-picker">{([{ key: "single", label: "한 가지 색" }, { key: "category", label: "유형별 색" }, { key: "rating", label: "평가별 색" }] as const).map((mode) => <button type="button" key={mode.key} className={customPinMode === mode.key ? "selected" : ""} aria-pressed={customPinMode === mode.key} onClick={() => setCustomPinMode(mode.key)}>{mode.label}</button>)}</div><small>이모지는 모든 방식에서 표시돼요. 평가별 색을 고르면 기록할 때 3단계 평가를 입력합니다.</small></div></> : <><div className="subheading"><strong>기록할 유형</strong><span>{createCategories.length}가지</span></div><div className="category-preview">{createCategories.map((category) => <span key={category.key}>{category.emojiOptions[0].glyph} {category.label}</span>)}</div>{createTheme.rating && <div className="feature-note"><strong>평가 기준</strong><div>{createTheme.rating.options.map((rating) => <span key={rating.key}><i style={{ backgroundColor: rating.color }} />{rating.label}</span>)}</div></div>}</>}<label className="toggle-row"><span><strong>개선 제안서</strong><small>관찰을 바탕으로 제안을 정리해요</small></span><input type="checkbox" checked={newProposals ?? createTheme.features.proposalsEnabled} onChange={(event) => setNewProposals(event.target.checked)} /></label></>}</section>}
          {createStep === 3 && <section className="flow-section"><span className="eyebrow">STEP 04 · PEOPLE</span><h1>누가 지도를<br />볼 수 있나요?</h1><p className="lead">친구들과만 조사하거나, 동네에 공개할 수 있어요.</p><div className="field"><span>활동 유형</span><div className="pin-mode-picker"><button type="button" className={newActivityContext === "community" ? "selected" : ""} onClick={() => {setNewActivityContext("community");setNewModeration("immediate");}}>일반 커뮤니티</button><button type="button" className={newActivityContext === "school" ? "selected" : ""} onClick={() => {setNewActivityContext("school");setNewModeration("approval");}}>학교 활동</button></div></div><label className="field"><span>기록 참여</span><select value={newParticipation} onChange={event=>setNewParticipation(event.target.value as "invited"|"admin_only"|"closed")}><option value="invited">초대 참여자도 기록</option><option value="admin_only">관리자만 기록</option><option value="closed">기록 마감</option></select></label><label className="field"><span>기록 공개</span><select value={newModeration} onChange={event=>setNewModeration(event.target.value as "immediate"|"approval")}><option value="immediate">등록 즉시 공개</option><option value="approval">관리자 승인 후 공개</option></select></label><label className="toggle-row"><span><strong>댓글 허용</strong><small>참여자가 게시 기록에 의견을 남겨요</small></span><input type="checkbox" checked={newComments} onChange={event=>setNewComments(event.target.checked)}/></label><div className="choice-stack"><button type="button" className={`choice-card ${newVisibility === "invite_only" ? "choice-card--selected" : ""}`} onClick={() => setNewVisibility("invite_only")}><span className="choice-card__icon">🔒</span><span><strong>초대받은 사람만</strong><small>초대 코드를 받은 사람만 지도를 보고 기록해요.</small></span><span className="radio-dot" /></button><button type="button" className={`choice-card ${newVisibility === "public" ? "choice-card--selected" : ""}`} onClick={() => setNewVisibility("public")}><span className="choice-card__icon">🌍</span><span><strong>누구나 볼 수 있게</strong><small>지도는 공개되고 기록은 초대받은 사람만 해요.</small></span><span className="radio-dot" /></button></div><div className="info-card">👋 <span>참여자는 초대 코드와 닉네임으로 입장해요. 지도 만들기는 Google 로그인이 필요합니다.</span></div></section>}
          {createStep === 4 && <section className="flow-section"><span className="eyebrow">STEP 05 · READY</span><h1>우리 지도를<br />살펴볼까요?</h1><p className="lead">준비한 내용을 확인하고 지도를 만들어 주세요.</p><div className="preview-cover"><span>{selectedTheme ? themeSymbol[selectedTheme] : "✨"}</span><div><ThemePill themeKey={selectedTheme ?? "custom"} /><strong>{newTitle || "지도 이름"}</strong><small><Icon name="pin" size={15} />{newLocation || "지역"}</small></div></div><div className="preview-list"><div><span>공개 범위</span><strong>{newVisibility === "public" ? "누구나 보기" : "초대받은 사람만"}</strong></div><div><span>포인트 아이콘</span><strong>{createCategories.length}개 유형의 이모지</strong></div><div><span>핀 색상</span><strong>{previewPinMode === "rating" ? "평가별" : previewPinMode === "category" ? "유형별" : "한 가지 색"}</strong></div><div><span>제안서</span><strong>{newProposals ?? createTheme?.features.proposalsEnabled ? "사용" : "사용 안 함"}</strong></div></div><p className="preview-notice">{liveMode ? "지도 설정과 위치 기록은 서버에 저장됩니다." : "화면 시안에서는 만든 지도와 기록이 새로고침하면 사라집니다."}</p></section>}
        </div>
        <div className="flow-footer"><button type="button" className="button button--primary" disabled={!isCreateValid} onClick={() => createStep < 4 ? setCreateStep((step) => step + 1) : createMap()}>{createStep === 4 ? "지도 만들기" : "다음으로"}<Icon name={createStep === 4 ? "check" : "chevron"} size={18} /></button></div>
      </>}

      {screen === "workspace" && <>
        <header className="workspace-header"><button type="button" className="round-icon" aria-label="지도 목록으로 돌아가기" onClick={() => { setScreen("home"); setSelectedPointId(null); }}><Icon name="arrow" /></button><div><span className="workspace-header__eyebrow">{themeSymbol[activeMap.themeKey]} {activeTheme.label} 지도</span><strong>{activeMap.title}</strong></div><button type="button" className="round-icon" aria-label="지도 정보 보기" onClick={() => { setTab("more"); setSelectedPointId(null); }}><Icon name="menu" /></button></header>
        {tab === "map" && <div className="workspace-body workspace-body--map"><div className="map-toolbar"><div className="map-toolbar__top"><div><span className="tiny-dot" /> {activeMap.location}</div><button type="button" onClick={() => setShowList((value) => !value)}><Icon name={showList ? "map" : "menu"} size={17} /> {showList ? "지도" : "목록"}</button></div><div className="filter-strip" aria-label="포인트 필터"><button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 <span>{mapPoints.length}</span></button>{activeTheme.pin.mode === "rating" && activeTheme.rating ? activeTheme.rating.options.map((option) => <button key={option.key} type="button" className={filter === `rating:${option.key}` ? "active" : ""} onClick={() => setFilter(`rating:${option.key}`)}><i style={{ backgroundColor: option.color }} />{option.label}</button>) : activeTheme.categories.map((category) => <button key={category.key} type="button" className={filter === `category:${category.key}` ? "active" : ""} onClick={() => setFilter(`category:${category.key}`)}>{category.emojiOptions[0].glyph} {category.label}</button>)}</div></div>{showList ? <div className="point-list">{filteredPoints.length ? filteredPoints.map((point) => <button className="point-row" key={point.id} type="button" onClick={() => { setSelectedPointId(point.id); setShowList(false); }}><span className="point-row__emoji" style={{ backgroundColor: getPinColor(activeTheme, point) }}>{getPointEmoji(activeTheme, point)?.glyph}</span><span><strong>{point.title}</strong><small>{activeTheme.categories.find((item) => item.key === point.categoryKey)?.label} · {point.date}</small></span><Icon name="chevron" size={17} /></button>) : <EmptyState emoji="📍" title="이 조건의 기록이 없어요">필터를 바꾸거나 새 기록을 남겨주세요.</EmptyState>}</div> : <div className="map-canvas">{liveMode ? <KakaoMap center={activeMap.center} points={filteredPoints.filter((point)=>!!point.location).map((point)=>({id:point.id,title:point.title,emoji:getPointEmoji(activeTheme,point)?.glyph??"📍",color:getPinColor(activeTheme,point),location:point.location!}))} selectedId={selectedPointId} onSelectPoint={setSelectedPointId}/> : <MapArtwork theme={activeTheme} points={filteredPoints} selectedId={selectedPointId ?? undefined} onSelect={setSelectedPointId} />}<button type="button" className="map-floating-action" aria-label="새 기록 남기기" onClick={beginRecord}><Icon name="plus" size={24} /></button><div className="map-legend"><strong>함께 찾은 기록 <b>{filteredPoints.length}</b></strong><div>{activeTheme.pin.mode === "rating" ? statusCounts.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label} {item.count}</span>) : <span>색상은 관찰 유형을 나타내요</span>}</div></div></div>}</div>}

        {tab === "record" && <form className="record-layout" onSubmit={savePoint}><div className="record-progress"><span>새로운 발견 기록</span><strong>{recordStep + 1} / 3</strong></div><div className="step-progress" aria-label={`${recordStep + 1}단계, 총 3단계`}>{[0,1,2].map((n) => <span key={n} className={n <= recordStep ? "step-progress__active" : ""} />)}</div><div className="record-scroll">{recordStep === 0 && <section className="flow-section"><span className="eyebrow">01 · PLACE</span><h1>어디에서<br />발견했나요?</h1><p className="lead">지도를 눌러 위치를 고르고, 장소 이름을 적어주세요.</p><div className="location-preview">{liveMode ? <KakaoMap compact center={activeMap.center} chosen={draftCoordinates} onPick={(location,source,label)=>{setDraftCoordinates(location);setDraftSource(source);updateDraft("location",label || draft.location || "지도에서 선택한 위치");}}/> : <><MapArtwork theme={activeTheme} points={[]} compact choosePosition={(x, y) => { setDraftPosition({ x, y }); updateDraft("location", draft.location || "지도에서 선택한 위치"); }} /><span className="location-preview__marker" style={{ left: `${draftPosition.x}%`, top: `${draftPosition.y}%` }}>📍</span></>}</div><label className="field"><span>위치 또는 장소 이름 <b>*</b></span><input value={draft.location} onChange={(event) => updateDraft("location", event.target.value)} placeholder="예: 공원 북쪽 입구" /></label></section>}{recordStep === 1 && <section className="flow-section"><span className="eyebrow">02 · DISCOVERY</span><h1>무엇을<br />발견했나요?</h1><p className="lead">관찰한 유형을 고르면 알맞은 이모지가 준비돼요.</p><label className="field"><span>기록 제목 <b>*</b></span><input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} maxLength={60} placeholder="예: 공원 입구의 높은 턱" /></label><div className="field"><span>관찰 유형 <b>*</b></span><div className="category-picker">{activeTheme.categories.map((category) => <button key={category.key} className={draft.categoryKey === category.key ? "selected" : ""} type="button" onClick={() => pickCategory(category.key)}><span>{category.emojiOptions[0].glyph}</span>{category.label}</button>)}</div></div>{draft.categoryKey && <div className="field"><span>이모지 선택</span><div className="emoji-picker">{activeTheme.categories.find((item) => item.key === draft.categoryKey)?.emojiOptions.map((emoji) => <button key={emoji.key} className={draft.emojiKey === emoji.key ? "selected" : ""} type="button" title={emoji.label} aria-label={emoji.label} aria-pressed={draft.emojiKey === emoji.key} onClick={() => updateDraft("emojiKey", emoji.key)}>{emoji.glyph}<small>{emoji.label}</small></button>)}</div></div>}{activeTheme.features.ratingEnabled && activeTheme.rating && <div className="field"><span>{activeTheme.rating.label} <b>*</b></span><div className="rating-picker">{activeTheme.rating.options.map((option) => <button key={option.key} className={draft.ratingKey === option.key ? "selected" : ""} type="button" aria-pressed={draft.ratingKey === option.key} onClick={() => updateDraft("ratingKey", option.key)}><i style={{ backgroundColor: option.color }}>{option.symbol}</i>{option.label}</button>)}</div></div>}<label className="field"><span>관찰한 내용 <b>*</b></span><textarea rows={4} value={draft.body} onChange={(event) => updateDraft("body", event.target.value)} maxLength={2000} placeholder="무엇을 보았는지 자세히 적어주세요." /><small>{draft.body.length} / 2,000 · 10자 이상</small></label>{activeTheme.questions.length > 0 && <QuestionInputs questions={activeTheme.questions} answers={draft.answers} onChange={updateAnswer} />}</section>}{recordStep === 2 && <section className="flow-section"><span className="eyebrow">03 · FINISH</span><h1>마지막으로<br />확인해 주세요.</h1><p className="lead">{activeTheme.features.ideasEnabled ? "사진과 개선 아이디어가 있으면 함께 남겨주세요." : "사진이나 관련 링크가 있으면 함께 남겨주세요."}</p><label className="photo-picker"><Icon name="camera" size={28} /><strong>{draft.imageName || "사진을 선택해 주세요"}</strong><small>{liveMode ? "최대 10MB · 사진의 위치정보는 제거돼요" : "화면 시안 · 업로드는 연결 전"}</small><input type="file" accept="image/*" onChange={handlePhoto} /></label><label className="field"><span>관련 링크 (선택)</span><input type="url" value={draft.link} onChange={(event) => updateDraft("link", event.target.value)} placeholder="https://example.com" /></label>{activeTheme.features.ideasEnabled && <label className="field"><span>개선 아이디어</span><textarea rows={4} value={draft.idea} onChange={(event) => updateDraft("idea", event.target.value)} maxLength={1000} placeholder="어떻게 바꾸면 더 좋을까요?" /></label>}<div className="record-review"><span className="record-review__emoji">{activeTheme.categories.find((item) => item.key === draft.categoryKey)?.emojiOptions.find((item) => item.key === draft.emojiKey)?.glyph ?? "📍"}</span><div><strong>{draft.title || "제목을 입력해 주세요"}</strong><small>{draft.location || "위치를 선택해 주세요"}</small><p>{draft.body || "관찰 내용을 입력해 주세요"}</p></div></div>{!liveMode && <div className="info-card">🌱 <span>이 화면은 시안입니다. 등록한 기록은 현재 화면에서만 볼 수 있어요.</span></div>}</section>}</div><div className="flow-footer flow-footer--split">{recordStep > 0 && <button className="button button--light" type="button" onClick={() => setRecordStep((step) => step - 1)}>이전</button>}<button className="button button--primary" type="button" disabled={savingPoint} onClick={(event) => { if (recordStep === 2) { event.currentTarget.closest("form")?.requestSubmit(); return; } if (recordStep === 0 && (!draft.location.trim() || (liveMode && !draftCoordinates))) { notify("지도에서 위치를 선택하고 장소 이름을 입력해 주세요."); return; } if (recordStep === 1 && (!draft.title.trim() || !draft.categoryKey || draft.body.trim().length < 10 || (activeTheme.features.ratingEnabled && !draft.ratingKey) || missingRequiredAnswers())) { notify("제목, 유형, 관찰 내용과 필수 질문을 확인해 주세요."); return; } setRecordStep((step) => step + 1); }}>{recordStep === 2 ? (savingPoint ? "저장 중..." : editingPointId ? "수정 저장" : "기록 남기기") : "다음"}<Icon name={recordStep === 2 ? "check" : "chevron"} size={18} /></button></div></form>}

        {tab === "analysis" && <div className="content-scroll"><section className="content-heading"><span className="eyebrow">OUR DATA</span><h1>우리가 발견한<br /><em>동네 이야기</em></h1><p>함께 모은 기록을 한눈에 살펴봐요.</p></section><div className="stat-hero"><span>이 지도에 모인 기록</span><strong>{mapPoints.length}<small>곳</small></strong><p>지금까지 남긴 발견을 기준으로 보여줘요.</p></div>{activeTheme.features.ratingEnabled && activeTheme.rating && <section className="chart-card"><div className="subheading"><strong>{activeTheme.rating.label} 분포</strong><span>기록 {mapPoints.length}개</span></div><div className="stacked-bar">{statusCounts.map((item) => <span key={item.key} style={{ width: `${mapPoints.length ? (item.count / mapPoints.length) * 100 : 0}%`, backgroundColor: item.color }} />)}</div><div className="chart-legend">{statusCounts.map((item) => <div key={item.key}><span><i style={{ backgroundColor: item.color }} />{item.label}</span><strong>{item.count}</strong></div>)}</div></section>}<section className="chart-card"><div className="subheading"><strong>많이 기록한 유형</strong><span>{activeTheme.categories.length}가지 유형</span></div><div className="bar-list">{activeTheme.categories.map((category) => ({ ...category, count: mapPoints.filter((item) => item.categoryKey === category.key).length })).sort((a, b) => b.count - a.count).map((category) => <div className="bar-list__row" key={category.key}><span className="bar-list__emoji">{category.emojiOptions[0].glyph}</span><span className="bar-list__label">{category.label}</span><div className="bar-list__track"><span style={{ width: `${mapPoints.length ? Math.max(4, (category.count / mapPoints.length) * 100) : 0}%`, backgroundColor: category.color }} /></div><b>{category.count}</b></div>)}</div></section><div className="info-card">💡 <span>{liveMode ? "현재 보이는 기록 기준의 임시 분석입니다. 집계 API와 전체 필터 일치는 6단계에서 연결됩니다." : "이 결과는 화면에 담긴 예시 기록을 분석한 시안입니다. 실제 통계는 데이터 연결 단계에서 제공돼요."}</span></div></div>}

        {tab === "proposal" && proposalEnabled && <div className="content-scroll"><section className="content-heading"><span className="eyebrow">MAKE A CHANGE</span><h1>발견에서<br /><em>변화로.</em></h1><p>함께 모은 기록을 바탕으로 개선할 방법을 적어보세요.</p></section><div className="proposal-banner"><span>💡</span><div><strong>작은 제안이 큰 변화를 만들어요</strong><p>문제와 아이디어를 간단히 정리해 보세요.</p></div></div>{savedProposal[activeMap.id] && <div className="saved-draft"><span>작성한 초안</span><strong>{savedProposal[activeMap.id]}</strong><small>현재 화면에서만 보이는 시안이에요</small></div>}<form className="proposal-form" onSubmit={saveProposal}><label className="field"><span>제안 제목</span><input value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} placeholder="예: 횡단보도 앞 경사로 만들기" required /></label><label className="field"><span>어떤 문제를 발견했나요?</span><textarea value={proposalBody} onChange={(event) => setProposalBody(event.target.value)} rows={5} placeholder="발견한 문제와 개선 방법을 적어주세요." required /></label><div className="evidence-card"><strong>📍 이 지도의 기록 {mapPoints.length}개</strong><small>완성된 제안서에는 관련 기록을 근거로 연결할 수 있어요.</small></div><button className="button button--primary" type="submit">초안 저장하기 <Icon name="chevron" size={18} /></button></form></div>}

        {tab === "more" && <div className="content-scroll"><section className="content-heading"><span className="eyebrow">ABOUT THIS MAP</span><h1>{activeMap.title}</h1><p>{activeMap.description}</p></section><div className="about-card"><ThemePill themeKey={activeMap.themeKey} /><div><span><Icon name="pin" size={17} />{activeMap.location}</span><span><Icon name="users" size={17} />{activeMap.author}</span><span><Icon name="clock" size={17} />{activeMap.visibility === "public" ? "공개 지도" : "초대 전용 지도"}</span></div></div><div className="subheading"><strong>이 지도에서 기록할 것</strong></div><div className="category-preview">{activeTheme.categories.map((category) => <span key={category.key}>{category.emojiOptions[0].glyph} {category.label}</span>)}</div><div className="info-card">🗺️ <span>{liveMode ? "지도와 기록은 서버에 저장됩니다. 분석·제안 화면은 후속 단계에서 연결됩니다." : "지도와 기록은 화면 시안용 데이터입니다. 로그인·초대·실제 카카오맵은 다음 구현 단계에서 연결돼요."}</span></div>{liveMode && activeMap.canManageMap && <div className="invite-panel"><strong>참여자 초대</strong><p>초대 코드는 생성할 때 한 번만 표시됩니다.</p><button type="button" onClick={() => void createShareInvite()}>새 초대 코드 만들기</button>{inviteInfo && <div><b>{inviteInfo.code}</b><small>{inviteInfo.joinUrl}</small><button type="button" onClick={() => void navigator.clipboard.writeText(inviteInfo.joinUrl).then(() => notify("초대 링크를 복사했어요."))}>링크 복사</button></div>}</div>}{liveMode && activeMap.isMine && <MyRecords mapId={activeMap.id} onNotice={notify} onSelect={record=>{const item=record as LiveObservation;if(item.status==="hidden"||item.status==="deleted"){notify(item.status==="hidden"?"관리자가 숨긴 기록입니다.":"삭제된 기록입니다.");return;}const point=asDemoPoint(item,activeTheme);setPoints(items=>[point,...items.filter(value=>value.id!==point.id)]);setSelectedPointId(point.id);setTab("map");}}/>}{liveMode && activeMap.canManageMap && liveSession?.csrfToken && activeMap.version && activeMap.participation && activeMap.moderation && activeMap.status && <ModerationCenter mapId={activeMap.id} csrfToken={liveSession.csrfToken} isOwner={!!activeMap.isOwner} settings={{visibility:activeMap.visibility,participation:activeMap.participation,moderation:activeMap.moderation,commentsEnabled:!!activeMap.commentsEnabled,status:activeMap.status,version:activeMap.version}} onNotice={notify} onChanged={()=>{void refreshActiveMap();}} onDeleted={()=>window.location.reload()}/>}<button className="button button--light button--full" type="button" onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(window.location.href).then(() => notify("현재 화면 주소를 복사했어요.")).catch(() => notify("주소 복사가 허용되지 않았어요.")); }}><Icon name="share" size={18} /> 화면 주소 복사</button></div>}

        <nav className="bottom-nav bottom-nav--workspace" aria-label="지도 메뉴"><button type="button" className={`bottom-nav__item ${tab === "map" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("map"); setSelectedPointId(null); }}><Icon name="map" /><span>지도</span></button><button type="button" className={`bottom-nav__item ${tab === "record" ? "bottom-nav__item--active" : ""}`} onClick={beginRecord}><span className="bottom-nav__create"><Icon name="plus" size={24} /></span><span>기록</span></button><button type="button" className={`bottom-nav__item ${tab === "analysis" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("analysis"); setSelectedPointId(null); }}><Icon name="chart" /><span>분석</span></button>{proposalEnabled && <button type="button" className={`bottom-nav__item ${tab === "proposal" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("proposal"); setSelectedPointId(null); }}><Icon name="note" /><span>제안</span></button>}<button type="button" className={`bottom-nav__item ${tab === "more" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("more"); setSelectedPointId(null); }}><Icon name="menu" /><span>더보기</span></button></nav>
        {selectedPoint && tab === "map" && <div className="sheet-backdrop" onClick={() => setSelectedPointId(null)}><section className="point-sheet" role="dialog" aria-modal="true" aria-label={`${selectedPoint.title} 상세 기록`} onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><button type="button" className="sheet-close" aria-label="상세 닫기" onClick={() => setSelectedPointId(null)}><Icon name="close" size={21} /></button><div className="point-sheet__title"><span className="point-sheet__emoji" style={{ backgroundColor: getPinColor(activeTheme, selectedPoint) }}>{getPointEmoji(activeTheme, selectedPoint)?.glyph}</span><div><small>{activeTheme.categories.find((item) => item.key === selectedPoint.categoryKey)?.label} · {selectedPoint.date}</small><h2>{selectedPoint.title}</h2></div></div>{activeTheme.rating && selectedPoint.ratingKey && <div className="sheet-rating"><i style={{ backgroundColor: activeTheme.rating.options.find((item) => item.key === selectedPoint.ratingKey)?.color }} />{activeTheme.rating.options.find((item) => item.key === selectedPoint.ratingKey)?.label}</div>}<p className="sheet-body">{selectedPoint.body}</p>{selectedPoint.photoUrl ? <img className="sheet-photo" src={selectedPoint.photoUrl} alt={`${selectedPoint.title} 현장 사진`}/> : selectedPoint.imageName && <div className="sheet-attachment">📷 첨부한 사진: {selectedPoint.imageName} <small>화면 시안 · 파일은 저장되지 않음</small></div>}{selectedPoint.link && <a className="sheet-link" href={selectedPoint.link} target="_blank" rel="noopener noreferrer">🔗 관련 링크 열기</a>}{selectedPoint.answers && Object.keys(selectedPoint.answers).length > 0 && <div className="sheet-answers">{Object.entries(selectedPoint.answers).map(([key, value]) => <span key={key}><b>{activeTheme.questions.find((item) => item.key === key)?.label ?? key}</b>{value}</span>)}</div>}{selectedPoint.idea && activeTheme.features.ideasEnabled && <div className="sheet-idea"><strong>💡 개선 아이디어</strong><p>{selectedPoint.idea}</p></div>}<div className="sheet-meta">기록한 사람 · {selectedPoint.author}{selectedPoint.status==="pending" && " · 검수 대기"}</div>{liveMode && selectedPoint.canEdit && <button type="button" className="button button--light button--full" onClick={()=>beginEdit(selectedPoint)}>기록 수정</button>}{liveMode && photoRetry?.pointId===selectedPoint.id && <button type="button" className="button button--light button--full" onClick={()=>void retryPhoto()}>사진 업로드 다시 시도</button>}{activeTheme.features.commentsEnabled && !liveMode && <div className="sheet-comments"><strong>댓글 {selectedPoint.comments?.length ?? 0}</strong>{selectedPoint.comments?.map((comment, i) => <p key={i}>{comment}</p>)}<form onSubmit={addComment}><label className="sr-only" htmlFor="comment-input">댓글 입력</label><input id="comment-input" value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={500} placeholder="의견을 남겨주세요" /><button type="submit" disabled={!commentText.trim()}>등록</button></form><small>화면 시안 · 댓글은 현재 화면에서만 유지됩니다.</small></div>}{liveMode && selectedPoint.status==="published" && <>{liveSession?.csrfToken && (selectedPoint.canDelete||activeMap.canManageMap) && selectedPoint.version && <ObservationActions mapId={activeMap.id} id={selectedPoint.id} version={selectedPoint.version} canDelete={!!selectedPoint.canDelete} canModerate={!!activeMap.canManageMap} csrfToken={liveSession.csrfToken} onNotice={notify} onChanged={()=>{setSelectedPointId(null);void refreshActiveMap();}}/>}<CommentSection mapId={activeMap.id} observationId={selectedPoint.id} enabled={!!activeMap.commentsEnabled} canWrite={!!activeMap.canComment} canModerate={!!activeMap.canManageMap} csrfToken={liveSession?.csrfToken??null} onNotice={notify}/>{activeMap.isMine && activeMap.status==="active" && liveSession?.csrfToken && <ReportAction mapId={activeMap.id} targetType="observation" targetId={selectedPoint.id} csrfToken={liveSession.csrfToken} onNotice={notify}/>}</>}</section></div>}
      </>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  </div>;
}
