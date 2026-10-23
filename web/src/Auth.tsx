import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  api,
  ApiError,
  errorMessage,
  setCsrf,
  type Session,
  type User,
} from "./api";
type Auth = {
  user: User | null;
  loading: boolean;
  error: string;
  mailMode: "console" | "smtp" | "brevo";
  accept: (session: Session) => void;
  refresh: () => Promise<void>;
  update: (user: User) => void;
  logout: () => Promise<void>;
};
const Context = React.createContext<Auth>(null!);
export const useAuth = () => React.useContext(Context);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, update] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [mailMode, setMailMode] = React.useState<"console" | "smtp" | "brevo">("console");
  const accept = React.useCallback((session: Session) => {
    update(session.user);
    setCsrf(session.csrfToken);
    setError("");
    setMailMode(session.mailMode ?? session.delivery?.mode ?? "console");
  }, []);
  const refresh = React.useCallback(async () => {
    setError("");
    try {
      accept(await api<Session>("/auth/session"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        update(null);
        setCsrf("");
      } else setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [accept]);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  async function logout() {
    await api("/auth/logout", { method: "POST", body: {} });
    update(null);
    setCsrf("");
  }
  return (
    <Context.Provider
      value={{
        user,
        loading,
        error,
        mailMode,
        accept,
        refresh,
        update,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="loading-page" role="status">
        Проверяем сессию…
      </div>
    );
  if (error)
    return (
      <div className="notice error-notice" role="alert">
        {error}
        <button onClick={() => void refresh()}>Повторить</button>
      </div>
    );
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!user.emailVerifiedAt && location.pathname !== "/pending")
    return <Navigate to="/pending" replace />;
  // При смене аккаунта в другой вкладке очищаем состояние защищённых страниц.
  return <React.Fragment key={user.id}>{children}</React.Fragment>;
}
