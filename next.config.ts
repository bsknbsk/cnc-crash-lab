import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
        // Leave *.module.css to Next's default CSS Modules pipeline so the
        // class-name mapping is generated instead of `undefined`.
        condition: { not: { path: /\.module\.css$/ } },
      },
    },
  },
};

export default nextConfig;
