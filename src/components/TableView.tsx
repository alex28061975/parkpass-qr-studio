import React, { useState, useMemo } from "react";
import { 
  Table, 
  Search, 
  Download, 
  Database, 
  ExternalLink, 
  Check, 
  Filter, 
  ArrowLeft,
  Calendar,
  Building2,
  Car,
  User,
  Ticket,
  Clock,
  ShieldAlert,
  RotateCcw
} from "lucide-react";
import { 
  CsvPermitRecord, 
  ParsedVoucherData, 
  formatFormId, 
  toTitleCase, 
  cleanVoucherCodeValue, 
  exportToExcel,
  sortRecordsByFormIdDesc,
  parseDateToISO,
  getTodayISO,
  checkIsBlockedDuplicate,
  isDateRequiredOutsideValidWindow
} from "../utils/csvParser";
import { checkIsRecordDispatched } from "../utils/dispatchUtils";
import { isSupabaseConfigured } from "../lib/supabase";
import { isRecordCancelled, isCancelled } from "./PermitCard";
import { BlocklistPanel } from "./BlocklistPanel";

interface TableViewProps {
  database: CsvPermitRecord[];
  totalRecordsCount?: number;
  vouchersDatabase: ParsedVoucherData[];
  dispatchedKeys: string[];
  unsentKeys?: string[];
  dispatchDates?: {[key: string]: string};
  onSelectRecord: (record: CsvPermitRecord) => void;
  processingDate?: string;
  onProcessingDateChange?: (dateISO: string) => void;
  onSwitchToDispatcher: () => void;
  onExportExcel: () => void;
  dateRangeFilter?: '7days' | '30days' | 'all';
  onDateRangeFilterChange?: (filter: '7days' | '30days' | 'all') => void;
  isLoadingHistory?: boolean;
  onCleanDatabase?: () => Promise<void> | void;
  customVouchersMap?: Record<string, string>;
}

