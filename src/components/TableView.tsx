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
  isDateRequiredOutsideValidWindow,
  getSpreadsheetMatchingAllocationsMap,
  extractRecordVoucherCode,
  isRecordCancelled
} from "../utils/csvParser";
import { checkIsRecordDispatched } from "../utils/dispatchUtils";
import { BlocklistPanel } from "./BlocklistPanel";
import { isVrmSilentBlockedSync } from "../lib/blocklist";

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
  const [tableDateFilter, setTableDateFilter] = useState<"ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM">("ALL");
  const [tableCustomStartDate, setTableCustomStartDate] = useState("");
  const [tableCustomEndDate, setTableCustomEndDate] = useState("");

  const todayISO = useMemo(() => getTodayISO(), []);

  const dateRanges = useMemo(() => {
    const addCalendarDays = (iso: string, delta: number): string => {
      const [year, month, day] = iso.split("-").map(Number);
      const ref = new Date(year, month - 1, day);
      ref.setDate(ref.getDate() + delta);
      const y = ref.getFullYear();
      const m = String(ref.getMonth() + 1).padStart(2, "0");
      const d = String(ref.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    return {
      today: todayISO,
      last7DaysStart: addCalendarDays(todayISO, -6),
      last30DaysStart: addCalendarDays(todayISO, -29)
    };
  }, [todayISO]);

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

  // Pre-calculate allocated codes across sortedDatabase using canonical csvParser allocation logic
  const tableRecordCodeMap = useMemo(() => {
    return getSpreadsheetMatchingAllocationsMap(
      database,
      database,
      processingDate || getTodayISO(),
      vouchersDatabase,
      customVouchersMap
    );
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

  const filteredRecords = useMemo(() => {
    return sortedDatabase.filter(r => {
      if (tableDateFilter !== "ALL") {
        const recDate =
          parseDateToISO(r.dateRequired || r.validFrom) ||
          parseDateToISO(r.todayDate || r.createdAt || r.created_at);
        if (!recDate) return false;

        if (tableDateFilter === "TODAY") {
          if (recDate !== todayISO) return false;
        } else if (tableDateFilter === "THIS_WEEK") {
          if (recDate < dateRanges.last7DaysStart || recDate > todayISO) return false;
        } else if (tableDateFilter === "THIS_MONTH") {
          if (recDate < dateRanges.last30DaysStart || recDate > todayISO) return false;
        } else if (tableDateFilter === "CUSTOM") {
          if (tableCustomStartDate && recDate < tableCustomStartDate) return false;
          if (tableCustomEndDate && recDate > tableCustomEndDate) return false;
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
  }, [sortedDatabase, searchQuery, selectedHospital, tableDateFilter, tableCustomStartDate, tableCustomEndDate, todayISO, dateRanges]);

  const effectiveTotalCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : database.length;
  const isFiltered = Boolean(searchQuery.trim() || selectedHospital !== "ALL" || tableDateFilter !== "ALL");
  const tableDisplayCount = (tableDateFilter === "ALL" && !isFiltered)
    ? effectiveTotalCount
    : filteredRecords.length;

  const handleLoadRecord = (record: CsvPermitRecord) => {
    const effectiveProcessingDate = processingDate || getTodayISO();
    const isRecCancelled = isRecordCancelled(record, effectiveProcessingDate, database);

    let displayCode = "-";
    if (isRecCancelled) {
      displayCode = "CANCELLED";
    } else {
      const recordKey = String(record.formId ?? record.id ?? "");
      const allocatedCode = tableRecordCodeMap.get(recordKey);
      const rawVoucher = extractRecordVoucherCode(record);
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
    const submissionTimestamp = record.startTime || record.created_at || record.createdAt || record.completionTime || record.validFrom || record.dateRequired;
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

      <div className="border border-slate-800 bg-slate-900/50 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-4 h-4 text-[#005EB8] dark:text-blue-400 shrink-0" />
          <span className="font-bold text-slate-300">Date Filter</span>
          <div className="relative">
            <select
              id="table-date-filter-dropdown"
              value={tableDateFilter}
              onChange={(e) => {
                const next = e.target.value as "ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";
                setTableDateFilter(next);
                if (next === "THIS_WEEK") {
                  onDateRangeFilterChange?.("7days");
                } else if (next === "THIS_MONTH") {
                  onDateRangeFilterChange?.("30days");
                } else {
                  onDateRangeFilterChange?.("all");
                }
                if (next === "ALL") {
                  setTableCustomStartDate("");
                  setTableCustomEndDate("");
                }
              }}
              className="h-8 min-w-[160px] px-3 pr-8 bg-slate-950 border border-slate-800 text-slate-200 rounded-md text-xs font-semibold focus:outline-none focus:border-[#005EB8] transition appearance-none cursor-pointer"
            >
              <option value="TODAY">Today</option>
              <option value="THIS_WEEK">This Week</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="CUSTOM">Custom Range</option>
              <option value="ALL">{isLoadingHistory ? "Loading..." : "All Time"}</option>
            </select>
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

      {tableDateFilter === "CUSTOM" && (
        <div className="flex flex-wrap items-center gap-3 p-2.5 bg-blue-50/70 dark:bg-[#0b2138] border border-blue-200 dark:border-[#183d63] rounded-xl text-xs animate-in fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
            <Calendar className="w-3.5 h-3.5 text-[#005EB8] dark:text-[#38bdf8]" />
            <span>Custom Date Range:</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">From:</label>
            <input
              type="date"
              value={tableCustomStartDate}
              onChange={(e) => setTableCustomStartDate(e.target.value)}
              className="px-2.5 py-1 bg-white dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] rounded-lg text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">To:</label>
            <input
              type="date"
              value={tableCustomEndDate}
              onChange={(e) => setTableCustomEndDate(e.target.value)}
              className="px-2.5 py-1 bg-white dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] rounded-lg text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
          {(tableCustomStartDate || tableCustomEndDate) && (
            <button
              type="button"
              onClick={() => { setTableCustomStartDate(""); setTableCustomEndDate(""); }}
              className="text-[11px] text-[#005EB8] hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 underline font-semibold cursor-pointer ml-1"
            >
              Reset Dates
            </button>
          )}
        </div>
      )}

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
                  const isRecCancelled = isRecordCancelled(r, effectiveProcessingDate, database);
                  const isBlocked = isVrmSilentBlockedSync(r.vrm);

                  const allocatedCode = tableRecordCodeMap.get(recordKey);
                  const rawVoucherCode = extractRecordVoucherCode(r);

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
                        {isBlocked ? (
                          <span 
                            className="inline-flex items-center gap-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-900/40 select-none"
                            title="Status: Blocked (Display only)"
                          >
                            <span>BLOCKED</span>
                          </span>
                        ) : isDispatched ? (
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
