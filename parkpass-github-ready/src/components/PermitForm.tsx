import React, { useState, useMemo } from "react";
import { PermitData, HOSPITAL_SITES } from "../types";
import { CsvPermitRecord, parseDateToISO, parseDateRange, addDays, addDaysSafe, ParsedVoucherData, isVoucherCodeMatch, getMatchingPermits, getUnusedVouchersForDate, getSpreadsheetMatchingAssignedCodes, cleanVoucherCodeValue, checkIsBlockedDuplicate, getTodayISO, resolvePermitDate } from "../utils/csvParser";
import { getRecordKeys, checkIsRecordDispatched } from "../utils/dispatchUtils";
import { PermitMatchingTable } from "./PermitMatchingTable";
import { isCancelled } from "./PermitCard";

// Helper to format string to Title Case (capitalize each word)
function toTitleCase(str: string): string {
  if (!str || str === "-") return str;
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

// Helper to format date to UK standard DD/MM/YYYY
function formatDate(d: string): string {
  if (!d) return "";
  const iso = parseDateToISO(d);
  if (!iso) return d;
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

// Helper to normalize any date input (string, Date, ISO timestamp, DD/MM/YYYY) to standard YYYY-MM-DD
function normalizeDateStr(val: any): string {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return val.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  if (!s || s === "-" || s === "—" || s === "N/A" || s === "NA") return "";

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // If ISO with time (e.g. 2026-08-20T00:00:00.000Z)
  if (s.includes("T")) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // Check parseDateToISO
  const iso = parseDateToISO(s);
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;

  // Attempt standard Date constructor
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return "";
}
import { 
  Building2, 
  User, 
  Car, 
  Calendar, 
  Network, 
  QrCode, 
  Hash, 
  Heading,
  Phone,
  Mail,
  RotateCcw,
  ListFilter,
  CheckCircle2,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface PermitFormProps {
  data: PermitData;
  database: CsvPermitRecord[];
  vouchersDatabase?: ParsedVoucherData[];
  dispatchedKeys?: string[];
  unsentKeys?: string[];
  dispatchBy?: {[key: string]: string};
  onChange: (updates: Partial<PermitData>) => void;
  onClear: () => void;
}

export function PermitForm({ 
  data, 
  database, 
  vouchersDatabase = [], 
  dispatchedKeys = [], 
  unsentKeys = [],
  dispatchBy = {},
  onChange, 
  onClear 
}: PermitFormProps) {
  const [showMatchingList, setShowMatchingList] = useState(false);

  // Helper to parse voucher codes
  const parsedCodes = useMemo(() => {
    if (!data.voucherCodesText) return [];
    return data.voucherCodesText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.length > 4 && /[A-Z0-9]{4,}/i.test(line));
  }, [data.voucherCodesText]);

  const matchedRecord = useMemo(() => {
    if (!data.vrm && !data.name) return null;
    const cleanVrm = data.vrm ? data.vrm.toUpperCase().replace(/\s+/g, "") : "";
    return database.find(r => 
      (cleanVrm && r.vrm.toUpperCase().replace(/\s+/g, "") === cleanVrm) || 
      (data.name && r.driverName.toLowerCase() === data.name.toLowerCase())
    );
  }, [data.vrm, data.name, database]);

  // Helper functions for robust date comparison
  const parseToTimestamp = (dateStr: string | undefined): number | null => {
    if (!dateStr) return null;
    const str = String(dateStr).trim();
    if (!str) return null;

    // Handle UK DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (with optional trailing time/text)
    const ukMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (ukMatch) {
      const d = Number(ukMatch[1]);
      const m = Number(ukMatch[2]);
      const y = Number(ukMatch[3]);
      return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
    }
    // Handle ISO YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (isoMatch) {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).setHours(0, 0, 0, 0);
  };

  const isDateInRange = (targetDate: string | undefined, startDate?: string, endDate?: string): boolean => {
    if (!targetDate) return false;
    const targetISO = normalizeDateStr(targetDate) || parseDateToISO(targetDate);
    const startISO = normalizeDateStr(startDate) || parseDateToISO(startDate || '');
    const endISO = normalizeDateStr(endDate) || parseDateToISO(endDate || '') || startISO;

    if (targetISO && startISO && endISO) {
      return targetISO >= startISO && targetISO <= endISO;
    }

    const targetTs = parseToTimestamp(targetDate);
    const startTs = parseToTimestamp(startDate);
    const endTs = parseToTimestamp(endDate) || startTs;

    if (!targetTs || !startTs) return false;
    return targetTs >= startTs && targetTs <= endTs;
  };

  const isDateMatching = (voucherDate: string, validToDate: string, selectedDate: string): boolean => {
    return isDateInRange(selectedDate, voucherDate, validToDate);
  };

  // ============================================
  // LOGIC: Match records based on "Date the parking is required on" (parkingStartISO)
  //        matching the active processing date, while ensuring the request
  //        was actually submitted (formFillISO) on or before that processing date.
  // ============================================
  const matchingPermits = useMemo(() => {
    return getMatchingPermits(database, resolvePermitDate(data));
  }, [data, database]);

  // =========================================================================
  // 1. unusedVouchersForDay: Filters vouchers to only unused codes matching the target ISO date
  // =========================================================================
  const unusedVouchersForDay = useMemo<ParsedVoucherData[]>(() => {
    const permitDate = data.validFrom || (data as any).dateRequired || (data as any).processingDate || data.todayDate || "";
    const targetIso = parseDateToISO(permitDate);
    if (!targetIso) return [];

    const processingDate = resolvePermitDate(data);
    const spreadsheetAssignedCodes = getSpreadsheetMatchingAssignedCodes(
      matchingPermits,
      database,
      processingDate,
      vouchersDatabase
    );

    const availableVouchers = getUnusedVouchersForDate(vouchersDatabase, database, targetIso, data.vrm, data, matchingPermits);
    return availableVouchers.filter(v => {
      const vIso = parseDateToISO(v.validFrom || v.valid_from || (v as any).dateRequired || (v as any).date || "");
      if (vIso !== targetIso) return false;
      const codeUpper = (v.code || "").trim().toUpperCase();
      return !spreadsheetAssignedCodes.has(codeUpper);
    });
  }, [
    vouchersDatabase, 
    database, 
    matchingPermits,
    data
  ]);

  const daysActive = useMemo(() => {
    const validFromISO = parseDateToISO(data.validFrom || (data as any).dateRequired || "");
    const refDateISO = parseDateToISO(data.todayDate) || getTodayISO();
    if (!validFromISO) return 0;
    const diff = Math.round((new Date(refDateISO).getTime() - new Date(validFromISO).getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  }, [data.validFrom, (data as any).dateRequired, data.todayDate]);

  const isBlockedDuplicate = useMemo(() => {
    return checkIsBlockedDuplicate(data as any, database || [], data.todayDate);
  }, [data, database, data.todayDate]);

  const dateWarning = useMemo(() => {
    if (data.validFrom && data.validTo) {
      return new Date(data.validTo) < new Date(data.validFrom);
    }
    return false;
  }, [data.validFrom, data.validTo]);

  const isDateBackdated = (dateStr: string): boolean => {
    const reqISO = parseDateToISO(dateStr);
    if (!reqISO) return false;
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return reqISO < todayISO;
  };

  const formatDateDisplay = (dateStr) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
  };

  // ============================================
  // handleSelectMatchingPermit - uses dateRequired for Valid From
  // ============================================
  const handleSelectMatchingPermit = (record: CsvPermitRecord) => {
    // Use dateRequired (when they want to park) for validFrom
    const fromISO = parseDateToISO(record.dateRequired);
    const toISO = addDays(fromISO, 6);
    
    onChange({
      ...data,
      id: record.id,
      formId: record.formId || record.id,
      site: record.hospital || data.site,
      name: record.driverName ? toTitleCase(record.driverName) : (data.name || ""),
      vrm: record.vrm ? record.vrm.toUpperCase() : (data.vrm || ""),
      ward: record.ward ? toTitleCase(record.ward) : (data.ward || ""),
      validFrom: fromISO || data.validFrom,
      validTo: toISO || data.validTo,
      todayDate: data.todayDate,
      dateRequired: record.dateRequired || (record as any).dateRequired || data.todayDate,
      phone: record.phone || "",
      email: (record.email || "").toLowerCase(),
      voucherCodesText: record.voucherCode || "-",
      startTime: record.startTime,
      createdAt: record.createdAt,
      isResend: false,
      emailType: "SEND_CONCESSION",
      emailTemplate: "new"
    });
  };

  return (
    <section className="form-panel">
      <div className="form-panel-head">
        <div className="step-title"><span className="step-badge">Step 1</span><h2>Configure Permit &amp; Driver Details</h2></div>
        <button type="button" onClick={onClear} className="clear-form"><RotateCcw /> Clear Form</button>
      </div>

      <div className="form-grid-top">
        <div className="form-group-block">
          <label>Card Main Title</label>
          <input value={data.title} readOnly disabled />
          <label className="field-spacer">Hospital Site</label>
          <select value={data.site} disabled><option value="">— Select Site —</option>{HOSPITAL_SITES.map(site => <option key={site} value={site}>{site}</option>)}</select>
        </div>
        <div className="form-group-block date-block">
          <label>Processing Date</label>
          <div className="date-control">
            <input type="date" value={data.todayDate || ""} onChange={e => onChange({ todayDate: e.target.value })} onClick={e => { try { e.currentTarget.showPicker(); } catch {} }} />
          </div>
        </div>
        <div className="form-group-block">
          <label>Valid From</label>
          <input type="date" value={data.validFrom || ""} disabled readOnly />
        </div>
        <div className="form-group-block">
          <label>Valid To</label>
          <input type="date" value={data.validTo || ""} disabled readOnly className={dateWarning ? "date-error" : ""} />
        </div>
      </div>

      {dateWarning && <div className="form-warning">⚠ Expiry date is set before the valid start date.</div>}

      <div className="form-section-grid">
        <div className="form-section">
          <h3>Driver Contact Info</h3>
          <div className="field-stack">
            <label>Driver's Name<input value={data.name} disabled readOnly placeholder="e.g. Fiona Gallagher" /></label>
            <label>Phone Number<input value={data.phone || ""} disabled readOnly placeholder="e.g. 07700 900077" /></label>
          </div>
        </div>
        <div className="form-section">
          <h3>Vehicle &amp; Location</h3>
          <div className="field-stack">
            <label>VRM / Number Plate<input value={data.vrm} disabled readOnly placeholder="e.g. LD68 UTX" /></label>
            {(!data.vrm || data.vrm.trim() === "") && <div className="vrm-warning">Awaiting plate number input</div>}
            <label>Ward / Department<input value={data.ward} disabled readOnly placeholder="e.g. Administration" /></label>
          </div>
        </div>
      </div>

      <div className="form-bottom-grid">
        <div className="voucher-section">
          <div className="section-label-row voucher-heading-row">
            <h3>Pre-Paid Voucher Code</h3>
            <div className="voucher-meta"><span>Unused codes: {unusedVouchersForDay.length}</span><span>Day</span><select aria-label="Voucher day" value="All"><option value="All">All</option></select></div>
          </div>
          <div className="voucher-controls">
            <select value="" onChange={e => { if (e.target.value) onChange({ voucherCodesText: e.target.value, status: "Pending", emailType: "RESEND_CONCESSION", isResend: true, emailTemplate: "replacement" }); }} disabled={!unusedVouchersForDay.length}>
              <option value="">— Choose ({unusedVouchersForDay.length}) —</option>
              {unusedVouchersForDay.map((v, i) => <option key={`${v.code}-${i}`} value={v.code}>{v.code}</option>)}
            </select>
            <input className="voucher-manual-input" value={isBlockedDuplicate ? "CANCELLED" : (data.voucherCodesText || "")} onChange={e => onChange({ voucherCodesText: e.target.value, status: "Pending" })} disabled={isBlockedDuplicate} placeholder="e.g. CON9012JXM" aria-label="Manual voucher code" />
          </div>
          <button type="button" className="queue-toggle" onClick={() => setShowMatchingList(!showMatchingList)}>{showMatchingList ? "▼ Hide Queue Details" : "▶ Show Queue Details"}</button>
        </div>
        <div className="mini-field">
          <label>Permit Type<select value="Patient & Visitor Concessions" onChange={() => {}}><option>Patient &amp; Visitor Concessions</option></select></label>
        </div>
        <div className="mini-field">
          <label>Hospital<select value={data.site} disabled><option>{data.site || "Whipps Cross Hospital"}</option></select></label>
        </div>
        <div className="mini-field">
          <label>Department<select value={data.ward} disabled><option>{data.ward || "—"}</option></select></label>
        </div>
      </div>

      {showMatchingList && (() => {
        const activeDateStr = data.todayDate || getTodayISO();
        const activeFromISO = parseDateToISO(activeDateStr);
        const hasAnyDatedVouchers = (vouchersDatabase || []).some(v => v.validFrom || v.validTo);
        return <PermitMatchingTable matchingPermits={matchingPermits} processingDate={data.todayDate} vouchersDatabase={vouchersDatabase} dispatchedKeys={dispatchedKeys} unsentKeys={unsentKeys} dispatchBy={dispatchBy} database={database} onSelectRecord={handleSelectMatchingPermit} />;
      })()}
    </section>
  );

}