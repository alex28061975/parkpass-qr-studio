import React, { useMemo, useState } from "react";
import { 
  ChevronDown, 
  Mail, 
  Send, 
  Archive, 
  Zap, 
  XSquare, 
  Calendar, 
  Building2, 
  Database, 
  CheckCircle2, 
  Lock, 
  RefreshCw,
  Download,
  QrCode,
  Search,
  X
} from "lucide-react";
import { 
  CsvPermitRecord, 
  ParsedVoucherData, 
  parseDateToISO, 
  addDays, 
  getSpreadsheetMatchingAllocationsMap, 
  isDateRequiredOutsideValidWindow, 
  checkIsBlockedDuplicate,
  exportToExcel,
  isRecordCancelled,
  sortRecordsBySubmissionTimeDesc
} from "../utils/csvParser";
import { checkIsRecordDispatched, getRecordKeys } from "../utils/dispatchUtils";

interface DispatchCentreProps {
  database: CsvPermitRecord[];
  vouchersDatabase: ParsedVoucherData[];
  dispatchedKeys: string[];
  unsentKeys?: string[];
  dispatchDates?: Record<string, string>;
  processingDate: string;
  formData?: {
    todayDate?: string;
    validFrom?: string;
    validTo?: string;
    ward?: string;
    hospitalSite?: string;
    [key: string]: any;
  };
  totalRecordsCount?: number;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSelectRecord: (record: CsvPermitRecord) => void;
  onSendRecord?: (record: CsvPermitRecord) => Promise<void> | void;
  onUnsendRecord?: (record: CsvPermitRecord) => Promise<void> | void;
  onBulkEmail?: () => void;
  onClear?: () => void;
  onChangeFormData?: (updates: any) => void;
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) return "-";
  const iso = parseDateToISO(dateStr);
  if (!iso) return dateStr;
  const parts = iso.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

export type SortKey = 
  | "id" 
  | "qr" 
  | "driverName" 
  | "vrm" 
  | "voucherCode" 
  | "validFrom" 
  | "validTo" 
  | "ward" 
  | "hospital" 
  | "status" 
  | "actions";

export type SortDirection = "asc" | "desc" | null;

