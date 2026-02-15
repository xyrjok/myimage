export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // 0. 全局 CORS 配置与辅助函数
    // ==========================================
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    };

    // 从文件名中提取真实的格式后缀
    const getExt = (name) => {
      const match = (name || '').match(/(\.[a-zA-Z0-9]+)$/);
      return match ? match[1].toLowerCase() : '.jpg';
    };

    let config = {};
    try {
      const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
      results.forEach(row => { config[row.key] = row.value; });
    } catch (err) {
      return jsonResponse({ error: "Database not initialized or binding 'DB' missing." }, 500);
    }

    // ==========================================
    // 1. 公开 API：前台瀑布流图库读取
    // ==========================================
    if (url.pathname === '/api/public/images' && request.method === 'GET') {
      const { results } = await env.DB.prepare("SELECT file_id, filename FROM images ORDER BY upload_time DESC").all();
      const publicImages = results.map(img => ({
        ...img, 
        url: `${url.origin}/image/${img.file_id}${getExt(img.filename)}` 
      }));
      return jsonResponse(publicImages);
    }

    // ==========================================
    // 2. 外部 API 接口
    // ==========================================
    if (url.pathname.startsWith('/api/external/')) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || authHeader !== `Bearer ${config.api_key}`) {
        return jsonResponse({ error: 'Unauthorized: Invalid API Key' }, 401);
      }

      if (url.pathname === '/api/external/upload' && request.method === 'POST') {
        try {
          const formData = await request.formData();
          const photo = formData.get('file');
          const filename = photo.name || 'api_upload.png';

          const tgFormData = new FormData();
          tgFormData.append('chat_id', config.tg_chat_id);
          // 【核心修改】将 photo 改为 document，触发原文件上传
          tgFormData.append('document', photo); 

          // 【核心修改】调用 sendDocument 接口
          const tgRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendDocument`, { method: 'POST', body: tgFormData });
          const tgData = await tgRes.json();

          if (tgData.ok) {
            // 【核心修改】从 document 节点获取 file_id
            const tgDoc = tgData.result.document || tgData.result.animation || tgData.result.video || tgData.result.photo?.pop();
            const fileId = tgDoc.file_id;
            const messageId = tgData.result.message_id;
            
            await env.DB.prepare("INSERT INTO images (file_id, message_id, filename, description) VALUES (?, ?, ?, ?)")
              .bind(fileId, messageId, filename, "API Upload").run();

            return jsonResponse({ success: true, url: `${url.origin}/image/${fileId}${getExt(filename)}`, file_id: fileId }); 
          }
          return jsonResponse({ error: 'Telegram API Error', details: tgData }, 500);
        } catch (err) { return jsonResponse({ error: err.message }, 500); }
      }

      if (url.pathname === '/api/external/edit' && request.method === 'POST') {
        const { file_id, filename, description } = await request.json();
        await env.DB.prepare("UPDATE images SET filename = ?, description = ? WHERE file_id = ?")
          .bind(filename, description, file_id).run();
        return jsonResponse({ success: true });
      }
    }

    // ==========================================
    // 3. 后台管理 API 接口
    // ==========================================
    if (url.pathname.startsWith('/api/admin/')) {
      const authHeader = request.headers.get('Authorization');
      const expectedAuth = `Basic ${btoa(`${config.admin_user}:${config.admin_pass}`)}`;
      
      if (authHeader !== expectedAuth) {
        return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
      }

      if (url.pathname === '/api/admin/images' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT * FROM images ORDER BY upload_time DESC").all();
        const imagesWithUrl = results.map(img => ({...img, url: `${url.origin}/image/${img.file_id}${getExt(img.filename)}`})); 
        return jsonResponse(imagesWithUrl);
      }

      if (url.pathname === '/api/admin/upload' && request.method === 'POST') {
        try {
          const formData = await request.formData();
          const photo = formData.get('file');
          const filename = photo.name || 'admin_upload.png';

          const tgFormData = new FormData();
          tgFormData.append('chat_id', config.tg_chat_id);
          // 【核心修改】将 photo 改为 document，触发原文件上传
          tgFormData.append('document', photo);

          // 【核心修改】调用 sendDocument 接口
          const tgRes = await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/sendDocument`, { method: 'POST', body: tgFormData });
          const tgData = await tgRes.json();

          if (tgData.ok) {
            // 【核心修改】从 document 节点获取 file_id
            const tgDoc = tgData.result.document || tgData.result.animation || tgData.result.video || tgData.result.photo?.pop();
            const fileId = tgDoc.file_id;
            const messageId = tgData.result.message_id;
            
            await env.DB.prepare("INSERT INTO images (file_id, message_id, filename, description) VALUES (?, ?, ?, ?)")
              .bind(fileId, messageId, filename, "Admin Upload").run();

            return jsonResponse({ success: true, url: `${url.origin}/image/${fileId}${getExt(filename)}` }); 
          }
          return jsonResponse({ error: 'Telegram API Error', details: tgData }, 500);
        } catch (err) { return jsonResponse({ error: err.message }, 500); }
      }

      if (url.pathname === '/api/admin/delete' && request.method === 'POST') {
        const { id } = await request.json();
        const record = await env.DB.prepare("SELECT message_id FROM images WHERE id = ?").bind(id).first();
        if (record) {
          await fetch(`https://api.telegram.org/bot${config.tg_bot_token}/deleteMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: config.tg_chat_id, message_id: record.message_id })
          });
          await env.DB.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
        }
        return jsonResponse({ success: true });
      }

      if (url.pathname === '/api/admin/settings' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const currentSettings = {};
        results.forEach(row => { currentSettings[row.key] = row.value; });
        return jsonResponse(currentSettings);
      }

      if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
        const updates = await request.json();
        const stmts = Object.keys(updates).map(key => env.DB.prepare("UPDATE settings SET value = ? WHERE key = ?").bind(updates[key], key));
        await env.DB.batch(stmts);
        return jsonResponse({ success: true });
      }
    }

    // ==========================================
    // 4. 核心功能：TG 图片直链反向代理
    // ==========================================
    if (url.pathname.startsWith('/image/')) {
      let fileId = url.pathname.replace('/image/', '');
      const extMatch = fileId.match(/(\.[a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : '';
      // 剥离后缀，还原真实的 TG file_id
      fileId = fileId.replace(/\.[a-zA-Z0-9]+$/, ''); 

      const getFileUrl = `https://api.telegram.org/bot${config.tg_bot_token}/getFile?file_id=${fileId}`;
      const fileData = await (await fetch(getFileUrl)).json();

      if (fileData.ok) {
        const filePath = fileData.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${config.tg_bot_token}/${filePath}`;
        const imageRes = await fetch(downloadUrl);

        // 智能推断 Content-Type
        let contentType = imageRes.headers.get('Content-Type');
        const extToMime = { '.gif': 'image/gif', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.tiff': 'image/tiff', '.avif': 'image/avif', '.heic': 'image/heic' };
        if (extToMime[ext]) {
          contentType = extToMime[ext];
        } else if (!contentType || contentType === 'application/octet-stream') {
          contentType = 'image/jpeg';
        }
        return new Response(imageRes.body, {
          headers: { 
            'Content-Type': contentType,
            'Content-Disposition': 'inline', 
            'Cache-Control': 'public, max-age=31536000', 
            ...corsHeaders
          }
        });
      }
      return new Response('Image Not Found in Telegram', { status: 404, headers: corsHeaders });
    }

    // ==========================================
    // 5. 默认根路由：接口探针
    // ==========================================
    return jsonResponse({ 
      status: "Image Bed API is running smoothly.",
      endpoints: {
        public_gallery: "/api/public/images",
        admin_api: "/api/admin/*",
        external_api: "/api/external/*"
      }
    });
  }
};
