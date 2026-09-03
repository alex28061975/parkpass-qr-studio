import React, { useState, useEffect, useRef } from "react";
import { PermitData, StorageMode } from "./types";
import { CheckCircle2, AlertCircle, Info, CloudUpload } from "lucide-react";
import { Header } from "./components/Header";
import { PermitForm } from "./components/PermitForm";
import { PermitCard } from "./components/PermitCard";
import type { PermitCardHandle } from "./components/PermitCard";
import { DispatchCentre } from "./components/DispatchCentre";
import { RefreshCw, Sparkles, Database, BarChart3 } from "lucide-react";
import { safeLocalStorage } from "./utils/safeLocalStorage";
import { isMobileDevice } from "./utils/device";
import { 
  getRecordKeys, 
  getRecordPrimaryKey,
  getPrimaryDispatchKey, 
  checkIsRecordDispatched,
  markRecordAsDispatched,
  unmarkRecordAsDispatched,
  getAllDispatchedKeys,
  batchCheckIsRecordDispatched
} from "./utils/dispatchUtils";

// CSV Database Imports
import { INITIAL_DEMO_CSV } from "./data/defaultCsv";
import { isVrmSilentBlockedSync } from "./lib/blocklist";
import { CsvPermitRecord, parsePermitCsv, parseDateToISO, addDays, formatPhoneNumber, ParsedVoucherData, addDaysSafe, parseDateRange, getDatesInRange, cleanVoucherCodeValue, exportToExcel, isVoucherCodeMatch, sortRecordsByFormIdDesc, getMatchingPermits, isDateRequiredOutsideValidWindow, getTodayISO, checkIsBlockedDuplicate, parseFullDateTimeMs, normalizeVouchersList, isRecordCancelled, getRequestedPermitDateISO, isVoucherExactPeriodEligible, isVoucherAvailableStatus, isVoucherVrmCompatible, getDefaultSampleVouchers } from "./utils/csvParser";
import { CsvDatabasePanel } from "./components/CsvDatabasePanel";
import { TableView } from "./components/TableView";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { 
  isSupabaseConfigured, 
  initSupabaseConfig,
  checkSupabaseConnection,
  fetchPermitsFromSupabase, 
  syncPermitsToSupabase, 
  fetchVouchersFromSupabase, 
  syncVouchersToSupabase, 
  fetchDispatchedFromSupabase, 
  syncDispatchedToSupabase, 
  bulkSyncDispatchedToSupabase,
  deleteDispatchedFromSupabase,
  clearSupabaseDispatches,
  cleanupCorruptedDispatchedKeys,
  subscribeToSupabaseChanges
} from "./lib/supabase";

