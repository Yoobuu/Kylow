import React from 'react'

const FILTER_LABELS = {
  environment: 'Ambiente',
  power_state: 'Estado',
  guest_os: 'SO',
  host: 'Host',
  cluster: 'Cluster',
  vlan: 'VLAN',
}

export default function VMFiltersPanel({
  filter,
  groupByOption,
  uniqueEnvironments,
  uniquePowerStates,
  uniqueGuestOS,
  uniqueHosts,
  uniqueClusters,
  uniqueVlans = [],
  onFilterChange,
  onClearFilters,
  onGroupChange,
  hasFilters,
}) {
  const activeFilters = Object.entries(filter).filter(
    ([key, value]) => key !== 'name' && value
  )

  const handleSelect = (field) => (event) =>
    onFilterChange(field, event.target.value)

  return (
    <div className="bg-white rounded-xl shadow-md p-6 mb-8">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">Filtros y Agrupamiento</h3>

      <div className="grid gap-4 mb-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <div className="min-w-[240px]">
          <label htmlFor="filter-environment" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Ambiente
          </label>
          <select
            id="filter-environment"
            value={filter.environment}
            onChange={handleSelect('environment')}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
          >
            <option value="">Todos</option>
            {uniqueEnvironments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-power_state" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Estado
          </label>
          <select
            id="filter-power_state"
            value={filter.power_state}
            onChange={handleSelect('power_state')}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
          >
            <option value="">Todos</option>
            {uniquePowerStates.map((state) => (
              <option key={state} value={state}>
                {state === 'POWERED_ON'
                  ? 'Encendida'
                  : state === 'POWERED_OFF'
                    ? 'Apagada'
                    : state}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-guest_os" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por SO
          </label>
          <select
            id="filter-guest_os"
            value={filter.guest_os}
            onChange={handleSelect('guest_os')}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
          >
            <option value="">Todos</option>
            {uniqueGuestOS.map((os) => (
              <option key={os} value={os}>
                {os}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[240px]">
          <label htmlFor="filter-host" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Host
          </label>
          <select
            id="filter-host"
            value={filter.host}
            onChange={handleSelect('host')}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
          >
            <option value="">Todos</option>
            {uniqueHosts.map((host) => (
              <option key={host} value={host}>
                {host}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-vlan" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por VLAN
          </label>
          <select
            id="filter-vlan"
            value={filter.vlan}
            onChange={handleSelect('vlan')}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
          >
            <option value="">Todas</option>
            {uniqueVlans.map((vlan) => (
              <option key={vlan} value={vlan}>
                {vlan}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-cluster" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Cluster
          </label>
          <select
            id="filter-cluster"
            value={filter.cluster}
            onChange={handleSelect('cluster')}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
          >
            <option value="">Todos</option>
            {uniqueClusters.map((cluster) => (
              <option key={cluster} value={cluster}>
                {cluster}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={onClearFilters}
          className="w-full md:w-auto bg-red-100 text-red-700 font-medium py-2 px-4 rounded-lg hover:bg-red-200 transition"
        >
          Limpiar filtros
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Agrupar por</label>
          <select
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5da345] focus:outline-none"
            value={groupByOption}
            onChange={(event) => onGroupChange(event.target.value)}
          >
            <option value="none">Sin agrupar</option>
            <option value="estado">Agrupar por Estado</option>
            <option value="ambiente">Agrupar por Ambiente</option>
            <option value="host">Agrupar por Host</option>
            <option value="vlan">Agrupar por VLAN</option>
            <option value="cluster">Agrupar por Cluster</option>
            <option value="SO">Agrupar por SO</option>
          </select>
        </div>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2 mt-6">
          {activeFilters.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center bg-blue-100 text-blue-800 text-sm px-3 py-1 rounded-full"
            >
              <span>{FILTER_LABELS[key] || key}: {value}</span>
              <button
                onClick={() => onFilterChange(key, '')}
                className="ml-2 text-blue-600 hover:text-blue-800"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
