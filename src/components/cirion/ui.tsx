import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Estado } from "@/lib/sim/data";

export function Panel({ title, subtitle, right, children, className, tour }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; tour?: string }) {
  return (
    <section data-tour={tour} className={cn("card-surface p-5", className)}>
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      const e = 1 - Math.pow(1 - p, 3);
      const v = a + (b - a) * e;
      setShown(v);
      from.current = v;
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span className={cn("tabular", className)}>{format(shown)}</span>;
}

export type Tone = "success" | "warning" | "danger" | "brand" | "muted" | "magenta";

export const toneOf = (e: Estado): Tone => {
  switch (e) {
    case "Aceptada":
    case "Pagada":
    case "Confirmada":
      return "success";
    case "Reintento programado":
      return "warning";
    case "Rechazada":
    case "Bloqueada por validación":
    case "Excepción (revisión humana)":
      return "danger";
    case "Duplicado bloqueado":
      return "muted";
    default:
      return "brand";
  }
};

const toneCls: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/25",
  brand: "bg-primary/10 text-primary border-primary/20",
  muted: "bg-muted text-muted-foreground border-border",
  magenta: "bg-magenta/12 text-magenta border-magenta/25",
};

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", toneCls[tone], className)}>{children}</span>;
}

export function StatusPill({ estado }: { estado: Estado }) {
  return (
    <Pill tone={toneOf(estado)}>
      <span className="size-1.5 rounded-full bg-current" />
      {estado}
    </Pill>
  );
}

export function Dot({ tone }: { tone: "ok" | "degradado" | "caido" }) {
  return <span className={cn("inline-block size-2.5 rounded-full", tone === "ok" ? "bg-success" : tone === "degradado" ? "bg-warning" : "bg-danger animate-pulse")} />;
}

/** Curved magenta stroke inspired by the Cirion mark */
export function MagentaStroke({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 200" fill="none" className={className} aria-hidden>
      <path d="M10 170 C 160 20, 360 10, 590 90" stroke="var(--magenta)" strokeWidth="10" strokeLinecap="round" />
      <path d="M60 190 C 210 70, 400 60, 590 130" stroke="var(--magenta)" strokeOpacity="0.35" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Sparkline({ data, className, stroke = "var(--cyan)" }: { data: number[]; className?: string; stroke?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data) * 1.1;
  const min = Math.min(...data) * 0.9;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={className}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
