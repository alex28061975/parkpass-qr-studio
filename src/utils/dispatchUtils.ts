import { CsvPermitRecord } from "./csvParser";
import { getSupabaseClient, syncDispatchedToSupabase, deleteDispatchedFromSupabase, deleteDispatchedKeysFromSupabase, fetchDispatchedFromSupabase } from "../lib/supabase";

/**
 * Helper to compute a simple 32-bit FNV-1a hash string for deterministic fallback key generation
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Returns the strictly unique primary key for a permit record.
 * Uses record.formId || record.id. If missing, computes a deterministic fallback key
 * based on stable record properties without mutating the input record object.
 * DO NOT use VRM alone for dispatch state checking.
 */
export function getRecordPrimaryKey(
  record?: CsvPermitRecord | null,
  fallbackVrm?: string | null,
  fallbackDate?: string | null
): string {
  if (!record) return "";

  if (record.formId !== undefined && record.formId !== null && String(record.formId).trim() !== "") {
    return String(record.formId).trim();
  }

  if (record.id !== undefined && record.id !== null && String(record.id).trim() !== "") {
    return String(record.id).trim();
  }

  // Generate a deterministic fallback key based on stable properties without mutating the input object
  const vrm = (record.vrm || fallbackVrm || "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const email = (record.email || record.driverEmail || "").toString().trim().toLowerCase();
  const dateRequired = (record.dateRequired || record.validFrom || record.todayDate || fallbackDate || "").toString().trim();
  const driverName = (record.driverName || record.name || "").toString().trim().toLowerCase();

  const stableSeed = `${vrm}_${email}_${dateRequired}_${driverName}`;
  if (stableSeed.replace(/_/g, "").length > 0) {
    return `rec_${hashString(stableSeed)}`;
  }

  return "";
}

/**
 * Resolves all strict Form ID key aliases for a permit record.
 * STRICTLY ISOLATED TO FORM ID / RECORD ID ONLY — NEVER MATCHES BY VRM ALONE.
 */
export function getRecordKeys(
  record?: CsvPermitRecord | null,
  _vrm?: string | null,
  _name?: string | null,
  _dateRequired?: string | null
): string[] {
  if (!record) return [];

  const keys = new Set<string>();
  const add = (k?: string | number | null) => {
    if (k === undefined || k === null) return;
    const str = String(k).trim();
    if (str) keys.add(str);
  };

  const pk = getRecordPrimaryKey(record);
  if (pk) {
    add(pk);
    const cleanNum = pk.replace(/[^0-9]/g, "");
    if (cleanNum) {
      add(cleanNum);
      add(`FORM_${cleanNum}`);
    }
  }

  if (record.id) {
    const idStr = String(record.id).trim();
    add(idStr);
    const cleanNum = idStr.replace(/[^0-9]/g, "");
    if (cleanNum) {
      add(cleanNum);
      add(`FORM_${cleanNum}`);
    }
  }

  if (record.formId) {
    const formIdStr = String(record.formId).trim();
    add(formIdStr);
    const cleanNum = formIdStr.replace(/[^0-9]/g, "");
    if (cleanNum) {
      add(cleanNum);
      add(`FORM_${cleanNum}`);
    }
  }

  return Array.from(keys);
}

/**
 * Gets the PRIMARY dispatch key for a record (Form ID based).
 * Strictly returns the unique Form ID primary key.
 */
export function getPrimaryDispatchKey(
  record?: CsvPermitRecord | any | null,
  fallbackVrm?: string | null,
  fallbackDate?: string | null
): string {
  return getRecordPrimaryKey(record, fallbackVrm, fallbackDate);
}

/**
 * Synchronously check if a record is dispatched by checking against pre-fetched dispatched Form IDs
 * and unsent keys from Supabase dispatch logs.
 *
 * Strict One-by-One Derivation: Returns true ONLY if a Form ID key specific to this record exists in dispatchedKeys.
 */
export function checkIsRecordDispatched(
  record?: CsvPermitRecord | any | null,
  _vrm?: string | null,
  _name?: string | null,
  _dateRequired?: string | null,
  dispatchedKeys?: string[] | Set<string>,
  unsentKeys?: string[] | Set<string>
): boolean {
  if (!record) return false;

  const recordKeys = getRecordKeys(record);
  if (recordKeys.length === 0) return false;

  const dispatchedSet = dispatchedKeys
    ? (Array.isArray(dispatchedKeys) ? new Set(dispatchedKeys) : dispatchedKeys)
    : new Set<string>();

  const unsentSet = unsentKeys
    ? (Array.isArray(unsentKeys) ? new Set(unsentKeys) : unsentKeys)
    : null;

  // If explicitly unmarked as dispatched / marked unsent in current session
  if (unsentSet && unsentSet.size > 0) {
    for (const k of recordKeys) {
      if (unsentSet.has(k)) {
        return false;
      }
    }
  }

  // Check if any resolved Form ID key alias for this specific record exists in dispatchedSet
  if (dispatchedSet.size > 0) {
    for (const k of recordKeys) {
      if (dispatchedSet.has(k)) {
        return true;
      }
    }
  }

  // Default: unrecorded records are strictly Pending (false)
  return false;
}

/**
 * Async check if a record is dispatched by querying Supabase directly by Form ID
 */
export async function checkIsRecordDispatchedAsync(
  record?: CsvPermitRecord | null
): Promise<boolean> {
  if (!record) return false;

  const primaryKey = getRecordPrimaryKey(record);
  if (!primaryKey) return false;

  const client = getSupabaseClient();
  if (!client) {
    console.warn('Supabase client not available');
    return false;
  }

  try {
    const recordKeys = getRecordKeys(record);
    const { data, error } = await client
      .from('dispatched_history')
      .select('key')
      .in('key', recordKeys)
      .limit(1);

    if (error) {
      console.error('Error checking dispatch status in Supabase:', error);
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error('Error checking dispatch status:', error);
    return false;
  }
}

/**
 * Alias for backward compatibility
 */
export const checkIsRecordDispatchedSync = checkIsRecordDispatched;

/**
 * Batch check dispatch status for multiple records by Form ID
 */
export async function batchCheckIsRecordDispatched(
  records: CsvPermitRecord[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();

  if (!records || records.length === 0) return result;

  const allKeysToQuery: string[] = [];
  const keyToRecordPk = new Map<string, string>();

  for (const record of records) {
    const pk = getRecordPrimaryKey(record);
    if (pk) {
      result.set(pk, false);
      const keys = getRecordKeys(record);
      for (const k of keys) {
        allKeysToQuery.push(k);
        keyToRecordPk.set(k, pk);
      }
    }
  }

  if (allKeysToQuery.length === 0) return result;

  const client = getSupabaseClient();
  if (!client) {
    return result;
  }

  try {
    const { data, error } = await client
      .from('dispatched_history')
      .select('key')
      .in('key', allKeysToQuery);

    if (error) {
      console.error('Error batch checking dispatch status:', error);
      return result;
    }

    if (data && Array.isArray(data)) {
      for (const item of data) {
        const pk = keyToRecordPk.get(item.key) || item.key;
        result.set(pk, true);
      }
    }

    return result;
  } catch (error) {
    console.error('Error batch checking dispatch status:', error);
    return result;
  }
}

/**
 * Mark a record as dispatched in Supabase by strict Form ID
 */
export async function markRecordAsDispatched(
  record: CsvPermitRecord,
  dispatchedBy?: string,
  _notes?: string
): Promise<{ success: boolean; error?: string }> {
  const primaryKey = getRecordPrimaryKey(record);
  if (!primaryKey) {
    return { success: false, error: 'Could not generate dispatch key from record Form ID' };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client not available' };
  }

  const todayISO = new Date().toISOString().split('T')[0];
  const dispatchedByName = dispatchedBy || 'System User';

  try {
    // Single consolidated write per send action using the primary Form ID dispatch key
    const success = await syncDispatchedToSupabase(
      primaryKey,
      todayISO,
      dispatchedByName,
      record.vrm,
      record.email
    );

    if (!success) {
      return { success: false, error: 'Failed to write dispatch status to database' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error marking record as dispatched:', error);
    return { success: false, error: error.message || 'Unknown database error' };
  }
}

/**
 * Unmark a record as dispatched (remove from Supabase by Form ID)
 */
export async function unmarkRecordAsDispatched(
  record: CsvPermitRecord
): Promise<{ success: boolean; error?: string }> {
  const primaryKey = getRecordPrimaryKey(record);
  if (!primaryKey) {
    return { success: false, error: 'Could not generate dispatch key from record Form ID' };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client not available' };
  }

  try {
    const allKeys = getRecordKeys(record);
    const keysToDelete = Array.from(new Set([primaryKey, ...allKeys]));
    await deleteDispatchedKeysFromSupabase(keysToDelete);

    return { success: true };
  } catch (error: any) {
    console.error('Error unmarking record as dispatched:', error);
    return { success: false, error: error.message || 'Unknown database error' };
  }
}

/**
 * Fetch dispatched Form IDs directly from Supabase (Source of Truth)
 */
export async function fetchDispatchedFormIdsFromSupabase(): Promise<{
  dispatchedKeys: string[];
  dispatchDates: Record<string, string>;
  dispatchBy: Record<string, string>;
} | null> {
  return fetchDispatchedFromSupabase();
}

/**
 * Get all dispatched keys from Supabase (for initial load)
 */
export async function getAllDispatchedKeys(): Promise<string[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('dispatched_history')
      .select('key');

    if (error) throw error;
    return data?.map(item => item.key) || [];
  } catch (error) {
    console.error('Error getting all dispatched keys:', error);
    return [];
  }
}

/**
 * Get dispatch history for a record by Form ID
 */
export async function getRecordDispatchHistory(
  record: CsvPermitRecord
): Promise<any[]> {
  const primaryKey = getRecordPrimaryKey(record);
  if (!primaryKey) return [];

  const client = getSupabaseClient();
  if (!client) return [];

  try {
    const allKeys = getRecordKeys(record);
    const { data, error } = await client
      .from('dispatched_history')
      .select('key, dispatch_date, dispatch_by, vrm, email')
      .in('key', allKeys);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting dispatch history:', error);
    return [];
  }
}