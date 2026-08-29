import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CsvPermitRecord, ParsedVoucherData, resolveDateExpiry, cleanVoucherCodeValue, parseDateToISO } from '../utils/csvParser';

let runtimeSupabaseUrl: string | undefined = undefined;
let runtimeSupabaseAnonKey: string | undefined = undefined;

const DEFAULT_SUPABASE_URL = "https://ihhkitfpjmhudyzdhlpg.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_-7OtzoSb8zYjAXHR_Gk6dg_jAqiUyHQ";

const getRawUrl = (): string | undefined => {
  return runtimeSupabaseUrl || import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL || (typeof window !== 'undefined' ? (window as any).__SUPABASE_URL__ : undefined) || DEFAULT_SUPABASE_URL;
};

const getRawKey = (): string | undefined => {
  return runtimeSupabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.SUPABASE_KEY || import.meta.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.SUPABASE_ANON_KEY || (typeof window !== 'undefined' ? (window as any).__SUPABASE_ANON_KEY__ : undefined) || DEFAULT_SUPABASE_KEY;
};

const getSupabaseUrl = (): string | undefined => {
  const url = getRawUrl();
  const key = getRawKey();
  if (url && url.startsWith('http')) return url;
  if (key && key.startsWith('http')) return key;
  return DEFAULT_SUPABASE_URL;
};

const getSupabaseAnonKey = (): string | undefined => {
  const url = getRawUrl();
  const key = getRawKey();
  if (key && !key.startsWith('http')) return key;
  if (url && !url.startsWith('http')) return url;
  return DEFAULT_SUPABASE_KEY;
};

export const initSupabaseConfig = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/config');
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.supabaseUrl && data.supabaseAnonKey) {
        runtimeSupabaseUrl = data.supabaseUrl;
        runtimeSupabaseAnonKey = data.supabaseAnonKey;
        if (typeof window !== 'undefined') {
          (window as any).__SUPABASE_URL__ = data.supabaseUrl;
          (window as any).__SUPABASE_ANON_KEY__ = data.supabaseAnonKey;
        }
        supabaseClient = null;
      }
    } else {
      console.warn(`⚠️ /api/config returned ${res ? res.status : 'error'}. Using default environment/local storage mode.`);
    }
  } catch (err) {
    console.warn('⚠️ Note: /api/config not available, running in fallback/local mode:', err);
  }
  return isSupabaseConfigured();
};

export const isSupabaseConfigured = (): boolean => {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  return Boolean(url && key && url.startsWith('http') && url.includes('.supabase.co'));
};

let supabaseClient: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseClient) {
    const url = getSupabaseUrl();
    const key = getSupabaseAnonKey();
    supabaseClient = createClient(url!, key!);
  }
  return supabaseClient;
};

export const checkSupabaseConnection = async (): Promise<{ connected: boolean; error?: string }> => {
  const client = getSupabaseClient();
  if (!client) return { connected: false, error: 'Supabase credentials missing' };

  try {
    const { error } = await client.from('permits').select('id').limit(1);
    if (error) {
      console.error('Supabase health check error:', error.message, error);
      return { connected: false, error: error.message };
    }
    return { connected: true };
  } catch (err: any) {
    console.error('Supabase connection exception:', err);
    return { connected: false, error: err?.message || String(err) };
  }
};

// 1. Permits Table
export interface SupabasePermit {
  id: string;
  hospital: string;
  ward: string;
  date_required: string;
  date_expiry?: string;
  vrm: string;
  driver_name: string;
  phone?: string;
  email?: string;
  voucher_code?: string;
  start_time?: string;
  created_at?: string;
}

