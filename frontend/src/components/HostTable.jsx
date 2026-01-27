import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IoServerSharp, IoPulse, IoSwapHorizontalSharp } from 'react-icons/io5'
import { MdOutlinePower } from 'react-icons/md'
import { getVmwareHostsJob, getVmwareHostsSnapshot, postVmwareHostsRefresh } from '../api/hosts'
import { normalizeHostSummary } from '../lib/normalizeHost'
import { useInventoryState } from './VMTable/useInventoryState'
import HostDetailModal from './HostDetailModal'
import DeepExpertModal from './DeepExpertModal'
import InventoryMetaBar from './common/InventoryMetaBar'
import { useAuth } from '../context/AuthContext'

const AUTO_REFRESH_MS = 5 * 60 * 1000
const gradientBg = 'bg-white'
const cardColors = [
  'from-usfq-red/20',
  'from-usfq-red/10',
  'from-usfq-gray/20',
  'from-usfq-gray/15',
  'from-usfq-white/10',
]

const hostSummaryBuilder = (items) => {
  const total = items.length
  const clusters = new Set(items.map((h) => h.cluster).filter(Boolean)).size
  const connected = items.filter((h) => h.connection_state === 'CONNECTED' || h.connection_state === 'Conectado').length
  const disconnected = items.filter((h) => h.connection_state && !['CONNECTED', 'Conectado'].includes(h.connection_state)).length
  const healthCount = {
    healthy: items.filter((h) => h.health === 'healthy').length,
    warning: items.filter((h) => h.health === 'warning').length,
    critical: items.filter((h) => h.health === 'critical').length,
  }
  const avg = (arr) => {
    const valid = arr.filter((v) => Number.isFinite(v))
    if (!valid.length) return null
    return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100
  }
  const avgCpu = avg(items.map((h) => h.cpu_usage_pct))
  const avgRam = avg(items.map((h) => h.memory_usage_pct))
  const avgDs = avg(items.map((h) => h.datastore_usage_pct))
  const avgCpuFree = avg(items.map((h) => h.cpu_free_pct))
  const avgRamFree = avg(items.map((h) => h.memory_free_pct))
  return { total, clusters, connected, disconnected, avgCpu, avgRam, avgDs, avgCpuFree, avgRamFree, healthCount }
}

const HOST_GRID_COLS =
  'grid grid-cols-[minmax(180px,2fr)_minmax(140px,1.3fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(180px,1.3fr)_minmax(80px,0.7fr)] gap-x-3 items-center'

const Badge = ({ children, tone = 'border-[#D6C7B8] text-[#231F20] bg-[#FAF3E9]' }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
    {children}
  </span>
)

const healthBadge = (health) => {
  const map = {
    healthy: { text: 'Saludable', tone: 'border-[#B7E0C1] text-[#1B5E20] bg-[#E6F4EA]' },
    warning: { text: 'Advertencia', tone: 'border-[#FFE3A3] text-[#7A5E00] bg-[#FFF3CD]' },
    critical: { text: 'Crítico', tone: 'border-[#F5B5B5] text-[#8B0000] bg-[#FDE2E2]' },
  }
  const cfg = map[health] || map.healthy
  return <Badge tone={cfg.tone}>{cfg.text}</Badge>
}

const typeBadge = (type) => (
  <Badge tone="border-[#D6C7B8] text-[#231F20] bg-[#FAF3E9]">{type || 'Servidor'}</Badge>
)

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

