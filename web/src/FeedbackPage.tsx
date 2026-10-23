import { newClientId } from "./clientIds";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Bug, CheckCircle2, RefreshCw } from "lucide-react";
import { api, errorMessage } from "./api";
import { eventDate } from "./eventsApi";
const areas=[ ["PEOPLE","Люди"],["FEED","Лента"],["EVENTS","Мероприятия"],["MESSAGES","Сообщения"],["PHONE","Доступ к телефону"],["PROFILE","Профиль и вход"],["NOTIFICATIONS","Уведомления"],["OTHER","Другое"] ];
type Report={id:string;area:string;title:string;steps:string;expected:string;actual:string;page:string;environment:string;status:"OPEN"|"RESOLVED";createdAt:string};
type Draft={area:string;title:string;steps:string;expected:string;actual:string;page:string;environment:string};
const initial=(page:string):Draft=>({area:"OTHER",title:"",steps:"",expected:"",actual:"",page,environment:""});
export function FeedbackPage(){
  const location=useLocation();
  const source=typeof location.state?.from==="string" && /^\/[A-Za-z0-9_/-]{0,159}$/.test(location.state.from)?location.state.from:"/";
  const [draft,setDraft]=React.useState(()=>initial(source));
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
  const [sent,setSent]=React.useState<Report|null>(null);
  const [page,setPage]=React.useState(1),[attempt,reload]=React.useReducer(n=>n+1,0);
  const [history,setHistory]=React.useState<{reports:Report[];total:number;limit:number}|null>(null);
  const [historyError,setHistoryError]=React.useState("");
  const pending=React.useRef<{body:string;clientId:string}|null>(null);
  const locked=React.useRef(false),alive=React.useRef(true);
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  React.useEffect(()=>{
    let active=true;setHistory(null);setHistoryError("");
    void api<{reports:Report[];total:number;limit:number}>(`/feedback?page=${page}`).then(data=>{if(active)setHistory(data);}).catch(e=>{if(active)setHistoryError(errorMessage(e));});
    return()=>{active=false;};
  },[page,attempt]);
  const field=(key:keyof Draft,value:string)=>setDraft(d=>({...d,[key]:value}));
  async function submit(e:React.FormEvent){
    e.preventDefault();if(locked.current)return;
    locked.current=true;setBusy(true);setError("");
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const values={...draft,title:draft.title.trim(),steps:draft.steps.trim(),expected:draft.expected.trim(),actual:draft.actual.trim(),environment:draft.environment.trim()};
      const body=JSON.stringify(values);
      if(!pending.current || pending.current.body!==body)pending.current={body,clientId:newClientId(window.crypto)};
      const result=await api<{report:Report}>("/feedback",{method:"POST",body:{...values,clientId:pending.current.clientId},signal:controller.signal});
      if(alive.current){setSent(result.report);setPage(1);reload();pending.current=null;}
    }catch(e){if(alive.current)setError(controller.signal.aborted?"Ответ не получен. Можно повторить отправку — одинаковый отчёт не продублируется.":errorMessage(e));}
    finally{clearTimeout(timeout);locked.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="feedback-page"><Link className="text-button" to="/">← К людям</Link>
    <div className="section-heading"><div><span className="eyebrow">ПОМОГИ СДЕЛАТЬ САЙТ ЛУЧШЕ</span><h1><Bug size={28}/> Сообщить об ошибке</h1></div></div>
    <p className="field-help">Опиши, что произошло и как это повторить. Отчёт сохранится для разработчика. Пароли, токены, номера телефонов и чужую переписку сюда не вставляй.</p>
    {sent?<div className="feedback-success form-card" role="status"><CheckCircle2 size={32}/><h2>Отчёт сохранён</h2><p>{sent.title}</p><p>Номер: <code>{sent.id}</code></p><p className="field-help">Это учебная демоверсия: автоматического ответа по почте нет. Статус можно увидеть в истории ниже.</p><button className="primary" onClick={()=>{setSent(null);setDraft(initial(source));setError("");}}>Сообщить о другой ошибке</button></div>
    :<form className="form-card" onSubmit={e=>void submit(e)}>
      <fieldset disabled={busy} className="feedback-fields"><legend className="sr-only">Описание ошибки</legend>
        <div className="form-row"><label>Раздел<select value={draft.area} onChange={e=>field("area",e.target.value)}>{areas.map(([id,title])=><option value={id} key={id}>{title}</option>)}</select></label>
        <label>Путь страницы<input value={draft.page} onChange={e=>field("page",e.target.value)} maxLength={160} required placeholder="/people/feed"/><span className="field-help">Только путь: без https://, параметров и ссылок подтверждения.</span></label></div>
        <label>Кратко об ошибке<input value={draft.title} onChange={e=>field("title",e.target.value)} minLength={5} maxLength={120} required placeholder="Например, кнопка отправки не реагирует"/></label>
        <label>Как повторить<textarea value={draft.steps} onChange={e=>field("steps",e.target.value)} minLength={10} maxLength={2000} required rows={4} placeholder="1. Открыл сообщения. 2. Ввёл текст. 3. Нажал «Отправить»."/></label>
        <label>Что ожидалось<textarea value={draft.expected} onChange={e=>field("expected",e.target.value)} minLength={5} maxLength={1000} required rows={2}/></label>
        <label>Что произошло<textarea value={draft.actual} onChange={e=>field("actual",e.target.value)} minLength={5} maxLength={2000} required rows={3}/></label>
        <label>Устройство и браузер · необязательно<input value={draft.environment} onChange={e=>field("environment",e.target.value)} maxLength={160} placeholder="Например, iPhone · Safari или Windows · Chrome"/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy?"Сохраняем…":"Отправить отчёт"}</button><p className="field-help">До 10 отчётов за 24 часа. Черновик остаётся в форме при ошибке отправки.</p>
      </fieldset>
    </form>}
    <div className="section-heading feedback-history-heading"><h2>Мои отчёты</h2><button aria-label="Обновить историю отчётов" onClick={reload}><RefreshCw size={17}/></button></div>
    {historyError && <p className="form-error" role="alert">{historyError}</p>}
    {!history && !historyError && <p role="status">Загружаем историю…</p>}
    {history && <><p className="field-help">Видны только твои отчёты. «Открыт» — ожидает проверки, «Исправлен» — разработчик отметил исправление.</p>
      {!history.reports.length?<p>На этой странице отчётов пока нет.</p>:<div className="feedback-history">{history.reports.map(r=><details className="form-card" key={r.id}><summary><strong>{r.title}</strong><span className={`pill ${r.status==="RESOLVED"?"feedback-resolved":""}`}>{r.status==="RESOLVED"?"Исправлен":"Открыт"}</span></summary><time dateTime={r.createdAt}>{eventDate(r.createdAt)}</time><p className="field-help">{areas.find(([id])=>id===r.area)?.[1]} · {r.page} · {r.environment || "Устройство не указано"}</p><h3>Шаги</h3><p>{r.steps}</p><h3>Ожидалось</h3><p>{r.expected}</p><h3>Произошло</h3><p>{r.actual}</p><small>Номер: {r.id}</small></details>)}</div>}
      <div className="actions"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>Страница {page}</span><button disabled={page*history.limit>=history.total} onClick={()=>setPage(p=>p+1)}>Далее</button></div>
    </>}
  </section>;
}
