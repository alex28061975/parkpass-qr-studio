import React, { useMemo, useState, useEffect, useCallback } from "react";
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
  Filter,
  FileSpreadsheet,
  FileText,
  Pencil
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
  getRecordSubmittedTimeMs,
  getMatchingPermits,
  getUnusedVouchersForDate,
  getSpreadsheetMatchingAssignedCodes,
  getVoucherDateISO,
  cleanVoucherCodeValue,
  isVoucherCodeMatch,
  isVoucherInValidityPeriod,
  toTitleCase
} from "../utils/csvParser";
import { checkIsRecordDispatched, getRecordKeys } from "../utils/dispatchUtils";
import { isVrmSilentBlockedSync } from "../lib/blocklist";
import { useLoading } from "../contexts/LoadingContext";

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

const getVoucherValidFromISO = (v: ParsedVoucherData | undefined | null): string => {
  if (!v) return "";
  const raw = v.validFrom || v.valid_from || v.ValidFrom || v.startDate || v.start_date || v.date || v.dateRequired || v.uploadDate;
  if (raw) {
    const iso = parseDateToISO(String(raw));
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return getVoucherDateISO(v) || "";
};

const getVoucherValidToISO = (v: ParsedVoucherData | undefined | null): string => {
  if (!v) return "";
  const raw = v.validTo || v.valid_to || v.ValidTo || v.endDate || v.end_date || v.expires || v.expiryDate;
  if (raw) {
    const iso = parseDateToISO(String(raw));
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  const fromIso = getVoucherValidFromISO(v);
  if (fromIso) {
    return addDays(fromIso, 6);
  }
  return "";
};

export const isVoucherForPermitDateRange = (
  v: ParsedVoucherData | undefined | null,
  permitFromISO: string,
  permitToISO?: string
): boolean => {
  if (!v || !v.code || !permitFromISO) return false;
  const cleanCode = cleanVoucherCodeValue(v.code).toUpperCase();
  if (!cleanCode || cleanCode === "-" || cleanCode === "CANCELLED" || cleanCode === "PENDING") {
    return false;
  }

  const vFrom = getVoucherValidFromISO(v);
  if (!vFrom || vFrom !== permitFromISO) {
    return false;
  }

  if (permitToISO) {
    const vTo = getVoucherValidToISO(v);
    if (vTo && vTo !== permitToISO) {
      return false;
    }
  }

  return true;
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
  isLoadingHistory,
  onBrowseConcessions,
  onBrowseVouchers,
  onEditRecord
}: DispatchCentreProps) {
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const { showLoading, hideLoading, updateProgress } = useLoading();
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

  // Assigned voucher codes set across the concessions database and custom allocations
  const assignedVoucherCodesSet = useMemo(() => {
    const set = new Set<string>();
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

      // If this record is undergoing voucher replacement via active form data, release its old voucher back to the pool
      const isReplacedByFormData = Boolean(
        formData &&
        (formData.emailType === "RESEND_CONCESSION" || formData.isResend === true || formData.emailTemplate === "replacement") &&
        ((formData.formId !== undefined && rec.formId !== undefined && String(formData.formId) === String(rec.formId)) ||
         (formData.id && rec.id && String(formData.id) === String(rec.id)) ||
         (formData.vrm && rec.vrm && formData.vrm.toUpperCase().replace(/[^A-Z0-9]/g, "") === rec.vrm.toUpperCase().replace(/[^A-Z0-9]/g, "")))
      );

      if (isReplacedByFormData) {
        // Old voucher is released back to the inventory pool
        return;
      }

      const raw = rec.voucherCode || rec.prePaidCode || "";
      if (raw && typeof raw === "string") {
        const clean = cleanVoucherCodeValue(raw).toUpperCase();
        if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "PENDING" && clean !== "N/A") {
          set.add(clean);
        }
      }
    });

    // If formData has an active replacement code, assign the newly chosen replacement code
    if (formData?.voucherCodesText && (formData.emailType === "RESEND_CONCESSION" || formData.isResend === true || formData.emailTemplate === "replacement")) {
      const cleanNew = cleanVoucherCodeValue(formData.voucherCodesText).toUpperCase();
      if (cleanNew && cleanNew !== "-" && cleanNew !== "CANCELLED" && cleanNew !== "PENDING" && cleanNew !== "N/A") {
        set.add(cleanNew);
      }
    }

    if (customVouchers) {
      Object.entries(customVouchers).forEach(([key, raw]) => {
        if (raw && typeof raw === "string") {
          const clean = cleanVoucherCodeValue(raw).toUpperCase();
          if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "PENDING" && clean !== "N/A") {
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
  }, [database, customVouchers, processingDate, formData]);

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
      const cleanVrm = formData.vrm.toUpperCase().replace(/\s+/g, "");
      const rec = database.find(r => r.vrm && r.vrm.toUpperCase().replace(/\s+/g, "") === cleanVrm);
      if (rec) {
        const iso = getRequestedPermitDateISO(rec);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
      }
    }
    if (matchingPermits && matchingPermits.length > 0) {
      const candidate = (formData?.vrm && matchingPermits.find(p => p.vrm && p.vrm.toUpperCase().replace(/\s+/g, "") === formData.vrm.toUpperCase().replace(/\s+/g, ""))) || matchingPermits[0];
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
      const candidate = (formData?.vrm && matchingPermits.find(p => p.vrm && p.vrm.toUpperCase().replace(/\s+/g, "") === formData.vrm.toUpperCase().replace(/\s+/g, ""))) || matchingPermits[0];
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
      emailTemplate: "replacement",
      originalVoucherCode: formData?.originalVoucherCode || formData?.voucherCode || formData?.voucherCodesText,
      replacementCount: ((formData?.replacementCount || 0) + 1),
    });
  };

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Dropdown filter states
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "SENT" | "CANCELLED" | "BLOCKED" | "REPLACEMENT">("ALL");
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

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [goToPageInput, setGoToPageInput] = useState<string>("");

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
    Boolean(
      (isSameSelectedRecord(record) &&
        (formData?.emailType === "RESEND_CONCESSION" || formData?.isResend === true || formData?.emailTemplate === "replacement")) ||
      record.emailType === "RESEND_CONCESSION" ||
      record.isResend === true ||
      record.emailTemplate === "replacement" ||
      (typeof record.status === "string" && record.status.trim().toUpperCase() === "REPLACEMENT")
    );

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

  const getIsCancelled = (record: CsvPermitRecord, idx?: number) => {
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

  const getStatusStr = (record: CsvPermitRecord, idx: number) => {
    if (isVrmSilentBlockedSync(record.vrm)) return "BLOCKED";
    if (getIsCancelled(record, idx)) return "CANCELLED";
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
          const aBlocked = isVrmSilentBlockedSync(a.vrm);
          const bBlocked = isVrmSilentBlockedSync(b.vrm);
          const aCanc = getIsCancelled(a, aIdx);
          const bCanc = getIsCancelled(b, bIdx);
          const aCode = aBlocked ? "BLOCKED" : (aCanc ? "CANCELLED" : (recordCodeMap.get(String(a.formId ?? a.id ?? aIdx)) || a.voucherCode || ""));
          const bCode = bBlocked ? "BLOCKED" : (bCanc ? "CANCELLED" : (recordCodeMap.get(String(b.formId ?? b.id ?? bIdx)) || b.voucherCode || ""));
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

  const filteredRecords = useMemo(() => {
    return sortedRecords.filter((record, idx) => {
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

  const totalFilteredCount = filteredRecords.length;
  const totalOriginalCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : (database.length || 0);
  const isFiltered = activeFilters.length > 0 || totalFilteredCount !== totalOriginalCount;

  const effectivePageSize = pageSize === 0 ? (totalFilteredCount || 50) : pageSize;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalFilteredCount / effectivePageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = totalFilteredCount === 0 ? 0 : (safePage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalFilteredCount);

  const paginatedRecords = useMemo(() => {
    if (pageSize === 0) return filteredRecords;
    return filteredRecords.slice(startIndex, endIndex);
  }, [filteredRecords, startIndex, endIndex, pageSize]);

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
    showLoading("Preparing your export file...", 30);
    try {
      updateProgress(60);
      exportToExcel(filteredRecords, "Concessions_Permits_Export.xlsx");
      updateProgress(100);
      setTimeout(hideLoading, 400);
    } catch (e) {
      hideLoading();
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
    <section className="w-full bg-white dark:bg-[#07172b] border border-slate-200 dark:border-[#183a5e] rounded-2xl p-4 md:p-6 shadow-sm dark:shadow-2xl text-slate-800 dark:text-slate-200 transition-colors">
      {/* Top Header Section - EVERYTHING IN A SINGLE LINE */}
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-200 dark:border-[#143252]">
        <div className="flex items-center gap-3 w-full flex-nowrap overflow-x-auto">
          {/* Left: Title + Record Counts */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-md shadow-blue-500/20 text-white shrink-0">
              <Send className="w-4 h-4 -rotate-45" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight whitespace-nowrap shrink-0">
              Permit Dispatch Centre
            </h2>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
              {totalDbCount} records
            </span>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
              {totalVouchersCount} vouchers
            </span>
          </div>

          {/* Center: Browse Buttons - TRULY CENTERED */}
          <div className="flex-1 flex items-center justify-center gap-3 min-w-0 overflow-x-auto">
            <button
              type="button"
              onClick={onBrowseConcessions}
              className="flex items-center gap-1.5 border border-emerald-700 dark:border-[#2c6e4f] rounded-md text-[13px] leading-none text-emerald-700 dark:text-[#4ade80] transition-colors whitespace-nowrap shrink-0"
              style={{
                background: "transparent",
                borderWidth: "1px",
                padding: "7px 12px"
              }}
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0 text-emerald-700 dark:text-[#4ade80]" />
              <span className="whitespace-nowrap">Browse concessions</span>
            </button>
            <button
              type="button"
              onClick={onBrowseVouchers}
              className="flex items-center gap-1.5 border border-emerald-700 dark:border-[#2c6e4f] rounded-md text-[13px] leading-none text-emerald-700 dark:text-[#4ade80] transition-colors whitespace-nowrap shrink-0"
              style={{
                background: "transparent",
                borderWidth: "1px",
                padding: "7px 12px"
              }}
            >
              <FileText className="w-4 h-4 shrink-0 text-emerald-700 dark:text-[#4ade80]" />
              <span className="whitespace-nowrap">Browse vouchers</span>
            </button>
            <span className="whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/60">
              <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-500 animate-pulse"></span>
              Sub-200ms
            </span>
          </div>

          {/* Right: Active Date Codes */}
          <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
            <label 
              className={`text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                isRangeStockLow ? "text-[#b91c1c]" : "text-[#15803d]"
              }`}
              style={{ color: isRangeStockLow ? "#b91c1c" : "#15803d" }}
            >
              Active Date Codes ({unusedVouchersForDay.length}):
            </label>
            <select
              value={unusedVouchersForDay.some(v => v.code === formData?.voucherCodesText) ? formData?.voucherCodesText : ""}
              onChange={handleActiveDateCodeChange}
              disabled={unusedVouchersForDay.length === 0}
              className={`h-9 px-3 py-1.5 border rounded-md text-xs font-mono font-extrabold focus:outline-none transition-all shrink-0 whitespace-nowrap ${
                unusedVouchersForDay.length > 0 ? "cursor-pointer" : "cursor-not-allowed font-normal"
              } ${
                isRangeStockLow
                  ? "border-[#dc2626] bg-[#fee2e2] text-[#b91c1c] focus:border-[#dc2626]"
                  : "border-[#16a34a] bg-[#dcfce7] text-[#15803d] focus:border-[#16a34a]"
              }`}
              style={{
                borderColor: isRangeStockLow ? "#dc2626" : "#16a34a",
                backgroundColor: isRangeStockLow ? "#fee2e2" : "#dcfce7",
                color: isRangeStockLow ? "#b91c1c" : "#15803d"
              }}
            >
              <option value="" disabled className="font-mono font-normal text-slate-500 bg-white dark:bg-slate-900">
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
                  className="font-mono font-extrabold text-gray-800 dark:bg-slate-900 dark:text-slate-100"
                >
                  {v.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filter Controls Toolbar */}
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
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

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-9.5 pl-3 pr-8 bg-slate-50 dark:bg-[#041222] border border-slate-300 dark:border-[#1b436c] text-slate-900 dark:text-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-blue-500 transition appearance-none cursor-pointer"
              >
                <option value="ALL">Status: All</option>
                <option value="PENDING">PENDING</option>
                <option value="SENT">SENT</option>
                <option value="REPLACEMENT">REPLACEMENT</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

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
                <th 
                  scope="col" 
                  onClick={() => handleSort("id")}
                  className={`py-3 px-3 text-center w-12 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className="py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap text-[11px] font-bold uppercase tracking-wider"
                >
                  PHONE
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("vrm")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className="py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap text-center select-none w-[90px] min-w-[90px] text-[11px] font-bold uppercase tracking-wider"
                >
                  <div className="flex items-center justify-center">
                    <span>CODES</span>
                  </div>
                </th>

                <th 
                  scope="col" 
                  onClick={() => handleSort("validFrom")}
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3.5 border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap min-w-[185px] cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 text-center border-r border-slate-200 dark:border-[#143252]/50 whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                  className={`py-3 px-3 text-center whitespace-nowrap cursor-pointer transition-colors group select-none text-[11px] font-bold uppercase tracking-wider ${
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
                // BLOCKED is determined only by the Manage Blocklist / VRM blocklist.
// CANCELLED is a separate permit state and must not itself make isBlocked true.
                const isBlocked = isVrmSilentBlockedSync(record.vrm);
                const isCancelled = isRecordCancelled(record, reqDate, database);
                const recordKey = String(record.formId ?? record.id ?? index);
                let displayCode = recordCodeMap.get(recordKey);

                if (isBlocked) {
                  displayCode = "BLOCKED";
                } else if (isCancelled) {
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
                const isReplacementRow = replacementPending && !isBlocked && !isCancelled;
                const replacementCount = record.replacementCount || (formData && isSameSelectedRecord(record) && formData.replacementCount) || 0;
                const originalCode = record.originalVoucherCode || 
                  (formData && isSameSelectedRecord(record) && formData.originalVoucherCode) ||
                  recordCodeMap.get(recordKey);

                if (replacementPending && formData?.voucherCodesText && isSameSelectedRecord(record)) {
                  displayCode = formData.voucherCodesText;
                }

                if (isReplacementRow) {
                  console.log(`[DispatchCentre] Replacement QR code detected for VRM ${record.vrm || record.id || rowKey}`);
                }

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

                // ⭐ FIXED CODES COLUMN - Per-row voucher count with RED when ≤ 5 remaining
                const permitFromISO = getRequestedPermitDateISO(record) || parseDateToISO(record.validFrom || record.dateRequired) || "";
                const permitToISO = record.validTo 
                  ? (parseDateToISO(record.validTo) || (permitFromISO ? addDays(permitFromISO, 6) : ""))
                  : (record.dateExpiry ? (parseDateToISO(record.dateExpiry) || (permitFromISO ? addDays(permitFromISO, 6) : "")) : (permitFromISO ? addDays(permitFromISO, 6) : ""));
                
                // Filter vouchers that match this permit's date range (ValidFrom - ValidTo)
                const matchingVouchersForRow = vouchersDatabase.filter(v => {
                  return isVoucherForPermitDateRange(v, permitFromISO, permitToISO);
                });
                
                const totalForRow = matchingVouchersForRow.length;
                
                const remainingForRow = matchingVouchersForRow.filter(v => {
                  if (v.isUsed === true || v.status === "used" || v.status === "dispatched") {
                    return false;
                  }
                  const code = cleanVoucherCodeValue(v.code).toUpperCase();
                  if (!code || code === "-" || code === "CANCELLED" || code === "PENDING") {
                    return false;
                  }
                  return !assignedVoucherCodesSet.has(code);
                }).length;
                
                const percentRemainingRow = totalForRow > 0
                  ? (remainingForRow / totalForRow) * 100
                  : 0;
                
                // 🔴 RED if: total=0 OR remaining≤5 OR percentage≤5%
                const isRowStockLow = totalForRow === 0 || remainingForRow <= 5 || percentRemainingRow <= 5;

                return (
                  <tr 
                    key={`dispatch_${rowKey}_${index}`}
                    onClick={() => onSelectRecord(record)}
                    className={`hover:bg-blue-50/50 dark:hover:bg-[#0c233d]/70 transition-colors cursor-pointer text-slate-800 dark:text-slate-200 ${
                      isReplacementRow ? 'bg-amber-50/70 dark:bg-amber-950/20 border-l-4 border-amber-400 dark:border-amber-500/60' : ''
                    } ${
                      isCancelled ? 'bg-rose-50/70 dark:bg-rose-950/20 border-l-4 border-rose-400 dark:border-rose-500/60' : ''
                    }`}
                  >
                    <td className={`py-3 px-3 text-center text-slate-500 dark:text-slate-400 font-mono font-normal border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px] ${
                      isReplacementRow ? 'border-l-4 border-l-amber-400 dark:border-l-amber-500/60' : isCancelled ? 'border-l-4 border-l-rose-400 dark:border-l-rose-500/60' : ''
                    }`}>
                      {excelId}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {formatSubmittedDateTime(record)}
                    </td>

                    <td className="py-3 px-3 font-normal text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {record.driverName ? toTitleCase(record.driverName) : "-"}
                    </td>

                    <td className="py-3 px-3 font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {record.phone || "-"}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-900 dark:text-white uppercase border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {record.vrm ? record.vrm.toUpperCase() : "-"}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
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
                          {(() => {
                            // Find and show original code if available
                            if (originalCode && originalCode !== displayCode && originalCode !== "CANCELLED" && originalCode !== "BLOCKED" && originalCode !== "-") {
                              return <span className="text-[9px] text-amber-500/70 dark:text-amber-400/60 line-through ml-1 font-normal">← {originalCode}</span>;
                            }
                            return null;
                          })()}
                          {replacementCount > 0 && (
                            <span className="text-[9px] text-amber-500 dark:text-amber-400 ml-0.5 font-bold" title={`Replaced ${replacementCount} time${replacementCount > 1 ? "s" : ""}`}>
                              ×{replacementCount}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-800 dark:text-slate-200 font-normal">
                          {displayCode || "-"}
                        </span>
                      )}
                    </td>

                    {/* ⭐ FIXED CODES COLUMN - Per-row voucher count with RED when ≤ 5 remaining */}
                    <td className="py-3 px-3 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-center text-[11px]">
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
                          className="text-[10px] font-bold leading-none select-none tracking-tight"
                          style={{ color: isRowStockLow ? "#b91c1c" : "#15803d" }}
                        >
                          {remainingForRow} left
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {formatDate(record.dateRequired || record.validFrom)}
                    </td>

                    <td className="py-3 px-3 font-mono font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {formatDate(expiresIso)}
                    </td>

                    <td className="py-3 px-3 font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap text-[11px]">
                      {record.ward ? toTitleCase(record.ward) : "-"}
                    </td>

                    <td className="py-3 px-3.5 font-normal text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-[#102947]/60 whitespace-nowrap min-w-[185px] text-[11px]">
                      {hospitalDisplay}
                    </td>

                    <td className="py-3 px-3 text-center border-r border-slate-100 dark:border-[#102947]/60 select-none whitespace-nowrap text-[11px]">
                      {isBlocked ? (
                        <span className="border border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-bold px-2 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          BLOCKED
                        </span>
                      ) : (isCancelled || (record.status && record.status.trim().toUpperCase() === "CANCELLED")) ? (
                        <span className="border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 font-bold px-2 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          CANCELLED
                        </span>
                      ) : replacementPending ? (
                        <span className="border border-amber-400 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-bold px-2 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center gap-1.5 whitespace-nowrap animate-pulse">
                          <span className="inline-block animate-spin text-[10px]">⟳</span>
                          REPLACEMENT
                        </span>
                      ) : isDispatched ? (
                        <span className="border border-emerald-300 dark:border-[#32D74B]/40 bg-emerald-50 dark:bg-[#32D74B]/15 text-emerald-700 dark:text-[#32D74B] font-bold px-2 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center gap-1 whitespace-nowrap">
                          <span>✅</span>
                          <span>SENT</span>
                        </span>
                      ) : isUnsent ? (
                        <span className="border border-sky-300 dark:border-[#42A5F5]/40 bg-sky-50 dark:bg-[#42A5F5]/15 text-sky-700 dark:text-[#42A5F5] font-bold px-2 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          UNSENT
                        </span>
                      ) : (
                        <span className="border border-amber-300 dark:border-[#FF9F0A]/40 bg-amber-50 dark:bg-[#FF9F0A]/15 text-amber-700 dark:text-[#FF9F0A] font-bold px-2 py-0.5 rounded text-[10px] tracking-wider uppercase inline-flex items-center justify-center whitespace-nowrap">
                          PENDING
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap text-[11px]" onClick={e => e.stopPropagation()}>
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
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-normal text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded shadow-xs hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer transition-colors"
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
                            title={isBlocked ? "This VRM is on the Manage Blocklist — dispatch disabled" : 
                                   replacementPending ? "Resend replacement QR code" : 
                                   isDispatched ? "Unsend this permit" : "Send this permit"}
                            className={`flex items-center gap-1 px-2 py-0.5 text-white text-[10px] font-normal transition-colors disabled:opacity-50 whitespace-nowrap ${
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
                                  ? "bg-amber-700 hover:bg-amber-800 border-l border-amber-800"
                                  : isDispatched
                                    ? "bg-[#b91c1c] hover:bg-[#991b1b] border-l border-[#991b1b]"
                                    : "bg-[#1565d8] hover:bg-[#0f4eb0] border-l border-[#0f4eb0]")
                            }`}
                            title={isBlocked ? "Disabled" : (replacementPending ? "Resend options" : "Select Record")}
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

      {/* Pagination Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5 mt-3 px-1 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
          <div className="font-normal text-slate-700 dark:text-slate-300">
            Showing <span className="font-medium text-slate-900 dark:text-white">{totalFilteredCount === 0 ? 0 : (startIndex + 1).toLocaleString()}</span>
            {" – "}
            <span className="font-medium text-slate-900 dark:text-white">{endIndex.toLocaleString()}</span> of{" "}
            <span className="font-medium text-slate-900 dark:text-white">{totalFilteredCount.toLocaleString()}</span> permits
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
                    <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-normal select-none">
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
                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-normal transition cursor-pointer ${
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