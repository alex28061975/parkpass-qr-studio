import React, { useEffect } from "react";
import { AlertTriangle, X, ShieldAlert, Calendar } from "lucide-react";
import type { VoucherValidationError } from "../utils/voucherValidation";

interface VoucherImportBlockedModalProps {
  isOpen: boolean;
  onClose: () => void;
  errors: VoucherValidationError[];
  fileName?: string;
}

export function VoucherImportBlockedModal({
  isOpen,
  onClose,
  errors,
  fileName
}: VoucherImportBlockedModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || errors.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voucher-blocked-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="w-full max-w-3xl bg-white dark:bg-[#0c182b] border border-amber-400/80 dark:border-amber-600/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-amber-500/10 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800/80 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-400/40">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 
                id="voucher-blocked-title"
                className="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"
              >
                <span>⚠️ Import Blocked: Found invalid voucher date ranges!</span>
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                Every row must have <span className="font-semibold text-amber-700 dark:text-amber-300 font-mono">VALIDFROM</span> and <span className="font-semibold text-amber-700 dark:text-amber-300 font-mono">VALIDTO</span> with a duration of exactly 6 days (7 days inclusive, e.g. 05/06/2026 to 11/06/2026).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition shrink-0 ml-2"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File & Error Summary Banner */}
        <div className="bg-rose-50/70 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900/40 px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>
              Upload aborted: <strong className="font-bold">{errors.length}</strong> {errors.length === 1 ? "row failed" : "rows failed"} pre-import validation.
            </span>
          </div>
          {fileName && (
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
              <Calendar className="w-3.5 h-3.5" />
              <span>{fileName}</span>
            </div>
          )}
        </div>

        {/* Errors Table */}
        <div className="p-6 overflow-y-auto flex-1">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs uppercase tracking-wider">
                  <th className="py-2.5 px-3.5 w-20 text-center">Row</th>
                  <th className="py-2.5 px-3.5">Voucher Code</th>
                  <th className="py-2.5 px-3.5">Valid From</th>
                  <th className="py-2.5 px-3.5">Valid To</th>
                  <th className="py-2.5 px-3.5">Validation Issue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-[#0c182b]">
                {errors.map((err, idx) => (
                  <tr 
                    key={`voucher_err_${err.rowNumber}_${idx}`}
                    className="hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors"
                  >
                    <td className="py-2 px-3.5 text-center font-mono font-bold text-slate-600 dark:text-slate-400">
                      Row {err.rowNumber}
                    </td>
                    <td className="py-2 px-3.5 font-mono font-bold text-amber-900 dark:text-amber-200 select-all">
                      {err.code || "-"}
                    </td>
                    <td className="py-2 px-3.5 font-mono text-slate-700 dark:text-slate-300">
                      {err.validFrom ? (
                        err.validFrom
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          Empty
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3.5 font-mono text-slate-700 dark:text-slate-300">
                      {err.validTo ? (
                        err.validTo
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          Empty
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3.5 text-rose-600 dark:text-rose-400 font-medium">
                      {err.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fix the date values in the CSV and upload again.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition"
          >
            Close & Review CSV
          </button>
        </div>
      </div>
    </div>
  );
}
