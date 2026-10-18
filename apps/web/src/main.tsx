import { AppErrorBoundary } from "./AppErrorBoundary";
import { readDarkTheme, saveDarkTheme } from "./preferences";
import { FeedbackPage } from "./FeedbackPage";
import { PeopleFeedPage } from "./PeopleFeedPage";
import { NotificationBell, NotificationsPage } from "./Notifications";
import { ChatProvider, useChat } from "./ChatContext";
import { MessagesPage } from "./MessagesPage";
import { EventsPage } from "./EventsPage";
import { CreateEventPage } from "./CreateEventPage";
import { EventDetailPage } from "./EventDetailPage";
import { PeoplePage } from "./PeoplePage";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Users,
  CalendarDays,
  MessageCircle,
  Moon,
  Sun,
  GraduationCap,
  LogOut,
} from "lucide-react";
import { AuthProvider, Protected, useAuth } from "./Auth";
import { LoginPage, PendingPage, RegisterPage, VerifyPage } from "./AuthPages";
import { Foundation } from "./Foundation";
import { ProfilePage, PublicProfilePage } from "./ProfilePage";
import { Avatar } from "./ProfileFields";
import { errorMessage } from "./api";
import "./style.css";
function Home() {
  const { user, loading, error, refresh } = useAuth();
  if (loading)
    return (
      <p role="status" className="loading-page">
        Загружаем StudentConnect…
      </p>
    );
  if (error)
    return (
      <div className="notice error-notice" role="alert">
        {error}
        <button onClick={() => void refresh()}>Повторить подключение</button>
      </div>
    );
  if (!user) return <Foundation />;
  if (!user.emailVerifiedAt) return <Navigate replace to="/pending" />;
  return <PeoplePage />;
}
function App() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { unread, phoneRequests } = useChat();
  const chatCount = unread + phoneRequests;
  const [dark, setDark] = React.useState(
    () => readDarkTheme(() => window.localStorage),
  );
  const [error, setError] = React.useState("");
  const [leaving, setLeaving] = React.useState(false);
  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    saveDarkTheme(() => window.localStorage, dark);
  }, [dark]);
  async function leave() {
    setLeaving(true);
    setError("");
    try {
      await logout();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLeaving(false);
    }
  }
  return (
    <>
      <header>
        <Link to="/" className="brand">
          <span>
            <GraduationCap size={23} />
          </span>
          student<span className="brand-accent">connect</span>
        </Link>
        <nav aria-label="Основная навигация">
          {[
            { Icon: Users, title: "Люди", path: "/" },
            { Icon: CalendarDays, title: "Мероприятия", path: "/events" },
            { Icon: MessageCircle, title: "Сообщения", path: "/messages" },
          ].map(({ Icon, title, path }) => (
            <NavLink end={path === "/"} key={path} to={path} className={({isActive}) => isActive || (path === "/" && location.pathname === "/people/feed") ? "active" : ""}>
              <Icon size={17} />
              {title}
              {path === "/messages" && chatCount > 0 && (
                <span
                  className="nav-unread"
                  aria-label={`${unread} непрочитанных сообщений, ${phoneRequests} запросов номера`}
                >
                  {chatCount > 99 ? "99+" : chatCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {user?.emailVerifiedAt && <NotificationBell key={user.id} />}
          <button
            onClick={() => setDark(!dark)}
            aria-label={dark ? "Светлая тема" : "Тёмная тема"}
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          {user ? (
            <>
              <Link
                aria-label="Мой профиль"
                to={user.emailVerifiedAt ? "/profile" : "/pending"}
              >
                <Avatar user={user} />
              </Link>
              <button
                disabled={leaving}
                className="logout-button"
                onClick={() => void leave()}
                aria-label="Выйти"
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <Link className="header-login" to="/login">
              Войти
            </Link>
          )}
        </div>
      </header>
      <main>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route
            path="/pending"
            element={
              <Protected>
                <PendingPage />
              </Protected>
            }
          />
          <Route
            path="/profile"
            element={
              <Protected>
                <ProfilePage />
              </Protected>
            }
          />
          <Route
            path="/users/:id"
            element={
              <Protected>
                <PublicProfilePage />
              </Protected>
            }
          />
          <Route
            path="/events"
            element={
              <Protected>
                <EventsPage />
              </Protected>
            }
          />
          <Route
            path="/events/new"
            element={
              <Protected>
                <CreateEventPage />
              </Protected>
            }
          />
          <Route
            path="/events/:id"
            element={
              <Protected>
                <EventDetailPage />
              </Protected>
            }
          />
          <Route path="/feedback" element={<Protected><FeedbackPage /></Protected>} />
          <Route path="/people/feed" element={<Protected><PeopleFeedPage /></Protected>} />
          <Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />
          <Route
            path="/messages"
            element={
              <Protected>
                <MessagesPage />
              </Protected>
            }
          />
          <Route
            path="/messages/:id"
            element={
              <Protected>
                <MessagesPage />
              </Protected>
            }
          />
          <Route
            path="*"
            element={
              <section className="placeholder">
                <h1>Страница не найдена</h1>
                <Link to="/">На главную</Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer>
        <span>StudentConnect · Учебный проект</span>
        {user?.emailVerifiedAt ? <Link to="/feedback" state={{from:location.pathname}}>Сообщить об ошибке</Link> : <Link to="/">Сделано для новых знакомств</Link>}
      </footer>
    </>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ChatProvider>
          <AppErrorBoundary><App /></AppErrorBoundary>
        </ChatProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
