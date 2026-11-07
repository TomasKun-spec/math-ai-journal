'use strict';
(() => {
  const $=id=>document.getElementById(id),empty=()=>({version:1,entries:[],images:{}});
  const S={public:empty(),library:empty(),session:{authenticated:false},ready:false,busy:false,dirty:false,active:null,page:'',hash:'',preview:false,filter:'all',message:''};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const link=(text,to,cls)=>{const n=el('a',text,cls);n.href=to;return n;};
  const auth=()=>S.session.authenticated===true;
  const idOf=(library,id)=>library.entries.find(e=>e.id===id);
  const published=id=>!!idOf(S.public,id);
  const sameVersion=(a,b)=>!!a&&!!b&&['title','body','topic','kind','updated'].every(k=>a[k]===b[k]);
  const typeName=kind=>kind==='note'?'随记':'文章';
  const stateName=e=>published(e.id)?(sameVersion(e,idOf(S.public,e.id))?'已发布':'已发布 · 有新修改'):'未发布';
  const sorted=arr=>[...arr].sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated));
  const date=(value,time=false)=>{const d=new Date(value);return !value||isNaN(d.getTime())?'':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',...(time?{hour:'2-digit',minute:'2-digit'}:{})}).format(d);};
  const themes=entries=>[...new Set(entries.map(e=>e.topic.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const option=(value,text)=>{const n=el('option',text);n.value=value;return n;};
  const summary=(body,n=110)=>{const s=body.replace(/!\[[^\]\n]*\]\(\/media\/[a-f0-9]{64}\)/g,'〔插图〕').replace(/\$\$[\s\S]*?\$\$/g,'〔公式〕').replace(/^\s*#{1,6}\s+/gm,'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n)+'…':s;};
  let timer;
  function say(text,error=false){clearTimeout(timer);$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').hidden=false;timer=setTimeout(()=>$('notice').hidden=true,error?9000:4400);}
  function problem(err){const text=err?.message||'操作没有完成，请保留当前文字后重试。';S.message=text;if($('settings').open)$('settings-msg').textContent=text;if(S.page==='writer')$('save-status').textContent=text;say(text,true);chrome();}
  async function api(path,payload){if(!window.JournalAPI)throw new Error('网站连接组件没有加载，请刷新页面重试。');return window.JournalAPI.api(path,payload);}
  function requireAuthor(){if(!auth())throw new Error('请先通过「管理」连接作者账户。');}
  function chrome(){
    document.querySelectorAll('[data-author]').forEach(n=>n.hidden=!auth());
    $('author-state').textContent=(S.dirty?'当前修改未保存　/　':'')+(S.busy?(S.message||'正在与 GitHub 通信……'):'作者已连接 · 保存私有稿后，可在其他设备继续写作');
    $('global-sync').dataset.phase=S.busy?'syncing':S.dirty?'waiting':'synced';
    $('connect-panel').hidden=auth();$('connected-panel').hidden=!auth();$('settings-title').textContent=auth()?'作者账户与备份':'连接作者账户';
    $('connection-info').textContent=auth()?'已连接 '+(S.session.owner||'作者账户')+'。私有文库：'+(S.session.repo||'已配置仓库'):'';
  }
  function run(fn,needsAuthor=true){return async(...args)=>{
    if(S.busy||!S.ready)return;
    if(needsAuthor&&!auth()){settings();return;}
    S.busy=true;S.message='正在与 GitHub 通信……';chrome();
    const locked=[...document.querySelectorAll('#writer button:not([disabled]), #writer input:not([disabled]), #writer textarea:not([disabled]), #writer select:not([disabled]), #settings button:not(#close-settings):not([disabled]), #author-token:not([disabled]), #refresh-library:not([disabled])')];locked.forEach(n=>n.disabled=true);
    try{await fn(...args);}catch(err){problem(err);}finally{S.busy=false;locked.forEach(n=>n.disabled=false);chrome();}
  };}
  function page(name){['home','desk','reader','writer','missing','restricted','startup'].forEach(id=>$(id).hidden=id!==name);S.page=name;}
  function markNav(key){document.querySelectorAll('[data-nav]').forEach(n=>n.dataset.nav===key?n.setAttribute('aria-current','page'):n.removeAttribute('aria-current'));}
  function blank(title,body,text,to){const n=el('div',null,'blank');n.append(el('h2',title),el('p',body));if(text)n.append(link(text,to,'ink-link'));return n;}
  function row(entry,privateView){
    const n=el('article',null,'entry-row'),d=el('time',date(entry.updated),'date');d.dateTime=entry.updated;n.append(d);
    const content=el('div');content.append(link(entry.title,(privateView?'#draft/':'#read/')+entry.id,'row-title'));const s=summary(entry.body);if(s)content.append(el('p',s,'row-summary'));n.append(content);
    if(privateView){const tools=el('div',null,'row-tools');tools.append(el('span',stateName(entry)),link('编辑 ↗','#write/'+entry.id));n.append(tools);}
    else{const meta=el('div',null,'row-meta');meta.append(el('span',typeName(entry.kind),'kind'),el('strong',entry.topic||'未分类'));n.append(meta);}return n;
  }
  function home(params){
    page('home');let kind=params.get('kind');if(!['article','note'].includes(kind))kind='all';
    const all=sorted(S.public.entries),topicNames=themes(all);let topic=params.get('topic')||'';if(!topicNames.includes(topic))topic='';
    $('topic-pick').replaceChildren(option('','全部主题'),...topicNames.map(t=>option(t,t)));$('topic-pick').value=topic;$('topic-pick').dataset.kind=kind;
    const filtered=kind!=='all'||!!topic;$('feature').hidden=filtered;
    const lead=all[0];$('lead-label').textContent=lead?'卷首 / 最近发布 · '+typeName(lead.kind):'卷首 / OPENING PAGE';
    $('lead-title').textContent=lead?lead.title:'把未想清的问题，\n也写下来。';
    $('lead-deck').textContent=lead?(summary(lead.body,145)||'打开这一页，继续阅读。'):'一本慢慢写成的个人文集。关于数学与 AI，也给偶然出现的想法留一页。';
    $('lead-link').hidden=!lead&&!auth();$('lead-link').textContent=lead?'阅读全文 ↗':'开始写作 ↗';$('lead-link').href=lead?'#read/'+lead.id:'#write/article';$('lead-date').textContent=lead?date(lead.updated):'第一篇，正在酝酿。';
    $('index-title').textContent=kind==='all'?'文集索引':kind==='article'?'文章索引':'随记索引';
    const list=all.filter(e=>(kind==='all'||e.kind===kind)&&(!topic||e.topic.trim()===topic));$('index-rows').replaceChildren(...list.map(e=>row(e,false)));
    if(!list.length)$('index-rows').append(blank(filtered?'这一栏暂时没有文章':'留一页，给接下来的思考',filtered?'换一个主题，或回到完整文集。':'新文章会在这里陆续展开。感谢你来读。',filtered?'查看全部 →':auth()?'去写作间 →':null,filtered?'#home':'#desk'));
    markNav(kind==='all'?'home':kind);
  }
  function desk(){
    page('desk');markNav('desk');document.querySelectorAll('[data-desk-filter]').forEach(b=>b.setAttribute('aria-pressed',String(S.filter===b.dataset.deskFilter)));
    const list=sorted(S.library.entries.filter(e=>S.filter==='all'||(S.filter==='published'?published(e.id):!published(e.id))));
    $('desk-rows').replaceChildren(...list.map(e=>row(e,true)));if(!list.length)$('desk-rows').append(blank('这一栏还没有文稿','先保存到私有文库，准备好后再发布给读者。','开始写作 →','#write/article'));
  }
  function math(tex,display){
    const n=el(display?'div':'span',null,display?'math-block':'math-inline');if(!window.katex){n.append(el('code',tex));return n;}
    try{window.katex.render(tex,n,{displayMode:display,throwOnError:false,trust:false,strict:'ignore',maxExpand:600,maxSize:30,output:'htmlAndMathml'});}catch{n.append(el('code',tex));}return n;
  }
  function inline(text,n){const re=/\\\(([\s\S]*?)\\\)|(?<!\\)\$(?!\$)([^\n$]+?)(?<!\\)\$/g;let at=0;for(const m of text.matchAll(re)){n.append(document.createTextNode(text.slice(at,m.index)),math(m[1]??m[2],false));at=m.index+m[0].length;}n.append(document.createTextNode(text.slice(at)));}
  function renderBody(body,target,images){
    const out=document.createDocumentFragment();
    function paragraphs(text){let parts=[];const flush=()=>{if(parts.length){const n=el('p');inline(parts.join('\n'),n);out.append(n);parts=[];}};
      for(const line of text.split('\n')){const h=/^(#{1,3})\s+(.+)$/.exec(line);if(h){flush();const n=el(h[1].length<3?'h2':'h3');inline(h[2],n);out.append(n);}else if(!line.trim())flush();else parts.push(line);}flush();}
    const re=/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|!\[([^\]\r\n]{0,240})\]\(\/media\/([a-f0-9]{64})\)/g;let at=0;
    for(const m of body.matchAll(re)){paragraphs(body.slice(at,m.index));if(m[4]){const image=images[m[4]],fig=el('figure');if(image&&['image/png','image/jpeg','image/webp'].includes(image.mime)&&typeof image.data==='string'){const n=el('img');n.src='data:'+image.mime+';base64,'+image.data;n.alt=m[3]||'文稿插图';n.loading='lazy';fig.append(n);}else fig.append(el('p','此处插图暂不可用。'));if(m[3])fig.append(el('figcaption',m[3]));out.append(fig);}else out.append(math(m[1]??m[2],true));at=m.index+m[0].length;}
    paragraphs(body.slice(at));if(!out.childNodes.length)out.append(el('p','这篇文稿还没有正文。'));target.replaceChildren(out);
  }
  function read(entry,privateView){
    page('reader');markNav(privateView?'desk':'');$('read-title').textContent=entry.title;
    $('read-label').textContent=[typeName(entry.kind),entry.topic||'未分类',privateView?'私有文稿预览':''].filter(Boolean).join(' / ');
    $('read-date').textContent='写于 '+date(entry.created)+'　·　更新 '+date(entry.updated);$('read-edit').hidden=!auth()||!idOf(S.library,entry.id);$('read-edit').href='#write/'+entry.id;$('share-article').hidden=privateView;
    renderBody(entry.body,$('read-body'),privateView?S.library.images:S.public.images);
  }
  function preview(on){S.preview=on;$('edit-grid').hidden=on;$('write-preview').hidden=!on;$('preview-btn').textContent=on?'继续编辑':'预览';
    if(on){$('preview-title').textContent=$('entry-title').value.trim()||'未命名文稿';$('preview-label').textContent='写作预览 · 尚未发布此次修改　/　'+typeName($('entry-kind').value)+'　/　'+($('entry-topic').value.trim()||'未分类');renderBody($('entry-body').value,$('preview-body'),S.library.images);}}
  function count(){$('word-count').textContent=$('entry-body').value.replace(/\s/g,'').length.toLocaleString('zh-CN')+' 字符';}
  function changed(){S.dirty=true;count();$('save-status').textContent='有尚未保存到私有文库的修改';chrome();}
  function updateWriterMeta(){
    const entry=S.active,live=!!entry&&published(entry.id);$('delete-btn').hidden=!entry;$('unpublish-btn').hidden=!live;$('file-btn').textContent=live?'更新网站文章 ↗':'发布到网站 ↗';$('publish-state').textContent=entry?stateName(entry):'尚未发布';
    $('save-status').textContent=entry?'私有稿已保存于 GitHub · '+date(entry.updated,true):'新文稿 · 尚未保存到 GitHub';
  }
  function write(entry,kind){page('writer');markNav('desk');S.active=entry||null;S.dirty=false;preview(false);$('entry-title').value=entry?.title||'';$('entry-body').value=entry?.body||'';$('entry-kind').value=entry?.kind||kind||'article';$('entry-topic').value=entry?.topic||'';$('known-topics').replaceChildren(...themes(S.library.entries).map(t=>option(t,t)));$('writer-remote-note').hidden=true;updateWriterMeta();count();}
  function route(raw=location.hash||'#home',scroll=true){
    S.hash=raw;S.active=null;S.dirty=false;S.preview=false;const [path,query]=raw.slice(1).split('?'),[name,id]=path.split('/');let title='数学、AI 与未完成的思考';
    if(['desk','write','draft'].includes(name)&&!auth()){page('restricted');markNav('');}
    else if(name==='home'||!name)home(new URLSearchParams(query));
    else if(name==='desk'){desk();title='我的文稿';}
    else if(name==='read'&&idOf(S.public,id)){const entry=idOf(S.public,id);read(entry,false);title=entry.title;}
    else if(name==='draft'&&idOf(S.library,id)){const entry=idOf(S.library,id);read(entry,true);title=entry.title;}
    else if(name==='write'&&(id==='article'||id==='note'||idOf(S.library,id))){write(idOf(S.library,id),id);title='写作间';}
    else{page('missing');markNav('');}
    document.title=title+' · 未定式';chrome();if(scroll)window.scrollTo({top:0,behavior:'instant'});
  }
  function go(to,replace=false){history[replace?'replaceState':'pushState'](null,'',to);route(to);}
  const leaveOK=()=>!S.dirty||confirm('当前修改还没有保存到 GitHub。确定放弃修改并离开吗？');
  window.addEventListener('hashchange',()=>{if(!S.ready)return;if((location.hash||'#home')===S.hash)return;if(S.busy||!leaveOK()){history.replaceState(null,'',S.hash);return;}route();});
  window.addEventListener('beforeunload',e=>{if(S.dirty||S.busy){e.preventDefault();e.returnValue='';}});
  $('skip').addEventListener('click',e=>{e.preventDefault();$('main').focus();});
  $('topic-pick').addEventListener('change',e=>{const p=new URLSearchParams(),kind=e.target.dataset.kind;if(kind!=='all')p.set('kind',kind);if(e.target.value)p.set('topic',e.target.value);location.hash='#home'+(p.size?'?'+p:'');});
  document.querySelectorAll('[data-desk-filter]').forEach(b=>b.addEventListener('click',()=>{S.filter=b.dataset.deskFilter;desk();}));
  ['entry-title','entry-body','entry-topic','entry-kind'].forEach(id=>$(id).addEventListener('input',changed));
  $('preview-btn').addEventListener('click',()=>preview(!S.preview));
  async function loadAuthor(){requireAuthor();const [library,publicLibrary]=await Promise.all([api('library'),api('published')]);S.library=library;S.public=publicLibrary;}
  async function savePrivate(){
    const old=S.active;
    if(!$('entry-title').value.trim()&&!$('entry-body').value.trim())throw new Error('请先写一个标题或几行正文。');
    const payload={title:$('entry-title').value.trim(),kind:$('entry-kind').value,topic:$('entry-topic').value.trim(),body:$('entry-body').value,status:old?.status||'draft'};
    if(old){payload.id=old.id;payload.expected_updated=old.updated;}
    S.message='正在保存到私有文库……';chrome();const {entry}=await api('entry',payload);
    S.library.entries=S.library.entries.filter(e=>e.id!==entry.id);S.library.entries.unshift(entry);S.active=entry;S.dirty=false;$('entry-title').value=entry.title;S.hash='#write/'+entry.id;history.replaceState(null,'',S.hash);updateWriterMeta();chrome();return entry;
  }
  $('draft-btn').addEventListener('click',run(async()=>{await savePrivate();say('已保存到 GitHub 私有文库，网站公开版本没有改变。');}));
  $('file-btn').addEventListener('click',run(async()=>{
    const title=$('entry-title').value.trim()||'这篇文章';
    if(!confirm('确认把「'+title+'」发布到公开网站？\n\n文章正文和文内图片会进入公开仓库，任何人都可以阅读。公开历史可能保留发布过的内容。'))return;
    const entry=await savePrivate();S.message='私有稿已保存，正在提交公开发布……';chrome();
    try{await api('publish',{id:entry.id,expected_updated:entry.updated});S.public=await api('published');updateWriterMeta();say('已提交发布，公开页通常稍后更新。');go('#read/'+entry.id);}
    catch(err){updateWriterMeta();throw new Error('私有稿已保存，公开发布未确认完成：'+(err.message||'请刷新文库检查后重试。'));}
  }));
  $('unpublish-btn').addEventListener('click',run(async()=>{
    const entry=S.active;if(!entry||!confirm('确认从公开网站撤下「'+entry.title+'」？\n私有稿会保留。公开仓库历史及他人已有的副本不会因此消失。'))return;
    await api('unpublish',{id:entry.id,expected_updated:entry.updated});S.public=await api('published');const dirty=S.dirty;updateWriterMeta();if(dirty)$('save-status').textContent='公开撤下已提交；当前修改尚未保存';say('已提交撤下，网站部署完成后生效。私有稿仍然保留。');
  }));
  $('delete-btn').addEventListener('click',run(async()=>{
    const entry=S.active;if(!entry)return;if(published(entry.id))throw new Error('请先撤下公开文章，再删除私有文稿。');
    if(!confirm('确认删除私有文稿「'+entry.title+'」及当前未保存的修改？'))return;
    await api('delete',{id:entry.id,expected_updated:entry.updated});S.library.entries=S.library.entries.filter(e=>e.id!==entry.id);S.dirty=false;go('#desk',true);say('私有文稿已删除。');
  }));
  function insert(before,sample,after){const n=$('entry-body'),a=n.selectionStart,b=n.selectionEnd,text=n.value.slice(a,b)||sample;if(n.value.length-(b-a)+before.length+text.length+after.length>n.maxLength)throw new Error('正文已达到长度上限。');n.setRangeText(before+text+after,a,b,'end');n.setSelectionRange(a+before.length,a+before.length+text.length);changed();n.focus();}
  document.querySelectorAll('[data-insert]').forEach(b=>b.addEventListener('click',()=>{try{if(b.dataset.insert==='heading')insert('\n\n## ','小标题','\n\n');else if(b.dataset.insert==='inline')insert('$','x^2','$');else insert('\n\n$$\n','\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}','\n$$\n\n');}catch(err){problem(err);}}));
  $('add-image').addEventListener('click',()=>$('image-file').click());
  const imageData=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('无法读取图片。'));r.readAsDataURL(file);});
  $('image-file').addEventListener('change',run(async()=>{
    const input=$('image-file'),file=input.files[0];input.value='';if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>3*1024*1024)throw new Error('请使用不超过 3 MiB 的 PNG、JPEG 或 WebP 图片。');
    S.message='正在把图片保存到私有文库……';chrome();const image={mime:file.type,data:await imageData(file)},{key}=await api('image',image);if(!/^[a-f0-9]{64}$/.test(key))throw new Error('图片保存结果无效。');S.library.images[key]=image;
    const name=file.name.replace(/\.[^.]+$/,'').replace(/[\]\r\n]/g,' ').slice(0,150)||'插图';insert('\n\n![',name,'](/media/'+key+')\n\n');say('图片已存入私有文库。发布文章时，文中引用的图片也会公开。');
  }));
  function settings(){if(!S.ready)return;$('settings-msg').textContent='';chrome();$('settings').showModal();}
  document.querySelectorAll('[data-settings]').forEach(b=>b.addEventListener('click',settings));
  $('close-settings').addEventListener('click',()=>$('settings').close());
  $('settings').addEventListener('close',()=>$('author-token').value='');
  $('connect-btn').addEventListener('click',run(async()=>{
    const token=$('author-token').value.trim();if(!token)throw new Error('请在此输入 GitHub 授权令牌。');$('author-token').value='';$('settings-msg').textContent='正在验证账户与仓库权限……';
    await window.JournalAPI.login(token);S.session=await api('session');requireAuthor();await loadAuthor();chrome();$('settings-msg').textContent='已连接。可以在这台设备上继续写作。';$('settings').close();go('#desk');
  },false));
  $('author-token').addEventListener('keydown',e=>{if(e.key==='Enter'&&!S.busy){e.preventDefault();$('connect-btn').click();}});
  function clearPrivateUI(){
    S.library=empty();S.active=null;S.dirty=false;S.preview=false;S.filter='all';
    ['author-token','entry-title','entry-body','entry-topic','image-file','import-file'].forEach(id=>$(id).value='');
    ['desk-rows','known-topics','read-body','preview-body'].forEach(id=>$(id).replaceChildren());
    ['read-title','read-label','read-date','preview-title','preview-label','save-status','word-count','connection-info','settings-msg'].forEach(id=>$(id).textContent='');
    $('entry-kind').value='article';$('delete-btn').hidden=true;$('unpublish-btn').hidden=true;$('writer-remote-note').hidden=true;$('read-edit').hidden=true;
  }
  $('logout-btn').addEventListener('click',run(async()=>{
    if(!leaveOK())return;const disconnected=window.JournalAPI.logout();S.session={authenticated:false};clearPrivateUI();$('settings').close();go('#home',true);await disconnected;say('当前页面已断开，私有文稿保留在 GitHub。');
  }));
  async function refreshAuthor(){if(S.dirty)throw new Error('请先保存当前文字，再刷新文库，避免覆盖未保存的修改。');await loadAuthor();if(S.page==='writer'&&S.active){const current=idOf(S.library,S.active.id);$('writer-remote-note').hidden=!!current&&current.updated===S.active.updated;say('文库已刷新，编辑中的文字保持不变。');}else route(S.hash,false);$('settings-msg').textContent='文库已刷新。';}
  $('refresh-library').addEventListener('click',run(refreshAuthor));$('refresh-account').addEventListener('click',run(refreshAuthor));
  $('export-file').addEventListener('click',run(async()=>{if(S.dirty&&!confirm('导出只包含已经保存的私有文稿，当前未保存文字不在其中。继续吗？'))return;const snapshot=await Promise.resolve(window.JournalAPI.exportData());const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=link('下载',url);a.download='weidingshi-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}));
  $('import-btn').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',run(async()=>{
    const n=$('import-file'),file=n.files[0];n.value='';if(!file)return;if(S.dirty)throw new Error('请先保存当前修改，再导入文库。');if(file.size>44*1024*1024)throw new Error('备份文件过大，当前文库上限为 32 MiB。');
    let library;try{library=JSON.parse(await file.text());}catch{throw new Error('无法读取这个 JSON 文件。');}if(!library||library.version!==1||!Array.isArray(library.entries))throw new Error('请选择未定式的版本 1 文库备份。');
    if(!confirm('把「'+file.name+'」中的 '+library.entries.length+' 篇文稿合并到 GitHub 私有文库？\n这些文稿不会自动发布到网站。'))return;
    const result=await api('import',{library});await loadAuthor();if(S.page!=='writer')route(S.hash,false);$('settings-msg').textContent='已导入 '+result.added+' 篇文稿到私有文库。';
  }));
  $('share-article').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);say('文章链接已复制。');}catch{window.prompt('复制这个文章链接：',location.href);}});
  function plate(){
    const ns='http://www.w3.org/2000/svg',g=$('wire'),patch=[];
    const project=(t,v)=>{const a=(1+.43*v*Math.cos(t/2))*Math.cos(t),b=(1+.43*v*Math.cos(t/2))*Math.sin(t),c=.57*v*Math.sin(t/2);return{x:177+91*(a*.83-b*.55),y:151+85*(a*.25+b*.38-c*.91),z:a*.5+b*.76+c*.42};};
    for(let j=0;j<8;j++)for(let k=0;k<80;k++){const v=-1+j/4,w=v+.25,a=k*Math.PI/40,b=(k+1)*Math.PI/40,pts=[project(a,v),project(b,v),project(b,w),project(a,w)];patch.push({pts,z:pts.reduce((s,p)=>s+p.z,0),s:j});}
    const out=document.createDocumentFragment();for(const p of patch.sort((a,b)=>a.z-b.z)){const n=document.createElementNS(ns,'polygon');n.setAttribute('points',p.pts.map(q=>q.x.toFixed(1)+','+q.y.toFixed(1)).join(' '));n.setAttribute('fill',p.s%2?'#e4bca5':'#eac7b1');n.setAttribute('stroke','#8e4939');n.setAttribute('stroke-width','.63');n.setAttribute('stroke-linejoin','round');out.append(n);}g.append(out);
  }
  async function boot(){plate();try{S.session=await api('session');S.public=await api('published');if(auth())S.library=await api('library');S.ready=true;route();}
    catch(err){S.ready=true;$('startup').replaceChildren(el('p','暂时未能打开文集：'+(err.message||'请稍后刷新。')));const retry=el('button','重新加载','btn');retry.type='button';retry.addEventListener('click',()=>location.reload());$('startup').append(retry);chrome();}}
  boot();
})();
