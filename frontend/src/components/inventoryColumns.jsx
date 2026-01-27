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

const formatDateTime = (value) => {
  if (!value) return '\u2014'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

const joinList = (list) =>
  Array.isArray(list) && list.length ? list.join(', ') : '\u2014'

const normalizeBootLabel = (value) => {
  const upper = String(value).trim().toUpperCase()
  if (!upper) return '\u2014'
  if (upper.includes('EFI')) return 'UEFI'
  if (upper.includes('BIOS')) return 'BIOS'
  return value
}

const renderGeneration = (vm) => {
  const raw = vm.compat_generation ?? vm.boot_type
  if (raw == null || raw === '') {
    return <span className="text-sm text-[#231F20]">{'\u2014'}</span>
  }

  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    return <span className="text-sm text-[#231F20]">{`Gen ${numeric}`}</span>
  }

  const textValue = String(raw).trim()
  if (!textValue) {
    return <span className="text-sm text-[#231F20]">{'\u2014'}</span>
  }

  const normalized = normalizeBootLabel(textValue)
  const upper = normalized.toUpperCase()
  if (upper === 'UEFI') {
    return <span className="text-sm text-[#231F20]">Gen 2</span>
  }
  if (upper === 'BIOS') {
    return <span className="text-sm text-[#231F20]">Gen 1</span>
  }
    return <span className="text-sm text-[#231F20]">{normalized}</span>
}

