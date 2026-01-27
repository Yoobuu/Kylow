import { useEffect, useMemo, useState } from 'react'
import { IoClose, IoChevronDown, IoChevronForward, IoPulseSharp, IoHardwareChipSharp, IoShieldCheckmarkSharp, IoGitNetworkSharp, IoCloudSharp } from 'react-icons/io5'
import { getHostDeep as getVmwareHostDeep } from '../api/hosts'
import { normalizeHostDeep } from '../lib/normalizeHost'

const Collapse = ({ title, children, defaultOpen = false, icon: Icon = null, accent = 'text-usfq-red' }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-[#E1D6C8] bg-[#FAF3E9] shadow-lg transition hover:border-usfq-red/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[#231F20]"
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon className={`text-lg ${accent}`} />}
          <span className={accent}>{title}</span>
        </span>
        {open ? <IoChevronDown /> : <IoChevronForward />}
      </button>
      {open && <div className="px-4 pb-4 text-sm text-[#231F20]">{children}</div>}
    </div>
  )
}

const Chip = ({ tone = 'bg-[#FAF3E9] text-[#231F20] border-[#D6C7B8]', children }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
    {children}
  </span>
)

const statusTone = (status) => {
  const val = String(status || '').toLowerCase()
  if (val.includes('green') || val.includes('ok') || val.includes('online')) return 'bg-[#E6F4EA] text-[#1B5E20] border-[#B7E0C1]'
  if (val.includes('yellow') || val.includes('warn')) return 'bg-[#FFF3CD] text-[#7A5E00] border-[#FFE3A3]'
  if (val.includes('red') || val.includes('fail') || val.includes('down')) return 'bg-[#FDE2E2] text-[#8B0000] border-[#F5B5B5]'
  return 'bg-[#FAF3E9] text-[#231F20] border-[#D6C7B8]'
}

