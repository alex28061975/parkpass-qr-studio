import React, { useState, useRef, useEffect } from "react";
import { QrCode, Settings, FileSpreadsheet, ChevronDown, Check } from "lucide-react";

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  activeTab?: "dispatcher" | "table" | "analytics";
  onActiveTabChange?: (tab: "dispatcher" | "table" | "analytics") => void;
  onExportExcel?: () => void;
  totalRecordsCount?: number;
  onEmail?: () => void;
  onPrint?: () => void;
  onOutlook?: () => void;
}

export function Header({
  darkMode,
  onToggleDarkMode,
  onExportExcel,
  activeTab,
  onActiveTabChange,
}: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }
    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSettings]);

  return (
    <header className="park-header no-print">
      <div className="park-header-main">
        {/* Window control dots: Close, Minimize, Maximize */}
        <div className="window-control-dots" aria-hidden="true">
          <span className="window-dot dot-close" title="Close" />
          <span className="window-dot dot-minimize" title="Minimize" />
          <span className="window-dot dot-maximize" title="Maximize" />
        </div>

        {/* QR Code Icon */}
        <div className="park-qr-icon-wrapper" title="QR Code Permit Management">
          <QrCode className="w-7 h-7 text-[#5bdcff] dark:text-[#38bdf8]" />
        </div>

        {/* Main Title */}
        <h1 className="park-main-title">Patient &amp; Visitor Parking Voucher Generator</h1>
      </div>

      <div className="park-header-controls">
        {/* Export Excel button */}
        {onExportExcel && (
          <button
            type="button"
            className="park-header-btn park-export-btn"
            onClick={onExportExcel}
            title="Export database to Excel / CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export</span>
          </button>
        )}

        {/* Settings Dropdown */}
        <div className="park-settings-wrap" ref={settingsRef}>
          <button
            type="button"
            className={`park-header-btn ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings((prev) => !prev)}
            title="Settings and views"
            aria-expanded={showSettings}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSettings ? "rotate-180" : ""}`} />
          </button>

          {showSettings && (
            <div className="park-settings-menu">
              <div className="park-menu-section-label">Switch View</div>
              {onActiveTabChange && (
                <>
                  <button
                    type="button"
                    className={activeTab === "dispatcher" ? "selected" : ""}
                    onClick={() => {
                      onActiveTabChange("dispatcher");
                      setShowSettings(false);
                    }}
                  >
                    <span>Permit Dispatcher</span>
                    {activeTab === "dispatcher" && <Check className="w-3.5 h-3.5 text-[#5bdcff]" />}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "table" ? "selected" : ""}
                    onClick={() => {
                      onActiveTabChange("table");
                      setShowSettings(false);
                    }}
                  >
                    <span>Full Records Table</span>
                    {activeTab === "table" && <Check className="w-3.5 h-3.5 text-[#5bdcff]" />}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "analytics" ? "selected" : ""}
                    onClick={() => {
                      onActiveTabChange("analytics");
                      setShowSettings(false);
                    }}
                  >
                    <span>Analytics &amp; Reports</span>
                    {activeTab === "analytics" && <Check className="w-3.5 h-3.5 text-[#5bdcff]" />}
                  </button>
                </>
              )}

              {onExportExcel && (
                <>
                  <div className="park-menu-divider" />
                  <div className="park-menu-section-label">Data Actions</div>
                  <button
                    type="button"
                    onClick={() => {
                      onExportExcel();
                      setShowSettings(false);
                    }}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 mr-1.5 inline" />
                    <span>Export to Spreadsheet</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Dark Mode toggle */}
        <div className="park-dark-mode">
          <span>Dark Mode</span>
          <button 
            type="button" 
            className={`park-switch ${darkMode ? "is-on" : ""}`} 
            onClick={onToggleDarkMode} 
            aria-label="Toggle dark mode"
          >
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
