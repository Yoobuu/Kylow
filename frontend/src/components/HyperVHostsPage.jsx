import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IoServerSharp, IoSwapHorizontalSharp, IoAlertCircleSharp } from 'react-icons/io5'
import { getHypervHosts, getHypervSnapshot, postHypervRefresh, getHypervConfig } from '../api/hypervHosts'
import { normalizeHypervHostSummary } from '../lib/normalizeHypervHost'
import { useInventoryState } from './VMTable/useInventoryState'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import InventoryMetaBar from './common/InventoryMetaBar'
import { formatGuayaquilTime } from '../lib/snapshotTime'

const AUTO_REFRESH_MS = 5 * 60 * 1000
const gradientBg = 'bg-white'
const cardColors = [
  'from-[#FAF3E9] to-[#FAF3E9]',
  'from-[#FAF3E9] to-[#FAF3E9]',
  'from-[#FAF3E9] to-[#FAF3E9]',
  'from-[#FAF3E9] to-[#FAF3E9]',
]

const inferCluster = (name) => {
  if (!name) return 'Otros'
  const first = name.toLowerCase()[0]
  if (first === 'p') return 'Producción'
  if (first === 't') return 'Test'
  if (first === 's') return 'Sandbox'
  return 'Otros'
}

const hostFetcherFactory = ({ hostsState, snapshotState, bannerState, discoverHosts, setStatus, setSnapshotGeneratedAt, setSnapshotSource, setSnapshotStale, setSnapshotStaleReason, isSuperadmin, useLegacyRef, initialRefreshRef, setJobId, setPolling }) => {
  return async ({ refresh } = {}) => {
    const params = refresh ? { refresh: true } : undefined
    const hs = hostsState.current.length ? hostsState.current : await discoverHosts()
    if (!hs.length) return []
    try {
      setStatus({ kind: 'info', text: 'Cargando snapshot hosts...' })
      const snap = await getHypervSnapshot('hosts', hs, 'summary')
      if (!snap || typeof snap !== 'object') {
        const err = new Error('snapshot_empty')
        err.response = { status: 204 }
        throw err
      }
      if (snap && Array.isArray(snap.data)) {
        snapshotState.current = snap
        bannerState.current = buildBannerFromSnapshot(snap)
        setSnapshotGeneratedAt(snap.generated_at || null)
        setSnapshotSource(snap.source || null)
        setSnapshotStale(Boolean(snap.stale))
        setSnapshotStaleReason(snap.stale_reason || null)
        const updatedAt = formatGuayaquilTime(snap.generated_at)
        setStatus({ kind: 'success', text: `Snapshot hosts ${updatedAt || '—'}` })
        return snap.data
      }
    } catch (err) {
      const status = err?.response?.status
      if (status === 401) throw err
      if (status !== 204) {
        // fall through to legacy
      }
    }
    if (isSuperadmin && !initialRefreshRef.current) {
      initialRefreshRef.current = true
      setSnapshotGeneratedAt(null)
      setSnapshotSource(null)
      setSnapshotStale(false)
      setSnapshotStaleReason(null)
      setStatus({ kind: 'info', text: 'Snapshot no disponible: generando snapshot inicial (hosts)...' })
      try {
        const resp = await postHypervRefresh({ scope: 'hosts', hosts: hs, level: 'summary', force: false })
        if (resp?.job_id) {
          setJobId(resp.job_id)
          setPolling(true)
          return []
        }
      } catch (e) {
        setStatus({ kind: 'error', text: 'No se pudo generar snapshot inicial (hosts)' })
      }
    }
    if (!isSuperadmin && !useLegacyRef.current) {
      setSnapshotGeneratedAt(null)
      setSnapshotSource(null)
      setSnapshotStale(false)
      setSnapshotStaleReason(null)
      setStatus({ kind: 'warning', text: 'Snapshot aún no generado; espera al refresh del superadmin' })
      throw new Error('Snapshot no disponible')
    }
    if (useLegacyRef.current && isSuperadmin) {
      setSnapshotGeneratedAt(null)
      setSnapshotSource(null)
      setSnapshotStale(false)
      setSnapshotStaleReason(null)
      setStatus({ kind: 'info', text: 'Snapshot no disponible: modo legacy (hosts)...' })
      const data = await getHypervHosts(params)
      const list = Array.isArray(data) ? data : data.results || []
      if (!hostsState.current.length) {
        hostsState.current = Array.from(new Set(list.map((h) => (h.host || h.name || '').toLowerCase()).filter(Boolean))).sort()
      }
      snapshotState.current = null
      bannerState.current = null
      return list
    }
    throw new Error('Snapshot no disponible')
  }
}

