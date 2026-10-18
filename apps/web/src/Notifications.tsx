import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, RefreshCw } from "lucide-react";
import { api, errorMessage } from "./api";
import { useAuth } from "./Auth";
import { useChat } from "./ChatContext";
import { eventDate } from "./eventsApi";
type Cursor = { before: number; beforeId: string };
type Notice = { id: string; kind: string; message: string; href: string; isRead: boolean; createdAt: string };
type Result = { notifications: Notice[]; unread: number; next: Cursor | null };
const changed = () => window.dispatchEvent(new Event("notifications-changed"));
function useNotices(cursor: Cursor | null = null, onlyUnread = false) {
  const { user } = useAuth();
  const { revision } = useChat();
  const [data, setData] = React.useState<Result | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [tick, update] = React.useReducer(n => n + 1, 0);
  const refresh = React.useCallback(() => update(), []);
  React.useEffect(() => {
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("notifications-changed", refresh);
    window.addEventListener("events-changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("notifications-changed", refresh);
      window.removeEventListener("events-changed", refresh);
    };
  }, [refresh]);
  React.useEffect(() => {
    setData(null); setLoading(true); setError("");
  }, [user?.id, cursor?.before, cursor?.beforeId, onlyUnread]);
  React.useEffect(() => {
    if (!user?.emailVerifiedAt) { setData(null); setLoading(false); return; }
    let active = true;
    const params = new URLSearchParams({ unread: onlyUnread ? "1" : "0" });
    if (cursor) { params.set("before", String(cursor.before)); params.set("beforeId", cursor.beforeId); }
    void api<Result>(`/notifications?${params}`).then(v => {
      if (active) { setData(v); setError(""); }
    }).catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, user?.emailVerifiedAt, revision, tick, cursor?.before, cursor?.beforeId, onlyUnread]);
  return { data, error, loading, refresh };
}
// Ключ пользователя в main.tsx сбрасывает данные при смене аккаунта.
export function NotificationBell() {
  const { data, error } = useNotices();
  const count = data?.unread ?? 0;
  return <Link to="/notifications" className="notification-bell" aria-label={error ? "Уведомления: не удалось обновить" : `Уведомления, непрочитанных: ${count}`} title={error || "Уведомления"}>
    <Bell size={20} />
    {count > 0 && <span className="nav-unread">{count > 99 ? "99+" : count}</span>}
    {error && <span aria-hidden="true">!</span>}
  </Link>;
}
export function NotificationsPage() {
  const navigate = useNavigate();
  const [cursors, setCursors] = React.useState<(Cursor | null)[]>([null]);
  const [onlyUnread, setOnlyUnread] = React.useState(false);
  const cursor = cursors.at(-1) ?? null;
  const { data, error, loading, refresh } = useNotices(cursor, onlyUnread);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  async function read(ids: string[], href?: string) {
    setBusy(true); setActionError(""); setSuccess("");
    try {
      await api("/notifications/read", { method: "POST", body: { ids } });
      changed(); window.dispatchEvent(new Event("events-changed"));
      if (href) navigate(href);
      else setSuccess("Показанные уведомления отмечены прочитанными");
    } catch (e) { setActionError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const unreadIds = data?.notifications.filter(n => !n.isRead).map(n => n.id) ?? [];
  return <section className="notifications-page">
    <div className="section-heading"><div><span className="eyebrow">НЕ ПРОПУСТИ ВАЖНОЕ</span><h1>Уведомления</h1></div>
      <button onClick={refresh} disabled={busy} aria-label="Обновить уведомления"><RefreshCw size={18} /></button>
    </div>
    <p className="field-help">Сообщения, мероприятия и запросы телефона. Обновляются автоматически, пока сайт открыт.</p>
    <div className="actions notification-filters">
      <button aria-pressed={!onlyUnread} disabled={busy} onClick={() => {setOnlyUnread(false);setCursors([null]);}}>Все</button>
      <button aria-pressed={onlyUnread} disabled={busy} onClick={() => {setOnlyUnread(true);setCursors([null]);}}>Непрочитанные{data ? ` · ${data.unread}` : ""}</button>
      <button disabled={busy || !unreadIds.length} onClick={() => void read(unreadIds)}>Прочитать показанные</button>
    </div>
    {(error || actionError) && <p className="form-error" role="alert">{actionError || error}</p>}
    {success && <p className="form-success" role="status">{success}</p>}
    {loading && <p role="status">Загружаем уведомления…</p>}
    {data && <>
      {!data.notifications.length && <div className="form-card"><p>{onlyUnread ? "Непрочитанных уведомлений на этой странице нет." : "На этой странице пока нет уведомлений."}</p></div>}
      <ul className="notification-list">{data.notifications.map(n => <li key={n.id} className={n.isRead ? "" : "unread"}>
        <Bell size={20} aria-hidden="true" />
        <div><Link to={n.href} onClick={ev => {
          if (!n.isRead && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey && ev.button === 0) {
            ev.preventDefault(); if (!busy) void read([n.id], n.href);
          }
        }}>{n.message}</Link><time dateTime={n.createdAt}>{eventDate(n.createdAt)}</time>
        {!n.isRead && <span className="field-help">Не прочитано</span>}</div>
        {!n.isRead && <button disabled={busy} onClick={() => void read([n.id])}>Прочитано</button>}
      </li>)}</ul>
      <div className="actions">
        <button disabled={busy || cursors.length === 1} onClick={() => setCursors(c => c.slice(0,-1))}>Назад</button>
        <span>Страница {cursors.length}</span>
        <button disabled={busy || !data.next} onClick={() => { if (data.next) setCursors(c => [...c, data.next]); }}>Далее</button>
      </div>
    </>}
  </section>;
}
