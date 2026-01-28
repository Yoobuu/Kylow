import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import VMTable from "./VMTable";
import HostTable from "./HostTable";
import {
  getOvirtSnapshot,
  getOvirtJob,
  postOvirtRefresh,
  getOvirtVmDetail,
  getOvirtVmPerf,
} from "../api/ovirt";
import {
  getOvirtHostsSnapshot,
  getOvirtHostsJob,
  postOvirtHostsRefresh,
  getOvirtHostDetail,
  getOvirtHostDeep,
} from "../api/ovirtHosts";
import { normalizeVMware } from "../lib/normalize";
import { exportInventoryXlsx } from "../lib/exportXlsx";

const normalizeOvirt = (vm) => ({ ...normalizeVMware(vm), provider: "ovirt" });
export default function KVMPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = (searchParams.get("view") || "vms").toLowerCase();
  const view = viewParam === "hosts" ? "hosts" : "vms";

  const handleSwitch = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set("view", next);
    setSearchParams(params, { replace: true });
  };

  const toggleClass = (active) =>
    active
      ? "bg-neutral-900 text-white shadow"
      : "text-neutral-700 hover:text-neutral-900";

  const vmTableProps = useMemo(
    () => ({
      providerKey: "ovirt",
      cacheKey: "ovirt",
      providerLabel: "KVM",
      pageTitle: "Inventario de VMs KVM",
      snapshotFetcher: getOvirtSnapshot,
      refreshFn: postOvirtRefresh,
      jobFetcher: getOvirtJob,
      snapshotDataKey: "ovirt",
      normalizeRecord: normalizeOvirt,
      exportFilenameBase: "kvm_inventory",
      exportFn: exportInventoryXlsx,
      exportLabel: "Exportar XLSX",
      vmDetailFetcher: getOvirtVmDetail,
      vmPerfFetcher: getOvirtVmPerf,
      powerActionsEnabled: false,
    }),
    []
  );

  const hostTableProps = useMemo(
    () => ({
      providerKey: "ovirt",
      cacheKey: "ovirt-hosts",
      providerLabel: "KVM",
      pageTitle: "Hosts KVM",
      pageSubtitle: "Inventario en vivo por cluster y estado.",
      snapshotFetcher: getOvirtHostsSnapshot,
      refreshFn: postOvirtHostsRefresh,
      jobFetcher: getOvirtHostsJob,
      snapshotDataKey: "ovirt",
      getHostDetail: getOvirtHostDetail,
      getHostDeep: getOvirtHostDeep,
    }),
    []
  );

  return (
    <div className="relative min-h-screen w-full bg-black m-0 p-0">
      <div className="fixed right-6 top-20 z-40 rounded-full border border-neutral-200 bg-white/90 p-1 text-xs shadow backdrop-blur">
        <button
          type="button"
          onClick={() => handleSwitch("vms")}
          className={`rounded-full px-3 py-1 font-semibold ${toggleClass(view === "vms")}`}
        >
          VMs
        </button>
        <button
          type="button"
          onClick={() => handleSwitch("hosts")}
          className={`rounded-full px-3 py-1 font-semibold ${toggleClass(view === "hosts")}`}
        >
          Hosts
        </button>
      </div>
      {view === "hosts" ? (
        <HostTable key="hosts" {...hostTableProps} />
      ) : (
        <VMTable key="vms" {...vmTableProps} />
      )}
    </div>
  );
}
