import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./keys";

/**
 * Browser-side Supabase client. Persists the session and auto-refreshes the
 * access token so an installed PWA stays logged in across launches — re-auth
 * (email OTP) is only needed on explicit logout or a genuinely lost session.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
