import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ChooseInventory from "./components/ChooseInventory";
import LoginForm from "./components/LoginForm";
import Navbar from "./components/Navbar";
import HyperVPage from "./components/HyperVPage";
import KVMPage from "./components/KVMPage";
import VMTable from "./components/VMTable";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import UserAdminPage from "./pages/UserAdminPage";
import AuditPage from "./pages/AuditPage";
import NotificationsPage from "./pages/NotificationsPage";

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
  const { token, mustChangePassword, isSuperadmin } = useAuth();
  const isAuthenticated = Boolean(token);
  const enforcePasswordChange = isAuthenticated && mustChangePassword;

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
              <div className="min-h-screen bg-gray-50 flex flex-col">
                <Navbar />
                <ChangePasswordPage />
              </div>
            ) : (
              <Navigate to="/choose" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/choose"
        element={
          isAuthenticated ? (
            enforcePasswordChange ? (
              <Navigate to="/change-password" replace />
            ) : (
              <ChooseInventory />
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
            ) : (
            <div className="min-h-screen bg-gray-50 flex flex-col">
              <Navbar />
              <HyperVPage />
            </div>
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
            <div className="min-h-screen bg-gray-50 flex flex-col">
              <Navbar />
              <KVMPage />
            </div>
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
            ) : isSuperadmin ? (
              <div className="min-h-screen bg-gray-50 flex flex-col">
                <Navbar />
                <NotificationsPage />
              </div>
            ) : (
              <div className="min-h-screen bg-gray-50 flex flex-col">
                <Navbar />
                <div className="flex flex-1 items-center justify-center px-6 py-20">
                  <div className="max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow">
                    <h2 className="text-lg font-semibold text-gray-900">Acceso denegado</h2>
                    <p className="mt-2 text-sm text-gray-600">
                      Esta sección solo está disponible para usuarios con rol <strong>SUPERADMIN</strong>.
                    </p>
                  </div>
                </div>
              </div>
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
            ) : isSuperadmin ? (
              <div className="min-h-screen bg-gray-50 flex flex-col">
                <Navbar />
                <AuditPage />
              </div>
            ) : (
              <div className="min-h-screen bg-gray-50 flex flex-col">
                <Navbar />
                <div className="flex flex-1 items-center justify-center px-6 py-20">
                  <div className="max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow">
                    <h2 className="text-lg font-semibold text-gray-900">Acceso denegado</h2>
                    <p className="mt-2 text-sm text-gray-600">
                      Esta sección solo está disponible para usuarios con rol <strong>SUPERADMIN</strong>.
                    </p>
                  </div>
                </div>
              </div>
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
            ) : (
            <div className="min-h-screen bg-gray-50 flex flex-col">
              <Navbar />
              <UserAdminPage />
            </div>
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
            ) : (
            <div className="min-h-screen bg-gray-50 flex flex-col">
              <Navbar />
              <VMTable />
            </div>
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
