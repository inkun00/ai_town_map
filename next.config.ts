import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/v1/weather/boundaries": ["./src/lib/weather-boundary-data/cities/*.json", "./src/lib/weather-boundary-data/districts/*.json"],
    "/api/v1/map-boundaries": ["./src/lib/weather-boundary-data/cities/*.json", "./src/lib/weather-boundary-data/districts/*.json"],
  },
  images: {
    // Only bundled illustrations use the shared optimizer. Observation photos
    // continue through their authenticated, private/no-store endpoint.
    localPatterns: [{pathname: "/_next/static/media/**", search: ""}],
    qualities: [75],
  },
};

export default nextConfig;