const renderDisksWithBars = (disks) => {
  if (!Array.isArray(disks) || disks.length === 0) {
    return <span className="text-sm text-[#231F20]">{'\u2014'}</span>
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
            ? 'bg-[#1B5E20]'
            : hasPct && pctNumber < 80
              ? 'bg-[#7A5E00]'
              : hasPct
                ? 'bg-[#E11B22]'
                : 'bg-[#1B5E20]'

        return (
          <div key={index} className="flex flex-col gap-1">
            <span className="text-sm text-[#231F20]">{text || '\u2014'}</span>
            {hasPct && (
              <div className="h-1.5 bg-[#E1E1E1] rounded-full overflow-hidden">
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

const shortenAzureId = (value) => {
  if (!value) return '\u2014'
  const raw = String(value)
  const vmMatch = /\/virtualMachines\/([^/]+)$/i.exec(raw)
  if (vmMatch) return vmMatch[1]
  const parts = raw.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : raw
}

const renderTruncatedText = (value, maxWidth = 'max-w-[200px]') => {
  const text = value == null || value === '' ? '\u2014' : String(value)
  return (
    <span className={`block ${maxWidth} truncate text-sm text-[#231F20]`} title={text}>
      {text}
    </span>
  )
}

const renderCompactList = (list, maxItems = 2, maxWidth = 'max-w-[240px]') => {
  const items = Array.isArray(list) ? list.filter((v) => v != null && String(v).trim()) : []
  if (!items.length) return <span className="text-sm text-[#231F20]">{'\u2014'}</span>
  const normalized = items.map((v) => {
    if (typeof v === 'object') {
      if (typeof v.text === 'string' && v.text.trim()) return v.text
      if (typeof v.name === 'string' && v.name.trim()) return v.name
    }
    return String(v)
  })
  const display = normalized.slice(0, maxItems)
  const rest = normalized.length - display.length
  const text = rest > 0 ? `${display.join(', ')} (+${rest})` : display.join(', ')
  return (
    <span className={`block ${maxWidth} truncate text-sm text-[#231F20]`} title={normalized.join(', ')}>
      {text}
    </span>
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
        <FaIndustry className="text-[#8B0000] text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-[#FAF3E9] text-[#231F20] rounded-full border border-[#D6C7B8]">
          {text}
        </span>
      </div>
    )
  }
  if (normalized.startsWith('sand')) {
    return (
      <div className="flex items-center gap-1">
        <GiSandCastle className="text-[#B45309] text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-[#FAF3E9] text-[#231F20] rounded-full border border-[#D6C7B8]">
          {text}
        </span>
      </div>
    )
  }
  if (normalized.startsWith('test')) {
    return (
      <div className="flex items-center gap-1">
        <FaFlask className="text-[#7A5E00] text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-[#FAF3E9] text-[#231F20] rounded-full border border-[#D6C7B8]">
          {text}
        </span>
      </div>
    )
  }
  if (normalized.startsWith('des')) {
    return (
      <div className="flex items-center gap-1">
        <FaCodeBranch className="text-[#1B5E20] text-lg" />
        <span className="px-2 py-0.5 text-xs font-medium bg-[#FAF3E9] text-[#231F20] rounded-full border border-[#D6C7B8]">
          {text}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <FaQuestionCircle className="text-[#3b3b3b] text-lg" />
      <span className="px-2 py-0.5 text-xs font-medium bg-[#FAF3E9] text-[#231F20] rounded-full border border-[#D6C7B8]">
        {text}
      </span>
    </div>
  )
}

const renderGuestOsBadge = (guestOs) => {
  if (guestOs?.toLowerCase().includes('win')) {
    return (
      <div className="flex items-center gap-1">
        <FaWindows className="text-[#E11B22] text-lg" />
        <span className="text-[#231F20]">{guestOs}</span>
      </div>
    )
  }
  if (guestOs?.toLowerCase().includes('linux')) {
    return (
      <div className="flex items-center gap-1">
        <FaLinux className="text-[#231F20] text-lg" />
        <span className="text-[#231F20]">{guestOs}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <FaQuestionCircle className="text-[#E11B22] text-lg" />
      <span className="text-[#231F20]">{guestOs || '\u2014'}</span>
    </div>
  )
}

const BASE_COLUMNS = [
  {
    key: 'id',
    label: 'ID',
    render: (vm) => (
      <span className="whitespace-nowrap text-sm font-medium text-[#231F20]">{vm.id}</span>
    ),
  },
  {
    key: 'name',
    label: 'Nombre',
    render: (vm) => (
      <span className="whitespace-nowrap text-sm text-[#231F20] font-medium">{vm.name}</span>
    ),
  },
  {
    key: 'power_state',
    label: 'Estado',
    render: (vm) => (
      vm.power_state === 'POWERED_ON' ? (
        <div className="flex items-center gap-1">
          <IoPowerSharp className="text-[#1B5E20] text-lg" />
          <span className="px-2 py-0.5 text-xs font-medium bg-[#E6F4EA] text-[#1B5E20] rounded-full border border-[#B7E0C1]">
            Encendida
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <IoPowerOutline className="text-[#E11B22] text-lg" />
          <span className="px-2 py-0.5 text-xs font-medium bg-[#FDE2E2] text-[#8B0000] rounded-full border border-[#F5B5B5]">
            {vm.power_state === 'POWERED_OFF' ? 'Apagada' : vm.power_state || '\u2014'}
          </span>
        </div>
      )
    ),
  },
  {
    key: 'cpu_count',
    label: 'CPU',
    render: (vm) => <span className="text-sm text-[#231F20]">{vm.cpu_count ?? '\u2014'}</span>,
  },
  {
    key: 'cpu_usage_pct',
    label: 'CPU (%)',
    render: (vm) => renderPercentWithBar(vm.cpu_usage_pct),
  },
  {
    key: 'memory_size_MiB',
    label: 'RAM (GiB)',
    render: (vm) => <span className="text-sm text-[#231F20]">{formatGiB(vm.memory_size_MiB)}</span>,
  },
  {
    key: 'ram_demand_mib',
    label: 'RAM demanda (GiB)',
    render: (vm) => <span className="text-sm text-[#231F20]">{formatGiB(vm.ram_demand_mib)}</span>,
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
    render: (vm) => <span className="text-sm text-[#231F20]">{vm.host || '\u2014'}</span>,
  },
  {
    key: 'cluster',
    label: 'Cluster',
    render: (vm) => <span className="text-sm text-[#231F20]">{vm.cluster || '\u2014'}</span>,
  },
  {
    key: 'vlans',
    label: 'VLAN(s)',
    render: (vm) => <span className="text-sm text-[#231F20]">{joinList(vm.vlans)}</span>,
  },
  {
    key: 'networks',
    label: 'Redes',
    render: (vm) => <span className="text-sm text-[#231F20]">{joinList(vm.networks)}</span>,
  },
  {
    key: 'compatibility_code',
    label: 'Compatibilidad Código',
    render: (vm) => <span className="text-sm text-[#231F20]">{vm.compatibility_code || '\u2014'}</span>,
  },
  {
    key: 'compatibility_human',
    label: 'Compatibilidad',
    render: (vm) => <span className="text-sm text-[#231F20]">{vm.compatibility_human || '\u2014'}</span>,
  },
  {
    key: 'compat_generation',
    label: 'Firmware / Gen',
    render: (vm) => renderGeneration(vm),
  },
  {
    key: 'ip_addresses',
    label: 'IPs',
    render: (vm) => <span className="text-sm text-[#231F20]">{joinList(vm.ip_addresses)}</span>,
  },
  {
    key: 'disks',
    label: 'Discos',
    render: (vm) => renderDisksWithBars(vm.disks),
  },
  {
    key: 'nics',
    label: 'NICs',
    render: (vm) => <span className="text-sm text-[#231F20]">{joinList(vm.nics)}</span>,
  },
]

export const columnsVMware = BASE_COLUMNS.filter((column) => column.key !== 'vlans')

export const columnsHyperV = BASE_COLUMNS.filter(
  (column) => column.key !== 'networks' && column.key !== 'nics' && column.key !== 'compatibility_human'
)

const _columnsByKey = Object.fromEntries(BASE_COLUMNS.map((column) => [column.key, column]))

export const columnsAzure = [
  {
    ..._columnsByKey.id,
    render: (vm) => renderTruncatedText(shortenAzureId(vm.id), 'max-w-[220px]'),
  },
  _columnsByKey.name,
  _columnsByKey.power_state,
  _columnsByKey.environment,
  _columnsByKey.cpu_count,
  _columnsByKey.memory_size_MiB,
  {
    ..._columnsByKey.host,
    label: 'Resource Group',
    render: (vm) => renderTruncatedText(vm.resource_group || vm.host || '\u2014', 'max-w-[180px]'),
  },
  {
    ..._columnsByKey.cluster,
    label: 'Location',
    render: (vm) => renderTruncatedText(vm.location || vm.cluster || '\u2014', 'max-w-[140px]'),
  },
  {
    key: 'vm_size',
    label: 'VM Size',
    render: (vm) => renderTruncatedText(vm.vm_size || vm.vmSize || '\u2014', 'max-w-[160px]'),
  },
  {
    ..._columnsByKey.guest_os,
    label: 'OS Type',
    render: (vm) => renderGuestOsBadge(vm.os_type || vm.guest_os),
  },
  {
    key: 'provisioning_state',
    label: 'Provisioning',
    render: (vm) => renderTruncatedText(vm.provisioning_state || '\u2014', 'max-w-[160px]'),
  },
  {
    key: 'time_created',
    label: 'Creada',
    render: (vm) => (
      <span className="text-sm text-[#231F20]">{formatDateTime(vm.time_created || vm.timeCreated)}</span>
    ),
  },
  {
    ..._columnsByKey.networks,
    render: (vm) => renderCompactList(vm.networks, 2, 'max-w-[220px]'),
  },
  {
    ..._columnsByKey.ip_addresses,
    render: (vm) => renderCompactList(vm.ip_addresses, 2, 'max-w-[220px]'),
  },
  {
    ..._columnsByKey.disks,
    render: (vm) => renderCompactList(vm.disks, 1, 'max-w-[260px]'),
  },
  {
    ..._columnsByKey.nics,
    render: (vm) => renderCompactList(vm.nics, 2, 'max-w-[200px]'),
  },
]

export const INVENTORY_COLUMNS = columnsVMware
const renderPercentWithBar = (value) => {
  if (value == null || value === '') {
    return <span className="text-sm text-[#231F20]">{'\u2014'}</span>
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return <span className="text-sm text-[#231F20]">{value}</span>
  }
  const clamped = Math.max(0, parsed)
  const width = Math.min(clamped, 100)
  const barColor = clamped < 50 ? 'bg-[#1B5E20]' : clamped < 80 ? 'bg-[#7A5E00]' : 'bg-[#E11B22]'

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-[#231F20]">{formatPercent(parsed)}</span>
      <div className="h-1.5 bg-[#E1E1E1] rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}
