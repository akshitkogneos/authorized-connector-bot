/**
 * Mock target app used to self-test the bot end-to-end.
 *
 * It imitates the real flow: sign-in -> "I understand" -> "Get started" ->
 * prompt toolbar -> Connectors menu with 5 rows -> "Enable actions" ->
 * OAuth popup (account chooser -> scroll-gated Allow) -> "Disable actions".
 *
 *   node mock/server.js            # then point TARGET_URL at the printed URL
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 5599);
const EMAIL = process.env.MOCK_EMAIL || 'tester@example.com';
const PASSWORD = process.env.MOCK_PASSWORD || 'secret123';

const CONNECTORS = ['Enable all connectors', 'Google Search', 'Gmail', 'Google Calendar', 'Google Drive'];
const ACTIONABLE = CONNECTORS.slice(2);

const page = (title, body, script = '') => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>
  body{font-family:system-ui,sans-serif;margin:0;background:#f6f8fc;color:#1f1f1f}
  .wrap{max-width:760px;margin:40px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.12)}
  button{font:inherit;padding:8px 16px;border-radius:20px;border:1px solid #c4c7c5;background:#fff;cursor:pointer}
  button.primary{background:#0b57d0;color:#fff;border-color:#0b57d0}
  button:disabled{opacity:.45;cursor:not-allowed}
  input{font:inherit;padding:10px;width:100%;box-sizing:border-box;border:1px solid #c4c7c5;border-radius:6px;margin:8px 0}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10}
  .modal{background:#fff;padding:28px;border-radius:14px;max-width:460px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 8px;border-bottom:1px solid #eee}
  .row .actions{display:flex;align-items:center;gap:12px}
  .menu{position:absolute;bottom:64px;left:0;width:520px;background:#fff;border:1px solid #ddd;border-radius:12px;padding:8px;box-shadow:0 4px 16px rgba(0,0,0,.18)}
  .toolbar{position:relative;display:flex;gap:8px;margin-top:24px}
  li{list-style:none;padding:14px;border:1px solid #ddd;border-radius:8px;margin:8px 0;cursor:pointer}
  .scroller{height:260px;overflow-y:auto;border:1px solid #ddd;padding:12px;border-radius:8px}
</style></head><body><div class="wrap">${body}</div><script>${script}</script></body></html>`;

/* ----------------------------- sign-in ----------------------------- */

const loginPage = () =>
  page(
    'Sign in',
    `<h2>Sign in</h2>
     <div id="s1"><input type="email" id="identifierId" name="identifier" placeholder="Email"><button class="primary" id="next1">Next</button></div>
     <div id="s2" style="display:none"><input type="password" name="Passwd" placeholder="Password"><button class="primary" id="next2">Next</button></div>
     <p id="err" style="color:#c5221f"></p>`,
    `const $=s=>document.querySelector(s);
     $('#next1').onclick=()=>{ if(!$('#identifierId').value){$('#err').textContent='Enter an email';return;}
       $('#s1').style.display='none'; $('#s2').style.display='block'; };
     $('#next2').onclick=()=>{ const p=$('input[name=Passwd]').value;
       if(p!==${JSON.stringify(PASSWORD)}){$('#err').textContent='Wrong password';return;}
       location.href='/app?u='+encodeURIComponent($('#identifierId').value); };`,
  );

/* ------------------------------- app ------------------------------- */

