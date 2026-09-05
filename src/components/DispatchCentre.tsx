import React, { useMemo, useState, useEffect } from "react";
import { 
  ChevronDown, 
  ChevronLeft,
  ChevronRight,
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
  X,
  Filter
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
  sortRecordsByFormIdDesc,
  getNumericFormId,
  extractRecordSubmissionTimeMs,
  getRequestedPermitDateISO,
  getTodayISO,
  formatSubmittedDateTime,
  getRecordSubmittedTimeMs
} from "../utils/csvParser";
import { checkIsRecordDispatched, getRecordKeys } from "../utils/dispatchUtils";
import { isVrmSilentBlockedSync } from "../lib/blocklist";

interface DispatchCentreProps {
  database: CsvPermitRecord[];
  vouchersDatabase: ParsedVoucherData[];
  dispatchedKeys: string[];
  unsentKeys?: string[];
  dispatchDates?: Record<string, string>;
  customVouchers?: Record<string, string>;
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
  dateRangeFilter?: '7days' | '30days' | 'all';
  onDateRangeFilterChange?: (filter: '7days' | '30days' | 'all') => void;
  isLoadingHistory?: boolean;
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
  | "submitted"
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
  dispatchDates,
  customVouchers,
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
  onChangeFormData,
  onDateRangeFilterChange,
  isLoadingHistory
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

