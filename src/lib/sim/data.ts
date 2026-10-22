import clientsJson from "@/data/clients.json";
import samplesJson from "@/data/sample_invoices.json";
import formatsJson from "@/data/formats_reference.json";
import flowsJson from "@/data/portal_flows.json";
import reasonsJson from "@/data/rejection_reasons.json";
import linesJson from "@/data/service_lines.json";
import issuersJson from "@/data/issuers_ficticios.json";

export type Pais = "AR" | "BR" | "CL" | "CO" | "EC" | "MX" | "PA" | "PE" | "US";
export type Canal =
  | "Correo electrónico"
  | "SAP Ariba"
  | "Microsoft Supplier Portal"
  | "Combinado (correo + portal)";

export type Estado =
  | "Recibida"
  | "Validada"
  | "En cola"
  | "Enviando"
  | "Enviada"
  | "Confirmada"
  | "Aceptada"
  | "Pagada"
  | "Bloqueada por validación"
  | "Rechazada"
  | "Reintento programado"
  | "Excepción (revisión humana)"
  | "Duplicado bloqueado";

export interface Client {
  id: string;
  nombre: string;
  pais: Pais;
  pais_nombre: string;
  bandera: string;
  tipo_id_fiscal: string;
  id_fiscal: string;
  segmento: string;
  moneda: string;
  canal: Canal;
  requisitos: { pdf: boolean; xml: boolean; orden_compra: boolean; planilla_detalle: boolean; hes_acta_conformidad: boolean };
  plazo_pago_dias: number;
  sla_presentacion_horas: number;
  contacto_ap: string;
  volumen_mensual: number;
}

export interface SampleInvoice {
  id: string;
  cliente_id: string;
  cliente: string;
  pais: Pais;
  canal: Canal;
  tipo_documento: string;
  numero: string;
  identificadores_fiscales: Record<string, string | number>;
  emisor: string;
  fecha_emision: string;
  moneda: string;
  monto: number;
  monto_usd: number;
  orden_compra: string | null;
  linea_servicio: string;
  periodo_servicio: string;
  adjuntos: string[];
  estado: Estado;
  historial: { estado: Estado; ts: string }[];
  comprobante: string;
  motivo_rechazo: string | null;
  intentos: number;
}

export interface Reason {
  codigo: string;
  motivo: string;
  etapa: string;
  prevenible_por_validacion: boolean;
  accion: string;
}

export const CLIENTS = clientsJson as unknown as Client[];
export const SAMPLES = samplesJson as unknown as SampleInvoice[];
export const FORMATS = formatsJson as unknown as {
  paises: Record<Pais, { autoridad: string; documento: string; numero: string; autorizacion: string; id_fiscal: string; moneda: string; formato_archivo: string }>;
};
export const FLOWS = flowsJson as unknown as Record<string, string[]>;
export const REASONS = reasonsJson as unknown as Reason[];
export const SERVICE_LINES = linesJson as unknown as { codigo: string; descripcion: string; rango_usd: [number, number] }[];
export const ISSUERS = issuersJson as unknown as Record<Pais, { entity: string; tax_id_type: string; tax_id: string }>;

export const COUNTRIES: { code: Pais | "ALL"; name: string; flag: string }[] = [
  { code: "ALL", name: "Todos", flag: "🌎" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "BR", name: "Brasil", flag: "🇧🇷" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "EC", name: "Ecuador", flag: "🇪🇨" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "PA", name: "Panamá", flag: "🇵🇦" },
  { code: "PE", name: "Perú", flag: "🇵🇪" },
  { code: "US", name: "Estados Unidos", flag: "🇺🇸" },
];
export const FLAG: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.flag]));
export const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));

export const CANALES: Canal[] = ["Correo electrónico", "SAP Ariba", "Microsoft Supplier Portal", "Combinado (correo + portal)"];
export const CANAL_SHORT: Record<Canal, string> = {
  "Correo electrónico": "Correo",
  "SAP Ariba": "SAP Ariba",
  "Microsoft Supplier Portal": "Microsoft Portal",
  "Combinado (correo + portal)": "Combinado",
};

export const RATES: Record<string, number> = { ARS: 1180, BRL: 5.45, CLP: 935, COP: 4080, MXN: 18.6, PEN: 3.72, USD: 1 };

export const TIPO_DOC: Record<Pais, string> = {
  AR: "Factura A (cód. 01)",
  BR: "NFCom (modelo 62)",
  CL: "Factura electrónica (DTE tipo 33)",
  CO: "Factura electrónica de venta",
  EC: "Factura electrónica (01)",
  MX: "CFDI 4.0 — Ingreso",
  PA: "Factura electrónica (FE)",
  PE: "Factura electrónica (01)",
  US: "Commercial Invoice",
};

export const FISCAL_LABEL: Record<Pais, string> = {
  AR: "CAE (14 dígitos)",
  BR: "Chave de acesso (44 dígitos)",
  CL: "Folio DTE 33 + Track ID SII",
  CO: "CUFE SHA-384 (96 hex)",
  EC: "Clave de acceso SRI (49 dígitos)",
  MX: "UUID CFDI 4.0 (36)",
  PA: "CUFE DGI + protocolo",
  PE: "Serie F### + CDR SUNAT",
  US: "Formato interno INV-US",
};
