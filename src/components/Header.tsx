import React, { useState } from "react";
import { BarChart3, Download, FileSpreadsheet, Mail, Moon, Printer, Settings, Sun, Table2, Monitor } from "lucide-react";

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  activeTab: "dispatcher" | "table" | "analytics";
  onActiveTabChange: (tab: "dispatcher" | "table" | "analytics") => void;
  onExportExcel?: () => void;
  totalRecordsCount?: number;
  onEmail?: () => void;
  onPrint?: () => void;
  onOutlook?: () => void;
}

export function Header({
  darkMode,
  onToggleDarkMode,
  activeTab,
  onActiveTabChange,
  onExportExcel,
  onEmail,
  onPrint,
  onOutlook,
}: HeaderProps) {
  const [showViews, setShowViews] = useState(false);

  const action = (label: string, icon: React.ReactNode, onClick?: () => void, title?: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      className="park-action"
      disabled={!onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <header className="park-header no-print">
      <div className="park-brand">
        <div className="park-title-row">
          <h1>ParkPass QR Studio</h1>
          <span className="park-badge">v3.4</span>
          <span className="park-badge park-badge-muted">Elite</span>
        </div>
        <div className="park-subtitle">Patient &amp; Visitor Permit Management</div>
        <div className="park-tagline">Status Tracking <b>•</b> Duplicate Protection <b>•</b> Bulk QR Dispatch</div>
      </div>

      <div className="park-header-actions">
        <div className="park-dark-mode">
          <span>Dark Mode</span>
          <button type="button" className={`park-switch ${darkMode ? "is-on" : ""}`} onClick={onToggleDarkMode} aria-label="Toggle dark mode">
            <span />
          </button>
        </div>
        <div className="park-action-row">
          <div className="park-actions-label">Actions</div>
          <div className="park-actions-divider" />
          {action("Outlook", <Monitor />, onOutlook, "Open Outlook dispatch for the selected permit")}
          {action("Excel", <FileSpreadsheet />, onExportExcel, "Export concessions to Excel")}
          {action("Email", <Mail />, onEmail, "Open email dispatch for the selected permit")}
          {action("Print", <Printer />, onPrint, "Print the selected permit")}
          <div className="park-settings-wrap">
            <button type="button" className="park-action" onClick={() => setShowViews(v => !v)} title="Open application views">
              <Settings />
              <span>Settings</span>
            </button>
            {showViews && (
              <div className="park-settings-menu">
                <button onClick={() => { onActiveTabChange("dispatcher"); setShowViews(false); }}>Dispatcher</button>
                <button onClick={() => { onActiveTabChange("table"); setShowViews(false); }}>Full Database Table</button>
                <button onClick={() => { onActiveTabChange("analytics"); setShowViews(false); }}>Daily Analytics</button>
              </div>
            )}
          </div>
        </div>
      </div>

    </header>
  );
}
