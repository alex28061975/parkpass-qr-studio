import React, { useMemo, useState } from "react";
import { ChevronDown, Mail, QrCode, Send, Package, RefreshCw } from "lucide-react";
import { CsvPermitRecord, ParsedVoucherData, cleanVoucherCodeValue, parseDateToISO, sortRecordsByFormIdDesc, toTitleCase } from "../utils/csvParser";
import { checkIsRecordDispatched } from "../utils/dispatchUtils";
import { isRecordCancelled } from "./PermitCard";

interface DispatchCentreProps {
  database: CsvPermitRecord[];
  vouchersDatabase: ParsedVoucherData[];
  dispatchedKeys: string[];
  unsentKeys?: string[];
  dispatchDates?: Record<string, string>;
  processingDate: string;
  onSelectRecord: (record: CsvPermitRecord) => void;
  onSendRecord?: (record: CsvPermitRecord) => Promise<void> | void;
  onUnsendRecord?: (record: CsvPermitRecord) => Promise<void> | void;
  onBulkEmail?: () => void;
}

const fmt = (value: string) => {
  const iso = parseDateToISO(value || "");
  if (!iso) return value || "-";
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function DispatchCentre({ database, vouchersDatabase, dispatchedKeys, unsentKeys = [], processingDate, onSelectRecord, onSendRecord, onUnsendRecord, onBulkEmail }: DispatchCentreProps) {
  const [activeOnly, setActiveOnly] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const records = useMemo(() => {
    return sortRecordsByFormIdDesc(database).filter((r) => {
      if (!activeOnly) return true;
      const required = r.dateRequired || r.validFrom || "";
      if (!required) return true;
      const iso = parseDateToISO(required);
      return !iso || iso === processingDate;
    });
  }, [database, activeOnly, processingDate]);

  const count = records.length;
  const handleAction = async (record: CsvPermitRecord, sent: boolean) => {
    const key = String(record.formId ?? record.id ?? record.vrm);
    setBusyKey(key);
    try {
      if (sent) await onUnsendRecord?.(record);
      else await onSendRecord?.(record);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="dispatch-panel">
      <div className="dispatch-head">
        <div className="dispatch-heading">
          <div className="dispatch-icon"><Package /></div>
          <div>
            <h2>Permit Dispatch Centre</h2>
            <p>Select recipients and dispatch emails via Outlook</p>
          </div>
        </div>
        <div className="dispatch-toolbar">
          <label className="active-date-toggle">
            <span>Active Date Only:</span>
            <b>{activeOnly ? "On" : "Off"}</b>
            <button type="button" className={`park-switch ${activeOnly ? "is-on" : ""}`} onClick={() => setActiveOnly(v => !v)}><span /></button>
          </label>
          <button type="button" className="dispatch-primary" onClick={onBulkEmail}><Mail /> Bulk Email</button>
          <button type="button" className="dispatch-secondary"><Package /> All ZIP</button>
        </div>
      </div>

      <div className="dispatch-table-wrap">
        <table className="dispatch-table">
          <thead>
            <tr>
              <th>#</th><th>QR</th><th>Driver's Name</th><th>VRM</th><th>VOUCHERCODE</th><th>Valid From</th><th>Valid To</th><th>Ward</th><th>Hospital</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, index) => {
              const sent = checkIsRecordDispatched(r, r.vrm, r.driverName, r.dateRequired, dispatchedKeys, unsentKeys);
              const cancelled = isRecordCancelled(r, processingDate);
              const code = cleanVoucherCodeValue(r.voucherCode || "") || (r.voucherCode || "-");
              const rowKey = String(r.formId ?? r.id ?? r.vrm ?? index);
              return (
                <tr key={`${rowKey}-${index}`} onClick={() => onSelectRecord(r)}>
                  <td>{index + 1}</td>
                  <td><span className="qr-link"><QrCode /> QR Code</span></td>
                  <td className="driver-name">{r.driverName ? toTitleCase(r.driverName) : "-"}</td>
                  <td className="vrm">{r.vrm || "-"}</td>
                  <td className="voucher">{cancelled ? "CANCELLED" : code}</td>
                  <td>{fmt(r.dateRequired || r.validFrom || "")}</td>
                  <td>{fmt(r.dateExpiry || r.validTo || "")}</td>
                  <td>{r.ward ? toTitleCase(r.ward) : "-"}</td>
                  <td>{r.hospital || "-"}</td>
                  <td><span className={`status-pill ${cancelled ? "cancelled" : sent ? "sent" : "pending"}`}>{cancelled ? "CANCELLED" : sent ? "SENT" : "PENDING"}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      <button type="button" className="row-send" disabled={busyKey === rowKey || cancelled} onClick={() => handleAction(r, sent)}>
                        {busyKey === rowKey ? <RefreshCw className="spin" /> : sent ? <RefreshCw /> : <Send />}
                        {sent ? "Unsend" : "Send"}
                      </button>
                      <button type="button" className="row-more" onClick={() => onSelectRecord(r)}><ChevronDown /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && <tr><td colSpan={11} className="empty-row">No records for the selected processing date.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="dispatch-foot">Showing {count.toLocaleString()} record{count === 1 ? "" : "s"} <span>•</span> Click a row to load the permit into Step 1</div>
    </section>
  );
}
