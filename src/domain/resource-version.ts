// App row versions are not HTTP entity tags. A dedicated header avoids CDN
// precondition handling after the application's write has already succeeded.
export function resourceVersion(headers: Pick<Headers, "get">): string | undefined {
  const current = headers.get("x-resource-version");
  const legacy = headers.get("if-match");
  if (current !== null && legacy !== null && current !== legacy) return undefined;
  return (current ?? legacy)?.match(/^"(\d+)"$/)?.[1];
}