export function TableView({
  database,
  totalRecordsCount,
  vouchersDatabase,
  dispatchedKeys = [],
  unsentKeys = [],
  dispatchDates = {},
  onSelectRecord,
  processingDate,
  onProcessingDateChange,
  onSwitchToDispatcher,
  onExportExcel,
  dateRangeFilter = '7days',
  onDateRangeFilterChange,
  isLoadingHistory = false,
  onCleanDatabase,
  customVouchersMap = {}
}: TableViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHospital, setSelectedHospital] = useState<string>("ALL");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showBlocklist, setShowBlocklist] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);

  const handleCleanDatabase = async () => {
    if (isCleaning) return;
    setIsCleaning(true);
    try {
      if (onCleanDatabase) {
        await onCleanDatabase();
      }
      setFeedback("Database cleaned and synchronized successfully!");
    } catch (e: any) {
      console.warn("Failed to clean database:", e);
    } finally {
      setIsCleaning(false);
    }
  };

  // Merge database with vouchers if applicable
  const sortedDatabase = useMemo(() => {
    return sortRecordsByFormIdDesc(database);
  }, [database]);

  // Pre-calculate allocated codes across sortedDatabase using vouchersDatabase
  const tableRecordCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    const assignedCodesSet = new Set<string>();
    const effectiveProcessingDate = processingDate || getTodayISO();

    // Pass 1: Existing valid codes directly from database
    const chronoRecords = [...database].sort((a, b) => {
      const aId = Number(String(a.formId ?? a.id ?? 0).replace(/[^0-9]/g, "")) || 0;
      const bId = Number(String(b.formId ?? b.id ?? 0).replace(/[^0-9]/g, "")) || 0;
      return aId - bId;
    });

    chronoRecords.forEach((r, idx) => {
      const recordKey = String(r.formId ?? r.id ?? idx);
      const isRecCancelled = isRecordCancelled(r, effectiveProcessingDate) || checkIsBlockedDuplicate(r, database, effectiveProcessingDate);

      // If record is dynamically cancelled or blocked
      if (isRecCancelled) {
        map.set(recordKey, "CANCELLED");
        return;
      }

      // Check custom vouchers map override first
      const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const rDateIso = parseDateToISO(r.dateRequired || r.validFrom || "");
      const keyWithDate = rDateIso ? `${rVrm}_${rDateIso}` : rVrm;
      const customOverride = customVouchersMap ? (
        customVouchersMap[keyWithDate] ||
        customVouchersMap[rVrm] ||
        (r.id ? customVouchersMap[r.id] : undefined) ||
        (r.formId ? customVouchersMap[String(r.formId)] : undefined)
      ) : undefined;

      if (customOverride && customOverride !== "-" && customOverride.toUpperCase() !== "CANCELLED") {
        const clean = String(customOverride).trim().split(/[\n,;\s]+/)[0]?.trim().toUpperCase();
        if (clean && clean !== "-" && clean !== "CANCELLED") {
          map.set(recordKey, clean);
          assignedCodesSet.add(clean);
          return;
        }
      }

      const rawCode = r.voucherCode || (r as any).prePaidCode || (r as any).qrCode || (r as any).serialNumber;
      const rawCodeUpper = rawCode ? String(rawCode).trim().toUpperCase() : "";
      if (rawCode && rawCode !== "-" && rawCodeUpper !== "CANCELLED") {
        const clean = String(rawCode).trim().split(/[\n,;\s]+/)[0]?.trim().toUpperCase();
        if (clean && clean !== "-" && clean !== "CANCELLED") {
          map.set(recordKey, clean);
          assignedCodesSet.add(clean);
        }
      }
    });

    // Pass 2: Allocate from vouchersDatabase if available for records without codes
    if (vouchersDatabase && vouchersDatabase.length > 0) {
      chronoRecords.forEach((r, idx) => {
        const recordKey = String(r.formId ?? r.id ?? idx);
        if (map.has(recordKey)) return;

        const isRecCancelled = isRecordCancelled(r, effectiveProcessingDate) || checkIsBlockedDuplicate(r, database, effectiveProcessingDate);
        if (isRecCancelled) {
          map.set(recordKey, "CANCELLED");
          return;
        }

        const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

        let nextCode = "";
        if (rVrm) {
          const vrmMatch = (vouchersDatabase || []).find(v => {
            const vVrm = (v.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            return vVrm && vVrm === rVrm && !assignedCodesSet.has(v.code.trim().toUpperCase());
          });
          if (vrmMatch && vrmMatch.code) {
            nextCode = vrmMatch.code.trim().toUpperCase();
          }
        }

        if (!nextCode) {
          const avail = (vouchersDatabase || []).find(v => v.code && !assignedCodesSet.has(v.code.trim().toUpperCase()))?.code;
          if (avail) {
            nextCode = (typeof avail === "string" ? avail : (avail as any).code).trim().toUpperCase();
          }
        }

        if (nextCode) {
          map.set(recordKey, nextCode);
          assignedCodesSet.add(nextCode);
        } else {
          map.set(recordKey, "-");
        }
      });
    }

    return map;
  }, [database, vouchersDatabase, customVouchersMap, processingDate]);

  // Extract unique hospital sites for filtering
  const hospitalSites = useMemo(() => {
    const sites = new Set<string>();
    database.forEach(r => {
      if (r.hospital && r.hospital.trim()) {
        sites.add(r.hospital.trim());
      }
    });
    return Array.from(sites);
  }, [database]);

  // Filter records based on date range, search query, and hospital filter
  const filteredRecords = useMemo(() => {
    return sortedDatabase.filter(r => {
      // Secondary in-memory Date Range Filter only when Supabase is not active
      if (!isSupabaseConfigured() && dateRangeFilter && dateRangeFilter !== 'all') {
        const days = dateRangeFilter === '7days' ? 7 : 30;
        const rawDate = r.dateRequired || r.todayDate || (r as any).createdAt || (r as any).created_at;
        if (rawDate) {
          const iso = parseDateToISO(rawDate);
          if (iso) {
            const dateObj = new Date(iso + 'T00:00:00');
            if (!isNaN(dateObj.getTime())) {
              const now = new Date();
              now.setHours(23, 59, 59, 999);
              const cutoff = new Date(now);
              cutoff.setDate(cutoff.getDate() - days);
              cutoff.setHours(0, 0, 0, 0);
              if (dateObj < cutoff) {
                return false;
              }
            }
          }
        }
      }

      // Hospital filter
      if (selectedHospital !== "ALL" && r.hospital !== selectedHospital) {
        return false;
      }

      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase().trim();
      const cleanFormId = formatFormId(r.formId !== undefined ? r.formId : r.id);

      return (
        cleanFormId.includes(query) ||
        (r.formId && String(r.formId).includes(query)) ||
        r.driverName.toLowerCase().includes(query) ||
        r.vrm.toLowerCase().includes(query) ||
        r.hospital.toLowerCase().includes(query) ||
        r.ward.toLowerCase().includes(query) ||
        (r.email && r.email.toLowerCase().includes(query)) ||
        (r.phone && r.phone.toLowerCase().includes(query)) ||
        (r.voucherCode && r.voucherCode.toLowerCase().includes(query))
      );
    });
  }, [sortedDatabase, searchQuery, selectedHospital, dateRangeFilter]);

  const effectiveTotalCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : database.length;
  const isFiltered = Boolean(searchQuery.trim() || selectedHospital !== "ALL");
  const tableDisplayCount = (dateRangeFilter === 'all' && !isFiltered)
    ? effectiveTotalCount
    : filteredRecords.length;

  const handleLoadRecord = (record: CsvPermitRecord) => {
    const effectiveProcessingDate = processingDate || getTodayISO();
    const isRecCancelled = isRecordCancelled(record, effectiveProcessingDate) || checkIsBlockedDuplicate(record, database, effectiveProcessingDate);

    let displayCode = "-";
    if (isRecCancelled) {
      displayCode = "CANCELLED";
    } else {
      const recordKey = String(record.formId ?? record.id ?? "");
      const allocatedCode = tableRecordCodeMap.get(recordKey);
      const rawVoucher = record.voucherCode || (record as any).prePaidCode || (record as any).qrCode;
      displayCode = (allocatedCode && allocatedCode !== "-" && allocatedCode !== "CANCELLED")
        ? allocatedCode
        : (rawVoucher && rawVoucher.trim() !== "" && rawVoucher.trim().toUpperCase() !== "CANCELLED")
          ? rawVoucher.trim()
          : "-";
    }

    const updatedRecord: CsvPermitRecord = {
      ...record,
      voucherCode: displayCode,
      prePaidCode: displayCode,
      isCancelled: isRecCancelled
    };

    // Load selected record details into the Dispatcher Desk
    onSelectRecord(updatedRecord);
    
    // Update Processing Date to the record's Start Time (submission timestamp) when "Load Desk" / "Load Table" is clicked
    const submissionTimestamp = record.startTime || (record as any).created_at || (record as any).createdAt || (record as any).completionTime || record.validFrom || record.dateRequired;
    const fromISO = parseDateToISO(submissionTimestamp);
    if (fromISO && onProcessingDateChange) {
      onProcessingDateChange(fromISO);
    }

    const cleanId = formatFormId(record.formId !== undefined ? record.formId : record.id);
    setFeedback(`Loaded Record #${cleanId} into Dispatcher Desk!`);
    setTimeout(() => {
      onSwitchToDispatcher();
    }, 400);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* View Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#005EB8]/10 dark:bg-blue-900/30 border border-[#005EB8]/20 flex items-center justify-center text-[#005EB8] dark:text-blue-400 shrink-0">
            <Table className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900 dark:text-white tracking-tight">
                Dispatcher Database Table
              </h2>
              <span className="bg-blue-100 dark:bg-blue-950 text-[#005EB8] dark:text-blue-300 font-mono font-bold px-2 py-0.5 rounded-full text-xs">
                {filteredRecords.length} / {totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : database.length} Records
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Full 12-Column interactive permit view sorted by Form ID DESC. Click any row to load into Dispatcher Desk.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCleanDatabase}
            disabled={isCleaning}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
            title="Clean Database"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-blue-400 ${isCleaning ? "animate-spin" : ""}`} />
            <span>{isCleaning ? "Cleaning..." : "Clean Database"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBlocklist(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60 text-xs font-bold rounded-lg transition-all cursor-pointer shadow-xs active:scale-95"
            title="Manage Concessions Blocklist"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Manage Blocklist</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-all shadow-xs cursor-pointer active:scale-95"
            title="Export full database to Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Data Range Filter Bar */}
      <div className="border border-slate-800 bg-slate-900/50 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        {/* Data Range Selector (Left Side) */}
        <div className="flex items-center gap-2 text-xs">
          <Clock className="w-4 h-4 text-[#005EB8] dark:text-blue-400 shrink-0" />
          <span className="font-bold text-slate-300">Data Range:</span>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-md border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => onDateRangeFilterChange?.('7days')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer text-xs ${
                dateRangeFilter === '7days'
                  ? "bg-[#005EB8] text-white font-bold shadow-xs"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => onDateRangeFilterChange?.('30days')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer text-xs ${
                dateRangeFilter === '30days'
                  ? "bg-[#005EB8] text-white font-bold shadow-xs"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => onDateRangeFilterChange?.('all')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer text-xs ${
                dateRangeFilter === 'all'
                  ? "bg-[#005EB8] text-white font-bold shadow-xs"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {isLoadingHistory ? "Loading..." : "All Time"}
            </button>
          </div>
        </div>

        {/* System Status & Metrics Badges (Right Side) */}
        <div className="flex items-center gap-2.5 text-xs font-mono">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold text-[#005EB8] dark:text-blue-300 bg-blue-950/60 border border-blue-800/80">
            {tableDisplayCount.toLocaleString()} Records Loaded
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 font-sans">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Sub-200ms
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-3 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Form ID, VRM, Driver Name, Ward, Voucher..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-950 text-gray-800 dark:text-slate-200 focus:outline-none focus:border-[#005EB8] dark:focus:border-blue-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 text-xs font-bold"
            >
              &times;
            </button>
          )}
        </div>

        {/* Hospital Filter Dropdown */}
        {hospitalSites.length > 0 && (
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-600 dark:text-slate-400 shrink-0">
              Site:
            </span>
            <select
              value={selectedHospital}
              onChange={(e) => setSelectedHospital(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-950 text-gray-800 dark:text-slate-200 focus:outline-none focus:border-[#005EB8]"
            >
              <option value="ALL">All Sites ({database.length})</option>
              {hospitalSites.map(site => (
                <option key={site} value={site}>{site}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main 12-Column Table */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="min-w-[1100px] w-full text-left text-xs border-collapse table-auto">
            <thead className="bg-gray-100/90 dark:bg-slate-800/90 text-gray-700 dark:text-slate-300 font-bold sticky top-0 z-10 backdrop-blur-xs uppercase text-[10px] tracking-wider border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Form ID</th>
                <th className="p-3 whitespace-nowrap text-center border-r border-gray-200/60 dark:border-slate-800/60">Status</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Hospital Site</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Ward / Dept</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Date Required</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Expiry Date</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">VRM</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Driver Name</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Phone</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Email</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Voucher Code</th>
                <th className="p-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Start Time</th>
                <th className="p-3 whitespace-nowrap text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60 font-mono text-[11px]">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-gray-400 dark:text-slate-500 font-sans">
                    No matching records found. Try adjusting your search query or filters.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, idx) => {
                  const cleanFormIdStr = formatFormId(r.formId !== undefined ? r.formId : r.id);
                  const recordKey = String(r.formId ?? r.id ?? idx);
                  const isDispatched = checkIsRecordDispatched(r, r.vrm, r.driverName, r.dateRequired, dispatchedKeys, unsentKeys);
                  const effectiveProcessingDate = processingDate || getTodayISO();
                  const isRecCancelled = isRecordCancelled(r, effectiveProcessingDate) || checkIsBlockedDuplicate(r, database, effectiveProcessingDate);

                  const allocatedCode = tableRecordCodeMap.get(recordKey);
                  const rawVoucherCode = r.voucherCode || (r as any).prePaidCode || (r as any).qrCode || (r as any).serialNumber;

                  let displayCode = "-";
                  if (isRecCancelled) {
                    displayCode = "CANCELLED";
                  } else if (allocatedCode && allocatedCode !== "-") {
                    displayCode = allocatedCode;
                  } else if (rawVoucherCode && rawVoucherCode.trim() !== "") {
                    displayCode = rawVoucherCode.trim();
                  }

                  const isInvalid = isRecCancelled || displayCode === "CANCELLED";
                  const hasValidVoucher = Boolean(
                    displayCode &&
                    displayCode !== "-" &&
                    displayCode.trim() !== "" &&
                    !isInvalid
                  );

                  return (
                    <tr
                      key={`${r.id || idx}_${idx}`}
                      onClick={() => handleLoadRecord(r)}
                      className="hover:bg-blue-50/70 dark:hover:bg-blue-950/40 transition-colors cursor-pointer group"
                    >
                      <td className="p-3 font-bold text-[#005EB8] dark:text-blue-400 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        <span className="bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800/60">
                          #{cleanFormIdStr}
                        </span>
                      </td>
                      <td className="p-3 text-center whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 cursor-default select-none pointer-events-none">
                        {isDispatched ? (
                          <span 
                            className="inline-flex items-center gap-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/40 select-none"
                            title="Status: Sent (Display only)"
                          >
                            <span>✓ Sent</span>
                          </span>
                        ) : (
                          <span 
                            className="inline-flex items-center gap-0.5 bg-blue-50 dark:bg-blue-950/40 text-[#005EB8] dark:text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900/40 select-none"
                            title="Status: Pending (Display only)"
                          >
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-sans text-gray-800 dark:text-slate-200 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        {r.hospital || "-"}
                      </td>
                      <td className="p-3 font-sans text-gray-700 dark:text-slate-300 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        {r.ward || "-"}
                      </td>
                      <td className="p-3 text-gray-800 dark:text-slate-200 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-mono">
                        {r.dateRequired || "-"}
                      </td>
                      <td className="p-3 text-gray-800 dark:text-slate-200 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-mono">
                        {r.dateExpiry || "-"}
                      </td>
                      <td className="p-3 font-bold text-gray-900 dark:text-white uppercase tracking-wider whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/40 font-mono">
                          {r.vrm || "-"}
                        </span>
                      </td>
                      <td className="p-3 font-sans font-semibold text-gray-800 dark:text-slate-200 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        {r.driverName ? toTitleCase(r.driverName) : "-"}
                      </td>
                      <td className="p-3 text-gray-600 dark:text-slate-400 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        {r.phone || "-"}
                      </td>
                      <td className="p-3 text-gray-600 dark:text-slate-400 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        {r.email || "-"}
                      </td>
                      <td className="p-3 font-bold whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-mono">
                        {isInvalid ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300">
                            CANCELLED
                          </span>
                        ) : hasValidVoucher ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">
                            {displayCode}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500 font-normal">
                            {displayCode || "-"}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-gray-500 dark:text-slate-500 text-[10px] whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        {r.startTime || "-"}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLoadRecord(r);
                          }}
                          className="px-2.5 py-1 bg-[#005EB8] hover:bg-[#004d99] text-white text-[10px] font-bold uppercase tracking-wider rounded transition-all flex items-center gap-1 mx-auto cursor-pointer shadow-xs group-hover:scale-105"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Load Desk</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary Bar */}
        <div className="p-3 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 text-xs text-gray-500 dark:text-slate-400 flex items-center justify-between font-sans">
          <span>Showing {filteredRecords.length} records in full 12-column table view</span>
          <span className="font-medium text-gray-700 dark:text-slate-300">Tip: Click any row to load into Dispatcher Desk</span>
        </div>
      </div>

      {/* Blocklist Management Modal Panel */}
      <BlocklistPanel 
        isOpen={showBlocklist} 
        onClose={() => setShowBlocklist(false)} 
        database={database}
      />
    </div>
  );
}
