import { useCallback, useEffect, useMemo, useState } from 'react'

import api from '../../api/axios'
import { normalizeVMware } from '../../lib/normalize'
import * as inventoryCache from '@/lib/inventoryCache'

function classifyFromString(str) {
  const cleaned = String(str ?? '').trim().toUpperCase()
  if (!cleaned) return null
  const tokens = cleaned.split(/[-_\s]+/).filter(Boolean)
  for (const token of tokens) {
    const first = token.charAt(0)
    if (first === 'S') return 'sandbox'
    if (first === 'T') return 'test'
    if (first === 'P') return 'produccion'
    if (first === 'D') return 'desarrollo'
  }
  return null
}

function inferEnvironmentForHyperV(vm) {
  if (!vm) return 'desconocido'
  const byName = classifyFromString(vm?.Name ?? vm?.name)
  if (byName) return byName
  const byCluster = classifyFromString(vm?.Cluster ?? vm?.cluster)
  if (byCluster) return byCluster
  const byHost = classifyFromString(vm?.HVHost ?? vm?.host)
  if (byHost) return byHost
  return 'desconocido'
}

function useDebouncedValue(value, delay = 200) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}

const DEFAULT_FILTERS = {
  name: '',
  environment: '',
  power_state: '',
  guest_os: '',
  host: '',
  cluster: '',
  vlan: '',
}

const GROUPERS = {
  none: () => '',
  estado: (vm) => vm.power_state || 'Sin estado',
  ambiente: (vm) => vm.environment || 'Sin ambiente',
  host: (vm) => vm.host || 'Sin Host',
  vlan: (vm) => (vm.vlans?.length ? vm.vlans.join(', ') : 'Sin VLAN'),
  cluster: (vm) => vm.cluster || 'Sin Cluster',
  SO: (vm) => vm.guest_os || 'Sin SO',
}

const defaultFetch = async ({ provider } = {}) => {
  if (provider === 'hyperv') {
    const { data } = await api.get('/hyperv/vms/batch')
    if (data && data.results && typeof data.results === 'object') {
      return Object.values(data.results).flat()
    }
    return []
  } else {
    const { data } = await api.get('/vms')
    return Array.isArray(data) ? data : data.results || []
  }
}

const defaultSummary = (items) => {
  const total = items.length
  const encendidas = items.filter((vm) => vm.power_state === 'POWERED_ON').length
  const apagadas = items.filter((vm) => vm.power_state === 'POWERED_OFF').length
  const ambientes = items.reduce((acc, vm) => {
    const env = vm.environment || 'Sin ambiente'
    acc[env] = (acc[env] || 0) + 1
    return acc
  }, {})
  return { total, encendidas, apagadas, ambientes }
}

const getStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const readPersistedFilters = (key) => {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch {
    // ignore malformed payloads
  }
  return null
}

const writePersistedFilters = (key, payload) => {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(payload))
  } catch {
    // ignore quota or serialization errors
  }
}

