import { useSearchParams } from "react-router-dom";
import VMTable from "./VMTable";
import HostTable from "./HostTable";
import { exportInventoryXlsx } from "../lib/exportXlsx";

export default function VMwarePage() {
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
        <div key="hosts" className="-mx-4 -my-6 sm:-mx-6">
          <HostTable />
        </div>
      ) : (
        <VMTable
          key="vms"
          exportFn={exportInventoryXlsx}
          exportLabel="Exportar XLSX"
        />
      )}
    </div>
  );
}
