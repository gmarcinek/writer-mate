"use client";

import { useEffect, useRef, useCallback } from "react";
import styles from "./Minimap.module.scss";

const MINIMAP_CONFIG = {
  width: 110,
  pad: 1,
  colors: {
    background: "#b8b8b8",
    viewportFill: "rgba(116, 73, 110, 0.25)",
    viewportStroke: "rgba(124,92,191,0.8)",
  },
};

export default function Minimap({
  scrollContainerRef,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const cloneHostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement | null>(null);
  const offsetRef = useRef(0);
  const vpHeightRef = useRef(0);
  const scaleRef = useRef(1);
  const rafIdRef = useRef<number | null>(null);
  const syncRafIdRef = useRef<number | null>(null);

  const findSource = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return null;
    return container.querySelector("[data-minimap-source]") as HTMLElement | null;
  }, [scrollContainerRef]);

  const layout = useCallback(() => {
    const container = scrollContainerRef.current;
    const wrap = wrapRef.current;
    const thumb = thumbRef.current;
    const viewport = viewportRef.current;
    const source = sourceRef.current ?? findSource();
    if (!container || !wrap || !thumb || !viewport || !source) return;

    sourceRef.current = source;

    const { width, pad, colors } = MINIMAP_CONFIG;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const scrollTop = container.scrollTop;
    const wrapperHeight = wrap.clientHeight;
    if (wrapperHeight === 0) return;

    const containerRect = container.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const sourceWidth = Math.max(1, sourceRect.width);
    const sourceHeight = Math.max(1, sourceRect.height);
    const contentScale = Math.min(1, (width - pad * 2) / sourceWidth);
    scaleRef.current = contentScale;

    const virtualHeight = Math.max(scrollHeight * contentScale, wrapperHeight);
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const maxOffset = Math.max(0, virtualHeight - wrapperHeight);
    const scrollRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));
    const offset = scrollRatio * maxOffset;

    const sourceTop = sourceRect.top - containerRect.top + scrollTop;
    const thumbWidth = sourceWidth * contentScale;
    const thumbLeft = (width - thumbWidth) / 2;
    const thumbTop = sourceTop * contentScale - offset;

    thumb.style.width = `${sourceWidth}px`;
    thumb.style.height = `${sourceHeight}px`;
    thumb.style.transformOrigin = "top left";
    thumb.style.transform = `translate(${thumbLeft}px, ${thumbTop}px) scale(${contentScale})`;

    const vpTop = scrollTop * contentScale - offset;
    const vpHeight = clientHeight * contentScale;
    viewport.style.top = `${vpTop}px`;
    viewport.style.height = `${vpHeight}px`;
    viewport.style.background = colors.viewportFill;
    viewport.style.border = `1.5px solid ${colors.viewportStroke}`;

    offsetRef.current = offset;
    vpHeightRef.current = vpHeight;
  }, [findSource, scrollContainerRef]);

  const syncClone = useCallback(() => {
    const host = cloneHostRef.current;
    const source = findSource();
    if (!host || !source) return;

    sourceRef.current = source;

    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-minimap-source");
    clone.setAttribute("aria-hidden", "true");
    clone.style.margin = "0";
    clone.style.maxWidth = "none";
    clone.style.pointerEvents = "none";
    clone.style.userSelect = "none";

    host.replaceChildren(clone);
    layout();
  }, [findSource, layout]);

  const scheduleLayout = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      layout();
    });
  }, [layout]);

  const scheduleSync = useCallback(() => {
    if (syncRafIdRef.current !== null) return;
    syncRafIdRef.current = requestAnimationFrame(() => {
      syncRafIdRef.current = null;
      syncClone();
    });
  }, [syncClone]);

  const wrapperYToScrollTop = useCallback((wrapperY: number, grabOffset: number) => {
    const container = scrollContainerRef.current;
    const wrap = wrapRef.current;
    if (!container || !wrap) return 0;
    const wrapperHeight = wrap.clientHeight;
    const vpHeight = vpHeightRef.current;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const sliderTrack = Math.max(1, wrapperHeight - vpHeight);
    const targetVpTopInWrapper = Math.max(0, Math.min(sliderTrack, wrapperY - grabOffset));
    const ratio = targetVpTopInWrapper / sliderTrack;
    return ratio * maxScroll;
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    syncClone();

    const onScroll = () => scheduleLayout();
    container.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => scheduleLayout());
    ro.observe(container);
    if (wrapRef.current) ro.observe(wrapRef.current);

    const source = findSource();
    if (source) ro.observe(source);

    const mo = new MutationObserver(() => scheduleSync());
    if (source) {
      mo.observe(source, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      container.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      if (syncRafIdRef.current !== null) cancelAnimationFrame(syncRafIdRef.current);
    };
  }, [findSource, scheduleLayout, scheduleSync, scrollContainerRef, syncClone]);

  return (
    <div
      ref={wrapRef}
      className={styles.wrapper}
      style={{ width: `${MINIMAP_CONFIG.width}px` }}
      onWheel={(e) => {
        const container = scrollContainerRef.current;
        if (!container) return;
        e.preventDefault();
        container.scrollBy({ top: e.deltaY, behavior: "auto" });
      }}
      onMouseDown={(e) => {
        const container = scrollContainerRef.current;
        const wrap = wrapRef.current;
        if (!container || !wrap) return;
        e.preventDefault();

        const rect = wrap.getBoundingClientRect();
        const wrapperY0 = e.clientY - rect.top;
        const vpHeight = vpHeightRef.current;
        const sliderTopInWrapper = container.scrollTop * scaleRef.current - offsetRef.current;
        const onSlider =
          wrapperY0 >= sliderTopInWrapper && wrapperY0 <= sliderTopInWrapper + vpHeight;

        let grabOffset: number;
        if (onSlider) {
          grabOffset = wrapperY0 - sliderTopInWrapper;
        } else {
          grabOffset = vpHeight / 2;
          container.scrollTo({
            top: wrapperYToScrollTop(wrapperY0, grabOffset),
            behavior: "auto",
          });
        }

        const onMove = (ev: MouseEvent) => {
          const newWrapperY = ev.clientY - rect.top;
          container.scrollTo({
            top: wrapperYToScrollTop(newWrapperY, grabOffset),
            behavior: "auto",
          });
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      <div
        ref={thumbRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          willChange: "transform",
          boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        }}
      >
        <div ref={cloneHostRef} style={{ pointerEvents: "none" }} />
      </div>
      <div
        ref={viewportRef}
        style={{
          position: "absolute",
          left: 0,
          width: "100%",
          pointerEvents: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}