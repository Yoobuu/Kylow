import { useCallback, useEffect, useRef } from "react";

export default function useAbortableRequest() {
  const controllerRef = useRef(null);

  const start = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  }, []);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { start, abort };
}
