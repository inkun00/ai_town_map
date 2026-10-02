"use client";
import MapOwnerDelete from "@/components/MapOwnerDelete";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {AnalysisPanel,type AnalysisData} from "@/components/AnalysisControls";
import {ProposalWorkspace} from "@/components/ProposalWorkspace";
import {aggregateRecords,type ObservationFilter} from "@/domain/analysis";
import {FeatureSettings} from "@/components/FeatureSettings";
import {preparePhoto,uploadPreparedPhoto,UploadError} from "@/lib/photo-upload";
import {draftKey,readDrafts,saveDraft,clearDrafts,type SavedRecordDraft} from "@/lib/record-draft";
import {pointRating,pointDescription} from "@/domain/point-presentation";
import {MapDirectory} from "@/components/MapDirectory";
import type {LiveMap} from "@/lib/map-directory";
import {RatingLabel} from "@/components/MapMeaning";
import {PointDialog} from "@/components/PointDialog";
import {EmojiPicker} from "@/components/EmojiPicker";
import {ExplorerGuide,GameIcon} from "@/components/AdventureArt";
import {MapWorkspace} from "@/components/MapWorkspace";
import KakaoMap, { type Coordinates } from "@/components/KakaoMap";
import { CommentSection,DeletedMaps,ModerationCenter,MyRecords,ObservationActions,ReportAction } from "@/components/CommunityControls";
import {
  Category,
  DemoMap,
  DemoPoint,
  EmojiOption,
  emojiLibrary,
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
type LiveSession = { draftScope:string; kind: "account" | "guest"; accountRole:import("@/domain/account").AccountRole|null; canCreateMap:boolean; expiresAt: string; csrfToken: string | null };

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
      const rating=pointRating(theme,point);
      return <button key={point.id} className={`map-pin ${selectedId === point.id ? "map-pin--active" : ""}`} type="button" style={{ left: `${point.x}%`, top: `${point.y}%`, backgroundColor: getPinColor(theme, point) }} aria-label={pointDescription(theme,point)} onClick={() => onSelect?.(point.id)}>
        <span aria-hidden="true">{emoji?.glyph ?? "📍"}{rating&&<b className="map-pin-symbol">{rating.symbol}</b>}</span>
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
  const [filter, setFilter] = useState<ObservationFilter>({});
  const [analysis,setAnalysis]=useState<AnalysisData|null>(null);
  const [dataLoading,setDataLoading]=useState(false);
  const [dataError,setDataError]=useState("");
  const [dataKey,setDataKey]=useState("");
  const [datasetIds,setDatasetIds]=useState<Set<string>>(new Set());
  const [reloadData,setReloadData]=useState(0);
  const [mapBounds,setMapBounds]=useState<ObservationFilter["bbox"]>();
  const filterKey=JSON.stringify(filter);
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
  const [customExtraEmojis,setCustomExtraEmojis]=useState<EmojiOption[]>([]);
  const [recordStep, setRecordStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(makeDraft());
  const [draftPosition, setDraftPosition] = useState({ x: 52, y: 49 });
  const [draftCoordinates, setDraftCoordinates] = useState<Coordinates | null>(null);
  const [draftSource, setDraftSource] = useState<"gps" | "search" | "manual">("manual");
  const [draftPhoto, setDraftPhoto] = useState<File | null>(null);
  const [savingPoint, setSavingPoint] = useState(false);
  const requestRef=useRef<SavedRecordDraft["request"]>(null);
  const draftContext=useRef<{mapId:string;editingId:string|null}|null>(null);
  const [recoverable,setRecoverable]=useState<SavedRecordDraft[]>([]);
  const [draftStorageError,setDraftStorageError]=useState("");
  const [savedPointId,setSavedPointId]=useState<string|null>(null);
  const savedPointRef=useRef<string|null>(null);
  const [photoPreparing,setPhotoPreparing]=useState(false);
  const photoSelection=useRef(0);
  const photoPreparingRef=useRef(false);
  const [photoInfo,setPhotoInfo]=useState("");
  const [saveError,setSaveError]=useState("");
  const [needsLogin,setNeedsLogin]=useState(false);
  const [uploadProgress,setUploadProgress]=useState<number|null>(null);
  const [retryingPhoto,setRetryingPhoto]=useState(false);
  const retryingRef=useRef(false);
  const savingRef = useRef(false);
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<string | null>(null);
  const [photoRetry, setPhotoRetry] = useState<{ mapId:string; pointId: string; file: File;editingId:string|null } | null>(null);
  const [toast, setToast] = useState("");
  const [commentText, setCommentText] = useState("");
  const [bootError,setBootError]=useState("");
  const [bootAttempt,setBootAttempt]=useState(0);
  const [liveMode, setLiveMode] = useState<boolean | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ code: string; joinUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const statusResponse = await fetch("/api/v1/status", { cache: "no-store" });
        if(!statusResponse.ok)throw new Error("서버에 연결하지 못했습니다. 다시 시도해 주세요.");
        const status=await statusResponse.json();
        if (!status.data?.configured) { if (!cancelled) setLiveMode(false); return; }
        const sessionResponse = await fetch("/api/v1/session", { cache: "no-store" });
        const sessionPayload = await sessionResponse.json();
        if (!sessionResponse.ok) throw new Error(sessionPayload.error?.message ?? "세션을 불러올 수 없습니다.");
        const session = sessionPayload.data as LiveSession | null;
        const merged = new Map<string, LiveMap>();
        const directMap = new URLSearchParams(window.location.search).get("map");
        if (directMap && !merged.has(directMap)) {
          const response = await fetch(`/api/v1/maps/${encodeURIComponent(directMap)}`, { cache: "no-store" });
          if (response.ok) { const payload = await response.json(); merged.set(directMap, payload.data as LiveMap); }
        }
        if (cancelled) return;
        setMaps([...merged.values()].map(asDemoMap));
        setLiveSession(session);
        setLiveMode(true);
        if (directMap && merged.has(directMap)) { setActiveMapId(directMap); setScreen("workspace"); setSelectedPointId(new URLSearchParams(window.location.search).get("point")); window.history.replaceState(null, "", `/?map=${encodeURIComponent(directMap)}`); }
      } catch (error) { if (!cancelled) { setBootError(error instanceof Error ? error.message : "서버에 연결할 수 없습니다."); } }
    })();
    return () => { cancelled = true; };
  }, [bootAttempt]);

  useEffect(() => {
    if (!liveMode || screen !== "workspace") return;
    let cancelled=false;setDataLoading(true);setDataError("");
    void (async()=>{
      try {
        const [configuration,response]=await Promise.all([fetch(`/api/v1/maps/${activeMapId}/configuration`,{cache:"no-store"}),fetch(`/api/v1/maps/${activeMapId}/analysis?filter=${encodeURIComponent(filterKey)}`,{cache:"no-store"})]);
        const [config,payload]=await Promise.all([configuration.json(),response.json()]);
        if(!configuration.ok||!response.ok)throw new Error(config.error?.message??payload.error?.message??"기록을 불러오지 못했습니다.");
        if(cancelled)return;
        const theme=config.data.theme as Theme;
        setMaps(items=>items.map(item=>item.id===activeMapId?{...item,categories:theme.categories,features:theme.features,pinMode:theme.pin.mode,rating:theme.rating,configRevision:config.data.configRevision}:item));
        setPoints(items=>[...items.filter(item=>item.mapId!==activeMapId),...(payload.data.items as LiveObservation[]).map(point=>asDemoPoint(point,theme))]);
        setAnalysis(payload.data as AnalysisData);setDatasetIds(new Set((payload.data.items as LiveObservation[]).map(point=>point.id)));setDataKey(activeMapId+filterKey);
      }catch(error){if(!cancelled){setDataError(error instanceof Error?error.message:"기록을 불러오지 못했습니다.");setAnalysis(null);setPoints(items=>items.filter(item=>item.mapId!==activeMapId));}}
      finally{if(!cancelled)setDataLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[liveMode,screen,activeMapId,filterKey,reloadData]);

  const activeMap = maps.find((item) => item.id === activeMapId) ?? maps[0] ?? initialMaps[0];
  const activeTheme = resolveTheme(activeMap);
  const mapPoints = points.filter((point) => point.mapId === activeMap.id && (!liveMode || point.status === "published"));
  const datasetReady=!liveMode||(!dataLoading&&!dataError&&dataKey===activeMap.id+filterKey);
  const filteredPoints=datasetReady?mapPoints.filter(point=>(!liveMode||datasetIds.has(point.id))&&(!filter.category||point.categoryKey===filter.category)&&(!filter.rating||point.ratingKey===filter.rating)):[];
  const displayedAnalysis=liveMode?analysis:{stats:aggregateRecords(filteredPoints.map(point=>({id:point.id,categoryKey:point.categoryKey,ratingKey:point.ratingKey,answers:point.rawAnswers??{},createdAt:"2026-09-25T00:00:00Z",configRevision:1})),activeTheme),dataRevision:"0",generatedAt:new Date().toISOString(),filterFingerprint:"demo",filter};
  const selectedPoint = points.find((item) => item.id === selectedPointId && item.mapId === activeMap.id) ?? null;
  const createTheme = selectedTheme ? themeByKey[selectedTheme] : null;
  const previewPinMode = selectedTheme === "custom" ? customPinMode : createTheme?.pin.mode;
  const createCategories = selectedTheme === "custom" ? customCategories : createTheme?.categories ?? [];
  const proposalEnabled = activeTheme.features.proposalsEnabled;
  const isCreateValid = createStep === 0 ? !!selectedTheme : createStep === 1 ? newTitle.trim().length >= 2 && newLocation.trim().length > 0 : createStep === 2 ? selectedTheme !== "custom" || customCategories.length > 0 : true;

  const visibleMaps = useMemo(() => maps.filter((map) => map.status!=="archived" && `${map.title} ${map.location} ${themeByKey[map.themeKey].label}`.toLowerCase().includes(search.toLowerCase())), [maps, search]);

  function refreshDraftList(){
    if(!liveSession?.draftScope)return;
    try{setRecoverable(readDrafts(sessionStorage,liveSession.draftScope,activeMap.id));}catch{setDraftStorageError("이 브라우저에서는 임시 저장을 사용할 수 없습니다. 페이지를 닫기 전에 기록을 저장해 주세요.");}
  }
  useEffect(()=>{
    if(!liveMode||!liveSession?.draftScope||screen!=="workspace")return;
    try{setRecoverable(readDrafts(sessionStorage,liveSession.draftScope,activeMap.id));}catch{setDraftStorageError("이 브라우저에서는 임시 저장을 사용할 수 없습니다.");}
  },[liveMode,liveSession?.draftScope,activeMap.id,screen,tab]);
  function persistDraft(){
    const context=draftContext.current;
    if(!liveMode||!liveSession?.draftScope||!context||context.mapId!==activeMap.id)return;
    try{saveDraft(sessionStorage,liveSession.draftScope,{format:1,updatedAt:Date.now(),mapId:context.mapId,editingId:context.editingId,editingVersion,configRevision:activeMap.configRevision??1,draft,coordinates:draftCoordinates,source:draftSource,step:recordStep,request:requestRef.current,savedPointId:savedPointRef.current});setDraftStorageError("");}
    catch{setDraftStorageError("임시 저장 공간이 부족하거나 사용할 수 없습니다. 이 화면을 유지한 채 기록을 저장해 주세요.");}
  }
  useEffect(()=>{if(screen==="workspace"&&tab==="record")persistDraft();},[draft,draftCoordinates,draftSource,recordStep,editingVersion,screen,tab,activeMap.id,liveSession?.draftScope]);
  function finishDraft(){
    const context=draftContext.current;draftContext.current=null;
    if(context&&liveSession?.draftScope){try{sessionStorage.removeItem(draftKey(liveSession.draftScope,context.mapId,context.editingId));}catch{setDraftStorageError("임시 저장 내용을 지우지 못했습니다.");}}
    requestRef.current=null;savedPointRef.current=null;setSavedPointId(null);refreshDraftList();
  }
  function restoreDraft(value:SavedRecordDraft){
    if(savingRef.current||retryingRef.current)return;
    photoSelection.current++;photoPreparingRef.current=false;setPhotoPreparing(false);setPhotoInfo("");setSaveError("");setNeedsLogin(false);
    draftContext.current={mapId:activeMap.id,editingId:value.editingId};requestRef.current=value.request;savedPointRef.current=value.savedPointId;setSavedPointId(value.savedPointId);
    setDraft(value.draft);setDraftCoordinates(value.coordinates);setDraftSource(value.source);setDraftPhoto(null);setEditingPointId(value.editingId);setEditingVersion(value.editingVersion);setRecordStep(value.savedPointId?2:value.step);setTab("record");setSelectedPointId(null);
    notify(value.draft.imageName?"작성 내용을 복구했어요. 사진 파일은 다시 선택해 주세요.":"작성 내용을 복구했어요.");
  }
  function discardDraft(value:SavedRecordDraft){
    if(!liveSession?.draftScope)return;
    try{sessionStorage.removeItem(draftKey(liveSession.draftScope,activeMap.id,value.editingId));refreshDraftList();}catch{notify("임시 저장 내용을 지우지 못했습니다.");}
  }
  function resetPhotoState(){photoSelection.current++;photoPreparingRef.current=false;setPhotoPreparing(false);setPhotoInfo("");setSaveError("");setNeedsLogin(false);setUploadProgress(null);}

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3600); }
  async function refreshActiveMap(){
    if(!liveMode)return;
    setReloadData(value=>value+1);
    const response=await fetch(`/api/v1/maps/${activeMap.id}`,{cache:"no-store"});const payload=await response.json();
    if(response.ok)setMaps(items=>items.map(item=>item.id===activeMap.id?{...item,...asDemoMap(payload.data as LiveMap)}:item));
  }
  function openMap(id: string) { if(savingRef.current||retryingRef.current)return; draftContext.current=null; window.history.replaceState(null,"",`/?map=${encodeURIComponent(id)}`); setActiveMapId(id); setSelectedPointId(null); setInviteInfo(null); setFilter({}); setMapBounds(undefined); setAnalysis(null); setShowList(false); setTab("map"); setScreen("workspace"); }
  function openCreate() { if (liveMode && liveSession?.kind !== "account") { window.location.assign("/api/v1/auth/google?returnTo=%2F"); return; } if(liveMode&&liveSession?.kind==="account"&&!liveSession.accountRole){window.location.assign("/account/setup?returnTo=%2F");return;} if(liveMode&&!liveSession?.canCreateMap){notify("교사로 가입한 회원만 새 지도를 만들 수 있어요.");return;} setCreateStep(0); setSelectedTheme(null); setNewTitle(""); setNewDescription(""); setNewLocation(""); setNewCenter(null); setNewVisibility("invite_only"); setNewActivityContext("community");setNewParticipation("invited");setNewModeration("immediate");setNewComments(true); setNewProposals(null); setCustomPinMode("single"); setCustomCategories([]); setCustomCategoryName(""); setCustomCategoryEmoji(""); setCustomExtraEmojis([]); setScreen("create"); }
  function addCustomCategory() {
    const label = customCategoryName.trim();
    const glyph = customCategoryEmoji.trim();
    if (!label || !glyph) return;
    const key = `custom_${customCategories.length + 1}`;
    const options: EmojiOption[] = [{key:`${key}-1`,glyph,label},...customExtraEmojis.filter(e=>e.glyph!==glyph&&e.glyph!=="📍").map((e,index)=>({key:`${key}-${index+2}`,glyph:e.glyph,label:e.label})),...(glyph!=="📍"?[{key:`${key}-location`,glyph:"📍",label:`${label} 위치`}]:[])];
    const emoji=options[0];
    setCustomCategories((items) => [...items, { key, label, color: ["#3b8372", "#d06c3a", "#8269ae", "#467ba7"][items.length % 4], defaultEmojiKey: emoji.key, emojiOptions: options }]);
    setCustomCategoryName(""); setCustomCategoryEmoji(""); setCustomExtraEmojis([]);
  }
  async function createMap() {
    if (!selectedTheme || !newTitle.trim() || !newLocation.trim() || (selectedTheme === "custom" && !customCategories.length)) return;
    if (liveMode) {
      if (liveSession?.kind !== "account" || !liveSession.csrfToken) { notify("Google 로그인이 필요합니다."); return; }
      try {
        const response = await fetch("/api/v1/maps", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": liveSession.csrfToken, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ themeKey: selectedTheme, themeVersion: themeByKey[selectedTheme].version, title: newTitle.trim(), description: newDescription.trim(), locationLabel: newLocation.trim(), activityContext: newActivityContext, visibility: newVisibility, participation:newParticipation,moderation:newModeration,commentsEnabled:newComments, center: newCenter, proposalsEnabled: newProposals ?? themeByKey[selectedTheme].features.proposalsEnabled, ...(selectedTheme === "custom" ? { custom: { categories: customCategories, pinMode: customPinMode } } : {}) }) });
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
    if(savingRef.current||retryingRef.current)return;
    if(liveMode && !activeMap.canCreateObservation) { notify("이 지도에서는 새 기록을 남길 수 없습니다."); return; }
    if(liveSession?.draftScope){try{const existing=readDrafts(sessionStorage,liveSession.draftScope,activeMap.id).find(item=>item.editingId===null);if(existing){restoreDraft(existing);return;}}catch{setDraftStorageError("임시 저장을 사용할 수 없습니다.");}}
    resetPhotoState();draftContext.current={mapId:activeMap.id,editingId:null};requestRef.current=null;savedPointRef.current=null;setSavedPointId(null);
    setDraft(makeDraft()); setDraftPhoto(null); setDraftCoordinates(null); setDraftSource("manual"); setEditingPointId(null); setEditingVersion(null);  setRecordStep(0); setDraftPosition({ x: 52, y: 49 }); setTab("record"); setSelectedPointId(null);
  }
  function beginEdit(point:DemoPoint) {
    if(savingRef.current||retryingRef.current)return;
    if(liveSession?.draftScope){try{const existing=readDrafts(sessionStorage,liveSession.draftScope,activeMap.id).find(item=>item.editingId===point.id);if(existing){restoreDraft(existing);return;}}catch{setDraftStorageError("임시 저장을 사용할 수 없습니다.");}}
    resetPhotoState();draftContext.current={mapId:activeMap.id,editingId:point.id};requestRef.current=null;savedPointRef.current=null;setSavedPointId(null);
    setDraft({title:point.title,body:point.body,categoryKey:point.categoryKey,emojiKey:point.emojiKey,ratingKey:point.ratingKey??"",location:point.locationLabel??activeMap.location,idea:point.idea??"",imageName:"",link:point.link??"",answers:point.rawAnswers??{}});
    setDraftCoordinates(point.location??null);setDraftSource(point.locationSource??"manual");setDraftPhoto(null);setEditingPointId(point.id);setEditingVersion(point.version??null);setRecordStep(0);setSelectedPointId(null);setTab("record");
  }
  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function updateAnswer(key: string, values: string[]) { setDraft((current) => ({ ...current, answers: { ...current.answers, [key]: values } })); }
  function missingRequiredAnswers() { return activeTheme.questions.some((question) => question.required && !(draft.answers[question.key]?.[0] ?? "").trim()); }
  function answerLabels(question: Question, values: string[]) { return question.type === "text" ? values.join(" · ") : values.map((value) => answerChoices(question).find((option) => option.key === value)?.label ?? value).join(" · "); }
  function pickCategory(key: string) {
    const category = activeTheme.categories.find((item) => item.key === key);
    setDraft((current) => ({ ...current, categoryKey: key, emojiKey: category?.defaultEmojiKey ?? "" }));
  }
  async function uploadPhoto(mapId:string,pointId:string,file:File) {
    if(!liveSession?.csrfToken)throw new UploadError("다시 로그인해 주세요.",401);
    return uploadPreparedPhoto(`/api/v1/maps/${encodeURIComponent(mapId)}/observations/${encodeURIComponent(pointId)}/photo`,file,liveSession.csrfToken,setUploadProgress);
  }
  async function retryPhoto() {
    if(!photoRetry||retryingRef.current||savingRef.current)return;
    retryingRef.current=true;setRetryingPhoto(true);setSaveError("");setNeedsLogin(false);
    try {const photo=await uploadPhoto(photoRetry.mapId,photoRetry.pointId,photoRetry.file);setPoints(items=>items.map(point=>point.id===photoRetry.pointId?{...point,...photo}:point));setPhotoRetry(null);if(draftContext.current?.mapId===photoRetry.mapId&&draftContext.current.editingId===photoRetry.editingId)finishDraft();else if(liveSession?.draftScope){try{sessionStorage.removeItem(draftKey(liveSession.draftScope,photoRetry.mapId,photoRetry.editingId));}catch{/* Preserve the record even if local cleanup fails. */}refreshDraftList();}setReloadData(value=>value+1);notify("사진이 저장됐어요.");}
    catch(error){setSaveError(error instanceof Error?error.message:"사진을 다시 저장하지 못했습니다.");if(error instanceof UploadError&&error.status===401)setNeedsLogin(true);}
    finally{retryingRef.current=false;setRetryingPhoto(false);setUploadProgress(null);}
  }
  async function savePoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recordStep !== 2 || savingRef.current || photoPreparingRef.current) return;
    if(draft.imageName&&!draftPhoto){setSaveError("사진을 다시 선택하거나 사진 첨부를 취소해 주세요.");return;}
    if (!draft.location.trim() || !draft.title.trim() || !draft.categoryKey || draft.body.trim().length < 10 || (activeTheme.features.ratingEnabled && !draft.ratingKey) || missingRequiredAnswers()) { notify("필수 항목을 확인해 주세요."); return; }
    if (draft.link.trim()) { try { const url = new URL(draft.link.trim()); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol"); } catch { notify("링크는 http 또는 https 주소로 입력해 주세요."); return; } }
    if(liveMode) {
      if(!draftCoordinates) {notify("지도에서 정확한 위치를 선택해 주세요.");return;}
      if(!liveSession?.csrfToken || (!editingPointId&&!savedPointRef.current&&!activeMap.canCreateObservation)) {notify("기록 권한을 확인해 주세요.");return;}
      savingRef.current=true;setSavingPoint(true);setSaveError("");setNeedsLogin(false);
      try {
        const payload={configRevision:activeMap.configRevision,title:draft.title.trim(),body:draft.body.trim(),locationLabel:draft.location.trim(),locationSource:draftSource,location:draftCoordinates,categoryKey:draft.categoryKey,emojiKey:draft.emojiKey,ratingKey:activeTheme.features.ratingEnabled?draft.ratingKey:null,answers:draft.answers,improvementIdea:activeTheme.features.ideasEnabled?draft.idea.trim():undefined,link:draft.link.trim()||undefined};
        let observation:LiveObservation;
        if(savedPointRef.current){
          if(!draftPhoto)throw new Error("본문은 이미 저장됐습니다. 다시 올릴 사진을 선택해 주세요.");
          const response=await fetch(`/api/v1/maps/${activeMap.id}/observations/${savedPointRef.current}`,{cache:"no-store"});const result=await response.json();
          if(!response.ok)throw new UploadError(result.error?.message??"기록을 열 수 없습니다.",response.status);observation=result.data;
        }else{
          const serialized=JSON.stringify(payload);
          if(requestRef.current&&requestRef.current.payload!==serialized)throw new Error("이전 저장 결과가 확인되지 않았습니다. 입력을 원래 내용으로 되돌려 재시도하거나, 내 기록에서 저장 여부를 확인해 주세요.");
          requestRef.current??={key:crypto.randomUUID(),payload:serialized};persistDraft();
          const response=await fetch(`/api/v1/maps/${encodeURIComponent(activeMap.id)}/observations${editingPointId?`/${encodeURIComponent(editingPointId)}`:""}`,{method:editingPointId?"PATCH":"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":liveSession.csrfToken,...(editingPointId?{"X-Resource-Version":`"${editingVersion}"`}:{"Idempotency-Key":requestRef.current.key})},body:serialized,signal:AbortSignal.timeout(30000)});
          const result=await response.json();
          if(!response.ok){if(response.status<500){requestRef.current=null;persistDraft();}throw new UploadError(result.error?.message??"기록을 저장하지 못했습니다.",response.status);}
          observation=result.data as LiveObservation;
          savedPointRef.current=observation.id;setSavedPointId(observation.id);requestRef.current=null;setEditingVersion(observation.version);persistDraft();
        }
        let point=asDemoPoint(observation,activeTheme);
        setPoints(items=>[point,...items.filter(item=>item.id!==point.id)]);
        let photoFailed=false;
        if(draftPhoto) {
          try {const photo=await uploadPhoto(activeMap.id,point.id,draftPhoto);point={...point,...photo};setPoints(items=>items.map(item=>item.id===point.id?point:item));setPhotoRetry(null);}
          catch(error){photoFailed=true;setPhotoRetry({mapId:activeMap.id,pointId:point.id,file:draftPhoto,editingId:draftContext.current?.editingId??null});setSaveError(`본문은 저장됐습니다. ${error instanceof Error?error.message:"사진을 다시 시도해 주세요."}`);if(error instanceof UploadError&&error.status===401)setNeedsLogin(true);}
        }
        if(!photoFailed)finishDraft();
        setReloadData(value=>value+1);setSelectedPointId(point.id);setTab("map");setShowList(false);if(!photoFailed) notify(point.status==="pending"?"기록이 제출됐어요. 검수 후 공개됩니다.":"기록이 지도에 저장됐어요.");
      } catch(error) {setSaveError(error instanceof Error?error.message:"기록을 저장하지 못했습니다. 연결을 확인해 다시 시도해 주세요.");if(error instanceof UploadError&&error.status===401)setNeedsLogin(true);}
      finally {savingRef.current=false;setSavingPoint(false);setUploadProgress(null);}
      return;
    }
    const answers = Object.fromEntries(activeTheme.questions.filter((question) => draft.answers[question.key]?.length).map((question) => [question.key, answerLabels(question, draft.answers[question.key])])) as Record<string, string>;
    const newPoint: DemoPoint = { id: `point_${Date.now()}`, mapId: activeMap.id, title: draft.title.trim(), body: draft.body.trim(), categoryKey: draft.categoryKey, emojiKey: draft.emojiKey, ratingKey: activeTheme.features.ratingEnabled ? draft.ratingKey : null, idea: activeTheme.features.ideasEnabled ? draft.idea.trim() : undefined, link: draft.link.trim() || undefined, imageName: draft.imageName || undefined, answers, x: draftPosition.x, y: draftPosition.y, author: "나", date: "방금", comments: [] };
    setPoints((items) => [newPoint, ...items]);
    setSelectedPointId(newPoint.id); setTab("map"); setShowList(false); notify("기록이 지도에 표시됐어요.");
  }
  async function handlePhoto(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";if(!file)return;
    const selection=++photoSelection.current;photoPreparingRef.current=true;setPhotoPreparing(true);setSaveError("");
    try{const prepared=await preparePhoto(file);if(selection!==photoSelection.current)return;setDraftPhoto(prepared);updateDraft("imageName",file.name);setPhotoInfo(`${(file.size/1024/1024).toFixed(1)}MB → ${(prepared.size/1024/1024).toFixed(2)}MB · 전송 준비 완료`);}
    catch(error){if(selection===photoSelection.current)setSaveError(error instanceof Error?error.message:"사진을 준비하지 못했습니다.");}
    finally{if(selection===photoSelection.current){photoPreparingRef.current=false;setPhotoPreparing(false);}}
  }
  function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPoint || !commentText.trim()) return;
    setPoints((items) => items.map((point) => point.id === selectedPoint.id ? { ...point, comments: [...(point.comments ?? []), commentText.trim()] } : point));
    setCommentText("");
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
      try{clearDrafts(sessionStorage);}catch{/* Storage may be unavailable. */}
      window.location.assign("/");
    } catch { notify("로그아웃하지 못했습니다."); }
  }

  if(liveMode===null)return <main className="boot-screen"><div className="brand"><GameIcon name="compass" size={34}/> 모두의 지도</div>{bootError?<><p role="alert">{bootError}</p><button type="button" className="button button--primary" onClick={()=>{setBootError("");setBootAttempt(value=>value+1);}}>다시 연결</button></>:<p role="status">지도를 불러오고 있어요…</p>}</main>;

  return <div className="site-shell">
    <aside className="desktop-aside" aria-hidden="true">
      <div className="brand brand--desktop"><span className="brand__mark"><GameIcon name="compass"/></span> 모두의 지도</div>
      <div className="desktop-aside__content"><span className="eyebrow">우리 동네 탐험대</span><h1>지도 밖으로<br /><em>모험을 떠나자!</em></h1><p>익숙한 길에도 새로운 발견이 숨어 있어요.<br/>우리의 발걸음으로 동네 지도를 채워봐요.</p><img className="desktop-explorer" src="/adventure/explorer-fox.webp" width="200" height="240" alt=""/></div>
      <div className="desktop-aside__footer">🧭 함께 찾고 · 함께 기록하고 · 함께 바꿔요</div>
    </aside>
    <main className="app-frame">
      {screen === "home" && <>
        <header className="home-header"><div className="brand"><span className="brand__mark"><GameIcon name="compass"/></span><span>모두의 지도<small>우리 동네 탐험대</small></span></div><button className="round-icon adventure-bag" type="button" aria-label="내 지도 보기" onClick={() => document.getElementById("my-maps")?.scrollIntoView({ behavior: "smooth" })}><GameIcon name="backpack"/></button></header>
        <div className="home-scroll">
          <section className="hero adventure-hero"><div className="hero__text"><span className="quest-tag"><GameIcon name="flag" size={19}/> 우리 동네가 모험의 시작!</span><h1>오늘은 어떤<br/><em>발견을 해볼까?</em></h1><p>친구들과 찾고, 기록하고, 동네를 바꿔요.</p></div><div className="hero__scene"><img src="/adventure/neighborhood-quest.webp" width="1280" height="853" alt="지도를 들고 동네의 공원과 길을 탐험하는 여우" fetchPriority="high"/><span className="scene-badge">🧭 익숙한 동네, 새로운 발견</span></div><div className="hero__launch"><button className="button button--primary button--full" type="button" disabled={!!liveMode&&!!liveSession?.accountRole&&!liveSession.canCreateMap} onClick={openCreate}><GameIcon name="map" size={25}/> 새 탐험지도 만들기 <Icon name="chevron" size={18}/></button><a className="adventure-invite" href="/join"><GameIcon name="key" size={19}/> 초대 코드로 친구들과 합류하기</a></div></section>
          <section className="home-section"><a href="/games" className="button button--full game-entry"><GameIcon name="flag" size={25}/> 탐험게임 · 미션을 찾아 떠나자! <Icon name="chevron" size={18}/></a></section>
          {liveMode && <div className="auth-banner"><div><strong>{liveSession?.kind === "account" ? "탐험 준비 완료!" : liveSession?.kind === "guest" ? "친구들과 탐험에 참여 중!" : "나만의 탐험지도를 만들어봐요"}</strong><small>{liveSession?.kind === "account"?(liveSession.accountRole==="teacher"?"교사 회원 · 지도를 만들고 탐험을 운영할 수 있어요.":liveSession.accountRole?"참여 회원 · 초대받은 지도에 기록을 남길 수 있어요.":"회원 유형을 선택하면 가입이 완료됩니다."):"지도 만들기는 교사 회원, 참여는 초대 코드로!"}</small></div><div>{liveSession?.kind === "account" ? <>{!liveSession.accountRole&&<a href="/account/setup?returnTo=%2F">회원 유형 선택</a>}<button type="button" onClick={() => void logout()}>로그아웃</button></> : !liveSession ? <a href="/api/v1/auth/google?returnTo=%2F">Google 로그인</a> : null}</div></div>}
          {liveMode ? <MapDirectory signedIn={!!liveSession} onOpen={map => { setMaps(items => [asDemoMap(map), ...items.filter(item => item.id !== map.id)]); openMap(map.id); }} /> : <>
          <section className="home-section"><div className="section-heading"><div><span className="eyebrow">EXPLORE</span><h2>어떤 지도를 볼까요?</h2></div></div><label className="search-field"><Icon name="search" size={19} /><span className="sr-only">지도 검색</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="지도 이름, 지역, 주제로 찾아요" /></label><div className="map-cards">{visibleMaps.map((map) => <button key={map.id} type="button" className="map-card" onClick={() => openMap(map.id)}><span className={`map-card__art map-card__art--${map.accent}`}><span>{map.coverEmoji}</span><i /><b /></span><span className="map-card__body"><ThemePill themeKey={map.themeKey} /><strong>{map.title}</strong><small>{map.description}</small><span className="map-card__meta"><span><Icon name="pin" size={14} />{map.location}</span><span>{liveMode?"기록 살펴보기":`${points.filter((point) => point.mapId === map.id).length}개의 발견`}</span></span></span><span className="map-card__arrow"><Icon name="chevron" size={19} /></span></button>)}</div>{visibleMaps.length === 0 && <EmptyState emoji="🔎" title="지도를 찾지 못했어요">다른 이름이나 지역으로 검색해 보세요.</EmptyState>}</section>
          <section className="home-section home-section--last" id="my-maps"><div className="section-heading"><div><span className="eyebrow">MY MAPS</span><h2>{liveMode ? "내가 참여한 지도" : "내가 만든 지도"}</h2></div></div><div className="my-map-list">{maps.filter((map) => map.isMine).map((map) => <button type="button" key={map.id} onClick={() => openMap(map.id)}><span className="my-map-list__emoji">{map.coverEmoji}</span><span><strong>{map.title}</strong><small>{map.visibility === "invite_only" ? "초대 전용" : "공개 지도"} · {themeByKey[map.themeKey].label}</small></span><Icon name="chevron" size={18} /></button>)}</div></section></>}{liveMode && liveSession?.kind==="account" && liveSession.csrfToken && <DeletedMaps csrfToken={liveSession.csrfToken} onNotice={notify}/>}</div>
        <nav className="bottom-nav" aria-label="홈 탐색"><button className="bottom-nav__item bottom-nav__item--active" type="button" onClick={()=>document.querySelector(".home-scroll")?.scrollTo({top:0,behavior:"smooth"})}><span className="nav-equipment"><GameIcon name="compass"/></span><span>탐험 지도</span></button><button className="bottom-nav__item" type="button" aria-label="지도 만들기" onClick={openCreate}><span className="nav-equipment"><GameIcon name="flag"/></span><span>지도 만들기</span></button><button className="bottom-nav__item" type="button" onClick={() => document.getElementById("my-maps")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-equipment"><GameIcon name="backpack"/></span><span>내 탐험</span></button></nav>
      </>}

      {screen === "create" && <>
        <header className="screen-header"><button className="round-icon" type="button" aria-label={createStep === 0 ? "홈으로 돌아가기" : "이전 단계"} onClick={() => createStep === 0 ? setScreen("home") : setCreateStep((step) => step - 1)}><Icon name="arrow" /></button><div><span className="screen-header__overline">🧭 탐험지도 만들기</span><strong>{["주제 선택", "기본 정보", "지도 설정", "참여 설정", "미리보기"][createStep]}</strong></div><span className="step-count">{createStep + 1} / 5</span></header>
        <div className="step-progress" aria-label={`${createStep + 1}단계, 총 5단계`}>{[0,1,2,3,4].map((n) => <span key={n} className={n <= createStep ? "step-progress__active" : ""} />)}</div>
        <div className="flow-scroll">
          {createStep === 0 && <section className="flow-section"><span className="eyebrow">첫 번째 준비 · 탐험 주제</span><h1>어떤 탐험을<br />떠나볼까요?</h1><ExplorerGuide>주제를 고르면 탐험에 필요한 기록 도구가 준비돼요!</ExplorerGuide><div className="theme-grid">{themes.map((theme) => <button key={theme.key} type="button" className={`theme-card adventure-theme--${theme.key} ${selectedTheme === theme.key ? "theme-card--selected" : ""}`} aria-pressed={selectedTheme === theme.key} onClick={() => { setSelectedTheme(theme.key); setNewProposals(null); }}><span className="theme-card__emoji">{themeSymbol[theme.key]}</span><span className="theme-card__copy"><strong>{theme.label}</strong><small>{themeDescription[theme.key]}</small></span><span className="theme-card__select">{selectedTheme === theme.key && <Icon name="check" size={15} />}</span></button>)}</div></section>}
          {createStep === 1 && <section className="flow-section"><span className="eyebrow">두 번째 준비 · 지도 이름</span><h1>지도에 이름을<br />붙여주세요.</h1><p className="lead">어떤 동네에서 무엇을 찾을지 알려주세요.</p><label className="field"><span>지도 이름 <b>*</b></span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={60} placeholder="예: 우리 동네 모두의 길" /></label><label className="field"><span>한 줄 소개</span><textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={300} rows={3} placeholder="이 지도에서 함께 기록하고 싶은 것은?" /></label><label className="field"><span>조사할 지역 <b>*</b></span><input value={newLocation} onChange={(event) => setNewLocation(event.target.value)} placeholder="예: 군산시 수송동" /></label>{liveMode ? <><div className="location-preview"><KakaoMap compact center={newCenter} chosen={newCenter} onPick={(location,source,label)=>{setNewCenter(location);if(label) setNewLocation(label);}}/></div><div className="info-card">📍 <span>장소를 검색하거나 지도를 눌러 시작 위치를 고를 수 있어요. 위치를 고르지 않으면 기본 위치에서 지도가 열립니다.</span></div></> : <div className="info-card">📍 <span>화면 시안에서는 지역 이름을 직접 적어요.</span></div>}</section>}
          {createStep === 2 && <section className="flow-section"><span className="eyebrow">세 번째 준비 · 탐험 도구</span><h1>주제에 맞는<br />지도 준비 끝!</h1><p className="lead">기록할 유형과 지도에 보일 이모지를 확인해 주세요.</p>{createTheme && <><div className="summary-card"><ThemePill themeKey={createTheme.key} /><strong>{createTheme.label} 지도</strong><p>{previewPinMode === "rating" ? "핀 색상은 평가 결과를 보여줘요." : previewPinMode === "category" ? "핀 색상은 관찰 유형을 보여줘요." : "핀 색상은 하나로 표시돼요."} 모든 포인트에 주제별 이모지가 들어가요.</p></div>{selectedTheme === "custom" ? <><div className="subheading"><strong>내 분류 만들기</strong><span>1개 이상 필요해요</span></div><div className="custom-add"><input aria-label="분류 이름" placeholder="분류 이름" value={customCategoryName} onChange={(event) => setCustomCategoryName(event.target.value)} /><input aria-label="대표 이모지" placeholder="이모지" value={customCategoryEmoji} onChange={(event) => setCustomCategoryEmoji(event.target.value)} /><button type="button" aria-label="분류 추가" onClick={addCustomCategory}><Icon name="plus" size={19} /></button></div><details className="custom-emoji-library"><summary>이모지 모음에서 선택 · {emojiLibrary.length}가지</summary><p className="help-text">첫 선택은 대표 이모지, 이후 선택은 이 분류의 추가 이모지입니다. 최대 30개까지 고를 수 있어요.</p><EmojiPicker options={emojiLibrary} selectedKeys={emojiLibrary.filter(e=>e.glyph===customCategoryEmoji||customExtraEmojis.some(extra=>extra.glyph===e.glyph)).map(e=>e.key)} onChoose={key=>{const emoji=emojiLibrary.find(e=>e.key===key);if(!emoji)return;if(emoji.glyph===customCategoryEmoji){setCustomCategoryEmoji("");return;}if(customExtraEmojis.some(e=>e.glyph===emoji.glyph)){setCustomExtraEmojis(items=>items.filter(e=>e.glyph!==emoji.glyph));return;}if(!customCategoryEmoji){setCustomCategoryEmoji(emoji.glyph);setCustomExtraEmojis(items=>items.filter(e=>e.glyph!==emoji.glyph));return;}if(customExtraEmojis.length>=29){notify("한 분류에 최대 30개의 이모지를 선택할 수 있어요.");return;}setCustomExtraEmojis(items=>[...items,emoji]);}}/></details><div className="category-preview">{customCategories.map((category) => <span key={category.key}>{category.emojiOptions[0].glyph} {category.label}</span>)}</div><div className="field"><span>핀 색상 표시</span><div className="pin-mode-picker">{([{ key: "single", label: "한 가지 색" }, { key: "category", label: "유형별 색" }, { key: "rating", label: "평가별 색" }] as const).map((mode) => <button type="button" key={mode.key} className={customPinMode === mode.key ? "selected" : ""} aria-pressed={customPinMode === mode.key} onClick={() => setCustomPinMode(mode.key)}>{mode.label}</button>)}</div><small>이모지는 모든 방식에서 표시돼요. 평가별 색을 고르면 기록할 때 3단계 평가를 입력합니다.</small></div></> : <><div className="subheading"><strong>기록할 유형</strong><span>{createCategories.length}유형 · {createCategories.reduce((sum,c)=>sum+c.emojiOptions.length,0)}개 이모지</span></div><div className="category-preview">{createCategories.map((category) => <span key={category.key}>{category.emojiOptions[0].glyph} {category.label}</span>)}</div>{createTheme.rating && <div className="feature-note"><strong>평가 기준</strong><div>{createTheme.rating.options.map((rating) => <span key={rating.key}><i style={{ backgroundColor: rating.color }} />{rating.label}</span>)}</div></div>}</>}<label className="toggle-row"><span><strong>개선 제안서</strong><small>관찰을 바탕으로 제안을 정리해요</small></span><input type="checkbox" checked={newProposals ?? createTheme.features.proposalsEnabled} onChange={(event) => setNewProposals(event.target.checked)} /></label></>}</section>}
          {createStep === 3 && <section className="flow-section"><span className="eyebrow">STEP 04 · PEOPLE</span><h1>누가 지도를<br />볼 수 있나요?</h1><p className="lead">친구들과만 조사하거나, 동네에 공개할 수 있어요.</p><div className="field"><span>활동 유형</span><div className="pin-mode-picker"><button type="button" className={newActivityContext === "community" ? "selected" : ""} onClick={() => {setNewActivityContext("community");setNewModeration("immediate");}}>일반 커뮤니티</button><button type="button" className={newActivityContext === "school" ? "selected" : ""} onClick={() => {setNewActivityContext("school");setNewModeration("approval");}}>학교 활동</button></div></div><label className="field"><span>기록 참여</span><select value={newParticipation} onChange={event=>setNewParticipation(event.target.value as "invited"|"admin_only"|"closed")}><option value="invited">초대 참여자도 기록</option><option value="admin_only">관리자만 기록</option><option value="closed">기록 마감</option></select></label><label className="field"><span>기록 공개</span><select value={newModeration} onChange={event=>setNewModeration(event.target.value as "immediate"|"approval")}><option value="immediate">등록 즉시 공개</option><option value="approval">관리자 승인 후 공개</option></select></label><label className="toggle-row"><span><strong>댓글 허용</strong><small>참여자가 게시 기록에 의견을 남겨요</small></span><input type="checkbox" checked={newComments} onChange={event=>setNewComments(event.target.checked)}/></label><div className="choice-stack"><button type="button" className={`choice-card ${newVisibility === "invite_only" ? "choice-card--selected" : ""}`} onClick={() => setNewVisibility("invite_only")}><span className="choice-card__icon">🔒</span><span><strong>초대받은 사람만</strong><small>초대 코드를 받은 사람만 지도를 보고 기록해요.</small></span><span className="radio-dot" /></button><button type="button" className={`choice-card ${newVisibility === "public" ? "choice-card--selected" : ""}`} onClick={() => setNewVisibility("public")}><span className="choice-card__icon">🌍</span><span><strong>누구나 볼 수 있게</strong><small>지도는 공개되고 기록은 초대받은 사람만 해요.</small></span><span className="radio-dot" /></button></div><div className="info-card">👋 <span>참여자는 초대 코드와 닉네임으로 입장해요. 지도 만들기는 Google 로그인이 필요합니다.</span></div></section>}
          {createStep === 4 && <section className="flow-section"><span className="eyebrow">STEP 05 · READY</span><h1>우리 지도를<br />살펴볼까요?</h1><p className="lead">준비한 내용을 확인하고 지도를 만들어 주세요.</p><div className="preview-cover"><span>{selectedTheme ? themeSymbol[selectedTheme] : "✨"}</span><div><ThemePill themeKey={selectedTheme ?? "custom"} /><strong>{newTitle || "지도 이름"}</strong><small><Icon name="pin" size={15} />{newLocation || "지역"}</small></div></div><div className="preview-list"><div><span>공개 범위</span><strong>{newVisibility === "public" ? "누구나 보기" : "초대받은 사람만"}</strong></div><div><span>포인트 아이콘</span><strong>{createCategories.length}개 유형의 이모지</strong></div><div><span>핀 색상</span><strong>{previewPinMode === "rating" ? "평가별" : previewPinMode === "category" ? "유형별" : "한 가지 색"}</strong></div><div><span>제안서</span><strong>{newProposals ?? createTheme?.features.proposalsEnabled ? "사용" : "사용 안 함"}</strong></div></div><p className="preview-notice">{liveMode ? "지도 설정과 위치 기록은 서버에 저장됩니다." : "화면 시안에서는 만든 지도와 기록이 새로고침하면 사라집니다."}</p></section>}
        </div>
        <div className="flow-footer"><button type="button" className="button button--primary" disabled={!isCreateValid} onClick={() => createStep < 4 ? setCreateStep((step) => step + 1) : createMap()}>{createStep === 4 ? "지도 만들기" : "다음으로"}<Icon name={createStep === 4 ? "check" : "chevron"} size={18} /></button></div>
      </>}

      {screen === "workspace" && <>
        <header className="workspace-header" inert={savingPoint||retryingPhoto}><button type="button" className="round-icon" aria-label="지도 목록으로 돌아가기" onClick={() => { setScreen("home"); window.history.replaceState(null,"","/"); setSelectedPointId(null); }}><Icon name="arrow" /></button><div><span className="workspace-header__eyebrow">{themeSymbol[activeMap.themeKey]} {activeTheme.label} 지도</span><strong>{activeMap.title}</strong></div><button type="button" className="round-icon" aria-label="지도 정보 보기" onClick={() => { setTab("more"); setSelectedPointId(null); }}><Icon name="menu" /></button></header>
        {tab!=="record"&&recoverable.length>0&&<aside className="draft-recovery" aria-label="임시 저장 기록"><strong>이 탭에서 작성 중인 기록</strong>{recoverable.map(item=><div key={item.editingId??"new"}><button type="button" disabled={dataLoading||savingPoint||retryingPhoto} onClick={()=>restoreDraft(item)}>{item.savedPointId?"사진 이어 올리기":item.editingId?"수정 이어 쓰기":"기록 이어 쓰기"} · {item.draft.title||"제목 없음"}</button><button type="button" disabled={savingPoint||retryingPhoto} onClick={()=>discardDraft(item)}>임시 내용 지우기</button></div>)}</aside>}
        {tab === "map" && <MapWorkspace key={`${activeMap.id}:${liveSession?.draftScope??"visitor"}`} mapId={activeMap.id} scope={liveMode?(liveSession?.draftScope??"visitor"):"demo"} theme={activeTheme} points={filteredPoints} center={activeMap.center} live={!!liveMode} selectedId={selectedPointId} onSelect={setSelectedPointId} filter={filter} onFilter={setFilter} bounds={mapBounds} onBounds={setMapBounds} showList={showList} onToggleList={()=>setShowList(value=>!value)} loading={dataLoading} error={dataError} fallback={(visible,onSelect)=><MapArtwork theme={activeTheme} points={visible} selectedId={selectedPointId??undefined} onSelect={onSelect}/>}/>}

        {tab === "record" && <form className="record-layout" onSubmit={savePoint}><fieldset className="record-fields" disabled={savingPoint||retryingPhoto}><div className="record-progress"><span>{savedPointId?"저장한 기록에 사진 올리기":editingPointId?"기록 수정":"탐험 일지 · 새로운 발견"}</span><strong>{recordStep + 1} / 3</strong></div><div className="step-progress" aria-label={`${recordStep + 1}단계, 총 3단계`}>{[0,1,2].map((n) => <span key={n} className={n <= recordStep ? "step-progress__active" : ""} />)}</div><div className="record-scroll">{liveMode&&<div className="draft-notice"><p>{draftStorageError||"작성 내용은 이 탭에 최대 24시간 임시 저장됩니다. 탭을 닫거나 로그아웃하면 지워집니다."}</p>{draft.imageName&&!draftPhoto&&<p>사진 파일은 저장되지 않았습니다. ‘{draft.imageName}’을 다시 선택해 주세요.</p>}{requestRef.current&&!savedPointId&&<p>저장 결과 확인 전에는 본문을 바꿀 수 없습니다. 같은 내용으로 다시 저장해 주세요.</p>}</div>}{savedPointId&&<p className="info-card">본문은 이미 저장됐습니다. 사진만 선택해 올려 주세요.</p>}{!savedPointId&&recordStep === 0 && <section className="flow-section" inert={!!requestRef.current}><ExplorerGuide>발견한 곳을 지도에서 골라줘. 함께 탐험 일지를 채워보자!</ExplorerGuide><span className="eyebrow">첫 번째 기록 · 발견한 장소</span><h1>어디에서<br />발견했나요?</h1><p className="lead">지도를 눌러 위치를 고르고, 장소 이름을 적어주세요.</p><div className="location-preview">{liveMode ? <KakaoMap compact center={activeMap.center} chosen={draftCoordinates} onPick={(location,source,label)=>{setDraftCoordinates(location);setDraftSource(source);updateDraft("location",label || draft.location || "지도에서 선택한 위치");}}/> : <><MapArtwork theme={activeTheme} points={[]} compact choosePosition={(x, y) => { setDraftPosition({ x, y }); updateDraft("location", draft.location || "지도에서 선택한 위치"); }} /><span className="location-preview__marker" style={{ left: `${draftPosition.x}%`, top: `${draftPosition.y}%` }}>📍</span></>}</div><label className="field"><span>위치 또는 장소 이름 <b>*</b></span><input value={draft.location} onChange={(event) => updateDraft("location", event.target.value)} placeholder="예: 공원 북쪽 입구" /></label></section>}{!savedPointId&&recordStep === 1 && <section className="flow-section" inert={!!requestRef.current}><span className="eyebrow">두 번째 기록 · 나의 발견</span><h1>무엇을<br />발견했나요?</h1><p className="lead">관찰한 유형을 고르면 알맞은 이모지가 준비돼요.</p><label className="field"><span>기록 제목 <b>*</b></span><input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} maxLength={60} placeholder="예: 공원 입구의 높은 턱" /></label><div className="field"><span>관찰 유형 <b>*</b></span><div className="category-picker">{activeTheme.categories.map((category) => <button key={category.key} className={draft.categoryKey === category.key ? "selected" : ""} type="button" onClick={() => pickCategory(category.key)}><span>{category.emojiOptions[0].glyph}</span>{category.label}</button>)}</div></div>{draft.categoryKey && <div className="field"><span>이모지 선택</span><EmojiPicker key={draft.categoryKey} options={activeTheme.categories.find(item=>item.key===draft.categoryKey)?.emojiOptions.filter(emoji=>emoji.active!==false||(!!editingPointId&&points.find(point=>point.id===editingPointId)?.emojiKey===emoji.key&&points.find(point=>point.id===editingPointId)?.categoryKey===draft.categoryKey))??[]} selectedKeys={[draft.emojiKey]} onChoose={key=>updateDraft("emojiKey",key)}/></div>}{activeTheme.features.ratingEnabled && activeTheme.rating && <div className="field"><span>{activeTheme.rating.label} <b>*</b></span><div className="rating-picker">{activeTheme.rating.options.map((option) => <button key={option.key} className={draft.ratingKey === option.key ? "selected" : ""} type="button" aria-pressed={draft.ratingKey === option.key} onClick={() => updateDraft("ratingKey", option.key)}><i className="rating-symbol" aria-hidden="true">{option.symbol}</i>{option.label}</button>)}</div></div>}<label className="field"><span>관찰한 내용 <b>*</b></span><textarea rows={4} value={draft.body} onChange={(event) => updateDraft("body", event.target.value)} maxLength={2000} placeholder="무엇을 보았는지 자세히 적어주세요." /><small>{draft.body.length} / 2,000 · 10자 이상</small></label>{activeTheme.questions.length > 0 && <QuestionInputs questions={activeTheme.questions} answers={draft.answers} onChange={updateAnswer} />}</section>}{recordStep === 2 && <section className="flow-section"><span className="eyebrow">마지막 기록 · 탐험 일지 완성</span><h1>마지막으로<br />확인해 주세요.</h1><p className="lead">{activeTheme.features.ideasEnabled ? "사진과 개선 아이디어가 있으면 함께 남겨주세요." : "사진이나 관련 링크가 있으면 함께 남겨주세요."}</p><label className="photo-picker"><Icon name="camera" size={28} /><strong>{draft.imageName || "사진을 선택해 주세요"}</strong><small>{liveMode ? "원본 최대 20MB · 전송 전 크기를 줄이고 위치정보를 제거해요" : "화면 시안 · 업로드는 연결 전"}</small><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={photoPreparing||savingPoint} onChange={event=>void handlePhoto(event)} /></label>{photoPreparing&&<p role="status">사진 크기를 줄이고 있어요…</p>}{photoInfo&&<p role="status">{photoInfo}</p>}{draft.imageName&&!savedPointId&&<button type="button" onClick={()=>{photoSelection.current++;photoPreparingRef.current=false;setPhotoPreparing(false);setDraftPhoto(null);updateDraft("imageName","");setPhotoInfo("");}}>사진 첨부 취소</button>}<fieldset className="record-fields" disabled={!!savedPointId||!!requestRef.current}><label className="field"><span>관련 링크 (선택)</span><input type="url" value={draft.link} onChange={(event) => updateDraft("link", event.target.value)} placeholder="https://example.com" /></label>{activeTheme.features.ideasEnabled && <label className="field"><span>개선 아이디어</span><textarea rows={4} value={draft.idea} onChange={(event) => updateDraft("idea", event.target.value)} maxLength={1000} placeholder="어떻게 바꾸면 더 좋을까요?" /></label>}<div className="record-review"><span className="record-review__emoji">{activeTheme.categories.find((item) => item.key === draft.categoryKey)?.emojiOptions.find((item) => item.key === draft.emojiKey)?.glyph ?? "📍"}</span><div><strong>{draft.title || "제목을 입력해 주세요"}</strong><small>{draft.location || "위치를 선택해 주세요"}</small><RatingLabel theme={activeTheme} point={{ratingKey:draft.ratingKey}}/><p>{draft.body || "관찰 내용을 입력해 주세요"}</p></div></div>{!liveMode && <div className="info-card">🌱 <span>이 화면은 시안입니다. 등록한 기록은 현재 화면에서만 볼 수 있어요.</span></div>}</fieldset></section>}</div><div className="flow-footer flow-footer--split">{recordStep > 0 && !savedPointId && <button className="button button--light" type="button" onClick={() => setRecordStep((step) => step - 1)}>이전</button>}<button className="button button--primary" type="button" disabled={savingPoint||photoPreparing||(!!savedPointId&&!draftPhoto)} onClick={(event) => { if (recordStep === 2) { event.currentTarget.closest("form")?.requestSubmit(); return; } if (recordStep === 0 && (!draft.location.trim() || (liveMode && !draftCoordinates))) { notify("지도에서 위치를 선택하고 장소 이름을 입력해 주세요."); return; } if (recordStep === 1 && (!draft.title.trim() || !draft.categoryKey || draft.body.trim().length < 10 || (activeTheme.features.ratingEnabled && !draft.ratingKey) || missingRequiredAnswers())) { notify("제목, 유형, 관찰 내용과 필수 질문을 확인해 주세요."); return; } setRecordStep((step) => step + 1); }}>{recordStep === 2 ? (savingPoint ? "저장 중..." : savedPointId ? "사진 올리기" : editingPointId ? "수정 저장" : "기록 남기기") : "다음"}<Icon name={recordStep === 2 ? "check" : "chevron"} size={18} /></button></div></fieldset></form>}

        {tab === "analysis" && <AnalysisPanel theme={activeTheme} filter={filter} onChange={setFilter} bounds={mapBounds} data={displayedAnalysis} loading={!!liveMode&&!datasetReady&&!dataError} error={dataError} mapId={activeMap.id} csrfToken={liveSession?.csrfToken} canExport={!!liveMode&&!!activeMap.canManageMap} onShowRecords={()=>{setShowList(true);setTab("map");}} onRefresh={()=>setReloadData(value=>value+1)}/>}
        {tab === "proposal" && proposalEnabled && (liveMode?<ProposalWorkspace key={activeMap.id} mapId={activeMap.id} theme={activeTheme} points={filteredPoints} filter={filter} onFilter={setFilter} csrfToken={liveSession?.csrfToken} isMember={!!activeMap.isMine} isAdmin={!!activeMap.canManageMap} active={activeMap.status==="active"} dataReady={datasetReady} onNotice={notify}/>:<div className="content-scroll"><h1>개선 제안서</h1><p>서버에 연결하면 근거를 선택해 제안서를 저장·공유할 수 있습니다.</p></div>)}

        {tab === "more" && <div className="content-scroll"><section className="content-heading"><span className="eyebrow">🎒 탐험 가방 · 지도 정보</span><h1>{activeMap.title}</h1><p>{activeMap.description}</p></section><div className="about-card"><ThemePill themeKey={activeMap.themeKey} /><div><span><Icon name="pin" size={17} />{activeMap.location}</span><span><Icon name="users" size={17} />{activeMap.author}</span><span><Icon name="clock" size={17} />{activeMap.visibility === "public" ? "공개 지도" : "초대 전용 지도"}</span></div></div>{liveMode&&activeMap.isOwner&&activeMap.version&&liveSession?.csrfToken&&<MapOwnerDelete mapId={activeMap.id} version={activeMap.version} csrfToken={liveSession.csrfToken} onNotice={notify} onDeleted={()=>window.location.assign("/")}/>}{liveMode&&activeMap.canManageMap&&liveSession?.accountRole==="teacher"&&activeMap.status==="active"&&<section className="game-launch-card"><strong>🎮 우리 지도로 탐험게임 만들기</strong><p>포인트를 복사하고 미션을 추가한 뒤 학생들을 게임방에 초대해요. 원본 기록은 그대로 유지됩니다.</p><a className="button button--primary button--full" href={`/games/new?source=${activeMap.id}`}>탐험게임맵 제작</a></section>}<div className="subheading"><strong>이 지도에서 기록할 것</strong></div><div className="category-preview">{activeTheme.categories.map((category) => <span key={category.key}>{category.emojiOptions[0].glyph} {category.label}</span>)}</div><div className="info-card">🗺️ <span>{liveMode ? "지도·기록·제안서는 서버에 저장됩니다. 분석은 현재 조건에 맞는 게시 기록을 집계합니다." : "지도와 기록은 화면 시안용 데이터입니다. 로그인·초대·실제 카카오맵은 다음 구현 단계에서 연결돼요."}</span></div>{liveMode && activeMap.canManageMap && <div className="invite-panel"><strong>참여자 초대</strong><p>초대 코드는 생성할 때 한 번만 표시됩니다.</p><button type="button" onClick={() => void createShareInvite()}>새 초대 코드 만들기</button>{inviteInfo && <div><b>{inviteInfo.code}</b><small>{inviteInfo.joinUrl}</small><button type="button" onClick={() => void navigator.clipboard.writeText(inviteInfo.joinUrl).then(() => notify("초대 링크를 복사했어요."))}>링크 복사</button></div>}</div>}{liveMode && activeMap.isMine && <MyRecords mapId={activeMap.id} onNotice={notify} onSelect={record=>{const item=record as LiveObservation;if(item.status==="hidden"||item.status==="deleted"){notify(item.status==="hidden"?"관리자가 숨긴 기록입니다.":"삭제된 기록입니다.");return;}const point=asDemoPoint(item,activeTheme);setPoints(items=>[point,...items.filter(value=>value.id!==point.id)]);setSelectedPointId(point.id);setTab("map");}}/>}{liveMode && activeMap.canManageMap && liveSession?.csrfToken && activeMap.version && activeMap.participation && activeMap.moderation && activeMap.status && <ModerationCenter mapId={activeMap.id} csrfToken={liveSession.csrfToken} isOwner={!!activeMap.isOwner} settings={{visibility:activeMap.visibility,participation:activeMap.participation,moderation:activeMap.moderation,commentsEnabled:!!activeMap.commentsEnabled,status:activeMap.status,version:activeMap.version}} onNotice={notify} onChanged={()=>{void refreshActiveMap();}} onDeleted={()=>window.location.reload()}/>}{liveMode&&activeMap.canManageMap&&activeMap.version&&liveSession?.csrfToken&&<FeatureSettings key={activeMap.id} mapId={activeMap.id} version={activeMap.version} theme={activeTheme} csrfToken={liveSession.csrfToken} loading={dataLoading} onChanged={refreshActiveMap} onNotice={notify}/>}<button className="button button--light button--full" type="button" onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(new URL(`/?map=${encodeURIComponent(activeMap.id)}`,window.location.origin).href).then(() => notify("지도 링크를 복사했어요.")).catch(() => notify("주소 복사가 허용되지 않았어요.")); }}><Icon name="share" size={18} /> 지도 링크 복사</button></div>}

        {(savingPoint||retryingPhoto||saveError)&&<div className="upload-status" role={saveError?"alert":"status"}>{saveError|| (uploadProgress===null?"기록을 저장하고 있어요…":uploadProgress===100?"사진 전송 완료 · 서버에서 저장 중…":`사진 전송 중 ${uploadProgress}%`)}{uploadProgress!==null&&<progress value={uploadProgress} max={100} aria-label="사진 전송 진행률"/>}{needsLogin&&<a href={liveSession?.kind==="guest"?"/join":`/api/v1/auth/google?returnTo=${encodeURIComponent(`/?map=${activeMap.id}`)}`}>다시 로그인·참여하기</a>}{saveError&&!savingPoint&&!retryingPhoto&&<button type="button" onClick={()=>setSaveError("")}>안내 닫기</button>}</div>}
        <nav inert={savingPoint||retryingPhoto} className="bottom-nav bottom-nav--workspace" aria-label="지도 메뉴"><button type="button" className={`bottom-nav__item ${tab === "map" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("map"); setSelectedPointId(null); }}><span className="nav-equipment"><GameIcon name="compass"/></span><span>탐험 지도</span></button><button type="button" className={`bottom-nav__item ${tab === "record" ? "bottom-nav__item--active" : ""}`} onClick={beginRecord}><span className="nav-equipment nav-equipment--record"><GameIcon name="journal"/></span><span>발견 기록</span></button><button type="button" className={`bottom-nav__item ${tab === "analysis" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("analysis"); setSelectedPointId(null); }}><span className="nav-equipment"><GameIcon name="chart"/></span><span>탐험 통계</span></button>{proposalEnabled && <button type="button" className={`bottom-nav__item ${tab === "proposal" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("proposal"); setSelectedPointId(null); }}><span className="nav-equipment"><GameIcon name="flag"/></span><span>개선 제안</span></button>}<button type="button" className={`bottom-nav__item ${tab === "more" ? "bottom-nav__item--active" : ""}`} onClick={() => { setTab("more"); setSelectedPointId(null); }}><span className="nav-equipment"><GameIcon name="backpack"/></span><span>탐험 가방</span></button></nav>
        {selectedPoint && tab === "map" && <PointDialog label={`${selectedPoint.title} 상세 기록`} onClose={() => setSelectedPointId(null)}><div className="sheet-handle" /><button type="button" className="sheet-close" aria-label="상세 닫기" onClick={() => setSelectedPointId(null)}><Icon name="close" size={21} /></button><div className="point-sheet__title"><span className="point-sheet__emoji" role="img" aria-label={getPointEmoji(activeTheme,selectedPoint)?.label??"위치 기록"} style={{ backgroundColor: getPinColor(activeTheme, selectedPoint) }}>{getPointEmoji(activeTheme, selectedPoint)?.glyph}</span><div><small>{activeTheme.categories.find((item) => item.key === selectedPoint.categoryKey)?.label} · {selectedPoint.date}</small><h2>{selectedPoint.title}</h2></div></div>{pointRating(activeTheme,selectedPoint)&&<div className="sheet-rating"><RatingLabel theme={activeTheme} point={selectedPoint}/></div>}<p className="sheet-body">{selectedPoint.body}</p>{selectedPoint.photoUrl ? <img className="sheet-photo" src={selectedPoint.photoUrl} alt={`${selectedPoint.title} 현장 사진`}/> : selectedPoint.imageName && <div className="sheet-attachment">📷 첨부한 사진: {selectedPoint.imageName} <small>화면 시안 · 파일은 저장되지 않음</small></div>}{selectedPoint.link && <a className="sheet-link" href={selectedPoint.link} target="_blank" rel="noopener noreferrer">🔗 관련 링크 열기</a>}{selectedPoint.answers && Object.keys(selectedPoint.answers).length > 0 && <div className="sheet-answers">{Object.entries(selectedPoint.answers).map(([key, value]) => <span key={key}><b>{activeTheme.questions.find((item) => item.key === key)?.label ?? key}</b>{value}</span>)}</div>}{selectedPoint.idea && activeTheme.features.ideasEnabled && <div className="sheet-idea"><strong>💡 개선 아이디어</strong><p>{selectedPoint.idea}</p></div>}<div className="sheet-meta">기록한 사람 · {selectedPoint.author}{selectedPoint.status==="pending" && " · 검수 대기"}</div>{liveMode && selectedPoint.canEdit && <button type="button" className="button button--light button--full" onClick={()=>beginEdit(selectedPoint)}>기록 수정</button>}{liveMode && photoRetry?.pointId===selectedPoint.id && <button disabled={retryingPhoto||savingPoint} type="button" className="button button--light button--full" onClick={()=>void retryPhoto()}>사진 업로드 다시 시도</button>}{liveMode&&photoRetry?.pointId===selectedPoint.id&&(saveError||retryingPhoto)&&<p role={saveError?"alert":"status"}>{saveError||(uploadProgress===100?"서버에서 사진을 저장하고 있어요…":`사진 전송 중 ${uploadProgress??0}%`)}</p>}{activeTheme.features.commentsEnabled && !liveMode && <div className="sheet-comments"><strong>댓글 {selectedPoint.comments?.length ?? 0}</strong>{selectedPoint.comments?.map((comment, i) => <p key={i}>{comment}</p>)}<form onSubmit={addComment}><label className="sr-only" htmlFor="comment-input">댓글 입력</label><input id="comment-input" value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={500} placeholder="의견을 남겨주세요" /><button type="submit" disabled={!commentText.trim()}>등록</button></form><small>화면 시안 · 댓글은 현재 화면에서만 유지됩니다.</small></div>}{liveMode && selectedPoint.status==="published" && <>{liveSession?.csrfToken && (selectedPoint.canDelete||activeMap.canManageMap) && selectedPoint.version && <ObservationActions mapId={activeMap.id} id={selectedPoint.id} version={selectedPoint.version} canDelete={!!selectedPoint.canDelete} canModerate={!!activeMap.canManageMap} csrfToken={liveSession.csrfToken} onNotice={notify} onChanged={()=>{setSelectedPointId(null);void refreshActiveMap();}}/>}<CommentSection mapId={activeMap.id} observationId={selectedPoint.id} enabled={!!activeMap.commentsEnabled} canWrite={!!activeMap.canComment} canModerate={!!activeMap.canManageMap} csrfToken={liveSession?.csrfToken??null} onNotice={notify}/>{activeMap.isMine && activeMap.status==="active" && liveSession?.csrfToken && <ReportAction mapId={activeMap.id} targetType="observation" targetId={selectedPoint.id} csrfToken={liveSession.csrfToken} onNotice={notify}/>}</>}</PointDialog>}
      </>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  </div>;
}
