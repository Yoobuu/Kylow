# Inventory Architecture Overview

1. **App.jsx → Rutas**
   - `/vmware` → `VMTable.jsx`
   - `/hyperv` → `HyperVPage.jsx`
2. **Tablas**
   - `VMTable.jsx` (VMware)
     - Usa `useInventoryState` (fetch normalizado, filtros, KPIs)
     - Inyecta `columnsVMware` para render
   - `HyperVPage.jsx`
     - Configura `fetcher` / `summaryBuilder` y delega a `HyperVTable`
     - `HyperVTable.jsx` reutiliza `useInventoryState`, UI de filtros y `columnsHyperV`
3. **Columnas**
   - `inventoryColumns.jsx` define `columnsVMware` y `columnsHyperV` (subset común)
4. **Normalización**
   - `lib/normalize.js` expone `normalizeVMware` y `normalizeHyperV`
   - Ambos producen el mismo “shape” para las tablas y export CSV.

## Normalized VM Contract
Cada registro expuesto por los hooks/tableas incluye:
```
{
  id, name, provider,
  environment, power_state,
  host, cluster,
  cpu_count, cpu_usage_pct,
  memory_size_MiB, ram_demand_mib, ram_usage_pct,
  guest_os,
  vlans (string[]), networks (string[]),
  ip_addresses (string[]),
  compatibility_code, compatibility_human, compat_generation,
  disks (array of { allocatedGiB, sizeGiB, allocatedPct, toString() }),
  nics (string[]),
  raw (opcional, solo para depuración interna)
}
```

## Axios Client & Auth
`frontend/src/api/axios.js` crea la instancia `api`:
- Inserta JWT desde `localStorage.token` en cada petición.
- Decodifica expiración (`jwt-decode`) y fuerza logout si caducó.
- Interceptor de respuesta: en `401` elimina token y redirige a `/login`.

## Data Decisions
- VLANs e IPs se normalizan como `string[]`, deduplicadas con `Set`, orden ascendente.
- Discos se transforman a objetos numéricos; se mantiene `toString()` para renders heredados.
- Export CSV (`lib/exportCsv.js`) siempre usa el shape normalizado y respeta filtros activos.

## Misc
- `Plantilla.jsx` funciona como alias temporal hacia `HyperVPage.jsx` para mantener compatibilidad con enlaces previos.
