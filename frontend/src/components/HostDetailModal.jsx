import { useEffect, useMemo, useState } from 'react'
import { IoClose, IoPulse } from 'react-icons/io5'
import { FaMemory, FaDatabase } from 'react-icons/fa'
import { getHostDetail as getVmwareHostDetail, getHostDeep as getVmwareHostDeep } from '../api/hosts'
import { normalizeHostDetail, normalizeHostDeep } from '../lib/normalizeHost'

const Backdrop = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
    <div className="relative max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-[#E1D6C8] bg-white text-[#231F20]" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>
)

const renderBar = (value) => {
  if (value == null || Number.isNaN(value)) return <span className="text-[#6b6b6b]">—</span>
  const width = Math.min(Math.max(value, 0), 100)
  const color = value < 50 ? 'bg-[#939598]' : value < 85 ? 'bg-[#E11B22]/70' : 'bg-[#E11B22]'
  return (
    <div className="space-y-1">
      <div className="text-xs text-[#231F20]">{value}%</div>
      <div className="h-2 w-full rounded-full bg-[#E1E1E1]">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

const healthBadge = (health) => {
  const map = {
    healthy: { text: 'Saludable', tone: 'border-[#B7E0C1] text-[#1B5E20] bg-[#E6F4EA]' },
    warning: { text: 'Advertencia', tone: 'border-[#FFE3A3] text-[#7A5E00] bg-[#FFF3CD]' },
    critical: { text: 'Crítico', tone: 'border-[#F5B5B5] text-[#8B0000] bg-[#FDE2E2]' },
  }
  const cfg = map[health] || map.healthy
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${cfg.tone}`}>{cfg.text}</span>
}

export default function HostDetailModal({
  hostId,
  record,
  onClose,
  onOpenDeep,
  getHostDetail = getVmwareHostDetail,
  getHostDeep = getVmwareHostDeep,
}) {
  const [detail, setDetail] = useState(record ? normalizeHostDetail(record) : null)
  const [loading, setLoading] = useState(!record)
  const [error, setError] = useState('')
  const [deepSensors, setDeepSensors] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!hostId) return undefined
    setLoading(true)
    setError('')
    getHostDetail(hostId)
      .then((data) => {
        if (cancelled) return
        const payload = data?.data ?? data
        setDetail(normalizeHostDetail(payload))
      })
      .catch(() => {
        if (cancelled) return
        setError('No se pudo cargar el host')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    getHostDeep(hostId)
      .then((res) => {
        if (cancelled) return
        const payload = res?.data ?? res
        const deep = normalizeHostDeep(payload)
        setDeepSensors(deep?.sensors || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hostId])

  const dsUsageAvg = useMemo(() => {
    if (!detail?.datastores?.length) return null
    const vals = detail.datastores.map((d) => d.used_pct).filter((v) => Number.isFinite(v))
    if (!vals.length) return null
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  }, [detail])

  const sensorSampleCards = () => {
    if (!deepSensors) return null
    const pick = (list) => (list && list.length ? list[0] : null)
    const cards = [
      { label: 'Temperatura', sensor: pick(deepSensors.temperature) },
      { label: 'Voltaje', sensor: pick(deepSensors.voltage) },
      { label: 'Power', sensor: pick(deepSensors.power) },
      { label: 'Ventiladores', sensor: pick(deepSensors.fan) },
    ].filter((c) => c.sensor)
    if (!cards.length) return null
    return (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, idx) => (
          <div key={idx} className="rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] p-3 text-sm">
            <div className="text-xs uppercase text-[#6b6b6b]">{c.label}</div>
            <div className="text-[#231F20] font-semibold">{c.sensor.name}</div>
            <div className="text-usfq-red text-xs">
              {c.sensor.value ?? '—'} {c.sensor.unit ?? ''}
            </div>
            <div className="text-[#6b6b6b] text-xs">{c.sensor.status || c.sensor.health}</div>
          </div>
        ))}
      </div>
    )
  }

  if (!hostId) return null

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center justify-between border-b border-usfq-red/30 bg-usfq-black px-4 py-3">
        <div>
          <div className="text-sm text-usfq-grayLight">Detalle de host</div>
          <div className="text-xl font-bold text-usfq-white">{detail?.name || hostId}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-usfq-grayLight">
            <span>
              {detail?.cluster} · {detail?.datacenter}
            </span>
            {detail?.server_type && (
              <span className="rounded-full border border-[#D6C7B8] bg-[#FAF3E9] px-2 py-0.5 text-[#231F20]">
                {detail.server_type}
              </span>
            )}
            {healthBadge(detail?.health)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenDeep}
            className="rounded-lg bg-[#E11B22] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#c9161c]"
          >
            Modo Experto (Deep)
          </button>
          <button onClick={onClose} className="rounded-full bg-white/10 p-2 text-usfq-white hover:bg-white/20">
            <IoClose className="text-xl" />
          </button>
        </div>
      </div>

      <div className="max-h-[80vh] overflow-y-auto p-4 text-[#231F20]">
        {loading && <div className="py-10 text-center text-[#6b6b6b]">Cargando...</div>}
        {error && <div className="rounded border border-usfq-red/40 bg-usfq-red/10 p-3 text-usfq-red">{error}</div>}
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <KpiCard icon={IoPulse} label="CPU Usage" value={renderBar(detail.quick_stats.cpu_usage_pct || null)} />
              <KpiCard icon={FaMemory} label="RAM Usage" value={renderBar(detail.quick_stats.memory_usage_pct || null)} />
              <KpiCard
                icon={FaDatabase}
                label="Datastore promedio"
                value={dsUsageAvg != null ? renderBar(dsUsageAvg) : <span className="text-[#6b6b6b]">—</span>}
              />
            </div>

            <Section title="Estado general">
              <div className="flex flex-wrap gap-3 text-sm">
                {healthBadge(detail.health)}
                {detail.quick_stats.uptime_human && <Info label="Uptime" value={detail.quick_stats.uptime_human} />}
                {detail.server_type && <Info label="Tipo" value={detail.server_type} />}
              </div>
              {sensorSampleCards()}
            </Section>

            <Section title="Hardware">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <Info label="CPU Model" value={detail.hardware.cpu_model} />
                <Info label="Cores" value={detail.hardware.cpu_cores} />
                <Info label="Threads" value={detail.hardware.cpu_threads} />
                <Info label="Memoria (GB)" value={detail.hardware.memory_size_gb} />
                <Info label="Modelo" value={detail.hardware.server_model} />
                <Info label="Vendor" value={detail.hardware.vendor} />
              </div>
            </Section>

            <Section title="ESXi / Estado">
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <Info label="Versión" value={detail.esxi.version} />
                <Info label="Build" value={detail.esxi.build} />
                <Info label="Power policy" value={detail.quick_stats.power_policy} />
                <Info label="Uptime" value={detail.quick_stats.uptime_human} />
                <Info label="CPU total (MHz)" value={detail.quick_stats.cpu_total_mhz} />
                <Info label="CPU libre (MHz)" value={detail.quick_stats.cpu_free_mhz} />
                <Info label="RAM total (GB)" value={detail.quick_stats.memory_total_gb} />
                <Info label="RAM libre (GB)" value={detail.quick_stats.memory_free_gb} />
              </div>
            </Section>

            <Section title="Red">
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase text-[#6b6b6b]">pNICs</div>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-sm">
                    {detail.networking.pnics?.map((nic) => (
                      <div key={nic.name} className="rounded-lg border border-[#E1D6C8] bg-white p-3">
                        <div className="font-semibold text-[#231F20]">{nic.name}</div>
                        <div className="text-xs text-[#6b6b6b]">{nic.mac}</div>
                        <div className="text-xs text-usfq-red">{nic.link_speed_mbps} Mbps · {nic.driver}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {Object.entries(detail.networking.vmk_grouped || {}).map(([bucket, list]) => (
                    <div key={bucket} className="rounded-lg border border-[#E1D6C8] bg-white p-3 text-sm">
                      <div className="text-xs uppercase text-[#6b6b6b]">{bucket}</div>
                      {list.length === 0 && <div className="text-[#6b6b6b] text-xs">Sin vmk</div>}
                      {list.map((vmk) => (
                        <div key={vmk.device} className="mt-1 rounded border border-[#E1D6C8] bg-[#FAF3E9] p-2">
                          <div className="font-semibold text-[#231F20]">{vmk.device}</div>
                          <div className="text-xs text-[#6b6b6b]">{vmk.ip} · MTU {vmk.mtu}</div>
                          <div className="text-xs text-usfq-red">{vmk.portgroup}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {detail.networking.vswitches?.map((sw) => (
                    <div key={sw.name} className="rounded-lg border border-[#E1D6C8] bg-white p-2 text-sm">
                      <div className="font-semibold text-[#231F20]">{sw.name}</div>
                      <div className="text-xs text-[#6b6b6b]">MTU {sw.mtu}</div>
                    </div>
                  ))}
                  {detail.networking.dvswitches?.map((sw) => (
                    <div key={sw.name} className="rounded-lg border border-[#E1D6C8] bg-white p-2 text-sm">
                      <div className="font-semibold text-[#231F20]">{sw.name}</div>
                      <div className="text-xs text-[#6b6b6b]">MTU {sw.mtu}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="Datastores">
              <div className="grid gap-3 md:grid-cols-2">
                {detail.datastores.map((ds) => {
                  return (
                    <div key={ds.name} className="rounded-lg border border-[#E1D6C8] bg-white p-3">
                      <div className="flex items-center justify-between text-sm text-[#231F20]">
                        <span className="font-semibold">{ds.name}</span>
                        <span className="text-xs text-[#6b6b6b]">{ds.type}</span>
                      </div>
                      <div className="text-xs text-[#6b6b6b]">Capacidad: {ds.capacity_h}</div>
                      <div className="text-xs text-[#6b6b6b]">Libre: {ds.free_space_h}</div>
                      <div className="text-xs text-[#6b6b6b]">Estado: {ds.status || '—'}</div>
                      <div className="mt-2">{renderBar(ds.used_pct ?? null)}</div>
                    </div>
                  )
                })}
              </div>
            </Section>

            <Section title="VMs residentes">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                {detail.vms.map((vm) => (
                  <div key={vm.moid} className="rounded-lg border border-[#E1D6C8] bg-[#FAF3E9] p-2">
                    <div className="font-semibold text-[#231F20]">{vm.name}</div>
                    <div className="text-xs text-[#6b6b6b]">{vm.moid}</div>
                    <div className="text-xs text-usfq-red">{vm.power_state}</div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </Backdrop>
  )
}

// eslint-disable-next-line no-unused-vars
function KpiCard({ icon: IconComponent, label, value }) {
  return (
    <div className="rounded-xl border border-[#E1D6C8] bg-[#FAF3E9] p-3 shadow-lg">
      <div className="flex items-center gap-2 text-[#231F20]">
        <IconComponent className="text-xl text-usfq-red" />
        <span className="text-sm font-semibold text-[#231F20]">{label}</span>
      </div>
      <div className="mt-2">{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-2 rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4">
      <div className="text-sm font-semibold text-usfq-red">{title}</div>
      {children}
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-[#E1D6C8] bg-white p-3">
      <div className="text-xs text-[#6b6b6b]">{label}</div>
      <div className="text-sm font-semibold text-[#231F20]">{value ?? '—'}</div>
    </div>
  )
}
