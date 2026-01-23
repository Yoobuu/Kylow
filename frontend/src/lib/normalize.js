const mapEnvironment = (value) => {
  const upper = (value || '').toString().toUpperCase()
  if (upper.startsWith('P')) return 'producciA3n'
  if (upper.startsWith('T')) return 'test'
  if (upper.startsWith('S')) return 'sandbox'
  if (upper.startsWith('D')) return 'desarrollo'
  return value ? value.toLowerCase() : 'desconocido'
}

const toNumber = (value) => {
  if (value == null || value === '') return null
  let candidate = value
  if (typeof candidate === 'string') {
    candidate = candidate.trim().replace(/,/g, '.').replace(/[^0-9.-]+/g, '')
    if (candidate === '' || candidate === '-' || candidate === '.') return null
  }
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

const dedupeSortStrings = (input) => {
  if (!Array.isArray(input)) return []
  const normalized = input
    .map((value) => {
      if (value == null) return null
      if (typeof value === 'string') return value.trim()
      return String(value)
    })
    .filter((value) => value != null && value !== '')
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b))
}

const normalizeDiskEntry = (disk) => {
  if (disk == null) return null
  if (typeof disk === 'string') {
    const match = /([\d.,]+)\s*GiB\s*\/\s*([\d.,]+)\s*GiB\s*\(([\d.,]+)%\)/i.exec(disk)
    if (match) {
      const [, allocatedStr, sizeStr, pctStr] = match
      disk = {
        AllocatedGiB: allocatedStr.replace(',', '.'),
        SizeGiB: sizeStr.replace(',', '.'),
        AllocatedPct: pctStr.replace(',', '.'),
      }
    } else {
      const numeric = toNumber(disk)
      if (numeric == null) return null
      disk = { AllocatedGiB: numeric }
    }
  }
  const allocatedGiB = toNumber(
    disk.AllocatedGiB ??
      disk.allocated ??
      disk.Allocated ??
      disk.UsedGiB ??
      disk.used ??
      disk.allocatedGiB
  )
  const sizeGiB = toNumber(
    disk.SizeGiB ??
      disk.size ??
      disk.CapacityGiB ??
      disk.capacity ??
      disk.sizeGiB
  )
  const allocatedPct = toNumber(
    disk.AllocatedPct ??
      disk.pct ??
      disk.UsagePct ??
      disk.usagePct ??
      disk.allocatedPct ??
      (sizeGiB && allocatedGiB != null && sizeGiB > 0
        ? (allocatedGiB / sizeGiB) * 100
        : null)
  )

  if (
    allocatedGiB == null &&
    sizeGiB == null &&
    allocatedPct == null
  ) {
    return null
  }

  return {
    allocatedGiB: allocatedGiB ?? null,
    sizeGiB: sizeGiB ?? null,
    allocatedPct:
      allocatedPct != null ? Math.round(allocatedPct * 100) / 100 : null,
    toString() {
      const allocText =
        this.allocatedGiB != null ? `${this.allocatedGiB} GiB` : '-'
      const sizeText = this.sizeGiB != null ? `${this.sizeGiB} GiB` : '-'
      const pctText =
        this.allocatedPct != null ? `${this.allocatedPct}%` : '-'
      return `${allocText} / ${sizeText} (${pctText})`
    },
  }
}

const DEBUG_HYPERV_DISKS = false
let loggedHyperVDisks = false