  // Dropdown filter states
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "SENT" | "UNSENT" | "BLOCKED">("ALL");
  const [hospitalFilter, setHospitalFilter] = useState<string>("ALL");
  const [wardFilter, setWardFilter] = useState<string>("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM">("THIS_WEEK");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  const [blocklistVersion, setBlocklistVersion] = useState<number>(0);
  useEffect(() => {
    const handleBlocklistUpdate = () => {
      setBlocklistVersion(v => v + 1);
    };
    window.addEventListener("blocklist_updated", handleBlocklistUpdate);
    return () => window.removeEventListener("blocklist_updated", handleBlocklistUpdate);
  }, []);

  // Pagination state (default: 50 rows per page)
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [goToPageInput, setGoToPageInput] = useState<string>("");

  // Base records: always shows all records sorted by Form ID (#) descending (highest number first)
  const baseRecords = useMemo(() => {
    return sortRecordsByFormIdDesc(database);
  }, [database]);

  // Compute dynamic voucher allocations map matching Matching Helper exactly
  const recordCodeMap = useMemo(() => {
    return getSpreadsheetMatchingAllocationsMap(
      baseRecords,
      database,
      processingDate,
      vouchersDatabase,
      customVouchers
    );
  }, [baseRecords, database, processingDate, vouchersDatabase, customVouchers, blocklistVersion]);

  // A replacement is temporarily UNSENT while its new QR code is prepared.
  // Keep that state visible in the Dispatch Centre using the selected form's
  // explicit replacement marker rather than relying on dispatchedKeys alone.
  /**
   * IMPORTANT: replacement state must belong to ONE exact permit record.
   * VRM/date is NOT a safe identity because multiple rows can share the same
   * VRM and valid-from date (including cancelled + active records).
   *
   * If either side has a stable id/formId, we ONLY compare stable ids.
   * VRM/date fallback is permitted only for genuinely legacy rows where BOTH
   * the row and the selected form have no stable identity.
   */
  const isSameSelectedRecord = (record: CsvPermitRecord) => {
    if (!formData) return false;

    const recordId = String(record.id ?? "").trim();
    const recordFormId = String(record.formId ?? "").trim();
    const selectedId = String(formData.id ?? "").trim();
    const selectedFormId = String(formData.formId ?? "").trim();

    const recordHasStableId = Boolean(recordId || recordFormId);
    const selectedHasStableId = Boolean(selectedId || selectedFormId);

    // Stable identity exists: NEVER fall back to VRM/date.
    if (recordHasStableId || selectedHasStableId) {
      return Boolean(
        (recordId && selectedId && recordId === selectedId) ||
        (recordFormId && selectedFormId && recordFormId === selectedFormId) ||
        (recordId && selectedFormId && recordId === selectedFormId) ||
        (recordFormId && selectedId && recordFormId === selectedId)
      );
    }

    // Legacy records with no stable identity on either side.
    const recordVrm = (record.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const selectedVrm = (formData.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const recordDate = parseDateToISO(record.dateRequired || record.validFrom) || "";
    const selectedDate = parseDateToISO(formData.validFrom || formData.todayDate) || "";
    return Boolean(
      recordVrm && selectedVrm &&
      recordVrm === selectedVrm &&
      recordDate && selectedDate &&
      recordDate === selectedDate
    );
  };

  const isReplacementPending = (record: CsvPermitRecord) =>
    isSameSelectedRecord(record) &&
    (formData?.emailType === "RESEND_CONCESSION" || formData?.isResend === true || formData?.emailTemplate === "replacement");

  // Shared status, hospital, and cancellation extractors
  const getHospital = (record: CsvPermitRecord) => {
    const raw = (record.hospital || "").trim();
    if (raw && !raw.toLowerCase().includes("royal london")) {
      return raw;
    }
    return (record.ward && (
      record.ward.toLowerCase().includes("acorn") || 
      record.ward.toLowerCase().includes("acacia") || 
      record.ward.toLowerCase().includes("mulberry")
    ) ? "Whipps Cross Hospital" : "Newham Hospital");
  };

  const getIsCancelled = (record: CsvPermitRecord, idx: number) => {
    return isVrmSilentBlockedSync(record.vrm);
  };

  const getStatusStr = (record: CsvPermitRecord, idx: number) => {
    if (isVrmSilentBlockedSync(record.vrm)) return "BLOCKED";
    if (isReplacementPending(record)) return "REPLACEMENT";
    const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
    const rowKey = String(record.formId ?? record.id ?? record.vrm ?? idx);
    const recordKeys = getRecordKeys(record);
    const isUnsent = Boolean(unsentKeys && unsentKeys.length > 0 && (unsentKeys.includes(rowKey) || recordKeys.some(k => unsentKeys.includes(k))));
    if (isDispatched) return "SENT";
    if (isUnsent) return "UNSENT";
    return "PENDING";
  };

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

  // List of distinct hospitals for filter dropdown: only Newham Hospital and Whipps Cross Hospital
  const allHospitalsList = useMemo(() => {
    const standardHospitals = ["Newham Hospital", "Whipps Cross Hospital"];
    const set = new Set<string>(standardHospitals);
    database.forEach(r => {
      const h = (r.hospital || "").trim();
      if (h && !h.toLowerCase().includes("royal london")) {
        set.add(h);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [database]);

  // List of distinct wards for filter dropdown
  const allWardsList = useMemo(() => {
    const standardWards = [
      "Maternity",
      "Labour Ward",
      "Mulberry",
      "Acorn",
      "Acacia",
      "ICU",
      "Antenatal",
      "Postnatal"
    ];
    const set = new Set<string>(standardWards);
    database.forEach(r => {
      const w = (r.ward || "").trim();
      if (w) set.add(w);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [database]);

  // Reset page to 1 whenever filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    statusFilter,
    hospitalFilter,
    wardFilter,
    dateFilter,
    customStartDate,
    customEndDate,
    pageSize
  ]);

  // Sorted records based on active column sort
  const sortedRecords = useMemo(() => {
    if (!sortKey || !sortDirection) {
      return baseRecords;
    }

    const sorted = [...baseRecords].sort((a, b) => {
      let comparison = 0;
      const aIdx = baseRecords.indexOf(a);
      const bIdx = baseRecords.indexOf(b);

      switch (sortKey) {
        case "id": {
          const aId = getNumericFormId(a) || (aIdx + 1);
          const bId = getNumericFormId(b) || (bIdx + 1);
          if (aId !== bId) {
            comparison = aId - bId;
          } else {
            const timeA = extractRecordSubmissionTimeMs(a);
            const timeB = extractRecordSubmissionTimeMs(b);
            comparison = timeA - timeB;
          }
          break;
        }
        case "submitted":
        case "qr": {
          const timeA = getRecordSubmittedTimeMs(a);
          const timeB = getRecordSubmittedTimeMs(b);
          if (timeA !== timeB) {
            comparison = timeA - timeB;
          } else {
            const aId = getNumericFormId(a) || (aIdx + 1);
            const bId = getNumericFormId(b) || (bIdx + 1);
            comparison = aId - bId;
          }
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
          const aCanc = getIsCancelled(a, aIdx);
          const bCanc = getIsCancelled(b, bIdx);
          const aDisp = checkIsRecordDispatched(a, a.vrm, a.driverName, a.dateRequired, dispatchedKeys, unsentKeys);
          const bDisp = checkIsRecordDispatched(b, b.vrm, b.driverName, b.dateRequired, dispatchedKeys, unsentKeys);
          const aAct = aCanc ? "Unsend" : (isReplacementPending(a) ? "Resend" : (aDisp ? "Unsend" : "Send"));
          const bAct = bCanc ? "Unsend" : (isReplacementPending(b) ? "Resend" : (bDisp ? "Unsend" : "Send"));
          comparison = aAct.localeCompare(bAct);
          break;
        }
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [baseRecords, sortKey, sortDirection, database, processingDate, recordCodeMap, dispatchedKeys, unsentKeys, formData]);

  // Comprehensive filtering: Search Query + Status + Hospital + Ward + Date Range
  const filteredRecords = useMemo(() => {
    return sortedRecords.filter((record, idx) => {
      // 1. Text Search Filter
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const cleanFormId = String(record.formId ?? record.id ?? "");
        const matchesSearch = (
          cleanFormId.toLowerCase().includes(q) ||
          (record.driverName || "").toLowerCase().includes(q) ||
          (record.vrm || "").toLowerCase().includes(q) ||
          (record.hospital || "").toLowerCase().includes(q) ||
          (record.ward || "").toLowerCase().includes(q) ||
          (record.email || "").toLowerCase().includes(q) ||
          (record.voucherCode || "").toLowerCase().includes(q)
        );
        if (!matchesSearch) return false;
      }

      // 2. Status Filter: "ALL" | "PENDING" | "SENT" | "UNSENT" | "BLOCKED"
      if (statusFilter !== "ALL") {
        const status = getStatusStr(record, idx);
        if (statusFilter === "PENDING" && status !== "PENDING") return false;
        if (statusFilter === "SENT" && status !== "SENT") return false;
        if (statusFilter === "UNSENT" && status !== "UNSENT") return false;
        if (statusFilter === "BLOCKED" && status !== "BLOCKED") return false;
      }

      // 3. Hospital Filter
      if (hospitalFilter !== "ALL") {
        const hosp = getHospital(record);
        if (hosp.toLowerCase().trim() !== hospitalFilter.toLowerCase().trim()) {
          return false;
        }
      }

      // 4. Ward Filter
      if (wardFilter !== "ALL") {
        const w = (record.ward || "").toLowerCase();
        const target = wardFilter.toLowerCase();
        if (!w.includes(target) && w !== target) {
          return false;
        }
      }

      if (dateFilter !== "ALL") {
        const recDate =
          getRequestedPermitDateISO(record) ||
          parseDateToISO(record.dateRequired || record.validFrom) ||
          parseDateToISO(record.todayDate || record.createdAt || record.created_at || (record as any).submissionTime);
        if (!recDate) return false;

        if (dateFilter === "TODAY") {
          if (recDate !== todayISO) return false;
        } else if (dateFilter === "THIS_WEEK") {
          if (recDate < dateRanges.last7DaysStart || recDate > todayISO) return false;
        } else if (dateFilter === "THIS_MONTH") {
          if (recDate < dateRanges.last30DaysStart || recDate > todayISO) return false;
        } else if (dateFilter === "CUSTOM") {
          if (customStartDate && recDate < customStartDate) return false;
          if (customEndDate && recDate > customEndDate) return false;
        }
      }

      return true;
    });
  }, [
    sortedRecords,
    searchQuery,
    statusFilter,
    hospitalFilter,
    wardFilter,
    dateFilter,
    customStartDate,
    customEndDate,
    todayISO,
    dateRanges,
    recordCodeMap,
    processingDate,
    database,
    dispatchedKeys,
    unsentKeys,
    formData
  ]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDirection === "desc") {
        setSortDirection("asc");
      } else if (sortDirection === "asc") {
        setSortKey(null);
        setSortDirection(null);
      } else {
        setSortDirection("desc");
      }
    } else {
      setSortKey(key);
      setSortDirection(key === "id" ? "desc" : "asc");
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

  // Active filter chips calculation
  const activeFilters = useMemo(() => {
    const chips: { id: string; label: string; onRemove: () => void }[] = [];

    if (searchQuery && searchQuery.trim()) {
      chips.push({
        id: "search",
        label: `Search: "${searchQuery.trim()}"`,
        onRemove: () => handleSearchChange("")
      });
    }

    if (statusFilter !== "ALL") {
      chips.push({
        id: "status",
        label: `Status: ${statusFilter}`,
        onRemove: () => setStatusFilter("ALL")
      });
    }

    if (hospitalFilter !== "ALL") {
      chips.push({
        id: "hospital",
        label: `Hospital: ${hospitalFilter}`,
        onRemove: () => setHospitalFilter("ALL")
      });
    }

    if (wardFilter !== "ALL") {
      chips.push({
        id: "ward",
        label: `Ward: ${wardFilter}`,
        onRemove: () => setWardFilter("ALL")
      });
    }

    if (dateFilter !== "ALL") {
      let dateLabel = "Date";
      if (dateFilter === "TODAY") dateLabel = `Date: Today (${formatDate(todayISO)})`;
      else if (dateFilter === "THIS_WEEK") dateLabel = "Date: This Week (Last 7 Days)";
      else if (dateFilter === "THIS_MONTH") dateLabel = "Date: This Month (Last 30 Days)";
      else if (dateFilter === "CUSTOM") {
        dateLabel = `Date: ${customStartDate ? formatDate(customStartDate) : "Start"} → ${customEndDate ? formatDate(customEndDate) : "End"}`;
      }
      chips.push({
        id: "date",
        label: dateLabel,
        onRemove: () => {
          setDateFilter("ALL");
          setCustomStartDate("");
          setCustomEndDate("");
        }
      });
    }

    return chips;
  }, [searchQuery, statusFilter, hospitalFilter, wardFilter, dateFilter, customStartDate, customEndDate, todayISO]);

  const handleClearAllFilters = () => {
    handleSearchChange("");
    setStatusFilter("ALL");
    setHospitalFilter("ALL");
    setWardFilter("ALL");
    setDateFilter("ALL");
    setCustomStartDate("");
    setCustomEndDate("");
    setCurrentPage(1);
  };

  // Counts & Metrics
  const totalFilteredCount = filteredRecords.length;
  const totalOriginalCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : (database.length || 0);
  const isFiltered = activeFilters.length > 0 || totalFilteredCount !== totalOriginalCount;

  // Pagination calculation
  const effectivePageSize = pageSize === 0 ? (totalFilteredCount || 50) : pageSize;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalFilteredCount / effectivePageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = totalFilteredCount === 0 ? 0 : (safePage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalFilteredCount);

  // Paginated records slice to render in the table
  const paginatedRecords = useMemo(() => {
    if (pageSize === 0) return filteredRecords;
    return filteredRecords.slice(startIndex, endIndex);
  }, [filteredRecords, startIndex, endIndex, pageSize]);

  // Smart page number windowing (e.g. 1 ... 4 5 6 ... 32)
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (safePage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push("...");
      pages.push(totalPages);
    } else if (safePage >= totalPages - 3) {
      pages.push(1);
      pages.push("...");
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push("...");
      pages.push(safePage - 1);
      pages.push(safePage);
      pages.push(safePage + 1);
      pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, safePage]);

  const count = filteredRecords.length;
  const totalDbCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : (database.length || 889);
  const totalVouchersCount = vouchersDatabase.length > 0 ? vouchersDatabase.length : 174;

  const validFromDisplay = formData?.validFrom || processingDate || "07/07/2026";
  const validToDisplay = formData?.validTo || (processingDate ? addDays(processingDate, 6) : "13/07/2026");
  const selectedWard = formData?.ward || "Acorn Ward";

  // List of distinct wards in database for filter/dropdown
  const availableWards = allWardsList;

  const handleAction = async (record: CsvPermitRecord, sent: boolean, replacement = false) => {
    const key = String(record.formId ?? record.id ?? record.vrm);
    setBusyKey(key);
    try {
      if (replacement) await onSendRecord?.(record);
      else if (sent) await onUnsendRecord?.(record);
      else await onSendRecord?.(record);
    } finally {
      setBusyKey(null);
    }
  };

  const handleExportZip = () => {
    exportToExcel(filteredRecords, "Concessions_Permits_Export.xlsx");
  };

  const handleGoToPage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const pageNum = parseInt(goToPageInput, 10);
    if (!isNaN(pageNum)) {
      const clamped = Math.min(Math.max(1, pageNum), totalPages);
      setCurrentPage(clamped);
      setGoToPageInput("");
    }
  };

  return (
    <section className="w-full bg-white dark:bg-[#07172b] border border-slate-200 dark:border-[#183a5e] rounded-2xl p-4 md:p-6 shadow-sm dark:shadow-2xl text-slate-800 dark:text-slate-200 transition-colors">
      {/* Top Header Section */}
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-200 dark:border-[#143252]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white shrink-0">
              <Send className="w-5 h-5 -rotate-45" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Permit Dispatch Centre</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">Select recipients and dispatch emails via Outlook</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Outlook info badge */}
            <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-[#0b2138] border border-blue-200 dark:border-[#1b436c] text-blue-700 dark:text-[#93c5fd] text-xs px-3 py-1.5 rounded-lg select-none">
              <Mail className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Select recipients and dispatch emails via Outlook</span>
            </div>
          </div>
        </div>

        {/* Filter Controls Toolbar */}
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Box - grows to fill remaining space */}
            <div className="relative flex-1 min-w-[220px]">
              <div className="flex items-center w-full bg-slate-50 dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] focus-within:border-blue-500 dark:focus-within:border-[#1677FF] focus-within:ring-2 focus-within:ring-blue-500/20 dark:focus-within:ring-[#1677FF]/20 rounded-xl px-3 py-2 transition shadow-inner">
                <Search className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 mr-2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search driver, VRN, hospital, voucher..."
                  className="w-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none font-normal"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => handleSearchChange("")}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5 rounded transition cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Status Filter - sized to content */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-9.5 pl-3 pr-8 bg-slate-50 dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] text-slate-900 dark:text-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500 transition appearance-none cursor-pointer"
              >
                <option value="ALL">Status: All</option>
                <option value="PENDING">PENDING</option>
                <option value="SENT">SENT</option>
                <option value="UNSENT">UNSENT</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            {/* Hospital Filter - sized to content */}
            <div className="relative">
              <select
                value={hospitalFilter}
                onChange={(e) => setHospitalFilter(e.target.value)}
                className="h-9.5 pl-3 pr-8 bg-slate-50 dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] text-slate-900 dark:text-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500 transition appearance-none cursor-pointer truncate"
              >
                <option value="ALL">Hospital: All</option>
                {allHospitalsList.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            {/* Ward Filter - sized to content */}
            <div className="relative">
              <select
                value={wardFilter}
                onChange={(e) => setWardFilter(e.target.value)}
                className="h-9.5 pl-3 pr-8 bg-slate-50 dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] text-slate-900 dark:text-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500 transition appearance-none cursor-pointer truncate"
              >
                <option value="ALL">Ward: All</option>
                {allWardsList.map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            {/* Date Filter - sized to content */}
            <div className="relative">
              <select
                id="date-filter-dropdown"
                value={dateFilter}
                onChange={(e) => {
                  const next = e.target.value as "ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";
                  setDateFilter(next);
                  if (next === "THIS_WEEK") {
                    onDateRangeFilterChange?.("7days");
                  } else if (next === "THIS_MONTH") {
                    onDateRangeFilterChange?.("30days");
                  } else {
                    onDateRangeFilterChange?.("all");
                  }
                  if (next === "ALL") {
                    setCustomStartDate("");
                    setCustomEndDate("");
                  }
                }}
                className="h-9.5 pl-3 pr-8 bg-slate-50 dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] text-slate-900 dark:text-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500 transition appearance-none cursor-pointer"
              >
                <option value="ALL">{isLoadingHistory ? "Loading..." : "Date: All Time"}</option>
                <option value="TODAY">Today</option>
                <option value="THIS_WEEK">This Week</option>
                <option value="THIS_MONTH">This Month</option>
                <option value="CUSTOM">Custom Range</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Custom Date Range Picker Sub-Bar */}
          {dateFilter === "CUSTOM" && (
            <div className="flex flex-wrap items-center gap-3 p-2.5 bg-blue-50/70 dark:bg-[#0b2138] border border-blue-200 dark:border-[#183d63] rounded-xl text-xs animate-in fade-in">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
                <span>Custom Date Range:</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">From:</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2.5 py-1 bg-white dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] rounded-lg text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">To:</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2.5 py-1 bg-white dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] rounded-lg text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
              {(customStartDate || customEndDate) && (
                <button
                  type="button"
                  onClick={() => { setCustomStartDate(""); setCustomEndDate(""); }}
                  className="text-[11px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 underline font-semibold cursor-pointer ml-1"
                >
                  Reset Dates
                </button>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Main Table Section */}
      <div className="w-full mt-4 border border-slate-200 dark:border-[#163657] rounded-xl bg-white dark:bg-[#061424] overflow-hidden shadow-xs dark:shadow-inner">
        <div className="overflow-x-auto w-full">
          <table className="min-w-[1180px] w-full text-xs text-left border-collapse table-auto">
            <thead className="bg-slate-50 dark:bg-[#081b30] border-b border-slate-200 dark:border-[#163657] text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-10 select-none">
              <tr>
                {/* # Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("id")}
                  className={`py-3 px-3 text-center w-12 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "id" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Number"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>#</span>
                    {renderSortIndicator("id")}
                  </div>
                </th>

                {/* SUBMITTED Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("submitted")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "submitted" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Submitted timestamp"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>SUBMITTED</span>
                    {renderSortIndicator("submitted")}
                  </div>
                </th>

                {/* DRIVER'S NAME Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("driverName")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "driverName" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Driver's Name"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>DRIVER'S NAME</span>
                    {renderSortIndicator("driverName")}
                  </div>
                </th>

                {/* VRM Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("vrm")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "vrm" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by VRM"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VRM</span>
                    {renderSortIndicator("vrm")}
                  </div>
                </th>

                {/* VOUCHER CODE Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("voucherCode")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "voucherCode" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Voucher Code"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VOUCHER CODE</span>
                    {renderSortIndicator("voucherCode")}
                  </div>
                </th>

                {/* VALID FROM Column */}
                <th 
                  scope="col" 
                  onClick={() => handleSort("validFrom")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "validFrom" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "validTo" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "ward" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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
                  className={`py-3 px-3.5 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap min-w-[185px] cursor-pointer transition-colors group select-none ${
                    sortKey === "hospital" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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
                  className={`py-3 px-3 text-center border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none ${
                    sortKey === "status" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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
                    sortKey === "actions" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-black" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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
            <tbody className="divide-y divide-slate-100 dark:divide-[#102947]">
              {paginatedRecords.map((record, pIdx) => {
                const index = startIndex + pIdx;
                const recordIso = parseDateToISO(record.dateRequired || record.validFrom);
                const expiresIso = recordIso ? addDays(recordIso, 6) : "";

                const reqDate = getRequestedPermitDateISO(record, processingDate);
                const isBlocked = isVrmSilentBlockedSync(record.vrm);
                const isCancelled = isRecordCancelled(record, reqDate, database);
                const recordKey = String(record.formId ?? record.id ?? index);
                let displayCode = recordCodeMap.get(recordKey);

                if (isBlocked || isCancelled) {
                  displayCode = "CANCELLED";
                } else if (displayCode === undefined || displayCode === null || displayCode === "CANCELLED" || displayCode === "BLOCKED") {
                  const rawCode = (record.voucherCode || (customVouchers && (customVouchers[recordKey] || (record.vrm && customVouchers[`${record.vrm.toUpperCase().replace(/\s+/g, "")}_${reqDate}`]))) || "").trim();
                  displayCode = (rawCode && rawCode.toUpperCase() !== "CANCELLED" && rawCode.toUpperCase() !== "BLOCKED") ? rawCode : "-";
                }
                const rowKey = String(record.formId ?? record.id ?? record.vrm ?? index);

                const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
                const recordKeys = getRecordKeys(record);
                const isUnsent = Boolean(unsentKeys && unsentKeys.length > 0 && (unsentKeys.includes(rowKey) || recordKeys.some(k => unsentKeys.includes(k))));
                const replacementPending = !isBlocked && isReplacementPending(record);

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
                const hospitalDisplay = getHospital(record);

                return (
                  <tr 
                    key={`dispatch_${rowKey}_${index}`}
                    onClick={() => onSelectRecord(record)}
                    className="hover:bg-blue-50/50 dark:hover:bg-[#0c233d]/70 transition-colors cursor-pointer text-slate-800 dark:text-slate-200"
                  >
                    {/* 1. # Column */}
                    <td className="py-3 px-3 text-center text-slate-500 dark:text-slate-400 font-mono font-medium border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {excelId}
                    </td>

                    {/* 2. Submitted Column */}
                    <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-xs">
                      {formatSubmittedDateTime(record)}
                    </td>

                    {/* 3. Driver's Name Column */}
                    <td className="py-3 px-3 font-medium text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {record.driverName || "-"}
                    </td>

                    {/* 4. VRN Column */}
                    <td className="py-3 px-3 font-mono font-medium text-slate-900 dark:text-white uppercase tracking-wider border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {record.vrm ? record.vrm.toUpperCase() : "-"}
                    </td>

                    {/* 5. VOUCHERCODE Column */}
                    <td className="py-3 px-3 font-mono border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {(isBlocked || isCancelled || displayCode === "CANCELLED") ? (
                        <span className="text-red-600 dark:text-[#FF453A] font-semibold tracking-wider">
                          CANCELLED
                        </span>
                      ) : (
                        <span className="text-slate-800 dark:text-slate-200">
                          {displayCode || "-"}
                        </span>
                      )}
                    </td>

                    {/* 6. VALID FROM Column */}
                    <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {formatDate(record.dateRequired || record.validFrom)}
                    </td>

                    {/* 7. VALID TO Column */}
                    <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {formatDate(expiresIso)}
                    </td>

                    {/* 8. WARD Column */}
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap">
                      {record.ward || "-"}
                    </td>

                    {/* 9. HOSPITAL Column */}
                    <td className="py-3 px-3.5 text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap min-w-[185px]">
                      {hospitalDisplay}
                    </td>

                    {/* 10. STATUS Column */}
                    <td className="py-3 px-3 text-center border-r border-slate-100 dark:border-[#102947]/60 select-none whitespace-nowrap">
                      {isBlocked ? (
                        <span className="border border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          BLOCKED
                        </span>
                      ) : replacementPending ? (
                        <span className="border border-purple-300 dark:border-[#a855f7]/40 bg-purple-50 dark:bg-[#a855f7]/15 text-purple-700 dark:text-[#c084fc] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          REPLACEMENT
                        </span>
                      ) : isDispatched ? (
                        <span className="border border-emerald-300 dark:border-[#32D74B]/40 bg-emerald-50 dark:bg-[#32D74B]/15 text-emerald-700 dark:text-[#32D74B] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center gap-1 whitespace-nowrap">
                          <span>✅</span>
                          <span>SENT</span>
                        </span>
                      ) : isUnsent ? (
                        <span className="border border-sky-300 dark:border-[#42A5F5]/40 bg-sky-50 dark:bg-[#42A5F5]/15 text-sky-700 dark:text-[#42A5F5] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          UNSENT
                        </span>
                      ) : (
                        <span className="border border-amber-300 dark:border-[#FF9F0A]/40 bg-amber-50 dark:bg-[#FF9F0A]/15 text-amber-700 dark:text-[#FF9F0A] font-bold px-2.5 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          PENDING
                        </span>
                      )}
                    </td>

                    {/* 11. ACTIONS Column */}
                    <td className="py-3 px-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-center rounded-md overflow-hidden shadow-xs">
                        <button 
                          type="button" 
                          disabled={busyKey === rowKey || isBlocked} 
                          onClick={() => { if (!isBlocked) handleAction(record, isDispatched, replacementPending); }} 
                          title={isBlocked ? "This VRM is on the Manage Blocklist — dispatch disabled" : undefined}
                          className={`flex items-center gap-1 px-3 py-1 text-white text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
                            isBlocked
                              ? "bg-slate-400 dark:bg-slate-700 cursor-not-allowed opacity-60"
                              : "cursor-pointer " + (replacementPending
                                  ? "bg-[#7c3aed] hover:bg-[#6d28d9]"
                                  : isDispatched
                                    ? "bg-[#dc2626] hover:bg-[#b91c1c]"
                                    : "bg-[#1d75f2] hover:bg-[#1565d8]")
                          }`}
                        >
                          {busyKey === rowKey ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Mail className="w-3 h-3" />
                          )}
                          <span>{isBlocked ? "UNSEND" : (replacementPending ? "Resend" : (isDispatched ? "Unsend" : "Send"))}</span>
                        </button>
                        <button 
                          type="button" 
                          disabled={isBlocked}
                          onClick={() => { if (!isBlocked) onSelectRecord(record); }} 
                          className={`px-1.5 py-1 text-white transition-colors ${
                            isBlocked
                              ? "bg-slate-500/80 dark:bg-slate-600/80 cursor-not-allowed opacity-60 border-l border-slate-600"
                              : "cursor-pointer " + (replacementPending
                                ? "bg-[#6d28d9] hover:bg-[#5b21b6] border-l border-[#5b21b6]"
                                : isDispatched
                                  ? "bg-[#b91c1c] hover:bg-[#991b1b] border-l border-[#991b1b]"
                                  : "bg-[#1565d8] hover:bg-[#0f4eb0] border-l border-[#0f4eb0]")
                          }`}
                          title={isBlocked ? "Disabled" : "Select Record"}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500 dark:text-slate-400 text-xs">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Filter className="w-6 h-6 text-slate-400 stroke-1" />
                      <p className="font-semibold text-sm text-slate-700 dark:text-slate-300">No matching permits found</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {isFiltered ? "Try adjusting or clearing your active filters." : `No records found for date ${formatDate(processingDate)}.`}
                      </p>
                      {isFiltered && (
                        <button
                          type="button"
                          onClick={handleClearAllFilters}
                          className="mt-2 px-3 py-1.5 text-xs bg-blue-50 dark:bg-[#0c2847] text-blue-600 dark:text-[#38bdf8] hover:bg-blue-100 rounded-lg font-medium border border-blue-200 dark:border-[#1e436c] transition cursor-pointer"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5 mt-3 px-1 text-xs text-slate-600 dark:text-slate-300">
        {/* Left: Row counts + Page size selector */}
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
          <div className="font-medium text-slate-700 dark:text-slate-300">
            Showing <span className="font-bold text-slate-900 dark:text-white">{totalFilteredCount === 0 ? 0 : (startIndex + 1).toLocaleString()}</span>
            {" – "}
            <span className="font-bold text-slate-900 dark:text-white">{endIndex.toLocaleString()}</span> of{" "}
            <span className="font-bold text-slate-900 dark:text-white">{totalFilteredCount.toLocaleString()}</span> permits
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 bg-white dark:bg-[#071b30] border border-slate-300 dark:border-[#1d436e] rounded-md text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={0}>All ({totalFilteredCount})</option>
            </select>
          </div>
        </div>

        {/* Right: Page navigation controls */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-end">
            {/* Previous Page Button */}
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium text-xs transition cursor-pointer ${
                safePage <= 1
                  ? "opacity-40 cursor-not-allowed bg-slate-100 dark:bg-[#061424] border-slate-200 dark:border-[#122b47] text-slate-400"
                  : "bg-white dark:bg-[#071b30] hover:bg-slate-100 dark:hover:bg-[#0c2847] border-slate-300 dark:border-[#1e436c] text-slate-700 dark:text-slate-200 shadow-2xs"
              }`}
              title="Previous Page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>

            {/* Page number buttons */}
            <div className="inline-flex items-center gap-1">
              {pageNumbers.map((p, idx) => {
                if (typeof p === "string") {
                  return (
                    <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-bold select-none">
                      ...
                    </span>
                  );
                }
                const isActive = p === safePage;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCurrentPage(p)}
                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      isActive
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                        : "bg-white dark:bg-[#071b30] hover:bg-slate-100 dark:hover:bg-[#0c2847] border border-slate-300 dark:border-[#1e436c] text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            {/* Next Page Button */}
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium text-xs transition cursor-pointer ${
                safePage >= totalPages
                  ? "opacity-40 cursor-not-allowed bg-slate-100 dark:bg-[#061424] border-slate-200 dark:border-[#122b47] text-slate-400"
                  : "bg-white dark:bg-[#071b30] hover:bg-slate-100 dark:hover:bg-[#0c2847] border-slate-300 dark:border-[#1e436c] text-slate-700 dark:text-slate-200 shadow-2xs"
              }`}
              title="Next Page"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {/* Go to page form */}
            <form onSubmit={handleGoToPage} className="flex items-center gap-1 ml-1 sm:ml-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Go to:</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={goToPageInput}
                onChange={(e) => setGoToPageInput(e.target.value)}
                placeholder={`${safePage}`}
                className="w-12 h-8 px-1.5 text-center bg-white dark:bg-[#071b30] border border-slate-300 dark:border-[#1e436c] rounded-lg text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="h-8 px-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#0c2847] dark:hover:bg-[#12365e] border border-slate-300 dark:border-[#1e436c] text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                Go
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Footer Controls Bar Inside Card */}
      <div className="bg-slate-50 dark:bg-[#051322] border border-slate-200 dark:border-[#143252] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 mt-4 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          {/* Actions Button */}
          <div className="relative">
            <button 
              type="button"
              onClick={() => setActionsOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 dark:bg-[#071b30] dark:hover:bg-[#0d2745] border border-slate-300 dark:border-[#1e436c] rounded-md text-slate-800 dark:text-white font-medium text-xs transition-colors shadow-xs cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
              <span>Actions</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
            {actionsOpen && (
              <div className="absolute left-0 bottom-full mb-1 w-48 bg-white dark:bg-[#091e34] border border-slate-200 dark:border-[#1d436e] rounded-lg shadow-xl py-1 z-30 text-xs">
                <button 
                  type="button" 
                  onClick={() => { setActionsOpen(false); handleExportZip(); }} 
                  className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#132e4d] flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Export Excel
                </button>
                <button 
                  type="button" 
                  onClick={() => { setActionsOpen(false); handleExportZip(); }} 
                  className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#132e4d] flex items-center gap-2 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Export All ZIP
                </button>
              </div>
            )}
          </div>

          {/* Clear Form Button */}
          <button 
            type="button"
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 dark:bg-[#071b30] dark:hover:bg-[#0d2745] border border-slate-300 dark:border-[#1e436c] rounded-md text-slate-800 dark:text-white font-medium text-xs transition-colors shadow-xs cursor-pointer"
          >
            <XSquare className="w-3.5 h-3.5 text-slate-400" />
            <span>Clear Form</span>
          </button>

          {/* Valid From */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
            <span className="text-slate-700 dark:text-slate-300 font-medium">Valid From</span>
            <span className="bg-white dark:bg-[#071b30] border border-slate-300 dark:border-[#1e436c] px-2.5 py-1 rounded text-slate-900 dark:text-white font-mono text-xs flex items-center gap-1.5 shadow-2xs">
              <Calendar className="w-3 h-3 text-slate-400" />
              {formatDate(validFromDisplay)}
            </span>
          </div>

          {/* Valid To */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
            <span className="text-slate-700 dark:text-slate-300 font-medium">Valid To</span>
            <span className="bg-white dark:bg-[#071b30] border border-slate-300 dark:border-[#1e436c] px-2.5 py-1 rounded text-slate-900 dark:text-white font-mono text-xs flex items-center gap-1.5 shadow-2xs">
              <Calendar className="w-3 h-3 text-slate-400" />
              {formatDate(validToDisplay)}
            </span>
          </div>

          {/* Ward / Department */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-700 dark:text-slate-300 font-medium">Ward / Department</span>
            <div className="relative">
              <button 
                type="button" 
                onClick={() => setWardDropdownOpen(v => !v)}
                className="bg-white hover:bg-slate-100 dark:bg-[#071b30] dark:hover:bg-[#0d2745] border border-slate-300 dark:border-[#1e436c] px-2.5 py-1 rounded text-slate-800 dark:text-white text-xs flex items-center gap-1.5 font-medium transition-colors shadow-2xs cursor-pointer"
              >
                <Building2 className="w-3 h-3 text-slate-400" />
                <span>{selectedWard}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>
              {wardDropdownOpen && (
                <div className="absolute left-0 bottom-full mb-1 w-52 max-h-48 overflow-y-auto bg-white dark:bg-[#091e34] border border-slate-200 dark:border-[#1d436e] rounded-lg shadow-xl py-1 z-30 text-xs">
                  {availableWards.map(w => (
                    <button 
                      key={w} 
                      type="button" 
                      onClick={() => { setWardDropdownOpen(false); onChangeFormData?.({ ward: w }); }} 
                      className="w-full text-left px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#132e4d] cursor-pointer"
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
      <div className="flex flex-wrap items-center gap-6 px-2 py-3 text-xs text-slate-500 dark:text-slate-400 font-medium select-none">
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
          <span>{totalDbCount} records · {totalVouchersCount} vouchers</span>
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
          <span>v3.4 Elite · {formatDate(processingDate || "07/07/2026")}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-[#38bdf8]" />
          <span>Secure QR</span>
        </span>
      </div>
    </section>
  );
}
