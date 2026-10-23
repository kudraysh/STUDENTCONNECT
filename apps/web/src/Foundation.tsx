import React from "react";
import { Link } from "react-router-dom";
import {ArrowUpRight,GraduationCap} from "lucide-react";
export function Foundation() {
  return (
    <>
      <div className="eyebrow">МИЭТ · СТУДЕНЧЕСКОЕ СООБЩЕСТВО</div>
      <section className="hero">
        <div>
          <span className="pill">Найди своих</span>
          <h1>
            Свои люди.
            <br />
            <span>Общие интересы.</span>
          </h1>
          <p>
            Место, где знакомство начинается с того, что вам нравится. Создай
            профиль и расскажи, что тебя увлекает.
          </p>
          <div className="actions">
            <Link className="primary" to="/register">
              Присоединиться <ArrowUpRight size={18} />
            </Link>
            <Link className="secondary" to="/login">
              Уже есть аккаунт
            </Link>
          </div>
        </div>
        <div className="art" aria-hidden="true">
          <div className="orbit o1" />
          <div className="orbit o2" />
          <div className="bubble b1">&lt;/&gt;</div>
          <div className="bubble b2">🏀</div>
          <div className="bubble b3">♫</div>
          <div className="center-logo">
            <GraduationCap size={66} />
          </div>
          <div className="art-label">На одной волне ✦</div>
        </div>
      </section>
    </>
  );
}
