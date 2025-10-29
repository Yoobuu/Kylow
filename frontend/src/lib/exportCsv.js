const HEADERS = [
  { key: 'name', label: 'name' },
  { key: 'provider', label: 'provider' },
  { key: 'environment', label: 'environment' },
  { key: 'power_state', label: 'power_state' },
  { key: 'host', label: 'host' },
  { key: 'cluster', label: 'cluster' },
  { key: 'cpu_count', label: 'cpu_count' },
  { key: 'cpu_usage_pct', label: 'cpu_usage_pct' },
  { key: 'memory_size_MiB', label: 'memory_size_MiB' },
  { key: 'ram_demand_mib', label: 'ram_demand_mib' },
  { key: 'ram_usage_pct', label: 'ram_usage_pct' },
  { key: 'guest_os', label: 'guest_os' },
  { key: 'vlans', label: 'vlans' },
  { key: 'ip_addresses', label: 'ip_addresses' },
  { key: 'compat_generation', label: 'compat_generation' },
]

const escapeCsvValue = (value) => {
  if (value == null) return ''
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

const formatRowValue = (row, key) => {
  if (!row) return ''
  if (key === 'vlans') {
    return Array.isArray(row.vlans) ? row.vlans.join(',') : ''
  }
  if (key === 'ip_addresses') {
    return Array.isArray(row.ip_addresses) ? row.ip_addresses.join(' ') : ''
  }
  return row[key] ?? ''
}

export function exportInventoryCsv(rows = [], filenameBase = 'inventory') {
  const headerLine = HEADERS.map(({ label }) => escapeCsvValue(label)).join(',')
  const dataLines = Array.isArray(rows)
    ? rows.map((row) =>
        HEADERS.map(({ key }) => escapeCsvValue(formatRowValue(row, key))).join(',')
      )
    : []

  const csvContent = [headerLine, ...dataLines].join('\r\n')
  const timestamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, '')
  const filename = `${filenameBase}_${timestamp}.csv`
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
