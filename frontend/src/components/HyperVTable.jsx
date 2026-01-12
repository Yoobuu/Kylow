import React, { useCallback, useMemo, useDeferredValue, useState, useEffect } from 'react'

import { useInventoryState } from './VMTable/useInventoryState'
import VMSummaryCards from './VMTable/VMSummaryCards'
import VMFiltersPanel from './VMTable/VMFiltersPanel'
import VMGroupsTable from './VMTable/VMGroupsTable'
import VMEmptyState from './VMTable/VMEmptyState'
import HyperVDetailModal from './HyperVDetailModal'
import { columnsHyperV } from './inventoryColumns.jsx'
import { exportInventoryCsv } from '../lib/exportCsv'
import InventoryMetaBar from './common/InventoryMetaBar'

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MISMA LOGICA DE AMBIENTE QUE EN EL MODAL
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function classifyFromString(str) {
  if (!str) return null
  const cleaned = String(str).trim().toUpperCase()
  if (!cleaned) return null

  // cortamos por "-", "_" o espacio
  const tokens = cleaned.split(/[-_\s]+/).filter(Boolean)

  // miramos la primera letra de cada token
  for (const tk of tokens) {
    const first = tk.charAt(0)
    if (first === 'S') return 'Sandbox'
    if (first === 'T') return 'Test'
    if (first === 'P') return 'Producción'
    if (first === 'D') return 'Desarrollo'
  }

  return null
}

