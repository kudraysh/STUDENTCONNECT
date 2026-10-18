import React from "react";
import { Link } from "react-router-dom";
import { Phone, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "./api";
import { useChat } from "./ChatContext";
import type { ChatDetails, Grant } from "./chatTypes";
export function ChatPhone({
  details,
  onInvalidate,
}: {
  details: ChatDetails;
  onInvalidate: () => void;
}) {
  const { refresh } = useChat();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  async function action(path: string, body: object = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, { method: "POST", body });
      onInvalidate();
      refresh();
      setNotice("Статус доступа обновлён");
    } catch (e) {
      setError(errorMessage(e));
      onInvalidate();
      refresh();
    } finally {
      setBusy(false);
    }
  }
  function decide(grant: Grant, decision: string) {
    void action(`/chat/phone/${grant.id}/${decision}`, {
      version: grant.version,
    });
  }
  return (
    <details className="chat-phone">
      <summary>
        <Phone size={15} /> Телефон и разрешения
      </summary>
      {details.phone ? (
        <div className="phone-visible">
          <ShieldCheck size={17} />
          <a href={`tel:${details.phone.replace(/[^+0-9]/g, "")}`}>
            {details.phone}
          </a>
          <span>Владелец разрешил просмотр только тебе</span>
        </div>
      ) : details.peer.hasPhone ? (
        <div>
          <p className="field-help">
            Номер скрыт. Собеседник решает, кому его показывать.
          </p>
          {details.outgoing?.status === "PENDING" ? (
            <p className="phone-status">Запрос отправлен. Ожидаем решения.</p>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void action(`/chat/conversations/${details.id}/phone`)
                }
              >
                Запросить номер
              </button>
              {details.outgoing?.status === "REJECTED" && (
                <p className="field-help">
                  Запрос отклонён. Повторный запрос доступен через минуту.
                </p>
              )}
              {details.outgoing?.status === "REVOKED" && (
                <p className="field-help">
                  Разрешение отозвано. Повторный запрос доступен через минуту.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="field-help">Собеседник не указал номер телефона.</p>
      )}
      {details.incoming?.status === "PENDING" && (
        <div className="incoming-phone">
          <strong>{details.peer.firstName} просит твой номер</strong>
          <p className="field-help">
            Одобрение откроет номер из твоего профиля только этому студенту.
          </p>
          <div className="actions">
            <button
              disabled={busy || !details.hasOwnPhone}
              onClick={() => decide(details.incoming!, "approve")}
            >
              Разрешить
            </button>
            <button
              disabled={busy}
              onClick={() => decide(details.incoming!, "reject")}
            >
              Отклонить
            </button>
          </div>
        </div>
      )}
      {details.incoming?.status === "APPROVED" && (
        <div className="incoming-phone">
          <p>Этому студенту разрешён просмотр твоего номера.</p>
          <button
            disabled={busy}
            onClick={() => decide(details.incoming!, "revoke")}
          >
            Отозвать разрешение
          </button>
        </div>
      )}
      {!details.hasOwnPhone && (
        <p className="field-help">
          Свой номер можно добавить в <Link to="/profile">профиле</Link>.
        </p>
      )}
      <p className="field-help">
        Смена или удаление своего номера автоматически отзывает разрешения.
        Почта через эту функцию не раскрывается.
      </p>
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
