import React from "react";
import { io } from "socket.io-client";
import { api, API_URL, getCsrf } from "./api";
import { useAuth } from "./Auth";
type State = {
  unread: number;
  phoneRequests: number;
  revision: number;
  accessRevision: number;
  status: "connecting" | "online" | "offline";
  refresh: () => void;
};
const Context = React.createContext<State>(null!);
export const useChat = () => React.useContext(Context);
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user, refresh: refreshAuth } = useAuth();
  const csrf = getCsrf();
  const [phoneRequests, setPhoneRequests] = React.useState(0);
  const [unread, setUnread] = React.useState(0);
  const [revision, setRevision] = React.useState(0);
  const [accessRevision, setAccessRevision] = React.useState(0);
  const [status, setStatus] = React.useState<State["status"]>("connecting");
  const refresh = React.useCallback(() => setRevision((n) => n + 1), []);
  React.useEffect(() => {
    setUnread(0);
    setPhoneRequests(0);
    if (!user?.emailVerifiedAt || !csrf) {
      setStatus("offline");
      return;
    }
    let active = true;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const socket = io(API_URL || window.location.origin, {
      withCredentials: true,
      tryAllTransports: true,
      auth: { csrfToken: csrf },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    function update() {
      if (!active) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (active) refresh();
      }, 60);
    }
    socket.on("connect", () => {
      setStatus("online");
      update();
    });
    socket.on("disconnect", (reason) => {
      if (!active) return;
      setStatus("offline");
      if (reason === "io server disconnect") void refreshAuth();
    });
    socket.on("connect_error", () => {
      if (active) setStatus("offline");
    });
    socket.on("chat:message", update);
    socket.on("chat:changed", update);
    socket.on("chat:access", () => {
      if (active) {
        setAccessRevision((n) => n + 1);
        update();
      }
    });
    const fallback = setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearInterval(fallback);
      window.removeEventListener("focus", update);
      socket.disconnect();
    };
  }, [user?.id, user?.emailVerifiedAt, csrf, refresh, refreshAuth]);
  React.useEffect(() => {
    if (!user?.emailVerifiedAt) return;
    let active = true;
    void api<{ unread: number; phoneRequests: number }>("/chat/unread")
      .then((v) => {
        if (active) {
          setUnread(v.unread);
          setPhoneRequests(v.phoneRequests);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [revision, user?.id, user?.emailVerifiedAt]);
  return (
    <Context.Provider
      value={{
        unread,
        phoneRequests,
        revision,
        accessRevision,
        status,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
