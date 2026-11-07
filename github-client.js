/* GitHub is contacted only by author actions. Tokens never leave this closure. */
(() => {
  "use strict";
  const LIMIT = 32 * 1024 * 1024, IMAGE_LIMIT = 3 * 1024 * 1024;
  const UTF8 = new TextEncoder(), decoder = new TextDecoder("utf-8", {fatal:true});
  const empty = () => ({version:1, entries:[], images:{}});
  const clone = value => JSON.parse(JSON.stringify(value));
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === keys.slice().sort().join("|");
  const fail = message => { throw new Error(message); };
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const cfg = Object.freeze({...window.JOURNAL_CONFIG});
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(cfg.owner || "") ||
      ![cfg.privateRepo, cfg.publicRepo].every(x => typeof x === "string" && /^[a-z0-9_.-]{1,100}$/i.test(x) && ![".", ".."].includes(x)) ||
      cfg.privateRepo.toLowerCase() === cfg.publicRepo.toLowerCase() ||
      cfg.privatePath !== "undetermined-journal/library-v1.json" || cfg.publicPath !== "published/library-v1.json" ||
      typeof cfg.branch !== "string" || !/^[a-z0-9_.\/-]{1,200}$/i.test(cfg.branch) || cfg.branch.includes(".."))
    fail("网站的 GitHub 配置不完整，请检查配置文件。");

  let token = "", epoch = 0, privateDoc = null, publicDoc = empty();
  let privateMeta = null, publicMeta = null, queue = Promise.resolve();
  const seen = new Map(), active = new Set();
  class APIError extends Error { constructor(status) {
    super(status === 401 ? "GitHub 登录已失效，请重新登录。" :
      status === 403 ? "GitHub 拒绝访问，请检查令牌的仓库权限或稍后重试。" :
      status === 409 || status === 422 ? "GitHub 内容已被其他设备修改或分支不允许提交。本次未覆盖，请保留文字并重新载入。" :
      status === 404 ? "未找到 GitHub 仓库或文件，请检查地址和令牌权限。" :
      status === 429 ? "GitHub 请求过于频繁，请稍后重试。" : "GitHub 请求未完成，请稍后重试。");
    this.status = status;
  }}
  const enqueue = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const checkEpoch = value => { if (value !== epoch) fail("登录状态已改变，本次操作已停止。"); };
  const signed = () => { if (!token || !privateMeta || !publicMeta) fail("请先登录作者账号。"); return {secret:token, generation:epoch}; };
  const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  const hash = async (bytes, algorithm="SHA-256") => hex(await crypto.subtle.digest(algorithm, bytes));
  const bytes = value => { const raw = UTF8.encode(JSON.stringify(value)); if (raw.length > LIMIT) fail("文库超过 32 MiB，请先导出备份并压缩图片。"); return raw; };
  const to64 = raw => { let text = ""; for (let i=0;i<raw.length;i+=8192) text += String.fromCharCode(...raw.subarray(i,i+8192)); return btoa(text); };
  const from64 = text => {
    if (typeof text !== "string" || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
      fail("图片编码无效。");
    const binary = atob(text);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  };
  const blobSHA = async raw => {
    const prefix = UTF8.encode("blob " + raw.length + "\0"), all = new Uint8Array(prefix.length + raw.length);
    all.set(prefix); all.set(raw, prefix.length); return hash(all, "SHA-1");
  };
  async function limited(response, limit) {
    const declared = Number(response.headers.get("content-length"));
    if (declared > limit) fail("服务器返回的数据超过大小限制。");
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(), parts = []; let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.length; if (size > limit) { await reader.cancel(); fail("服务器返回的数据超过大小限制。"); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const all = new Uint8Array(size); let offset=0;
    for (const part of parts) { all.set(part,offset); offset+=part.length; }
    return all;
  }
  async function request(path, auth, {method="GET", data, raw=false, object=false}={}) {
    if (!path.startsWith("/repos/") && path !== "/user") fail("请求地址无效。");
    checkEpoch(auth.generation);
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("https://api.github.com" + path, {
        method, redirect:"error", credentials:"omit", cache:"no-store", signal:controller.signal,
        headers:{"Authorization":"Bearer " + auth.secret, "Accept":raw ? "application/vnd.github.raw+json" :
          object ? "application/vnd.github.object+json" : "application/vnd.github+json",
          "X-GitHub-Api-Version":"2022-11-28", ...(data ? {"Content-Type":"application/json"} : {})},
        ...(data ? {body:JSON.stringify(data)} : {})
      });
      checkEpoch(auth.generation);
      if (!response.ok) {
        const err = new APIError(response.status);
        if (response.status === 409 && method === "GET") {
          try {
            const description = JSON.parse(decoder.decode(await limited(response, 8192))).message;
            err.empty = typeof description === "string" && /^(?:git |this )?repository is empty\.?$/i.test(description);
          } catch (_) {}
        }
        throw err;
      }
      const body = await limited(response, raw ? LIMIT : 2*1024*1024);
      checkEpoch(auth.generation);
      if (raw) return body;
      try { return JSON.parse(decoder.decode(body)); } catch (_) { fail("GitHub 返回的数据格式异常，已停止操作。"); }
    } catch (e) {
      if (e instanceof APIError || e instanceof Error && /^(登录状态|GitHub 返回|服务器返回)/.test(e.message)) throw e;
      fail("无法连接 GitHub，或请求超时。文字不会被覆盖；若刚才正在保存，请重新载入确认是否已提交。");
    } finally { clearTimeout(timer); active.delete(controller); }
  }
  async function inspect(repo, isPrivate, auth, previous=null) {
    const meta = await request("/repos/" + cfg.owner + "/" + repo, auth);
    if (!meta || typeof meta.id !== "number" || typeof meta.full_name !== "string" ||
        meta.full_name.toLowerCase() !== (cfg.owner + "/" + repo).toLowerCase() ||
        previous && previous.id !== meta.id) fail("仓库身份发生变化，操作已停止。");
    if (meta.private !== isPrivate || meta.visibility && meta.visibility !== (isPrivate ? "private" : "public"))
      fail(isPrivate ? "文稿仓库必须保持 Private 私有状态，未上传内容。" : "公开网站仓库必须为 Public，未发布内容。");
    if (!meta.permissions || meta.permissions.push !== true || meta.archived || meta.disabled)
      fail("作者账号没有此仓库的可用写入权限。");
    if (typeof meta.default_branch !== "string" || !meta.default_branch || meta.default_branch.length>255)
      fail("无法确认仓库默认分支。");
    return {id:meta.id, repo, branch:isPrivate ? meta.default_branch : cfg.branch};
  }
  function text(value, limit) { if (typeof value !== "string" || value.length>limit) fail("文章字段格式无效或过长。"); return value; }
  async function imageData(image) {
    if (!exact(image, ["mime","data"]) || !["image/png","image/jpeg","image/webp"].includes(image.mime) ||
        typeof image.data !== "string" || image.data.length > 4*Math.ceil(IMAGE_LIMIT/3)) fail("插图须为不超过 3 MiB 的 PNG、JPEG 或 WebP。");
    const raw = from64(image.data);
    const starts = (...a) => a.every((v,i) => raw[i] === v);
    const detected = starts(137,80,78,71,13,10,26,10) ? "image/png" : starts(255,216,255) ? "image/jpeg" :
      starts(82,73,70,70) && String.fromCharCode(...raw.subarray(8,12)) === "WEBP" ? "image/webp" : "";
    if (!raw.length || raw.length>IMAGE_LIMIT || detected !== image.mime) fail("图片内容与类型不符或超过 3 MiB。");
    return raw;
  }
  async function validate(doc) {
    if (!exact(doc,["version","entries","images"]) || doc.version !== 1 || !Array.isArray(doc.entries) ||
        !doc.images || typeof doc.images !== "object" || Array.isArray(doc.images)) fail("文件不是可识别的未定式文库；未覆盖远端文件。");
    bytes(doc); const ids = new Set();
    for (const entry of doc.entries) {
      if (!exact(entry,["id","title","body","topic","kind","status","created","updated"]) ||
          !/^[a-f0-9]{32}$/.test(entry.id) || ids.has(entry.id) || !["article","note"].includes(entry.kind) ||
          !["draft","filed"].includes(entry.status)) fail("文库的文章结构无效或编号重复。");
      ids.add(entry.id); text(entry.title,300); text(entry.body,1000000); text(entry.topic,120);
      for (const field of ["created","updated"])
        if (typeof entry[field] !== "string" || entry[field].length>45 || !/(Z|[+-]\d\d:\d\d)$/.test(entry[field]) || !Number.isFinite(Date.parse(entry[field])))
          fail("文章日期格式无效。");
    }
    for (const [key,image] of Object.entries(doc.images))
      if (!/^[a-f0-9]{64}$/.test(key) || await hash(await imageData(image)) !== key) fail("插图校验失败，文库未载入。");
    return doc;
  }
  async function read(meta, path, auth) {
    const prefix = "/repos/" + cfg.owner + "/" + meta.repo;
    let info;
    try { info = await request(prefix + "/contents/" + path + "?ref=" + encodeURIComponent(meta.branch), auth, {object:true}); }
    catch (e) {
      if (e instanceof APIError && (e.status===404 || e.status===409 && e.empty)) {
        if (seen.get(meta.repo + "/" + path)) fail("之前存在的文库文件已被移除。为避免覆盖，请先检查仓库。");
        return {doc:empty(),sha:null};
      }
      throw e;
    }
    if (!info || info.type !== "file" || info.path !== path || info.target || info.submodule_git_url ||
        !/^[a-f0-9]{40}$/.test(info.sha) || !Number.isSafeInteger(info.size) || info.size<=0 || info.size>LIMIT)
      fail("远端同名文件无法确认为有效文库，未覆盖。");
    const raw = await request(prefix + "/git/blobs/" + info.sha, auth, {raw:true});
    if (raw.length !== info.size || await blobSHA(raw) !== info.sha) fail("远端文库校验失败，请重新载入。");
    let doc; try { doc = JSON.parse(decoder.decode(raw)); } catch (_) { fail("文库文件格式异常，未覆盖。"); }
    await validate(doc); checkEpoch(auth.generation);
    seen.set(meta.repo + "/" + path, true);
    return {doc,sha:info.sha};
  }
  async function put(meta, path, doc, sha, auth, privateFile) {
    await validate(doc);
    const verified = await inspect(meta.repo, privateFile, auth, meta);
    if (verified.branch !== meta.branch) fail("仓库默认分支改变，未提交。请重新登录。");
    const raw = bytes(doc), data = {message:privateFile ? "保存未定式私有文稿" : "更新未定式公开文章",content:to64(raw)};
    if (sha) data.sha=sha;
    // The public repository is already initialized by the site deployment.
    // For an empty private repository, omit branch so GitHub can create it.
    if (sha || !privateFile) data.branch=meta.branch;
    const result = await request("/repos/" + cfg.owner + "/" + meta.repo + "/contents/" + path, auth, {method:"PUT",data});
    if (!result || !result.content || result.content.path !== path || result.content.sha !== await blobSHA(raw))
      fail("GitHub 未返回可校验的保存结果。请重新载入确认，当前文字请保留。");
    checkEpoch(auth.generation); seen.set(meta.repo + "/" + path,true);
  }
  async function loadPrivate(auth) {
    privateMeta = await inspect(cfg.privateRepo,true,auth,privateMeta);
    const found = await read(privateMeta,cfg.privatePath,auth);
    privateDoc = found.doc; return found;
  }
  async function loadPublic(auth=null) {
    if (auth) {
      publicMeta = await inspect(cfg.publicRepo,false,auth,publicMeta);
      const found = await read(publicMeta,cfg.publicPath,auth);
      publicDoc=found.doc; return found;
    }
    const controller = new AbortController(), timer=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch("./"+cfg.publicPath,{cache:"no-store",credentials:"omit",redirect:"error",signal:controller.signal});
      if (!response.ok) fail("公开文章暂时无法载入，请稍后刷新。");
      const raw=await limited(response,LIMIT);
      let doc; try { doc=JSON.parse(decoder.decode(raw)); } catch (_) { fail("公开文章文件格式异常。"); }
      await validate(doc); publicDoc=doc; return {doc,sha:null};
    } finally { clearTimeout(timer); }
  }
  function session() {
    return {authenticated:!!token,owner:cfg.owner,repo:cfg.owner+"/"+cfg.privateRepo,
      published_ids:publicDoc.entries.map(e=>e.id)};
  }
  const view = doc => ({...clone(doc),published_ids:publicDoc.entries.map(e=>e.id),readonly:!token});
  function checked(doc,payload) {
    const entry=doc.entries.find(e=>e.id===payload.id);
    if (!entry || typeof payload.expected_updated!=="string" || payload.expected_updated!==entry.updated)
      fail("这篇文章已被其他页面修改。请先复制当前文字，再重新载入最新版。");
    return entry;
  }
  function stamp(previous="") { return new Date(Math.max(Date.now(),(Date.parse(previous)||0)+1)).toISOString(); }
  function fields(p) {
    if (!["article","note"].includes(p.kind) || !["draft","filed"].includes(p.status)) fail("请选择有效的文章类型和草稿状态。");
    return {title:text(p.title,300),body:text(p.body,1000000),topic:text(p.topic ?? "",120),kind:p.kind,status:p.status};
  }
  function referenced(entries,pool) {
    const images={};
    // Match the reader's token ordering: image-like text inside display math is
    // not an illustration and must not cause a private image to be published.
    const tokens=/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|!\[([^\]\r\n]{0,240})\]\(\/media\/([a-f0-9]{64})\)/g;
    for (const entry of entries) for (const match of entry.body.matchAll(tokens)) {
      const key=match[4]; if (!key) continue;
      if (!pool[key]) fail("文章引用的插图不存在，未发布。");
      images[key]=clone(pool[key]);
    }
    return images;
  }
  async function dispatch(path,payload) {
    if (path==="published") { await loadPublic(token ? signed() : null); return clone(publicDoc); }
    if (path==="library" || path==="sync") {
      if (token) { const auth=signed(); await loadPrivate(auth); await loadPublic(auth); return view(privateDoc); }
      await loadPublic(); return view(publicDoc);
    }
    const auth=signed();
    if (path==="export") { if (!privateDoc) await loadPrivate(auth); return clone(privateDoc); }
    const p=payload || {};
    if (!p || typeof p!=="object" || Array.isArray(p)) fail("请求数据格式无效。");
    const current=await loadPrivate(auth), next=clone(current.doc);
    if (path==="entry") {
      const nextFields=fields(p); let entry;
      if (!nextFields.title.trim()) nextFields.title=nextFields.body.trim().split("\n")[0].slice(0,40)||"未命名草稿";
      if (p.id) { entry=checked(next,p); Object.assign(entry,nextFields,{updated:stamp(entry.updated)}); }
      else { const now=stamp(); entry={...nextFields,id:crypto.randomUUID().replaceAll("-",""),created:now,updated:now}; next.entries.unshift(entry); }
      await put(privateMeta,cfg.privatePath,next,current.sha,auth,true); privateDoc=next; return {entry:clone(entry)};
    }
    if (path==="image") {
      const image={mime:p.mime,data:p.data}, key=await hash(await imageData(image));
      if (!next.images[key]) { next.images[key]=image; await put(privateMeta,cfg.privatePath,next,current.sha,auth,true); privateDoc=next; }
      return {key};
    }
    if (path==="import") {
      await validate(p.library); let added=0;
      for (const e of p.library.entries) {
        const existing=next.entries.find(v=>v.id===e.id);
        if (existing && canonical(existing)!==canonical(e)) fail("备份含同编号但内容不同的文章，本次未导入；请核对两份内容。");
        if (!existing) { next.entries.push(clone(e)); added++; }
      }
      Object.assign(next.images,clone(p.library.images));
      await put(privateMeta,cfg.privatePath,next,current.sha,auth,true); privateDoc=next; return {added};
    }
    if (!["publish","unpublish","delete"].includes(path)) fail("没有此操作。");
    const published=await loadPublic(auth), visible=clone(published.doc);
    if (path==="delete") {
      checked(next,p);
      if (visible.entries.some(e=>e.id===p.id)) fail("这篇文章仍在公开网站上，请先撤下再删除私有文稿。");
      next.entries=next.entries.filter(e=>e.id!==p.id);
      await put(privateMeta,cfg.privatePath,next,current.sha,auth,true); privateDoc=next; return {ok:true};
    }
    if (path==="publish") {
      const entry=clone(checked(next,p)); entry.status="filed";
      visible.entries=visible.entries.filter(e=>e.id!==entry.id); visible.entries.unshift(entry);
    } else {
      const old=visible.entries.find(e=>e.id===p.id), draft=next.entries.find(e=>e.id===p.id);
      if (!old || p.expected_updated!==old.updated && p.expected_updated!==draft?.updated)
        fail("公开文章的版本已改变，请重新载入后再撤下。");
      visible.entries=visible.entries.filter(e=>e.id!==p.id);
    }
    visible.images=referenced(visible.entries,{...visible.images,...next.images});
    await put(publicMeta,cfg.publicPath,visible,published.sha,auth,false); publicDoc=visible;
    return {ok:true,published_ids:publicDoc.entries.map(e=>e.id)};
  }
  window.JournalAPI=Object.freeze({
    api(path,payload) {
      const cleaned=String(path).replace(/^\/?api\//,"").replace(/^\//,"");
      if (cleaned==="session") return Promise.resolve(session());
      const generation=epoch;
      return enqueue(()=>{ checkEpoch(generation); return dispatch(cleaned,payload); });
    },
    login(candidate) {
      if (typeof candidate!=="string" || !/^[!-~]{10,4096}$/.test(candidate.trim())) return Promise.reject(new Error("请输入有效的 GitHub 访问令牌。"));
      const generation=++epoch; token=""; privateDoc=null; privateMeta=publicMeta=null; seen.clear();
      for (const controller of active) controller.abort();
      return enqueue(async()=>{
        checkEpoch(generation);
        const auth={secret:candidate.trim(),generation};
        const user=await request("/user",auth);
        if (!user || typeof user.login!=="string" || user.login.toLowerCase()!==cfg.owner.toLowerCase())
          fail("这个令牌不属于网站作者账号，请使用作者本人的令牌。");
        const priv=await inspect(cfg.privateRepo,true,auth), pub=await inspect(cfg.publicRepo,false,auth);
        const drafts=await read(priv,cfg.privatePath,auth), published=await read(pub,cfg.publicPath,auth);
        checkEpoch(generation); privateMeta=priv; publicMeta=pub; privateDoc=drafts.doc; publicDoc=published.doc; token=auth.secret;
        return session();
      });
    },
    logout() {
      ++epoch; token=""; privateDoc=null; privateMeta=publicMeta=null; seen.clear();
      for (const controller of active) controller.abort();
      return session();
    },
    media(key) {
      if (typeof key!=="string" || !/^[a-f0-9]{64}$/.test(key)) return "";
      const image=privateDoc?.images[key] || publicDoc.images[key];
      return image ? "data:"+image.mime+";base64,"+image.data : "";
    },
    exportData() { signed(); if (!privateDoc) fail("私有文库尚未载入。"); return clone(privateDoc); },
    publishedData() { return clone(publicDoc); }
  });
})();
