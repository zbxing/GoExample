import 'server-only';
import { readFile } from 'node:fs/promises';
import { type QueryResultRow } from 'pg';
import {
  type ManagedProject,
  type ManagedProjectDraft,
  type ManagedProjectService,
  type ManagedProjectServer,
  type ProjectRepositoryPayload,
  type ProjectEnvironment,
  type ProjectStatus,
  type ManagedServiceCategory,
  type ManagedProjectListQuery,
  type ManagedProjectPage,
  type ManagedProjectSummary,
  type ManagedProjectCatalogEntry,
} from '@/lib/types/management';
import { resolveDataFilePath, writeJsonPath } from '@/lib/server/json-store';
import {
  getDatabasePool,
  resolveDatabaseUrl as resolveConfiguredDatabaseUrl,
} from '@/lib/server/database';

const projectDataFilePath = resolveDataFilePath('projects.json');

const validStatuses: ProjectStatus[] = ['healthy', 'warning', 'critical'];
const validEnvironments: ProjectEnvironment[] = ['production', 'staging', 'development'];
const validServiceCategories: ManagedServiceCategory[] = [
  'api',
  'worker',
  'queue',
  'storage',
  'database',
];
const auditActor = 'msfront:ui';
const fullProjectListCacheTtlMs = 5_000;
let fullProjectListCache: { expiresAt: number; projects: ManagedProject[] } | null = null;
let fullProjectListInFlight: Promise<ManagedProject[]> | null = null;

type ProjectStorageDriver = 'auto' | 'database' | 'file';

interface ManagedProjectRow extends QueryResultRow {
  id: string;
  name: string;
  code: string;
  description: string;
  owner: string;
  environment: string;
  status: string;
  region: string;
  baseUrl: string;
  apiBaseUrl: string;
  probeBaseUrl: string | null;
  tags: string[];
  versionLabel: string;
  lastDeployedAt: Date | string;
  activeUsers: number;
  requestPerMinute: number;
  errorRate: number;
  servers: unknown;
  services: unknown;
}

interface ManagedProjectCatalogRow extends QueryResultRow {
  id: string;
  name: string;
  code: string;
  description: string;
  owner: string;
  environment: string;
  status: string;
  region: string;
  baseUrl: string;
  apiBaseUrl: string;
  probeBaseUrl: string | null;
  tags: string[];
  versionLabel: string;
  lastDeployedAt: Date | string;
  activeUsers: number;
  requestPerMinute: number;
  errorRate: number;
}

interface ManagedProjectSummaryRow extends ManagedProjectCatalogRow {
  serverCount: number | string;
  serviceCount: number | string;
  healthyServerCount: number | string;
  healthyServiceCount: number | string;
}

export async function listProjects() {
  if (fullProjectListCache && fullProjectListCache.expiresAt > Date.now()) {
    return fullProjectListCache.projects;
  }

  if (fullProjectListInFlight) {
    return fullProjectListInFlight;
  }

  fullProjectListInFlight = (shouldUseDatabase()
    ? listProjectsFromDatabase()
    : readProjectPayload().then((payload) => payload.projects))
    .then((projects) => {
      fullProjectListCache = {
        expiresAt: Date.now() + fullProjectListCacheTtlMs,
        projects,
      };
      return projects;
    })
    .finally(() => {
      fullProjectListInFlight = null;
    });

  return fullProjectListInFlight;
}

export async function listProjectSummaries(
  query: ManagedProjectListQuery = {},
): Promise<ManagedProjectPage> {
  const page = clampInteger(query.page, 1, 1, 100000);
  const pageSize = clampInteger(query.pageSize, 20, 1, 100);
  const search = `${query.search ?? ''}`.trim();
  const environment = query.environment && query.environment !== 'all' ? query.environment : null;
  const status = query.status && query.status !== 'all' ? query.status : null;

  if (shouldUseDatabase()) {
    return listProjectSummariesFromDatabase({ page, pageSize, search, environment, status, sort: query.sort });
  }

  const payload = await readProjectPayload();
  const summaries = payload.projects
    .map(toProjectSummary)
    .filter((project) => !environment || project.environment === environment)
    .filter((project) => !status || project.status === status)
    .filter((project) => matchesProjectSearch(project, search))
    .sort((left, right) => compareProjectSummaries(left, right, query.sort));
  const totalItems = summaries.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: summaries.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
  };
}

