import React from "react";
import { Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { ArrowRight, MailCheck, ShieldCheck } from "lucide-react";
import {
  api,
  ApiError,
  errorMessage,
  type Delivery,
  type Session,
} from "./api";
import { useAuth } from "./Auth";
import { InterestsPicker } from "./InterestsPicker";
import { blankProfile, ProfileFields, useCatalog } from "./ProfileFields";
export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = React.useState(blankProfile);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [step, setStep] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const catalog = useCatalog();
  if (auth.loading)
    return (
      <p className="loading-page" role="status">
        Проверяем сессию…
      </p>
    );
  if (auth.error)
    return (
      <div className="notice error-notice" role="alert">
        {auth.error}
        <button onClick={() => void auth.refresh()}>Повторить</button>
      </div>
    );
  if (auth.user)
    return (
      <Navigate replace to={auth.user.emailVerifiedAt ? "/" : "/pending"} />
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    if (
      password.length < 10 ||
      !/\p{L}/u.test(password) ||
      !/[0-9]/.test(password)
    ) {
      setStep(1);
      setError("Пароль: минимум 10 символов, хотя бы одна буква и цифра");
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    if (!profile.interestIds.length) {
      setError("Выбери хотя бы один конкретный интерес");
      return;
    }
    setBusy(true);
    try {
      const session = await api<Session>("/auth/register", {
        method: "POST",
        body: { ...profile, email, password },
      });
      auth.accept(session);
      navigate("/pending", {
        replace: true,
        state: { delivery: session.delivery },
      });
    } catch (error) {
      if (error instanceof ApiError && error.fields?.password?.length) {
        setStep(1);
        setError(`Пароль: ${error.fields.password[0]}`);
      } else setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-layout">
      <aside className="auth-story">
        <span className="eyebrow">ДОБРО ПОЖАЛОВАТЬ В STUDENTCONNECT</span>
        <h1>
          Знакомства
          <br />
          начинаются
          <br />
          <span>с тебя.</span>
        </h1>
        <p>
          Расскажи немного о себе — так будущим друзьям будет проще тебя найти.
        </p>
        <div className="story-note">
          <ShieldCheck size={23} />
          <p>
            Почту видишь только ты.
            <br />
            Телефон скрыт от других студентов.
          </p>
        </div>
        <div className="step-list">
          <span className={step === 1 ? "current" : ""}>01 · О тебе</span>
          <span className={step === 2 ? "current" : ""}>02 · Интересы</span>
        </div>
      </aside>
      <div className="form-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ШАГ {step} ИЗ 2</span>
            <h2>{step === 1 ? "Давай знакомиться" : "Что тебя увлекает?"}</h2>
          </div>
          <span className="pill">МИЭТ · Колледж</span>
        </div>
        <form onSubmit={(e) => void submit(e)}>
          <fieldset disabled={busy}>
            {step === 1 ? (
              <>
                <ProfileFields value={profile} onChange={setProfile} />
                <label>
                  Электронная почта
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={254}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                  <span className="field-help">
                    От 10 символов, минимум одна буква и цифра.
                  </span>
                </label>
                <label>
                  Повтори пароль
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : (
              <>
                {catalog.loading ? (
                  <p role="status">Загружаем интересы…</p>
                ) : catalog.error ? (
                  <div className="notice error-notice">
                    {catalog.error}
                    <button
                      type="button"
                      onClick={() => void catalog.reload().catch(() => {})}
                    >
                      Повторить
                    </button>
                  </div>
                ) : (
                  <InterestsPicker
                    categories={catalog.categories}
                    selected={profile.interestIds}
                    onChange={(ids) =>
                      setProfile({ ...profile, interestIds: ids })
                    }
                  />
                )}
                <details>
                  <summary>
                    Добавить фото и другие данные · необязательно
                  </summary>
                  <ProfileFields
                    optional
                    value={profile}
                    onChange={setProfile}
                  />
                </details>
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="actions">
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError("");
                  }}
                >
                  Назад
                </button>
              )}
              <button
                className="primary"
                type="submit"
                disabled={
                  busy ||
                  (step === 2 &&
                    (!profile.interestIds.length ||
                      !!catalog.error ||
                      catalog.loading))
                }
              >
                {busy
                  ? "Создаём аккаунт…"
                  : step === 1
                    ? "Продолжить"
                    : "Создать аккаунт"}
                <ArrowRight size={17} />
              </button>
            </div>
          </fieldset>
        </form>
        <p className="form-bottom">
          Уже зарегистрирован? <Link to="/login">Войти</Link>
        </p>
      </div>
    </section>
  );
}
export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  if (auth.loading)
    return (
      <p className="loading-page" role="status">
        Проверяем сессию…
      </p>
    );
  if (auth.error)
    return (
      <div className="notice error-notice" role="alert">
        {auth.error}
        <button onClick={() => void auth.refresh()}>Повторить</button>
      </div>
    );
  if (auth.user)
    return (
      <Navigate replace to={auth.user.emailVerifiedAt ? "/" : "/pending"} />
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api<Session>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      auth.accept(session);
      await auth.refresh();
      navigate(session.user.emailVerifiedAt ? "/" : "/pending", {
        replace: true,
      });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-layout login-layout">
      <aside className="auth-story">
        <span className="eyebrow">ТВОЁ СТУДЕНЧЕСКОЕ СООБЩЕСТВО</span>
        <h1>
          Рады видеть
          <br />
          <span>тебя снова.</span>
        </h1>
        <p>Твои интересы — начало чего-то общего.</p>
      </aside>
      <div className="form-card">
        <h2>Вход в StudentConnect</h2>
        <p>Введи почту и пароль своего аккаунта.</p>
        <form onSubmit={(e) => void submit(e)}>
          <fieldset disabled={busy}>
            <label>
              Электронная почта
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={128}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Входим…" : "Войти"}
              <ArrowRight size={17} />
            </button>
          </fieldset>
        </form>
        <p className="form-bottom">
          Ещё нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </section>
  );
}
export function PendingPage() {
  const { user, mailMode, refresh, logout } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [delivery, setDelivery] = React.useState<Delivery | null>(
    (location.state as { delivery?: Delivery } | null)?.delivery ?? null,
  );
  const [notice, setNotice] = React.useState("");
  const manual = (delivery?.mode ?? mailMode) === "manual";
  if (user?.emailVerifiedAt) return <Navigate replace to="/" />;
  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api<{ delivery: Delivery }>(
        "/auth/resend-verification",
        { method: "POST", body: {} },
      );
      setDelivery(data.delivery);
      setNotice(
        data.delivery.sent
          ? "Новая ссылка подготовлена. Она действует 24 часа."
          : "Не удалось отправить письмо. Проверь настройки почты и повтори через минуту.",
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    await refresh();
    setBusy(false);
    setNotice(
      "Статус обновлён. Если подтверждение завершено, откроется главная страница.",
    );
  }
  return (
    <section className="center-card">
      <span className="round-icon">
        <MailCheck size={32} />
      </span>
      <h1>{manual ? "Ожидается допуск к демо" : "Подтверди почту"}</h1>
      <p>
        Аккаунт <strong>{user?.email}</strong> создан. {manual ? "Для входа нужен допуск организатора тестирования." : "Осталось подтвердить, что эта почта принадлежит тебе."}
      </p>
      {manual ? (
        <div className="notice"><strong>Закрытое тестирование</strong><p>Письмо не отправляется. Сообщи организатору тестирования адрес, указанный при регистрации. Он подтвердит твой аккаунт вручную. Затем нажми «Проверить допуск».</p></div>
      ) : (delivery?.mode ?? mailMode) === "console" ? (
        <div className="notice">
          <strong>Режим локальной разработки</strong>
          <p>
            Настоящее письмо не отправляется. Найди в терминале VS Code строку
            «ТЕСТОВАЯ ПОЧТА» и открой ссылку после «Подтвердить:». Ссылка
            действует 24 часа.
          </p>
        </div>
      ) : (
        <div className="notice">
          <p>
            Открой письмо StudentConnect и перейди по ссылке. Проверь папку
            «Спам». Если письмо не пришло, запроси его ещё раз.
          </p>
        </div>
      )}
      {!manual && delivery?.sent === false && (
        <p role="alert" className="form-error">
          Письмо не отправлено. Аккаунт сохранён. Проверь настройки почты и
          запроси письмо повторно через минуту.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="stack-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void check()}
        >
          {manual ? "Проверить допуск" : "Я подтвердил почту"}
        </button>
        {!manual && <button disabled={busy} onClick={() => void resend()}>
          Отправить ссылку ещё раз
        </button>}
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void logout().catch((e) => setError(errorMessage(e)))}
        >
          Выйти из аккаунта
        </button>
      </div>
    </section>
  );
}
export function VerifyPage() {
  const auth = useAuth();
  const [token] = React.useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);
  React.useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  async function verify() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/verify-email", { method: "POST", body: { token } });
      setSuccess(true);
      await auth.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="center-card">
      <span className="round-icon">
        <MailCheck size={32} />
      </span>
      <h1>{success ? "Почта подтверждена" : "Один шаг — и ты с нами"}</h1>
      <p>
        {success
          ? "Теперь можно заполнить профиль и выбрать интересы."
          : "Нажми кнопку, чтобы подтвердить электронную почту."}
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!token && !success && (
        <p role="alert" className="form-error">
          В ссылке нет токена. Открой полную ссылку из письма или терминала.
        </p>
      )}
      {success ? (
        <Link
          className="primary"
          to={auth.user?.emailVerifiedAt ? "/profile" : "/login"}
        >
          {auth.user?.emailVerifiedAt ? "Перейти в профиль" : "Войти в аккаунт"}
        </Link>
      ) : (
        <button
          className="primary"
          disabled={!token || busy}
          onClick={() => void verify()}
        >
          {busy ? "Подтверждаем…" : "Подтвердить почту"}
        </button>
      )}
      <p>
        <Link to={auth.user ? "/pending" : "/login"}>Вернуться в аккаунт</Link>
      </p>
    </section>
  );
}
