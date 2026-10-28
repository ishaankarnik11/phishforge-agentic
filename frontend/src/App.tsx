import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import PrivateRoute from "./components/PrivateRoute";
import AppShell from "./components/shell/AppShell";
import LoginPage from "./pages/LoginPage";
import BriefPage from "./pages/BriefPage";
import EmailerPage from "./pages/EmailerPage";
import HomePage from "./pages/HomePage";
import SharedPreview from "./pages/SharedPreview";
import AdminObservabilityPage from "./pages/AdminObservabilityPage";
import AdminImpersonationPresetsPage from "./pages/AdminImpersonationPresetsPage";
import ImpersonationPresetFormPage from "./pages/ImpersonationPresetFormPage";
import AssetLibraryPage from "./pages/AssetLibraryPage";
import AssetDetailPage from "./pages/AssetDetailPage";
import MaskEditorPage from "./pages/MaskEditorPage";
import DesignTokensPage from "./pages/DesignTokensPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Public share route (STORY-4.5) -- intentionally OUTSIDE PrivateRoute */}
          <Route path="/share/:token" element={<SharedPreview />} />

          {/* STORY-AP7.1: standard-content authenticated screens share one
              shell (TopBar + Authorization Context Bar + SideNav). The
              PrivateRoute guard wraps the whole layout so the auth check is
              unchanged. Full-screen editor workspaces (EmailerPage,
              MaskEditorPage) are routed OUTSIDE the shell on purpose: they use
              the dedicated Two-Pane Editor Shell (later chunk). */}
          <Route
            element={
              <PrivateRoute>
                <AppShell />
              </PrivateRoute>
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/brief" element={<BriefPage />} />
            {/* STORY-7.8 AC-3 / AC-5: admin observability page. The page
                itself enforces ``role === "admin"`` and redirects
                non-admins to ``/`` (PrivateRoute only checks login). */}
            <Route
              path="/admin/observability"
              element={<AdminObservabilityPage />}
            />
            {/* STORY-AP1.2: admin impersonation preset registry. Page enforces
                ``role === "admin"`` and redirects non-admins to ``/``. */}
            <Route
              path="/admin/impersonation-presets"
              element={<AdminImpersonationPresetsPage />}
            />
            <Route
              path="/admin/impersonation-presets/new"
              element={<ImpersonationPresetFormPage />}
            />
            <Route
              path="/admin/impersonation-presets/:id/edit"
              element={<ImpersonationPresetFormPage />}
            />
            {/* STORY-A1.1: asset library grid */}
            <Route path="/assets" element={<AssetLibraryPage />} />
            {/* STORY-A1.5: asset detail page with version history */}
            <Route path="/assets/:id" element={<AssetDetailPage />} />
          </Route>

          {/* STORY-AP1.2 editor: full-screen two-pane workspace, own chrome. */}
          <Route
            path="/emailers/:id"
            element={
              <PrivateRoute>
                <EmailerPage />
              </PrivateRoute>
            }
          />
          {/* STORY-A4.1: mask-based inpainting editor, full-screen own chrome. */}
          <Route
            path="/assets/:id/edit"
            element={
              <PrivateRoute>
                <MaskEditorPage />
              </PrivateRoute>
            }
          />

          {/* STORY-AP0.2: dev-only design-token preview. Public + unguarded by
              design (no auth, no business logic); mounted only in dev builds so
              it never ships to production. */}
          {import.meta.env.DEV && (
            <Route path="/design-tokens" element={<DesignTokensPage />} />
          )}
          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
