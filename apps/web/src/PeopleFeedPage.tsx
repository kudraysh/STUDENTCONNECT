import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Heart, X, Sparkles, RotateCw, HelpCircle, ArrowUpRight } from "lucide-react";
import { api, errorMessage, type PublicUser, type Interest } from "./api";
import { useChat } from "./ChatContext";
import { StartChatButton } from "./StartChatButton";

type Person = PublicUser & { commonCount: number; commonInterests: Interest[] };
type Feed = { person: Person | null; remaining: number; tutorialRemaining: number };
type Decision = "LIKE" | "SKIP";
export function PeopleFeedPage() {
  const [data, setData] = React.useState<Feed | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [exit, setExit] = React.useState<Decision | null>(null);
  const [help, setHelp] = React.useState(false);
  const [lastLiked, setLastLiked] = React.useState<Person | null>(null);
  const lock = React.useRef(false);
  const alive = React.useRef(true);
  const { refresh } = useChat();
  const load = React.useCallback(async (signal?: AbortSignal) => {
    const next = await api<Feed>("/people/feed", { signal });
    if (alive.current) { setData(next); setLoading(false); }
  }, []);
  React.useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void load(controller.signal).catch(e => {if (alive.current && !controller.signal.aborted) {setError(errorMessage(e));setLoading(false);}});
    return () => {alive.current=false;controller.abort();};
  }, [load]);
  async function reload() {
    if (lock.current) return;
    setLoading(true);setError("");
    try { await load(); } catch(e) { if(alive.current) {setError(errorMessage(e));setLoading(false);} }
  }
  async function choose(decision: Decision) {
    if (lock.current || !data?.person) return;
    lock.current = true;setBusy(true);setError("");setNotice("");
    const person=data.person;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const result=await api<{decision:Decision;created:boolean;tutorialRemaining:number}>(`/people/feed/${person.id}`,{method:"POST",body:{decision},signal:controller.signal});
      clearTimeout(timeout);
      if (!alive.current) return;
      setExit(result.decision);
      await new Promise(resolve=>setTimeout(resolve,220));
      if (!alive.current) return;
      if(result.decision==="LIKE") {
        setLastLiked(person);
        setNotice(result.created ? `Интерес к ${person.firstName} отправлен. Можно написать первым.` : "Интерес уже был отправлен.");
      } else setNotice(result.created ? `${person.firstName} скрыт из твоей ленты на 7 дней.` : "Этот человек уже временно скрыт из ленты.");
      setData(d=>d?{...d,person:null,tutorialRemaining:result.tutorialRemaining}:d);
      setExit(null);setLoading(true);
      refresh();
      await load();
    } catch(e) {
      if (alive.current) {setError(controller.signal.aborted ? "Ответ не получен. Повтори действие — второе уведомление не отправится." : errorMessage(e));setExit(null);setLoading(false);}
    } finally {
      clearTimeout(timeout);lock.current=false;
      if (alive.current) setBusy(false);
    }
  }
  async function dismiss() {
    if(lock.current) return;
    lock.current=true;setBusy(true);setError("");
    try {
      await api("/people/feed/tutorial/dismiss",{method:"POST",body:{}});
      if(alive.current) {setData(d=>d?{...d,tutorialRemaining:0}:d);setHelp(false);}
    }catch(e){if(alive.current)setError(errorMessage(e));}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="feed-page">
    <div className="feed-heading">
      <div><Link to="/" className="text-button"><ArrowLeft size={16}/> К списку людей</Link>
      <span className="eyebrow">НОВЫЕ ЗНАКОМСТВА · МИЭТ</span><h1>Кто тебе <span>по интересам?</span></h1>
      <p>Одна карточка. Возможно, начало хорошего общения.</p></div>
      <button className="feed-help-button" onClick={()=>setHelp(h=>!h)} aria-expanded={help || !!data?.tutorialRemaining}><HelpCircle size={18}/> Как это работает</button>
    </div>
    {((data?.person && data.tutorialRemaining > 0) || help) && <aside className="feed-tutorial" aria-label="Обучение работе с лентой">
      <span className="feed-tutorial-icon"><Sparkles size={22}/></span>
      <div><strong>{data?.tutorialRemaining ? `Знакомимся с лентой · ${3-data.tutorialRemaining} из 2` : "Два движения — новые знакомства"}</strong>
      <p><b>Вправо — интересно.</b> Человеку придёт уведомление с твоим профилем. <b>Влево — пропустить.</b> Он не появится в твоей ленте 7 дней. Можно нажимать кнопки под карточкой.</p>
      {!!data?.tutorialRemaining && <small>Подсказка исчезнет после первых двух карточек.</small>}</div>
      <button aria-label="Закрыть обучение" disabled={busy} onClick={()=>{if(data?.tutorialRemaining)void dismiss();else setHelp(false);}}><X size={18}/></button>
    </aside>}
    {error && <div className="notice error-notice" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>void reload()}><RotateCw size={16}/> Обновить ленту</button><Link to="/profile">Мой профиль и интересы</Link></div>}
    <div className="feed-stage" aria-busy={busy || loading}>
      {loading ? <div className="feed-loading" role="status"><div className="feed-loading-photo"/><div/><p>Ищем следующего человека…</p></div>
      : data?.person ? <SwipeCard key={data.person.id} person={data.person} busy={busy} exit={exit} choose={choose}/>
      : !error && <div className="feed-empty form-card"><Sparkles size={40}/><h2>Пока все знакомые лица</h2><p>Ты посмотрел доступные карточки. Новые студенты появятся здесь после регистрации, а пропущенные — через 7 дней.</p><button onClick={()=>void reload()} disabled={busy}><RotateCw size={16}/> Проверить ещё раз</button><Link className="secondary" to="/">Посмотреть общий список</Link></div>}
    </div>
    <p className="feed-status" role="status" aria-live="polite">{notice || (data?.person ? `Доступно карточек: ${data.remaining}` : "")}</p>
    {lastLiked && <aside className="feed-last-liked"><Heart size={18}/><p>Тебе интересен <strong>{lastLiked.firstName} {lastLiked.lastName}</strong></p><StartChatButton peerId={lastLiked.id}/></aside>}
    <p className="feed-footnote">Взаимного интереса ждать не нужно — общение можно начать сразу. Свайп влево виден только тебе и действует на ленту.</p>
  </section>;
}
function SwipeCard({person,busy,exit,choose}:{person:Person;busy:boolean;exit:Decision|null;choose:(d:Decision)=>Promise<void>}) {
  const [dx,setDx]=React.useState(0);
  const [dragging,setDragging]=React.useState(false);
  const [photoError,setPhotoError]=React.useState(false);
  const gesture=React.useRef<{x:number;y:number;id:number;horizontal:boolean}|null>(null);
  const reset=()=>{gesture.current=null;setDx(0);setDragging(false);};
  const label=dx>35?"ИНТЕРЕСНО":dx< -35?"ПРОПУСТИТЬ":"";
  return <>
    <div className="feed-side-hint left"><ArrowLeft size={24}/><span>Пропустить</span><small>На 7 дней</small></div>
    <article className={`swipe-card ${dragging?"dragging":""} ${exit?`exit-${exit.toLowerCase()}`:""}`} tabIndex={0}
      aria-label={`Карточка: ${person.firstName} ${person.lastName}. Стрелка вправо — интересно, влево — пропустить.`}
      style={{transform:exit?undefined:`translateX(${dx}px) rotate(${dx/25}deg)`}}
      onKeyDown={e=>{if(e.target!==e.currentTarget || busy || e.repeat)return;if(e.key==="ArrowRight" || e.key==="ArrowLeft"){e.preventDefault();void choose(e.key==="ArrowRight"?"LIKE":"SKIP");}}}
      onPointerDown={e=>{
        if(busy || !e.isPrimary || e.button!==0 || (e.target as HTMLElement).closest("a,button"))return;
        gesture.current={x:e.clientX,y:e.clientY,id:e.pointerId,horizontal:false};
      }}
      onPointerMove={e=>{
        const g=gesture.current;if(!g || busy || e.pointerId!==g.id)return;
        const x=e.clientX-g.x,y=e.clientY-g.y;
        if(!g.horizontal && Math.abs(y)>16 && Math.abs(y)>Math.abs(x)) {reset();return;}
        if(!g.horizontal && Math.abs(x)>14 && Math.abs(x)>Math.abs(y)*1.2){g.horizontal=true;setDragging(true);e.currentTarget.setPointerCapture(e.pointerId);}
        if(g.horizontal)setDx(Math.max(-200,Math.min(200,x)));
      }}
      onPointerUp={e=>{
        const g=gesture.current;if(!g || e.pointerId!==g.id)return;
        const distance=e.clientX-g.x;
        const threshold=Math.min(110,Math.max(65,e.currentTarget.clientWidth*.23));
        const swiped=g.horizontal && Math.abs(distance)>=threshold;
        reset();
        if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
        if(swiped && !busy)void choose(distance>0?"LIKE":"SKIP");
      }}
      onPointerCancel={reset} onLostPointerCapture={reset}>
      <div className="swipe-photo" onDragStart={e=>e.preventDefault()}>
        {person.avatar && !photoError ? <img src={person.avatar} alt={`${person.firstName} ${person.lastName}`} draggable={false} onError={()=>setPhotoError(true)}/>
        : <div className="swipe-initials" aria-label="Фото пока не добавлено"><span>{person.firstName[0]}{person.lastName[0]}</span><small>Фото пока нет — знакомство впереди</small></div>}
        <span className="swipe-common"><Sparkles size={14}/>{person.commonCount ? `Общих интересов: ${person.commonCount}` : "Открой новые интересы"}</span>
        {label && <span className={`swipe-stamp ${dx>0?"like":"skip"}`} aria-hidden="true">{label}</span>}
        <div className="swipe-identity"><h2>{person.firstName}<br/>{person.lastName}</h2><span>{person.group} · {person.course} курс{person.nickname?` · @${person.nickname}`:""}</span></div>
      </div>
      <div className="swipe-body">
        <p>{person.bio || "Начни знакомство с общих интересов."}</p>
        <div className="interest-chips">{[...person.commonInterests,...person.interests.filter(i=>!person.commonInterests.some(c=>c.id===i.id))].map(i=><span key={i.id} className={`interest-chip ${person.commonInterests.some(c=>c.id===i.id)?"selected":""}`}>{i.name}</span>)}</div>
        <Link to={`/users/${person.id}`} className="text-button">Открыть профиль <ArrowUpRight size={16}/></Link>
      </div>
    </article>
    <div className="feed-side-hint right"><Heart size={24}/><span>Интересно</span><small>Уведомим человека</small></div>
    <div className="swipe-actions">
      <button className="swipe-skip" disabled={busy} onClick={()=>void choose("SKIP")} aria-label={`Пропустить ${person.firstName} на 7 дней`}><X size={28}/><span>Пропустить</span></button>
      <p>{busy ? "Сохраняем выбор…" : "Листай или выбирай"}</p>
      <button className="swipe-like" disabled={busy} onClick={()=>void choose("LIKE")} aria-label={`Проявить интерес к ${person.firstName}`}><Heart size={28}/><span>Интересно</span></button>
    </div>
  </>;
}
