import type { NextConfig } from "next";
import { securityHeaders } from "@/lib/security/headers";

const nextConfig: NextConfig = {
  agentRules: false,
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl)
      throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set to configure security headers");
    return [{ source: "/(.*)", headers: securityHeaders(supabaseUrl) }];
  },
};

export default nextConfig;
