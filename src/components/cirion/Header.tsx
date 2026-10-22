import logoColor from "@/assets/cirion_logo_color.png.asset.json";
import logoWhite from "@/assets/cirion_logo_white.png.asset.json";
import { CANALES, COUNTRIES, type Canal, type Pais } from "@/lib/sim/data";
import { useSim } from "@/lib/sim/store";
import { fmtClock, fmtDate } from "@/lib/sim/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

export function Header() {
  const s = useSim();
  const tech = s.ui.view === "tecnica";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-3 px-6 py-3">
        <div className="flex items-center gap-4">
          <img src={tech ? logoWhite.url : logoColor.url} alt="Cirion" className="h-8 w-auto" />
          <div className="h-8 w-px bg-border" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">Invoice Delivery Control</div>
            <div className="text-[11px] text-muted-foreground">Facturación LATAM · {fmtDate(s.simNow)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1">
          <span className="live-dot" />
          <span className="text-[11px] font-semibold tracking-wider text-success">EN VIVO</span>
          <span className="font-mono text-xs tabular text-foreground">{fmtClock(s.simNow)}</span>
          {s.speed > 1 && <span className="font-mono text-[10px] text-magenta">×{s.speed}</span>}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={s.ui.country} onValueChange={(v) => s.setUi({ country: v as Pais | "ALL" })}>
            <SelectTrigger className="h-9 w-[180px] bg-card text-sm" aria-label="País">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  <span className="mr-1.5">{c.flag}</span>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={s.ui.channel} onValueChange={(v) => s.setUi({ channel: v as Canal | "ALL" })}>
            <SelectTrigger className="h-9 w-[210px] bg-card text-sm" aria-label="Canal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los canales</SelectItem>
              {CANALES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div data-tour="toggle" className="relative flex rounded-xl border border-border bg-muted p-1" role="tablist">
            <span className={cn("absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-primary shadow transition-all duration-300", tech ? "left-[calc(50%)]" : "left-1")} />
            {(["negocio", "tecnica"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={s.ui.view === v}
                onClick={() => s.setUi({ view: v })}
                className={cn("relative z-10 w-[120px] rounded-lg py-1.5 text-sm font-semibold transition-colors", s.ui.view === v ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "negocio" ? "Vista Negocio" : "Vista Técnica"}
              </button>
            ))}
          </div>

          <Button variant="outline" className="h-9 gap-1.5 border-magenta/40 text-magenta hover:bg-magenta/10 hover:text-magenta" onClick={() => s.setUi({ tourStep: 0 })}>
            <Play className="size-3.5 fill-current" /> Presentación
          </Button>
        </div>
      </div>
    </header>
  );
}