export const fetchPermitsFromSupabase = async (options?: { daysLimit?: number | null }): Promise<CsvPermitRecord[] | null> => {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    let allData: SupabasePermit[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    const daysLimit = options?.daysLimit;
    let cutoffISO = "";
    if (daysLimit && daysLimit > 0) {
      const nowObj = new Date();
      const cutoffTime = nowObj.getTime() - daysLimit * 86400000;
      const cutoffObj = new Date(cutoffTime);
      const cutoffYear = cutoffObj.getFullYear();
      const cutoffMonth = String(cutoffObj.getMonth() + 1).padStart(2, '0');
      const cutoffDay = String(cutoffObj.getDate()).padStart(2, '0');
      cutoffISO = `${cutoffYear}-${cutoffMonth}-${cutoffDay}`;
    }

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      let query = client
        .from('permits')
        .select('id, hospital, ward, date_required, date_expiry, vrm, driver_name, phone, email, voucher_code, start_time, created_at')
        .range(from, to)
        .order('created_at', { ascending: false });

      if (cutoffISO) {
        query = query.gte('created_at', cutoffISO);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('Supabase fetch permits error:', error.message);
        break;
      }

      if (data && data.length > 0) {
        allData = allData.concat(data as SupabasePermit[]);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    if (allData.length === 0) return [];

    let mappedRecords: CsvPermitRecord[] = allData.map((item: SupabasePermit) => ({
      id: item.id,
      formId: item.id,
      hospital: item.hospital || '',
      ward: item.ward || '',
      dateRequired: item.date_required || '',
      dateExpiry: resolveDateExpiry(item.date_required || '', item.date_expiry || ''),
      vrm: item.vrm || '',
      driverName: item.driver_name || '',
      phone: item.phone || '',
      email: item.email || '',
      voucherCode: item.voucher_code || '',
      startTime: item.start_time || undefined
    }));

    if (daysLimit && daysLimit > 0) {
      const nowObj = new Date();
      const cutoffTime = nowObj.getTime() - daysLimit * 86400000;
      const cutoffObj = new Date(cutoffTime);
      const cutoffYear = cutoffObj.getFullYear();
      const cutoffMonth = String(cutoffObj.getMonth() + 1).padStart(2, '0');
      const cutoffDay = String(cutoffObj.getDate()).padStart(2, '0');
      const cutoffISO = `${cutoffYear}-${cutoffMonth}-${cutoffDay}`;

      mappedRecords = mappedRecords.filter((r, idx) => {
        const item = allData[idx];
        const reqIso = r.dateRequired ? parseDateToISO(r.dateRequired) : "";
        const createdIso = item && item.created_at ? parseDateToISO(item.created_at) : "";

        const recordIso = reqIso || createdIso;
        if (!recordIso) return false;

        return recordIso >= cutoffISO;
      });
    }

    let exactTotalCount = 0;
    try {
      const { count } = await client.from('permits').select('*', { count: 'exact', head: true });
      if (typeof count === 'number' && count > 0) {
        exactTotalCount = count;
      }
    } catch (e) {}

    const totalCount = exactTotalCount || mappedRecords.length;
    const resultRecords = mappedRecords as CsvPermitRecord[] & { totalCount?: number };
    resultRecords.totalCount = totalCount;
    return resultRecords;
  } catch (err) {
    console.warn('Failed to fetch permits from Supabase:', err);
    return null;
  }
};

export const syncPermitsToSupabase = async (records: CsvPermitRecord[], replaceAll: boolean = false): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    if (replaceAll) {
      await client.from('permits').delete().not('id', 'is', null);
      await client.from('permits').delete().neq('id', '___non_existent___');

      const existing = await client.from('permits').select('id');
      if (existing.data && existing.data.length > 0) {
        const idsToDelete = existing.data.map(d => d.id).filter(Boolean);
        for (let i = 0; i < idsToDelete.length; i += 200) {
          const chunk = idsToDelete.slice(i, i + 200);
          await client.from('permits').delete().in('id', chunk);
        }
      }
    }

    if (records.length === 0) return true;

    const payload = records.map(r => ({
      id: r.id,
      hospital: r.hospital || '',
      ward: r.ward || '',
      date_required: r.dateRequired || '',
      date_expiry: resolveDateExpiry(r.dateRequired || '', r.dateExpiry || ''),
      vrm: r.vrm || '',
      driver_name: r.driverName || '',
      phone: r.phone || null,
      email: r.email || null,
      voucher_code: r.voucherCode || null,
      start_time: r.startTime || null
    }));

    const BATCH_SIZE = 400;
    let success = true;
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const chunk = payload.slice(i, i + BATCH_SIZE);
      const { error } = await client.from('permits').upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.warn(`Supabase sync permits error on batch starting at index ${i}:`, error.message);
        success = false;
      }
    }
    return success;
  } catch (err) {
    console.warn('Failed to sync permits to Supabase:', err);
    return false;
  }
};

