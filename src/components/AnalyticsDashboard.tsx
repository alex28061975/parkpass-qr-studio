import React, { useState, useRef } from "react";
import { 
  CsvPermitRecord, 
  ParsedVoucherData, 
  parseDateToISO, 
  addDays,
  cleanVoucherCodeValue,
  isRecordCancelled
} from "../utils/csvParser";
import { checkIsRecordDispatched } from "../utils/dispatchUtils";
import { 
  TrendingUp, 
  Database, 
  CheckCircle, 
  Clock, 
  Building, 
  Award, 
  Inbox, 
  ArrowRight,
  ShieldAlert,
  HelpCircle,
  BarChart3,
  Cloud,
  HardDrive,
  RefreshCw,
  Server,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Lock
} from "lucide-react";

// Helper to format string to Title Case (capitalize each word)
function toTitleCase(str: string): string {
  if (!str || str === "-") return str;
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

interface AnalyticsDashboardProps {
  database: CsvPermitRecord[];
  vouchersDatabase: ParsedVoucherData[];
  dispatchedKeys: string[];
  unsentKeys?: string[];
  dispatchDates: { [key: string]: string };
  onSelectWard: (wardName: string) => void;
  onSelectSite?: (siteName: string) => void;
  storageMode?: "cloud" | "offline";
  onToggleStorageMode?: () => void;
  isSyncing?: boolean;
  onSyncNow?: () => void;
  totalRecordsCount?: number;
}

export function AnalyticsDashboard({
  database,
  vouchersDatabase,
  dispatchedKeys,
  unsentKeys = [],
  dispatchDates,
  onSelectWard,
  onSelectSite,
  storageMode = "cloud",
  onToggleStorageMode,
  isSyncing = false,
  onSyncNow,
  totalRecordsCount
}: AnalyticsDashboardProps) {
  // Secret multi-click admin panel trigger
  const [showAdminSyncPanel, setShowAdminSyncPanel] = useState<boolean>(false);
  const clickCountRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSecretHeaderClick = () => {
    clickCountRef.current += 1;
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }

    if (clickCountRef.current >= 5) {
      setShowAdminSyncPanel((prev) => !prev);
      clickCountRef.current = 0;
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 1500);
    }
  };

  const isCloudMode = storageMode === "cloud";
  const recordsCount = totalRecordsCount !== undefined ? totalRecordsCount : database.length;

  
  // Helper to format Date to ISO String YYYY-MM-DD
  const getTodayISO = (): string => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayISO = getTodayISO();
  const dailyTarget = 10;

  // Site Comparative Metrics
  let whippsTotal = 0;
  let whippsActive = 0;
  let whippsExpired = 0;
  let whippsDispatched = 0;

  let newhamTotal = 0;
  let newhamActive = 0;
  let newhamExpired = 0;
  let newhamDispatched = 0;

  let otherTotal = 0;
  let otherActive = 0;
  let otherExpired = 0;
  let otherDispatched = 0;

  database.forEach(record => {
    const rawHospital = (record.hospital || "").toLowerCase();
    const isWhipps = rawHospital.includes("whipps") || rawHospital.includes("wipps") || rawHospital.includes("cross");
    const isNewham = rawHospital.includes("newham");

    // Expiry check
    const recordIso = parseDateToISO(record.dateRequired);
    const daysActive = recordIso ? Math.round((new Date(todayISO).getTime() - new Date(recordIso).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const isExpired = recordIso ? daysActive >= 7 : false;

    // Dispatch check
    const isDispatched = checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);

    if (isWhipps) {
      whippsTotal++;
      if (isExpired) whippsExpired++; else whippsActive++;
      if (isDispatched) whippsDispatched++;
    } else if (isNewham) {
      newhamTotal++;
      if (isExpired) newhamExpired++; else newhamActive++;
      if (isDispatched) newhamDispatched++;
    } else {
      otherTotal++;
      if (isExpired) otherExpired++; else otherActive++;
      if (isDispatched) otherDispatched++;
    }
  });

  // 6. Recent dispatches details
  // Let's reconstruct list of recently dispatched records
  const dispatchedRecords = database.filter(record => {
    return checkIsRecordDispatched(record, record.vrm, record.driverName, record.dateRequired, dispatchedKeys, unsentKeys);
  }).map(record => {
    const signature = `${record.driverName || ""}_${record.vrm || ""}_${parseDateToISO(record.dateRequired) || ""}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const dateOfDispatch = (record.id && dispatchDates[record.id]) || (record.formId && dispatchDates[String(record.formId)]) || dispatchDates[signature] || todayISO;
    return {
      ...record,
      dispatchDate: dateOfDispatch
    };
  }).sort((a, b) => b.dispatchDate.localeCompare(a.dispatchDate));

  // 1. Total Dispatched Today (progress ring towards target)
  const dispatchedTodayCount = dispatchedRecords.filter(record => {
    const dDate = record.dispatchDate || todayISO;
    return dDate === todayISO;
  }).length;
  const percentage = Math.min((dispatchedTodayCount / dailyTarget) * 100, 100);

  // 2. Active vs. Expired Ratio
  let activeCount = 0;
  let expiredCount = 0;
  database.forEach(p => {
    const recordIso = parseDateToISO(p.dateRequired);
    const daysActive = recordIso ? Math.round((new Date(todayISO).getTime() - new Date(recordIso).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const isExpired = recordIso ? daysActive >= 7 : false;
    if (isExpired) {
      expiredCount++;
    } else {
      activeCount++;
    }
  });

  // 3. Wards distribution & frequency
  const wardCounts: { [ward: string]: number } = {};
  database.forEach(record => {
    const ward = record.ward ? toTitleCase(record.ward.trim()) : "General/Unknown";
    wardCounts[ward] = (wardCounts[ward] || 0) + 1;
  });
  const sortedWards = Object.entries(wardCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const topWards = sortedWards.slice(0, 8);

  // 4. Site distribution
  const siteCounts: { [site: string]: number } = {};
  database.forEach(record => {
    const site = record.hospital ? toTitleCase(record.hospital.trim()) : "Main Site";
    siteCounts[site] = (siteCounts[site] || 0) + 1;
  });
  const siteDistribution = Object.entries(siteCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 5. Voucher Pool Inventory Calculations
  // Total vouchers uploaded
  const totalVouchers = vouchersDatabase.length;
  // Count of unique dispatched permit records
  const totalDispatched = dispatchedRecords.length;
  
  // Track all unique voucher codes currently assigned to active (non-cancelled) records
  const assignedVouchersSet = new Set<string>();
  database.forEach(r => {
    if (r.voucherCode === "CANCELLED" || r.isCancelled === true || isRecordCancelled(r, r.dateRequired || "", database)) return;
    const raw = r.voucherCode || r.prePaidCode || r.qrCode || r.serialNumber;
    if (raw && raw !== "-" && raw !== "CANCELLED" && raw !== "PENDING") {
      const clean = cleanVoucherCodeValue(raw).toUpperCase();
      if (clean && clean !== "-" && clean !== "CANCELLED") {
        assignedVouchersSet.add(clean);
      }
    }
  });
  const totalAssignedVouchers = assignedVouchersSet.size;
  const vouchersRemaining = Math.max(totalVouchers - totalAssignedVouchers, 0);

  return (
    <div className="space-y-6 animate-fade-in select-none">
      
      {/* Top Section Header with Secret Admin Click Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-1 border-b border-slate-200/60 dark:border-slate-800/60">
        <div>
          <h2 
            onClick={handleSecretHeaderClick}
            className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2 cursor-pointer select-none hover:text-[#005EB8] dark:hover:text-sky-400 transition-colors"
            title="Daily Operations & Concessions Overview"
          >
            <BarChart3 className="w-5 h-5 text-[#005EB8] dark:text-sky-400" />
            <span>Daily Concessions Analytics</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Operational dashboard tracking permits, vouchers, and active hospital queues.
          </p>
        </div>

        {showAdminSyncPanel && (
          <button
            type="button"
            onClick={() => setShowAdminSyncPanel(false)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800/60 self-start sm:self-auto cursor-pointer"
          >
            <Lock className="w-3 h-3" />
            <span>Hide Admin Panel</span>
          </button>
        )}
      </div>

      {/* Secret Admin Database & Sync Settings Card */}
      {showAdminSyncPanel && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-950 text-white rounded-xl border border-slate-700/80 p-4 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Left: Info & Mode Description */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-sky-400 shrink-0" />
                <h3 className="text-sm font-bold text-slate-100 tracking-wide flex items-center gap-2">
                  <span>Admin Database &amp; Sync Settings</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/50">
                    Unlocked
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Configure data persistence layer and synchronize local dispatch records with Supabase cloud.
              </p>
            </div>

            {/* Right: Controls & Status */}
            <div className="flex flex-wrap items-center gap-2.5">
              
              {/* Storage Mode Toggle Pill */}
              {onToggleStorageMode && (
                <div className="flex items-center gap-1 bg-slate-800/90 p-1 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isCloudMode) onToggleStorageMode();
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      isCloudMode
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    <span>Cloud Mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (isCloudMode) onToggleStorageMode();
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      !isCloudMode
                        ? "bg-amber-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Offline Mode</span>
                  </button>
                </div>
              )}

              {/* Status Badge */}
              {isCloudMode ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Cloud Connected</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-800/60">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  <span>Offline Local Mode</span>
                </span>
              )}

              {/* Sync Now Button */}
              {isCloudMode && onSyncNow && (
                <button
                  type="button"
                  onClick={onSyncNow}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#005EB8] hover:bg-[#004d99] text-white cursor-pointer shadow-xs disabled:opacity-50 transition-all border border-blue-400/30"
                  title="Force immediate database sync"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
                </button>
              )}
            </div>

          </div>

          {/* Quick Metrics Footer Readout */}
          <div className="mt-3 pt-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono">
            <div className="flex items-center gap-3">
              <span>Permit Records: <strong className="text-slate-200">{recordsCount}</strong></span>
              <span>•</span>
              <span>Dispatched Permits: <strong className="text-slate-200">{dispatchedRecords.length}</strong></span>
              <span>•</span>
              <span>Voucher Pool: <strong className="text-slate-200">{vouchersDatabase.length}</strong></span>
            </div>
            <div className="text-slate-500">
              Auto-re-sync on reconnect active • Auto-locks on navigation
            </div>
          </div>
        </div>
      )}
      
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* KPI 1: Daily Target Progress */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="26"
                stroke="currentColor"
                strokeWidth="5"
                className="text-slate-100 dark:text-slate-800"
                fill="transparent"
              />
              <circle
                cx="32"
                cy="32"
                r="26"
                stroke="currentColor"
                strokeWidth="5"
                className="text-blue-600 dark:text-blue-500 transition-all duration-500"
                strokeDasharray={2 * Math.PI * 26}
                strokeDashoffset={2 * Math.PI * 26 * (1 - percentage / 100)}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>
            <span className="absolute text-xs font-black font-mono text-slate-800 dark:text-slate-200">
              {dispatchedTodayCount}
            </span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Today's Dispatches
            </span>
            <span className="text-xl font-extrabold text-slate-900 dark:text-white leading-none block font-mono">
              {percentage.toFixed(0)}%
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block leading-none">
              Target: {dispatchedTodayCount} / {dailyTarget} completed
            </span>
          </div>
        </div>

        {/* KPI 2: Permit Active/Expired Queue */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between min-h-[80px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Concessions Queue Status
            </span>
            <Database className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-extrabold text-slate-900 dark:text-white font-mono leading-none">
                {database.length}
              </span>
              <span className="text-[10px] text-slate-400"> Total Records</span>
            </div>
            
            {/* Split Progress Bar */}
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${database.length > 0 ? (activeCount / database.length) * 100 : 50}%` }}
                className="bg-emerald-500 h-full transition-all duration-500"
              />
              <div
                style={{ width: `${database.length > 0 ? (expiredCount / database.length) * 100 : 50}%` }}
                className="bg-amber-500 h-full transition-all duration-500"
              />
            </div>

            <div className="flex items-center justify-between text-[9px] font-bold font-mono">
              <span className="text-emerald-500 flex items-center gap-1">
                ● Active: {activeCount}
              </span>
              <span className="text-amber-500 flex items-center gap-1">
                ● Expired: {expiredCount}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Voucher Code Inventory Pool */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between min-h-[80px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Voucher Inventory Pool
            </span>
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-extrabold text-slate-900 dark:text-white font-mono leading-none">
                {vouchersRemaining}
              </span>
              <span className="text-[10px] text-slate-400">Codes Left</span>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                style={{ width: `${totalVouchers > 0 ? (vouchersRemaining / totalVouchers) * 100 : 100}%` }}
                className="bg-blue-500 h-full transition-all duration-500"
              />
            </div>
            <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
              <span>Dispatched: {totalDispatched}</span>
              <span>Total Pool: {totalVouchers}</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Hospital Site Distribution */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between min-h-[80px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Active Coverage Sites
            </span>
            <Building className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-extrabold text-slate-900 dark:text-white font-mono leading-none">
                {siteDistribution.length || 1}
              </span>
              <span className="text-[10px] text-slate-400">Hospital Sites</span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-none truncate pt-1">
              Top: <span className="font-bold">{siteDistribution[0]?.name || "Main Site"}</span> ({siteDistribution[0]?.count || database.length} records)
            </div>
            <div className="text-[9px] text-slate-400 flex items-center gap-1">
              <Award className="w-3 h-3 text-amber-500 shrink-0" />
              <span>Full active regional NHS support</span>
            </div>
          </div>
        </div>

      </div>

      {/* Hospital Sites Comparative Breakdown */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Building className="w-4 h-4 text-blue-600 dark:text-blue-500" />
              <span>Hospital Site Comparative Analysis</span>
            </h3>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">
              Compare concession loads, active/expired statuses, and QR card dispatch counts between Whipps Cross and Newham
            </p>
          </div>
          <span className="text-[9px] bg-blue-50 dark:bg-blue-950 text-[#005EB8] dark:text-blue-300 font-mono font-bold px-2.5 py-1 rounded-full border border-blue-100 dark:border-blue-900/60 self-start sm:self-auto">
            Live Site Metrics
          </span>
        </div>

        {/* 3-Column Comparative Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Column 1: Whipps Cross */}
          <div className="bg-slate-50/60 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800/60 p-4 rounded-xl space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-bold text-[#005EB8] dark:text-blue-400 uppercase tracking-widest block font-mono">
                    Barts Health NHS
                  </span>
                  <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-150">
                    Whipps Cross Hospital
                  </h4>
                </div>
                <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900/40 flex items-center justify-center text-[#005EB8] dark:text-blue-300 font-black text-[10px] font-mono shrink-0">
                  WX
                </div>
              </div>

              {/* Concession Volume KPI */}
              <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/50 dark:border-slate-800/80 flex items-baseline justify-between">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Concession Load:</span>
                <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                  {whippsTotal} <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">permits</span>
                </span>
              </div>

              {/* Sub metrics progress bar breakdowns */}
              <div className="space-y-2 text-[10px]">
                {/* Active Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-emerald-600 dark:text-emerald-400">● Active</span>
                    <span className="text-slate-600 dark:text-slate-400">{whippsActive} ({whippsTotal > 0 ? ((whippsActive/whippsTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${whippsTotal > 0 ? (whippsActive/whippsTotal)*100 : 0}%` }} className="bg-emerald-500 h-full rounded-full" />
                  </div>
                </div>

                {/* Expired Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-amber-600 dark:text-amber-400">● Expired</span>
                    <span className="text-slate-600 dark:text-slate-400">{whippsExpired} ({whippsTotal > 0 ? ((whippsExpired/whippsTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${whippsTotal > 0 ? (whippsExpired/whippsTotal)*100 : 0}%` }} className="bg-amber-500 h-full rounded-full" />
                  </div>
                </div>

                {/* Dispatched Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-blue-600 dark:text-blue-400">● Dispatched Cards</span>
                    <span className="text-slate-600 dark:text-slate-400">{whippsDispatched} ({whippsTotal > 0 ? ((whippsDispatched/whippsTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${whippsTotal > 0 ? (whippsDispatched/whippsTotal)*100 : 0}%` }} className="bg-blue-500 h-full rounded-full" />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSelectSite && onSelectSite("Whipps Cross")}
              className="w-full mt-2 bg-[#005EB8] hover:bg-[#004d99] active:scale-[0.98] text-white py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Database className="w-3 h-3" />
              <span>Filter Desk to Whipps Cross</span>
            </button>
          </div>

          {/* Column 2: Newham */}
          <div className="bg-slate-50/60 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800/60 p-4 rounded-xl space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest block font-mono">
                    Barts Health NHS
                  </span>
                  <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-150">
                    Newham University Hospital
                  </h4>
                </div>
                <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black text-[10px] font-mono shrink-0">
                  NH
                </div>
              </div>

              {/* Concession Volume KPI */}
              <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/50 dark:border-slate-800/80 flex items-baseline justify-between">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Concession Load:</span>
                <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                  {newhamTotal} <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">permits</span>
                </span>
              </div>

              {/* Sub metrics progress bar breakdowns */}
              <div className="space-y-2 text-[10px]">
                {/* Active Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-emerald-600 dark:text-emerald-400">● Active</span>
                    <span className="text-slate-600 dark:text-slate-400">{newhamActive} ({newhamTotal > 0 ? ((newhamActive/newhamTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${newhamTotal > 0 ? (newhamActive/newhamTotal)*100 : 0}%` }} className="bg-emerald-500 h-full rounded-full" />
                  </div>
                </div>

                {/* Expired Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-amber-600 dark:text-amber-400">● Expired</span>
                    <span className="text-slate-600 dark:text-slate-400">{newhamExpired} ({newhamTotal > 0 ? ((newhamExpired/newhamTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${newhamTotal > 0 ? (newhamExpired/newhamTotal)*100 : 0}%` }} className="bg-amber-500 h-full rounded-full" />
                  </div>
                </div>

                {/* Dispatched Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-blue-600 dark:text-blue-400">● Dispatched Cards</span>
                    <span className="text-slate-600 dark:text-slate-400">{newhamDispatched} ({newhamTotal > 0 ? ((newhamDispatched/newhamTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${newhamTotal > 0 ? (newhamDispatched/newhamTotal)*100 : 0}%` }} className="bg-blue-500 h-full rounded-full" />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSelectSite && onSelectSite("Newham")}
              className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Database className="w-3 h-3" />
              <span>Filter Desk to Newham</span>
            </button>
          </div>

          {/* Column 3: Others */}
          <div className="bg-slate-50/60 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800/60 p-4 rounded-xl space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block font-mono">
                    NHS Regional Care
                  </span>
                  <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-150">
                    Other Facilities &amp; Sites
                  </h4>
                </div>
                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 font-black text-[10px] font-mono shrink-0">
                  OT
                </div>
              </div>

              {/* Concession Volume KPI */}
              <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/50 dark:border-slate-800/80 flex items-baseline justify-between">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">Concession Load:</span>
                <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                  {otherTotal} <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">permits</span>
                </span>
              </div>

              {/* Sub metrics progress bar breakdowns */}
              <div className="space-y-2 text-[10px]">
                {/* Active Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-emerald-600 dark:text-emerald-400">● Active</span>
                    <span className="text-slate-600 dark:text-slate-400">{otherActive} ({otherTotal > 0 ? ((otherActive/otherTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${otherTotal > 0 ? (otherActive/otherTotal)*100 : 0}%` }} className="bg-emerald-500 h-full rounded-full" />
                  </div>
                </div>

                {/* Expired Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-amber-600 dark:text-amber-400">● Expired</span>
                    <span className="text-slate-600 dark:text-slate-400">{otherExpired} ({otherTotal > 0 ? ((otherExpired/otherTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${otherTotal > 0 ? (otherExpired/otherTotal)*100 : 0}%` }} className="bg-amber-500 h-full rounded-full" />
                  </div>
                </div>

                {/* Dispatched Metric */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold leading-none">
                    <span className="text-blue-600 dark:text-blue-400">● Dispatched Cards</span>
                    <span className="text-slate-600 dark:text-slate-400">{otherDispatched} ({otherTotal > 0 ? ((otherDispatched/otherTotal)*100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
                    <div style={{ width: `${otherTotal > 0 ? (otherDispatched/otherTotal)*100 : 0}%` }} className="bg-blue-500 h-full rounded-full" />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSelectSite && onSelectSite("")}
              className="w-full mt-2 bg-slate-600 hover:bg-slate-700 active:scale-[0.98] text-white py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Database className="w-3 h-3" />
              <span>Clear Filter / View All Sites</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Analysis Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Interactive Wards List (Left Panel - Spans 7/12) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
                <span>Ward concessions distribution</span>
              </h3>
              <p className="text-[10px] text-slate-400 leading-none mt-0.5">
                Click any ward to filter the main dispatcher list immediately
              </p>
            </div>
            <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-mono font-bold">
              {sortedWards.length} Wards
            </span>
          </div>

          <div className="p-4 flex-1">
            {topWards.length > 0 ? (
              <div className="space-y-3">
                {topWards.map((ward, i) => {
                  const maxCount = topWards[0]?.count || 1;
                  const ratio = (ward.count / maxCount) * 100;
                  const overallPercentage = database.length > 0 ? (ward.count / database.length) * 100 : 0;
                  
                  return (
                    <button
                      key={`ward_${ward.name}_${i}`}
                      type="button"
                      onClick={() => onSelectWard(ward.name)}
                      className="w-full text-left bg-slate-50 hover:bg-slate-100 dark:bg-slate-950/40 dark:hover:bg-slate-850 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50 transition-all hover:-translate-y-0.5 active:scale-[0.99] flex flex-col gap-1 cursor-pointer group"
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 group-hover:text-[#005EB8] dark:group-hover:text-blue-400 transition-colors">
                          {i + 1}. {ward.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            {ward.count} permits ({overallPercentage.toFixed(0)}%)
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-[#005EB8] dark:group-hover:text-blue-400 transition-all group-hover:translate-x-0.5" />
                        </div>
                      </div>
                      
                      {/* Visual Bar Indicator */}
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                        <div
                          style={{ width: `${ratio}%` }}
                          className={`h-full rounded-full transition-all duration-500 ${
                            i === 0 
                              ? "bg-blue-600 dark:bg-blue-500" 
                              : i === 1 
                              ? "bg-indigo-600 dark:bg-indigo-500"
                              : "bg-slate-400 dark:bg-slate-600"
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 dark:text-slate-500">
                <Inbox className="w-8 h-8 stroke-1 mb-2 text-slate-300" />
                <span className="text-xs">No concessions records loaded yet</span>
                <span className="text-[10px] text-slate-400/80 mt-1 max-w-[200px]">
                  Upload your spreadsheet permits first to view metrics
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Recent Dispatched Activity (Spans 5/12) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span>Recent Dispatches Today</span>
              </h3>
              <p className="text-[10px] text-slate-400 leading-none mt-0.5">
                Concessions printed or emailed in this session
              </p>
            </div>
            <span className="text-[9px] bg-blue-50 dark:bg-blue-900/40 text-[#005EB8] dark:text-blue-300 px-2 py-0.5 rounded-full font-mono font-bold">
              {dispatchedTodayCount} Today
            </span>
          </div>

          <div className="p-4 flex-1">
            {dispatchedRecords.length > 0 ? (
              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {dispatchedRecords.map((record, i) => {
                  const isToday = record.dispatchDate === todayISO;
                  return (
                    <div
                      key={`dispatch_${record.id || 'rec'}_${i}`}
                      className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-950 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
                          {record.driverName ? toTitleCase(record.driverName) : "No Driver Name"}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                          <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded font-mono font-bold text-slate-700 dark:text-slate-300">
                            {record.vrm}
                          </span>
                          <span>•</span>
                          <span className="truncate">{record.ward ? toTitleCase(record.ward) : "General"}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900">
                          Dispatched
                        </span>
                        <span className="block text-[8px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                          {isToday ? "Today" : record.dispatchDate}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 dark:text-slate-500 min-h-[220px]">
                <Clock className="w-8 h-8 stroke-1 mb-2 text-slate-300 animate-pulse" />
                <span className="text-xs">No dispatches logged today</span>
                <span className="text-[10px] text-slate-400/80 mt-1 max-w-[200px]">
                  Dispatch a voucher QR code from the Live Voucher Card preview to populate this activity log.
                </span>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
