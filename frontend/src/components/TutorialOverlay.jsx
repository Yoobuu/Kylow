import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTutorial } from "../context/TutorialContext";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getTargetElement = (targetId) => {
  if (!targetId) return null;
  return document.querySelector(`[data-tutorial-id="${targetId}"]`);
};

export default function TutorialOverlay() {
  const { isOpen, steps, stepIndex, nextStep, prevStep, stopTour } = useTutorial();
  const step = steps[stepIndex];
  const [rect, setRect] = useState(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    let raf = null;

    const updateRect = () => {
      if (!step?.target) {
        setRect(null);
        setTargetMissing(true);
        return;
      }
      const el = getTargetElement(step.target);
      if (!el) {
        setRect(null);
        setTargetMissing(true);
        return;
      }
      setTargetMissing(false);
      const nextRect = el.getBoundingClientRect();
      setRect(nextRect);
    };

    const scrollToTarget = () => {
      if (!step?.target) return;
      const el = getTargetElement(step.target);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    };

    scrollToTarget();
    updateRect();

    const handleScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        updateRect();
        raf = null;
      });
    };

    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen, step]);

  if (!isOpen || !step) return null;

  const showPrev = stepIndex > 0;
  const showNext = stepIndex < steps.length - 1;

  const highlight = rect
    ? {
        top: clamp(rect.top - 6, 8, window.innerHeight - 8),
        left: clamp(rect.left - 6, 8, window.innerWidth - 8),
        width: clamp(rect.width + 12, 32, window.innerWidth - 16),
        height: clamp(rect.height + 12, 32, window.innerHeight - 16),
      }
    : null;

  const overlayBlocks = highlight
    ? [
        { top: 0, left: 0, width: "100%", height: highlight.top },
        {
          top: highlight.top,
          left: 0,
          width: highlight.left,
          height: highlight.height,
        },
        {
          top: highlight.top,
          left: highlight.left + highlight.width,
          width: `calc(100% - ${highlight.left + highlight.width}px)`,
          height: highlight.height,
        },
        {
          top: highlight.top + highlight.height,
          left: 0,
          width: "100%",
          height: `calc(100% - ${highlight.top + highlight.height}px)`,
        },
      ]
    : [
        { top: 0, left: 0, width: "100%", height: "100%" },
      ];

  const placement = step.placement || "bottom";
  const popoverStyle = () => {
    if (!highlight) {
      return { top: "20%", left: "50%", transform: "translateX(-50%)" };
    }
    const margin = 14;
    const base = { top: highlight.top, left: highlight.left };
    switch (placement) {
      case "left":
        return { top: highlight.top, left: Math.max(16, highlight.left - 320 - margin) };
      case "right":
        return { top: highlight.top, left: highlight.left + highlight.width + margin };
      case "top":
        return { top: Math.max(16, highlight.top - 220 - margin), left: base.left };
      case "bottom":
      default:
        return { top: highlight.top + highlight.height + margin, left: base.left };
    }
  };

  const stepCountLabel = `${stepIndex + 1} / ${steps.length}`;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {overlayBlocks.map((block, index) => (
        <div
          key={index}
          className="absolute bg-white/70"
          style={block}
          onClick={stopTour}
        />
      ))}
      {highlight && (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-[#E11B22] shadow-[0_0_0_2px_rgba(225,27,34,0.2)]"
          style={highlight}
        />
      )}
      <div
        ref={popoverRef}
        className="absolute max-w-xs rounded-2xl border border-[#E1D6C8] bg-white p-4 text-[#231F20] shadow-2xl"
        style={popoverStyle()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#6b6b6b]">Tutorial</p>
            <h3 className="text-base font-semibold text-[#231F20]">{step.title}</h3>
          </div>
          <button
            type="button"
            onClick={stopTour}
            className="rounded-full border border-[#D6C7B8] px-2 py-1 text-xs text-[#231F20] transition hover:border-[#E11B22]"
          >
            X
          </button>
        </div>
        <p className="mt-2 text-sm text-[#231F20]">
          {targetMissing ? "No se encontró el elemento. Desplázate o prueba de nuevo." : step.body}
        </p>
        <div className="mt-4 flex items-center justify-between text-xs text-[#6b6b6b]">
          <span>{stepCountLabel}</span>
          <div className="flex items-center gap-2">
            {showPrev && (
              <button
                type="button"
                onClick={prevStep}
                className="rounded-full border border-[#D6C7B8] px-3 py-1 text-[#231F20] transition hover:border-[#E11B22]"
              >
                Anterior
              </button>
            )}
            {showNext ? (
              <button
                type="button"
                onClick={nextStep}
                className="rounded-full bg-[#E11B22] px-3 py-1 font-semibold text-white transition hover:bg-[#c9161c]"
              >
                Siguiente
              </button>
            ) : (
              <button
                type="button"
                onClick={stopTour}
                className="rounded-full bg-[#E11B22] px-3 py-1 font-semibold text-white transition hover:bg-[#c9161c]"
              >
                Finalizar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