// 2. Vouchers Table
export interface SupabaseVoucher {
  code: string;
  vrm?: string;
  valid_from?: string;
  valid_to?: string;
}

export const fetchVouchersFromSupabase = async (): Promise<ParsedVoucherData[] | null> => {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    let allData: SupabaseVoucher[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await client
        .from('vouchers')
        .select('code, vrm, valid_from, valid_to')
        .range(from, to);

      if (error) {
        console.warn('Supabase fetch vouchers error:', error.message);
        break;
      }

      if (data && data.length > 0) {
        allData = allData.concat(data as SupabaseVoucher[]);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    if (allData.length === 0) return [];

    const uniqueVouchers = new Map<string, ParsedVoucherData>();
    for (const item of allData) {
      if (!item.code) continue;
      const cleanCode = cleanVoucherCodeValue(item.code);
      const lower = cleanCode.toLowerCase();
      if (
        !cleanCode || 
        cleanCode === '-' || 
        lower === 'code' || 
        lower === 'voucher code' || 
        lower === 'vouchercode' || 
        lower === 'voucher_code' ||
        lower === 'vouchers' ||
        lower === 'qr code' ||
        lower === 'qrcode'
      ) {
        continue;
      }

      if (!uniqueVouchers.has(cleanCode)) {
        uniqueVouchers.set(cleanCode, {
          code: cleanCode,
          vrm: item.vrm || undefined,
          validFrom: item.valid_from || undefined,
          validTo: item.valid_to || undefined
        });
      }
    }

    return Array.from(uniqueVouchers.values());
  } catch (err) {
    console.warn('Failed to fetch vouchers from Supabase:', err);
    return null;
  }
};

export const syncVouchersToSupabase = async (vouchers: ParsedVoucherData[], replaceAll: boolean = false): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    if (replaceAll) {
      await client.from('vouchers').delete().not('code', 'is', null);
      await client.from('vouchers').delete().neq('code', '___non_existent___');

      const existing = await client.from('vouchers').select('code');
      if (existing.data && existing.data.length > 0) {
        const codesToDelete = existing.data.map(d => d.code).filter(Boolean);
        for (let i = 0; i < codesToDelete.length; i += 200) {
          const chunk = codesToDelete.slice(i, i + 200);
          await client.from('vouchers').delete().in('code', chunk);
        }
      }
    }

    const cleanPayloadMap = new Map<string, { code: string; vrm: string | null; valid_from: string | null; valid_to: string | null }>();
    for (const v of vouchers) {
      if (!v.code) continue;
      const cleanCode = cleanVoucherCodeValue(v.code);
      const lower = cleanCode.toLowerCase();
      if (
        !cleanCode || 
        cleanCode === '-' || 
        lower === 'code' || 
        lower === 'voucher code' || 
        lower === 'vouchercode' || 
        lower === 'voucher_code' ||
        lower === 'vouchers' ||
        lower === 'qr code' ||
        lower === 'qrcode'
      ) {
        continue;
      }

      if (!cleanPayloadMap.has(cleanCode)) {
        cleanPayloadMap.set(cleanCode, {
          code: cleanCode,
          vrm: v.vrm || null,
          valid_from: v.validFrom || null,
          valid_to: v.validTo || null
        });
      }
    }

    const payload = Array.from(cleanPayloadMap.values());
    if (payload.length === 0) return true;

    const BATCH_SIZE = 400;
    let success = true;
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const chunk = payload.slice(i, i + BATCH_SIZE);
      const { error } = await client.from('vouchers').upsert(chunk, { onConflict: 'code' });
      if (error) {
        console.warn(`Supabase sync vouchers error on batch starting at index ${i}:`, error.message);
        success = false;
      }
    }
    return success;
  } catch (err) {
    console.warn('Failed to sync vouchers to Supabase:', err);
    return false;
  }
};

