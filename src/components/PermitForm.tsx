import React, { useState, useMemo } from "react";
import { PermitData, HOSPITAL_SITES } from "../types";
import { 
  CsvPermitRecord, 
  parseDateToISO, 
  addDays, 
  ParsedVoucherData, 
  getMatchingPermits, 
  getUnusedVouchersForDate, 
  getSpreadsheetMatchingAssignedCodes, 
  checkIsBlockedDuplicate, 
  resolvePermitDate,
  getRequestedPermitDateISO
} from "../utils/csvParser";
import { 
  Building2, 
  User, 
  Car, 
  Calendar, 
  Network, 
  CreditCard,
  Phone,
  Mail,
  Key,
  Ticket,
  ChevronDown
} from "lucide-react";

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

interface PermitFormProps {
  data: PermitData;
  database: CsvPermitRecord[];
  vouchersDatabase?: ParsedVoucherData[];
  dispatchedKeys?: string[];
  unsentKeys?: string[];
  dispatchBy?: {[key: string]: string};
  onChange: (updates: Partial<PermitData>) => void;
  onClear?: () => void;
}

export function PermitForm({ 
  data, 
  database, 
  vouchersDatabase = [], 
  dispatchedKeys = [], 
  unsentKeys = [],
  dispatchBy = {},
  onChange
}: PermitFormProps) {
  // Distinct wards for the dropdown
  const availableWards = useMemo(() => {
    const set = new Set<string>();
    database.forEach(r => {
      if (r.ward) set.add(toTitleCase(r.ward));
    });
    if (set.size === 0) {
      return ["Acorn Ward", "Mulberry Ward", "ICU", "Larch Antenatal Ward", "Antenatal Ward", "CDS", "Birth Centre", "Acacia Ward", "Larch Postnatal Ward"];
    }
    return Array.from(set);
  }, [database]);

  // Matching permits for the active date
  const matchingPermits = useMemo(() => {
    return getMatchingPermits(database, resolvePermitDate(data));
  }, [data, database]);

  // Unused vouchers computation
  const unusedVouchersForDay = useMemo<ParsedVoucherData[]>(() => {
    const targetIso = getRequestedPermitDateISO(data, resolvePermitDate(data));
    if (!targetIso) return [];

    return getUnusedVouchersForDate(
      vouchersDatabase, 
      database, 
      targetIso, 
      data.vrm, 
      data, 
      matchingPermits
    );
  }, [
    vouchersDatabase, 
    database, 
    matchingPermits,
    data
  ]);

  const isBlockedDuplicate = useMemo(() => {
    return checkIsBlockedDuplicate(data, database || [], data.todayDate);
  }, [data, database, data.todayDate]);

  const dateWarning = useMemo(() => {
    if (data.validFrom && data.validTo) {
      return new Date(data.validTo) < new Date(data.validFrom);
    }
    return false;
  }, [data.validFrom, data.validTo]);

  // handleSelectMatchingPermit
  const handleSelectMatchingPermit = (record: CsvPermitRecord) => {
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
      dateRequired: record.dateRequired || data.todayDate,
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

  const formattedProcessingDate = data.todayDate ? formatDate(data.todayDate) : "07/07/2026";
  const formattedValidFrom = data.validFrom ? formatDate(data.validFrom) : formattedProcessingDate;
  const formattedValidTo = data.validTo ? formatDate(data.validTo) : (data.todayDate ? formatDate(addDays(data.todayDate, 6)) : "13/07/2026");

  // Common class strings for inputs and selects: 12px, font-weight: 400 (regular, not bold), compact styling
  const inputClass = "w-full h-8 bg-[#041320] border border-[rgba(113,163,255,0.18)] text-white text-[12px] font-normal rounded-md px-2.5 py-1 focus:outline-none focus:border-[#1677FF] focus:ring-1 focus:ring-[#1677FF]/30 transition placeholder:text-[12px] placeholder:font-normal placeholder:text-[#B7D4FF]/40";
  const selectClass = "w-full h-8 bg-[#041320] border border-[rgba(113,163,255,0.18)] text-white text-[12px] font-normal rounded-md px-2.5 py-1 appearance-none pr-7 focus:outline-none focus:border-[#1677FF] focus:ring-1 focus:ring-[#1677FF]/30 transition cursor-pointer";

  return (
    <section className="w-full h-full bg-gradient-to-b from-[#061524] to-[#081B31] border border-[rgba(133,189,255,0.15)] rounded-xl p-3 md:p-3.5 shadow-xl text-white flex flex-col gap-2.5">
      
      {/* 1. Section Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[rgba(113,163,255,0.15)]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#1677FF]/15 border border-[#1677FF]/30 flex items-center justify-center text-[#1677FF] shadow-sm">
            <User className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-[14px] font-medium text-white tracking-tight leading-none">
              Configure Permit &amp; Driver Details
            </h2>
          </div>
        </div>
      </div>

      {/* 2. Form Layout - Row 1 (4 columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Card Main Title */}
        <div className="flex flex-col">
          <label htmlFor="cardTitle" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <CreditCard className="w-3 h-3 text-[#1677FF]" />
            <span>Card Main Title</span>
          </label>
          <input
            id="cardTitle"
            type="text"
            value={data.title || "Patient & Visitor Concessions"}
            onChange={e => onChange({ title: e.target.value })}
            className={inputClass}
            placeholder="Patient & Visitor Concessions"
          />
        </div>

        {/* Processing Date */}
        <div className="flex flex-col">
          <label htmlFor="processingDate" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Calendar className="w-3 h-3 text-[#1677FF]" />
            <span>Processing Date</span>
          </label>
          <div className="relative">
            <input
              id="processingDate"
              type="date"
              value={data.todayDate || ""}
              onChange={e => onChange({ todayDate: e.target.value })}
              onClick={e => { try { e.currentTarget.showPicker(); } catch {} }}
              className={`${inputClass} cursor-pointer`}
            />
          </div>
        </div>

        {/* Valid From */}
        <div className="flex flex-col">
          <label htmlFor="validFrom" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Calendar className="w-3 h-3 text-[#1677FF]" />
            <span>Valid From</span>
          </label>
          <input
            id="validFrom"
            type="text"
            readOnly
            value={formattedValidFrom}
            className={`${inputClass} opacity-90 focus:outline-none`}
          />
        </div>

        {/* Valid To */}
        <div className="flex flex-col">
          <label htmlFor="validTo" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Calendar className="w-3 h-3 text-[#1677FF]" />
            <span>Valid To</span>
          </label>
          <input
            id="validTo"
            type="text"
            readOnly
            value={formattedValidTo}
            className={`${inputClass} opacity-90 focus:outline-none ${
              dateWarning ? "border-rose-500 text-rose-300" : ""
            }`}
          />
        </div>
      </div>

      {dateWarning && (
        <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/50 text-rose-300 text-[11px] flex items-center gap-2">
          <span>⚠ Warning: Expiry date is set before the valid start date.</span>
        </div>
      )}

      {/* 3. Form Layout - Row 2 (4 columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Hospital Site */}
        <div className="flex flex-col">
          <label htmlFor="hospitalSelect" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Building2 className="w-3 h-3 text-[#1677FF]" />
            <span>Hospital Site</span>
          </label>
          <div className="relative">
            <select
              id="hospitalSelect"
              value={data.site || "Whipps Cross Hospital"}
              onChange={e => onChange({ site: e.target.value })}
              className={selectClass}
            >
              <option value="" className="bg-[#041320] text-white text-[12px] font-normal">— Select Site —</option>
              {HOSPITAL_SITES.map(site => (
                <option key={site} value={site} className="bg-[#041320] text-white text-[12px] font-normal">{site}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-[#B7D4FF] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Ward / Department */}
        <div className="flex flex-col">
          <label htmlFor="wardSelect" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Network className="w-3 h-3 text-[#1677FF]" />
            <span>Ward / Department</span>
          </label>
          <div className="relative">
            <select
              id="wardSelect"
              value={data.ward || "Acorn Ward"}
              onChange={e => onChange({ ward: e.target.value })}
              className={selectClass}
            >
              <option value="" className="bg-[#041320] text-white text-[12px] font-normal">— Select Ward —</option>
              {availableWards.map(w => (
                <option key={w} value={w} className="bg-[#041320] text-white text-[12px] font-normal">{w}</option>
              ))}
              {data.ward && !availableWards.includes(data.ward) && (
                <option value={data.ward} className="bg-[#041320] text-white text-[12px] font-normal">{data.ward}</option>
              )}
            </select>
            <ChevronDown className="w-3 h-3 text-[#B7D4FF] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Driver's Name */}
        <div className="flex flex-col">
          <label htmlFor="driverName" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <User className="w-3 h-3 text-[#1677FF]" />
            <span>Driver's Name</span>
          </label>
          <input
            id="driverName"
            type="text"
            value={data.name || ""}
            onChange={e => onChange({ name: e.target.value })}
            placeholder="e.g. Sherry Moran"
            className={inputClass}
          />
        </div>

        {/* VRM / Number Plate */}
        <div className="flex flex-col">
          <label htmlFor="vrm" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Car className="w-3 h-3 text-[#1677FF]" />
            <span>VRM / Number Plate</span>
          </label>
          <input
            id="vrm"
            type="text"
            value={data.vrm || ""}
            onChange={e => onChange({ vrm: e.target.value.toUpperCase() })}
            placeholder="E.G. FN15VKS"
            className={`${inputClass} uppercase`}
          />
          {(!data.vrm || data.vrm.trim() === "") && (
            <span className="text-amber-400/90 text-[10px] mt-0.5 font-normal select-none">
              Awaiting plate number input
            </span>
          )}
        </div>
      </div>

      {/* 4. Form Layout - Row 3 (4 columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Phone Number */}
        <div className="flex flex-col">
          <label htmlFor="phoneNumber" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Phone className="w-3 h-3 text-[#1677FF]" />
            <span>Phone Number</span>
          </label>
          <input
            id="phoneNumber"
            type="text"
            value={data.phone || ""}
            onChange={e => onChange({ phone: e.target.value })}
            placeholder="e.g. 07700 900077"
            className={inputClass}
          />
        </div>

        {/* Email Address */}
        <div className="flex flex-col">
          <label htmlFor="emailAddress" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Mail className="w-3 h-3 text-[#1677FF]" />
            <span>Email Address</span>
          </label>
          <input
            id="emailAddress"
            type="email"
            value={data.email || ""}
            onChange={e => onChange({ email: e.target.value.toLowerCase() })}
            placeholder="driver@example.com"
            className={inputClass}
          />
        </div>

        {/* Voucher Code */}
        <div className="flex flex-col">
          <label htmlFor="voucherManual" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Key className="w-3 h-3 text-[#1677FF]" />
            <span>Voucher Code</span>
          </label>
          <input
            id="voucherManual"
            type="text"
            value={isBlockedDuplicate ? "CANCELLED" : (data.voucherCodesText || "")}
            onChange={e => onChange({ voucherCodesText: e.target.value.toUpperCase(), status: "Pending" })}
            placeholder="E.G. OXHM4NQUTHSID"
            disabled={isBlockedDuplicate}
            className={`${inputClass} uppercase disabled:opacity-50`}
          />
        </div>

        {/* Unused Codes */}
        <div className="flex flex-col">
          <label htmlFor="unusedCodesSelect" className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#B7D4FF] flex items-center gap-1.5 mb-1">
            <Ticket className="w-3 h-3 text-[#1677FF]" />
            <span>Unused Codes</span>
          </label>
          <div className="relative">
            <select
              id="unusedCodesSelect"
              value={unusedVouchersForDay.some(v => v.code === data.voucherCodesText) ? data.voucherCodesText : ""}
              onChange={e => {
                if (e.target.value) {
                  onChange({
                    voucherCodesText: e.target.value,
                    status: "Pending"
                  });
                }
              }}
              disabled={!unusedVouchersForDay.length}
              className={selectClass}
            >
              <option value="" className="bg-[#041320] text-white text-[12px] font-normal">
                {unusedVouchersForDay.length === 0 ? "— Choose (0) —" : `— Choose (${unusedVouchersForDay.length}) —`}
              </option>
              {unusedVouchersForDay.map((voucher, idx) => (
                <option
                  key={`${voucher.code}-${idx}`}
                  value={voucher.code}
                  className="bg-[#041320] text-white text-[12px] font-mono"
                >
                  {voucher.code}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-[#B7D4FF] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

    </section>
  );
}
