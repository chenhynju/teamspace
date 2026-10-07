'use client';
import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import {
  Card, Button, Modal, Input, Select, Field, Empty, InlineError, Badge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react';

type DictTypeRow = {
  id: string;
  name: string;
  type: string;
  status: 'NORMAL' | 'DISABLED';
  remark: string | null;
};

type DictDataRow = {
  id: string;
  label: string;
  value: string;
  dictType: string;
  sort: number;
  isDefault: 'YES' | 'NO';
  listClass: string | null;
  status: 'NORMAL' | 'DISABLED';
};

const LISTCLASS_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'slate', label: '灰色' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'amber', label: '橙色' },
  { value: 'red', label: '红色' },
  { value: 'violet', label: '紫色' },
];

export default function DictManagePage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const [types, setTypes] = useState<DictTypeRow[]>([]);
  const [current, setCurrent] = useState<DictTypeRow | null>(null);
  const [data, setData] = useState<DictDataRow[]>([]);
  const [typeKw, setTypeKw] = useState('');

  const [typeModal, setTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<DictTypeRow | null>(null);
  const [typeForm, setTypeForm] = useState({ name: '', type: '', status: 'NORMAL', remark: '' });
  const [typeError, setTypeError] = useState<string | null>(null);

  const [dataModal, setDataModal] = useState(false);
  const [editingData, setEditingData] = useState<DictDataRow | null>(null);
  const [dataForm, setDataForm] = useState({ label: '', value: '', sort: 0, isDefault: 'NO', listClass: '', status: 'NORMAL' });
  const [dataError, setDataError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const refreshTypes = useCallback(async () => {
    const { data: list } = await api.get('/dict-types');
    setTypes(list);
    return list as DictTypeRow[];
  }, []);

  const refreshData = useCallback(async (type: string) => {
    const { data: list } = await api.get('/dict-data', { params: { dictType: type } });
    setData(list);
  }, []);

  useEffect(() => {
    refreshTypes().then((list) => {
      if (list.length) {
        setCurrent(list[0]);
        refreshData(list[0].type);
      }
    });
  }, [refreshTypes, refreshData]);

  const selectType = (t: DictTypeRow) => {
    setCurrent(t);
    refreshData(t.type);
  };

  /* ---------- 类型 CRUD ---------- */

  const openTypeCreate = () => {
    setEditingType(null);
    setTypeForm({ name: '', type: '', status: 'NORMAL', remark: '' });
    setTypeError(null);
    setTypeModal(true);
  };

  const openTypeEdit = (t: DictTypeRow) => {
    setEditingType(t);
    setTypeForm({ name: t.name, type: t.type, status: t.status, remark: t.remark ?? '' });
    setTypeError(null);
    setTypeModal(true);
  };

  const saveType = async () => {
    if (!typeForm.name.trim() || !typeForm.type.trim()) {
      setTypeError('请填写字典名称和编码');
      return;
    }
    setBusy(true);
    setTypeError(null);
    try {
      if (editingType) {
        await api.patch(`/dict-types/${editingType.id}`, {
          name: typeForm.name.trim(),
          status: typeForm.status,
          remark: typeForm.remark || null,
        });
      } else {
        await api.post('/dict-types', {
          name: typeForm.name.trim(),
          type: typeForm.type.trim(),
          status: typeForm.status,
          remark: typeForm.remark || null,
        });
      }
      setTypeModal(false);
      const list = await refreshTypes();
      if (current) {
        const updated = list.find((t) => t.id === current.id);
        if (updated) setCurrent(updated);
      }
    } catch (e: any) {
      setTypeError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const removeType = async (t: DictTypeRow) => {
    if (!confirm(`确认删除字典类型「${t.name}」？`)) return;
    try {
      await api.delete(`/dict-types/${t.id}`);
      const list = await refreshTypes();
      if (current?.id === t.id) {
        setCurrent(list[0] ?? null);
        if (list[0]) refreshData(list[0].type);
        else setData([]);
      }
    } catch (e: any) {
      alert(e.response?.data?.message ?? '删除失败');
    }
  };

  /* ---------- 数据 CRUD ---------- */

  const openDataCreate = () => {
    if (!current) return;
    setEditingData(null);
    setDataForm({ label: '', value: '', sort: data.length, isDefault: 'NO', listClass: '', status: 'NORMAL' });
    setDataError(null);
    setDataModal(true);
  };

  const openDataEdit = (d: DictDataRow) => {
    setEditingData(d);
    setDataForm({
      label: d.label,
      value: d.value,
      sort: d.sort,
      isDefault: d.isDefault,
      listClass: d.listClass ?? '',
      status: d.status,
    });
    setDataError(null);
    setDataModal(true);
  };

  const saveData = async () => {
    if (!dataForm.label.trim() || !dataForm.value.trim()) {
      setDataError('请填写数据标签和键值');
      return;
    }
    if (!current) return;
    setBusy(true);
    setDataError(null);
    try {
      const payload = {
        label: dataForm.label.trim(),
        value: dataForm.value.trim(),
        sort: Number(dataForm.sort) || 0,
        isDefault: dataForm.isDefault,
        listClass: dataForm.listClass || null,
        status: dataForm.status,
      };
      if (editingData) await api.patch(`/dict-data/${editingData.id}`, payload);
      else await api.post('/dict-data', { ...payload, dictType: current.type });
      setDataModal(false);
      await refreshData(current.type);
    } catch (e: any) {
      setDataError(e.response?.data?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const removeData = async (d: DictDataRow) => {
    if (!current || !confirm(`确认删除「${d.label}」？`)) return;
    await api.delete(`/dict-data/${d.id}`);
    refreshData(current.type);
  };

  const filteredTypes = types.filter(
    (t) => !typeKw || t.name.includes(typeKw) || t.type.includes(typeKw),
  );

  return (
    <div>
      <PageHeader title="字典管理" description="维护系统中相对固定的枚举数据（状态、类型、等级等），业务页面按编码引用">
        {hasPerm('dict:add') && <Button onClick={openTypeCreate}><Plus className="w-4 h-4" /> 新增字典类型</Button>}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* 左：字典类型 */}
        <Card className="flex flex-col overflow-hidden self-start">
          <div className="p-3 border-b border-slate-100">
            <Input
              placeholder="搜索字典名称 / 编码"
              value={typeKw}
              onChange={(e) => setTypeKw(e.target.value)}
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {filteredTypes.length ? filteredTypes.map((t) => (
              <button
                key={t.id}
                onClick={() => selectType(t)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-50 transition-colors ${
                  current?.id === t.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : 'hover:bg-slate-50'
                }`}
              >
                <BookOpen className={`w-4 h-4 shrink-0 ${current?.id === t.id ? 'text-blue-600' : 'text-slate-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 truncate">{t.name}</div>
                  <div className="text-xs text-slate-400 font-mono truncate">{t.type}</div>
                </div>
                {t.status === 'DISABLED' && <Badge tone="red">停用</Badge>}
              </button>
            )) : <div className="p-4"><Empty text="暂无字典类型" /></div>}
          </div>
        </Card>

        {/* 右：字典数据 */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <span className="text-sm font-medium text-slate-800">{current?.name ?? '请选择字典'}</span>
              {current && <span className="ml-2 text-xs text-slate-400 font-mono">{current.type}</span>}
            </div>
            {current && hasPerm('dict:add') && (
              <Button size="sm" onClick={openDataCreate}><Plus className="w-3.5 h-3.5" /> 新增数据</Button>
            )}
          </div>
          {current ? (
            data.length ? (
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs text-slate-500">
                    <th className="py-2 px-4 font-medium">标签</th>
                    <th className="py-2 px-4 font-medium">键值</th>
                    <th className="py-2 px-4 font-medium">排序</th>
                    <th className="py-2 px-4 font-medium">默认</th>
                    <th className="py-2 px-4 font-medium">状态</th>
                    <th className="py-2 px-4 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 px-4">
                        <Badge tone={(d.listClass as any) || 'slate'}>{d.label}</Badge>
                      </td>
                      <td className="py-2.5 px-4 text-xs font-mono text-slate-600">{d.value}</td>
                      <td className="py-2.5 px-4 text-xs text-slate-500">{d.sort}</td>
                      <td className="py-2.5 px-4 text-xs">
                        {d.isDefault === 'YES' ? <Badge tone="green">默认</Badge> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="py-2.5 px-4">
                        {d.status === 'NORMAL' ? <Badge tone="green">正常</Badge> : <Badge tone="red">停用</Badge>}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          {hasPerm('dict:edit') && (
                            <Button size="sm" variant="ghost" onClick={() => openDataEdit(d)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {hasPerm('dict:remove') && (
                            <Button size="sm" variant="ghost" onClick={() => removeData(d)}>
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-4"><Empty text="该字典暂无数据" /></div>
            )
          ) : (
            <div className="p-4"><Empty text="请先选择左侧字典类型" /></div>
          )}
        </Card>
      </div>

      {/* 类型弹窗 */}
      <Modal open={typeModal} onClose={() => setTypeModal(false)} title={editingType ? '编辑字典类型' : '新增字典类型'}>
        <div className="space-y-4">
          <Field label="字典名称">
            <Input value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="字典编码" hint="字母开头，仅含字母/数字/下划线；编辑时编码不可修改">
            <Input
              value={typeForm.type}
              onChange={(e) => setTypeForm((f) => ({ ...f, type: e.target.value }))}
              disabled={!!editingType}
              className="font-mono"
            />
          </Field>
          <Field label="状态">
            <Select value={typeForm.status} onChange={(e) => setTypeForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="NORMAL">正常</option>
              <option value="DISABLED">停用</option>
            </Select>
          </Field>
          <Field label="备注">
            <Input value={typeForm.remark} onChange={(e) => setTypeForm((f) => ({ ...f, remark: e.target.value }))} />
          </Field>
          <InlineError message={typeError} />
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setTypeModal(false)}>取消</Button>
            <Button onClick={saveType} disabled={busy}>{busy ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </Modal>

      {/* 数据弹窗 */}
      <Modal open={dataModal} onClose={() => setDataModal(false)} title={editingData ? '编辑字典数据' : '新增字典数据'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="数据标签">
              <Input value={dataForm.label} onChange={(e) => setDataForm((f) => ({ ...f, label: e.target.value }))} />
            </Field>
            <Field label="数据键值">
              <Input value={dataForm.value} onChange={(e) => setDataForm((f) => ({ ...f, value: e.target.value }))} className="font-mono" />
            </Field>
            <Field label="显示排序">
              <Input type="number" value={dataForm.sort} onChange={(e) => setDataForm((f) => ({ ...f, sort: Number(e.target.value) }))} />
            </Field>
            <Field label="标签样式">
              <Select value={dataForm.listClass} onChange={(e) => setDataForm((f) => ({ ...f, listClass: e.target.value }))}>
                {LISTCLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="是否默认">
              <Select value={dataForm.isDefault} onChange={(e) => setDataForm((f) => ({ ...f, isDefault: e.target.value }))}>
                <option value="NO">否</option>
                <option value="YES">是</option>
              </Select>
            </Field>
            <Field label="状态">
              <Select value={dataForm.status} onChange={(e) => setDataForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="NORMAL">正常</option>
                <option value="DISABLED">停用</option>
              </Select>
            </Field>
          </div>
          <InlineError message={dataError} />
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setDataModal(false)}>取消</Button>
            <Button onClick={saveData} disabled={busy}>{busy ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
