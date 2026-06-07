"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GroupMember, Message } from "@/lib/types";
import { timeLabel } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { useSwipeDownDismiss } from "@/lib/useSwipeDownDismiss";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Render a message body, highlighting @mentions of known members. */
function MessageBody({
  body,
  names,
  mine,
}: {
  body: string;
  names: string[];
  mine: boolean;
}) {
  if (names.length === 0) return <>{body}</>;
  const re = new RegExp(`@(${names.map(escapeRe).join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(body))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      <span
        key={i++}
        className={cn(
          "rounded px-0.5 font-semibold",
          mine ? "underline" : "bg-accent-tint text-accent",
        )}
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return <>{out}</>;
}

export function ChatClient({
  groupId,
  groupName,
  tz,
  userId,
  members,
  initialMessages,
  initialNotifyChat,
}: {
  groupId: string;
  groupName: string;
  tz: string;
  userId: string;
  members: GroupMember[];
  initialMessages: Message[];
  initialNotifyChat: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [mentionQuery, setMentionQuery] = useState<{
    q: string;
    start: number;
  } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const caretToSet = useRef<number | null>(null);

  const [showMembers, setShowMembers] = useState(false);
  const [notifyChat, setNotifyChat] = useState(initialNotifyChat);

  // Swipe down on the composer to dismiss the keyboard.
  const swipeDown = useSwipeDownDismiss();

  const toggleNotifyChat = async () => {
    const next = !notifyChat;
    setNotifyChat(next);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ notify_chat: next })
      .eq("id", userId);
    if (error) setNotifyChat(!next); // revert on failure
  };

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.user_id, m])),
    [members],
  );
  const memberNames = useMemo(
    () => members.map((m) => m.display_name),
    [members],
  );

  // Realtime: append others' new messages (our own are handled on send).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`messages-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          if (row.user_id === userId) return;
          setMessages((prev) =>
            prev.some((x) => x.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, userId]);

  // Keep pinned to the latest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Restore caret after inserting a mention.
  useEffect(() => {
    if (caretToSet.current != null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        caretToSet.current,
        caretToSet.current,
      );
      caretToSet.current = null;
    }
  }, [draft]);

  const suggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.q.toLowerCase();
    return members
      .filter((m) => m.display_name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [mentionQuery, members]);

  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (m) {
      setMentionQuery({ q: m[1], start: caret - m[1].length - 1 });
      setActiveIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  const pickMention = (member: GroupMember) => {
    if (!mentionQuery) return;
    const caret =
      inputRef.current?.selectionStart ?? mentionQuery.start + mentionQuery.q.length + 1;
    const before = draft.slice(0, mentionQuery.start);
    const after = draft.slice(caret);
    const insert = `@${member.display_name} `;
    const next = before + insert + after;
    caretToSet.current = (before + insert).length;
    setDraft(next);
    setMentionQuery(null);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    const mentioned = members
      .filter((m) => body.includes(`@${m.display_name}`))
      .map((m) => m.user_id);

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      group_id: groupId,
      user_id: userId,
      body,
      mentions: mentioned,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setMentionQuery(null);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .insert({ group_id: groupId, user_id: userId, body, mentions: mentioned })
      .select("*")
      .single();

    if (error || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? (data as Message) : m)),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-7">
        <button
          onClick={() => setShowMembers(true)}
          className="min-w-0 flex-1 text-left"
        >
          <h1 className="truncate text-title3">{groupName}</h1>
          <p className="text-caption text-faint">
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </button>
        <button
          onClick={() => setShowMembers(true)}
          aria-label="Group members"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"
        >
          <Users className="size-5" />
        </button>
      </header>

      <Sheet
        open={showMembers}
        onClose={() => setShowMembers(false)}
        labelledBy="members-title"
      >
        <div className="px-5 pt-2">
          <h2 id="members-title" className="text-title2">
            {groupName}
          </h2>
          <p className="mb-4 mt-0.5 text-footnote text-muted">
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>

          {/* Personal notification preference */}
          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1">
            <div className="min-w-0 flex-1">
              <p className="text-callout font-semibold">Message notifications</p>
              <p className="text-footnote text-muted">
                {notifyChat
                  ? "On — you're notified for new messages."
                  : "Off — only @mentions notify you."}
              </p>
            </div>
            <button
              onClick={toggleNotifyChat}
              aria-pressed={notifyChat}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                notifyChat ? "bg-accent" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
                  notifyChat ? "left-[1.375rem]" : "left-0.5",
                )}
              />
            </button>
          </div>

          <p className="mb-2 px-1 text-footnote font-medium uppercase tracking-wider text-faint">
            Members
          </p>
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.user_id}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-e1"
              >
                <Avatar name={m.display_name} src={m.avatar_url} size={40} />
                <span className="truncate text-callout font-medium">
                  {m.display_name}
                  {m.user_id === userId && (
                    <span className="text-faint"> (You)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="m-auto max-w-xs text-center">
            <p className="text-callout font-semibold">No messages yet</p>
            <p className="mt-1 text-footnote text-muted">
              Say salaam to your circle. Use @ to tag someone.
            </p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const mine = msg.user_id === userId;
          const sender = memberMap.get(msg.user_id);
          const prev = messages[idx - 1];
          const showSender =
            !mine && (!prev || prev.user_id !== msg.user_id);
          const pending = msg.id.startsWith("temp-");
          return (
            <div
              key={msg.id}
              className={cn(
                "flex items-end gap-2",
                mine ? "justify-end" : "justify-start",
              )}
            >
              {!mine && (
                <div className="w-7 shrink-0">
                  {showSender && (
                    <Avatar
                      name={sender?.display_name ?? "Member"}
                      src={sender?.avatar_url}
                      size={28}
                    />
                  )}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-e1",
                  mine
                    ? "rounded-br-md bg-accent text-on-accent"
                    : "rounded-bl-md bg-surface",
                  pending && "opacity-70",
                )}
              >
                {showSender && (
                  <p className="text-footnote font-semibold text-accent">
                    {sender?.display_name ?? "Member"}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words text-callout">
                  <MessageBody body={msg.body} names={memberNames} mine={mine} />
                </p>
                <p
                  className={cn(
                    "mt-1 text-right text-[10px] tabular-nums",
                    mine ? "text-on-accent/70" : "text-faint",
                  )}
                >
                  {pending ? "sending…" : timeLabel(msg.created_at, tz)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div
        {...swipeDown}
        className="relative border-t border-border bg-surface px-3 py-2.5"
      >
        {/* Mention typeahead */}
        {mentionQuery && suggestions.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-e3">
            {suggestions.map((s, i) => (
              <button
                key={s.user_id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(s);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === activeIdx ? "bg-accent-tint" : "",
                )}
              >
                <Avatar name={s.display_name} src={s.avatar_url} size={28} />
                <span className="text-callout font-medium">
                  {s.display_name}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) =>
              onDraftChange(e.target.value, e.target.selectionStart ?? 0)
            }
            onKeyDown={onKeyDown}
            placeholder={`Message ${groupName}…`}
            className="max-h-32 flex-1 resize-none rounded-2xl bg-surface-2 px-4 py-2.5 text-callout text-foreground placeholder:text-faint outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent shadow-e2 transition active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100"
          >
            <Send className="size-[18px]" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}