function inferEnvironmentFromRecord(vm) {
  if (!vm) return 'desconocido'

  // 1. Nombre de la VM
  let env = classifyFromString(vm.Name || vm.name)
  if (env) return env

  // 2. Cluster
  env = classifyFromString(vm.Cluster || vm.cluster)
  if (env) return env

  // 3. Host Hyper-V
  env = classifyFromString(vm.HVHost || vm.host)
  if (env) return env

  return 'desconocido'
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// COMPONENTE PRINCIPAL
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function HyperVTable({
  title = 'Inventario Hyper-V',
  fetcher,
  normalizeRecord,
  summaryBuilder,
  columns = columnsHyperV,
  onRefresh,
  searchInputId = 'hyperv-global-search',
  searchPlaceholder = 'Buscar por Nombre, SO, Host, Cluster...',
  onExport,
  exportFilenameBase = 'inventory',
  onErrorChange,
  refreshBusy = false,
  refreshCooldownUntil = null,
  snapshotGeneratedAt = null,
  snapshotSource = null,
  snapshotStale = false,
  snapshotStaleReason = null,
  refreshNotice = null,
}) {
  const { state, actions } = useInventoryState({
    fetcher,
    normalizeRecord,
    summaryBuilder,
    provider: 'hyperv',
    cacheTtlMs: 5 * 60 * 1000,
    autoRefreshMs: 5 * 60 * 1000,
    keepPreviousOnEmpty: true,
  })

  const {
    vms,                // lista completa de objetos VM Hyper-V
    loading,
    error,
    filter,
    groupByOption,
    globalSearch,
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
    clearFilters,
    toggleGroup,
    fetchVm,
    onHeaderClick,
  } = actions

  // ------------------------------
  // clave Ãºnica VM para poder referenciarla luego en el modal
  // usamos Name::HVHost
  // ------------------------------
  const makeVmKey = useCallback((vmObj) => {
    if (!vmObj || typeof vmObj !== 'object') return null
    const name = vmObj.Name || vmObj.name || ''
    const host = vmObj.HVHost || vmObj.host || ''
    if (!name) return null
    return `${name}::${host}`
  }, [])

  const [selectedVm, setSelectedVm] = useState(null)
  const [selectorKey, setSelectorKey] = useState('')

  // ------------------------------
  // CLICK EN FILA
  // ------------------------------
  const handleRowClick = useCallback(
    (row) => {
      if (!row || typeof row !== 'object') {
        console.warn('[ROW CLICK] payload invÃ¡lido', row)
        setSelectedVm(null)
        setSelectorKey('')
        return
      }

      const key = `${row.Name || row.name || ''}::${row.HVHost || row.host || ''}`
      setSelectedVm(row)
      setSelectorKey(key)
    },
    [setSelectedVm, setSelectorKey]
  )

  // ------------------------------
  // groups / processed para render
  // ------------------------------
  const entries = useMemo(() => Object.entries(groups), [groups])
  const deferredEntries = useDeferredValue(entries)
  const hasGroups = entries.length > 0
  const fallbackRows = !hasGroups && vms.length > 0 ? vms : null

  const formatGiB = (value) => {
    if (value == null || value === '') return '—'
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return '—'
    const gib = parsed / 1024
    if (!Number.isFinite(gib)) return '—'
    return gib.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  function inferClusterFromHost(obj) {
    const hvhost =
      obj.HVHost ||
      obj.host ||
      obj.HVHOST ||
      obj.hypervHost ||
      ''

    if (typeof hvhost === 'string' && hvhost.length > 0) {
      const first = hvhost[0].toUpperCase()
      if (first === 'S') return 'Sandbox'
      if (first === 'T') return 'Test'
      if (first === 'P') return 'Producción'
    }

    return null
  }

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
    if (onExport) {
      onExport(processed)
      return
    }
    exportInventoryCsv(processed, exportFilenameBase)
  }, [exportFilenameBase, onExport, processed])

  const handleRefresh = useCallback(() => {
    const refresh = () => fetchVm()
    if (onRefresh) {
      onRefresh(refresh)
    } else {
      refresh()
    }
  }, [fetchVm, onRefresh])

  const cooldownTs = refreshCooldownUntil ? Date.parse(String(refreshCooldownUntil)) : null
  const cooldownActive = Number.isFinite(cooldownTs) && cooldownTs > Date.now()
  const refreshDisabled = cooldownActive || refreshBusy || loading || refreshing
  const refreshLabel = cooldownActive
    ? 'Cooldown activo'
    : refreshBusy || loading || refreshing
      ? 'Consultando...'
      : 'Actualizar inventario'

  const handleCloseModal = useCallback(() => {
    setSelectedVm(null)
    setSelectorKey('')
  }, [setSelectorKey])

  useEffect(() => {
    if (onErrorChange) {
      onErrorChange(error || '')
    }
  }, [error, onErrorChange])

  let emptyStateType = null
  const hasRows = processed.length > 0
  if (!loading && !error && !hasRows) {
    emptyStateType = hasFilters ? 'filtered' : 'empty'
  } else if (error && !hasRows) {
    emptyStateType = 'error'
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 mb-2">{title}</h2>
          <div className="h-1 w-32 bg-[#5da345] rounded-full"></div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshDisabled}
              aria-busy={refreshDisabled}
              title={cooldownActive ? 'Cooldown activo' : 'Actualizar inventario'}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-medium shadow-sm transition ${
                refreshDisabled
                  ? 'cursor-not-allowed border-gray-300 bg-gray-100 text-gray-500'
                  : 'border-blue-300 bg-white text-blue-700 hover:bg-blue-50'
              }`}
            >
              {refreshBusy || loading || refreshing ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></span>
              ) : cooldownActive ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                </span>
              ) : null}
              {refreshLabel}
            </button>
            <button
              onClick={handleExport}
              disabled={!processed.length}
              className="bg-[#5da345] text-white font-medium py-2 px-4 rounded-lg shadow hover:bg-[#4c8c38] transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Exportar CSV
            </button>
          </div>
          {refreshing && (
            <div className="text-xs text-blue-600 animate-pulse text-right">
              Actualizando&hellip;
            </div>
          )}
          {refreshNotice && (
            <div className="text-[11px] text-amber-700 text-right">
              {refreshNotice}
            </div>
          )}
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
        <label htmlFor={searchInputId} className="block text-sm font-medium text-gray-700 mb-1">
          Busqueda Global
        </label>
        <input
          id={searchInputId}
          type="text"
          placeholder={searchPlaceholder}
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

      {emptyStateType ? (
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
          // OJO: le pasamos tal cual al handler
          onRowClick={handleRowClick}
          loading={loading}
        />
      ) : (
        <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
          <thead className="bg-gray-100 text-left text-sm text-gray-600">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Ambiente</th>{/* <-- nueva col */}
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Host</th>
              <th className="px-4 py-2">Cluster</th>
              <th className="px-4 py-2">SO</th>
              <th className="px-4 py-2">vCPU</th>
              <th className="px-4 py-2">RAM (GiB)</th>
            </tr>
          </thead>
          <tbody className="text-sm text-gray-800">
            {fallbackRows && fallbackRows.map((vm) => {
              const ambiente = inferEnvironmentFromRecord(vm)
              const clusterExplicit =
                vm.Cluster ||
                vm.cluster ||
                vm.ClusterName ||
                null

              const clusterDerived = inferClusterFromHost(vm)
              const clusterDisplay = clusterExplicit || clusterDerived || '—'
              return (
                <tr
                  key={makeVmKey(vm) || vm.Name || vm.name}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleRowClick(vm)}
                >
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {vm.Name || vm.name || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {ambiente}
                  </td>
                  <td className="px-4 py-2">
                    {vm.State || vm.power_state || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {vm.HVHost || vm.host || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {clusterDisplay}
                  </td>
                  <td className="px-4 py-2">
                    {vm.OS || vm.guest_os || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {vm.vCPU ?? vm.cpu_count ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    {formatGiB(vm.RAM_MiB ?? vm.memory_size_MiB ?? vm.MemoryMB)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {selectedVm && (
        <HyperVDetailModal
          record={selectedVm}
          selectorKey={selectorKey} 
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}







