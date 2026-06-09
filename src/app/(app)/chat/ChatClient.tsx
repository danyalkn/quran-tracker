"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GroupMember, Message } from "@/lib/types";
import { chatStamp, timeLabel } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { useSwipeDownDismiss } from "@/lib/useSwipeDownDismiss";

// Show a centered time separator when a message lands ≥1h after the previous
// one (within the hour, consecutive messages share the last separator).
const GAP_MS = 60 * 60 * 1000;

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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const caretToSet = useRef<number | null>(null);

  // Swipe-left-to-reveal message times (iMessage-style).
  const [revealX, setRevealX] = useState(0);
  const drag = useRef<{ x: number; y: number; axis: null | "x" | "y" } | null>(
    null,
  );

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

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      atBottomRef.current = true;
    });
  }, []);

  // Re-fetch + merge messages. Heals gaps left when the realtime socket drops
  // (backgrounded PWA, network blip) — missed messages reappear without the
  // user having to manually refresh.
  const syncMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(100);
    const server = ((data as Message[] | null) ?? []).reverse();
    if (server.length === 0) return;
    setMessages((prev) => {
      const byId = new Map<string, Message>();
      for (const m of server) byId.set(m.id, m);
      // keep still-pending optimistic sends not yet on the server
      for (const m of prev) {
        if (m.id.startsWith("temp-") && !byId.has(m.id)) byId.set(m.id, m);
      }
      const next = Array.from(byId.values()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      // No change → keep the same reference so we don't re-render / re-scroll.
      if (
        next.length === prev.length &&
        next.every((m, i) => m.id === prev[i].id)
      ) {
        return prev;
      }
      return next;
    });
  }, [groupId]);

  // Realtime: append others' new messages (our own are handled on send). On
  // every (re)subscribe we resync to backfill anything missed while down.
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") syncMessages();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, userId, syncMessages]);

  // Resync when the app returns to the foreground — the socket usually dies
  // while backgrounded on mobile / in a standalone PWA.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === "visible") syncMessages();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [syncMessages]);

  // Safety-net poll while the chat is open and visible: catches messages even
  // if realtime silently dropped without us backgrounding (the "it didn't
  // update until I refreshed" case). Cheap — merge is a no-op when nothing's new.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") syncMessages();
    }, 20_000);
    return () => clearInterval(id);
  }, [syncMessages]);

  // Note how close to the bottom we are, so incoming messages don't yank the
  // view when the user has scrolled up to read history.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Auto-scroll on new messages: always for our own sends, otherwise only when
  // already pinned to the bottom.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.user_id === userId || atBottomRef.current) scrollToBottom();
  }, [messages, userId, scrollToBottom]);

  // Land at the bottom on first open.
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pinned to the bottom when the keyboard opens (the viewport shrinks).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (atBottomRef.current) scrollToBottom();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  // Swipe the conversation left to reveal each message's time.
  const onListTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    drag.current = { x: t.clientX, y: t.clientY, axis: null };
  };
  const onListTouchMove = (e: React.TouchEvent) => {
    const s = drag.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (s.axis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (s.axis === "x") setRevealX(Math.max(-64, Math.min(0, dx)));
  };
  const onListTouchEnd = () => {
    drag.current = null;
    setRevealX(0);
  };

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
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        style={{ touchAction: "pan-y" }}
        className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-xs text-center">
            <p className="text-callout font-semibold">No messages yet</p>
            <p className="mt-1 text-footnote text-muted">
              Say salaam to your circle. Use @ to tag someone.
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col gap-2.5"
            style={{
              transform: `translateX(${revealX}px)`,
              transition: revealX === 0 ? "transform 220ms var(--ease-spring)" : "none",
            }}
          >
            {messages.map((msg, idx) => {
              const mine = msg.user_id === userId;
              const sender = memberMap.get(msg.user_id);
              const prev = messages[idx - 1];
              const gap = prev
                ? new Date(msg.created_at).getTime() -
                  new Date(prev.created_at).getTime()
                : Infinity;
              const showStamp = gap >= GAP_MS;
              const showSender =
                !mine && (showStamp || !prev || prev.user_id !== msg.user_id);
              const pending = msg.id.startsWith("temp-");
              return (
                <div key={msg.id}>
                  {showStamp && (
                    <div className="flex justify-center py-2">
                      <span className="text-[11px] font-medium text-faint">
                        {chatStamp(msg.created_at, tz)}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "relative flex items-end gap-2",
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
                        <p className="mb-0.5 text-footnote font-semibold text-accent">
                          {sender?.display_name ?? "Member"}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words text-callout">
                        <MessageBody
                          body={msg.body}
                          names={memberNames}
                          mine={mine}
                        />
                      </p>
                    </div>
                    {/* Time revealed by swiping the conversation left. Offset a
                        full px-4 past the row edge so it stays hidden (the
                        scroller clips at the padding box, not the content box)
                        until the swipe shifts it into view. */}
                    <span className="pointer-events-none absolute left-[calc(100%+1rem)] top-1/2 w-16 -translate-y-1/2 pr-3 text-right text-[11px] tabular-nums text-faint">
                      {pending ? "…" : timeLabel(msg.created_at, tz)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
