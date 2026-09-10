import { ParsedVoucherData, CsvPermitRecord } from "./csvParser";
import { cleanVoucherCodeValue } from "./csvParser";

/**
 * Normalizes any date string (ISO YYYY-MM-DD or UK DD/MM/YYYY) into ISO YYYY-MM-DD.
 */
export function normalizeDateToISO(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Check UK DD/MM/YYYY or DD-MM-YYYY
  const ukMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (ukMatch) {
    const day = ukMatch[1].padStart(2, "0");
    const month = ukMatch[2].padStart(2, "0");
    const year = ukMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback to Date parsing
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

/**
 * Adds days to an ISO date string (YYYY-MM-DD)
 */
export function addDaysISO(isoDate: string, days: number): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Extracts normalized validFrom from a voucher object
 */
export function getVoucherValidFromISO(v: ParsedVoucherData | undefined | null): string {
  if (!v) return "";
  const raw = v.validFrom || (v as any).valid_from || (v as any).ValidFrom || (v as any).startDate || (v as any).start_date || (v as any).date;
  if (raw) {
    const iso = normalizeDateToISO(String(raw));
    if (iso) return iso;
  }
  return "";
}

/**
 * Extracts normalized validTo from a voucher object
 */
export function getVoucherValidToISO(v: ParsedVoucherData | undefined | null): string {
  if (!v) return "";
  const raw = v.validTo || (v as any).valid_to || (v as any).ValidTo || (v as any).endDate || (v as any).end_date || (v as any).expires || (v as any).expiryDate;
  if (raw) {
    const iso = normalizeDateToISO(String(raw));
    if (iso) return iso;
  }
  const fromIso = getVoucherValidFromISO(v);
  if (fromIso) {
    return addDaysISO(fromIso, 6);
  }
  return "";
}

/**
 * Check if a voucher belongs to a specific permit date range
 */
export function isVoucherForPermitDateRange(
  v: ParsedVoucherData | undefined | null,
  permitFromISO: string,
  permitToISO?: string
): boolean {
  if (!v || !v.code || !permitFromISO) return false;
  const cleanCode = cleanVoucherCodeValue(v.code).toUpperCase();
  if (!cleanCode || cleanCode === "-" || cleanCode === "CANCELLED" || cleanCode === "PENDING" || cleanCode === "BLOCKED") {
    return false;
  }

  const normPermitFrom = normalizeDateToISO(permitFromISO);
  if (!normPermitFrom) return false;

  const vFrom = getVoucherValidFromISO(v);
  if (vFrom && vFrom !== normPermitFrom) {
    return false;
  }

  if (permitToISO) {
    const normPermitTo = normalizeDateToISO(permitToISO);
    const vTo = getVoucherValidToISO(v);
    if (vTo && normPermitTo && vTo !== normPermitTo) {
      return false;
    }
  }

  return true;
}

/**
 * Validates whether a voucher code exists in the vouchers database (CSV).
 * Returns true if valid, false if invalid (or if not in database).
 * If no vouchers database is uploaded yet, returns true (permissive when empty).
 */
export function isVoucherInDatabase(
  code: string | undefined | null,
  vouchersDb: ParsedVoucherData[] | undefined | null,
  permitFromISO?: string,
  permitToISO?: string
): { isValid: boolean; reason?: "not_in_db" | "date_mismatch" | "empty" } {
  if (!code) return { isValid: false, reason: "empty" };
  const clean = cleanVoucherCodeValue(code).toUpperCase();
  if (!clean || clean === "-" || clean === "CANCELLED" || clean === "BLOCKED" || clean === "PENDING" || clean === "N/A") {
    return { isValid: false, reason: "empty" };
  }

  // If no vouchers database exists, cannot enforce
  if (!vouchersDb || vouchersDb.length === 0) {
    return { isValid: true };
  }

  // 1. Check if the code exists anywhere in vouchers database
  const matchingCodes = vouchersDb.filter(v => {
    if (!v || !v.code) return false;
    const vCode = cleanVoucherCodeValue(v.code).toUpperCase();
    return vCode === clean;
  });

  if (matchingCodes.length === 0) {
    return { isValid: false, reason: "not_in_db" };
  }

  // 2. If date range is specified, verify that at least one matching voucher is valid for this date
  if (permitFromISO) {
    const normFrom = normalizeDateToISO(permitFromISO);
    const normTo = permitToISO ? normalizeDateToISO(permitToISO) : addDaysISO(normFrom, 6);

    const matchesDate = matchingCodes.some(v => {
      const vFrom = getVoucherValidFromISO(v);
      const vTo = getVoucherValidToISO(v);
      if (!vFrom) return true; // generic voucher without explicit date
      if (vFrom !== normFrom) return false;
      if (normTo && vTo && vTo !== normTo) return false;
      return true;
    });

    if (!matchesDate) {
      return { isValid: false, reason: "date_mismatch" };
    }
  }

  return { isValid: true };
}

/**
 * Scan all permit records for codes not in the CSV database
 */
export interface InvalidVoucherRecord {
  record: CsvPermitRecord;
  code: string;
  formId?: string | number;
  vrm?: string;
  driverName?: string;
  validFrom?: string;
  validTo?: string;
  reason: "not_in_db" | "date_mismatch" | "empty";
}

export function scanForInvalidVouchers(
  database: CsvPermitRecord[],
  vouchersDb: ParsedVoucherData[]
): InvalidVoucherRecord[] {
  if (!database || !vouchersDb || vouchersDb.length === 0) return [];
  const invalid: InvalidVoucherRecord[] = [];

  database.forEach(record => {
    // Skip cancelled or blocked records
    if (
      record.isCancelled === true ||
      (typeof record.status === "string" && (record.status.toUpperCase() === "CANCELLED" || record.status.toUpperCase() === "BLOCKED"))
    ) {
      return;
    }

    const code = record.voucherCode || record.prePaidCode;
    if (!code) return;
    const clean = cleanVoucherCodeValue(code).toUpperCase();
    if (!clean || clean === "-" || clean === "CANCELLED" || clean === "BLOCKED" || clean === "PENDING" || clean === "N/A") {
      return;
    }

    const dateFrom = record.validFrom || record.dateRequired;
    const dateTo = record.validTo || record.dateExpiry;
    const result = isVoucherInDatabase(clean, vouchersDb, dateFrom, dateTo);

    if (!result.isValid && result.reason) {
      invalid.push({
        record,
        code: clean,
        formId: record.formId || record.id,
        vrm: record.vrm,
        driverName: record.driverName || record.name,
        validFrom: dateFrom,
        validTo: dateTo,
        reason: result.reason
      });
    }
  });

  return invalid;
}

/**
 * Finds the first unused valid voucher code from the CSV database for a given date range
 */
export function getFirstValidUnusedCodeForDate(
  vouchersDb: ParsedVoucherData[],
  database: CsvPermitRecord[],
  permitFromISO: string,
  permitToISO?: string,
  customVouchers?: Record<string, string>
): string | null {
  if (!vouchersDb || vouchersDb.length === 0 || !permitFromISO) return null;

  const normFrom = normalizeDateToISO(permitFromISO);
  const normTo = permitToISO ? normalizeDateToISO(permitToISO) : addDaysISO(normFrom, 6);

  // Collect all currently assigned codes in database
  const assignedCodes = new Set<string>();
  database.forEach(r => {
    if (r.isCancelled === true || (typeof r.status === "string" && r.status.toUpperCase() === "CANCELLED")) return;
    const raw = r.voucherCode || r.prePaidCode || r.qrCode || (r as any).voucherCodesText;
    if (raw) {
      const clean = cleanVoucherCodeValue(raw).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "BLOCKED" && clean !== "PENDING") {
        assignedCodes.add(clean);
      }
    }
  });

  if (customVouchers) {
    Object.values(customVouchers).forEach(raw => {
      if (raw) {
        const clean = cleanVoucherCodeValue(raw).toUpperCase();
        if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "BLOCKED") {
          assignedCodes.add(clean);
        }
      }
    });
  }

  // Filter vouchers that match this date and are not yet assigned
  const candidates = vouchersDb.filter(v => {
    if (!v || !v.code) return false;
    const cleanCode = cleanVoucherCodeValue(v.code).toUpperCase();
    if (!cleanCode || cleanCode === "-" || cleanCode === "CANCELLED" || cleanCode === "BLOCKED") return false;
    if (assignedCodes.has(cleanCode)) return false;

    // Check date match
    return isVoucherForPermitDateRange(v, normFrom, normTo);
  });

  if (candidates.length > 0) {
    return cleanVoucherCodeValue(candidates[0].code).toUpperCase();
  }

  // ⭐ No fallback. If no voucher exists for this exact date range,
  // return null so the caller shows 0 — never assign a voucher from
  // a different week's batch.
  return null;
}
