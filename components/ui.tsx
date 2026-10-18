import Link from "next/link";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const variants = {
    primary: "bg-accent text-accent-foreground hover:opacity-90",
    secondary: "border border-line bg-card hover:bg-background",
    danger: "bg-danger text-white hover:opacity-90",
    ghost: "hover:bg-background",
  };
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none ring-accent/30 focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-28 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none ring-accent/30 focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-muted">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const tones: Record<string, string> = {
  RECEIVED: "bg-stone-200/70 text-stone-800",
  PROCESSING: "bg-sky-100 text-sky-900",
  PROCESSED: "bg-emerald-100 text-emerald-900",
  NEEDS_REVIEW: "bg-amber-100 text-amber-950",
  VALIDATED: "bg-emerald-700/10 text-accent",
  REJECTED: "bg-red-100 text-danger",
  ERROR: "bg-red-100 text-danger",
  DRAFT: "bg-stone-200/70 text-stone-800",
  SENT: "bg-sky-100 text-sky-900",
  DUE: "bg-amber-100 text-amber-950",
  OVERDUE: "bg-red-100 text-danger",
  PAID: "bg-emerald-100 text-emerald-900",
  MATCH: "bg-emerald-100 text-emerald-900",
  PARTIAL_MATCH: "bg-amber-100 text-amber-950",
  MISMATCH: "bg-red-100 text-danger",
  UNMATCHED: "bg-stone-200/70 text-stone-700",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", tones[status] ?? tones.RECEIVED)}>{label}</span>;
}

export function EmptyState({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card px-6 py-14 text-center">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{body}</p>
      {href && action && (
        <Link href={href} className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground">
          {action}
        </Link>
      )}
    </div>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-line bg-card", className)}>{children}</section>;
}
