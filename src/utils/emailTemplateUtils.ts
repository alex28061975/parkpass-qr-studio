import { 
  formatDate, 
  parseDateToISO, 
  addDays, 
  toTitleCase,
  getTodayISO,
  checkIsBlockedDuplicate,
  isRecordCancelled
} from "./csvParser";

export type CancellationReason = 'future' | 'expired' | 'duplicate';

export interface EmailTemplateParams {
  vrm?: string;
  driverName?: string;
  duration?: string;
  validFrom?: string;
  validTo?: string;
  todayDate?: string;
  dateRequired?: string;
  activePermitExpiry?: string;
  reapplyDate?: string;
  currentExpiryDate?: string;
  earliestRenewalDate?: string;
  reason?: CancellationReason;
}

export interface EmailContentResult {
  subject: string;
  plainText: string;
  htmlText: string;
}

export const NHS_SUPPORT_EMAIL = "parkingadminbh.bartshealth@nhs.net";

/**
 * Automatically resolves the cancellation details (reason: duplicate/expired/future,
 * currentExpiryDate, earliestRenewalDate) for a permit record based on the database.
 */
export function resolveCancellationDetails(
  record?: { 
    vrm?: string; 
    name?: string; 
    driverName?: string; 
    validFrom?: string; 
    dateRequired?: string; 
    todayDate?: string; 
    id?: string | number; 
    formId?: string | number; 
    isCancelled?: boolean; 
    voucherCode?: string;
    status?: string;
    isDispatched?: boolean;
    startTime?: string;
    createdAt?: string;
    validTo?: string;
  },
  database?: any[],
  refDateStr?: string
): {
  reason: CancellationReason;
  currentExpiryDate: string;
  earliestRenewalDate: string;
} {
  if (!record) {
    return { reason: 'future', currentExpiryDate: '', earliestRenewalDate: '' };
  }

  const cleanVrm = (record.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const refDateISO = parseDateToISO(refDateStr || record.todayDate) || getTodayISO();

  let isDuplicate = false;
  let activePermit: any = null;

  if (cleanVrm && cleanVrm !== "PENDING" && cleanVrm !== "-" && database && database.length > 0) {
    // 1. Check if blocked duplicate via checkIsBlockedDuplicate
    const isBlocked = checkIsBlockedDuplicate(record, database, refDateISO);

    // 2. Look for any matching record for this VRM in database (excluding self)
    const cleanRecordId = (val: any) => String(val || "").replace(/^#/, "").trim();
    const recFormId = cleanRecordId(record.formId ?? record.id);

    const matchingRecords = database.filter(r => {
      const rVrm = (r.vrm || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (rVrm !== cleanVrm) return false;
      // Exclude self if ID / formId matches
      const rFormId = cleanRecordId(r.formId ?? r.id);
      if (recFormId && rFormId && recFormId === rFormId) return false;
      return true;
    });

    if (matchingRecords.length > 0) {
      // Sort matching records descending by date so the latest is always evaluated first
      const sortedMatchingRecords = [...matchingRecords].sort((a, b) => {
        const aD = parseDateToISO(a.dateRequired || a.validFrom || a.startTime || a.createdAt || "") || "";
        const bD = parseDateToISO(b.dateRequired || b.validFrom || b.startTime || b.createdAt || "") || "";
        return bD.localeCompare(aD);
      });

      // Find active / sent / valid permits for this VRM
      const activeMatches = sortedMatchingRecords.filter(r => {
        if (r.status === 'sent' || r.isDispatched === true) return true;
        if (r.voucherCode && r.voucherCode !== '-' && r.voucherCode !== 'CANCELLED' && r.voucherCode !== 'Cancelled') return true;
        if (!isRecordCancelled(r, refDateISO, database)) return true;
        return false;
      });

      // Look for overlapping earlier permit for this vehicle (e.g., within 7 days before this request)
      const thisReqIso = parseDateToISO(record.dateRequired || record.validFrom || "") || refDateISO;
      const overlappingMatch = sortedMatchingRecords.find(r => {
        const rReqIso = parseDateToISO(r.dateRequired || r.validFrom || "");
        if (!rReqIso || !thisReqIso) return false;
        const rTime = new Date(rReqIso + "T00:00:00").getTime();
        const thisTime = new Date(thisReqIso + "T00:00:00").getTime();
        const diff = Math.round((thisTime - rTime) / (1000 * 60 * 60 * 24));
        return diff >= 0 && diff < 7;
      });

      if (isBlocked || activeMatches.length > 0 || overlappingMatch) {
        isDuplicate = true;
        if (overlappingMatch) {
          activePermit = overlappingMatch;
        } else if (activeMatches.length > 0) {
          activePermit = activeMatches[0];
        } else {
          activePermit = sortedMatchingRecords[0];
        }
      }
    }
  }

  if (isDuplicate && activePermit) {
    // Requirements:
    // 1. validTo must be dateRequired + 6 days (e.g., 31/08/2026 → 06/09/2026)
    // 2. earliestRenewalDate must be validTo + 1 day (e.g., 06/09/2026 → 07/09/2026)
    let expiryIso = "";
    const activeReqIso = parseDateToISO(activePermit.dateRequired || "");
    const activeValidToIso = parseDateToISO(activePermit.validTo || "");
    const activeValidFromIso = parseDateToISO(activePermit.validFrom || "");
    const activeExpiryIso = parseDateToISO(activePermit.dateExpiry || "");

    if (activeReqIso) {
      const calculatedExpiry = addDays(activeReqIso, 6);
      expiryIso = (activeValidToIso && activeValidToIso > calculatedExpiry) ? activeValidToIso : calculatedExpiry;
    } else if (activeValidToIso) {
      expiryIso = activeValidToIso;
    } else if (activeValidFromIso) {
      expiryIso = addDays(activeValidFromIso, 6);
    } else if (activeExpiryIso) {
      expiryIso = activeExpiryIso;
    } else {
      const fallbackStart = parseDateToISO(activePermit.startTime || activePermit.createdAt || "");
      if (fallbackStart) {
        expiryIso = addDays(fallbackStart, 6);
      }
    }

    let currentExpiryDate = "";
    let earliestRenewalDate = "";
    if (expiryIso) {
      currentExpiryDate = formatDate(expiryIso);
      const renewalIso = addDays(expiryIso, 1);
      if (renewalIso) {
        earliestRenewalDate = formatDate(renewalIso);
      }
    }
    return {
      reason: 'duplicate',
      currentExpiryDate,
      earliestRenewalDate
    };
  }

  if (isDuplicate) {
    return {
      reason: 'duplicate',
      currentExpiryDate: '',
      earliestRenewalDate: ''
    };
  }

  const validFromStr = record.validFrom || record.dateRequired || "";
  const validFromISO = parseDateToISO(validFromStr);
  if (validFromISO && validFromISO < refDateISO) {
    return {
      reason: 'expired',
      currentExpiryDate: '',
      earliestRenewalDate: ''
    };
  }

  return {
    reason: 'future',
    currentExpiryDate: '',
    earliestRenewalDate: ''
  };
}

/**
 * Normalizes VRM for email display (Upper-case, e.g., FY21CVX)
 */
export function formatVrmForEmail(vrm?: string | null): string {
  if (!vrm || vrm.trim() === "" || vrm.trim() === "-") {
    return "[VRM]";
  }
  return vrm.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Normalizes driver name for email display (Title-case, e.g., Shakil Uddin)
 */
export function formatDriverNameForEmail(name?: string | null): string {
  if (!name || name.trim() === "" || name.trim() === "-") {
    return "Driver";
  }
  return toTitleCase(name.trim());
}

/**
 * Derives formatted validFrom and validExpiry date strings (DD/MM/YYYY)
 */
export function deriveDateRangeForEmail(params: EmailTemplateParams): {
  validFrom: string;
  validExpiry: string;
} {
  const rawFrom = params.validFrom || params.dateRequired || params.todayDate || "";
  const rawFromIso = parseDateToISO(rawFrom);

  const rawTo = params.validTo || "";
  const rawToIso = parseDateToISO(rawTo);

  let formattedFrom = "[Valid From]";
  if (rawFrom) {
    const f = formatDate(rawFrom);
    if (f && f !== "-") formattedFrom = f;
  }

  let formattedExpiry = "[Valid Expiry]";
  if (rawTo) {
    const f = formatDate(rawTo);
    if (f && f !== "-") formattedExpiry = f;
  } else if (rawFromIso) {
    const calculatedExpiryIso = addDays(rawFromIso, 6);
    if (calculatedExpiryIso) {
      formattedExpiry = formatDate(calculatedExpiryIso);
    }
  }

  return {
    validFrom: formattedFrom,
    validExpiry: formattedExpiry,
  };
}

/**
 * Template 1: Send Concession QR Code
 */
export function getSendEmailContent(params: EmailTemplateParams): EmailContentResult {
  const vrm = formatVrmForEmail(params.vrm);
  const driverName = formatDriverNameForEmail(params.driverName);
  const duration = params.duration || "7 days";
  const { validFrom, validExpiry } = deriveDateRangeForEmail(params);

  const subject = `Your QR Code Credentials - ${vrm}`;

  const plainText = `
Dear ${driverName},

Please find attached your concession QR code.

On your first day of parking, please take the QR code to the pay machine, press Concession, and enter vehicle registration number ${vrm}.

The machine will then ask you to scan a blue badge or concession. Please scan your QR code at this point.

Your concession will allow you to park for ${duration}, from ${validFrom} to ${validExpiry}.

Please note that concession payments are non-refundable.

If you have any queries, please contact: ${NHS_SUPPORT_EMAIL}

Kind regards,
Barts Health NHS Trust
Car Parking Services Team`;

  const htmlText = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; line-height: 1.35;">
<br/>
Dear ${driverName},<br/><br/>
Please find attached your concession QR code.<br/><br/>
On your first day of parking, please take the QR code to the pay machine, press Concession, and enter vehicle registration number <strong>${vrm}</strong>.<br/><br/>
The machine will then ask you to scan a blue badge or concession. Please scan your QR code at this point.<br/><br/>
Your concession will allow you to park for ${duration}, from ${validFrom} to ${validExpiry}.<br/><br/>
Please note that concession payments are non-refundable.<br/><br/>
If you have any queries, please contact: <a href="mailto:${NHS_SUPPORT_EMAIL}" style="color: #005EB8; text-decoration: underline;">${NHS_SUPPORT_EMAIL}</a><br/><br/>
Kind regards,<br/>
Barts Health NHS Trust<br/>
Car Parking Services Team
</div>`;

  return { subject, plainText, htmlText };
}

/**
 * Template 2: Replacement / Resent Concession QR Code (RESEND_CONCESSION)
 */
export function getReplacementEmailContent(params: EmailTemplateParams): EmailContentResult {
  const vrm = formatVrmForEmail(params.vrm);
  const driverName = formatDriverNameForEmail(params.driverName);
  const duration = params.duration || "7 days";
  const { validFrom, validExpiry } = deriveDateRangeForEmail(params);

  const subject = `Replacement Parking Concession – ${vrm}`;

  const plainText = `
Dear ${driverName},

Please find attached your replacement concession QR code. We apologise for any inconvenience caused by the previous code.

Please use this replacement QR code instead of your previous QR code.

On your next visit, please take the replacement QR code to the pay machine, press Concession, and enter vehicle registration number ${vrm}.

The machine will then ask you to scan a blue badge or concession. Please scan your replacement QR code at this point.

Your concession will allow you to park for ${duration}, from ${validFrom} to ${validExpiry}.

Please note that concession payments are non-refundable.

If you continue to experience any issues or have any further queries, please contact: ${NHS_SUPPORT_EMAIL}

Kind regards,
Barts Health NHS Trust
Car Parking Services Team`;

  const htmlText = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; line-height: 1.35;">
<br/>
Dear ${driverName},<br/><br/>
Please find attached your replacement concession QR code. We apologise for any inconvenience caused by the previous code.<br/><br/>
Please use this replacement QR code instead of your previous QR code.<br/><br/>
On your next visit, please take the replacement QR code to the pay machine, press Concession, and enter vehicle registration number <strong>${vrm}</strong>.<br/><br/>
The machine will then ask you to scan a blue badge or concession. Please scan your replacement QR code at this point.<br/><br/>
Your concession will allow you to park for ${duration}, from ${validFrom} to ${validExpiry}.<br/><br/>
Please note that concession payments are non-refundable.<br/><br/>
If you continue to experience any issues or have any further queries, please contact: <a href="mailto:${NHS_SUPPORT_EMAIL}" style="color: #005EB8; text-decoration: underline;">${NHS_SUPPORT_EMAIL}</a><br/><br/>
Kind regards,<br/>
Barts Health NHS Trust<br/>
Car Parking Services Team
</div>`;

  return { subject, plainText, htmlText };
}

export const getResendConcessionEmailContent = getReplacementEmailContent;

/**
 * Template 3: Cancellation Notice
 * Generates specific cancellation messages for the 3 scenarios:
 * 1. Date Invalid (Future): 2+ days ahead
 * 2. Expired (Too Old): 7+ days ago
 * 3. Duplicate (Same VRM): active permit exists
 */
export function getCancellationEmailContent(
  params: EmailTemplateParams,
  reasonOverride?: CancellationReason
): EmailContentResult {
  const vrm = formatVrmForEmail(params.vrm);
  const driverName = formatDriverNameForEmail(params.driverName);
  const { validFrom } = deriveDateRangeForEmail(params);

  // Determine effective cancellation reason
  let reason: CancellationReason = reasonOverride || params.reason || 'future';
  if (!reasonOverride && !params.reason) {
    if (params.currentExpiryDate || params.activePermitExpiry || params.earliestRenewalDate || params.reapplyDate) {
      reason = 'duplicate';
    }
  }

  const subject = `Cancelled: Concession Permit – ${vrm}`;

  let plainText = "";
  let htmlText = "";

  if (reason === 'duplicate') {
    // Format Current Expiry Date
    let currentExpiry = "[Current Expiry Date]";
    const rawExpiry = params.currentExpiryDate || params.activePermitExpiry || "";
    if (rawExpiry) {
      const f = formatDate(rawExpiry);
      if (f && f !== "-") {
        currentExpiry = f;
      }
    }

    // Format Earliest Renewal Date
    let earliestRenewal = "[Earliest Renewal Date]";
    const rawRenewal = params.earliestRenewalDate || params.reapplyDate || "";
    if (rawRenewal) {
      const f = formatDate(rawRenewal);
      if (f && f !== "-") {
        earliestRenewal = f;
      }
    } else if (rawExpiry) {
      const expiryIso = parseDateToISO(rawExpiry);
      if (expiryIso) {
        const nextDayIso = addDays(expiryIso, 1);
        if (nextDayIso) {
          const f = formatDate(nextDayIso);
          if (f && f !== "-") {
            earliestRenewal = f;
          }
        }
      }
    }

    plainText = `Dear ${driverName},

We have received your parking concession request for vehicle ${vrm}.

Our records show that this vehicle already has an active permit valid through ${currentExpiry}. Your new concession request has been cancelled because your current permit is still active.

You can submit a new concession request from ${earliestRenewal}, after your current permit expires.

If you continue to experience any issues or have any further queries, please contact: ${NHS_SUPPORT_EMAIL}

Kind regards,
Barts Health NHS Trust
Car Parking Services Team`;

    htmlText = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; line-height: 1.35;">
Dear ${driverName},<br/><br/>
We have received your parking concession request for vehicle <strong>${vrm}</strong>.<br/><br/>
Our records show that this vehicle already has an active permit valid through ${currentExpiry}. Your new concession request has been cancelled because your current permit is still active.<br/><br/>
You can submit a new concession request from ${earliestRenewal}, after your current permit expires.<br/><br/>
If you continue to experience any issues or have any further queries, please contact: <a href="mailto:${NHS_SUPPORT_EMAIL}" style="color: #005EB8; text-decoration: underline;">${NHS_SUPPORT_EMAIL}</a><br/><br/>
Kind regards,<br/>
Barts Health NHS Trust<br/>
Car Parking Services Team
</div>`;
  } else if (reason === 'expired') {
    plainText = `Dear ${driverName},

We have received your parking concession request for vehicle ${vrm}.

The 7-day validity period for this concession has ended, so your request has been cancelled.

If you require a new concession, please contact your ward or department to submit a new concession request.

If you continue to experience any issues or have any further queries, please contact: ${NHS_SUPPORT_EMAIL}

Kind regards,
Barts Health NHS Trust
Car Parking Services Team`;

    htmlText = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; line-height: 1.35;">
Dear ${driverName},<br/><br/>
We have received your parking concession request for vehicle <strong>${vrm}</strong>.<br/><br/>
The 7-day validity period for this concession has ended, so your request has been cancelled.<br/><br/>
If you require a new concession, please contact your ward or department to submit a new concession request.<br/><br/>
If you continue to experience any issues or have any further queries, please contact: <a href="mailto:${NHS_SUPPORT_EMAIL}" style="color: #005EB8; text-decoration: underline;">${NHS_SUPPORT_EMAIL}</a><br/><br/>
Kind regards,<br/>
Barts Health NHS Trust<br/>
Car Parking Services Team
</div>`;
  } else {
    // Default / 'future': Date Invalid (Future)
    plainText = `Dear ${driverName},

We have received your parking concession request for vehicle ${vrm}.

The start date on your application was set to ${validFrom}, which is in the future. To prevent issuing an invalid concession, this request has been cancelled.

If you still require parking, please contact your ward or department to submit a new concession request.

If you continue to experience any issues or have any further queries, please contact: ${NHS_SUPPORT_EMAIL}

Kind regards,
Barts Health NHS Trust
Car Parking Services Team`;

    htmlText = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; line-height: 1.35;">
Dear ${driverName},<br/><br/>
We have received your parking concession request for vehicle <strong>${vrm}</strong>.<br/><br/>
The start date on your application was set to ${validFrom}, which is in the future. To prevent issuing an invalid concession, this request has been cancelled.<br/><br/>
If you still require parking, please contact your ward or department to submit a new concession request.<br/><br/>
If you continue to experience any issues or have any further queries, please contact: <a href="mailto:${NHS_SUPPORT_EMAIL}" style="color: #005EB8; text-decoration: underline;">${NHS_SUPPORT_EMAIL}</a><br/><br/>
Kind regards,<br/>
Barts Health NHS Trust<br/>
Car Parking Services Team
</div>`;
  }

  return { subject, plainText, htmlText };
}