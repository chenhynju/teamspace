const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const pending = [];
  const values = new Map([['current_org_id', 'A']]);
  const localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  function load(file, dependencies) {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(compiled, { exports, localStorage, window: {}, require: id => dependencies[id] ?? require(id) });
    return exports;
  }
  const im = load('src/store/im.ts', {});
  const auth = load('src/store/auth.ts', {
    './im': im,
    '@/lib/api': { api: { get: () => new Promise(resolve => pending.push(resolve)) } },
  });
  return { auth: auth.useAuthStore, im: im.useImStore, pending };
}

test('tenant switch immediately clears cached messages and permissions; logout also clears IM', async () => {
  const f = fixture();
  f.im.setState({ conversations: [{ id: 'private-A' }], currentConversationId: 'private-A', messages: [{ content: 'A only' }] });
  f.auth.setState({ perms: ['A:read'], roleKeys: ['OWNER'] });
  const switched = f.auth.getState().setCurrentOrg('B');
  assert.equal(f.auth.getState().currentOrgId, 'B');
  assert.equal(f.auth.getState().perms.length, 0);
  assert.equal(f.auth.getState().roleKeys.length, 0);
  assert.equal(f.im.getState().conversations.length, 0);
  assert.equal(f.im.getState().messages.length, 0);
  assert.equal(f.im.getState().currentConversationId, null);
  f.pending.shift()({ data: { perms: ['B:read'], roleKeys: ['MEMBER'] } });
  await switched;
  f.im.setState({ messages: [{ content: 'B only' }] });
  f.auth.getState().logout();
  assert.equal(f.im.getState().messages.length, 0);
  assert.equal(f.auth.getState().currentOrgId, null);
});

test('late response from B cannot overwrite A permissions after A-B-A switch', async () => {
  const f = fixture();
  const switchB = f.auth.getState().setCurrentOrg('B');
  const switchA = f.auth.getState().setCurrentOrg('A');
  f.pending[1]({ data: { perms: ['A:read'], roleKeys: ['MEMBER'] } });
  await switchA;
  f.pending[0]({ data: { perms: ['B:admin'], roleKeys: ['OWNER'] } });
  await switchB;
  assert.equal(f.auth.getState().currentOrgId, 'A');
  assert.equal(f.auth.getState().perms[0], 'A:read');
  assert.equal(f.auth.getState().roleKeys[0], 'MEMBER');
});
