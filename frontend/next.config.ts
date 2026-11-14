import type { NextConfig } from "next";

const backendOrigin = new URL(
  process.env.ADROBOT_BACKEND_ORIGIN ?? "http://127.0.0.1:8000",
);

if (
  !["http:", "https:"].includes(backendOrigin.protocol) ||
  backendOrigin.username ||
  backendOrigin.password ||
  backendOrigin.pathname !== "/" ||
  backendOrigin.search ||
  backendOrigin.hash
) {
  throw new Error("ADROBOT_BACKEND_ORIGIN must be an HTTP(S) origin");
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/integrations/keitaro/campaigns/:id",
        destination: `${backendOrigin.origin}/api/v1/integrations/keitaro/campaigns/:id`,
      },
      {
        source: "/api/v1/integrations/keitaro/campaigns",
        destination: `${backendOrigin.origin}/api/v1/integrations/keitaro/campaigns`,
      },
    ];
  },
};

export default nextConfig;
