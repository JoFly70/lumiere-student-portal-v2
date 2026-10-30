import { useEffect } from "react";

/**
 * Publishes the docked sidebar's width as `--aa-side` on <html>, so a fixed bottom-left button can sit at the
 * bottom-left of the CONTENT area (never on top of the sidebar's account card). 0 on phones, where the sidebar is
 * an off-canvas sheet. Tracks the open sidebar, the icon rail and window resizes.
 */
export function useSidebarOffset(): void {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    let ro: ResizeObserver | null = null;
    let timer: number | undefined;
    let tries = 0;
    const apply = () => {
      const gap = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const w = gap && window.innerWidth >= 768 ? Math.round(gap.getBoundingClientRect().width) : 0;
      root.style.setProperty("--aa-side", `${w}px`);
    };
    const attach = () => {
      const gap = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      if (!gap) { if (tries++ < 30) timer = window.setTimeout(attach, 100); return; }
      apply();
      if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(apply); ro.observe(gap); }
    };
    attach();
    window.addEventListener("resize", apply);
    return () => {
      window.clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--aa-side");
    };
  }, []);
}
