"use client";

import { useEffect, useRef } from "react";
import { TabBar } from "@/components/ui/TabBar";

/**
 * The authenticated app shell, sized to the *visual* viewport.
 *
 * iOS Safari (unlike Android Chrome's `interactive-widget=resizes-content`)
 * does not shrink the layout viewport when the soft keyboard opens: `100dvh`
 * stays full-height, so Safari scrolls the whole page up to reveal the focused
 * input — yanking the chat log up and leaving dead space below the bar.
 *
 * We instead pin a fixed-position frame to the visual viewport: its height
 * tracks `visualViewport.height` (shrinks with the keyboard) and it is
 * translated by `visualViewport.offsetTop` so it always overlays the visible
 * region. Result: the composer + tab bar sit directly above the keyboard with
 * no yank and no gap. Falls back to `h-dvh` before JS runs / where the API is
 * absent.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.height = `${vv.height}px`;
        // `none` (not translateY(0)) when unshifted, so we don't create a
        // containing block that would clip full-screen sheets to the column.
        el.style.transform = vv.offsetTop
          ? `translateY(${vv.offsetTop}px)`
          : "none";
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 top-0 mx-auto flex h-dvh w-full max-w-md flex-col pt-[env(safe-area-inset-top)]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <TabBar />
    </div>
  );
}
