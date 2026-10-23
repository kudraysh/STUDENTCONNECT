import React from "react";
import { Link } from "react-router-dom";
import { Bell, RefreshCw } from "lucide-react";
import { api, errorMessage } from "./api";
import { eventDate } from "./eventsApi";
type Notice = {
  id: string;
  eventId: string;
  kind: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};
export function EventNotices() {
  const [data, setData] = React.useState<{ notices: Notice[]; unread: number }>(
    { notices: [], unread: 0 },
  );
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reload = React.useCallback(async () => {
    try {
      setData(await api("/events/notices"));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  React.useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 30000);
    const update = () => void reload();
    window.addEventListener("events-changed", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("events-changed", update);
    };
  }, [reload]);
  async function read() {
    setBusy(true);
    try {
      await api("/events/notices/read", {
        method: "POST",
        body: { ids: data.notices.filter((n) => !n.isRead).map((n) => n.id) },
      });
      await reload();
      window.dispatchEvent(new Event("notifications-changed"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="event-notices">
      <summary>
        <Bell size={17} /> Уведомления мероприятий{" "}
        {data.unread > 0 && (
          <span className="notification-count">{data.unread}</span>
        )}
      </summary>
      <div className="section-heading">
        <p className="field-help">
          Обновляются каждые 30 секунд, пока открыт раздел.
        </p>
        <button aria-label="Обновить уведомления" onClick={() => void reload()}>
          <RefreshCw size={15} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data.notices.length === 0 ? (
        <p>Пока нет уведомлений.</p>
      ) : (
        <ul>
          {data.notices.map((n) => (
            <li className={!n.isRead ? "unread" : ""} key={n.id}>
              <Link to={`/events/${n.eventId}`}>{n.message}</Link>
              <time dateTime={n.createdAt}>{eventDate(n.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
      {data.notices.some((n) => !n.isRead) && (
        <button disabled={busy} onClick={() => void read()}>
          Отметить показанные прочитанными
        </button>
      )}
    </details>
  );
}
