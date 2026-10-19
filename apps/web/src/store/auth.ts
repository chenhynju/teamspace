import { create } from 'zustand';
import { api } from '@/lib/api';
import { useImStore } from './im';

export interface MembershipOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  membershipId: string;
  membershipStatus: string;
  deptId: string | null;
  roleKeys: string[];
  roleNames: string[];
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  organizations: MembershipOrg[];
  currentOrgId: string | null;
  perms: string[];
  roleKeys: string[];
  setToken: (t: string) => void;
  setCurrentOrg: (id: string) => Promise<void>;
  logout: () => void;
  loadProfile: () => Promise<void>;
  loadOrgContext: () => Promise<void>;
  hasPerm: (p: string) => boolean;
}

function matchPerm(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  // 模块级通配：如 project:* 命中 project:edit
  const [module] = required.split(':');
  return granted.includes(`${module}:*`);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('access_token') : null,
  user: null,
  organizations: [],
  currentOrgId:
    typeof window !== 'undefined' ? localStorage.getItem('current_org_id') : null,
  perms: [],
  roleKeys: [],

  setToken: (t) => {
    localStorage.setItem('access_token', t);
    set({ token: t });
  },

  setCurrentOrg: async (id) => {
    if (get().currentOrgId !== id) {
      useImStore.setState({ conversations: [], currentConversationId: null, messages: [] });
      set({ perms: [], roleKeys: [] });
    }
    localStorage.setItem('current_org_id', id);
    set({ currentOrgId: id });
    await get().loadOrgContext();
  },

  logout: () => {
    useImStore.setState({ conversations: [], currentConversationId: null, messages: [] });
    localStorage.removeItem('access_token');
    localStorage.removeItem('current_org_id');
    set({
      token: null,
      user: null,
      organizations: [],
      currentOrgId: null,
      perms: [],
      roleKeys: [],
    });
  },

  loadProfile: async () => {
    const { data } = await api.get('/users/me');
    const organizations: MembershipOrg[] = data.organizations ?? [];
    set({
      user: {
        id: data.id,
        email: data.email,
        name: data.name,
        avatarUrl: data.avatarUrl,
      },
      organizations,
    });

    if (!get().currentOrgId && organizations.length > 0) {
      await get().setCurrentOrg(organizations[0].id);
    } else {
      await get().loadOrgContext();
    }
  },

  loadOrgContext: async () => {
    const orgId = get().currentOrgId;
    if (!orgId) return;
    const { data } = await api.get('/organizations/current');
    if (get().currentOrgId !== orgId) return;
    set({ perms: data.perms ?? [], roleKeys: data.roleKeys ?? [] });
  },

  hasPerm: (p) => {
    const { perms, roleKeys } = get();
    if (roleKeys.includes('OWNER')) return true;
    return matchPerm(perms, p);
  },
}));
