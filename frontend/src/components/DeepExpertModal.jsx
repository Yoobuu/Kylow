import { useEffect, useMemo, useState } from 'react'
import { IoClose, IoChevronDown, IoChevronForward, IoPulseSharp, IoHardwareChipSharp, IoShieldCheckmarkSharp, IoGitNetworkSharp, IoCloudSharp } from 'react-icons/io5'
import { getHostDeep as getVmwareHostDeep } from '../api/hosts'
import { normalizeHostDeep } from '../lib/normalizeHost'

const Collapse = ({ title, children, defaultOpen = false, icon: Icon = null, accent = 'text-cyan-200' }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900/70 shadow-lg shadow-cyan-500/10 transition hover:border-cyan-400/50 hover:shadow-cyan-400/20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-cyan-200"
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon className={`text-lg ${accent}`} />}
          <span className={accent}>{title}</span>
        </span>
        {open ? <IoChevronDown /> : <IoChevronForward />}
      </button>
      {open && <div className="px-4 pb-4 text-sm text-neutral-200">{children}</div>}
    </div>
  )
}

const Chip = ({ tone = 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40', children }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
    {children}
  </span>
)

const statusTone = (status) => {
  const val = String(status || '').toLowerCase()
  if (val.includes('green') || val.includes('ok') || val.includes('online')) return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
  if (val.includes('yellow') || val.includes('warn')) return 'bg-amber-500/20 text-amber-200 border-amber-400/50'
  if (val.includes('red') || val.includes('fail') || val.includes('down')) return 'bg-rose-500/20 text-rose-200 border-rose-400/50'
  return 'bg-neutral-500/20 text-neutral-200 border-neutral-400/40'
}

const MiniTable = ({ columns, rows, empty }) => {
  if (!rows?.length) return <div className="text-neutral-400 text-xs">{empty || 'Sin datos'}</div>
  return (
    <div className="overflow-x-auto rounded-lg border border-white/5 bg-neutral-950/80">
      <table className="min-w-full text-xs">
        <thead className="bg-neutral-900 text-neutral-300">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1 text-left">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-neutral-900/60 transition">
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-1 text-neutral-100">
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
  if (!entries.length) return <div className="text-neutral-400 text-xs">Sin datos</div>
  return (
    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded border border-white/5 bg-neutral-900/60 p-2">
          <div className="text-neutral-400">{k}</div>
          <div className="font-semibold text-white break-all">{typeof v === 'object' ? JSON.stringify(v) : v}</div>
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
  if (!numa) return <div className="text-neutral-400 text-xs">Sin datos</div>
  const nodes = Array.isArray(numa.numaNode) ? numa.numaNode : []
  if (!nodes.length) return <div className="text-neutral-400 text-xs">Sin nodos</div>
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
      <div className="flex flex-wrap gap-2 text-xs text-neutral-300">
        {numa.numNodes != null && <Chip tone="bg-cyan-500/20 text-cyan-200 border-cyan-400/40">Nodos: {numa.numNodes}</Chip>}
        {numa.type && <Chip tone="bg-emerald-500/20 text-emerald-200 border-emerald-400/40">{numa.type}</Chip>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {nodes.map((n, idx) => {
          const parsed = parseNode(n)
          return (
            <div key={idx} className="rounded border border-white/5 bg-neutral-900/70 p-2 text-[11px] text-neutral-200 space-y-1">
              <div className="font-semibold text-white">Nodo NUMA {idx}</div>
              <div className="text-neutral-300">CPUs: {parsed.cpus.length ? parsed.cpus.join(', ') : '—'}</div>
              <div className="text-neutral-400">Mem: {parsed.memory ? formatGiB(parsed.memory * 1024 * 1024) : '—'}</div>
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
    if (runtime.connection_state) chips.push({ label: runtime.connection_state, tone: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40' })
    if (runtime.power_state) chips.push({ label: runtime.power_state, tone: 'bg-amber-500/20 text-amber-200 border-amber-400/40' })
    if (runtime.in_maintenance) chips.push({ label: 'Maintenance ON', tone: 'bg-red-500/20 text-red-200 border-red-400/40' })
    if (sec.secure_boot) chips.push({ label: 'SecureBoot', tone: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' })
    if (sec.tpm) chips.push({ label: 'TPM', tone: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' })
    return chips
  }, [data])

  if (!hostId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-black via-neutral-950 to-neutral-900/90 backdrop-blur">
      <div className="relative max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-cyan-500/40 bg-neutral-950 p-4 shadow-2xl shadow-cyan-500/20">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <div className="text-xs uppercase text-cyan-300">Modo experto</div>
            <div className="text-xl font-bold text-white">{data?.name || hostId}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {statsChips.map((c, idx) => (
                <Chip key={idx} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-neutral-800 p-2 text-neutral-200 hover:bg-neutral-700">
            <IoClose className="text-xl" />
          </button>
        </div>

        {loading && <div className="py-8 text-center text-neutral-300">Cargando deep info...</div>}
        {error && <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-red-200">{error}</div>}
        {!loading && data && (
          <div className="mt-4 space-y-3">
            <Collapse title="Sensores IPMI" icon={IoPulseSharp} defaultOpen>
              {['temperature', 'voltage', 'power', 'fan', 'other'].map((section) => {
                const list = data.sensors?.[section] || []
                if (!list.length) return null
                return (
                <div key={section} className="mb-3">
                  <div className="text-xs uppercase text-neutral-400">{section}</div>
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
                  <div className="text-xs uppercase text-neutral-400">PCI devices</div>
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
                  <div className="text-xs uppercase text-neutral-400">NUMA</div>
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
                <div className="space-y-2 rounded border border-white/10 bg-neutral-900/70 p-3">
                  <div className="text-xs uppercase text-neutral-400">Seguridad</div>
                  <div className="flex flex-wrap gap-2">
                    <Chip tone="bg-amber-500/20 text-amber-200 border-amber-400/40">
                      Lockdown: {data.security?.lockdown_mode ?? 'N/A'}
                    </Chip>
                    <Chip tone="bg-cyan-500/20 text-cyan-200 border-cyan-400/40">
                      Secure Boot: {data.security?.secure_boot === true ? 'ON' : data.security?.secure_boot === false ? 'OFF' : 'N/A'}
                    </Chip>
                    <Chip tone="bg-cyan-500/20 text-cyan-200 border-cyan-400/40">
                      TPM: {data.security?.tpm ? 'Presente' : 'No info'}
                    </Chip>
                    {data.security?.certificate && (
                      <Chip tone="bg-emerald-500/20 text-emerald-200 border-emerald-400/40">
                        Cert len: {Array.isArray(data.security.certificate) ? data.security.certificate.length : 'N/A'}
                      </Chip>
                    )}
                  </div>
                </div>
                <div className="space-y-2 rounded border border-white/10 bg-neutral-900/70 p-3">
                  <div className="text-xs uppercase text-neutral-400">BIOS</div>
                  <KeyVals
                    data={{
                      vendor: data.hardware?.bios?.vendor,
                      version: data.hardware?.bios?.biosVersion,
                      release: data.hardware?.bios?.releaseDate,
                    }}
                  />
                  <div className="mt-2 text-xs uppercase text-neutral-400">OEM</div>
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
              <pre className="max-h-64 overflow-y-auto rounded bg-neutral-900/70 p-3 text-xs text-neutral-200">
                {JSON.stringify(data.raw || {}, null, 2)}
              </pre>
            </Collapse>
          </div>
        )}
      </div>
    </div>
  )
}
