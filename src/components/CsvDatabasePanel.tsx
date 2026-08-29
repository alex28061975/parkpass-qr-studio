import React, { useState, useRef, useEffect } from "react";
import { 
  CsvPermitRecord, 
  ParsedVoucherData, 
  parsePermitExcel, 
  parsePermitCsv, 
  parseVoucherFile, 
  parsePastedText, 
  parseDateToISO, 
  addDays,
  getTodayISO,
  generateNextFormId,
  sortRecordsByFormIdDesc,
  exportToExcel,
  formatPhoneNumber,
  cleanVoucherCodeValue,
  formatFormId
} from "../utils/csvParser";
import { safeLocalStorage } from "../utils/safeLocalStorage";
import { isSupabaseConfigured } from "../lib/supabase";

// Helper to format string to Title Case (capitalize each word)
function toTitleCase(str: string): string {
  if (!str || str === "-") return str;
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, (char) => char.toUpperCase());
}

const HOSPITAL_SITES = [
  "Whipps Cross Hospital",
  "Newham Hospital",
  "Royal London Hospital",
  "Mile End Hospital",
  "St Bartholomew's Hospital"
];

import { INITIAL_DEMO_CSV } from "../data/defaultCsv";
import { 
  Database, 
  Upload, 
  Check, 
  AlertCircle,
  Trash2,
  RotateCcw,
  Ticket,
  ChevronDown,
  ChevronUp,
  Search,
  Plus,
  Download,
  Table,
  X,
  RefreshCw,
  Clock,
  Calendar
} from "lucide-react";

interface CsvDatabasePanelProps {
  database: CsvPermitRecord[];
  totalRecordsCount?: number;
  onDatabaseChange: (records: CsvPermitRecord[]) => void;
  vouchersDatabase: ParsedVoucherData[];
  onVouchersDatabaseChange: (vouchers: ParsedVoucherData[]) => void;
  onSelectRecord?: (record: CsvPermitRecord) => void;
  onRefreshDatabase?: () => void;
  dispatchedKeys?: string[];
  dispatchDates?: {[key: string]: string};
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  showTable?: boolean;
  onShowTableChange?: (show: boolean) => void;
  dateRangeFilter?: '7days' | '30days' | 'all';
  onDateRangeFilterChange?: (filter: '7days' | '30days' | 'all') => void;
  isLoadingHistory?: boolean;
  processingDate?: string;
  onProcessingDateChange?: (dateISO: string) => void;
  customVouchersMap?: Record<string, string>;
}

