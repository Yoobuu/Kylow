import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { IoAlertCircleSharp } from 'react-icons/io5'
import api from '../api/axios'
import { normalizeHyperV } from '../lib/normalize'
import { exportInventoryXlsx } from '../lib/exportXlsx'
import HyperVTable from './HyperVTable'
import { getHypervHosts, getHypervSnapshot, postHypervRefresh, getHypervConfig } from '../api/hypervHosts'
import { useAuth } from '../context/AuthContext'
import { formatGuayaquilDateTime, formatGuayaquilTime, parseSnapshotTimestamp } from '../lib/snapshotTime'

const POLL_MS = 2500
const HOST_STATE_LABELS = {
  ok: 'ok',
  error: 'error',
  timeout_host: 'timeout',
  stale_snapshot: 'stale',
  skipped_cooldown: 'cooldown',
  pending: 'pendiente',
}
const HOST_STATE_STYLES = {
  ok: 'border-[#B7E0C1] bg-[#E6F4EA] text-[#1B5E20]',
  error: 'border-[#F5B5B5] bg-[#FDE2E2] text-[#8B0000]',
  timeout_host: 'border-[#F5B5B5] bg-[#FDE2E2] text-[#8B0000]',
  stale_snapshot: 'border-[#FFE3A3] bg-[#FFF3CD] text-[#7A5E00]',
  skipped_cooldown: 'border-[#FFE3A3] bg-[#FFF3CD] text-[#7A5E00]',
  pending: 'border-[#D6C7B8] bg-[#FAF3E9] text-[#6b6b6b]',
}
const NOTICE_STYLES = {
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  info: 'border-cyan-300 bg-cyan-50 text-cyan-900',
}

const formatLocalTimestamp = (value) => {
  return formatGuayaquilDateTime(value) || (value ? String(value) : null)
}

