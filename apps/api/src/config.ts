import "dotenv/config";
import {parseSettings} from "./settings.js";
export const config=parseSettings(process.env);
export const allowedOrigins=config.NODE_ENV==="production"?[config.WEB_ORIGIN]:[...new Set([config.WEB_ORIGIN,"http://localhost:5173","http://127.0.0.1:5173"])];