export async function listProjectCatalog(): Promise<ManagedProjectCatalogEntry[]> {
  if (shouldUseDatabase()) {
    return listProjectCatalogFromDatabase();
  }

  const payload = await readProjectPayload();
  return payload.projects.map(toProjectCatalogEntry).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getProjectById(projectId: string) {
  if (shouldUseDatabase()) {
    return getProjectByIdFromDatabase(projectId);
  }

  const projects = await listProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function createProject(draft: ManagedProjectDraft) {
  if (shouldUseDatabase()) {
    return createProjectInDatabase(draft);
  }

  const payload = await readProjectPayload();
  const project = normalizeProjectDraft(draft);

  if (
    payload.projects.some(
      (item) => item.id === project.id || item.code.toLowerCase() === project.code.toLowerCase(),
    )
  ) {
    throw new Error('Project id or code already exists.');
  }

  payload.projects.unshift(project);
  await writeProjectPayload(payload);
  invalidateFullProjectListCache();
  return project;
}

export async function updateProject(projectId: string, draft: ManagedProjectDraft) {
  if (shouldUseDatabase()) {
    return updateProjectInDatabase(projectId, draft);
  }

  const payload = await readProjectPayload();
  const index = payload.projects.findIndex((project) => project.id === projectId);

  if (index < 0) {
    return null;
  }

  const nextProject = normalizeProjectDraft(draft, projectId);
  const duplicateCode = payload.projects.some(
    (item, currentIndex) =>
      currentIndex !== index && item.code.toLowerCase() === nextProject.code.toLowerCase(),
  );

  if (duplicateCode) {
    throw new Error('Project code already exists.');
  }

  payload.projects[index] = nextProject;
  await writeProjectPayload(payload);
  invalidateFullProjectListCache();
  return nextProject;
}

export async function deleteProject(projectId: string) {
  if (shouldUseDatabase()) {
    return deleteProjectInDatabase(projectId);
  }

  const payload = await readProjectPayload();
  const nextProjects = payload.projects.filter((project) => project.id !== projectId);

  if (nextProjects.length === payload.projects.length) {
    return false;
  }

  await writeProjectPayload({ projects: nextProjects });
  invalidateFullProjectListCache();
  return true;
}

async function listProjectsFromDatabase() {
  const pool = getDatabasePool();
  const result = await pool.query<ManagedProjectRow>(
    `
      SELECT
        "id",
        "name",
        "code",
        "description",
        "owner",
        "environment",
        "status",
        "region",
        "baseUrl",
        "apiBaseUrl",
        "probeBaseUrl",
        "tags",
        "versionLabel",
        "lastDeployedAt",
        "activeUsers",
        "requestPerMinute",
        "errorRate",
        "servers",
        "services"
      FROM "managed_projects"
      ORDER BY "updatedAt" DESC, "createdAt" DESC
    `,
  );

  return result.rows.map(mapProjectRow);
}

async function listProjectSummariesFromDatabase({
  page,
  pageSize,
  search,
  environment,
  status,
  sort,
}: Required<Pick<ManagedProjectListQuery, 'page' | 'pageSize'>> & {
  search: string;
  environment: ProjectEnvironment | null;
  status: ProjectStatus | null;
  sort?: ManagedProjectListQuery['sort'];
}): Promise<ManagedProjectPage> {
  const pool = getDatabasePool();
  const filters: string[] = [];
  const values: unknown[] = [];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (search) {
    const parameter = addValue(`%${search}%`);
    filters.push(`("name" ILIKE ${parameter} OR "code" ILIKE ${parameter} OR "owner" ILIKE ${parameter} OR "region" ILIKE ${parameter})`);
  }
  if (environment) filters.push(`"environment" = ${addValue(environment)}`);
  if (status) filters.push(`"status" = ${addValue(status)}`);
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sortClause = projectSummarySortSql(sort);
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "managed_projects" ${whereClause}`,
    values,
  );
  const totalItems = Number(countResult.rows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const limitParameter = addValue(pageSize);
  const offsetParameter = addValue((safePage - 1) * pageSize);
  const result = await pool.query<ManagedProjectSummaryRow>(
    `
      SELECT "id", "name", "code", "description", "owner", "environment", "status", "region",
        "baseUrl", "apiBaseUrl", "probeBaseUrl", "tags", "versionLabel", "lastDeployedAt",
        "activeUsers", "requestPerMinute", "errorRate",
        jsonb_array_length(CASE WHEN jsonb_typeof("servers") = 'array' THEN "servers" ELSE '[]'::jsonb END) AS "serverCount",
        jsonb_array_length(CASE WHEN jsonb_typeof("services") = 'array' THEN "services" ELSE '[]'::jsonb END) AS "serviceCount",
        COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof("servers") = 'array' THEN "servers" ELSE '[]'::jsonb END) item WHERE item->>'status' = 'healthy'), 0) AS "healthyServerCount",
        COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof("services") = 'array' THEN "services" ELSE '[]'::jsonb END) item WHERE item->>'status' = 'healthy'), 0) AS "healthyServiceCount"
      FROM "managed_projects"
      ${whereClause}
      ORDER BY ${sortClause}
      LIMIT ${limitParameter} OFFSET ${offsetParameter}
    `,
    values,
  );

  return { items: result.rows.map(mapProjectSummaryRow), page: safePage, pageSize, totalItems, totalPages };
}

async function listProjectCatalogFromDatabase() {
  const pool = getDatabasePool();
  const result = await pool.query<ManagedProjectCatalogRow>(
    `
      SELECT "id", "name", "code", "description", "owner", "environment", "status", "region",
        "baseUrl", "apiBaseUrl", "probeBaseUrl", "tags", "versionLabel", "lastDeployedAt",
        "activeUsers", "requestPerMinute", "errorRate"
      FROM "managed_projects"
      ORDER BY "name" ASC
    `,
  );
  return result.rows.map(mapProjectCatalogRow);
}

async function getProjectByIdFromDatabase(projectId: string) {
  const pool = getDatabasePool();
  const result = await pool.query<ManagedProjectRow>(
    `
      SELECT
        "id",
        "name",
        "code",
        "description",
        "owner",
        "environment",
        "status",
        "region",
        "baseUrl",
        "apiBaseUrl",
        "probeBaseUrl",
        "tags",
        "versionLabel",
        "lastDeployedAt",
        "activeUsers",
        "requestPerMinute",
        "errorRate",
        "servers",
        "services"
      FROM "managed_projects"
      WHERE "id" = $1
      LIMIT 1
    `,
    [projectId],
  );

  return result.rows[0] ? mapProjectRow(result.rows[0]) : null;
}

async function createProjectInDatabase(draft: ManagedProjectDraft) {
  const pool = getDatabasePool();
  const project = normalizeProjectDraft(draft);
  const existing = await pool.query<{ id: string }>(
    `
      SELECT "id"
      FROM "managed_projects"
      WHERE "id" = $1 OR LOWER("code") = LOWER($2)
      LIMIT 1
    `,
    [project.id, project.code],
  );

  if (existing.rowCount) {
    throw new Error('Project id or code already exists.');
  }

  const result = await pool.query<ManagedProjectRow>(
    `
      INSERT INTO "managed_projects" (
        "id",
        "name",
        "code",
        "description",
        "owner",
        "environment",
        "status",
        "region",
        "baseUrl",
        "apiBaseUrl",
        "probeBaseUrl",
        "tags",
        "versionLabel",
        "lastDeployedAt",
        "activeUsers",
        "requestPerMinute",
        "errorRate",
        "servers",
        "services",
        "createdBy",
        "updatedBy",
        "version",
        "createdAt",
        "updatedAt"
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18::jsonb,
        $19::jsonb,
        $20,
        $21,
        1,
        NOW(),
        NOW()
      )
      RETURNING
        "id",
        "name",
        "code",
        "description",
        "owner",
        "environment",
        "status",
        "region",
        "baseUrl",
        "apiBaseUrl",
        "probeBaseUrl",
        "tags",
        "versionLabel",
        "lastDeployedAt",
        "activeUsers",
        "requestPerMinute",
        "errorRate",
        "servers",
        "services"
    `,
    [
      project.id,
      project.name,
      project.code,
      project.description,
      project.owner,
      project.environment,
      project.status,
      project.region,
      project.baseUrl,
      project.apiBaseUrl,
      project.probeBaseUrl,
      project.tags,
      project.version,
      project.lastDeployedAt,
      project.activeUsers,
      project.requestPerMinute,
      project.errorRate,
      JSON.stringify(project.servers),
      JSON.stringify(project.services),
      auditActor,
      auditActor,
    ],
  );

  const nextProject = mapProjectRow(result.rows[0]);
  invalidateFullProjectListCache();
  return nextProject;
}

async function updateProjectInDatabase(projectId: string, draft: ManagedProjectDraft) {
  const pool = getDatabasePool();
  const project = normalizeProjectDraft(draft, projectId);
  const existing = await pool.query<{ id: string }>(
    `
      SELECT "id"
      FROM "managed_projects"
      WHERE "id" = $1
      LIMIT 1
    `,
    [projectId],
  );

  if (!existing.rowCount) {
    return null;
  }

  const duplicateCode = await pool.query<{ id: string }>(
    `
      SELECT "id"
      FROM "managed_projects"
      WHERE LOWER("code") = LOWER($1) AND "id" <> $2
      LIMIT 1
    `,
    [project.code, projectId],
  );

  if (duplicateCode.rowCount) {
    throw new Error('Project code already exists.');
  }

  const result = await pool.query<ManagedProjectRow>(
    `
      UPDATE "managed_projects"
      SET
        "name" = $2,
        "code" = $3,
        "description" = $4,
        "owner" = $5,
        "environment" = $6,
        "status" = $7,
        "region" = $8,
        "baseUrl" = $9,
        "apiBaseUrl" = $10,
        "probeBaseUrl" = $11,
        "tags" = $12,
        "versionLabel" = $13,
        "lastDeployedAt" = $14,
        "activeUsers" = $15,
        "requestPerMinute" = $16,
        "errorRate" = $17,
        "servers" = $18::jsonb,
        "services" = $19::jsonb,
        "updatedBy" = $20,
        "version" = "version" + 1,
        "updatedAt" = NOW()
      WHERE "id" = $1
      RETURNING
        "id",
        "name",
        "code",
        "description",
        "owner",
        "environment",
        "status",
        "region",
        "baseUrl",
        "apiBaseUrl",
        "probeBaseUrl",
        "tags",
        "versionLabel",
        "lastDeployedAt",
        "activeUsers",
        "requestPerMinute",
        "errorRate",
        "servers",
        "services"
    `,
    [
      projectId,
      project.name,
      project.code,
      project.description,
      project.owner,
      project.environment,
      project.status,
      project.region,
      project.baseUrl,
      project.apiBaseUrl,
      project.probeBaseUrl,
      project.tags,
      project.version,
      project.lastDeployedAt,
      project.activeUsers,
      project.requestPerMinute,
      project.errorRate,
      JSON.stringify(project.servers),
      JSON.stringify(project.services),
      auditActor,
    ],
  );

  const nextProject = mapProjectRow(result.rows[0]);
  invalidateFullProjectListCache();
  return nextProject;
}

async function deleteProjectInDatabase(projectId: string) {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      DELETE FROM "managed_projects"
      WHERE "id" = $1
    `,
    [projectId],
  );

  const deleted = (result.rowCount ?? 0) > 0;
  if (deleted) {
    invalidateFullProjectListCache();
  }
  return deleted;
}

