import 'server-only';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(128);
const shortText = z.string().trim().max(256);
const longText = z.string().trim().max(4096);
const stringList = z.array(z.string().trim().min(1).max(256)).max(500);
const httpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const userStatus = z.enum(['active', 'disabled']);
const projectStatus = z.enum(['healthy', 'warning', 'critical']);
const projectEnvironment = z.enum(['production', 'staging', 'development']);

export const loginRequestSchema = z
  .object({
    username: identifier,
    password: z.string().min(1).max(1024),
  })
  .strict();

export const deleteByIdSchema = z.object({ id: identifier }).strict();

export const createSystemUserSchema = z
  .object({
    username: identifier,
    password: z.string().min(1).max(1024),
    displayName: shortText,
    email: z.string().trim().max(320).optional(),
    phone: z.string().trim().max(64).optional(),
    status: userStatus.optional(),
    roleIds: z.array(identifier).min(1).max(100),
  })
  .strict();

export const updateSystemUserSchema = createSystemUserSchema
  .omit({ username: true })
  .partial()
  .extend({ id: identifier })
  .strict();

export const createSystemRoleSchema = z
  .object({
    id: z.union([identifier, z.literal('')]).optional().transform((value) => value || undefined),
    name: z.string().trim().min(1).max(256),
    description: longText.optional(),
    parentId: z.string().trim().max(128).optional(),
    defaultRouter: z.string().trim().max(2048).optional(),
    menuIds: stringList.optional(),
    btnAuths: stringList.optional(),
  })
  .strict();

export const updateSystemRoleSchema = createSystemRoleSchema
  .partial()
  .extend({ id: identifier })
  .strict();

export const createSystemMenuSchema = z
  .object({
    parentId: z.string().trim().max(128).optional(),
    path: z.string().trim().min(1).max(2048),
    name: identifier,
    component: z.string().trim().min(1).max(2048),
    title: z.string().trim().min(1).max(256),
    icon: z.string().trim().max(128).optional(),
    hidden: z.boolean().optional(),
    sort: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    keepAlive: z.boolean().optional(),
    menuBtns: stringList.optional(),
  })
  .strict();

export const updateSystemMenuSchema = createSystemMenuSchema
  .partial()
  .extend({ id: identifier })
  .strict();

export const createSystemApiSchema = z
  .object({
    path: z.string().trim().min(1).max(2048),
    method: httpMethod,
    apiGroup: z.string().trim().min(1).max(256),
    description: longText.optional(),
  })
  .strict();

export const updateSystemApiSchema = createSystemApiSchema
  .partial()
  .extend({ id: identifier })
  .strict();

export const replaceCasbinPoliciesSchema = z
  .object({
    roleId: identifier,
    policies: z
      .array(z.object({ path: z.string().trim().min(1).max(2048), method: httpMethod }).strict())
      .max(5000),
  })
  .strict();

const managedProjectServerSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(256),
    region: z.string().trim().min(1).max(256),
    host: z.string().trim().min(1).max(2048),
    environment: projectEnvironment,
    status: projectStatus,
    cpuUsage: z.number().nonnegative(),
    memoryUsage: z.number().nonnegative(),
    responseTimeMs: z.number().nonnegative(),
  })
  .strict();

const managedProjectServiceSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(256),
    category: z.enum(['api', 'worker', 'queue', 'storage', 'database']),
    uptime: z.string().trim().min(1).max(256),
    status: projectStatus,
  })
  .strict();

export const managedProjectDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    code: identifier,
    description: longText,
    owner: z.string().trim().min(1).max(256),
    environment: projectEnvironment,
    status: projectStatus,
    region: z.string().trim().min(1).max(256),
    baseUrl: z.url().max(2048),
    apiBaseUrl: z.url().max(2048),
    probeBaseUrl: z.url().max(2048).nullable().optional(),
    tags: stringList,
    version: z.string().trim().min(1).max(128),
    lastDeployedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date-time.'),
    activeUsers: z.number().nonnegative(),
    requestPerMinute: z.number().nonnegative(),
    errorRate: z.number().nonnegative(),
    servers: z.array(managedProjectServerSchema).max(1000),
    services: z.array(managedProjectServiceSchema).max(1000),
  })
  .strict();

export const managedUserBatchSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('batch-status'),
      userIds: z.array(identifier).min(1).max(1000),
      status: userStatus,
    })
    .strict(),
  z
    .object({
      action: z.literal('batch-role'),
      userIds: z.array(identifier).min(1).max(1000),
      roleId: identifier,
      operation: z.enum(['assign', 'remove']),
    })
    .strict(),
]);

export const managedUserUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(256),
    status: userStatus,
    roles: z.array(identifier).max(100),
    extraPermissions: stringList,
  })
  .strict();

const managedRoleFields = {
  name: z.string().trim().min(1).max(256),
  description: longText,
  permissions: stringList,
};

export const managedRoleCreateSchema = z
  .object({ id: identifier, ...managedRoleFields })
  .strict();

export const managedRoleUpdateSchema = z
  .object({ id: identifier.optional(), ...managedRoleFields })
  .strict();
