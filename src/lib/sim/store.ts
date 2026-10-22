import { useSyncExternalStore } from "react";
import {
  CANALES,
  CLIENTS,
  FLAG,
  ISSUERS,
  REASONS,
  RATES,
  SAMPLES,
  TIPO_DOC,
  type Canal,
  type Client,
  type Estado,
  type Pais,
  type Reason,
} from "./data";
import { between, initialCounters, jobId, makeAmount, makeComprobante, makeFiscal, makeOC, mulberry32, pick, type Rng } from "./gen";
import { fmtClockMs } from "./format";

export interface Step {
  estado: Estado;
  ts: number;
}
export interface Invoice {
  id: string;
  numero: string;
  tipo: string;
  pais: Pais;
  clientId: string;
  cliente: string;
  clienteIdFiscal: string;
  clienteTipoId: string;
  canal: Canal;
  emisor: string;
  emisorId: string;
  moneda: string;
  monto: number;
  montoUsd: number;
  oc: string | null;
  linea: string;
  periodo: string;
  adjuntos: string[];
  fiscal: Record<string, string>;
  principal: string;
  comprobante: string;
  estado: Estado;
  historial: Step[];
  plan: Step[];
  motivo: Reason | null;
  motivoNota?: string;
  resuelta?: boolean;
  intentos: number;
  jobId: string;
  idemKey: string;
  createdAt: number;
  plazo: number;
  sla: number;
  live: boolean;
  flashUntil?: number;
}

export interface LogLine {
  id: number;
  ts: number;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  comp: string;
  msg: string;
  job?: string;
}
export interface FeedItem {
  id: number;
  ts: number;
  invId: string;
  estado: Estado;
}
export type ConnKey = "email" | "msportal" | "ariba";
export interface Connector {
  key: ConnKey;
  name: string;
  tech: string;
  status: "ok" | "degradado" | "caido";
  sessions: number;
  p50: number;
  p95: number;
  success24: number;
  lastError: string;
  lastErrorTs: number;
  spark: number[];
}

export type View = "negocio" | "tecnica";

export interface UiState {
  view: View;
  country: Pais | "ALL";
  channel: Canal | "ALL";
  selectedId: string | null;
  search: string;
  tourStep: number | null;
}

const PRE_SEND: Estado[] = ["Recibida", "Validada", "En cola", "Enviando", "Reintento programado"];
export const STATES_MAIN: Estado[] = ["Recibida", "Validada", "En cola", "Enviando", "Enviada", "Confirmada", "Aceptada", "Pagada"];
export const STATES_BRANCH: Estado[] = ["Bloqueada por validación", "Rechazada", "Reintento programado", "Excepción (revisión humana)", "Duplicado bloqueado"];

const H = 3600_000;
const D = 24 * H;
const M = 60_000;
const S = 1000;

const VALIDATION_REASONS = REASONS.filter((r) => ["R01", "R02", "R03", "R04", "R06", "R07", "R08"].includes(r.codigo));
const PORTAL_REASONS = REASONS.filter((r) => ["R01", "R02", "R06", "R07", "R08", "R09", "R10"].includes(r.codigo));
const reason = (c: string) => REASONS.find((r) => r.codigo === c)!;

export const connKeyOf = (c: Canal): ConnKey =>
  c === "Correo electrónico" ? "email" : c === "Microsoft Supplier Portal" ? "msportal" : "ariba";
const compOf = (c: Canal) => `connector.${connKeyOf(c)}`;
export const isPortal = (c: Canal) => c !== "Correo electrónico";

type Outcome = "ok" | "transient" | "bloqueo" | "rechazo" | "excepcion" | "duplicado" | "sinRespuesta";

function weightedClients() {
  const cum: number[] = [];
  let t = 0;
  for (const c of CLIENTS) {
    t += c.volumen_mensual;
    cum.push(t);
  }
  return (r: Rng) => {
    const x = r() * t;
    let lo = 0,
      hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return CLIENTS[lo];
  };
}

function businessHourTime(r: Rng, dayStart: number) {
  // Peak 8–19 h, with tail overnight batch
  const x = r();
  const hour = x < 0.85 ? between(r, 8, 19.5) : between(r, 0, 24);
  return dayStart + hour * H;
}

export class SimStore {
  version = 0;
  invoices: Invoice[] = [];
  byId = new Map<string, Invoice>();
  logs: LogLine[] = [];
  feed: FeedItem[] = [];
  simNow = Date.now();
  speed = 1;
  ui: UiState = { view: "negocio", country: "ALL", channel: "ALL", selectedId: null, search: "", tourStep: null };
  aribaOutage: { downUntil: number; recoverUntil: number } | null = null;
  connectors: Record<ConnKey, Connector> = {} as Record<ConnKey, Connector>;
  queueSeries: { t: number; depth: number; workers: number }[] = [];
  transitions: { t: number; to: Estado; canal: Canal }[] = [];
  flash: Partial<Record<Estado, number>> = {};
  dupBlockedToday = 0;
  errors24 = { auth: 0, timeout: 0, validacion: 0, inesperada: 0 };
  featured = { rejectedAriba: "", acceptedSearch: "" };

  private listeners = new Set<() => void>();
  private rng: Rng = mulberry32(1);
  private liveRng: Rng = mulberry32(Date.now() & 0xffff);
  private counters = initialCounters();
  private seq = 0;
  private logSeq = 0;
  private nextSpawn = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReal = 0;
  private lastSample = 0;
  private lastConn = 0;
  private lastNoise = 0;
  private dirty = false;
  private pickClient = weightedClients();
  private derivedCache: { key: string; value: Derived } | null = null;

