import React, { useMemo, useState, useEffect, useCallback } from "react";
import { 
  ChevronDown, 
  ChevronLeft,
  ChevronRight,
  Mail, 
  Send, 
  Navigation,
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
  Filter,
  FileSpreadsheet,
  FileText,
  Pencil
} from "lucide-react";
import { 
  CsvPermitRecord, 
  ParsedVoucherData, 
  parseDateToISO, 
  parseDateRange,
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
  getRecordSubmittedDateISO,
  getTodayISO,
  formatSubmittedDateTime,
  getRecordSubmittedTimeMs,
  getMatchingPermits,
  getUnusedVouchersForDate,
  getSpreadsheetMatchingAssignedCodes,
  getVoucherDateISO,
  cleanVoucherCodeValue,
  isVoucherCodeMatch,
  isVoucherInValidityPeriod,
  toTitleCase,
  isValidVRM,
  isLikelyDriverName,
  cleanVrm
} from "../utils/csvParser";
import { checkIsRecordDispatched } from "../utils/dispatchUtils";
import { isVrmSilentBlockedSync } from "../lib/blocklist";
// ⭐ FIX: Import canonical date & voucher matching functions from voucherValidation
import {
  isVoucherForPermitDateRange,
  getVoucherValidFromISO,
  getVoucherValidToISO,
  normalizeDateToISO
} from "../utils/voucherValidation";