export default function HostTable({
  providerKey = 'hosts',
  cacheKey,
  providerLabel = 'VMware',
  snapshotFetcher = getVmwareHostsSnapshot,
  refreshFn = postVmwareHostsRefresh,
  jobFetcher = getVmwareHostsJob,
  snapshotDataKey = 'vmware',
  pageTitle = 'Hosts ESXi',
  pageSubtitle = 'Inventario en vivo por cluster y estado.',
  getHostDetail,
  getHostDeep,
}) {
  const { hasPermission } = useAuth()
  const isSuperadmin = hasPermission('jobs.trigger')
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState(null)
  const [snapshotSource, setSnapshotSource] = useState(null)
  const [snapshotStale, setSnapshotStale] = useState(false)
  const [snapshotStaleReason, setSnapshotStaleReason] = useState(null)
  const [showDeep, setShowDeep] = useState(false)
  const [refreshJobId, setRefreshJobId] = useState(null)
  const [refreshPolling, setRefreshPolling] = useState(false)
  const [refreshRequested, setRefreshRequested] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState(null)
  const pollRef = useRef(null)
  const hostFetcher = useCallback(async () => {
    const snapshot = await snapshotFetcher()
    if (snapshot?.empty) {
      setSnapshotGeneratedAt(null)
      setSnapshotSource(null)
      setSnapshotStale(false)
      setSnapshotStaleReason(null)
      return { empty: true }
    }
    setSnapshotGeneratedAt(snapshot?.generated_at || null)
    setSnapshotSource(snapshot?.source || null)
    setSnapshotStale(Boolean(snapshot?.stale))
    setSnapshotStaleReason(snapshot?.stale_reason || null)
    const payload = snapshot?.data || {}
    const dataKey = snapshotDataKey || providerKey
    return Array.isArray(payload?.[dataKey]) ? payload[dataKey] : []
  }, [providerKey, snapshotDataKey, snapshotFetcher])

  const resolvedCacheKey = cacheKey ? `${cacheKey}:hosts` : `${providerKey}:hosts`
  const { state, actions } = useInventoryState({
    provider: providerKey,
    cacheKey: resolvedCacheKey,
    fetcher: hostFetcher,
    normalizeRecord: normalizeHostSummary,
    summaryBuilder: hostSummaryBuilder,
    groupersKey: 'hosts',
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
    selectedVm,
    selectedRecord,
    collapsedGroups,
    resumen,
    uniqueClusters,
    uniqueConnectionStates,
    uniqueVersions,
    uniqueVendors,
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
    setSelectedVm,
    setSelectedRecord,
    clearFilters,
    toggleGroup,
    fetchVm,
    onHeaderClick,
  } = actions

  const entries = useMemo(() => Object.entries(groups), [groups])
  const hasGroups = entries.length > 0
  const fallbackRows = !hasGroups && hosts.length > 0 ? hosts : null
  const uniqueHealth = useMemo(
    () => Array.from(new Set(hosts.map((h) => h.health).filter(Boolean))).sort(),
    [hosts]
  )
  const uniqueTypes = useMemo(
    () => Array.from(new Set(hosts.map((h) => h.server_type).filter(Boolean))).sort(),
    [hosts]
  )
  const refreshBusy = refreshPolling || refreshRequested || refreshing || loading
  const isOvirt = useMemo(
    () => providerKey === 'ovirt' || resolvedCacheKey.startsWith('ovirt'),
    [providerKey, resolvedCacheKey]
  )

  const handleFilterChange = useCallback(
    (field, value) => {
      setFilter((prev) => ({
        ...prev,
        [field]: value,
      }))
    },
    [setFilter]
  )

  const handleSelect = useCallback(
    (field) => (value) => handleFilterChange(field, value),
    [handleFilterChange]
  )

  const handleRowClick = useCallback(
    (row) => {
      if (!row) return
      setSelectedVm(row.id)
      setSelectedRecord(row)
    },
    [setSelectedRecord, setSelectedVm]
  )

  const handleCloseModal = useCallback(() => {
    setSelectedVm(null)
    setSelectedRecord(null)
    setShowDeep(false)
  }, [setSelectedVm, setSelectedRecord, setShowDeep])

  const handleRefresh = useCallback(async () => {
    if (!isSuperadmin) {
      const label = providerLabel ? ` ${providerLabel}` : ''
      setRefreshNotice({ kind: 'error', text: `Sin permisos para refrescar hosts${label}.` })
      return
    }
    setRefreshNotice(null)
    setRefreshRequested(true)
    try {
      const resp = await refreshFn({ force: true })
      if (resp?.message === 'cooldown_active') {
        const until = resp?.cooldown_until ? `hasta ${resp.cooldown_until}` : 'intervalo mínimo'
        setRefreshNotice({ kind: 'warning', text: `Cooldown activo (${until}).` })
        return
      }
      if (resp?.job_id) {
        setRefreshJobId(resp.job_id)
        setRefreshPolling(true)
      } else {
        setRefreshNotice({ kind: 'warning', text: 'No se pudo iniciar el refresh.' })
      }
    } catch (err) {
      const status = err?.response?.status
      if (status === 403) {
        const label = providerLabel ? ` ${providerLabel}` : ''
        setRefreshNotice({ kind: 'error', text: `Sin permisos para refrescar hosts${label}.` })
        return
      }
      const label = providerLabel ? ` ${providerLabel}` : ''
      setRefreshNotice({ kind: 'error', text: `Error iniciando refresh de hosts${label}.` })
    } finally {
      setRefreshRequested(false)
    }
  }, [isSuperadmin, providerLabel, refreshFn])

  useEffect(() => {
    if (!refreshJobId || !refreshPolling) return undefined
    const tick = async () => {
      try {
        const job = await jobFetcher(refreshJobId)
        const terminal = ['succeeded', 'failed', 'expired'].includes(job.status)
        const isPartial = job.message === 'partial'
        if (terminal) {
          setRefreshPolling(false)
          setRefreshJobId(null)
          if (job.status === 'succeeded') {
            setRefreshNotice(
              isPartial
                ? { kind: 'warning', text: 'Refresh parcial: algunos hosts no respondieron.' }
                : null
            )
          } else {
            const label = providerLabel ? ` ${providerLabel}` : ''
            setRefreshNotice({ kind: 'error', text: `No se pudo completar el refresh de hosts${label}.` })
          }
          await fetchVm({ refresh: false, showLoading: false })
        }
      } catch (err) {
        setRefreshPolling(false)
        setRefreshJobId(null)
        const label = providerLabel ? ` ${providerLabel}` : ''
        setRefreshNotice({ kind: 'error', text: `Error durante el refresh de hosts${label}.` })
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    pollRef.current = id
    return () => clearInterval(id)
  }, [refreshJobId, refreshPolling, fetchVm, jobFetcher, providerLabel])

  const kpiCards = [
    { label: 'Hosts totales', value: resumen.total || 0, icon: IoServerSharp },
    { label: 'Clusters', value: resumen.clusters || 0, icon: IoSwapHorizontalSharp },
    {
      label: 'Health',
      value: `${resumen.healthCount?.healthy || 0} OK / ${resumen.healthCount?.warning || 0} Warn / ${resumen.healthCount?.critical || 0} Crit`,
      icon: MdOutlinePower,
    },
    {
      label: 'Promedio CPU / RAM / DS',
      value: `${resumen.avgCpu ?? '—'}% · ${resumen.avgRam ?? '—'}% · ${resumen.avgDs ?? '—'}%`,
      icon: IoPulse,
    },
    {
      label: 'CPU libre / RAM libre (%)',
      value: `${resumen.avgCpuFree ?? '—'}% · ${resumen.avgRamFree ?? '—'}%`,
      icon: IoSwapHorizontalSharp,
    },
  ]

  const tableHeader = useMemo(
    () => [
      { key: 'name', label: 'Nombre' },
      { key: 'cluster', label: 'Cluster' },
      { key: 'connection_state', label: 'Conexión' },
      { key: 'health', label: 'Health' },
      { key: 'server_type', label: 'Tipo' },
      { key: 'cpu_usage_pct', label: 'CPU %' },
      { key: 'memory_usage_pct', label: 'RAM %' },
      { key: 'version', label: 'ESXi' },
      { key: 'vendor', label: 'Vendor/Modelo' },
      { key: 'total_vms', label: isOvirt ? 'VMs encendidas' : 'VMs' },
    ],
    [isOvirt]
  )

  const renderBar = (value) => {
    if (value == null || Number.isNaN(value)) return <span className="text-[#231F20]">—</span>
    const width = Math.min(Math.max(value, 0), 100)
    const color = value < 50 ? 'bg-[#939598]' : value < 80 ? 'bg-[#E11B22]/70' : 'bg-[#E11B22]'
    return (
      <div className="space-y-1">
        <div className="text-xs text-[#231F20]">{value}%</div>
        <div className="h-2 w-full rounded-full bg-[#E1E1E1]">
          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${width}%` }} />
        </div>
      </div>
    )
  }

  const containerClass = isOvirt
    ? `${gradientBg} min-h-screen w-full text-[#231F20] -mx-4 -my-6 sm:-mx-6`
    : `${gradientBg} min-h-screen w-full text-[#231F20]`

  return (
    <div className={containerClass} data-tutorial-id="host-table-root">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[3rem] font-bold text-[#E11B22]">{pageTitle}</h2>
            <p className="text-sm text-[#3b3b3b]">{pageSubtitle}</p>
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
            {refreshNotice ? (
              <span
                className={`text-xs ${
                  refreshNotice.kind === 'error'
                    ? 'text-usfq-red'
                    : refreshNotice.kind === 'warning'
                      ? 'text-[#7A5E00]'
                      : 'text-[#3b3b3b]'
                }`}
              >
                {refreshNotice.text}
              </span>
            ) : null}
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

        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
          data-tutorial-id="host-kpis"
        >
          {kpiCards.map((card, idx) => {
            const Icon = card.icon
            return (
              <div
                key={card.label}
                className={`rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4 shadow-lg`}
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

        <div className="rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4" data-tutorial-id="host-filters">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <input
              type="text"
              placeholder="Buscar por nombre o cluster..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="col-span-2 rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] placeholder:text-[#939598] focus:border-usfq-red focus:ring-2 focus:ring-usfq-red/40"
            />
          <BeigeSelect
            id="filter-cluster"
            value={filter.cluster}
            onChange={handleSelect('cluster')}
            options={[
              { value: '', label: 'Cluster (todos)' },
              ...uniqueClusters.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="filter-connection"
            value={filter.connection_state}
            onChange={handleSelect('connection_state')}
            options={[
              { value: '', label: 'Conexión' },
              ...uniqueConnectionStates.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="filter-version"
            value={filter.version}
            onChange={handleSelect('version')}
            options={[
              { value: '', label: 'Versión ESXi' },
              ...uniqueVersions.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="filter-vendor"
            value={filter.vendor}
            onChange={handleSelect('vendor')}
            options={[
              { value: '', label: 'Vendor' },
              ...uniqueVendors.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="filter-health"
            value={filter.health || ''}
            onChange={handleSelect('health')}
            options={[
              { value: '', label: 'Health' },
              ...uniqueHealth.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="filter-type"
            value={filter.server_type || ''}
            onChange={handleSelect('server_type')}
            options={[
              { value: '', label: 'Tipo' },
              ...uniqueTypes.map((c) => ({ value: c, label: c })),
            ]}
          />
          <BeigeSelect
            id="filter-group"
            value={groupByOption}
            onChange={setGroupByOption}
            options={[
              { value: 'none', label: 'Sin agrupación' },
              { value: 'cluster', label: 'Cluster' },
              { value: 'estado', label: 'Estado' },
              { value: 'version', label: 'Versión' },
              { value: 'vendor', label: 'Vendor' },
              { value: 'health', label: 'Health' },
              { value: 'tipo', label: 'Tipo' },
            ]}
          />
          </div>
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 text-xs text-usfq-white/80">
            <Badge tone="border-[#D6C7B8] text-[#231F20] bg-[#FAF3E9]">Filtros activos</Badge>
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

        {isOvirt && (
          <div
            className="text-xs text-usfq-gray"
            title="Las VMs apagadas no tienen host.id, por eso no se incluyen aquí."
          >
            En oVirt, este conteo muestra solo VMs en ejecución (las apagadas no se asignan a un host).
          </div>
        )}

        <div
          className="overflow-hidden rounded-2xl border border-[#E1D6C8] bg-white shadow-2xl"
          data-tutorial-id="host-table-list"
        >
          <table className="min-w-full divide-y divide-[#E1D6C8]">
            <thead className="bg-[#FAF3E9] text-xs uppercase text-[#E11B22]">
              <tr className={HOST_GRID_COLS}>
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
                  <tr key={group} className="bg-[#FAF3E9] text-[#E11B22]">
                    <td colSpan={tableHeader.length} className="px-4 py-2">
                      <button
                        onClick={() => toggleGroup(group)}
                        className="flex w-full items-center justify-between text-left text-[#E11B22]"
                      >
                        <span className="font-semibold">{group || 'Sin grupo'}</span>
                        <span className="text-xs text-[#E11B22]/70">
                          {collapsedGroups[group] ? 'Mostrar' : 'Ocultar'} ({rows.length})
                        </span>
                      </button>
                      {!collapsedGroups[group] &&
                        rows.map((host) => (
                          <div
                            key={host.id}
                            className={`mt-2 rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] p-3 transition hover:border-usfq-red/40 hover:shadow-lg text-[#231F20] ${HOST_GRID_COLS}`}
                            onClick={() => handleRowClick(host)}
                          >
                            <div className="text-sm font-semibold text-[#231F20]">{host.name}</div>
                            <div className="text-xs text-[#3b3b3b]">{host.cluster}</div>
                            <Badge tone="border-[#D6C7B8] text-[#231F20] bg-[#FAF3E9]">
                              {host.connection_state || 'N/A'}
                            </Badge>
                            {healthBadge(host.health)}
                            {typeBadge(host.server_type)}
                            <div className="w-full">{renderBar(host.cpu_usage_pct)}</div>
                            <div className="w-full">{renderBar(host.memory_usage_pct)}</div>
                            <div className="text-xs text-[#3b3b3b]">
                              ESXi {host.version} <span className="text-[#6b6b6b]">build</span> {host.build}
                            </div>
                            <div className="text-xs text-[#3b3b3b]">
                              {host.vendor} {host.model}
                            </div>
                            <div className="text-sm font-semibold text-usfq-red">{host.total_vms} VMs</div>
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}
              {!hasGroups &&
                fallbackRows &&
                fallbackRows.map((host) => (
                  <tr
                    key={host.id}
                    className={`odd:bg-white even:bg-[#FAF3E9] hover:bg-[#FAF3E9] cursor-pointer ${HOST_GRID_COLS}`}
                    onClick={() => handleRowClick(host)}
                  >
                    <td className="px-4 py-3 font-semibold text-[#231F20]">{host.name}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.cluster}</td>
                    <td className="px-4 py-3">
                      <Badge tone="border-[#D6C7B8] text-[#231F20] bg-[#FAF3E9]">
                        {host.connection_state || 'N/A'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{healthBadge(host.health)}</td>
                    <td className="px-4 py-3">{typeBadge(host.server_type)}</td>
                    <td className="px-4 py-3">{renderBar(host.cpu_usage_pct)}</td>
                    <td className="px-4 py-3">{renderBar(host.memory_usage_pct)}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">{host.version}</td>
                    <td className="px-4 py-3 text-[#3b3b3b]">
                      {host.vendor} {host.model}
                    </td>
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

      {selectedVm && (
        <HostDetailModal
          hostId={selectedVm}
          record={selectedRecord}
          onClose={handleCloseModal}
          onOpenDeep={() => setShowDeep(true)}
          getHostDetail={getHostDetail}
          getHostDeep={getHostDeep}
        />
      )}

      {showDeep && selectedVm && (
        <DeepExpertModal
          hostId={selectedVm}
          onClose={() => setShowDeep(false)}
          getHostDeep={getHostDeep}
        />
      )}
    </div>
  )
}
