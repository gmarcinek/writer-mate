"use client";

import { useEffect, useRef, useCallback } from "react";
import styles from "./Minimap.module.scss";

const MINIMAP_CONFIG = {
  width: 90,
  contentScale: 0.15,
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

export default function Minimap({
  scrollContainerRef,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Stan potrzebny obsłudze myszy — aktualizowany w draw()
  const offsetRef = useRef(0);     // ile canvas jest przesunięty względem wrappera
  const vpHeightRef = useRef(0);   // wysokość slidera w px canvasa/wrappera

  // Throttle rysowania do rAF
  const rafIdRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const container = scrollContainerRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!container || !canvas || !wrap) return;

    const {
      width, contentScale, barHeightRatio,
      charWidthHeading, charWidthText, padX, colors,
    } = MINIMAP_CONFIG;

    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const scrollTop = container.scrollTop;
    const wrapperHeight = wrap.clientHeight;
    if (wrapperHeight === 0) return;

    // Canvas zawsze reprezentuje CAŁY dokument w stałej skali
    const canvasHeight = Math.max(scrollHeight * contentScale, wrapperHeight);

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, canvasHeight);

    // Linie tekstu
    const contentEl = container.querySelector("[data-minimap-content]") as HTMLElement | null;
    if (contentEl) {
      const lines = contentEl.innerText.split("\n");
      const actualLineHeight = contentEl.scrollHeight / Math.max(lines.length, 1);
      const innerW = width - padX * 2;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const y = i * actualLineHeight * contentScale;
        if (y > canvasHeight) break;
        const barH = Math.max(1, actualLineHeight * contentScale * barHeightRatio);
        if (line.startsWith("#")) {
          ctx.fillStyle = colors.heading;
          ctx.fillRect(padX, y, Math.min(line.length * charWidthHeading * contentScale, innerW), barH + 1);
        } else if (line.trim().length > 0) {
          ctx.fillStyle = colors.text;
          ctx.fillRect(padX, y, Math.min(line.length * charWidthText * contentScale, innerW), barH);
        }
      }
    }

    // Slider (aktualny viewport) — pozycja w canvasie
    const vpTop = scrollTop * contentScale;
    const vpHeight = clientHeight * contentScale;

    ctx.fillStyle = colors.viewportFill;
    ctx.fillRect(0, vpTop, width, vpHeight);
    ctx.strokeStyle = colors.viewportStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, vpTop + 0.75, width - 1.5, Math.max(vpHeight - 1.5, 2));

    // VS Code-style proporcjonalny offset:
    // slider płynnie wędruje od góry do dołu wrappera wraz ze scrollem dokumentu.
    // Niezmiennik: vpTop_wrapper / (wrapperHeight - vpHeight) === scrollTop / maxScroll
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const maxOffset = Math.max(0, canvasHeight - wrapperHeight);
    const scrollRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));
    const offset = scrollRatio * maxOffset;

    canvas.style.transform = `translateY(-${offset}px)`;
    offsetRef.current = offset;
    vpHeightRef.current = vpHeight;
  }, [scrollContainerRef]);

  const scheduleDraw = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      draw();
    });
  }, [draw]);

  // Pozycja w wrapperze → scrollTop dokumentu.
  // grabOffset = ile px od górnej krawędzi slidera trzymamy "pod kursorem".
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
    draw();
    const onScroll = () => scheduleDraw();
    container.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => scheduleDraw());
    ro.observe(container);
    if (wrapRef.current) ro.observe(wrapRef.current);
    // Repaint jeżeli treść (długość) się zmienia
    const contentEl = container.querySelector("[data-minimap-content]");
    let mo: MutationObserver | null = null;
    if (contentEl) {
      mo = new MutationObserver(() => scheduleDraw());
      mo.observe(contentEl, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      container.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo?.disconnect();
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [draw, scheduleDraw, scrollContainerRef]);

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

        // Aktualna pozycja slidera w wrapperze
        const sliderTopInCanvas = container.scrollTop * MINIMAP_CONFIG.contentScale;
        const sliderTopInWrapper = sliderTopInCanvas - offsetRef.current;

        // Czy klik trafił w slider?
        const onSlider =
          wrapperY0 >= sliderTopInWrapper && wrapperY0 <= sliderTopInWrapper + vpHeight;

        let grabOffset: number;
        if (onSlider) {
          // Zachowaj punkt uchwytu (slider "klei się" do kursora w tym samym miejscu)
          grabOffset = wrapperY0 - sliderTopInWrapper;
        } else {
          // Klik poza sliderem — wyśrodkuj slider pod kursorem i jumpuj
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
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width: `${MINIMAP_CONFIG.width}px`, cursor: "pointer" }}
      />
    </div>
  );
}