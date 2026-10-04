// Member address lookup shared by /workspace and the /agents/new expert picker.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const LOOKUP_CONCURRENCY = 10;

// Server only. The admin client is used for nothing but these lookups, and only for
// user ids the user-scoped (RLS) query already returned.
export async function lookupEmails(userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (userIds.length === 0) return emails;
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return emails;
  }
  for (let i = 0; i < userIds.length; i += LOOKUP_CONCURRENCY) {
    const batch = userIds.slice(i, i + LOOKUP_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((id) => admin.auth.admin.getUserById(id)));
    results.forEach((r, j) => {
      const email = r.status === "fulfilled" ? r.value.data?.user?.email : undefined;
      if (email) emails.set(batch[j], email);
    });
  }
  return emails;
}
