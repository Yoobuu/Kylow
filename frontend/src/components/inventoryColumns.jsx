import React from 'react'
import { IoPowerOutline, IoPowerSharp } from 'react-icons/io5'
import {
  FaCodeBranch,
  FaFlask,
  FaIndustry,
  FaLinux,
  FaQuestionCircle,
  FaServer,
  FaWindows,
} from 'react-icons/fa'
import { GiSandCastle } from 'react-icons/gi'

const formatNumber = (value) => {
  if (value == null || value === '') return '\u2014'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return parsed.toLocaleString()
}

const formatPercent = (value) => {
  if (value == null || value === '') return '\u2014'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return `${parsed}%`
}

const formatGiB = (value) => {
  if (value == null || value === '') return '\u2014'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  const gib = parsed / 1024
  if (!Number.isFinite(gib)) return '\u2014'
  return gib.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const joinList = (list) =>
  Array.isArray(list) && list.length ? list.join(', ') : '\u2014'

const renderDisksWithBars = (disks) => {
  if (!Array.isArray(disks) || disks.length === 0) {
    return <span className="text-sm text-gray-700">{'\u2014'}</span>
  }

  return (
    <div className="flex flex-col gap-2">
      {disks.map((disk, index) => {
        const text = typeof disk === 'string' ? disk : disk?.text
        const pctRaw =
          typeof disk === 'object'
            ? disk?.pct
            : (() => {
                if (typeof text !== 'string') return undefined
                const match = /([\d.,]+)%/.exec(text)
                if (!match) return undefined
                return Number(match[1].replace(',', '.'))
              })()
        const pctNumber = Number(pctRaw)
        const hasPct = Number.isFinite(pctNumber)
        const width = hasPct ? Math.min(Math.max(pctNumber, 0), 100) : 0
        const barColor =
          hasPct && pctNumber < 50
            ? 'bg-green-500'
            : hasPct && pctNumber < 80
              ? 'bg-yellow-500'
              : hasPct
                ? 'bg-red-500'
                : 'bg-green-500'

        return (
          <div key={index} className="flex flex-col gap-1">
            <span className="text-sm text-gray-700">{text || '\u2014'}</span>
            {hasPct && (
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${barColor} rounded-full transition-all duration-300`}
                  style={{ width: `${width}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const renderEnvironmentBadge = (environmentRaw) => {
  const value = environmentRaw ?? '\u2014'
  const text = typeof value === 'string' && value.trim() ? value : '\u2014'
  const normalized =
    typeof value === 'string'
      ? value
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
      : ''

  if (normalized.startsWith('prod')) {
    return (
      <div className="flex items-center gap-1">
        <FaIndustry className="text-indigo-600 text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full">
          {text}
        </span>
      </div>
    )
  }
  if (normalized.startsWith('sand')) {
    return (
      <div className="flex items-center gap-1">
        <GiSandCastle className="text-orange-600 text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
          {text}
        </span>
      </div>
    )
  }
  if (normalized.startsWith('test')) {
    return (
      <div className="flex items-center gap-1">
        <FaFlask className="text-yellow-600 text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
          {text}
        </span>
      </div>
    )
  }
  if (normalized.startsWith('des')) {
    return (
      <div className="flex items-center gap-1">
        <FaCodeBranch className="text-green-600 text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
          {text}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <FaQuestionCircle className="text-purple-600 text-lg" />
      <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
        {text}
      </span>
    </div>
  )
}

const renderGuestOsBadge = (guestOs) => {
  if (guestOs?.toLowerCase().includes('win')) {
    return (
      <div className="flex items-center gap-1">
        <FaWindows className="text-blue-600 text-lg" />
        <span className="text-gray-700">{guestOs}</span>
      </div>
    )
  }
  if (guestOs?.toLowerCase().includes('linux')) {
    return (
      <div className="flex items-center gap-1">
        <FaLinux className="text-gray-800 text-lg" />
        <span className="text-gray-700">{guestOs}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <FaQuestionCircle className="text-gray-600 text-lg" />
      <span className="text-gray-700">{guestOs || '\u2014'}</span>
    </div>
  )
}

const BASE_COLUMNS = [
  {
    key: 'id',
    label: 'ID',
    render: (vm) => (
      <span className="whitespace-nowrap text-sm font-medium text-gray-900">{vm.id}</span>
    ),
  },
  {
    key: 'name',
    label: 'Nombre',
    render: (vm) => (
      <span className="whitespace-nowrap text-sm text-gray-800 font-medium">{vm.name}</span>
    ),
  },
  {
    key: 'power_state',
    label: 'Estado',
    render: (vm) => (
      vm.power_state === 'POWERED_ON' ? (
        <div className="flex items-center gap-1">
          <IoPowerSharp className="text-green-600 text-lg" />
          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
            Encendida
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <IoPowerOutline className="text-red-600 text-lg" />
          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded-full">
            {vm.power_state === 'POWERED_OFF' ? 'Apagada' : vm.power_state || '\u2014'}
          </span>
        </div>
      )
    ),
  },
  {
    key: 'cpu_count',
    label: 'CPU',
    render: (vm) => <span className="text-sm text-gray-700">{vm.cpu_count ?? '\u2014'}</span>,
  },
  {
    key: 'cpu_usage_pct',
    label: 'CPU (%)',
    render: (vm) => renderPercentWithBar(vm.cpu_usage_pct),
  },
  {
    key: 'memory_size_MiB',
    label: 'RAM (GiB)',
    render: (vm) => <span className="text-sm text-gray-700">{formatGiB(vm.memory_size_MiB)}</span>,
  },
  {
    key: 'ram_demand_mib',
    label: 'RAM demanda (GiB)',
    render: (vm) => <span className="text-sm text-gray-700">{formatGiB(vm.ram_demand_mib)}</span>,
  },
  {
    key: 'ram_usage_pct',
    label: 'RAM (%)',
    render: (vm) => renderPercentWithBar(vm.ram_usage_pct),
  },
  {
    key: 'environment',
    label: 'Ambiente',
    render: (vm) => renderEnvironmentBadge(vm.environment),
  },
  {
    key: 'guest_os',
    label: 'SO',
    render: (vm) => renderGuestOsBadge(vm.guest_os),
  },
  {
    key: 'host',
    label: 'Host',
    render: (vm) => <span className="text-sm text-gray-700">{vm.host || '\u2014'}</span>,
  },
  {
    key: 'cluster',
    label: 'Cluster',
    render: (vm) => <span className="text-sm text-gray-700">{vm.cluster || '\u2014'}</span>,
  },
  {
    key: 'vlans',
    label: 'VLAN(s)',
    render: (vm) => <span className="text-sm text-gray-700">{joinList(vm.vlans)}</span>,
  },
  {
    key: 'networks',
    label: 'Redes',
    render: (vm) => <span className="text-sm text-gray-700">{joinList(vm.networks)}</span>,
  },
  {
    key: 'compatibility_code',
    label: 'Compatibilidad CA3digo',
    render: (vm) => <span className="text-sm text-gray-700">{vm.compatibility_code || '\u2014'}</span>,
  },
  {
    key: 'compatibility_human',
    label: 'Compatibilidad',
    render: (vm) => <span className="text-sm text-gray-700">{vm.compatibility_human || '\u2014'}</span>,
  },
  {
    key: 'compat_generation',
    label: 'Compatibilidad GeneraciA3n',
    render: (vm) => <span className="text-sm text-gray-700">{vm.compat_generation ?? '\u2014'}</span>,
  },
  {
    key: 'ip_addresses',
    label: 'IPs',
    render: (vm) => <span className="text-sm text-gray-700">{joinList(vm.ip_addresses)}</span>,
  },
  {
    key: 'disks',
    label: 'Discos',
    render: (vm) => renderDisksWithBars(vm.disks),
  },
  {
    key: 'nics',
    label: 'NICs',
    render: (vm) => <span className="text-sm text-gray-700">{joinList(vm.nics)}</span>,
  },
]

const COMMON_HYPERV_KEYS = new Set([
  'id',
  'name',
  'power_state',
  'cpu_count',
  'cpu_usage_pct',
  'memory_size_MiB',
  'ram_demand_mib',
  'ram_usage_pct',
  'environment',
  'guest_os',
  'host',
  'cluster',
  'vlans',
  'ip_addresses',
  'disks',
  'compatibility_code',
  'compatibility_human',
  'compat_generation',
])

export const columnsVMware = BASE_COLUMNS

export const columnsHyperV = BASE_COLUMNS.filter((column) =>
  COMMON_HYPERV_KEYS.has(column.key)
)

export const INVENTORY_COLUMNS = columnsVMware
const renderPercentWithBar = (value) => {
  if (value == null || value === '') {
    return <span className="text-sm text-gray-700">{'\u2014'}</span>
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return <span className="text-sm text-gray-700">{value}</span>
  }
  const clamped = Math.max(0, parsed)
  const width = Math.min(clamped, 100)
  const barColor =
    clamped < 50 ? 'bg-green-500' : clamped < 80 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-gray-700">{formatPercent(parsed)}</span>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}
