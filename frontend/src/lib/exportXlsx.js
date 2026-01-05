import { utils, writeFile } from 'xlsx'

const toTimestamp = () =>
  new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, '')

const pickNumber = (value) => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === 'object') {
    if ('#text' in value) return pickNumber(value['#text'])
    if ('value' in value) return pickNumber(value.value)
  }
  return undefined
}

const formatStorageKiB = (value) => {
  // value is expected in KiB (no chained conversions)
  if (typeof value !== 'number') return ''
  const kib = value
  if (!Number.isFinite(kib) || kib < 0) return ''
  const gib = kib / 1024 / 1024
  if (gib >= 1024) {
    const tib = gib / 1024
    return `${tib.toFixed(2)} TiB`
  }
  return `${gib.toFixed(2)} GiB`
}

const formatMemoryMiB = (value) => {
  if (typeof value !== 'number') return ''
  const mib = value
  if (!Number.isFinite(mib) || mib < 0) return ''
  const gib = mib / 1024
  if (gib >= 1024) {
    const tib = gib / 1024
    return `${tib.toFixed(2)} TiB`
  }
  return `${gib.toFixed(2)} GiB`
}

const formatPercent = (value) => {
  const num = pickNumber(value)
  if (!Number.isFinite(num)) return ''
  return `${num.toFixed(1)}%`
}

const formatList = (value, separator = '\n') => {
  if (!Array.isArray(value) || value.length === 0) return ''
  return value.join(separator)
}

const formatPowerState = (state) => {
  const normalized = String(state || '').toUpperCase()
  if (!normalized) return ''
  if (normalized === 'POWERED_ON') return 'Encendida'
  if (normalized === 'POWERED_OFF') return 'Apagada'
  if (normalized === 'SUSPENDED') return 'Suspendida'
  return normalized
}

const formatDisks = (disks) => {
  if (!Array.isArray(disks) || disks.length === 0) return ''
  const lines = disks.map((disk, idx) => {
    if (!disk) return ''
    if (typeof disk === 'string') return disk
    const label =
      disk.label ||
      disk.name ||
      disk.id ||
      (disk.text ? String(disk.text).split('·')[0].trim() : '') ||
      `Disco ${idx + 1}`
    const labelHasPct = typeof label === 'string' && label.includes('%')
    const capacityKiB =
      pickNumber(
        disk.provisionedKiB ??
        disk.capacityKiB ??
        disk.provisionedMB ??
        disk.provisionedSizeMB ??
        disk.capacityMB ??
        disk.sizeMB ??
        disk.provisionedSize ??
        disk.capacity ??
        disk.size
      )
    const usedKiB = pickNumber(
      disk.usedKiB ??
      disk.usedMB ??
      disk.consumedMB ??
      disk.usedMiB ??
      disk.consumedMiB ??
      disk.used ??
      disk.consumed
    )
    const capacityText = capacityKiB !== undefined ? formatStorageKiB(capacityKiB) : ''
    const usedText = usedKiB !== undefined ? formatStorageKiB(usedKiB) : ''
    const pctRaw = pickNumber(disk.pct)
    const pct =
      pctRaw !== undefined
        ? `${pctRaw.toFixed(1)}%`
        : typeof disk.pct === 'string'
          ? disk.pct
          : undefined
    const parts = [label]
    if (capacityText) parts.push(capacityText)
    if (usedText) parts.push(`Usado ${usedText}`)
    if (pct && !labelHasPct) parts.push(pct)
    if (parts.length === 1 && disk.text && disk.text !== label) parts.push(disk.text)
    return parts.join(' · ')
  })
  return lines.join('\n')
}

const CEDIA_COLUMNS = [
  { key: 'id', label: 'ID', width: 20 },
  { key: 'name', label: 'Nombre', width: 26 },
  { key: 'environment', label: 'Org/VDC', width: 18 },
  { key: 'power_state', label: 'Estado', value: (row) => formatPowerState(row.power_state) },
  { key: 'host', label: 'Host', width: 18 },
  { key: 'cluster', label: 'Cluster', width: 18 },
  { key: 'cpu_count', label: 'vCPU', width: 8 },
  { key: 'cpu_usage_pct', label: 'CPU (%)', value: (row) => formatPercent(row.cpu_usage_pct) },
  { key: 'memory_size_MiB', label: 'RAM', value: (row) => formatMemoryMiB(row.memory_size_MiB) },
  { key: 'ram_usage_pct', label: 'RAM (%)', value: (row) => formatPercent(row.ram_usage_pct) },
  { key: 'guest_os', label: 'SO', width: 24 },
  { key: 'vlans', label: 'VLAN(s)', value: (row) => formatList(row.vlans) },
  { key: 'networks', label: 'Redes', value: (row) => formatList(row.networks) },
  { key: 'ip_addresses', label: 'IPs', width: 28, value: (row) => formatList(row.ip_addresses) },
  { key: 'disks', label: 'Discos', width: 30, value: (row) => formatDisks(row.disks) },
  { key: 'nics', label: 'NICs', value: (row) => formatList(row.nics) },
]

const defaultValue = (value) => {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return formatList(value)
  if (typeof value === 'object') return ''
  return value
}

const buildRow = (row) =>
  CEDIA_COLUMNS.map((column) => {
    if (typeof column.value === 'function') return column.value(row)
    return defaultValue(row[column.key])
  })

export function exportCediaInventoryXlsx(rows = [], filenameBase = 'cedia_inventory') {
  const safeRows = Array.isArray(rows) ? rows : []
  const header = CEDIA_COLUMNS.map((column) => column.label)
  const data = safeRows.map((row) => buildRow(row))
  const worksheet = utils.aoa_to_sheet([header, ...data])
  worksheet['!cols'] = CEDIA_COLUMNS.map((column) => ({
    wch: column.width || 16,
  }))
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, worksheet, 'Inventario')
  const timestamp = toTimestamp()
  writeFile(workbook, `${filenameBase}_${timestamp}.xlsx`)
}
