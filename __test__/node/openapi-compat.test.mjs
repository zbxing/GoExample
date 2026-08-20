import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOpenAPIBreakingChanges } from '../../scripts/lib/openapi-compat.mjs';

function document(operation) {
  return {
    openapi: '3.1.0',
    paths: {
      '/widgets': {
        post: {
          operationId: 'createWidget',
          parameters: [
            { name: 'locale', in: 'query', required: false, schema: { type: 'string', enum: ['en', 'zh'] } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name'],
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    mode: { type: 'string', enum: ['safe', 'fast'] },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Created widget',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'state'],
                    properties: {
                      id: { type: 'string' },
                      state: { type: 'string', enum: ['ready', 'failed'] },
                    },
                  },
                },
              },
            },
          },
          ...operation,
        },
      },
    },
  };
}

test('OpenAPI compatibility accepts additive optional changes', () => {
  const baseline = document();
  const current = structuredClone(baseline);
  current.paths['/widgets'].post.parameters.push({
    name: 'trace',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  });
  current.paths['/widgets'].post.requestBody.content['application/json'].schema.properties.note = {
    type: 'string',
  };
  current.paths['/widgets'].post.responses[200].content['application/json'].schema.properties.detail = {
    type: 'string',
  };
  current.paths['/widgets'].post.responses[201] = { description: 'Alternative success' };

  assert.deepEqual(findOpenAPIBreakingChanges(baseline, current), []);
});

test('OpenAPI compatibility rejects removed operations and changed operation IDs', () => {
  const baseline = document();
  const removed = structuredClone(baseline);
  delete removed.paths['/widgets'].post;
  assert.deepEqual(findOpenAPIBreakingChanges(baseline, removed), ['POST /widgets operation was removed']);

  const renamed = structuredClone(baseline);
  renamed.paths['/widgets'].post.operationId = 'replaceWidget';
  assert.match(findOpenAPIBreakingChanges(baseline, renamed).join('\n'), /operationId changed/);
});

test('OpenAPI compatibility rejects tightened request contracts', () => {
  const baseline = document();
  const current = structuredClone(baseline);
  const operation = current.paths['/widgets'].post;
  operation.parameters[0].required = true;
  operation.parameters[0].schema.enum = ['en'];
  operation.parameters.push({ name: 'tenant', in: 'header', required: true, schema: { type: 'string' } });
  const requestSchema = operation.requestBody.content['application/json'].schema;
  requestSchema.required.push('mode');
  requestSchema.properties.name.minLength = 3;

  const issues = findOpenAPIBreakingChanges(baseline, current).join('\n');
  assert.match(issues, /parameter query:locale became required/);
  assert.match(issues, /enum compatibility narrowed/);
  assert.match(issues, /added required parameter header:tenant/);
  assert.match(issues, /mode became incompatible/);
  assert.match(issues, /minLength changed from 1 to 3/);
});

test('OpenAPI compatibility rejects response variants outside the old client contract', () => {
  const baseline = document();
  baseline.paths['/widgets'].post.responses[200].headers = {
    'X-Request-ID': { schema: { type: 'string' } },
  };
  const current = structuredClone(baseline);
  const responseSchema = current.paths['/widgets'].post.responses[200].content['application/json'].schema;
  responseSchema.required = ['id'];
  delete responseSchema.properties.id;
  responseSchema.properties.state.enum.push('queued');
  delete current.paths['/widgets'].post.responses[200].headers['X-Request-ID'];

  const issues = findOpenAPIBreakingChanges(baseline, current).join('\n');
  assert.match(issues, /state became incompatible/);
  assert.match(issues, /id property was removed/);
  assert.match(issues, /response enum compatibility narrowed/);
  assert.match(issues, /removed header X-Request-ID/);
});

test('OpenAPI compatibility detects constraints added to requests or removed from responses', () => {
  const baseline = document();
  const current = structuredClone(baseline);
  current.paths['/widgets'].post.requestBody.content['application/json'].schema.properties.mode.pattern = '^[a-z]+$';
  delete current.paths['/widgets'].post.responses[200].content['application/json'].schema.properties.state.enum;

  const issues = findOpenAPIBreakingChanges(baseline, current).join('\n');
  assert.match(issues, /pattern changed/);
  assert.match(issues, /response enum compatibility narrowed/);
});

test('OpenAPI compatibility rejects newly required authentication', () => {
  const baseline = document();
  const current = structuredClone(baseline);
  current.paths['/widgets'].post.security = [{ bearerAuth: [] }];

  assert.match(findOpenAPIBreakingChanges(baseline, current).join('\n'), /security requirements were tightened/);
});
