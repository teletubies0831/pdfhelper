# PDF Helper 后端

本地 FastAPI 服务为扩展提供翻译与解释接口。

## 启动

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\server\start.ps1
```

启动脚本要求 Python 3.12，并会自动创建 `.venv`。

## 配置

项目根目录的 `.env`：

```env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=你的API密钥
LLM_MODEL=deepseek-chat
```

不要把真实 API Key 提交到代码仓库。

## 接口

```text
GET  /health
POST /api/translate
POST /api/explain
```
