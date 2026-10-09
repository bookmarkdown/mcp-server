import {DEFAULT_CHROME_EXTENSION_ID} from './pairing-link.js';

export function managementHtml(csrf: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="csrf-token" content="${csrf}">
<meta name="color-scheme" content="dark light">
<title>BookMarkdown MCP</title>
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<link rel="stylesheet" href="/assets/style.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="M25 14h50a5 5 0 0 1 5 5v67L50 71 20 86V19a5 5 0 0 1 5-5ZM31 59h9V39l10 13 10-13v20h9V28H59L50 40 41 28H31Z"/></svg>
      <h1>BookMarkdown MCP</h1>
    </div>
    <nav aria-label="頁面區段"><a href="#connect">連線</a><a href="#devices-section">裝置</a><a href="#settings-section">設定</a></nav>
    <div class="status" id="status" data-state="pending" role="status"><span class="dot" aria-hidden="true"></span><span id="status-text">連線中…</span></div>
  </div>
</header>
<main>
  <div id="restart" class="banner" role="status" hidden>設定已儲存，重新啟動 server 後生效。下方的端點與 token 仍是目前執行中的值。</div>
  <div id="client-updates" class="banner" hidden><p id="client-update-text" role="status"></p><button type="button" id="dismiss-client-updates">已更新客戶端，清除提醒</button></div>

  <section id="connect" aria-labelledby="h-connect">
    <h2 id="h-connect">連線</h2>
    <p class="lead">把 agent 與瀏覽器套件接到這台電腦上的同一個 server。</p>
    <ol class="steps"><li>啟動 server，複製「瀏覽器套件」的 WS URL 與配對 token。</li><li>套件測試成功後「儲存並啟用」，等待「已連線」。</li><li>MCP host 使用獨立的「Agent」HTTP URL 與 Bearer token，再執行唯讀工具檢查。</li></ol>
    <div class="group">
      <div class="group-head"><h3>Agent</h3><span class="tag">MCP HTTP</span></div>
      <div class="field"><label for="mcp-url">端點</label><div class="copy-row"><input id="mcp-url" readonly><button type="button" data-copy="mcp-url">複製</button></div></div>
      <div class="field"><label for="mcp-token">Bearer token</label><div class="copy-row"><input id="mcp-token" type="password" value="••••••••••••••••" readonly><button type="button" data-reveal="mcpToken">顯示</button><button type="button" data-token-copy="mcpToken">複製</button></div></div>
      <p class="hint">在 agent 的 MCP HTTP 設定加入標頭 Authorization: Bearer &lt;token&gt;。</p>
      <p class="hint" id="mcp-token-state"></p>
      <details><summary>不含秘密的 Agent 設定樣板</summary><pre id="agent-template"></pre></details>
    </div>
    <div class="group">
      <div class="group-head"><h3>瀏覽器套件</h3><span class="tag">WebSocket</span></div>
      <div class="field"><label for="ws-url">端點</label><div class="copy-row"><input id="ws-url" readonly><button type="button" data-copy="ws-url">複製</button></div></div>
      <div class="field"><label for="bridge-token">配對 token</label><div class="copy-row"><input id="bridge-token" type="password" value="••••••••••••••••" readonly><button type="button" data-reveal="bridgeToken">顯示</button><button type="button" data-token-copy="bridgeToken">複製</button></div></div>
      <p class="hint">在套件的 MCP 設定填入 WebSocket 端點與配對 token。</p>
      <p class="hint" id="bridge-token-state"></p>
      <div class="field"><label for="pair-extension-id">Chrome 套件 ID</label><input id="pair-extension-id" value="${DEFAULT_CHROME_EXTENSION_ID}" minlength="32" maxlength="32" pattern="[a-p]{32}" required spellcheck="false" autocomplete="off"></div>
      <p class="hint">已預填指定的套件 ID。開發版請改成 chrome://extensions 顯示的 ID；這個欄位不會修改 server 的允許清單。</p>
      <div class="field"><label for="pair-endpoint">帶入套件的 WebSocket 端點</label><select id="pair-endpoint"></select></div>
      <div class="rotate"><button type="button" id="pair-open">連接 Chrome 套件</button><button type="button" id="pair-copy">複製配對連結</button></div>
      <p class="hint" id="pair-feedback" role="status" aria-live="polite"></p>
      <p class="hint">開啟後會帶入草稿並提示測試，儲存並啟用後才會更新套件。配對連結包含目前生效的配對 token，僅提供給要連接的瀏覽器。套件未安裝或 ID 不符時，請先安裝或修正 ID。</p>
    </div>
    <div id="lan-urls"></div>
    <div class="group" aria-labelledby="h-health">
      <h3 id="h-health">連線健康檢查</h3>
      <ol class="steps"><li id="health-server">MCP HTTP：尚未檢查</li><li id="health-extension">套件：尚未註冊</li><li id="health-tool">唯讀工具：尚未檢查</li></ol>
      <label class="field" for="check-instance">檢查裝置</label><select id="check-instance"></select>
      <button type="button" id="check-connection">執行唯讀 MCP 檢查</button>
      <p class="hint" id="connection-feedback" role="status" aria-live="polite"></p>
      <p class="hint">只執行 initialize、tools/list 與分頁計數，不開啟、移動或關閉分頁。這能驗證本機 HTTP 工具路徑；你的 MCP host 仍須另設定 Agent URL 與 token。</p>
    </div>
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
      <p id="settings-feedback" class="hint" role="status" aria-live="polite"></p>
    </form>

    <div class="group">
      <div class="group-head"><h3>重建 token</h3></div>
      <p class="hint">重建後，重啟 server 並更新對應 agent 或套件的 token。</p>
      <div class="rotate"><button type="button" class="danger" data-rotate="mcpToken">重建 MCP token</button><button type="button" class="danger" data-rotate="bridgeToken">重建配對 token</button></div>
      <p id="rotate-feedback" class="hint" role="status" aria-live="polite"></p>
    </div>
    <p class="hint">設定檔：<code id="config-path"></code></p>
  </section>
</main>
<div id="notice" role="status" aria-live="polite"></div>
</body>
</html>`;
}

export const managementIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>path{fill:#000000}@media(prefers-color-scheme:dark){path{fill:#ffffff}}</style><path fill-rule="evenodd" d="M25 14h50a5 5 0 0 1 5 5v67L50 71 20 86V19a5 5 0 0 1 5-5ZM31 59h9V39l10 13 10-13v20h9V28H59L50 40 41 28H31Z"/></svg>`;

export const managementCss = `:root{
  color-scheme:dark light;
  --bg:#101612;--surface:#17201a;--field:#0f1511;--line:#2a3830;--text:#e7eee8;--muted:#9aaa9f;
  --accent:#c6ef8d;--btn:#c6ef8d;--on-btn:#15251d;--danger:#f2958a;
  --brand:#ffffff;
  --warn-bg:#2b2512;--warn-line:#6b5a1f;--warn-text:#f0d98a;
  --mono:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;
  --sans:"Segoe UI Variable","Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
}
@media(prefers-color-scheme:light){:root{
  --bg:#f5f7f2;--surface:#ffffff;--field:#f5f7f2;--line:#d4dcd0;--text:#17221b;--muted:#566559;
  --accent:#2f6b13;--btn:#2f6b13;--on-btn:#ffffff;--danger:#a8321f;
  --brand:#000000;
  --warn-bg:#fff4d6;--warn-line:#e3c25a;--warn-text:#5a4300;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 var(--sans)}
h1,h2,h3,p{margin:0}
.topbar{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:880px;margin:auto;padding:12px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px}
.brand{display:flex;align-items:center;gap:10px;margin-right:auto}
.brand-mark{width:26px;height:26px;fill:var(--brand)}
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
input:not([type=checkbox]),select{width:100%;background:var(--field);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:8px 10px;font:13px/1.4 var(--mono)}
select{margin-bottom:12px}
.steps{margin:12px 0;padding-left:24px;color:var(--muted)}
.steps li{margin:6px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 var(--mono)}
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
.banner button{margin-top:8px;white-space:normal}
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
let lastCheck;
let checking=false;
let pairing=false;
const PAIR_ID='bookmarkdown.pairing-extension-id';
try{const saved=localStorage.getItem(PAIR_ID);if(/^[a-p]{32}$/.test(saved||''))$('pair-extension-id').value=saved}catch{}
const REMINDER='bookmarkdown.client-updates';
let reminder;
try{const saved=JSON.parse(localStorage.getItem(REMINDER)||'null');if(saved&&typeof saved.configPath==='string'&&typeof saved.serverInstanceId==='string'&&typeof saved.agents==='boolean'&&typeof saved.bridge==='boolean'&&Array.isArray(saved.extensions)&&saved.extensions.length<=64&&saved.extensions.every(v=>typeof v==='string'&&v.length<=64))reminder=saved}catch{}
function saveReminder(){try{if(reminder)localStorage.setItem(REMINDER,JSON.stringify(reminder));else localStorage.removeItem(REMINDER)}catch{}}
function note(text,target){if(target)$(target).textContent=text;const box=$('notice');box.textContent=text;clearTimeout(noticeTimer);if(text)noticeTimer=setTimeout(()=>{box.textContent=''},6000)}
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
function health(){
  const select=$('check-instance');const previous=select.value;
  select.replaceChildren();
  const online=state.devices.filter(d=>d.status==='online');
  if(!online.length){const option=el('option','','尚未註冊裝置');option.value='';select.append(option)}
  for(const device of online){const option=el('option','',device.displayName||device.instanceId);option.value=device.instanceId;select.append(option)}
  if(online.some(d=>d.instanceId===previous))select.value=previous;
  if(previous!==select.value)lastCheck=undefined;
  $('health-server').textContent='MCP HTTP：'+(lastCheck?.server==='passed'?'已通過認證與工具目錄檢查':lastCheck?.server==='failed'?'檢查失敗；確認執行中的 MCP 設定':'服務運行中，尚未檢查 MCP');
  $('health-extension').textContent='套件：'+(select.value&&lastCheck?.extension!=='missing'?'已註冊裝置':'尚未註冊，先在套件儲存並啟用 bridge');
  $('health-tool').textContent='唯讀工具：'+(lastCheck?.tool==='passed'?'分頁計數成功':lastCheck?.tool==='failed'?'讀取失敗；確認套件在線與能力':'尚未驗證');
}
function pairingEndpoints(){
  const select=$('pair-endpoint');const previous=select.value;select.replaceChildren();
  for(const url of new Set([state.webSocketUrl,...state.lanEndpoints.map(value=>value.webSocketUrl)])){
    const option=el('option','',url);option.value=url;select.append(option);
  }
  if([...select.options].some(option=>option.value===previous))select.value=previous;
}
async function handoffPairing(open){
  const id=$('pair-extension-id');if(pairing||!id.reportValidity())return;
  pairing=true;$('pair-open').disabled=true;$('pair-copy').disabled=true;
  try{
    const result=await api('/api/pairing-link',{extensionId:id.value,endpointUrl:$('pair-endpoint').value});
    try{localStorage.setItem(PAIR_ID,id.value)}catch{}
    if(open)location.assign(result.url);
    else{await copy(result.url);note('已複製配對連結，包含目前生效的配對 token。只分享給要連接的瀏覽器。','pair-feedback')}
  }catch{note('無法建立配對連結。請確認 server 仍在執行、套件 ID 正確，然後重試。','pair-feedback')}
  finally{pairing=false;$('pair-open').disabled=false;$('pair-copy').disabled=false}
}
function credentialState(){
  const changes=state.pendingChanges||[];
  for(const [key,id] of [['mcpToken','mcp-token-state'],['bridgeToken','bridge-token-state']])$(id).textContent=changes.includes(key)?'新 token 已儲存、待重啟生效；顯示／複製仍取執行中的 token。':'顯示／複製的是目前執行中的 token。';
  const agents=changes.includes('mcpToken');const bridge=changes.includes('bridgeToken');
  if(reminder&&reminder.configPath!==state.configPath){reminder=undefined;saveReminder()}
  if(agents||bridge){
    reminder={configPath:state.configPath,serverInstanceId:state.serverInstanceId,agents:agents||Boolean(reminder?.agents),extensions:bridge?[...new Set([...(reminder?.extensions||[]),...state.devices.map(d=>d.displayName||d.instanceId)])].slice(0,64):reminder?.extensions||[],bridge:bridge||Boolean(reminder?.bridge)};
    saveReminder();
  }
  $('client-updates').hidden=!reminder;
  if(reminder){
    const active=reminder.serverInstanceId!==state.serverInstanceId;
    const clients=[];
    if(reminder.agents)clients.push('所有使用這個 server 的 Agent／MCP host');
    if(reminder.bridge)clients.push('使用此 server 的瀏覽器套件'+(reminder.extensions.length?'（已知裝置：'+reminder.extensions.join('、')+'）':''));
    $('client-update-text').textContent=(active?'已重啟，重建的 token 已生效。請更新：':'Token 變更待重啟生效。重啟後請更新：')+clients.join('；')+'。新 token 生效後從上方對應卡片複製。';
    $('dismiss-client-updates').disabled=!active;
  }
}
function lanList(endpoints){
  const box=$('lan-urls');box.replaceChildren();
  if(!endpoints.length)return;
  const group=el('div','group');const head=el('div','group-head');head.append(el('h3','','區網端點'));group.append(head);
  for(const endpoint of endpoints){
    const row=el('div','lan-row');const text=el('div','lan-text');
    text.append(el('code','',endpoint.mcpUrl),el('code','',endpoint.webSocketUrl));
    const buttons=el('div','rotate');
    for(const [label,url] of [['複製 Agent HTTP',endpoint.mcpUrl],['複製套件 WS',endpoint.webSocketUrl]]){
      const button=el('button','',label);button.type='button';button.setAttribute('aria-label',label+' '+url);
      button.addEventListener('click',()=>copy(url).catch(e=>note(e.message)));buttons.append(button);
    }
    row.append(text,buttons);group.append(row);
  }
  box.append(group);
}
async function refresh(initial=false){
  const previous=state?.serverInstanceId;
  try{state=await api('/api/status')}catch(error){$('status').dataset.state='error';$('status-text').textContent='無法連線到 server';throw error}
  if(previous&&previous!==state.serverInstanceId){location.reload();return}
  const online=state.devices.filter(d=>d.status==='online').length;
  $('status').dataset.state='online';
  $('status-text').textContent='服務運行中，'+online+' 台裝置在線';
  $('restart').hidden=!state.restartRequired;
  $('mcp-url').value=state.mcpUrl;$('ws-url').value=state.webSocketUrl;
  $('mode').textContent=state.runtimeMode==='development'?'開發模式：任何符合協定、通過 token 驗證的 Chrome 套件皆可連線。':state.allowlistEnabled?'已啟用 extension ID 允許清單。':'不需預先登記 ID；接受符合協定並通過 token 驗證的 Chrome 套件。';
  deviceList(state.devices);lanList(state.lanEndpoints);health();credentialState();pairingEndpoints();
  $('agent-template').textContent='URL: '+state.mcpUrl+'\\nAuthorization: Bearer <貼入 Agent MCP token>';
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
    if(button.id==='pair-open'||button.id==='pair-copy')await handoffPairing(button.id==='pair-open');
    if(button.id==='dismiss-client-updates'){reminder=undefined;saveReminder();$('client-updates').hidden=true}
    if(button.id==='check-connection'&&!checking){
      checking=true;button.disabled=true;lastCheck=undefined;
      $('connection-feedback').textContent='正在執行唯讀檢查…';
      try{lastCheck=await api('/api/connection-check',$('check-instance').value?{instanceId:$('check-instance').value}:{});health();
        $('connection-feedback').textContent=lastCheck.tool==='passed'?'HTTP 與套件唯讀工具路徑已通過。MCP host 仍須使用自己的 Agent 設定。':lastCheck.server==='passed'&&lastCheck.extension==='missing'?'MCP server 可用；先啟用套件，已驗證 probe 不代表已註冊。':'檢查未通過。確認 server 執行中、套件已連線，再試一次。';
      }catch(error){note(error.message,'connection-feedback')}finally{checking=false;button.disabled=false}
    }
    if(button.dataset.copy)await copy($(button.dataset.copy).value);
    if(button.dataset.tokenCopy){const result=await api('/api/secrets',{which:button.dataset.tokenCopy});await copy(result.token)}
    if(button.dataset.reveal){
      const input=$(button.dataset.reveal==='mcpToken'?'mcp-token':'bridge-token');
      if(input.type==='text'){input.type='password';input.value=MASK;button.textContent='顯示'}
      else{input.value=(await api('/api/secrets',{which:button.dataset.reveal})).token;input.type='text';button.textContent='隱藏'}
    }
    if(button.dataset.rotate&&confirm('重建 token 後，重啟 server 並更新對應 agent／套件設定。要繼續嗎？')){
      await api('/api/rotate',{which:button.dataset.rotate});await refresh();
      note('新 token 已儲存，重啟後生效。上方仍顯示執行中的 token。','rotate-feedback');
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
  try{await api('/api/settings',values);await refresh();note('設定已儲存。重新啟動 server 後生效。','settings-feedback')}catch(error){note(error.message,'settings-feedback')}
});
$('check-instance').addEventListener('change',()=>{lastCheck=undefined;health();$('connection-feedback').textContent=''});
refresh(true).catch(error=>note(error.message));
setInterval(()=>refresh().catch(()=>{}),5000);`;