// ⭐ FIX: Re-export isVoucherForPermitDateRange so other files importing from DispatchCentre don't break
export { isVoucherForPermitDateRange };

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
  onBrowseConcessions?: () => void;
  onBrowseVouchers?: () => void;
  onEditRecord?: (record: CsvPermitRecord) => void;
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
  dateRangeFilter,
  onDateRangeFilterChange,
  isLoadingHistory,
  onBrowseConcessions,
  onBrowseVouchers,
  onEditRecord
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

  // Target ISO for Active Date Codes dropdown
  const targetIso = useMemo(() => {
    if (formData) {
      const permitIso = getRequestedPermitDateISO(formData as any);
      if (permitIso && /^\d{4}-\d{2}-\d{2}$/.test(permitIso)) {
        return permitIso;
      }
      const formDateIso = formData.todayDate ? parseDateToISO(String(formData.todayDate)) : "";
      if (formDateIso && /^\d{4}-\d{2}-\d{2}$/.test(formDateIso)) {
        return formDateIso;
      }
    }
    const procIso = processingDate ? parseDateToISO(processingDate) : "";
    if (procIso && /^\d{4}-\d{2}-\d{2}$/.test(procIso)) {
      return procIso;
    }
    return getTodayISO();
  }, [formData?.validFrom, formData?.dateRequired, formData?.startTime, formData?.createdAt, formData?.todayDate, processingDate]);

  // Matching permits for the active date
  const matchingPermits = useMemo(() => {
    if (!targetIso) return [];
    return getMatchingPermits(database, targetIso);
  }, [database, targetIso]);

  const [blocklistVersion, setBlocklistVersion] = useState<number>(0);
  useEffect(() => {
    const handleBlocklistUpdate = () => {
      setBlocklistVersion(v => v + 1);
    };
    window.addEventListener("blocklist_updated", handleBlocklistUpdate);
    return () => window.removeEventListener("blocklist_updated", handleBlocklistUpdate);
  }, []);

  // Base records
  const baseRecords = useMemo(() => {
    return sortRecordsByFormIdDesc(database);
  }, [database]);

  // Compute dynamic voucher allocations map
  const recordCodeMap = useMemo(() => {
    return getSpreadsheetMatchingAllocationsMap(
      baseRecords,
      database,
      processingDate,
      vouchersDatabase,
      customVouchers
    );
  }, [baseRecords, database, processingDate, vouchersDatabase, customVouchers, blocklistVersion]);

  // Assigned voucher codes set across the concessions database, custom allocations, AND recordCodeMap
  const assignedVoucherCodesSet = useMemo(() => {
    const set = new Set<string>();

    // 1. Include allocations from recordCodeMap (canonical allocation source)
    if (recordCodeMap) {
      recordCodeMap.forEach((code) => {
        if (code && typeof code === "string") {
          const clean = cleanVoucherCodeValue(code).toUpperCase();
          if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "PENDING" && clean !== "BLOCKED") {
            set.add(clean);
          }
        }
      });
    }

    // 2. Include database records
    (database || []).forEach(rec => {
      // Cancelled or blocked permits MUST NOT consume a voucher - they release their codes back to inventory
      const reqDate = getRequestedPermitDateISO(rec, processingDate);
      const isBlocked = isVrmSilentBlockedSync(rec.vrm);
      const isCancelled = rec.isCancelled === true ||
                          (typeof rec.status === "string" && rec.status.toLowerCase().includes("cancel")) ||
                          rec.voucherCode === "CANCELLED" ||
                          rec.prePaidCode === "CANCELLED" ||
                          isRecordCancelled(rec, reqDate, database);
      if (isBlocked || isCancelled) {
        return;
      }

      const raw = rec.voucherCode || rec.prePaidCode || "";
      if (raw && typeof raw === "string") {
        const clean = cleanVoucherCodeValue(raw).toUpperCase();
        if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "PENDING" && clean !== "N/A" && clean !== "BLOCKED") {
          set.add(clean);
        }
      }
    });

    // 3. Include customVouchers
    if (customVouchers) {
      Object.entries(customVouchers).forEach(([key, raw]) => {
        if (raw && typeof raw === "string") {
          const clean = cleanVoucherCodeValue(raw).toUpperCase();
          if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "PENDING" && clean !== "N/A" && clean !== "BLOCKED") {
            const matchingRec = (database || []).find(r => 
              String(r.formId) === key || String(r.id) === key
            );
            if (matchingRec) {
              const reqDate = getRequestedPermitDateISO(matchingRec, processingDate);
              if (isVrmSilentBlockedSync(matchingRec.vrm) || isRecordCancelled(matchingRec, reqDate, database)) {
                return;
              }
            }
            set.add(clean);
          }
        }
      });
    }

    return set;
  }, [database, customVouchers, processingDate, recordCodeMap]);

  // Current permit exact validFrom and validTo ISO matching
  const currentPermitValidFromIso = useMemo(() => {
    if (formData?.id || formData?.formId) {
      const rec = (database || []).find(r => 
        (formData.id && r.id === formData.id) || 
        (formData.formId && r.formId === formData.formId)
      );
      if (rec) {
        const iso = getRequestedPermitDateISO(rec);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
      }
    }
    if (formData?.validFrom) {
      const iso = parseDateToISO(String(formData.validFrom));
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    if (formData?.dateRequired) {
      const iso = getRequestedPermitDateISO(formData);
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    if (formData?.vrm && database && database.length > 0) {
      const cleanVrm = String(formData.vrm).toUpperCase().replace(/\s+/g, "");
      const rec = database.find(r => r?.vrm && String(r.vrm).toUpperCase().replace(/\s+/g, "") === cleanVrm);
      if (rec) {
        const iso = getRequestedPermitDateISO(rec);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
      }
    }
    if (matchingPermits && matchingPermits.length > 0) {
      const targetVrm = formData?.vrm ? String(formData.vrm).toUpperCase().replace(/\s+/g, "") : "";
      const candidate = (targetVrm && matchingPermits.find(p => p?.vrm && String(p.vrm).toUpperCase().replace(/\s+/g, "") === targetVrm)) || matchingPermits[0];
      const iso = getRequestedPermitDateISO(candidate);
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    if (database && database.length > 0) {
      const iso = getRequestedPermitDateISO(database[0]);
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    if (targetIso && /^\d{4}-\d{2}-\d{2}$/.test(targetIso)) {
      return targetIso;
    }
    return "";
  }, [formData?.id, formData?.formId, formData?.validFrom, formData?.dateRequired, formData?.vrm, database, matchingPermits, targetIso]);

  const currentPermitValidToIso = useMemo(() => {
    if (formData?.id || formData?.formId) {
      const rec = (database || []).find(r => 
        (formData.id && r.id === formData.id) || 
        (formData.formId && r.formId === formData.formId)
      );
      if (rec) {
        if (rec.validTo) {
          const iso = parseDateToISO(String(rec.validTo));
          if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
        }
        if (rec.dateExpiry) {
          const iso = parseDateToISO(String(rec.dateExpiry));
          if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
        }
      }
    }
    if (formData?.validTo) {
      const iso = parseDateToISO(String(formData.validTo));
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    if (matchingPermits && matchingPermits.length > 0) {
      const targetVrm = formData?.vrm ? String(formData.vrm).toUpperCase().replace(/\s+/g, "") : "";
      const candidate = (targetVrm && matchingPermits.find(p => p?.vrm && String(p.vrm).toUpperCase().replace(/\s+/g, "") === targetVrm)) || matchingPermits[0];
      const rawTo = candidate?.validTo || candidate?.dateExpiry;
      if (rawTo) {
        const iso = parseDateToISO(String(rawTo));
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
      }
    }
    if (currentPermitValidFromIso) {
      return addDays(currentPermitValidFromIso, 6);
    }
    return "";
  }, [formData?.id, formData?.formId, formData?.validTo, database, matchingPermits, currentPermitValidFromIso]);

  // Helper to check if a voucher matches the permit's validity period
  const hasDatedVouchersForDate = useMemo(() => {
    if (!vouchersDatabase || vouchersDatabase.length === 0 || !currentPermitValidFromIso) return false;
    return vouchersDatabase.some(v => isVoucherForPermitDateRange(v, currentPermitValidFromIso, currentPermitValidToIso));
  }, [vouchersDatabase, currentPermitValidFromIso, currentPermitValidToIso]);

  const isVoucherMatchingPeriod = useCallback((v: ParsedVoucherData | undefined | null): boolean => {
    return isVoucherForPermitDateRange(v, currentPermitValidFromIso, currentPermitValidToIso);
  }, [currentPermitValidFromIso, currentPermitValidToIso]);

  // Unused vouchers computation for the active date with exact validFrom/validTo matching
  const unusedVouchersForDay = useMemo<ParsedVoucherData[]>(() => {
    if (!currentPermitValidFromIso || !vouchersDatabase || vouchersDatabase.length === 0) {
      return [];
    }

    // Filter vouchers that strictly match the current selected permit's date range (ValidFrom - ValidTo)
    const matchingRangeVouchers = vouchersDatabase.filter(v => {
      return isVoucherForPermitDateRange(v, currentPermitValidFromIso, currentPermitValidToIso);
    });

    return matchingRangeVouchers.filter(v => {
      if (v.isUsed === true || v.status === "used" || v.status === "dispatched") {
        return false;
      }
      const codeUpper = cleanVoucherCodeValue(v.code).toUpperCase();
      if (!codeUpper || codeUpper === "-" || codeUpper === "CANCELLED" || codeUpper === "PENDING") {
        return false;
      }
      return !assignedVoucherCodesSet.has(codeUpper);
    });
  }, [
    vouchersDatabase,
    currentPermitValidFromIso,
    currentPermitValidToIso,
    assignedVoucherCodesSet
  ]);

  // Exact range voucher stock metrics for Active Date Codes dropdown badge
  const totalForThisRange = useMemo(() => {
    if (!currentPermitValidFromIso || !vouchersDatabase || vouchersDatabase.length === 0) {
      return 0;
    }
    return vouchersDatabase.filter(v => isVoucherForPermitDateRange(v, currentPermitValidFromIso, currentPermitValidToIso)).length;
  }, [vouchersDatabase, currentPermitValidFromIso, currentPermitValidToIso]);

  const remainingForThisRange = unusedVouchersForDay.length;
  const percentRemaining = totalForThisRange > 0
    ? (remainingForThisRange / totalForThisRange) * 100
    : 0;
  const isRangeStockLow = totalForThisRange === 0 || remainingForThisRange <= 5 || percentRemaining <= 5;

  const handleActiveDateCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedCode = cleanVoucherCodeValue(e.target.value).toUpperCase();
    if (!selectedCode || selectedCode === "-" || selectedCode === "CANCELLED") {
      return;
    }

    const codeFields = [
      "voucherCode",
      "prePaidCode",
      "qrCode",
      "voucherCodesText",
      "serialNumber",
      "voucher",
      "code",
      "qrOverride",
      "Voucher Code",
      "VOUCHER CODE",
      "Pre-Paid Code",
      "Pre Paid Code",
      "QR Code",
      "QR CODE"
    ];

    const isCodeAssigned = (record: any) => {
      if (!record) return false;

      return codeFields.some((field) => {
        const raw = record[field];
        if (raw === undefined || raw === null) return false;

        return String(raw)
          .split(/[\n,;\s]+/)
          .map((part) => cleanVoucherCodeValue(part).toUpperCase())
          .some((code) => code && code !== "-" && isVoucherCodeMatch(code, selectedCode));
      });
    };

    const alreadyAssigned =
      (database || []).some(isCodeAssigned) || (formData && isCodeAssigned(formData));

    if (alreadyAssigned) {
      console.warn(
        `🚫 Voucher ${selectedCode} is already assigned and cannot be reused.`
      );
      return;
    }

    onChangeFormData?.({
      voucherCodesText: selectedCode,
      status: "Pending",
      emailType: "RESEND_CONCESSION",
      isResend: true,
      emailTemplate: "replacement"
    });
  };

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Dropdown filter states
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "SENT" | "CANCELLED" | "BLOCKED" | "REPLACEMENT">("ALL");
  const [hospitalFilter, setHospitalFilter] = useState<string>("ALL");
  const [wardFilter, setWardFilter] = useState<string>("ALL");
  // ⭐ FIX: Restore default filter to "This Week"
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM">("THIS_WEEK");

  useEffect(() => {
    // Don't let the parent's fetch-range prop clobber a local "Today" or "Custom Range"
    // selection — both legitimately map to onDateRangeFilterChange("all") for data-fetching
    // purposes, but that shouldn't reset the user's actual filter choice back to "ALL".
    if (dateFilter === "TODAY" || dateFilter === "CUSTOM") return;
    if (dateRangeFilter === "7days") setDateFilter("THIS_WEEK");
    else if (dateRangeFilter === "30days") setDateFilter("THIS_MONTH");
    else if (dateRangeFilter === "all") setDateFilter("ALL");
  }, [dateRangeFilter]);
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [goToPageInput, setGoToPageInput] = useState<string>("");

  const isSameSelectedRecord = (record: CsvPermitRecord) => {
    if (!formData) return false;

    const recordId = String(record.id ?? "").trim();
    const recordFormId = String(record.formId ?? "").trim();
    const selectedId = String(formData.id ?? "").trim();
    const selectedFormId = String(formData.formId ?? "").trim();

    const recordHasStableId = Boolean(recordId || recordFormId);
    const selectedHasStableId = Boolean(selectedId || selectedFormId);

    if (recordHasStableId || selectedHasStableId) {
      return Boolean(
        (recordId && selectedId && recordId === selectedId) ||
        (recordFormId && selectedFormId && recordFormId === selectedFormId) ||
        (recordId && selectedFormId && recordId === selectedFormId) ||
        (recordFormId && selectedId && recordFormId === selectedId)
      );
    }

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

  const getHospital = (record: CsvPermitRecord) => {
    const raw = (record?.hospital || "").trim();
    if (raw && !raw.toLowerCase().includes("royal london")) {
      return raw;
    }
    const ward = (record?.ward || "").toLowerCase();
    return (
      ward.includes("acorn") || 
      ward.includes("acacia") || 
      ward.includes("mulberry")
    ) ? "Whipps Cross Hospital" : "Newham Hospital";
  };

  const getIsCancelled = (record: CsvPermitRecord, idx?: number) => {
    if (!record) return false;
    if (record.isCancelled === true) return true;
    if (typeof record.status === "string" && record.status.trim().toLowerCase().includes("cancel")) return true;
    if (
      record.voucherCode === "CANCELLED" ||
      record.voucherCodesText === "CANCELLED" ||
      record.prePaidCode === "CANCELLED" ||
      (typeof record.voucherCode === "string" && record.voucherCode.trim().toUpperCase() === "CANCELLED") ||
      (typeof record.voucherCodesText === "string" && record.voucherCodesText.trim().toUpperCase() === "CANCELLED") ||
      (typeof record.prePaidCode === "string" && record.prePaidCode.trim().toUpperCase() === "CANCELLED")
    ) {
      return true;
    }
    const reqDate = getRequestedPermitDateISO(record, processingDate);
    return isRecordCancelled(record, reqDate, database);
  };

  const getStatusStr = (record: CsvPermitRecord, idx?: number) => {
    if (!record) return "PENDING";
    if (isVrmSilentBlockedSync(record.vrm)) return "BLOCKED";
    if (getIsCancelled(record, idx)) return "CANCELLED";
    if (isReplacementPending(record)) return "REPLACEMENT";
    const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
    if (isDispatched) return "SENT";
    return "PENDING";
  };

  // ⭐ PERFORMANCE OPTIMIZATION: Pre-index vouchersDatabase for O(1) table row and sort evaluations
  const voucherIndex = useMemo(() => {
    const codeMap = new Map<string, ParsedVoucherData[]>();
    const periodMap = new Map<string, ParsedVoucherData[]>();
    const stockCache = new Map<string, { total: number; remaining: number }>();

    (vouchersDatabase || []).forEach(v => {
      if (!v || !v.code) return;
      const clean = cleanVoucherCodeValue(v.code).toUpperCase();
      if (!clean) return;

      let cList = codeMap.get(clean);
      if (!cList) {
        cList = [];
        codeMap.set(clean, cList);
      }
      cList.push(v);

      const pKey = `${v.validFrom || ""}_${v.validTo || ""}`;
      let pList = periodMap.get(pKey);
      if (!pList) {
        pList = [];
        periodMap.set(pKey, pList);
      }
      pList.push(v);
    });

    return { codeMap, periodMap, stockCache };
  }, [vouchersDatabase]);

  const getRowVoucherStats = (permitFromISO: string, permitToISO: string, recordVrm: string) => {
    const recordVrmClean = (recordVrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cacheKey = `${permitFromISO}_${permitToISO}_${recordVrmClean}`;
    const cached = voucherIndex.stockCache.get(cacheKey);
    if (cached) return cached;

    const periodBucket = voucherIndex.periodMap.get(`${permitFromISO}_${permitToISO}`);
    const candidateVouchers = periodBucket ?? (vouchersDatabase || []);

    const matchingVouchers = candidateVouchers.filter(v => {
      const dateMatch = isVoucherForPermitDateRange(v, permitFromISO, permitToISO);
      if (!dateMatch) return false;
      const vVrmClean = (v.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      return !vVrmClean || vVrmClean === recordVrmClean;
    });

    const total = matchingVouchers.length;
    let remaining = 0;
    matchingVouchers.forEach(v => {
      if (v.isUsed === true || v.status === "used" || v.status === "dispatched") return;
      const code = cleanVoucherCodeValue(v.code).toUpperCase();
      if (!code || code === "-" || code === "CANCELLED" || code === "PENDING") return;
      if (!assignedVoucherCodesSet.has(code)) remaining++;
    });

    const result = { total, remaining };
    voucherIndex.stockCache.set(cacheKey, result);
    return result;
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

  // ⭐ STEP 1: Filter first in O(N) linear scan
  const filteredRecords = useMemo(() => {
    return baseRecords.filter((record, idx) => {
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

      if (statusFilter !== "ALL") {
        const status = getStatusStr(record, idx);
        if (statusFilter === "PENDING" && status !== "PENDING") return false;
        if (statusFilter === "SENT" && status !== "SENT") return false;
        if (statusFilter === "CANCELLED" && status.toUpperCase() !== "CANCELLED") return false;
        if (statusFilter === "BLOCKED" && status !== "BLOCKED") return false;
        if (statusFilter === "REPLACEMENT" && status !== "REPLACEMENT") return false;
      }

      if (hospitalFilter !== "ALL") {
        const hosp = getHospital(record);
        if (hosp.toLowerCase().trim() !== hospitalFilter.toLowerCase().trim()) {
          return false;
        }
      }

      if (wardFilter !== "ALL") {
        const w = (record.ward || "").toLowerCase();
        const target = wardFilter.toLowerCase();
        if (!w.includes(target) && w !== target) {
          return false;
        }
      }

      if (dateFilter !== "ALL") {
        // Filter by SUBMITTED date
        const recDate =
          getRecordSubmittedDateISO(record) ||
          parseDateToISO(record.completionTime || record.startTime || record.createdAt || record.created_at);
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
    baseRecords,
    searchQuery,
    statusFilter,
    hospitalFilter,
    wardFilter,
    dateFilter,
    customStartDate,
    customEndDate,
    todayISO,
    dateRanges,
    processingDate,
    database,
    dispatchedKeys,
    unsentKeys,
    formData
  ]);

  // ⭐ STEP 2: Sort filtered records using pre-decorated keys in O(M log M) without indexOf
  const sortedRecords = useMemo(() => {
    if (!sortKey || !sortDirection) {
      return filteredRecords;
    }

    const decorated = filteredRecords.map((r, i) => {
      let keyVal: string | number = 0;
      switch (sortKey) {
        case "id":
          keyVal = getNumericFormId(r) || (i + 1);
          break;
        case "submitted":
        case "qr":
          keyVal = getRecordSubmittedTimeMs(r);
          break;
        case "driverName":
          keyVal = (r.driverName || "").trim().toLowerCase();
          break;
        case "vrm":
          keyVal = (r.vrm || "").trim().toUpperCase();
          break;
        case "voucherCode": {
          const isBlk = isVrmSilentBlockedSync(r.vrm);
          const isCanc = getIsCancelled(r, i);
          keyVal = isBlk ? "BLOCKED" : (isCanc ? "CANCELLED" : (recordCodeMap.get(String(r.formId ?? r.id ?? i)) || r.voucherCode || ""));
          break;
        }
        case "validFrom":
          keyVal = parseDateToISO(r.dateRequired || r.validFrom) || "";
          break;
        case "validTo": {
          const iso = parseDateToISO(r.dateRequired || r.validFrom);
          keyVal = iso ? addDays(iso, 6) : "";
          break;
        }
        case "ward":
          keyVal = (r.ward || "").trim().toLowerCase();
          break;
        case "hospital":
          keyVal = getHospital(r).toLowerCase();
          break;
        case "status":
          keyVal = getStatusStr(r, i);
          break;
        case "actions": {
          const isCanc = getIsCancelled(r, i);
          const isDisp = checkIsRecordDispatched(r, r.vrm, r.driverName, r.dateRequired, dispatchedKeys, unsentKeys);
          keyVal = isCanc ? "Unsend" : (isReplacementPending(r) ? "Resend" : (isDisp ? "Unsend" : "Send"));
          break;
        }
        default:
          keyVal = 0;
      }
      return {
        r,
        keyVal,
        numId: getNumericFormId(r) || (i + 1),
        submittedTime: getRecordSubmittedTimeMs(r)
      };
    });

    decorated.sort((a, b) => {
      let comp = 0;
      if (typeof a.keyVal === "string" && typeof b.keyVal === "string") {
        comp = a.keyVal.localeCompare(b.keyVal, undefined, { sensitivity: "base", numeric: true });
      } else if (typeof a.keyVal === "number" && typeof b.keyVal === "number") {
        comp = a.keyVal - b.keyVal;
      }
      if (comp === 0) {
        comp = a.numId - b.numId || a.submittedTime - b.submittedTime;
      }
      return sortDirection === "asc" ? comp : -comp;
    });

    return decorated.map(d => d.r);
  }, [
    filteredRecords,
    sortKey,
    sortDirection,
    database,
    processingDate,
    recordCodeMap,
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

  const totalFilteredCount = sortedRecords.length;
  const totalOriginalCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : (database.length || 0);
  const isFiltered = activeFilters.length > 0 || totalFilteredCount !== totalOriginalCount;

  const effectivePageSize = pageSize === 0 ? (totalFilteredCount || 50) : pageSize;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalFilteredCount / effectivePageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = totalFilteredCount === 0 ? 0 : (safePage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalFilteredCount);

  // ⭐ Non-blocking progressive rendering when "ALL" (pageSize === 0) is selected
  const [allRenderLimit, setAllRenderLimit] = useState<number>(100);

  useEffect(() => {
    if (pageSize === 0) {
      setAllRenderLimit(100);
      let limit = 100;
      let frameId: number;
      const renderNextChunk = () => {
        if (limit < sortedRecords.length) {
          limit = Math.min(limit + 150, sortedRecords.length);
          setAllRenderLimit(limit);
          frameId = requestAnimationFrame(renderNextChunk);
        }
      };
      frameId = requestAnimationFrame(renderNextChunk);
      return () => cancelAnimationFrame(frameId);
    }
  }, [pageSize, sortedRecords.length]);

  const paginatedRecords = useMemo(() => {
    if (pageSize === 0) {
      return sortedRecords.slice(0, allRenderLimit);
    }
    return sortedRecords.slice(startIndex, endIndex);
  }, [sortedRecords, startIndex, endIndex, pageSize, allRenderLimit]);

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
  const unusedVouchersCount = unusedVouchersForDay.length;
  const remainingVoucherPercent = totalVouchersCount > 0 
    ? (unusedVouchersCount / totalVouchersCount) * 100 
    : 0;
  const isVoucherStockLow = remainingVoucherPercent <= 5;

  const validFromDisplay = formData?.validFrom || processingDate || "07/07/2026";
  const validToDisplay = formData?.validTo || (processingDate ? addDays(processingDate, 6) : "13/07/2026");
  const selectedWard = formData?.ward || "Acorn Ward";

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
    try {
      exportToExcel(filteredRecords, "Concessions_Permits_Export.xlsx");
    } catch (e) {
      console.error("Export failed:", e);
    }
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
    <section className="w-full bg-white dark:bg-[#030C1B] border border-slate-200 dark:border-[#0D223C] rounded-2xl p-4 md:p-6 shadow-2xl text-slate-700 dark:text-slate-200 transition-colors">
      {/* Top Header Section */}
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-200 dark:border-[#0D223C]">
        <div className="flex items-center justify-between gap-4 w-full flex-wrap lg:flex-nowrap">
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-[#1877F2] flex items-center justify-center shadow-md shadow-blue-500/20 text-white shrink-0">
              <Navigation className="w-4 h-4 fill-white text-white" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight whitespace-nowrap shrink-0">
              Permit Dispatch Centre
            </h2>
          </div>

          {/* Center: Browse Buttons, Counts & Sub-200ms Badge */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={onBrowseConcessions}
              className="flex items-center gap-2 bg-[#1A73E8] hover:bg-[#1557b0] text-white rounded-lg h-8 px-3 text-xs font-semibold transition-colors whitespace-nowrap shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Browse concessions</span>
            </button>
            <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-normal whitespace-nowrap">
              {totalDbCount} concessions
            </span>

            <button
              type="button"
              onClick={onBrowseVouchers}
              className="flex items-center gap-2 bg-[#1A73E8] hover:bg-[#1557b0] text-white rounded-lg h-8 px-3 text-xs font-semibold transition-colors whitespace-nowrap shadow-sm"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Browse vouchers</span>
            </button>
            <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-normal whitespace-nowrap">
              {totalVouchersCount} vouchers
            </span>

            <span className="whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Sub-200ms
            </span>
          </div>

          {/* Right: Active Date Codes */}
          <div className="flex items-center gap-2 whitespace-nowrap shrink-0 ml-auto lg:ml-0">
            <label 
              className="text-xs sm:text-sm font-medium text-[#10B981] whitespace-nowrap shrink-0"
            >
              Active Date Codes ({unusedVouchersForDay.length}):
            </label>
            <select
              value={unusedVouchersForDay.some(v => v.code === formData?.voucherCodesText) ? formData?.voucherCodesText : ""}
              onChange={handleActiveDateCodeChange}
              disabled={unusedVouchersForDay.length === 0}
              className="h-8 px-2.5 py-1 bg-[#D1FAE5] text-[#065F46] border border-[#34D399] rounded-lg text-xs font-mono font-bold focus:outline-none transition shrink-0 cursor-pointer"
            >
              <option value="" disabled className="font-mono font-normal text-slate-700 bg-white">
                {vouchersDatabase.length === 0
                  ? "-- No Vouchers Uploaded --"
                  : unusedVouchersForDay.length === 0
                    ? "-- 0 Available --"
                    : "-- Choose Code --"}
              </option>
              {unusedVouchersForDay.map((v, index) => (
                <option
                  key={`voucher_${v.code}_${index}`}
                  value={v.code}
                  className="font-mono text-gray-900 bg-white"
                >
                  {v.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Second Row: Search & Filters */}
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[220px]">
              <div className="flex items-center w-full bg-white dark:bg-[#020B19] border border-slate-300 dark:border-[#132A4A] focus-within:border-[#1A73E8] focus-within:ring-2 focus-within:ring-[#1A73E8]/20 rounded-xl px-3.5 py-2 transition shadow-inner">
                <Search className="w-4 h-4 text-sky-500 dark:text-sky-400 shrink-0 mr-2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search driver, VRN, hospital, voucher..."
                  className="w-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none font-normal"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => handleSearchChange("")}
                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-0.5 rounded transition cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="relative shrink-0">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-9.5 pl-3.5 pr-8 bg-white dark:bg-[#020B19] border border-slate-300 dark:border-[#132A4A] text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:outline-none focus:border-[#1A73E8] transition appearance-none cursor-pointer"
              >
                <option value="ALL" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">Status: All</option>
                <option value="PENDING" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">PENDING</option>
                <option value="SENT" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">SENT</option>
                <option value="CANCELLED" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">CANCELLED</option>
                <option value="BLOCKED" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">BLOCKED</option>
                <option value="REPLACEMENT" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">REPLACEMENT</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="relative shrink-0">
              <select
                value={hospitalFilter}
                onChange={(e) => setHospitalFilter(e.target.value)}
                className="h-9.5 pl-3.5 pr-8 bg-white dark:bg-[#020B19] border border-slate-300 dark:border-[#132A4A] text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:outline-none focus:border-[#1A73E8] transition appearance-none cursor-pointer truncate max-w-[200px]"
              >
                <option value="ALL" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">Hospital: All</option>
                {allHospitalsList.map(h => (
                  <option key={h} value={h} className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">{h}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="relative shrink-0">
              <select
                value={wardFilter}
                onChange={(e) => setWardFilter(e.target.value)}
                className="h-9.5 pl-3.5 pr-8 bg-white dark:bg-[#020B19] border border-slate-300 dark:border-[#132A4A] text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:outline-none focus:border-[#1A73E8] transition appearance-none cursor-pointer truncate max-w-[200px]"
              >
                <option value="ALL" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">Ward: All</option>
                {allWardsList.map(w => (
                  <option key={w} value={w} className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">{w}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="relative shrink-0">
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
                className="h-9.5 pl-3.5 pr-8 bg-white dark:bg-[#020B19] border border-slate-300 dark:border-[#132A4A] text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:outline-none focus:border-[#1A73E8] transition appearance-none cursor-pointer"
              >
                <option value="ALL" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">{isLoadingHistory ? "Loading..." : "Date: All Time"}</option>
                <option value="TODAY" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">Today</option>
                <option value="THIS_WEEK" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">This Week</option>
                <option value="THIS_MONTH" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">This Month</option>
                <option value="CUSTOM" className="bg-white dark:bg-[#020B19] text-slate-900 dark:text-white">Custom Range</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

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

      <div className="w-full mt-4 border border-slate-200 dark:border-[#163657] rounded-xl bg-white dark:bg-[#061424] overflow-hidden shadow-xs dark:shadow-inner">
        <div className="overflow-x-auto w-full">
          <table className="min-w-[1180px] w-full text-xs text-left border-collapse table-auto">
            <thead className="bg-slate-50 dark:bg-[#081b30] border-b border-slate-200 dark:border-[#163657] text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 select-none">
              <tr>
                <th 
                  scope="col" 
                  onClick={() => handleSort("id")}
                  className={`py-3 px-3 text-center w-12 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "id" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Number"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>#</span>
                    {renderSortIndicator("id")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("submitted")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "submitted" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Submitted timestamp"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>SUBMITTED</span>
                    {renderSortIndicator("submitted")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("driverName")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "driverName" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Driver's Name"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>DRIVER'S NAME</span>
                    {renderSortIndicator("driverName")}
                  </div>
                </th>

                <th
                  scope="col"
                  className="py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider"
                >
                  PHONE
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("vrm")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "vrm" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by VRM"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VRM</span>
                    {renderSortIndicator("vrm")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("voucherCode")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "voucherCode" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Voucher Code"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VOUCHER CODE</span>
                    {renderSortIndicator("voucherCode")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  className="py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap text-center select-none w-[90px] min-w-[90px] text-[10px] font-bold uppercase tracking-wider"
                >
                  <div className="flex items-center justify-center">
                    <span>CODES</span>
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("validFrom")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "validFrom" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Valid From date"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VALID FROM</span>
                    {renderSortIndicator("validFrom")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("validTo")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "validTo" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Valid To date"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>VALID TO</span>
                    {renderSortIndicator("validTo")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("ward")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "ward" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Ward"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>WARD</span>
                    {renderSortIndicator("ward")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("hospital")}
                  className={`py-3 px-3.5 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap min-w-[185px] cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "hospital" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Hospital Site"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>HOSPITAL</span>
                    {renderSortIndicator("hospital")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("status")}
                  className={`py-3 px-3 text-center border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "status" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
                  }`}
                  title="Click to sort by Status"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>STATUS</span>
                    {renderSortIndicator("status")}
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("actions")}
                  className={`py-3 px-3 text-center whitespace-nowrap cursor-pointer transition-colors group select-none text-[10px] font-bold uppercase tracking-wider ${
                    sortKey === "actions" ? "bg-blue-50 text-blue-700 dark:bg-[#0c2847] dark:text-[#38bdf8] font-bold" : "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0b2440] dark:hover:text-white"
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

                // ⭐ FIX: CODES Column & VOUCHER CODE Column - canonical date range matching
                const permitFromISO = getRequestedPermitDateISO(record) || parseDateToISO(record.validFrom || record.dateRequired) || "";
                const permitToISO = (() => {
                  if (record.validTo) {
                    const iso = parseDateToISO(record.validTo);
                    if (iso) return iso;
                  }
                  if (record.dateExpiry) {
                    const iso = parseDateToISO(record.dateExpiry);
                    if (iso) return iso;
                  }
                  const rawDate = record.dateRequired || record.validFrom;
                  if (rawDate) {
                    const range = parseDateRange(String(rawDate));
                    if (range && range.endISO) {
                      return range.endISO;
                    }
                  }
                  if (permitFromISO) {
                    return addDays(permitFromISO, 6);
                  }
                  return "";
                })();

                let displayCode = recordCodeMap.get(recordKey);

                if (isBlocked) {
                  displayCode = "BLOCKED";
                } else if (isCancelled) {
                  displayCode = "CANCELLED";
                } else if (displayCode === undefined || displayCode === null || displayCode === "CANCELLED" || displayCode === "BLOCKED") {
                  const rawCode = (record.voucherCode || (customVouchers && (customVouchers[recordKey] || (record.vrm && customVouchers[`${String(record.vrm).toUpperCase().replace(/\s+/g, "")}_${reqDate}`]))) || "").trim();
                  const cleanRaw = cleanVoucherCodeValue(rawCode).toUpperCase();
                  
                  // ⭐ O(1) check if code exists in current vouchersDatabase
                  const codeExists = cleanRaw && cleanRaw !== "-" && cleanRaw !== "CANCELLED" && cleanRaw !== "BLOCKED" &&
                    voucherIndex.codeMap.has(cleanRaw);
                  
                  displayCode = codeExists ? rawCode : "-";
                }

                // ⭐ O(1) candidate lookup: Verify displayCode exists in current vouchersDatabase for this permit's date range
                if (
                  displayCode &&
                  displayCode !== "-" &&
                  displayCode !== "CANCELLED" &&
                  displayCode !== "BLOCKED" &&
                  vouchersDatabase &&
                  vouchersDatabase.length > 0
                ) {
                  const cleanDisplay = cleanVoucherCodeValue(displayCode).toUpperCase();
                  const candidates = voucherIndex.codeMap.get(cleanDisplay);
                  const validInDbForDate = candidates ? candidates.some(v =>
                    !permitFromISO || isVoucherForPermitDateRange(v, permitFromISO, permitToISO)
                  ) : false;
                  if (!validInDbForDate) {
                    displayCode = "-";
                  }
                }
                const rowKey = String(record.formId ?? record.id ?? record.vrm ?? index);

                const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
                const replacementPending = !isBlocked && isReplacementPending(record);

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

                const hospitalDisplay = getHospital(record);

                // ⭐ Stale code check using indexed lookup
                const cleanUpperDisplay = String(displayCode || "").trim().toUpperCase();
                const candidatesForDisplay = voucherIndex.codeMap.get(cleanUpperDisplay);
                const isStaleCode = Boolean(
                  !isBlocked &&
                  !isCancelled &&
                  displayCode &&
                  displayCode !== "-" &&
                  (!candidatesForDisplay || !candidatesForDisplay.some(v => isVoucherForPermitDateRange(v, permitFromISO, permitToISO)))
                );
                
                // ⭐ Instant O(1) memoized voucher stock calculation
                const { total: totalForRow, remaining: remainingForRow } = getRowVoucherStats(permitFromISO, permitToISO, record?.vrm || "");
                
                const percentRemainingRow = totalForRow > 0
                  ? (remainingForRow / totalForRow) * 100
                  : 0;
                
                // 🔴 RED if: total=0 OR remaining≤5 OR percentage≤5%
                const isRowStockLow = totalForRow === 0 || remainingForRow <= 5 || percentRemainingRow <= 5;

                return (
                  <tr 
                    key={`dispatch_${rowKey}_${index}`}
                    onClick={() => onSelectRecord(record)}
                    className="hover:bg-blue-50/50 dark:hover:bg-[#0c233d]/70 transition-colors cursor-pointer text-slate-800 dark:text-slate-200"
                  >
                    <td className="py-3 px-3 text-center text-slate-500 dark:text-slate-400 font-mono font-normal border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {excelId}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {formatSubmittedDateTime(record)}
                    </td>

                    <td className="py-3 px-3 font-normal text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {record.driverName ? toTitleCase(record.driverName) : "-"}
                    </td>

                    <td className="py-3 px-3 font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {record.phone || "-"}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-900 dark:text-white uppercase border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {record.vrm ? record.vrm.toUpperCase() : "-"}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {isBlocked ? (
                        <span className="text-rose-600 dark:text-rose-400 font-normal">
                          BLOCKED
                        </span>
                      ) : (isCancelled || displayCode === "CANCELLED") ? (
                        <span className="text-red-600 dark:text-[#FF453A] font-normal">
                          CANCELLED
                        </span>
                      ) : replacementPending ? (
                        <span className="text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-700/50 inline-flex items-center gap-1.5">
                          <span className="inline-block animate-spin text-[10px]">⟳</span>
                          {displayCode || "-"}
                        </span>
                      ) : isStaleCode ? (
                        <span 
                          className="text-orange-600 dark:text-orange-400 font-normal inline-flex items-center gap-1"
                          title="This code isn't in the currently loaded voucher batch for this date range — likely assigned before the latest Vouchers.csv was uploaded."
                        >
                          <span aria-hidden="true">⚠</span>
                          {displayCode}
                        </span>
                      ) : (
                        <span className="text-slate-800 dark:text-slate-200 font-normal">
                          {displayCode || "-"}
                        </span>
                      )}
                    </td>

                    {/* ⭐ FIXED CODES COLUMN - Shows count, not VRM */}
                    <td className="py-3 px-3 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-center text-[10px]">
                      <div className="flex flex-col items-center justify-center gap-1 mx-auto w-[74px]">
                        <div 
                          className="w-[74px] h-[5px] rounded overflow-hidden"
                          style={{ backgroundColor: isRowStockLow ? "#fee2e2" : "#dcfce7" }}
                        >
                          <div 
                            className="h-full rounded transition-all duration-300"
                            style={{ 
                              width: `${Math.min(100, Math.max(0, percentRemainingRow))}%`,
                              backgroundColor: isRowStockLow ? "#dc2626" : "#16a34a" 
                            }} 
                          />
                        </div>
                        <span 
                          className="text-[9px] font-medium leading-none select-none tracking-tight"
                          style={{ color: isRowStockLow ? "#b91c1c" : "#15803d" }}
                        >
                          {remainingForRow} left
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {formatDate(record.dateRequired || record.validFrom)}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {formatDate(expiresIso)}
                    </td>

                    <td className="py-3 px-3 font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[10px]">
                      {record.ward ? toTitleCase(record.ward) : "-"}
                    </td>

                    <td className="py-3 px-3.5 font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap min-w-[185px] text-[10px]">
                      {hospitalDisplay}
                    </td>

                    <td className="py-3 px-3 text-center border-r border-slate-100 dark:border-[#102947]/60 select-none whitespace-nowrap text-[10px]">
                      {isBlocked ? (
                        <span className="border border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-bold px-2 py-0.5 rounded text-[9px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          BLOCKED
                        </span>
                      ) : (isCancelled || (record.status && record.status.trim().toUpperCase() === "CANCELLED")) ? (
                        <span className="border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-bold px-2 py-0.5 rounded text-[9px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          CANCELLED
                        </span>
                      ) : replacementPending ? (
                        <span className="border border-amber-400 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-bold px-2 py-0.5 rounded text-[9px] tracking-wider uppercase inline-flex items-center justify-center gap-1.5 whitespace-nowrap animate-pulse">
                          <span className="inline-block animate-spin text-[9px]">⟳</span>
                          REPLACEMENT
                        </span>
                      ) : isDispatched ? (
                        <span className="border border-emerald-300 dark:border-[#32D74B]/40 bg-emerald-50 dark:bg-[#32D74B]/15 text-emerald-700 dark:text-[#32D74B] font-bold px-2 py-0.5 rounded text-[9px] tracking-wider uppercase inline-flex items-center justify-center gap-1 whitespace-nowrap">
                          <span>✅</span>
                          <span>SENT</span>
                        </span>
                      ) : (
                        <span className="border border-amber-300 dark:border-[#FF9F0A]/40 bg-amber-50 dark:bg-[#FF9F0A]/15 text-amber-700 dark:text-[#FF9F0A] font-bold px-2 py-0.5 rounded text-[9px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          PENDING
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap text-[10px]" onClick={e => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-center gap-1.5 rounded-md">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onEditRecord) {
                              onEditRecord(record);
                            } else {
                              onSelectRecord(record);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded shadow-xs hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer transition-colors"
                          title="Edit Record"
                        >
                          <Pencil className="w-2.5 h-2.5 text-slate-500 dark:text-slate-400" />
                          <span>Edit</span>
                        </button>
                        <div className="inline-flex items-center justify-center rounded-md overflow-hidden shadow-xs">
                          <button 
                            type="button" 
                            disabled={busyKey === rowKey || isBlocked} 
                            onClick={() => { if (!isBlocked) handleAction(record, isDispatched, replacementPending); }} 
                            title={isBlocked ? "This VRM is on the Manage Blocklist — dispatch disabled" : undefined}
                            className={`flex items-center gap-1 px-2 py-0.5 text-white text-[10px] font-medium transition-colors disabled:opacity-50 whitespace-nowrap ${
                              isBlocked
                                ? "bg-slate-400 dark:bg-slate-700 cursor-not-allowed opacity-60"
                                : "cursor-pointer " + (replacementPending
                                    ? "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
                                    : isDispatched
                                      ? "bg-[#dc2626] hover:bg-[#b91c1c]"
                                      : "bg-[#1d75f2] hover:bg-[#1565d8]")
                            }`}
                          >
                            {busyKey === rowKey ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              replacementPending ? (
                                <span className="inline-block animate-spin text-[10px]">⟳</span>
                              ) : (
                                <Mail className="w-2.5 h-2.5" />
                              )
                            )}
                            <span>{isBlocked ? "Blocked" : (replacementPending ? "Resend" : (isDispatched ? "Unsend" : "Send"))}</span>
                          </button>
                          <button 
                            type="button" 
                            disabled={isBlocked}
                            onClick={() => { if (!isBlocked) onSelectRecord(record); }} 
                            className={`px-1.5 py-0.5 text-white transition-colors ${
                              isBlocked
                                ? "bg-slate-500/80 dark:bg-slate-600/80 cursor-not-allowed opacity-60 border-l border-slate-600"
                                : "cursor-pointer " + (replacementPending
                                  ? "bg-amber-700 hover:bg-amber-800 border-l border-amber-600"
                                  : isDispatched
                                    ? "bg-[#b91c1c] hover:bg-[#991b1b] border-l border-[#991b1b]"
                                    : "bg-[#1565d8] hover:bg-[#0f4eb0] border-l border-[#0f4eb0]")
                            }`}
                            title={isBlocked ? "Disabled" : "Select Record"}
                          >
                            <ChevronDown className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-slate-500 dark:text-slate-400 text-xs">
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

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5 mt-3 px-1 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
          <div className="font-medium text-slate-700 dark:text-slate-300">
            Showing <span className="font-semibold text-slate-900 dark:text-white">{totalFilteredCount === 0 ? 0 : (startIndex + 1).toLocaleString()}</span>
            {" – "}
            <span className="font-semibold text-slate-900 dark:text-white">{endIndex.toLocaleString()}</span> of{" "}
            <span className="font-semibold text-slate-900 dark:text-white">{totalFilteredCount.toLocaleString()}</span> permits
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

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-end">
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

            <div className="inline-flex items-center gap-1">
              {pageNumbers.map((p, idx) => {
                if (typeof p === "string") {
                  return (
                    <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-medium select-none">
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
                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition cursor-pointer ${
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
    </section>
  );
}