function invalidateFullProjectListCache() {
  fullProjectListCache = null;
}

async function readProjectPayload(): Promise<ProjectRepositoryPayload> {
  const content = await readFile(projectDataFilePath, 'utf8');
  return JSON.parse(content) as ProjectRepositoryPayload;
}

async function writeProjectPayload(payload: ProjectRepositoryPayload) {
  await writeJsonPath(projectDataFilePath, payload);
}

function shouldUseDatabase() {
  const driver = resolveStorageDriver();

  if (driver === 'file') {
    return false;
  }

  const databaseUrl = resolveConfiguredDatabaseUrl();

  if (!databaseUrl) {
    if (driver === 'database') {
      throw new Error(
        'MSFront database storage is enabled, but no DATABASE_URL or MSFRONT_DATABASE_URL was found.',
      );
    }

    return false;
  }

  return true;
}

function resolveStorageDriver(): ProjectStorageDriver {
  const configuredValue = `${process.env.MSFRONT_PROJECT_STORAGE_DRIVER ?? 'auto'}`
    .trim()
    .toLowerCase();

  if (
    configuredValue === 'auto' ||
    configuredValue === 'database' ||
    configuredValue === 'file'
  ) {
    return configuredValue;
  }

  return 'auto';
}

function mapProjectRow(row: ManagedProjectRow): ManagedProject {
  return normalizeProjectDraft(
    {
      name: row.name,
      code: row.code,
      description: row.description,
      owner: row.owner,
      environment: row.environment as ProjectEnvironment,
      status: row.status as ProjectStatus,
      region: row.region,
      baseUrl: row.baseUrl,
      apiBaseUrl: row.apiBaseUrl,
      probeBaseUrl: row.probeBaseUrl,
      tags: Array.isArray(row.tags) ? row.tags : [],
      version: row.versionLabel,
      lastDeployedAt: new Date(row.lastDeployedAt).toISOString(),
      activeUsers: row.activeUsers,
      requestPerMinute: row.requestPerMinute,
      errorRate: row.errorRate,
      servers: parseEntityArray(row.servers) as ManagedProjectServer[],
      services: parseEntityArray(row.services) as ManagedProjectService[],
    },
    row.id,
  );
}

