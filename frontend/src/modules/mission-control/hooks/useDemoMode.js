import { useEffect, useMemo, useRef, useState } from "react";

const STEP_MS_BASE = 3800;
const STEP_MS_JITTER = 1200;

const isPoweredOn = (value) => String(value || "").toUpperCase() === "POWERED_ON";

const scoreVm = (vm) => {
  const cpu = Number(vm.cpu_usage_pct || 0);
  const ram = Number(vm.ram_usage_pct || 0);
  const high = cpu >= 85 || ram >= 85;
  const powered = isPoweredOn(vm.power_state);
  return (powered ? 2 : 0) + (high ? 1 : 0) + (cpu + ram) / 200;
};

const pickNode = (nodes, fallback) => nodes && nodes.length ? nodes[0] : fallback;

const cameraScaleFor = (type) => {
  if (type === "env") return 0.7;
  if (type === "cluster") return 1.1;
  if (type === "host") return 1.6;
  if (type === "vm") return 2.6;
  return 1;
};

const buildTour = ({ nodes, envKpis }) => {
  if (!nodes || !nodes.length) return [];
  const positioned = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!positioned.length) return [];

  const envNodes = positioned.filter((n) => n.type === "env");
  const envTarget =
    envNodes.reduce((best, node) => {
      const meta = envKpis?.[node.environment] || node.meta || {};
      const score = meta.on ?? meta.total ?? 0;
      if (!best || score > best.score) return { node, score };
      return best;
    }, null)?.node || pickNode(envNodes);

  const clusterNodes = positioned.filter(
    (n) => n.type === "cluster" && (!envTarget || n.envId === envTarget.id)
  );
  const clusterTarget =
    clusterNodes.reduce((best, node) => {
      const score = node.meta?.on ?? node.meta?.total ?? 0;
      if (!best || score > best.score) return { node, score };
      return best;
    }, null)?.node || pickNode(clusterNodes);

  const hostNodes = positioned.filter(
    (n) => n.type === "host" && (!clusterTarget || n.clusterId === clusterTarget.id)
  );
  const hostTarget =
    hostNodes.reduce((best, node) => {
      const score = node.meta?.vmCount ?? 0;
      if (!best || score > best.score) return { node, score };
      return best;
    }, null)?.node || pickNode(hostNodes);

  const vmNodes = positioned
    .filter((n) => n.type === "vm" && (!hostTarget || n.hostId === hostTarget.id))
    .sort((a, b) => scoreVm(b) - scoreVm(a))
    .slice(0, 3);

  const steps = [];
  [envTarget, clusterTarget, hostTarget, ...vmNodes].forEach((node) => {
    if (!node) return;
    steps.push({
      id: node.id,
      node,
      cameraTarget: { x: node.x, y: node.y, scale: cameraScaleFor(node.type) },
      nowShowingText: `${node.type.toUpperCase()}: ${node.name}`,
    });
  });

  return steps;
};

export function useDemoMode({ enabled, nodes, kpis, envKpis }) {
  const [internalEnabled, setInternalEnabled] = useState(Boolean(enabled));
  const [stepIndex, setStepIndex] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState(null);
  const [cameraTarget, setCameraTarget] = useState(null);
  const [nowShowingText, setNowShowingText] = useState("");
  const timerRef = useRef(null);

  const isControlled = typeof enabled === "boolean";
  const active = isControlled ? Boolean(enabled) : internalEnabled;

  useEffect(() => {
    if (isControlled) {
      setInternalEnabled(Boolean(enabled));
    }
  }, [enabled, isControlled]);

  const steps = useMemo(() => buildTour({ nodes, kpis, envKpis }), [nodes, kpis, envKpis]);

  useEffect(() => {
    if (!active || !steps.length) {
      setFocusNodeId(null);
      setCameraTarget(null);
      setNowShowingText("");
      setStepIndex(0);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return undefined;
    }

    let cancelled = false;
    let idx = 0;

    const run = () => {
      if (cancelled) return;
      const step = steps[idx % steps.length];
      setFocusNodeId(step.id);
      setCameraTarget(step.cameraTarget);
      setNowShowingText(step.nowShowingText);
      setStepIndex(idx);
      idx += 1;
      const jitter = Math.floor(Math.random() * STEP_MS_JITTER);
      timerRef.current = setTimeout(run, STEP_MS_BASE + jitter);
    };

    run();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, steps]);

  const start = () => {
    if (isControlled) return;
    setInternalEnabled(true);
  };
  const stop = () => {
    if (isControlled) return;
    setInternalEnabled(false);
  };
  const toggle = () => {
    if (isControlled) return;
    setInternalEnabled((prev) => !prev);
  };

  return {
    enabled: active,
    focusNodeId,
    cameraTarget,
    nowShowingText,
    stepIndex,
    start,
    stop,
    toggle,
  };
}
