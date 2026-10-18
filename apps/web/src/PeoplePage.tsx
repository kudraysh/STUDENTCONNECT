import { StartChatButton } from "./StartChatButton";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  X,
  Users,
  ArrowUpRight,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import {
  api,
  ApiError,
  errorMessage,
  type PublicUser,
  type Interest,
} from "./api";
import { useAuth } from "./Auth";
import { Avatar, useCatalog } from "./ProfileFields";
type Person = PublicUser & { commonCount: number; commonInterests: Interest[] };
type People = { users: Person[]; total: number; page: number; limit: number };
function matches(n: number) {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? "общий интерес" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "общих интереса" : "общих интересов"}`;
}
export function PeoplePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const catalog = useCatalog();
  const [data, setData] = React.useState<People | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [needsInterests, setNeedsInterests] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [query, setQuery] = React.useState(params.get("q") ?? "");
  const [group, setGroup] = React.useState(params.get("group") ?? "");
  const requestKey = params.toString();
  const selected = (params.get("interests") ?? "").split(",").filter(Boolean);
  const category = params.get("category") ?? "";
  const course = params.get("course") ?? "";
  const filtersActive = ["q", "group", "course", "category", "interests"].some(
    (k) => !!params.get(k),
  );
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      value ? next.set(key, value) : next.delete(key);
      next.delete("page");
      return next;
    });
  }
  React.useEffect(() => {
    setQuery(params.get("q") ?? "");
    setGroup(params.get("group") ?? "");
  }, [requestKey]);
  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNeedsInterests(false);
    void api<People>(`/people?${requestKey}`, { signal: controller.signal })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active) {
          setError(errorMessage(error));
          setNeedsInterests(error instanceof ApiError && error.status === 409);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestKey, retry, user?.id, user?.interests.map((i) => i.id).join(",")]);
  function search(event: React.FormEvent) {
    event.preventDefault();
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [k, v] of [
        ["q", query.trim()],
        ["group", group.trim()],
      ]) {
        v ? next.set(k, v) : next.delete(k);
      }
      next.delete("page");
      return next;
    });
  }
  const visibleInterests = catalog.categories
    .filter((c) => !category || c.id === category)
    .flatMap((c) => c.interests);
  return (
    <section className="people-page">
      <div className="people-heading">
        <div>
          <span className="eyebrow">МИЭТ · КОЛЛЕДЖ</span>
          <h1>
            Найди <span>своих.</span>
          </h1>
          <p>Студенты, с которыми у тебя есть что-то общее.</p>
        </div>
        <div className="people-view-actions">
        <Link className="primary" to="/people/feed"><Sparkles size={17} /> Лента</Link>
        <Link className="secondary" to="/profile">
          Мои интересы <ArrowUpRight size={16} />
        </Link>
        </div>
      </div>
      <div className="people-layout">
        <aside className="people-filters">
          <div className="section-heading">
            <h2>
              <SlidersHorizontal size={17} /> Фильтры
            </h2>
            {filtersActive && (
              <button
                type="button"
                className="text-button"
                onClick={() => setParams({})}
              >
                Сбросить
              </button>
            )}
          </div>
          <form onSubmit={search}>
            <label>
              Имя или псевдоним
              <div className="people-search">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={60}
                  placeholder="Кого ищем?"
                />
              </div>
            </label>
            <label>
              Группа
              <input
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                maxLength={24}
                placeholder="Например, ИС-21"
              />
            </label>
            <button className="primary wide" type="submit">
              Найти студентов
            </button>
          </form>
          <label>
            Курс
            <select
              value={course}
              onChange={(e) => change("course", e.target.value)}
            >
              <option value="">Все курсы</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option value={n} key={n}>
                  {n} курс
                </option>
              ))}
            </select>
          </label>
          <label>
            Категория
            <select
              value={category}
              onChange={(e) => change("category", e.target.value)}
              disabled={catalog.loading || !!catalog.error}
            >
              <option value="">Все категории</option>
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-divider" />
          <h3>Конкретные интересы</h3>
          <p className="field-help">
            Совпадение хотя бы с одним выбранным интересом. До 20 интересов.
          </p>
          {catalog.loading ? (
            <p role="status">Загружаем интересы…</p>
          ) : catalog.error ? (
            <div className="form-error" role="alert">
              {catalog.error}
              <button onClick={() => void catalog.reload().catch(() => {})}>
                Повторить
              </button>
            </div>
          ) : (
            <div className="filter-interest-list">
              {visibleInterests.map((i) => (
                <label key={i.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(i.id)}
                    disabled={!selected.includes(i.id) && selected.length >= 20}
                    onChange={() =>
                      change(
                        "interests",
                        (selected.includes(i.id)
                          ? selected.filter((id) => id !== i.id)
                          : [...selected, i.id]
                        ).join(","),
                      )
                    }
                  />
                  {i.name}
                </label>
              ))}
            </div>
          )}
          {selected.length > 0 && (
            <button
              className="text-button"
              onClick={() => change("interests", "")}
            >
              <X size={14} /> Убрать выбранные ({selected.length})
            </button>
          )}
          <div className="filter-note">
            <Sparkles size={18} />
            <p>
              Сначала показываем тех, у кого больше общих интересов с тобой.
            </p>
          </div>
        </aside>
        <div className="people-results">
          <div className="results-toolbar">
            <span aria-live="polite">
              {loading
                ? "Ищем студентов…"
                : error
                  ? "Не удалось загрузить"
                  : `Найдено: ${data?.total ?? 0}`}
            </span>
            <label>
              Сортировка
              <select
                value={params.get("sort") ?? "matches"}
                onChange={(e) => change("sort", e.target.value)}
              >
                <option value="matches">По общим интересам</option>
                <option value="name">По фамилии</option>
              </select>
            </label>
          </div>
          {selected.length > 0 && (
            <div className="active-filters">
              {selected.map((id) => (
                <button
                  key={id}
                  onClick={() =>
                    change(
                      "interests",
                      selected.filter((x) => x !== id).join(","),
                    )
                  }
                >
                  {catalog.categories
                    .flatMap((c) => c.interests)
                    .find((i) => i.id === id)?.name ?? "Выбранный интерес"}
                  <X size={12} />
                </button>
              ))}
            </div>
          )}
          {loading ? (
            <div
              className="people-grid"
              role="status"
              aria-label="Загрузка студентов"
            >
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="person-skeleton">
                  <div />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="empty-people" role="alert">
              <Users size={35} />
              <h2>
                {needsInterests
                  ? "Сначала выбери интересы"
                  : "Не удалось загрузить студентов"}
              </h2>
              <p>{error}</p>
              {needsInterests ? (
                <Link className="primary" to="/profile">
                  Заполнить профиль
                </Link>
              ) : (
                <button onClick={() => setRetry((n) => n + 1)}>
                  Повторить
                </button>
              )}
            </div>
          ) : data?.users.length ? (
            <>
              <div className="people-grid">
                {data.users.map((person) => (
                  <article className="person-card" key={person.id}>
                    <div className="person-top">
                      <Link
                        aria-label={`Профиль: ${person.firstName} ${person.lastName}`}
                        to={`/users/${person.id}`}
                      >
                        <Avatar user={person} large />
                      </Link>
                      <span
                        className={`common-badge ${person.commonCount ? "has-common" : ""}`}
                      >
                        <Sparkles size={12} />
                        {matches(person.commonCount)}
                      </span>
                    </div>
                    <Link className="person-name" to={`/users/${person.id}`}>
                      <h2>
                        {person.firstName} {person.lastName}
                      </h2>
                    </Link>
                    <p className="person-nickname">
                      {person.nickname ? `@${person.nickname}` : "Студент МИЭТ"}
                    </p>
                    <span className="person-group">
                      {person.group} · {person.course} курс
                    </span>
                    <p className="person-bio">
                      {person.bio ||
                        "Пока без описания — начните с общих интересов."}
                    </p>
                    <div className="interest-chips">
                      {[
                        ...person.commonInterests,
                        ...person.interests.filter(
                          (i) =>
                            !person.commonInterests.some((c) => c.id === i.id),
                        ),
                      ]
                        .slice(0, 5)
                        .map((i) => (
                          <span
                            key={i.id}
                            className={`interest-chip ${person.commonInterests.some((c) => c.id === i.id) ? "selected" : ""}`}
                          >
                            {i.name}
                          </span>
                        ))}
                      {person.interests.length > 5 && (
                        <Link
                          className="extra-interests"
                          to={`/users/${person.id}`}
                        >
                          +{person.interests.length - 5}
                        </Link>
                      )}
                    </div>
                    <div className="person-actions">
                      <Link className="secondary" to={`/users/${person.id}`}>
                        Профиль <ArrowUpRight size={15} />
                      </Link>
                      <StartChatButton peerId={person.id} />
                    </div>
                  </article>
                ))}
              </div>
              <div className="people-pagination">
                <button
                  disabled={data.page <= 1}
                  onClick={() =>
                    setParams((previous) => {
                      const n = new URLSearchParams(previous);
                      n.set("page", String(data.page - 1));
                      return n;
                    })
                  }
                >
                  <ChevronLeft size={16} /> Назад
                </button>
                <span>
                  Страница {data.page} из {Math.ceil(data.total / data.limit)}
                </span>
                <button
                  disabled={data.page * data.limit >= data.total}
                  onClick={() =>
                    setParams((previous) => {
                      const n = new URLSearchParams(previous);
                      n.set("page", String(data.page + 1));
                      return n;
                    })
                  }
                >
                  Далее <ChevronRight size={16} />
                </button>
              </div>
              <p className="field-help">
                Нажми «Написать», чтобы познакомиться со студентом.
              </p>
            </>
          ) : (
            <div className="empty-people">
              <Users size={38} />
              <h2>
                {filtersActive
                  ? "Пока нет совпадений"
                  : data?.total
                    ? "На этой странице никого нет"
                    : "Будем знакомиться?"}
              </h2>
              <p>
                {filtersActive
                  ? "Попробуй убрать часть фильтров или изменить запрос."
                  : data?.total
                    ? "Вернись на первую страницу результатов."
                    : "Здесь появятся другие студенты с подтверждённой почтой и заполненными интересами. Для проверки создай второй аккаунт в другом браузере или инкогнито."}
              </p>
              {(filtersActive || !!data?.total) && (
                <button onClick={() => setParams({})}>Сбросить поиск</button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