// 3. Dispatched History Table
export interface SupabaseDispatched {
  key: string;
  dispatch_date: string;
  dispatch_by: string;
  vrm?: string;
  email?: string;
}

export const fetchDispatchedFromSupabase = async (): Promise<{
  dispatchedKeys: string[];
  dispatchDates: Record<string, string>;
  dispatchBy: Record<string, string>;
} | null> => {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    let allData: SupabaseDispatched[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await client
        .from('dispatched_history')
        .select('key, dispatch_date, dispatch_by')
        .range(from, to);

      if (error) {
        console.warn('Supabase fetch dispatched error:', error.message);
        break;
      }

      if (data && data.length > 0) {
        allData = allData.concat(data as SupabaseDispatched[]);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    const dispatchedKeys: string[] = [];
    const dispatchDates: Record<string, string> = {};
    const dispatchBy: Record<string, string> = {};

    allData.forEach((item: SupabaseDispatched) => {
      if (item && item.key) {
        const cleanKey = String(item.key).trim();
        if (cleanKey) {
          dispatchedKeys.push(cleanKey);
          if (item.dispatch_date) dispatchDates[cleanKey] = item.dispatch_date;
          if (item.dispatch_by) dispatchBy[cleanKey] = item.dispatch_by;
        }
      }
    });

    return { dispatchedKeys, dispatchDates, dispatchBy };
  } catch (err) {
    console.warn('Failed to fetch dispatched from Supabase:', err);
    return null;
  }
};

export const cleanupCorruptedDispatchedKeys = async (): Promise<{ count: number; deletedKeys: string[] }> => {
  const client = getSupabaseClient();
  if (!client) return { count: 0, deletedKeys: [] };

  try {
    const { data, error } = await client.from('dispatched_history').select('*');
    if (error || !data) return { count: 0, deletedKeys: [] };

    const invalidRows = data.filter((item: SupabaseDispatched) => {
      const k = (item.key || '').trim();
      if (!k) return true;
      if (/^\d{8}$/.test(k)) return true;
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return true;
      if (k.toUpperCase() === 'UNDEFINED' || k.toUpperCase() === 'NULL') return true;
      return false;
    });

    const deletedKeys: string[] = invalidRows.map((item: SupabaseDispatched) => item.key);

    if (deletedKeys.length > 0) {
      console.log('[Supabase Cleanup] Found corrupted/collision keys to purge:', deletedKeys);
      for (const badKey of deletedKeys) {
        const { error: delErr } = await client.from('dispatched_history').delete().eq('key', badKey);
        if (delErr) {
          console.error('[Supabase Cleanup Error] Failed to delete key:', badKey, delErr);
        } else {
          console.log('[Supabase Cleanup Success] Deleted corrupted key:', badKey);
        }
      }
    }

    return { count: deletedKeys.length, deletedKeys };
  } catch (err) {
    console.error('[Supabase Cleanup Exception]', err);
    return { count: 0, deletedKeys: [] };
  }
};

export const bulkSyncDispatchedToSupabase = async (
  dispatchedList: Array<{ key: string; date?: string; by?: string; vrm?: string; email?: string }>
): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client || !dispatchedList || dispatchedList.length === 0) return true;

  try {
    const payload = dispatchedList
      .filter(item => item && item.key && String(item.key).trim())
      .map(item => ({
        key: String(item.key).trim(),
        dispatch_date: item.date || new Date().toISOString().split('T')[0],
        dispatch_by: item.by || 'System User',
        vrm: item.vrm ? String(item.vrm).trim() : null,
        email: item.email ? String(item.email).trim() : null
      }));

    if (payload.length === 0) return true;

    const BATCH_SIZE = 400;
    let success = true;
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const chunk = payload.slice(i, i + BATCH_SIZE);
      const { error } = await client.from('dispatched_history').upsert(chunk, { onConflict: 'key' });
      if (error) {
        console.warn(`Supabase bulk sync dispatched error on batch starting at index ${i}:`, error.message);
        // Fallback with basic fields if extra column fails
        const basicChunk = chunk.map(c => ({
          key: c.key,
          dispatch_date: c.dispatch_date,
          dispatch_by: c.dispatch_by
        }));
        const { error: basicErr } = await client.from('dispatched_history').upsert(basicChunk, { onConflict: 'key' });
        if (basicErr) {
          console.error('Basic chunk upsert also failed:', basicErr.message);
          success = false;
        }
      }
    }
    return success;
  } catch (err) {
    console.error('Exception in bulkSyncDispatchedToSupabase:', err);
    return false;
  }
};

