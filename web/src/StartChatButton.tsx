import React from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { api, errorMessage } from "./api";
export function StartChatButton({ peerId }: { peerId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ id: string }>("/chat/conversations", {
        method: "POST",
        body: { peerId },
      });
      navigate(`/messages/${data.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-start-wrap">
      <button disabled={busy} onClick={() => void start()}>
        <MessageCircle size={16} />
        {busy ? "Открываем…" : "Написать"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
