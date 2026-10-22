import { ISSUERS, RATES, SAMPLES, SERVICE_LINES, type Canal, type Client, type Pais } from "./data";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(r: Rng, arr: T[]) => arr[Math.floor(r() * arr.length)];
export const between = (r: Rng, a: number, b: number) => a + r() * (b - a);
export const digits = (r: Rng, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join("");
export const hex = (r: Rng, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
const pad = (n: number, w: number) => String(n).padStart(w, "0");

function mod11(base: string) {
  let sum = 0;
  let w = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const dv = 11 - (sum % 11);
  return dv >= 10 ? 0 : dv;
}

/** Last correlative per country, continued from the dataset. */
export function initialCounters(): Record<Pais, number> {
  const c: Record<string, number> = { AR: 80000, BR: 15000, CL: 67000, CO: 27000, EC: 43000, MX: 44000, PA: 80000, PE: 11700, US: 29300 };
  for (const s of SAMPLES) {
    const m = s.pais === "BR" ? s.numero.match(/nº\s*(\d+)/) : s.pais === "AR" ? s.numero.match(/-(\d+)$/) : s.numero.match(/(\d+)\s*$/);
    if (m) c[s.pais] = Math.max(c[s.pais], Number(m[1]));
  }
  return c as Record<Pais, number>;
}

export interface FiscalDoc {
  numero: string;
  fiscal: Record<string, string>;
  principal: string; // fiscal id highlighted in checklist
}

export function makeFiscal(r: Rng, pais: Pais, n: number, ts: number): FiscalDoc {
  const d = new Date(ts);
  const yy = String(d.getFullYear()).slice(2);
  const mm = pad(d.getMonth() + 1, 2);
  switch (pais) {
    case "AR": {
      const cae = digits(r, 14).replace(/^0/, "7");
      const vto = new Date(ts + 10 * 864e5);
      return { numero: `A 00003-${pad(n, 8)}`, fiscal: { CAE: cae, vto_CAE: vto.toISOString().slice(0, 10) }, principal: `CAE ${cae}` };
    }
    case "BR": {
      const cnpj = ISSUERS.BR.tax_id.replace(/\D/g, "");
      const base = `35${yy}${mm}${cnpj}62001${pad(n, 9)}1${digits(r, 8)}`;
      const chave = base + mod11(base);
      return { numero: `NFCom nº ${pad(n, 9)} · Série 001`, fiscal: { chave_acesso: chave, protocolo_autorizacao: `3${digits(r, 14)}` }, principal: `Chave ${chave}` };
    }
    case "CL":
      return { numero: `Folio ${n}`, fiscal: { tipo_dte: "33", track_id_sii: digits(r, 10).replace(/^0/, "9") }, principal: `DTE 33 · Folio ${n}` };
    case "CO": {
      const cufe = hex(r, 96);
      return { numero: `FEV${n}`, fiscal: { CUFE: cufe }, principal: `CUFE ${cufe}` };
    }
    case "MX": {
      const u = hex(r, 32).toUpperCase();
      const uuid = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
      return { numero: `A-${n}`, fiscal: { UUID: uuid, uso_cfdi: "G03", metodo_pago: r() < 0.8 ? "PUE" : "PPD" }, principal: `UUID ${uuid}` };
    }
    case "PE":
      return { numero: `F001-${pad(n, 8)}`, fiscal: { CDR_SUNAT: "Aceptada", hash: hex(r, 28) }, principal: `CDR SUNAT · F001-${pad(n, 8)}` };
    case "EC": {
      const ruc = ISSUERS.EC.tax_id;
      const base = `${pad(d.getDate(), 2)}${mm}${d.getFullYear()}01${ruc}2001001${pad(n, 9)}${digits(r, 8)}1`;
      const clave = base + mod11(base);
      return { numero: `001-001-${pad(n, 9)}`, fiscal: { clave_acceso: clave, autorizacion_SRI: "AUTORIZADO" }, principal: `Clave ${clave}` };
    }
    case "PA": {
      const cufe = `FE01${digits(r, 62)}`;
      return { numero: `FE-${pad(n, 10)}`, fiscal: { CUFE: cufe, protocolo_DGI: digits(r, 16) }, principal: `CUFE ${cufe}` };
    }
    case "US":
      return { numero: `INV-US-${n}`, fiscal: {}, principal: `INV-US-${n}` };
  }
}

export function makeOC(r: Rng, client: Client): string | null {
  if (client.canal === "SAP Ariba" || client.canal === "Combinado (correo + portal)") return `45${digits(r, 8)}`;
  if (client.canal === "Microsoft Supplier Portal") return `11${digits(r, 8)}`;
  return client.requisitos.orden_compra ? `OC-${pad(Math.floor(between(r, 10000, 99999)), 5)}` : null;
}

export function makeComprobante(r: Rng, canal: Canal): string {
  if (canal === "SAP Ariba" || canal === "Combinado (correo + portal)") return `Ariba doc ID INV${digits(r, 8)}`;
  if (canal === "Microsoft Supplier Portal") return `MSP-${hex(r, 12).toUpperCase()}`;
  return `Message-ID <${hex(r, 20)}@ciriontechnologies.com>`;
}

const BW = ["100 Mbps", "500 Mbps", "1 Gbps", "10 Gbps", "100 Gbps"];
const RUTAS = ["São Paulo – Buenos Aires", "Bogotá – Medellín", "Santiago – Lima", "Ciudad de México – Querétaro", "Miami – São Paulo", "Panamá – Bogotá"];

export function makeAmount(r: Rng, client: Client) {
  const line = pick(r, SERVICE_LINES);
  const [lo, hi] = line.rango_usd;
  const seg = client.segmento === "Hyperscaler" ? 2.2 : 1;
  const usd = Math.min(hi * 1.4, Math.exp(between(r, Math.log(lo), Math.log(hi))) * seg);
  const rate = RATES[client.moneda] ?? 1;
  const desc = line.descripcion
    .replace("{bw}", pick(r, BW))
    .replace("{n}", String(Math.floor(between(r, 3, 48))))
    .replace("{ruta}", pick(r, RUTAS))
    .replace("{r}", String(Math.floor(between(r, 2, 40))));
  const monto = Math.round(usd * rate * 100) / 100;
  return { linea: desc, monto, montoUsd: Math.round((monto / rate) * 100) / 100 };
}

export const jobId = (r: Rng) => hex(r, 6);
