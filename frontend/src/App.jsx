import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ChooseInventory from "./components/ChooseInventory";
import LoginForm from "./components/LoginForm";
import HyperVInventoryPage from "./components/HyperVInventoryPage";
import KVMPage from "./components/KVMPage";
import AppLayout from "./components/AppLayout";
import AccessDenied from "./components/AccessDenied";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import AccessPending from "./pages/AccessPending";
import AccessDeniedTenant from "./pages/AccessDeniedTenant";
import UserAdminPage from "./pages/UserAdminPage";
import AuditPage from "./pages/AuditPage";
import NotificationsPage from "./pages/NotificationsPage";
import VMwarePage from "./components/VMwarePage";
import CediaPage from "./components/CediaPage";
import AzurePage from "./components/AzurePage";
import SystemPage from "./pages/SystemPage";
import ExecutiveMissionControl from "./pages/ExecutiveMissionControl";
import AiChatPanel from "./components/AiChatPanel";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { token, mustChangePassword, hasPermission } = useAuth();
  const location = useLocation();
  const isAuthenticated = Boolean(token);
  const enforcePasswordChange = isAuthenticated && mustChangePassword;
  const canViewVmware = hasPermission("vms.view");
  const canViewHyperv = hasPermission("hyperv.view");
  const canViewCedia = hasPermission("cedia.view");
  const canViewAzure = hasPermission("azure.view");
  const canViewNotifications = hasPermission("notifications.view");
  const canViewAudit = hasPermission("audit.view");
  const canManageUsers = hasPermission("users.manage");
  const canViewSystemSettings = hasPermission("system.settings.view");
  const canUseAi = hasPermission("ai.chat");
  const canViewInventory = canViewVmware || canViewHyperv || canViewCedia || canViewAzure;
  const hostIdParam = new URLSearchParams(location.search).get("hostId");

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/choose" replace />
          ) : (
            <div className="min-h-dvh">
              <LoginForm />
            </div>
          )
        }
      />

      <Route
        path="/change-password"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <AppLayout>
                <ChangePasswordPage />
              </AppLayout>
            ) : (
              <Navigate to="/choose" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/access-pending"
        element={isAuthenticated ? <Navigate to="/choose" replace /> : <AccessPending />}
      />

      <Route
        path="/access-denied-tenant"
        element={isAuthenticated ? <Navigate to="/choose" replace /> : <AccessDeniedTenant />}
      />

      <Route
        path="/choose"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewInventory ? (
              <AppLayout mainClassName="p-0">
                <ChooseInventory />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="No tienes permisos para ver inventarios (vms.view / hyperv.view / cedia.view / azure.view)." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/hyperv"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewHyperv ? (
              <AppLayout>
                <HyperVInventoryPage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso hyperv.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/hyperv-hosts"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewHyperv ? (
              <Navigate to="/hyperv?view=hosts" replace />
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso hyperv.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/cedia"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewCedia ? (
              <AppLayout>
                <CediaPage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso cedia.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/azure"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewAzure ? (
              <AppLayout>
                <AzurePage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso azure.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/hosts"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewVmware ? (
              <Navigate
                to={`/vmware?view=hosts${hostIdParam ? `&hostId=${encodeURIComponent(hostIdParam)}` : ""}`}
                replace
              />
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso vms.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/vmware"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewVmware ? (
              <AppLayout>
                <VMwarePage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso vms.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/kvm"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : (
              <AppLayout>
                <KVMPage />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/notifications"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewNotifications ? (
              <AppLayout>
                <NotificationsPage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso notifications.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/audit"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewAudit ? (
              <AppLayout mainClassName="p-0 bg-black">
                <AuditPage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso audit.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/users"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canManageUsers ? (
              <AppLayout mainClassName="p-0 bg-black">
                <UserAdminPage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso users.manage para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/system"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewSystemSettings ? (
              <AppLayout>
                <SystemPage />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso system.settings.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/ai"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canUseAi ? (
              <AppLayout mainClassName="flex-1 min-h-0 px-4 py-3 sm:px-6">
                <AiChatPanel />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="No tienes acceso a KYLOW." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/mission-control"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewVmware ? (
              <AppLayout mainClassName="p-0">
                <ExecutiveMissionControl />
              </AppLayout>
            ) : (
              <AppLayout>
                <AccessDenied description="Necesitas el permiso vms.view para acceder." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/*"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : canViewInventory ? (
              <Navigate to="/choose" replace />
            ) : (
              <AppLayout>
                <AccessDenied description="No tienes permisos para ver inventarios." />
              </AppLayout>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
