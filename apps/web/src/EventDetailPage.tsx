import React from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, MapPin, Users, RefreshCw, Check, X } from "lucide-react";
import { api, errorMessage } from "./api";
import { useAuth } from "./Auth";
import { Avatar } from "./ProfileFields";
import { EventNotices } from "./EventNotices";
import { eventDate, eventStatus, type EventDetails } from "./eventsApi";
export function EventDetailPage() {
  const { id } = useParams();
  // Новое мероприятие получает отдельное состояние, даже если предыдущий запрос ещё идёт.
  return <EventDetail key={id} id={id ?? ""} />;
}
function EventDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const [data, setData] = React.useState<EventDetails | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [kickId, setKickId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const reload = React.useCallback(async () => {
    setData(await api<EventDetails>(`/events/${encodeURIComponent(id ?? "")}`));
  }, [id]);
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setError("");
    setNotice("");
    setConfirmLeave(false);
    setKickId("");
    void api<EventDetails>(`/events/${encodeURIComponent(id ?? "")}`)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function action(path: string, body: object = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ message: string }>(`/events/${id}${path}`, {
        method: "POST",
        body,
      });
      setNotice(result.message);
      setConfirmClose(false);
      setConfirmLeave(false);
      setKickId("");
      setReason("");
      await reload();
      window.dispatchEvent(new Event("events-changed"));
    } catch (e) {
      setError(errorMessage(e));
      try {
        await reload();
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <p className="loading-page" role="status">
        Загружаем мероприятие…
      </p>
    );
  if (!data)
    return (
      <div className="notice error-notice" role="alert">
        {error || "Мероприятие не найдено"}
        <p>
          <Link to="/events">К мероприятиям</Link>
        </p>
      </div>
    );
  const e = data.event;
  const future = !e.closedAt && new Date(e.startsAt).getTime() > Date.now();
  return (
    <section className="event-details">
      <Link className="text-button" to="/events">
        ← Все мероприятия
      </Link>
      <EventNotices />
      <div className="event-detail-hero">
        <div>
          <span className="pill">{e.category.name}</span>
          <h1>{e.title}</h1>
          <div className="event-meta">
            <span>
              <CalendarDays size={18} />
              {eventDate(e.startsAt)}
            </span>
            <span>
              <MapPin size={18} />
              {e.place}
            </span>
            <span>
              <Users size={18} />
              {e.participants} / {e.capacity} участников
            </span>
          </div>
          <p className="field-help">Дата и время в твоём часовом поясе.</p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void reload().catch((err) => setError(errorMessage(err)))
          }
          aria-label="Обновить мероприятие"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="form-success">
          {notice}
        </p>
      )}
      <div className="event-detail-grid">
        <div>
          <article className="form-card">
            <h2>О мероприятии</h2>
            <p className="event-description-full">{e.description}</p>
            <h3>Организатор</h3>
            <Link className="event-organizer" to={`/users/${e.organizer.id}`}>
              <Avatar user={e.organizer} />
              <span>
                {e.organizer.firstName} {e.organizer.lastName}
                <small>{e.organizer.group}</small>
              </span>
            </Link>
          </article>
          <article className="form-card event-members">
            <h2>Участники · {e.participants}</h2>
            {data.participants.map((p) => (
              <div className="event-person" key={p.id}>
                <Link className="event-organizer" to={`/users/${p.id}`}>
                  <Avatar user={p} />
                  <span>
                    {p.firstName} {p.lastName}
                    <small>
                      {p.group}
                      {p.id === e.organizerId ? " · Организатор" : ""}
                    </small>
                  </span>
                </Link>
                {e.isOrganizer && p.id !== user?.id && future && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setKickId(p.id);
                      setReason("");
                    }}
                  >
                    Исключить
                  </button>
                )}
                {kickId === p.id && (
                  <form
                    className="kick-form"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void action(`/members/${p.id}/kick`, { reason });
                    }}
                  >
                    <label>
                      Причина исключения
                      <textarea
                        required
                        maxLength={500}
                        value={reason}
                        onChange={(ev) => setReason(ev.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <p className="field-help">
                      Участник получит причину и больше не сможет вступить в это
                      мероприятие.
                    </p>
                    <div className="actions">
                      <button
                        className="danger-button"
                        disabled={busy || !reason.trim()}
                      >
                        Исключить навсегда
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setKickId("")}
                      >
                        Отмена
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </article>
          {e.isOrganizer && (
            <article className="form-card event-applications">
              <h2>Заявки · {data.applications.length}</h2>
              <p className="field-help">
                Принять можно только при наличии места. Для обновления списка
                нажми кнопку выше.
              </p>
              {data.applications.length === 0 ? (
                <p>Новых заявок пока нет.</p>
              ) : (
                data.applications.map((a) => (
                  <div className="event-person" key={a.id}>
                    <Link
                      className="event-organizer"
                      to={`/users/${a.user.id}`}
                    >
                      <Avatar user={a.user} />
                      <span>
                        {a.user.firstName} {a.user.lastName}
                        <small>
                          {a.user.group} · {eventDate(a.createdAt)}
                        </small>
                      </span>
                    </Link>
                    <div className="actions">
                      <button
                        disabled={busy || e.free <= 0 || !future}
                        onClick={() =>
                          void action(`/applications/${a.id}/accept`)
                        }
                      >
                        <Check size={14} /> Принять
                      </button>
                      <button
                        disabled={busy || !future}
                        onClick={() =>
                          void action(`/applications/${a.id}/reject`)
                        }
                      >
                        <X size={14} /> Отклонить
                      </button>
                    </div>
                  </div>
                ))
              )}
            </article>
          )}
        </div>
        <aside className="event-join-card form-card">
          <span className="eyebrow">ТВОЁ УЧАСТИЕ</span>
          <h2>{eventStatus(e)}</h2>
          <p>
            {e.closedAt
              ? "Организатор закрыл мероприятие. Список участников сохранён."
              : future
              ? `Свободных мест: ${e.free}`
              : "Мероприятие уже началось. Изменение состава закрыто."}
          </p>
          {e.member?.state === "KICKED" && (
            <div className="notice">
              <strong>Причина исключения</strong>
              <p>{e.member.kickReason}</p>
            </div>
          )}
          {e.canApply && (
            <button
              className="primary wide"
              disabled={busy}
              onClick={() => void action("/apply")}
            >
              {busy ? "Отправляем…" : "Подать заявку"}
            </button>
          )}
          {!e.canApply && !e.isOrganizer && (
            <p className="field-help">{e.applyBlock}</p>
          )}
          {e.member && !e.isOrganizer && (
            <p className="field-help">
              Успешных вступлений: {e.member.joinCount} / 2<br />
              Добровольных выходов: {e.member.leaveCount} / 2
            </p>
          )}
          {e.member?.state === "ACTIVE" &&
            !e.isOrganizer &&
            future &&
            (confirmLeave ? (
              <div className="notice">
                <p>
                  {e.member.joinCount >= 2
                    ? "После этого выхода повторное вступление будет запрещено."
                    : "После первого выхода можно подать заявку ещё один раз."}
                </p>
                <div className="actions">
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() => void action("/leave")}
                  >
                    Да, выйти
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setConfirmLeave(false)}
                  >
                    Остаться
                  </button>
                </div>
              </div>
            ) : (
              <button
                disabled={busy}
                className="secondary wide"
                onClick={() => setConfirmLeave(true)}
              >
                Выйти из мероприятия
              </button>
            ))}
          {e.isOrganizer && !e.closedAt && (
            confirmClose ? <div className="notice" role="alert">
              <p>Закрыть мероприятие? Заявки будут отклонены, изменение состава станет недоступно. Участники получат уведомление. Повторно открыть мероприятие нельзя.</p>
              <div className="actions">
                <button className="danger-button" disabled={busy} onClick={() => void action("/close")}>Да, закрыть</button>
                <button disabled={busy} onClick={() => setConfirmClose(false)}>Отмена</button>
              </div>
            </div> : <button className="danger-button wide" disabled={busy} onClick={() => setConfirmClose(true)}>Закрыть мероприятие</button>
          )}
          <div className="form-divider" />
          <p className="field-help">
            После первого добровольного выхода можно вступить повторно. Всего
            допускается два успешных вступления. После второго выхода или
            исключения повторное вступление запрещено.
          </p>
          {e.isOrganizer && (
            <p className="field-help">
              Ты занимаешь одно место в составе и не можешь выйти или исключить
              себя.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
