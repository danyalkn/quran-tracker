import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mb-2 text-footnote font-medium uppercase tracking-wider text-faint",
        className,
      )}
    >
      {children}
    </p>
  );
}

const inputBase =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-callout text-foreground " +
  "placeholder:text-faint outline-none transition focus:border-accent " +
  "focus:ring-2 focus:ring-accent/20";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputBase, className)} {...rest} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(inputBase, "min-h-[88px] resize-none", className)}
      {...rest}
    />
  );
});
