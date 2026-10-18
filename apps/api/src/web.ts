import express, {type Express} from "express";
import {existsSync} from "node:fs";
import path from "node:path";

export function mountWeb(app:Express,directory:string){
  const root=path.resolve(directory),index=path.join(root,"index.html");
  if(!existsSync(index))throw new Error("Не найдена сборка сайта. Выполни npm run build до запуска SERVE_WEB=1");
  const files=express.static(root,{index:false,dotfiles:"deny",fallthrough:true,setHeaders:(response,file)=>{
    response.setHeader("Cache-Control",file.startsWith(path.join(root,"assets")+path.sep)?"public, max-age=31536000, immutable":"no-store");
  }});
  app.use((req,res,next)=>{
    // Не превращаем ошибки API, отсутствующие скрипты или Socket.IO в HTML.
    if(!["GET","HEAD"].includes(req.method) || req.path==="/api" || req.path.startsWith("/api/") || req.path==="/socket.io" || req.path.startsWith("/socket.io/"))return next();
    if(req.path.split("/").some(part=>part.startsWith(".")))return next();
    return files(req,res,error=>{
      if(error)return next(error);
      if(path.extname(req.path)||req.path.startsWith("/assets/")||!req.accepts("html"))return next();
      res.setHeader("Cache-Control","no-store");
      res.sendFile(index,error=>{if(error)next(error);});
    });
  });
}
