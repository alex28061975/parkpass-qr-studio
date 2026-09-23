import { useState, useEffect, RefObject } from "react";

interface TableVirtualizerOptions {
  totalCount: number;
  estimateRowHeight?: number;
  overscan?: number;
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
}

export interface TableVirtualizerResult {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  isVirtual: boolean;
}

/**
 * Lightweight, zero-dependency row virtualization hook for table rows.
 * Computes visible slice using container or window scroll offsets and fixed row heights,
 * preserving exact semantic <table> structure via top/bottom spacer <tr> elements.
 */
export function useTableVirtualizer({
  totalCount,
  estimateRowHeight = 48,
  overscan = 20,
  containerRef,
  enabled = true
}: TableVirtualizerOptions): TableVirtualizerResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  useEffect(() => {
    if (!enabled || totalCount === 0) return;

    let ticking = false;

    const updateMetrics = () => {
      const el = containerRef.current;
      if (!el) {
        ticking = false;
        return;
      }

      // Check if container itself has scrollable overflow
      if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
        setScrollTop(el.scrollTop);
        setViewportHeight(el.clientHeight);
      } else {
        // Window scroll mode: compute container offset relative to viewport
        const rect = el.getBoundingClientRect();
        const topOffset = -rect.top;
        setScrollTop(Math.max(0, topOffset));
        setViewportHeight(window.innerHeight);
      }
      ticking = false;
    };

    const handleScrollOrResize = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateMetrics);
        ticking = true;
      }
    };

    updateMetrics();

    window.addEventListener("scroll", handleScrollOrResize, { passive: true });
    window.addEventListener("resize", handleScrollOrResize, { passive: true });
    const el = containerRef.current;
    if (el) {
      el.addEventListener("scroll", handleScrollOrResize, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);
      if (el) {
        el.removeEventListener("scroll", handleScrollOrResize);
      }
    };
  }, [enabled, totalCount, containerRef]);

  if (!enabled || totalCount === 0) {
    return {
      startIndex: 0,
      endIndex: totalCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      isVirtual: false
    };
  }

  const rawStartIndex = Math.floor(scrollTop / estimateRowHeight);
  const visibleCount = Math.ceil(viewportHeight / estimateRowHeight);

  const startIndex = Math.max(0, rawStartIndex - overscan);
  const endIndex = Math.min(totalCount, rawStartIndex + visibleCount + overscan);

  const topSpacerHeight = startIndex * estimateRowHeight;
  const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * estimateRowHeight);

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    isVirtual: true
  };
}
