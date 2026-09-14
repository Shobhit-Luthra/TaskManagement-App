import type { VercelConfig } from "@vercel/config/v1";

// Keep functions close to the Supabase data plane in Mumbai.
export const config: VercelConfig = {
  framework: "nextjs",
  regions: ["bom1"],
};