export function useInventoryState(options = {}) {
  const {
    fetcher = defaultFetch,
    normalizeRecord = normalizeVMware,
    summaryBuilder = defaultSummary,
    initialGroup = 'none',
    provider = 'vmware',
    cacheTtlMs,
  } = options

  const providerKey = provider || 'vmware'
  const filtersKey = `inv-filters:${providerKey}`
  const resolvedCacheTtl = cacheTtlMs ?? inventoryCache.DEFAULT_TTL_MS

  const persistedFilters = readPersistedFilters(filtersKey)
  const initialFilterState =
    persistedFilters?.filter && typeof persistedFilters.filter === 'object'
      ? { ...DEFAULT_FILTERS, ...persistedFilters.filter }
      : DEFAULT_FILTERS
  const initialSearchState =
    typeof persistedFilters?.q === 'string' ? persistedFilters.q : ''

  const [vms, setVms] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState(initialFilterState)
  const [sortBy, setSortBy] = useState({ key: 'name', asc: true })
  const [groupByOption, setGroupByOption] = useState(initialGroup)
  const [globalSearch, setGlobalSearch] = useState(initialSearchState)
  const [selectedVm, setSelectedVm] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [lastFetchTs, setLastFetchTs] = useState(null)

  const debouncedSearch = useDebouncedValue(globalSearch, 200)

  const fetchData = useCallback(
    async ({ showLoading = true, ...fetchOptions } = {}) => {
      if (showLoading) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }
      setError('')

      console.log('[fetchData] start for providerKey =', providerKey, 'opts =', fetchOptions)

      try {
        // 1. pedir datos al backend usando el fetcher actual
        const rawItems = await fetcher(fetchOptions)

        // 2. normalizar cada item
        console.log('RAW ITEMS', rawItems)
        const normalized = rawItems.map((item) => {
          const record = normalizeRecord(item);

          const enriched = (
            providerKey === 'hyperv'
              ? {
                  ...record,
                  environment: inferEnvironmentForHyperV(record),
                }
              : record
          );

          // ADJUNTAR LA VM CRUDA ORIGINAL
          return {
            ...enriched,
            __raw: item,
          };
        })
        console.log('NORMALIZED', normalized.length, normalized[0])
        console.log('[fetchData] normalized.length =', normalized.length, 'providerKey =', providerKey)

        // 3. actualizar estado con las VMs recibidas
        setVms(normalized)
        inventoryCache.set(providerKey, normalized)
        console.log('STATE SET', normalized.length)
        setLastFetchTs(Date.now())

        return normalized
      } catch (fetchError) {
        console.error('[fetchData] ERROR', fetchError)
        setError(fetchError?.message || 'OcurriÃ¯Â¿Â½ un error al obtener las VMs.')
        return null
      } finally {
        if (showLoading) {
          setLoading(false)
        } else {
          setRefreshing(false)
        }
      }
    },
    [fetcher, normalizeRecord, providerKey]
  )

  const fetchVm = useCallback(
    async (options = {}) => {
      let normalizedOptions = {}
      if (options === true) {
        normalizedOptions = { refresh: true }
      } else if (typeof options === 'object' && options !== null) {
        normalizedOptions = options
      }
      await fetchData({ showLoading: true, ...normalizedOptions })
    },
    [fetchData]
  )

  useEffect(() => {
    console.log('[useEffect mount] providerKey =', providerKey)
    const cachedEntry = inventoryCache.get(providerKey)
    const cachedList = Array.isArray(cachedEntry?.data) ? cachedEntry.data : null
    const cacheIsFresh = cachedEntry ? inventoryCache.isFresh(providerKey, resolvedCacheTtl) : false

    if (cachedList && cachedList.length) {
      console.log('[useEffect mount] using cached inventory len =', cachedList.length)
      setVms(cachedList)
      setLastFetchTs(cachedEntry.ts || null)
    }

    if (cacheIsFresh) {
      console.log('[useEffect mount] cache is fresh, skipping immediate refresh')
      return
    }

    const shouldShowLoading = !(cachedList && cachedList.length)
    fetchData({ showLoading: shouldShowLoading })
  }, [providerKey, fetchData, resolvedCacheTtl])

  useEffect(() => {
    writePersistedFilters(filtersKey, {
      q: globalSearch,
      filter: {
        ...DEFAULT_FILTERS,
        ...filter,
      },
    })
  }, [
    filtersKey,
    globalSearch,
    filter.environment,
    filter.power_state,
    filter.guest_os,
    filter.host,
    filter.cluster,
    filter.vlan,
    filter.name,
  ])

  const handlePowerChange = useCallback((id, newState) => {
    setVms((prev) =>
      prev.map((vm) =>
        vm.id === id
          ? { ...vm, power_state: newState || vm.power_state }
          : vm
      )
    )
  }, [])

  const resumen = useMemo(() => summaryBuilder(vms), [vms, summaryBuilder])

  const uniqueEnvironments = useMemo(
    () => Array.from(new Set(vms.map((vm) => vm.environment).filter(Boolean))).sort(),
    [vms]
  )

  const uniquePowerStates = useMemo(
    () => Array.from(new Set(vms.map((vm) => vm.power_state).filter(Boolean))).sort(),
    [vms]
  )

  const uniqueGuestOS = useMemo(
    () => Array.from(new Set(vms.map((vm) => vm.guest_os).filter(Boolean))).sort(),
    [vms]
  )

  const uniqueHosts = useMemo(
    () => Array.from(new Set(vms.map((vm) => vm.host).filter(Boolean))).sort(),
    [vms]
  )

  const uniqueClusters = useMemo(
    () => Array.from(new Set(vms.map((vm) => vm.cluster).filter(Boolean))).sort(),
    [vms]
  )

  const uniqueVlans = useMemo(() => {
    const vlanSet = new Set()
    vms.forEach((vm) => {
      if (Array.isArray(vm.vlans)) {
        vm.vlans.forEach((vlan) => {
          if (vlan != null && vlan !== '') {
            vlanSet.add(String(vlan))
          }
        })
      }
    })
    return Array.from(vlanSet).sort((a, b) => a.localeCompare(b))
  }, [vms])

  const processed = useMemo(() => {
    let arr = [...vms]
    const term = debouncedSearch.trim().toLowerCase()

    if (term) {
      arr = arr.filter((vm) =>
        [
          vm.name,
          vm.guest_os,
          vm.host,
          vm.cluster,
          vm.environment,
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term))
      )
    }

    if (filter.name) {
      const nameTerm = filter.name.toLowerCase()
      arr = arr.filter((vm) => vm.name?.toLowerCase().includes(nameTerm))
    }
    if (filter.environment) {
      const envTerm = String(filter.environment).toLowerCase()
      arr = arr.filter((vm) => String(vm.environment || '').toLowerCase() === envTerm)
    }
    if (filter.power_state) {
      arr = arr.filter((vm) => vm.power_state === filter.power_state)
    }
    if (filter.guest_os) {
      const osTerm = String(filter.guest_os).toLowerCase()
      arr = arr.filter((vm) => String(vm.guest_os || '').toLowerCase().includes(osTerm))
    }
    if (filter.host) {
      arr = arr.filter((vm) => vm.host === filter.host)
    }
    if (filter.cluster) {
      arr = arr.filter((vm) => vm.cluster === filter.cluster)
    }
    if (filter.vlan) {
      const wanted = String(filter.vlan)
      arr = arr.filter((vm) => vm.vlans?.some((vlan) => String(vlan) === wanted))
    }

    arr.sort((a, b) => {
      const { key, asc } = sortBy
      const va = a[key]
      const vb = b[key]
      if (va == null || vb == null) return 0
      if (va < vb) return asc ? -1 : 1
      if (va > vb) return asc ? 1 : -1
      return 0
    })

    return arr
  }, [vms, debouncedSearch, filter, sortBy])

  const groups = useMemo(() => {
    const grouper = {
      none: () => '',
      estado: (vm) => vm.power_state || 'Sin estado',
      ambiente: (vm) => vm.environment || 'Sin ambiente',
      host: (vm) => vm.host || 'Sin Host',
      vlan: (vm) => (vm.vlans?.length ? vm.vlans.join(', ') : 'Sin VLAN'),
      cluster: (vm) => vm.cluster || 'Sin Cluster',
      SO: (vm) => vm.guest_os || 'Sin SO',
    }[groupByOption] ?? (() => '')

    return processed.reduce((acc, vm) => {
      const key = grouper(vm) || ''
      if (!acc[key]) acc[key] = []
      const row = {
        ...vm,
        __original: vm.__raw || vm,
      }
      acc[key].push(row)
      return acc
    }, {})
  }, [processed, groupByOption])

  console.log('[render state] vms.length =', vms.length, 'processed.length =', processed.length, 'group keys =', Object.keys(groups))

  const toggleGroup = useCallback((groupName) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }))
  }, [])

  const hasFilters = useMemo(
    () =>
      Boolean(
        debouncedSearch.trim() ||
          filter.environment ||
          filter.power_state ||
          filter.guest_os ||
          filter.host ||
          filter.cluster ||
          filter.vlan ||
          filter.name
      ),
    [
      debouncedSearch,
      filter.environment,
      filter.power_state,
      filter.guest_os,
      filter.host,
      filter.cluster,
      filter.vlan,
      filter.name,
    ]
  )

  const clearFilters = useCallback(() => {
    setFilter(DEFAULT_FILTERS)
    setGlobalSearch('')
  }, [])

  const onHeaderClick = useCallback((key) => {
    setSortBy((prev) =>
      prev.key === key ? { key, asc: !prev.asc } : { key, asc: true }
    )
  }, [])

  const actions = {
    fetchVm,
    setFilter,
    setGroupByOption,
    setGlobalSearch,
    setSelectedVm,
    setSelectedRecord,
    setSortBy,
    toggleGroup,
    clearFilters,
    onHeaderClick,
    handlePowerChange,
  }

  const state = {
    vms,
    loading,
    error,
    filter,
    sortBy,
    groupByOption,
    globalSearch,
    selectedVm,
    selectedRecord,
    collapsedGroups,
    resumen,
    uniqueEnvironments,
    uniquePowerStates,
    uniqueGuestOS,
    uniqueHosts,
    uniqueClusters,
    uniqueVlans,
    processed,
    groups,
    hasFilters,
    refreshing,
    lastFetchTs,
  }

  return { state, actions }
}

export const inventoryDefaults = {
  DEFAULT_FILTERS,
  GROUPERS,
}












