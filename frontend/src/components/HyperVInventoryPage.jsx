import { useSearchParams } from "react-router-dom";
import HyperVPage from "./HyperVPage";
import HyperVHostsPage from "./HyperVHostsPage";

export default function HyperVInventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = (searchParams.get("view") || "vms").toLowerCase();
  const view = viewParam === "hosts" ? "hosts" : "vms";
  const groupParam = (searchParams.get("group") || "cumbaya").toLowerCase();
  const group = groupParam === "otros" ? "otros" : "cumbaya";

  const handleSwitch = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set("view", next);
    setSearchParams(params, { replace: true });
  };

  const handleGroupSwitch = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set("group", next);
    setSearchParams(params, { replace: true });
  };

  const toggleClass = (active) =>
    active
      ? "bg-neutral-900 text-white shadow"
      : "text-neutral-700 hover:text-neutral-900";

  return (
    <div className="relative min-h-screen w-full bg-white m-0 p-0">
      <div className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Grupo
            </span>
            <div className="rounded-full border border-neutral-200 bg-white p-1 text-sm shadow-sm">
              <button
                type="button"
                onClick={() => handleGroupSwitch("cumbaya")}
                className={`rounded-full px-4 py-1.5 font-semibold ${toggleClass(group === "cumbaya")}`}
              >
                Hyperv cumbaya
              </button>
              <button
                type="button"
                onClick={() => handleGroupSwitch("otros")}
                className={`rounded-full px-4 py-1.5 font-semibold ${toggleClass(group === "otros")}`}
              >
                Hyperv otros
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Vista
            </span>
            <div className="rounded-full border border-neutral-200 bg-white p-1 text-sm shadow-sm">
              <button
                type="button"
                onClick={() => handleSwitch("vms")}
                className={`rounded-full px-4 py-1.5 font-semibold ${toggleClass(view === "vms")}`}
              >
                VMs
              </button>
              <button
                type="button"
                onClick={() => handleSwitch("hosts")}
                className={`rounded-full px-4 py-1.5 font-semibold ${toggleClass(view === "hosts")}`}
              >
                Hosts
              </button>
            </div>
          </div>
        </div>
      </div>
      {view === "hosts" ? (
        <div key={`hosts-${group}`} className="-mx-4 -my-6 sm:-mx-6">
          <HyperVHostsPage group={group} />
        </div>
      ) : (
        <HyperVPage key={`vms-${group}`} group={group} />
      )}
    </div>
  );
}
