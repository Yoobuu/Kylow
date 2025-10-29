import React, { useCallback, useMemo, useDeferredValue } from 'react'
import { useInventoryState } from './VMTable/useInventoryState'
import VMSummaryCards from './VMTable/VMSummaryCards'
import VMFiltersPanel from './VMTable/VMFiltersPanel'
import VMGroupsTable from './VMTable/VMGroupsTable'
import VMEmptyState from './VMTable/VMEmptyState'
import VMDetailModal from './VMDetailModal'
import { columnsVMware } from './inventoryColumns.jsx'
import { exportInventoryCsv } from '../lib/exportCsv'

export default function VMTable() {
  const { state, actions } = useInventoryState({ provider: 'vmware' })
  const {
    vms,
    loading,
    error,
    filter,
    groupByOption,
    globalSearch,
    selectedVm,
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
  } = state
  const {
    setFilter,
    setGroupByOption,
    setGlobalSearch,
    setSelectedVm,
    clearFilters,
    toggleGroup,
    fetchVm,
    onHeaderClick,
    handlePowerChange,
  } = actions

  console.log(
    '[VMTable render]',
    'provider=VMWARE',
    'vms.length=',
    vms?.length,
    'groups keys=',
    Object.keys(groups || {})
  )

  const entries = useMemo(() => Object.entries(groups), [groups])
  const deferredEntries = useDeferredValue(entries)
  const hasGroups = entries.length > 0
  const fallbackRows = !hasGroups && vms.length > 0 ? vms : null

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

  const handleRefresh = useCallback(() => {
    fetchVm(true)
  }, [fetchVm])

  const handleRowClick = useCallback(
    (row) => {
      if (!row || !row.id) return
      setSelectedVm(row.id)
    },
    [setSelectedVm]
  )

  const handleCloseModal = useCallback(
    () => setSelectedVm(null),
    [setSelectedVm]
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
    },
    [handlePowerChange, selectedVm, setSelectedVm]
  )

  let emptyStateType = null
  if (!loading && !error && processed.length === 0) {
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
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading}
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

      {emptyStateType ? (
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
          onClose={handleCloseModal}
          onAction={handleDetailAction}
        />
      )}
    </div>
  )
}
