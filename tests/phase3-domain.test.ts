import { describe, expect, it } from "vitest";
import { createInviteCode, normalizedCode } from "../src/domain/invite-code";
import { buildMapTheme, validCustomCategories } from "../src/domain/map-theme";
import { themeByKey } from "../src/lib/demo-data";
import { canManageMap, canReadMap } from "../src/server/policies/maps";

describe("지도 접근 경계", () => {
  const privateMap = { visibility: "invite_only" as const, status: "active" as const, ownerPrincipalId: "owner" };

  it("초대 전용 지도는 활성 멤버만 읽는다", () => {
    expect(canReadMap(null, privateMap, null)).toBe(false);
    expect(canReadMap("a", privateMap, { status: "blocked", role: "participant" })).toBe(false);
    expect(canReadMap("a", privateMap, { status: "active", role: "participant" })).toBe(true);
  });

  it("같은 닉네임과 무관하게 principal과 역할로 관리자를 판정한다", () => {
    expect(canManageMap("other", privateMap, { status: "active", role: "participant" })).toBe(false);
    expect(canManageMap("admin", privateMap, { status: "blocked", role: "admin" })).toBe(false);
    expect(canManageMap("admin", privateMap, { status: "active", role: "admin" })).toBe(true);
    expect(canManageMap("owner", privateMap, { status: "active", role: "participant" })).toBe(true);
  });

  it("공개 지도는 읽되 삭제된 지도는 읽지 못한다", () => {
    expect(canReadMap(null, { ...privateMap, visibility: "public" }, null)).toBe(true);
    expect(canReadMap("owner", { ...privateMap, status: "deleted" }, { status: "active", role: "participant" })).toBe(false);
  });
});

describe("초대 코드", () => {
  it("읽기 쉬운 12자리 코드로 발급하고 하이픈 입력을 정규화한다", () => {
    const code = createInviteCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(normalizedCode(`${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`)).toBe(code);
    expect(normalizedCode("IIII-OOOO-LLLL")).toBeNull();
  });
});

describe("주제별 설정", () => {
  it("생태는 평가가 없고 날씨는 유형 색과 영향 평가가 분리된다", () => {
    const ecology = buildMapTheme(themeByKey.ecology);
    const weather = buildMapTheme(themeByKey.weather_life);
    expect(ecology.pin.mode).toBe("category");
    expect(ecology.rating).toBeNull();
    expect(ecology.features.ratingEnabled).toBe(false);
    expect(weather.pin.mode).toBe("category");
    expect(weather.rating?.options).toHaveLength(3);
  });

  it("직접 만든 주제의 평가별 색과 대표 이모지가 일치한다", () => {
    const categories = [{ key: "cafe", label: "카페", color: "#285943", defaultEmojiKey: "coffee", emojiOptions: [{ key: "coffee", glyph: "☕", label: "카페" }] }];
    expect(validCustomCategories(categories)).toBe(true);
    const custom = buildMapTheme(themeByKey.custom, { categories, pinMode: "rating" });
    expect(custom.pin.mode).toBe("rating");
    expect(custom.features.ratingEnabled).toBe(true);
    expect(custom.categories[0].emojiOptions[0].glyph).toBe("☕");
    expect(validCustomCategories([{ ...categories[0], defaultEmojiKey: "missing" }])).toBe(false);
  });
});
