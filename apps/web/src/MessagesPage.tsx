import {ReportButton,UserSafety} from "./Safety";
import { newClientId } from "./clientIds";
import React from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { MessageCircle, Send, ArrowLeft, RefreshCw } from "lucide-react";
import { api, errorMessage } from "./api";
import { useAuth } from "./Auth";
import { useChat } from "./ChatContext";
import { Avatar } from "./ProfileFields";
import { ChatPhone } from "./ChatPhone";
import {
  messageTime,
  messageDay,
  type Message,
  type Dialog,
  type ChatDetails,
} from "./chatTypes";
function merge(a: Message[], b: Message[]) {
  return [...new Map([...a, ...b].map((m) => [m.id, m])).values()].sort(
    (x, y) => x.id - y.id,
  );
}
export function MessagesPage() {
  const { id } = useParams();
  const { revision, status } = useChat();
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{
    conversations: Dialog[];
    total: number;
  } | null>(null);
  const [error, setError] = React.useState("");
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    void api<{ conversations: Dialog[]; total: number }>(
      `/chat/conversations?page=${page}`,
    )
      .then((v) => {
        if (active) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [page, revision, attempt]);
  return (
    <section className={`messages-page ${id ? "has-thread" : ""}`}>
      <div className="chat-title">
        <div>
          <span className="eyebrow">НА ОДНОЙ ВОЛНЕ</span>
          <h1>Сообщения</h1>
        </div>
        <span className={`connection-dot ${status}`}>
          {status === "online"
            ? "На связи"
            : status === "connecting"
              ? "Подключаемся…"
              : "Переподключаемся…"}
        </span>
      </div>
      <div className="chat-layout">
        <aside className="dialog-sidebar">
          <div className="section-heading">
            <h2>Диалоги</h2>
            <button
              aria-label="Обновить диалоги"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RefreshCw size={15} />
            </button>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {!data && !error ? (
            <p role="status">Загрузка…</p>
          ) : data?.conversations.length ? (
            <div className="dialog-list">
              {data.conversations.map((d) => (
                <NavLink
                  to={`/messages/${d.id}`}
                  key={d.id}
                  className={({ isActive }) =>
                    `dialog ${isActive ? "current" : ""}`
                  }
                >
                  <Avatar user={d.peer} />
                  <span className="dialog-copy">
                    <strong>
                      {d.peer.firstName} {d.peer.lastName}
                    </strong>
                    <small>
                      {d.phoneRequest
                        ? "Новый запрос твоего номера"
                        : (d.lastMessage?.text ?? "Начните знакомство")}
                    </small>
                  </span>
                  <span className="dialog-tail">
                    {d.lastMessage && (
                      <time>{messageTime(d.lastMessage.createdAt)}</time>
                    )}
                    {d.unread > 0 && (
                      <b className="notification-count">{d.unread}</b>
                    )}
                  </span>
                </NavLink>
              ))}
            </div>
          ) : (
            <div className="no-dialogs">
              <MessageCircle size={30} />
              <p>Начни знакомство со страницы «Люди».</p>
              <Link to="/">Найти студентов</Link>
            </div>
          )}
          {data && data.total > 30 && (
            <div className="dialog-pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((n) => n - 1)}
              >
                Назад
              </button>
              <span>{page}</span>
              <button
                disabled={page * 30 >= data.total}
                onClick={() => setPage((n) => n + 1)}
              >
                Далее
              </button>
            </div>
          )}
        </aside>
        {id ? (
          <Thread key={id} id={id} />
        ) : (
          <div className="empty-chat">
            <MessageCircle size={48} />
            <h2>Разговор начинается с «привет»</h2>
            <p>Выбери диалог или напиши студенту в разделе «Люди».</p>
            <Link className="primary" to="/">
              Найти своих
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
function Thread({ id }: { id: string }) {
  const { user } = useAuth();
  const { revision, accessRevision, refresh, status } = useChat();
  const [details, setDetails] = React.useState<ChatDetails | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const messagesRef = React.useRef<Message[]>([]);
  const lastRead = React.useRef(0);
  const [hasOlder, setHasOlder] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [olderBusy, setOlderBusy] = React.useState(false);
  const [text, setText] = React.useState("");
  const [reply,setReply]=React.useState<Message|null>(null);
  const [editing,setEditing]=React.useState<Message|null>(null);
  const [emojiOpen,setEmojiOpen]=React.useState(false);
  const [actionBusy,setActionBusy]=React.useState(false);
  const composer=React.useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState("");
  const pending = React.useRef<{ text: string; clientId: string;replyToId?:number } | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const nearBottom = React.useRef(true);
  const update = React.useCallback((rows: Message[], replace = false) => {
    const next = replace ? rows : merge(messagesRef.current, rows);
    messagesRef.current = next;
    setMessages(next);
  }, []);
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      api<ChatDetails>(`/chat/conversations/${id}`),
      api<{ messages: Message[]; hasMore: boolean }>(
        `/chat/conversations/${id}/messages`,
      ),
    ])
      .then(([detail, history]) => {
        if (active) {
          setDetails(detail);
          update(history.messages);
          setHasOlder(history.hasMore);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, update]);
  React.useEffect(() => {
    if (loading) return;
    let active = true;
    async function sync() {
      try {
        const detail = await api<ChatDetails>(`/chat/conversations/${id}`);
        if (!active) return;
        setDetails(detail);
        setError("");
        const ids=messagesRef.current.map(m=>m.id);
        for(let offset=0;offset<ids.length;offset+=100){
          const changed=await api<{messages:Message[]}>(`/chat/conversations/${id}/messages?ids=${ids.slice(offset,offset+100).join(",")}`);
          if(!active)return;update(changed.messages);
        }
        let after = messagesRef.current.at(-1)?.id ?? 0;
        for (let n = 0; n < 50; n++) {
          const data = await api<{ messages: Message[]; hasMore: boolean }>(
            `/chat/conversations/${id}/messages?after=${after}`,
          );
          if (!active) return;
          update(data.messages);
          if (!data.hasMore || !data.messages.length) break;
          after = data.messages.at(-1)!.id;
        }
      } catch (e) {
        if (active) setError(errorMessage(e));
      }
    }
    void sync();
    return () => {
      active = false;
    };
  }, [id, revision, accessRevision, loading, update]);
  React.useEffect(() => {
    setDetails((d) => (d ? { ...d, phone: null } : d));
  }, [accessRevision]);
  React.useEffect(() => {
    if (nearBottom.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);
  const markRead = React.useCallback(() => {
    const last = messagesRef.current.at(-1)?.id;
    if (
      !last ||
      last <= lastRead.current ||
      document.hidden ||
      !document.hasFocus() ||
      !nearBottom.current
    )
      return;
    const before = lastRead.current;
    lastRead.current = last;
    void api(`/chat/conversations/${id}/read`, {
      method: "POST",
      body: { messageId: last },
    })
      .then(() => refresh())
      .catch(() => {
        lastRead.current = before;
      });
  }, [id, refresh]);
  React.useEffect(() => {
    markRead();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [messages, markRead]);
  async function older() {
    if (!messagesRef.current.length) return;
    setOlderBusy(true);
    setError("");
    const element = scroller.current,
      height = element?.scrollHeight ?? 0;
    nearBottom.current = false;
    try {
      const data = await api<{ messages: Message[]; hasMore: boolean }>(
        `/chat/conversations/${id}/messages?before=${messagesRef.current[0].id}`,
      );
      update(data.messages);
      setHasOlder(data.hasMore);
      requestAnimationFrame(() => {
        if (element) element.scrollTop = element.scrollHeight - height;
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOlderBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending || details?.unavailable) return;
    setSending(true);
    setSendError("");
    const body = text.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      if(editing){
        await api(`/chat/conversations/${id}/messages/${editing.id}`,{method:"PATCH",body:{text:body},signal:controller.signal});
        setEditing(null);setText("");refresh();return;
      }
      if (pending.current?.text !== body || pending.current?.replyToId !== reply?.id)
        pending.current = { text: body, clientId: newClientId(window.crypto),...(reply?{replyToId:reply.id}:{}) };
      const result = await api<{ message: Message }>(
        `/chat/conversations/${id}/messages`,
        { method: "POST", body: pending.current, signal: controller.signal },
      );
      nearBottom.current = true;
      update([result.message]);
      setText("");
      setReply(null);
      pending.current = null;
      refresh();
    } catch (e) {
      setSendError(errorMessage(e));
    } finally {
      window.clearTimeout(timer);
      setSending(false);
    }
  }
  async function remove(m:Message,scope:"self"|"everyone"){
    if(!window.confirm(scope==="everyone"?"Удалить своё сообщение у всех? Отменить это действие нельзя.":"Скрыть сообщение только у себя? Собеседник продолжит его видеть."))return;
    setActionBusy(true);setError("");
    try{await api(`/chat/conversations/${id}/messages/${m.id}`,{method:"DELETE",body:{scope}});if(reply?.id===m.id)setReply(null);if(editing?.id===m.id){setEditing(null);setText("");}refresh();}
    catch(e){setError(errorMessage(e));}finally{setActionBusy(false);}
  }
  function addEmoji(value:string){
    const el=composer.current,start=el?.selectionStart??text.length,end=el?.selectionEnd??text.length;
    if(text.length-(end-start)+value.length>4000)return;
    setText(text.slice(0,start)+value+text.slice(end));
    requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+value.length,start+value.length);});
  }
  if (loading)
    return (
      <div className="thread-loading" role="status">
        Загружаем переписку…
      </div>
    );
  if (!details)
    return (
      <div className="empty-chat" role="alert">
        <p>{error || "Диалог недоступен"}</p>
        <Link to="/messages">К диалогам</Link>
        <button onClick={() => window.location.reload()}>Повторить</button>
      </div>
    );
  return (
    <div className="chat-thread">
      <div className="thread-header">
        <Link
          className="mobile-chat-back"
          to="/messages"
          aria-label="К диалогам"
        >
          <ArrowLeft size={20} />
        </Link>
        <Link className="thread-person" to={`/users/${details.peer.id}`}>
          <Avatar user={details.peer} />
          <span>
            <strong>
              {details.peer.firstName} {details.peer.lastName}
            </strong>
            <small>
              {details.peer.group} · {details.peer.course} курс
            </small>
          </span>
        </Link>
      </div>
      <UserSafety userId={details.peer.id} onChange={()=>refresh()}/>
      {details.unavailable && <p className="notice" role="status">Общение ограничено блокировкой. История переписки сохранена.</p>}
      {!details.unavailable && <ChatPhone
        details={details}
        onInvalidate={() => {
          setDetails((d) => (d ? { ...d, phone: null } : d));
        }}
      />}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div
        className="message-history"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el) {
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            markRead();
          }
        }}
      >
        {hasOlder && (
          <button
            className="load-older"
            disabled={olderBusy}
            onClick={() => void older()}
          >
            {olderBusy ? "Загрузка…" : "Загрузить более ранние"}
          </button>
        )}
        {!messages.some(m=>!m.hiddenForMe) && (
          <p className="chat-first-message">
            У вас уже есть общее — начни с приветствия.
          </p>
        )}
        {messages.filter(m=>!m.hiddenForMe).map((m, index,visible) => (
          <React.Fragment key={m.id}>
            {(index === 0 ||
              messageDay(visible[index - 1].createdAt) !==
                messageDay(m.createdAt)) && (
              <div className="message-day">{messageDay(m.createdAt)}</div>
            )}
            <div
              className={`message-row ${m.senderId === user?.id ? "own" : ""}`}
            >
              <div className={`message-bubble ${m.deletedAt?"deleted-message":""}`} id={`message-${m.id}`}>
                {m.replyTo&&!m.deletedAt&&<blockquote className="message-reply"><strong>{m.replyTo.senderId===user?.id?"Ты":"Собеседник"}</strong><span>{m.replyTo.text}</span></blockquote>}
                <p>{m.deletedAt?"Сообщение удалено":m.text}</p>
                <div className="message-meta"><time dateTime={m.createdAt}>{m.editedAt&&!m.deletedAt?"изменено · ":""}{messageTime(m.createdAt)}</time>
                <details className="message-menu"><summary aria-label="Действия с сообщением">•••</summary><div>
                  {!m.deletedAt&&!details.unavailable&&<button type="button" disabled={actionBusy||sending} onClick={()=>{setReply(m);setEditing(null);composer.current?.focus();}}>Ответить</button>}
                  {m.senderId===user?.id&&!m.deletedAt&&!details.unavailable&&<button type="button" disabled={actionBusy||sending} onClick={()=>{setEditing(m);setReply(null);setText(m.text);composer.current?.focus();}}>Редактировать</button>}
                  <button type="button" disabled={actionBusy||sending} onClick={()=>void remove(m,"self")}>Удалить у себя</button>
                  {m.senderId===user?.id&&!m.deletedAt&&<button type="button" disabled={actionBusy||sending} onClick={()=>void remove(m,"everyone")}>Удалить у всех</button>}
                  {m.senderId!==user?.id&&!m.deletedAt&&<ReportButton kind="MESSAGE" targetId={String(m.id)}/>}
                </div></details></div>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
      {!details.unavailable&&<form className="message-composer" onSubmit={(e) => void send(e)}>
        {sendError && (
          <p role="alert" className="form-error">
            {sendError} Текст сохранён в поле — можно повторить отправку.
          </p>
        )}
        {(editing||reply)&&<div className="composer-context"><span><strong>{editing?"Редактирование":"Ответ на сообщение"}</strong><small>{(editing??reply)?.text}</small></span><button type="button" disabled={sending} aria-label="Отменить редактирование или ответ" onClick={()=>{if(editing)setText("");setEditing(null);setReply(null);}}>✕</button></div>}
        <button type="button" className="emoji-toggle" aria-label="Выбрать смайлик" aria-expanded={emojiOpen} disabled={sending} onClick={()=>setEmojiOpen(v=>!v)}>☺ Смайлики</button>
        {emojiOpen&&<div className="emoji-picker" role="group" aria-label="Смайлики">{["😀","😃","😄","😁","😂","🤣","😊","😉","😍","🥰","😘","😎","🤔","🙃","😅","😭","😢","😡","😱","🥳","👍","👎","👏","🙌","🤝","🙏","❤️","💔","🔥","✨","🎉","💯","👀","💪","🏀","🎮","📚","☕","✅","👋"].map(emoji=><button key={emoji} type="button" aria-label={`Добавить ${emoji}`} onClick={()=>addEmoji(emoji)}>{emoji}</button>)}</div>}
        <div>
          <textarea ref={composer}
            aria-label="Текст сообщения"
            placeholder="Напиши что-нибудь…"
            value={text}
            maxLength={4000}
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (text.trim() && !sending)
                  e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="primary"
            disabled={sending || !text.trim()}
            aria-label={editing?"Сохранить сообщение":"Отправить сообщение"}
          >
            <Send size={18} />
          </button>
        </div>
        <span className="field-help">
          {text.length}/4000 · Enter — отправить, Shift+Enter — новая строка
          {status !== "online"
            ? " · Переподключаемся, история обновляется автоматически"
            : ""}
        </span>
      </form>}
    </div>
  );
}
