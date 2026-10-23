import React from "react";
import {api,errorMessage} from "./api";
import {newClientId} from "./clientIds";
import {useChat} from "./ChatContext";
const reasons={AVATAR:"Непристойная аватарка",PROFILE:"Нарушение в профиле",ABUSE:"Оскорбления или непристойные слова",SPAM:"Спам или мошенничество",DANGER:"Угрозы или опасное содержимое",OTHER:"Другая причина"};
export function ReportButton({kind,targetId}:{kind:"USER"|"MESSAGE"|"EVENT";targetId:string}){
 const dialog=React.useRef<HTMLDialogElement>(null);
 const [reason,setReason]=React.useState("OTHER"),[details,setDetails]=React.useState(""),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(""),[receipt,setReceipt]=React.useState("");
 const attempt=React.useRef<{signature:string;clientId:string}|null>(null);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");
  try{const body={kind,targetId,reason,details};const signature=JSON.stringify(body);
   if(attempt.current?.signature!==signature)attempt.current={signature,clientId:newClientId(window.crypto)};
   const r=await api<{id:string}>("/safety/reports",{method:"POST",body:{...body,clientId:attempt.current.clientId}});
   setReceipt(r.id);
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <><button type="button" className="report-button" onClick={()=>{setError("");setReceipt("");dialog.current?.showModal();}}>Пожаловаться</button>
 <dialog ref={dialog} className="safety-dialog" aria-labelledby={`report-${kind}-${targetId}`}>
 <h2 id={`report-${kind}-${targetId}`}>Сообщить о нарушении</h2>
 {receipt?<><p role="status">Жалоба сохранена. Организатор тестирования рассмотрит её вручную.</p><p className="field-help">Номер: {receipt}</p><button autoFocus type="button" onClick={()=>dialog.current?.close()}>Закрыть</button></>:<form onSubmit={e=>void submit(e)}>
 <p>К жалобе приложится копия указанного содержимого. Автору не сообщается, кто отправил жалобу. Жалоба сама по себе не блокирует аккаунт.</p>
 <label>Причина<select autoFocus value={reason} onChange={e=>setReason(e.target.value)}>{Object.entries(reasons).filter(([key])=>kind==="USER"||!["AVATAR","PROFILE"].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label>Подробности<textarea maxLength={2000} value={details} onChange={e=>setDetails(e.target.value)} placeholder="Что произошло? Не указывай пароли и личные данные." rows={4}/></label>
 {error&&<p role="alert" className="form-error">{error}</p>}
 <div className="actions"><button disabled={busy} className="primary">{busy?"Отправляем…":"Отправить жалобу"}</button><button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>Отмена</button></div>
 </form>}</dialog></>;
}
export function UserSafety({userId,onChange}:{userId:string;onChange?:()=>void}){
 const [state,setState]=React.useState<{blockedByMe:boolean;unavailable:boolean}|null>(null),[error,setError]=React.useState(""),[busy,setBusy]=React.useState(false);
 const {accessRevision,refresh}=useChat();
 React.useEffect(()=>{let active=true;void api<{blockedByMe:boolean;unavailable:boolean}>(`/safety/blocks/${userId}`).then(v=>{if(active)setState(v);}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[userId,accessRevision]);
 async function toggle(){if(!state)return;if(!state.blockedByMe&&!window.confirm("Заблокировать пользователя? Новые сообщения и запросы телефона станут недоступны с обеих сторон. Вы исчезнете друг у друга из поиска и ленты. История переписки сохранится."))return;
 setBusy(true);setError("");try{await api(`/safety/blocks/${userId}`,{method:state.blockedByMe?"DELETE":"POST",body:{}});setState(await api(`/safety/blocks/${userId}`));refresh();onChange?.();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <div className="user-safety"><button type="button" disabled={busy||!state} onClick={()=>void toggle()}>{state?.blockedByMe?"Разблокировать":"Заблокировать"}</button><ReportButton kind="USER" targetId={userId}/>{state?.unavailable&&<small>Общение ограничено блокировкой</small>}{error&&<p role="alert" className="form-error">{error}</p>}</div>;
}
export function BlockedUsers(){
 const [blocks,setBlocks]=React.useState<{blockedId:string;blocked:{firstName:string;lastName:string}}[]>([]),[error,setError]=React.useState("");
 const {revision,refresh}=useChat();
 React.useEffect(()=>{let active=true;void api<{blocks:typeof blocks}>("/safety/blocks").then(v=>{if(active)setBlocks(v.blocks);}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[revision]);
 return <section className="form-card blocked-users"><h2>Заблокированные пользователи</h2>{error&&<p role="alert">{error}</p>}{!blocks.length&&<p>Список пуст.</p>}{blocks.map(b=><div key={b.blockedId}><span>{b.blocked.firstName} {b.blocked.lastName}</span><button type="button" onClick={()=>{void api(`/safety/blocks/${b.blockedId}`,{method:"DELETE",body:{}}).then(()=>refresh()).catch(e=>setError(errorMessage(e)) );}}>Разблокировать</button></div>)}</section>;
}
