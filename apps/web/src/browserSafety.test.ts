import {test} from "node:test";
import assert from "node:assert/strict";
import {readDarkTheme,saveDarkTheme,type ThemeStorage} from "./preferences";
import {newClientId} from "./clientIds";

test("тема читается и сохраняется без доступа к другим данным",()=>{
  const values=new Map<string,string>();
  const store:ThemeStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}};
  assert.equal(readDarkTheme(()=>store),false);saveDarkTheme(()=>store,true);assert.equal(readDarkTheme(()=>store),true);
  saveDarkTheme(()=>store,false);assert.equal(values.get("theme"),"light");assert.equal(values.size,1);
});
test("запрет получения localStorage не обрушает приложение",()=>{
  const denied=():ThemeStorage=>{throw new Error("SecurityError");};
  assert.equal(readDarkTheme(denied),false);assert.doesNotThrow(()=>saveDarkTheme(denied,true));
});
test("ошибки чтения и переполненное хранилище не блокируют тему",()=>{
  const broken:ThemeStorage={getItem:()=>{throw new Error("SecurityError");},setItem:()=>{throw new Error("QuotaExceededError");}};
  assert.equal(readDarkTheme(()=>broken),false);assert.doesNotThrow(()=>saveDarkTheme(()=>broken,true));
});
test("неизвестное значение темы даёт светлую тему",()=>{
  assert.equal(readDarkTheme(()=>({getItem:()=>"<script>",setItem:()=>{}})),false);
});
test("идентификатор использует нативную криптографию при наличии",()=>{
  const value="a7bc8152-86c6-40c3-8ae0-1ba0cc323e57";
  assert.equal(newClientId({randomUUID:()=>value,getRandomValues:()=>{throw new Error("unexpected");}}),value);
});
test("браузер без randomUUID получает корректный UUID v4 из getRandomValues",()=>{
  let fills=0;
  const value=newClientId({getRandomValues:bytes=>{fills++;bytes.fill(255);return bytes;}});
  assert.match(value,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(value,"ffffffff-ffff-4fff-bfff-ffffffffffff");assert.equal(fills,1);
});
test("отсутствие криптографии даёт понятную ошибку",()=>{
  assert.throws(()=>newClientId(undefined),/HTTPS/);
});
