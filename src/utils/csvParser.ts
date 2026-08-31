import * as XLSX from "xlsx";
import { safeLocalStorage } from "./safeLocalStorage";

export function findFormIdColumn(headers: string[]): number {
  const exactTargets = ["form id", "form_id", "formid", "id", "id_no", "id no", "response id", "submission id"];
  let idx = headers.findIndex(h => exactTargets.includes(h.toLowerCase().trim()));
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => h.toLowerCase().includes("form id") || h.toLowerCase().includes("form_id") || h.toLowerCase().includes("formid"));
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => h.toLowerCase() === "id" || h.toLowerCase() === "id_no" || h.toLowerCase() === "id no");
  if (idx !== -1) return idx;

  return -1;
}

export function findVoucherCodeColumn(headers: string[]): number {
  const exactTargets = [
    "vouchercode", "voucher_code", "voucher code", "code", "vouchers", "voucher",
    "qrcode", "qr_code", "qr code", "qr",
    "concessioncode", "concession_code", "concession code", "concession",
    "permitcode", "permit_code", "permit code"
  ];
  let idx = headers.findIndex(h => exactTargets.includes(h));
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    (h.includes("vouchercode") || h.includes("voucher_code") || h.includes("voucher code") || h.includes("voucher") || h.includes("concession") || h.includes("qr")) && 
    !h.includes("id")
  );
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    h.includes("code") && 
    !h.includes("id") && 
    h !== "categorycode" && 
    h !== "tariffcode"
  );
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    h.includes("voucher") && 
    !h.includes("id") && 
    h !== "vouchertype"
  );
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    (h.includes("code") || h.includes("voucher")) && 
    h !== "voucherid" && 
    h !== "voucher_id"
  );
  if (idx !== -1) return idx;

  return -1;
}

export function cleanVoucherCodeValue(val: any): string {
  if (val === undefined || val === null) return "-";
  const s = String(val).trim();
  if (!s || s === "") return "-";
  
  const num = Number(s);
  if (!isNaN(num)) {
    if (s.includes(".") || (num > 30000 && num < 60000)) {
      return "-";
    }
  }

  const lower = s.toLowerCase();
  if (
    lower === "pending" || 
    lower === "none" || 
    lower === "null" || 
    lower === "undefined" || 
    lower === "-" || 
    lower === "—" ||
    lower === "blocked" ||
    lower === "expired" ||
    lower === "cancelled" ||
    lower === "canceled" ||
    lower === "cz7o274wedacs" ||
    lower === "29s54wndiefeg" ||
    lower.includes("cz7o") ||
    lower.includes("29s5") ||
    lower.includes("hospital") || 
    lower.includes("site") || 
    lower.includes("ward") || 
    lower.includes("department")
  ) {
    return "-";
  }

  return s.toUpperCase();
}

export function findValidFromColumn(headers: string[]): number {
  const exactTargets = ["validfrom", "valid_from", "valid from", "startdate", "start_date", "start date"];
  let idx = headers.findIndex(h => exactTargets.includes(h));
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    h.includes("validfrom") || 
    h.includes("valid_from") || 
    h.includes("valid from") || 
    h.includes("start") || 
    h.includes("from")
  );
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    (h === "date" || h.includes("date") || h.includes("day")) && 
    !h.includes("to") && !h.includes("end") && !h.includes("expire") && !h.includes("expiry")
  );
  if (idx !== -1) return idx;

  return -1;
}

export function findValidToColumn(headers: string[]): number {
  const exactTargets = ["validto", "valid_to", "valid to", "enddate", "end_date", "end date", "expire", "expiry"];
  let idx = headers.findIndex(h => exactTargets.includes(h));
  if (idx !== -1) return idx;

  idx = headers.findIndex(h => 
    h.includes("validto") || 
    h.includes("valid_to") || 
    h.includes("valid to") || 
    h.includes("end") || 
    h.includes("expire") || 
    h.includes("expiry")
  );
  if (idx !== -1) return idx;

  return -1;
}

export function resolveDateExpiry(rawDate: string, rawExpiry: string): string {
  if (rawExpiry) {
    const s = String(rawExpiry).trim();
    const parsedExp = parseDateToISO(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsedExp)) {
      return s;
    }
  }
  if (rawDate) {
    const parsedStart = parseDateToISO(rawDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsedStart)) {
      const isoExpiry = addDays(parsedStart, 6);
      const parts = isoExpiry.split("-");
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return isoExpiry;
    }
  }
  return "";
}