const MiniTable = ({ columns, rows, empty }) => {
  if (!rows?.length) return <div className="text-[#6b6b6b] text-xs">{empty || 'Sin datos'}</div>
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E1D6C8] bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-usfq-black text-usfq-white">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1 text-left">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E1D6C8]">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-[#FAF3E9] transition">
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-1 text-[#231F20]">
                  {c.render ? c.render(row[c.key], row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const KeyVals = ({ data }) => {
  const entries = Object.entries(data || {}).filter(([, v]) => v != null && v !== '')
  if (!entries.length) return <div className="text-[#6b6b6b] text-xs">Sin datos</div>
  return (
    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded border border-[#E1D6C8] bg-white p-2">
          <div className="text-[#6b6b6b]">{k}</div>
          <div className="font-semibold text-[#231F20] break-all">{typeof v === 'object' ? JSON.stringify(v) : v}</div>
        </div>
      ))}
    </div>
  )
}

const formatGiB = (bytes) => {
  if (!Number.isFinite(bytes)) return '—'
  return `${(bytes / 1_073_741_824).toFixed(1)} GiB`
}

const NumaView = ({ numa }) => {
  if (!numa) return <div className="text-[#6b6b6b] text-xs">Sin datos</div>
  const nodes = Array.isArray(numa.numaNode) ? numa.numaNode : []
  if (!nodes.length) return <div className="text-[#6b6b6b] text-xs">Sin nodos</div>
  const parseNode = (node) => {
    if (typeof node === 'string') {
      const cpuMatch = node.match(/\[(.*?)\]/)
      const cpus = cpuMatch ? cpuMatch[1].split(',').map((c) => c.trim()) : []
      const memMatch = node.match(/memorySize\s*=\s*([0-9]+)/i)
      const mem = memMatch ? Number(memMatch[1]) : null
      return { cpus, memory: mem }
    }
    return {
      cpus: Array.isArray(node.cpuID) ? node.cpuID : [],
      memory: node.memorySize,
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {numa.numNodes != null && <Chip tone="bg-[#E1E1E1] text-[#231F20] border-[#D0D0D0]">Nodos: {numa.numNodes}</Chip>}
        {numa.type && <Chip tone="bg-[#FAF3E9] text-[#231F20] border-[#D6C7B8]">{numa.type}</Chip>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {nodes.map((n, idx) => {
          const parsed = parseNode(n)
          return (
            <div key={idx} className="rounded border border-[#E1D6C8] bg-white p-2 text-[11px] text-[#231F20] space-y-1">
              <div className="font-semibold text-usfq-red">Nodo NUMA {idx}</div>
              <div>CPUs: {parsed.cpus.length ? parsed.cpus.join(', ') : '—'}</div>
              <div className="text-[#6b6b6b]">Mem: {parsed.memory ? formatGiB(parsed.memory * 1024 * 1024) : '—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DeepExpertModal({ hostId, onClose, getHostDeep = getVmwareHostDeep }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getHostDeep(hostId)
      .then((res) => {
        if (cancelled) return
        const payload = res?.data ?? res
        setData(normalizeHostDeep(payload))
      })
      .catch(() => {
        if (cancelled) return
        setError('No se pudo cargar deep info')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hostId])

  const statsChips = useMemo(() => {
    const runtime = data?.runtime || {}
    const sec = data?.security || {}
    const chips = []
    if (runtime.connection_state) chips.push({ label: runtime.connection_state, tone: 'bg-[#E6F4EA] text-[#1B5E20] border-[#B7E0C1]' })
    if (runtime.power_state) chips.push({ label: runtime.power_state, tone: 'bg-[#FFF3CD] text-[#7A5E00] border-[#FFE3A3]' })
    if (runtime.in_maintenance) chips.push({ label: 'Maintenance ON', tone: 'bg-[#FDE2E2] text-[#8B0000] border-[#F5B5B5]' })
    if (sec.secure_boot) chips.push({ label: 'SecureBoot', tone: 'bg-[#E8F1FF] text-[#1F4E8C] border-[#C9DDF7]' })
    if (sec.tpm) chips.push({ label: 'TPM', tone: 'bg-[#E8F1FF] text-[#1F4E8C] border-[#C9DDF7]' })
    return chips
  }, [data])

  if (!hostId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur">
      <div className="relative max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#E1D6C8] bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E1D6C8] pb-3">
          <div>
            <div className="inline-flex w-fit rounded-full bg-usfq-red px-2 py-0.5 text-xs uppercase text-usfq-white">
              Modo experto
            </div>
            <div className="text-xl font-bold text-[#231F20]">{data?.name || hostId}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {statsChips.map((c, idx) => (
                <Chip key={idx} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-[#FAF3E9] p-2 text-[#231F20] hover:bg-[#F1E6D8]">
            <IoClose className="text-xl" />
          </button>
        </div>

        {loading && <div className="py-8 text-center text-[#6b6b6b]">Cargando deep info...</div>}
        {error && <div className="mt-3 rounded border border-[#F5B5B5] bg-[#FDE2E2] p-3 text-[#8B0000]">{error}</div>}
        {!loading && data && (
          <div className="mt-4 space-y-3">
            <Collapse title="Sensores IPMI" icon={IoPulseSharp} defaultOpen>
              {['temperature', 'voltage', 'power', 'fan', 'other'].map((section) => {
                const list = data.sensors?.[section] || []
                if (!list.length) return null
                return (
                <div key={section} className="mb-3">
                  <div className="text-xs uppercase text-[#6b6b6b]">{section}</div>
                  <MiniTable
                    columns={[
                      { key: 'name', label: 'Nombre' },
                      { key: 'status_chip', label: 'Estado' },
                      { key: 'value', label: 'Valor' },
                    ]}
                    rows={list.map((s) => ({
                      ...s,
                      status_chip: <Chip tone={statusTone(s.status)}>{s.status || 'N/A'}</Chip>,
                    }))}
                    empty="Sin sensores"
                  />
                </div>
                )
              })}
            </Collapse>

            <Collapse title="Hardware / PCI / NUMA" icon={IoHardwareChipSharp} defaultOpen>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs uppercase text-[#6b6b6b]">PCI devices</div>
                  <MiniTable
                    columns={[
                      { key: 'vendor_name', label: 'Vendor' },
                      { key: 'device_name', label: 'Dispositivo' },
                      { key: 'slot', label: 'Slot' },
                      { key: 'class_name', label: 'Clase' },
                    ]}
                    rows={data.hardware?.pci_devices || []}
                    empty="Sin dispositivos PCI"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase text-[#6b6b6b]">NUMA</div>
                  <NumaView numa={data.hardware?.numa} />
                </div>
              </div>
            </Collapse>

            <Collapse title="Storage (HBAs / LUNs / Multipath)" icon={IoCloudSharp} defaultOpen>
              <div className="space-y-3">
                <MiniTable
                  columns={[
                    { key: 'device', label: 'Dispositivo' },
                    { key: 'model', label: 'Modelo' },
                    { key: 'driver', label: 'Driver' },
                    { key: 'status', label: 'Estado', render: (v) => <Chip tone={statusTone(v)}>{v || 'N/A'}</Chip> },
                    { key: 'type', label: 'Tipo' },
                  ]}
                  rows={data.storage?.hbas || []}
                  empty="Sin HBAs"
                />
                <MiniTable
                  columns={[
                    { key: 'canonical_name', label: 'LUN' },
                    { key: 'lun_type', label: 'Tipo' },
                    { key: 'vendor', label: 'Vendor' },
                    { key: 'model', label: 'Modelo' },
                    { key: 'capacity_bytes', label: 'Capacidad', render: (v) => formatGiB(v) },
                  ]}
                  rows={data.storage?.luns || []}
                  empty="Sin LUNs"
                />
                <MiniTable
                  columns={[
                    { key: 'id', label: 'LUN ID' },
                    { key: 'policy', label: 'Política' },
                    {
                      key: 'path_count',
                      label: 'Paths',
                      render: (_v, row) => {
                        const paths = row.paths || []
                        const active = paths.filter((p) => String(p.state || '').toLowerCase().includes('active')).length
                        const standby = paths.filter((p) => String(p.state || '').toLowerCase().includes('standby')).length
                        return `${paths.length} (act:${active}/std:${standby})`
                      },
                    },
                  ]}
                  rows={data.storage?.multipath || []}
                  empty="Sin multipath"
                />
              </div>
            </Collapse>

            <Collapse title="Seguridad / BIOS / OEM / TPM" icon={IoShieldCheckmarkSharp}>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 rounded border border-[#E1D6C8] bg-[#FAF3E9] p-3">
                  <div className="text-xs uppercase text-[#6b6b6b]">Seguridad</div>
                  <div className="flex flex-wrap gap-2">
                    <Chip tone="bg-[#FFF3CD] text-[#7A5E00] border-[#FFE3A3]">
                      Lockdown: {data.security?.lockdown_mode ?? 'N/A'}
                    </Chip>
                    <Chip tone="bg-[#E8F1FF] text-[#1F4E8C] border-[#C9DDF7]">
                      Secure Boot: {data.security?.secure_boot === true ? 'ON' : data.security?.secure_boot === false ? 'OFF' : 'N/A'}
                    </Chip>
                    <Chip tone="bg-[#E8F1FF] text-[#1F4E8C] border-[#C9DDF7]">
                      TPM: {data.security?.tpm ? 'Presente' : 'No info'}
                    </Chip>
                    {data.security?.certificate && (
                      <Chip tone="bg-[#E6F4EA] text-[#1B5E20] border-[#B7E0C1]">
                        Cert len: {Array.isArray(data.security.certificate) ? data.security.certificate.length : 'N/A'}
                      </Chip>
                    )}
                  </div>
                </div>
                <div className="space-y-2 rounded border border-[#E1D6C8] bg-white p-3">
                  <div className="text-xs uppercase text-[#6b6b6b]">BIOS</div>
                  <KeyVals
                    data={{
                      vendor: data.hardware?.bios?.vendor,
                      version: data.hardware?.bios?.biosVersion,
                      release: data.hardware?.bios?.releaseDate,
                    }}
                  />
                  <div className="mt-2 text-xs uppercase text-[#6b6b6b]">OEM</div>
                  <KeyVals
                    data={{
                      vendor: data.hardware?.oem?.vendor,
                      model: data.hardware?.oem?.model,
                      serial: data.hardware?.oem?.serialNumber,
                      uuid: data.hardware?.oem?.uuid,
                    }}
                  />
                </div>
              </div>
            </Collapse>

            <Collapse title="Network Deep" icon={IoGitNetworkSharp}>
              <div className="space-y-3">
                <MiniTable
                  columns={[
                    { key: 'name', label: 'pNIC' },
                    { key: 'mac', label: 'MAC' },
                    { key: 'link_speed_mbps', label: 'Velocidad' },
                    { key: 'driver', label: 'Driver' },
                  ]}
                  rows={data.networking?.pnics || []}
                  empty="Sin pNICs"
                />
                <MiniTable
                  columns={[
                    { key: 'device', label: 'vmk' },
                    {
                      key: 'ipAddress',
                      label: 'IP',
                      render: (v, row) => row?.spec?.ip?.ipAddress || row?.ipAddress || v || '—',
                    },
                    { key: 'mtu', label: 'MTU', render: (v, row) => row?.spec?.mtu || row?.mtu || v || '—' },
                    { key: 'portgroup', label: 'Portgroup' },
                  ]}
                  rows={data.networking?.vmknics || []}
                  empty="Sin vmkernel NICs"
                />
                <MiniTable
                  columns={[
                    { key: 'name', label: 'vSwitch/dvSwitch' },
                    { key: 'type', label: 'Tipo' },
                    { key: 'mtu', label: 'MTU' },
                    { key: 'num_ports', label: 'Puertos' },
                  ]}
                  rows={[
                    ...(data.networking?.vswitch || []).map((x) => ({ ...x, type: 'vSwitch' })),
                    ...(data.networking?.dvs_proxy_switch || []).map((x) => ({ ...x, type: 'dvSwitch' })),
                  ]}
                  empty="Sin switches"
                />
              </div>
            </Collapse>

            <Collapse title="Runtime / Power" icon={IoPulseSharp}>
              <KeyVals data={data.runtime} />
            </Collapse>

            <Collapse title="VMs (deep)">
              <MiniTable
                columns={[
                  { key: 'name', label: 'Nombre' },
                  { key: 'moid', label: 'MOID' },
                  { key: 'power_state', label: 'Power' },
                  { key: 'guest', label: 'Guest' },
                ]}
                rows={data.vms || []}
                empty="Sin VMs"
              />
            </Collapse>

            <Collapse title="Raw JSON" defaultOpen={false}>
              <pre className="max-h-64 overflow-y-auto rounded border border-[#E1D6C8] bg-[#FAF3E9] p-3 text-xs text-[#231F20]">
                {JSON.stringify(data.raw || {}, null, 2)}
              </pre>
            </Collapse>
          </div>
        )}
      </div>
    </div>
  )
}