function normalizeHyperV(vm) {
  const rawState = vm.Estado ?? vm.State ?? vm.state
  const powerState = rawState === 'Running'
    ? 'POWERED_ON'
    : rawState === 'Off'
      ? 'POWERED_OFF'
      : rawState?.toString().toUpperCase() || null

  const name = vm.Nombre ?? vm.Name ?? vm.VMName ?? vm.id ?? '<Sin nombre>'
  const host = vm.HVHost ?? vm.host ?? null
  const identifier = vm.VMId ?? vm.Id ?? vm.id ?? `${name}::${host || ''}`

  const inferClusterFromHost = (value) => {
    if (typeof value !== 'string' || !value.length) return null
    const first = value.trim().charAt(0).toUpperCase()
    if (first === 'S') return 'sandbox'
    if (first === 'T') return 'test'
    if (first === 'P') return 'produccion'
    return null
  }

  const clusterExplicit =
    vm.Cluster ??
    vm.cluster ??
    vm.ClusterName ??
    null

  const clusterDerived = inferClusterFromHost(host)

  const disksArray = Array.isArray(vm.Discos)
    ? vm.Discos
    : Array.isArray(vm.Disks)
      ? vm.Disks
      : []

  const vlans = dedupeSortStrings(
    Array.isArray(vm.VLANs)
      ? vm.VLANs
      : Array.isArray(vm.VLAN_IDs)
        ? vm.VLAN_IDs
        : []
  )

  const ipList = dedupeSortStrings(
    Array.isArray(vm.IPs)
      ? vm.IPs
      : Array.isArray(vm.IPv4)
        ? vm.IPv4
        : []
  )

  const networks = Array.isArray(vm.Networks)
    ? vm.Networks
    : []

  const formatDiskEntry = (entry) => {
    if (!entry) return null

    const resolveValue = (...candidates) => {
      for (const value of candidates) {
        if (value === undefined || value === null || value === '') continue
        return value
      }
      return undefined
    }

    const alloc = resolveValue(
      entry.AllocatedGiB,
      entry.allocatedGiB,
      entry.AllocatedGB,
      entry.allocatedGB,
      entry.AllocatedMiB,
      entry.allocatedMiB,
      entry.Allocated,
      entry.allocated
    )

    const size = resolveValue(
      entry.SizeGiB,
      entry.sizeGiB,
      entry.SizeGB,
      entry.sizeGB,
      entry.SizeMiB,
      entry.sizeMiB,
      entry.Size,
      entry.size
    )

    const pct = resolveValue(
      entry.AllocatedPct,
      entry.allocatedPct,
      entry.Percent,
      entry.percent,
      entry.pct
    )
    const allocNumber = toNumber(alloc)
    const sizeNumber = toNumber(size)
    let pctNumber = toNumber(pct)
    if (pctNumber == null && allocNumber != null && sizeNumber != null && sizeNumber > 0) {
      pctNumber = Math.round((allocNumber / sizeNumber) * 100 * 100) / 100
    }

    if (allocNumber != null && sizeNumber != null) {
      const pctText = pctNumber != null ? ` (${pctNumber}%)` : ''
      return `${allocNumber} GiB / ${sizeNumber} GiB${pctText}`
    }
    if (allocNumber != null) {
      return `Usado: ${allocNumber} GiB`
    }
    if (sizeNumber != null) {
      return `Tamano: ${sizeNumber} GiB`
    }
    return null
  }

  const disks = disksArray
    .map((disk) => normalizeDiskEntry(disk))
    .map((disk) => {
      if (!disk) return null
      const text = formatDiskEntry(disk)
      if (!text) return null
      const pct = disk.allocatedPct ?? disk.AllocatedPct ?? null
      const allocatedGiB = disk.allocatedGiB ?? disk.AllocatedGiB ?? null
      const sizeGiB = disk.sizeGiB ?? disk.SizeGiB ?? null
      if (DEBUG_HYPERV_DISKS && !loggedHyperVDisks && disksArray.length > 0) {
        loggedHyperVDisks = true
        console.log('sample hyperv vm disks', {
          raw: disksArray,
          normalized: { text, pct, allocatedGiB, sizeGiB },
        })
      }
      return {
        text,
        pct: pct != null && Number.isFinite(Number(pct)) ? Number(pct) : null,
        allocatedGiB,
        sizeGiB,
      }
    })
    .filter((disk) => disk && disk.text)

  const isPoweredOn = powerState === 'POWERED_ON'
  const cpuUsageRaw = toNumber(vm.CPU_UsagePct)
  const cpuUsagePct = isPoweredOn ? cpuUsageRaw : (cpuUsageRaw && cpuUsageRaw > 0 ? cpuUsageRaw : null)
  const ramDemandRaw = toNumber(vm.RAM_Demand_MiB)
  const ramUsageRaw = toNumber(vm.RAM_UsagePct)
  const ramDemandMib = isPoweredOn ? ramDemandRaw : null
  const ramUsagePct = isPoweredOn ? ramUsageRaw : (ramUsageRaw && ramUsageRaw > 0 ? ramUsageRaw : null)
  const generation = toNumber(vm.CompatHW?.Generation)
  const bootType = generation === 2 ? 'UEFI' : generation === 1 ? 'BIOS' : null

  return {
    id: identifier,
    name,
    power_state: powerState,
    cpu_count: toNumber(vm.CPU ?? vm.vCPU),
    cpu_usage_pct: cpuUsagePct,
    memory_size_MiB: toNumber(vm.RAM_MiB),
    ram_demand_mib: ramDemandMib,
    ram_usage_pct: ramUsagePct,
    environment: mapEnvironment(vm.Ambiente),
    guest_os: vm.SO ?? vm.OS ?? null,
    host,
    cluster: clusterExplicit ?? clusterDerived ?? null,
    vlans,
    networks,
    compatibility_code: vm.CompatHW?.Version ?? null,
    compatibility_human: vm.CompatHW?.Version ? `VersiA3n ${vm.CompatHW.Version}` : null,
    compat_generation: generation,
    boot_type: bootType,
    ip_addresses: ipList,
    disks,
    nics: Array.isArray(vm.NICs) ? vm.NICs.map((nic) => (nic == null ? '' : String(nic))) : [],
    provider: 'hyperv',
  }
}

