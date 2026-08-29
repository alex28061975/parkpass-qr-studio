import { safeLocalStorage } from "../utils/safeLocalStorage";

export interface BlocklistItem {
  id: string;
  formId?: string | number;
  hospitalSite?: string;
  wardDept?: string;
  dateRequired?: string;
  expiryDate?: string;
  vrm: string;
  driverName?: string;
  phone?: string;
  email?: string;
  voucherCode?: string;
  reason: string;
  addedAt?: string;
}

export const BLOCKLIST_STORAGE_KEY = "concession_blocklist_data";

// Initial seed data if none in storage
const DEFAULT_BLOCKLIST: BlocklistItem[] = [
  {
    id: "blk_seed_1",
    formId: "1311",
    hospitalSite: "Whipps Cross Hospital",
    wardDept: "Emergency Care",
    dateRequired: "2025-05-10",
    expiryDate: "2025-05-17",
    vrm: "AU67 HCZ",
    driverName: "Sarah Connor",
    phone: "07700900123",
    email: "s.connor@example.com",
    voucherCode: "BLOCKED",
    reason: "Duplicate permit abuse / multiple simultaneous active vehicles",
    addedAt: "2025-05-10T08:00:00.000Z"
  }
];

export function normalizeVrm(vrm?: string): string {
  if (!vrm) return "";
  return vrm.replace(/\s+/g, "").toUpperCase();
}

export function getBlocklist(): BlocklistItem[] {
  try {
    const raw = safeLocalStorage.getItem(BLOCKLIST_STORAGE_KEY);
    if (!raw) {
      // Initialize with default seed
      saveBlocklist(DEFAULT_BLOCKLIST);
      return DEFAULT_BLOCKLIST;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return DEFAULT_BLOCKLIST;
  } catch (e) {
    console.error("Failed to load blocklist from storage:", e);
    return DEFAULT_BLOCKLIST;
  }
}

export function saveBlocklist(items: BlocklistItem[]): void {
  try {
    safeLocalStorage.setItem(BLOCKLIST_STORAGE_KEY, JSON.stringify(items));
    // Dispatch a custom storage event so other components update synchronously
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("blocklist_updated", { detail: items }));
    }
  } catch (e) {
    console.error("Failed to save blocklist to storage:", e);
  }
}

export function addBlocklistItem(item: Omit<BlocklistItem, "id"> & { id?: string }): BlocklistItem {
  const list = getBlocklist();
  const newItem: BlocklistItem = {
    ...item,
    id: item.id || `blk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    vrm: item.vrm.trim().toUpperCase(),
    addedAt: item.addedAt || new Date().toISOString()
  };
  const updated = [newItem, ...list];
  saveBlocklist(updated);
  return newItem;
}

export function removeBlocklistItem(id: string): void {
  const list = getBlocklist();
  const updated = list.filter((i) => i.id !== id);
  saveBlocklist(updated);
}

export function isVrmSilentBlockedSync(vrm?: string): boolean {
  if (!vrm) return false;
  const target = normalizeVrm(vrm);
  if (!target) return false;
  const list = getBlocklist();
  return list.some((item) => normalizeVrm(item.vrm) === target);
}

export async function isVrmSilentBlocked(vrm?: string): Promise<boolean> {
  return isVrmSilentBlockedSync(vrm);
}
