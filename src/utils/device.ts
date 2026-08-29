export const isMobileDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  const isSmallScreen = window.innerWidth < 768;
  const hasTouch = "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  return isSmallScreen && hasTouch;
};
