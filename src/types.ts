export type StorageMode = "cloud" | "offline";

export interface PermitData {
  id?: string;
  formId?: string | number;
  title: string;
  site: string;
  name: string;
  vrm: string;
  validFrom: string;
  validTo: string;
  ward: string;
  qrOverride: string;
  voucherCodesText: string;
  phone: string;
  email: string;
  todayDate?: string;
  dateRequired?: string;
  department?: string;
  startTime?: string;
  createdAt?: string;
  status?: string;
  emailType?: "SEND_CONCESSION" | "RESEND_CONCESSION" | string;
  isResend?: boolean;
  emailTemplate?: "new" | "replacement";
}

export const HOSPITAL_SITES = [
  "Royal London Hospital",
  "Newham Hospital",
  "Whipps Cross Hospital",
  "Mile End Hospital",
  "St Bartholomew's Hospital"
] as const;
