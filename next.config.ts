import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Only bundled illustrations use the shared optimizer. Observation photos
    // continue through their authenticated, private/no-store endpoint.
    localPatterns: [{pathname: "/_next/static/media/**", search: ""}],
    qualities: [75],
  },
};

export default nextConfig;
