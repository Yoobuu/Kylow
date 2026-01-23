import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { tours } from "../tutorials";

const TutorialContext = createContext(null);

export function TutorialProvider({ children }) {
  const [activeTour, setActiveTour] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = useMemo(() => {
    if (!activeTour) return [];
    return Array.isArray(tours[activeTour]) ? tours[activeTour] : [];
  }, [activeTour]);

  const startTour = useCallback((key) => {
    if (!tours[key]) return;
    setActiveTour(key);
    setStepIndex(0);
  }, []);

  const stopTour = useCallback(() => {
    setActiveTour(null);
    setStepIndex(0);
  }, []);

  const nextStep = useCallback(() => {
    setStepIndex((prev) => {
      if (!steps.length) return prev;
      const next = prev + 1;
      if (next >= steps.length) {
        return prev;
      }
      return next;
    });
  }, [steps.length]);

  const prevStep = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const value = useMemo(
    () => ({
      activeTour,
      stepIndex,
      steps,
      isOpen: Boolean(activeTour && steps.length),
      startTour,
      stopTour,
      nextStep,
      prevStep,
      setStepIndex,
    }),
    [activeTour, stepIndex, steps, startTour, stopTour, nextStep, prevStep],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error("useTutorial must be used within TutorialProvider");
  }
  return ctx;
}