export function DispatchCentre({ 
  database, 
  vouchersDatabase, 
  dispatchedKeys, 
  unsentKeys = [], 
  processingDate, 
  formData,
  totalRecordsCount,
  searchQuery: searchQueryProp,
  onSearchQueryChange,
  onSelectRecord, 
  onSendRecord, 
  onUnsendRecord, 
  onBulkEmail,
  onClear,
  onChangeFormData
}: DispatchCentreProps) {
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const isControlled = searchQueryProp !== undefined;
  const searchQuery = isControlled ? searchQueryProp : internalSearchQuery;
  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setInternalSearchQuery(val);
    }
  };

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [wardDropdownOpen, setWardDropdownOpen] = useState(false);

  // Sorting state (Excel-like sorting: asc -> desc -> reset)
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Base records: always shows all records (sorted by newest submission time / createdAt descending)
  const baseRecords = useMemo(() => {
    return sortRecordsBySubmissionTimeDesc(database);
  }, [database]);

  // Compute dynamic voucher allocations map matching Matching Helper exactly
  const recordCodeMap = useMemo(() => {
    return getSpreadsheetMatchingAllocationsMap(
      baseRecords,
      database,
      processingDate,
      vouchersDatabase
    );
  }, [baseRecords, database, processingDate, vouchersDatabase]);

  // Sorted records based on active column sort
  const sortedRecords = useMemo(() => {
    if (!sortKey || !sortDirection) {
      return baseRecords;
    }

    const getHospital = (record: CsvPermitRecord) => {
      return record.hospital || 
        (record.ward && (
          record.ward.toLowerCase().includes("acorn") || 
          record.ward.toLowerCase().includes("acacia") || 
          record.ward.toLowerCase().includes("mulberry")
        ) ? "Whipps Cross Hospital" : "Newham Hospital");
    };

    const getIsCancelled = (record: CsvPermitRecord, idx: number) => {
      const recordKey = String(record.formId ?? record.id ?? idx);
      const displayCode = recordCodeMap.get(recordKey);
      return isRecordCancelled(record, processingDate, database) || displayCode === "CANCELLED";
    };

    const getStatusStr = (record: CsvPermitRecord, idx: number) => {
      const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
      const rowKey = String(record.formId ?? record.id ?? record.vrm ?? idx);
      const recordKeys = getRecordKeys(record);
      const isUnsent = Boolean(unsentKeys && unsentKeys.length > 0 && (unsentKeys.includes(rowKey) || recordKeys.some(k => unsentKeys.includes(k))));
      if (isDispatched) return "SENT";
      if (isUnsent) return "UNSENT";
      return "PENDING";
    };

    const sorted = [...baseRecords].sort((a, b) => {
      let comparison = 0;
      const aIdx = baseRecords.indexOf(a);
      const bIdx = baseRecords.indexOf(b);

      switch (sortKey) {
        case "id": {
          const aId = Number(String(a.formId ?? a.id ?? aIdx + 1).replace(/[^0-9]/g, "")) || (aIdx + 1);
          const bId = Number(String(b.formId ?? b.id ?? bIdx + 1).replace(/[^0-9]/g, "")) || (bIdx + 1);
          comparison = aId - bId;
          break;
        }
        case "qr": {
          const aCanc = getIsCancelled(a, aIdx);
          const bCanc = getIsCancelled(b, bIdx);
          const aVal = aCanc ? "CANCELLED" : "QR Code";
          const bVal = bCanc ? "CANCELLED" : "QR Code";
          comparison = aVal.localeCompare(bVal);
          break;
        }
        case "driverName": {
          const aName = (a.driverName || "").trim();
          const bName = (b.driverName || "").trim();
          comparison = aName.localeCompare(bName, undefined, { sensitivity: "base", numeric: true });
          break;
        }
        case "vrm": {
          const aVrm = (a.vrm || "").trim().toUpperCase();
          const bVrm = (b.vrm || "").trim().toUpperCase();
          comparison = aVrm.localeCompare(bVrm, undefined, { sensitivity: "base", numeric: true });
          break;
        }
        case "voucherCode": {
          const aCanc = getIsCancelled(a, aIdx);
          const bCanc = getIsCancelled(b, bIdx);
          const aCode = aCanc ? "CANCELLED" : (recordCodeMap.get(String(a.formId ?? a.id ?? aIdx)) || a.voucherCode || "");
          const bCode = bCanc ? "CANCELLED" : (recordCodeMap.get(String(b.formId ?? b.id ?? bIdx)) || b.voucherCode || "");
          comparison = aCode.localeCompare(bCode, undefined, { sensitivity: "base", numeric: true });
          break;
        }
        case "validFrom": {
          const aDate = parseDateToISO(a.dateRequired || a.validFrom) || "";
          const bDate = parseDateToISO(b.dateRequired || b.validFrom) || "";
          comparison = aDate.localeCompare(bDate);
          break;
        }
        case "validTo": {
          const aIso = parseDateToISO(a.dateRequired || a.validFrom);
          const bIso = parseDateToISO(b.dateRequired || b.validFrom);
          const aExp = aIso ? addDays(aIso, 6) : "";
          const bExp = bIso ? addDays(bIso, 6) : "";
          comparison = aExp.localeCompare(bExp);
          break;
        }
        case "ward": {
          const aWard = (a.ward || "").trim();
          const bWard = (b.ward || "").trim();
          comparison = aWard.localeCompare(bWard, undefined, { sensitivity: "base", numeric: true });
          break;
        }
        case "hospital": {
          const aHosp = getHospital(a);
          const bHosp = getHospital(b);
          comparison = aHosp.localeCompare(bHosp, undefined, { sensitivity: "base", numeric: true });
          break;
        }
        case "status": {
          const aStatus = getStatusStr(a, aIdx);
          const bStatus = getStatusStr(b, bIdx);
          comparison = aStatus.localeCompare(bStatus);
          break;
        }
        case "actions": {
          const aDisp = checkIsRecordDispatched(a, a.vrm, a.driverName, a.dateRequired, dispatchedKeys, unsentKeys);
          const bDisp = checkIsRecordDispatched(b, b.vrm, b.driverName, b.dateRequired, dispatchedKeys, unsentKeys);
          const aAct = aDisp ? "Unsend" : "Send";
          const bAct = bDisp ? "Unsend" : "Send";
          comparison = aAct.localeCompare(bAct);
          break;
        }
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [baseRecords, sortKey, sortDirection, database, processingDate, recordCodeMap, dispatchedKeys, unsentKeys]);

  const filteredRecords = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) return sortedRecords;
    const q = searchQuery.trim().toLowerCase();
    return sortedRecords.filter(r => {
      const cleanFormId = String(r.formId ?? r.id ?? "");
      return (
        cleanFormId.toLowerCase().includes(q) ||
        (r.driverName || "").toLowerCase().includes(q) ||
        (r.vrm || "").toLowerCase().includes(q) ||
        (r.hospital || "").toLowerCase().includes(q) ||
        (r.ward || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        (r.voucherCode || "").toLowerCase().includes(q)
      );
    });
  }, [sortedRecords, searchQuery]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortKey(null);
        setSortDirection(null);
      } else {
        setSortDirection("asc");
      }
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey === key) {
      return (
        <span className="inline-flex items-center ml-1 text-[#38bdf8] font-bold text-[11px] animate-pulse">
          {sortDirection === "asc" ? "▲" : "▼"}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center ml-1 text-slate-500/40 group-hover:text-slate-300 text-[9px] transition-colors">
        ▲▼
      </span>
    );
  };

  const count = filteredRecords.length;
  const totalDbCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : (database.length || 889);
  const totalVouchersCount = vouchersDatabase.length > 0 ? vouchersDatabase.length : 174;

  const validFromDisplay = formData?.validFrom || processingDate || "07/07/2026";
  const validToDisplay = formData?.validTo || (processingDate ? addDays(processingDate, 6) : "13/07/2026");
  const selectedWard = formData?.ward || "Acorn Ward";

  // List of distinct wards in database for filter/dropdown
  const availableWards = useMemo(() => {
    const set = new Set<string>();
    database.forEach(r => {
      if (r.ward) set.add(r.ward);
    });
    if (set.size === 0) {
      return ["Acorn Ward", "Mulberry Ward", "ICU", "LARCH ANTENATAL WARD", "ANTENATAL WARD", "CDS", "birth centre", "Acacia ward", "LARCH POSTNATAL WARD"];
    }
    return Array.from(set);
  }, [database]);

  const handleAction = async (record: CsvPermitRecord, sent: boolean) => {
    const key = String(record.formId ?? record.id ?? record.vrm);
    setBusyKey(key);
    try {
      if (sent) await onUnsendRecord?.(record);
      else await onSendRecord?.(record);
    } finally {
      setBusyKey(null);
    }
  };

  const handleExportZip = () => {
    exportToExcel(sortedRecords, "Concessions_Permits_Export.xlsx");
  };

  return (
    <section className="w-full bg-[#07172b] border border-[#183a5e] rounded-2xl p-4 md:p-6 shadow-2xl text-slate-200">
      {/* Top Header Section */}
      <div className="flex flex-col gap-3 pb-4 border-b border-[#143252]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white shrink-0">
              <Send className="w-5 h-5 -rotate-45" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Permit Dispatch Centre</h2>
              <p className="text-xs text-slate-400 font-normal mt-0.5">Select recipients and dispatch emails via Outlook</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Outlook info badge */}
            <div className="flex items-center gap-1.5 bg-[#0b2138] border border-[#1b436c] text-[#93c5fd] text-xs px-3 py-1.5 rounded-lg select-none">
              <Mail className="w-3.5 h-3.5 text-blue-400" />
              <span>Select recipients and dispatch emails via Outlook</span>
            </div>
          </div>
        </div>

        {/* Header Search Bar */}
        <div className="relative w-full">
          <div className="flex items-center w-full bg-[#041222] border border-[#1b436c] focus-within:border-[#1677FF] focus-within:ring-2 focus-within:ring-[#1677FF]/20 rounded-xl px-3.5 py-2 transition shadow-inner">
            <Search className="w-4 h-4 text-blue-400 shrink-0 mr-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by driver's name, number plate (VRM), or hospital..."
              className="w-full bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none font-normal"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="text-slate-400 hover:text-white p-1 rounded-md transition"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[11px] text-slate-400 bg-[#081f38] px-2 py-0.5 rounded border border-[#194068] hidden md:block">
              {filteredRecords.length} {filteredRecords.length === 1 ? 'match' : 'matches'}
            </div>
          )}
        </div>
      </div>

      {/* Main Table Section */}
      <div className="w-full mt-4 border border-[#163657] rounded-xl bg-[#061424] overflow-hidden shadow-inner">
        <div className="overflow-x-auto w-full">
          <table className="min-w-[1180px] w-full text-xs text-left border-collapse table-auto">
            <thead className="bg-[#081b30] border-b border-[#163657] text-slate-300 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10 select-none">
              <tr>
                {/* # Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("id")}
                  className={`py-3 px-3 text-center w-12 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "id" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Number"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>#</span>
                    {renderSortIndicator("id")}
                  </div>
                </th>

                {/* QR CODE Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("qr")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "qr" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by QR Code status"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>QR CODE</span>
                    {renderSortIndicator("qr")}
                  </div>
                </th>

                {/* DRIVER'S NAME Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("driverName")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "driverName" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Driver's Name"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>DRIVER'S NAME</span>
                    {renderSortIndicator("driverName")}
                  </div>
                </th>

                {/* VRN Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("vrm")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "vrm" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by VRN / Vehicle Reg"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VRN</span>
                    {renderSortIndicator("vrm")}
                  </div>
                </th>

                {/* VOUCHERCODE Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("voucherCode")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "voucherCode" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Voucher Code"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VOUCHERCODE</span>
                    {renderSortIndicator("voucherCode")}
                  </div>
                </th>

                {/* VALID FROM Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("validFrom")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "validFrom" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Valid From date"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VALID FROM</span>
                    {renderSortIndicator("validFrom")}
                  </div>
                </th>

                {/* VALID TO Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("validTo")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "validTo" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Valid To date"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VALID TO</span>
                    {renderSortIndicator("validTo")}
                  </div>
                </th>

                {/* WARD Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("ward")}
                  className={`py-3 px-3 border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "ward" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Ward"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>WARD</span>
                    {renderSortIndicator("ward")}
                  </div>
                </th>

                {/* HOSPITAL Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("hospital")}
                  className={`py-3 px-3.5 border-r border-[#143252]/50 whitespace-nowrap min-w-[185px] cursor-pointer transition-colors group select-none ${
                    sortKey === "hospital" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Hospital Site"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>HOSPITAL</span>
                    {renderSortIndicator("hospital")}
                  </div>
                </th>

                {/* STATUS Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("status")}
                  className={`py-3 px-3 text-center border-r border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "status" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Status"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>STATUS</span>
                    {renderSortIndicator("status")}
                  </div>
                </th>

                {/* ACTIONS Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("actions")}
                  className={`py-3 px-3 text-center whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "actions" ? "bg-[#0c2847] text-[#38bdf8] font-black" : "hover:bg-[#0b2440] hover:text-white"
                  }`}
                  title="Click to sort by Action state"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>ACTIONS</span>
                    {renderSortIndicator("actions")}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#102947]">
              {filteredRecords.map((record, index) => {
                const recordIso = parseDateToISO(record.dateRequired || record.validFrom);
                const expiresIso = recordIso ? addDays(recordIso, 6) : "";

                const isCancelledRecord = isRecordCancelled(record, processingDate, database);
                const recordKey = String(record.formId ?? record.id ?? index);
                let displayCode = recordCodeMap.get(recordKey);

                if (displayCode === undefined || displayCode === null) {
                  displayCode = isCancelledRecord ? "CANCELLED" : (record.voucherCode || "-");
                }

                const isCancelled = isCancelledRecord || displayCode === "CANCELLED";
                const rowKey = String(record.formId ?? record.id ?? record.vrm ?? index);

                const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
                const recordKeys = getRecordKeys(record);
                const isUnsent = Boolean(unsentKeys && unsentKeys.length > 0 && (unsentKeys.includes(rowKey) || recordKeys.some(k => unsentKeys.includes(k))));

                // 2. # Column: Excel ID with row number fallback
                const excelId = (() => {
                  if (record.formId !== undefined && record.formId !== null) {
                    const s = String(record.formId).trim();
                    if (s && s !== "-" && !s.startsWith("row-")) return s;
                  }
                  if (record.id !== undefined && record.id !== null) {
                    const s = String(record.id).trim();
                    if (s && s !== "-" && !s.startsWith("row-")) return s;
                  }
                  return String(index + 1);
                })();

                // Derive hospital site cleanly
                const hospitalDisplay = record.hospital || 
                  (record.ward && (
                    record.ward.toLowerCase().includes("acorn") || 
                    record.ward.toLowerCase().includes("acacia") || 
                    record.ward.toLowerCase().includes("mulberry")
                  ) ? "Whipps Cross Hospital" : "Newham Hospital");

                return (
                  <tr 
                    key={`dispatch_${rowKey}_${index}`}
                    onClick={() => onSelectRecord(record)}
                    className="hover:bg-[#0c233d]/70 transition-colors cursor-pointer text-slate-200"
                  >
                    {/* 1. # Column */}
                    <td className="py-3 px-3 text-center text-slate-400 font-mono font-medium border-r border-[#102947]/60 whitespace-nowrap">
                      {excelId}
                    </td>

                    {/* 2. QR Code Column */}
                    <td className="py-3 px-3 border-r border-[#102947]/60 whitespace-nowrap">
                      {isCancelled ? (
                        <span className="text-[#FF453A] font-semibold text-xs tracking-wider">
                          CANCELLED
                        </span>
                      ) : (
                        <button 
                          type="button" 
                          onClick={(e) => { e.stopPropagation(); onSelectRecord(record); }} 
                          className="inline-flex items-center gap-1.5 text-xs text-[#38bdf8] hover:text-[#7dd3fc] font-medium transition-colors cursor-pointer"
                          title="Open QR Permit"
                        >
                          <QrCode className="w-3.5 h-3.5 text-[#38bdf8]" />
                          <span>QR Code</span>
                        </button>
                      )}
                    </td>

                    {/* 3. Driver's Name Column */}
                    <td className="py-3 px-3 font-medium text-white border-r border-[#102947]/60 whitespace-nowrap">
                      {record.driverName || "-"}
                    </td>

                    {/* 4. VRN Column */}
                    <td className="py-3 px-3 font-mono font-medium text-white uppercase tracking-wider border-r border-[#102947]/60 whitespace-nowrap">
                      {record.vrm ? record.vrm.toUpperCase() : "-"}
                    </td>

                    {/* 5. VOUCHERCODE Column */}
                    <td className="py-3 px-3 font-mono border-r border-[#102947]/60 whitespace-nowrap">
                      {isCancelled ? (
                        <span className="text-[#FF453A] font-semibold tracking-wider">
                          CANCELLED
                        </span>
                      ) : (
                        <span className="text-slate-200">
                          {displayCode || "-"}
                        </span>
                      )}
                    </td>

                    {/* 6. VALID FROM Column */}
                    <td className="py-3 px-3 font-mono text-slate-200 border-r border-[#102947]/60 whitespace-nowrap">
                      {formatDate(record.dateRequired || record.validFrom)}
                    </td>

                    {/* 7. VALID TO Column */}
                    <td className="py-3 px-3 font-mono text-slate-200 border-r border-[#102947]/60 whitespace-nowrap">
                      {formatDate(expiresIso)}
                    </td>

                    {/* 8. WARD Column */}
                    <td className="py-3 px-3 text-slate-200 border-r border-[#102947]/60 whitespace-nowrap">
                      {record.ward || "-"}
                    </td>

                    {/* 9. HOSPITAL Column */}
                    <td className="py-3 px-3.5 text-slate-200 border-r border-[#102947]/60 whitespace-nowrap min-w-[185px]">
                      {hospitalDisplay}
                    </td>

                    {/* 10. STATUS Column (Never displays CANCELLED - only SENT, UNSENT, or PENDING) */}
                    <td className="py-3 px-3 text-center border-r border-[#102947]/60 select-none whitespace-nowrap">
                      {isDispatched ? (
                        <span className="border border-[#32D74B]/40 bg-[#32D74B]/15 text-[#32D74B] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center gap-1 whitespace-nowrap">
                          <span>✅</span>
                          <span>SENT</span>
                        </span>
                      ) : isUnsent ? (
                        <span className="border border-[#42A5F5]/40 bg-[#42A5F5]/15 text-[#42A5F5] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          UNSENT
                        </span>
                      ) : (
                        <span className="border border-[#FF9F0A]/40 bg-[#FF9F0A]/15 text-[#FF9F0A] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          PENDING
                        </span>
                      )}
                    </td>

                    {/* 11. ACTIONS Column */}
                    <td className="py-3 px-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-center rounded-md overflow-hidden shadow-xs">
                        <button 
                          type="button" 
                          disabled={busyKey === rowKey} 
                          onClick={() => handleAction(record, isDispatched)} 
                          className={`flex items-center gap-1 px-3 py-1 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap ${
                            isDispatched 
                              ? "bg-[#dc2626] hover:bg-[#b91c1c]" 
                              : "bg-[#1d75f2] hover:bg-[#1565d8]"
                          }`}
                        >
                          {busyKey === rowKey ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Mail className="w-3 h-3" />
                          )}
                          <span>{isDispatched ? "Unsend" : "Send"}</span>
                        </button>
                        <button 
                          type="button" 
                          onClick={() => onSelectRecord(record)} 
                          className={`px-1.5 py-1 text-white transition-colors cursor-pointer ${
                            isDispatched
                              ? "bg-[#b91c1c] hover:bg-[#991b1b] border-l border-[#991b1b]"
                              : "bg-[#1565d8] hover:bg-[#0f4eb0] border-l border-[#0f4eb0]"
                          }`}
                          title="Select permit record"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedRecords.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500 text-xs">
                    No matching records found for active date {formatDate(processingDate)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Controls Bar Inside Card */}
      <div className="bg-[#051322] border border-[#143252] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 mt-4 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          {/* Actions Button */}
          <div className="relative">
            <button 
              type="button"
              onClick={() => setActionsOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#071b30] hover:bg-[#0d2745] border border-[#1e436c] rounded-md text-white font-medium text-xs transition-colors shadow-xs cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span>Actions</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
            {actionsOpen && (
              <div className="absolute left-0 bottom-full mb-1 w-48 bg-[#091e34] border border-[#1d436e] rounded-lg shadow-xl py-1 z-30 text-xs">
                <button 
                  type="button" 
                  onClick={() => { setActionsOpen(false); handleExportZip(); }} 
                  className="w-full text-left px-3 py-2 text-slate-200 hover:bg-[#132e4d] flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" /> Export Excel
                </button>
                <button 
                  type="button" 
                  onClick={() => { setActionsOpen(false); handleExportZip(); }} 
                  className="w-full text-left px-3 py-2 text-slate-200 hover:bg-[#132e4d] flex items-center gap-2 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5 text-amber-400" /> Export All ZIP
                </button>
              </div>
            )}
          </div>

          {/* Clear Form Button */}
          <button 
            type="button"
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#071b30] hover:bg-[#0d2745] border border-[#1e436c] rounded-md text-white font-medium text-xs transition-colors shadow-xs cursor-pointer"
          >
            <XSquare className="w-3.5 h-3.5 text-slate-400" />
            <span>Clear Form</span>
          </button>

          {/* Valid From */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span className="text-slate-300 font-medium">Valid From</span>
            <span className="bg-[#071b30] border border-[#1e436c] px-2.5 py-1 rounded text-white font-mono text-xs flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-slate-400" />
              {formatDate(validFromDisplay)}
            </span>
          </div>

          {/* Valid To */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span className="text-slate-300 font-medium">Valid To</span>
            <span className="bg-[#071b30] border border-[#1e436c] px-2.5 py-1 rounded text-white font-mono text-xs flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-slate-400" />
              {formatDate(validToDisplay)}
            </span>
          </div>

          {/* Ward / Department */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-300 font-medium">Ward / Department</span>
            <div className="relative">
              <button 
                type="button"
                onClick={() => setWardDropdownOpen(v => !v)}
                className="bg-[#071b30] hover:bg-[#0d2745] border border-[#1e436c] px-2.5 py-1 rounded text-white text-xs flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
              >
                <Building2 className="w-3 h-3 text-slate-400" />
                <span>{selectedWard}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>
              {wardDropdownOpen && (
                <div className="absolute left-0 bottom-full mb-1 w-52 max-h-48 overflow-y-auto bg-[#091e34] border border-[#1d436e] rounded-lg shadow-xl py-1 z-30 text-xs">
                  {availableWards.map(w => (
                    <button 
                      key={w} 
                      type="button" 
                      onClick={() => { setWardDropdownOpen(false); onChangeFormData?.({ ward: w }); }} 
                      className="w-full text-left px-3 py-1.5 text-slate-200 hover:bg-[#132e4d] cursor-pointer"
                    >
                      {w}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Metadata Info Strip */}
      <div className="flex flex-wrap items-center gap-6 px-2 py-3 text-xs text-slate-400 font-medium select-none">
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>{totalDbCount} records · {totalVouchersCount} vouchers</span>
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>v3.4 Elite · {formatDate(processingDate || "07/07/2026")}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Secure QR</span>
        </span>
      </div>
    </section>
  );
}
