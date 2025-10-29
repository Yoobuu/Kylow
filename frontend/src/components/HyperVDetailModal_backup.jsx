import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion as Motion } from 'framer-motion'
import api from '../api/axios'
import { IoPowerSharp, IoPowerOutline, IoRefreshSharp } from 'react-icons/io5'

const ACTION_THEMES = {
  start: {
    base: 'bg-green-500 hover:bg-green-600 focus-visible:ring-green-300',
  },
  stop: {
    base: 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-300',
  },
  reset: {
    base: 'bg-yellow-500 hover:bg-yellow-600 focus-visible:ring-yellow-300',
  },
}

const SKELETON_WIDTHS = ['w-2/3', 'w-1/2', 'w-5/6', 'w-3/4', 'w-1/3', 'w-2/5']

function classifyFromString(str) {
  const cleaned = String(str ?? '').trim().toUpperCase()
  if (!cleaned) return null

  const tokens = cleaned.split(/[-_\s]+/).filter(Boolean)
  for (const token of tokens) {
    const first = token.charAt(0)
    if (first === 'S') return 'sandbox'
    if (first === 'T') return 'test'
    if (first === 'P') return 'producción'
    if (first === 'D') return 'desarrollo'
  }

  return null
}

function inferFromVmObject(vm) {
  if (!vm) return null
  const byName = classifyFromString(vm.Name || vm.name)
  if (byName) return byName
  const byCluster = classifyFromString(vm.Cluster || vm.cluster)
  if (byCluster) return byCluster
  const byHost = classifyFromString(vm.HVHost || vm.host)
  if (byHost) return byHost
  return null
}

function inferFromSelectorKey(selectorKey) {
  if (!selectorKey) return null
  const [maybeName, maybeHost] = String(selectorKey).split('::')
  const byName = classifyFromString(maybeName)
  if (byName) return byName
  const byHost = classifyFromString(maybeHost)
  if (byHost) return byHost
  return null
}

function inferEnvironment({ vm, selectorKey }) {
  const fromVm = inferFromVmObject(vm)
  if (fromVm) return fromVm
  const fromSelector = inferFromSelectorKey(selectorKey)
  if (fromSelector) return fromSelector
  return 'desconocido'
}