export function formatDate(d: string): string {
  if (!d) return "";
  const iso = parseDateToISO(d);
  if (!iso) return d;
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

export function toTitleCase(str: string): string {
  if (!str || str === "-") return str;
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

export function formatFormId(val: string | number | undefined | null): string {
  if (val === undefined || val === null || val === "") return "-";
  const str = String(val).trim();
  if (str === "" || str === "-") return "-";
  return str;
}

export interface CsvPermitRecord {
  id: string;
  formId?: string | number;
  hospital: string;
  ward: string;
  dateRequired: string;
  validFrom?: string;
  validTo?: string;
  dateExpiry?: string;
  vrm: string;
  driverName: string;
  name?: string;
  phone?: string;
  email?: string;
  driverEmail?: string;
  voucherCode?: string;
  prePaidCode?: string;
  qrCode?: string;
  serialNumber?: string;
  voucherCodesText?: string;
  voucher?: string;
  code?: string;
  startTime?: string;
  createdAt?: string;
  created_at?: string;
  completionTime?: string;
  hasOriginalVoucher?: boolean;
  isCancelled?: boolean;
  isDispatched?: boolean;
  dispatchedAt?: string;
  status?: string;
  todayDate?: string;
  processingDate?: string;
  submissionDate?: string;
  department?: string;
  title?: string;
  site?: string;
  qrOverride?: string;
  emailType?: "SEND_CONCESSION" | "RESEND_CONCESSION" | string;
  isResend?: boolean;
  emailTemplate?: "new" | "replacement";
}

export function getNumericFormId(record: CsvPermitRecord): number {
  const val = record.formId !== undefined && record.formId !== null && record.formId !== "" ? record.formId : record.id;
  const formatted = formatFormId(val);
  const num = parseInt(formatted.replace(/\D/g, ""), 10);
  return isNaN(num) ? 0 : num;
}

export function sortRecordsByFormIdDesc(records: CsvPermitRecord[]): CsvPermitRecord[] {
  return [...records].sort((a, b) => getNumericFormId(b) - getNumericFormId(a));
}

export function sortRecordsByFormIdAsc(records: CsvPermitRecord[]): CsvPermitRecord[] {
  return [...records].sort((a, b) => getNumericFormId(a) - getNumericFormId(b));
}

export function getMaxFormId(records: CsvPermitRecord[]): number {
  let max = 0;
  for (const r of records) {
    const num = getNumericFormId(r);
    if (num > max) max = num;
  }
  return max;
}

export function generateNextFormId(records: CsvPermitRecord[]): string {
  const nextNum = getMaxFormId(records) + 1;
  return String(nextNum).padStart(5, "0");
}

export function formatExportStartTime(dateRequired?: string, startTime?: string): string {
  // The "Start Time" export column represents the actual submission timestamp,
  // not the requested parking date (that's already its own "Date Required"
  // column). Prioritizing dateRequired here silently discarded the real
  // time-of-day on every export, which then caused duplicate-precedence ties
  // if the exported file was ever re-imported.
  const targetRaw = startTime || dateRequired || "";
  if (!targetRaw) return "-";

  let datePart = targetRaw.trim();
  if (datePart.includes(" - ")) {
    datePart = datePart.split(" - ")[0].trim();
  } else if (datePart.includes(" to ")) {
    datePart = datePart.split(" to ")[0].trim();
  }

  const iso = parseDateToISO(datePart);
  if (iso) {
    const parts = iso.split("-");
    if (parts.length === 3) {
      const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      const timeMatch = datePart.match(/(?:\s+|T)(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (timeMatch) {
        return `${formattedDate} ${timeMatch[1]}`;
      }
      return formattedDate;
    }
  }

  return datePart || "-";
}

export function formatExportCreatedAt(createdAt?: string, created_at?: string, startTime?: string): string {
  if (createdAt && createdAt.trim()) return createdAt.trim();
  if (created_at && created_at.trim()) return created_at.trim();
  if (startTime && startTime.trim()) return startTime.trim();
  return "-";
}

export function exportToExcel(
  records: CsvPermitRecord[], 
  filename = "Concessions_Permits_Export.xlsx", 
  customVouchersMap?: Record<string, string>,
  processingDate?: string
) {
  const seenIds = new Set<string>();
  const uniqueRecords: CsvPermitRecord[] = [];

  for (const r of records) {
    const rawId = (r.formId !== undefined && r.formId !== null && r.formId !== "" ? r.formId : r.id) || "";
    const cleanId = formatFormId(rawId);
    const key = (cleanId && cleanId !== "-") ? cleanId : String(r.id || "");

    if (key && seenIds.has(key)) {
      continue;
    }
    if (key) {
      seenIds.add(key);
    }
    uniqueRecords.push(r);
  }

  const sorted = sortRecordsByFormIdDesc(uniqueRecords);

  const rows = sorted.map(r => {
    let voucherVal = r.voucherCode || r.prePaidCode || r.qrCode || r.serialNumber;
    if ((!voucherVal || voucherVal === "-" || voucherVal.trim() === "") && customVouchersMap) {
      const cleanVrm = r.vrm ? r.vrm.toUpperCase().replace(/\s+/g, "") : "";
      const recDateISO = parseDateToISO(r.dateRequired || "") || "";
      const keyWithDate = recDateISO ? `${cleanVrm}_${recDateISO}` : cleanVrm;
      const customCode = customVouchersMap[keyWithDate] ||
                         customVouchersMap[cleanVrm] ||
                         (r.id ? customVouchersMap[r.id] : undefined) ||
                         (r.formId ? customVouchersMap[String(r.formId)] : undefined);
      if (customCode) {
        voucherVal = customCode;
      }
    }

    const finalVoucherCode = (voucherVal && voucherVal.trim() !== "") ? voucherVal.trim() : "-";
    const cleanFormId = formatFormId(r.formId !== undefined && r.formId !== null && r.formId !== "" ? r.formId : r.id);

    return {
      "Form ID": cleanFormId,
      "Hospital": r.hospital || "-",
      "Ward / Department": r.ward || "-",
      "Date Required": r.dateRequired || "-",
      "Date Expiry": r.dateExpiry || "-",
      "VRM": r.vrm || "-",
      "Driver Name": r.driverName || "-",
      "Driver Phone": r.phone || "-",
      "Driver Email": r.email || "-",
      "Voucher Code": finalVoucherCode,
      "Start Time": formatExportStartTime(r.dateRequired, r.startTime),
      "Created At": formatExportCreatedAt(r.createdAt, r.created_at, r.startTime)
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      "Form ID",
      "Hospital",
      "Ward / Department",
      "Date Required",
      "Date Expiry",
      "VRM",
      "Driver Name",
      "Driver Phone",
      "Driver Email",
      "Voucher Code",
      "Start Time",
      "Created At"
    ]
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Permits");
  XLSX.writeFile(workbook, filename);
}

export function exportToCSV(
  records: CsvPermitRecord[], 
  filename = "Concessions_Permits_Export.csv", 
  customVouchersMap?: Record<string, string>,
  processingDate?: string
) {
  const seenIds = new Set<string>();
  const uniqueRecords: CsvPermitRecord[] = [];

  for (const r of records) {
    const rawId = (r.formId !== undefined && r.formId !== null && r.formId !== "" ? r.formId : r.id) || "";
    const cleanId = formatFormId(rawId);
    const key = (cleanId && cleanId !== "-") ? cleanId : String(r.id || "");

    if (key && seenIds.has(key)) {
      continue;
    }
    if (key) {
      seenIds.add(key);
    }
    uniqueRecords.push(r);
  }

  const sorted = sortRecordsByFormIdDesc(uniqueRecords);

  const headers = [
    "Form ID",
    "Hospital",
    "Ward / Department",
    "Date Required",
    "Date Expiry",
    "VRM",
    "Driver Name",
    "Driver Phone",
    "Driver Email",
    "Voucher Code",
    "Start Time",
    "Created At"
  ];

  const escapeCsvField = (field: any) => {
    if (field === undefined || field === null) return '""';
    const str = String(field).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvRows = [headers.join(",")];

  for (const r of sorted) {
    let voucherVal = r.voucherCode || r.prePaidCode || r.qrCode || r.serialNumber;
    if ((!voucherVal || voucherVal === "-" || voucherVal.trim() === "") && customVouchersMap) {
      const cleanVrm = r.vrm ? r.vrm.toUpperCase().replace(/\s+/g, "") : "";
      const recDateISO = parseDateToISO(r.dateRequired || "") || "";
      const keyWithDate = recDateISO ? `${cleanVrm}_${recDateISO}` : cleanVrm;
      const customCode = customVouchersMap[keyWithDate] ||
                         customVouchersMap[cleanVrm] ||
                         (r.id ? customVouchersMap[r.id] : undefined) ||
                         (r.formId ? customVouchersMap[String(r.formId)] : undefined);
      if (customCode) {
        voucherVal = customCode;
      }
    }

    const finalVoucherCode = (voucherVal && voucherVal.trim() !== "") ? voucherVal.trim() : "-";
    const cleanFormId = formatFormId(r.formId !== undefined && r.formId !== null && r.formId !== "" ? r.formId : r.id);

    const row = [
      escapeCsvField(cleanFormId),
      escapeCsvField(r.hospital || "-"),
      escapeCsvField(r.ward || "-"),
      escapeCsvField(r.dateRequired || "-"),
      escapeCsvField(r.dateExpiry || "-"),
      escapeCsvField(r.vrm || "-"),
      escapeCsvField(r.driverName || "-"),
      escapeCsvField(r.phone || "-"),
      escapeCsvField(r.email || "-"),
      escapeCsvField(finalVoucherCode),
      escapeCsvField(formatExportStartTime(r.dateRequired, r.startTime)),
      escapeCsvField(formatExportCreatedAt(r.createdAt, r.created_at, r.startTime))
    ];
    csvRows.push(row.join(","));
  }

  const csvString = csvRows.join("\r\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parsePastedText(rawText: string): CsvPermitRecord[] {
  if (!rawText || !rawText.trim()) return [];

  const detectedFormat = detectDateFormat(rawText);
  safeLocalStorage.setItem("concessions_date_format_resolved", detectedFormat);

  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Helper to split a line by tab or CSV or multiple spaces
  const splitLine = (l: string): string[] => {
    if (l.includes("\t")) {
      return l.split("\t").map(c => c.trim());
    }
    const csvParsed = splitCsvLine(l).map(c => c.trim());
    if (csvParsed.length >= 4) return csvParsed;
    return l.split(/\s{2,}/).map(c => c.trim());
  };

  const firstLine = lines[0];
  const firstLineCols = splitLine(firstLine);
  
  const firstCell = firstLineCols[0] || "";
  const dateRegex = /^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/;
  const isFirstCellDate = dateRegex.test(firstCell);

  const lowerFirstLine = firstLine.toLowerCase();
  const hasHeaders = !isFirstCellDate && (
    lowerFirstLine.includes("driver") || 
    lowerFirstLine.includes("vrm") || 
    lowerFirstLine.includes("plate") || 
    lowerFirstLine.includes("valid") || 
    lowerFirstLine.includes("permit") ||
    lowerFirstLine.includes("hospital") ||
    lowerFirstLine.includes("ward") ||
    lowerFirstLine.includes("department") ||
    lowerFirstLine.includes("required") ||
    lowerFirstLine.includes("email") ||
    lowerFirstLine.includes("start time") ||
    lowerFirstLine.includes("completion time")
  );

  const records: CsvPermitRecord[] = [];

  if (hasHeaders) {
    const headers = firstLineCols.map(h => h.toLowerCase().trim());

    const hospitalIdx = headers.findIndex(h => h.includes("hospital") || h.includes("based in") || h.includes("site"));
    const wardIdx = headers.findIndex(h => h.includes("ward") || h.includes("department") || h.includes("dept"));
    
    let dateIdx = headers.findIndex(h => h.includes("date the parking is required on") || h.includes("parking required") || h.includes("date required") || h.includes("valid from") || h.includes("valid_from"));
    if (dateIdx === -1 && headers.length > 8) {
      const colIHeader = headers[8];
      if (colIHeader.includes("date") || colIHeader.includes("required") || colIHeader.includes("parking") || colIHeader.includes("valid")) {
        dateIdx = 8;
      }
    }
    if (dateIdx === -1) {
      dateIdx = headers.findIndex(h => h.includes("date") && (h.includes("required") || h.includes("parking") || h.includes("start")));
    }

    const vrmIdx = headers.findIndex(h => h.includes("registration") || h.includes("plate") || h.includes("vrm"));
    const phoneIdx = headers.findIndex(h => h.includes("phone") || h.includes("mobile") || h.includes("contact") || h.includes("tel"));
    
    let startTimeIdx = headers.findIndex(h => h === "start time" || h === "start_time" || h.includes("submission start") || h.includes("submission time"));
    if (startTimeIdx === -1 && headers.length > 1) {
      const colBHeader = headers[1];
      if (colBHeader.includes("start") || colBHeader.includes("time") || colBHeader.includes("submit") || colBHeader.includes("creation")) {
        startTimeIdx = 1;
      }
    }
    if (startTimeIdx === -1 && headers.length >= 10) {
      startTimeIdx = 1;
    }
    
    let driverIdx = -1;
    if (headers.length > 11) {
      driverIdx = 11;
    } else {
      driverIdx = headers.findIndex(h => h.includes("driver") || h.includes("holder") || h.includes("full name"));
      if (driverIdx === -1) {
        driverIdx = headers.findIndex(h => h === "name");
      }
    }

    let emailIdx = -1;
    if (headers.length > 13) {
      emailIdx = 13;
    } else {
      emailIdx = headers.findIndex(h => h.includes("email") || h.includes("mail"));
    }

    const voucherIdx = findVoucherCodeColumn(headers);
    const validToIdx = findValidToColumn(headers);
    const idIdx = findFormIdColumn(headers);

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const columns = splitLine(line);

      if (columns.length < 2) continue;

      const rawVrm = vrmIdx !== -1 ? columns[vrmIdx] : "";
      const rawDriver = driverIdx !== -1 ? columns[driverIdx] : "";
      const rawHospital = hospitalIdx !== -1 ? columns[hospitalIdx] : "";
      const rawWard = wardIdx !== -1 ? columns[wardIdx] : "";
      const rawDate = dateIdx !== -1 ? columns[dateIdx] : "";
      const rawPhone = phoneIdx !== -1 ? columns[phoneIdx] : "";
      const rawEmail = emailIdx !== -1 ? columns[emailIdx] : "";
      const rawVoucher = voucherIdx !== -1 ? columns[voucherIdx] : "";
      const rawExpiry = validToIdx !== -1 ? columns[validToIdx] : "";
      const rawStartTime = startTimeIdx !== -1 ? columns[startTimeIdx] : "";

      const cleanVrm = rawVrm ? rawVrm.toUpperCase().replace(/\s+/g, "") : "";
      if (!cleanVrm && !rawDriver && !rawEmail) continue;

      let formIdStr = "";
      if (idIdx !== -1 && columns[idIdx]) {
        const rawIdVal = String(columns[idIdx]).trim();
        const cleaned = formatFormId(rawIdVal);
        if (cleaned && cleaned !== "-") {
          formIdStr = cleaned;
        }
      }
      if (!formIdStr) {
        formIdStr = String(i);
      }

      const parsedReqDate = parseUKDate(rawDate) || rawDate;
      const parsedExpDate = parseUKDate(rawExpiry) || rawExpiry;

      records.push({
        id: formIdStr,
        formId: formIdStr,
        hospital: rawHospital || "Whipps Cross Hospital",
        ward: rawWard || "Acorn Ward",
        dateRequired: parsedReqDate,
        dateExpiry: resolveDateExpiry(parsedReqDate, parsedExpDate),
        vrm: cleanVrm || "PENDING",
        driverName: rawDriver || "Driver's Name",
        phone: rawPhone ? formatPhoneNumber(String(rawPhone)) : "",
        email: rawEmail ? String(rawEmail).trim() : "",
        voucherCode: cleanVoucherCodeValue(rawVoucher),
        startTime: rawStartTime || undefined,
        createdAt: rawStartTime || new Date().toISOString()
      });
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const columns = splitLine(line);

      if (columns.length < 2) continue;

      // Check if standard 10, 11, or 12 column concessions table format:
      // [#FormId, Hospital, Ward, DateRequired, DateExpiry, VRM, DriverName, Phone, Email, Voucher, StartTime/CreatedAt...]
      const hasStandardConcessionsCols = (
        columns.length >= 7 &&
        (columns[0].startsWith("#") || /^\d+$/.test(columns[0])) &&
        (columns[1].toLowerCase().includes("hospital") || columns[1].toLowerCase().includes("site") || columns[1].toLowerCase().includes("whipps") || columns[1].toLowerCase().includes("newham") || columns[1].toLowerCase().includes("barts") || columns[1].toLowerCase().includes("royal"))
      );

      if (hasStandardConcessionsCols) {
        const rawId = columns[0] || "";
        const rawHospital = columns[1] || "Newham Hospital";
        const rawWard = columns[2] || "ICU";
        const rawDate = columns[3] || "";
        const rawExpiry = columns[4] || "";
        const rawVrm = columns[5] || "";
        const rawDriver = columns[6] || "Driver's Name";
        const rawPhone = columns[7] || "";
        const rawEmail = columns[8] || "";
        const rawVoucher = columns[9] || "";
        const rawStartTime = columns[10] || columns[11] || "";

        const formIdStr = formatFormId(rawId) || String(i + 1);
        const cleanVrm = rawVrm ? rawVrm.toUpperCase().replace(/\s+/g, "") : "";

        records.push({
          id: formIdStr,
          formId: formIdStr,
          hospital: rawHospital,
          ward: rawWard,
          dateRequired: rawDate,
          dateExpiry: resolveDateExpiry(rawDate, rawExpiry),
          vrm: cleanVrm || "PENDING",
          driverName: rawDriver,
          phone: rawPhone ? formatPhoneNumber(rawPhone) : "",
          email: rawEmail,
          voucherCode: cleanVoucherCodeValue(rawVoucher),
          startTime: rawStartTime || undefined,
          createdAt: rawStartTime || new Date().toISOString()
        });
        continue;
      }

      let isMsFormsFormat = false;
      let formsEmailIdx = -1;
      let formsHospitalIdx = -1;

      if (columns.length >= 7) {
        formsEmailIdx = columns.findIndex(c => c && c.includes("@"));
        formsHospitalIdx = columns.findIndex(c => {
          const lower = c.toLowerCase();
          return lower.includes("hospital") || lower.includes("whipps") || lower.includes("newham") || lower.includes("barts") || lower.includes("royal") || lower.includes("mile");
        });

        if (formsEmailIdx !== -1 && formsHospitalIdx !== -1) {
          isMsFormsFormat = true;
        } else if (formsHospitalIdx !== -1 && (formsHospitalIdx === 2 || formsHospitalIdx === 3)) {
          isMsFormsFormat = true;
        }
      }

      let rawDriver = "Driver's Name";
      let rawVrm = "";
      let rawVoucher = "";
      let rawWard = "Acorn Ward";
      let rawDate = "";
      let rawExpiry = "";
      let rawHospital = "Newham Hospital";
      let rawEmail = "";
      let rawPhone = "";
      let rawStartTime = "";

      if (isMsFormsFormat) {
        rawStartTime = columns[0] || "";
        rawEmail = formsEmailIdx !== -1 ? (columns[formsEmailIdx] || "") : "";
        rawHospital = columns[formsHospitalIdx] || "Newham Hospital";
        rawWard = columns[formsHospitalIdx + 1] || "Acorn Ward";
        rawDate = columns[formsHospitalIdx + 2] || "";
        
        if (formsEmailIdx !== -1 && formsEmailIdx + 1 < columns.length) {
          rawDriver = columns[formsEmailIdx + 1] || "Driver's Name";
        } else {
          if (formsHospitalIdx + 4 < columns.length) {
            rawDriver = columns[formsHospitalIdx + 4];
          } else {
            rawDriver = columns[columns.length - 1] || "Driver's Name";
          }
        }

        if (formsHospitalIdx + 3 < columns.length) {
          rawVrm = columns[formsHospitalIdx + 3];
        } else {
          rawVrm = "PENDING";
        }
      } else {
        rawDriver = columns[0] || "Driver's Name";
        rawVrm = columns[1] || "";
        rawVoucher = columns[2] || "";
        rawWard = columns[3] || "Acorn Ward";
        rawDate = columns[4] || "";
        rawExpiry = columns[5] || "";
      }

      const cleanVrm = rawVrm ? rawVrm.toUpperCase().replace(/\s+/g, "") : "";
      if (!cleanVrm && !rawDriver && !rawEmail) continue;

      const seqFormId = String(i + 1);

      records.push({
        id: seqFormId,
        formId: seqFormId,
        hospital: rawHospital,
        ward: rawWard,
        dateRequired: rawDate,
        dateExpiry: resolveDateExpiry(rawDate, rawExpiry),
        vrm: cleanVrm || "PENDING",
        driverName: rawDriver,
        phone: rawPhone ? formatPhoneNumber(rawPhone) : "",
        email: rawEmail,
        voucherCode: cleanVoucherCodeValue(rawVoucher),
        startTime: rawStartTime || undefined,
        createdAt: rawStartTime || new Date().toISOString()
      });
    }
  }

  return sortRecordsByFormIdDesc(records);
}

export function parsePermitCsv(rawText: string): CsvPermitRecord[] {
  if (!rawText || !rawText.trim()) return [];

  const detectedFormat = detectDateFormat(rawText);
  safeLocalStorage.setItem("concessions_date_format_resolved", detectedFormat);

  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(5, lines.length); r++) {
    const l = lines[r].toLowerCase();
    if (l.includes("vrm") || l.includes("registration") || l.includes("plate") || l.includes("driver") || l.includes("email") || l.includes("hospital") || l.includes("ward") || l.includes("required")) {
      headerRowIndex = r;
      break;
    }
  }

  const firstLine = lines[headerRowIndex];
  const headers = (firstLine.includes("\t") 
    ? firstLine.split("\t").map(c => c.trim()) 
    : splitCsvLine(firstLine).map(c => c.trim())
  ).map(h => h.toLowerCase().trim());

  const idIdx = headers.findIndex(h => h === "id" || h === "form id" || h === "form_id" || h === "id_no" || h === "response id" || h === "record id");
  const hospitalIdx = headers.findIndex(h => h.includes("hospital") || h.includes("based in") || h.includes("site"));
  const wardIdx = headers.findIndex(h => h.includes("ward") || h.includes("department") || h.includes("dept"));
  
  let dateIdx = headers.findIndex(h => h.includes("date the parking is required on") || h.includes("parking required") || h.includes("date required") || h.includes("valid from") || h.includes("valid_from"));
  if (dateIdx === -1 && headers.length > 8) {
    const colIHeader = headers[8];
    if (colIHeader.includes("date") || colIHeader.includes("required") || colIHeader.includes("parking") || colIHeader.includes("valid")) {
      dateIdx = 8;
    }
  }
  if (dateIdx === -1) {
    dateIdx = headers.findIndex(h => h.includes("date") && (h.includes("required") || h.includes("parking") || h.includes("start")));
  }

  const vrmIdx = headers.findIndex(h => h.includes("registration") || h.includes("plate") || h.includes("vrm"));
  const phoneIdx = headers.findIndex(h => h.includes("phone") || h.includes("mobile") || h.includes("contact") || h.includes("tel"));
  
  let startTimeIdx = headers.findIndex(h => h === "start time" || h === "start_time" || h.includes("submission start") || h.includes("submission time"));
  if (startTimeIdx === -1 && headers.length > 1) {
    const colBHeader = headers[1];
    if (colBHeader.includes("start") || colBHeader.includes("time") || colBHeader.includes("submit") || colBHeader.includes("creation")) {
      startTimeIdx = 1;
    }
  }
  if (startTimeIdx === -1 && headers.length >= 10) {
    startTimeIdx = 1;
  }
  
  let driverIdx = -1;
  if (headers.length > 11) {
    driverIdx = 11;
  } else {
    driverIdx = headers.findIndex(h => h.includes("driver") || h.includes("holder") || h.includes("full name"));
    if (driverIdx === -1) {
      driverIdx = headers.findIndex(h => h === "name");
    }
  }

  let emailIdx = -1;
  if (headers.length > 13) {
    emailIdx = 13;
  } else {
    emailIdx = headers.findIndex(h => h.includes("email") || h.includes("mail"));
  }

  const voucherIdx = findVoucherCodeColumn(headers);
  const validToIdx = findValidToColumn(headers);

  const records: CsvPermitRecord[] = [];

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const columns = line.includes("\t") 
      ? line.split("\t").map(c => c.trim()) 
      : splitCsvLine(line).map(c => c.trim());
    if (columns.length < 2) continue;

    const rawVrm = vrmIdx !== -1 ? columns[vrmIdx] : "";
    const rawDriver = driverIdx !== -1 ? columns[driverIdx] : "";
    const rawHospital = hospitalIdx !== -1 ? columns[hospitalIdx] : "";
    const rawWard = wardIdx !== -1 ? columns[wardIdx] : "";
    const rawDate = dateIdx !== -1 ? columns[dateIdx] : "";
    const rawPhone = phoneIdx !== -1 ? columns[phoneIdx] : "";
    const rawEmail = emailIdx !== -1 ? columns[emailIdx] : "";
    const rawVoucher = voucherIdx !== -1 ? columns[voucherIdx] : "";
    const rawExpiry = validToIdx !== -1 ? columns[validToIdx] : "";
    const rawStartTime = startTimeIdx !== -1 ? columns[startTimeIdx] : "";

    let cleanVrm = rawVrm ? String(rawVrm).trim().toUpperCase().replace(/\s+/g, "") : "";
    let cleanDriver = rawDriver ? String(rawDriver).trim() : "";
    let cleanEmail = rawEmail ? String(rawEmail).trim() : "";
    let cleanPhone = rawPhone ? String(rawPhone).trim() : "";
    let cleanHospital = rawHospital ? String(rawHospital).trim() : "";
    let cleanWard = rawWard ? String(rawWard).trim() : "";

    if (cleanVrm === "NULL" || cleanVrm === "UNDEFINED" || cleanVrm === "NONE" || cleanVrm === "N/A" || cleanVrm === "-") cleanVrm = "";
    if (cleanDriver.toLowerCase() === "null" || cleanDriver.toLowerCase() === "undefined") cleanDriver = "";
    if (cleanEmail.toLowerCase() === "null" || cleanEmail.toLowerCase() === "undefined") cleanEmail = "";

    const lowerDriver = cleanDriver.toLowerCase();
    if (
      lowerDriver === "driver's name" || lowerDriver === "driver name" ||
      lowerDriver === "driver" || lowerDriver === "name" ||
      lowerDriver === "full name" || lowerDriver.startsWith("total") ||
      lowerDriver.startsWith("subtotal") || lowerDriver === "id"
    ) {
      continue;
    }

    if (!cleanVrm && !cleanDriver && !cleanEmail && !rawDate && !rawStartTime) continue;

    let formIdStr = "";
    if (idIdx !== -1 && columns[idIdx]) {
      const rawIdVal = String(columns[idIdx]).trim();
      const cleaned = formatFormId(rawIdVal);
      if (cleaned && cleaned !== "-") {
        formIdStr = cleaned;
      }
    }
    if (!formIdStr) {
      formIdStr = `row-${i + 1}`;
    }

    records.push({
      id: formIdStr,
      formId: formIdStr,
      hospital: cleanHospital || "Whipps Cross Hospital",
      ward: cleanWard || "Acorn Ward",
      dateRequired: rawDate,
      dateExpiry: resolveDateExpiry(rawDate, rawExpiry),
      vrm: cleanVrm || "PENDING",
      driverName: cleanDriver || "Driver's Name",
      phone: cleanPhone ? formatPhoneNumber(cleanPhone) : "",
      email: cleanEmail,
      voucherCode: cleanVoucherCodeValue(rawVoucher),
      startTime: rawStartTime ? String(rawStartTime).trim() : undefined,
      createdAt: rawStartTime || new Date().toISOString()
    });
  }

  return sortRecordsByFormIdDesc(records);
}

export function parsePermitExcel(arrayBuffer: ArrayBuffer): CsvPermitRecord[] {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
    if (rawRows.length < 2) return [];

    try {
      const allCellsStr = rawRows.map(row => Array.isArray(row) ? row.join(" ") : "").join("\n");
      const detected = detectDateFormat(allCellsStr);
      safeLocalStorage.setItem("concessions_date_format_resolved", detected);
    } catch (e) {}

    let headerRowIndex = 0;
    for (let r = 0; r < Math.min(5, rawRows.length); r++) {
      const candidateRow = rawRows[r] as unknown[];
      if (candidateRow && Array.isArray(candidateRow)) {
        const candidateStr = candidateRow.map(c => String(c || "").toLowerCase()).join(" ");
        if (
          candidateStr.includes("vrm") || candidateStr.includes("registration") ||
          candidateStr.includes("plate") || candidateStr.includes("driver") ||
          candidateStr.includes("email") || candidateStr.includes("hospital") ||
          candidateStr.includes("ward") || candidateStr.includes("required") ||
          candidateStr.includes("start time") || candidateStr.includes("completion time")
        ) {
          headerRowIndex = r;
          break;
        }
      }
    }

    const headerRow = rawRows[headerRowIndex] as string[];
    const headers = (headerRow || []).map(h => String(h || "").toLowerCase().trim());

    const hospitalIdx = headers.findIndex(h => h.includes("hospital") || h.includes("based in") || h.includes("site"));
    const wardIdx = headers.findIndex(h => h.includes("ward") || h.includes("department") || h.includes("dept"));
    
    let dateIdx = headers.findIndex(h => h.includes("date the parking is required on") || h.includes("parking required") || h.includes("date required") || h.includes("valid from") || h.includes("valid_from"));
    if (dateIdx === -1 && headers.length > 8) {
      const colIHeader = headers[8];
      if (colIHeader.includes("date") || colIHeader.includes("required") || colIHeader.includes("parking") || colIHeader.includes("valid")) {
        dateIdx = 8;
      }
    }
    if (dateIdx === -1) {
      dateIdx = headers.findIndex(h => h.includes("date") && (h.includes("required") || h.includes("parking") || h.includes("start")));
    }

    const vrmIdx = headers.findIndex(h => h.includes("registration") || h.includes("plate") || h.includes("vrm"));
    const phoneIdx = headers.findIndex(h => h.includes("phone") || h.includes("mobile") || h.includes("contact") || h.includes("tel"));
    
    let startTimeIdx = headers.findIndex(h => h === "start time" || h === "start_time" || h.includes("submission start") || h.includes("submission time"));
    if (startTimeIdx === -1 && headers.length > 1) {
      const colBHeader = headers[1];
      if (colBHeader.includes("start") || colBHeader.includes("time") || colBHeader.includes("submit") || colBHeader.includes("creation")) {
        startTimeIdx = 1;
      }
    }
    if (startTimeIdx === -1 && headers.length >= 10) {
      startTimeIdx = 1;
    }
    
    let driverIdx = -1;
    if (headers.length > 11) {
      driverIdx = 11;
    } else {
      driverIdx = headers.findIndex(h => h.includes("driver") || h.includes("holder") || h.includes("full name"));
      if (driverIdx === -1) {
        driverIdx = headers.findIndex(h => h === "name");
      }
    }

    let emailIdx = -1;
    if (headers.length > 13) {
      emailIdx = 13;
    } else {
      emailIdx = headers.findIndex(h => h.includes("email") || h.includes("mail"));
    }

    const voucherIdx = findVoucherCodeColumn(headers);
    const validToIdx = findValidToColumn(headers);
    const idIdx = findFormIdColumn(headers);

    const records: CsvPermitRecord[] = [];

    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const columns = rawRows[i] as unknown[];
      if (!columns || !Array.isArray(columns) || columns.length < 1) continue;

      const rawVrm = vrmIdx !== -1 ? columns[vrmIdx] : "";
      const rawDriver = driverIdx !== -1 ? columns[driverIdx] : "";
      const rawHospital = hospitalIdx !== -1 ? columns[hospitalIdx] : "";
      const rawWard = wardIdx !== -1 ? columns[wardIdx] : "";
      const rawPhone = phoneIdx !== -1 ? columns[phoneIdx] : "";
      const rawEmail = emailIdx !== -1 ? columns[emailIdx] : "";
      const rawVoucher = voucherIdx !== -1 ? columns[voucherIdx] : "";
      
      let rawDate = "";
      if (dateIdx !== -1 && columns[dateIdx] !== undefined && columns[dateIdx] !== null) {
        const val = columns[dateIdx];
        if (typeof val === "number") {
          const date = new Date((val - 25569) * 86400 * 1000);
          if (!isNaN(date.getTime())) {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, "0");
            const day = String(date.getUTCDate()).padStart(2, "0");
            rawDate = `${day}/${month}/${year}`;
          }
        } else {
          const s = String(val).trim();
          if (s && s !== "null" && s !== "undefined") rawDate = s;
        }
      }

      let rawExpiry = "";
      if (validToIdx !== -1 && columns[validToIdx] !== undefined && columns[validToIdx] !== null) {
        const val = columns[validToIdx];
        if (typeof val === "number") {
          const date = new Date((val - 25569) * 86400 * 1000);
          if (!isNaN(date.getTime())) {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, "0");
            const day = String(date.getUTCDate()).padStart(2, "0");
            rawExpiry = `${day}/${month}/${year}`;
          }
        } else {
          const s = String(val).trim();
          if (s && s !== "null" && s !== "undefined") rawExpiry = s;
        }
      }

      let rawStartTime = "";
      if (startTimeIdx !== -1 && columns[startTimeIdx] !== undefined && columns[startTimeIdx] !== null) {
        const val = columns[startTimeIdx];
        if (typeof val === "number") {
          const date = new Date((val - 25569) * 86400 * 1000);
          if (!isNaN(date.getTime())) {
            const hours = String(date.getUTCHours()).padStart(2, "0");
            const minutes = String(date.getUTCMinutes()).padStart(2, "0");
            const seconds = String(date.getUTCSeconds()).padStart(2, "0");
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, "0");
            const day = String(date.getUTCDate()).padStart(2, "0");
            rawStartTime = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
          }
        } else {
          const s = String(val).trim();
          if (s && s !== "null" && s !== "undefined") rawStartTime = s;
        }
      }

      let cleanVrm = rawVrm !== undefined && rawVrm !== null ? String(rawVrm).trim().toUpperCase().replace(/\s+/g, "") : "";
      let cleanDriver = rawDriver !== undefined && rawDriver !== null ? String(rawDriver).trim() : "";
      let cleanEmail = rawEmail !== undefined && rawEmail !== null ? String(rawEmail).trim() : "";
      let cleanPhone = rawPhone !== undefined && rawPhone !== null ? String(rawPhone).trim() : "";
      let cleanHospital = rawHospital !== undefined && rawHospital !== null ? String(rawHospital).trim() : "";
      let cleanWard = rawWard !== undefined && rawWard !== null ? String(rawWard).trim() : "";

      if (cleanVrm === "NULL" || cleanVrm === "UNDEFINED" || cleanVrm === "NONE" || cleanVrm === "N/A" || cleanVrm === "-") cleanVrm = "";
      if (cleanDriver.toLowerCase() === "null" || cleanDriver.toLowerCase() === "undefined") cleanDriver = "";
      if (cleanEmail.toLowerCase() === "null" || cleanEmail.toLowerCase() === "undefined") cleanEmail = "";

      const lowerDriver = cleanDriver.toLowerCase();
      if (
        lowerDriver === "driver's name" || lowerDriver === "driver name" ||
        lowerDriver === "driver" || lowerDriver === "name" ||
        lowerDriver === "full name" || lowerDriver.startsWith("total") ||
        lowerDriver.startsWith("subtotal") || lowerDriver === "id"
      ) {
        continue;
      }

      if (!cleanVrm && !cleanDriver && !cleanEmail && !rawDate && !rawStartTime) continue;

      let formIdStr = "";
      if (idIdx !== -1 && columns[idIdx] !== undefined && columns[idIdx] !== null) {
        const rawIdVal = String(columns[idIdx]).trim();
        const cleaned = formatFormId(rawIdVal);
        if (cleaned && cleaned !== "-") {
          formIdStr = cleaned;
        }
      } else if (columns[0] !== undefined && columns[0] !== null) {
        const rawIdVal = String(columns[0]).trim();
        const cleaned = formatFormId(rawIdVal);
        if (cleaned && cleaned !== "-") {
          formIdStr = cleaned;
        }
      }
      if (!formIdStr) {
        formIdStr = `row-${i + 1}`;
      }

      records.push({
        id: formIdStr,
        formId: formIdStr,
        hospital: cleanHospital || "Whipps Cross Hospital",
        ward: cleanWard || "Acorn Ward",
        dateRequired: rawDate,
        dateExpiry: resolveDateExpiry(rawDate, rawExpiry),
        vrm: cleanVrm || "PENDING",
        driverName: cleanDriver || "Driver's Name",
        phone: cleanPhone ? formatPhoneNumber(cleanPhone) : "",
        email: cleanEmail,
        voucherCode: cleanVoucherCodeValue(rawVoucher),
        startTime: rawStartTime || undefined,
        createdAt: rawStartTime || new Date().toISOString()
      });
    }

    const seenFormIds = new Set<string>();
    const uniqueRecords: CsvPermitRecord[] = [];
    for (const rec of records) {
      const key = String(rec.formId || rec.id || "");
      if (key && !seenFormIds.has(key)) {
        seenFormIds.add(key);
        uniqueRecords.push(rec);
      } else if (!key) {
        uniqueRecords.push(rec);
      }
    }

    return sortRecordsByFormIdDesc(uniqueRecords);
  } catch (error) {
    console.error("XLSX Parsing failed:", error);
    return [];
  }
}

