// Explicit deployed target support; credentials remain in ignored local env files.
export function liveTestTarget() {
  const url = new URL(process.env.LIVE_APP_ORIGIN || process.env.APP_ORIGIN);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Live test target must be an origin without credentials or a path");
  }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!local && url.origin !== "https://ai-town-map.vercel.app") {
    throw new Error("Live tests support localhost or the configured production app only");
  }
  const prefix = url.protocol === "https:" ? "__Host-moa_" : "moa_dev_";
  return { base: url.origin, sessionName: `${prefix}session`, csrfName: `${prefix}csrf`, cookiePrefix: prefix };
}
