# LLM 学习教练（前后端分离：React Native + FastAPI + LangGraph + Supabase Postgres）

## 目录
- `backend/`：FastAPI 后端（LangGraph 生成学习流程 + LLM 评分 + SQLite 持久化 + Supabase Postgres 知识图谱）
- `frontend/`：Expo React Native 前端（Teacher 页解锁流程 + 星空风格知识图谱）

---

## 后端启动（FastAPI）

### 1) 安装依赖
当前环境不支持 `venv`（缺少 `python3-venv`），所以用 user-site 安装：

```bash
python3 -m pip install --user -r backend/requirements.txt
```

### 2) 配置 Supabase（用于知识图谱）

1) 在 Supabase SQL Editor 执行：`supabase/schema.sql`
2) 配置后端环境变量（见 `backend/.env.example`）：
   - `APP_SUPABASE_URL`
   - `APP_SUPABASE_ANON_KEY`

### 3) 启动 API

```bash
cd backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

健康检查：`GET /health`

> 说明：未配置 LLM Key 时，后端会自动走 **mock** 方案（仍可完整跑通解锁与图谱写入）。

### 4) 配置 LLM Key
方式 A：前端 Teacher 页右上角 **设置**  
方式 B：环境变量（见 `backend/.env.example`）

---

## 前端启动（Expo React Native）

### 1) 安装依赖

```bash
cd frontend
npm install
```

### 2) 配置后端地址（重要）
创建 `frontend/.env`：

```bash
cp .env.example .env
```

把 `EXPO_PUBLIC_API_BASE_URL` 改成你的后端可访问地址，例如：
- 模拟器：`http://localhost:8000`
- 真机：`http://<你的电脑局域网IP>:8000`

### 3) 启动 Expo

```bash
cd frontend
npm start
```

---

## 功能概览

### Teacher（学习流程）
- 侧边栏：会话/提问记录
- 主区：输入问题 → 生成流程（大纲 + 知识点节点）
- 节点解锁：提交回答 → LLM 评分 → 达标解锁下一节点

### 知识图谱（星空样式）
- 每个概念 = 一颗星
- **亮度**：由后端根据“最近练习/浏览时间”计算（越近越亮，越久越暗）
- 上传图谱：Graph 页可粘贴 JSON 上传合并

