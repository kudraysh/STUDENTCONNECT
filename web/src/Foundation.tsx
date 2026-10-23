import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Database,
  RefreshCw,
  GraduationCap,
} from "lucide-react";
import { API_URL as api } from "./api";
type State = "loading" | "ok" | "error";
export function Foundation() {
  const [status, setStatus] = React.useState<{ api: State; db: State }>({
    api: "loading",
    db: "loading",
  });
  const [attempt, retry] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    setStatus({ api: "loading", db: "loading" });
    async function check(path: string, field: "api" | "db") {
      try {
        const response = await fetch(`${api}/api/${path}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (
          !response.ok ||
          data.status !== "ok" ||
          (field === "db" && data.database !== "connected")
        )
          throw new Error();
        if (active) setStatus((s) => ({ ...s, [field]: "ok" }));
      } catch {
        if (active) setStatus((s) => ({ ...s, [field]: "error" }));
      }
    }
    let active = true;
    void Promise.all([check("health", "api"), check("ready", "db")]).finally(
      () => clearTimeout(timer),
    );
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);
  const label = (s: State) =>
    s === "loading" ? "Проверяем…" : s === "ok" ? "Подключено" : "Недоступно";
  return (
    <>
      <div className="eyebrow">МИЭТ · СТУДЕНЧЕСКОЕ СООБЩЕСТВО</div>
      <section className="hero">
        <div>
          <span className="pill">Этап 03 / Найди своих</span>
          <h1>
            Свои люди.
            <br />
            <span>Общие интересы.</span>
          </h1>
          <p>
            Место, где знакомство начинается с того, что вам нравится. Создай
            профиль и расскажи, что тебя увлекает.
          </p>
          <div className="actions">
            <Link className="primary" to="/register">
              Присоединиться <ArrowUpRight size={18} />
            </Link>
            <Link className="secondary" to="/login">
              Уже есть аккаунт
            </Link>
          </div>
        </div>
        <div className="art" aria-hidden="true">
          <div className="orbit o1" />
          <div className="orbit o2" />
          <div className="bubble b1">&lt;/&gt;</div>
          <div className="bubble b2">🏀</div>
          <div className="bubble b3">♫</div>
          <div className="center-logo">
            <GraduationCap size={66} />
          </div>
          <div className="art-label">На одной волне ✦</div>
        </div>
      </section>
      <section className="connection" id="connection">
        <div className="section-heading">
          <div>
            <h2>Всё начинается с подключения</h2>
            <p>Реальное состояние компонентов приложения</p>
          </div>
          <button aria-label="Повторить проверку" onClick={retry}>
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="status-grid" aria-live="polite">
          {(
            [
              ["api", "Сервер приложения", "Express · Node.js"],
              ["db", "База данных", "PostgreSQL · Prisma"],
            ] as const
          ).map(([key, title, description]) => (
            <div className="status-card" key={key}>
              <Database size={24} />
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <span className={`state ${status[key]}`}>
                {label(status[key])}
              </span>
            </div>
          ))}
        </div>
        {status.db === "error" && (
          <p className="hint">
            Запустите PostgreSQL и примените миграции по инструкции в README.
            Статус обновляется по ответу сервера.
          </p>
        )}
      </section>
      <section className="next">
        <div>
          <span className="eyebrow">ЧТО ДАЛЬШЕ</span>
          <h2>
            От первого знакомства
            <br />
            до общих планов
          </h2>
          <p>Начни с профиля. Находи студентов по общим интересам.</p>
        </div>
        <div className="roadmap">
          {[
            "Профиль и интересы — доступны",
            "Поиск студентов — доступен",
            "Мероприятия и чат — доступны",
            "Общие уведомления — доступны",
          ].map((s, i) => (
            <div key={s}>
              <span>0{i + 2}</span>
              {s}
            </div>
          ))}
          <div className="done">
            <Check size={18} /> Сейчас: знакомства, мероприятия и общение
          </div>
        </div>
      </section>
    </>
  );
}
