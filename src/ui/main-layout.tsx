export function MainLayout() {
  return (
    <div className="main-layout">
      <aside className="sidebar">
        <nav className="sidebar-nav">
          <a href="#tasks">任务</a>
          <a href="#skills">技能</a>
          <a href="#experts">专家</a>
          <a href="#claw">远程控制</a>
          <a href="#scheduler">定时任务</a>
          <a href="#settings">设置</a>
        </nav>
      </aside>

      <main className="content-area">
        <section className="chat-panel">
          <div className="chat-header">
            <h2>对话区</h2>
          </div>
          <div className="chat-messages"></div>
          <div className="chat-input">
            <textarea placeholder="输入指令..."></textarea>
            <button>发送</button>
          </div>
        </section>

        <section className="result-panel">
          <div className="result-header">
            <h2>结果区</h2>
          </div>
          <div className="result-tabs">
            <button>产物</button>
            <button>文件</button>
            <button>变更</button>
            <button>预览</button>
          </div>
          <div className="result-content"></div>
        </section>
      </main>
    </div>
  );
}