export function isVoucherCodeMatch(qrOrCode1: string, code2: string): boolean {
  if (!qrOrCode1 || !code2) return false;
  const c1 = qrOrCode1.trim().toUpperCase();
  const c2 = code2.trim().toUpperCase();

  const placeholders = new Set(["-", "—", "PENDING", "N/A", "NA", "NONE", "UNKNOWN", "NULL", "UNDEFINED", "NO", "YES"]);
  if (placeholders.has(c1) || placeholders.has(c2)) return false;

  if (c1 === c2) return true;

  if (c2.length >= 6 && c1.length >= c2.length && (c1.endsWith(c2) || c1.includes(c2))) return true;
  if (c1.length >= 6 && c2.length >= c1.length && (c2.endsWith(c1) || c2.includes(c1))) return true;
  return false;
}

export function getTodayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Validates that a parking permit's required date falls within the allowed window:
 * 7 valid days in the past through tomorrow (inclusive), relative to a reference
 * "today" date.
 *
 * daysDiff = dateRequired - today (in whole days)
 * Valid only if: -6 <= daysDiff <= 1
 * Anything outside that window (8+ days ago, i.e. daysDiff <= -7, or 2+ days
 * ahead, i.e. daysDiff > 1) is invalid and should be cancelled.
 *
 * This is the single source of truth for cancellation-by-date. Callers should
 * use this to compute status dynamically rather than trusting a stored
 * voucherCode/status string, which may be stale (e.g. re-imported from a
 * previous export, or simply left over from an earlier day).
 *
 * @param dateRequiredStr the permit's required parking date
 * @param referenceDateStr optional reference "today" (defaults to the real
 *   current date). Pass this when the UI lets the user review data as of a
 *   simulated/processing date rather than the actual system date.
 */
