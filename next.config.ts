import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon: it must stay a real Node require, not a
  // bundled module (D-001, D-038).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
