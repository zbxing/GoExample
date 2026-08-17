import 'server-only';
import type {
  CasbinPolicyRecord,
  HttpMethod,
  ReplaceCasbinPoliciesInput,
} from '@/lib/types/system';
import { createId, readJsonFile, writeJsonFile } from '@/lib/server/json-store';

interface CasbinFile {
  policies: CasbinPolicyRecord[];
}

const fileName = 'system-casbin.json';

async function loadPolicies() {
  const data = await readJsonFile<CasbinFile>(fileName, { policies: [] });
  return data.policies;
}

async function savePolicies(policies: CasbinPolicyRecord[]) {
  await writeJsonFile<CasbinFile>(fileName, { policies });
}

export async function listCasbinPolicies(roleId?: string) {
  const policies = await loadPolicies();
  if (!roleId) {
    return policies;
  }
  return policies.filter((policy) => policy.roleId === roleId);
}

export async function replaceCasbinPoliciesForRole(input: ReplaceCasbinPoliciesInput) {
  const policies = await loadPolicies();
  const retained = policies.filter((policy) => policy.roleId !== input.roleId);
  const nextPolicies: CasbinPolicyRecord[] = input.policies.map((policy) => ({
    id: createId('p'),
    roleId: input.roleId,
    path: policy.path.trim(),
    method: policy.method,
  }));
  const merged = [...retained, ...nextPolicies];
  await savePolicies(merged);
  return nextPolicies;
}

export async function isPathAllowedForRoles(
  roleIds: string[],
  method: string,
  requestPath: string,
) {
  if (roleIds.includes('888')) {
    return true;
  }

  const normalizedMethod = method.toUpperCase() as HttpMethod;
  const policies = await loadPolicies();
  const roleSet = new Set(roleIds);

  return policies.some((policy) => {
    if (!roleSet.has(policy.roleId)) {
      return false;
    }
    if (policy.method !== normalizedMethod) {
      return false;
    }
    return matchApiPath(policy.path, requestPath);
  });
}

function matchApiPath(pattern: string, requestPath: string) {
  if (pattern === requestPath) {
    return true;
  }

  const patternParts = pattern.split('/').filter(Boolean);
  const requestParts = requestPath.split('/').filter(Boolean);
  if (patternParts.length !== requestParts.length) {
    return false;
  }

  return patternParts.every((part, index) => part.startsWith(':') || part === requestParts[index]);
}
