import { redirect } from "next/navigation";
import { getAuth, isOnboarded } from "@/lib/auth";
import { getMyMembership, getMyRecentEntries } from "@/lib/data";
import { TodayClient } from "./TodayClient";

export default async function TodayPage() {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  const membership = await getMyMembership();
  const entries = membership
    ? await getMyRecentEntries(membership.group_id, user.id)
    : [];

  return (
    <TodayClient
      mode={profile.mode}
      tz={profile.timezone}
      displayName={profile.display_name ?? "You"}
      avatarUrl={profile.avatar_url}
      userId={user.id}
      groupId={membership?.group_id ?? null}
      initialEntries={entries}
    />
  );
}
