import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AtlasLegend from "./AtlasLegend";

const LOD_THRESHOLDS = {
  far: 0.9,
  near: 2.2,
};

const VM_BADGE_THRESHOLD = 24;

const ENV_TONES = ["--mc-emerald", "--mc-cyan", "--mc-amber", "--mc-indigo", "--mc-rose"];

const TYPE_ALPHA = {
  env: 0.95,
  provider: 0.85,
  cluster: 0.78,
  host: 0.62,
  vm: 0.42,
};

const BASE_SIZES = {
  env: 46,
  provider: 28,
  cluster: 24,
  host: 14,
  vm: 5,
};

const LABEL_MAX_CHARS = 22;

const truncateLabel = (value, max = LABEL_MAX_CHARS) => {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

const PROVIDER_LABELS = {
  vmware: "VMware",
  hyperv: "Hyper-V",
  ovirt: "oVirt",
  cedia: "CEDIA",
  unknown: "Unknown",
};

const formatProvider = (value) => {
  const key = String(value || "").toLowerCase();
  return PROVIDER_LABELS[key] || value || "—";
};

const drawPolygon = (ctx, x, y, sides, radius) => {
  if (sides < 3) return;
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
};

const drawLabelPill = (ctx, text, x, y, scale) => {
  if (!text) return;
  const fontSize = 12 / scale;
  const paddingX = 6 / scale;
  const paddingY = 3 / scale;
  ctx.font = `${fontSize}px 'Inter', sans-serif`;
  const metrics = ctx.measureText(text);
  const width = metrics.width + paddingX * 2;
  const height = fontSize + paddingY * 2;
  const left = x - width / 2;
  const top = y - height / 2;
  const radius = 6 / scale;

  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + width, top, left + width, top + height, radius);
  ctx.arcTo(left + width, top + height, left, top + height, radius);
  ctx.arcTo(left, top + height, left, top, radius);
  ctx.arcTo(left, top, left + width, top, radius);
  ctx.closePath();
  ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1 / scale;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(226, 232, 240, 0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
};

const hashString = (value) => {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const pickEnvTone = (node, palette, fallback) => {
  const key = node.environment || node.envId || node.id || "env";
  if (!palette.length) return fallback;
  const idx = hashString(key) % palette.length;
  return palette[idx] || fallback;
};

const computeLod = (scale) => {
  if (scale < LOD_THRESHOLDS.far) return "far";
  if (scale < LOD_THRESHOLDS.near) return "mid";
  return "near";
};

const formatPct = (value) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
};

const buildLayout = ({ nodes, links, width, height }) => {
  if (!width || !height) {
    return { nodes: [], links: [], stats: {} };
  }

  const envs = nodes.filter((n) => n.type === "env").sort((a, b) => a.name.localeCompare(b.name));
  const providers = nodes.filter((n) => n.type === "provider").sort((a, b) => a.name.localeCompare(b.name));
  const clusters = nodes.filter((n) => n.type === "cluster").sort((a, b) => a.name.localeCompare(b.name));
  const hosts = nodes.filter((n) => n.type === "host").sort((a, b) => a.name.localeCompare(b.name));
  const vms = nodes.filter((n) => n.type === "vm");

  const nodeMap = new Map();
  const positionedNodes = [];
  const center = { x: 0, y: 0 };
  const envRadius = Math.min(width, height) * 0.26;
  const providerRadius = Math.min(width, height) * 0.17;
  const clusterRadius = Math.min(width, height) * 0.11;
  const hostRadius = Math.min(width, height) * 0.06;

  envs.forEach((env, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(envs.length, 1);
    const position = {
      ...env,
      x: center.x + Math.cos(angle) * envRadius,
      y: center.y + Math.sin(angle) * envRadius,
    };
    nodeMap.set(env.id, position);
    positionedNodes.push(position);
  });

  const providersByEnv = providers.reduce((acc, provider) => {
    const key = provider.envId || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(provider);
    return acc;
  }, {});

  Object.entries(providersByEnv).forEach(([envId, group]) => {
    const envNode = nodeMap.get(envId) || { x: center.x, y: center.y };
    group.sort((a, b) => a.name.localeCompare(b.name));
    group.forEach((provider, index) => {
      const angleSeed = hashString(provider.id) % 360;
      const angle = ((Math.PI * 2) / Math.max(group.length, 1)) * index + (angleSeed * Math.PI) / 180;
      const position = {
        ...provider,
        x: envNode.x + Math.cos(angle) * providerRadius,
        y: envNode.y + Math.sin(angle) * providerRadius,
      };
      nodeMap.set(provider.id, position);
      positionedNodes.push(position);
    });
  });

  const clustersByProvider = clusters.reduce((acc, cluster) => {
    const key = cluster.providerId || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(cluster);
    return acc;
  }, {});

  Object.entries(clustersByProvider).forEach(([providerId, group]) => {
    const providerNode = nodeMap.get(providerId) || { x: center.x, y: center.y };
    group.sort((a, b) => a.name.localeCompare(b.name));
    group.forEach((cluster, index) => {
      const angleSeed = hashString(cluster.id) % 360;
      const angle = ((Math.PI * 2) / Math.max(group.length, 1)) * index + (angleSeed * Math.PI) / 180;
      const position = {
        ...cluster,
        x: providerNode.x + Math.cos(angle) * clusterRadius,
        y: providerNode.y + Math.sin(angle) * clusterRadius,
      };
      nodeMap.set(cluster.id, position);
      positionedNodes.push(position);
    });
  });

  const hostsByCluster = hosts.reduce((acc, host) => {
    const key = host.clusterId || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(host);
    return acc;
  }, {});

  Object.entries(hostsByCluster).forEach(([clusterId, group]) => {
    const clusterNode = nodeMap.get(clusterId) || { x: center.x, y: center.y };
    group.sort((a, b) => a.name.localeCompare(b.name));
    group.forEach((host, index) => {
      const angleSeed = hashString(host.id) % 360;
      const angle = ((Math.PI * 2) / Math.max(group.length, 1)) * index + (angleSeed * Math.PI) / 180;
      const position = {
        ...host,
        x: clusterNode.x + Math.cos(angle) * hostRadius,
        y: clusterNode.y + Math.sin(angle) * hostRadius,
      };
      nodeMap.set(host.id, position);
      positionedNodes.push(position);
    });
  });

  const vmsByHost = vms.reduce((acc, vm) => {
    const key = vm.hostId || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(vm);
    return acc;
  }, {});

  Object.entries(vmsByHost).forEach(([hostId, group]) => {
    const hostNode = nodeMap.get(hostId) || { x: center.x, y: center.y };
    group.forEach((vm) => {
      const seed = hashString(vm.id);
      const angle = (seed % 360) * (Math.PI / 180);
      const radius = 10 + ((seed >> 3) % 16);
      const position = {
        ...vm,
        x: hostNode.x + Math.cos(angle) * radius,
        y: hostNode.y + Math.sin(angle) * radius,
      };
      nodeMap.set(vm.id, position);
      positionedNodes.push(position);
    });
  });

  const linkPairs = links
    .map((link) => ({
      source: nodeMap.get(link.source),
      target: nodeMap.get(link.target),
    }))
    .filter((link) => link.source && link.target);

  return {
    nodes: positionedNodes,
    links: linkPairs,
    stats: {
      envCount: envs.length,
      providerCount: providers.length,
      clusterCount: clusters.length,
      hostCount: hosts.length,
      vmCount: vms.length,
    },
  };
};

export default function AtlasCanvas({
  nodes = [],
  links = [],
  onSelectNode,
  selectedNodeId,
  cameraTarget,
  focusNodeId,
  onNodePositionsReady,
  onUserInteraction,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const hoveredRef = useRef(null);
  const paletteRef = useRef({});
  const cameraRef = useRef(null);
  const interactionRef = useRef(0);
  const layoutSignatureRef = useRef("");
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [zoomLabel, setZoomLabel] = useState("Vista estrategica");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });

  const layout = useMemo(
    () => buildLayout({ nodes, links, width: canvasSize.width, height: canvasSize.height }),
    [nodes, links, canvasSize.width, canvasSize.height]
  );

  useEffect(() => {
    cameraRef.current = cameraTarget || null;
  }, [cameraTarget]);

  useEffect(() => {
    if (typeof onNodePositionsReady === "function" && layout.nodes.length) {
      const firstId = layout.nodes[0]?.id || "";
      const lastId = layout.nodes[layout.nodes.length - 1]?.id || "";
      const signature = `${layout.stats.envCount}-${layout.stats.providerCount}-${layout.stats.clusterCount}-${layout.stats.hostCount}-${layout.stats.vmCount}-${firstId}-${lastId}-${canvasSize.width}-${canvasSize.height}`;
      if (signature !== layoutSignatureRef.current) {
        layoutSignatureRef.current = signature;
        onNodePositionsReady(layout.nodes);
      }
    }
  }, [layout.nodes, layout.stats, canvasSize.width, canvasSize.height, onNodePositionsReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const readPalette = () => {
      const style = getComputedStyle(container);
      const read = (name) => {
        const value = style.getPropertyValue(name).trim();
        return value || "148, 163, 184";
      };
      paletteRef.current = {
        tones: ENV_TONES.map((tone) => read(tone)),
        neutral: read("--mc-slate"),
      };
    };

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      setCanvasSize({ width: rect.width, height: rect.height, dpr });
      viewRef.current.offsetX = rect.width / 2;
      viewRef.current.offsetY = rect.height / 2;
      readPalette();
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width * canvasSize.dpr;
    canvas.height = canvasSize.height * canvasSize.dpr;
  }, [canvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout.nodes.length) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let rafId;
    const draw = (time) => {
      let { scale, offsetX, offsetY } = viewRef.current;
      const selectedId = selectedNodeId;
      const width = canvasSize.width;
      const height = canvasSize.height;
      const dpr = canvasSize.dpr;
      const now = time / 1000;

      if (cameraRef.current && !dragRef.current.active) {
        const target = cameraRef.current;
        const targetScale = Math.min(6, Math.max(0.25, target.scale || 1));
        const targetOffsetX = width / 2 - target.x * targetScale;
        const targetOffsetY = height / 2 - target.y * targetScale;
        const ease = Date.now() - interactionRef.current > 900 ? 0.08 : 0;
        if (ease > 0) {
          viewRef.current.scale = scale + (targetScale - scale) * ease;
          viewRef.current.offsetX = offsetX + (targetOffsetX - offsetX) * ease;
          viewRef.current.offsetY = offsetY + (targetOffsetY - offsetY) * ease;
          ({ scale, offsetX, offsetY } = viewRef.current);
        }
      }

      const lod = computeLod(scale);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);

      const visibleTypes =
        lod === "far"
          ? new Set(["env", "provider", "cluster"])
          : lod === "mid"
            ? new Set(["env", "provider", "cluster", "host"])
            : new Set(["env", "provider", "cluster", "host", "vm"]);

      const visibleNodes = layout.nodes.filter((node) => visibleTypes.has(node.type));
      const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      layout.links.forEach((link) => {
        if (!visibleNodeIds.has(link.source.id) || !visibleNodeIds.has(link.target.id)) return;
        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        ctx.stroke();
      });

      visibleNodes.forEach((node) => {
        const tone = pickEnvTone(
          node,
          paletteRef.current.tones || [],
          paletteRef.current.neutral || "148, 163, 184"
        );
        const baseSize = BASE_SIZES[node.type] || 10;
        const sizeHint = node.sizeHint || 0;
        const vmCount = node.meta?.vmCount || 0;
        const sizeBoost = node.type === "host" && vmCount ? Math.min(10, Math.sqrt(vmCount)) : 0;
        const radius = (baseSize + sizeHint * 0.15 + sizeBoost) / scale;

        const pulseSeed = hashString(node.id) % 100;
        const pulse = node.type === "vm" && node.power_state === "POWERED_ON"
          ? 0.55 + 0.45 * Math.sin(now * 2 + pulseSeed)
          : 0.9;
        const alphaBase = TYPE_ALPHA[node.type] ?? 0.6;
        const powerFactor = node.power_state === "POWERED_OFF" ? 0.4 : 1;
        const fillAlpha = alphaBase * pulse * powerFactor;

        const highUsage = (node.cpu_usage_pct ?? 0) >= 85 || (node.ram_usage_pct ?? 0) >= 85;
        if (highUsage) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${tone}, 0.35)`;
          ctx.lineWidth = (3 / scale);
          ctx.arc(node.x, node.y, radius * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = `rgba(${tone}, ${fillAlpha})`;
        if (node.type === "provider") {
          drawPolygon(ctx, node.x, node.y, 6, radius);
          ctx.fill();
          ctx.strokeStyle = `rgba(${tone}, 0.55)`;
          ctx.lineWidth = 1.2 / scale;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        if (node.id === focusNodeId) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${tone}, ${0.7 + 0.2 * Math.sin(now * 3)})`;
          ctx.lineWidth = (3.2 / scale);
          ctx.arc(node.x, node.y, radius * 1.8, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (node.id === selectedId) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${tone}, 0.9)`;
          ctx.lineWidth = (2.4 / scale);
          ctx.arc(node.x, node.y, radius * 1.4, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (lod === "mid" && node.type === "host" && vmCount > VM_BADGE_THRESHOLD) {
          ctx.beginPath();
          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.strokeStyle = `rgba(${tone}, 0.7)`;
          ctx.lineWidth = 1 / scale;
          ctx.arc(node.x + radius, node.y - radius, 10 / scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
          ctx.font = `${10 / scale}px 'Inter', sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`+${vmCount}`, node.x + radius, node.y - radius);
        }
      });

      const hoveredId = hoveredRef.current?.id;
      const visibleClusterCount = visibleNodes.filter((node) => node.type === "cluster").length;
      const allowClusterLabels = visibleClusterCount > 0 && visibleClusterCount <= 18;
      const labelCandidates = visibleNodes.filter((node) => {
        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoveredId;
        if (node.type === "env" || node.type === "provider") return true;
        if (node.type === "cluster") return isSelected || isHovered || allowClusterLabels;
        if (node.type === "host") return lod !== "far" && (isSelected || isHovered);
        if (node.type === "vm") return isSelected;
        return false;
      });

      labelCandidates.forEach((node) => {
        if (!node.name) return;
        const label = truncateLabel(node.name);
        const labelY = node.y - (BASE_SIZES[node.type] + 14) / scale;
        drawLabelPill(ctx, label, node.x, labelY, scale);
      });

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [layout, canvasSize, selectedNodeId]);

  const handlePointerMove = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    const worldX = (event.clientX - rect.left - offsetX) / scale;
    const worldY = (event.clientY - rect.top - offsetY) / scale;
    const lod = computeLod(scale);
    const visibleTypes =
      lod === "far"
        ? new Set(["env", "provider", "cluster"])
        : lod === "mid"
          ? new Set(["env", "provider", "cluster", "host"])
          : new Set(["env", "provider", "cluster", "host", "vm"]);

    const candidates = layout.nodes.filter((node) => visibleTypes.has(node.type));
    let closest = null;
    let minDist = Infinity;
    candidates.forEach((node) => {
      const baseSize = BASE_SIZES[node.type] || 10;
      const sizeHint = node.sizeHint || 0;
      const vmCount = node.meta?.vmCount || 0;
      const sizeBoost = node.type === "host" && vmCount ? Math.min(10, Math.sqrt(vmCount)) : 0;
      const radius = (baseSize + sizeHint * 0.15 + sizeBoost) / scale;
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius * 1.4 && dist < minDist) {
        minDist = dist;
        closest = node;
      }
    });

    if (closest?.id !== hoveredRef.current?.id) {
      hoveredRef.current = closest;
      setHoveredNode(closest || null);
    }

    if (closest) {
      setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: closest });
      canvas.style.cursor = "pointer";
    } else {
      setTooltip(null);
      canvas.style.cursor = dragRef.current.active ? "grabbing" : "grab";
    }

    if (dragRef.current.active) {
      const dx = event.clientX - dragRef.current.startX;
      const dy = event.clientY - dragRef.current.startY;
      if (!dragRef.current.moved && Math.hypot(dx, dy) > 4) {
        dragRef.current.moved = true;
      }
      viewRef.current.offsetX = dragRef.current.originX + dx;
      viewRef.current.offsetY = dragRef.current.originY + dy;
    }
  };

  const handlePointerDown = (event) => {
    interactionRef.current = Date.now();
    onUserInteraction?.();
    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.offsetX,
      originY: viewRef.current.offsetY,
    };
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
    if (hoveredRef.current && !dragRef.current.moved) {
      onSelectNode?.(hoveredRef.current);
    }
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hoveredRef.current ? "pointer" : "grab";
  };

  const handleWheel = useCallback((event) => {
    interactionRef.current = Date.now();
    onUserInteraction?.();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(6, Math.max(0.25, scale * delta));
    const worldX = (event.clientX - rect.left - offsetX) / scale;
    const worldY = (event.clientY - rect.top - offsetY) / scale;
    viewRef.current.scale = nextScale;
    viewRef.current.offsetX = event.clientX - rect.left - worldX * nextScale;
    viewRef.current.offsetY = event.clientY - rect.top - worldY * nextScale;

    const lod = computeLod(nextScale);
    const label =
      lod === "far" ? "Vista estrategica" : lod === "mid" ? "Vista operativa" : "Vista detallada";
    setZoomLabel(label);
  }, [onUserInteraction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleWheel(event);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [handleWheel]);

  const tooltipNode = tooltip?.node || hoveredNode;

  return (
    <div className="mc-atlas">
      <div className="mc-atlas-header">
        <div>
          <div className="mc-atlas-title">Atlas</div>
          <div className="mc-atlas-subtitle">Pan + zoom con LOD automatico.</div>
        </div>
        <div className="mc-atlas-tags">
          <span className="mc-tag">Drag</span>
          <span className="mc-tag">Scroll</span>
          <span className="mc-tag">{zoomLabel}</span>
        </div>
      </div>

      <div className="mc-atlas-stage" ref={containerRef}>
        <div className="mc-atlas-glow" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="mc-atlas-canvas"
          onMouseMove={handlePointerMove}
          onMouseDown={handlePointerDown}
          onMouseUp={handlePointerUp}
          onMouseLeave={() => {
            dragRef.current.active = false;
            hoveredRef.current = null;
            setHoveredNode(null);
            setTooltip(null);
          }}
        />
        <AtlasLegend />
        {tooltipNode && tooltip && (
          <div
            className="mc-atlas-tooltip"
            style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
          >
            <div className="mc-atlas-tooltip-title">{tooltipNode.name}</div>
            <div className="mc-atlas-tooltip-row">Tipo: {tooltipNode.type}</div>
            {tooltipNode.provider && (
              <div className="mc-atlas-tooltip-row">Provider: {formatProvider(tooltipNode.provider)}</div>
            )}
            {tooltipNode.environment && (
              <div className="mc-atlas-tooltip-row">Env: {tooltipNode.environment}</div>
            )}
            {tooltipNode.cluster && (
              <div className="mc-atlas-tooltip-row">Cluster: {tooltipNode.cluster}</div>
            )}
            {tooltipNode.host && (
              <div className="mc-atlas-tooltip-row">Host: {tooltipNode.host}</div>
            )}
            {tooltipNode.power_state && (
              <div className="mc-atlas-tooltip-row">Estado: {tooltipNode.power_state}</div>
            )}
            {tooltipNode.cpu_usage_pct != null && (
              <div className="mc-atlas-tooltip-row">CPU: {formatPct(tooltipNode.cpu_usage_pct)}</div>
            )}
            {tooltipNode.ram_usage_pct != null && (
              <div className="mc-atlas-tooltip-row">RAM: {formatPct(tooltipNode.ram_usage_pct)}</div>
            )}
          </div>
        )}
      </div>

      <div className="mc-atlas-footer">
        <div className="mc-atlas-hint">Zoom OUT para estrategia, IN para VMs.</div>
        <div className="mc-atlas-legend">
          <span className="mc-legend-item mc-tone-emerald">Cluster</span>
          <span className="mc-legend-item mc-tone-cyan">Host</span>
          <span className="mc-legend-item mc-tone-amber">VM</span>
        </div>
      </div>
    </div>
  );
}