function normalizeVMware(vm) {
  const vlans = dedupeSortStrings(vm.vlans ?? [])
  const networks = Array.isArray(vm.networks) ? vm.networks : []
  const ipAddresses = dedupeSortStrings(vm.ip_addresses ?? [])
  const publicIps = dedupeSortStrings(vm.public_ips ?? [])
  const publicDns = dedupeSortStrings(vm.public_dns ?? [])
  const zones = Array.isArray(vm.zones) ? vm.zones.map((z) => String(z)) : []

  const formatDiskEntry = (entry) => {
    if (!entry) return null

    const resolveValue = (...candidates) => {
      for (const value of candidates) {
        if (value === undefined || value === null || value === '') continue
        return value
      }
      return undefined
    }

    const alloc = resolveValue(
      entry.AllocatedGiB,
      entry.allocatedGiB,
      entry.AllocatedGB,
      entry.allocatedGB,
      entry.AllocatedMiB,
      entry.allocatedMiB,
      entry.Allocated,
      entry.allocated
    )

    const size = resolveValue(
      entry.SizeGiB,
      entry.sizeGiB,
      entry.SizeGB,
      entry.sizeGB,
      entry.SizeMiB,
      entry.sizeMiB,
      entry.Size,
      entry.size
    )

    const pct = resolveValue(
      entry.AllocatedPct,
      entry.allocatedPct,
      entry.Percent,
      entry.percent,
      entry.pct
    )

    const parts = []
    if (alloc !== undefined) parts.push(`${alloc} GiB`)
    if (size !== undefined) parts.push(`${size} GiB`)
    if (pct !== undefined) parts.push(`(${pct}%)`)

    if (!parts.length) return null

    if (parts.length === 3) {
      return `${parts[0]} / ${parts[1]} ${parts[2]}`
    }

    return parts.join(' / ')
  }

  const disks = Array.isArray(vm.disks)
    ? vm.disks
        .map((disk) => {
          if (typeof disk === 'string') {
            const match = /([\d.,]+)\s*GiB\s*\/\s*([\d.,]+)\s*GiB\s*\(([\d.,]+)%\)/i.exec(disk)
            if (match) {
              const [ , allocatedStr, sizeStr, pctStr ] = match
              return {
                AllocatedGiB: allocatedStr.replace(',', '.'),
                SizeGiB: sizeStr.replace(',', '.'),
                AllocatedPct: pctStr.replace(',', '.'),
              }
            }
            const simple = /([\d.,]+)\s*(Gi?B|GB)/i.exec(disk)
            if (simple) {
              const [, sizeStr] = simple
              return {
                SizeGiB: sizeStr.replace(',', '.'),
              }
            }
            return null
          }
          return disk
        })
        .map((disk) => normalizeDiskEntry(disk))
        .map((disk) => {
          if (!disk) return null
          const text = formatDiskEntry(disk)
          if (!text) return null
          const pct = disk.allocatedPct ?? disk.AllocatedPct ?? null
          return {
            text,
            pct: pct != null && Number.isFinite(Number(pct)) ? Number(pct) : null,
            allocatedGiB: disk.allocatedGiB ?? null,
            sizeGiB: disk.sizeGiB ?? null,
          }
        })
        .filter((entry) => entry && entry.text)
    : []

  return {
    id: vm.id,
    name: vm.name,
    power_state: vm.power_state,
    cpu_count: vm.cpu_count,
    cpu_usage_pct: vm.cpu_usage_pct ?? null,
    memory_size_MiB: vm.memory_size_MiB,
    ram_demand_mib: vm.ram_demand_mib ?? null,
    ram_usage_pct: vm.ram_usage_pct ?? null,
    environment: vm.environment,
    guest_os: vm.guest_os,
    host: vm.host,
    cluster: vm.cluster,
    vlans,
    networks,
    compatibility_code: vm.compatibility_code ?? null,
    compatibility_human: vm.compatibility_human,
    compat_generation: vm.compat_generation ?? vm.boot_type ?? null,
    boot_type: vm.boot_type ?? null,
    ip_addresses: ipAddresses,
    disks,
    nics: Array.isArray(vm.nics) ? vm.nics.map((nic) => (nic == null ? '' : String(nic))) : [],
    provider: vm.provider ?? 'vmware',
  }
}

