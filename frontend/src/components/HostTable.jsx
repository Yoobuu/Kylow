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
const gradientBg = 'bg-gradient-to-br from-neutral-900 via-black to-neutral-950'
const cardColors = ['from-yellow-500/30', 'from-cyan-500/30', 'from-blue-500/30', 'from-amber-500/30', 'from-emerald-500/30']

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

const Badge = ({ children, tone = 'border-yellow-400 text-yellow-300 bg-yellow-400/10' }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
    {children}
  </span>
)

const healthBadge = (health) => {
  const map = {
    healthy: { text: 'Saludable', tone: 'border-emerald-400 text-emerald-200 bg-emerald-500/10' },
    warning: { text: 'Advertencia', tone: 'border-amber-400 text-amber-200 bg-amber-500/10' },
    critical: { text: 'Crítico', tone: 'border-rose-400 text-rose-200 bg-rose-500/10' },
  }
  const cfg = map[health] || map.healthy
  return <Badge tone={cfg.tone}>{cfg.text}</Badge>
}

const typeBadge = (type) => (
  <Badge tone="border-cyan-400 text-cyan-200 bg-cyan-500/10">{type || 'Servidor'}</Badge>
)

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

  const renderBar = (value, tone = 'from-yellow-400 to-amber-500') => {
    if (value == null || Number.isNaN(value)) return <span className="text-neutral-400">—</span>
    const width = Math.min(Math.max(value, 0), 100)
    const color = value < 50 ? 'from-emerald-400 to-teal-500' : value < 80 ? tone : 'from-rose-500 to-red-600'
    return (
      <div className="space-y-1">
        <div className="text-xs text-neutral-200">{value}%</div>
        <div className="h-2 w-full rounded-full bg-neutral-800">
          <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${width}%` }} />
        </div>
      </div>
    )
  }

  const containerClass = isOvirt
    ? `${gradientBg} min-h-screen text-white -mx-4 -my-6 sm:-mx-6`
    : `${gradientBg} min-h-screen text-white`

  return (
    <div className={containerClass} data-tutorial-id="host-table-root">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-yellow-300 drop-shadow">{pageTitle}</h2>
            <p className="text-sm text-neutral-300">{pageSubtitle}</p>
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
            {refreshNotice ? (
              <span
                className={`text-xs ${
                  refreshNotice.kind === 'error'
                    ? 'text-rose-300'
                    : refreshNotice.kind === 'warning'
                      ? 'text-amber-200'
                      : 'text-cyan-200'
                }`}
              >
                {refreshNotice.text}
              </span>
            ) : null}
            <button
              onClick={handleRefresh}
              disabled={refreshBusy}
              aria-busy={refreshBusy}
              className="rounded-lg border border-yellow-400/60 px-3 py-1.5 text-sm font-semibold text-yellow-200 hover:bg-yellow-400/10 disabled:cursor-not-allowed disabled:opacity-60"
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
                className={`rounded-2xl border border-white/10 bg-gradient-to-br ${cardColors[idx % cardColors.length]} p-4 shadow-lg`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="text-2xl text-yellow-300" />
                  <span className="text-sm uppercase text-neutral-200">{card.label}</span>
                </div>
                <div className="mt-2 text-3xl font-semibold text-white">{card.value}</div>
              </div>
            )
          })}
        </div>

        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          data-tutorial-id="host-filters"
        >
          <input
            type="text"
            placeholder="Buscar por nombre o cluster..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="col-span-2 rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          />
          <select
            value={filter.cluster}
            onChange={(e) => handleFilterChange('cluster', e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="">Cluster (todos)</option>
            {uniqueClusters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filter.connection_state}
            onChange={(e) => handleFilterChange('connection_state', e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="">Conexión</option>
            {uniqueConnectionStates.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filter.version}
            onChange={(e) => handleFilterChange('version', e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="">Versión ESXi</option>
            {uniqueVersions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filter.vendor}
            onChange={(e) => handleFilterChange('vendor', e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="">Vendor</option>
            {uniqueVendors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filter.health || ''}
            onChange={(e) => handleFilterChange('health', e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="">Health</option>
            {uniqueHealth.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filter.server_type || ''}
            onChange={(e) => handleFilterChange('server_type', e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="">Tipo</option>
            {uniqueTypes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={groupByOption}
            onChange={(e) => setGroupByOption(e.target.value)}
            className="rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2 text-sm text-white focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40"
          >
            <option value="none">Sin agrupación</option>
            <option value="cluster">Cluster</option>
            <option value="estado">Estado</option>
            <option value="version">Versión</option>
            <option value="vendor">Vendor</option>
            <option value="health">Health</option>
            <option value="tipo">Tipo</option>
          </select>
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 text-xs text-neutral-300">
            <Badge tone="border-cyan-400 text-cyan-200 bg-cyan-400/10">Filtros activos</Badge>
            <button onClick={clearFilters} className="text-yellow-300 underline">
              Limpiar
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {isOvirt && (
          <div
            className="text-xs text-neutral-400"
            title="Las VMs apagadas no tienen host.id, por eso no se incluyen aquí."
          >
            En oVirt, este conteo muestra solo VMs en ejecución (las apagadas no se asignan a un host).
          </div>
        )}

        <div
          className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 shadow-2xl"
          data-tutorial-id="host-table-list"
        >
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
                        className="flex w-full items-center justify-between text-left text-yellow-200"
                      >
                        <span className="font-semibold">{group || 'Sin grupo'}</span>
                        <span className="text-xs text-neutral-400">
                          {collapsedGroups[group] ? 'Mostrar' : 'Ocultar'} ({rows.length})
                        </span>
                      </button>
                      {!collapsedGroups[group] &&
                        rows.map((host) => (
                          <div
                            key={host.id}
                            className="mt-2 rounded-lg border border-white/5 bg-neutral-950/70 p-3 transition hover:border-yellow-300/40 hover:shadow-lg"
                            onClick={() => handleRowClick(host)}
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex-1">
                                <div className="text-sm font-semibold text-white">{host.name}</div>
                                <div className="text-xs text-neutral-400">{host.cluster}</div>
                              </div>
                              {healthBadge(host.health)}
                              {typeBadge(host.server_type)}
                              <Badge tone="border-emerald-400 text-emerald-200 bg-emerald-400/10">
                                {host.connection_state || 'N/A'}
                              </Badge>
                              <div className="w-32">{renderBar(host.cpu_usage_pct)}</div>
                              <div className="w-32">{renderBar(host.memory_usage_pct, 'from-cyan-400 to-blue-500')}</div>
                              <div className="text-xs text-neutral-300">
                                ESXi {host.version} <span className="text-neutral-500">build</span> {host.build}
                              </div>
                              <div className="text-xs text-neutral-300">
                                {host.vendor} {host.model}
                              </div>
                              <div className="text-sm font-semibold text-yellow-200">{host.total_vms} VMs</div>
                            </div>
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
                    className="hover:bg-neutral-900/60 cursor-pointer"
                    onClick={() => handleRowClick(host)}
                  >
                    <td className="px-4 py-3 font-semibold text-white">{host.name}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.cluster}</td>
                    <td className="px-4 py-3">
                      <Badge tone="border-emerald-400 text-emerald-200 bg-emerald-400/10">
                        {host.connection_state || 'N/A'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{healthBadge(host.health)}</td>
                    <td className="px-4 py-3">{typeBadge(host.server_type)}</td>
                    <td className="px-4 py-3">{renderBar(host.cpu_usage_pct)}</td>
                    <td className="px-4 py-3">{renderBar(host.memory_usage_pct, 'from-cyan-400 to-blue-500')}</td>
                    <td className="px-4 py-3 text-neutral-200">{host.version}</td>
                    <td className="px-4 py-3 text-neutral-200">
                      {host.vendor} {host.model}
                    </td>
                    <td className="px-4 py-3 text-yellow-200 font-semibold">{host.total_vms}</td>
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
