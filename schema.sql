-- 1. 创建配置表
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 初始化配置（请将里面的中文替换为你第一阶段获取的真实数据）
INSERT INTO settings (key, value) VALUES 
('admin_user', 'admin'),
('admin_pass', 'admin123'),
('tg_bot_token', '此处填入你的BotToken'),
('tg_chat_id', '此处填入你的ChatID'),
('api_key', 'sk-my-blog-secret-key-888'); -- 博客等外部调用的密钥

-- 2. 创建图片数据表
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  filename TEXT,
  description TEXT,
  upload_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
