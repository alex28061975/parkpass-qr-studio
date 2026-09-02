import React from "react";
import { ListFilter } from "lucide-react";
import { 
  CsvPermitRecord, 
  ParsedVoucherData, 
  parseDateToISO, 
  addDays, 
  getTodayISO,
  getSpreadsheetMatchingAllocationsMap,
  isRecordCancelled,
  isVoucherExactPeriodEligible,
  getRequestedPermitDateISO
} from "../utils/csvParser";
import { checkIsRecordDispatched } from "../utils/dispatchUtils";

export interface PermitMatchingTableProps {
  matchingPermits: CsvPermitRecord[];
  processingDate?: string;
  vouchersDatabase?: ParsedVoucherData[];
  dispatchedKeys?: string[];
  unsentKeys?: string[];
  dispatchBy?: Record<string, string>;
  database?: CsvPermitRecord[];
  onSelectRecord?: (record: CsvPermitRecord) => void;
}

export function PermitMatchingTable({
  matchingPermits,
  processingDate = "",
  vouchersDatabase = [],
  dispatchedKeys = [],
  unsentKeys = [],
  dispatchBy = {},
  database = [],
  onSelectRecord
}: PermitMatchingTableProps) {
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

  const toTitleCase = (str?: string) => {
    if (!str) return "";
    return str
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Sort matching permits by Form ID ASCENDING (OLDEST first = ORIGINAL/VALID first)
  const sortedMatchingPermits = React.useMemo(() => {
    return [...matchingPermits].sort((a, b) => {
      const aId = Number(String(a.formId ?? a.id ?? 0).replace(/[^0-9]/g, "")) || 0;
      const bId = Number(String(b.formId ?? b.id ?? 0).replace(/[^0-9]/g, "")) || 0;
      return aId - bId;
    });
  }, [matchingPermits]);

  // Always resolve duplicate checks against the FULL original parsed dataset
  // (unique row ids attached at import time) rather than the locally
  // re-sorted table view, so index/id-based tiebreaking stays accurate.
  const effectiveDatabase = database.length > 0 ? database : sortedMatchingPermits;

  const activeFromISO = parseDateToISO(processingDate);
  const activeVouchers = React.useMemo(() => {
    if (!activeFromISO || !vouchersDatabase || vouchersDatabase.length === 0) {
      return [];
    }
    return vouchersDatabase.filter(v => isVoucherExactPeriodEligible(v, activeFromISO));
  }, [activeFromISO, vouchersDatabase]);
  const matchingVouchersCount = activeVouchers.length;

  // Auto-Assign QR Voucher Code to Unblocked Baseline Records:
  // Pre-calculate allocated codes across sortedMatchingPermits so valid records missing a code get the next available active date code
  const recordCodeMap = React.useMemo(() => {
    return getSpreadsheetMatchingAllocationsMap(
      sortedMatchingPermits,
      database,
      processingDate,
      vouchersDatabase
    );
  }, [sortedMatchingPermits, database, processingDate, vouchersDatabase]);

  return (
    <div className="pt-3 border-t border-gray-100 dark:border-slate-800 space-y-2.5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <label className="text-xs font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
          <ListFilter className="w-3.5 h-3.5 text-[#005EB8] dark:text-blue-400" />
          <span>Spreadsheet Permits Matching Helper</span>
        </label>
        {processingDate && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
              Processing Date: {formatDate(processingDate)}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              sortedMatchingPermits.length > 0 
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
            }`}>
              {sortedMatchingPermits.length} {sortedMatchingPermits.length === 1 ? "match" : "matches"}
            </span>
            {vouchersDatabase.length > 0 && processingDate && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/35 text-teal-600 dark:text-teal-400">
                {matchingVouchersCount} {matchingVouchersCount === 1 ? "code match" : "code matches"}
              </span>
            )}
          </div>
        )}
      </div>

      {!processingDate ? (
        <div className="text-center py-4 px-3 border border-dashed border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50/50 dark:bg-slate-950/10 text-gray-400 dark:text-slate-500 text-xs flex flex-col items-center justify-center gap-1">
          <span>Select a date above to search matching records.</span>
        </div>
      ) : sortedMatchingPermits.length === 0 ? (
        <div className="text-center py-5 px-3 border border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50/30 dark:bg-slate-950/10 text-gray-400 dark:text-slate-500 text-xs flex flex-col items-center justify-center gap-1">
          <span>No permits found for this date.</span>
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-xs bg-white dark:bg-slate-950">
          <div className="max-h-[220px] overflow-x-auto overflow-y-auto w-full">
            <table className="min-w-[760px] w-full text-xs text-left border-collapse table-auto">
              <thead className="bg-gray-100/90 dark:bg-slate-900 text-gray-700 dark:text-slate-300 font-bold uppercase tracking-wider sticky top-0 border-b border-gray-200 dark:border-slate-800 z-10 text-[10px]">
                <tr>
                  <th scope="col" className="py-2.5 px-3 text-center whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Status</th>
                  <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Driver's Name</th>
                  <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">VRM Plate</th>
                  <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">QR Code</th>
                  <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Department</th>
                  <th scope="col" className="py-2.5 px-3 whitespace-nowrap border-r border-gray-200/60 dark:border-slate-800/60">Valid From</th>
                  <th scope="col" className="py-2.5 px-3 whitespace-nowrap">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-150 dark:divide-slate-800/80">
                {sortedMatchingPermits.map((record, index) => {
                  const recordIso = parseDateToISO(record.dateRequired);
                  const expiresIso = addDays(recordIso, 6);
                  
                  const validFromISO = parseDateToISO(record.validFrom || record.dateRequired);
                  const refDateISO = parseDateToISO(processingDate) || parseDateToISO(record.todayDate) || getTodayISO();
                  const daysActive = validFromISO ? Math.round((new Date(refDateISO).getTime() - new Date(validFromISO).getTime()) / (1000 * 60 * 60 * 24)) : 0;
                  
                  // Canonical isRecordCancelled check
                  const recRequestedDate = getRequestedPermitDateISO(record, processingDate);
                  const isCancelled = isRecordCancelled(record, recRequestedDate, effectiveDatabase);
                  const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);

                  // Get Form ID for display
                  const numId = Number(String(record.formId ?? record.id ?? 0).replace(/[^0-9]/g, "")) || 0;

                  const permitStatus = isDispatched ? '✓ Sent' : 'Pending';

                  // Determine QR Code display STRICTLY from recordCodeMap
                  const recordKey = String(record.formId ?? record.id ?? index);
                  
                  // Get the code from the map (which has been computed dynamically)
                  let displayCode = recordCodeMap.get(recordKey);
                  
                  if (isCancelled) {
                    displayCode = "CANCELLED";
                  } else if (displayCode === undefined || displayCode === null || displayCode === "CANCELLED") {
                    const rawCode = (record.voucherCode || "").trim();
                    displayCode = (rawCode && rawCode.toUpperCase() !== "CANCELLED") ? rawCode : "-";
                  }
                  
                  const isInvalid = isCancelled;

                  const hasValidVoucher = Boolean(
                    displayCode &&
                    displayCode !== "-" &&
                    displayCode.trim() !== "" &&
                    !isInvalid
                  );

                  return (
                    <tr 
                      key={`match_${record.id || index}_${index}`}
                      className="text-gray-700 dark:text-slate-300"
                    >
                      <td 
                        className="py-2.5 px-3 text-center whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 select-none"
                      >
                        {isInvalid ? (
                          <span 
                            className="inline-flex items-center gap-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-900/40 select-none"
                            title="Status: Cancelled (Display only)"
                          >
                            <span>CANCELLED</span>
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
                            className="inline-flex items-center gap-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900/40 select-none"
                            title="Status: Pending (Display only)"
                          >
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-semibold text-gray-900 dark:text-slate-100">
                        {record.driverName ? toTitleCase(record.driverName) : "-"}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60">
                        <span className="font-mono font-extrabold bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800/60 text-amber-950 dark:text-amber-300 px-2 py-0.5 rounded text-[11px] uppercase tracking-wider inline-block">
                          {record.vrm ? record.vrm.toUpperCase() : "-"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-mono">
                        {isInvalid ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300">
                            CANCELLED
                          </span>
                        ) : hasValidVoucher ? (
                          <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-300 text-[11px] bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/50">
                            {displayCode}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500 font-mono font-medium text-[11px]">
                            {displayCode}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-medium text-gray-700 dark:text-slate-300">
                        {record.ward ? toTitleCase(record.ward) : (record.department ? toTitleCase(record.department) : "-")}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap border-r border-gray-150/60 dark:border-slate-800/60 font-mono text-gray-700 dark:text-slate-300">
                        {formatDate(record.dateRequired)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono text-gray-700 dark:text-slate-300">
                        {formatDate(expiresIso)}
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
  );
}