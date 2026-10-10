import type { NextConfig } from "next";
import { embedFrameAncestors, NO_FRAME_ANCESTORS } from "./src/embed/frame-ancestors";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // The Vercel Function body limit. The Event image upload (src/admin/images) sends at most
      // 4 MB of file; the browser shrinks a larger file first.
      bodySizeLimit: "4.5mb",
    },
  },
  async headers() {
    // When two rules set the same header, the last one wins: the Embed rule must come last.
    return [
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: NO_FRAME_ANCESTORS }] },
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: embedFrameAncestors(process.env.EMBED_EXTRA_FRAME_ANCESTORS),
          },
        ],
      },
      // A change to the Embed script reaches the host pages within 5 minutes.
      { source: "/embed.js", headers: [{ key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