const buildBannerFromSnapshot = (snap) => {
  const errors = []
  Object.entries(snap.hosts_status || {}).forEach(([h, st]) => {
    if (!st?.state) return
    if (st.state !== 'ok') errors.push(`${h}: ${st.state}`)
  })
  if (snap.stale || errors.length) {
    return {
      kind: 'warning',
      title: 'Inventario parcial',
      details: errors,
    }
  }
  return null
}

const hostSummaryBuilder = (items) => {
  const total = items.length
  const clusters = new Set(items.map((h) => h.cluster).filter(Boolean)).size
  const totalVms = items.reduce((acc, h) => acc + (h.total_vms || 0), 0)
  const avgCpu = items.length ? Math.round((items.reduce((a, h) => a + (h.logical_processors || 0), 0) / items.length) * 100) / 100 : null
  const avgRam = items.length ? Math.round((items.reduce((a, h) => a + (h.memory_capacity_gb || 0), 0) / items.length) * 100) / 100 : null
  return { total, clusters, totalVms, avgCpu, avgRam }
}

const BeigeSelect = ({ id, value, options, onChange }) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const selectedLabel = useMemo(() => {
    const match = options.find((opt) => opt.value === value)
    return match ? match.label : options[0]?.label || 'Seleccionar'
  }, [options, value])

  useEffect(() => {
    const handleClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        className="w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-left text-sm text-[#231F20] shadow-sm focus:outline-none focus:ring-2 focus:ring-usfq-red/40"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedLabel}</span>
        <span className="float-right text-[#939598]">▾</span>
      </button>
      {open && (
        <ul
          className="absolute z-20 mt-2 max-h-60 w-full overflow-auto rounded-lg border border-[#E1D6C8] bg-white shadow-lg"
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((opt) => (
            <li key={opt.value ?? opt.label}>
              <button
                type="button"
                className={`w-full px-3 py-2 text-left text-sm transition ${
                  value === opt.value ? 'bg-[#FAF3E9] text-[#231F20]' : 'hover:bg-[#FAF3E9]'
                }`}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function HyperVHostsPage() {
  const [selected, setSelected] = useState(null)
  const [searchParams] = useSearchParams()
  const autoHostRef = useRef(null)
  const hostsRef = useRef([])
  const snapshotRef = useRef(null)
  const bannerRef = useRef(null)
  const [banner, setBanner] = useState(null)
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState(null)
  const [snapshotSource, setSnapshotSource] = useState(null)
  const [snapshotStale, setSnapshotStale] = useState(false)
  const [snapshotStaleReason, setSnapshotStaleReason] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [polling, setPolling] = useState(false)
  const pollRef = useRef(null)
  const { hasPermission } = useAuth()
  const isSuperadmin = hasPermission('jobs.trigger')
  const [refreshRequested, setRefreshRequested] = useState(false)
  const [status, setStatus] = useState(null)
  const initialRefreshRef = useRef(false)
  const useLegacyRef = useRef(false)

  const discoverHosts = useCallback(async () => {
    if (hostsRef.current.length) return hostsRef.current
    try {
      setStatus({ kind: 'info', text: 'Descubriendo hosts (config)...' })
      const cfg = await getHypervConfig()
      const hs = Array.isArray(cfg?.hosts)
        ? cfg.hosts.map((h) => (h || '').trim().toLowerCase()).filter(Boolean).sort()
        : []
      if (hs.length) {
        console.log('[HyperVHosts] hosts discover via /hyperv/config', hs)
        hostsRef.current = hs
        return hs
      }
    } catch (err) {
      console.warn('[HyperVHosts] config discovery failed', err)
    }
    try {
      setStatus({ kind: 'info', text: 'Descubriendo hosts (hosts)...' })
      const data = await getHypervHosts()
      const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []
      const hs = Array.from(
        new Set(
          list
            .map((h) => (h.host || h.name || '').trim().toLowerCase())
            .filter(Boolean)
        )
      ).sort()
      if (hs.length) {
        console.log('[HyperVHosts] hosts discover via /hyperv/hosts', hs)
        hostsRef.current = hs
        return hs
      }
    } catch (err) {
      // fallback
    }
    try {
      setStatus({ kind: 'info', text: 'Descubriendo hosts (vms/batch)...' })
      const { data } = await api.get('/hyperv/vms/batch')
      const payload = data?.results
      if (payload && typeof payload === 'object') {
        const hs = Object.keys(payload).map((h) => h.trim().toLowerCase()).filter(Boolean).sort()
        console.log('[HyperVHosts] hosts discover via /hyperv/vms/batch', hs)
        hostsRef.current = hs
        return hs
      }
    } catch (err) {
      // ignore
    }
    setStatus({ kind: 'error', text: 'No se encontraron hosts para Hyper-V' })
    return []
  }, [])

  const { state, actions } = useInventoryState({
    provider: 'hyperv-hosts',
    fetcher: hostFetcherFactory({
      hostsState: hostsRef,
      snapshotState: snapshotRef,
      bannerState: bannerRef,
      discoverHosts,
      setStatus,
      setSnapshotGeneratedAt,
      setSnapshotSource,
      setSnapshotStale,
      setSnapshotStaleReason,
      isSuperadmin,
      useLegacyRef,
      initialRefreshRef,
      setJobId,
      setPolling,
    }),
    normalizeRecord: normalizeHypervHostSummary,
    groupersKey: 'hosts',
    summaryBuilder: hostSummaryBuilder,
    initialGroup: 'cluster',
    cacheTtlMs: 5 * 60 * 1000,
    autoRefreshMs: AUTO_REFRESH_MS,
  })

  const {
    vms: hosts,
    loading,
    error,
    filter,
    groupByOption,
    globalSearch,
    resumen,
    uniqueClusters,
    hasFilters,
    refreshing,
    lastFetchTs,
    processed,
    groups,
  } = state
  const {
    setFilter,
    setGroupByOption,
    setGlobalSearch,
    clearFilters,
    toggleGroup,
    onHeaderClick,
    fetchVm,
  } = actions

  const entries = useMemo(() => Object.entries(groups), [groups])
  const hasGroups = entries.length > 0
  const fallbackRows = !hasGroups && hosts.length > 0 ? hosts : null

  const autoHost = searchParams.get('host')
  useEffect(() => {
    if (!autoHost) return
    if (autoHostRef.current === autoHost) return
    if (!hosts.length) return
    const match = hosts.find((host) => {
      const candidate = String(host?.host || host?.name || host?.id || '').toLowerCase()
      return candidate === String(autoHost).toLowerCase()
    })
    if (!match) return
    autoHostRef.current = autoHost
    setSelected(match)
  }, [autoHost, hosts])
  const statusNode = status ? (
    <div className={`mb-4 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-sm w-fit ${
      status.kind === 'warning' ? 'border-[#FFE3A3] bg-[#FFF3CD] text-[#7A5E00]' :
      status.kind === 'error' ? 'border-[#F5B5B5] bg-[#FDE2E2] text-[#8B0000]' :
      status.kind === 'success' ? 'border-[#B7E0C1] bg-[#E6F4EA] text-[#1B5E20]' :
      'border-[#D6C7B8] bg-[#FAF3E9] text-[#231F20]'
    }`}>
      <span className={`h-2 w-2 rounded-full ${
        status.kind === 'warning' ? 'bg-[#7A5E00]' :
        status.kind === 'error' ? 'bg-[#E11B22]' :
        status.kind === 'success' ? 'bg-[#1B5E20]' :
        'bg-[#E11B22]'
      } ${status.kind === 'info' || status.text.includes('Cargando') ? 'animate-pulse' : ''}`} />
      {status.text}
    </div>
  ) : null
  const bannerNode = useMemo(() => {
    const b = banner || bannerRef.current
    if (!b) return null
    const isError = b.kind === 'error'
    const isWarning = b.kind === 'warning'

    return (
      <div className="mb-6 flex items-start gap-4 rounded-2xl border border-[#E1D6C8] bg-white p-4 shadow-sm transition-all hover:shadow-md">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          isError ? 'bg-[#FDE2E2] text-[#E11B22]' : 
          isWarning ? 'bg-[#FFF3CD] text-[#7A5E00]' : 
          'bg-[#FAF3E9] text-[#E11B22]'
        }`}>
          <IoAlertCircleSharp className="text-2xl" />
        </div>
        
        <div className="flex-1 space-y-1">
          <h4 className="font-bold text-[#231F20]">{b.title}</h4>
          
          {b.details && b.details.length > 0 && (
            <div className="space-y-0.5 text-xs text-[#3b3b3b]">
              {b.details.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }, [banner])

  useEffect(() => {
    setBanner(bannerRef.current || null)
  }, [lastFetchTs])

  const handleRefresh = useCallback(async () => {
    if (!isSuperadmin) {
      fetchVm({ refresh: true, showLoading: false })
      return
    }
    const hs = hostsRef.current.length ? hostsRef.current : await discoverHosts()
    if (!hs.length) {
      fetchVm({ refresh: true, showLoading: false })
      return
    }
    try {
      setRefreshRequested(true)
      const resp = await postHypervRefresh({ scope: 'hosts', hosts: hs, level: 'summary', force: true })
      if (resp?.message === 'cooldown_active') {
        setBanner({
          kind: 'info',
          title: 'Cooldown activo',
          details: [`Próximo refresh después de ${resp.cooldown_until || 'intervalo mínimo'}`],
        })
        setStatus({ kind: 'info', text: `Cooldown activo hasta ${resp.cooldown_until || ''}` })
        return
      }
      if (resp?.job_id) {
        setJobId(resp.job_id)
        setPolling(true)
        setStatus({ kind: 'info', text: 'Refrescando inventario (job en curso)...' })
      }
    } catch (err) {
      const status = err?.response?.status
      if (status === 401) throw err
        if (status === 403) {
        setStatus({ kind: 'error', text: 'Sin permisos para refrescar Hyper-V' })
        setBanner({
          kind: 'error',
          title: 'No se pudo iniciar refresh',
          details: ['Permisos insuficientes'],
        })
        return
      }
      setBanner({
        kind: 'error',
        title: 'No se pudo iniciar refresh',
        details: [err?.message || 'Error desconocido'],
      })
      setStatus({ kind: 'error', text: 'Error iniciando refresh' })
      fetchVm({ refresh: true, showLoading: false })
    } finally {
      setRefreshRequested(false)
    }
  }, [discoverHosts, fetchVm, isSuperadmin])

  useEffect(() => {
    if (!jobId || !polling) return undefined
    const tick = async () => {
      try {
        const { data } = await api.get(`/hyperv/jobs/${jobId}`)
        const terminal = ['succeeded', 'failed', 'expired'].includes(data.status)
        const errors = []
        Object.entries(data.hosts_status || {}).forEach(([h, st]) => {
          if (st?.state && st.state !== 'ok') errors.push(`${h}: ${st.state}`)
        })
        if (errors.length || data.message === 'partial') {
          setBanner({
            kind: 'warning',
            title: 'Refresh parcial',
            details: errors,
          })
          setStatus({ kind: 'warning', text: 'Refresh parcial' })
        }
        if (terminal) {
          setPolling(false)
          setJobId(null)
          setStatus({ kind: 'success', text: 'Refresh completado, recargando snapshot...' })
          await fetchVm({ refresh: false, showLoading: false })
        }
      } catch (err) {
        setPolling(false)
        setJobId(null)
        setStatus({ kind: 'error', text: 'Error durante polling del job' })
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    pollRef.current = id
    return () => clearInterval(id)
  }, [jobId, polling, fetchVm])

  useEffect(() => {
    setBanner(bannerRef.current)
  }, [bannerRef.current])

  const refreshBusy = polling || refreshRequested || loading || refreshing

  const kpiCards = [
    { label: 'Hosts Hyper-V', value: resumen.total || 0, icon: IoServerSharp },
    { label: 'Clusters', value: resumen.clusters || 0, icon: IoSwapHorizontalSharp },
    { label: 'VMs totales', value: resumen.totalVms || 0, icon: IoServerSharp },
    { label: 'Promedio CPU / RAM (GB)', value: `${resumen.avgCpu ?? '—'} · ${resumen.avgRam ?? '—'}`, icon: IoSwapHorizontalSharp },
  ]

  const tableHeader = [
    { key: 'name', label: 'Host' },
    { key: 'cluster', label: 'Cluster' },
    { key: 'version', label: 'Versión' },
    { key: 'logical_processors', label: 'vCPU host' },
    { key: 'memory_capacity_gb', label: 'RAM (GB)' },
    { key: 'cpu_usage_pct', label: 'CPU %' },
    { key: 'memory_usage_pct', label: 'RAM %' },
    { key: 'switch_count', label: 'Switches' },
    { key: 'vmm_migration_enabled', label: 'Migración' },
    { key: 'total_vms', label: 'VMs' },
  ]

  const renderBool = (val) => (
    <span
      className={`rounded-md px-2 py-0.5 text-xs ${
        val
          ? 'bg-[#E6F4EA] text-[#1B5E20] border border-[#B7E0C1]'
          : 'bg-[#FAF3E9] text-[#231F20] border border-[#D6C7B8]'
      }`}
    >
      {val ? 'Sí' : 'No'}
    </span>
  )

  const renderPct = (val) => {
    if (val == null || Number.isNaN(val)) return '—'
    return `${val}%`
  }

  const inferCluster = (name) => {
    if (!name) return 'Otros'
    const first = name.toLowerCase()[0]
    if (first === 'p') return 'Producción'
    if (first === 't') return 'Test'
    if (first === 's') return 'Sandbox'
    return 'Otros'
  }

  const Modal = ({ host, onClose }) => {
    if (!host) return null
    const uptime = host.uptime_seconds
      ? (() => {
          const d = Math.floor(host.uptime_seconds / 86400)
          const h = Math.floor((host.uptime_seconds % 86400) / 3600)
          const m = Math.floor((host.uptime_seconds % 3600) / 60)
          return `${d}d ${h}h ${m}m`
        })()
      : '—'
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-[#E1D6C8] bg-white p-6 shadow-2xl text-[#231F20]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-[#231F20]">{host.name}</h3>
              <p className="text-sm text-[#3b3b3b]">{host.cluster || 'Sin cluster'}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-[#D6C7B8] px-3 py-1 text-sm text-[#231F20] hover:bg-[#FAF3E9]"
            >
              Cerrar
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-[#231F20]">
            <div><span className="text-[#6b6b6b]">Versión:</span> {host.version || '—'}</div>
            <div><span className="text-[#6b6b6b]">CPU lógicos:</span> {host.logical_processors ?? '—'}</div>
            <div><span className="text-[#6b6b6b]">RAM:</span> {host.memory_capacity_gb ?? '—'} GB</div>
            <div><span className="text-[#6b6b6b]">VMs:</span> {host.total_vms ?? 0}</div>
            <div><span className="text-[#6b6b6b]">CPU uso:</span> {renderPct(host.cpu_usage_pct)}</div>
            <div><span className="text-[#6b6b6b]">RAM uso:</span> {renderPct(host.memory_usage_pct)}</div>
            <div><span className="text-[#6b6b6b]">Migración:</span> {host.vmm_migration_enabled ? 'Sí' : 'No'}</div>
            <div><span className="text-[#6b6b6b]">Uptime:</span> {uptime}</div>
            <div><span className="text-[#6b6b6b]">NICs:</span> {host.nic_count ?? 0}</div>
            <div><span className="text-[#6b6b6b]">Switches:</span> {host.switch_count}</div>
          </div>
          {host.switches && host.switches.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-[#6b6b6b] mb-1">Switches</div>
              <div className="space-y-2 text-sm text-[#231F20] max-h-40 overflow-auto">
                {host.switches.map((sw, idx) => (
                  <div key={idx} className="rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] px-3 py-2">
                    <div className="font-semibold text-[#231F20]">{sw.Name || sw.name || 'Switch'}</div>
                    <div className="text-xs text-[#6b6b6b]">{sw.NetAdapterInterfaceDescription || sw.description || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {host.nics && host.nics.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-[#6b6b6b] mb-1">NICs</div>
              <div className="space-y-2 text-sm text-[#231F20] max-h-40 overflow-auto">
                {host.nics.map((nic, idx) => (
                  <div key={idx} className="rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] px-3 py-2">
                    <div className="font-semibold text-[#231F20]">{nic.Name || nic.name || 'NIC'}</div>
                    <div className="text-xs text-[#6b6b6b]">{nic.InterfaceDescription || nic.description || '—'}</div>
                    <div className="text-xs text-[#6b6b6b]">MAC: {nic.MacAddress || '—'}</div>
                    <div className="text-xs text-[#6b6b6b]">Estado: {nic.Status || nic.status || '—'} · Vel: {nic.LinkSpeed || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {host.storage && host.storage.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-[#6b6b6b] mb-1">Storage</div>
              <div className="space-y-2 text-sm text-[#231F20] max-h-40 overflow-auto">
                {host.storage.map((disk, idx) => (
                  <div key={idx} className="rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] px-3 py-2">
                    <div className="font-semibold text-[#231F20]">{disk.FriendlyName || disk.Name || 'Disco'}</div>
                    <div className="text-xs text-[#6b6b6b]">Tamaño: {disk.Size || '—'}</div>
                    <div className="text-xs text-[#6b6b6b]">Estado: {disk.HealthStatus || disk.OperationalStatus || '—'}</div>
                    <div className="text-xs text-[#6b6b6b]">Tipo: {disk.MediaType || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`${gradientBg} min-h-screen text-[#231F20]`} data-tutorial-id="hyperv-hosts-root">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
        {statusNode}
        {bannerNode}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-[#E11B22]">Hosts Hyper-V</h2>
            <p className="text-sm text-[#3b3b3b]">Inventario de hosts Hyper-V con recursos básicos y switches.</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-[#3b3b3b]">
            {refreshBusy && <span className="text-[#E11B22] animate-pulse">Actualizando…</span>}
            <InventoryMetaBar
              generatedAt={snapshotGeneratedAt}
              source={snapshotSource}
              lastFetchTs={lastFetchTs}
              stale={snapshotStale}
              staleReason={snapshotStaleReason}
              className="items-end text-right"
              textClassName="text-xs text-[#3b3b3b]"
              badgeClassName="border-usfq-red/60 text-usfq-red bg-usfq-red/10"
            />
            <button
              onClick={handleRefresh}
              disabled={refreshBusy}
              aria-busy={refreshBusy}
              className="rounded-lg bg-[#E11B22] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#c9161c] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refrescar
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpiCards.map((card, idx) => {
            const Icon = card.icon
            return (
              <div
                key={card.label}
                className={`rounded-2xl border border-[#E1D6C8] bg-gradient-to-br ${cardColors[idx % cardColors.length]} p-4 shadow-lg`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="text-2xl text-[#E11B22]" />
                  <span className="text-sm uppercase text-[#E11B22]">{card.label}</span>
                </div>
                <div className="mt-2 text-3xl font-semibold text-[#231F20]">{card.value}</div>
              </div>
            )
          })}
        </div>

        <div className="rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="text"
            placeholder="Buscar por host o cluster..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="col-span-2 rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] placeholder:text-[#939598] focus:border-usfq-red focus:ring-2 focus:ring-usfq-red/40"
          />
          <BeigeSelect
            id="hyperv-filter-cluster"
            value={filter.cluster || ''}
            onChange={(value) => setFilter((prev) => ({ ...prev, cluster: value }))}
            options={[
              { value: '', label: 'Cluster (todos)' },
              ...uniqueClusters.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="hyperv-filter-group"
            value={groupByOption}
            onChange={setGroupByOption}
            options={[
              { value: 'none', label: 'Sin agrupación' },
              { value: 'cluster', label: 'Cluster' },
              { value: 'version', label: 'Versión' },
            ]}
          />
        </div>
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 text-xs text-[#3b3b3b]">
            <span className="rounded-full border border-[#D6C7B8] bg-[#FAF3E9] px-2 py-1 text-[#231F20]">Filtros activos</span>
            <button onClick={clearFilters} className="text-usfq-red underline">
              Limpiar
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-usfq-red/40 bg-usfq-red/10 p-4 text-sm text-usfq-red">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#E1D6C8] bg-white shadow-2xl">
          <table className="min-w-full divide-y divide-[#E1D6C8]">
            <thead className="bg-[#FAF3E9] text-xs uppercase text-[#E11B22]">
              <tr>
                {tableHeader.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => onHeaderClick(col.key)}
                    className="cursor-pointer px-4 py-3 text-left"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1D6C8] text-sm text-[#231F20]">
              {hasGroups &&
                entries.map(([group, rows]) => (
                  <React.Fragment key={group}>
                    <tr className="bg-[#FAF3E9] text-[#E11B22]">
                      <td colSpan={tableHeader.length} className="px-4 py-2">
                        <button
                          onClick={() => toggleGroup(group)}
                          className="flex w-full items-center justify-between text-left text-[#E11B22]"
                        >
                          <span className="font-semibold">{group || 'Sin grupo'}</span>
                          <span className="text-xs text-[#E11B22]/70">
                            {rows.length} hosts · {rows.reduce((acc, r) => acc + (r.total_vms || 0), 0)} VMs
                          </span>
                        </button>
                      </td>
                    </tr>
                    {rows.length > 0 &&
                      rows.map((host) => (
                        <tr 
                          key={host.id} 
                          className="odd:bg-white even:bg-[#FAF3E9] hover:bg-[#FAF3E9] cursor-pointer"
                          onClick={() => setSelected(host)}
                        >
                          <td className="px-4 py-3 font-semibold text-[#231F20]">{host.name}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{host.cluster || inferCluster(host.name)}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{host.version}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{host.logical_processors ?? '—'}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{host.memory_capacity_gb ?? '—'}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{renderPct(host.cpu_usage_pct)}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{renderPct(host.memory_usage_pct)}</td>
                          <td className="px-4 py-3 text-[#3b3b3b]">{host.switch_count}</td>
                          <td className="px-4 py-3">{renderBool(host.vmm_migration_enabled)}</td>
                          <td className="px-4 py-3 text-usfq-red font-semibold">{host.total_vms}</td>
                        </tr>
                      ))}
                  </React.Fragment>
                ))}

              {!hasGroups &&
                fallbackRows &&
                fallbackRows.map((host) => (
                  <tr 
                    key={host.id} 
                    className="odd:bg-white even:bg-[#FAF3E9] hover:bg-[#FAF3E9] cursor-pointer" 
                    onClick={() => setSelected(host)}
                  >
                    <td className="px-4 py-3 font-semibold text-[#231F20]">{host.name}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.cluster || inferCluster(host.name)}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.version}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.logical_processors ?? '—'}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.memory_capacity_gb ?? '—'}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{renderPct(host.cpu_usage_pct)}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{renderPct(host.memory_usage_pct)}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.switch_count}</td>
                    <td className="px-4 py-3">{renderBool(host.vmm_migration_enabled)}</td>
                    <td className="px-4 py-3 text-usfq-red font-semibold">{host.total_vms}</td>
                  </tr>
                ))}

              {!loading && !error && processed.length === 0 && (
                <tr>
                  <td colSpan={tableHeader.length} className="px-4 py-6 text-center text-[#3b3b3b]">
                    Sin datos de hosts.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={tableHeader.length} className="px-4 py-6 text-center text-[#3b3b3b]">
                    Cargando...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {selected && <Modal host={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
