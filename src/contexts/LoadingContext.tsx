import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface LoadingContextType {
  isLoading: boolean;
  loadingMessage: string;
  loadingProgress?: number;
  showLoading: (message: string, progress?: number) => void;
  hideLoading: () => void;
  updateProgress: (progress: number) => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export const useLoading = () => {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error("useLoading must be used within a LoadingProvider");
  }
  return context;
};

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Loading...");
  const [loadingProgress, setLoadingProgress] = useState<number | undefined>(undefined);

  const showLoading = useCallback((message: string, progress?: number) => {
    setLoadingMessage(message);
    setLoadingProgress(progress);
    setIsLoading(true);
  }, []);

  const hideLoading = useCallback(() => {
    setIsLoading(false);
    setLoadingMessage("Loading...");
    setLoadingProgress(undefined);
  }, []);

  const updateProgress = useCallback((progress: number) => {
    setLoadingProgress(Math.min(100, Math.max(0, progress)));
  }, []);

  return (
    <LoadingContext.Provider
      value={{
        isLoading,
        loadingMessage,
        loadingProgress,
        showLoading,
        hideLoading,
        updateProgress
      }}
    >
      {children}
      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 transition-all duration-200 animate-in fade-in"
        >
          <div className="bg-white dark:bg-[#07172b] border border-slate-200 dark:border-[#193b61] rounded-2xl p-7 max-w-sm w-full shadow-2xl flex flex-col items-center gap-4 text-center">
            {/* Animated Spinner Icon */}
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>

            {/* Message */}
            <div className="space-y-1 w-full">
              <p className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                {loadingMessage}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Please wait while we process your request...
              </p>
            </div>

            {/* Optional Progress Bar */}
            {loadingProgress !== undefined && (
              <div className="w-full pt-1">
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/60 dark:border-slate-700/60">
                  <div
                    className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-200 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 mt-1.5 px-0.5">
                  <span>Progress</span>
                  <span>{Math.round(loadingProgress)}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  );
};
