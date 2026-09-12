import React, { useState, useEffect, useMemo } from "react";
import { X, Check, Calendar, Car, User, Phone, Mail, Building2, MapPin, Tag } from "lucide-react";
import { CsvPermitRecord, ParsedVoucherData, parseDateToISO, addDays, formatPhoneNumber, isVoucherCodeMatch } from "../utils/csvParser";
import { isVoucherForPermitDateRange, cleanVoucherCodeValue } from "../utils/voucherValidation";
import { HOSPITAL_SITES } from "../types";

interface EditRecordModalProps {
  isOpen: boolean;
  record: CsvPermitRecord | null;
  database: CsvPermitRecord[];
  vouchersDatabase: ParsedVoucherData[];
  onClose: () => void;
  onSave: (updatedRecord: CsvPermitRecord) => void;
  resolvedVoucherCode?: string;
}

export function EditRecordModal({
  isOpen,
  record,
  database,
  vouchersDatabase,
  onClose,
  onSave,
  resolvedVoucherCode
}: EditRecordModalProps) {
  const [formVrm, setFormVrm] = useState("");
  const [formDriverName, setFormDriverName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formHospital, setFormHospital] = useState("Whipps Cross Hospital");
  const [formWard, setFormWard] = useState("");
  const [formDateRequired, setFormDateRequired] = useState("");
  const [formDateExpiry, setFormDateExpiry] = useState("");
  const [formVoucherCode, setFormVoucherCode] = useState("");
  const [formStatus, setFormStatus] = useState("PENDING");

  // Resolve any real code found directly on record itself,
  // ignoring placeholder/display values like "-" or "CANCELLED".
  const resolvedRecordCode = useMemo(() => {
    if (!record) return "";
    const candidates = [
      record.voucherCode,
      (record as any).prePaidCode,
      (record as any).voucherCodesText,
      (record as any).qrCode,
      (record as any).serialNumber
    ];
    for (const raw of candidates) {
      if (raw === undefined || raw === null) continue;
      const first = String(raw).split(/[\n,;\s]+/)[0];
      const clean = cleanVoucherCodeValue(first).toUpperCase();
      if (
        clean &&
        clean !== "-" &&
        clean !== "CANCELLED" &&
        clean !== "PENDING" &&
        clean !== "BLOCKED" &&
        clean !== "N/A"
      ) {
        return clean;
      }
    }
    return "";
  }, [record]);

  // Codes currently allocated to THIS record via vouchersDatabase VRM match.
  // Mirrors DispatchCentre's getRowVoucherStats: a voucher counts as "assigned to
  // this permit" when its VRM matches the record's VRM inside the date window.
  const allocatedCodesForThisRecord = useMemo(() => {
    const set = new Set<string>();
    if (!record || !vouchersDatabase?.length) return set;

    const recordVrmClean = (record.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!recordVrmClean) return set;

    const fromIso = parseDateToISO(record.dateRequired || record.validFrom || "") || "";
    if (!fromIso) return set;
    const toIso = record.validTo
      ? (parseDateToISO(record.validTo) || "")
      : (record.dateExpiry
        ? (parseDateToISO(record.dateExpiry) || "")
        : addDays(fromIso, 6));

    vouchersDatabase.forEach(v => {
      if (!v || !v.code) return;
      const vVrmClean = (v.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!vVrmClean || vVrmClean !== recordVrmClean) return;
      if (!isVoucherForPermitDateRange(v, fromIso, toIso)) return;
      const clean = cleanVoucherCodeValue(v.code).toUpperCase();
      if (
        clean &&
        clean !== "-" &&
        clean !== "CANCELLED" &&
        clean !== "PENDING" &&
        clean !== "BLOCKED" &&
        clean !== "N/A"
      ) {
        set.add(clean);
      }
    });

    return set;
  }, [record, vouchersDatabase]);

  // ⭐ Canonical resolved voucher code with priority:
  // (a) resolvedVoucherCode prop passed from caller
  // (b) any real code found in record's own fields (voucherCode, prePaidCode, etc.)
  // (c) VRM+date-matched voucher from vouchersDatabase
  const canonicalRecordCode = useMemo(() => {
    // (a) resolvedVoucherCode prop
    if (resolvedVoucherCode) {
      const cleanProp = cleanVoucherCodeValue(resolvedVoucherCode).trim().toUpperCase();
      if (
        cleanProp &&
        cleanProp !== "-" &&
        cleanProp !== "CANCELLED" &&
        cleanProp !== "PENDING" &&
        cleanProp !== "BLOCKED" &&
        cleanProp !== "N/A"
      ) {
        return cleanProp;
      }
    }

    // (b) Any real code found on record itself
    if (resolvedRecordCode) {
      return resolvedRecordCode;
    }

    // (c) VRM+date-matched voucher from vouchersDatabase
    if (allocatedCodesForThisRecord.size > 0) {
      return Array.from(allocatedCodesForThisRecord)[0];
    }

    return "";
  }, [resolvedVoucherCode, resolvedRecordCode, allocatedCodesForThisRecord]);

  // Set of voucher codes already assigned to other records in database
  const assignedCodesInOtherRecords = useMemo(() => {
    const set = new Set<string>();
    if (!database?.length) return set;

    const codeFields = [
      "voucherCode", "prePaidCode", "qrCode", "voucherCodesText", "serialNumber",
      "voucher", "code", "qrOverride", "Voucher Code", "VOUCHER CODE",
      "Pre-Paid Code", "Pre Paid Code", "QR Code", "QR CODE"
    ];

    database.forEach((r) => {
      if (!r) return;
      // Skip the record currently being edited so its own code isn't blocked
      if (record) {
        const id1 = String(r.id ?? "").trim();
        const formId1 = String(r.formId ?? "").trim();
        const id2 = String(record.id ?? "").trim();
        const formId2 = String(record.formId ?? "").trim();
        if (id1 || formId1 || id2 || formId2) {
          if (
            (id1 && id2 && id1 === id2) ||
            (formId1 && formId2 && formId1 === formId2) ||
            (id1 && formId2 && id1 === formId2) ||
            (formId1 && id2 && formId1 === id2)
          ) {
            return;
          }
        } else {
          const vrm1 = (r.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const vrm2 = (record.vrm || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (vrm1 && vrm2 && vrm1 === vrm2) {
            const d1 = parseDateToISO(r.validFrom || r.dateRequired) || "";
            const d2 = parseDateToISO(record.validFrom || record.dateRequired) || "";
            if (d1 && d2 && d1 === d2) return;
          }
        }
      }

      codeFields.forEach((field) => {
        const raw = (r as any)[field];
        if (raw !== undefined && raw !== null) {
          String(raw)
            .split(/[\n,;\s]+/)
            .forEach((part) => {
              const clean = cleanVoucherCodeValue(part).toUpperCase();
              if (clean && clean !== "-" && clean !== "CANCELLED" && clean !== "PENDING" && clean !== "BLOCKED") {
                set.add(clean);
              }
            });
        }
      });
    });

    return set;
  }, [database, record]);

  // Options list: filter vouchersDatabase by date range and exclude already-used/cancelled/pending/assigned codes
  const activeDateCodes = useMemo(() => {
    if (!formDateRequired || !vouchersDatabase?.length) return [];
    const currentVoucherCode = formVoucherCode.trim().toUpperCase();
    const underlyingCode = canonicalRecordCode;

    return vouchersDatabase.filter(v => {
      if (!isVoucherForPermitDateRange(v, formDateRequired, formDateExpiry || formDateRequired)) return false;
      if (v.isUsed === true || v.status === "used" || v.status === "dispatched") return false;
      const codeUpper = cleanVoucherCodeValue(v.code).toUpperCase();
      if (!codeUpper || codeUpper === "-" || codeUpper === "CANCELLED" || codeUpper === "PENDING") return false;

      // Exclude whatever code is currently sitting in the Voucher Code field —
      // once it's in that field (typed or picked), it shouldn't also appear as a pickable option here
      if (currentVoucherCode && codeUpper === currentVoucherCode) return false;

      // ⭐ Exclude the record's true underlying canonical code
      if (underlyingCode && codeUpper === underlyingCode) return false;

      // Exclude codes already allocated to this record's VRM in its date window
      if (allocatedCodesForThisRecord.has(codeUpper)) return false;

      // Exclude codes that are already assigned to another permit in database
      if (assignedCodesInOtherRecords.has(codeUpper)) return false;

      return true;
    });
  }, [
    vouchersDatabase,
    formDateRequired,
    formDateExpiry,
    assignedCodesInOtherRecords,
    formVoucherCode,
    canonicalRecordCode,
    allocatedCodesForThisRecord
  ]);

  // Code assignment check
  const codeFields = [
    "voucherCode", "prePaidCode", "qrCode", "voucherCodesText", "serialNumber",
    "voucher", "code", "qrOverride", "Voucher Code", "VOUCHER CODE",
    "Pre-Paid Code", "Pre Paid Code", "QR Code", "QR CODE"
  ];

  const isCodeAssigned = (rec: any, selectedCode: string) => {
    if (!rec) return false;
    return codeFields.some((field) => {
      const raw = rec[field];
      if (raw === undefined || raw === null) return false;
      return String(raw)
        .split(/[\n,;\s]+/)
        .map((part) => cleanVoucherCodeValue(part).toUpperCase())
        .some((code) => code && code !== "-" && isVoucherCodeMatch(code, selectedCode));
    });
  };

  const handleActiveDateCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedCode = cleanVoucherCodeValue(e.target.value).toUpperCase();
    if (!selectedCode || selectedCode === "-" || selectedCode === "CANCELLED") return;

    if (assignedCodesInOtherRecords.has(selectedCode)) {
      console.warn(`Voucher ${selectedCode} is already assigned and cannot be reused.`);
      return;
    }

    setFormVoucherCode(selectedCode);
    setFormStatus("PENDING"); // matches the header's status: "Pending" reset on reassignment
  };

  // Populate form fields whenever `record` changes or modal opens
  useEffect(() => {
    if (record && isOpen) {
      setFormVrm(record.vrm ? record.vrm.toUpperCase() : "");
      setFormDriverName(record.driverName || record.name || "");
      setFormPhone(formatPhoneNumber(record.phone || ""));
      setFormEmail(record.email || record.driverEmail || "");
      setFormHospital(record.hospital || record.site || "Whipps Cross Hospital");
      setFormWard(record.ward || "");
      
      const reqDateIso = parseDateToISO(record.dateRequired || record.validFrom || "") || "";
      setFormDateRequired(reqDateIso);
      
      const expDateIso = record.validTo 
        ? (parseDateToISO(record.validTo) || "")
        : (record.dateExpiry 
          ? (parseDateToISO(record.dateExpiry) || "")
          : (reqDateIso ? addDays(reqDateIso, 6) : ""));
      setFormDateExpiry(expDateIso);

      // ⭐ Use canonical code (priority: resolvedVoucherCode -> record field -> VRM allocation),
      // falling back to "-" only if canonical code is truly empty
      const codeToShow = canonicalRecordCode || "-";
      setFormVoucherCode(codeToShow === "CANCELLED" ? "-" : codeToShow);

      let initialStatus = "PENDING";
      if (record.isCancelled || (record.status && record.status.toUpperCase() === "CANCELLED")) {
        initialStatus = "CANCELLED";
      } else if (record.status) {
        const sUpper = record.status.toUpperCase();
        if (sUpper === "SENT" || sUpper === "DISPATCHED") initialStatus = "SENT";
        else if (sUpper === "UNSENT") initialStatus = "UNSENT";
        else if (sUpper === "CANCELLED") initialStatus = "CANCELLED";
        else initialStatus = "PENDING";
      }
      setFormStatus(initialStatus);
    }
  }, [record, isOpen, canonicalRecordCode]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !record) return null;

  const handleDateRequiredChange = (newDate: string) => {
    setFormDateRequired(newDate);
    if (newDate) {
      // Automatically keep expiry synced to 6 days after date required
      setFormDateExpiry(addDays(newDate, 6));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;

    const trimmedVrm = formVrm.trim().toUpperCase();
    const cleanVoucher = formVoucherCode.trim().toUpperCase() || "-";

    const updatedRecord: CsvPermitRecord = {
      ...record,
      vrm: trimmedVrm,
      driverName: formDriverName.trim(),
      name: formDriverName.trim(),
      phone: formPhone.trim(),
      email: formEmail.trim().toLowerCase(),
      driverEmail: formEmail.trim().toLowerCase(),
      hospital: formHospital.trim(),
      site: formHospital.trim(),
      ward: formWard.trim(),
      dateRequired: formDateRequired,
      validFrom: formDateRequired,
      validTo: formDateExpiry || (formDateRequired ? addDays(formDateRequired, 6) : ""),
      dateExpiry: formDateExpiry || (formDateRequired ? addDays(formDateRequired, 6) : ""),
      voucherCode: cleanVoucher,
      prePaidCode: cleanVoucher,
      voucherCodesText: cleanVoucher,
      status: formStatus,
      isCancelled: formStatus === "CANCELLED",
      isDispatched: formStatus === "SENT"
    };

    onSave(updatedRecord);
  };

  const formIdDisplay = record.formId !== undefined && record.formId !== null && record.formId !== ""
    ? String(record.formId)
    : (record.id ? String(record.id) : "-");

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-permit-modal-title"
    >
      <div 
        className="relative w-full max-w-2xl bg-white dark:bg-[#0d2137] rounded-xl shadow-2xl border border-slate-200 dark:border-[#1e3a5f] overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-[#193555] bg-slate-50 dark:bg-[#0b1c2f]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-base">
              ✏️
            </div>
            <div>
              <h2 id="edit-permit-modal-title" className="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2">
                Edit Permit Record
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-semibold">
                  ID: #{formIdDisplay}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Update permit details. Edited records are preserved across file uploads.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* VRM Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5 text-slate-400" />
                Vehicle Registration (VRM) *
              </label>
              <input
                type="text"
                required
                value={formVrm}
                onChange={(e) => setFormVrm(e.target.value.toUpperCase())}
                placeholder="e.g. LD68 UTX"
                className="w-full px-3 py-2 text-sm font-mono font-bold uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 tracking-wider"
              />
            </div>

            {/* Driver Name Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Driver Name
              </label>
              <input
                type="text"
                value={formDriverName}
                onChange={(e) => setFormDriverName(e.target.value)}
                placeholder="Full name"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Phone Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                Phone Number
              </label>
              <input
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="e.g. 07700 900077"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Email Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Email Address
              </label>
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="driver@example.com"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Hospital Site Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                Hospital Site
              </label>
              <select
                value={formHospital}
                onChange={(e) => setFormHospital(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {HOSPITAL_SITES.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
                {!HOSPITAL_SITES.includes(formHospital as any) && formHospital && (
                  <option value={formHospital}>{formHospital}</option>
                )}
              </select>
            </div>

            {/* Ward Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                Ward / Department
              </label>
              <input
                type="text"
                value={formWard}
                onChange={(e) => setFormWard(e.target.value)}
                placeholder="Ward name"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date Required (From) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Date Required (Valid From) *
              </label>
              <input
                type="date"
                required
                value={formDateRequired}
                onChange={(e) => handleDateRequiredChange(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date Expiry (To) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Expiry Date (Valid To)
              </label>
              <input
                type="date"
                value={formDateExpiry}
                onChange={(e) => setFormDateExpiry(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Voucher Code */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                Voucher Code
              </label>
              <input
                type="text"
                value={formVoucherCode}
                onChange={(e) => setFormVoucherCode(e.target.value.toUpperCase())}
                placeholder="e.g. 5X7B-9Q2M or -"
                className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Active Date Codes Dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                Active Date Codes ({activeDateCodes.length})
              </label>
              <select
                value={activeDateCodes.some(v => cleanVoucherCodeValue(v.code).toUpperCase() === formVoucherCode) ? formVoucherCode : ""}
                onChange={handleActiveDateCodeChange}
                disabled={activeDateCodes.length === 0}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#071728] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">
                  {activeDateCodes.length === 0 ? "No active codes for this date" : "-- Choose Code --"}
                </option>
                {activeDateCodes.map((v, i) => (
                  <option key={`${v.code}_${i}`} value={cleanVoucherCodeValue(v.code).toUpperCase()}>
                    {cleanVoucherCodeValue(v.code).toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-[#193555]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}