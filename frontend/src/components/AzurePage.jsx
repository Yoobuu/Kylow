import VMTable from "./VMTable";
import { getAzureSnapshot, getAzureJob, postAzureRefresh } from "../api/azure";
import { columnsAzure } from "./inventoryColumns.jsx";
import { normalizeAzure } from "../lib/normalize";
import * as inventoryCache from "../lib/inventoryCache";

const CACHE_KEY = "azure:vms";

const getCachedDetail = (vmId) => {
  const entry = inventoryCache.get(CACHE_KEY);
  const list = Array.isArray(entry?.data) ? entry.data : [];
  if (!list.length) {
    return { id: vmId };
  }
  return list.find((vm) => vm.id === vmId || vm.name === vmId) || { id: vmId };
};

const emptyPerf = () => ({ });

export default function AzurePage() {
  return (
    <div className="relative min-h-screen w-full bg-black m-0 p-0">
      <VMTable
        providerKey="azure"
        cacheKey="azure"
        providerLabel="Azure"
        snapshotFetcher={getAzureSnapshot}
        refreshFn={postAzureRefresh}
        jobFetcher={getAzureJob}
        snapshotDataKey="azure"
        columns={columnsAzure}
        normalizeRecord={normalizeAzure}
        exportFilenameBase="azure_inventory"
        pageTitle="Inventario Azure"
        vmDetailFetcher={(vmId) => getCachedDetail(vmId)}
        vmPerfFetcher={() => Promise.resolve(emptyPerf())}
        powerActionsEnabled={false}
        powerUnavailableMessage="Acciones de energía no disponibles para Azure."
      />
    </div>
  );
}