const appPage = (user) =>
  page(
    'Mock App',
    `<div class="overlay" id="ack"><div class="modal"><h3>Terms</h3>
       <p>This is an experimental feature.</p><button class="primary" id="understand">I understand</button></div></div>

     <div class="overlay" id="welcome" style="display:none"><div role="dialog" class="modal">
       <h3>Welcome</h3><p>Let's set up your workspace.</p><button class="primary" id="start">Get started</button></div></div>

     <div id="app" style="display:none">
       <h2>Prompt</h2>
       <textarea rows="4" style="width:100%" placeholder="Ask anything"></textarea>
       <div class="toolbar">
         <button aria-label="Upload files">+</button>
         <button>Tools</button>
         <button id="conn">Connectors</button>
         <div class="menu" id="menu" style="display:none"></div>
       </div>
     </div>`,
    `const $=s=>document.querySelector(s);
     const NAMES=${JSON.stringify(CONNECTORS)};
     const USER=${JSON.stringify(user)};
     const state={}; NAMES.slice(2).forEach(n=>state[n]=false);

     $('#understand').onclick=()=>{ $('#ack').style.display='none'; $('#welcome').style.display='flex'; };
     $('#start').onclick=()=>{ $('#welcome').style.display='none'; $('#app').style.display='block'; };

     function render(){
       $('#menu').innerHTML = NAMES.map((n,i)=>{
         const act = i<2 ? '' : '<button class="enable" data-n="'+n+'">'+(state[n]?'Disable actions':'Enable actions')+'</button>';
         return '<div class="row"><span>'+n+'</span><div class="actions">'+act+'<input type="checkbox" aria-label="Toggle '+n+'"'+(state[n]?' checked':'')+'></div></div>';
       }).join('');
       document.querySelectorAll('.enable').forEach(b=>b.onclick=()=>{
         const n=b.dataset.n;
         if(state[n]){ state[n]=false; render(); return; }
         window.open('/oauth?c='+encodeURIComponent(n)+'&u='+encodeURIComponent(USER),'oauth','width=600,height=700');
       });
     }
     $('#conn').onclick=()=>{ const m=$('#menu'); const open=m.style.display==='block';
       m.style.display=open?'none':'block'; if(!open) render(); };
     window.addEventListener('message',e=>{ if(e.data&&e.data.granted){ state[e.data.granted]=true; render(); } });`,
  );

/* ------------------------------ oauth ------------------------------ */

const oauthPage = (connector, user) =>
  page(
    'Choose an account',
    `<h2>Choose an account</h2>
     <p>to continue to <b>${connector}</b></p>
     <ul id="accounts">
       <li data-identifier="${user}">${user}</li>
       <li data-identifier="someone.else@example.com">someone.else@example.com</li>
     </ul>

     <div id="consent" style="display:none">
       <h3>${connector} wants access to your account</h3>
       <div class="scroller" id="sc">
         ${Array.from({ length: 25 }, (_, i) => `<p>Permission ${i + 1}: read and manage your ${connector} data.</p>`).join('')}
         <label><input type="checkbox" aria-label="Select all"> Select all</label>
         <div style="margin-top:20px;text-align:right">
           <button id="cancel">Cancel</button>
           <button class="primary" id="allow" disabled>Allow</button>
         </div>
       </div>
       <p id="hint" style="color:#8a6d3b">Scroll down to enable Allow.</p>
     </div>`,
    `const $=s=>document.querySelector(s);
     document.querySelectorAll('#accounts li').forEach(li=>li.onclick=()=>{
       if(li.dataset.identifier!==${JSON.stringify(user)}){ alert('wrong account'); return; }
       $('#accounts').style.display='none'; $('#consent').style.display='block';
     });
     document.addEventListener('scroll',()=>{},true);
     $('#sc').addEventListener('scroll',()=>{
       const el=$('#sc');
       if(el.scrollTop+el.clientHeight>=el.scrollHeight-8){ $('#allow').disabled=false; $('#hint').textContent='Ready.'; }
     });
     $('#allow').onclick=()=>{ window.opener.postMessage({granted:${JSON.stringify(connector)}},'*'); window.close(); };
     $('#cancel').onclick=()=>window.close();`,
  );

/* ------------------------------ server ----------------------------- */

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/app') return res.end(appPage(url.searchParams.get('u') || EMAIL));
    if (url.pathname === '/oauth')
      return res.end(oauthPage(url.searchParams.get('c') || 'App', url.searchParams.get('u') || EMAIL));
    if (url.pathname === '/favicon.ico') return res.end('');
    return res.end(loginPage());
  })
  .listen(PORT, () => {
    console.log(`Mock app running:  http://localhost:${PORT}`);
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  actionable connectors: ${ACTIONABLE.join(', ')}`);
  });
