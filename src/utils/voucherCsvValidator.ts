import * as XLSX from "xlsx";
import type { ParsedVoucherData } from "./csvParser";
import {
  findVoucherCodeColumn,
  findValidFromColumn,
  findValidToColumn,
  cleanVoucherDate,
  parseDateToISO,
  parseVoucherFile
} from "./csvParser";
import { cleanVoucherCodeValue } from "./voucherValidation";

export interface VoucherValidationError {
  rowNumber: number;
  code: string;
  validFrom?: string;
  validTo?: string;
  durationInDays?: number;
  reason: string;
}

export interface VoucherImportValidationResult {
  isValid: boolean;
  errors: VoucherValidationError[];
  vouchers: ParsedVoucherData[];
}

/**
 * Pre-import validation check for uploaded Voucher CSV files.
 * 
 * 1. Mandatory Date Validation Rules:
 *    - Check that 'VALIDFROM' and 'VALIDTO' exist and are not empty for every row.
 *    - Calculate duration: durationInDays = Math.round((new Date(VALIDTO) - new Date(VALIDFROM)) / (1000 * 60 * 60 * 24)).
 *    - Verify that the duration equals exactly 6 days (or 7 days inclusive, e.g., 05/06/2026 to 11/06/2026 = 6 days).
 * 
 * 2. User Alert & Prevention:
 *    - If any row has missing dates or an invalid date range (e.g., 8 days like 05/Jun to 13/Jun), abort the import.
 *    - Collect and list the row numbers and exact voucher codes failing the check.
 */