function mapProjectSummaryRow(row: ManagedProjectSummaryRow): ManagedProjectSummary {
  return {
    ...mapProjectCatalogRow(row),
    serverCount: Number(row.serverCount ?? 0),
    serviceCount: Number(row.serviceCount ?? 0),
    healthyServerCount: Number(row.healthyServerCount ?? 0),
    healthyServiceCount: Number(row.healthyServiceCount ?? 0),
  };
}

function mapProjectCatalogRow(row: ManagedProjectCatalogRow): ManagedProjectCatalogEntry {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    owner: row.owner,
    environment: row.environment as ProjectEnvironment,
    status: row.status as ProjectStatus,
    region: row.region,
    baseUrl: row.baseUrl,
    apiBaseUrl: row.apiBaseUrl,
    probeBaseUrl: row.probeBaseUrl,
    tags: Array.isArray(row.tags) ? row.tags : [],
    version: row.versionLabel,
    lastDeployedAt: new Date(row.lastDeployedAt).toISOString(),
    activeUsers: Number(row.activeUsers ?? 0),
    requestPerMinute: Number(row.requestPerMinute ?? 0),
    errorRate: Number(row.errorRate ?? 0),
  };
}

function toProjectSummary(project: ManagedProject): ManagedProjectSummary {
  const { servers, services, ...metadata } = project;

  return {
    ...metadata,
    serverCount: servers.length,
    serviceCount: services.length,
    healthyServerCount: servers.filter((server) => server.status === 'healthy').length,
    healthyServiceCount: services.filter((service) => service.status === 'healthy').length,
  };
}

