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

export default function VMTable() {
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
  const snapshotFetcher = useCallback(async () => {
    const snapshot = await getVmwareSnapshot()
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
    const payload = snapshot?.data || {}
    return Array.isArray(payload?.vmware) ? payload.vmware : []
  }, [])
  const { state, actions } = useInventoryState({
    provider: 'vmware',
    autoRefreshMs: AUTO_REFRESH_MS,
    fetcher: snapshotFetcher,
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
    const cachedEntry = inventoryCache.get('vmware')
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
    exportInventoryCsv(processed, 'vmware_inventory')
  }, [processed])

  const handleRefresh = useCallback(async () => {
    if (!isSuperadmin) {
      setRefreshNotice({ kind: 'error', text: 'Sin permisos para refrescar VMs VMware.' })
      return
    }
    setRefreshNotice(null)
    setRefreshRequested(true)
    try {
      const resp = await postVmwareRefresh({ force: true })
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
        setRefreshNotice({ kind: 'error', text: 'Sin permisos para refrescar VMs VMware.' })
        return
      }
      setRefreshNotice({ kind: 'error', text: 'Error iniciando refresh de VMs VMware.' })
    } finally {
      setRefreshRequested(false)
    }
  }, [isSuperadmin])

  useEffect(() => {
    if (!refreshJobId || !refreshPolling) return undefined
    const tick = async () => {
      try {
        const job = await getVmwareJob(refreshJobId)
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
            setRefreshNotice({ kind: 'error', text: 'No se pudo completar el refresh de VMs VMware.' })
          }
          await fetchVm({ refresh: false, showLoading: false })
        }
      } catch (err) {
        setRefreshPolling(false)
        setRefreshJobId(null)
        setRefreshNotice({ kind: 'error', text: 'Error durante el refresh de VMs VMware.' })
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    pollRef.current = id
    return () => clearInterval(id)
  }, [refreshJobId, refreshPolling, fetchVm])

  const handleRowClick = useCallback(
    (row) => {
      if (!row) return
      const normalized = row.provider ? row : { ...normalizeVMware(row), __raw: row }
      if (!normalized.id) return
      setSelectedVm(normalized.id)
      setSelectedRecord(normalized)
    },
    [setSelectedRecord, setSelectedVm]
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

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 mb-2">Inventario de VMs</h2>
          <div className="h-1 w-32 bg-[#5da345] rounded-full"></div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshBusy}
              aria-busy={refreshBusy}
              className="bg-white border border-blue-300 text-blue-700 font-medium py-2 px-4 rounded-lg shadow-sm hover:bg-blue-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Actualizar inventario
            </button>
            <button
              onClick={handleExport}
              disabled={!processed.length}
              className="bg-[#5da345] text-white font-medium py-2 px-4 rounded-lg shadow hover:bg-[#4c8c38] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Exportar CSV
            </button>
          </div>
          {refreshBusy && (
            <div className="text-xs text-blue-600 animate-pulse text-right">
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

      <VMSummaryCards summary={resumen} />

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

      <div className="text-sm text-gray-600 mb-4">
        Mostrando {processed.length} de {vms.length} VMs
        {globalSearch.trim() !== '' && (
          <span className="ml-2 text-gray-500">(filtradas por "{globalSearch}")</span>
        )}
      </div>

      {emptyMessage && !loading && !error ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow">
          {emptyMessage}
        </div>
      ) : emptyStateType ? (
        <VMEmptyState type={emptyStateType} onResetFilters={clearFilters} />
      ) : hasGroups ? (
        <VMGroupsTable
          columns={columnsVMware}
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
          <thead className="bg-gray-100 text-left text-sm text-gray-600">
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
          <tbody className="text-sm text-gray-800">
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

      {selectedVm && (
        <VMDetailModal
          vmId={selectedVm}
          record={selectedRecord}
          onClose={handleCloseModal}
          onAction={handleDetailAction}
        />
      )}
    </div>
  )
}