export const syncDispatchedToSupabase = async (
  key: string,
  date: string,
  by: string,
  vrm?: string,
  email?: string
): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client || !key || !key.trim()) {
    console.warn('syncDispatchedToSupabase called with invalid parameters:', { key, date, by });
    return false;
  }

  const cleanKey = String(key).trim();
  const dateVal = date || new Date().toISOString().split('T')[0];
  const byVal = by || 'System User';

  const fullPayload = {
    key: cleanKey,
    dispatch_date: dateVal,
    dispatch_by: byVal,
    vrm: vrm ? String(vrm).trim() : null,
    email: email ? String(email).trim() : null
  };

  try {
    console.log('[Supabase Write] Upserting dispatched record:', fullPayload);
    const { error } = await client.from('dispatched_history').upsert(fullPayload, { onConflict: 'key' });

    if (!error) {
      console.log('[Supabase Write Success] Upsert succeeded for key:', cleanKey);
      return true;
    }

    console.warn('[Supabase Write Warning] Full payload upsert error, attempting basic payload upsert:', error.message);

    const basicPayload = {
      key: cleanKey,
      dispatch_date: dateVal,
      dispatch_by: byVal
    };

    const { error: basicErr } = await client.from('dispatched_history').upsert(basicPayload, { onConflict: 'key' });

    if (!basicErr) {
      console.log('[Supabase Write Success] Basic payload upsert succeeded for key:', cleanKey);
      return true;
    }

    console.error('[Supabase Write Error] Basic payload upsert failed:', basicErr.message);
    return false;
  } catch (err) {
    console.error('[Supabase Write Exception] Exception in syncDispatchedToSupabase:', err);
    return false;
  }
};

export const deleteDispatchedFromSupabase = async (key: string): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client || !key || !key.trim()) return false;

  const cleanKey = String(key).trim();
  try {
    console.log('[Supabase Delete] Removing key from dispatched_history:', cleanKey);
    const { error } = await client.from('dispatched_history').delete().eq('key', cleanKey);
    if (error) {
      console.error('[Supabase Delete Error] Delete failed:', {
        code: error.code,
        message: error.message,
        key: cleanKey
      });
      return false;
    }
    console.log('[Supabase Delete Success] Deleted key:', cleanKey);
    return true;
  } catch (err) {
    console.error('[Supabase Delete Exception] Exception in deleteDispatchedFromSupabase:', err, cleanKey);
    return false;
  }
};

export const clearSupabaseDispatches = async (): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client.from('dispatched_history').delete().neq('key', '');
    if (error) {
      console.warn('Supabase clear dispatched error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Failed to clear dispatched from Supabase:', err);
    return false;
  }
};

export const subscribeToSupabaseChanges = (
  onChange: () => void
): (() => void) | null => {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedOnChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onChange();
      }, 500);
    };

    const channelName = `realtime-dispatches-${Math.random().toString(36).substring(2, 9)}`;
    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'permits' },
        debouncedOnChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vouchers' },
        debouncedOnChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatched_history' },
        debouncedOnChange
      )
      .subscribe((status) => {
        console.log(`[Supabase Realtime] Channel ${channelName} status:`, status);
      });

    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  } catch (err) {
    console.warn('Failed to subscribe to Supabase Realtime:', err);
    return null;
  }
};