function toProjectCatalogEntry(project: ManagedProject): ManagedProjectCatalogEntry {
  return {
    id: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    owner: project.owner,
    environment: project.environment,
    status: project.status,
    region: project.region,
    baseUrl: project.baseUrl,
    apiBaseUrl: project.apiBaseUrl,
    probeBaseUrl: project.probeBaseUrl,
    tags: project.tags,
    version: project.version,
    lastDeployedAt: project.lastDeployedAt,
    activeUsers: project.activeUsers,
    requestPerMinute: project.requestPerMinute,
    errorRate: project.errorRate,
  };
}

function matchesProjectSearch(project: ManagedProjectSummary, search: string) {
  if (!search) return true;
  return [project.name, project.code, project.description, project.owner, project.region, project.version, ...project.tags]
    .join(' ').toLowerCase().includes(search.toLowerCase());
}

function compareProjectSummaries(left: ManagedProjectSummary, right: ManagedProjectSummary, sort?: ManagedProjectListQuery['sort']) {
  if (sort === 'name') return left.name.localeCompare(right.name);
  if (sort === 'traffic') return right.requestPerMinute - left.requestPerMinute;
  if (sort === 'deploy') return new Date(right.lastDeployedAt).valueOf() - new Date(left.lastDeployedAt).valueOf();
  return statusRank(right.status) - statusRank(left.status) || right.errorRate - left.errorRate;
}

function projectSummarySortSql(sort?: ManagedProjectListQuery['sort']) {
  if (sort === 'name') return '"name" ASC';
  if (sort === 'traffic') return '"requestPerMinute" DESC, "name" ASC';
  if (sort === 'deploy') return '"lastDeployedAt" DESC NULLS LAST, "name" ASC';
  return `CASE "status" WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC, "errorRate" DESC, "name" ASC`;
}

