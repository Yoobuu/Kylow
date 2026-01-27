import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaSearch } from "react-icons/fa";
import { createUser, deleteUser, listUsers, resetUserPassword } from "../api/users";
import { getUserPermissions, listPermissionCatalog, updateUserPermissions } from "../api/permissions";
import { useAuth } from "../context/AuthContext";

const PAGE_SIZE = 10;

const getInitials = (value) => {
  if (!value) return "U";
  const parts = value
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return value.slice(0, 2).toUpperCase();
  const first = parts[0][0] || "";
  const second = parts[1]?.[0] || "";
  return `${first}${second}`.toUpperCase();
};

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const tone =
    toast.type === "error"
      ? "border-[#F5B5B5] bg-[#FDE2E2] text-[#8B0000]"
      : "border-[#B7E0C1] bg-[#E6F4EA] text-[#1B5E20]";
  return (
    <div className={`fixed right-4 top-4 z-50 max-w-sm rounded-lg border px-4 py-3 shadow ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <span>{toast.message}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-semibold text-current opacity-70 transition hover:opacity-100"
          aria-label="Cerrar"
        >
          x
        </button>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose, size = "md" }) {
  const widthClass =
    size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-10">
      <div
        className={`w-full ${widthClass} rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-6 text-[#231F20] shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-[#E11B22]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6b6b6b] transition hover:text-[#E11B22]"
            aria-label="Cerrar"
          >
            x
          </button>
        </div>
        <div className="mt-4 max-h-[75vh] overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

export default function UserAdminPage() {
  const { hasPermission } = useAuth();
  const canManageUsers = hasPermission("users.manage");

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState({ type: null, user: null });
  const [createForm, setCreateForm] = useState({ username: "", password: "" });
  const [passwordForm, setPasswordForm] = useState({ password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [formError, setFormError] = useState("");
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [permissionsState, setPermissionsState] = useState({ loading: false, overridesDraft: {}, summary: null });
  const [permissionsError, setPermissionsError] = useState("");
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [fullAccessUsers, setFullAccessUsers] = useState(0);
  const [fullAccessMap, setFullAccessMap] = useState({});
  const toastTimerRef = useRef();

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const fetchUsers = useCallback(() => {
    if (!canManageUsers) {
      setUsers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    listUsers()
      .then((response) => {
        const payload = Array.isArray(response.data) ? response.data : [];
        setUsers(payload);
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || err?.message || "No se pudo cargar la lista de usuarios.";
        setError(detail);
      })
      .finally(() => setLoading(false));
  }, [canManageUsers]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => u.username.toLowerCase().includes(term));
  }, [users, search]);

  const permissionsByCategory = useMemo(() => {
    const grouped = {};
    (permissionCatalog || []).forEach((perm) => {
      const cat = perm.category || "otros";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(perm);
    });
    Object.values(grouped).forEach((arr) => arr.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    return grouped;
  }, [permissionCatalog]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, page]);

  const closeModal = () => {
    setModal({ type: null, user: null });
    setCreateForm({ username: "", password: "" });
    setPasswordForm({ password: "" });
    setSubmitting(false);
    setFormError("");
    setPermissionsState({ loading: false, overridesDraft: {}, summary: null });
    setPermissionsError("");
    setPermissionsSaving(false);
  };

  const allPermissionCodes = useMemo(
    () => new Set((permissionCatalog || []).map((p) => p.code)),
    [permissionCatalog],
  );

  const computeFullAccessUsers = useCallback(async () => {
    if (!permissionCatalog.length || !users.length) {
      setFullAccessMap({});
      return 0;
    }
    const allCodes = allPermissionCodes;
    const tasks = users.map((u) =>
      getUserPermissions(u.id)
        .then(({ data }) => {
          const effective = new Set(data?.effective || []);
          const hasAll = [...allCodes].every((code) => effective.has(code));
          return { id: u.id, hasAll };
        })
        .catch(() => ({ id: u.id, hasAll: false }))
    );
    const results = await Promise.all(tasks);
    const nextMap = {};
    let count = 0;
    results.forEach((entry) => {
      if (!entry) return;
      nextMap[entry.id] = entry.hasAll;
      if (entry.hasAll) count += 1;
    });
    setFullAccessMap(nextMap);
    return count;
  }, [allPermissionCodes, permissionCatalog.length, users]);

  const ensurePermissionData = useCallback(async () => {
    try {
      if (!permissionCatalog.length) {
        const { data } = await listPermissionCatalog();
        setPermissionCatalog(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudo cargar el catálogo de permisos.";
      setPermissionsError(detail);
      throw err;
    }
    try {
      const fullCount = await computeFullAccessUsers();
      setFullAccessUsers(fullCount);
    } catch {
      // no-op; el contador se actualizará en próximas acciones
    }
  }, [permissionCatalog.length, computeFullAccessUsers]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    ensurePermissionData().catch(() => null);
  }, [ensurePermissionData]);

  useEffect(() => {
    if (!users.length || !permissionCatalog.length) return;
    computeFullAccessUsers()
      .then((count) => setFullAccessUsers(count))
      .catch(() => null);
  }, [users, permissionCatalog.length, computeFullAccessUsers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const handleCreateSubmit = async (event) => {
    event.preventDefault();
    if (!createForm.username.trim() || !createForm.password.trim()) {
      setFormError("Debes ingresar un usuario y una contraseña válidos.");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      await createUser({
        username: createForm.username.trim(),
        password: createForm.password,
      });
      showToast("Usuario creado correctamente.");
      closeModal();
      fetchUsers();
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudo crear el usuario.";
      showToast(detail, "error");
      setSubmitting(false);
      setFormError(detail);
    }
  };

  const openPermissionsModal = async (user) => {
    if (!user?.id) return;
    setModal({ type: "permissions", user });
    setPermissionsState({ loading: true, overridesDraft: {}, summary: null });
    setPermissionsError("");
    try {
      await ensurePermissionData();
      const { data } = await getUserPermissions(user.id);
      const draft = {};
      if (Array.isArray(data?.overrides)) {
        data.overrides.forEach((item) => {
          if (!item?.code) return;
          draft[item.code] = item.granted ? "grant" : "deny";
        });
      }
      setPermissionsState({ loading: false, overridesDraft: draft, summary: data });
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudieron cargar los permisos del usuario.";
      setPermissionsError(detail);
      setPermissionsState((prev) => ({ ...prev, loading: false }));
    }
  };

  const updateOverrideChoice = (code, choice) => {
    setPermissionsState((prev) => {
      const nextOverrides = { ...(prev.overridesDraft || {}) };
      if (choice === "inherit") {
        delete nextOverrides[code];
      } else {
        nextOverrides[code] = choice;
      }
      return { ...prev, overridesDraft: nextOverrides };
    });
  };

  const handlePermissionsSubmit = async (event) => {
    event.preventDefault();
    if (!modal.user) return;
    setPermissionsSaving(true);
    setPermissionsError("");
    const overridesPayload = Object.entries(permissionsState.overridesDraft || {})
      .filter(([, mode]) => mode === "grant" || mode === "deny")
      .map(([code, mode]) => ({ code, granted: mode === "grant" }));

    const currentEffective = new Set(permissionsState.summary?.effective || []);
    const proposedEffective = new Set(
      overridesPayload.filter((item) => item.granted).map((item) => item.code)
    );
    const removingFullAccess =
      currentEffective.size === allPermissionCodes.size &&
      [...allPermissionCodes].every((code) => currentEffective.has(code)) &&
      ![...allPermissionCodes].every((code) => proposedEffective.has(code));

    if (removingFullAccess) {
      try {
        const othersFull = await computeFullAccessUsers();
        const othersExcludingCurrent = modal.user ? othersFull - 1 : othersFull;
        if (othersExcludingCurrent <= 0) {
          setPermissionsError("No puedes quitar permisos: este usuario es el único con acceso total.");
          setPermissionsSaving(false);
          return;
        }
      } catch {
        // si falla el conteo, seguimos y dejamos que el backend valide
      }
    }

    try {
      const { data } = await updateUserPermissions(modal.user.id, overridesPayload);
      const draft = {};
      if (Array.isArray(data?.overrides)) {
        data.overrides.forEach((item) => {
          if (!item?.code) return;
          draft[item.code] = item.granted ? "grant" : "deny";
        });
      }
      setPermissionsState({ loading: false, overridesDraft: draft, summary: data });
      showToast("Permisos actualizados.");
      fetchUsers();
      const fullCount = await computeFullAccessUsers();
      setFullAccessUsers(fullCount);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudieron actualizar los permisos.";
      setPermissionsError(detail);
    } finally {
      setPermissionsSaving(false);
    }
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    if (!modal.user) return;
    if (!passwordForm.password.trim()) {
      setFormError("La nueva contraseña es obligatoria.");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      await resetUserPassword(modal.user.id, passwordForm.password);
      showToast("Contraseña actualizada.");
      closeModal();
      fetchUsers();
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudo actualizar la contraseña.";
      showToast(detail, "error");
      setSubmitting(false);
      setFormError(detail);
    }
  };

  const handleDelete = async () => {
    if (!modal.user) return;
    setSubmitting(true);
    try {
      const { data } = await getUserPermissions(modal.user.id);
      const effective = new Set(data?.effective || []);
      const hasAll = allPermissionCodes.size > 0 && [...allPermissionCodes].every((code) => effective.has(code));
      if (hasAll) {
        const othersFull = await computeFullAccessUsers();
        const othersExcludingCurrent = othersFull - 1;
        if (othersExcludingCurrent <= 0) {
          showToast("No puedes eliminar al último usuario con todos los permisos.", "error");
          setSubmitting(false);
          return;
        }
      }
    } catch {
      // si falla la validación seguimos intentando borrar y delegamos en backend
    }

    try {
      await deleteUser(modal.user.id);
      showToast("Usuario eliminado.");
      closeModal();
      fetchUsers();
      const fullCount = await computeFullAccessUsers();
      setFullAccessUsers(fullCount);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "No se pudo eliminar el usuario.";
      showToast(detail, "error");
      setSubmitting(false);
    }
  };

  if (!canManageUsers) {
    return (
      <main className="min-h-screen w-full bg-white px-6 py-10 text-[#231F20]">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <h1 className="text-2xl font-semibold text-[#E11B22]">Administración de usuarios</h1>
        <p className="mt-4 text-sm text-[#3b3b3b]">
          Acceso denegado. Necesitas el permiso <strong>users.manage</strong> para ver esta sección.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-white px-4 py-8 text-[#231F20] md:px-8">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between" data-tutorial-id="users-header">
        <div>
          <h1 className="text-3xl font-semibold text-[#E11B22]">Administración de usuarios</h1>
          <p className="text-sm text-[#3b3b3b]">Gestiona cuentas, contraseñas y permisos atómicos.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateForm({ username: "", password: "" });
            setModal({ type: "create", user: null });
            setFormError("");
          }}
          className="inline-flex items-center justify-center rounded-full bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c9161c]"
          data-tutorial-id="users-create"
        >
          Crear usuario
        </button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3" data-tutorial-id="users-kpis">
        <div className="rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[#E11B22]">Total usuarios</p>
          <p className="mt-2 text-2xl font-semibold text-[#231F20]">{users.length}</p>
        </div>
        <div className="rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[#E11B22]">Con acceso total</p>
          <p className="mt-2 text-2xl font-semibold text-[#231F20]">
            {permissionCatalog.length ? fullAccessUsers : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[#E11B22]">Usuarios filtrados</p>
          <p className="mt-2 text-2xl font-semibold text-[#231F20]">{filteredUsers.length}</p>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-[#E1D6C8] bg-[#FAF3E9] p-4" data-tutorial-id="users-search">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
              <FaSearch className="text-[#E11B22]" />
            </span>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Buscar por usuario"
              className="w-full rounded-lg border border-[#D6C7B8] bg-white py-2 pl-9 pr-3 text-sm text-[#231F20] placeholder:text-[#939598] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
            />
          </div>
          <div className="text-sm text-[#E11B22]">
            Mostrando <span className="font-semibold text-[#231F20]">{paginatedUsers.length}</span> de{" "}
            <span className="font-semibold text-[#231F20]">{filteredUsers.length}</span>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-[#E1D6C8] bg-white p-4 text-sm text-[#6b6b6b] shadow">
          Cargando usuarios...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-[#F5B5B5] bg-[#FDE2E2] p-4 text-sm text-[#8B0000] shadow">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div
            className="overflow-x-auto rounded-2xl border border-[#E1D6C8] bg-white shadow"
            data-tutorial-id="users-table"
          >
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-[#FAF3E9]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[#E11B22]">ID</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[#E11B22]">Usuario</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.2em] text-[#E11B22]">Acceso</th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.2em] text-[#E11B22]">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1D6C8]">
                {paginatedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-[#6b6b6b]">
                      No hay usuarios para mostrar.
                    </td>
                  </tr>
                ) : (
                  paginatedUsers.map((user) => (
                    <tr key={user.id ?? user.username} className="transition hover:bg-[#FAF3E9]">
                      <td className="px-4 py-3 text-[#3b3b3b]">{user.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D6C7B8] bg-[#FAF3E9] text-sm font-semibold text-[#231F20]">
                            {getInitials(user.username)}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-[#231F20]">{user.username}</div>
                            <div className="text-xs text-[#6b6b6b]">ID {user.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {permissionCatalog.length ? (
                          fullAccessMap[user.id] ? (
                            <span className="inline-flex items-center rounded-full border border-[#F5B5B5] bg-[#FDE2E2] px-3 py-1 text-xs font-semibold text-[#8B0000]">
                              Acceso total
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-[#D6C7B8] bg-[#FAF3E9] px-3 py-1 text-xs text-[#231F20]">
                              Estándar
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-[#6b6b6b]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              openPermissionsModal(user);
                              setFormError("");
                            }}
                            className="rounded-full border border-[#D6C7B8] px-3 py-1 text-[#E11B22] transition hover:border-[#E11B22]"
                          >
                            Permisos
                          </button>
                          <button
                            type="button"
                          onClick={() => {
                            setPasswordForm({ password: "" });
                            setModal({ type: "password", user });
                            setFormError("");
                          }}
                            className="rounded-full border border-[#D6C7B8] px-3 py-1 text-[#231F20] transition hover:border-[#E11B22]"
                          >
                            Reset pass
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFormError("");
                              setModal({ type: "delete", user });
                            }}
                            className="rounded-full border border-[#F5B5B5] px-3 py-1 text-[#8B0000] transition hover:border-[#E11B22] hover:text-[#E11B22]"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-[#6b6b6b] md:flex-row">
            <span>
              Mostrando {paginatedUsers.length} de {filteredUsers.length} usuarios
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                className="rounded-full border border-[#D6C7B8] bg-white px-3 py-1 text-[#E11B22] transition hover:bg-[#FAF3E9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <span>
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
                className="rounded-full border border-[#D6C7B8] bg-white px-3 py-1 text-[#E11B22] transition hover:bg-[#FAF3E9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}

      {modal.type === "create" && (
        <Modal title="Crear usuario" onClose={closeModal}>
          <form className="space-y-4" onSubmit={handleCreateSubmit}>
            {formError && (
              <div className="rounded-lg border border-[#F5B5B5] bg-[#FDE2E2] px-3 py-2 text-sm text-[#8B0000]">
                {formError}
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-[#231F20]">Usuario</label>
              <input
                type="text"
                value={createForm.username}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
                className="w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#231F20]">Contraseña</label>
              <input
                type="password"
                value={createForm.password}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                className="w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-[#c9161c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal.type === "password" && modal.user && (
        <Modal title={`Restablecer contraseña de ${modal.user.username}`} onClose={closeModal}>
          <form className="space-y-4" onSubmit={handlePasswordSubmit}>
            {formError && (
              <div className="rounded-lg border border-[#F5B5B5] bg-[#FDE2E2] px-3 py-2 text-sm text-[#8B0000]">
                {formError}
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-[#231F20]">Nueva contraseña</label>
              <input
                type="password"
                value={passwordForm.password}
                onChange={(event) => setPasswordForm({ password: event.target.value })}
                className="w-full rounded-lg border border-[#D6C7B8] bg-white px-3 py-2 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-[#c9161c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Guardando..." : "Actualizar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal.type === "permissions" && modal.user && (
        <Modal title={`Permisos de ${modal.user.username}`} onClose={closeModal} size="xl">
          {permissionsError && (
            <div className="mb-3 rounded-lg border border-[#F5B5B5] bg-[#FDE2E2] px-3 py-2 text-sm text-[#8B0000]">
              {permissionsError}
            </div>
          )}
          {permissionsState.loading ? (
            <div className="rounded border border-[#E1D6C8] bg-white p-4 text-sm text-[#6b6b6b]">Cargando permisos...</div>
          ) : !permissionCatalog.length ? (
            <div className="rounded border border-[#E1D6C8] bg-white p-4 text-sm text-[#6b6b6b]">
              No hay catálogo de permisos disponible.
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handlePermissionsSubmit}>
              <div className="rounded-md border border-[#E1D6C8] bg-white px-3 py-2 text-sm text-[#3b3b3b]">
                <p className="text-xs text-[#6b6b6b]">
                  Selecciona <em>Permitir</em> o <em>Denegar</em>. <em>Sin override</em> elimina la entrada y el permiso queda denegado.
                </p>
              </div>

              <div className="space-y-4 rounded border border-[#E1D6C8] bg-[#FAF3E9] p-3">
                {Object.keys(permissionsByCategory).sort().map((category) => {
                  const items = permissionsByCategory[category] || [];
                  const effectiveSet = new Set(permissionsState.summary?.effective || []);
                  return (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center justify-between border-b border-[#E1D6C8] pb-1">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#E11B22]">{category}</h3>
                        <span className="text-[11px] text-[#6b6b6b]">{items.length} permisos</span>
                      </div>
                      <div className="space-y-3 rounded border border-[#E1D6C8] bg-white p-2">
                        {items.map((perm) => {
                          const override = permissionsState.overridesDraft?.[perm.code] ?? "inherit";
                          const effective = effectiveSet.has(perm.code);
                          const statusLabel =
                            override === "inherit"
                              ? effective
                                ? "Acceso actual: Permitido (sin override)"
                                : "Acceso actual: Denegado (sin override)"
                              : override === "grant"
                              ? "Override aplicado: Permitido"
                              : "Override aplicado: Denegado";
                          return (
                            <div
                              key={perm.code}
                              className="grid grid-cols-1 gap-3 rounded-md bg-[#FAF3E9] p-3 shadow-sm ring-1 ring-[#E1D6C8] md:grid-cols-12 md:items-center"
                            >
                              <div className="md:col-span-3">
                                <div className="break-words text-sm font-semibold text-[#231F20]">{perm.name}</div>
                                <div className="break-all text-xs text-[#6b6b6b]">{perm.code}</div>
                              </div>
                              <div className="md:col-span-5 break-words text-sm text-[#3b3b3b]">{perm.description || "—"}</div>
                              <div className="md:col-span-2 text-xs font-medium text-[#6b6b6b]">{statusLabel}</div>
                              <div className="md:col-span-2">
                                <select
                                  value={override}
                                  onChange={(event) => updateOverrideChoice(perm.code, event.target.value)}
                                  className="w-full rounded border border-[#D6C7B8] bg-white px-2 py-1 text-sm text-[#231F20] focus:border-[#E11B22] focus:outline-none focus:ring-1 focus:ring-[#E11B22]/40"
                                >
                                  <option value="inherit">Sin override (queda denegado)</option>
                                  <option value="grant">Permitir</option>
                                  <option value="deny">Denegar</option>
                                </select>
                              </div>
                              <div className="md:col-span-6 text-xs font-semibold text-[#6b6b6b]">
                                Acceso actual: {effective ? "Permitido" : "Denegado"}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9]"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={permissionsSaving}
                  className="rounded-full bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-[#c9161c] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {permissionsSaving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {modal.type === "delete" && modal.user && (
        <Modal title="Eliminar usuario" onClose={closeModal}>
          <div className="space-y-4 text-sm text-[#3b3b3b]">
            <p>
              Estas seguro de eliminar la cuenta <strong className="text-[#231F20]">{modal.user.username}</strong>? Esta accion no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-[#D6C7B8] bg-white px-4 py-2 text-sm text-[#E11B22] transition hover:bg-[#FAF3E9]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="rounded-full bg-[#E11B22] px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-[#c9161c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
