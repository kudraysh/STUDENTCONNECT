import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, MapPin, Users, Plus, ArrowUpRight } from "lucide-react";
import { api, errorMessage } from "./api";
import { useCatalog, Avatar } from "./ProfileFields";
import { EventNotices } from "./EventNotices";
import { eventDate, eventStatus, type EventData } from "./eventsApi";
export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const [query, setQuery] = React.useState(params.get("q") ?? "");
  const [data, setData] = React.useState<{
    events: EventData[];
    total: number;
    page: number;
    limit: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const catalog = useCatalog();
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api<{
      events: EventData[];
      total: number;
      page: number;
      limit: number;
    }>(`/events?${key}`)
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
  }, [key, retry]);
  React.useEffect(() => setQuery(params.get("q") ?? ""), [key]);
  function filter(k: string, v: string) {
    setParams((previous) => {
      const n = new URLSearchParams(previous);
      v ? n.set(k, v) : n.delete(k);
      n.delete("page");
      return n;
    });
  }
  return (
    <section className="events-page">
      <div className="people-heading">
        <div>
          <span className="eyebrow">ВМЕСТЕ ИНТЕРЕСНЕЕ</span>
          <h1>
            Есть <span>планы?</span>
          </h1>
          <p>Собери команду для спорта, учёбы или любимой игры.</p>
        </div>
        <Link className="primary" to="/events/new">
          <Plus size={17} /> Создать мероприятие
        </Link>
      </div>
      <EventNotices />
      <div className="events-controls">
        <div className="event-tabs">
          {[
            ["upcoming", "Предстоящие"],
            ["mine", "Я организую"],
            ["participating", "Я участвую"],
            ["past", "Прошедшие"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={(params.get("scope") ?? "upcoming") === value}
              className={
                (params.get("scope") ?? "upcoming") === value ? "selected" : ""
              }
              onClick={() => filter("scope", value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            filter("q", query.trim());
          }}
        >
          <input
            aria-label="Поиск мероприятий"
            placeholder="Поиск по названию и описанию"
            maxLength={80}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Найти</button>
        </form>
        <label>
          Категория
          <select
            value={params.get("category") ?? ""}
            onChange={(e) => filter("category", e.target.value)}
          >
            <option value="">Все категории</option>
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {catalog.error && (
          <p role="alert" className="form-error">
            {catalog.error}
            <button onClick={() => void catalog.reload().catch(() => {})}>
              Повторить загрузку категорий
            </button>
          </p>
        )}
      </div>
      {loading ? (
        <div role="status" className="loading-page">
          Загружаем мероприятия…
        </div>
      ) : error ? (
        <div className="notice error-notice" role="alert">
          {error}
          <button onClick={() => setRetry((n) => n + 1)}>Повторить</button>
          <button onClick={() => setParams({})}>Сбросить фильтры</button>
        </div>
      ) : data?.events.length ? (
        <>
          <p className="field-help">
            Найдено: {data.total} · Время в вашем часовом поясе
          </p>
          <div className="event-grid">
            {data.events.map((e) => (
              <article className="event-card" key={e.id}>
                <div className="event-card-top">
                  <span className="pill">{e.category.name}</span>
                  <CalendarDays size={28} />
                </div>
                <div className="event-card-body">
                  <div className="section-heading">
                    <time dateTime={e.startsAt}>{eventDate(e.startsAt)}</time>
                    {e.pendingCount > 0 && (
                      <span className="notification-count">
                        Заявок: {e.pendingCount}
                      </span>
                    )}
                  </div>
                  <Link to={`/events/${e.id}`}>
                    <h2>{e.title}</h2>
                  </Link>
                  <p className="event-description-preview">{e.description}</p>
                  <div className="event-meta">
                    <span>
                      <MapPin size={15} />
                      {e.place}
                    </span>
                    <span>
                      <Users size={15} />
                      {e.participants} / {e.capacity} участников
                    </span>
                  </div>
                  <div className="event-organizer">
                    <Avatar user={e.organizer} />
                    <span>
                      {e.organizer.firstName} {e.organizer.lastName}
                    </span>
                  </div>
                  <div className="event-card-bottom">
                    <span className="field-help">{eventStatus(e)}</span>
                    <Link className="secondary" to={`/events/${e.id}`}>
                      Подробнее <ArrowUpRight size={15} />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="people-pagination">
            <button
              disabled={data.page <= 1}
              onClick={() =>
                setParams((p) => {
                  const n = new URLSearchParams(p);
                  n.set("page", String(data.page - 1));
                  return n;
                })
              }
            >
              Назад
            </button>
            <span>
              Страница {data.page} из {Math.ceil(data.total / data.limit)}
            </span>
            <button
              disabled={data.page * data.limit >= data.total}
              onClick={() =>
                setParams((p) => {
                  const n = new URLSearchParams(p);
                  n.set("page", String(data.page + 1));
                  return n;
                })
              }
            >
              Далее
            </button>
          </div>
        </>
      ) : (
        <div className="empty-people">
          <CalendarDays size={40} />
          <h2>Пока нет мероприятий</h2>
          <p>Создай своё мероприятие или попробуй другой раздел и фильтры.</p>
          <Link className="primary" to="/events/new">
            Создать мероприятие
          </Link>
        </div>
      )}
    </section>
  );
}
