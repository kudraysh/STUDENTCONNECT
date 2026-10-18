import { StartChatButton } from "./StartChatButton";
import React from "react";
import { Link, useParams } from "react-router-dom";
import { Save, Eye, ShieldCheck } from "lucide-react";
import { api, errorMessage, type PublicUser, type User } from "./api";
import { useAuth } from "./Auth";
import {
  Avatar,
  ProfileFields,
  profileInput,
  useCatalog,
} from "./ProfileFields";
import { InterestsPicker } from "./InterestsPicker";
export function ProfilePage() {
  const { user, update } = useAuth();
  const [value, setValue] = React.useState(() => profileInput(user!));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const catalog = useCatalog();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const data = await api<{ user: User }>("/profile", {
        method: "PATCH",
        body: value,
      });
      update(data.user);
      setValue(profileInput(data.user));
      setSaved(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span>
          <h1>Мой профиль</h1>
          <p>Покажи, что тебе близко, и находи своих.</p>
        </div>
        <Link className="secondary" to={`/users/${user!.id}`}>
          <Eye size={17} /> Как видят другие
        </Link>
      </div>
      <div className="profile-layout">
        <aside className="profile-sidebar">
          <Avatar user={{ ...value }} large />
          <h2>
            {value.firstName} {value.lastName}
          </h2>
          <p>{value.nickname ? `@${value.nickname}` : "Псевдоним не указан"}</p>
          <span className="pill">
            {value.group} · {value.course} курс
          </span>
          <div className="privacy-note">
            <ShieldCheck size={22} />
            <div>
              <strong>Личные данные под защитой</strong>
              <p>
                Почта видна только тебе. Доступ к телефону ты разрешаешь и
                отзываешь отдельно для каждого собеседника в чате.
              </p>
            </div>
          </div>
          <div className="private-email">
            <span className="field-help">Твоя почта · подтверждена</span>
            <p>{user!.email}</p>
          </div>
        </aside>
        <form
          className="form-card profile-form"
          onSubmit={(e) => void submit(e)}
        >
          <fieldset disabled={busy}>
            <h2>Основная информация</h2>
            <ProfileFields
              value={value}
              onChange={(v) => {
                setValue(v);
                setSaved(false);
              }}
            />
            <ProfileFields
              optional
              value={value}
              onChange={(v) => {
                setValue(v);
                setSaved(false);
              }}
            />
            <div className="form-divider" />
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
                selected={value.interestIds}
                onChange={(ids) => {
                  setValue({ ...value, interestIds: ids });
                  setSaved(false);
                }}
                editable
                reload={catalog.reload}
              />
            )}
            <div className="form-divider" />
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="form-success">
                Изменения сохранены
              </p>
            )}
            <button
              className="primary"
              disabled={
                busy ||
                !value.interestIds.length ||
                catalog.loading ||
                !!catalog.error
              }
            >
              <Save size={17} />
              {busy ? "Сохраняем…" : "Сохранить изменения"}
            </button>
          </fieldset>
        </form>
      </div>
    </>
  );
}
export function PublicProfilePage() {
  const { user: viewer } = useAuth();
  const { id } = useParams();
  const [user, setUser] = React.useState<PublicUser | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let active = true;
    setUser(null);
    setError("");
    void api<{ user: PublicUser }>(`/users/${encodeURIComponent(id ?? "")}`)
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  if (error)
    return (
      <div role="alert" className="notice error-notice">
        {error}
        <p>
          <Link to="/">К списку студентов</Link>
        </p>
      </div>
    );
  if (!user)
    return (
      <p role="status" className="loading-page">
        Загружаем профиль…
      </p>
    );
  return (
    <section className="public-profile form-card">
      <span className="eyebrow">ПУБЛИЧНЫЙ ПРОФИЛЬ</span>
      <Avatar user={user} large />
      <h1>
        {user.firstName} {user.lastName}
      </h1>
      {user.nickname && <p>@{user.nickname}</p>}
      <span className="pill">
        {user.group} · {user.course} курс
      </span>
      <p className="bio">{user.bio || "Пока без описания"}</p>
      <h2>Интересы</h2>
      <div className="interest-chips">
        {user.interests.map((i) => (
          <span className="interest-chip selected" key={i.id}>
            {i.name}
          </span>
        ))}
      </div>
      <p className="field-help">
        Почта и телефон в публичном профиле не отображаются.
      </p>
      {viewer?.id !== user.id && <StartChatButton peerId={user.id} />}
      <Link className="secondary" to="/">
        К списку студентов
      </Link>
    </section>
  );
}
