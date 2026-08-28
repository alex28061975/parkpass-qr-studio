const memStore: Record<string, string> = {};

export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      // In some environments, even referencing localStorage can throw, so guard it
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      // Ignore security/access errors
    }
    return memStore[key] !== undefined ? memStore[key] : null;
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch (e) {
      // Ignore security/access errors
    }
    memStore[key] = String(value);
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
    } catch (e) {
      // Ignore security/access errors
    }
    delete memStore[key];
  },
  clear: (): void => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.clear();
        return;
      }
    } catch (e) {
      // Ignore security/access errors
    }
    for (const k in memStore) {
      delete memStore[k];
    }
  }
};
