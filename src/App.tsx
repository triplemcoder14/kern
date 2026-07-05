import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ui/components/ProtectedRoute";
import { AuthProvider } from "./ui/hooks/useAuth";
import { ConsoleApp } from "./ui/pages/ConsoleApp";
import { LandingPage } from "./ui/pages/LandingPage";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <ConsoleApp />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
