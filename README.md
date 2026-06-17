# 数据管理系统

局域网可访问的表单填写与汇总系统，使用 React + Vite + Express + SQLite。

## 启动

```bash
npm install
npm run dev
```

开发模式下访问 `http://localhost:49271`。同一局域网设备可访问本机 IP 的 `49271` 端口。

## 生产构建

```bash
npm run build
npm run server
```

构建后 Express 会在 `http://0.0.0.0:38427` 提供前端页面和 API。

## 数据

SQLite 数据库默认保存在 `data/records.sqlite`。