function statusRank(status: ProjectStatus) {
  return status === 'critical' ? 3 : status === 'warning' ? 2 : 1;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function parseEntityArray(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Managed project JSON column did not contain an array payload.');
  }

  return value;
}

function normalizeProjectDraft(
  draft: ManagedProjectDraft,
  existingId?: string,
): ManagedProject {
  const name = requiredString(draft.name, 'name');
  const code = requiredString(draft.code, 'code').toUpperCase();
  const description = requiredString(draft.description, 'description');
  const owner = requiredString(draft.owner, 'owner');
  const region = requiredString(draft.region, 'region');
  const baseUrl = requiredString(draft.baseUrl, 'baseUrl');
  const apiBaseUrl = requiredString(draft.apiBaseUrl, 'apiBaseUrl');
  const version = requiredString(draft.version, 'version');
  const lastDeployedAt = normalizeDateTime(draft.lastDeployedAt, 'lastDeployedAt');
  const status = validateStatus(draft.status);
  const environment = validateEnvironment(draft.environment);
  const probeBaseUrl =
    typeof draft.probeBaseUrl === 'string' && draft.probeBaseUrl.trim().length > 0
      ? draft.probeBaseUrl.trim()
      : null;

  const projectId = existingId ?? slugify(code || name);

  return {
    id: projectId,
    name,
    code,
    description,
    owner,
    environment,
    status,
    region,
    baseUrl,
    apiBaseUrl,
    probeBaseUrl,
    tags: Array.from(
      new Set(
        (draft.tags ?? [])
          .map((tag) => `${tag}`.trim())
          .filter(Boolean),
      ),
    ),
    version,
    lastDeployedAt,
    activeUsers: normalizeNumber(draft.activeUsers, 'activeUsers'),
    requestPerMinute: normalizeNumber(draft.requestPerMinute, 'requestPerMinute'),
    errorRate: normalizeNumber(draft.errorRate, 'errorRate'),
    servers: (draft.servers ?? []).map(normalizeServer),
    services: (draft.services ?? []).map(normalizeService),
  };
}

function normalizeServer(server: ManagedProjectServer): ManagedProjectServer {
  return {
    id: requiredString(server.id, 'server.id') || slugify(server.name),
    name: requiredString(server.name, 'server.name'),
    region: requiredString(server.region, 'server.region'),
    host: requiredString(server.host, 'server.host'),
    environment: validateEnvironment(server.environment),
    status: validateStatus(server.status),
    cpuUsage: normalizeNumber(server.cpuUsage, 'server.cpuUsage'),
    memoryUsage: normalizeNumber(server.memoryUsage, 'server.memoryUsage'),
    responseTimeMs: normalizeNumber(server.responseTimeMs, 'server.responseTimeMs'),
  };
}

function normalizeService(service: ManagedProjectService): ManagedProjectService {
  const category = `${service.category}` as ManagedServiceCategory;

  if (!validServiceCategories.includes(category)) {
    throw new Error(`Invalid service category: ${service.category}`);
  }

  return {
    id: requiredString(service.id, 'service.id') || slugify(service.name),
    name: requiredString(service.name, 'service.name'),
    category,
    uptime: requiredString(service.uptime, 'service.uptime'),
    status: validateStatus(service.status),
  };
}

function requiredString(value: string, fieldName: string) {
  const normalized = `${value ?? ''}`.trim();

  if (!normalized) {
    throw new Error(`Missing required field: ${fieldName}`);
  }

  return normalized;
}

function normalizeNumber(value: number, fieldName: string) {
  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new Error(`Invalid number field: ${fieldName}`);
  }

  return normalized;
}

function normalizeDateTime(value: string, fieldName: string) {
  const normalized = requiredString(value, fieldName);
  const parsedDate = new Date(normalized);

  if (Number.isNaN(parsedDate.valueOf())) {
    throw new Error(`Invalid date field: ${fieldName}`);
  }

  return parsedDate.toISOString();
}

function validateStatus(value: ProjectStatus) {
  if (!validStatuses.includes(value)) {
    throw new Error(`Invalid status: ${value}`);
  }

  return value;
}

function validateEnvironment(value: ProjectEnvironment) {
  if (!validEnvironments.includes(value)) {
    throw new Error(`Invalid environment: ${value}`);
  }

  return value;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