export default function HyperVPage({ group = 'cumbaya' }) {
  const refreshRef = useRef(false)
  const [hosts, setHosts] = useState([])
  const [snapshotMeta, setSnapshotMeta] = useState(null)
  const [banner, setBanner] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [polling, setPolling] = useState(false)
  const pollRef = useRef(null)
  const { hasPermission } = useAuth()
  const isSuperadmin = hasPermission('jobs.trigger')
  const [status, setStatus] = useState(null)
  const initialRefreshRef = useRef(false)
  const useLegacyRef = useRef(false)
  const [tableError, setTableError] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(null)
  const [cooldownTick, setCooldownTick] = useState(0)
  const [refreshRequested, setRefreshRequested] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState(null)
  const lastGoodRef = useRef({ data: null, level: null })
  const groupKey = group === 'otros' ? 'otros' : 'cumbaya'

  useEffect(() => {
    setHosts([])
    setSnapshotMeta(null)
    setBanner(null)
    setStatus(null)
    setJobId(null)
    setPolling(false)
    refreshRef.current = false
    initialRefreshRef.current = false
    lastGoodRef.current = { data: null, level: null }
  }, [groupKey])

  const discoverHosts = useCallback(async () => {
    if (hosts.length) return hosts
    const pickFromConfig = (cfg) => {
      const primary = Array.isArray(cfg?.hosts)
        ? cfg.hosts.map((h) => (h || '').trim().toLowerCase()).filter(Boolean).sort()
        : []
      const otros = Array.isArray(cfg?.hosts_otros)
        ? cfg.hosts_otros.map((h) => (h || '').trim().toLowerCase()).filter(Boolean).sort()
        : []
      const picked = groupKey === 'otros' ? otros : primary
      return { picked, primary, otros }
    }
    // preferir /hyperv/hosts
    try {
      setStatus({ kind: 'info', text: 'Descubriendo hosts (config)...' })
      const cfg = await getHypervConfig()
      const { picked, otros } = pickFromConfig(cfg)
      const hs = picked
      if (hs.length) {
        console.log('[HyperVPage] hosts discover via /hyperv/config', hs)
        setHosts(hs)
        return hs
      }
      if (groupKey === 'otros' && !otros.length) {
        setStatus({ kind: 'error', text: 'No se encontraron hosts para Hyper-V Otros' })
        return []
      }
    } catch (err) {
      console.warn('[HyperVPage] config discovery failed', err)
    }
    try {
      setStatus({ kind: 'info', text: 'Descubriendo hosts (config)...' })
      const cfg = await getHypervConfig()
      const { picked, otros } = pickFromConfig(cfg)
      const hs = picked
      if (hs.length) {
        console.log('[HyperVPage] hosts discover via /hyperv/config', hs)
        setHosts(hs)
        return hs
      }
      if (groupKey === 'otros' && !otros.length) {
        setStatus({ kind: 'error', text: 'No se encontraron hosts para Hyper-V Otros' })
        return []
      }
    } catch (err) {
      console.warn('[HyperVPage] config discovery failed', err)
    }
    if (groupKey === 'otros') {
      setStatus({ kind: 'error', text: 'No se encontraron hosts para Hyper-V Otros' })
      return []
    }
    try {
      setStatus({ kind: 'info', text: 'Descubriendo hosts (hosts)...' })
      const data = await getHypervHosts()
      const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []
      const hs = Array.from(
        new Set(
          list
            .map((h) => (h.host || h.name || '').trim().toLowerCase())
            .filter(Boolean)
        )
      ).sort()
      if (hs.length) {
        console.log('[HyperVPage] hosts discover via /hyperv/hosts', hs)
        setHosts(hs)
        return hs
      }
    } catch (err) {
      // fallback a vms/batch
    }
    if (useLegacyRef.current) {
      try {
        setStatus({ kind: 'info', text: 'Descubriendo hosts (vms/batch)...' })
        const { data } = await api.get('/hyperv/vms/batch', { timeout: 8000 })
        const payload = data?.results
        if (payload && typeof payload === 'object') {
          const hs = Object.keys(payload).map((h) => h.trim().toLowerCase()).filter(Boolean).sort()
          console.log('[HyperVPage] hosts discover via /hyperv/vms/batch', hs)
          setHosts(hs)
          return hs
        }
      } catch (err) {
        // silence, handled downstream
      }
    }
    console.warn('[HyperVPage] hosts discover failed, empty list')
    setStatus({ kind: 'error', text: 'No se encontraron hosts para Hyper-V' })
    return []
  }, [groupKey, hosts.length])

  const fetchSnapshot = useCallback(
    async (useRefreshLegacy = false) => {
      const hs = await discoverHosts()
      if (!hs.length) throw new Error('No se encontraron hosts para Hyper-V')
      setRefreshNotice(null)
      const getLastGood = () => {
        const cached = lastGoodRef.current?.data
        return Array.isArray(cached) && cached.length ? cached : null
      }
      const rememberLastGood = (rows, level) => {
        if (!Array.isArray(rows) || rows.length === 0) return
        lastGoodRef.current = { data: rows, level }
      }

      const attemptSnapshot = async (level, allowSummaryFallback) => {
        const loadingLabel =
          level === 'detail' ? 'Cargando snapshot (detalles)...' : 'Cargando snapshot...'
        setStatus({ kind: 'info', text: loadingLabel })
        try {
          const snap = await getHypervSnapshot('vms', hs, level)
          if (!snap || typeof snap !== 'object') {
            const err = new Error('snapshot_empty')
            err.response = { status: 204 }
            throw err
          }
          const flattened =
            snap && snap.data && typeof snap.data === 'object'
              ? Object.values(snap.data).flat()
              : []
          const errors = []
          Object.entries(snap.hosts_status || {}).forEach(([h, st]) => {
            if (!st || !st.state) return
            if (st.state !== 'ok') errors.push(`${h}: ${st.state}`)
          })
          setSnapshotMeta({
            generated_at: snap.generated_at,
            source: snap.source || null,
            stale: snap.stale,
            stale_reason: snap.stale_reason,
            hosts_status: snap.hosts_status || {},
          })
          console.log('[HyperVPage] snapshot loaded', { hosts: hs.length, vms: flattened.length })
          if (snap.stale || errors.length) {
            setBanner({
              kind: 'warning',
              title: 'Inventario parcial',
              details: errors,
            })
            setStatus({ kind: 'warning', text: 'Snapshot parcial' })
          } else {
            setBanner(null)
            const updatedAt = formatGuayaquilTime(snap.generated_at)
            setStatus({ kind: 'success', text: `Snapshot actualizado ${updatedAt || '—'}` })
          }
          setRefreshNotice(null)
          if (flattened.length) {
            rememberLastGood(flattened, level)
            return flattened
          }
          const cached = getLastGood()
          if (cached) {
            setRefreshNotice('No se pudo actualizar; mostrando datos anteriores.')
            return cached
          }
          return flattened
        } catch (err) {
          const status = err?.response?.status
          if (status === 401) throw err
          if (status === 204 || useRefreshLegacy) {
            if (allowSummaryFallback && level === 'detail') {
              try {
                const summaryRows = await attemptSnapshot('summary', false)
                if (Array.isArray(summaryRows) && summaryRows.length) {
                  setRefreshNotice('Detalles no disponibles; mostrando resumen.')
                }
                return summaryRows
              } catch (e) {
                // fallback to refresh/legacy flows below
              }
            }
            if (isSuperadmin && !initialRefreshRef.current) {
              initialRefreshRef.current = true
              const message =
                level === 'detail'
                  ? 'Snapshot no disponible: generando snapshot con detalles...'
                  : 'Snapshot no disponible: generando snapshot inicial...'
              setStatus({ kind: 'info', text: message })
              try {
                const resp = await postHypervRefresh({ scope: 'vms', hosts: hs, level, force: false })
                if (resp?.job_id) {
                  setJobId(resp.job_id)
                  setPolling(true)
                  const cached = getLastGood()
                  if (cached) {
                    setRefreshNotice('Actualizando en segundo plano; mostrando datos anteriores.')
                    return cached
                  }
                  return []
                }
              } catch (e) {
                setStatus({ kind: 'error', text: 'No se pudo generar snapshot inicial' })
              }
            } else if (!isSuperadmin && !useLegacyRef.current) {
              setStatus({ kind: 'warning', text: 'Snapshot aún no generado; espera al refresh del superadmin' })
              const cached = getLastGood()
              if (cached) {
                setRefreshNotice('No se pudo actualizar; mostrando datos anteriores.')
                return cached
              }
              if (allowSummaryFallback && level === 'detail') {
                setRefreshNotice('Detalles no disponibles; mostrando resumen.')
                return attemptSnapshot('summary', false)
              }
              throw new Error('Snapshot no disponible')
            }
            if (useLegacyRef.current && isSuperadmin) {
              setStatus({ kind: 'info', text: 'Snapshot no disponible: usando modo legacy...' })
              console.log('[HyperVPage] snapshot 204, using legacy')
              const { data } = await api.get('/hyperv/vms/batch', {
                params: refreshRef.current ? { refresh: true } : {},
                timeout: 8000,
              })
              const payload = data
              if (payload?.results && typeof payload.results === 'object') {
                setSnapshotMeta(null)
                setBanner(null)
                const flattened = Object.values(payload.results).flat()
                console.log('[HyperVPage] legacy data loaded', { vms: flattened.length })
                const cached = getLastGood()
                if (cached) {
                  setRefreshNotice('No se pudo actualizar; mostrando datos anteriores.')
                  return cached
                }
                if (level === 'detail') {
                  setRefreshNotice('Detalles no disponibles en modo legacy; mostrando resumen.')
                }
                setStatus({ kind: 'info', text: `Modo legacy (${flattened.length} VMs)` })
                return flattened
              }
            }
          }
          const cached = getLastGood()
          if (cached) {
            setRefreshNotice('No se pudo actualizar; mostrando datos anteriores.')
            return cached
          }
          if (allowSummaryFallback && level === 'detail') {
            setRefreshNotice('Detalles no disponibles; mostrando resumen.')
            return attemptSnapshot('summary', false)
          }
          setStatus({ kind: 'error', text: err?.message || 'Error cargando snapshot' })
          throw new Error('Ocurrió un error al obtener las VMs. Intenta nuevamente.')
        }
      }

      try {
        return await attemptSnapshot('detail', true)
      } finally {
        refreshRef.current = false
      }
    },
    [discoverHosts, isSuperadmin]
  )

  const fetcher = useCallback(() => fetchSnapshot(), [fetchSnapshot])

  const summaryBuilder = useCallback((items) => {
    const total = items.length
    const encendidas = items.filter((vm) => vm.power_state === 'POWERED_ON').length
    const apagadas = items.filter((vm) => vm.power_state === 'POWERED_OFF').length
    const ambientes = items.reduce((acc, vm) => {
      const env = vm.environment || 'Sin ambiente'
      acc[env] = (acc[env] || 0) + 1
      return acc
    }, {})
    return { total, encendidas, apagadas, ambientes }
  }, [])

  const handleRefresh = useCallback(async (refresh) => {
    refreshRef.current = true
    setRefreshRequested(true)
    if (!isSuperadmin) {
      await refresh()
      setRefreshRequested(false)
      return
    }
    const hs = await discoverHosts()
    if (!hs.length) {
      await refresh()
      setRefreshRequested(false)
      return
    }
    try {
      const resp = await postHypervRefresh({ scope: 'vms', hosts: hs, level: 'detail', force: false })
      if (resp?.message === 'cooldown_active') {
        const cooldownAt = formatLocalTimestamp(resp.cooldown_until)
        const cooldownLabel = cooldownAt ? `Próximo refresh: ${cooldownAt}` : 'Próximo refresh: intervalo mínimo'
        setCooldownUntil(resp.cooldown_until || null)
        setBanner({
          kind: 'info',
          title: 'Snapshot reciente',
          details: [cooldownLabel],
        })
        setStatus({ kind: 'info', text: cooldownAt ? `Actualizado recientemente (próximo refresh ${cooldownAt})` : 'Actualizado recientemente' })
        setRefreshRequested(false)
        return
      }
      if (resp?.job_id) {
        setCooldownUntil(null)
        setJobId(resp.job_id)
        setPolling(true)
        setStatus({ kind: 'info', text: 'Refrescando inventario (job en curso)...' })
        setRefreshRequested(false)
      }
    } catch (err) {
      setRefreshRequested(false)
      const status = err?.response?.status
      if (status === 401) throw err
      if (status === 403) {
        setStatus({ kind: 'error', text: 'Sin permisos para refrescar Hyper-V' })
        setBanner({
          kind: 'error',
          title: 'No se pudo iniciar refresh',
          details: ['Permisos insuficientes'],
        })
        return
      }
      setBanner({
        kind: 'error',
        title: 'No se pudo iniciar refresh',
        details: [err?.message || 'Error desconocido'],
      })
      setStatus({ kind: 'error', text: 'Error iniciando refresh' })
      refresh()
    }
  }, [discoverHosts, isSuperadmin])

  useEffect(() => {
    if (!cooldownUntil) return undefined
    const untilDate = parseSnapshotTimestamp(cooldownUntil)
    const untilTs = untilDate ? untilDate.getTime() : Number.NaN
    if (!Number.isFinite(untilTs)) return undefined
    const delay = Math.max(0, untilTs - Date.now())
    if (delay === 0) {
      setCooldownTick((value) => value + 1)
      return undefined
    }
    const id = setTimeout(() => setCooldownTick((value) => value + 1), delay)
    return () => clearTimeout(id)
  }, [cooldownUntil, cooldownTick])

  useEffect(() => {
    if (!jobId || !polling) return undefined
    const tick = async () => {
      try {
        const { data } = await api.get(`/hyperv/jobs/${jobId}`)
        const terminal = ['succeeded', 'failed', 'expired'].includes(data.status)
        const errors = []
        Object.entries(data.hosts_status || {}).forEach(([h, st]) => {
          if (st.state && st.state !== 'ok') errors.push(`${h}: ${st.state}`)
        })
        if (errors.length || data.message === 'partial') {
          setBanner({
            kind: 'warning',
            title: 'Refresh parcial',
            details: errors,
          })
          setStatus({ kind: 'warning', text: 'Refresh parcial' })
        }
        if (terminal) {
          setPolling(false)
          setJobId(null)
          setStatus({ kind: 'success', text: 'Refresh completado, recargando snapshot...' })
          await fetchSnapshot(true)
        }
      } catch (err) {
        setPolling(false)
        setJobId(null)
        setStatus({ kind: 'error', text: 'Error durante polling del job' })
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    pollRef.current = id
    return () => clearInterval(id)
  }, [jobId, polling, fetchSnapshot])

  const handleExport = useCallback(
    (rows) => exportInventoryXlsx(rows, 'hyperv_inventory'),
    []
  )

  const noticeNode = useMemo(() => {
    if (!banner && !status && !tableError) return null

    const kind = banner?.kind || status?.kind || (tableError ? 'warning' : 'info')
    const baseStyle = NOTICE_STYLES[kind] || NOTICE_STYLES.info
    const title = banner?.title || status?.text || 'Aviso'
    const subtitle =
      banner && status?.text && status.text !== title ? status.text : null
    const extra =
      tableError && tableError !== title && tableError !== subtitle
        ? tableError
        : null

    const details = Array.isArray(banner?.details) ? banner.details : []
    const parsedDetails = details
      .map((raw) => {
        if (!raw || typeof raw !== 'string') return null
        const [hostPart, statePart] = raw.split(':')
        const host = (hostPart || '').trim()
        const stateRaw = (statePart || '').trim().toLowerCase()
        if (!host || !HOST_STATE_LABELS[stateRaw]) {
          return { key: raw, text: raw, isHost: false }
        }
        const label = HOST_STATE_LABELS[stateRaw]
        const className = HOST_STATE_STYLES[stateRaw] || HOST_STATE_STYLES.pending
        return {
          key: `${host}-${stateRaw}`,
          label: `${host} (${label})`,
          className,
          isHost: true,
        }
      })
      .filter(Boolean)

    const textDetails = parsedDetails.filter((item) => !item.isHost).map((item) => item.text)
    const hostDetails = parsedDetails.filter((item) => item.isHost)

    const hostStatusEntries = snapshotMeta?.hosts_status
      ? Object.entries(snapshotMeta.hosts_status)
      : []
    const parsedHostStatus = hostStatusEntries
      .map(([host, status]) => {
        const stateRaw = String(status?.state || '').toLowerCase()
        if (!stateRaw || stateRaw === 'ok') return null
        const label = HOST_STATE_LABELS[stateRaw] || stateRaw || 'estado'
        const className = HOST_STATE_STYLES[stateRaw] || HOST_STATE_STYLES.pending
        return {
          key: `${host}-${stateRaw}`,
          label: `${host} (${label})`,
          className,
        }
      })
      .filter(Boolean)

    const hostChips = hostDetails.length ? hostDetails : parsedHostStatus
    const hasHostIssues = hostChips.length > 0
    const isCooldownNotice = banner?.title === 'Cooldown activo' || status?.text?.toLowerCase().includes('cooldown')

    const resolvedTitle =
      hasHostIssues && isCooldownNotice ? 'Inventario parcial' : title
    const resolvedSubtitle =
      hasHostIssues && isCooldownNotice ? 'Cooldown activo' : subtitle

    return (
      <div className="mb-6 flex items-start gap-4 rounded-2xl border border-[#E1D6C8] bg-white p-4 shadow-sm transition-all hover:shadow-md">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          kind === 'error' ? 'bg-[#FDE2E2] text-[#E11B22]' : 
          kind === 'warning' ? 'bg-[#FFF3CD] text-[#7A5E00]' : 
          'bg-[#FAF3E9] text-[#E11B22]'
        }`}>
          <IoAlertCircleSharp className="text-2xl" />
        </div>
        
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-[#231F20]">{resolvedTitle}</h4>
            {resolvedSubtitle && (
              <span className="rounded-full bg-[#FAF3E9] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6b6b6b] border border-[#E1D6C8]">
                {resolvedSubtitle}
              </span>
            )}
          </div>

          {extra && <div className="text-xs text-[#6b6b6b] italic">{extra}</div>}
          
          {textDetails.length > 0 && (
            <div className="space-y-0.5 text-xs text-[#3b3b3b]">
              {textDetails.map((text) => (
                <div key={text}>{text}</div>
              ))}
            </div>
          )}

          {hostChips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {hostChips.map((item) => (
                <span
                  key={item.key}
                  className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors ${item.className}`}
                >
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }, [banner, status, tableError, snapshotMeta])

  return (
    <div className="flex flex-col gap-3" data-tutorial-id="hyperv-root">
      {noticeNode}
      <HyperVTable
        title="Inventario Hyper-V"
        providerKey={`hyperv-${groupKey}`}
        fetcher={fetcher}
        normalizeRecord={normalizeHyperV}
        summaryBuilder={summaryBuilder}
        onRefresh={handleRefresh}
        searchInputId="hyperv-global-search"
        onExport={handleExport}
        exportFilenameBase="hyperv_inventory"
        exportLabel="Exportar XLSX"
        onErrorChange={setTableError}
        refreshBusy={polling || refreshRequested}
        refreshCooldownUntil={cooldownUntil}
        snapshotGeneratedAt={snapshotMeta?.generated_at || null}
        snapshotSource={snapshotMeta?.source || null}
        snapshotStale={Boolean(snapshotMeta?.stale)}
        snapshotStaleReason={snapshotMeta?.stale_reason || null}
        refreshNotice={refreshNotice}
      />
    </div>
  )
}
