import React, { useCallback, useRef } from 'react'

import api from '../api/axios'
import { normalizeHyperV } from '../lib/normalize'
import { exportInventoryCsv } from '../lib/exportCsv'
import HyperVTable from './HyperVTable'

export default function HyperVPage() {
  const refreshRef = useRef(false)

  const fetcher = useCallback(async () => {
    const useRefresh = refreshRef.current
    refreshRef.current = false
    try {
      const { data } = await api.get('/hyperv/vms/batch', {
        params: useRefresh ? { refresh: true } : {},
      })
      const payload = data
      if (Array.isArray(payload)) return payload
      if (payload?.results && typeof payload.results === 'object') {
        return Object.values(payload.results).flat()
      }
      if (Array.isArray(payload?.items)) return payload.items
      if (Array.isArray(payload?.data)) return payload.data
      return []
    } catch (error) {
      const status = error?.response?.status
      if (status === 401) {
        throw error
      }
      throw new Error('OcurriA3 un error al obtener las VMs.')
    }
  }, [])

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

  const handleRefresh = useCallback((refresh) => {
    refreshRef.current = true
    refresh()
  }, [])

  const handleExport = useCallback(
    (rows) => exportInventoryCsv(rows, 'hyperv_inventory'),
    []
  )

  return (
    <HyperVTable
      title="Inventario Hyper-V"
      fetcher={fetcher}
      normalizeRecord={normalizeHyperV}
      summaryBuilder={summaryBuilder}
      onRefresh={handleRefresh}
      searchInputId="hyperv-global-search"
      onExport={handleExport}
      exportFilenameBase="hyperv_inventory"
    />
  )
}
