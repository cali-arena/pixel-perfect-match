import { useMemo, useRef, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Clock, FileCheck2, Search, ShieldCheck, Timer, Wallet, Zap } from "lucide-react";
import { CANAL_SHORT, COUNTRY_NAME } from "@/lib/sim/data";
import { cobroEstimado, flagOf, searchInvoices, useSim, type Invoice } from "@/lib/sim/store";
import { fmtAgo, fmtDate, fmtDayShort, fmtInt, fmtMoney, fmtPct, fmtUsd } from "@/lib/sim/format";
import { CountUp, MagentaStroke, Panel, Pill, StatusPill } from "./ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LiveFeed } from "./LiveFeed";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--foreground)" };

export function BusinessView() {
  const s = useSim();
  const d = s.derived();
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        <Hero />
        <Kpis />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Funnel />
          <Cash />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          <ByCountry />
          <ByChannel />
        </div>
        <Attention />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Reasons />
          <Trend />
        </div>
        <p className="sr-only">{d.todayCount}</p>
      </div>
      <aside className="xl:sticky xl:top-[84px] xl:h-[calc(100vh-110px)]">
        <LiveFeed />
      </aside>
    </div>
  );
}

function Hero() {
  const s = useSim();
  const q = s.ui.search;
  const [focus, setFocus] = useState(false);
  const results = useMemo(() => searchInvoices(s, q), [s, q, s.version > 0 && q]);
  const open = (focus || s.ui.tourStep === 0) && q.trim().length >= 2;
  return (
    <section className="relative overflow-visible rounded-2xl bg-hero p-8 text-primary-foreground shadow-lg tech:border tech:border-border">
      <MagentaStroke className="pointer-events-none absolute -right-6 -top-4 h-48 w-[520px] opacity-90" />
      <div className="relative max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] opacity-75">Pregunta de la Dirección Financiera</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight">¿Esta factura llegó, fue aceptada y cuándo vamos a cobrar?</h1>
        <div data-tour="search" className="relative mt-6">
          <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => s.setUi({ search: e.target.value })}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 180)}
            placeholder="Buscar por número fiscal, cliente, OC, CUFE / UUID / chave…"
            className="h-14 w-full rounded-xl border border-border bg-card pl-12 pr-4 text-[15px] text-foreground shadow-xl outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-magenta"
          />
          {open && (
            <div className="absolute left-0 right-0 top-[60px] z-30 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
              {results.length === 0 && <div className="p-4 text-sm text-muted-foreground">Sin coincidencias para “{q}”.</div>}
              {results.map((inv) => (
                <SearchRow key={inv.id} inv={inv} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SearchRow({ inv }: { inv: Invoice }) {
  const s = useSim();
  const cobro = cobroEstimado(inv);
  return (
    <button onMouseDown={() => s.setUi({ selectedId: inv.id })} className="flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-muted">
      <span className="text-xl">{flagOf(inv.pais)}</span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm font-medium">{inv.numero}</div>
        <div className="truncate text-xs text-muted-foreground">
          {inv.cliente} · {CANAL_SHORT[inv.canal]} {inv.oc ? `· OC ${inv.oc}` : ""}
        </div>
      </div>
      <div className="text-right">
        <StatusPill estado={inv.estado} />
        <div className="mt-1 text-[11px] text-muted-foreground">{cobro ? `Cobro est. ${fmtDate(cobro)}` : "Sin fecha de cobro"}</div>
      </div>
      <ArrowRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function Kpis() {
  const d = useSim().derived();
  const items = [
    { icon: FileCheck2, label: "Facturas hoy", value: d.todayCount, f: fmtInt, sub: `${fmtInt(d.monthCount)} en el mes` },
    { icon: Timer, label: "Entregadas en plazo (SLA)", value: d.slaPct, f: (n: number) => fmtPct(n), sub: "Presentación dentro del SLA del cliente" },
    { icon: ShieldCheck, label: "Aceptadas por el cliente", value: d.acceptPct, f: (n: number) => fmtPct(n), sub: "Sobre facturas con respuesta" },
    { icon: AlertTriangle, label: "En riesgo de vencer SLA", value: d.atRisk, f: fmtInt, sub: "Requieren prioridad hoy", warn: d.atRisk > 0 },
    { icon: Wallet, label: "Monto en tránsito", value: d.transitUsd, f: (n: number) => fmtUsd(n, true), sub: "Enviado, aún sin aceptación" },
    { icon: Zap, label: "Horas manuales evitadas", value: d.hoursSaved, f: fmtInt, sub: "En el mes · 14 min por documento" },
  ];
  return (
    <div data-tour="kpis" className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
      {items.map((k) => (
        <div key={k.label} className="card-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{k.label}</span>
            <k.icon className={cn("size-4", k.warn ? "text-warning" : "text-magenta")} />
          </div>
          <CountUp value={k.value} format={k.f} className="mt-2 block text-[26px] font-semibold tracking-tight" />
          <div className="mt-1 text-[11px] text-muted-foreground">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Funnel() {
  const d = useSim().derived();
  const max = Math.max(1, d.funnel[0].value);
  return (
    <Panel tour="funnel" title="Embudo del día" subtitle="De la emisión a la aceptación del cliente">
      <div className="space-y-2.5">
        {d.funnel.map((st, i) => {
          const prev = i ? d.funnel[i - 1].value : st.value;
          const conv = prev ? st.value / prev : 1;
          return (
            <div key={st.label} className="flex items-center gap-3">
              <div className="w-24 text-xs font-medium text-muted-foreground">{st.label}</div>
              <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-muted">
                <div className="absolute inset-y-0 left-0 rounded-lg bg-primary transition-all duration-700" style={{ width: `${(st.value / max) * 100}%`, opacity: 1 - i * 0.12 }} />
                <span className="absolute inset-y-0 left-3 flex items-center font-mono text-sm font-semibold text-primary-foreground">{fmtInt(st.value)}</span>
              </div>
              <div className="w-14 text-right font-mono text-xs text-magenta">{i ? fmtPct(conv) : "—"}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Las confirmaciones y aceptaciones de portales llegan durante el día; las facturas de hoy siguen avanzando en vivo.</p>
    </Panel>
  );
}

function Cash() {
  const d = useSim().derived();
  const total = d.cashWeeks.reduce((a, b) => a + b.usd, 0);
  return (
    <Panel tour="cash" title="Proyección de cobro" subtitle="Monto aceptado por semana según plazo de pago de cada cliente" right={<div className="text-right"><div className="text-[11px] text-muted-foreground">Próximas 8 semanas</div><CountUp value={total} format={(n) => fmtUsd(n, true)} className="text-lg font-semibold" /></div>}>
      <div className="h-[220px]">
        <ResponsiveContainer>
          <BarChart data={d.cashWeeks} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `${fmtInt(v / 1000)}k`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, p) => [`${fmtUsd(v)} · ${(p.payload as { count: number }).count} facturas`, "A cobrar"]} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="usd" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {d.cashWeeks.map((_, i) => (
                <Cell key={i} fill={i === 0 ? "var(--magenta)" : "var(--chart-1)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function ByCountry() {
  const d = useSim().derived();
  const max = Math.max(1, ...d.byCountry.map((c) => c.count));
  return (
    <Panel title="Por país" subtitle="Volumen del mes, % de aceptación y monto facturado">
      <div className="space-y-2">
        {d.byCountry.map((c) => (
          <div key={c.pais} className="grid grid-cols-[150px_1fr_70px_110px] items-center gap-3 text-sm">
            <div className="flex items-center gap-2 truncate"><span className="text-lg">{flagOf(c.pais)}</span>{COUNTRY_NAME[c.pais]}</div>
            <div className="h-2.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${(c.count / max) * 100}%` }} /></div>
            <div className="text-right font-mono text-xs"><span className="text-muted-foreground">{fmtInt(c.count)} · </span><span className={c.acceptPct > 0.95 ? "text-success" : "text-warning"}>{fmtPct(c.acceptPct, 0)}</span></div>
            <div className="text-right font-mono text-xs text-muted-foreground">{fmtUsd(c.usd, true)}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const CH_COLORS = ["var(--chart-1)", "var(--magenta)", "var(--cyan)", "var(--chart-3)"];
function ByChannel() {
  const d = useSim().derived();
  const total = d.byChannel.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <Panel title="Por canal de entrega" subtitle="Documentos del mes">
      <div className="flex items-center gap-4">
        <div className="relative h-[190px] w-[190px] shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={d.byChannel} dataKey="count" nameKey="canal" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {d.byChannel.map((_, i) => <Cell key={i} fill={CH_COLORS[i]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold">{fmtInt(total)}</span><span className="text-[11px] text-muted-foreground">documentos</span></div>
        </div>
        <ul className="flex-1 space-y-2.5 text-sm">
          {d.byChannel.map((c, i) => (
            <li key={c.canal} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: CH_COLORS[i] }} />{CANAL_SHORT[c.canal]}</span>
              <span className="font-mono text-xs text-muted-foreground">{fmtPct(c.count / total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

const ROW_H = 58;
function Attention() {
  const s = useSim();
  const rows = s.derived().attention;
  const [scroll, setScroll] = useState(0);
  const viewH = 400;
  const start = Math.max(0, Math.floor(scroll / ROW_H) - 4);
  const end = Math.min(rows.length, Math.ceil((scroll + viewH) / ROW_H) + 4);
  const ref = useRef<HTMLDivElement>(null);
  const tone = { Rechazada: "danger", Excepción: "danger", Bloqueada: "magenta", "SLA en riesgo": "warning", "Sin respuesta": "brand" } as const;
  return (
    <Panel title="Requieren atención" subtitle={`${fmtInt(rows.length)} facturas priorizadas por impacto en el cobro`} right={<Pill tone="danger">{rows.filter((r) => r.prioridad <= 2).length} críticas</Pill>}>
      <div className="grid grid-cols-[110px_1.4fr_1fr_120px_1.6fr_70px_1.1fr_100px] gap-3 border-b border-border px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Tipo</span><span>Cliente</span><span>Factura</span><span className="text-right">Monto</span><span>Motivo</span><span className="text-right">Días</span><span>Acción sugerida</span><span />
      </div>
      <div ref={ref} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} className="relative overflow-y-auto" style={{ height: Math.min(viewH, rows.length * ROW_H + 4) }}>
        <div style={{ height: rows.length * ROW_H }}>
          {rows.slice(start, end).map((r, k) => (
            <div key={r.inv.id} className={cn("absolute inset-x-0 grid grid-cols-[110px_1.4fr_1fr_120px_1.6fr_70px_1.1fr_100px] items-center gap-3 border-b border-border px-2 text-sm", r.inv.flashUntil && r.inv.flashUntil > Date.now() && "flash-new")} style={{ top: (start + k) * ROW_H, height: ROW_H }}>
              <Pill tone={tone[r.tipo]}>{r.tipo}</Pill>
              <div className="min-w-0"><div className="truncate font-medium">{flagOf(r.inv.pais)} {r.inv.cliente}</div><div className="text-[11px] text-muted-foreground">{CANAL_SHORT[r.inv.canal]}</div></div>
              <div className="truncate font-mono text-xs">{r.inv.numero}</div>
              <div className="text-right"><div className="font-mono text-xs">{fmtMoney(r.inv.monto, r.inv.moneda)}</div><div className="font-mono text-[10px] text-muted-foreground">{fmtUsd(r.inv.montoUsd)}</div></div>
              <div className="line-clamp-2 text-xs">{r.motivo}</div>
              <div className="text-right font-mono text-xs">{r.dias < 1 ? "hoy" : Math.floor(r.dias)}</div>
              <div className="line-clamp-2 text-xs text-muted-foreground">{r.accion}</div>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => s.setUi({ selectedId: r.inv.id })}>Ver detalle</Button>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Reasons() {
  const d = useSim().derived();
  const max = Math.max(1, ...d.reasons.map((r) => r.count));
  const n = Math.round(d.preventedShare * 10);
  return (
    <Panel tour="reasons" title="Motivos de rechazo del mes" subtitle="Detenidos por validación previa vs. rechazados por el cliente">
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-magenta/30 bg-magenta/10 p-3">
        <ShieldCheck className="size-6 shrink-0 text-magenta" />
        <p className="text-sm font-medium"><span className="text-magenta">{n} de cada 10 errores</span> se detienen antes de llegar al cliente.</p>
      </div>
      <div className="space-y-2">
        {d.reasons.slice(0, 8).map((r) => (
          <div key={r.codigo} className="text-xs">
            <div className="mb-1 flex justify-between"><span><span className="font-mono text-muted-foreground">{r.codigo}</span> {r.motivo}</span><span className="font-mono">{r.count}</span></div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" style={{ width: `${(r.count / max) * 100}%` }}>
              <div className="bg-magenta" style={{ width: `${(r.prevented / r.count) * 100}%` }} />
              <div className="flex-1 bg-danger/70" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-magenta" />Detenido antes del envío</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-danger/70" />Rechazado por el cliente</span></div>
    </Panel>
  );
}

function Trend() {
  const d = useSim().derived();
  const data = d.trend.map((t) => ({ ...t, label: fmtDayShort(t.day), ratePct: t.rate * 100 }));
  return (
    <Panel title="Tendencia 30 días" subtitle="Facturas procesadas vs. tasa de aceptación">
      <div className="h-[260px]">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="gCount" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={4} />
            <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={32} />
            <YAxis yAxisId="r" orientation="right" domain={[80, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => (n === "ratePct" ? [`${v.toFixed(1).replace(".", ",")}%`, "Aceptación"] : [fmtInt(v), "Facturas"])} />
            <Area yAxisId="l" dataKey="count" stroke="var(--chart-1)" fill="url(#gCount)" strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="r" dataKey="ratePct" stroke="var(--magenta)" strokeWidth={2.2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export { fmtAgo, Clock };
