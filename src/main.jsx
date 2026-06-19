import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Checkbox, ConfigProvider, DatePicker, Input, Modal, Popconfirm, Space, Table, Tooltip, message } from 'antd';
import dayjs from 'dayjs';
import 'antd/dist/reset.css';
import './styles.css';

const { TextArea } = Input;
const today = () => dayjs().format('YYYY-MM-DD');

const emptyForm = {
  repoId: '',
  solver: '',
  traeSessionId: '',
  userPrompt: '',
  modificationScope: '',
  repoUrl: '',
  commitId: '',
  result: '',
  submitted: false
};

const filterFields = [
  ['repoId', 'repoId'],
  ['solver', '做题人'],
  ['traeSessionId', 'Trae Session ID'],
  ['modificationScope', '修改范围'],
  ['result', '结果']
];

function buildQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (String(value || '').trim()) {
      query.set(key, value.trim());
    }
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

async function apiRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '请求失败，请稍后重试。');
  }
  if (response.status === 204) return null;
  return response.json();
}

function formatRecordForCopy(record) {
  return [
    `ID：${record.id}`,
    `已提交：${record.submitted ? '是' : '否'}`,
    `repoId：${record.repoId}`,
    `做题人：${record.solver}`,
    `Trae Session ID：${record.traeSessionId}`,
    `User Prompt：${record.userPrompt}`,
    `修改范围：${record.modificationScope}`,
    `Repo URL：${record.repoUrl}`,
    `Commit ID：${record.commitId}`,
    `结果：${record.result}`,
    `创建时间：${record.createdAt}`,
    `更新时间：${record.updatedAt}`
  ].join('\n');
}

function EllipsisCell({ value }) {
  const text = value == null ? '' : String(value);
  if (!text) return '';

  return (
    <Tooltip title={<div className="tooltip-content">{text}</div>} placement="topLeft">
      <span className="ellipsis-cell">{text}</span>
    </Tooltip>
  );
}