export function isDateRequiredOutsideValidWindow(dateRequiredStr?: string, referenceDateStr?: string): boolean {
  if (!dateRequiredStr) return false;
  const iso = parseDateToISO(String(dateRequiredStr));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;

  const refIso = referenceDateStr ? parseDateToISO(String(referenceDateStr)) : "";
  const today = /^\d{4}-\d{2}-\d{2}$/.test(refIso) ? new Date(refIso + "T00:00:00") : new Date();
  today.setHours(0, 0, 0, 0);

  const parkingDate = new Date(iso + "T00:00:00");
  parkingDate.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((parkingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff < -7 || daysDiff > 1;
}

export function parseUKDate(dateStr: string): string {
  if (!dateStr) return "";
  let s = String(dateStr).trim();
  if (!s) return "";

  s = s.split(/[\sT]+/)[0].trim();

  const ymdMatch = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = String(parseInt(ymdMatch[2], 10)).padStart(2, "0");
    const day = String(parseInt(ymdMatch[3], 10)).padStart(2, "0");
    return `${day}/${month}/${year}`;
  }

  const dmyMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmyMatch) {
    const day = String(parseInt(dmyMatch[1], 10)).padStart(2, "0");
    const month = String(parseInt(dmyMatch[2], 10)).padStart(2, "0");
    let yearStr = dmyMatch[3];
    if (yearStr.length === 2) {
      yearStr = "20" + yearStr;
    }
    return `${day}/${month}/${yearStr}`;
  }

  return s;
}

