import React, { useCallback, useMemo, useDeferredValue, useState, useEffect, useRef } from 'react'
import { getVmwareSnapshot, getVmwareJob, postVmwareRefresh } from '../api/vmware'
import { useInventoryState } from './VMTable/useInventoryState'
import VMSummaryCards from './VMTable/VMSummaryCards'
import VMFiltersPanel from './VMTable/VMFiltersPanel'
import VMGroupsTable from './VMTable/VMGroupsTable'
import VMEmptyState from './VMTable/VMEmptyState'
import VMDetailModal from './VMDetailModal'
import { columnsVMware } from './inventoryColumns.jsx'
import { exportInventoryCsv } from '../lib/exportCsv'
import { normalizeVMware } from '../lib/normalize'
import InventoryMetaBar from './common/InventoryMetaBar'
import * as inventoryCache from '../lib/inventoryCache'
import { useAuth } from '../context/AuthContext'

const AUTO_REFRESH_MS = 5 * 60 * 1000
const DEBUG_SNAPSHOT = false

export default function VMTable({
  providerKey = 'vmware',
  cacheKey,
  providerLabel = 'VMware',
  snapshotFetcher: fetchSnapshot = getVmwareSnapshot,
  refreshFn = postVmwareRefresh,
  jobFetcher = getVmwareJob,
  snapshotDataKey = 'vmware',
  columns = columnsVMware,
  normalizeRecord = normalizeVMware,
  exportFilenameBase = 'vmware_inventory',
  exportFn = exportInventoryCsv,
  exportLabel = 'Exportar CSV',
  pageTitle = 'Inventario de VMs',
  vmDetailFetcher,
  vmPerfFetcher,
  powerActionsEnabled = true,
  powerUnavailableMessage,
}) {
  const { hasPermission } = useAuth()
  const isSuperadmin = hasPermission('jobs.trigger')
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState(null)
  const [snapshotSource, setSnapshotSource] = useState(null)
  const [snapshotStale, setSnapshotStale] = useState(false)
  const [snapshotStaleReason, setSnapshotStaleReason] = useState(null)
  const [snapshotLoadedFromSnapshot, setSnapshotLoadedFromSnapshot] = useState(false)
  const [refreshJobId, setRefreshJobId] = useState(null)
  const [refreshPolling, setRefreshPolling] = useState(false)
  const [refreshRequested, setRefreshRequested] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState(null)
  const pollRef = useRef(null)
  const resolvedCacheKey = cacheKey ? `${cacheKey}:vms` : `${providerKey}:vms`
  const snapshotFetcher = useCallback(async () => {
    const snapshot = await fetchSnapshot()
    if (DEBUG_SNAPSHOT) {
      const payloadKeys =
        snapshot && snapshot.data && typeof snapshot.data === 'object'
          ? Object.keys(snapshot.data)
          : []
      console.log('vmware snapshot response', snapshot)
      console.log('vmware snapshot status empty?', snapshot?.empty)
      console.log('generated_at', snapshot?.generated_at, 'source', snapshot?.source)
      console.log('payload keys', payloadKeys)
    }
    if (snapshot?.empty) {
      setSnapshotGeneratedAt(null)
      setSnapshotSource(null)
      setSnapshotStale(false)
      setSnapshotStaleReason(null)
      setSnapshotLoadedFromSnapshot(false)
      return { empty: true }
    }
    setSnapshotGeneratedAt(snapshot?.generated_at || null)
    setSnapshotSource(snapshot?.source || null)
    setSnapshotStale(Boolean(snapshot?.stale))
    setSnapshotStaleReason(snapshot?.stale_reason || null)
    setSnapshotLoadedFromSnapshot(true)
    const payload = snapshot?.data
    if (Array.isArray(payload)) {
      return payload
    }
    const dataKey = snapshotDataKey || providerKey
    if (payload && typeof payload === 'object') {
      if (Array.isArray(payload?.[dataKey])) return payload[dataKey]
      const values = Object.values(payload)
      if (values.length === 1 && Array.isArray(values[0])) return values[0]
    }
    if (Array.isArray(snapshot?.[dataKey])) {
      return snapshot[dataKey]
    }
    if (Array.isArray(snapshot?.records)) {
      return snapshot.records
    }
    return []
  }, [providerKey, snapshotDataKey, fetchSnapshot])
  const { state, actions } = useInventoryState({
    provider: providerKey,
    cacheKey: resolvedCacheKey,
    autoRefreshMs: AUTO_REFRESH_MS,
    fetcher: snapshotFetcher,
    normalizeRecord,
  })
  const {
    vms,
    loading,
    error,
    emptyMessage,
    filter,
    groupByOption,
    globalSearch,
    selectedVm,
    selectedRecord,
    collapsedGroups,
    resumen,
    uniqueEnvironments,
    uniquePowerStates,
    uniqueGuestOS,
    uniqueHosts,
    uniqueClusters,
    uniqueVlans,
    processed,
    groups,
    sortBy,
    hasFilters,
    refreshing,
    lastFetchTs,
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
    handlePowerChange,
  } = actions

  const entries = useMemo(() => Object.entries(groups), [groups])
  const deferredEntries = useDeferredValue(entries)
  const hasGroups = entries.length > 0
  const fallbackRows = !hasGroups && vms.length > 0 ? vms : null
  const refreshBusy = refreshPolling || refreshRequested || refreshing || loading
  const refreshNoticeTone =
    refreshNotice?.kind === 'error'
      ? 'text-red-600'
      : refreshNotice?.kind === 'warning'
        ? 'text-amber-600'
        : 'text-blue-600'

  useEffect(() => {
    if (snapshotLoadedFromSnapshot) return
    if (snapshotGeneratedAt || snapshotSource) return
    if (!vms.length) return
    const cachedEntry = inventoryCache.get(resolvedCacheKey)
    const cachedList = Array.isArray(cachedEntry?.data) ? cachedEntry.data : null
    if (!cachedList || !cachedList.length) return
    setSnapshotSource('cache')
    setSnapshotGeneratedAt(null)
    setSnapshotStale(false)
    setSnapshotStaleReason(null)
  }, [
    snapshotLoadedFromSnapshot,
    snapshotGeneratedAt,
    snapshotSource,
    vms.length,
    resolvedCacheKey,
  ])

  const handleFilterChange = useCallback(
    (field, value) => {
      setFilter((prev) => ({
        ...prev,
        [field]: value,
      }))
    },
    [setFilter]
  )

  const handleSearchChange = useCallback(
    (event) => setGlobalSearch(event.target.value),
    [setGlobalSearch]
  )

  const handleGroupChange = useCallback(
    (value) => setGroupByOption(value),
    [setGroupByOption]
  )

  const handleExport = useCallback(() => {
    if (!processed.length) return
    exportFn(processed, exportFilenameBase)
  }, [processed, exportFilenameBase, exportFn])

  const handleRefresh = useCallback(async () => {
    if (!isSuperadmin) {
      const label = providerLabel ? ` ${providerLabel}` : ''
      setRefreshNotice({ kind: 'error', text: `Sin permisos para refrescar VMs${label}.` })
      return
    }
    setRefreshNotice(null)
    setRefreshRequested(true)
    try {
      const resp = await refreshFn({ force: true })
      if (resp?.message === 'cooldown_active') {
        const until = resp?.cooldown_until ? `hasta ${resp.cooldown_until}` : 'intervalo minimo'
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
        setRefreshNotice({ kind: 'error', text: `Sin permisos para refrescar VMs${label}.` })
        return
      }
      const label = providerLabel ? ` ${providerLabel}` : ''
      setRefreshNotice({ kind: 'error', text: `Error iniciando refresh de VMs${label}.` })
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
                ? { kind: 'warning', text: 'Refresh parcial: algunos datos no se pudieron actualizar.' }
                : null
            )
          } else {
            const label = providerLabel ? ` ${providerLabel}` : ''
            setRefreshNotice({ kind: 'error', text: `No se pudo completar el refresh de VMs${label}.` })
          }
          await fetchVm({ refresh: false, showLoading: false })
        }
      } catch (err) {
        setRefreshPolling(false)
        setRefreshJobId(null)
        const label = providerLabel ? ` ${providerLabel}` : ''
        setRefreshNotice({ kind: 'error', text: `Error durante el refresh de VMs${label}.` })
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    pollRef.current = id
    return () => clearInterval(id)
  }, [refreshJobId, refreshPolling, fetchVm, jobFetcher, providerLabel])

  const handleRowClick = useCallback(
    (row) => {
      if (!row) return
      const normalized = row.provider ? row : { ...normalizeRecord(row), __raw: row }
      if (!normalized.id) return
      setSelectedVm(normalized.id)
      setSelectedRecord(normalized)
    },
    [normalizeRecord, setSelectedRecord, setSelectedVm]
  )

  const handleCloseModal = useCallback(
    () => {
      setSelectedVm(null)
      setSelectedRecord(null)
    },
    [setSelectedRecord, setSelectedVm]
  )

  const handleDetailAction = useCallback(
    (path) => {
      if (!selectedVm) return
      const newState =
        path === 'start' ? 'POWERED_ON'
          : path === 'stop' ? 'POWERED_OFF'
          : ''
      handlePowerChange(selectedVm, newState)
      setSelectedVm(null)
      setSelectedRecord(null)
    },
    [handlePowerChange, selectedVm, setSelectedRecord, setSelectedVm]
  )

  let emptyStateType = null
  if (!loading && !error && !emptyMessage && processed.length === 0) {
    emptyStateType = hasFilters ? 'filtered' : 'empty'
  } else if (error) {
    emptyStateType = 'error'
  }

  const resolvedTitle =
    pageTitle === 'Inventario de VMs' && providerLabel
      ? `Inventario de VMs ${providerLabel}`
      : pageTitle

  return (
    <div className="p-6 bg-gray-50 min-h-screen" data-tutorial-id="vm-table-root">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-[2.6rem] font-bold text-[#231F20] mb-2">{resolvedTitle}</h2>
          <div className="h-1 w-32 bg-[#E11B22] rounded-full"></div>
        </div>
        <div className="flex flex-col items-end gap-2" data-tutorial-id="vm-table-actions">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshBusy}
              aria-busy={refreshBusy}
              className="bg-[#E11B22] border border-[#E11B22] text-white font-medium py-2 px-4 rounded-lg shadow-sm hover:bg-[#c9161c] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Actualizar inventario
            </button>
            <button
              onClick={handleExport}
              disabled={!processed.length}
              className="bg-[#E11B22] text-white font-medium py-2 px-4 rounded-lg shadow hover:bg-[#c9161c] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exportLabel}
            </button>
          </div>
          {refreshBusy && (
            <div className="text-xs text-[#E11B22] animate-pulse text-right">
              Actualizando&hellip;
            </div>
          )}
          {refreshNotice ? (
            <div className={`text-xs text-right ${refreshNoticeTone}`}>
              {refreshNotice.text}
            </div>
          ) : null}
          <InventoryMetaBar
            generatedAt={snapshotGeneratedAt}
            source={snapshotSource}
            lastFetchTs={lastFetchTs}
            stale={snapshotStale}
            staleReason={snapshotStaleReason}
            className="items-end text-right"
          />
        </div>
      </div>

      <div data-tutorial-id="vm-summary">
        <VMSummaryCards summary={resumen} />
      </div>

      <div className="mb-6">
        <label htmlFor="global-search" className="block text-sm font-medium text-gray-700 mb-1">
          Busqueda Global
        </label>
        <input
          id="global-search"
          type="text"
          placeholder="Buscar por Nombre, SO, Host, Cluster..."
          value={globalSearch}
          onChange={handleSearchChange}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
        />
      </div>

      <div data-tutorial-id="vm-filters">
        <VMFiltersPanel
          filter={filter}
          groupByOption={groupByOption}
          uniqueEnvironments={uniqueEnvironments}
          uniquePowerStates={uniquePowerStates}
          uniqueGuestOS={uniqueGuestOS}
          uniqueHosts={uniqueHosts}
          uniqueClusters={uniqueClusters}
          uniqueVlans={uniqueVlans}
          onFilterChange={handleFilterChange}
          onClearFilters={clearFilters}
          onGroupChange={handleGroupChange}
          hasFilters={hasFilters}
        />
      </div>

      <div className="text-sm text-[#E11B22] mb-4">
        Mostrando {processed.length} de {vms.length} VMs
        {globalSearch.trim() !== '' && (
          <span className="ml-2 text-[#E11B22]/70">(filtradas por "{globalSearch}")</span>
        )}
      </div>

      <div data-tutorial-id="vm-table-list">
        {emptyMessage && !loading && !error ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow">
            {emptyMessage}
          </div>
        ) : emptyStateType ? (
          <VMEmptyState type={emptyStateType} onResetFilters={clearFilters} />
        ) : hasGroups ? (
          <VMGroupsTable
            columns={columns}
            entries={deferredEntries}
            groupByOption={groupByOption}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            sortBy={sortBy}
            onHeaderClick={onHeaderClick}
            onRowClick={handleRowClick}
            loading={loading}
          />
        ) : (
          <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
            <thead className="bg-[#FAF3E9] text-left text-sm text-[#E11B22]">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Host</th>
                <th className="px-4 py-2">Cluster</th>
                <th className="px-4 py-2">SO</th>
                <th className="px-4 py-2">vCPU</th>
                <th className="px-4 py-2">RAM (MiB)</th>
              </tr>
            </thead>
            <tbody className="text-sm text-[#231F20]">
              {fallbackRows && fallbackRows.map((vm) => (
                <tr
                  key={vm.id || vm.name}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleRowClick(vm)}
                >
                  <td className="px-4 py-2 font-medium text-gray-900">{vm.name || '—'}</td>
                  <td className="px-4 py-2">{vm.power_state || vm.State || '—'}</td>
                  <td className="px-4 py-2">{vm.host || vm.HVHost || '—'}</td>
                  <td className="px-4 py-2">{vm.cluster || vm.Cluster || '—'}</td>
                  <td className="px-4 py-2">{vm.guest_os || vm.OS || '—'}</td>
                  <td className="px-4 py-2">{vm.cpu_count ?? vm.vCPU ?? '—'}</td>
                  <td className="px-4 py-2">{vm.memory_size_MiB ?? vm.RAM_MiB ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedVm && (
        <VMDetailModal
          vmId={selectedVm}
          record={selectedRecord}
          onClose={handleCloseModal}
          onAction={powerActionsEnabled ? handleDetailAction : undefined}
          getVmDetail={vmDetailFetcher}
          getVmPerf={vmPerfFetcher}
          powerActionsEnabled={powerActionsEnabled}
          powerUnavailableMessage={powerUnavailableMessage}
        />
      )}
    </div>
  )
}
