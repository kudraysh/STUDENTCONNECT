import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { api, errorMessage } from "./api";
import { useCatalog } from "./ProfileFields";
import type { EventData } from "./eventsApi";
export function CreateEventPage() {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [value, setValue] = React.useState({
    title: "",
    description: "",
    place: "",
    startsAt: "",
    capacity: 6,
    categoryId: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const date = new Date(value.startsAt);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
        throw new Error("Выбери дату и время в будущем");
      const data = await api<{ event: EventData }>("/events", {
        method: "POST",
        body: { ...value, startsAt: date.toISOString() },
      });
      navigate(`/events/${data.event.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="event-form-wrap">
      <Link className="text-button" to="/events">
        ← Все мероприятия
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ТВОЯ ИДЕЯ — ОБЩИЙ ПЛАН</span>
          <h1>Создать мероприятие</h1>
          <p>Расскажи, что, где и когда вы будете делать.</p>
        </div>
      </div>
      <form className="form-card" onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <label>
            Название
            <input
              required
              minLength={5}
              maxLength={100}
              placeholder="Например, баскетбол после пар"
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </label>
          <label>
            Описание
            <textarea
              required
              minLength={10}
              maxLength={2000}
              rows={5}
              placeholder="Кого ищешь, что планируете и что взять с собой?"
              value={value.description}
              onChange={(e) =>
                setValue({ ...value, description: e.target.value })
              }
            />
          </label>
          <label>
            Категория
            <select
              required
              value={value.categoryId}
              onChange={(e) =>
                setValue({ ...value, categoryId: e.target.value })
              }
            >
              <option value="">Выбери категорию</option>
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
              <button
                type="button"
                onClick={() => void catalog.reload().catch(() => {})}
              >
                Повторить
              </button>
            </p>
          )}
          <div className="form-row">
            <label>
              Дата и время
              <input
                type="datetime-local"
                required
                value={value.startsAt}
                onChange={(e) =>
                  setValue({ ...value, startsAt: e.target.value })
                }
              />
              <span className="field-help">
                В твоём часовом поясе, на сервере сохраняется UTC.
              </span>
            </label>
            <label>
              Всего участников
              <input
                type="number"
                required
                min={2}
                max={200}
                value={value.capacity}
                onChange={(e) =>
                  setValue({ ...value, capacity: Number(e.target.value) })
                }
              />
              <span className="field-help">
                От 2 до 200, включая тебя как организатора.
              </span>
            </label>
          </div>
          <label>
            Место
            <input
              required
              minLength={3}
              maxLength={200}
              placeholder="Площадка у колледжа или адрес встречи"
              value={value.place}
              onChange={(e) => setValue({ ...value, place: e.target.value })}
            />
          </label>
          <div className="notice">
            <p>
              Ты автоматически становишься участником. Остальные подают заявки —
              решение принимаешь ты. После начала мероприятия изменение состава
              закрывается.
            </p>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || catalog.loading || !!catalog.error}
          >
            <CalendarPlus size={17} />
            {busy ? "Создаём…" : "Опубликовать мероприятие"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
