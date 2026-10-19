import { Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { RequireAuth, SessionProvider } from "./lib/session";
import Dashboard from "./routes/Dashboard";
import Builder from "./routes/Builder";
import Login from "./routes/Login";

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Everything below the guard renders only with a session. */}
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/p/:id" element={<Builder />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </SessionProvider>
  );
}
