export type ThemeStorage = {getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
// Даже получение window.localStorage может бросить SecurityError в ограниченном браузере.
export function readDarkTheme(storage:()=>ThemeStorage):boolean {
  try{return storage().getItem("theme")==="dark";}catch{return false;}
}
export function saveDarkTheme(storage:()=>ThemeStorage,dark:boolean):void {
  try{storage().setItem("theme",dark?"dark":"light");}catch{/* Тема всё равно работает до закрытия страницы. */}
}
