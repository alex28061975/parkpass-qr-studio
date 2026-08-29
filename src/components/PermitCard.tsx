import React, { useState, useEffect, useMemo, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import QRCode from "qrcode";
import { PermitData } from "../types";
import { motion } from "motion/react";
import { CsvPermitRecord, ParsedVoucherData, parseDateToISO, parseDateRange, addDays, getTodayISO, getMatchingPermits, getUnusedVouchersForDate, getSpreadsheetMatchingAssignedCodes, isDateRequiredOutsideValidWindow, checkIsBlockedDuplicate, isRecordStrictlyEarlier, extractRecordSubmissionTimeMs, extractRecordNumericFormId, resolvePermitDate } from "../utils/csvParser";
import { getRecordKeys, checkIsRecordDispatched } from "../utils/dispatchUtils";
import { 
  getReplacementEmailContent, 
  getResendConcessionEmailContent,
  getSendEmailContent,
  getCancellationEmailContent, 
  formatVrmForEmail,
  formatDriverNameForEmail,
  deriveDateRangeForEmail,
  NHS_SUPPORT_EMAIL
} from "../utils/emailTemplateUtils";
import { safeLocalStorage } from "../utils/safeLocalStorage";
import { isVrmSilentBlocked } from "../lib/blocklist";
import { 
  Download, 
  Copy, 
  Check, 
  Printer, 
  Sparkles, 
  ExternalLink,
  ShieldAlert,
  Send,
  Mail,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Layers,
  History,
  Play,
  Settings,
  AlertCircle,
  FileImage,
  RotateCcw,
  Clock,
  X
} from "lucide-react";

export interface PermitCardHandle {
  send: () => Promise<boolean | void>;
  sendOne: (record?: CsvPermitRecord) => Promise<boolean | void>;
  bulkEmail: (records?: CsvPermitRecord[]) => Promise<boolean | void>;
  unsend: () => Promise<boolean | void>;
  print: () => void;
}

interface PermitCardProps {
  data: PermitData;
  database?: CsvPermitRecord[];
  vouchersDatabase?: ParsedVoucherData[];
  dispatchedKeys?: string[];
  unsentKeys?: string[];
  dispatchBy?: {[key: string]: string};
  markAsDispatched?: (vrm?: string, email?: string, record?: CsvPermitRecord) => Promise<boolean | void> | boolean | void;
  unmarkAsDispatched?: (vrm?: string, email?: string, record?: CsvPermitRecord) => Promise<boolean | void> | boolean | void;
  onSelectRecord?: (record: CsvPermitRecord) => void;
  onChange?: (updates: Partial<PermitData>) => void;
}

// Exported status helpers for use across components (PermitCard, TableView, PermitForm)
export function isRecordCancelled(record: Partial<CsvPermitRecord> | PermitData, todayDate?: string): boolean {
  if (!record) return false;
  const rec = record as any;
  // Ignore imported "CANCELLED" values - recompute dynamically from the record's
  // actual required date. A stored CANCELLED marker may be stale (re-imported
  // from an earlier export, or left over from a previous day).
  if (rec.isCancelled === true) return true;
  const referenceDate = todayDate || rec.todayDate || "";
  const dateRequired = rec.dateRequired || rec.validFrom || "";
  return isDateRequiredOutsideValidWindow(dateRequired, referenceDate);
}

// Aliases for clean importing
export const isCancelled = isRecordCancelled;

// Helper to format date to UK standard DD/MM/YYYY
function formatDate(d: string): string {
  if (!d) return "";
  const iso = parseDateToISO(d);
  if (!iso) return d;
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

// Helper to format UK registration mark with standard spacing (e.g. AB12 CDE)
function formatUKPlate(vrm: string): string {
  if (!vrm) return "";
  const clean = vrm.trim().toUpperCase().replace(/\s+/g, "");
  if (clean.length === 7) {
    const isStandard = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(clean);
    if (isStandard) {
      return `${clean.slice(0, 4)} ${clean.slice(4)}`;
    }
  }
  return vrm.trim().toUpperCase();
}

// Helper to format string to Title Case (capitalize each word)
function toTitleCase(str: string): string {
  if (!str || str === "-") return str;
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

// Helper to convert base64 Data URL to Blob synchronously
function dataURLtoBlob(dataurl: string): Blob {
  const parts = dataurl.split(",");
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function PermitCardInner({ 
  data, 
  database = [], 
  vouchersDatabase = [], 
  dispatchedKeys = [],
  unsentKeys = [],
  dispatchBy = {},
  markAsDispatched,
  unmarkAsDispatched,
  onSelectRecord, 
  onChange 
}: PermitCardProps, ref: React.ForwardedRef<PermitCardHandle>) {
  const [qrUrl, setQrUrl] = useState<string>("");
  const [qrUrlSmall, setQrUrlSmall] = useState<string>("");
  const [isSilentBlocked, setIsSilentBlocked] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "success">("idle");
  const [showUnsendConfirm, setShowUnsendConfirm] = useState<boolean>(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const [batchDownloadProgress, setBatchDownloadProgress] = useState<number | null>(null);
  const [batchDownloadType, setBatchDownloadType] = useState<"qr" | "card" | null>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [showPendingModal, setShowPendingModal] = useState<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showPendingModal) {
        setShowPendingModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPendingModal]);

  useEffect(() => {
    let active = true;
    const checkBlocked = async () => {
      if (!data.vrm) {
        setIsSilentBlocked(false);
        return;
      }
      const blocked = await isVrmSilentBlocked(data.vrm);
      if (active) {
        setIsSilentBlocked(blocked);
        if (blocked) {
          setQrUrl("");
          setQrUrlSmall("");
        }
      }
    };
    checkBlocked();

    const handleStorageUpdate = () => {
      checkBlocked();
    };
    window.addEventListener("blocklist_updated", handleStorageUpdate);
    return () => {
      active = false;
      window.removeEventListener("blocklist_updated", handleStorageUpdate);
    };
  }, [data.vrm]);

  // FIXED: Use the processing/submission date for matching
  const matchingPermits = useMemo(() => {
    const activeDateStr = resolvePermitDate(data);
    return getMatchingPermits(database, activeDateStr);
  }, [data, database]);

  // =========================================================================
  // 1. unusedVouchersForDay: Filters vouchers to only unused codes matching the target ISO date
  // =========================================================================
  const unusedVouchersForDay = useMemo<ParsedVoucherData[]>(() => {
    const permitDate = data.validFrom || (data as any).dateRequired || (data as any).processingDate || data.todayDate || "";
    const targetIso = parseDateToISO(permitDate);
    if (!targetIso) return [];

    const activeDateStr = resolvePermitDate(data);

    const spreadsheetAssignedCodes = getSpreadsheetMatchingAssignedCodes(
      matchingPermits,
      database,
      activeDateStr,
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

  const availableVouchersForDate = unusedVouchersForDay;
  const availableCodesCount = unusedVouchersForDay.length;

  // Derive activeIndex directly from currentCardIndex, safely clamped
  const activeIndex = useMemo(() => {
    if (matchingPermits.length === 0) return -1;
    if (currentCardIndex >= 0 && currentCardIndex < matchingPermits.length) {
      return currentCardIndex;
    }
    return 0;
  }, [matchingPermits.length, currentCardIndex]);

  // Keep currentCardIndex synchronized if date changes or if external selection occurs
  useEffect(() => {
    if (matchingPermits.length === 0) {
      if (currentCardIndex !== 0) setCurrentCardIndex(0);
      return;
    }

    if (currentCardIndex >= matchingPermits.length) {
      setCurrentCardIndex(0);
      return;
    }

    const curr = matchingPermits[currentCardIndex];
    const dataId = String((data as any).formId ?? data.id ?? "");
    const dataDate = parseDateToISO(data.validFrom || (data as any).dateRequired || "");

    if (curr) {
      const currId = String(curr.formId ?? curr.id ?? "");
      if (dataId && currId && (currId === dataId || String(curr.formId) === dataId || String(curr.id) === dataId)) {
        return;
      }
      const dataVrm = (data.vrm || "").toUpperCase().replace(/\s+/g, "");
      const dataName = (data.name || "").toUpperCase().replace(/\s+/g, "");
      const currVrm = curr.vrm.toUpperCase().replace(/\s+/g, "");
      const currName = (curr.driverName || "").toUpperCase().replace(/\s+/g, "");
      const currDate = parseDateToISO(curr.dateRequired || curr.validFrom || "");
      if (dataVrm && currVrm === dataVrm && (!dataName || currName === dataName) && (!dataDate || !currDate || dataDate === currDate)) {
        return;
      }
    }

    const dataVrm = (data.vrm || "").toUpperCase().replace(/\s+/g, "");
    const dataName = (data.name || "").toUpperCase().replace(/\s+/g, "");
    if (!dataId && !dataVrm) return;

    const foundIdx = matchingPermits.findIndex(p => {
      const pId = String(p.formId ?? p.id ?? "");
      if (dataId && pId && (pId === dataId || String(p.formId) === dataId || String(p.id) === dataId)) {
        return true;
      }
      const pVrm = p.vrm.toUpperCase().replace(/\s+/g, "");
      const pName = (p.driverName || "").toUpperCase().replace(/\s+/g, "");
      const pDate = parseDateToISO(p.dateRequired || p.validFrom || "");
      if (pVrm === dataVrm && (!dataName || pName === dataName)) {
        if (dataDate && pDate) {
          return pDate === dataDate;
        }
        return true;
      }
      return false;
    });

    if (foundIdx !== -1 && foundIdx !== currentCardIndex) {
      setCurrentCardIndex(foundIdx);
    }
  }, [data.vrm, data.name, (data as any).formId, data.id, data.validFrom, (data as any).dateRequired, matchingPermits]);

  const isRecordDispatched = useCallback((item: CsvPermitRecord) => {
    return checkIsRecordDispatched(item, item.vrm, item.driverName, item.dateRequired, dispatchedKeys, unsentKeys);
  }, [dispatchedKeys, unsentKeys]);

  const isCurrentDispatched = useMemo(() => {
    if (activeIndex !== -1 && matchingPermits[activeIndex]) {
      const activeRec = matchingPermits[activeIndex];
      return checkIsRecordDispatched(activeRec, activeRec.vrm, activeRec.driverName, activeRec.dateRequired, dispatchedKeys, unsentKeys);
    }
    const targetRecord = (database ? database.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))) : undefined) || (data as any);
    return checkIsRecordDispatched(targetRecord, data.vrm, data.name, data.validFrom || data.todayDate, dispatchedKeys, unsentKeys);
  }, [activeIndex, matchingPermits, data, database, dispatchedKeys, unsentKeys]);

  const [lastDispatchedCodeMap, setLastDispatchedCodeMap] = useState<Record<string, string>>({});

  const recordKeyStr = useMemo(() => {
    const activeRec = activeIndex !== -1 ? matchingPermits[activeIndex] : null;
    const vrm = (activeRec?.vrm || data.vrm || "").trim().toUpperCase();
    const name = (activeRec?.driverName || data.name || "").trim().toLowerCase();
    const date = (activeRec?.dateRequired || data.validFrom || data.todayDate || "").trim();
    const id = activeRec?.id || (activeRec as any)?.formId || "";
    return id ? `id_${id}` : `${vrm}_${name}_${date}`;
  }, [activeIndex, matchingPermits, data.vrm, data.name, data.validFrom, data.todayDate]);

  const currentSelectedCode = useMemo(() => {
    const raw = data.voucherCodesText || (data as any).voucherCode || (data as any).prePaidCode || "";
    if (!raw) return "";
    const firstLine = raw.split("\n")[0]?.trim() || "";
    return firstLine.toUpperCase();
  }, [data.voucherCodesText, (data as any).voucherCode, (data as any).prePaidCode]);

  useEffect(() => {
    if (isCurrentDispatched) {
      setLastDispatchedCodeMap(prev => {
        if (prev[recordKeyStr] === undefined) {
          const matchedRec = activeIndex !== -1 ? matchingPermits[activeIndex] : null;
          const initialCode = matchedRec
            ? (matchedRec.voucherCode || (matchedRec as any).prePaidCode || (matchedRec as any).voucherCodesText || "")
            : (data.voucherCodesText || (data as any).voucherCode || "");
          const cleanInit = (initialCode && initialCode !== "-" && initialCode.toUpperCase() !== "CANCELLED") ? initialCode.trim().toUpperCase() : "";
          return { ...prev, [recordKeyStr]: cleanInit };
        }
        return prev;
      });
    }
  }, [isCurrentDispatched, recordKeyStr, activeIndex, matchingPermits]);

  // Original voucher code assigned to this record in the database or when first dispatched
  const originalVoucherCode = useMemo(() => {
    const matchedRec = activeIndex !== -1 ? matchingPermits[activeIndex] : (database?.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))));
    const dbCode = (matchedRec?.voucherCode || (matchedRec as any)?.prePaidCode || (matchedRec as any)?.voucherCodesText || "").trim().toUpperCase();
    const dispatchedCode = (lastDispatchedCodeMap[recordKeyStr] ?? "").trim().toUpperCase();
    return dispatchedCode || (dbCode && dbCode !== "-" && dbCode !== "CANCELLED" ? dbCode : "");
  }, [activeIndex, matchingPermits, database, (data as any).formId, lastDispatchedCodeMap, recordKeyStr]);

  // Determine whether the QR code / voucher code has actually changed from the original code
  const qrCodeChanged = useMemo(() => {
    if (!currentSelectedCode || currentSelectedCode === "-" || currentSelectedCode === "CANCELLED") {
      return false;
    }
    if (!originalVoucherCode) {
      return false;
    }
    return currentSelectedCode !== originalVoucherCode;
  }, [currentSelectedCode, originalVoucherCode]);

  const isVoucherChangedOnSent = qrCodeChanged;

  const currentSenderName = useMemo(() => {
    if (!isCurrentDispatched) return "";
    const keys = activeIndex !== -1 && matchingPermits[activeIndex]
      ? getRecordKeys(matchingPermits[activeIndex], data.vrm, data.name, data.validFrom || data.todayDate)
      : getRecordKeys(null, data.vrm, data.name, data.validFrom || data.todayDate);
    for (const k of keys) {
      if (dispatchBy[k]) return dispatchBy[k];
    }
    return "";
  }, [isCurrentDispatched, data, activeIndex, matchingPermits, dispatchBy]);

  const matchingStats = useMemo(() => {
    let sent = 0;
    const total = matchingPermits.length;

    matchingPermits.forEach(p => {
      if (isRecordDispatched(p)) {
        sent++;
      }
    });
    const pending = Math.max(0, total - sent);
    return { sent, pending, total };
  }, [matchingPermits, isRecordDispatched]);

  const allPendingRecords = useMemo(() => {
    const records = (database && database.length > 0) ? database : matchingPermits;
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    return records.filter(p => {
      const recProcessingDate = p.todayDate || (p as any).createdAt || (p as any).created_at || data.todayDate || "";
      const recValidFrom = p.dateRequired || p.validFrom || "";
      const recCancelled = (p as any).isCancelled === true || isDateRequiredOutsideValidWindow(recValidFrom, recProcessingDate);

      return !recCancelled && !isRecordDispatched(p);
    });
  }, [database, matchingPermits, isRecordDispatched, data.todayDate]);

  const dbStats = useMemo(() => {
    const records = (database && database.length > 0) ? database : matchingPermits;
    let sent = 0;
    let cancelled = 0;
    const total = records.length;
    if (total === 0) return { sent: 0, pending: 0, expired: 0, cancelled: 0, processed: 0, total: 0, progressPct: 0, pendingPct: 0 };

    records.forEach(p => {
      const recProcessingDate = p.todayDate || (p as any).createdAt || (p as any).created_at || data.todayDate || "";
      const recValidFrom = p.dateRequired || p.validFrom || "";
      const recCancelled = (p as any).isCancelled === true || isDateRequiredOutsideValidWindow(recValidFrom, recProcessingDate);

      if (recCancelled) {
        cancelled++;
      } else if (isRecordDispatched(p)) {
        sent++;
      }
    });

    const processed = sent + cancelled;
    const pending = Math.max(0, total - processed);

    let progressPct = 0;
    if (total > 0) {
      if (pending === 0 || processed >= total) {
        progressPct = 100;
      } else {
        progressPct = Math.min(100, Math.round((processed / total) * 100));
      }
    }
    const pendingPct = total > 0 ? Math.max(0, 100 - progressPct) : 0;

    return { sent, pending, expired: 0, cancelled, processed, total, progressPct, pendingPct };
  }, [database, matchingPermits, isRecordDispatched, data.todayDate]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [emailTemplate, setEmailTemplate] = useState<"new" | "replacement">("new");

  // Track voucher code changes to automatically switch to Replacement template
  const prevRecordIdentityRef = useRef<string>("");
  const prevVoucherCodeRef = useRef<string | undefined>(data.voucherCodesText);
  
  useEffect(() => {
    const currentIdentity = `${data.vrm || ""}_${data.name || ""}_${data.validFrom || ""}_${(data as any).id || (data as any).formId || ""}`;
    const isNewRecordLoaded = prevRecordIdentityRef.current !== currentIdentity;
    
    if (isNewRecordLoaded) {
      prevRecordIdentityRef.current = currentIdentity;
      prevVoucherCodeRef.current = data.voucherCodesText;
      
      const isPending = !isCurrentDispatched || (data as any).status === "Pending" || !(data as any).isDispatched;
      if (isPending) {
        setEmailTemplate("new");
        if (data.isResend || data.emailType === "RESEND_CONCESSION" || data.emailTemplate === "replacement") {
          onChange?.({
            isResend: false,
            emailType: "SEND_CONCESSION",
            emailTemplate: "new"
          });
        }
      } else {
        if (data.emailTemplate) {
          setEmailTemplate(data.emailTemplate);
        } else if (data.emailType === "RESEND_CONCESSION" || data.isResend) {
          setEmailTemplate("replacement");
        } else {
          setEmailTemplate("replacement");
        }
      }
      return;
    }

    // Explicit email template/type update from form or parent
    if (data.emailTemplate === "replacement" || data.emailType === "RESEND_CONCESSION" || data.isResend) {
      setEmailTemplate("replacement");
    } else if (data.emailTemplate === "new" || data.emailType === "SEND_CONCESSION") {
      setEmailTemplate("new");
    }

    // If an operator actively selects a new voucher code from "Active Date Codes"
    // or updates the voucher code, switch to the replacement template. This only
    // counts as an edit when the PREVIOUS value was already a real, assigned
    // code - a record's first-ever auto-assignment (blank/undefined -> a code)
    // is not an operator edit and must not flip a first-time send into the
    // replacement flow.
    const prevWasRealCode = Boolean(
      prevVoucherCodeRef.current &&
      prevVoucherCodeRef.current !== "-" &&
      prevVoucherCodeRef.current !== "CANCELLED" &&
      prevVoucherCodeRef.current !== "Cancelled"
    );
    if (
      prevWasRealCode &&
      prevVoucherCodeRef.current !== data.voucherCodesText &&
      data.voucherCodesText &&
      data.voucherCodesText !== "-" &&
      data.voucherCodesText !== "CANCELLED" &&
      data.voucherCodesText !== "Cancelled"
    ) {
      setEmailTemplate("replacement");
    }
    prevVoucherCodeRef.current = data.voucherCodesText;
  }, [data.voucherCodesText, data.vrm, data.name, data.validFrom, (data as any).id, (data as any).formId, isCurrentDispatched, data.emailTemplate, data.emailType, data.isResend, (data as any).status, (data as any).isDispatched]);

  const isCancelled = useMemo(() => {
    // Ignore an imported "CANCELLED" value here too - recompute dynamically from
    // the record's actual required date rather than trusting a possibly-stale marker.
    if ((data as any).isCancelled === true) return true;
    const processingDateStr = data.todayDate || "";
    const validFromStr = data.validFrom || (data as any).dateRequired || "";
    if (isDateRequiredOutsideValidWindow(validFromStr, processingDateStr)) return true;
    if (checkIsBlockedDuplicate(data as any, database || [], data.todayDate)) return true;
    return false;
  }, [data.todayDate, data.validFrom, (data as any).dateRequired, data, database]);

  // isDateRequiredOutsideValidWindow covers both "too far in the future" and
  // "too far in the past" in one boolean - this distinguishes which, purely
  // for choosing an accurate caption below (does not affect isCancelled itself).
  const isCancelledInFuture = useMemo(() => {
    if (!isCancelled) return false;
    const validFromStr = data.validFrom || (data as any).dateRequired || "";
    const validFromISO = parseDateToISO(validFromStr);
    const refDateISO = parseDateToISO(data.todayDate) || getTodayISO();
    if (!validFromISO) return true;
    return validFromISO > refDateISO;
  }, [isCancelled, data.validFrom, (data as any).dateRequired, data.todayDate]);

  const daysActive = useMemo(() => {
    const validFromISO = parseDateToISO(data.validFrom || (data as any).dateRequired || "");
    const refDateISO = parseDateToISO(data.todayDate) || getTodayISO();
    if (!validFromISO) return 0;
    const diff = Math.round((new Date(refDateISO).getTime() - new Date(validFromISO).getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  }, [data.validFrom, (data as any).dateRequired, data.todayDate]);

  const cancellationDetails = useMemo(() => {
    let reason: 'future' | 'expired' | 'duplicate' = 'future';
    let currentExpiryDate = "";
    let earliestRenewalDate = "";

    const isDuplicate = checkIsBlockedDuplicate(data as any, database || [], data.todayDate);

    if (isDuplicate) {
      reason = 'duplicate';
      const cleanVrm = (data.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const refDateISO = parseDateToISO(data.todayDate) || getTodayISO();
      
      // Find all earlier records for the same VRM that are valid (not date-invalid, not blocked duplicates themselves)
      const validEarlierRecords = (database || []).filter(r => {
        const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (rVrm !== cleanVrm) return false;
        if (!isRecordStrictlyEarlier(r, data as any, database || [])) return false;
        const earlierDate = r.dateRequired || r.validFrom || "";
        if (isDateRequiredOutsideValidWindow(earlierDate, refDateISO) || (r as any).isCancelled === true) return false;
        if (checkIsBlockedDuplicate(r, database || [], refDateISO)) return false;
        return true;
      });

      // Sort deterministically: latest submission time / form ID among valid earlier records
      validEarlierRecords.sort((a, b) => {
        const timeA = extractRecordSubmissionTimeMs(a);
        const timeB = extractRecordSubmissionTimeMs(b);
        if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeB - timeA;
        const idA = extractRecordNumericFormId(a);
        const idB = extractRecordNumericFormId(b);
        if (idA > 0 && idB > 0 && idA !== idB) return idB - idA;
        return 0;
      });

      const activeEarlier = validEarlierRecords[0];
      if (activeEarlier) {
        const startIso = parseDateToISO(activeEarlier.dateRequired || activeEarlier.validFrom || activeEarlier.startTime || activeEarlier.createdAt || "");
        const expiryIso = (activeEarlier as any).validTo ? parseDateToISO((activeEarlier as any).validTo) : (startIso ? addDays(startIso, 6) : null);
        if (expiryIso) {
          currentExpiryDate = formatDate(expiryIso);
          const renewalIso = addDays(expiryIso, 1);
          if (renewalIso) {
            earliestRenewalDate = formatDate(renewalIso);
          }
        }
      }
    } else if (isCancelled && !isCancelledInFuture) {
      reason = 'expired';
    } else {
      reason = 'future';
    }

    return { reason, currentExpiryDate, earliestRenewalDate };
  }, [isCancelled, isCancelledInFuture, data, database]);

  const getCancellationEmailContentCallback = useCallback(() => {
    return getCancellationEmailContent({
      vrm: data.vrm,
      driverName: data.name,
      validFrom: data.validFrom,
      todayDate: data.todayDate,
      dateRequired: (data as any).dateRequired,
      reason: cancellationDetails.reason,
      currentExpiryDate: cancellationDetails.currentExpiryDate,
      earliestRenewalDate: cancellationDetails.earliestRenewalDate,
      activePermitExpiry: cancellationDetails.currentExpiryDate,
      reapplyDate: cancellationDetails.earliestRenewalDate,
    });
  }, [data.name, data.vrm, data.validFrom, data.todayDate, (data as any).dateRequired, cancellationDetails]);

  const isReplacement = useMemo(() => {
    // 0. Explicit resend / replacement markers on form data
    if (data.emailType === "RESEND_CONCESSION" || data.isResend || data.emailTemplate === "replacement") return true;
    // 1. If the template was explicitly set/selected to replacement
    if (emailTemplate === "replacement") return true;
    // 2. If voucher code has been updated or changed on an existing/dispatched record
    if (isCurrentDispatched && isVoucherChangedOnSent) return true;
    // 3. If any voucher code modification happened on an existing dispatched entry
    if (isCurrentDispatched && currentSelectedCode && currentSelectedCode !== "-" && currentSelectedCode !== "CANCELLED") {
      const dispatchedCode = (lastDispatchedCodeMap[recordKeyStr] ?? "").trim().toUpperCase();
      if (dispatchedCode && currentSelectedCode !== dispatchedCode) {
        return true;
      }
    }
    // 4. If a PREVIOUSLY DISPATCHED record had an assigned code in the database
    // and the current code differs, that's a genuine replacement. Gated by
    // isCurrentDispatched like checks #2/#3 above - without that gate, this
    // would also fire on a never-sent record purely because the database's
    // independently-computed auto-assigned code and this card's own
    // auto-assigned code picked different (but equally unsent) codes from the
    // same pool, which is not a replacement.
    const matchedRec = activeIndex !== -1 ? matchingPermits[activeIndex] : (database?.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))));
    const initialDbCode = (matchedRec?.voucherCode || (matchedRec as any)?.prePaidCode || (matchedRec as any)?.voucherCodesText || "").trim().toUpperCase();
    if (isCurrentDispatched && initialDbCode && initialDbCode !== "-" && initialDbCode !== "CANCELLED" && currentSelectedCode && currentSelectedCode !== initialDbCode) {
      return true;
    }
    return false;
  }, [data.emailType, data.isResend, data.emailTemplate, emailTemplate, isCurrentDispatched, isVoucherChangedOnSent, currentSelectedCode, lastDispatchedCodeMap, recordKeyStr, activeIndex, matchingPermits, database, (data as any).formId]);

  const getEmailContent = useCallback((template: "new" | "replacement") => {
    const hasUpdatedVoucherCode = isCurrentDispatched && isVoucherChangedOnSent;
    const isResentMode = template === "replacement" || emailTemplate === "replacement" || data.emailType === "RESEND_CONCESSION" || data.isResend || data.emailTemplate === "replacement" || hasUpdatedVoucherCode || isReplacement;

    const params = {
      vrm: data.vrm,
      driverName: data.name,
      duration: "7 days",
      validFrom: data.validFrom,
      validTo: data.validTo,
      todayDate: data.todayDate,
      dateRequired: (data as any).dateRequired,
    };

    if (isResentMode) {
      return getReplacementEmailContent(params);
    } else {
      return getSendEmailContent(params);
    }
  }, [data.name, data.vrm, data.validFrom, data.validTo, data.todayDate, (data as any).dateRequired, data.emailType, data.isResend, data.emailTemplate, isCurrentDispatched, isVoucherChangedOnSent, emailTemplate, isReplacement]);
  
  const showToast = (message: string) => {
    setToastMessage(message);
  };

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleResendConcessionEmail = async () => {
    const silentBlocked = await isVrmSilentBlocked(data.vrm || "");
    if (silentBlocked) {
      setQrUrl("");
      setQrUrlSmall("");
      showToast("Unable to generate a QR code for this vehicle — please contact the parking admin team.");
      return;
    }

    if (!qrUrl) {
      showToast("⚠️ Cannot resend email: No QR code is available for this permit. Please assign a valid voucher code.");
      return;
    }

    const params = {
      vrm: data.vrm,
      driverName: data.name,
      duration: "7 days",
      validFrom: data.validFrom,
      validTo: data.validTo,
      todayDate: data.todayDate,
      dateRequired: (data as any).dateRequired,
    };
    const content = getReplacementEmailContent(params);
    const subject = content.subject;
    const mailBody = content.plainText;
    const htmlText = content.htmlText;

    (window as any).__styledEmailBody = htmlText;

    const currentTargetRecord = (activeIndex !== -1 && matchingPermits[activeIndex])
      ? matchingPermits[activeIndex]
      : (database ? database.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))) : undefined) || {
          id: (data as any).id,
          formId: (data as any).formId,
          vrm: data.vrm,
          driverName: data.name,
          dateRequired: data.validFrom || data.todayDate,
          email: data.email,
          ward: data.ward
        } as any;

    let dispatchResult;
    try {
      dispatchResult = await markAsDispatched?.(data.vrm, data.email, currentTargetRecord);
    } catch (err) {
      console.error("Dispatch mutation error:", err);
      showToast("❌ Dispatch failed: Error updating status.");
      return;
    }

    if (dispatchResult === false) {
      console.warn("Dispatch mutation failed or was rolled back due to database write error.");
      showToast("❌ Database write error: Failed to update status.");
      return false;
    }

    setShowOutlookGuide(true);

    if (currentSelectedCode && currentSelectedCode !== "-" && currentSelectedCode !== "CANCELLED") {
      setLastDispatchedCodeMap(prev => ({ ...prev, [recordKeyStr]: currentSelectedCode }));
    }

    const formattedMailBody = mailBody.replace(/\r?\n/g, "\r\n");
    let url = "";
    if (outlookClientType === "web") {
      url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(recipientEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMailBody)}`;
    } else if (outlookClientType === "live") {
      url = `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(recipientEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMailBody)}`;
    } else {
      url = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMailBody)}`;
    }

    // Generate QR code data URL on demand if not cancelled
    let activeQrDataUrl = qrUrlSmall || qrUrl;
    if (!isCancelled) {
      const payload = data.qrOverride.trim() || activeVoucherCode || currentSelectedCode || "";
      if (payload && payload !== "-" && payload !== "CANCELLED") {
        try {
          activeQrDataUrl = await QRCode.toDataURL(payload, {
            width: 400,
            margin: 1,
            errorCorrectionLevel: "H",
            color: { dark: "#111111", light: "#FFFFFF" }
          });
          setQrUrl(activeQrDataUrl);
          setQrUrlSmall(activeQrDataUrl);
        } catch (err) {
          console.error("QR Code Generation Error in Resend:", err);
        }
      }
    }

    // Copy the QR code image directly to clipboard
    if (!isCancelled && activeQrDataUrl) {
      try {
        window.focus();
        const blob = dataURLtoBlob(activeQrDataUrl);
        if (navigator.clipboard && typeof navigator.clipboard.write === 'function') {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          setCopyStatus("success");
          setTimeout(() => setCopyStatus("idle"), 2000);
        }
      } catch (err) {
        console.warn("Clipboard copy QR code error:", err);
      }
    }

    // Automatically open Outlook / email composer
    try {
      if (url.startsWith("mailto:")) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.warn("Could not auto-open Outlook link:", err);
    }

    showToast(`📋 QR Code copied! Outlook opened — paste (Ctrl+V) into the email body.`);

    let nextUnsentRecord: CsvPermitRecord | null = null;
    if (matchingPermits.length > 0 && activeIndex !== -1) {
      for (let i = activeIndex + 1; i < matchingPermits.length; i++) {
        if (!isRecordDispatched(matchingPermits[i])) {
          nextUnsentRecord = matchingPermits[i];
          break;
        }
      }
      if (!nextUnsentRecord) {
        for (let i = 0; i < activeIndex; i++) {
          if (!isRecordDispatched(matchingPermits[i])) {
            nextUnsentRecord = matchingPermits[i];
            break;
          }
        }
      }
    }
    if (nextUnsentRecord) {
      onSelectRecord?.(nextUnsentRecord);
    }
    return true;
  };

  const handleSendClick = async () => {
    if (!isCancelled && qrCodeChanged) {
      const res = await handleResendConcessionEmail();
      if (res === false) {
        showToast("❌ Failed to send. Please try again.");
      }
      return;
    }

    const silentBlocked = await isVrmSilentBlocked(data.vrm || "");
    if (silentBlocked) {
      setQrUrl("");
      setQrUrlSmall("");
      showToast("Unable to generate a QR code for this vehicle — please contact the parking admin team.");
      return;
    }
    
    if (!isCancelled && !qrUrl) {
      showToast(`⚠️ Cannot send email: No QR code is available for this permit. Please assign a valid voucher code.`);
      return;
    }
    
    const result = await handleSendWithOutlook();
    if (result !== false) {
      if (currentSelectedCode && currentSelectedCode !== "-" && currentSelectedCode !== "CANCELLED") {
        setLastDispatchedCodeMap(prev => ({ ...prev, [recordKeyStr]: currentSelectedCode }));
      }
      showToast(
        isCancelled
          ? `📧 Sent cancellation notice to ${data.name || "Driver"}.`
          : qrCodeChanged
            ? `📧 Resent replacement permit to ${data.name || "Driver"}.`
            : `📧 Sent permit to ${data.name || "Driver"}.`
      );
    } else {
      showToast("❌ Failed to send. Please try again.");
    }
  };

  const handleUnsendClick = () => {
    if (!isCurrentDispatched) {
      showToast(`ℹ️ ${data.name || "Driver"} is already set to SEND.`);
      return;
    }
    setShowUnsendConfirm(true);
  };

  const handleConfirmUnsend = async () => {
    setShowUnsendConfirm(false);
    const matchedRecord = (activeIndex !== -1 && matchingPermits[activeIndex])
      ? matchingPermits[activeIndex]
      : (database ? database.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))) : undefined) || {
          id: (data as any).id,
          formId: (data as any).formId,
          vrm: data.vrm,
          driverName: data.name,
          dateRequired: data.validFrom || data.todayDate,
          email: data.email,
          ward: data.ward
        } as any;
    const res = await unmarkAsDispatched?.(data.vrm, data.email, matchedRecord);
    if (res !== false) {
      setLastDispatchedCodeMap(prev => {
        const next = { ...prev };
        delete next[recordKeyStr];
        return next;
      });
      showToast(`✅ ${data.name || "Driver"} marked as SEND. Send button now available.`);
    }
  };

  const handleCancelUnsend = () => {
    setShowUnsendConfirm(false);
  };

  const [showOutlookSettings, setShowOutlookSettings] = useState<boolean>(false);

  const [recipientEmail, setRecipientEmail] = useState<string>(() => {
    return safeLocalStorage.getItem("outlook_permit_last_recipient") || "";
  });
  const [outlookClientType, setOutlookClientType] = useState<"app" | "web" | "live">(() => {
    return (safeLocalStorage.getItem("outlook_permit_client_type") as any) || "app";
  });
  const [showOutlookGuide, setShowOutlookGuide] = useState<boolean>(false);
  const [copyTarget, setCopyTarget] = useState<"card" | "qr">("qr");
  const [copySubjectSuccess, setCopySubjectSuccess] = useState<boolean>(false);
  const [copyBodySuccess, setCopyBodySuccess] = useState<boolean>(false);

  useEffect(() => {
    safeLocalStorage.setItem("outlook_permit_last_recipient", recipientEmail);
  }, [recipientEmail]);

  useEffect(() => {
    safeLocalStorage.setItem("outlook_permit_client_type", outlookClientType);
  }, [outlookClientType]);

  useEffect(() => {
    setRecipientEmail((data.email || "").toLowerCase());
  }, [data.email]);

  const [activeVoucherIndex, setActiveVoucherIndex] = useState<number>(0);

  const voucherCodes = useMemo(() => {
    if (!data.voucherCodesText) return [];
    return data.voucherCodesText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.length > 4 && /[A-Z0-9]{4,}/i.test(line));
  }, [data.voucherCodesText]);

  useEffect(() => {
    if (activeVoucherIndex >= voucherCodes.length) {
      setActiveVoucherIndex(0);
    }
  }, [voucherCodes.length, activeVoucherIndex]);

  const activeVoucherCode = useMemo(() => {
    if (isCancelled) return "";
    if (voucherCodes.length > 0) {
      const idx = Math.min(activeVoucherIndex, voucherCodes.length - 1);
      const code = voucherCodes[idx];
      if (code && code !== "-" && code.toUpperCase() !== "CANCELLED") {
        return code;
      }
    }
    const raw = (data as any).voucherCode || (data as any).prePaidCode || (data as any).qrCode || (data as any).serialNumber;
    if (raw && raw !== "-" && raw.toUpperCase() !== "CANCELLED") {
      return raw;
    }
    if ((data as any).formId) {
      const matched = database?.find(r => (r.formId === (data as any).formId || r.id === (data as any).formId));
      if (matched && matched.voucherCode && matched.voucherCode !== "CANCELLED" && matched.voucherCode !== "-") {
        return matched.voucherCode;
      }
    }

    // Auto-Assign QR Voucher Code from date-filtered vouchers only
    if (availableVouchersForDate.length > 0) {
      // Collect codes already used by other records in the database for this date
      const usedCodesByOthers = new Set<string>();
      const currentFormId = String((data as any).formId ?? data.id ?? "");
      const targetDate = data.validFrom || (data as any).dateRequired || getTodayISO();
      const targetISO = parseDateToISO(targetDate);
      
      (database || []).forEach(r => {
        const rId = String(r.formId ?? r.id ?? "");
        if (currentFormId && rId && rId === currentFormId) return;
        
        // Only check records with the same date
        const rDate = parseDateToISO(r.dateRequired || r.validFrom || "");
        if (rDate !== targetISO) return;
        
        const rawCode = r.voucherCode || (r as any).prePaidCode || (r as any).qrCode || (r as any).serialNumber;
        if (rawCode && rawCode !== "-" && rawCode.toUpperCase() !== "CANCELLED") {
          const lines = String(rawCode).split(/[\n,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
          lines.forEach(c => usedCodesByOthers.add(c));
        }
      });

      // Try matching VRM if restricted
      const currentVrm = (data.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (currentVrm) {
        const vrmMatch = availableVouchersForDate.find(v => {
          const vVrm = (v.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
          return vVrm && vVrm === currentVrm && !usedCodesByOthers.has(v.code);
        });
        if (vrmMatch && vrmMatch.code) return vrmMatch.code.trim().toUpperCase();
      }

      // Next available from active date pool
      const availableCode = availableVouchersForDate.find(v => !usedCodesByOthers.has(v.code));
      if (availableCode && availableCode.code) {
        return availableCode.code.trim().toUpperCase();
      }
    }

    return "";
  }, [isCancelled, voucherCodes, activeVoucherIndex, (data as any).voucherCode, (data as any).prePaidCode, (data as any).qrCode, (data as any).serialNumber, (data as any).formId, (data as any).dateRequired, (data as any).startTime, data.validFrom, data.todayDate, data.vrm, data.id, database, availableVouchersForDate]);

  const qrPayload = useMemo(() => {
    if (data.qrOverride.trim()) {
      return data.qrOverride.trim();
    }
    if (activeVoucherCode && activeVoucherCode !== "-") {
      return activeVoucherCode;
    }
    return "";
  }, [data.qrOverride, activeVoucherCode]);

  useEffect(() => {
    if (!qrPayload) {
      setQrUrl("");
      setQrUrlSmall("");
      return;
    }

    QRCode.toDataURL(qrPayload, {
      width: 600,
      margin: 1,
      errorCorrectionLevel: "H",
      color: {
        dark: "#111111",
        light: "#FFFFFF"
      }
    })
      .then((url) => {
        setQrUrl(url);
      })
      .catch((err) => {
        console.error("QR Code Generation Error (High-Res):", err);
      });

    QRCode.toDataURL(qrPayload, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#111111",
        light: "#FFFFFF"
      }
    })
      .then((url) => {
        setQrUrlSmall(url);
      })
      .catch((err) => {
        console.error("QR Code Generation Error (Compact):", err);
      });
  }, [qrPayload]);

  const generateHighResCanvas = (customData?: PermitData, customQrUrl?: string): Promise<HTMLCanvasElement> => {
    const activeData = customData || data;
    const activeQrUrl = customQrUrl || qrUrl;

    // Extract correct voucher code
    let activeVoucher = activeVoucherCode;
    if (customData) {
      const parsed = activeData.voucherCodesText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line.length > 4 && /[A-Z0-9]{4,}/i.test(line));
      activeVoucher = parsed[0] || activeData.voucherCodesText || "";
    }

    return new Promise((resolve) => {
      const scale = 3;
      const width = 350 * scale;

      // Define logical layout measurements (all multiplied by scale at draw time)
      const topHeight = 48 * scale;
      const padding = 16 * scale;
      const spacing = 12 * scale;

      // Heights of components
      const plateHeight = 36 * scale;
      const qrBoxHeight = 186 * scale;
      const dateCardHeight = 42 * scale;
      const detailsBoxHeight = 92 * scale;
      const footerHeight = 32 * scale;

      // Compute total height
      const totalHeight = topHeight + padding + plateHeight + spacing + qrBoxHeight + spacing + dateCardHeight + (10 * scale) + detailsBoxHeight + (16 * scale) + footerHeight;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = totalHeight;
      const ctx = canvas.getContext("2d")!;

      // Enable font anti-aliasing & nice scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // 1. Draw pure white background card with rounded corners
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(0, 0, width, totalHeight, 20 * scale);
      } else {
        ctx.rect(0, 0, width, totalHeight);
      }
      ctx.fill();

      // Clip subsequent drawings within the outer rounded rect
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(0, 0, width, totalHeight, 20 * scale);
      } else {
        ctx.rect(0, 0, width, totalHeight);
      }
      ctx.clip();

      // 2. Draw top header background (NHS Blue)
      ctx.fillStyle = "#005EB8";
      ctx.fillRect(0, 0, width, topHeight);

      // Draw title in header
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${9.5 * scale}px "Inter", Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText((activeData.title || "Patient & Visitor Concessions").toUpperCase(), 16 * scale, topHeight / 2 - 5 * scale);

      // Draw Map Pin icon & Site subtitle
      const pinX = 16 * scale;
      const pinY = topHeight / 2 + 9 * scale;
      
      // Draw a small custom Map Pin icon
      ctx.fillStyle = "#EBF8FF";
      ctx.beginPath();
      ctx.arc(pinX + 3.5 * scale, pinY - 1.5 * scale, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(pinX + 1.7 * scale, pinY - 1.5 * scale);
      ctx.lineTo(pinX + 3.5 * scale, pinY + 2.5 * scale);
      ctx.lineTo(pinX + 5.3 * scale, pinY - 1.5 * scale);
      ctx.fill();
      
      // Draw site name text next to map pin
      ctx.font = `bold ${7.5 * scale}px "Inter", Arial, sans-serif`;
      ctx.fillText(activeData.site || "NHS Whipps Cross Hospital", pinX + 8.5 * scale, pinY);

      // Draw authentic NHS logo badge on top right
      const nhsBadgeWidth = 26 * scale;
      const nhsBadgeHeight = 16 * scale;
      const nhsBadgeX = width - (16 * scale) - nhsBadgeWidth;
      const nhsBadgeY = (topHeight - nhsBadgeHeight) / 2;
      ctx.fillStyle = "#FFFFFF";
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(nhsBadgeX, nhsBadgeY, nhsBadgeWidth, nhsBadgeHeight, 3 * scale);
        ctx.fill();
      } else {
        ctx.fillRect(nhsBadgeX, nhsBadgeY, nhsBadgeWidth, nhsBadgeHeight);
      }
      ctx.fillStyle = "#005EB8";
      ctx.font = `black italic ${9 * scale}px "Inter", Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("NHS", nhsBadgeX + nhsBadgeWidth / 2, nhsBadgeY + nhsBadgeHeight / 2);

      ctx.restore(); // Remove header clipping

      // Define body/footer rendering function to defer until QR image is loaded (if present)
      const drawBodyAndFooter = () => {
        // 3. Draw Slate License Plate style display
        const plateY = topHeight + padding;
        const plateWidth = 200 * scale;
        const plateX = (width - plateWidth) / 2;

        ctx.fillStyle = "#0F172A"; // Slate-900
        ctx.strokeStyle = "#475569"; // Slate-600
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(plateX, plateY, plateWidth, plateHeight, 5 * scale);
        } else {
          ctx.rect(plateX, plateY, plateWidth, plateHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Blue UK strip on the left
        const stripWidth = 14 * scale;
        ctx.fillStyle = "#005EB8";
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(plateX, plateY, stripWidth, plateHeight, [5 * scale, 0, 0, 5 * scale]);
        } else {
          ctx.rect(plateX, plateY, stripWidth, plateHeight);
        }
        ctx.fill();

        // White "GB" text inside blue strip
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold ${5.5 * scale}px "Inter", Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("GB", plateX + stripWidth / 2, plateY + plateHeight / 2);

        // License Plate Text (Standard UK plate text is black on yellow on back, but here in app it is premium white on dark)
        const vrmDisplay = activeData.vrm ? formatUKPlate(activeData.vrm).toUpperCase() : "-";
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `900 ${15 * scale}px "JetBrains Mono", "Fira Code", Courier, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(vrmDisplay, plateX + stripWidth + (plateWidth - stripWidth) / 2, plateY + plateHeight / 2);

        // 4. Draw QR Code Section Container (Centered rounded card box)
        const qrBoxY = plateY + plateHeight + 12 * scale;
        const qrBoxWidth = 210 * scale;
        const qrBoxX = (width - qrBoxWidth) / 2;

        ctx.fillStyle = "#F8FAFC"; // light slate grey bg-slate-50
        ctx.strokeStyle = "#F1F5F9"; // border-slate-100
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(qrBoxX, qrBoxY, qrBoxWidth, qrBoxHeight, 12 * scale);
        } else {
          ctx.rect(qrBoxX, qrBoxY, qrBoxWidth, qrBoxHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Draw QR Code Image inside the QR box
        const qrSize = 136 * scale;
        const qrX = qrBoxX + (qrBoxWidth - qrSize) / 2;
        const qrY = qrBoxY + 10 * scale;

        if (activeQrUrl && qrImageLoaded) {
          // Draw actual QR code with rounded/clean container
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(qrX, qrY, qrSize, qrSize, 6 * scale);
          } else {
            ctx.rect(qrX, qrY, qrSize, qrSize);
          }
          ctx.fill();
          
          ctx.drawImage(qrImage, qrX + 3 * scale, qrY + 3 * scale, qrSize - 6 * scale, qrSize - 6 * scale);
        } else {
          // Mock QR or empty state
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(qrX, qrY, qrSize, qrSize);
          ctx.strokeStyle = "#E2E8F0";
          ctx.lineWidth = 1 * scale;
          ctx.strokeRect(qrX, qrY, qrSize, qrSize);
          
          if (activeData.voucherCodesText === "-") {
            ctx.fillStyle = "#EF4444"; // red-500
            ctx.font = `bold ${8 * scale}px "Inter", Arial, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("NO VOUCHER", qrX + qrSize / 2, qrY + qrSize / 2 - 6 * scale);
            ctx.font = `bold ${6 * scale}px "Inter", Arial, sans-serif`;
            ctx.fillStyle = "#94A3B8";
            ctx.fillText("Date Missing Code", qrX + qrSize / 2, qrY + qrSize / 2 + 6 * scale);
          } else {
            ctx.fillStyle = "#94A3B8";
            ctx.font = `bold ${8 * scale}px "Inter", Arial, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("NO UNIQUE QR", qrX + qrSize / 2, qrY + qrSize / 2);
          }
        }

        // Voucher Code badge inside QR Code box
        const labelY = qrY + qrSize + 14 * scale;
        ctx.fillStyle = "#94A3B8"; // text-slate-400
        ctx.font = `bold ${7 * scale}px "Inter", Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PRE-PAID PARKING CODE", qrBoxX + qrBoxWidth / 2, labelY);

        const codeY = qrY + qrSize + 26 * scale;
        ctx.fillStyle = "#10B981"; // emerald-500
        ctx.font = `bold ${10.5 * scale}px "JetBrains Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(activeVoucher || "-", qrBoxX + qrBoxWidth / 2, codeY);

        // 5. Draw Valid From & Expires side-by-side Cards
        const dateBoxY = qrBoxY + qrBoxHeight + 12 * scale;
        const dateCardWidth = (width - 32 * scale - 8 * scale) / 2;
        const leftCardX = 16 * scale;
        const rightCardX = 16 * scale + dateCardWidth + 8 * scale;

        const drawDateCard = (x: number, label: string, value: string) => {
          ctx.fillStyle = "#F8FAFC"; // bg-slate-50
          ctx.strokeStyle = "#E2E8F0"; // border-slate-200/60
          ctx.lineWidth = 0.75 * scale;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, dateBoxY, dateCardWidth, dateCardHeight, 6 * scale);
          } else {
            ctx.rect(x, dateBoxY, dateCardWidth, dateCardHeight);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#94A3B8"; // text-slate-400
          ctx.font = `bold ${7 * scale}px "Inter", Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, x + dateCardWidth / 2, dateBoxY + 12 * scale);

          ctx.fillStyle = "#1E293B"; // slate-800
          ctx.font = `bold ${9 * scale}px "JetBrains Mono", monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(value, x + dateCardWidth / 2, dateBoxY + 28 * scale);
        };

        const fromVal = activeData.validFrom ? formatDate(activeData.validFrom) : "-";
        const toVal = activeData.validTo ? formatDate(activeData.validTo) : "-";
        drawDateCard(leftCardX, "VALID FROM", fromVal);
        drawDateCard(rightCardX, "EXPIRES", toVal);

        // 6. Draw Details Inset Box (Driver Details Container)
        const detailsBoxY = dateBoxY + dateCardHeight + 10 * scale;
        const detailsBoxWidth = width - 32 * scale;
        const detailsBoxX = 16 * scale;

        ctx.fillStyle = "rgba(248, 250, 252, 0.5)"; // bg-slate-50/50
        ctx.strokeStyle = "#E2E8F0"; // border-slate-200/80
        ctx.lineWidth = 0.75 * scale;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(detailsBoxX, detailsBoxY, detailsBoxWidth, detailsBoxHeight, 8 * scale);
        } else {
          ctx.rect(detailsBoxX, detailsBoxY, detailsBoxWidth, detailsBoxHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Driver details rows inside
        const detailsRows = [
          { label: "DRIVER NAME", value: activeData.name && activeData.name !== "-" ? toTitleCase(activeData.name) : "-", icon: "driver" },
          { label: "DEPARTMENT", value: activeData.ward && activeData.ward !== "-" ? toTitleCase(activeData.ward) : "-", icon: "ward" },
          { label: "PHONE", value: activeData.phone || "-", icon: "phone" },
          { label: "EMAIL", value: activeData.email && activeData.email !== "-" ? activeData.email.toLowerCase() : "-", icon: "email" }
        ];

        const innerRowHeight = 20 * scale;
        const startY = detailsBoxY + 6 * scale;

        detailsRows.forEach((row, index) => {
          const rowCenterY = startY + (index * innerRowHeight) + (innerRowHeight / 2);
          const rowIconX = detailsBoxX + 12 * scale;
          const labelX = rowIconX + 14 * scale;

          // Draw Divider line between rows
          if (index > 0) {
            ctx.strokeStyle = "rgba(226, 232, 240, 0.5)";
            ctx.lineWidth = 0.5 * scale;
            ctx.beginPath();
            ctx.moveTo(detailsBoxX + 10 * scale, startY + index * innerRowHeight);
            ctx.lineTo(detailsBoxX + detailsBoxWidth - 10 * scale, startY + index * innerRowHeight);
            ctx.stroke();
          }

          // Draw Icon
          ctx.fillStyle = "#005EB8"; // NHS Blue for icons
          ctx.strokeStyle = "#005EB8";
          ctx.lineWidth = 1 * scale;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          if (row.icon === "driver") {
            // User icon
            ctx.beginPath();
            ctx.arc(rowIconX, rowCenterY - 2 * scale, 2.2 * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(rowIconX, rowCenterY + 4 * scale, 4 * scale, Math.PI, Math.PI * 2);
            ctx.stroke();
          } else if (row.icon === "ward") {
            // Layers icon (overlapping diamonds)
            ctx.beginPath();
            ctx.moveTo(rowIconX, rowCenterY - 3 * scale);
            ctx.lineTo(rowIconX + 3.5 * scale, rowCenterY - 1 * scale);
            ctx.lineTo(rowIconX, rowCenterY + 1 * scale);
            ctx.lineTo(rowIconX - 3.5 * scale, rowCenterY - 1 * scale);
            ctx.closePath();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(rowIconX - 3.5 * scale, rowCenterY + 1.5 * scale);
            ctx.lineTo(rowIconX, rowCenterY + 3.5 * scale);
            ctx.lineTo(rowIconX + 3.5 * scale, rowCenterY + 1.5 * scale);
            ctx.stroke();
          } else if (row.icon === "phone") {
            // Phone icon
            ctx.fillStyle = "transparent";
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(rowIconX - 2.2 * scale, rowCenterY - 4.5 * scale, 4.4 * scale, 9 * scale, 1 * scale);
            } else {
              ctx.rect(rowIconX - 2.2 * scale, rowCenterY - 4.5 * scale, 4.4 * scale, 9 * scale);
            }
            ctx.stroke();
            // Screen line
            ctx.beginPath();
            ctx.moveTo(rowIconX - 2.2 * scale, rowCenterY + 2 * scale);
            ctx.lineTo(rowIconX + 2.2 * scale, rowCenterY + 2 * scale);
            ctx.stroke();
            // Home button
            ctx.fillStyle = "#005EB8";
            ctx.beginPath();
            ctx.arc(rowIconX, rowCenterY + 3.2 * scale, 0.4 * scale, 0, Math.PI * 2);
            ctx.fill();
          } else if (row.icon === "email") {
            // Envelope icon
            ctx.beginPath();
            ctx.rect(rowIconX - 4 * scale, rowCenterY - 2.8 * scale, 8 * scale, 5.6 * scale);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(rowIconX - 4 * scale, rowCenterY - 2.8 * scale);
            ctx.lineTo(rowIconX, rowCenterY + 0.2 * scale);
            ctx.lineTo(rowIconX + 4 * scale, rowCenterY - 2.8 * scale);
            ctx.stroke();
          }

          // Row Label
          ctx.fillStyle = "#94A3B8"; // text-slate-400
          ctx.font = `bold ${7 * scale}px "Inter", Arial, sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(row.label, labelX, rowCenterY);

          // Row Value
          ctx.fillStyle = "#1E293B"; // text-slate-800
          ctx.font = `bold ${8.5 * scale}px "Inter", Arial, sans-serif`;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          // If value is email, make sure it is truncated nicely if too long
          let valStr = row.value;
          if (row.icon === "email" && valStr.length > 28) {
            valStr = valStr.substring(0, 25) + "...";
          }
          ctx.fillText(valStr, detailsBoxX + detailsBoxWidth - 10 * scale, rowCenterY);
        });

        // 7. Draw Footer Background & Border
        ctx.fillStyle = "#F8FAFC"; // light slate grey bg-slate-50
        ctx.fillRect(0, totalHeight - footerHeight, width, footerHeight);

        ctx.strokeStyle = "#E2E8F0";
        ctx.lineWidth = 0.75 * scale;
        ctx.beginPath();
        ctx.moveTo(0, totalHeight - footerHeight);
        ctx.lineTo(width, totalHeight - footerHeight);
        ctx.stroke();

        // Footer clock icon + text
        const footerCenterY = totalHeight - (footerHeight / 2);
        const footerTextX = width / 2;

        // Draw small clock icon in footer
        const clockX = 16 * scale;
        ctx.strokeStyle = "#3B82F6"; // blue-500
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        ctx.arc(clockX, footerCenterY, 3.5 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(clockX, footerCenterY - 1.8 * scale);
        ctx.lineTo(clockX, footerCenterY);
        ctx.lineTo(clockX + 1.4 * scale, footerCenterY + 0.7 * scale);
        ctx.stroke();

        const selectedSiteClean = activeData.site ? activeData.site.replace(/^NHS\s+/i, "") : "-";
        ctx.fillStyle = "#94A3B8"; // text-slate-400
        ctx.font = `bold ${6.8 * scale}px "Inter", Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          `NHS ${selectedSiteClean.toUpperCase()} PARKING VALIDATION CARD`,
          footerTextX,
          footerCenterY
        );

        resolve(canvas);
      };

      // Handle QR Image loading
      let qrImageLoaded = false;
      const qrImage = new Image();

      if (activeQrUrl) {
        qrImage.onload = () => {
          qrImageLoaded = true;
          drawBodyAndFooter();
        };
        qrImage.onerror = () => {
          qrImageLoaded = false;
          drawBodyAndFooter();
        };
        qrImage.src = activeQrUrl;
      } else {
        drawBodyAndFooter();
      }
    });
  };

  const getDownloadFilename = (target: "qr" | "card", customData?: PermitData, customVoucher?: string) => {
    const activeData = customData || data;
    const activeVoucher = customVoucher || activeVoucherCode;
    const driverNameSlug = activeData.name 
      ? activeData.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") 
      : "";
    
    if (target === "qr") {
      return driverNameSlug ? `${driverNameSlug}-qr.png` : `parking-qr-${activeVoucher || "code"}.png`;
    }

    if (driverNameSlug) {
      const titleLower = (activeData.title || "").toLowerCase();
      const isConcession = titleLower.includes("concess") || titleLower.includes("voucher") || titleLower.includes("concession");
      const suffix = isConcession ? "concession" : "permit";
      return `${driverNameSlug}-${suffix}.png`;
    }
    
    return `${(activeData.title || "parking-permit").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.png`;
  };

  const handleDownload = async (target?: "qr" | "card") => {
    const finalTarget = target || copyTarget;
    try {
      setDownloadStatus("idle");
      let dataUrl = "";
      if (finalTarget === "qr") {
        dataUrl = qrUrlSmall;
      } else {
        const canvas = await generateHighResCanvas();
        dataUrl = canvas.toDataURL("image/png");
      }

      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = getDownloadFilename(finalTarget);
      link.click();
      
      setDownloadStatus("success");
      setTimeout(() => setDownloadStatus("idle"), 2000);
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  const handleCopy = async (target?: "qr" | "card") => {
    const finalTarget = target || copyTarget;
    try {
      setCopyStatus("idle");
      window.focus();
      
      if (finalTarget === "qr") {
        if (!qrUrlSmall) {
          setCopyStatus("error");
          return;
        }
        const blob = dataURLtoBlob(qrUrlSmall);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        setCopyStatus("success");
        setTimeout(() => setCopyStatus("idle"), 2000);
      } else {
        const canvas = await generateHighResCanvas();
        canvas.toBlob(async (blob) => {
          if (!blob) {
            setCopyStatus("error");
            return;
          }
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob })
            ]);
            setCopyStatus("success");
            setTimeout(() => setCopyStatus("idle"), 2000);
          } catch (e) {
            console.error("Clipboard copy error:", e);
            setCopyStatus("error");
            setTimeout(() => setCopyStatus("idle"), 3000);
          }
        }, "image/png");
      }
    } catch (e) {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 3000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Derive active record directly from currentCardIndex
  const currentRecord = useMemo(() => {
    if (activeIndex !== -1 && matchingPermits[activeIndex]) return matchingPermits[activeIndex];
    return null;
  }, [activeIndex, matchingPermits]);

  // Previous Match Button Handler with pure array index math
  const handlePrevMatch = () => {
    if (matchingPermits.length === 0) return;
    const prevIndex = (currentCardIndex - 1 + matchingPermits.length) % matchingPermits.length;
    setCurrentCardIndex(prevIndex);
    const prevRecord = matchingPermits[prevIndex];
    if (prevRecord) {
      // Navigate to previous record only
      onSelectRecord?.(prevRecord);
    }
  };

  // Next Match Button Handler with pure array index math
  const handleNextMatch = () => {
    if (matchingPermits.length === 0) return;
    const nextIndex = (currentCardIndex + 1) % matchingPermits.length;
    setCurrentCardIndex(nextIndex);
    const nextRecord = matchingPermits[nextIndex];
    if (nextRecord) {
      // Navigate to next record only
      onSelectRecord?.(nextRecord);
    }
  };

  const handleBatchDownloadQrs = async () => {
    if (matchingPermits.length === 0) return;
    setBatchDownloadProgress(0);
    setBatchDownloadType("qr");
    
    try {
      for (let i = 0; i < matchingPermits.length; i++) {
        const record = matchingPermits[i];
        const payload = record.voucherCode || "-";
        
        const dataUrl = await QRCode.toDataURL(payload, { 
          width: 500, 
          margin: 1,
          color: {
            dark: "#000000",
            light: "#FFFFFF"
          }
        });
        
        const link = document.createElement("a");
        link.href = dataUrl;
        const driverNameClean = (record.driverName || "Driver").toUpperCase().replace(/[^A-Z0-9]/g, "_");
        const vrmClean = (record.vrm || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]/g, "");
        link.download = `QR_${vrmClean}_${driverNameClean}.png`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setBatchDownloadProgress(Math.round(((i + 1) / matchingPermits.length) * 100));
        
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (err) {
      console.error("Batch download failed:", err);
    } finally {
      setTimeout(() => {
        setBatchDownloadProgress(null);
        setBatchDownloadType(null);
      }, 1500);
    }
  };

  const handleBatchDownloadCards = async () => {
    if (matchingPermits.length === 0) return;
    setBatchDownloadProgress(0);
    setBatchDownloadType("card");
    
    try {
      for (let i = 0; i < matchingPermits.length; i++) {
        const record = matchingPermits[i];
        const payload = record.voucherCode || "-";
        
        const qrDataUrl = await QRCode.toDataURL(payload, { 
          width: 600, 
          margin: 1,
          errorCorrectionLevel: "H",
          color: {
            dark: "#111111",
            light: "#FFFFFF"
          }
        });
        
        const permitData: PermitData = {
          title: record.permitType || data.title,
          site: record.site || data.site,
          name: record.driverName || "",
          phone: record.phone || "",
          vrm: record.vrm || "",
          validFrom: record.validFrom || "",
          validTo: record.validTo || "",
          ward: record.ward || "",
          email: record.email || "",
          voucherCodesText: payload,
          qrOverride: ""
        };

        const canvas = await generateHighResCanvas(permitData, qrDataUrl);
        const cardDataUrl = canvas.toDataURL("image/png");
        
        const link = document.createElement("a");
        link.href = cardDataUrl;
        link.download = getDownloadFilename("card", permitData, payload);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setBatchDownloadProgress(Math.round(((i + 1) / matchingPermits.length) * 100));
        
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (err) {
      console.error("Batch download cards failed:", err);
    } finally {
      setTimeout(() => {
        setBatchDownloadProgress(null);
        setBatchDownloadType(null);
      }, 1500);
    }
  };

  // ============================================
  // EMAIL TEMPLATE - Fixed
  // - No asterisks
  // - Yellow highlight only on dates
  // - Red text for non-refundable
  // - Blue clickable email link
  // ============================================
  const handleSendWithOutlook = async () => {
    const silentBlocked = await isVrmSilentBlocked(data.vrm || "");
    if (silentBlocked) {
      setQrUrl("");
      setQrUrlSmall("");
      showToast("Unable to generate a QR code for this vehicle — please contact the parking admin team.");
      return;
    }

    const labelVal = data.vrm ? data.vrm.toUpperCase() : "No VRM";
    let subject = "";
    let mailBody = "";
    let htmlText = "";

    if (isCancelled) {
      const cancelContent = getCancellationEmailContentCallback();
      subject = cancelContent.subject;
      mailBody = cancelContent.plainText;
      htmlText = cancelContent.htmlText;
    } else {
      const effectiveTemplate = isReplacement ? "replacement" : emailTemplate;
      const content = getEmailContent(effectiveTemplate);
      subject = content.subject;
      mailBody = content.plainText;
      htmlText = content.htmlText;
    }

    // Store HTML version for the styled body button
    (window as any).__styledEmailBody = htmlText;

    // 4. Update dispatched status in database and local UI state
    const currentTargetRecord = (activeIndex !== -1 && matchingPermits[activeIndex])
      ? matchingPermits[activeIndex]
      : (database ? database.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))) : undefined) || {
          id: (data as any).id,
          formId: (data as any).formId,
          vrm: data.vrm,
          driverName: data.name,
          dateRequired: data.validFrom || data.todayDate,
          email: data.email,
          ward: data.ward
        } as any;

    let dispatchResult;
    try {
      dispatchResult = await markAsDispatched?.(data.vrm, data.email, currentTargetRecord);
    } catch (err) {
      console.error("Dispatch mutation error:", err);
      showToast("❌ Dispatch failed: Error updating status.");
      return false;
    }

    if (dispatchResult === false) {
      console.warn("Dispatch mutation failed or was rolled back due to database write error.");
      showToast("❌ Database write error: Failed to update status.");
      return false;
    }

    // Show interactive user guidance banner only on verified write confirmation
    setShowOutlookGuide(true);

    // 5. Build compose link based on client type selection with standard CRLF formatting
    const formattedMailBody = mailBody.replace(/\r?\n/g, "\r\n");
    let url = "";
    if (outlookClientType === "web") {
      url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(recipientEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMailBody)}`;
    } else if (outlookClientType === "live") {
      url = `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(recipientEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMailBody)}`;
    } else {
      url = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMailBody)}`;
    }

    // 6. Generate QR code data URL on demand if not cancelled
    let activeQrDataUrl = qrUrlSmall || qrUrl;
    if (!isCancelled) {
      const payload = data.qrOverride.trim() || activeVoucherCode || "";
      if (payload && payload !== "-" && payload !== "CANCELLED") {
        try {
          activeQrDataUrl = await QRCode.toDataURL(payload, {
            width: 400,
            margin: 1,
            errorCorrectionLevel: "H",
            color: { dark: "#111111", light: "#FFFFFF" }
          });
          setQrUrl(activeQrDataUrl);
          setQrUrlSmall(activeQrDataUrl);
        } catch (err) {
          console.error("QR Code Generation Error in Send:", err);
        }
      }
    }

    // Copy the QR code image directly to clipboard
    if (!isCancelled && activeQrDataUrl) {
      try {
        window.focus();
        const blob = dataURLtoBlob(activeQrDataUrl);
        if (navigator.clipboard && typeof navigator.clipboard.write === 'function') {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          setCopyStatus("success");
          setTimeout(() => setCopyStatus("idle"), 2000);
        }
      } catch (err) {
        console.warn("Clipboard copy QR code error:", err);
      }
    }

    // Automatically open Outlook / email composer
    try {
      if (url.startsWith("mailto:")) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.warn("Could not auto-open Outlook link:", err);
    }

    showToast(`📋 QR Code copied! Outlook opened — paste (Ctrl+V) into the email body.`);

    // 7. Auto-progression: scan the remaining matched records queue within active date scope ONLY
    let nextUnsentRecord: CsvPermitRecord | null = null;

    if (matchingPermits.length > 0 && activeIndex !== -1) {
      // Look-ahead search: start from the index after the current activeIndex
      for (let i = activeIndex + 1; i < matchingPermits.length; i++) {
        const record = matchingPermits[i];
        if (!isRecordDispatched(record)) {
          nextUnsentRecord = record;
          break;
        }
      }

      // Wrap-around search: if not found, scan from index 0 up to activeIndex
      if (!nextUnsentRecord) {
        for (let i = 0; i < activeIndex; i++) {
          const record = matchingPermits[i];
          if (!isRecordDispatched(record)) {
            nextUnsentRecord = record;
            break;
          }
        }
      }
    }

    // If an unsent record was found in the current date queue, transition to it.
    // Once all pending items for the active date hit 0, stop and wait on the current date ('Dead Stop').
    if (nextUnsentRecord) {
      onSelectRecord?.(nextUnsentRecord);
    }
    return true;
  };

  const sendOne = async (record?: CsvPermitRecord) => {
    if (record) {
      onSelectRecord?.(record);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    return handleSendClick();
  };

  const bulkEmail = async (records?: CsvPermitRecord[]) => {
    const targets = records && records.length > 0
      ? records
      : matchingPermits.filter(r => !isRecordDispatched(r));

    if (targets.length === 0) {
      showToast("No unsent records to dispatch.");
      return;
    }

    showToast(`Initiating email dispatch for ${targets.length} record(s)...`);
    for (const record of targets) {
      onSelectRecord?.(record);
      await new Promise(resolve => setTimeout(resolve, 400));
      await handleSendClick();
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  };

  // Keyboard shortcuts listener: Enter/Space to dispatch, Left/Right arrows to navigate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElem = document.activeElement;
      if (
        activeElem &&
        (activeElem.tagName === 'INPUT' ||
         activeElem.tagName === 'TEXTAREA' ||
         activeElem.tagName === 'SELECT' ||
         (activeElem as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (matchingPermits.length > 0 && activeIndex > 0) {
          onSelectRecord?.(matchingPermits[activeIndex - 1]);
        } else if (matchingPermits.length > 0) {
          onSelectRecord?.(matchingPermits[matchingPermits.length - 1]);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (matchingPermits.length > 0 && activeIndex < matchingPermits.length - 1) {
          onSelectRecord?.(matchingPermits[activeIndex + 1]);
        } else if (matchingPermits.length > 0) {
          onSelectRecord?.(matchingPermits[0]);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if ((qrUrlSmall || isCancelled) && !isCurrentDispatched) {
          handleSendWithOutlook();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [matchingPermits, activeIndex, qrUrlSmall, isCurrentDispatched, onSelectRecord, handleSendWithOutlook]);

  useImperativeHandle(ref, () => ({
    send: handleSendClick,
    sendOne,
    bulkEmail,
    unsend: async () => {
      if (!isCurrentDispatched) return true;
      const matchedRecord = (activeIndex !== -1 && matchingPermits[activeIndex])
        ? matchingPermits[activeIndex]
        : (database ? database.find(r => ((data as any).formId && (r.formId === (data as any).formId || r.id === (data as any).formId))) : undefined);
      if (!matchedRecord) return false;
      const result = await unmarkAsDispatched?.(data.vrm, data.email, matchedRecord);
      return result !== false;
    },
    print: handlePrint,
  }), [handleSendClick, sendOne, bulkEmail, isCurrentDispatched, activeIndex, matchingPermits, database, data, unmarkAsDispatched, handlePrint]);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div 
        ref={cardRef}
        className="w-full max-w-[370px] bg-white dark:bg-slate-950 rounded-2xl shadow-xl border border-gray-200/80 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl print:border-none print:shadow-none font-sans text-gray-800 dark:text-slate-200"
        id="print-card-content"
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none duration-700 mix-blend-overlay" />

        {/* Top Header - Concessions Parking Voucher */}
        <div className="bg-[#005EB8] p-3.5 text-white flex items-center justify-between">
          <div className="space-y-0.5 text-left">
            <h3 className="text-xs font-bold tracking-wide uppercase leading-tight">
              {data.title || "Patient & Visitor Concessions"}
            </h3>
            <p className="text-[10px] text-blue-100 font-semibold uppercase tracking-wider flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>{data.site || "-"}</span>
            </p>
          </div>
          {/* Authentic NHS logo badge style */}
          <div className="bg-white text-[#005EB8] text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow-sm select-none uppercase shrink-0 tracking-tighter">
            NHS
          </div>
        </div>

        {/* Card Body - Content & Details */}
        <div className="p-4 space-y-3.5">
          
          {/* Slate License Plate style display */}
          <div className="flex justify-center mt-0.5">
            <div className="bg-slate-900 text-white border border-slate-700/80 rounded-md py-1 px-3 flex items-center font-bold tracking-widest text-base shadow-sm select-none max-w-[200px] w-full justify-center relative overflow-hidden h-9">
              {/* Blue UK strip on the left */}
              <div className="absolute left-0 top-0 bottom-0 w-3.5 bg-[#005EB8] flex flex-col justify-between items-center py-0.5 text-[5px] text-white select-none">
                <span className="font-sans font-black">GB</span>
              </div>
              <span className="pl-3 uppercase text-white font-extrabold text-[15px] font-mono">
                {data.vrm ? formatUKPlate(data.vrm).toUpperCase() : "-"}
              </span>
            </div>
          </div>

          {/* QR Code section */}
          <div className="flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-100 dark:border-slate-850 max-w-[210px] mx-auto shadow-sm">
            {isSilentBlocked ? (
              <div className="w-36 h-36 flex flex-col items-center justify-center bg-rose-50 dark:bg-rose-950/30 rounded-lg p-2 text-center border border-rose-200 dark:border-rose-900/60 shadow-xs">
                <ShieldAlert className="w-7 h-7 text-rose-600 dark:text-rose-400 mb-1.5 shrink-0" />
                <span className="font-extrabold text-[9.5px] text-rose-700 dark:text-rose-300 uppercase tracking-wider leading-tight">
                  Unable to generate a QR code for this vehicle — please contact the parking admin team.
                </span>
              </div>
            ) : isCancelled ? (
              <div className="w-36 h-36 flex flex-col items-center justify-center bg-rose-50 dark:bg-rose-950/30 rounded-lg p-2 text-center border border-rose-200 dark:border-rose-900/60 shadow-xs">
                <ShieldAlert className="w-7 h-7 text-rose-600 dark:text-rose-400 mb-1 shrink-0" />
                <span className="font-extrabold text-[11px] text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                  CANCELLED
                </span>
                <span className="text-[8.5px] font-semibold text-rose-600/80 dark:text-rose-400/80 mt-1 leading-tight px-1">
                  {cancellationDetails.reason === 'duplicate'
                    ? "Duplicate Permit Request (Active Permit Found)"
                    : isCancelledInFuture
                      ? "Date Mismatch (≥ 2 days in future)"
                      : `Validity period ended (${data.validTo ? formatDate(data.validTo) : (data.validFrom ? formatDate(addDays(data.validFrom, 6)) : "[Date Expiry]")})`}
                </span>
              </div>
            ) : qrUrl ? (
              <img 
                src={qrUrl} 
                alt="QR Code Ticket" 
                className="w-36 h-36 bg-white p-1 rounded-md border border-gray-150 select-none"
              />
            ) : data.voucherCodesText === "-" ? (
              <div className="w-36 h-36 flex flex-col items-center justify-center bg-rose-50/40 dark:bg-rose-950/10 rounded-lg p-2 text-center border border-dashed border-rose-200 dark:border-rose-900/30">
                <span className="font-sans font-black italic text-rose-500 dark:text-rose-400 text-4xl select-none leading-none mb-1">
                  -
                </span>
                <span className="font-bold text-[10px] text-rose-700 dark:text-rose-400">No Voucher Available</span>
                <span className="text-[8px] mt-0.5 text-rose-500/70 dark:text-rose-400/60">(Required Date Missing Code)</span>
              </div>
            ) : (
              <div className="w-36 h-36 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 rounded-lg text-xs text-slate-400 dark:text-slate-500 p-2 text-center border border-dashed border-slate-200 dark:border-slate-800">
                <span className="text-base mb-1">⚠️</span>
                <span className="font-semibold text-slate-500 dark:text-slate-400">No Unique QR</span>
                <span className="text-[8px] mt-0.5 text-slate-400 dark:text-slate-500">(Duplicate or Empty Code)</span>
              </div>
            )}
            
            {/* Voucher Code badge */}
            <div className="mt-2 text-center">
              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                {isSilentBlocked ? "Blocklist Status" : isCancelled ? "Permit Status" : "Pre-Paid Parking Code"}
              </span>
              <span className={`text-sm font-bold tracking-wider ${
                isSilentBlocked || isCancelled
                  ? "text-rose-600 dark:text-rose-400 font-mono" 
                  : "text-emerald-600 dark:text-emerald-400 font-mono"
              }`}>
                {isSilentBlocked ? "SILENT BLOCKED" : isCancelled ? "CANCELLED" : (activeVoucherCode || "-")}
              </span>
            </div>
          </div>

          {/* Multiple Voucher Selector (Preserving dynamic multi-voucher picker) */}
          {voucherCodes.length > 1 && (
            <div className="w-full mb-3 px-1 print:hidden">
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg p-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveVoucherIndex((prev) => (prev > 0 ? prev - 1 : voucherCodes.length - 1))}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-[#005EB8] dark:text-blue-400 font-bold transition-all select-none cursor-pointer"
                  title="Previous Voucher Code"
                >
                  ◀
                </button>
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                    Voucher {activeVoucherIndex + 1} of {voucherCodes.length}
                  </span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                    {activeVoucherCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveVoucherIndex((prev) => (prev < voucherCodes.length - 1 ? prev + 1 : 0))}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-[#005EB8] dark:text-blue-400 font-bold transition-all select-none cursor-pointer"
                  title="Next Voucher Code"
                >
                  ▶
                </button>
              </div>
            </div>
          )}

          {/* Metadata details grid/table */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3 text-[11px] space-y-2">
            
            {/* Valid From & Valid To Date Badges */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded border border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block">Valid From</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200 block text-xs mt-0.5">
                  {data.validFrom ? formatDate(data.validFrom) : "-"}
                </span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded border border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block">Expires</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200 block text-xs mt-0.5">
                  {data.validTo ? formatDate(data.validTo) : "-"}
                </span>
              </div>
            </div>

            {/* Additional driver details rows in inset container */}
            <div className="space-y-1 bg-slate-50/50 dark:bg-slate-900/30 p-2 rounded-lg border border-slate-100 dark:border-slate-800/80">
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 text-left">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#005EB8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span>Driver Name:</span>
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[170px] text-right">
                  {data.name && data.name !== "-" ? toTitleCase(data.name) : "-"}
                </span>
              </div>
              
              <div className="flex justify-between items-center py-0.5">
                <span className="text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 text-left">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#005EB8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="m12 3-10 5 10 5 10-5-10-5Z"/>
                    <path d="m2 17 10 5 10-5"/>
                    <path d="m2 12 10 5 10-5"/>
                  </svg>
                  <span>Department:</span>
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[170px] text-right">
                  {data.ward && data.ward !== "-" ? toTitleCase(data.ward) : "-"}
                </span>
              </div>

              {/* Phone and Email Sub-Section */}
              <div className="border-t border-slate-200/50 dark:border-slate-800/60 pt-1.5 mt-1.5 space-y-0.5 text-[10px]">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 text-left">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#005EB8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    <span>Phone:</span>
                  </span>
                  <span className="font-bold text-slate-600 dark:text-slate-400 font-mono text-right">
                    {data.phone || "-"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1 text-left">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#005EB8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <rect width="20" height="16" x="2" y="4" rx="2"/>
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                    <span>Email:</span>
                  </span>
                  <span className="font-semibold text-slate-600 dark:text-slate-400 truncate max-w-[170px] text-right">
                    {data.email && data.email !== "-" ? data.email.toLowerCase() : "-"}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Card Footer - Scan / Stamp Info */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 border-t border-slate-150 dark:border-slate-800/80 text-center flex items-center justify-center gap-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none select-none">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>NHS {data.site ? data.site.replace(/^NHS\s+/i, "") : "-"} Parking Validation Card</span>
        </div>
      </div>

      <div className="w-full max-w-[370px] flex flex-col gap-3.5 print:hidden">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-3.5 space-y-3 text-left">
          <div className="flex flex-col gap-2 pb-2 border-b border-gray-150 dark:border-slate-800/60 select-none">
            <div className="flex items-center justify-between gap-1 text-xs overflow-hidden">
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-gray-500 dark:text-slate-400 font-bold text-xs tracking-tight whitespace-nowrap">Permit Status</span>
                <span className="text-[11px] text-gray-400 dark:text-slate-500 font-medium font-sans whitespace-nowrap">
                  (Pending: <button type="button" onClick={() => setShowPendingModal(true)} className="font-extrabold text-[#3b82f6] font-mono hover:underline cursor-pointer bg-transparent border-0 p-0 text-left inline" title="Click to view pending records">{matchingStats.pending}</button> | Sent: <span className="font-extrabold text-[#10b981] font-mono">{matchingStats.sent}</span>)
                </span>
              </div>
              {isCancelled ? (
                <span 
                  className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider text-[11px] shrink-0 whitespace-nowrap"
                  title="Cancelled"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                  <span>CANCELLED</span>
                </span>
              ) : isCurrentDispatched ? (
                <span 
                  className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-bold text-[11px] shrink-0 whitespace-nowrap"
                  title="Sent"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 text-[#005EB8] dark:text-blue-400 font-bold uppercase tracking-wider text-[11px] shrink-0 whitespace-nowrap select-none"
                  title="Pending"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-[#005EB8]" />
                  <span>PENDING</span>
                </span>
              )}
            </div>

            {/* Visual Progress Bar (Processed vs Pending) */}
            {dbStats.total > 0 && (
              <div className="w-full space-y-1 pt-0.5">
                <div className="flex items-center justify-between text-[10px] font-semibold text-gray-500 dark:text-slate-400">
                  <span>Progress: {dbStats.processed} of {dbStats.total} Processed ({dbStats.progressPct}%)</span>
                  <button
                    type="button"
                    onClick={() => setShowPendingModal(true)}
                    className="text-[#005EB8] dark:text-blue-400 font-bold cursor-pointer hover:underline hover:opacity-90 transition-all bg-transparent border-0 p-0 text-left"
                    title="Click to view pending records for active date"
                  >
                    {dbStats.pending} Pending
                  </button>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden flex border border-gray-200/60 dark:border-slate-800">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-300" 
                    style={{ width: `${dbStats.progressPct}%` }}
                    title={`Processed: ${dbStats.progressPct}% (${dbStats.processed} of ${dbStats.total} processed)`}
                  />
                  <div 
                    onClick={() => setShowPendingModal(true)}
                    className="h-full bg-[#005EB8] dark:bg-blue-500 transition-all duration-300 cursor-pointer hover:brightness-125" 
                    style={{ width: `${dbStats.pendingPct}%` }}
                    title={`Pending: ${dbStats.pendingPct}% (${dbStats.pending} pending for active date) - Click to view pending records`}
                  />
                </div>
              </div>
            )}
          </div>

          {!isCancelled && !qrUrl && !isCurrentDispatched && (
            <div className="bg-amber-50/50 dark:bg-amber-950/15 border border-amber-200 dark:border-amber-900/40 rounded-xl p-[14px] space-y-1.5 shadow-sm text-left">
              <div className="flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-400 space-y-0.5">
                  <div className="font-extrabold text-[12px] leading-snug">No QR Code Available</div>
                  <div className="font-medium leading-relaxed text-[10.5px] opacity-90">
                    Email dispatch is blocked. Please assign a unique voucher code or provide a custom override.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowOutlookSettings(!showOutlookSettings)}
              className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-xl border transition-all duration-250 ease-in-out cursor-pointer hover:shadow-xs active:scale-95 ${
                showOutlookSettings 
                  ? "bg-slate-100 border-gray-200 text-slate-800 dark:bg-slate-800 dark:border-slate-800 dark:text-white" 
                  : "bg-slate-50 border-gray-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-850/50"
              }`}
              title="Outlook Settings, Quick Actions & Clipboard Backups"
            >
              <Settings className="w-4 h-4 transition-transform duration-300 hover:rotate-45" />
            </button>

            {isCurrentDispatched ? (
              // Already sent → Always show Unsend (Red outlined styling)
              <button
                type="button"
                onClick={handleUnsendClick}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl transition-all duration-250 ease-in-out font-bold text-xs shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.98] bg-transparent hover:bg-red-50 dark:hover:bg-red-950/25 text-red-600 dark:text-red-400 border border-red-600 dark:border-red-500 cursor-pointer"
                title="Click to unsend and mark this permit as Pending"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
                <span>Unsend</span>
              </button>
            ) : (
              // Not sent → Show appropriate send button
              <button
                type="button"
                onClick={
                  isCancelled
                    ? handleSendClick
                    : qrCodeChanged
                      ? handleResendConcessionEmail
                      : handleSendClick
                }
                disabled={!isCancelled && !qrUrl}
                className={`flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl transition-all duration-250 ease-in-out font-bold text-xs shadow-xs hover:shadow-md hover:scale-[1.01] active:scale-[0.98] ${
                  !isCancelled && !qrUrl
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed hover:scale-100 hover:shadow-xs active:scale-100"
                    : isCancelled
                      ? "bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
                      : "bg-[#005EB8] hover:bg-blue-700 text-white cursor-pointer"
                }`}
                title={!isCancelled && !qrUrl ? "A valid QR code is required before sending." : ""}
              >
                {isCancelled ? (
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-white/90" />
                ) : (
                  <Mail className={`w-3.5 h-3.5 shrink-0 ${!isCancelled && !qrUrl ? "text-slate-400 dark:text-slate-500" : "text-white/90"}`} />
                )}
                <span>
                  {isCancelled
                    ? "Send Cancellation Notice" 
                    : qrCodeChanged 
                      ? "Resend Concession Email" 
                      : "Send Concession Email"}
                </span>
              </button>
            )}
          </div>

          {showOutlookSettings && (
            <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/80 space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Email Template
                </label>
                <div className="grid grid-cols-2 gap-1 bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800/80 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setEmailTemplate("new")}
                    className={`py-1 font-bold rounded transition-all cursor-pointer ${
                      emailTemplate === "new"
                        ? "bg-slate-100 dark:bg-slate-800 text-[#005EB8] dark:text-blue-300"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    }`}
                  >
                    New
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailTemplate("replacement")}
                    className={`py-1 font-bold rounded transition-all cursor-pointer ${
                      emailTemplate === "replacement"
                        ? "bg-slate-100 dark:bg-slate-800 text-[#005EB8] dark:text-blue-300"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    }`}
                  >
                    Resent
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-200/50 dark:border-slate-800/65 pt-0.5"></div>

              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Quick Actions
                </span>
                
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownload("qr")}
                    disabled={!qrUrl}
                    className="flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer h-8 shadow-sm"
                    title="Download high-resolution QR code image"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy("qr")}
                    disabled={!qrUrl}
                    className="flex items-center justify-center bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 p-1 rounded-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer h-8"
                    title="Copy QR code image to clipboard"
                  >
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownload("card")}
                    disabled={!qrUrl}
                    className="flex items-center justify-center bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 p-1 rounded-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer h-8"
                    title="Download full card graphic as PNG image"
                  >
                    <FileImage className="w-3.5 h-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                  </button>

                  <button
                    type="button"
                    onClick={handlePrint}
                    className="flex items-center justify-center bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 p-1 rounded-lg transition-all active:scale-95 cursor-pointer h-8"
                    title="Open browser print dialogue for full permit card"
                  >
                    <Printer className="w-3.5 h-3.5 shrink-0" />
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-200/50 dark:border-slate-800/65 pt-0.5"></div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Send Bulk Card Graphics
                </label>
                <button
                  type="button"
                  onClick={handleBatchDownloadCards}
                  disabled={batchDownloadProgress !== null}
                  className="w-full flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-200 p-2.5 rounded-lg transition-all cursor-pointer text-[11px] font-semibold disabled:opacity-60 disabled:cursor-not-allowed h-9 shadow-sm"
                >
                  <div className="flex items-center gap-1.5">
                    {batchDownloadProgress !== null && batchDownloadType === "card" ? (
                      <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <FileImage className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    )}
                    <span>Send Bulk Card Graphics</span>
                  </div>
                  <span className="text-[8px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-bold border border-indigo-100 dark:border-indigo-900/40">
                    {batchDownloadProgress !== null && batchDownloadType === "card" ? `${batchDownloadProgress}%` : "DOWNLOAD ALL"}
                  </span>
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Active Date Codes ({unusedVouchersForDay.length}):
                </label>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-center">
                  <span className="text-lg font-bold text-[#005EB8] dark:text-blue-400">
                    {unusedVouchersForDay.length}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">
                    codes available for {data.validFrom || (data as any).dateRequired || getTodayISO()}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Outlook Client Link Mode
                </label>
                <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setOutlookClientType("app")}
                    className={`py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                      outlookClientType === "app"
                        ? "bg-slate-100 dark:bg-slate-800 text-[#005EB8] dark:text-blue-300 font-bold"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    }`}
                  >
                    💻 App
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutlookClientType("web")}
                    className={`py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                      outlookClientType === "web"
                        ? "bg-slate-100 dark:bg-slate-800 text-[#005EB8] dark:text-blue-300 font-bold"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    }`}
                  >
                    🌐 Web (O365)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutlookClientType("live")}
                    className={`py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                      outlookClientType === "live"
                        ? "bg-slate-100 dark:bg-slate-800 text-[#005EB8] dark:text-blue-300 font-bold"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    }`}
                  >
                    📧 Live
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {matchingPermits.length > 0 && (
        <div className="w-full max-w-[370px] space-y-3 print:hidden">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl py-1.5 px-3 flex items-center justify-between text-xs font-semibold shadow-xs select-none">
            
            {/* Previous Match Button */}
            <button
              type="button"
              onClick={handlePrevMatch}
              className="group flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg transition-all duration-200 cursor-pointer active:scale-95"
              title="Step to previous matching record"
            >
              <ChevronLeft className="w-4 h-4 text-[#005EB8] dark:text-blue-400 transition-transform group-hover:-translate-x-0.5" />
              <span className="font-bold">Prev</span>
            </button>
            
            {/* Current Match Counter / Progress Indicator */}
            <div className="text-center py-0.5 px-3">
              <span className="text-[12px] text-indigo-600 dark:text-indigo-400 font-black block uppercase tracking-[0.18em] leading-none mb-0.5 font-mono">
                {currentRecord ? currentRecord.vrm.toUpperCase() : (data.vrm ? data.vrm.toUpperCase() : "MATCHED")}
              </span>
              <span className="text-[11px] font-bold text-gray-400 dark:text-slate-500 font-mono">
                {matchingPermits.length > 0 
                  ? `${currentCardIndex + 1} of ${matchingPermits.length} matches` 
                  : `${matchingPermits.length} matches`
                }
              </span>
            </div>

            {/* Next Match Button */}
            <button
              type="button"
              onClick={handleNextMatch}
              className="group flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg transition-all duration-200 cursor-pointer active:scale-95"
              title="Step to next matching record"
            >
              <span className="font-bold">Next</span>
              <ChevronRight className="w-4 h-4 text-[#005EB8] dark:text-blue-400 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      )}

      {showOutlookGuide && (
        <div className="fixed bottom-4 right-4 z-50 max-w-[280px] bg-slate-900 dark:bg-slate-950 text-white p-3 rounded-xl shadow-xl border border-slate-700/80 space-y-2.5">
          <div className="flex items-start gap-2">
            <div className="bg-emerald-500 text-white p-1 rounded-full shrink-0 mt-0.5">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
            <div className="text-left flex-1 min-w-0">
              <h4 className="font-bold text-[11px] uppercase tracking-wider text-slate-200 font-sans">
                QR Code Copied!
              </h4>
              <p className="text-[10.5px] text-slate-300 mt-1 leading-normal">
                Simply press <strong className="text-white">Ctrl + V</strong> inside your Outlook email body to insert it directly.
              </p>
              
              <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-slate-800">
                <span className="text-[9px] text-emerald-400 font-bold">Ready to paste</span>
                <button 
                  onClick={() => setShowOutlookGuide(false)}
                  className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors cursor-pointer px-2 py-0.5 rounded bg-slate-800"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUnsendConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 text-left">
            <div className="flex items-start gap-3">
              <div className="bg-rose-50 dark:bg-rose-950/30 p-2 rounded-full shrink-0">
                <RotateCcw className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-sans">
                  Confirm Action
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal font-medium">
                  Are you sure you want to Unsend this voucher?
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2.5 pt-1.5 justify-end">
              <button
                type="button"
                onClick={handleCancelUnsend}
                className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer select-none"
              >
                No
              </button>
              <button
                type="button"
                onClick={handleConfirmUnsend}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm select-none"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {showPendingModal && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowPendingModal(false)}
        >
          <div 
            className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-900/80 select-none">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#005EB8] dark:text-blue-400 flex items-center justify-center font-bold text-sm border border-blue-100 dark:border-blue-900/40">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    Pending Permits
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-[#005EB8] dark:text-blue-300">
                      {allPendingRecords.length} Pending
                    </span>
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 font-medium mt-0.5">
                    All Pending Records Across Database
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content / Table */}
            <div className="p-4 overflow-y-auto flex-1">
              {allPendingRecords.length === 0 ? (
                <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-xs flex flex-col items-center justify-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 opacity-60" />
                  <span className="font-semibold text-gray-600 dark:text-slate-300">No pending permits in the database</span>
                  <span className="text-[11px]">All permit records across the database have been dispatched or processed.</span>
                </div>
              ) : (
                <div className="border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs bg-white dark:bg-slate-950">
                  <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                    <table className="min-w-[650px] w-full text-xs text-left border-collapse table-auto">
                      <thead className="bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-gray-200 dark:border-slate-800 sticky top-0 z-10 select-none text-[10px]">
                        <tr>
                          <th scope="col" className="py-2.5 px-3 text-center whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Status</th>
                          <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Driver's Name</th>
                          <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">VRM / Plate</th>
                          <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Department</th>
                          <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Processing Date</th>
                          <th scope="col" className="py-2.5 px-3 text-right whitespace-nowrap">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-150 dark:divide-slate-800/80">
                        {allPendingRecords.map((record, index) => {
                          return (
                            <tr 
                              key={`pending_modal_${record.id || index}_${record.vrm}`}
                              onClick={() => {
                                if (onSelectRecord) {
                                  onSelectRecord(record);
                                }
                                setShowPendingModal(false);
                              }}
                              className="hover:bg-blue-50/60 dark:hover:bg-blue-950/30 transition-colors cursor-pointer text-gray-800 dark:text-slate-200 group"
                              title="Click to load this pending record into card"
                            >
                              <td 
                                className="py-2.5 px-3 text-center whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 cursor-default select-none"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 text-[#005EB8] dark:text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-900/40 cursor-default select-none pointer-events-none">
                                  <AlertCircle className="w-3 h-3 text-[#005EB8] dark:text-blue-400" />
                                  <span>Pending</span>
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-gray-900 dark:text-slate-100 group-hover:text-[#005EB8] dark:group-hover:text-blue-400 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                                {record.driverName ? toTitleCase(record.driverName) : "-"}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                                <span className="font-mono font-extrabold bg-amber-100 dark:bg-amber-950/50 border border-yellow-200 dark:border-yellow-900/50 text-amber-950 dark:text-amber-300 px-2 py-0.5 rounded text-[11px] uppercase tracking-wider inline-block">
                                  {record.vrm ? record.vrm.toUpperCase() : "-"}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-medium text-gray-600 dark:text-slate-400 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                                {record.department || record.ward ? toTitleCase(record.department || record.ward) : "-"}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-medium text-gray-600 dark:text-slate-400 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                                {record.dateRequired ? formatDate(record.dateRequired) : "-"}
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onSelectRecord) {
                                      onSelectRecord(record);
                                    }
                                    setShowPendingModal(false);
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-bold text-[#005EB8] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-[#005EB8] hover:text-white dark:hover:bg-blue-600 dark:hover:text-white rounded-lg transition-all border border-blue-100 dark:border-blue-900/40 cursor-pointer"
                                >
                                  Load Record
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-900/80 text-xs select-none">
              <span className="text-gray-500 dark:text-slate-400 font-medium">
                Showing {allPendingRecords.length} pending {allPendingRecords.length === 1 ? 'record' : 'records'} across the entire database
              </span>
              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 font-bold rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900/95 dark:bg-slate-950/95 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700/80 animate-bounce font-semibold text-xs whitespace-nowrap">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export const PermitCard = forwardRef<PermitCardHandle, PermitCardProps>(PermitCardInner);
PermitCard.displayName = "PermitCard";
