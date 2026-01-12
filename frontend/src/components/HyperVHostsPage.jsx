import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { IoServerSharp, IoSwapHorizontalSharp } from 'react-icons/io5'
import { getHypervHosts, getHypervSnapshot, postHypervRefresh, getHypervConfig } from '../api/hypervHosts'
import { normalizeHypervHostSummary } from '../lib/normalizeHypervHost'
import { useInventoryState } from './VMTable/useInventoryState'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import InventoryMetaBar from './common/InventoryMetaBar'

const AUTO_REFRESH_MS = 5 * 60 * 1000
const gradientBg = 'bg-gradient-to-br from-slate-900 via-black to-slate-950'
const cardColors = ['from-blue-500/30', 'from-cyan-500/30', 'from-indigo-500/30', 'from-emerald-500/30']

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
        setStatus({ kind: 'success', text: `Snapshot hosts ${new Date(snap.generated_at).toLocaleTimeString()}` })
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

export default function HyperVHostsPage() {
  const [selected, setSelected] = useState(null)
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
  const statusNode = status ? (
    <div className={`mb-2 rounded-lg border px-3 py-1 text-xs ${status.kind === 'warning' ? 'border-amber-400/60 bg-amber-500/10 text-amber-200' : status.kind === 'error' ? 'border-red-400/60 bg-red-500/10 text-red-200' : status.kind === 'success' ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200' : 'border-cyan-400/60 bg-cyan-500/10 text-cyan-200'}`}>
      {status.text}
    </div>
  ) : null
  const bannerNode = useMemo(() => {
    const bannerToUse = banner || bannerRef.current
    if (!bannerToUse) return null
    return (
      <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${bannerToUse.kind === 'warning' ? 'border-amber-400/60 bg-amber-500/10 text-amber-200' : bannerToUse.kind === 'error' ? 'border-red-400/60 bg-red-500/10 text-red-200' : 'border-cyan-400/60 bg-cyan-500/10 text-cyan-200'}`}>
        <div className="font-semibold">{bannerToUse.title}</div>
        {bannerToUse.details && bannerToUse.details.length > 0 && (
          <ul className="list-disc pl-5">
            {bannerToUse.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
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
    <span className={`rounded-md px-2 py-0.5 text-xs ${val ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40' : 'bg-neutral-800 text-neutral-200 border border-neutral-700'}`}>
      {val ? 'Sí' : 'No'}
    </span>
  )

  const renderPct = (val) => {
    if (val == null || Number.isNaN(val)) return '—'
    return `${val}%`
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-white">{host.name}</h3>
              <p className="text-sm text-neutral-400">{host.cluster || 'Sin cluster'}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-white/20 px-3 py-1 text-sm text-neutral-200 hover:bg-white/10"
            >
              Cerrar
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-neutral-200">
            <div><span className="text-neutral-400">Versión:</span> {host.version || '—'}</div>
            <div><span className="text-neutral-400">CPU lógicos:</span> {host.logical_processors ?? '—'}</div>
            <div><span className="text-neutral-400">RAM:</span> {host.memory_capacity_gb ?? '—'} GB</div>
            <div><span className="text-neutral-400">VMs:</span> {host.total_vms ?? 0}</div>
            <div><span className="text-neutral-400">CPU uso:</span> {renderPct(host.cpu_usage_pct)}</div>
            <div><span className="text-neutral-400">RAM uso:</span> {renderPct(host.memory_usage_pct)}</div>
            <div><span className="text-neutral-400">Migración:</span> {host.vmm_migration_enabled ? 'Sí' : 'No'}</div>
            <div><span className="text-neutral-400">Uptime:</span> {uptime}</div>
            <div><span className="text-neutral-400">NICs:</span> {host.nic_count ?? 0}</div>
            <div><span className="text-neutral-400">Switches:</span> {host.switch_count}</div>
          </div>
          {host.switches && host.switches.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-neutral-400 mb-1">Switches</div>
              <div className="space-y-2 text-sm text-neutral-200 max-h-40 overflow-auto">
                {host.switches.map((sw, idx) => (
                  <div key={idx} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="font-semibold text-white">{sw.Name || sw.name || 'Switch'}</div>
                    <div className="text-xs text-neutral-400">{sw.NetAdapterInterfaceDescription || sw.description || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {host.nics && host.nics.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-neutral-400 mb-1">NICs</div>
              <div className="space-y-2 text-sm text-neutral-200 max-h-40 overflow-auto">
                {host.nics.map((nic, idx) => (
                  <div key={idx} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="font-semibold text-white">{nic.Name || nic.name || 'NIC'}</div>
                    <div className="text-xs text-neutral-400">{nic.InterfaceDescription || nic.description || '—'}</div>
                    <div className="text-xs text-neutral-400">MAC: {nic.MacAddress || '—'}</div>
                    <div className="text-xs text-neutral-400">Estado: {nic.Status || nic.status || '—'} · Vel: {nic.LinkSpeed || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {host.storage && host.storage.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-neutral-400 mb-1">Storage</div>
              <div className="space-y-2 text-sm text-neutral-200 max-h-40 overflow-auto">
                {host.storage.map((disk, idx) => (
                  <div key={idx} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="font-semibold text-white">{disk.FriendlyName || disk.Name || 'Disco'}</div>
                    <div className="text-xs text-neutral-400">Tamaño: {disk.Size || '—'}</div>
                    <div className="text-xs text-neutral-400">Estado: {disk.HealthStatus || disk.OperationalStatus || '—'}</div>
                    <div className="text-xs text-neutral-400">Tipo: {disk.MediaType || '—'}</div>
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
    <div className={`${gradientBg} min-h-screen text-white`}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
        {statusNode}
        {bannerNode}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-blue-300 drop-shadow">Hosts Hyper-V</h2>
            <p className="text-sm text-neutral-300">Inventario de hosts Hyper-V con recursos básicos y switches.</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-neutral-300">
            {refreshBusy && <span className="text-cyan-300 animate-pulse">Actualizando…</span>}
            <InventoryMetaBar
              generatedAt={snapshotGeneratedAt}
              source={snapshotSource}
              lastFetchTs={lastFetchTs}
              stale={snapshotStale}
              staleReason={snapshotStaleReason}
              className="items-end text-right"
              textClassName="text-xs text-neutral-300"
              badgeClassName="border-amber-400/60 text-amber-200 bg-amber-500/10"
            />
            <button
              onClick={handleRefresh}
              disabled={refreshBusy}
              aria-busy={refreshBusy}
              className="rounded-lg border border-blue-400/60 px-3 py-1.5 text-sm font-semibold text-blue-200 hover:bg-blue-400/10 disabled:cursor-not-allowed disabled:opacity-60"
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
                className={`rounded-2xl border border-white/10 bg-gradient-to-br ${cardColors[idx % cardColors.length]} p-4 shadow-lg`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="text-2xl text-blue-200" />
                  <span className="text-sm uppercase text-neutral-200">{card.label}</span>
                </div>
                <div className="mt-2 text-3xl font-semibold text-white">{card.value}</div>
              </div>
            )
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="text"
            placeholder="Buscar por host o cluster..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="col-span-2 rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40"
          />
          <select
            value={filter.cluster || ''}
            onChange={(e) => setFilter((prev) => ({ ...prev, cluster: e.target.value }))}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40"
          >
            <option value="">Cluster (todos)</option>
            {uniqueClusters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={groupByOption}
            onChange={(e) => setGroupByOption(e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40"
          >
            <option value="none">Sin agrupación</option>
            <option value="cluster">Cluster</option>
            <option value="version">Versión</option>
          </select>
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 text-xs text-neutral-300">
            <span className="rounded-full border border-cyan-400/60 bg-cyan-400/10 px-2 py-1 text-cyan-100">Filtros activos</span>
            <button onClick={clearFilters} className="text-blue-300 underline">
              Limpiar
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 shadow-2xl">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-neutral-900/60 text-xs uppercase text-neutral-300">
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
            <tbody className="divide-y divide-white/5 text-sm">
              {hasGroups &&
                entries.map(([group, rows]) => (
                  <tr key={group} className="bg-neutral-900/60">
                    <td colSpan={tableHeader.length} className="px-4 py-2">
                      <button
                        onClick={() => toggleGroup(group)}
                        className="flex w-full items-center justify-between text-left text-blue-200"
                      >
                        <span className="font-semibold">{group || 'Sin grupo'}</span>
                        <span className="text-xs text-neutral-400">
                          {rows.length} hosts · {rows.reduce((acc, r) => acc + (r.total_vms || 0), 0)} VMs
                        </span>
                      </button>
                      {!rows.length && <div className="text-neutral-400 text-sm mt-2">Sin datos</div>}
                      {rows.length > 0 &&
                        rows.map((host) => (
                          <div
                            key={host.id}
                            className="mt-2 rounded-lg border border-white/5 bg-neutral-950/70 p-3 transition hover:border-blue-300/40 hover:shadow-lg"
                            onClick={() => setSelected(host)}
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex-1">
                                <div className="text-sm font-semibold text-white">{host.name}</div>
                                <div className="text-xs text-neutral-400">{host.cluster || '—'}</div>
                              </div>
                              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-neutral-100">
                                {host.version || '—'}
                              </span>
                              <span className="text-xs text-neutral-300">CPU: {host.logical_processors ?? '—'}</span>
                              <span className="text-xs text-neutral-300">RAM: {host.memory_capacity_gb ?? '—'} GB</span>
                              <span className="text-xs text-neutral-300">Switches: {host.switch_count}</span>
                              {renderBool(host.vmm_migration_enabled)}
                              <div className="text-sm font-semibold text-blue-200">{host.total_vms} VMs</div>
                            </div>
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}

              {!hasGroups &&
                fallbackRows &&
                fallbackRows.map((host) => (
                  <tr key={host.id} className="hover:bg-neutral-900/60 cursor-pointer" onClick={() => setSelected(host)}>
                    <td className="px-4 py-3 font-semibold text-white">{host.name}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.cluster}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.version}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.logical_processors ?? '—'}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.memory_capacity_gb ?? '—'}</td>
                    <td className="px-4 py-3 text-neutral-200">{renderPct(host.cpu_usage_pct)}</td>
                    <td className="px-4 py-3 text-neutral-200">{renderPct(host.memory_usage_pct)}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.switch_count}</td>
                    <td className="px-4 py-3">{renderBool(host.vmm_migration_enabled)}</td>
                    <td className="px-4 py-3 text-blue-200 font-semibold">{host.total_vms}</td>
                  </tr>
                ))}

              {!loading && !error && processed.length === 0 && (
                <tr>
                  <td colSpan={tableHeader.length} className="px-4 py-6 text-center text-neutral-400">
                    Sin datos de hosts.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={tableHeader.length} className="px-4 py-6 text-center text-neutral-300">
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