// Helper to format string to Title Case (capitalize each word)
function toTitleCase(str: string): string {
  if (!str || str === "-") return str;
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

// Helper to dynamically enrich database records with voucher codes from the voucher database or custom override vouchers
export function enrichRecordsWithVouchers(
  recordsList: CsvPermitRecord[],
  vouchersDb: ParsedVoucherData[],
  customVouchersMap: Record<string, string>,
  fallbackDateStr: string = "",
  dispatchedKeys: string[] = [],
  unsentKeys: string[] = []
): CsvPermitRecord[] {
  const assignedGlobally = new Set<string>();
  const assignedPerCustomer = new Map<string, Set<string>>();

  const getCustomerKey = (rec: CsvPermitRecord) => {
    const vrm = rec.vrm ? rec.vrm.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    if (vrm && vrm !== "PENDING") return `vrm:${vrm}`;
    if (rec.email) return `email:${rec.email.trim().toLowerCase()}`;
    return `driver:${(rec.driverName || "").trim().toUpperCase()}`;
  };

  const checkIsAssigned = (codeUpper: string, custSet: Set<string>): boolean => {
    if (!codeUpper || codeUpper === "-" || codeUpper === "CANCELLED") return false;
    const clean = cleanVoucherCodeValue(codeUpper);
    if (assignedGlobally.has(codeUpper)) return true;
    if (clean && clean !== "-" && assignedGlobally.has(clean)) return true;
    if (custSet.has(codeUpper)) return true;
    if (clean && clean !== "-" && custSet.has(clean)) return true;
    return false;
  };

  const registerCodeGlobally = (codeStr: string, custSet?: Set<string>) => {
    if (!codeStr || codeStr === "-" || codeStr === "CANCELLED") return;
    const parts = codeStr.split(/[\n,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    parts.forEach(p => {
      if (p !== "-" && p !== "CANCELLED") {
        assignedGlobally.add(p);
        const clean = cleanVoucherCodeValue(p);
        if (clean && clean !== "-") assignedGlobally.add(clean);
        if (custSet) {
          custSet.add(p);
          if (clean && clean !== "-") custSet.add(clean);
        }
      }
    });
  };

  const mapRecordFallback = (record: CsvPermitRecord, index: number, defaultVal: string) => {
    const cleanVrm = record.vrm ? record.vrm.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const recDateISO = getRequestedPermitDateISO(record, fallbackDateStr);
    const keyWithDate = recDateISO ? `${cleanVrm}_${recDateISO}` : cleanVrm;
    const hasOriginalVoucher = false;
    let code = "";
    if (customVouchersMap[keyWithDate]) {
      code = customVouchersMap[keyWithDate];
    } else if (customVouchersMap[cleanVrm]) {
      code = customVouchersMap[cleanVrm];
    } else if (record.id && customVouchersMap[record.id]) {
      code = customVouchersMap[record.id];
    } else if (record.formId && customVouchersMap[String(record.formId)]) {
      code = customVouchersMap[String(record.formId)];
    } else {
      const rawCode = record.voucherCode || defaultVal;
      if (rawCode && rawCode.toUpperCase() === "CANCELLED") {
        code = defaultVal;
      } else {
        code = rawCode;
      }
    }

    if (code && code !== "-") {
      const codeUpper = code.toUpperCase();
      if (checkIsAssigned(codeUpper, new Set())) {
        code = "-";
      } else {
        registerCodeGlobally(codeUpper);
      }
    }
    return { ...record, voucherCode: code, hasOriginalVoucher };
  };

  if (!vouchersDb || vouchersDb.length === 0) {
    return recordsList.map((record, index) => mapRecordFallback(record, index, "-"));
  }

  const vouchersList: ParsedVoucherData[] = vouchersDb.filter(v => v && v.code);
  const recordClaimedCodes = new Map<number, string>();

  const getRecordSortInfo = (r: CsvPermitRecord, idx: number) => {
    const reqIso = getRequestedPermitDateISO(r, fallbackDateStr) || getTodayISO();
    const cand = r.startTime || r.createdAt || r.created_at || r.completionTime || r.validFrom || r.dateRequired;
    const timeMs = parseFullDateTimeMs(cand, reqIso) ?? new Date(reqIso).getTime();
    const numFormId = Number(r.formId ?? r.id ?? 0) || 0;
    return { timeMs, numFormId, idx };
  };

  const chronologicalIndices = recordsList
    .map((r, idx) => getRecordSortInfo(r, idx))
    .sort((a, b) => {
      if (a.numFormId > 0 && b.numFormId > 0 && a.numFormId !== b.numFormId) {
        return a.numFormId - b.numFormId;
      }
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      return a.idx - b.idx;
    })
    .map(x => x.idx);

  const enrichedByIndex = new Map<number, CsvPermitRecord>();

  // Pass 0: Register all existing valid codes from database / custom overrides
  chronologicalIndices.forEach((index) => {
    const record = recordsList[index];
    const cleanVrm = record.vrm ? record.vrm.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const customerKey = getCustomerKey(record);
    if (!assignedPerCustomer.has(customerKey)) {
      assignedPerCustomer.set(customerKey, new Set());
    }
    const custAssignedSet = assignedPerCustomer.get(customerKey)!;
    const reqIso = getRequestedPermitDateISO(record, fallbackDateStr);
    const keyWithDate = (reqIso && cleanVrm) ? `${cleanVrm}_${reqIso}` : "";
    const customOverride = (record.formId ? customVouchersMap[String(record.formId)] : undefined) ||
                           (record.id ? customVouchersMap[String(record.id)] : undefined) ||
                           (keyWithDate ? customVouchersMap[keyWithDate] : undefined) ||
                           (cleanVrm ? customVouchersMap[cleanVrm] : undefined);

    const existingCode = record.voucherCode || record.prePaidCode || record.qrCode || record.serialNumber;

    if (customOverride && customOverride !== "-" && customOverride.toUpperCase() !== "CANCELLED") {
      const clean = cleanVoucherCodeValue(customOverride).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED" && !checkIsAssigned(clean, custAssignedSet)) {
        registerCodeGlobally(clean, custAssignedSet);
        recordClaimedCodes.set(index, clean);
      }
    } else if (existingCode && existingCode !== "-" && existingCode.toUpperCase() !== "CANCELLED") {
      const clean = cleanVoucherCodeValue(existingCode).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED" && !checkIsAssigned(clean, custAssignedSet)) {
        registerCodeGlobally(clean, custAssignedSet);
        recordClaimedCodes.set(index, clean);
      }
    }
  });

  // Pass 1: Allocate vouchers using strict exact-period matching on requested permit date D:
  // Eligible if and only if voucher.validFrom === D AND voucher.validTo === addDays(D, 6).
  chronologicalIndices.forEach((index) => {
    const record = recordsList[index];
    const cleanVrm = record.vrm ? record.vrm.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const reqDateD = getRequestedPermitDateISO(record, fallbackDateStr);

    // Any VRM on the actual security blocklist is always blocked
    if (isVrmSilentBlockedSync(record.vrm)) {
      enrichedByIndex.set(index, {
        ...record,
        voucherCode: "CANCELLED",
        prePaidCode: "CANCELLED",
        hasOriginalVoucher: false
      });
      return;
    }

    if (record.isCancelled === true || isRecordCancelled(record, reqDateD || fallbackDateStr, recordsList)) {
      enrichedByIndex.set(index, {
        ...record,
        voucherCode: "CANCELLED",
        prePaidCode: "CANCELLED",
        hasOriginalVoucher: false
      });
      return;
    }

    const claimed = recordClaimedCodes.get(index);
    if (claimed) {
      enrichedByIndex.set(index, {
        ...record,
        voucherCode: claimed,
        prePaidCode: claimed,
        hasOriginalVoucher: true
      });
      return;
    }

    if (!reqDateD) {
      enrichedByIndex.set(index, {
        ...record,
        voucherCode: "-",
        prePaidCode: record.prePaidCode && record.prePaidCode !== "CANCELLED" ? record.prePaidCode : "-",
        hasOriginalVoucher: false
      });
      return;
    }

    const customerKey = getCustomerKey(record);
    if (!assignedPerCustomer.has(customerKey)) {
      assignedPerCustomer.set(customerKey, new Set());
    }
    const custAssignedSet = assignedPerCustomer.get(customerKey)!;

    // Filter available vouchers eligible for this EXACT requested permit date D
    const eligibleVouchers = vouchersList.filter(v => {
      if (!isVoucherAvailableStatus(v)) return false;
      const cleanCode = cleanVoucherCodeValue(v.code).toUpperCase();
      if (!cleanCode || checkIsAssigned(cleanCode, custAssignedSet)) return false;
      return isVoucherExactPeriodEligible(v, reqDateD);
    });

    let matchedVoucher: ParsedVoucherData | undefined;

    // 1. Try exact VRM match among eligible vouchers for requested date D
    if (cleanVrm) {
      matchedVoucher = eligibleVouchers.find(v => {
        const vVrm = (v.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        return vVrm && vVrm === cleanVrm;
      });
    }

    // 2. Try generic/unrestricted VRM voucher among eligible vouchers for requested date D
    if (!matchedVoucher) {
      matchedVoucher = eligibleVouchers.find(v => isVoucherVrmCompatible(v.vrm, cleanVrm));
    }

    if (matchedVoucher && matchedVoucher.code) {
      const code = cleanVoucherCodeValue(matchedVoucher.code).toUpperCase();
      registerCodeGlobally(code, custAssignedSet);
      enrichedByIndex.set(index, {
        ...record,
        voucherCode: code,
        prePaidCode: code,
        hasOriginalVoucher: true
      });
    } else {
      enrichedByIndex.set(index, {
        ...record,
        voucherCode: "-",
        prePaidCode: record.prePaidCode && record.prePaidCode !== "CANCELLED" ? record.prePaidCode : "-",
        hasOriginalVoucher: false
      });
    }
  });

  return recordsList.map((record, index) => enrichedByIndex.get(index) || record);
}

export default function App() {
  const [currentUserName] = useState<string>(() => safeLocalStorage.getItem("realtime_user_name") || "Colleague_" + Math.floor(1000 + Math.random() * 9000));

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const cached = safeLocalStorage.getItem("concessions_dark_mode");
    if (cached !== null) {
      return cached === "true";
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return true;
  });

  useEffect(() => {
    safeLocalStorage.setItem("concessions_dark_mode", String(darkMode));
    if (darkMode) {
      document.body.classList.add("dark");
      document.documentElement.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const todayStr = getTodayISO();
  const next7DaysStr = addDays(todayStr, 6);

  const defaultState: PermitData = {
    title: "Patient & Visitor Concessions",
    site: "Main Site",
    name: "Fiona Gallagher",
    vrm: "LD68 UTX",
    validFrom: todayStr,
    validTo: next7DaysStr,
    ward: "Administration",
    qrOverride: "",
    voucherCodesText: "-",
    phone: "07700900077",
    email: "colleague@concessions-parking.com",
    todayDate: todayStr
  };

  const [formData, setFormData] = useState<PermitData>(() => {
    const tStr = getTodayISO();
    const n7DaysStr = addDays(tStr, 6);
    const cached = safeLocalStorage.getItem("concessions_permit_data");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Do not restore voucher/QR fields from cache to avoid stale codes on load
        const {
          voucherCodesText,
          voucherCode,
          prePaidCode,
          qrCode,
          serialNumber,
          ...restFormData
        } = parsed;

        return {
          ...defaultState,
          ...restFormData,
          voucherCodesText: "-",
          name: parsed.name ? toTitleCase(parsed.name) : "",
          ward: parsed.ward ? toTitleCase(parsed.ward) : "",
          vrm: parsed.vrm ? parsed.vrm.toUpperCase() : "",
          email: parsed.email ? parsed.email.toLowerCase() : "",
          phone: parsed.phone !== undefined ? parsed.phone : defaultState.phone,
          validFrom: tStr,
          validTo: n7DaysStr,
          todayDate: parsed.todayDate || tStr
        };
      } catch (e) {}
    }
    return {
      ...defaultState,
      validFrom: tStr,
      validTo: n7DaysStr,
      todayDate: tStr
    };
  });

  const [database, setDatabase] = useState<CsvPermitRecord[]>(() => {
    const cached = safeLocalStorage.getItem("concessions_permit_db");
    try {
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });
  const [vouchersDatabase, setVouchersDatabase] = useState<ParsedVoucherData[]>(() => {
    const cached = safeLocalStorage.getItem("concessions_vouchers_db") || safeLocalStorage.getItem("vouchers") || safeLocalStorage.getItem("activeCodes");
    try {
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const list = normalizeVouchersList(parsed);
          if (list.length > 0) return list;
        }
      }
    } catch (e) {}
    return getDefaultSampleVouchers(getTodayISO());
  });

  // Storage Mode: "cloud" or "offline" - persisted in localStorage under "app_storage_mode"
  const [storageMode, setStorageMode] = useState<StorageMode>(() => {
    const saved = safeLocalStorage.getItem("app_storage_mode");
    return (saved === "offline" || saved === "cloud") ? (saved as StorageMode) : "cloud";
  });
  const storageModeRef = useRef<StorageMode>(storageMode);

  useEffect(() => {
    storageModeRef.current = storageMode;
    safeLocalStorage.setItem("app_storage_mode", storageMode);
  }, [storageMode]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<{ message: string; type: "success" | "info" | "warning" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "info" | "warning" | "error" = "success") => {
    setSyncToast({ message, type });
    setTimeout(() => {
      setSyncToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  };

  const databaseRef = useRef<CsvPermitRecord[]>(database);
  const vouchersDatabaseRef = useRef<ParsedVoucherData[]>(vouchersDatabase);

  useEffect(() => {
    databaseRef.current = database;
  }, [database]);

  useEffect(() => {
    vouchersDatabaseRef.current = vouchersDatabase;
  }, [vouchersDatabase]);

  const [customVouchers, setCustomVouchers] = useState<{[vrm: string]: string}>(() => {
    const cached = safeLocalStorage.getItem("concessions_custom_vouchers");
    try {
      return cached ? JSON.parse(cached) : {};
    } catch (e) {
      return {};
    }
  });

  const [dispatchBy, setDispatchBy] = useState<{[key: string]: string}>(() => {
    const cached = safeLocalStorage.getItem("concessions_dispatch_by");
    try { return cached ? JSON.parse(cached) : {}; } catch (e) { return {}; }
  });
  const [dispatchedKeys, setDispatchedKeys] = useState<string[]>(() => {
    const cached = safeLocalStorage.getItem("concessions_dispatched_keys");
    try { return cached ? JSON.parse(cached) : []; } catch (e) { return []; }
  });
  const [dispatchDates, setDispatchDates] = useState<{[key: string]: string}>(() => {
    const cached = safeLocalStorage.getItem("concessions_dispatch_dates");
    try { return cached ? JSON.parse(cached) : {}; } catch (e) { return {}; }
  });
  const [unsentKeys, setUnsentKeys] = useState<string[]>([]);

  const dispatchedKeysRef = useRef<string[]>(dispatchedKeys);
  const unsentKeysRef = useRef<string[]>(unsentKeys);
  const dispatchDatesRef = useRef<Record<string, string>>(dispatchDates);
  const dispatchByRef = useRef<Record<string, string>>(dispatchBy);

  useEffect(() => {
    dispatchedKeysRef.current = dispatchedKeys;
  }, [dispatchedKeys]);

  useEffect(() => {
    unsentKeysRef.current = unsentKeys;
  }, [unsentKeys]);

  useEffect(() => {
    dispatchDatesRef.current = dispatchDates;
  }, [dispatchDates]);

  useEffect(() => {
    dispatchByRef.current = dispatchBy;
  }, [dispatchBy]);

  useEffect(() => {
    const todayISO = getTodayISO();
    let updated = { ...dispatchDates };
    let changed = false;
    dispatchedKeys.forEach(key => {
      if (!updated[key]) {
        updated[key] = todayISO;
        changed = true;
      }
    });
    if (changed) {
      setDispatchDates(updated);
      dispatchDatesRef.current = updated;
    }
  }, [dispatchedKeys]);

  const [activeTab, setActiveTab] = useState<"dispatcher" | "table" | "analytics">("dispatcher");
  const permitCardRef = useRef<PermitCardHandle>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastProcessedDate, setLastProcessedDate] = useState<string>("");
  const [lastDbLength, setLastDbLength] = useState<number>(0);

  // 🔥 DISPATCH STATUS HANDLER: Writes to Supabase first, then syncs React state
  const markAsDispatched = async (vrm?: string, email?: string, record?: CsvPermitRecord): Promise<boolean> => {
    lastUserActionTimestampRef.current = Date.now();
    
    const targetRecord: CsvPermitRecord | undefined = record || (vrm ? enrichedDatabase.find(r => r.vrm && r.vrm.toUpperCase().replace(/\s+/g, "") === vrm.toUpperCase().replace(/\s+/g, "")) : undefined) || (vrm ? { vrm, email } : undefined);
    if (!targetRecord) {
      console.error("❌ Record not found. Cannot mark as dispatched.");
      alert("❌ Record not found. Cannot mark as dispatched.");
      return false;
    }

    const pk = getRecordPrimaryKey(targetRecord);
    const allKeys = getRecordKeys(targetRecord);
    const combinedKeys = Array.from(new Set([pk, ...allKeys].filter(Boolean)));

    const todayISO = getTodayISO();
    const currentUser = currentUserName || 'System User';

    // If in Offline Local Storage mode, save directly to localStorage without network calls
    if (storageModeRef.current === "offline") {
      setDispatchedKeys(prev => {
        const next = Array.from(new Set([...prev, ...combinedKeys]));
        dispatchedKeysRef.current = next;
        safeLocalStorage.setItem("concessions_dispatched_keys", JSON.stringify(next));
        return next;
      });
      setDispatchDates(prev => {
        const updated = { ...prev };
        combinedKeys.forEach(k => { updated[k] = todayISO; });
        dispatchDatesRef.current = updated;
        safeLocalStorage.setItem("concessions_dispatch_dates", JSON.stringify(updated));
        return updated;
      });
      setDispatchBy(prev => {
        const updated = { ...prev };
        combinedKeys.forEach(k => { updated[k] = currentUser; });
        dispatchByRef.current = updated;
        safeLocalStorage.setItem("concessions_dispatch_by", JSON.stringify(updated));
        return updated;
      });
      setUnsentKeys(prev => {
        const next = prev.filter(k => !combinedKeys.includes(k));
        unsentKeysRef.current = next;
        return next;
      });
      console.log("💾 [Offline Storage] Record marked as dispatched locally:", pk);
      return true;
    }

    // Optimistically update React state immediately so UI changes to Sent instantly with zero lag
    setDispatchedKeys(prev => {
      const next = Array.from(new Set([...prev, ...combinedKeys]));
      dispatchedKeysRef.current = next;
      return next;
    });
    setDispatchDates(prev => {
      const updated = { ...prev };
      combinedKeys.forEach(k => { updated[k] = todayISO; });
      dispatchDatesRef.current = updated;
      return updated;
    });
    setDispatchBy(prev => {
      const updated = { ...prev };
      combinedKeys.forEach(k => { updated[k] = currentUser; });
      dispatchByRef.current = updated;
      return updated;
    });
    setUnsentKeys(prev => {
      const next = prev.filter(k => !combinedKeys.includes(k));
      unsentKeysRef.current = next;
      return next;
    });

    // 1. Write dispatch log to Supabase FIRST
    try {
      const result = await markRecordAsDispatched(
        targetRecord,
        currentUser
      );

      if (!result.success) {
        console.error("❌ [Supabase Dispatch Write Error]:", result.error);
        // Rollback on error
        setDispatchedKeys(prev => {
          const next = prev.filter(k => !combinedKeys.includes(k));
          dispatchedKeysRef.current = next;
          return next;
        });
        alert(`❌ Database Error: ${result.error || 'Failed to save dispatch status in database.'}`);
        return false;
      }

      console.log("✅ [Supabase Dispatch Write Success] Record marked as dispatched in database:", pk);

      // 2. Fetch fresh keys from Supabase or apply verified keys to state
      const freshResult = await fetchDispatchedFromSupabase();
      if (freshResult && freshResult.dispatchedKeys) {
        dispatchedKeysRef.current = freshResult.dispatchedKeys;
        setDispatchedKeys(freshResult.dispatchedKeys);
        setDispatchDates(freshResult.dispatchDates);
        setDispatchBy(freshResult.dispatchBy);
      } else {
        setDispatchedKeys(prev => {
          const next = Array.from(new Set([...prev, ...combinedKeys]));
          dispatchedKeysRef.current = next;
          return next;
        });
        setDispatchDates(prev => {
          const updated = { ...prev };
          combinedKeys.forEach(k => { updated[k] = todayISO; });
          dispatchDatesRef.current = updated;
          return updated;
        });
      }

      setUnsentKeys(prev => {
        const next = prev.filter(k => !combinedKeys.includes(k));
        unsentKeysRef.current = next;
        return next;
      });

      return true;
    } catch (err: any) {
      console.error("❌ [Supabase Dispatch Exception]:", err);
      alert(`❌ Dispatch Exception: ${err.message || 'Unknown database error'}`);
      return false;
    }
  };

  // 🔥 UNMARK DISPATCH HANDLER: Removes from Supabase and updates state
  const unmarkAsDispatched = async (vrm?: string, email?: string, record?: CsvPermitRecord): Promise<boolean> => {
    lastUserActionTimestampRef.current = Date.now();
    
    const targetRecord: CsvPermitRecord | undefined = record || (vrm ? enrichedDatabase.find(r => r.vrm && r.vrm.toUpperCase().replace(/\s+/g, "") === vrm.toUpperCase().replace(/\s+/g, "")) : undefined) || (vrm ? { vrm, email } : undefined);
    if (!targetRecord) {
      console.error("❌ Record not found. Cannot unmark as dispatched.");
      alert("❌ Record not found. Cannot unmark as dispatched.");
      return false;
    }

    const pk = getRecordPrimaryKey(targetRecord);
    const allKeys = getRecordKeys(targetRecord);
    const combinedKeys = Array.from(new Set([pk, ...allKeys].filter(Boolean)));

    // Optimistically update React state immediately in both offline and cloud modes
    setDispatchedKeys(prev => {
      const next = prev.filter(k => !combinedKeys.includes(k));
      dispatchedKeysRef.current = next;
      safeLocalStorage.setItem("concessions_dispatched_keys", JSON.stringify(next));
      return next;
    });
    setDispatchDates(prev => {
      const updated = { ...prev };
      combinedKeys.forEach(k => { delete updated[k]; });
      dispatchDatesRef.current = updated;
      safeLocalStorage.setItem("concessions_dispatch_dates", JSON.stringify(updated));
      return updated;
    });
    setDispatchBy(prev => {
      const updated = { ...prev };
      combinedKeys.forEach(k => { delete updated[k]; });
      dispatchByRef.current = updated;
      safeLocalStorage.setItem("concessions_dispatch_by", JSON.stringify(updated));
      return updated;
    });
    setUnsentKeys(prev => {
      const next = Array.from(new Set([...prev, ...combinedKeys]));
      unsentKeysRef.current = next;
      return next;
    });

    // If in Offline Local Storage mode, state and storage are already updated
    if (storageModeRef.current === "offline") {
      console.log("💾 [Offline Storage] Record unmarked as dispatched locally:", pk);
      return true;
    }

    // 1. Remove from Supabase FIRST
    try {
      const result = await unmarkRecordAsDispatched(targetRecord);
      if (!result.success) {
        console.error("❌ [Supabase Unmark Error]:", result.error);
        alert(`❌ Database Error: ${result.error || 'Failed to remove dispatch status.'}`);
        return false;
      }

      console.log("✅ [Supabase Unmark Success] Record unmarked as dispatched:", pk);

      // Local optimistic state is already updated and persisted cleanly.
      // Do NOT run immediate background refreshes that could overwrite local Unsend overrides.
      return true;
    } catch (err: any) {
      console.error("❌ [Supabase Unmark Exception]:", err);
      return false;
    }
  };

  const clearDispatchedHistory = async () => {
    dispatchedKeysRef.current = [];
    unsentKeysRef.current = [];
    dispatchDatesRef.current = {};
    dispatchByRef.current = {};

    setDispatchedKeys([]);
    setUnsentKeys([]);
    setDispatchDates({});
    
    if (isSupabaseConfigured()) {
      await clearSupabaseDispatches();
    }
  };

  useEffect(() => {
    safeLocalStorage.setItem("concessions_permit_data", JSON.stringify(formData));
  }, [formData]);

  const initialSupabaseSyncDone = useRef(false);

  const [isSupabaseActive, setIsSupabaseActive] = useState<boolean>(() => isSupabaseConfigured());
  const [dateRangeFilter, setDateRangeFilter] = useState<'7days' | '30days' | 'all'>('7days');
  const dateRangeFilterRef = useRef(dateRangeFilter);
  useEffect(() => {
    dateRangeFilterRef.current = dateRangeFilter;
  }, [dateRangeFilter]);

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasFullHistoryLoaded, setHasFullHistoryLoaded] = useState(false);
  const [totalRecordsCount, setTotalRecordsCount] = useState<number>(0);

  const lastUserActionTimestampRef = useRef<number>(0);
  const isSilentRefetchRef = useRef<boolean>(false);

  // ⚡ Lightweight helper: Refreshes ONLY dispatched keys from Supabase without refetching permits or vouchers
  const refreshDispatchedKeysOnly = async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const dbDispatchedData = await fetchDispatchedFromSupabase();
      if (dbDispatchedData && dbDispatchedData.dispatchedKeys) {
        const isCorrupted = (k: string) => {
          if (!k || !k.trim()) return true;
          const clean = k.trim();
          if (/^\d{8}$/.test(clean)) return true;
          if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return true;
          if (clean.toUpperCase() === 'UNDEFINED' || clean.toUpperCase() === 'NULL') return true;
          return false;
        };

        const currentUnsent = unsentKeysRef.current || [];
        const validKeys = dbDispatchedData.dispatchedKeys
          .filter(k => !isCorrupted(k))
          .filter(k => !currentUnsent.includes(k));

        dispatchedKeysRef.current = validKeys;
        setDispatchedKeys(validKeys);
        setDispatchDates(dbDispatchedData.dispatchDates || {});
        setDispatchBy(dbDispatchedData.dispatchBy || {});
      }
    } catch (err) {
      console.warn("Dispatched keys background sync error:", err);
    }
  };

  // 🔥 FIX: refreshDatabase - loads dispatched keys from Supabase without stale state closures
  const refreshDatabase = async (overrideFilter?: '7days' | '30days' | 'all', silent: boolean = false) => {
    // If in Offline Local Storage mode, do NOT perform network calls
    if (storageModeRef.current === "offline") {
      const localDbStr = safeLocalStorage.getItem("concessions_permit_db");
      const localVouchersStr = safeLocalStorage.getItem("concessions_vouchers_db");
      const localDispatchedStr = safeLocalStorage.getItem("concessions_dispatched_keys");
      const localDatesStr = safeLocalStorage.getItem("concessions_dispatch_dates");
      const localByStr = safeLocalStorage.getItem("concessions_dispatch_by");

      if (localDbStr) {
        try {
          const parsed = JSON.parse(localDbStr);
          databaseRef.current = parsed;
          setDatabase(parsed);
          setTotalRecordsCount(parsed.length);
        } catch (e) {}
      }
      if (localVouchersStr) {
        try {
          const parsed = JSON.parse(localVouchersStr);
          const normalized = normalizeVouchersList(parsed);
          vouchersDatabaseRef.current = normalized;
          setVouchersDatabase(normalized);
        } catch (e) {}
      }
      if (localDispatchedStr) {
        try {
          const parsed = JSON.parse(localDispatchedStr);
          dispatchedKeysRef.current = parsed;
          setDispatchedKeys(parsed);
        } catch (e) {}
      }
      if (localDatesStr) {
        try {
          const parsed = JSON.parse(localDatesStr);
          dispatchDatesRef.current = parsed;
          setDispatchDates(parsed);
        } catch (e) {}
      }
      if (localByStr) {
        try {
          const parsed = JSON.parse(localByStr);
          dispatchByRef.current = parsed;
          setDispatchBy(parsed);
        } catch (e) {}
      }
      return;
    }

    if (!isSupabaseConfigured()) return;
    const filterToUse = overrideFilter || dateRangeFilterRef.current;
    const daysLimit = filterToUse === '7days' ? 7 : filterToUse === '30days' ? 30 : null;

    if (!silent) setIsLoadingHistory(true);
    isSilentRefetchRef.current = silent;

    try {
      const [dbPermits, dbVouchers, dbDispatchedData] = await Promise.all([
        fetchPermitsFromSupabase({ daysLimit }),
        fetchVouchersFromSupabase(),
        fetchDispatchedFromSupabase()
      ]);

      if (dbPermits) {
        const currentDb = databaseRef.current;
        const isIdentical = currentDb.length === dbPermits.length && currentDb.every((rec, idx) => {
          const target = dbPermits[idx];
          return target &&
            rec.id === target.id &&
            rec.formId === target.formId &&
            rec.vrm === target.vrm &&
            rec.driverName === target.driverName &&
            rec.dateRequired === target.dateRequired &&
            rec.voucherCode === target.voucherCode &&
            rec.startTime === target.startTime;
        });

        if (!isIdentical) {
          databaseRef.current = dbPermits;
          setDatabase(dbPermits);
          safeLocalStorage.setItem("concessions_permit_db", JSON.stringify(dbPermits));
        }

        const countFromDb = (dbPermits as { totalCount?: number }).totalCount;
        if (typeof countFromDb === 'number' && countFromDb > 0) {
          setTotalRecordsCount(countFromDb);
        } else {
          setTotalRecordsCount(dbPermits.length);
        }
        if (daysLimit === null) {
          setHasFullHistoryLoaded(true);
        }
      }
      if (dbVouchers) {
        const currentVouchersDb = vouchersDatabaseRef.current;
        const isVouchersIdentical = currentVouchersDb.length === dbVouchers.length && currentVouchersDb.every((v, idx) => {
          const target = dbVouchers[idx];
          return target && v.code === target.code && v.vrm === target.vrm && v.validFrom === target.validFrom && v.validTo === target.validTo;
        });
        if (!isVouchersIdentical) {
          vouchersDatabaseRef.current = dbVouchers;
          setVouchersDatabase(dbVouchers);
          safeLocalStorage.setItem("concessions_vouchers_db", JSON.stringify(dbVouchers));
        }
      }
      
      // 🔥 FIX: Update dispatched keys directly from Supabase (Source of Truth)
      if (dbDispatchedData && dbDispatchedData.dispatchedKeys) {
        const isCorrupted = (k: string) => {
          if (!k || !k.trim()) return true;
          const clean = k.trim();
          if (/^\d{8}$/.test(clean)) return true;
          if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return true;
          if (clean.toUpperCase() === 'UNDEFINED' || clean.toUpperCase() === 'NULL') return true;
          return false;
        };

        const currentUnsent = unsentKeysRef.current || [];
        const validKeys = dbDispatchedData.dispatchedKeys
          .filter(k => !isCorrupted(k))
          .filter(k => !currentUnsent.includes(k));
        
        dispatchedKeysRef.current = validKeys;
        setDispatchedKeys(validKeys);
        setDispatchDates(dbDispatchedData.dispatchDates || {});
        setDispatchBy(dbDispatchedData.dispatchBy || {});

        safeLocalStorage.setItem("concessions_dispatched_keys", JSON.stringify(validKeys));
        safeLocalStorage.setItem("concessions_dispatch_dates", JSON.stringify(dbDispatchedData.dispatchDates || {}));
        safeLocalStorage.setItem("concessions_dispatch_by", JSON.stringify(dbDispatchedData.dispatchBy || {}));
      }
    } catch (err) {
      console.warn("Real-time database fetch error:", err);
    } finally {
      if (!silent) setIsLoadingHistory(false);
    }
  };

  // 🔥 Manual Sync Handler for Cloud Mode
  const handleManualSync = async () => {
    if (storageModeRef.current !== "cloud") return;
    setIsSyncing(true);
    try {
      await refreshDatabase(undefined, false);
      showToast("Database successfully synced with Supabase cloud!", "success");
    } catch (err: any) {
      showToast(`Sync failed: ${err?.message || 'Network error'}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // 🔥 Toggle Storage Mode (Cloud <-> Offline) with automatic sync on reconnect
  const handleToggleStorageMode = async () => {
    if (storageMode === "cloud") {
      // Switching from Cloud to Offline
      setStorageMode("offline");
      storageModeRef.current = "offline";
      safeLocalStorage.setItem("app_storage_mode", "offline");
      
      // Save current in-memory state to localStorage for offline access
      if (databaseRef.current && databaseRef.current.length > 0) {
        safeLocalStorage.setItem("concessions_permit_db", JSON.stringify(databaseRef.current));
      }
      if (vouchersDatabaseRef.current && vouchersDatabaseRef.current.length > 0) {
        safeLocalStorage.setItem("concessions_vouchers_db", JSON.stringify(vouchersDatabaseRef.current));
      }
      if (dispatchedKeysRef.current && dispatchedKeysRef.current.length > 0) {
        safeLocalStorage.setItem("concessions_dispatched_keys", JSON.stringify(dispatchedKeysRef.current));
      }
      if (dispatchDatesRef.current && Object.keys(dispatchDatesRef.current).length > 0) {
        safeLocalStorage.setItem("concessions_dispatch_dates", JSON.stringify(dispatchDatesRef.current));
      }
      if (dispatchByRef.current && Object.keys(dispatchByRef.current).length > 0) {
        safeLocalStorage.setItem("concessions_dispatch_by", JSON.stringify(dispatchByRef.current));
      }

      showToast("Switched to Offline Local Storage mode. Background sync paused.", "info");
    } else {
      // Switching from Offline back to Supabase Cloud -> Trigger Auto-Re-Sync
      setStorageMode("cloud");
      storageModeRef.current = "cloud";
      safeLocalStorage.setItem("app_storage_mode", "cloud");
      setIsSyncing(true);
      showToast("Reconnected to Cloud. Synchronizing local records to Supabase...", "info");

      try {
        const localPermitsStr = safeLocalStorage.getItem("concessions_permit_db");
        const localVouchersStr = safeLocalStorage.getItem("concessions_vouchers_db");
        const localDispatchedStr = safeLocalStorage.getItem("concessions_dispatched_keys");
        const localDatesStr = safeLocalStorage.getItem("concessions_dispatch_dates");
        const localByStr = safeLocalStorage.getItem("concessions_dispatch_by");

        let localPermits: CsvPermitRecord[] = [];
        let localVouchers: ParsedVoucherData[] = [];
        let localDispatchedKeys: string[] = [];
        let localDates: Record<string, string> = {};
        let localBy: Record<string, string> = {};

        try { if (localPermitsStr) localPermits = JSON.parse(localPermitsStr); } catch (e) {}
        try { if (localVouchersStr) localVouchers = JSON.parse(localVouchersStr); } catch (e) {}
        try { if (localDispatchedStr) localDispatchedKeys = JSON.parse(localDispatchedStr); } catch (e) {}
        try { if (localDatesStr) localDates = JSON.parse(localDatesStr); } catch (e) {}
        try { if (localByStr) localBy = JSON.parse(localByStr); } catch (e) {}

        // 1. Bulk sync local permits to Supabase if any exist
        if (localPermits.length > 0) {
          await syncPermitsToSupabase(localPermits, false);
        }

        // 2. Bulk sync local vouchers to Supabase if any exist
        if (localVouchers.length > 0) {
          await syncVouchersToSupabase(localVouchers, false);
        }

        // 3. Bulk sync local dispatched keys to Supabase
        if (localDispatchedKeys.length > 0) {
          const itemsToSync = localDispatchedKeys.map(k => ({
            key: k,
            dispatchedDate: localDates[k] || getTodayISO(),
            dispatchedBy: localBy[k] || currentUserName || 'System User'
          }));
          await bulkSyncDispatchedToSupabase(itemsToSync);
        }

        // 4. Refresh full state from cloud
        await refreshDatabase(undefined, false);
        showToast("Auto-sync complete! All offline records updated to Supabase Cloud.", "success");
      } catch (syncErr: any) {
        console.error("Auto-re-sync error:", syncErr);
        showToast(`Auto-sync warning: ${syncErr?.message || 'Could not sync all records'}`, "warning");
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handlePurgeCorruptedKeys = async () => {
    if (isSupabaseConfigured()) {
      const { count, deletedKeys } = await cleanupCorruptedDispatchedKeys();
      console.log(`[Purge Keys] Cleaned ${count} corrupted collision keys:`, deletedKeys);
    }
    await refreshDatabase();
  };

  const handleDateRangeFilterChange = async (newFilter: '7days' | '30days' | 'all') => {
    setDateRangeFilter(newFilter);
    await refreshDatabase(newFilter);
  };

  const handleExportExcel = async () => {
    let recordsToExport = database;
    if (isSupabaseConfigured() && !hasFullHistoryLoaded) {
      setIsLoadingHistory(true);
      try {
        const allPermits = await fetchPermitsFromSupabase({ daysLimit: null });
        if (allPermits && allPermits.length > 0) {
          recordsToExport = allPermits;
          setDatabase(allPermits);
          setHasFullHistoryLoaded(true);
        }
      } catch (err) {
        console.warn("Export full history fetch failed, falling back to current memory database:", err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
    exportToExcel(recordsToExport, "Concessions_Permits_Export.xlsx", customVouchers, formData.todayDate || getTodayISO());
  };

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && storageModeRef.current === "cloud") {
        refreshDatabase(undefined, true);
      }
    };

    const initAndFetch = async () => {
      // If offline mode is active, load from local storage immediately and do not connect to Supabase
      if (storageModeRef.current === "offline") {
        const localPermits = safeLocalStorage.getItem("concessions_permit_db");
        if (localPermits) {
          try {
            const parsed = JSON.parse(localPermits);
            setDatabase(parsed);
            databaseRef.current = parsed;
            setTotalRecordsCount(parsed.length);
          } catch (e) {}
        } else {
          const demoData = parsePermitCsv(INITIAL_DEMO_CSV);
          setDatabase(demoData);
          databaseRef.current = demoData;
          setTotalRecordsCount(demoData.length);
        }
        setIsSupabaseActive(false);
        initialSupabaseSyncDone.current = true;
        return;
      }

      await initSupabaseConfig();
      const configured = isSupabaseConfigured();
      if (!configured) {
        setIsSupabaseActive(false);
        initialSupabaseSyncDone.current = true;
        
        // Hydrate permits from LocalStorage
        const localPermits = safeLocalStorage.getItem("concessions_permit_db");
        if (localPermits) {
          try {
            const parsed = JSON.parse(localPermits);
            setDatabase(parsed);
            databaseRef.current = parsed;
            setTotalRecordsCount(parsed.length);
          } catch (e) {
            const demoData = parsePermitCsv(INITIAL_DEMO_CSV);
            setDatabase(demoData);
            databaseRef.current = demoData;
            setTotalRecordsCount(demoData.length);
          }
        } else {
          const demoData = parsePermitCsv(INITIAL_DEMO_CSV);
          setDatabase(demoData);
          databaseRef.current = demoData;
          setTotalRecordsCount(demoData.length);
        }

        // Hydrate vouchers from LocalStorage immediately
        const localVouchersStr = safeLocalStorage.getItem("concessions_vouchers_db") || safeLocalStorage.getItem("vouchers") || safeLocalStorage.getItem("activeCodes");
        if (localVouchersStr) {
          try {
            const parsedVouchers = JSON.parse(localVouchersStr);
            if (Array.isArray(parsedVouchers)) {
              const sanitized = parsedVouchers.map((item: any) => ({
                ...item,
                code: item.code || item.VoucherCode || item.Code || "",
                status: item.status || "active",
                isUsed: item.isUsed !== undefined ? item.isUsed : false,
              })).filter((item: any) => item.code);
              setVouchersDatabase(sanitized);
              vouchersDatabaseRef.current = sanitized;
            }
          } catch (e) {}
        }
        return;
      }

      const conn = await checkSupabaseConnection();
      setIsSupabaseActive(conn.connected);

      if (conn.connected) {
        cleanupCorruptedDispatchedKeys().catch(e => console.warn("Cleanup key check failed:", e));
        await refreshDatabase(undefined, false);

        unsubscribe = subscribeToSupabaseChanges(() => {
          if (storageModeRef.current !== "cloud") return;
          if (Date.now() - lastUserActionTimestampRef.current < 2500) {
            return;
          }
          refreshDatabase(undefined, true);
        });

        pollInterval = setInterval(() => {
          if (storageModeRef.current === "cloud" && document.visibilityState === 'visible') {
            refreshDatabase(undefined, true);
          }
        }, 30000);

        window.addEventListener("visibilitychange", handleVisibilityChange);
      } else {
        const localPermits = safeLocalStorage.getItem("concessions_permit_db");
        if (localPermits) {
          try {
            const parsed = JSON.parse(localPermits);
            setDatabase(parsed);
            databaseRef.current = parsed;
          } catch (e) {
            setDatabase(parsePermitCsv(INITIAL_DEMO_CSV));
          }
        } else {
          setDatabase(parsePermitCsv(INITIAL_DEMO_CSV));
        }

        const localVouchersStr = safeLocalStorage.getItem("concessions_vouchers_db") || safeLocalStorage.getItem("vouchers") || safeLocalStorage.getItem("activeCodes");
        if (localVouchersStr) {
          try {
            const parsedVouchers = JSON.parse(localVouchersStr);
            if (Array.isArray(parsedVouchers)) {
              const sanitized = parsedVouchers.map((item: any) => ({
                ...item,
                code: item.code || item.VoucherCode || item.Code || "",
                status: item.status || "active",
                isUsed: item.isUsed !== undefined ? item.isUsed : false,
              })).filter((item: any) => item.code);
              setVouchersDatabase(sanitized);
              vouchersDatabaseRef.current = sanitized;
            }
          } catch (e) {}
        }
      }
      initialSupabaseSyncDone.current = true;
    };

    initAndFetch();

    return () => {
      if (unsubscribe) unsubscribe();
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [storageMode]);

  const enrichedDatabase = React.useMemo(() => {
    return enrichRecordsWithVouchers(
      database,
      vouchersDatabase,
      customVouchers,
      formData.todayDate || getTodayISO(),
      dispatchedKeys,
      unsentKeys
    );
  }, [database, vouchersDatabase, customVouchers, formData.todayDate, dispatchedKeys, unsentKeys]);

  const isManualSelectionRef = useRef(false);
  const isUserNavigationRef = useRef(false);

  useEffect(() => {
    if (isManualSelectionRef.current) {
      isManualSelectionRef.current = false;
      isUserNavigationRef.current = false;
      setLastProcessedDate(formData.todayDate || getTodayISO());
      setLastDbLength(enrichedDatabase.length);
      return;
    }

    if (isSilentRefetchRef.current) {
      isSilentRefetchRef.current = false;
      setLastProcessedDate(formData.todayDate || getTodayISO());
      setLastDbLength(enrichedDatabase.length);
      return;
    }

    const activeDateStr = formData.todayDate || getTodayISO();
    if (!activeDateStr || !enrichedDatabase || enrichedDatabase.length === 0) {
      return;
    }

    const dateChanged = activeDateStr !== lastProcessedDate;
    const dbChanged = enrichedDatabase.length !== lastDbLength;
    const userNav = isUserNavigationRef.current;
    isUserNavigationRef.current = false;

    if (dateChanged || dbChanged || userNav) {
      setLastProcessedDate(activeDateStr);
      setLastDbLength(enrichedDatabase.length);

      const matching = getMatchingPermits(enrichedDatabase, activeDateStr);

      if (matching.length > 0) {
        const currentCleanVrm = (formData.vrm || "").toUpperCase().replace(/\s+/g, "");
        const currentCleanName = (formData.name || "").toUpperCase().replace(/\s+/g, "");
        const alreadyMatched = matching.find(r => 
          currentCleanVrm && r.vrm.toUpperCase().replace(/\s+/g, "") === currentCleanVrm &&
          (!currentCleanName || (r.driverName || "").toUpperCase().replace(/\s+/g, "") === currentCleanName)
        );

        if (alreadyMatched && !userNav) {
          return;
        }

        const firstUnsent = matching.find((item) => {
          return !checkIsRecordDispatched(item, item.vrm, item.driverName, item.dateRequired, dispatchedKeys, unsentKeys);
        });

        const targetRecord = firstUnsent || matching[0];

        const fromISO = parseDateToISO(targetRecord.dateRequired) || getTodayISO();
        const toISO = addDays(fromISO, 6);

        setFormData((prev) => ({
          ...prev,
          id: targetRecord.id,
          formId: targetRecord.formId || targetRecord.id,
          site: targetRecord.hospital,
          name: targetRecord.driverName ? toTitleCase(targetRecord.driverName) : "",
          vrm: targetRecord.vrm ? targetRecord.vrm.toUpperCase() : "",
          ward: targetRecord.ward ? toTitleCase(targetRecord.ward) : "",
          validFrom: fromISO,
          validTo: toISO,
          phone: formatPhoneNumber(targetRecord.phone || ""),
          email: (targetRecord.email || "").toLowerCase(),
          voucherCodesText: targetRecord.voucherCode || "-",
          startTime: targetRecord.startTime,
          createdAt: targetRecord.createdAt
        }));
      }
    }
  }, [formData.todayDate, formData.vrm, formData.name, enrichedDatabase, dispatchedKeys, unsentKeys, lastProcessedDate, lastDbLength]);

  const handleUpdate = (updates: Partial<PermitData>) => {
    setFormData((prev) => {
      let next = { ...prev, ...updates };

      if (updates.phone !== undefined) {
        next.phone = formatPhoneNumber(updates.phone);
      }

      if (updates.vrm !== undefined && updates.name === undefined) {
        const cleanVrm = updates.vrm.toUpperCase().replace(/\s+/g, "");
        if (cleanVrm) {
          const activeDateISO = parseDateToISO(next.todayDate || next.validFrom || "") || getTodayISO();
          const match = enrichedDatabase.find(r => {
            const rVrm = r.vrm ? r.vrm.toUpperCase().replace(/\s+/g, "") : "";
            const rDate = parseDateToISO(r.dateRequired || r.validFrom || "") || "";
            return rVrm === cleanVrm && (!rDate || rDate === activeDateISO);
          }) || enrichedDatabase.find(r => (r.vrm || "").toUpperCase().replace(/\s+/g, "") === cleanVrm);
          if (match) {
            const fromISO = parseDateToISO(match.dateRequired) || getTodayISO();
            const toISO = addDays(fromISO, 6);
            return {
              ...next,
              id: match.id || next.id,
              formId: match.formId || next.formId,
              site: match.hospital,
              name: match.driverName ? toTitleCase(match.driverName) : "",
              ward: match.ward ? toTitleCase(match.ward) : "",
              validFrom: fromISO,
              validTo: toISO,
              phone: formatPhoneNumber(match.phone || prev.phone || ""),
              email: (match.email || prev.email || "").toLowerCase(),
              voucherCodesText: match.voucherCode || prev.voucherCodesText || ""
            };
          }
        }
      }

      return next;
    });

    if (updates.voucherCodesText !== undefined) {
      const activeVrm = updates.vrm || formData.vrm;
      const cleanVrm = activeVrm ? activeVrm.toUpperCase().replace(/\s+/g, "") : "";
      const activeDateISO = parseDateToISO(formData.validFrom || formData.todayDate || "") || getTodayISO();
      const targetId = String(updates.id || formData.id || "").trim();
      const targetFormId = String(updates.formId || formData.formId || "").trim();

      if (cleanVrm || targetId || targetFormId) {
        const nextCustomVouchers = { ...customVouchers };
        if (targetFormId) {
          nextCustomVouchers[targetFormId] = updates.voucherCodesText || "";
        }
        if (targetId) {
          nextCustomVouchers[targetId] = updates.voucherCodesText || "";
        }
        if (cleanVrm && activeDateISO) {
          const keyWithDate = `${cleanVrm}_${activeDateISO}`;
          nextCustomVouchers[keyWithDate] = updates.voucherCodesText || "";
        }
        setCustomVouchers(nextCustomVouchers);
        safeLocalStorage.setItem("concessions_custom_vouchers", JSON.stringify(nextCustomVouchers));
        const nowTimestamp = Date.now();
        safeLocalStorage.setItem("concessions_custom_vouchers_last_modified", String(nowTimestamp));

        setDatabase((prevDb) => {
          return prevDb.map((rec) => {
            const recId = String(rec.id ?? "").trim();
            const recFormId = String(rec.formId ?? "").trim();

            const isTarget = Boolean(
              (targetId && (recId === targetId || recFormId === targetId)) ||
              (targetFormId && (recFormId === targetFormId || recId === targetFormId))
            );

            if (isTarget) {
              return { ...rec, voucherCode: updates.voucherCodesText || "" };
            }

            // Fallback only if no target ID or formId is available
            if (!targetId && !targetFormId) {
              const recVrmClean = rec.vrm ? rec.vrm.toUpperCase().replace(/\s+/g, "") : "";
              const recDateISO = parseDateToISO(rec.dateRequired || "") || "";
              if (recVrmClean === cleanVrm && (!recDateISO || !activeDateISO || recDateISO === activeDateISO)) {
                return { ...rec, voucherCode: updates.voucherCodesText || "" };
              }
            }

            return rec;
          });
        });

        // When a voucher code is changed or selected from Active Date Codes, reset this permit's STATUS to Pending
        const targetRecord = (updates.id || formData.id || updates.formId || formData.formId)
          ? enrichedDatabase.find(r => 
              ((updates.id || formData.id) && r.id === (updates.id || formData.id)) ||
              ((updates.formId || formData.formId) && (r.formId === (updates.formId || formData.formId) || r.id === (updates.formId || formData.formId)))
            )
          : enrichedDatabase.find(r => {
              const rVrm = r.vrm ? r.vrm.toUpperCase().replace(/\s+/g, "") : "";
              const rDate = parseDateToISO(r.dateRequired || "") || "";
              return rVrm === cleanVrm && (!rDate || !activeDateISO || rDate === activeDateISO);
            });

        const keysToUnsent: string[] = [];
        if (targetRecord) {
          keysToUnsent.push(...getRecordKeys(targetRecord));
          const pk = getRecordPrimaryKey(targetRecord);
          if (pk) keysToUnsent.push(pk);
        }
        if (updates.id || formData.id) {
          keysToUnsent.push(String(updates.id || formData.id));
        }
        if (updates.formId || formData.formId) {
          keysToUnsent.push(String(updates.formId || formData.formId));
        }
        if (cleanVrm) {
          keysToUnsent.push(cleanVrm);
          if (activeDateISO) {
            keysToUnsent.push(`${cleanVrm}_${activeDateISO}`);
          }
          if (formData.name || updates.name) {
            const nameStr = (updates.name || formData.name || "").trim();
            keysToUnsent.push(`${nameStr}_${cleanVrm}_${activeDateISO}`.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          }
        }

        const uniqueKeysToUnsent = Array.from(new Set(keysToUnsent.filter(Boolean)));
        if (uniqueKeysToUnsent.length > 0) {
          setUnsentKeys(prev => {
            const next = Array.from(new Set([...prev, ...uniqueKeysToUnsent]));
            unsentKeysRef.current = next;
            return next;
          });
          setDispatchedKeys(prev => {
            const next = prev.filter(k => !uniqueKeysToUnsent.includes(k));
            dispatchedKeysRef.current = next;
            return next;
          });
        }
      }
    }
  };

  const handleProcessingDateChange = (dateISO: string) => {
    if (dateISO) {
      setFormData(prev => ({
        ...prev,
        todayDate: dateISO
      }));
    }
  };

  const handleSelectRecord = (record: CsvPermitRecord) => {
    isManualSelectionRef.current = true;
    isUserNavigationRef.current = true;
    const enrichedRecord = (record.id ? enrichedDatabase.find(r => r.id === record.id) : null) || 
                           (record.formId ? enrichedDatabase.find(r => r.formId === record.formId) : null) || 
                           record;
    const fromISO = parseDateToISO(enrichedRecord.dateRequired) || getTodayISO();
    const toISO = addDays(fromISO, 6);

    const isRecordDispatched = checkIsRecordDispatched(
      enrichedRecord,
      enrichedRecord.vrm,
      enrichedRecord.driverName,
      enrichedRecord.dateRequired,
      dispatchedKeys,
      unsentKeys
    );

    setFormData((prev) => ({
      ...prev,
      id: enrichedRecord.id,
      formId: enrichedRecord.formId || enrichedRecord.id,
      site: enrichedRecord.hospital,
      name: enrichedRecord.driverName ? toTitleCase(enrichedRecord.driverName) : "",
      vrm: enrichedRecord.vrm ? enrichedRecord.vrm.toUpperCase() : "",
      ward: enrichedRecord.ward ? toTitleCase(enrichedRecord.ward) : "",
      validFrom: fromISO,
      validTo: toISO,
      phone: formatPhoneNumber(enrichedRecord.phone || ""),
      email: (enrichedRecord.email || "").toLowerCase(),
      voucherCodesText: enrichedRecord.voucherCode || "-",
      startTime: enrichedRecord.startTime,
      createdAt: enrichedRecord.createdAt,
      isResend: isRecordDispatched ? prev.isResend : false,
      emailType: isRecordDispatched ? prev.emailType : "SEND_CONCESSION",
      emailTemplate: isRecordDispatched ? prev.emailTemplate : "new"
    }));
  };

  const handleSelectRecordQuickSearch = (record: CsvPermitRecord) => {
    isManualSelectionRef.current = true;
    isUserNavigationRef.current = true;
    const enrichedRecord = (record.id ? enrichedDatabase.find(r => r.id === record.id) : null) || 
                           (record.formId ? enrichedDatabase.find(r => r.formId === record.formId) : null) || 
                           record;
    const fromISO = parseDateToISO(enrichedRecord.dateRequired) || getTodayISO();
    const toISO = addDays(fromISO, 6);

    const isRecordDispatched = checkIsRecordDispatched(
      enrichedRecord,
      enrichedRecord.vrm,
      enrichedRecord.driverName,
      enrichedRecord.dateRequired,
      dispatchedKeys,
      unsentKeys
    );

    setFormData((prev) => ({
      ...prev,
      id: enrichedRecord.id,
      formId: enrichedRecord.formId || enrichedRecord.id,
      site: enrichedRecord.hospital,
      name: enrichedRecord.driverName ? toTitleCase(enrichedRecord.driverName) : "",
      vrm: enrichedRecord.vrm ? enrichedRecord.vrm.toUpperCase() : "",
      ward: enrichedRecord.ward ? toTitleCase(enrichedRecord.ward) : "",
      validFrom: fromISO,
      validTo: toISO,
      phone: formatPhoneNumber(enrichedRecord.phone || ""),
      email: (enrichedRecord.email || "").toLowerCase(),
      voucherCodesText: enrichedRecord.voucherCode || "-",
      startTime: enrichedRecord.startTime,
      createdAt: enrichedRecord.createdAt,
      isResend: isRecordDispatched ? prev.isResend : false,
      emailType: isRecordDispatched ? prev.emailType : "SEND_CONCESSION",
      emailTemplate: isRecordDispatched ? prev.emailTemplate : "new"
    }));
  };

  const handleDatabaseChange = async (incomingDb: CsvPermitRecord[]) => {
    safeLocalStorage.removeItem("concessions_unsent_keys");
    
    const recordMap = new Map<number | string, CsvPermitRecord>();
    
    (database || []).forEach(item => {
      const key = item.formId !== undefined ? item.formId : item.id;
      if (key !== undefined && key !== null) {
        recordMap.set(key, { ...item });
      }
    });

    (incomingDb || []).forEach(item => {
      const key = item.formId !== undefined ? item.formId : item.id;
      if (key !== undefined && key !== null) {
        const existing = recordMap.get(key);
        if (existing) {
          recordMap.set(key, { ...existing, ...item });
        } else {
          recordMap.set(key, { ...item });
        }
      }
    });

    const combinedDb = Array.from(recordMap.values());
    const sorted = sortRecordsByFormIdDesc(combinedDb);

    setDatabase(sorted);
    setTotalRecordsCount(prev => Math.max(prev, sorted.length));

    safeLocalStorage.setItem("concessions_permit_db", JSON.stringify(sorted));
    const nowTimestamp = Date.now();
    safeLocalStorage.setItem("concessions_permit_db_last_modified", String(nowTimestamp));

    if (storageModeRef.current === "cloud" && isSupabaseConfigured()) {
      await syncPermitsToSupabase(sorted, false);
      await refreshDatabase(undefined, true);
    }

    if (incomingDb && incomingDb.length > 0) {
      const firstRecord = incomingDb[0];
      const fromISO = parseDateToISO(firstRecord.dateRequired) || getTodayISO();
      const toISO = addDays(fromISO, 6);
      
      setFormData((prev) => ({
        ...prev,
        site: firstRecord.hospital,
        name: firstRecord.driverName ? toTitleCase(firstRecord.driverName) : "",
        vrm: firstRecord.vrm ? firstRecord.vrm.toUpperCase() : "",
        ward: firstRecord.ward ? toTitleCase(firstRecord.ward) : "",
        validFrom: fromISO,
        validTo: toISO,
        phone: formatPhoneNumber(firstRecord.phone || prev.phone || ""),
        email: (firstRecord.email || prev.email || "").toLowerCase(),
        voucherCodesText: firstRecord.voucherCode || prev.voucherCodesText || ""
      }));
    }
  };

  const handleVouchersDatabaseChange = async (incomingVouchers: ParsedVoucherData[]) => {
    const mergedMap = new Map<string, ParsedVoucherData>();
    const todayISO = getTodayISO();

    (vouchersDatabase || []).forEach(v => {
      if (!v.code) return;
      const cleanKey = cleanVoucherCodeValue(v.code).toUpperCase();
      if (cleanKey && cleanKey !== "-") {
        mergedMap.set(cleanKey, { ...v });
      }
    });

    (incomingVouchers || []).forEach(v => {
      if (!v.code) return;
      const cleanKey = cleanVoucherCodeValue(v.code).toUpperCase();
      if (cleanKey && cleanKey !== "-") {
        const existing = mergedMap.get(cleanKey);
        const effectiveValidFrom = v.validFrom || (existing ? existing.validFrom : todayISO);
        if (existing) {
          mergedMap.set(cleanKey, {
            ...existing,
            ...v,
            vrm: v.vrm || existing.vrm,
            validFrom: effectiveValidFrom,
            validTo: v.validTo || existing.validTo,
            uploadDate: v.uploadDate || existing.uploadDate || todayISO
          });
        } else {
          mergedMap.set(cleanKey, {
            ...v,
            validFrom: effectiveValidFrom,
            uploadDate: v.uploadDate || todayISO
          });
        }
      }
    });

    const combinedVouchers = Array.from(mergedMap.values());
    setVouchersDatabase(combinedVouchers);

    safeLocalStorage.setItem("concessions_vouchers_db", JSON.stringify(combinedVouchers));
    const nowTimestamp = Date.now();
    safeLocalStorage.setItem("concessions_vouchers_db_last_modified", String(nowTimestamp));

    if (storageModeRef.current === "cloud" && isSupabaseConfigured()) {
      await syncVouchersToSupabase(combinedVouchers, false);
      await refreshDatabase(undefined, true);
    }
  };

  const handleClear = () => {
    setFormData({
      title: "Patient & Visitor Concessions",
      site: "",
      name: "",
      vrm: "",
      validFrom: "",
      validTo: "",
      ward: "",
      qrOverride: "",
      voucherCodesText: "",
      phone: "",
      email: "",
      todayDate: ""
    });
  };

  const handleHeaderSend = async () => {
    if (!formData.vrm) {
      showToast("Select a permit record first.", "warning");
      return;
    }
    await permitCardRef.current?.send();
  };

  const handleBulkEmail = async () => {
    await permitCardRef.current?.bulkEmail();
  };

  const handleHeaderPrint = () => {
    if (!formData.vrm) {
      showToast("Select a permit record first.", "warning");
      return;
    }
    permitCardRef.current?.print();
  };

  const handleDispatchRecord = async (record: CsvPermitRecord) => {
    handleSelectRecord(record);
    if (permitCardRef.current?.sendOne) {
      await permitCardRef.current.sendOne(record);
    } else if (permitCardRef.current?.send) {
      await permitCardRef.current.send(record);
    } else {
      await markAsDispatched(record.vrm, record.email, record);
    }
  };

  const handleUnsendRecord = async (record: CsvPermitRecord) => {
    handleSelectRecord(record);
    if (permitCardRef.current?.unsend) {
      await permitCardRef.current.unsend(record);
    } else {
      await unmarkAsDispatched(record.vrm, record.email, record);
    }
  };

  return (
    <div className="park-app" id="print-root-container">
      <style>{`@media print { body { background:#fff !important; } .no-print, .data-sidebar, .form-panel, .dispatch-panel, .park-view-tabs { display:none !important; } #print-card-wrapper { display:block !important; position:fixed !important; inset:0 !important; margin:auto !important; width:370px !important; height:max-content !important; } #print-card-content { box-shadow:none !important; } }`}</style>
      {syncToast && (
        <div className={`park-toast ${syncToast.type}`}>
          {syncToast.type === "success" ? <CheckCircle2 /> : <AlertCircle />}
          <span>{syncToast.message}</span>
        </div>
      )}

      <Header
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        onExportExcel={handleExportExcel}
        onOutlook={handleHeaderSend}
        onEmail={handleHeaderSend}
        onPrint={handleHeaderPrint}
      />

      {activeTab === "dispatcher" && (
        <main className="w-full flex flex-col gap-4">
          <div className="dispatcher-layout">
            <CsvDatabasePanel
              database={enrichedDatabase}
              totalRecordsCount={totalRecordsCount > 0 ? totalRecordsCount : enrichedDatabase.length}
              onDatabaseChange={handleDatabaseChange}
              vouchersDatabase={vouchersDatabase}
              onVouchersDatabaseChange={handleVouchersDatabaseChange}
              onSelectRecord={handleSelectRecordQuickSearch}
              onRefreshDatabase={refreshDatabase}
              dispatchedKeys={dispatchedKeys}
              dispatchDates={dispatchDates}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              dateRangeFilter={dateRangeFilter}
              onDateRangeFilterChange={handleDateRangeFilterChange}
              isLoadingHistory={isLoadingHistory}
              processingDate={formData.todayDate || getTodayISO()}
              onProcessingDateChange={handleProcessingDateChange}
              customVouchersMap={customVouchers}
            />

            <div className="dispatcher-main">
              <PermitForm
                data={formData}
                database={enrichedDatabase}
                vouchersDatabase={vouchersDatabase}
                dispatchedKeys={dispatchedKeys}
                unsentKeys={unsentKeys}
                dispatchBy={dispatchBy}
                onChange={handleUpdate}
                onClear={handleClear}
              />
            </div>
          </div>

          <DispatchCentre
            database={enrichedDatabase}
            vouchersDatabase={vouchersDatabase}
            dispatchedKeys={dispatchedKeys}
            unsentKeys={unsentKeys}
            dispatchDates={dispatchDates}
            customVouchers={customVouchers}
            processingDate={formData.todayDate || getTodayISO()}
            formData={formData}
            totalRecordsCount={totalRecordsCount > 0 ? totalRecordsCount : enrichedDatabase.length}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSelectRecord={handleSelectRecord}
            onSendRecord={handleDispatchRecord}
            onUnsendRecord={handleUnsendRecord}
            onBulkEmail={handleBulkEmail}
            onClear={handleClear}
            onChangeFormData={handleUpdate}
          />

          <div id="print-card-wrapper" className="permit-card-engine" aria-hidden="true">
            <PermitCard
              ref={permitCardRef}
              data={formData}
              database={enrichedDatabase}
              vouchersDatabase={vouchersDatabase}
              dispatchedKeys={dispatchedKeys}
              unsentKeys={unsentKeys}
              dispatchBy={dispatchBy}
              markAsDispatched={markAsDispatched}
              unmarkAsDispatched={unmarkAsDispatched}
              onSelectRecord={handleSelectRecord}
              onChange={handleUpdate}
            />
          </div>
        </main>
      )}

      {activeTab === "table" && (
        <TableView
          database={enrichedDatabase}
          totalRecordsCount={totalRecordsCount > 0 ? totalRecordsCount : enrichedDatabase.length}
          vouchersDatabase={vouchersDatabase}
          dispatchedKeys={dispatchedKeys}
          unsentKeys={unsentKeys}
          dispatchDates={dispatchDates}
          processingDate={formData.todayDate || getTodayISO()}
          onSelectRecord={handleSelectRecordQuickSearch}
          onProcessingDateChange={handleProcessingDateChange}
          onSwitchToDispatcher={() => setActiveTab("dispatcher")}
          onExportExcel={handleExportExcel}
          dateRangeFilter={dateRangeFilter}
          onDateRangeFilterChange={handleDateRangeFilterChange}
          isLoadingHistory={isLoadingHistory}
          onCleanDatabase={handlePurgeCorruptedKeys}
          customVouchersMap={customVouchers}
        />
      )}

      {activeTab === "analytics" && (
        <AnalyticsDashboard
          database={enrichedDatabase}
          vouchersDatabase={vouchersDatabase}
          dispatchedKeys={dispatchedKeys}
          unsentKeys={unsentKeys}
          dispatchDates={dispatchDates}
          storageMode={storageMode}
          onToggleStorageMode={handleToggleStorageMode}
          isSyncing={isSyncing}
          onSyncNow={handleManualSync}
          totalRecordsCount={totalRecordsCount > 0 ? totalRecordsCount : enrichedDatabase.length}
          onSelectWard={(wardName) => { setSearchQuery(wardName); setActiveTab("dispatcher"); }}
          onSelectSite={(siteName) => { setSearchQuery(siteName); setActiveTab("dispatcher"); }}
        />
      )}
    </div>
  );

}