// Nota: ya no bloqueamos por sandbox. Los botones siempre salen.
export default function HyperVDetailModal({ record, selectorKey = '', onClose }) {
  const modalRef = useRef(null)
  const [loading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [actionLoading, setActionLoading] = useState(null)
  const [pending, setPending] = useState(null)

  const detail = null
  const baseVm = detail || record || {}

  // Unifica la vista de tabla y el modal para mostrar Encendida/Apagada en lugar de POWERED_ON.
  const POWER_LABELS = {
    POWERED_ON: 'Encendida',
    Running: 'Encendida',
    POWERED_OFF: 'Apagada',
    Off: 'Apagada',
    SUSPENDED: 'Suspendida',
  }

  const rawPowerState = baseVm.State || baseVm.power_state
  const friendlyPowerState = POWER_LABELS[rawPowerState] || rawPowerState || '—'

  const cpuPctRaw =
    baseVm.CPU_UsagePct ??
    baseVm.cpuUsagePct ??
    baseVm.cpu_pct ??
    null
  const cpuPctDisplay = cpuPctRaw !== null && cpuPctRaw !== undefined
    ? `${cpuPctRaw}%`
    : '—'

  const ramTotalMiB =
    baseVm.RAM ??
    baseVm.RAM_MiB ??
    baseVm.MemoryMB ??
    baseVm.mem_total ??
    '—'

  const ramDemandMiB =
    baseVm.RAM_DemandMiB ??
    baseVm.RAMDemandMiB ??
    baseVm.RAM_Demand ??
    baseVm.mem_demand ??
    '—'

  const ramPctRaw =
    baseVm.RAM_UsagePct ??
    baseVm.ram_pct ??
    baseVm.mem_pct ??
    null
  const ramPctDisplay = ramPctRaw !== null && ramPctRaw !== undefined
    ? `${ramPctRaw}%`
    : '—'

  const formatDiskEntry = (entry) => {
    if (!entry) return ''
    if (typeof entry === 'string') return entry
    if (typeof entry === 'number') return `${entry}`

    const displayObj =
      (typeof entry.Display === 'object' && entry.Display !== null && entry.Display) ||
      (typeof entry.display === 'object' && entry.display !== null && entry.display) ||
      null

    const source = displayObj || entry

    const resolveValue = (...candidates) => {
      for (const value of candidates) {
        if (value === undefined || value === null || value === '') continue
        return value
      }
      return undefined
    }

    const alloc = resolveValue(
      source.AllocatedGiB,
      source.allocatedGiB,
      source.AllocatedGB,
      source.allocatedGB,
      source.AllocatedMiB,
      source.allocatedMiB,
      source.Allocated,
      source.allocated,
      entry.AllocatedGiB,
      entry.allocatedGiB,
      entry.AllocatedGB,
      entry.allocatedGB,
      entry.Allocated,
      entry.allocated
    )

    const size = resolveValue(
      source.SizeGiB,
      source.sizeGiB,
      source.SizeGB,
      source.sizeGB,
      source.SizeMiB,
      source.sizeMiB,
      source.Size,
      source.size,
      entry.SizeGiB,
      entry.sizeGiB,
      entry.SizeGB,
      entry.sizeGB,
      entry.Size,
      entry.size
    )

    const pct = resolveValue(
      source.AllocatedPct,
      source.allocatedPct,
      source.Percent,
      source.percent,
      source.pct,
      entry.AllocatedPct,
      entry.allocatedPct,
      entry.Percent,
      entry.percent,
      entry.pct
    )

    if (size && pct !== undefined && pct !== null && pct !== '') {
      const allocText =
        alloc !== undefined && alloc !== null && alloc !== ''
          ? `${alloc}`
          : '—'
      return `${allocText} / ${size} (${pct}%)`
    }

    const displayText = resolveValue(
      typeof entry.Display === 'string' ? entry.Display : undefined,
      typeof entry.display === 'string' ? entry.display : undefined,
      typeof source.Display === 'string' ? source.Display : undefined,
      typeof source.display === 'string' ? source.display : undefined
    )
    if (displayText) return displayText

    if (source && typeof source.toString === 'function') {
      const strValue = source.toString.call(source)
      if (strValue && strValue !== '[object Object]') return strValue
    }
    if (entry && typeof entry.toString === 'function') {
      const strValue = entry.toString.call(entry)
      if (strValue && strValue !== '[object Object]') return strValue
    }

    try {
      const json = JSON.stringify(source)
      return json && json !== '{}' ? json : ''
    } catch {
      return ''
    }
  }

  const buildDisksDisplay = () => {
    const primary = Array.isArray(baseVm.Disks) ? baseVm.Disks : null
    const secondary = !primary && Array.isArray(baseVm.disks) ? baseVm.disks : null
    const listSource = primary || secondary

    if (listSource) {
      const formatted = listSource
        .map(formatDiskEntry)
        .filter((value) => Boolean(value && String(value).trim()))
      if (formatted.length) {
        return formatted.join(', ')
      }
    }

    const fallback =
      baseVm.DisksString ||
      baseVm.disksString ||
      baseVm.DisksDisplay ||
      baseVm.disksDisplay ||
      baseVm.disks

    if (Array.isArray(fallback)) {
      const formatted = fallback
        .map(formatDiskEntry)
        .filter((value) => Boolean(value && String(value).trim()))
      if (formatted.length) {
        return formatted.join(', ')
      }
      return '—'
    }

    if (fallback === undefined || fallback === null || fallback === '') return '—'
    if (typeof fallback === 'string') return fallback
    if (typeof fallback === 'number') return `${fallback}`

    try {
      const json = JSON.stringify(fallback)
      return json && json !== '{}' ? json : '—'
    } catch {
      return '—'
    }
  }

  const disksDisplay = buildDisksDisplay()

  const computedEnv = inferEnvironment({ vm: baseVm, selectorKey })

  // DEBUG MUY VERBOSO
  console.log('[HyperVDetailModal] baseVm =', baseVm)
  console.log('[HyperVDetailModal] selectorKey =', selectorKey)
  console.log('[HyperVDetailModal] computedEnv =', computedEnv)
  console.log('[HyperVDetailModal] Name =', baseVm?.Name || baseVm?.name)
  console.log('[HyperVDetailModal] Cluster =', baseVm?.Cluster || baseVm?.cluster)
  console.log('[HyperVDetailModal] HVHost =', baseVm?.HVHost || baseVm?.host)

  useEffect(() => {
    if (!record) return
    modalRef.current?.focus()
    const onKey = (event) => event.key === 'Escape'
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [record, onClose])

  if (!record) return null

  const details = [
    ['Nombre', baseVm.Name || baseVm.name],
    ['Estado', friendlyPowerState],
    ['Ambiente', computedEnv || baseVm.Env || baseVm.env || '—'],
    ['Host', baseVm.HVHost || baseVm.Host || baseVm.host || '—'],
    ['Cluster', baseVm.Cluster || baseVm.cluster || '—'],

    ['CPU', baseVm.CPUs || baseVm.NumCPU || baseVm.vCPU || baseVm.cpu || '—'],
    ['CPU (%)', cpuPctDisplay],

    ['RAM (MiB)', ramTotalMiB],
    ['RAM demanda (MiB)', ramDemandMiB],
    ['RAM (%)', ramPctDisplay],

    ['SO', baseVm.OS || baseVm.os || baseVm.GuestFullName || '—'],
    ['VLAN(s)', baseVm.VLAN || baseVm.vlan || baseVm.vlans || '—'],

    ['IPv4', baseVm.IPv4 || baseVm.ipv4 || baseVm.IP || baseVm.ip || '—'],

    ['Discos', disksDisplay],

    [
      'Compatibilidad versión',
      baseVm.CompatibilityVersion ||
      baseVm.compatibilityVersion ||
      baseVm.Version ||
      baseVm.version ||
      baseVm.HyperVVersion ||
      '—'
    ],
    [
      'Compatibilidad generación',
      baseVm.CompatibilityGeneration ||
      baseVm.compatibilityGeneration ||
      baseVm.Generation ||
      baseVm.generation ||
      baseVm.HyperVGeneration ||
      '—'
    ],
  ]

  const actionButton = (text, themeKey, apiPath, Icon) => {
    const isLoading = actionLoading === apiPath
    const theme = ACTION_THEMES[themeKey] ?? ACTION_THEMES.start
    return (
      <Motion.button
        key={apiPath}
        type="button"
        whileHover={isLoading ? {} : { scale: 1.05 }}
        whileTap={isLoading ? {} : { scale: 0.95 }}
        disabled={isLoading}
        className={[
          'flex items-center justify-center py-2 rounded font-medium text-white shadow transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          theme.base,
          isLoading ? 'opacity-70 cursor-not-allowed' : '',
        ].join(' ')}
        onClick={() => {
          if (isLoading) return
          setPending({ apiPath, text })
          setSuccessMsg('')
          setError('')
        }}
      >
        {isLoading ? (
          <svg className="inline-block w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <>
            {Icon && <Icon className="mr-2" />}
            {text}
          </>
        )}
      </Motion.button>
    )
  }

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.2 } },
  }

  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
  }

  const content = (
    <AnimatePresence>
      <Motion.div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-[9999]"
        onClick={onClose}
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
      >
        <Motion.div
          ref={modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="hyperv-detail-title"
          className="bg-white text-gray-800 p-6 rounded-2xl shadow-xl max-w-xl w-full relative focus:outline-none"
          onClick={(event) => event.stopPropagation()}
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <button
            onClick={onClose}
            aria-label="Cerrar detalle Hyper-V"
            className="absolute top-4 right-4 text-gray-600 hover:text-gray-900 transition text-xl"
          >
            ×
          </button>

          <h3 id="hyperv-detail-title" className="text-2xl font-semibold mb-4">
            Detalle VM {baseVm.Name || baseVm.name}
          </h3>

          {successMsg && (
            <div className="bg-green-100 text-green-800 p-3 rounded mb-4">
              {successMsg}
            </div>
          )}

          {error && (
            <div className="bg-red-100 text-red-700 p-3 rounded mb-4">
              {error}
            </div>
          )}

          {loading && (
            <div className="space-y-3 mb-6 px-4">
              {SKELETON_WIDTHS.map((widthClass, index) => (
                <div
                  key={index}
                  className={'h-4 bg-gray-200 rounded animate-pulse ' + widthClass}
                />
              ))}
            </div>
          )}

          {pending && (
            <div className="bg-gray-100 border border-gray-300 rounded p-4 mb-4">
              <p className="text-gray-800">
                ¿Seguro que deseas <strong>{pending.text.toLowerCase()}</strong> la VM {baseVm.Name || baseVm.name}?
              </p>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                  onClick={async () => {
                    // Integración real con backend: /hyperv/vms/{hvhost}/{vmname}/power/{action}
                    // Ejecuta acciones de energía reales vía WinRM.
                    const hvhost = baseVm.HVHost || baseVm.host;
                    const vmname = baseVm.Name || baseVm.name;
                    const action = pending.apiPath; // "start" | "stop" | "reset"
                    if (!hvhost || !vmname) {
                      setError("Falta HVHost o VMName");
                      return;
                    }
                    setActionLoading(pending.apiPath);
                    setError("");
                    let ok = false;
                    try {
                      const resp = await api.post(
                        `/hyperv/vms/${hvhost}/${vmname}/power/${action}`
                      );
                      ok = true;
                      setSuccessMsg(
                        resp?.data?.message ||
                        `Acción ${pending.text.toLowerCase()} aceptada para ${vmname} en ${hvhost}.`
                      );
                    } catch (err) {
                      const apiDetail =
                        err?.response?.data?.detail ||
                        err?.message ||
                        "Error al ejecutar la acción solicitada.";
                      setError(apiDetail);
                    } finally {
                      setActionLoading(null);
                      setPending(null);
                    }
                  }}
                >
                  Sí
                </button>
                <button
                  className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
                  onClick={() => setPending(null)}
                >
                  No
                </button>
              </div>
            </div>
          )}

          {!loading && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6 px-2">
              {details.map(([label, value]) => (
                <div key={label} className="col-span-1 flex">
                  <dt className="font-medium text-gray-700 w-1/2">{label}:</dt>
                  <dd className="text-gray-800 flex-1 break-words">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {actionButton('Encender', 'start', 'start', IoPowerSharp)}
            {actionButton('Apagar', 'stop', 'stop', IoPowerOutline)}
            {actionButton('Reset', 'reset', 'reset', IoRefreshSharp)}
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}
