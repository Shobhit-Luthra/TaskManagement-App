import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// One verified Supabase user lookup per request: the layout, nested layouts and the page all
// ask for the user, and each uncached call is a network round trip to the auth server.
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
