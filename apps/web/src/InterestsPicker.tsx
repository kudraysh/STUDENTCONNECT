import React from "react";
import { Check, Plus, Flag, Search } from "lucide-react";
import { api, errorMessage, type Category, type Interest } from "./api";
export function InterestsPicker({
  categories,
  selected,
  onChange,
  editable = false,
  reload,
}: {
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
  editable?: boolean;
  reload?: () => Promise<void>;
}) {
  const [categoryId, setCategory] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<Interest[]>([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState<Interest | null>(null);
  const [reason, setReason] = React.useState("");
  const [notice, setNotice] = React.useState("");
  React.useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void api<{ interests: Interest[] }>(
        `/interests?q=${encodeURIComponent(query)}`,
      )
        .then((data) => {
          if (active) setSuggestions(data.interests);
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  function toggle(id: string) {
    setError("");
    if (selected.includes(id)) onChange(selected.filter((v) => v !== id));
    else if (selected.length < 20) onChange([...selected, id]);
    else setError("Можно выбрать до 20 интересов");
  }
  const all = categories.flatMap((c) => c.interests);
  const filtered = all.filter(
    (i) =>
      (!categoryId || i.categoryId === categoryId) &&
      (!query ||
        i.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
        suggestions.some((s) => s.id === i.id)),
  );
  async function create() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api<{ interest: Interest; reused: boolean }>(
        "/interests",
        { method: "POST", body: { name: query, categoryId } },
      );
      await reload?.();
      if (!selected.includes(data.interest.id) && selected.length < 20)
        onChange([...selected, data.interest.id]);
      setQuery("");
      setNotice(
        data.reused
          ? "Нашли существующий интерес и выбрали его"
          : "Интерес создан и выбран",
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function submitReport() {
    setBusy(true);
    setError("");
    try {
      await api(`/interests/${report!.id}/report`, {
        method: "POST",
        body: { reason },
      });
      setReport(null);
      setReason("");
      setNotice("Жалоба сохранена для рассмотрения");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="interest-picker">
      <div className="section-heading">
        <h3>Твои интересы</h3>
        <span className="muted">Выбрано {selected.length} / 20</span>
      </div>
      <p className="field-help">
        Выбери хотя бы один конкретный интерес. Категории помогают найти нужное.
      </p>
      <div className="interest-search">
        <Search size={17} />
        <input
          aria-label="Поиск интересов"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Например, баскетбол или CS2"
          maxLength={40}
        />
      </div>
      <div className="category-tabs">
        <button
          type="button"
          className={!categoryId ? "selected" : ""}
          onClick={() => setCategory("")}
        >
          Все
        </button>
        {categories.map((c) => (
          <button
            type="button"
            className={categoryId === c.id ? "selected" : ""}
            key={c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="interest-chips">
        {filtered.map((i) => (
          <span className="chip-wrap" key={i.id}>
            <button
              type="button"
              aria-pressed={selected.includes(i.id)}
              className={`interest-chip ${selected.includes(i.id) ? "selected" : ""}`}
              onClick={() => toggle(i.id)}
            >
              {selected.includes(i.id) && <Check size={14} />} {i.name}
            </button>
            {editable && (
              <button
                type="button"
                className="report-icon"
                aria-label={`Пожаловаться на интерес ${i.name}`}
                onClick={() => {
                  setReport(i);
                  setError("");
                  setReason("");
                }}
              >
                <Flag size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!filtered.length && (
        <p className="field-help">Подходящих интересов пока нет.</p>
      )}
      {query && suggestions.length > 0 && (
        <p className="field-help">
          Похожие варианты: {suggestions.map((s) => s.name).join(", ")}
        </p>
      )}
      {editable && query.trim().length >= 2 && (
        <div className="create-interest">
          <p className="field-help">
            Сначала проверь похожие варианты и выбери категорию для нового
            интереса.
          </p>
          <button
            type="button"
            disabled={busy || !categoryId || selected.length >= 20}
            onClick={() => void create()}
          >
            <Plus size={16} /> Добавить «{query}»
          </button>
        </div>
      )}
      {!editable && (
        <p className="field-help">
          Создать собственный интерес можно в профиле после подтверждения почты.
        </p>
      )}
      {report && (
        <div className="report-box">
          <h4>Жалоба: {report.name}</h4>
          <label>
            Что не так с интересом?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Опиши причину, минимум 10 символов"
            />
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={busy || reason.trim().length < 10}
              onClick={() => void submitReport()}
            >
              Отправить жалобу
            </button>
            <button type="button" onClick={() => setReport(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
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
    </div>
  );
}
