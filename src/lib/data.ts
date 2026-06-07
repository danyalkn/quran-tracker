import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  LogRow,
  Membership,
  Reminder,
  GroupMember,
  Message,
} from "@/lib/types";

/** The current user's first group membership (the app assumes one circle). */
export async function getMyMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("group_members")
    .select("group_id, role, groups(name)")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const group = data.groups as unknown as { name: string } | null;
  return {
    group_id: data.group_id as string,
    group_name: group?.name ?? "Your circle",
    role: (data.role as string) ?? "member",
  };
}

/** The signed-in user's own entries since `sinceDays` ago (for Today + streak). */
export async function getMyRecentEntries(
  groupId: string,
  userId: string,
  sinceDays = 120,
): Promise<LogRow[]> {
  const supabase = await createClient();
  const since = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false });

  return (data as LogRow[] | null) ?? [];
}

/** Everyone in the group, with their profile name/avatar (for chat + feed).
 *  Two queries on purpose: there is no direct FK group_members.user_id →
 *  profiles.id (both reference auth.users), so a PostgREST embed can't resolve
 *  it. We fetch the member ids, then their profiles. */
export async function getGroupMembers(
  groupId: string,
): Promise<GroupMember[]> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  const ids = ((rows as { user_id: string }[] | null) ?? []).map(
    (r) => r.user_id,
  );
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  const byId = new Map(
    (
      (profiles as
        | {
            id: string;
            display_name: string | null;
            avatar_url: string | null;
          }[]
        | null) ?? []
    ).map((p) => [p.id, p]),
  );

  return ids.map((id) => ({
    user_id: id,
    display_name: byId.get(id)?.display_name ?? "Member",
    avatar_url: byId.get(id)?.avatar_url ?? null,
  }));
}

/** Recent messages for the group, oldest→newest (for the chat view). */
export async function getGroupMessages(
  groupId: string,
  limit = 100,
): Promise<Message[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as Message[] | null) ?? [];
  return rows.reverse();
}

/** All entries in the group (every member) for the feed. */
export async function getGroupEntries(
  groupId: string,
  sinceDays = 30,
): Promise<LogRow[]> {
  const supabase = await createClient();
  const since = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false })
    .limit(1000);
  return (data as LogRow[] | null) ?? [];
}

/** Recipients the user has nudged in the last 24h (for the ~1/day limit). */
export async function getMyNudgesToday(userId: string): Promise<string[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("nudges")
    .select("to_user")
    .eq("from_user", userId)
    .gte("created_at", since);
  return ((data as { to_user: string }[] | null) ?? []).map((r) => r.to_user);
}

/** The current user's reminders, earliest first. */
export async function getMyReminders(userId: string): Promise<Reminder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .order("time", { ascending: true });
  return (data as Reminder[] | null) ?? [];
}
