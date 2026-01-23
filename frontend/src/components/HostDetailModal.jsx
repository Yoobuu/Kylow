import { useEffect, useMemo, useState } from 'react'
import { IoClose, IoPulse } from 'react-icons/io5'
import { FaMemory, FaDatabase } from 'react-icons/fa'
import { getHostDetail as getVmwareHostDetail, getHostDeep as getVmwareHostDeep } from '../api/hosts'
import { normalizeHostDetail, normalizeHostDeep } from '../lib/normalizeHost'

const Backdrop = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur" onClick={onClose}>
    <div className="relative max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-yellow-500/30 bg-neutral-900" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>
)

const renderBar = (value, tone = 'from-yellow-400 to-amber-500') => {
  if (value == null || Number.isNaN(value)) return <span className="text-neutral-400">—</span>
  const width = Math.min(Math.max(value, 0), 100)
  const color = value < 50 ? 'from-emerald-400 to-teal-500' : value < 85 ? tone : 'from-rose-500 to-red-600'
  return (
    <div className="space-y-1">
      <div className="text-xs text-neutral-200">{value}%</div>
      <div className="h-2 w-full rounded-full bg-neutral-800">
        <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

const healthBadge = (health) => {
  const map = {
    healthy: { text: 'Saludable', tone: 'border-emerald-400 text-emerald-200 bg-emerald-500/10' },
    warning: { text: 'Advertencia', tone: 'border-amber-400 text-amber-200 bg-amber-500/10' },
    critical: { text: 'Crítico', tone: 'border-rose-400 text-rose-200 bg-rose-500/10' },
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
          <div key={idx} className="rounded-lg border border-white/10 bg-neutral-900/70 p-3 text-sm">
            <div className="text-xs uppercase text-neutral-400">{c.label}</div>
            <div className="text-white font-semibold">{c.sensor.name}</div>
            <div className="text-cyan-300 text-xs">
              {c.sensor.value ?? '—'} {c.sensor.unit ?? ''}
            </div>
            <div className="text-neutral-400 text-xs">{c.sensor.status || c.sensor.health}</div>
          </div>
        ))}
      </div>
    )
  }

  if (!hostId) return null

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center justify-between border-b border-yellow-500/30 bg-neutral-950 px-4 py-3">
        <div>
          <div className="text-sm text-neutral-400">Detalle de host</div>
          <div className="text-xl font-bold text-yellow-200">{detail?.name || hostId}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
            <span>
              {detail?.cluster} · {detail?.datacenter}
            </span>
            {detail?.server_type && (
              <span className="rounded-full border border-cyan-400/50 bg-cyan-500/10 px-2 py-0.5 text-cyan-100">
                {detail.server_type}
              </span>
            )}
            {healthBadge(detail?.health)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenDeep}
            className="rounded-lg border border-cyan-400/60 px-3 py-1.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10"
          >
            Modo Experto (Deep)
          </button>
          <button onClick={onClose} className="rounded-full bg-neutral-800 p-2 text-neutral-200 hover:bg-neutral-700">
            <IoClose className="text-xl" />
          </button>
        </div>
      </div>

      <div className="max-h-[80vh] overflow-y-auto p-4 text-neutral-100">
        {loading && <div className="py-10 text-center text-neutral-300">Cargando...</div>}
        {error && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-red-200">{error}</div>}
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <KpiCard icon={IoPulse} label="CPU Usage" value={renderBar(detail.quick_stats.cpu_usage_pct || null)} />
              <KpiCard icon={FaMemory} label="RAM Usage" value={renderBar(detail.quick_stats.memory_usage_pct || null, 'from-cyan-400 to-blue-500')} />
              <KpiCard
                icon={FaDatabase}
                label="Datastore promedio"
                value={dsUsageAvg != null ? renderBar(dsUsageAvg, 'from-yellow-400 to-amber-500') : <span className="text-neutral-400">—</span>}
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
                  <div className="text-xs uppercase text-neutral-400">pNICs</div>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-sm">
                    {detail.networking.pnics?.map((nic) => (
                      <div key={nic.name} className="rounded-lg border border-white/5 bg-neutral-900/80 p-3">
                        <div className="font-semibold text-white">{nic.name}</div>
                        <div className="text-xs text-neutral-400">{nic.mac}</div>
                        <div className="text-xs text-cyan-300">{nic.link_speed_mbps} Mbps · {nic.driver}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {Object.entries(detail.networking.vmk_grouped || {}).map(([bucket, list]) => (
                    <div key={bucket} className="rounded-lg border border-white/5 bg-neutral-900/80 p-3 text-sm">
                      <div className="text-xs uppercase text-neutral-400">{bucket}</div>
                      {list.length === 0 && <div className="text-neutral-400 text-xs">Sin vmk</div>}
                      {list.map((vmk) => (
                        <div key={vmk.device} className="mt-1 rounded border border-white/5 bg-neutral-900/80 p-2">
                          <div className="font-semibold text-white">{vmk.device}</div>
                          <div className="text-xs text-neutral-400">{vmk.ip} · MTU {vmk.mtu}</div>
                          <div className="text-xs text-cyan-300">{vmk.portgroup}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {detail.networking.vswitches?.map((sw) => (
                    <div key={sw.name} className="rounded-lg border border-white/5 bg-neutral-900/80 p-2 text-sm">
                      <div className="font-semibold text-white">{sw.name}</div>
                      <div className="text-xs text-neutral-400">MTU {sw.mtu}</div>
                    </div>
                  ))}
                  {detail.networking.dvswitches?.map((sw) => (
                    <div key={sw.name} className="rounded-lg border border-white/5 bg-neutral-900/80 p-2 text-sm">
                      <div className="font-semibold text-white">{sw.name}</div>
                      <div className="text-xs text-neutral-400">MTU {sw.mtu}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="Datastores">
              <div className="grid gap-3 md:grid-cols-2">
                {detail.datastores.map((ds) => {
                  const barTone =
                    ds.used_pct != null && ds.used_pct > 85
                      ? 'from-rose-500 to-red-600'
                      : ds.used_pct != null && ds.used_pct > 70
                        ? 'from-amber-500 to-yellow-500'
                        : 'from-emerald-500 to-teal-500'
                  return (
                    <div key={ds.name} className="rounded-lg border border-white/5 bg-neutral-900/80 p-3">
                      <div className="flex items-center justify-between text-sm text-white">
                        <span className="font-semibold">{ds.name}</span>
                        <span className="text-xs text-neutral-400">{ds.type}</span>
                      </div>
                      <div className="text-xs text-neutral-400">Capacidad: {ds.capacity_h}</div>
                      <div className="text-xs text-neutral-400">Libre: {ds.free_space_h}</div>
                      <div className="text-xs text-neutral-400">Estado: {ds.status || '—'}</div>
                      <div className="mt-2">{renderBar(ds.used_pct ?? null, barTone)}</div>
                    </div>
                  )
                })}
              </div>
            </Section>

            <Section title="VMs residentes">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                {detail.vms.map((vm) => (
                  <div key={vm.moid} className="rounded-lg border border-white/5 bg-neutral-900/70 p-2">
                    <div className="font-semibold text-white">{vm.name}</div>
                    <div className="text-xs text-neutral-400">{vm.moid}</div>
                    <div className="text-xs text-emerald-300">{vm.power_state}</div>
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
    <div className="rounded-xl border border-white/5 bg-neutral-950/80 p-3 shadow-lg">
      <div className="flex items-center gap-2 text-neutral-300">
        <IconComponent className="text-xl text-yellow-300" />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="mt-2">{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-neutral-950/80 p-4">
      <div className="text-sm font-semibold text-yellow-300">{title}</div>
      {children}
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-white/5 bg-neutral-900/70 p-3">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-sm font-semibold text-white">{value ?? '—'}</div>
    </div>
  )
}
