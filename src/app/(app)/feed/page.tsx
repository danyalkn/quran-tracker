import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getAuth, isOnboarded } from "@/lib/auth";
import {
  getMyMembership,
  getGroupMembers,
  getGroupEntries,
  getMyNudgesToday,
} from "@/lib/data";
import { Placeholder } from "@/components/Placeholder";
import { FeedClient } from "./FeedClient";

export default async function FeedPage() {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  const membership = await getMyMembership();
  if (!membership) {
    return (
      <Placeholder
        icon={Users}
        title="Feed"
        note="You’re not in a circle yet. Ask the group owner to add you, then your circle’s activity shows up here."
      />
    );
  }

  const [members, entries, nudgedToday] = await Promise.all([
    getGroupMembers(membership.group_id),
    getGroupEntries(membership.group_id),
    getMyNudgesToday(user.id),
  ]);

  return (
    <FeedClient
      groupId={membership.group_id}
      groupName={membership.group_name}
      tz={profile.timezone}
      userId={user.id}
      members={members}
      initialEntries={entries}
      nudgedToday={nudgedToday}
    />
  );
}