function App() {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(today);
  const [filters, setFilters] = useState({ repoId: '', solver: '', traeSessionId: '', modificationScope: '', result: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [updatingSubmittedId, setUpdatingSubmittedId] = useState(null);
  const [tableScrollY, setTableScrollY] = useState(360);
  const tableContainerRef = useRef(null);
  const [messageApi, contextHolder] = message.useMessage();

  const queryParams = useMemo(() => ({ date: dateFilter, search, ...filters }), [dateFilter, search, filters]);
  const selectedRecords = useMemo(
    () => records.filter((record) => selectedRowKeys.includes(record.id)),
    [records, selectedRowKeys]
  );

  useEffect(() => {
    function updateTableHeight() {
      const top = tableContainerRef.current?.getBoundingClientRect().top || 0;
      const nextHeight = Math.max(280, window.innerHeight - top - 72);
      setTableScrollY(nextHeight);
    }

    updateTableHeight();
    window.addEventListener('resize', updateTableHeight);
    return () => window.removeEventListener('resize', updateTableHeight);
  }, [records.length, loading]);

  async function loadRecords() {
    setLoading(true);
    try {
      const data = await apiRequest(`/api/records${buildQuery(queryParams)}`);
      setRecords(data.records);
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRecords();
  }, [queryParams]);

  useEffect(() => {
    setSelectedRowKeys((current) => current.filter((id) => records.some((record) => record.id === id && !record.submitted)));
  }, [records]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function openCreateModal() {
    resetForm();
    setFormOpen(true);
  }

  function closeFormModal() {
    setFormOpen(false);
    resetForm();
  }

  async function submitForm(event) {
    event?.preventDefault();
    setSaving(true);

    try {
      const url = editingId ? `/api/records/${editingId}` : '/api/records';
      const method = editingId ? 'PUT' : 'POST';
      await apiRequest(url, {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(form)
      });
      messageApi.success(editingId ? '记录已更新。' : '记录已新增。');
      closeFormModal();
      await loadRecords();
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function editRecord(record) {
    setEditingId(record.id);
    setForm({
      repoId: record.repoId,
      solver: record.solver,
      traeSessionId: record.traeSessionId,
      userPrompt: record.userPrompt,
      modificationScope: record.modificationScope,
      repoUrl: record.repoUrl,
      commitId: record.commitId,
      result: record.result,
      submitted: record.submitted
    });
    setFormOpen(true);
  }

  async function deleteRecord(record) {
    try {
      await apiRequest(`/api/records/${record.id}`, { method: 'DELETE' });
      messageApi.success('记录已删除。');
      if (editingId === record.id) resetForm();
      await loadRecords();
    } catch (err) {
      messageApi.error(err.message);
    }
  }

  function exportCsv() {
    window.location.href = `/api/records/export.csv${buildQuery(queryParams)}`;
  }

  async function toggleSubmitted(record, submitted) {
    setUpdatingSubmittedId(record.id);

    try {
      const data = await apiRequest(`/api/records/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ...record, submitted })
      });
      setRecords((current) => current.map((item) => (item.id === record.id ? data.record : item)));
      messageApi.success(`记录 #${record.id} 已标记为${submitted ? '已提交' : '未提交'}。`);
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setUpdatingSubmittedId(null);
    }
  }

  async function batchMarkSubmitted() {
    const targets = selectedRecords.filter((record) => !record.submitted);
    if (!targets.length) {
      messageApi.info('请选择未提交的记录。');
      return;
    }

    setBatchSubmitting(true);
    try {
      const updatedRecords = await Promise.all(
        targets.map((record) => (
          apiRequest(`/api/records/${record.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ ...record, submitted: true })
          })
        ))
      );
      const updatedMap = new Map(updatedRecords.map((data) => [data.record.id, data.record]));
      setRecords((current) => current.map((record) => updatedMap.get(record.id) || record));
      setSelectedRowKeys([]);
      messageApi.success(`已批量标记 ${updatedRecords.length} 条记录为已提交。`);
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function copyRecord(record) {
    const text = formatRecordForCopy(record);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      messageApi.success(`记录 #${record.id} 已复制。`);
    } catch {
      messageApi.error('复制失败，请检查浏览器剪贴板权限。');
    }
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 76,
      fixed: 'left'
    },
    {
      title: '已提交',
      dataIndex: 'submitted',
      width: 104,
      fixed: 'left',
      render: (_, record) => (
        <Checkbox
          checked={record.submitted}
          disabled={updatingSubmittedId === record.id}
          onChange={(event) => toggleSubmitted(record, event.target.checked)}
        >
          {record.submitted ? '已提交' : '未提交'}
        </Checkbox>
      )
    },
    { title: 'repoId', dataIndex: 'repoId', width: 140 },
    { title: '做题人', dataIndex: 'solver', width: 130 },
    { title: 'Trae Session ID', dataIndex: 'traeSessionId', width: 260, render: (value) => <EllipsisCell value={value} /> },
    { title: 'User Prompt', dataIndex: 'userPrompt', width: 320, render: (value) => <EllipsisCell value={value} /> },
    { title: '修改范围', dataIndex: 'modificationScope', width: 260, render: (value) => <EllipsisCell value={value} /> },
    {
      title: 'Repo URL',
      dataIndex: 'repoUrl',
      width: 260,
      render: (value) => value && !value.startsWith('git@')
        ? (
          <Tooltip title={<div className="tooltip-content">{value}</div>} placement="topLeft">
            <a className="ellipsis-cell table-link" href={value} target="_blank" rel="noreferrer">{value}</a>
          </Tooltip>
        )
        : <EllipsisCell value={value} />
    },
    { title: 'Commit ID', dataIndex: 'commitId', width: 230, render: (value) => <EllipsisCell value={value} /> },
    { title: '结果', dataIndex: 'result', width: 280, render: (value) => <EllipsisCell value={value} /> },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button size="small" onClick={() => copyRecord(record)}>复制</Button>
          <Button size="small" type="primary" ghost onClick={() => editRecord(record)}>编辑</Button>
          <Popconfirm
            title="删除记录"
            description={`确定删除记录 #${record.id} 吗？`}
            okText="删除"
            cancelText="取消"
            onConfirm={() => deleteRecord(record)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    getCheckboxProps: (record) => ({
      disabled: record.submitted
    })
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 6,
          colorPrimary: '#2563eb'
        }
      }}
    >
      {contextHolder}
      <main className="app-shell">
        <header className="topbar">
          <div>
            <h1>数据管理系统</h1>
            <p>表单填写、汇总筛选、编辑删除与 CSV 导出</p>
          </div>
          <div className="topbar-actions">
            <Button type="primary" onClick={openCreateModal}>新增</Button>
            <Button
              type="primary"
              ghost
              onClick={batchMarkSubmitted}
              loading={batchSubmitting}
              disabled={!selectedRowKeys.length}
            >
              批量标记已提交{selectedRowKeys.length ? ` (${selectedRowKeys.length})` : ''}
            </Button>
            <Button onClick={loadRecords} loading={loading}>刷新</Button>
            <Button onClick={exportCsv}>导出 CSV</Button>
          </div>
        </header>

        <section className="panel table-panel">
          <div className="section-heading">
            <h2>汇总</h2>
            <span className="record-count">{records.length} 条记录</span>
          </div>

          <div className="filters">
            <label>
              <span>日期</span>
              <DatePicker
                value={dateFilter ? dayjs(dateFilter) : null}
                onChange={(_, dateString) => setDateFilter(Array.isArray(dateString) ? dateString[0] : dateString)}
                allowClear={false}
                format="YYYY-MM-DD"
                className="full-width"
              />
            </label>
            <label>
              <span>搜索</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索所有字段" allowClear />
            </label>
            {filterFields.map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <Input
                  value={filters[key]}
                  onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
                  allowClear
                />
              </label>
            ))}
          </div>

          <div ref={tableContainerRef}>
            <Table
              className="records-table"
              rowKey="id"
              rowSelection={rowSelection}
              columns={columns}
              dataSource={records}
              loading={loading}
              size="middle"
              bordered
              scroll={{ x: 2430, y: tableScrollY }}
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`
              }}
              locale={{ emptyText: '暂无记录' }}
            />
          </div>
        </section>

        <Modal
          title={editingId ? `编辑记录 #${editingId}` : '新增记录'}
          open={formOpen}
          width={860}
          onCancel={closeFormModal}
          destroyOnHidden
          footer={[
            <Button key="clear" onClick={resetForm}>清空</Button>,
            <Button key="cancel" onClick={closeFormModal}>取消</Button>,
            <Button key="submit" type="primary" loading={saving} onClick={submitForm}>
              {editingId ? '保存修改' : '新增记录'}
            </Button>
          ]}
        >
          <form className="entry-form modal-entry-form" onSubmit={submitForm}>
            <label>
              <span>repoId</span>
              <Input value={form.repoId} onChange={(event) => updateForm('repoId', event.target.value)} />
            </label>
            <label>
              <span>做题人</span>
              <Input value={form.solver} onChange={(event) => updateForm('solver', event.target.value)} />
            </label>
            <label>
              <span>Trae Session ID</span>
              <Input value={form.traeSessionId} onChange={(event) => updateForm('traeSessionId', event.target.value)} />
            </label>
            <label>
              <span>User Prompt</span>
              <TextArea rows={4} value={form.userPrompt} onChange={(event) => updateForm('userPrompt', event.target.value)} />
            </label>
            <label>
              <span>修改范围</span>
              <TextArea rows={3} value={form.modificationScope} onChange={(event) => updateForm('modificationScope', event.target.value)} />
            </label>
            <label>
              <span>Repo URL</span>
              <Input value={form.repoUrl} onChange={(event) => updateForm('repoUrl', event.target.value)} placeholder="https://github.com/owner/repo" />
            </label>
            <label>
              <span>Commit ID</span>
              <Input value={form.commitId} onChange={(event) => updateForm('commitId', event.target.value)} />
            </label>
            <label>
              <span>结果</span>
              <TextArea rows={4} value={form.result} onChange={(event) => updateForm('result', event.target.value)} />
            </label>
          </form>
        </Modal>
      </main>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
