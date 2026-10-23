import React from "react";
import { Camera, UserRound } from "lucide-react";
import { api, type Category, type User, errorMessage } from "./api";
export type ProfileInput = {
  firstName: string;
  lastName: string;
  nickname: string;
  group: string;
  course: number;
  phone: string;
  bio: string;
  avatar: string | null;
  interestIds: string[];
};
export const blankProfile: ProfileInput = {
  firstName: "",
  lastName: "",
  nickname: "",
  group: "",
  course: 1,
  phone: "",
  bio: "",
  avatar: null,
  interestIds: [],
};
export function profileInput(user: User): ProfileInput {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    nickname: user.nickname ?? "",
    group: user.group,
    course: user.course,
    phone: user.phone ?? "",
    bio: user.bio,
    avatar: user.avatar,
    interestIds: user.interests.map((i) => i.id),
  };
}
export function useCatalog() {
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const reload = React.useCallback(async () => {
    setError("");
    try {
      setCategories(
        (await api<{ categories: Category[] }>("/catalog")).categories,
      );
    } catch (error) {
      setError(errorMessage(error));
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);
  return { categories, error, loading, reload };
}
export function Avatar({
  user,
  large = false,
}: {
  user: { avatar: string | null; firstName: string; lastName: string };
  large?: boolean;
}) {
  return user.avatar ? (
    <img
      className={`avatar ${large ? "large" : ""}`}
      src={user.avatar}
      alt={`${user.firstName} ${user.lastName}`}
    />
  ) : (
    <span
      className={`avatar ${large ? "large" : ""}`}
      aria-label="Аватар по умолчанию"
    >
      {user.firstName ? (
        `${user.firstName[0]}${user.lastName[0] ?? ""}`
      ) : (
        <UserRound size={large ? 40 : 20} />
      )}
    </span>
  );
}
export function ProfileFields({
  value,
  onChange,
  optional = false,
}: {
  value: ProfileInput;
  onChange: (value: ProfileInput) => void;
  optional?: boolean;
}) {
  const [imageError, setImageError] = React.useState("");
  const [imageLoading, setImageLoading] = React.useState(false);
  const field = (key: keyof ProfileInput, v: string | number | null) =>
    onChange({ ...value, [key]: v });
  async function photo(file?: File) {
    if (!file) return;
    setImageError("");
    if (
      file.size > 1000000 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      setImageError("Выберите JPEG, PNG или WebP до 1 МБ");
      return;
    }
    setImageLoading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
      });
      field("avatar", data);
    } catch {
      setImageError("Не удалось прочитать фото");
    } finally {
      setImageLoading(false);
    }
  }
  if (optional)
    return (
      <>
        <div className="photo-editor">
          <Avatar user={value} large />
          <div>
            <label className="photo-button">
              <Camera size={16} /> {imageLoading ? "Загрузка…" : "Выбрать фото"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void photo(e.target.files?.[0])}
              />
            </label>
            <p className="field-help">JPEG, PNG или WebP · до 1 МБ</p>
            {value.avatar && (
              <button
                className="text-button"
                type="button"
                onClick={() => field("avatar", null)}
              >
                Удалить фото
              </button>
            )}
          </div>
        </div>
        {imageError && (
          <p role="alert" className="form-error">
            {imageError}
          </p>
        )}
        <label>
          Псевдоним
          <input
            value={value.nickname}
            onChange={(e) => field("nickname", e.target.value)}
            placeholder="Например, ilya_dev"
            maxLength={24}
            autoComplete="nickname"
          />
          <span className="field-help">
            3–24 латинские буквы, цифры или _. Должен быть уникальным.
          </span>
        </label>
        <label>
          Телефон{" "}
          <span className="private-label">Скрыт до твоего разрешения</span>
          <input
            type="tel"
            value={value.phone}
            onChange={(e) => field("phone", e.target.value)}
            autoComplete="tel"
            maxLength={30}
            placeholder="+7 900 000-00-00"
          />
        </label>
        <label>
          О себе
          <textarea
            value={value.bio}
            onChange={(e) => field("bio", e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Чем увлекаешься и кого хочешь найти?"
          />
          <span className="field-help">{value.bio.length} / 500</span>
        </label>
      </>
    );
  return (
    <>
      <div className="form-row">
        <label>
          Имя
          <input
            value={value.firstName}
            onChange={(e) => field("firstName", e.target.value)}
            required
            maxLength={50}
            autoComplete="given-name"
          />
        </label>
        <label>
          Фамилия
          <input
            value={value.lastName}
            onChange={(e) => field("lastName", e.target.value)}
            required
            maxLength={50}
            autoComplete="family-name"
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Учебная группа
          <input
            value={value.group}
            onChange={(e) => field("group", e.target.value)}
            required
            minLength={2}
            maxLength={24}
            placeholder="ИС-21"
          />
        </label>
        <label>
          Курс
          <select
            value={value.course}
            onChange={(e) => field("course", Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <option key={v} value={v}>
                {v} курс
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
