import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'records.sqlite');
const logDir = path.join(rootDir, 'logs');
const logPath = path.join(logDir, 'server.log');
const port = Number(process.env.PORT || 38427);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id TEXT NOT NULL DEFAULT '',
    solver TEXT NOT NULL DEFAULT '',
    trae_session_id TEXT NOT NULL DEFAULT '',
    user_prompt TEXT NOT NULL DEFAULT '',
    modification_scope TEXT NOT NULL DEFAULT '',
    repo_url TEXT NOT NULL DEFAULT '',
    commit_id TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    submitted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_records_repo_id ON records(repo_id);
  CREATE INDEX IF NOT EXISTS idx_records_solver ON records(solver);
  CREATE INDEX IF NOT EXISTS idx_records_trae_session_id ON records(trae_session_id);
`);

const columns = db.prepare('PRAGMA table_info(records)').all().map((column) => column.name);
if (!columns.includes('modification_scope')) {
  db.exec("ALTER TABLE records ADD COLUMN modification_scope TEXT NOT NULL DEFAULT ''");
}
if (!columns.includes('submitted')) {
  db.exec('ALTER TABLE records ADD COLUMN submitted INTEGER NOT NULL DEFAULT 0');
}

const app = express();
app.use(express.json({ limit: '1mb' }));

function appendLog(level, message, meta = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  });
  fs.appendFile(logPath, `${line}\n`, (err) => {
    if (err) console.error(err);
  });
}

const apiFields = [
  ['repoId', 'repo_id'],
  ['solver', 'solver'],
  ['traeSessionId', 'trae_session_id'],
  ['userPrompt', 'user_prompt'],
  ['modificationScope', 'modification_scope'],
  ['repoUrl', 'repo_url'],
  ['commitId', 'commit_id'],
  ['result', 'result']
];

function normalizeRecord(input) {
  const record = {};
  for (const [apiField] of apiFields) {
    record[apiField] = typeof input?.[apiField] === 'string' ? input[apiField].trim() : '';
  }
  record.submitted = input?.submitted === true || input?.submitted === 1 || input?.submitted === '1' ? 1 : 0;
  return record;
}

function isValidRepoUrl(value) {
  if (!value) return true;
  if (/^git@[^:\s]+:[^\s]+$/.test(value)) return true;

  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateRecord(record) {
  if (!isValidRepoUrl(record.repoUrl)) {
    return 'Repo URL 格式不正确，请填写 http(s)、ssh、git 或 git@host:path 格式。';
  }
  return null;
}

function mapRow(row) {
  return {
    id: row.id,
    repoId: row.repo_id,
    solver: row.solver,
    traeSessionId: row.trae_session_id,
    userPrompt: row.user_prompt,
    modificationScope: row.modification_scope,
    repoUrl: row.repo_url,
    commitId: row.commit_id,
    result: row.result,
    submitted: Boolean(row.submitted),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatSqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getBeijingDateUtcRange(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const start = new Date(`${dateText}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: formatSqlDateTime(start),
    end: formatSqlDateTime(end)
  };
}

function getRecords(query) {
  const where = [];
  const params = {};

  const date = String(query.date || '').trim();
  const dateRange = date ? getBeijingDateUtcRange(date) : null;
  if (dateRange) {
    params.dateStart = dateRange.start;
    params.dateEnd = dateRange.end;
    where.push('datetime(created_at) >= datetime(:dateStart) AND datetime(created_at) < datetime(:dateEnd)');
  }

  const search = String(query.search || '').trim();
  if (search) {
    params.search = `%${search}%`;
    where.push(`(
      repo_id LIKE :search OR
      solver LIKE :search OR
      trae_session_id LIKE :search OR
      user_prompt LIKE :search OR
      modification_scope LIKE :search OR
      repo_url LIKE :search OR
      commit_id LIKE :search OR
      result LIKE :search OR
      CASE submitted WHEN 1 THEN '已提交' ELSE '未提交' END LIKE :search
    )`);
  }

  const filters = [
    ['repoId', 'repo_id'],
    ['solver', 'solver'],
    ['traeSessionId', 'trae_session_id'],
    ['modificationScope', 'modification_scope'],
    ['result', 'result']
  ];

  for (const [queryKey, column] of filters) {
    const value = String(query[queryKey] || '').trim();
    if (value) {
      params[queryKey] = `%${value}%`;
      where.push(`${column} LIKE :${queryKey}`);
    }
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = db.prepare(`
    SELECT *
    FROM records
    ${whereClause}
    ORDER BY datetime(created_at) DESC, id DESC
  `);

  return stmt.all(params).map(mapRow);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/records', (req, res) => {
  res.json({ records: getRecords(req.query) });
});

app.post('/api/records', (req, res) => {
  const record = normalizeRecord(req.body);
  const validationError = validateRecord(record);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const stmt = db.prepare(`
    INSERT INTO records (
      repo_id, solver, trae_session_id, user_prompt, modification_scope, repo_url, commit_id, result, submitted
    )
    VALUES (:repoId, :solver, :traeSessionId, :userPrompt, :modificationScope, :repoUrl, :commitId, :result, :submitted)
  `);
  const result = stmt.run(record);
  const saved = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ record: mapRow(saved) });
});

app.put('/api/records/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '记录 ID 不正确。' });
  }

  const existing = db.prepare('SELECT id FROM records WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '记录不存在。' });
  }

  const record = normalizeRecord(req.body);
  const validationError = validateRecord(record);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  db.prepare(`
    UPDATE records
    SET
      repo_id = :repoId,
      solver = :solver,
      trae_session_id = :traeSessionId,
      user_prompt = :userPrompt,
      modification_scope = :modificationScope,
      repo_url = :repoUrl,
      commit_id = :commitId,
      result = :result,
      submitted = :submitted,
      updated_at = datetime('now')
    WHERE id = :id
  `).run({ ...record, id });

  const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  res.json({ record: mapRow(updated) });
});

app.delete('/api/records/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '记录 ID 不正确。' });
  }

  const result = db.prepare('DELETE FROM records WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '记录不存在。' });
  }
  res.status(204).end();
});

function escapeCsvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

app.get('/api/records/export.csv', (req, res) => {
  const records = getRecords(req.query);
  const headers = ['ID', '已提交', 'repoId', '做题人', 'Trae Session ID', 'User Prompt', '修改范围', 'Repo URL', 'Commit ID', '结果', '创建时间', '更新时间'];
  const rows = records.map((record) => [
    record.id,
    record.submitted ? '是' : '否',
    record.repoId,
    record.solver,
    record.traeSessionId,
    record.userPrompt,
    record.modificationScope,
    record.repoUrl,
    record.commitId,
    record.result,
    record.createdAt,
    record.updatedAt
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="records.csv"');
  res.send(`\uFEFF${csv}`);
});

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  const isJsonParseError = err instanceof SyntaxError && err.status === 400 && 'body' in err;
  const status = isJsonParseError ? 400 : 500;
  const error = isJsonParseError ? 'JSON 格式不正确，请检查请求体和 Content-Type。' : '服务器内部错误。';

  appendLog(status >= 500 ? 'error' : 'warn', err.message, {
    method: req.method,
    url: req.originalUrl,
    status,
    stack: err.stack
  });

  res.status(status).json({ error });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Data manager running at http://0.0.0.0:${port}`);
});
