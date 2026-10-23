import React from "react";
export class AppErrorBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(this.state.failed)return <main className="loading-page"><section className="form-card" role="alert">
      <h1>Страница не открылась</h1><p>Попробуй перезагрузить страницу. Если ошибка повторится, сообщи, на каком действии она возникла.</p>
      <div className="actions"><button onClick={()=>window.location.reload()}>Перезагрузить</button><a className="secondary" href="/feedback">Сообщить об ошибке</a><a className="secondary" href="/">На главную</a></div>
    </section></main>;
    return this.props.children;
  }
}
