import { describe, it, expect } from "vitest";
import { resourceVersion } from "../src/domain/resource-version";
import { inviteAttemptActor } from "../src/server/policies/invite-attempts";

describe("application version preconditions", () => {
  it("reads the CDN-independent version header and legacy clients", () => {
    expect(resourceVersion(new Headers({"X-Resource-Version":'"9223372036854775807"'}))).toBe("9223372036854775807");
    expect(resourceVersion(new Headers({"If-Match":'"3"'}))).toBe("3");
  });
  it("does not accept missing, wildcard, weak, list or conflicting versions", () => {
    for (const value of ["", "*", 'W/"3"', '"3", "4"', "3", '"-1"'])
      expect(resourceVersion(new Headers({"X-Resource-Version":value}))).toBeUndefined();
    expect(resourceVersion(new Headers())).toBeUndefined();
    expect(resourceVersion(new Headers({"X-Resource-Version":'"3"',"If-Match":'"4"'}))).toBeUndefined();
  });
});

describe("trusted invite request identity", () => {
  it("uses the Vercel-owned header instead of an arbitrary forwarded address", () => {
    expect(inviteAttemptActor(new Headers({"x-vercel-forwarded-for":"203.0.113.5","x-forwarded-for":"198.51.100.8"}),
      {NODE_ENV:"production",VERCEL:"1"})).toBe("203.0.113.5");
  });
  it("keeps unknown production hosts closed and honors explicit proxy configuration", () => {
    expect(inviteAttemptActor(new Headers({"x-forwarded-for":"198.51.100.8"}),{NODE_ENV:"production"})).toBeUndefined();
    expect(inviteAttemptActor(new Headers({"cf-connecting-ip":"2001:db8::1"}),
      {NODE_ENV:"production",TRUSTED_CLIENT_IP_HEADER:"CF-Connecting-IP"})).toBe("2001:db8::1");
  });
  it("groups missing or malformed addresses into the limited global bucket", () => {
    for(const value of ["", "abc", "203.0.113.5, 198.51.100.8"])
      expect(inviteAttemptActor(new Headers({"x-vercel-forwarded-for":value}),{NODE_ENV:"production",VERCEL:"1"})).toBe("global");
  });
});
