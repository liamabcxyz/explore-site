import { execSync } from "node:child_process";

const basePath = process.env.BASEURL ? `/${process.env.BASEURL}` : "";

// Bake the current commit + build time into the client so a "report a
// problem" bundle can name the exact code that produced its numbers.
// Fall back cleanly outside a git checkout (installed tarball, docker
// build with a shallow clone that misses HEAD, etc.) — an "unknown" here
// is much better than crashing the build.
let gitSha = "unknown";
try {
  gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // leave "unknown"
}
const buildTime = new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_GIT_SHA: gitSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  images: {
    unoptimized: true,
  },
  webpack(config) {
    // Enable WebAssembly for @geoarrow/geoarrow-wasm
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Handle SVG imports as React components (replaces vite-plugin-svgr)
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.(".svg")
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports not ending with ?react
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: { not: [/react/] },
      },
      // Convert *.svg?react imports to React components
      {
        test: /\.svg$/i,
        resourceQuery: /react/,
        use: ["@svgr/webpack"],
      }
    );

    // Modify the file loader rule to ignore *.svg
    fileLoaderRule.exclude = /\.svg$/i;

    // Handle .wasm?url imports
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    return config;
  },
};

export default nextConfig;
