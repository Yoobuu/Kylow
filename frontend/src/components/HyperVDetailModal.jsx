import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion as Motion } from 'framer-motion'
import api from '../api/axios'
import { IoPowerSharp, IoPowerOutline, IoRefreshSharp } from 'react-icons/io5'
import { useAuth } from '../context/AuthContext'
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
    if (first === 'P') return 'producciÃ³n'
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

function isHostStatusPayload(payload) {
  return payload && typeof payload === 'object' && payload.provider === 'hyperv' && Array.isArray(payload.hosts)
}

function extractHostStatusMessage(payload, host) {
  if (!isHostStatusPayload(payload)) return null
  const hostKey = String(host || '').toLowerCase()
  const entry = payload.hosts.find((item) => String(item?.host || '').toLowerCase() === hostKey) || payload.hosts[0]
  if (!entry || entry.status === 'ok') return null
  const status = String(entry.status || 'error')
  const error = entry.error ? String(entry.error) : ''
  return error ? `${status}: ${error}` : status
}
// Nota: ya no bloqueamos por sandbox. Los botones siempre salen.
export default function HyperVDetailModal({ record, selectorKey = '', onClose }) {
  const modalRef = useRef(null)
  const { hasPermission } = useAuth()
  const powerDisabled = !hasPermission("hyperv.power")
  const powerDisabledMessage = 'No tienes permisos para controlar energia. Pide acceso a un admin.'
  const [loading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [isTakingLong, setIsTakingLong] = useState(false)
  const canFetchDetail = hasPermission('jobs.trigger')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [actionLoading, setActionLoading] = useState(null)
  const [pending, setPending] = useState(null)
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
  const friendlyPowerState = POWER_LABELS[rawPowerState] || rawPowerState || '\u2014'
  const cpuPctRaw =
    baseVm.CPU_UsagePct ??
    baseVm.cpu_usage_pct ??
    baseVm.cpuUsagePct ??
    baseVm.cpu_pct ??
    baseVm.CpuUsagePct ??
    baseVm.CpuPct ??
    baseVm.CPUPercent ??
    baseVm.cpuPercent ??
    null
  const toGiB = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    const gib = parsed / 1024
    return Number.isFinite(gib) ? gib : null
  }
  const formatGiB = (value) => {
    if (value == null || value === '' || value === '\u2014') return '\u2014'
    const gib = toGiB(value)
    if (gib == null) return '\u2014'
    return gib.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  const renderPercentWithBar = (value) => {
    if (value == null || value === '') return '\u2014'
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return value
    const clamped = Math.max(0, parsed)
    const width = Math.min(clamped, 100)
    const barColor =
      clamped < 50 ? 'bg-green-500' : clamped < 80 ? 'bg-yellow-500' : 'bg-red-500'
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-gray-700">{`${parsed}%`}</span>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-300`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
    )
  }
  const parsePctFromText = (text) => {
    if (typeof text !== 'string') return null
    const match = /([\d.,]+)%/.exec(text)
    if (!match) return null
    const value = Number(match[1].replace(',', '.'))
    return Number.isFinite(value) ? value : null
  }
  const normalizeDiskForDisplay = (entry) => {
    if (!entry) return null
    if (typeof entry === 'object' && ('text' in entry || 'pct' in entry)) {
      const textValue = entry.text ?? formatDiskEntry(entry)
      if (!textValue) return null
      const pctValue =
        entry.pct != null && Number.isFinite(Number(entry.pct))
          ? Number(entry.pct)
          : parsePctFromText(textValue)
      return {
        text: textValue,
        pct: pctValue,
      }
    }
    if (typeof entry === 'string') {
      return {
        text: entry,
        pct: parsePctFromText(entry),
      }
    }
    if (typeof entry === 'number') {
      return {
        text: `${entry}`,
        pct: null,
      }
    }
    const textValue = formatDiskEntry(entry)
    if (!textValue) return null
    return {
      text: textValue,
      pct: parsePctFromText(textValue),
    }
  }
  const hasDiskMetrics = (vm) => {
    if (!vm || typeof vm !== 'object') return false
    if (Array.isArray(vm.disks)) {
      return vm.disks.some((disk) => disk && (disk.text || disk.pct != null))
    }
    const rawList = Array.isArray(vm.Disks)
      ? vm.Disks
      : Array.isArray(vm.Discos)
        ? vm.Discos
        : null
    if (!rawList) return false
    return rawList.some((disk) => {
      if (!disk || typeof disk !== 'object') return false
      return (
        disk.SizeGiB != null ||
        disk.AllocatedGiB != null ||
        disk.AllocatedPct != null
      )
    })
  }
  useEffect(() => {
    if (!record) return undefined
    setDetail(null)
    setDetailError('')
    setDetailLoading(false)
    if (!canFetchDetail) return undefined
    if (hasDiskMetrics(record)) return undefined
    const hvhost = record.HVHost || record.host
    const vmName = record.Name || record.name
    if (!hvhost || !vmName) return undefined

    let cancelled = false
    setDetailLoading(true)
    setIsTakingLong(false)
    
    // Si tarda más de 5s, mostramos mensaje de "paciencia"
    const timer = setTimeout(() => {
      if (!cancelled) setIsTakingLong(true)
    }, 5000)

    api.get(
      `/hyperv/vms/${encodeURIComponent(String(hvhost))}/${encodeURIComponent(String(vmName))}/detail`
    )
      .then((resp) => {
        if (cancelled) return
        const payload = resp?.data || null
        const statusMsg = extractHostStatusMessage(payload, hvhost)
        if (statusMsg) {
          setDetail(null)
          setDetailError(`Host ${hvhost}: ${statusMsg}`)
          return
        }
        setDetail(payload)
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.response?.status === 403) {
          setDetailError('Sin permisos para consultar detalle de discos.')
          return
        }
        const apiMsg = err?.response?.data?.detail || err?.message || 'Error desconocido'
        setDetailError(`Error: ${apiMsg}`)
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false)
          clearTimeout(timer)
        }
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [record, canFetchDetail])
  const renderDisksWithBars = (disks) => {
    if (!Array.isArray(disks) || disks.length === 0) {
      return '\u2014'
    }
    const items = disks
      .map(normalizeDiskForDisplay)
      .filter((disk) => disk && disk.text)
    if (!items.length) return '\u2014'
    return (
      <div className="flex flex-col gap-2">
        {items.map((disk, index) => {
          const pctNumber = Number(disk.pct)
          const hasPct = Number.isFinite(pctNumber)
          const width = hasPct ? Math.min(Math.max(pctNumber, 0), 100) : 0
          const barColor =
            hasPct && pctNumber < 50
              ? 'bg-green-500'
              : hasPct && pctNumber < 80
                ? 'bg-yellow-500'
                : hasPct
                  ? 'bg-red-500'
                  : 'bg-green-500'
          return (
            <div key={index} className="flex flex-col gap-1">
              <span className="text-sm text-gray-700">{disk.text}</span>
              {hasPct && (
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-full transition-all duration-300`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  const ramTotalMiBRaw =
    baseVm.RAM ??
    baseVm.RAM_MiB ??
    baseVm.memory_size_MiB ??
    baseVm.MemoryMB ??
    baseVm.mem_total ??
    baseVm.MemoryMB_Allocated ??
    baseVm.AssignedMemoryMB ??
    baseVm.TotalMemoryMB ??
    baseVm.RAMAssignedMiB ??
    baseVm.RAM_TotalMiB ??
    null
  const ramTotalGiBDisplay = formatGiB(ramTotalMiBRaw)
  const ramDemandMiBRaw =
    baseVm.RAM_Demand_MiB ??
    baseVm.RAM_DemandMiB ??
    baseVm.RAMDemandMiB ??
    baseVm.RAM_Demand ??
    baseVm.MemoryDemandMB ??
    baseVm.DemandMB ??
    baseVm.mem_demand ??
    baseVm.ram_demand_mib ??
    baseVm.ramDemandMiB ??
    null
  const ramDemandGiBDisplay = formatGiB(ramDemandMiBRaw)
  const ramPctRaw =
    baseVm.RAM_UsagePct ??
    baseVm.ram_usage_pct ??
    baseVm.ram_pct ??
    baseVm.mem_pct ??
    baseVm.MemoryUsagePct ??
    baseVm.RAMUsagePct ??
    baseVm.RamUsagePct ??
    null
  const osDisplay =
    baseVm.OS ||
    baseVm.os ||
    baseVm.GuestFullName ||
    baseVm.guestFullName ||
    baseVm.GuestOS ||
    baseVm.guestOS ||
    baseVm.guest_os ||
    '\u2014'
  let ipv4Display = '\u2014'
  if (Array.isArray(baseVm.IPv4)) {
    const joined = baseVm.IPv4.filter(Boolean).join(', ').trim()
    if (joined) ipv4Display = joined
  } else if (typeof baseVm.IPv4 === 'string' && baseVm.IPv4.trim()) {
    ipv4Display = baseVm.IPv4
  } else {
    const ipv4Fallback =
      baseVm.ip_addresses ??
      baseVm.ipv4 ??
      baseVm.IP ??
      baseVm.ip ??
      baseVm.IPAddress ??
      baseVm.IpAddress ??
      baseVm.PrimaryIP ??
      baseVm.primaryIp ??
      null
    if (Array.isArray(ipv4Fallback)) {
      const joined = ipv4Fallback.filter(Boolean).join(', ').trim()
      if (joined) ipv4Display = joined
    } else if (ipv4Fallback != null && String(ipv4Fallback).trim()) {
      ipv4Display = ipv4Fallback
    }
  }
  const vlanDisplayRaw =
    baseVm.VLAN ??
    baseVm.vlan ??
    baseVm.vlans ??
    baseVm.VLANs ??
    baseVm.VLAN_IDs ??
    baseVm.VLANIDs ??
    baseVm.VLANID ??
    baseVm.VlanId ??
    null
  const vlanDisplay = Array.isArray(vlanDisplayRaw)
    ? (vlanDisplayRaw.filter(Boolean).join(', ').trim() || '\u2014')
    : (
      vlanDisplayRaw != null && String(vlanDisplayRaw).trim()
        ? vlanDisplayRaw
        : '\u2014'
    )
  function inferClusterFromHost(obj) {
    const hvhost =
      obj.HVHost ||
      obj.host ||
      obj.HVHOST ||
      obj.hypervHost ||
      ''
    if (typeof hvhost === 'string' && hvhost.length > 0) {
      const first = hvhost[0].toUpperCase()
      if (first === 'S') return 'sandbox'
      if (first === 'T') return 'test'
      if (first === 'P') return 'produccion'
    }
    return null
  }
  const clusterExplicit =
    baseVm.Cluster ||
    baseVm.cluster ||
    baseVm.ClusterName ||
    null
  const clusterDerived = inferClusterFromHost(baseVm)
  const clusterDisplay = clusterExplicit || clusterDerived || '\u2014'
  const compatVersionRaw =
    baseVm.CompatibilityVersion ??
    baseVm.compatibilityVersion ??
    baseVm.Version ??
    baseVm.version ??
    baseVm.HyperVVersion ??
    baseVm.compatibility_code ??
    baseVm.compatibilityCode ??
    baseVm.CompatHW?.Version ??
    null
  const compatVersionDisplay = compatVersionRaw ?? '\u2014'
  const compatGenerationRaw =
    baseVm.CompatibilityGeneration ??
    baseVm.compatibilityGeneration ??
    baseVm.Generation ??
    baseVm.generation ??
    baseVm.HyperVGeneration ??
    baseVm.compat_generation ??
    baseVm.compatGeneration ??
    baseVm.CompatHW?.Generation ??
    null
  const compatGenerationDisplay = compatGenerationRaw ?? '\u2014'
  const formatDiskEntry = (entry) => {
    if (!entry) return ''
    if (typeof entry === 'string') return entry
    if (typeof entry === 'number') return `${entry}`
    const toNumber = (value) => {
      if (value == null || value === '') return null
      if (typeof value === 'number') return Number.isFinite(value) ? value : null
      if (typeof value === 'string') {
        const cleaned = value.trim().replace(/,/g, '.').replace(/[^0-9.-]+/g, '')
        if (!cleaned || cleaned === '-' || cleaned === '.') return null
        const parsed = Number(cleaned)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    }
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
    const allocNumber = toNumber(alloc)
    const sizeNumber = toNumber(size)
    let pctNumber = toNumber(pct)
    if (pctNumber == null && allocNumber != null && sizeNumber != null && sizeNumber > 0) {
      pctNumber = Math.round((allocNumber / sizeNumber) * 100 * 100) / 100
    }
    const hasMetric = [allocNumber, sizeNumber, pctNumber].some(
      (value) => value !== undefined && value !== null && value !== ''
    )
    if (allocNumber != null && sizeNumber != null) {
      const pctText = pctNumber != null ? ` (${pctNumber}%)` : ''
      return `${allocNumber} GiB / ${sizeNumber} GiB${pctText}`
    }
    if (allocNumber != null) {
      return `Usado: ${allocNumber} GiB`
    }
    if (sizeNumber != null) {
      return `Tamano: ${sizeNumber} GiB`
    }
    const displayText = resolveValue(
      typeof entry.Display === 'string' ? entry.Display : undefined,
      typeof entry.display === 'string' ? entry.display : undefined,
      typeof source.Display === 'string' ? source.Display : undefined,
      typeof source.display === 'string' ? source.display : undefined
    )
    if (displayText && !displayText.includes('???')) return displayText
    if (!hasMetric) return ''
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
    const hasDiskData = hasDiskMetrics(baseVm)
    if (!hasDiskData) {
      if (detailLoading) {
        return (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 animate-pulse">
              Consultando discos...
            </span>
            {isTakingLong && (
              <span className="text-xs text-amber-600">
                Conectando al host en tiempo real. Esto puede demorar varios minutos si el host está lento...
              </span>
            )}
          </div>
        )
      }
      if (detailError) {
        return <span className="text-xs text-red-600">{detailError}</span>
      }
      if (!canFetchDetail) {
        return (
          <span className="text-xs text-gray-500">
            Detalle de discos no disponible (permiso requerido).
          </span>
        )
      }
    }
    const normalized = Array.isArray(baseVm.disks) ? baseVm.disks : null
    if (normalized && normalized.length) {
      return renderDisksWithBars(normalized)
    }
    const sources = [
      baseVm.Disks,
      baseVm.disks,
      baseVm.DisksDisplay,
      baseVm.disksDisplay,
    ]
    for (const source of sources) {
      if (Array.isArray(source) && source.length) {
        const entries = source
          .map(normalizeDiskForDisplay)
          .filter((disk) => disk && disk.text)
        if (entries.length) {
          return renderDisksWithBars(entries)
        }
      }
    }
    const fallbackString =
      baseVm.DisksString ||
      baseVm.disksString ||
      baseVm.DisksText ||
      baseVm.disksText ||
      null
    if (typeof fallbackString === 'string' && fallbackString.trim()) {
      return renderDisksWithBars([fallbackString])
    }
    return '\u2014'
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
    ['Ambiente', computedEnv || baseVm.Env || baseVm.env || '\u2014'],
    ['Host', baseVm.HVHost || baseVm.Host || baseVm.host || '\u2014'],
    ['Cluster', clusterDisplay],
    ['CPU', baseVm.CPUs || baseVm.NumCPU || baseVm.vCPU || baseVm.cpu_count || baseVm.cpu || baseVm.CPU || baseVm.NumCpus || baseVm.ProcessorCount || baseVm.processorCount || '\u2014'],
    ['CPU (%)', renderPercentWithBar(cpuPctRaw)],
    ['RAM (GiB)', ramTotalGiBDisplay],
    ['RAM demanda (GiB)', ramDemandGiBDisplay],
    ['RAM (%)', renderPercentWithBar(ramPctRaw)],
    ['SO', osDisplay],
    ['VLAN(s)', vlanDisplay],
    ['IPv4', ipv4Display],
    ['Discos', disksDisplay],
    ['Compatibilidad versi\u00f3n', compatVersionDisplay],
    ['Compatibilidad generaci\u00f3n', compatGenerationDisplay],
  ]
  const actionButton = (text, themeKey, apiPath, Icon) => {
    const isLoading = actionLoading === apiPath
    const theme = ACTION_THEMES[themeKey] ?? ACTION_THEMES.start
    const disabled = powerDisabled || isLoading
    return (
      <Motion.button
        key={apiPath}
        type="button"
        whileHover={disabled ? {} : { scale: 1.05 }}
        whileTap={disabled ? {} : { scale: 0.95 }}
        disabled={disabled}
        title={powerDisabled ? powerDisabledMessage : undefined}
        className={[
          'flex items-center justify-center rounded px-4 py-2 font-medium text-white shadow transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          theme.base,
          disabled ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ')}
        onClick={() => {
          if (disabled) return
          setPending({ apiPath, text })
          setSuccessMsg('')
          setError('')
        }}
      >
        {isLoading ? (
          <svg className="inline-block h-5 w-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
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
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-8"
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
          className="relative flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white text-gray-800 shadow-xl focus:outline-none"
          onClick={(event) => event.stopPropagation()}
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
            <h3 id="hyperv-detail-title" className="text-2xl font-semibold">
              Detalle VM {baseVm.Name || baseVm.name}
            </h3>
            <button
              onClick={onClose}
              aria-label="Cerrar detalle Hyper-V"
              className="text-xl text-gray-500 transition hover:text-gray-900"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {successMsg && (
              <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                {successMsg}
              </div>
            )}

            {error && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading && (
              <div className="space-y-3">
                {SKELETON_WIDTHS.map((widthClass, index) => (
                  <div
                    key={index}
                    className={`h-4 rounded bg-gray-200 animate-pulse ${widthClass}`}
                  />
                ))}
              </div>
            )}

            {pending && (
              <div className="mb-4 rounded border border-gray-300 bg-gray-100 p-4">
                <p className="text-sm text-gray-800">
                  ¿Seguro que deseas <strong>{pending.text.toLowerCase()}</strong> la VM {baseVm.Name || baseVm.name}?
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    className="rounded bg-green-500 px-3 py-1 text-sm text-white hover:bg-green-600"
                    onClick={async () => {
                      const hvhost = baseVm.HVHost || baseVm.host;
                      const vmname = baseVm.Name || baseVm.name;
                      const action = pending.apiPath;
                      if (!hvhost || !vmname) {
                        setError("Falta HVHost o VMName");
                        return;
                      }
                      if (powerDisabled) {
                        alert('Acceso denegado (403).');
                        setPending(null);
                        return;
                      }
                      setActionLoading(pending.apiPath);
                      setError("");
                      try {
                        const resp = await api.post(`/hyperv/vms/${hvhost}/${vmname}/power/${action}`);
                        const statusMsg = extractHostStatusMessage(resp?.data, hvhost)
                        if (statusMsg) {
                          setError(`Host ${hvhost}: ${statusMsg}`)
                          return
                        }
                        setSuccessMsg(
                          resp?.data?.message ||
                            `Acción ${pending.text.toLowerCase()} aceptada para ${vmname} en ${hvhost}.`
                        );
                      } catch (err) {
                        if (err?.response?.status === 403) {
                          alert('Acceso denegado (403).');
                        }
                        const apiDetail =
                          err?.response?.data?.detail ||
                          err?.message ||
                          'Error al ejecutar la acción solicitada.';
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
                    className="rounded bg-gray-300 px-3 py-1 text-sm text-gray-800 hover:bg-gray-400"
                    onClick={() => setPending(null)}
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {!loading && (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={label} className="col-span-1 flex">
                    <dt className="w-1/2 font-medium text-gray-700">{label}:</dt>
                    <dd className="flex-1 break-words text-gray-800">{value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {actionButton('Encender', 'start', 'start', IoPowerSharp)}
              {actionButton('Apagar', 'stop', 'stop', IoPowerOutline)}
              {actionButton('Reset', 'reset', 'reset', IoRefreshSharp)}
            </div>

            {powerDisabled && (
              <p className="mt-3 text-xs text-red-500">{powerDisabledMessage}</p>
            )}
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body)
}