export function parseDateToISO(dateStr: string): string {
  if (!dateStr) return "";
  let s = String(dateStr).trim();
  if (!s) return "";

  s = s.split(/[\sT]+/)[0].trim();
  
  // 1. If date is already YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
    const day = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 2. Excel numeric serial date support (e.g. 46255 -> 2026-08-21)
  if (!isNaN(Number(s)) && Number(s) > 30000 && Number(s) < 60000) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  let dateFormat = "UK";
  try {
    const saved = safeLocalStorage.getItem("concessions_date_format");
    if (saved === "US" || saved === "UK") {
      dateFormat = saved;
    } else {
      const resolved = safeLocalStorage.getItem("concessions_date_format_resolved");
      if (resolved === "US") {
        dateFormat = "US";
      }
    }
  } catch (e) {}

  // 3. Handle DD/MM/YYYY, MM/DD/YYYY, D/M/YY, D/M/YYYY (e.g. "8/21/2026", "21/08/2026", "8/19/26")
  const slashMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (slashMatch) {
    const part1 = parseInt(slashMatch[1], 10);
    const part2 = parseInt(slashMatch[2], 10);
    let yearStr = slashMatch[3];
    if (yearStr.length === 2) {
      const yy = parseInt(yearStr, 10);
      yearStr = (yy >= 70 ? "19" : "20") + yearStr;
    }
    
    let day = part1;
    let month = part2;
    
    if (dateFormat === "US") {
      day = part2;
      month = part1;
    }
    
    // Auto-disambiguate: If one part is > 12 and the other is <= 12, part > 12 MUST be the day
    if (month > 12 && day <= 12) {
      const temp = month;
      month = day;
      day = temp;
    }
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${yearStr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 4. Fallback using native Date parsing
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

export function addDays(dateStr: string, days: number): string {
  return addDaysSafe(dateStr, days);
}

export function formatPhoneNumber(phone: string): string {
  if (!phone) return "";
  let clean = phone.trim();
  if (clean.startsWith("+44")) {
    clean = "0" + clean.slice(3).trim();
  } else if (clean.startsWith("44") && clean.replace(/\s/g, "").length > 10) {
    clean = "0" + clean.slice(2).trim();
  }
  
  if (!clean.startsWith("0") && clean.length > 0) {
    clean = "0" + clean;
  }
  return clean;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export interface ParsedVoucherData {
  vrm?: string;
  code: string;
  status?: string;
  isUsed?: boolean;
  validFrom?: string;
  validTo?: string;
  valid_from?: string;
  valid_to?: string;
  [key: string]: any;
}

export function cleanVoucherDate(val: any): string {
  if (val === undefined || val === null) return "";
  
  if (val instanceof Date) {
    const year = val.getUTCFullYear();
    const month = String(val.getUTCMonth() + 1).padStart(2, '0');
    const day = String(val.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const s = String(val).trim();
  if (!s || s === "-" || s === "—" || s === "N/A" || s === "NA") return "";

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  if (!isNaN(Number(s)) && Number(s) > 30000 && Number(s) < 60000) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  const range = parseDateRange(s);
  if (range && range.startISO) {
    return range.startISO;
  }

  const parsedIso = parseDateToISO(s);
  if (parsedIso && /^\d{4}-\d{2}-\d{2}$/.test(parsedIso)) {
    return parsedIso;
  }

  return "";
}

export function normalizeVoucherData(item: any): ParsedVoucherData {
  if (!item) return item;
  const rawCode = item.code || item.VoucherCode || item.Code || item.voucher_code || "";
  const cleanCode = cleanVoucherCodeValue(rawCode);
  
  const startRaw = item.validFrom || item.valid_from || item.ValidFrom || item.date || item.dateRequired || item.uploadDate || item.IssueDate || item.created_at || item.startDate || item.start_date;
  const endRaw = item.validTo || item.valid_to || item.ValidTo || item.expires || item.expiryDate || item.endDate || item.end_date;
  
  const validFrom = cleanVoucherDate(startRaw) || undefined;
  const validTo = cleanVoucherDate(endRaw) || (validFrom ? validFrom : undefined);
  
  return {
    ...item,
    code: cleanCode.toUpperCase(),
    validFrom,
    validTo,
    valid_from: validFrom,
    valid_to: validTo,
    status: item.status || "active",
    isUsed: item.isUsed !== undefined ? Boolean(item.isUsed) : false,
  };
}

export function normalizeVouchersList(vouchers: any[]): ParsedVoucherData[] {
  if (!Array.isArray(vouchers)) return [];
  return vouchers
    .map(normalizeVoucherData)
    .filter(v => v && v.code && v.code !== "-");
}

export function parseVoucherFile(arrayBuffer: ArrayBuffer, fileName?: string): ParsedVoucherData[] {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
    if (rawRows.length === 0) return [];

    let fileDate = "";
    if (fileName) {
      const matchRange = parseDateRange(fileName);
      if (matchRange && matchRange.startISO) {
        fileDate = matchRange.startISO;
      } else {
        const single = parseDateToISO(fileName);
        if (single && /^\d{4}-\d{2}-\d{2}$/.test(single)) {
          fileDate = single;
        }
      }
    }
    const defaultDate = fileDate || getTodayISO();

    const firstRow = rawRows[0] as unknown[];
    if (!firstRow || firstRow.length === 0) return [];

    const headers = firstRow.map(h => String(h || "").toLowerCase().trim());
    
    const sampleRows = rawRows.slice(0, 15);
    const maxCols = Math.max(...sampleRows.map(r => Array.isArray(r) ? r.length : 0));

    const voucherIdx = findVoucherCodeColumn(headers);
    const validFromIdx = findValidFromColumn(headers);
    const validToIdx = findValidToColumn(headers);
    let vrmIdx = headers.findIndex(h => 
      h.includes("vrm") || 
      h.includes("plate") || 
      h.includes("registration") || 
      h.includes("reg") || 
      h.includes("vehicle")
    );

    let statusIdx = headers.findIndex(h => h.includes("status") || h.includes("state"));
    let isUsedIdx = headers.findIndex(h => h.includes("used") || h.includes("is_used") || h.includes("isused") || h.includes("assigned"));

    let isFirstRowData = false;
    for (const cell of firstRow) {
      const cellStr = String(cell || "").trim();
      if (cellStr.match(/^CON\d+JXM$/i) || (cellStr.length >= 8 && cleanVoucherDate(cellStr))) {
        isFirstRowData = true;
        break;
      }
    }

    const result: ParsedVoucherData[] = [];
    const seenCodes = new Set<string>();
    const hasHeaders = !isFirstRowData && (
      firstRow.some(cell => {
        const str = String(cell || "").toLowerCase().trim();
        return str.includes("code") || str.includes("valid") || str.includes("date") || str.includes("voucher") || str.includes("from") || str.includes("to") || str.includes("plate") || str.includes("vrm") || str.includes("status") || str.includes("used");
      })
    );
    const startIndex = hasHeaders ? 1 : 0;
    
    for (let i = startIndex; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];
      if (!row || row.length === 0) continue;
      
      let rawCode = "";
      let vrm = "";
      let validFrom = "";
      let validTo = "";
      let status = "active";
      let isUsed = false;
      
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

      if (statusIdx !== -1 && row[statusIdx] !== undefined && row[statusIdx] !== null) {
        const sVal = String(row[statusIdx]).trim().toLowerCase();
        if (sVal) status = sVal;
      }

      if (isUsedIdx !== -1 && row[isUsedIdx] !== undefined && row[isUsedIdx] !== null) {
        const uVal = row[isUsedIdx];
        if (typeof uVal === "boolean") {
          isUsed = uVal;
        } else {
          const strVal = String(uVal).trim().toLowerCase();
          isUsed = strVal === "true" || strVal === "1" || strVal === "yes" || strVal === "used";
        }
      }

      const cleanCode = cleanVoucherCodeValue(rawCode);
      const lowerCode = cleanCode.toLowerCase();
      if (
        !cleanCode || 
        cleanCode === "-" || 
        lowerCode === "code" || 
        lowerCode === "voucher code" || 
        lowerCode === "vouchercode" || 
        lowerCode === "voucher_code" || 
        lowerCode === "vouchers" || 
        lowerCode === "qr code" ||
        lowerCode === "qrcode"
      ) {
        continue;
      }

      const upperCode = cleanCode.toUpperCase();
      if (seenCodes.has(upperCode)) {
        continue;
      }
      seenCodes.add(upperCode);
      
      if (vrmIdx !== -1 && row[vrmIdx] !== undefined) {
        vrm = String(row[vrmIdx]).toUpperCase().replace(/\s+/g, "");
      }

      const cleanVrmUpper = vrm.trim().toUpperCase();
      const isVrmPlaceholder = !cleanVrmUpper ||
        cleanVrmUpper === "-" ||
        cleanVrmUpper === "—" ||
        cleanVrmUpper === "PENDING" ||
        cleanVrmUpper === "N/A" ||
        cleanVrmUpper === "NA" ||
        cleanVrmUpper === "UNKNOWN" ||
        cleanVrmUpper === "NULL" ||
        cleanVrmUpper === "UNDEFINED";

      const parsedVrm = isVrmPlaceholder ? undefined : vrm;

      if (validFromIdx !== -1 && row[validFromIdx] !== undefined) {
        const rawFromStr = String(row[validFromIdx] || "").trim();
        const range = parseDateRange(rawFromStr);
        if (range && range.startISO) {
          validFrom = range.startISO;
          if (!validTo && range.endISO) validTo = range.endISO;
        } else {
          validFrom = cleanVoucherDate(row[validFromIdx]);
        }
      }

      if (!validFrom) {
        for (let c = 0; c < row.length; c++) {
          if (c === voucherIdx || c === vrmIdx) continue;
          const cellVal = row[c];
          if (cellVal !== undefined && cellVal !== null) {
            const rawCellStr = String(cellVal || "").trim();
            const range = parseDateRange(rawCellStr);
            if (range && range.startISO) {
              validFrom = range.startISO;
              if (!validTo && range.endISO) validTo = range.endISO;
              break;
            }
            const parsedDate = cleanVoucherDate(cellVal);
            if (parsedDate && /^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
              validFrom = parsedDate;
              break;
            }
          }
        }
      }

      if (validToIdx !== -1 && row[validToIdx] !== undefined) {
        validTo = cleanVoucherDate(row[validToIdx]);
      }
      
      result.push({
        vrm: parsedVrm,
        code: upperCode,
        status: status || "active",
        isUsed: isUsed !== undefined ? isUsed : false,
        validFrom: validFrom || defaultDate,
        validTo: validTo || undefined,
        valid_from: validFrom || defaultDate,
        valid_to: validTo || undefined,
        uploadDate: defaultDate
      });
    }
    
    return result;
  } catch (e) {
    console.error("Error parsing voucher file", e);
    return [];
  }
}

export function addDaysSafe(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return "";
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(Date.UTC(year, month, day));
  d.setUTCDate(d.getUTCDate() + days);
  const rYear = d.getUTCFullYear();
  const rMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const rDay = String(d.getUTCDate()).padStart(2, '0');
  return `${rYear}-${rMonth}-${rDay}`;
}

export function parseDateRange(dateStr: string): { startISO: string; endISO: string } | null {
  if (!dateStr) return null;
  const s = dateStr.trim();

  const rangeRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(?:to|and|\-|through|\s)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i;
  const match = s.match(rangeRegex);
  if (match) {
    const startISO = parseDateToISO(match[1]);
    const endISO = parseDateToISO(match[2]);
    if (startISO && endISO) {
      return { startISO, endISO };
    }
  }

  const singleISO = parseDateToISO(s);
  if (singleISO && /^\d{4}-\d{2}-\d{2}$/.test(singleISO)) {
    return { startISO: singleISO, endISO: singleISO };
  }

  return null;
}

export function getDatesInRange(startISO: string, endISO: string): string[] {
  const dates: string[] = [];
  let current = startISO;
  let count = 0;
  while (current <= endISO && count < 366) {
    dates.push(current);
    current = addDaysSafe(current, 1);
    count++;
  }
  return dates;
}

export function detectDateFormat(rawText: string): "US" | "UK" {
  if (!rawText) return "UK";
  
  const dateRegex = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
  let maxFirst = 0;
  let maxSecond = 0;
  
  let match;
  while ((match = dateRegex.exec(rawText)) !== null) {
    const first = parseInt(match[1], 10);
    const second = parseInt(match[2], 10);
    if (first > maxFirst) maxFirst = first;
    if (second > maxSecond) maxSecond = second;
  }
  
  if (maxFirst > 12 && maxSecond <= 12) {
    return "UK";
  }
  if (maxSecond > 12 && maxFirst <= 12) {
    return "US";
  }
  
  const hasMsFormsHeaders = rawText.toLowerCase().includes("start time") && rawText.toLowerCase().includes("completion time");
  if (hasMsFormsHeaders) {
    return "US";
  }

  return "UK";
}

/**
 * Get matching permits by target date prioritization using resolvePermitDate
 */
export function getMatchingPermits(database: CsvPermitRecord[], activeDateStr: string): CsvPermitRecord[] {
  if (!database || database.length === 0 || !activeDateStr) {
    return [];
  }

  const activeFromISO = parseDateToISO(activeDateStr);
  if (!activeFromISO) return [];

  return database.filter((record) => {
    return resolvePermitDate(record) === activeFromISO;
  });
}

/**
 * Extracts raw voucher/QR code string from any known permit record property variation.
 */
export function extractRecordVoucherCode(record: any): string {
  if (!record) return "";
  const raw = record.voucherCode ??
              record.prePaidCode ??
              record.qrCode ??
              record.voucherCodesText ??
              record.serialNumber ??
              record.voucher ??
              record.code ??
              record["Voucher Code"] ??
              record["VOUCHER CODE"] ??
              record["Pre-Paid Code"] ??
              record["Pre Paid Code"] ??
              record["QR Code"] ??
              record["QR CODE"] ??
              "";
  if (typeof raw !== "string") {
    if (raw === null || raw === undefined) return "";
    return String(raw);
  }
  return raw;
}

export function isVoucherAvailableStatus(v: ParsedVoucherData | undefined | null): boolean {
  if (!v || !v.code) return false;
  const cleanCode = cleanVoucherCodeValue(v.code).toUpperCase();
  if (!cleanCode || cleanCode === "-" || cleanCode === "CANCELLED") return false;
  const status = String(v.status || "").toLowerCase();
  if (v.isUsed === true || status === "used" || status === "assigned" || status === "sent" || status === "completed") {
    return false;
  }
  return true;
}

export function isVoucherVrmCompatible(vVrm: string | undefined | null, cleanVrm: string): boolean {
  if (!vVrm) return true;
  const vVrmClean = String(vVrm).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isUnrestricted = !vVrmClean ||
    ["-", "—", "PENDING", "N/A", "NA", "UNKNOWN", "NULL", "UNDEFINED"].includes(vVrmClean);
  if (isUnrestricted) return true;
  return cleanVrm !== "" && vVrmClean === cleanVrm;
}

/**
 * Resolves the Excel/requested permit date D from a permit record in ISO format (YYYY-MM-DD).
 * Uses dateRequired / validFrom (or date range start), falling back to other record dates if missing.
 */
export function getRequestedPermitDateISO(record?: any, fallbackDateStr?: string): string {
  if (!record) {
    return fallbackDateStr ? (parseDateToISO(fallbackDateStr) || "") : "";
  }
  const rawDate = record.dateRequired ||
                  record.validFrom ||
                  record.valid_from ||
                  record["Date Required"] ||
                  record["DATE REQUIRED"] ||
                  record["Valid From"] ||
                  record["VALID FROM"];

  if (rawDate) {
    const range = parseDateRange(String(rawDate));
    if (range && range.startISO) {
      return range.startISO;
    }
    const iso = parseDateToISO(String(rawDate));
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return iso;
    }
  }

  if (fallbackDateStr) {
    const fbIso = parseDateToISO(fallbackDateStr);
    if (fbIso && /^\d{4}-\d{2}-\d{2}$/.test(fbIso)) {
      return fbIso;
    }
  }

  const secondaryDate = record.startTime || record.completionTime || record.todayDate || record.createdAt || record.processingDate;
  if (secondaryDate) {
    const iso = parseDateToISO(String(secondaryDate));
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return iso;
    }
  }

  return "";
}

/**
 * Shared helper for strict exact-period voucher eligibility comparison.
 * For a requested permit date D (ISO YYYY-MM-DD), a CSV voucher is eligible
 * IF AND ONLY IF:
 *   voucher.validFrom === D AND voucher.validTo === addDays(D, 6).
 *
 * Rules:
 * - Does NOT use date-range containment (validFrom <= D <= validTo).
 * - Does NOT match on validFrom alone.
 * - Does NOT fall back to vouchers from other validity periods.
 */
export function isVoucherExactPeriodEligible(
  voucher: ParsedVoucherData | undefined | null,
  requestedDateStr: string
): boolean {
  if (!voucher || !voucher.code || !requestedDateStr) return false;
  const dIso = parseDateToISO(requestedDateStr);
  if (!dIso || !/^\d{4}-\d{2}-\d{2}$/.test(dIso)) return false;

  const rawFrom = voucher.validFrom || voucher.valid_from || voucher.ValidFrom || voucher.startDate || voucher.start_date;
  const rawTo = voucher.validTo || voucher.valid_to || voucher.ValidTo || voucher.expires || voucher.expiryDate || voucher.endDate || voucher.end_date;

  const vFromIso = rawFrom ? parseDateToISO(String(rawFrom)) : "";
  const vToIso = rawTo ? parseDateToISO(String(rawTo)) : "";
  const expectedToIso = addDays(dIso, 6);

  return Boolean(vFromIso && vToIso && vFromIso === dIso && vToIso === expectedToIso);
}

/**
 * Replicates the Spreadsheet Permits Matching Helper's exact two-pass logic
 * (explicit codes on records, then auto-assigned next-available codes) and returns
 * the canonical Map of recordKey to assigned code (or "CANCELLED" / "-").
 *
 * Voucher allocation strictly uses the Excel/requested permit date (D), not processingDate.
 * A CSV voucher is eligible only when voucher.validFrom === D AND voucher.validTo === addDays(D, 6).
 */
export function getSpreadsheetMatchingAllocationsMap(
  matchingPermits: any[] = [],
  database: CsvPermitRecord[] = [],
  processingDate: string = "",
  vouchersDatabase: ParsedVoucherData[] = [],
  customVouchersMap?: Record<string, string>
): Map<string, string> {
  const map = new Map<string, string>();
  const activeFromISO = parseDateToISO(processingDate);

  const targetPermits = (matchingPermits && matchingPermits.length > 0)
    ? matchingPermits
    : (activeFromISO ? getMatchingPermits(database, activeFromISO) : database);

  if (!targetPermits || targetPermits.length === 0) return map;

  const sortedMatchingPermits = [...targetPermits].sort((a, b) => {
    const aId = Number(String(a.formId ?? a.id ?? 0).replace(/[^0-9]/g, "")) || 0;
    const bId = Number(String(b.formId ?? b.id ?? 0).replace(/[^0-9]/g, "")) || 0;
    return aId - bId;
  });

  const effectiveDatabase = database.length > 0 ? database : sortedMatchingPermits;
  const internalAssignedSet = new Set<string>();

  // Pass 1: Register records that already have a specific valid code or custom override
  sortedMatchingPermits.forEach((r, idx) => {
    const recordKey = String(r.formId ?? r.id ?? idx);
    const reqDate = getRequestedPermitDateISO(r, processingDate);
    if (isRecordCancelled(r, reqDate || processingDate, effectiveDatabase)) {
      map.set(recordKey, "CANCELLED");
      return;
    }

    const rawCode = extractRecordVoucherCode(r);
    const rawCodeUpper = rawCode ? String(rawCode).trim().toUpperCase() : "";
    if (rawCodeUpper === "CANCELLED") {
      map.set(recordKey, "CANCELLED");
      return;
    }
    if (rawCode && rawCode !== "-" && rawCodeUpper !== "CANCELLED") {
      const clean = cleanVoucherCodeValue(String(rawCode)).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED") {
        map.set(recordKey, clean);
        internalAssignedSet.add(clean);
        return;
      }
    }

    // Check custom vouchers map override if record doesn't have an explicit code
    if (customVouchersMap) {
      const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const rDateIso = reqDate;
      const keyWithDate = rDateIso ? `${rVrm}_${rDateIso}` : rVrm;
      const customOverride = customVouchersMap[keyWithDate] ||
                             customVouchersMap[rVrm] ||
                             (r.id ? customVouchersMap[r.id] : undefined) ||
                             (r.formId ? customVouchersMap[String(r.formId)] : undefined);

      if (customOverride && customOverride !== "-" && customOverride.toUpperCase() !== "CANCELLED") {
        const clean = String(customOverride).trim().split(/[\n,;\s]+/)[0]?.trim().toUpperCase();
        if (clean && clean !== "-" && clean !== "CANCELLED") {
          map.set(recordKey, clean);
          internalAssignedSet.add(clean);
          return;
        }
      }
    }
  });

  // Pass 2: Auto-assign next available active date code for unblocked records that lack a code.
  // CRITICAL RULE: Voucher allocation must use the Excel/requested permit date (D), not processingDate.
  // For requested date D, a CSV voucher is eligible ONLY when voucher.validFrom === D AND voucher.validTo === addDays(D, 6).
  // Do not use date-range containment. Do not match on validFrom alone. Do not fall back to vouchers from other validity periods.
  sortedMatchingPermits.forEach((r, idx) => {
    const recordKey = String(r.formId ?? r.id ?? idx);
    if (map.has(recordKey)) return;

    const reqDateD = getRequestedPermitDateISO(r, processingDate);
    if (isRecordCancelled(r, reqDateD || processingDate, effectiveDatabase)) {
      map.set(recordKey, "CANCELLED");
      return;
    }

    const rawCode = extractRecordVoucherCode(r);
    const rawCodeUpper = rawCode ? String(rawCode).trim().toUpperCase() : "";
    if (rawCodeUpper === "CANCELLED") {
      map.set(recordKey, "CANCELLED");
      return;
    }

    if (!reqDateD) {
      map.set(recordKey, "-");
      return;
    }

    // Filter available vouchers eligible for this EXACT requested permit date D
    const eligibleVouchers = (vouchersDatabase || []).filter(v => {
      if (!isVoucherAvailableStatus(v)) return false;
      const cleanCode = cleanVoucherCodeValue(v.code).toUpperCase();
      if (internalAssignedSet.has(cleanCode)) return false;
      return isVoucherExactPeriodEligible(v, reqDateD);
    });

    const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    let nextCode = "";

    // 1. Try exact VRM match among eligible vouchers for requested date D
    if (rVrm) {
      const vrmMatch = eligibleVouchers.find(v => {
        const vVrm = (v.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        return vVrm && vVrm === rVrm;
      });
      if (vrmMatch && vrmMatch.code) {
        nextCode = cleanVoucherCodeValue(vrmMatch.code).toUpperCase();
      }
    }

    // 2. Try generic/unrestricted VRM voucher among eligible vouchers for requested date D
    if (!nextCode) {
      const genericMatch = eligibleVouchers.find(v => isVoucherVrmCompatible(v.vrm, rVrm));
      if (genericMatch && genericMatch.code) {
        nextCode = cleanVoucherCodeValue(genericMatch.code).toUpperCase();
      }
    }

    // 3. Set assigned code or '-' (NO fallback to other dates/periods!)
    if (nextCode && nextCode !== "-" && nextCode !== "CANCELLED") {
      map.set(recordKey, nextCode);
      internalAssignedSet.add(nextCode);
    } else {
      map.set(recordKey, "-");
    }
  });

  return map;
}

/**
 * Replicates the Spreadsheet Permits Matching Helper's exact two-pass logic
 * (explicit codes on records, then auto-assigned next-available codes) and returns
 * the Set of codes considered assigned for a given processing date.
 */
export function getSpreadsheetMatchingAssignedCodes(
  matchingPermits: any[] = [],
  database: CsvPermitRecord[] = [],
  processingDate: string = "",
  vouchersDatabase: ParsedVoucherData[] = []
): Set<string> {
  const assignedCodes = new Set<string>();
  const allocationsMap = getSpreadsheetMatchingAllocationsMap(
    matchingPermits,
    database,
    processingDate,
    vouchersDatabase
  );

  allocationsMap.forEach((code) => {
    if (code && code !== "-" && code !== "CANCELLED") {
      const clean = cleanVoucherCodeValue(code).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED") {
        assignedCodes.add(clean);
      }
    }
  });

  return assignedCodes;
}

/**
 * Filter vouchers to only unused codes matching a target ISO date.
 * Excludes codes assigned to OTHER active driver records in the database
 * or in the Spreadsheet Permits Matching Helper using the canonical allocations engine.
 *
 * Enforces strict exact-period rule: voucher.validFrom === D AND voucher.validTo === addDays(D, 6).
 */
export function getUnusedVouchersForDate(
  vouchersDatabase: ParsedVoucherData[],
  database: CsvPermitRecord[] = [],
  targetIsoDate: string,
  currentVrm?: string,
  currentRecord?: any,
  spreadsheetMatches?: any[]
): ParsedVoucherData[] {
  if (!vouchersDatabase || vouchersDatabase.length === 0 || !targetIsoDate) {
    return [];
  }

  const targetISO = parseDateToISO(targetIsoDate);
  if (!targetISO) return [];

  const currentId = String(currentRecord?.id ?? "").trim();
  const currentFormId = String(currentRecord?.formId ?? "").trim();
  const currentVrmClean = (currentVrm || currentRecord?.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const currentRecordCode = cleanVoucherCodeValue(
    extractRecordVoucherCode(currentRecord) || currentRecord?.qrOverride || ""
  ).toUpperCase();

  // 1. Get matching records for target ISO
  const targetPermits = (spreadsheetMatches && spreadsheetMatches.length > 0)
    ? spreadsheetMatches
    : getMatchingPermits(database, targetISO);

  // 2. Canonical allocations map for the date
  const allocationsMap = getSpreadsheetMatchingAllocationsMap(
    targetPermits,
    database,
    targetISO,
    vouchersDatabase
  );

  // 3. Build Set of voucher codes assigned to OTHER active driver records
  const assignedToOtherSet = new Set<string>();

  targetPermits.forEach((permit, idx) => {
    const pId = String(permit.id ?? "").trim();
    const pFormId = String(permit.formId ?? "").trim();
    const pVrmClean = (permit.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Skip current active record
    const isCurrent = Boolean(
      (currentId && (pId === currentId || pFormId === currentId)) ||
      (currentFormId && (pId === currentFormId || pFormId === currentFormId)) ||
      (currentVrmClean && pVrmClean && currentVrmClean === pVrmClean && (!currentId && !currentFormId))
    );
    if (isCurrent) return;

    const permitReqDate = getRequestedPermitDateISO(permit, targetISO);
    if (isRecordCancelled(permit, permitReqDate || targetISO, database)) return;

    const recordKey = String(permit.formId ?? permit.id ?? idx);
    const allocatedCode = allocationsMap.get(recordKey);
    if (allocatedCode && allocatedCode !== "-" && allocatedCode !== "CANCELLED") {
      const clean = cleanVoucherCodeValue(allocatedCode).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED") {
        assignedToOtherSet.add(clean);
      }
    }
  });

  // If the current record itself has an assigned code, ensure it is NOT blocked in assignedToOtherSet
  if (currentRecordCode && currentRecordCode !== "-" && currentRecordCode !== "CANCELLED") {
    assignedToOtherSet.delete(currentRecordCode);
  }

  // Filter vouchers eligible for target ISO date D:
  // Must satisfy exact-period rule: voucher.validFrom === D AND voucher.validTo === addDays(D, 6)
  const eligibleVouchersForDate = vouchersDatabase.filter(v => {
    if (!v) return false;
    return isVoucherExactPeriodEligible(v, targetISO);
  });

  const seenCodes = new Set<string>();
  const activeUnassignedCodes: ParsedVoucherData[] = [];

  for (const voucher of eligibleVouchersForDate) {
    const rawCode = voucher.code || voucher.voucherCode || voucher.qrCode || voucher.serialNumber || voucher.prePaidCode;
    if (!rawCode) continue;

    const codeUpper = cleanVoucherCodeValue(rawCode).toUpperCase();
    if (!codeUpper || codeUpper === "-" || codeUpper === "CANCELLED") continue;

    // Exclude if assigned to another active driver record
    if (assignedToOtherSet.has(codeUpper)) {
      continue;
    }

    let isMatchedToOtherAssigned = false;
    for (const assigned of assignedToOtherSet) {
      if (isVoucherCodeMatch(assigned, codeUpper)) {
        isMatchedToOtherAssigned = true;
        break;
      }
    }
    if (isMatchedToOtherAssigned) {
      continue;
    }

    // Exclude if voucher status is used
    if (!isVoucherAvailableStatus(voucher)) {
      continue;
    }

    // VRM check if voucher has specific VRM
    if (!isVoucherVrmCompatible(voucher.vrm, currentVrmClean)) {
      continue;
    }

    if (!seenCodes.has(codeUpper)) {
      seenCodes.add(codeUpper);
      activeUnassignedCodes.push({
        ...voucher,
        code: codeUpper
      });
    }
  }

  return activeUnassignedCodes;
}

export interface PermitRecord {
  id?: string;
  formId?: string | number;
  vrm?: string;
  driverName?: string;
  name?: string;
  email?: string;
  driverEmail?: string;
  phone?: string;
  hospital?: string;
  ward?: string;
  status?: string;
  isDispatched?: boolean;
  dispatchedAt?: string;
  validFrom?: string;
  validTo?: string;
  expires?: string;
  dateRequired?: string;
  dateExpiry?: string;
  isCancelled?: boolean;
  voucherCode?: string;
  prePaidCode?: string;
  qrCode?: string;
  serialNumber?: string;
  voucherCodesText?: string;
  voucher?: string;
  code?: string;
  startTime?: string;
  createdAt?: string;
  created_at?: string;
  completionTime?: string;
  todayDate?: string;
  processingDate?: string;
  submissionDate?: string;
  department?: string;
  title?: string;
  site?: string;
  qrOverride?: string;
  emailType?: "SEND_CONCESSION" | "RESEND_CONCESSION" | string;
  isResend?: boolean;
  emailTemplate?: "new" | "replacement";
  hasOriginalVoucher?: boolean;
  [key: string]: any;
}

export const getRecordStatus = (
  record: PermitRecord,
  _processingDateStr: string,
  dispatchedIdsSet: Set<string> = new Set()
): '✓ Sent' | 'Pending' | 'Expired' | 'Cancelled' | '-' => {
  if (record.status === 'Cancelled' || record.isCancelled) return 'Cancelled';

  const formId = record.formId || record.id || "";
  const cleanFormId = formId ? String(formId).replace(/[^0-9]/g, "") : "";
  const cleanVrm = (record.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const isConfirmedDispatched =
    (record.id && dispatchedIdsSet.has(record.id)) ||
    (cleanFormId && dispatchedIdsSet.has(cleanFormId)) ||
    (cleanVrm && dispatchedIdsSet.has(cleanVrm)) ||
    (record.isDispatched === true && Boolean(record.dispatchedAt));

  if (isConfirmedDispatched) return '✓ Sent';
  return 'Pending';
};

export function findDuplicateCodes(database: CsvPermitRecord[]): string[] {
  const codeMap = new Map<string, string[]>();
  database.forEach(record => {
    const rawVal = record.voucherCode || record.prePaidCode;
    if (rawVal && rawVal !== "-" && rawVal !== "CANCELLED") {
      const lines = rawVal.split(/[\n,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      lines.forEach(code => {
        if (!code || code === "-" || code === "CANCELLED") return;
        if (!codeMap.has(code)) {
          codeMap.set(code, []);
        }
        codeMap.get(code)!.push(record.id || String(record.formId) || "");
      });
    }
  });

  return Array.from(codeMap.entries())
    .filter(([_code, records]) => records.length > 1)
    .map(([code]) => code);
}

export function parseFullDateTimeMs(str?: string, fallbackIsoDate?: string): number | null {
  if (!str) return null;
  const s = String(str).trim();
  if (!s || s === "-" || s === "null" || s === "undefined") return null;

  // 1. ISO 8601 with T (e.g. 2026-08-21T15:14:24)
  if (s.includes("T")) {
    const parsedISO = Date.parse(s);
    if (!isNaN(parsedISO)) return parsedISO;
  }

  // 2. Extract time components (HH:MM:SS or HH:MM with optional AM/PM)
  const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?/i);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let hasTime = false;

  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10) || 0;
    minutes = parseInt(timeMatch[2], 10) || 0;
    seconds = timeMatch[3] ? (parseInt(timeMatch[3], 10) || 0) : 0;
    const ampm = timeMatch[4];
    if (ampm) {
      if (/PM/i.test(ampm) && hours < 12) hours += 12;
      if (/AM/i.test(ampm) && hours === 12) hours = 0;
    }
    hasTime = true;
  }

  // 3. Resolve the date component
  const parsedDateISO = parseDateToISO(s);
  const resolvedFallbackISO = fallbackIsoDate ? parseDateToISO(fallbackIsoDate) : "";
  const isoDate = (parsedDateISO && /^\d{4}-\d{2}-\d{2}$/.test(parsedDateISO))
    ? parsedDateISO
    : (resolvedFallbackISO && /^\d{4}-\d{2}-\d{2}$/.test(resolvedFallbackISO))
      ? resolvedFallbackISO
      : "";

  if (isoDate) {
    const dateParts = isoDate.split("-").map(Number);
    if (dateParts.length === 3) {
      const [y, m, d] = dateParts;
      return new Date(y, m - 1, d, hours, minutes, seconds).getTime();
    }
  }

  // 4. If time matched but no date was available, return milliseconds from baseline date 2000-01-01
  if (hasTime) {
    return new Date(2000, 0, 1, hours, minutes, seconds).getTime();
  }

  // 5. Fallback using native Date
  const dateObj = new Date(s);
  if (!isNaN(dateObj.getTime()) && dateObj.getTime() > 0) {
    return dateObj.getTime();
  }

  return null;
}

// ============================================================================
// HELPER FUNCTIONS FOR checkIsBlockedDuplicate
// ============================================================================

/**
 * Helper: Extract numeric Form ID from a record
 */
export function extractRecordNumericFormId(record: any): number {
  if (!record) return 0;
  const raw = record.formId !== undefined && record.formId !== null && record.formId !== ""
    ? record.formId
    : (record.id !== undefined && record.id !== null && record.id !== "" ? record.id : undefined);

  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number" && !isNaN(raw)) return raw;

  const str = String(raw).trim();
  const digits = str.replace(/\D/g, "");
  if (digits) {
    const parsed = parseInt(digits, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * Helper: Extract submission timestamp (in epoch milliseconds) from a record.
 * Prioritizes actual submission time strings, falling back to base dates.
 */
export function extractRecordSubmissionTimeMs(record: any, fallbackDateStr?: string): number {
  if (!record) return 0;

  // Resolve base date from record itself if available
  const recDateRaw = record.dateRequired || record.validFrom || record.todayDate || fallbackDateStr || "";
  const recDateISO = recDateRaw ? (parseDateToISO(recDateRaw) || "") : "";

  const timestampFields = [
    record.startTime,
    record.start_time,
    record.submissionTime,
    record.submission_time,
    record.submittedAt,
    record.submitted_at,
    record.completionTime,
    record.completion_time,
    record.createdAt,
    record.created_at
  ];

  for (const field of timestampFields) {
    if (field !== undefined && field !== null) {
      const s = String(field).trim();
      if (!s || s === "-" || s === "null" || s === "undefined") continue;
      
      const ms = parseFullDateTimeMs(s, recDateISO);
      if (ms !== null && ms > 0) return ms;

      const dateObj = new Date(s);
      if (!isNaN(dateObj.getTime()) && dateObj.getTime() > 0) {
        return dateObj.getTime();
      }
    }
  }

  return 0;
}

/**
 * Helper: Check if two records refer to the exact same submission
 */
export function isSamePermitRecord(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const idA = extractRecordNumericFormId(a);
  const idB = extractRecordNumericFormId(b);
  if (idA > 0 && idB > 0 && idA === idB) return true;

  const rawIdA = String(a.formId ?? a.id ?? "").trim();
  const rawIdB = String(b.formId ?? b.id ?? "").trim();
  if (rawIdA && rawIdB && rawIdA !== "-" && rawIdA === rawIdB) return true;

  // If both records carry a confident, distinct explicit identity (numeric Form ID
  // or raw id), that is definitive: they are different submissions. Do NOT fall
  // through to the fuzzy VRM/timestamp heuristic below, which can otherwise treat
  // two different people's (or the same person's two different) submissions as
  // "the same record" purely because their VRM matches and their computed
  // timestamps happen to coincide (e.g. both truncate to midnight when a time
  // component is missing) - a false positive that also corrupts dataset-index
  // lookups and chronological-precedence checks used for duplicate blocking.
  const hasDistinctExplicitIds = (idA > 0 && idB > 0) || (rawIdA && rawIdB && rawIdA !== "-" && rawIdB !== "-");
  if (hasDistinctExplicitIds) return false;

  const vrmA = (a.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const vrmB = (b.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (vrmA && vrmB && vrmA === vrmB) {
    const timeA = extractRecordSubmissionTimeMs(a);
    const timeB = extractRecordSubmissionTimeMs(b);
    if (timeA > 0 && timeB > 0 && timeA === timeB) return true;

    const nameA = (a.driverName || a.name || "").trim().toLowerCase();
    const nameB = (b.driverName || b.name || "").trim().toLowerCase();
    const dateA = parseDateToISO(a.dateRequired || a.validFrom || "");
    const dateB = parseDateToISO(b.dateRequired || b.validFrom || "");
    if (nameA && nameB && nameA === nameB && dateA && dateB && dateA === dateB && timeA === timeB) {
      return true;
    }
  }

  return false;
}

/**
 * Helper: Find the array position of a record within the dataset.
 */
export function getRecordDatasetIndex(
  record: any,
  database: CsvPermitRecord[],
  formIdRecord?: number,
  rawIdRecord?: string
): number {
  if (!database || database.length === 0) return -1;
  let idx = database.indexOf(record);
  if (idx !== -1) return idx;

  const numId = formIdRecord ?? extractRecordNumericFormId(record);
  const rawId = rawIdRecord ?? String(record.formId ?? record.id ?? "").trim();

  idx = database.findIndex(r => {
    if (isSamePermitRecord(r, record)) return true;
    const formIdR = extractRecordNumericFormId(r);
    if (numId > 0 && formIdR > 0 && numId === formIdR) return true;
    const rawIdR = String(r.formId ?? r.id ?? "").trim();
    if (rawId && rawIdR && rawId !== "-" && rawId === rawIdR) return true;
    return false;
  });

  return idx;
}

/**
 * Determines whether candidate is STRICTLY EARLIER in submission order than target.
 *
 * Precedence hierarchy:
 * 1. Both have valid timestamps and they differ -> earlier timestamp wins.
 * 2. Both have valid numeric Form IDs and they differ -> lower Form ID integer wins.
 * 3. Fallback to appearance order in database -> lower index wins.
 */
export function isRecordStrictlyEarlier(
  candidate: any,
  target: any,
  database?: CsvPermitRecord[]
): boolean {
  if (!candidate || !target) return false;
  if (isSamePermitRecord(candidate, target)) return false;

  // Resolve full records from database if available
  let cand = candidate;
  let targ = target;
  if (database && database.length > 0) {
    const numCand = extractRecordNumericFormId(candidate);
    const matchedCand = database.find(r => isSamePermitRecord(r, candidate) || (numCand > 0 && extractRecordNumericFormId(r) === numCand));
    if (matchedCand) cand = { ...matchedCand, ...candidate };

    const numTarg = extractRecordNumericFormId(target);
    const matchedTarg = database.find(r => isSamePermitRecord(r, target) || (numTarg > 0 && extractRecordNumericFormId(r) === numTarg));
    if (matchedTarg) targ = { ...matchedTarg, ...target };
  }

  // Priority 1: Compare Timestamps (Highest Priority)
  const timeCandidate = extractRecordSubmissionTimeMs(cand);
  const timeTarget = extractRecordSubmissionTimeMs(targ);

  if (timeCandidate > 0 && timeTarget > 0 && timeCandidate !== timeTarget) {
    return timeCandidate < timeTarget;
  }

  // Priority 2: Compare Form IDs (Numerically)
  const formIdCandidate = extractRecordNumericFormId(cand);
  const formIdTarget = extractRecordNumericFormId(targ);

  if (formIdCandidate > 0 && formIdTarget > 0 && formIdCandidate !== formIdTarget) {
    return formIdCandidate < formIdTarget;
  }

  // If one has timestamp and they have distinct form IDs
  if (timeCandidate > 0 && timeTarget === 0 && formIdCandidate > 0 && formIdTarget > 0) {
    return formIdCandidate < formIdTarget;
  }
  if (timeTarget > 0 && timeCandidate === 0 && formIdCandidate > 0 && formIdTarget > 0) {
    return formIdCandidate < formIdTarget;
  }

  // Priority 3: Fallback to Dataset Index (Array Position)
  if (database && database.length > 0) {
    const idxCandidate = getRecordDatasetIndex(cand, database, formIdCandidate);
    const idxTarget = getRecordDatasetIndex(targ, database, formIdTarget);

    if (idxCandidate !== -1 && idxTarget !== -1 && idxCandidate !== idxTarget) {
      const isDesc = database.length >= 2 && extractRecordNumericFormId(database[0]) > extractRecordNumericFormId(database[database.length - 1]);
      if (isDesc) {
        return idxCandidate > idxTarget; // in descending sorted arrays, higher index is earlier
      }
      return idxCandidate < idxTarget;
    }
  }

  return false;
}

/**
 * Helper: Compare records in strict chronological submission timestamp and Form ID order
 * EARLIER submission comes FIRST (lower timestamp or lower Form ID integer).
 */
export function compareRecordsBySubmissionOrder(a: any, b: any, fallbackDateStr?: string): number {
  if (isSamePermitRecord(a, b)) return 0;
  if (isRecordStrictlyEarlier(a, b)) return -1;
  if (isRecordStrictlyEarlier(b, a)) return 1;
  return 0;
}

/**
 * Determines whether a given permit application record is a blocked duplicate.
 * STRICT CHRONOLOGICAL SUBMISSION ORDER RULES:
 * 1. A record can ONLY be blocked by records that are STRICTLY EARLIER than it.
 * 2. Strict Precedence Order (PRIORITIZES TIMESTAMP OVER FORM ID):
 *    a. Compare timestamps (createdAt/submissionTime) - HIGHEST PRIORITY
 *    b. If timestamps tie/missing, compare Form IDs numerically
 *    c. If Form IDs tie/missing, compare array position
 * 3. Self-matching is EXCLUDED (record cannot block itself).
 * 4. Records with the SAME VRM within 0-6 days are evaluated.
 * 5. If ANY strictly earlier valid record exists within 0-6 days, record is BLOCKED.
 */
export function checkIsBlockedDuplicate(
  record: { vrm?: string; validFrom?: string; dateRequired?: string; id?: string | number; formId?: string | number; voucherCode?: string; createdAt?: string; startTime?: string; driverName?: string },
  database: CsvPermitRecord[],
  refDateISO?: string
): boolean {
  // --- EARLY EXITS ---
  if (!record) return false;
  if (!record.vrm) return false;
  
  const cleanVrm = record.vrm.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleanVrm || cleanVrm === "PENDING" || cleanVrm === "-") return false;
  
  if (!database || database.length === 0) {
    return false;
  }

  // Resolve full record from database if needed
  const numId = extractRecordNumericFormId(record);
  const matchedDbRecord = database.find(r => isSamePermitRecord(r, record) || (numId > 0 && extractRecordNumericFormId(r) === numId));
  const fullRecord = matchedDbRecord ? { ...matchedDbRecord, ...record } : record;

  // Find all records with matching VRM
  const vrmRecords = database.filter(r => {
    const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return rVrm === cleanVrm;
  });

  if (vrmRecords.length <= 1) {
    return false;
  }

  // Find records that are STRICTLY EARLIER than current record
  const strictlyEarlierRecords: CsvPermitRecord[] = [];

  for (const other of vrmRecords) {
    if (isRecordStrictlyEarlier(other, fullRecord, database)) {
      strictlyEarlierRecords.push(other);
    }
  }

  // If no strictly earlier records, this is the original submission → NOT BLOCKED
  if (strictlyEarlierRecords.length === 0) {
    return false;
  }

  // Get current record's required date
  const reqIsoX = parseDateToISO(fullRecord.dateRequired || fullRecord.validFrom || "") || 
                  parseDateToISO(fullRecord.startTime || fullRecord.createdAt || "") || 
                  refDateISO || getTodayISO();
  const reqTimeMsX = new Date(reqIsoX + "T00:00:00").getTime();

  // Check each strictly earlier record: is it within the 0-6 day block window?
  for (const earlier of strictlyEarlierRecords) {
    // Skip records that are cancelled for their OWN reason (date-invalid, or an
    // explicit manual override) - a cancelled original shouldn't block a later
    // resubmission. This is recomputed dynamically from the record's actual
    // required date rather than trusting a stored "CANCELLED" marker, since that
    // marker may itself simply mean "this record was blocked as a duplicate" -
    // which should NOT disqualify it from blocking a still-later duplicate.
    const earlierDateRequired = earlier.dateRequired || earlier.validFrom || "";
    const earlierIsDateCancelled = isDateRequiredOutsideValidWindow(earlierDateRequired, refDateISO) ||
                                    earlier.isCancelled === true;
    if (earlierIsDateCancelled) continue;

    // Get earlier record's required date
    const earlierReqIso = parseDateToISO(earlier.dateRequired || earlier.validFrom || "") || 
                          parseDateToISO(earlier.startTime || earlier.createdAt || "") || 
                          refDateISO || getTodayISO();
    const earlierReqTimeMs = new Date(earlierReqIso + "T00:00:00").getTime();

    // Calculate days difference: current request date minus earlier request date
    const diffDays = Math.round((reqTimeMsX - earlierReqTimeMs) / (1000 * 60 * 60 * 24));

    // If within 0-6 days (inclusive), the current record is a BLOCKED duplicate
    if (diffDays >= 0 && diffDays < 7) {
      return true;
    }
  }

  return false;
}

function simpleStringHash(str: string): number {
  let hash = 0;
  if (!str || str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

/**
 * Canonical single source of truth for cancellation logic across all components and algorithms.
 * Evaluates:
 * 1. Explicit cancellation flags (record.isCancelled === true)
 * 2. Date window validity (isDateRequiredOutsideValidWindow)
 * 3. Duplicate blocking within 0-6 days window (checkIsBlockedDuplicate)
 * 4. Stored or explicit voucher "CANCELLED" string values
 */
export function isRecordCancelled(
  record: any,
  todayDateOrReference?: string,
  database?: CsvPermitRecord[]
): boolean {
  if (!record) return false;

  // 1. Explicit boolean cancellation override
  if (record.isCancelled === true) return true;

  // 2. Date window validity
  const referenceDate = todayDateOrReference || record.todayDate || record.processingDate || "";
  const dateRequired = record.dateRequired || record.validFrom || "";
  if (isDateRequiredOutsideValidWindow(dateRequired, referenceDate)) {
    return true;
  }

  // 3. Duplicate blocking check if database context is available
  if (database && database.length > 0) {
    if (checkIsBlockedDuplicate(record, database, referenceDate)) {
      return true;
    }
  }

  // 4. Stored/assigned voucher code cancellation
  const rawCode = record.voucherCode || record.prePaidCode || record.qrCode || record.voucherCodesText || record.qrOverride;
  if (typeof rawCode === "string" && rawCode.trim().toUpperCase() === "CANCELLED") {
    return true;
  }

  return false;
}

/**
 * Resolves the primary processing/active date from a permit record or data object in standard ISO format (YYYY-MM-DD),
 * prioritizing processingDate -> submissionDate -> todayDate -> startTime -> completionTime -> validFrom -> dateRequired -> today.
 */
export function resolvePermitDate(record?: any): string {
  if (!record) return getTodayISO();
  const rawDate = record.processingDate ||
                  record.submissionDate ||
                  record.todayDate ||
                  record.startTime ||
                  record.completionTime ||
                  record.validFrom ||
                  record.dateRequired ||
                  record.createdAt;

  if (rawDate) {
    const range = parseDateRange(String(rawDate));
    if (range && range.startISO) {
      return range.startISO;
    }
    const iso = parseDateToISO(rawDate);
    if (iso) return iso;
  }
  return getTodayISO();
}