export function validateVoucherCSV(
  arrayBuffer: ArrayBuffer,
  fileName?: string
): VoucherImportValidationResult {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: "array", raw: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return {
        isValid: false,
        errors: [{ rowNumber: 1, code: "-", reason: "Empty or invalid spreadsheet sheet" }],
        vouchers: []
      };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: true });
    if (!rawRows || rawRows.length === 0) {
      return {
        isValid: false,
        errors: [{ rowNumber: 1, code: "-", reason: "Empty file (no rows found)" }],
        vouchers: []
      };
    }

    const firstRow = rawRows[0] as unknown[];
    if (!firstRow || firstRow.length === 0) {
      return {
        isValid: false,
        errors: [{ rowNumber: 1, code: "-", reason: "Empty header row" }],
        vouchers: []
      };
    }

    const headers = firstRow.map(h => String(h || "").toLowerCase().trim());
    const voucherIdx = findVoucherCodeColumn(headers);
    const validFromIdx = findValidFromColumn(headers);
    const validToIdx = findValidToColumn(headers);

    let isFirstRowData = false;
    for (const cell of firstRow) {
      const cellStr = String(cell || "").trim();
      if (cellStr.match(/^CON\d+JXM$/i) || (cellStr.length >= 8 && cleanVoucherDate(cellStr))) {
        isFirstRowData = true;
        break;
      }
    }

    const hasHeaders = !isFirstRowData && (
      firstRow.some(cell => {
        const str = String(cell || "").toLowerCase().trim();
        return str.includes("code") || str.includes("valid") || str.includes("date") || str.includes("voucher") || str.includes("from") || str.includes("to") || str.includes("plate") || str.includes("vrm") || str.includes("status") || str.includes("used");
      })
    );
    const startIndex = hasHeaders ? 1 : 0;

    const errors: VoucherValidationError[] = [];
    let nonBlankRowCount = 0;

    for (let i = startIndex; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];
      if (!row || !Array.isArray(row)) continue;

      // Check if row is completely blank
      const isBlankRow = row.every(cell => cell === undefined || cell === null || String(cell).trim() === "");
      if (isBlankRow) continue;

      nonBlankRowCount++;
      const rowNumber = i + 1; // 1-based row number in CSV

      // Extract voucher code
      let rawCode = "";
      if (voucherIdx !== -1 && row[voucherIdx] !== undefined && row[voucherIdx] !== null) {
        rawCode = String(row[voucherIdx]).trim();
      } else {
        for (const cell of row) {
          const str = String(cell || "").trim();
          if (str && str.length >= 3 && !str.includes(" ") && cleanVoucherCodeValue(str) !== "-") {
            rawCode = str;
            break;
          }
        }
      }

      const cleanCode = cleanVoucherCodeValue(rawCode);
      const lowerCode = cleanCode.toLowerCase();
      if (
        lowerCode === "code" ||
        lowerCode === "voucher code" ||
        lowerCode === "vouchercode" ||
        lowerCode === "vouchers"
      ) {
        continue;
      }

      const displayCode = cleanCode && cleanCode !== "-" ? cleanCode : (rawCode || `Row ${rowNumber}`);

      // 1. Mandatory Date Validation Rules:
      // Check that 'VALIDFROM' and 'VALIDTO' exist and are not empty for every row
      let rawFrom = "";
      let rawTo = "";

      if (validFromIdx !== -1 && row[validFromIdx] !== undefined && row[validFromIdx] !== null) {
        rawFrom = String(row[validFromIdx]).trim();
      }
      if (validToIdx !== -1 && row[validToIdx] !== undefined && row[validToIdx] !== null) {
        rawTo = String(row[validToIdx]).trim();
      }

      // If specific column indices were not found or values are empty, check if date range exists in any cell
      if (!rawFrom || !rawTo) {
        for (let c = 0; c < row.length; c++) {
          if (c === voucherIdx) continue;
          const cellVal = row[c];
          if (cellVal !== undefined && cellVal !== null) {
            const str = String(cellVal).trim();
            if (str.includes("-") || str.includes("—") || /\bto\b/i.test(str)) {
              const parts = str.split(/\s*(?:-|—|\bto\b)\s*/i);
              if (parts.length === 2 && !rawFrom) {
                rawFrom = parts[0].trim();
                if (!rawTo) rawTo = parts[1].trim();
              }
            }
          }
        }
      }

      const isFromEmpty = !rawFrom || rawFrom === "-" || rawFrom === "—" || rawFrom.toLowerCase() === "n/a" || rawFrom.toLowerCase() === "null";
      const isToEmpty = !rawTo || rawTo === "-" || rawTo === "—" || rawTo.toLowerCase() === "n/a" || rawTo.toLowerCase() === "null";

      if (isFromEmpty && isToEmpty) {
        errors.push({
          rowNumber,
          code: displayCode,
          validFrom: undefined,
          validTo: undefined,
          reason: "Missing both 'VALIDFROM' and 'VALIDTO' dates"
        });
        continue;
      }

      if (isFromEmpty) {
        errors.push({
          rowNumber,
          code: displayCode,
          validFrom: undefined,
          validTo: rawTo,
          reason: "Missing 'VALIDFROM' date"
        });
        continue;
      }

      if (isToEmpty) {
        errors.push({
          rowNumber,
          code: displayCode,
          validFrom: rawFrom,
          validTo: undefined,
          reason: "Missing 'VALIDTO' date"
        });
        continue;
      }

      // Parse both dates
      const fromIso = cleanVoucherDate(rawFrom) || parseDateToISO(rawFrom);
      const toIso = cleanVoucherDate(rawTo) || parseDateToISO(rawTo);

      if (!fromIso || !/^\d{4}-\d{2}-\d{2}$/.test(fromIso)) {
        errors.push({
          rowNumber,
          code: displayCode,
          validFrom: rawFrom,
          validTo: rawTo,
          reason: `Invalid 'VALIDFROM' date format: "${rawFrom}"`
        });
        continue;
      }

      if (!toIso || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
        errors.push({
          rowNumber,
          code: displayCode,
          validFrom: rawFrom,
          validTo: rawTo,
          reason: `Invalid 'VALIDTO' date format: "${rawTo}"`
        });
        continue;
      }

      // Calculate duration:
      // durationInDays = Math.round((new Date(VALIDTO) - new Date(VALIDFROM)) / (1000 * 60 * 60 * 24))
      const [fy, fm, fd] = fromIso.split("-").map(Number);
      const fromDate = new Date(fy, fm - 1, fd);
      fromDate.setHours(0, 0, 0, 0);

      const [ty, tm, td] = toIso.split("-").map(Number);
      const toDate = new Date(ty, tm - 1, td);
      toDate.setHours(0, 0, 0, 0);

      const durationInDays = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));

      // Verify that duration equals exactly 6 days (or 7 days inclusive)
      if (durationInDays !== 6) {
        errors.push({
          rowNumber,
          code: displayCode,
          validFrom: rawFrom,
          validTo: rawTo,
          durationInDays,
          reason: `Invalid date range: ${durationInDays} days (expected exactly 6 days, e.g. 05/06/2026 to 11/06/2026)`
        });
        continue;
      }
    }

    if (nonBlankRowCount === 0) {
      return {
        isValid: false,
        errors: [{ rowNumber: 1, code: "-", reason: "No voucher rows found in file" }],
        vouchers: []
      };
    }

    if (errors.length > 0) {
      return {
        isValid: false,
        errors,
        vouchers: []
      };
    }

    const vouchers = parseVoucherFile(arrayBuffer, fileName);
    return {
      isValid: true,
      errors: [],
      vouchers
    };
  } catch (err: any) {
    return {
      isValid: false,
      errors: [{ rowNumber: 1, code: "-", reason: `File parsing error: ${err?.message || "Unknown error"}` }],
      vouchers: []
    };
  }
}
