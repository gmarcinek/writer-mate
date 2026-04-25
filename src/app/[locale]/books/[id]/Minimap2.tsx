"use client";

import { useEffect, useRef, useCallback } from "react";
import type { RefObject } from "react";
import styles from "./Minimap.module.scss";

const MINIMAP_CONFIG = {
  width: 90,
  contentScale: 0.15,
  maxCanvasDeviceHeight: 32000,
  barHeightRatio: 0.6,
  charWidthHeading: 7,
  charWidthText: 6,
  padX: 4,
  colors: {
    background: "#00000013",
    heading: "rgba(143, 109, 109, 0.75)",
    text: "rgba(180,170,210,0.45)",
    viewportFill: "rgba(94,48,192,0.12)",
    viewportStroke: "rgba(124,92,191,0.8)",
  },
};

type MinimapProps = {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
};

export default function Minimap({ scrollContainerRef }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);
  const offsetRef = useRef(0);
  const scaleRef = useRef(MINIMAP_CONFIG.contentScale);

  const draw = useCallback(() => {
    const container = scrollContainerRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;

    if (!container || !canvas || !wrap) return;

    const {
      width,
      contentScale,
      maxCanvasDeviceHeight,
      barHeightRatio,
      charWidthHeading,
      charWidthText,
      padX,
      colors,
    } = MINIMAP_CONFIG;

    const scrollHeight = Math.max(container.scrollHeight, 1);
    const clientHeight = container.clientHeight;
    const scrollTop = container.scrollTop;
    const wrapperHeight = wrap.clientHeight;

    if (wrapperHeight <= 0 || clientHeight <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Nie pozwalamy, żeby canvas przekroczył praktyczne limity przeglądarki.
    const maxCanvasCssHeight = Math.floor(maxCanvasDeviceHeight / dpr);
    const effectiveScale = Math.min(
      contentScale,
      maxCanvasCssHeight / scrollHeight
    );

    scaleRef.current = effectiveScale;

    const canvasCssHeight = Math.max(
      scrollHeight * effectiveScale,
      wrapperHeight
    );

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(canvasCssHeight * dpr);

    canvas.style.width = `${width}px`;
    canvas.style.height = `${canvasCssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, canvasCssHeight);

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, canvasCssHeight);

    const contentEl = container.querySelector(
      "[data-minimap-content]"
    ) as HTMLElement | null;

    if (contentEl) {
      const text = contentEl.innerText || "";
      const lines = text.split("\n");
      const lineCount = Math.max(lines.length, 1);
      const actualLineHeight = contentEl.scrollHeight / lineCount;

      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const y = i * actualLineHeight * effectiveScale;
        if (y > canvasCssHeight) return;

        const barH = Math.max(
          1,
          actualLineHeight * effectiveScale * barHeightRatio
        );

        const isHeading = trimmed.startsWith("#");
        const charWidth = isHeading ? charWidthHeading : charWidthText;
        const barW = Math.min(
          trimmed.length * charWidth * effectiveScale,
          width - padX * 2
        );

        ctx.fillStyle = isHeading ? colors.heading : colors.text;
        ctx.fillRect(padX, y, Math.max(1, barW), isHeading ? barH + 1 : barH);
      });
    }

    const vpTop = scrollTop * effectiveScale;
    const vpHeight = Math.max(2, clientHeight * effectiveScale);

    ctx.fillStyle = colors.viewportFill;
    ctx.fillRect(0, vpTop, width, vpHeight);

    ctx.strokeStyle = colors.viewportStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      0.75,
      vpTop + 0.75,
      width - 1.5,
      Math.max(vpHeight - 1.5, 2)
    );

    const idealOffset = vpTop - (wrapperHeight - vpHeight) / 2;
    const maxOffset = Math.max(0, canvasCssHeight - wrapperHeight);
    const offset = Math.max(0, Math.min(idealOffset, maxOffset));

    canvas.style.transform = `translateY(-${offset}px)`;
    offsetRef.current = offset;
  }, [scrollContainerRef]);

  const seekTo = useCallback(
    (clientY: number) => {
      const container = scrollContainerRef.current;
      const wrap = wrapRef.current;

      if (!container || !wrap) return;

      const rect = wrap.getBoundingClientRect();
      const scale = scaleRef.current || MINIMAP_CONFIG.contentScale;

      const canvasY = clientY - rect.top + offsetRef.current;
      const targetScrollTop = canvasY / scale - container.clientHeight / 2;

      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight
      );

      container.scrollTo({
        top: Math.max(0, Math.min(targetScrollTop, maxScrollTop)),
        behavior: "auto",
      });
    },
    [scrollContainerRef]
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const requestDraw = () => {
      if (rafId !== null) return;

      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        draw();
      });
    };

    requestDraw();

    container.addEventListener("scroll", requestDraw, { passive: true });

    const resizeObserver = new ResizeObserver(requestDraw);
    resizeObserver.observe(container);

    if (wrapRef.current) {
      resizeObserver.observe(wrapRef.current);
    }

    const mutationObserver = new MutationObserver(requestDraw);
    mutationObserver.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => {
      container.removeEventListener("scroll", requestDraw);
      resizeObserver.disconnect();
      mutationObserver.disconnect();

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [draw, scrollContainerRef]);

  return (
    <div
      ref={wrapRef}
      className={styles.wrapper}
      style={{
        width: `${MINIMAP_CONFIG.width}px`,
        touchAction: "none",
      }}
      onWheel={(e) => {
        e.preventDefault();

        const container = scrollContainerRef.current;
        if (!container) return;

        container.scrollBy({
          top: e.deltaY,
          behavior: "auto",
        });
      }}
      onPointerDown={(e) => {
        e.preventDefault();

        isDraggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientY);
      }}
      onPointerMove={(e) => {
        if (!isDraggingRef.current) return;
        seekTo(e.clientY);
      }}
      onPointerUp={(e) => {
        isDraggingRef.current = false;

        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        isDraggingRef.current = false;
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          willChange: "transform",
        }}
      />
    </div>
  );
}