  constructor() {
    this.reset();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setUi(p: Partial<UiState>) {
    this.ui = { ...this.ui, ...p };
    this.emit();
  }
  setSpeed(s: number) {
    this.speed = s;
    this.emit();
  }

  // ---------- generation ----------
  reset() {
    this.rng = mulberry32(20261022);
    this.counters = initialCounters();
    this.invoices = [];
    this.byId.clear();
    this.logs = [];
    this.feed = [];
    this.transitions = [];
    this.queueSeries = [];
    this.flash = {};
    this.seq = 0;
    this.aribaOutage = null;
    this.simNow = Date.now();
    const now = this.simNow;
    const r = this.rng;

    // Samples from the dataset (real-format fiscal numbers)
    for (const s of SAMPLES) {
      const client = CLIENTS.find((c) => c.id === s.cliente_id);
      const hist = s.historial.map((h) => ({ estado: h.estado, ts: new Date(h.ts).getTime() })).filter((h) => h.ts <= now);
      if (!hist.length) continue;
      const fiscal = Object.fromEntries(Object.entries(s.identificadores_fiscales).map(([k, v]) => [k, String(v)]));
      const first = Object.entries(fiscal)[0];
      const inv: Invoice = {
        id: s.id,
        numero: s.numero,
        tipo: s.tipo_documento,
        pais: s.pais,
        clientId: s.cliente_id,
        cliente: s.cliente,
        clienteIdFiscal: client?.id_fiscal ?? "",
        clienteTipoId: client?.tipo_id_fiscal ?? "",
        canal: s.canal,
        emisor: s.emisor,
        emisorId: `${ISSUERS[s.pais].tax_id_type} ${ISSUERS[s.pais].tax_id}`,
        moneda: s.moneda,
        monto: s.monto,
        montoUsd: s.monto_usd,
        oc: s.orden_compra,
        linea: s.linea_servicio,
        periodo: s.periodo_servicio,
        adjuntos: s.adjuntos,
        fiscal,
        principal: first ? `${first[0].replace(/_/g, " ")} ${first[1]}` : s.numero,
        comprobante: s.comprobante,
        estado: hist[hist.length - 1].estado,
        historial: hist,
        plan: [],
        motivo: s.motivo_rechazo ? (REASONS.find((x) => x.motivo === s.motivo_rechazo) ?? null) : null,
        intentos: s.intentos,
        jobId: jobId(r),
        idemKey: `${s.pais}:${s.numero.replace(/\s/g, "")}:${s.orden_compra ?? "NA"}`,
        createdAt: hist[0].ts,
        plazo: client?.plazo_pago_dias ?? 30,
        sla: client?.sla_presentacion_horas ?? 48,
        live: false,
      };
      // sample accepted → schedule payment
      if (inv.estado === "Aceptada") {
        const acc = hist[hist.length - 1].ts;
        const pay = acc + inv.plazo * D;
        if (pay <= now) {
          inv.historial.push({ estado: "Pagada", ts: pay });
          inv.estado = "Pagada";
        }
      }
      this.add(inv);
    }

    // Month history: 31 days back, ~85 docs per business day
    const today0 = new Date(now);
    today0.setHours(0, 0, 0, 0);
    for (let d = 31; d >= 0; d--) {
      const dayStart = today0.getTime() - d * D;
      const dow = new Date(dayStart).getDay();
      const weekend = dow === 0 || dow === 6;
      const n = weekend ? Math.round(between(r, 3, 9)) : Math.round(between(r, 72, 96));
      for (let i = 0; i < n; i++) {
        const t0 = businessHourTime(r, dayStart);
        if (t0 > now) continue;
        this.add(this.build(r, this.pickClient(r), t0, false));
      }
    }

    // Guaranteed story invoices for presentation mode
    const ariba = CLIENTS.find((c) => c.canal === "SAP Ariba" && c.pais === "CO") ?? CLIENTS.find((c) => c.canal === "SAP Ariba")!;
    const rej = this.build(r, ariba, now - 26 * H, false, "rechazo", reason("R01"));
    rej.motivoNota = `La OC ${rej.oc} figura como cerrada en Ariba desde el 30 sep. La validación previa (regla R01 · vigencia de OC) la habría detenido antes del envío.`;
    this.add(rej);
    this.featured.rejectedAriba = rej.id;
    const accepted = [...this.invoices].reverse().find((i) => i.estado === "Aceptada" && i.canal === "SAP Ariba" && i.pais === "CO")
      ?? [...this.invoices].reverse().find((i) => i.estado === "Aceptada")!;
    this.featured.acceptedSearch = accepted.id;

    this.invoices.sort((a, b) => a.createdAt - b.createdAt);
    this.dupBlockedToday = this.invoices.filter((i) => i.estado === "Duplicado bloqueado" && i.createdAt >= today0.getTime()).length + 2;
    const v24 = this.invoices.filter((i) => i.historial.some((h) => h.estado === "Bloqueada por validación" && h.ts > now - D)).length;
    this.errors24 = { auth: 2, timeout: 9, validacion: v24, inesperada: 3 };

    this.connectors = {
      email: { key: "email", name: "Correo electrónico", tech: "Microsoft Graph / SMTP", status: "ok", sessions: 4, p50: 0.6, p95: 1.9, success24: 0.996, lastError: "DSN 550 5.1.1 buzón inexistente (ap@cliente)", lastErrorTs: now - 3.2 * H, spark: [] },
      msportal: { key: "msportal", name: "Microsoft Supplier Portal", tech: "Playwright · MFA aprobado", status: "ok", sessions: 2, p50: 6.4, p95: 14.8, success24: 0.981, lastError: "submit timeout 30s → reintento OK", lastErrorTs: now - 5.6 * H, spark: [] },
      ariba: { key: "ariba", name: "SAP Ariba", tech: "Playwright · Ariba Network", status: "ok", sessions: 3, p50: 8.1, p95: 19.5, success24: 0.987, lastError: "HTTP 502 en búsqueda de OC → reintento OK", lastErrorTs: now - 2.1 * H, spark: [] },
    };
    for (const c of Object.values(this.connectors)) c.spark = Array.from({ length: 30 }, () => c.p50 * between(r, 0.8, 1.25));

    for (let i = 60; i > 0; i--) {
      const depth = Math.round(between(r, 3, 12));
      this.queueSeries.push({ t: now - i * S * 2, depth, workers: 6 });
    }
    // Seed logs
    const recent = this.invoices.filter((i) => i.historial[i.historial.length - 1].ts > now - 20 * M).slice(-25);
    for (const inv of recent) this.logFor(inv, inv.estado, inv.historial[inv.historial.length - 1].ts);
    this.logs.sort((a, b) => a.ts - b.ts);
    for (const inv of this.invoices.filter((i) => i.historial[i.historial.length - 1].ts > now - 30 * M).slice(-12)) {
      this.feed.unshift({ id: ++this.logSeq, ts: inv.historial[inv.historial.length - 1].ts, invId: inv.id, estado: inv.estado });
    }
    this.feed.sort((a, b) => b.ts - a.ts);
    this.nextSpawn = now + 1500;
    this.derivedCache = null;
    this.emit();
  }

  private add(inv: Invoice) {
    this.invoices.push(inv);
    this.byId.set(inv.id, inv);
  }

  private pickOutcome(r: Rng, client: Client, t0: number): Outcome {
    const x = r();
    if (x < 0.004) return "duplicado";
    if (x < 0.92) {
      if (isPortal(client.canal) && r() < 0.025 && t0 < this.simNow - 2.5 * D) return "sinRespuesta";
      return "ok";
    }
    if (x < 0.95) return "transient";
    if (x < 0.978) return "bloqueo";
    if (x < 0.99) return "rechazo";
    return "excepcion";
  }

  build(r: Rng, client: Client, t0: number, live: boolean, forced?: Outcome, forcedReason?: Reason): Invoice {
    const pais = client.pais;
    const n = ++this.counters[pais];
    const doc = makeFiscal(r, pais, n, t0);
    const amt = makeAmount(r, client);
    const oc = makeOC(r, client);
    const outcome = forced ?? this.pickOutcome(r, client, t0);
    const portal = isPortal(client.canal);
    const d = new Date(t0);
    const periodoDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const k = live ? 1 / 600 : 1; // compress durations for live docs
    const L = (a: number, b: number) => between(r, a, b) * k;
    const steps: Step[] = [{ estado: "Recibida", ts: t0 }];
    let t = t0;
    const push = (estado: Estado, dt: number) => {
      t += dt;
      steps.push({ estado, ts: t });
    };
    let motivo: Reason | null = forcedReason ?? null;
    let intentos = 1;
    let resuelta = false;
    const liveMs = (a: number, b: number) => between(r, a, b);
    const vT = () => (live ? liveMs(2 * S, 5 * S) : L(30 * S, 3 * M));
    const qT = () => (live ? liveMs(2 * S, 4 * S) : L(M, 5 * M));
    const sT = () => (live ? liveMs(3 * S, 7 * S) : L(M, 10 * M));
    const eT = () => (live ? liveMs(portal ? 5 * S : 2 * S, portal ? 11 * S : 4 * S) : portal ? L(20 * S, 3 * M) : L(5 * S, 30 * S));
    const cT = () => (live ? liveMs(12 * S, 35 * S) : portal ? L(H, 6 * H) : L(5 * M, 30 * M));
    const aT = () => (live ? liveMs(25 * S, 90 * S) : L(2 * H, 40 * H));

    const sendChain = () => {
      push("Validada", vT());
      push("En cola", qT());
      push("Enviando", sT());
    };
    const happyTail = () => {
      push("Enviada", eT());
      push("Confirmada", cT());
      push("Aceptada", aT());
      if (!live) push("Pagada", (client.plazo_pago_dias + between(r, -3, 4)) * D);
    };

    switch (outcome) {
      case "ok":
        sendChain();
        happyTail();
        break;
      case "sinRespuesta":
        sendChain();
        push("Enviada", eT());
        push("Confirmada", between(r, 50, 110) * H);
        push("Aceptada", aT());
        break;
      case "transient":
        sendChain();
        push("Reintento programado", live ? liveMs(2 * S, 4 * S) : L(10 * S, 40 * S));
        push("Enviando", live ? liveMs(4 * S, 8 * S) : 30 * S + L(0, 4 * M));
        intentos = 2;
        happyTail();
        break;
      case "bloqueo": {
        motivo = motivo ?? pick(r, VALIDATION_REASONS);
        push("Bloqueada por validación", live ? liveMs(2 * S, 4 * S) : L(30 * S, 2 * M));
        if (!live) {
          // corrected by the billing team, resent
          push("Validada", between(r, 4, 30) * H);
          push("En cola", qT());
          push("Enviando", sT());
          intentos = 2;
          resuelta = true;
          happyTail();
        }
        break;
      }
      case "rechazo":
        motivo = motivo ?? pick(r, PORTAL_REASONS);
        sendChain();
        push("Enviada", eT());
        if (portal) push("Confirmada", cT());
        push("Rechazada", live ? liveMs(6 * S, 14 * S) : L(3 * H, 30 * H));
        break;
      case "excepcion":
        sendChain();
        push("Reintento programado", live ? liveMs(2 * S, 4 * S) : L(30 * S, M));
        push("Enviando", live ? liveMs(3 * S, 6 * S) : 30 * S);
        push("Reintento programado", live ? liveMs(2 * S, 4 * S) : L(30 * S, M));
        push("Enviando", live ? liveMs(3 * S, 6 * S) : 2 * M);
        push("Excepción (revisión humana)", live ? liveMs(2 * S, 4 * S) : L(30 * S, M));
        intentos = 3;
        if (!live && t0 < this.simNow - 3 * D) {
          push("En cola", between(r, 3, 20) * H);
          push("Enviando", sT());
          intentos = 4;
          resuelta = true;
          happyTail();
        }
        break;
      case "duplicado":
        push("Validada", vT());
        push("Duplicado bloqueado", live ? liveMs(1 * S, 2 * S) : L(5 * S, 20 * S));
        motivo = reason("R05");
        break;
    }
    const nowT = this.simNow;
    const historial = live ? [steps[0]] : steps.filter((s) => s.ts <= nowT);
    const plan = live ? steps.slice(1) : steps.filter((s) => s.ts > nowT && s.estado !== "Pagada");
    const id = `INV-${String(1000 + ++this.seq).padStart(5, "0")}-${live ? "L" : "H"}`;
    return {
      id,
      numero: doc.numero,
      tipo: TIPO_DOC[pais],
      pais,
      clientId: client.id,
      cliente: client.nombre,
      clienteIdFiscal: client.id_fiscal,
      clienteTipoId: client.tipo_id_fiscal,
      canal: client.canal,
      emisor: ISSUERS[pais].entity,
      emisorId: `${ISSUERS[pais].tax_id_type} ${ISSUERS[pais].tax_id}`,
      moneda: client.moneda,
      monto: amt.monto,
      montoUsd: amt.montoUsd,
      oc,
      linea: amt.linea,
      periodo: `${String(periodoDate.getMonth() + 1).padStart(2, "0")}/${periodoDate.getFullYear()}`,
      adjuntos: [
        ...(client.requisitos.pdf ? ["PDF"] : []),
        ...(client.requisitos.xml ? ["XML"] : []),
        ...(client.requisitos.planilla_detalle ? ["Planilla"] : []),
        ...(client.requisitos.hes_acta_conformidad ? ["HES"] : []),
      ],
      fiscal: doc.fiscal,
      principal: doc.principal,
      comprobante: makeComprobante(r, client.canal),
      estado: historial[historial.length - 1].estado,
      historial,
      plan,
      motivo,
      resuelta,
      intentos,
      jobId: jobId(r),
      idemKey: `${pais}:${doc.numero.replace(/\s|nº|·|Série/g, "")}:${oc ?? "NA"}`,
      createdAt: t0,
      plazo: client.plazo_pago_dias,
      sla: client.sla_presentacion_horas,
      live,
    };
  }

  // ---------- loop ----------
  start() {
    if (this.timer) return;
    this.lastReal = performance.now();
    this.timer = setInterval(() => this.tick(), 200);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const real = performance.now();
    const dt = real - this.lastReal;
    this.lastReal = real;
    this.simNow += dt * this.speed;
    const now = this.simNow;
    const wall = Date.now();

    if (this.aribaOutage && wall > this.aribaOutage.recoverUntil) {
      this.aribaOutage = null;
      this.connectors.ariba.status = "ok";
      this.log("INFO", "connector.ariba", "health_check ok · sesiones restablecidas · circuito cerrado", now);
      this.dirty = true;
    } else if (this.aribaOutage && wall > this.aribaOutage.downUntil && this.connectors.ariba.status === "caido") {
      this.connectors.ariba.status = "degradado";
      this.log("WARN", "connector.ariba", "health_check parcial · circuito semiabierto · drenando reintentos", now);
      this.dirty = true;
    }

    if (now >= this.nextSpawn) {
      this.spawn();
      this.nextSpawn = now + between(this.liveRng, 2000, 4000) * this.speed;
    }

    for (const inv of this.invoices) {
      if (!inv.plan.length || inv.plan[0].ts > now) continue;
      while (inv.plan.length && inv.plan[0].ts <= now) {
        const next = inv.plan[0];
        if (next.estado === "Enviada" && this.aribaDown() && connKeyOf(inv.canal) === "ariba") {
          // Outage: divert to retry, push the plan back
          inv.plan.shift();
          const delay = (between(this.liveRng, 6, 10) * S) * this.speed;
          inv.intentos++;
          this.transition(inv, "Reintento programado", now);
          this.log("WARN", "connector.ariba", `job=${inv.jobId} inv=${inv.numero} submit 503 Service Unavailable → retry ${Math.min(inv.intentos - 1, 3)}/3 in ${Math.round(delay / 1000 / this.speed)}s`, now, inv.jobId);
          this.errors24.timeout++;
          const shift = delay;
          inv.plan = [{ estado: "Enviando", ts: now + delay }, { estado: "Enviada", ts: now + delay + 3 * S }, ...[next, ...inv.plan].filter((s) => s.estado !== "Enviada").map((s) => ({ ...s, ts: s.ts + shift }))];
          // dedupe: keep chain Enviando→Enviada→rest
          inv.plan = inv.plan.filter((s, i, arr) => !(i > 1 && s.estado === "Enviando" && arr[i - 1].estado === "Enviada"));
          break;
        }
        inv.plan.shift();
        this.transition(inv, next.estado, next.ts);
      }
    }

    if (wall - this.lastSample > 1000) {
      this.lastSample = wall;
      const depth = this.invoices.reduce((a, i) => a + (i.estado === "En cola" || i.estado === "Enviando" || i.estado === "Reintento programado" ? 1 : 0), 0);
      this.queueSeries.push({ t: now, depth, workers: Math.min(8, Math.max(4, 5 + Math.round(depth / 4))) });
      if (this.queueSeries.length > 90) this.queueSeries.shift();
      this.transitions = this.transitions.filter((x) => x.t > now - 120 * S * this.speed);
      this.dirty = true;
    }
    if (wall - this.lastConn > 2000) {
      this.lastConn = wall;
      this.updateConnectors();
      this.dirty = true;
    }
    if (wall - this.lastNoise > 3500) {
      this.lastNoise = wall;
      this.noiseLog();
    }
    // clock always ticks once per second at least
    this.emit();
    this.dirty = false;
  }

  aribaDown() {
    return !!this.aribaOutage && Date.now() < this.aribaOutage.downUntil;
  }

  private spawn(forced?: Outcome, client?: Client, reasonCode?: string) {
    const c = client ?? this.pickClient(this.liveRng);
    const inv = this.build(this.liveRng, c, this.simNow, true, forced, reasonCode ? reason(reasonCode) : undefined);
    inv.flashUntil = Date.now() + 2500;
    this.add(inv);
    this.transitions.push({ t: this.simNow, to: "Recibida", canal: inv.canal });
    this.flash.Recibida = Date.now();
    this.logFor(inv, "Recibida", this.simNow);
    this.pushFeed(inv, "Recibida");
    return inv;
  }

  private transition(inv: Invoice, estado: Estado, ts: number) {
    inv.historial.push({ estado, ts });
    inv.estado = estado;
    this.transitions.push({ t: this.simNow, to: estado, canal: inv.canal });
    this.flash[estado] = Date.now();
    if (inv.live || ts > this.simNow - 60 * S) {
      this.logFor(inv, estado, ts);
      if (["Aceptada", "Rechazada", "Enviada", "Bloqueada por validación", "Duplicado bloqueado", "Excepción (revisión humana)", "Confirmada"].includes(estado))
        this.pushFeed(inv, estado);
    }
    if (estado === "Duplicado bloqueado") this.dupBlockedToday++;
    if (estado === "Bloqueada por validación") this.errors24.validacion++;
    if (estado === "Excepción (revisión humana)") this.errors24.inesperada++;
  }

  private pushFeed(inv: Invoice, estado: Estado) {
    this.feed.unshift({ id: ++this.logSeq, ts: this.simNow, invId: inv.id, estado });
    if (this.feed.length > 60) this.feed.pop();
  }

  log(level: LogLine["level"], comp: string, msg: string, ts: number, job?: string) {
    this.logs.push({ id: ++this.logSeq, ts, level, comp, msg, job });
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  private logFor(inv: Invoice, estado: Estado, ts: number) {
    const r = this.liveRng;
    const j = inv.jobId;
    const comp = compOf(inv.canal);
    const sec = () => between(r, 0.4, 2.6).toFixed(1);
    const fiscalShort = inv.principal.length > 30 ? inv.principal.slice(0, 26) + "…" : inv.principal;
    switch (estado) {
      case "Recibida":
        return this.log("INFO", "ingest", `inv=${inv.numero} src=erp.sap/outbound files=${inv.adjuntos.join("+").toLowerCase()} client=${inv.clientId}`, ts, j);
      case "Validada":
        return this.log("INFO", "validator", `inv=${inv.numero} ${fiscalShort} xml=${inv.adjuntos.includes("XML") ? "ok" : "n/a"} po=${inv.oc ? "ok" : "n/a"}`, ts, j);
      case "En cola":
        return this.log("INFO", "orchestrator", `job=${j} enqueue queue=delivery.${connKeyOf(inv.canal)} idem_key=${inv.idemKey}`, ts, j);
      case "Enviando":
        this.log("INFO", comp, `job=${j} inv=${inv.numero} step=${inv.canal === "Correo electrónico" ? "compose_template" : "login"} ok ${sec()}s`, ts, j);
        if (isPortal(inv.canal)) this.log("INFO", comp, `job=${j} step=search_po po=${inv.oc} ok ${sec()}s`, ts + 400, j);
        return;
      case "Enviada":
        return this.log("INFO", comp, `job=${j} inv=${inv.numero} step=${isPortal(inv.canal) ? "upload_xml+submit" : "send_graph"} ok ${sec()}s ref=${inv.comprobante.slice(0, 28)}`, ts, j);
      case "Confirmada":
        return this.log("INFO", "results", `job=${j} inv=${inv.numero} status=${isPortal(inv.canal) ? "portal:Sent→Approved" : "dsn:delivered"}`, ts, j);
      case "Aceptada":
        return this.log("INFO", "results", `inv=${inv.numero} status=accepted pay_eta=+${inv.plazo}d usd=${inv.montoUsd.toFixed(2)}`, ts, j);
      case "Reintento programado":
        return this.log("WARN", comp, `job=${j} submit timeout → retry ${Math.min(inv.intentos, 3)}/3 in 30s`, ts, j);
      case "Bloqueada por validación":
        return this.log("ERROR", "validator", `inv=${inv.numero} rule=${inv.motivo?.codigo} "${inv.motivo?.motivo}" → blocked pre-send`, ts, j);
      case "Rechazada":
        return this.log("WARN", "results", `inv=${inv.numero} status=rejected reason=${inv.motivo?.codigo} po=${inv.oc ?? "n/a"}`, ts, j);
      case "Duplicado bloqueado":
        return this.log("INFO", "orchestrator", `idem_key=${inv.idemKey} duplicate → blocked`, ts, j);
      case "Excepción (revisión humana)":
        return this.log("ERROR", "orchestrator", `job=${j} max_retries=3 exceeded → human_review queue=ap-ops`, ts, j);
      default:
        return;
    }
  }

  private noiseLog() {
    const r = this.liveRng;
    const now = this.simNow;
    const opts: [LogLine["level"], string, string][] = [
      ["DEBUG", "orchestrator", `heartbeat workers=${this.queueSeries.at(-1)?.workers ?? 6}/8 queue_depth=${this.queueSeries.at(-1)?.depth ?? 0}`],
      ["INFO", "connector.ariba", `session keepalive anid=AN${Math.floor(between(r, 1e10, 9e10))} ok`],
      ["INFO", "connector.msportal", `session refresh mfa=approved_procedure ok ${between(r, 0.8, 2).toFixed(1)}s`],
      ["INFO", "connector.email", `graph.sendMail throttle=ok remaining=${Math.floor(between(r, 9000, 10000))}`],
      ["DEBUG", "docrepo", `put s3://cirion-docs/${new Date(now).toISOString().slice(0, 10)}/ etag=${Math.floor(r() * 1e8).toString(16)}`],
    ];
    const [l, c, m] = pick(r, opts);
    this.log(l, c, m, now);
  }

  private updateConnectors() {
    const r = this.liveRng;
    for (const c of Object.values(this.connectors)) {
      const base = c.key === "email" ? 0.6 : c.key === "msportal" ? 6.4 : 8.1;
      let v = base * between(r, 0.85, 1.2);
      if (c.key === "ariba" && c.status === "caido") v = base * between(r, 3.5, 5);
      if (c.key === "ariba" && c.status === "degradado") v = base * between(r, 1.6, 2.4);
      c.p50 = Math.round(v * 10) / 10;
      c.p95 = Math.round(v * between(r, 2.1, 2.6) * 10) / 10;
      c.spark = [...c.spark.slice(1), v];
    }
  }

  // ---------- demo actions ----------
  simulateAribaOutage() {
    const wall = Date.now();
    this.aribaOutage = { downUntil: wall + 11_000, recoverUntil: wall + 20_000 };
    const c = this.connectors.ariba;
    c.status = "caido";
    c.success24 = Math.max(0.94, c.success24 - 0.012);
    c.lastError = "503 Service Unavailable · supplier.ariba.com";
    c.lastErrorTs = this.simNow;
    this.errors24.timeout += 2;
    this.errors24.auth += 1;
    this.log("ERROR", "connector.ariba", "health_check failed · 503 Service Unavailable · circuit=open", this.simNow);
    this.log("WARN", "orchestrator", "connector.ariba circuit open → jobs reprogramados con backoff exponencial", this.simNow);
    // force some Ariba traffic so the outage is visible
    const ariba = CLIENTS.filter((x) => x.canal === "SAP Ariba");
    for (let i = 0; i < 3; i++) this.spawn("ok", pick(this.liveRng, ariba));
    this.emit();
  }

  simulateDuplicate() {
    const src = [...this.invoices].reverse().find((i) => i.oc && (i.estado === "Aceptada" || i.estado === "Confirmada"))!;
    const client = CLIENTS.find((c) => c.id === src.clientId)!;
    const inv = this.spawn("duplicado", client);
    inv.numero = src.numero;
    inv.oc = src.oc;
    inv.fiscal = src.fiscal;
    inv.principal = src.principal;
    inv.monto = src.monto;
    inv.montoUsd = src.montoUsd;
    inv.idemKey = src.idemKey;
    inv.motivoNota = `Mismo número fiscal y OC que la factura ya enviada (${src.numero}). Bloqueada por la clave de idempotencia.`;
    this.emit();
    return inv;
  }

  simulateOcRejection() {
    const c = pick(this.liveRng, CLIENTS.filter((x) => x.canal === "SAP Ariba"));
    const inv = this.spawn("rechazo", c, "R01");
    inv.motivoNota = `La OC ${inv.oc} está cerrada en SAP Ariba. Con la regla R01 activa, la validación previa la detiene antes del envío.`;
    this.emit();
    return inv;
  }

  simulateEmailBounce() {
    const c = pick(this.liveRng, CLIENTS.filter((x) => x.canal === "Correo electrónico"));
    const inv = this.spawn("ok", c);
    const t = this.simNow;
    inv.plan = [
      { estado: "Validada", ts: t + 2 * S },
      { estado: "En cola", ts: t + 4 * S },
      { estado: "Enviando", ts: t + 6 * S },
      { estado: "Enviada", ts: t + 8 * S },
      { estado: "Reintento programado", ts: t + 12 * S },
      { estado: "Enviando", ts: t + 16 * S },
      { estado: "Excepción (revisión humana)", ts: t + 20 * S },
    ];
    inv.motivo = reason("R09");
    inv.motivoNota = `Rebote DSN 550 5.1.1: el buzón de AP ${c.contacto_ap} no existe. Se requiere actualizar el contacto del cliente.`;
    this.connectors.email.lastError = `DSN 550 5.1.1 buzón inexistente (${c.contacto_ap})`;
    this.connectors.email.lastErrorTs = t;
    this.emit();
    return inv;
  }

  reprocess(id: string) {
    const inv = this.byId.get(id);
    if (!inv) return;
    const t = this.simNow;
    inv.intentos++;
    inv.resuelta = true;
    this.transition(inv, "Reintento programado", t);
    this.log("INFO", "orchestrator", `job=${inv.jobId} manual_reprocess authorized_by=ap-ops intento=${inv.intentos}`, t, inv.jobId);
    inv.plan = [
      { estado: "Validada", ts: t + 2.5 * S * this.speed },
      { estado: "En cola", ts: t + 4.5 * S * this.speed },
      { estado: "Enviando", ts: t + 7 * S * this.speed },
      { estado: "Enviada", ts: t + 10 * S * this.speed },
      { estado: "Confirmada", ts: t + 16 * S * this.speed },
      { estado: "Aceptada", ts: t + 24 * S * this.speed },
    ];
    this.emit();
  }

  // ---------- derived ----------
  derived(): Derived {
    const key = `${this.version}|${this.ui.country}|${this.ui.channel}`;
    if (this.derivedCache?.key === key) return this.derivedCache.value;
    const value = computeDerived(this);
    this.derivedCache = { key, value };
    return value;
  }
}

// ======================= Derived metrics =======================

export interface AttentionRow {
  inv: Invoice;
  tipo: "Rechazada" | "Excepción" | "Sin respuesta" | "SLA en riesgo" | "Bloqueada";
  prioridad: number;
  motivo: string;
  dias: number;
  accion: string;
}

export interface Derived {
  list: Invoice[];
  todayCount: number;
  slaPct: number;
  acceptPct: number;
  atRisk: number;
  transitUsd: number;
  hoursSaved: number;
  monthCount: number;
  funnel: { label: string; value: number }[];
  cashWeeks: { label: string; usd: number; count: number }[];
  byCountry: { pais: Pais; count: number; acceptPct: number; usd: number }[];
  byChannel: { canal: Canal; count: number }[];
  attention: AttentionRow[];
  reasons: { codigo: string; motivo: string; count: number; prevented: number }[];
  preventedShare: number;
  trend: { day: number; count: number; rate: number }[];
  stateCounts: Record<Estado, number>;
  validators: { pais: Pais; pct: number; count: number }[];
  throughput: { A: number; B: number; C: number; D: number; E: number };
  inProcess: { A: number; B: number; C: number; D: number; E: number };
}

const SENT: Estado[] = ["Enviada", "Confirmada", "Aceptada", "Pagada", "Rechazada"];

function reached(inv: Invoice, e: Estado) {
  return inv.historial.some((h) => h.estado === e);
}
function tsOf(inv: Invoice, e: Estado) {
  return inv.historial.find((h) => h.estado === e)?.ts;
}
export function lastTs(inv: Invoice, e: Estado) {
  for (let i = inv.historial.length - 1; i >= 0; i--) if (inv.historial[i].estado === e) return inv.historial[i].ts;
  return undefined;
}
export function cobroEstimado(inv: Invoice): number | null {
  const acc = lastTs(inv, "Aceptada");
  if (acc) return acc + inv.plazo * D;
  if (["Rechazada", "Duplicado bloqueado"].includes(inv.estado)) return null;
  return inv.createdAt + (inv.estado === "Excepción (revisión humana)" || inv.estado === "Bloqueada por validación" ? 3 : 1.5) * D + inv.plazo * D;
}

function computeDerived(s: SimStore): Derived {
  const { country, channel } = s.ui;
  const now = s.simNow;
  const list = s.invoices.filter((i) => (country === "ALL" || i.pais === country) && (channel === "ALL" || i.canal === channel));
  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);
  const t0 = today0.getTime();
  const month0 = new Date(today0.getFullYear(), today0.getMonth(), 1).getTime();

  const today = list.filter((i) => i.createdAt >= t0);
  const month = list.filter((i) => i.createdAt >= month0);

  let slaOk = 0,
    slaN = 0,
    accepted = 0,
    decided = 0,
    atRisk = 0,
    transitUsd = 0;
  const stateCounts = Object.fromEntries([...STATES_MAIN, ...STATES_BRANCH].map((e) => [e, 0])) as Record<Estado, number>;
  const attention: AttentionRow[] = [];

  for (const inv of list) {
    stateCounts[inv.estado]++;
    const sent = tsOf(inv, "Enviada");
    const age = now - inv.createdAt;
    if (inv.createdAt >= month0) {
      if (sent) {
        slaN++;
        if (sent - inv.createdAt <= inv.sla * H) slaOk++;
      }
      if (inv.estado === "Aceptada" || inv.estado === "Pagada") {
        accepted++;
        decided++;
      } else if (inv.estado === "Rechazada" || inv.estado === "Excepción (revisión humana)" || inv.estado === "Bloqueada por validación") decided++;
    }
    if (["En cola", "Enviando", "Enviada", "Confirmada", "Reintento programado"].includes(inv.estado)) transitUsd += inv.montoUsd;

    const preSend = PRE_SEND.includes(inv.estado) || inv.estado === "Bloqueada por validación" || inv.estado === "Excepción (revisión humana)";
    const slaRisk = preSend && age > inv.sla * H * 0.5;
    if (slaRisk) atRisk++;

    const dias = age / D;
    if (inv.estado === "Rechazada" && dias < 20) {
      attention.push({ inv, tipo: "Rechazada", prioridad: 1, motivo: `El cliente rechazó la factura: ${inv.motivo?.motivo ?? "motivo no informado"}`, dias, accion: inv.motivo?.accion ?? "Contactar al cliente" });
    } else if (inv.estado === "Excepción (revisión humana)") {
      attention.push({ inv, tipo: "Excepción", prioridad: 2, motivo: inv.motivoNota ? "Correo rebotado: contacto de cuentas por pagar inválido" : "No se pudo entregar tras 3 intentos automáticos", dias, accion: "Asignar analista de facturación" });
    } else if (inv.estado === "Bloqueada por validación") {
      attention.push({ inv, tipo: "Bloqueada", prioridad: 3, motivo: `Detenida antes del envío: ${inv.motivo?.motivo ?? ""}`, dias, accion: inv.motivo?.accion ?? "Corregir y reprocesar" });
    } else if (slaRisk) {
      attention.push({ inv, tipo: "SLA en riesgo", prioridad: 3, motivo: `Plazo de presentación de ${inv.sla} h por vencer`, dias, accion: "Priorizar envío" });
    } else if ((inv.estado === "Enviada" || inv.estado === "Confirmada") && isPortal(inv.canal)) {
      const st = lastTs(inv, "Enviada") ?? inv.createdAt;
      if (now - st > 48 * H)
        attention.push({ inv, tipo: "Sin respuesta", prioridad: 4, motivo: `Sin respuesta del portal hace ${Math.floor((now - st) / D)} días`, dias, accion: "Escalar con AP del cliente" });
    }
  }
  attention.sort((a, b) => a.prioridad - b.prioridad || b.inv.montoUsd - a.inv.montoUsd);

  const fStages: [string, Estado][] = [
    ["Recibidas", "Recibida"],
    ["Validadas", "Validada"],
    ["Enviadas", "Enviada"],
    ["Confirmadas", "Confirmada"],
    ["Aceptadas", "Aceptada"],
  ];
  const funnel = fStages.map(([label, e]) => ({ label, value: today.filter((i) => reached(i, e)).length }));

  // Cash projection
  const weekStart = new Date(today0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const w0 = weekStart.getTime();
  const cashWeeks = Array.from({ length: 8 }, (_, k) => {
    const d = new Date(w0 + k * 7 * D);
    return { label: `Sem ${d.getDate()}/${d.getMonth() + 1}`, usd: 0, count: 0 };
  });
  for (const inv of list) {
    if (inv.estado !== "Aceptada") continue;
    const c = cobroEstimado(inv);
    if (!c) continue;
    const k = Math.floor((Math.max(c, now) - w0) / (7 * D));
    if (k >= 0 && k < 8) {
      cashWeeks[k].usd += inv.montoUsd;
      cashWeeks[k].count++;
    }
  }

  const byCountryMap = new Map<Pais, { count: number; acc: number; dec: number; usd: number }>();
  for (const inv of month) {
    const e = byCountryMap.get(inv.pais) ?? { count: 0, acc: 0, dec: 0, usd: 0 };
    e.count++;
    e.usd += inv.montoUsd;
    if (inv.estado === "Aceptada" || inv.estado === "Pagada") {
      e.acc++;
      e.dec++;
    } else if (["Rechazada", "Excepción (revisión humana)", "Bloqueada por validación"].includes(inv.estado)) e.dec++;
    byCountryMap.set(inv.pais, e);
  }
  const byCountry = [...byCountryMap.entries()]
    .map(([pais, e]) => ({ pais, count: e.count, acceptPct: e.dec ? e.acc / e.dec : 1, usd: e.usd }))
    .sort((a, b) => b.count - a.count);
  const byChannel = CANALES.map((canal) => ({ canal, count: month.filter((i) => i.canal === canal).length }));

  const rmap = new Map<string, { codigo: string; motivo: string; count: number; prevented: number }>();
  for (const inv of month) {
    if (!inv.motivo) continue;
    const blocked = reached(inv, "Bloqueada por validación") || reached(inv, "Duplicado bloqueado");
    const rejected = reached(inv, "Rechazada");
    if (!blocked && !rejected) continue;
    const e = rmap.get(inv.motivo.codigo) ?? { codigo: inv.motivo.codigo, motivo: inv.motivo.motivo, count: 0, prevented: 0 };
    e.count++;
    if (blocked) e.prevented++;
    rmap.set(inv.motivo.codigo, e);
  }
  const reasons = [...rmap.values()].sort((a, b) => b.count - a.count);
  const totErr = reasons.reduce((a, b) => a + b.count, 0);
  const preventedShare = totErr ? reasons.reduce((a, b) => a + b.prevented, 0) / totErr : 0.7;

  const trend = Array.from({ length: 30 }, (_, k) => {
    const ds = t0 - (29 - k) * D;
    const items = list.filter((i) => i.createdAt >= ds && i.createdAt < ds + D);
    const acc = items.filter((i) => reached(i, "Aceptada")).length;
    const dec = items.filter((i) => reached(i, "Aceptada") || i.estado === "Rechazada" || i.estado === "Excepción (revisión humana)" || i.estado === "Bloqueada por validación").length;
    return { day: ds, count: items.length, rate: dec ? acc / dec : 0 };
  });

  const vmap = new Map<Pais, { n: number; bad: number }>();
  for (const inv of month) {
    const e = vmap.get(inv.pais) ?? { n: 0, bad: 0 };
    e.n++;
    if (reached(inv, "Bloqueada por validación") && (inv.motivo?.codigo === "R03" || inv.motivo?.codigo === "R04")) e.bad++;
    vmap.set(inv.pais, e);
  }
  const validators = (["AR", "BR", "CL", "CO", "EC", "MX", "PA", "PE", "US"] as Pais[]).map((p) => {
    const e = vmap.get(p) ?? { n: 0, bad: 0 };
    return { pais: p, pct: e.n ? 1 - e.bad / e.n : 1, count: e.n };
  });

  const win = 60 * 1000 * s.speed;
  const tr = s.transitions.filter((x) => x.t > now - win);
  const cnt = (es: Estado[]) => tr.filter((x) => es.includes(x.to)).length;
  const throughput = {
    A: cnt(["Recibida", "Validada", "Bloqueada por validación"]),
    B: cnt(["En cola", "Duplicado bloqueado", "Reintento programado"]),
    C: cnt(["Enviando", "Enviada"]),
    D: cnt(["Confirmada", "Aceptada", "Rechazada", "Excepción (revisión humana)"]),
    E: tr.length,
  };
  const inProcess = {
    A: stateCounts["Recibida"] + stateCounts["Validada"],
    B: stateCounts["En cola"],
    C: stateCounts["Enviando"] + stateCounts["Reintento programado"],
    D: list.filter((i) => i.estado === "Enviada" || (i.estado === "Confirmada" && now - i.createdAt < 2 * D)).length,
    E: s.feed.length,
  };

  const monthDocs = month.filter((i) => reached(i, "Enviada")).length;
  return {
    list,
    todayCount: today.length,
    slaPct: slaN ? slaOk / slaN : 1,
    acceptPct: decided ? accepted / decided : 1,
    atRisk,
    transitUsd,
    hoursSaved: (monthDocs * 14) / 60,
    monthCount: month.length,
    funnel,
    cashWeeks,
    byCountry,
    byChannel,
    attention,
    reasons,
    preventedShare,
    trend,
    stateCounts,
    validators,
    throughput,
    inProcess,
  };
}

// ======================= React bindings =======================

let singleton: SimStore | null = null;
export function getSim() {
  if (!singleton) singleton = new SimStore();
  return singleton;
}

export function useSim() {
  const s = getSim();
  useSyncExternalStore(s.subscribe, s.getVersion, s.getVersion);
  return s;
}

export function searchInvoices(s: SimStore, q: string, limit = 8) {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const out: Invoice[] = [];
  for (let i = s.invoices.length - 1; i >= 0 && out.length < limit; i--) {
    const inv = s.invoices[i];
    if (
      inv.numero.toLowerCase().includes(term) ||
      inv.cliente.toLowerCase().includes(term) ||
      (inv.oc ?? "").toLowerCase().includes(term) ||
      inv.comprobante.toLowerCase().includes(term) ||
      Object.values(inv.fiscal).some((v) => v.toLowerCase().includes(term))
    )
      out.push(inv);
  }
  return out;
}

export const flagOf = (p: string) => FLAG[p] ?? "🏳️";
export const usdRate = (m: string) => RATES[m] ?? 1;
export { fmtClockMs };