const _normalizeAzureTags = (tags) => {
  if (!tags || typeof tags !== 'object') return {}
  const out = {}
  Object.entries(tags).forEach(([key, value]) => {
    if (typeof key === 'string') {
      out[key.trim().toLowerCase()] = value
    }
  })
  return out
}

function normalizeAzure(vm) {
  const tags = _normalizeAzureTags(vm.tags)
  const envRaw =
    tags.environment ??
    tags.env ??
    tags.ambiente ??
    tags.stage ??
    tags.tier ??
    vm.environment
  const environment = mapEnvironment(envRaw)
  const powerState = vm.power_state ?? vm.powerState ?? null

  const nicIds = Array.isArray(vm.nic_ids)
    ? vm.nic_ids.map((nic) => (nic == null ? '' : String(nic))).filter(Boolean)
    : []
  const ipAddresses = dedupeSortStrings(vm.ip_addresses ?? [])
  const publicIps = dedupeSortStrings(vm.public_ips ?? [])
  const publicDns = dedupeSortStrings(vm.public_dns ?? [])
  const zones = Array.isArray(vm.zones)
    ? vm.zones.map((zone) => (zone == null ? '' : String(zone))).filter(Boolean)
    : []

  return {
    id: vm.id,
    name: vm.name,
    power_state: powerState,
    cpu_count: vm.cpu_count ?? vm.cpuCount ?? null,
    cpu_usage_pct: vm.cpu_usage_pct ?? vm.cpuUsagePct ?? null,
    memory_size_MiB: vm.memory_size_MiB ?? vm.memory_size_mib ?? vm.memorySizeMiB ?? null,
    ram_demand_mib: vm.ram_demand_mib ?? vm.ramDemandMiB ?? null,
    ram_usage_pct: vm.ram_usage_pct ?? vm.ramUsagePct ?? null,
    environment,
    guest_os: vm.os_type ?? vm.guest_os ?? null,
    host: vm.resource_group ?? vm.host ?? null,
    cluster: vm.location ?? vm.cluster ?? null,
    vlans: [],
    networks: Array.isArray(vm.networks) ? vm.networks : [],
    compatibility_code: null,
    compatibility_human: null,
    compat_generation: null,
    boot_type: null,
    ip_addresses: ipAddresses,
    disks: Array.isArray(vm.disks) ? vm.disks : [],
    nics: Array.isArray(vm.nics) && vm.nics.length ? vm.nics : nicIds,
    public_ips: publicIps,
    public_dns: publicDns,
    zones,
    vm_size: vm.vm_size ?? vm.vmSize ?? null,
    os_type: vm.os_type ?? null,
    provisioning_state: vm.provisioning_state ?? vm.provisioningState ?? null,
    time_created: vm.time_created ?? vm.timeCreated ?? null,
    resource_group: vm.resource_group ?? null,
    location: vm.location ?? null,
    tags: vm.tags ?? null,
    vm_agent_status: vm.vm_agent_status ?? vm.vmAgentStatus ?? null,
    vm_agent_version: vm.vm_agent_version ?? vm.vmAgentVersion ?? null,
    provider: 'azure',
  }
}

export { normalizeHyperV, normalizeVMware, normalizeAzure }
