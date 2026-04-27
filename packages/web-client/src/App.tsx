import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LobbyPage } from "./pages/LobbyPage";
import { SessionPage } from "./pages/SessionPage";
import { SessionSetupPage } from "./pages/SessionSetupPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/session/:id/setup" element={<SessionSetupPage />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