export function CsvDatabasePanel({ 
  database, 
  totalRecordsCount,
  onDatabaseChange, 
  vouchersDatabase, 
  onVouchersDatabaseChange, 
  onSelectRecord,
  onRefreshDatabase,
  dispatchedKeys = [],
  dispatchDates = {},
  searchQuery: searchQueryProp,
  onSearchQueryChange,
  showTable: propShowTable,
  onShowTableChange,
  dateRangeFilter = '7days',
  onDateRangeFilterChange,
  isLoadingHistory = false,
  processingDate,
  onProcessingDateChange,
  customVouchersMap
}: CsvDatabasePanelProps) {
  const [concessionsInputMode, setConcessionsInputMode] = useState<"file" | "paste">("file");
  const [pastedConcessions, setPastedConcessions] = useState("");
  const [internalShowTable, setInternalShowTable] = useState(false);
  const showTable = propShowTable !== undefined ? propShowTable : internalShowTable;
  const setShowTable = (val: boolean) => {
    setInternalShowTable(val);
    if (onShowTableChange) onShowTableChange(val);
  };
  const [showNewEntryModal, setShowNewEntryModal] = useState(false);
  
  // New Entry Form State
  const [newFormHospital, setNewFormHospital] = useState("Whipps Cross Hospital");
  const [newFormWard, setNewFormWard] = useState("");
  const [newFormDateReq, setNewFormDateReq] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [newFormDateExp, setNewFormDateExp] = useState("");
  const [newFormVrm, setNewFormVrm] = useState("");
  const [newFormDriverName, setNewFormDriverName] = useState("");
  const [newFormPhone, setNewFormPhone] = useState("");
  const [newFormEmail, setNewFormEmail] = useState("");
  const [newFormVoucherCode, setNewFormVoucherCode] = useState("-");
  const [newFormStartTime, setNewFormStartTime] = useState("");

  const [dragActive, setDragActive] = useState(false);
  const [vouchersDragActive, setVouchersDragActive] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Auto-dismiss feedback status message after 4.5 seconds
  useEffect(() => {
    if (!feedbackMsg) return;
    const timer = setTimeout(() => {
      setFeedbackMsg(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [feedbackMsg]);
  
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(() => {
    const cachedName = safeLocalStorage.getItem("concessions_uploaded_file_name");
    if (cachedName) return cachedName;
    return null;
  });

  const [uploadedVouchersFileName, setUploadedVouchersFileName] = useState<string | null>(() => {
    const cachedName = safeLocalStorage.getItem("concessions_uploaded_vouchers_file_name");
    if (cachedName && !cachedName.includes("Codes")) return cachedName;
    return "Vouchers.csv";
  });

  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const isControlledSearch = searchQueryProp !== undefined;
  const searchQuery = isControlledSearch ? searchQueryProp : localSearchQuery;
  const setSearchQuery = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setLocalSearchQuery(val);
    }
  };

  const [showDropdown, setShowDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vouchersFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const sortedDatabase = React.useMemo(() => {
    return sortRecordsByFormIdDesc(database);
  }, [database]);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Synchronize display status when database prop changes
  useEffect(() => {
    const cachedName = safeLocalStorage.getItem("concessions_uploaded_file_name");
    if (cachedName) {
      setUploadedFileName(cachedName);
    } else if (database.length === 0) {
      setUploadedFileName(null);
    } else {
      setUploadedFileName(`_Visitor _ Patient Parking Concessions Request Form(1-${database.length}).xlsx`);
    }
  }, [database]);

  // Synchronize vouchers display status when vouchersDatabase prop changes
  useEffect(() => {
    const cachedName = safeLocalStorage.getItem("concessions_uploaded_vouchers_file_name");
    if (cachedName && !cachedName.includes("Codes")) {
      setUploadedVouchersFileName(cachedName);
    } else if (vouchersDatabase.length === 0) {
      setUploadedVouchersFileName(null);
    } else {
      setUploadedVouchersFileName("Vouchers.csv");
    }
  }, [vouchersDatabase]);

  // Parse uploaded concessions file
  const handleFile = (file: File) => {
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      setFeedbackMsg({
        type: "error",
        text: "Invalid file type. Please upload a valid Concessions Excel file (.xlsx or .xls)."
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const records = parsePermitExcel(arrayBuffer);
        
        if (records.length === 0) {
          setFeedbackMsg({
            type: "error",
            text: "No valid permit records found. Please ensure headers match like VRM, Driver, Hospital, Ward."
          });
          return;
        }

        const sorted = sortRecordsByFormIdDesc(records);
        onDatabaseChange(sorted);
        setUploadedFileName(file.name);
        safeLocalStorage.setItem("concessions_uploaded_file_name", file.name);
        setFeedbackMsg({
          type: "success",
          text: `Processed ${sorted.length} records. Database appended/updated successfully!`
        });
      } catch (e: any) {
        setFeedbackMsg({
          type: "error",
          text: `Concessions failed: ${e.message || "Unknown error"}`
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // Parse uploaded vouchers file
  const handleVouchersFile = (file: File) => {
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv")) {
      setFeedbackMsg({
        type: "error",
        text: "Invalid file type. Please upload a valid Voucher Codes CSV file (.csv)."
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const vouchers = parseVoucherFile(arrayBuffer, file.name);
        
        if (vouchers.length === 0) {
          setFeedbackMsg({
            type: "error",
            text: "No valid voucher codes found. Ensure the file contains voucher codes under a 'Voucher' column or is a single-column list."
          });
          return;
        }

        onVouchersDatabaseChange(vouchers);
        setUploadedVouchersFileName(file.name);
        safeLocalStorage.setItem("concessions_uploaded_vouchers_file_name", file.name);
        setFeedbackMsg({
          type: "success",
          text: `Processed ${vouchers.length} voucher codes. Database appended/updated successfully!`
        });
      } catch (e: any) {
        setFeedbackMsg({
          type: "error",
          text: `Vouchers failed: ${e.message || "Unknown error"}`
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleVouchersFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleVouchersFile(file);
  };

  const handleVouchersDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setVouchersDragActive(true);
    } else if (e.type === "dragleave") {
      setVouchersDragActive(false);
    }
  };

  const handleVouchersDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setVouchersDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleVouchersFile(file);
  };

  // Handle New Entry creation
  const handleCreateNewEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const nextFormId = generateNextFormId(database);
    
    let formattedDateReq = newFormDateReq;
    if (formattedDateReq && formattedDateReq.includes("-")) {
      const parts = formattedDateReq.split("-");
      if (parts.length === 3) {
        formattedDateReq = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    let formattedDateExp = newFormDateExp;
    if (formattedDateExp && formattedDateExp.includes("-")) {
      const parts = formattedDateExp.split("-");
      if (parts.length === 3) {
        formattedDateExp = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    } else if (!formattedDateExp && newFormDateReq) {
      const dateIso = parseDateToISO(newFormDateReq) || newFormDateReq;
      const expIso = addDays(dateIso, 6);
      const parts = expIso.split("-");
      if (parts.length === 3) {
        formattedDateExp = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    const newRecord: CsvPermitRecord = {
      id: nextFormId,
      formId: nextFormId,
      hospital: newFormHospital || "Whipps Cross Hospital",
      ward: newFormWard || "Administration",
      dateRequired: formattedDateReq || "01/01/2026",
      dateExpiry: formattedDateExp || "07/01/2026",
      vrm: newFormVrm ? newFormVrm.toUpperCase().replace(/\s+/g, "") : "PENDING",
      driverName: newFormDriverName ? toTitleCase(newFormDriverName) : "New Driver",
      phone: newFormPhone ? formatPhoneNumber(newFormPhone) : "",
      email: newFormEmail ? newFormEmail.toLowerCase().trim() : "",
      voucherCode: newFormVoucherCode && newFormVoucherCode.trim() !== "" ? newFormVoucherCode.trim() : "-",
      startTime: newFormStartTime || new Date().toLocaleString("en-GB"),
      createdAt: new Date().toISOString()
    };

    const updated = sortRecordsByFormIdDesc([newRecord, ...database]);
    safeLocalStorage.setItem("concessions_permit_db", JSON.stringify(updated));
    safeLocalStorage.setItem("concessions_permit_db_last_modified", Date.now().toString());
    onDatabaseChange(updated);

    setShowNewEntryModal(false);
    setFeedbackMsg({
      type: "success",
      text: `Successfully created Record Form ID ${nextFormId}!`
    });

    // Reset inputs
    setNewFormWard("");
    setNewFormVrm("");
    setNewFormDriverName("");
    setNewFormPhone("");
    setNewFormEmail("");
    setNewFormVoucherCode("-");
    setNewFormStartTime("");
  };

  const filteredDropdownRecords = React.useMemo(() => {
    if (!debouncedSearchQuery.trim()) return [];
    const q = debouncedSearchQuery.toLowerCase();
    return sortedDatabase.filter(r => {
      const cleanFormId = formatFormId(r.formId !== undefined ? r.formId : r.id);
      return (
        cleanFormId.includes(debouncedSearchQuery) ||
        (r.formId && String(r.formId).includes(debouncedSearchQuery)) ||
        r.driverName.toLowerCase().includes(q) ||
        r.vrm.toLowerCase().includes(q) ||
        r.hospital.toLowerCase().includes(q) ||
        r.ward.toLowerCase().includes(q)
      );
    }).slice(0, 8);
  }, [sortedDatabase, debouncedSearchQuery]);

  const filteredTableRecords = React.useMemo(() => {
    let result = sortedDatabase;

    if (!isSupabaseConfigured() && dateRangeFilter && dateRangeFilter !== 'all') {
      const days = dateRangeFilter === '7days' ? 7 : 30;
      result = result.filter(r => {
        const rawDate = r.dateRequired || r.todayDate || (r as any).createdAt || (r as any).created_at;
        if (rawDate) {
          const iso = parseDateToISO(rawDate);
          if (iso) {
            const reqDate = new Date(iso);
            const today = new Date("2026-08-06");
            const diffTime = today.getTime() - reqDate.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays < 0 || diffDays > days) return false;
          }
        }
        return true;
      });
    }

    if (!debouncedSearchQuery.trim()) return result;
    const q = debouncedSearchQuery.toLowerCase();
    return result.filter(r => {
      const cleanFormId = formatFormId(r.formId !== undefined ? r.formId : r.id);
      return (
        cleanFormId.includes(debouncedSearchQuery) ||
        (r.formId && String(r.formId).includes(debouncedSearchQuery)) ||
        r.driverName.toLowerCase().includes(q) ||
        r.vrm.toLowerCase().includes(q) ||
        r.hospital.toLowerCase().includes(q) ||
        r.ward.toLowerCase().includes(q) ||
        (r.email && r.email.toLowerCase().includes(q)) ||
        (r.voucherCode && r.voucherCode.toLowerCase().includes(q))
      );
    });
  }, [sortedDatabase, debouncedSearchQuery, dateRangeFilter]);

  const effectiveTotalCount = totalRecordsCount && totalRecordsCount > 0 ? totalRecordsCount : database.length;
  const isFilteredBySearch = Boolean(debouncedSearchQuery.trim());
  const displayCount = (dateRangeFilter === 'all' && !isFilteredBySearch)
    ? effectiveTotalCount
    : filteredTableRecords.length;

  const processingDateInputRef = useRef<HTMLInputElement>(null);

  const effectiveProcessingDate = parseDateToISO(processingDate || "") || getTodayISO();
  const formattedProcessingDate = (() => {
    if (!effectiveProcessingDate) return "-";
    const parts = effectiveProcessingDate.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : effectiveProcessingDate;
  })();

  const handlePrevDay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIso = parseDateToISO(processingDate || "") || getTodayISO();
    const prevIso = addDays(currentIso, -1);
    if (onProcessingDateChange) {
      onProcessingDateChange(prevIso);
    }
  };

  const handleNextDay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIso = parseDateToISO(processingDate || "") || getTodayISO();
    const nextIso = addDays(currentIso, 1);
    if (onProcessingDateChange) {
      onProcessingDateChange(nextIso);
    }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val && onProcessingDateChange) {
      onProcessingDateChange(val);
    }
  };

  const handleOpenDatePicker = () => {
    try {
      processingDateInputRef.current?.showPicker?.();
    } catch {
      processingDateInputRef.current?.click();
    }
  };

  return (
    <aside ref={panelRef} className="data-sidebar">
      <div className="sidebar-card">
        <div className="sidebar-card-title"><span>1. Concessions Spreadsheet</span></div>
        <div className="file-summary">
          <div className="file-logo excel">X</div>
          <div className="file-meta">
            <div className="file-name" title={uploadedFileName || "_Visitor _ Patient Parking Concessions Request Form(1-72).xlsx"}>{uploadedFileName || "_Visitor _ Patient Parking Concessions Request Form(1-72).xlsx"}</div>
            <div className="file-links"><button type="button" onClick={() => setConcessionsInputMode("file")}>File</button><span>|</span><button type="button" onClick={() => setConcessionsInputMode("paste")}>Paste</button><span>|</span><span>{effectiveTotalCount.toLocaleString()} Records</span></div>
          </div>
        </div>
        {concessionsInputMode === "paste" ? (
          <div className="paste-box">
            <textarea value={pastedConcessions} onChange={e => setPastedConcessions(e.target.value)} placeholder="Paste tab-separated concession rows here..." />
            <button type="button" disabled={!pastedConcessions.trim()} onClick={() => {
              if (!pastedConcessions.trim()) return;
              const records = parsePastedText(pastedConcessions);
              if (!records.length) { setFeedbackMsg({ type: "error", text: "Could not parse the pasted concession rows." }); return; }
              const sorted = sortRecordsByFormIdDesc(records);
              safeLocalStorage.setItem("concessions_permit_db", JSON.stringify(sorted));
              safeLocalStorage.setItem("concessions_permit_db_last_modified", Date.now().toString());
              onDatabaseChange(sorted);
              setUploadedFileName("Pasted Spreadsheet Rows");
              safeLocalStorage.setItem("concessions_uploaded_file_name", "Pasted Spreadsheet Rows");
              setConcessionsInputMode("file");
              setFeedbackMsg({ type: "success", text: `Loaded ${sorted.length} concession records.` });
            }}>Import Pasted Rows</button>
          </div>
        ) : (
          <div onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} className={`sidebar-dropzone ${dragActive ? "drag-active" : ""}`}>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />
            <Upload /><span>Click/drop to replace concessions</span>
          </div>
        )}
      </div>

      <div className="sidebar-card">
        <div className="sidebar-card-title"><span>2. Voucher Codes CSV</span></div>
        <div className="file-summary">
          <div className="file-logo csv">CSV</div>
          <div className="file-meta"><div className="file-name">{uploadedVouchersFileName || "Vouchers.csv"}</div><div className="file-links"><span>{vouchersDatabase.length.toLocaleString()} Codes</span></div></div>
        </div>
        <div onDragEnter={handleVouchersDrag} onDragOver={handleVouchersDrag} onDragLeave={handleVouchersDrag} onDrop={handleVouchersDrop} onClick={() => vouchersFileInputRef.current?.click()} className={`sidebar-dropzone ${vouchersDragActive ? "drag-active" : ""}`}>
          <input type="file" ref={vouchersFileInputRef} onChange={handleVouchersFileUpload} accept=".csv,.txt" className="hidden" />
          <Upload /><span>Click/drop to replace voucher list</span>
        </div>
      </div>

      <div className="sidebar-card search-card">
        <div className="sidebar-card-title"><span>Quick-Search Loaded Spreadsheet Database:</span></div>
        <div className="sidebar-search"><Search /><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by driver's name, number plate (VRM), or hospital ward..." /></div>
        {debouncedSearchQuery.trim() && filteredTableRecords.length > 0 && <div className="search-results">
          {filteredTableRecords.slice(0, 8).map((record, index) => <button type="button" key={`${record.id || record.formId || index}`} onClick={() => onSelectRecord?.(record)}><span>{toTitleCase(record.driverName || "Unnamed")}</span><small>{record.vrm || "No VRM"} · {record.ward || record.hospital || ""}</small></button>)}
        </div>}
      </div>

      <div className="sidebar-card processing-card">
        <div className="sidebar-card-title"><span>Spreadsheet Processing Date:</span></div>
        <div className="processing-date-nav-row">
          <button 
            type="button" 
            onClick={handlePrevDay} 
            className="date-nav-btn prev-btn"
            title="Previous day (minus 1 day)"
            aria-label="Previous day"
          >
            ◀
          </button>
          <div 
            className="processing-date-display-btn"
            onClick={handleOpenDatePicker}
            title="Click to open calendar date picker"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpenDatePicker();
              }
            }}
          >
            <Calendar className="w-4 h-4 text-[#1677FF]" />
            <span>{formattedProcessingDate}</span>
            <input
              type="date"
              ref={processingDateInputRef}
              value={effectiveProcessingDate}
              onChange={handleDateChange}
              className="sr-only"
              aria-label="Spreadsheet Processing Date"
            />
          </div>
          <button 
            type="button" 
            onClick={handleNextDay} 
            className="date-nav-btn next-btn"
            title="Next day (plus 1 day)"
            aria-label="Next day"
          >
            ▶
          </button>
        </div>
      </div>

      {feedbackMsg && <div className={`sidebar-feedback ${feedbackMsg.type}`}><span>{feedbackMsg.type === "success" ? "✓" : "!"}</span><span>{feedbackMsg.text}</span><button type="button" onClick={() => setFeedbackMsg(null)}><X /></button></div>}
    </aside>
  );

}
