export const tours = {
  choose: [
    {
      target: "choose-title",
      title: "Selecciona un inventario",
      body: "Aquí eliges el proveedor que quieres explorar (VMware, Hyper-V, KVM, CEDIA o Azure).",
      placement: "bottom",
    },
    {
      target: "choose-grid",
      title: "Tarjetas de inventario",
      body: "Cada tarjeta representa un entorno. Entra a VMs o Hosts según tu necesidad.",
      placement: "top",
    },
    {
      target: "choose-actions-esxi",
      title: "Acciones rápidas",
      body: "Estos botones te llevan directo a VMs u Hosts del proveedor seleccionado.",
      placement: "top",
    },
  ],
  vmware_vms: [
    {
      target: "vm-table-actions",
      title: "Actualización y exportación",
      body: "Refresca el inventario y exporta CSV desde aquí.",
      placement: "left",
    },
    {
      target: "vm-filters",
      title: "Filtros y agrupación",
      body: "Filtra por estado, SO, host o cluster y agrupa por criterios comunes.",
      placement: "top",
    },
    {
      target: "vm-table-list",
      title: "Listado de VMs",
      body: "Haz click en una VM para abrir el detalle y métricas.",
      placement: "top",
    },
  ],
  vmware_hosts: [
    {
      target: "host-kpis",
      title: "KPIs de hosts",
      body: "Indicadores rápidos de capacidad, estado y conteos.",
      placement: "bottom",
    },
    {
      target: "host-filters",
      title: "Filtros de hosts",
      body: "Filtra por cluster, conexión, versión y estado.",
      placement: "top",
    },
    {
      target: "host-table-list",
      title: "Listado de hosts",
      body: "Haz click para ver detalles y vista avanzada.",
      placement: "top",
    },
  ],
  kvm_vms: [
    {
      target: "vm-table-actions",
      title: "Actualización",
      body: "Refresca el inventario oVirt/KVM desde aquí.",
      placement: "left",
    },
    {
      target: "vm-filters",
      title: "Filtros",
      body: "Filtra por estado, SO o cluster.",
      placement: "top",
    },
    {
      target: "vm-table-list",
      title: "Listado de VMs",
      body: "Haz click en una VM para ver el detalle.",
      placement: "top",
    },
  ],
  kvm_hosts: [
    {
      target: "host-kpis",
      title: "KPIs de hosts",
      body: "Visión rápida de salud y capacidad.",
      placement: "bottom",
    },
    {
      target: "host-filters",
      title: "Filtros de hosts",
      body: "Filtra por cluster o estado.",
      placement: "top",
    },
    {
      target: "host-table-list",
      title: "Listado de hosts",
      body: "Haz click para abrir el detalle.",
      placement: "top",
    },
  ],
  hyperv_vms: [
    {
      target: "hyperv-root",
      title: "Inventario Hyper-V",
      body: "Aquí ves el estado de VMs en Hyper-V.",
      placement: "top",
    },
  ],
  hyperv_hosts: [
    {
      target: "hyperv-hosts-root",
      title: "Hosts Hyper-V",
      body: "Vista de hosts y su estado operativo.",
      placement: "top",
    },
  ],
  cedia: [
    {
      target: "cedia-root",
      title: "Inventario CEDIA",
      body: "Explora VMs en CEDIA con métricas básicas.",
      placement: "top",
    },
  ],
  notifications: [
    {
      target: "notifications-filters",
      title: "Filtros de alertas",
      body: "Filtra por proveedor, estado y fecha.",
      placement: "bottom",
    },
    {
      target: "notifications-table",
      title: "Listado de alertas",
      body: "Revisa y reconoce alertas desde aquí.",
      placement: "top",
    },
  ],
  audit: [
    {
      target: "audit-filters",
      title: "Filtros de auditoría",
      body: "Busca por acción, actor o tipo de objetivo.",
      placement: "bottom",
    },
    {
      target: "audit-table",
      title: "Eventos auditados",
      body: "Abre un evento para ver el detalle completo.",
      placement: "top",
    },
  ],
  users: [
    {
      target: "users-header",
      title: "Administración de usuarios",
      body: "Gestiona cuentas, permisos y contraseñas.",
      placement: "bottom",
    },
    {
      target: "users-kpis",
      title: "KPIs de usuarios",
      body: "Resumen de usuarios y acceso total.",
      placement: "bottom",
    },
    {
      target: "users-table",
      title: "Listado",
      body: "Edita permisos, resetea contraseñas o elimina usuarios.",
      placement: "top",
    },
  ],
  system: [
    {
      target: "system-header",
      title: "Configuración del sistema",
      body: "Activa proveedores y ajusta intervalos.",
      placement: "bottom",
    },
    {
      target: "system-settings",
      title: "Parámetros",
      body: "Cambia toggles e intervalos y guarda cambios.",
      placement: "top",
    },
  ],
};

export const getTourKeyForLocation = (pathname, search = "") => {
  const params = new URLSearchParams(search);
  if (pathname === "/choose") return "choose";
  if (pathname === "/vmware") {
    return params.get("view") === "hosts" ? "vmware_hosts" : "vmware_vms";
  }
  if (pathname === "/kvm") {
    return params.get("view") === "hosts" ? "kvm_hosts" : "kvm_vms";
  }
  if (pathname === "/hyperv") {
    return params.get("view") === "hosts" ? "hyperv_hosts" : "hyperv_vms";
  }
  if (pathname === "/cedia") return "cedia";
  if (pathname === "/notifications") return "notifications";
  if (pathname === "/audit") return "audit";
  if (pathname === "/users") return "users";
  if (pathname === "/system") return "system";
  return null;
};
