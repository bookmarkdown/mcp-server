export function managementHtml(csrf: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="csrf-token" content="${csrf}">
<meta name="color-scheme" content="dark light">
<title>BookMarkdown MCP</title>
<link rel="stylesheet" href="/assets/style.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 160 160" aria-hidden="true"><path d="M42 18h76a18 18 0 0 1 18 18v106l-56-28-56 28V36a18 18 0 0 1 18-18Z"/></svg>
      <h1>BookMarkdown MCP</h1>
    </div>
    <nav aria-label="頁面區段"><a href="#connect">連線</a><a href="#devices-section">裝置</a><a href="#settings-section">設定</a></nav>
    <div class="status" id="status" data-state="pending" role="status"><span class="dot" aria-hidden="true"></span><span id="status-text">連線中…</span></div>
  </div>
</header>
<main>
  <div id="restart" class="banner" role="status" hidden>設定已儲存，重新啟動 server 後生效。下方的端點與 token 仍是目前執行中的值。</div>

  <section id="connect" aria-labelledby="h-connect">
    <h2 id="h-connect">連線</h2>
    <p class="lead">把 agent 與瀏覽器套件接到這台電腦上的同一個 server。</p>
    <div class="group">
      <div class="group-head"><h3>Agent</h3><span class="tag">MCP HTTP</span></div>
      <div class="field"><label for="mcp-url">端點</label><div class="copy-row"><input id="mcp-url" readonly><button type="button" data-copy="mcp-url">複製</button></div></div>
      <div class="field"><label for="mcp-token">Bearer token</label><div class="copy-row"><input id="mcp-token" type="password" value="••••••••••••••••" readonly><button type="button" data-reveal="mcpToken">顯示</button><button type="button" data-token-copy="mcpToken">複製</button></div></div>
      <p class="hint">在 agent 的 MCP HTTP 設定加入標頭 Authorization: Bearer &lt;token&gt;。</p>
    </div>
    <div class="group">
      <div class="group-head"><h3>瀏覽器套件</h3><span class="tag">WebSocket</span></div>
      <div class="field"><label for="ws-url">端點</label><div class="copy-row"><input id="ws-url" readonly><button type="button" data-copy="ws-url">複製</button></div></div>
      <div class="field"><label for="bridge-token">配對 token</label><div class="copy-row"><input id="bridge-token" type="password" value="••••••••••••••••" readonly><button type="button" data-reveal="bridgeToken">顯示</button><button type="button" data-token-copy="bridgeToken">複製</button></div></div>
      <p class="hint">在套件的 MCP 設定填入 WebSocket 端點與配對 token。</p>
    </div>
    <div id="lan-urls"></div>
  </section>

  <section id="devices-section" aria-labelledby="h-devices">
    <div class="section-head"><h2 id="h-devices">裝置</h2><button type="button" id="refresh">重新整理</button></div>
    <p class="hint" id="mode"></p>
    <div id="devices" class="devices">尚未連接套件。</div>
  </section>

  <section id="settings-section" aria-labelledby="h-settings">
    <h2 id="h-settings">伺服器設定</h2>
    <p class="lead">設定儲存在本機，重新啟動 server 後生效。</p>
    <form id="settings">
      <div class="group">
        <label class="switch"><input id="lanEnabled" type="checkbox" role="switch"><span class="switch-text"><strong>開啟區網連線</strong><small>其他裝置可透過區網 IP 連入 HTTP 與 WebSocket。請只在可信任的區網使用；設定頁僅限本機開啟。</small></span></label>
      </div>
      <div class="group">
        <div class="fields">
          <label class="field">MCP port<input id="mcpPort" type="number" min="1" max="65535" required></label>
          <label class="field">WebSocket port<input id="webSocketPort" type="number" min="1" max="65535" required></label>
        </div>
        <details>
          <summary>進階設定</summary>
          <div class="fields">
            <label class="field">請求逾時（ms）<input id="requestTimeoutMs" type="number" min="100" max="60000" required></label>
            <label class="field">套件連線上限<input id="maxConnections" type="number" min="1" max="64" required></label>
            <label class="field">同時請求上限<input id="maxPendingRequests" type="number" min="1" max="256" required></label>
          </div>
          <label class="field">允許的 extension IDs（選填，以逗號分隔）<input id="extensionIds" placeholder="留空接受所有相容套件"></label>
          <p class="hint" id="overrides"></p>
          <p class="hint" id="environment-only"></p>
        </details>
      </div>
      <div class="form-actions"><button class="primary" type="submit">儲存設定</button></div>
    </form>

    <div class="group">
      <div class="group-head"><h3>重建 token</h3></div>
      <p class="hint">重建後，重啟 server 並更新對應 agent 或套件的 token。</p>
      <div class="rotate"><button type="button" class="danger" data-rotate="mcpToken">重建 MCP token</button><button type="button" class="danger" data-rotate="bridgeToken">重建配對 token</button></div>
    </div>
    <p class="hint">設定檔：<code id="config-path"></code></p>
  </section>
</main>
<div id="notice" role="status" aria-live="polite"></div>
</body>
</html>`;
}

export const managementCss = `:root{
  color-scheme:dark light;
  --bg:#101612;--surface:#17201a;--field:#0f1511;--line:#2a3830;--text:#e7eee8;--muted:#9aaa9f;
  --accent:#c6ef8d;--btn:#c6ef8d;--on-btn:#15251d;--danger:#f2958a;
  --warn-bg:#2b2512;--warn-line:#6b5a1f;--warn-text:#f0d98a;
  --mono:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;
  --sans:"Segoe UI Variable","Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
}
@media(prefers-color-scheme:light){:root{
  --bg:#f5f7f2;--surface:#ffffff;--field:#f5f7f2;--line:#d4dcd0;--text:#17221b;--muted:#566559;
  --accent:#2f6b13;--btn:#2f6b13;--on-btn:#ffffff;--danger:#a8321f;
  --warn-bg:#fff4d6;--warn-line:#e3c25a;--warn-text:#5a4300;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 var(--sans)}
h1,h2,h3,p{margin:0}
.topbar{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:880px;margin:auto;padding:12px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px}
.brand{display:flex;align-items:center;gap:10px;margin-right:auto}
.brand-mark{width:22px;height:22px;fill:var(--accent)}
h1{font-size:16px;font-weight:650}
nav{display:flex;gap:4px}
nav a{color:var(--muted);text-decoration:none;padding:4px 10px;border-radius:6px}
nav a:hover{color:var(--text);background:var(--surface)}
.status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.status[data-state=online] .dot{background:var(--accent)}
.status[data-state=error] .dot{background:var(--danger)}
.status[data-state=error]{color:var(--danger)}
main{max-width:880px;margin:auto;padding:8px 24px 96px}
section{padding-top:36px;scroll-margin-top:64px}
h2{font-size:20px;font-weight:650;line-height:1.3}
h3{font-size:15px;font-weight:600}
.lead{color:var(--muted);margin:4px 0 16px;max-width:60ch}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}
.hint{color:var(--muted);font-size:13px;max-width:70ch}
.group{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-top:14px}
.group-head{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
.tag{color:var(--muted);font:12px var(--mono)}
.field{display:block;margin:12px 0 0;color:var(--muted);font-size:13px}
.field label{display:block;margin-bottom:4px}
.field>input{margin-top:4px}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px}
input:not([type=checkbox]){width:100%;background:var(--field);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:8px 10px;font:13px/1.4 var(--mono)}
input:disabled{opacity:.55}
input:focus-visible,button:focus-visible,summary:focus-visible,a:focus-visible,.switch input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.copy-row{display:flex;gap:6px}
.copy-row input{min-width:0;flex:1}
button{font:inherit;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);cursor:pointer;padding:7px 12px;white-space:nowrap}
button:hover:not(:disabled){border-color:var(--accent)}
button:disabled{opacity:.5;cursor:default}
.primary{background:var(--btn);color:var(--on-btn);border-color:var(--btn);font-weight:600}
.danger{color:var(--danger)}
.danger:hover:not(:disabled){border-color:var(--danger)}
.form-actions{margin-top:14px}
.rotate{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.switch{display:flex;gap:12px;align-items:flex-start;cursor:pointer}
.switch input{appearance:none;flex:none;width:36px;height:20px;margin:2px 0 0;border-radius:10px;background:var(--line);position:relative;cursor:pointer}
.switch input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--text)}
.switch input:checked{background:var(--btn)}
.switch input:checked::after{left:18px;background:var(--on-btn)}
.switch input:disabled{opacity:.55;cursor:default}
.switch-text{display:flex;flex-direction:column}
.switch-text small{color:var(--muted);font-size:13px;max-width:62ch}
details{margin-top:16px}
summary{cursor:pointer;color:var(--muted);width:max-content}
summary:hover{color:var(--text)}
details .hint{margin-top:8px}
.devices{margin-top:12px;color:var(--muted)}
.device{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:8px;color:var(--text)}
.device-main{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pill{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:0 10px}
.pill[data-online=true]{color:var(--accent);border-color:var(--accent)}
.device-meta{font:12px var(--mono);color:var(--muted);overflow-wrap:anywhere;margin-top:2px}
.lan-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.lan-row:first-of-type{border-top:0}
.lan-text{display:flex;flex-direction:column;min-width:0}
code{font:12px var(--mono);overflow-wrap:anywhere}
.banner{margin-top:20px;background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--warn-text);border-radius:8px;padding:10px 14px}
.banner[hidden]{display:none}
#notice:empty{display:none}
#notice{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));background:var(--text);color:var(--bg);border-radius:8px;padding:10px 16px;box-shadow:0 4px 18px rgba(0,0,0,.3)}
@media(max-width:560px){
  .topbar-inner,main{padding-left:16px;padding-right:16px}
  .copy-row{flex-wrap:wrap}
  .copy-row input{flex-basis:100%}
  .lan-row{align-items:flex-start;flex-direction:column}
}
@media(prefers-reduced-motion:no-preference){
  button,nav a{transition:border-color .15s,background-color .15s,color .15s}
  .switch input::after{transition:left .15s}
}
`;

export const managementJs = `const $=id=>document.getElementById(id);
let state;
const csrf=document.querySelector('meta[name="csrf-token"]').content;
const MASK='••••••••••••••••';
let noticeTimer;
function note(text){const box=$('notice');box.textContent=text;clearTimeout(noticeTimer);if(text)noticeTimer=setTimeout(()=>{box.textContent=''},6000)}
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
async function api(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  if(!response.ok){throw new Error((await response.json().catch(()=>({}))).error||'請求失敗，請確認 server 仍在執行。')}
  return response.json();
}
async function copy(text){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);note('已複製。');return}catch{}}
  const field=document.createElement('textarea');field.value=text;document.body.append(field);field.select();
  const ok=document.execCommand('copy');field.remove();
  if(!ok)throw new Error('無法使用剪貼簿，請顯示後手動複製。');
  note('已複製。');
}
function deviceList(devices){
  const list=$('devices');list.replaceChildren();
  if(!devices.length){list.textContent='尚未連接套件。安裝套件後，填入上方的 WebSocket 端點與配對 token。';return}
  for(const device of devices){
    const row=el('div','device');const main=el('div','device-main');
    const online=device.status==='online';
    const pill=el('span','pill',online?'已連線':'離線');pill.dataset.online=String(online);
    main.append(el('strong','',device.displayName),pill);
    row.append(main,el('div','device-meta',device.extensionId+' / '+device.instanceId+'，'+device.operations.length+' 個操作'));
    list.append(row);
  }
}
function lanList(endpoints){
  const box=$('lan-urls');box.replaceChildren();
  if(!endpoints.length)return;
  const group=el('div','group');const head=el('div','group-head');head.append(el('h3','','區網端點'));group.append(head);
  for(const endpoint of endpoints){
    const row=el('div','lan-row');const text=el('div','lan-text');
    text.append(el('code','',endpoint.mcpUrl),el('code','',endpoint.webSocketUrl));
    const button=el('button','','複製');button.type='button';button.setAttribute('aria-label','複製區網端點 '+endpoint.mcpUrl);
    button.addEventListener('click',()=>copy(endpoint.mcpUrl+'\\n'+endpoint.webSocketUrl).catch(e=>note(e.message)));
    row.append(text,button);group.append(row);
  }
  box.append(group);
}
async function refresh(initial=false){
  try{state=await api('/api/status')}catch(error){$('status').dataset.state='error';$('status-text').textContent='無法連線到 server';throw error}
  const online=state.devices.filter(d=>d.status==='online').length;
  $('status').dataset.state='online';
  $('status-text').textContent='服務運行中，'+online+' 台裝置在線';
  $('restart').hidden=!state.restartRequired;
  $('mcp-url').value=state.mcpUrl;$('ws-url').value=state.webSocketUrl;
  $('mode').textContent=state.runtimeMode==='development'?'開發模式：任何符合協定、通過 token 驗證的 Chrome 套件皆可連線。':state.allowlistEnabled?'已啟用 extension ID 允許清單。':'不需預先登記 ID；接受符合協定並通過 token 驗證的 Chrome 套件。';
  deviceList(state.devices);lanList(state.lanEndpoints);
  if(initial){
    const extra=state.environmentOnly;
    $('environment-only').textContent='ENV 進階值：WS host '+extra.webSocketHost+'，TLS '+(extra.webSocketTls?'開':'關')+'，payload '+extra.maxPayloadBytes+' bytes，instances '+extra.maxRegisteredInstances+'，hello timeout '+extra.helloTimeoutMs+' ms';
    for(const [key,value] of Object.entries(state.settings)){
      if(!$(key))continue;
      if(key==='lanEnabled')$(key).checked=value;else $(key).value=Array.isArray(value)?value.join(', '):value;
      $(key).disabled=state.overrides.includes(key);
    }
    $('config-path').textContent=state.configPath;
    $('overrides').textContent=state.overrides.length?'由 ENV 覆寫：'+state.overrides.join(', '):'ENV 優先於設定檔。';
    for(const button of document.querySelectorAll('[data-rotate]'))button.disabled=state.overrides.includes(button.dataset.rotate);
  }
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try{
    if(button.dataset.copy)await copy($(button.dataset.copy).value);
    if(button.dataset.tokenCopy){const result=await api('/api/secrets',{which:button.dataset.tokenCopy});await copy(result.token)}
    if(button.dataset.reveal){
      const input=$(button.dataset.reveal==='mcpToken'?'mcp-token':'bridge-token');
      if(input.type==='text'){input.type='password';input.value=MASK;button.textContent='顯示'}
      else{input.value=(await api('/api/secrets',{which:button.dataset.reveal})).token;input.type='text';button.textContent='隱藏'}
    }
    if(button.dataset.rotate&&confirm('重建 token 後，重啟 server 並更新對應 agent／套件設定。要繼續嗎？')){
      await api('/api/rotate',{which:button.dataset.rotate});await refresh();
      note('新 token 已儲存，重啟後生效。上方仍顯示執行中的 token。');
    }
    if(button.id==='refresh')await refresh();
  }catch(error){note(error.message)}
});
$('settings').addEventListener('submit',async event=>{
  event.preventDefault();
  const values={...state.settings};
  for(const key of Object.keys(values)){
    if($(key).disabled)continue;
    values[key]=key==='lanEnabled'?$(key).checked:key==='extensionIds'?$(key).value.split(',').map(v=>v.trim()).filter(Boolean):Number($(key).value);
  }
  try{await api('/api/settings',values);await refresh();note('設定已儲存。重新啟動 server 後生效。')}catch(error){note(error.message)}
});
refresh(true).catch(error=>note(error.message));
setInterval(()=>refresh().catch(()=>{}),5000);`;
