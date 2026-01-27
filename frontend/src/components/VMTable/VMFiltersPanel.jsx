import React, { useEffect, useMemo, useRef, useState } from 'react'

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
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-left text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FAF3E9]"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{selectedLabel}</span>
          <span className="float-right text-gray-500">▾</span>
        </button>
        {open && (
          <ul
            className="absolute z-20 mt-2 max-h-60 w-full overflow-auto rounded-lg border border-[#E1D6C8] bg-white shadow-lg"
            role="listbox"
            aria-labelledby={id}
          >
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm transition ${
                    value === opt.value ? 'bg-[#FAF3E9] text-gray-900' : 'hover:bg-[#FAF3E9]'
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

  const activeFilters = Object.entries(filter).filter(
    ([key, value]) => key !== 'name' && value
  )

  const handleSelect = (field) => (value) => onFilterChange(field, value)

  return (
    <div className="bg-[#FAF3E9] rounded-xl shadow-md p-6 mb-8">
      <h3 className="text-[1.6rem] font-semibold text-[#E11B22] mb-4">Filtros y Agrupamiento</h3>

      <div className="grid gap-4 mb-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <div className="min-w-[240px]">
          <label htmlFor="filter-environment" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Ambiente
          </label>
          <BeigeSelect
            id="filter-environment"
            value={filter.environment}
            onChange={handleSelect('environment')}
            options={[
              { value: '', label: 'Todos' },
              ...uniqueEnvironments.map((env) => ({ value: env, label: env })),
            ]}
          />
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-power_state" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Estado
          </label>
          <BeigeSelect
            id="filter-power_state"
            value={filter.power_state}
            onChange={handleSelect('power_state')}
            options={[
              { value: '', label: 'Todos' },
              ...uniquePowerStates.map((state) => ({
                value: state,
                label:
                  state === 'POWERED_ON'
                    ? 'Encendida'
                    : state === 'POWERED_OFF'
                      ? 'Apagada'
                      : state,
              })),
            ]}
          />
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-guest_os" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por SO
          </label>
          <BeigeSelect
            id="filter-guest_os"
            value={filter.guest_os}
            onChange={handleSelect('guest_os')}
            options={[
              { value: '', label: 'Todos' },
              ...uniqueGuestOS.map((os) => ({ value: os, label: os })),
            ]}
          />
        </div>
        <div className="min-w-[240px]">
          <label htmlFor="filter-host" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Host
          </label>
          <BeigeSelect
            id="filter-host"
            value={filter.host}
            onChange={handleSelect('host')}
            options={[
              { value: '', label: 'Todos' },
              ...uniqueHosts.map((host) => ({ value: host, label: host })),
            ]}
          />
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-vlan" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por VLAN
          </label>
          <BeigeSelect
            id="filter-vlan"
            value={filter.vlan}
            onChange={handleSelect('vlan')}
            options={[
              { value: '', label: 'Todas' },
              ...uniqueVlans.map((vlan) => ({ value: vlan, label: vlan })),
            ]}
          />
        </div>

        <div className="min-w-[240px]">
          <label htmlFor="filter-cluster" className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por Cluster
          </label>
          <BeigeSelect
            id="filter-cluster"
            value={filter.cluster}
            onChange={handleSelect('cluster')}
            options={[
              { value: '', label: 'Todos' },
              ...uniqueClusters.map((cluster) => ({ value: cluster, label: cluster })),
            ]}
          />
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
          <BeigeSelect
            id="group-by"
            value={groupByOption}
            onChange={onGroupChange}
            options={[
              { value: 'none', label: 'Sin agrupar' },
              { value: 'estado', label: 'Agrupar por Estado' },
              { value: 'ambiente', label: 'Agrupar por Ambiente' },
              { value: 'host', label: 'Agrupar por Host' },
              { value: 'vlan', label: 'Agrupar por VLAN' },
              { value: 'cluster', label: 'Agrupar por Cluster' },
              { value: 'SO', label: 'Agrupar por SO' },
            ]}
          />
        </div>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2 mt-6">
          {activeFilters.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center bg-[#FAF3E9] text-gray-800 text-sm px-3 py-1 rounded-full border border-[#E1D6C8]"
            >
              <span>{FILTER_LABELS[key] || key}: {value}</span>
              <button
                onClick={() => onFilterChange(key, '')}
                className="ml-2 text-gray-600 hover:text-gray-900"
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
