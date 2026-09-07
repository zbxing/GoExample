import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOpenAPIDocument,
  readProjectManifest,
  resolveProjectDocument,
  selectProject,
} from './lib/project-contracts.mjs';
import {
  formatGoFileWithCandidatesSync,
  formatGeneratedGoSDKSourceSync,
  publishGeneratedGoSDKSync,
} from './lib/sdk-generation.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const args = process.argv.slice(2);
const task = args[0] ?? 'check';
let projectSelector = process.env.GO_PROJECT?.trim() || 'Example';
let fetchRemoteContract = false;

for (let index = 1; index < args.length; index += 1) {
  const argument = args[index];
  const [name, inlineValue] = argument.split('=', 2);
  if (name === '--fetch-contract') {
    if (inlineValue !== undefined) {
      console.error('--fetch-contract does not accept a value');
      process.exit(1);
    }
    fetchRemoteContract = true;
    continue;
  }
  if (name !== '--project') {
    console.error(`Unknown argument ${argument}`);
    process.exit(1);
  }
  const value = inlineValue ?? args[++index];
  if (!value || value.startsWith('--')) {
    console.error('--project requires a value');
    process.exit(1);
  }
  projectSelector = value;
}

if (!['check', 'generate'].includes(task)) {
  console.error('Usage: node scripts/go-sdk.mjs <check|generate> [--project <name>] [--fetch-contract]');
  process.exit(1);
}

let manifest;
let project;
let sourceDocument;
try {
  manifest = readProjectManifest(repositoryRoot);
  project = selectProject(manifest, projectSelector);
  sourceDocument = resolveProjectDocument(repositoryRoot, project, {
    fetchRemote: fetchRemoteContract,
  });
} catch (error) {
  console.error(`Go SDK: ${error.message}`);
  process.exit(1);
}

const sourcePath = sourceDocument.path;
const sdkRoot = path.join(repositoryRoot, project.sdk.path);
const targetPath = path.join(sdkRoot, 'client.gen.go');
const versionPath = path.join(sdkRoot, 'VERSION');
const stagingRoot = path.join(repositoryRoot, '.temp', 'sdk-generation');

function fail(message) {
  throw new Error(message);
}

function goName(value) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    fail(`Cannot derive a Go identifier from ${JSON.stringify(value)}`);
  }
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return /^[0-9]/.test(name) ? `Value${name}` : name;
}

function referenceName(reference) {
  const prefix = '#/components/schemas/';
  if (typeof reference !== 'string' || !reference.startsWith(prefix)) {
    fail(`Only local component schema references are supported: ${JSON.stringify(reference)}`);
  }
  return goName(reference.slice(prefix.length));
}

function goType(schema = {}) {
  if (schema.$ref) {
    return referenceName(schema.$ref);
  }
  if (Array.isArray(schema.type)) {
    const nonNullTypes = schema.type.filter((type) => type !== 'null');
    if (nonNullTypes.length !== 1) {
      fail(`Unsupported schema type union: ${JSON.stringify(schema.type)}`);
    }
    return goType({ ...schema, type: nonNullTypes[0] });
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
      return 'int';
    case 'number':
      return 'float64';
    case 'boolean':
      return 'bool';
    case 'array':
      return `[]${goType(schema.items)}`;
    case 'object':
      return 'map[string]any';
    case 'null':
    case undefined:
      return 'json.RawMessage';
    default:
      fail(`Unsupported OpenAPI schema type: ${JSON.stringify(schema.type)}`);
  }
}

function parameterField(parameter) {
  return {
    fieldName: goName(parameter.name),
    jsonName: parameter.name,
    location: parameter.in,
    required: parameter.required === true,
    type: goType(parameter.schema),
  };
}

function resolveParameter(document, parameter) {
  if (!parameter?.$ref) {
    return parameter;
  }
  const prefix = '#/components/parameters/';
  if (!parameter.$ref.startsWith(prefix)) {
    fail(`Only local component parameter references are supported: ${parameter.$ref}`);
  }
  const name = parameter.$ref.slice(prefix.length);
  const resolved = document.components?.parameters?.[name];
  if (!resolved) {
    fail(`Parameter reference does not exist: ${parameter.$ref}`);
  }
  return resolved;
}

function requestBodyType(operation) {
  const requestBody = operation.requestBody;
  if (!requestBody) {
    return null;
  }
  const schema = requestBody.content?.['application/json']?.schema;
  if (!schema) {
    fail(`Operation ${operation.operationId} has a non-JSON or schema-less request body`);
  }
  if (requestBody.required !== true) {
    fail(`Optional request bodies are not supported for ${operation.operationId}`);
  }
  return goType(schema);
}

function collectOperations(document) {
  const operations = [];
  const seen = new Set();
  const supportedMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!supportedMethods.has(method)) {
        continue;
      }
      if (!operation.operationId || !/^[A-Za-z][A-Za-z0-9]*$/.test(operation.operationId)) {
        fail(`${method.toUpperCase()} ${routePath} must declare a Go-safe operationId`);
      }
      if (seen.has(operation.operationId)) {
        fail(`Duplicate operationId: ${operation.operationId}`);
      }
      seen.add(operation.operationId);
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
        .map((parameter) => resolveParameter(document, parameter))
        .map(parameterField);
      const placeholders = [...routePath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      const pathParameters = parameters
        .filter((parameter) => parameter.location === 'path')
        .map((parameter) => parameter.jsonName);
      if (
        placeholders.length !== pathParameters.length ||
        placeholders.some((name) => !pathParameters.includes(name))
      ) {
        fail(`${operation.operationId} path placeholders and parameters do not match`);
      }
      for (const parameter of parameters) {
        if (!['path', 'query', 'header'].includes(parameter.location)) {
          fail(`${operation.operationId} uses unsupported parameter location ${parameter.location}`);
        }
        if (parameter.location === 'path' && !parameter.required) {
          fail(`${operation.operationId} path parameter ${parameter.jsonName} must be required`);
        }
      }
      operations.push({
        operationId: operation.operationId,
        name: goName(operation.operationId),
        method: method.toUpperCase(),
        routePath,
        deprecated: operation.deprecated === true,
        parameters,
        bodyType: requestBodyType(operation),
      });
    }
  }
  if (operations.length === 0) {
    fail('OpenAPI document contains no supported operations');
  }
  return operations;
}

function generateModels(document) {
  const chunks = [];
  for (const [schemaName, schema] of Object.entries(document.components?.schemas ?? {})) {
    if (schema.type !== 'object') {
      fail(`Component schema ${schemaName} must be an object`);
    }
    if (!schema.properties) {
      if (schema.additionalProperties === true) {
        chunks.push(`type ${goName(schemaName)} = map[string]any`);
        continue;
      }
      fail(`Component schema ${schemaName} must define properties or additionalProperties: true`);
    }
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(([propertyName, propertySchema]) => {
      const type = goType(propertySchema);
      const optional = !required.has(propertyName) && !type.startsWith('[]') && type !== 'json.RawMessage';
      return `\t${goName(propertyName)} ${optional ? '*' : ''}${type} \`json:"${propertyName}${optional ? ',omitempty' : ''}"\``;
    });
    chunks.push(`type ${goName(schemaName)} struct {\n${fields.join('\n')}\n}`);
  }
  return chunks.join('\n\n');
}

function goValue(parameter, expression) {
  switch (parameter.type) {
    case 'string':
      return expression;
    case 'int':
      return `strconv.Itoa(${expression})`;
    case 'float64':
      return `strconv.FormatFloat(${expression}, 'g', -1, 64)`;
    case 'bool':
      return `strconv.FormatBool(${expression})`;
    default:
      fail(
        `Parameter ${parameter.jsonName} uses unsupported generated client type ${parameter.type}`,
      );
  }
}

function generateOperation(operation) {
  const chunks = [];
  if (operation.parameters.length > 0) {
    const fields = operation.parameters.map((parameter) => {
      const optional = parameter.required ? '' : '*';
      return `\t${parameter.fieldName} ${optional}${parameter.type}`;
    });
    chunks.push(`type ${operation.name}Params struct {\n${fields.join('\n')}\n}`);
  }

  const argumentsList = ['ctx context.Context'];
  if (operation.parameters.length > 0) {
    argumentsList.push(`params ${operation.name}Params`);
  }
  if (operation.bodyType) {
    argumentsList.push(`body ${operation.bodyType}`);
  }
  argumentsList.push('editors ...RequestEditorFn');

  const lines = [];
  lines.push(`routePath := ${JSON.stringify(operation.routePath)}`);
  for (const parameter of operation.parameters.filter(({ location }) => location === 'path')) {
    lines.push(
      `routePath = strings.ReplaceAll(routePath, ${JSON.stringify(`{${parameter.jsonName}}`)}, url.PathEscape(params.${parameter.fieldName}))`,
    );
  }
  lines.push('query := make(url.Values)');
  for (const parameter of operation.parameters.filter(({ location }) => location === 'query')) {
    if (parameter.required) {
      lines.push(
        `query.Set(${JSON.stringify(parameter.jsonName)}, ${goValue(parameter, `params.${parameter.fieldName}`)})`,
      );
    } else {
      lines.push(`if params.${parameter.fieldName} != nil {`);
      lines.push(
        `\tquery.Set(${JSON.stringify(parameter.jsonName)}, ${goValue(parameter, `*params.${parameter.fieldName}`)})`,
      );
      lines.push('}');
    }
  }
  const headerParameters = operation.parameters.filter(({ location }) => location === 'header');
  if (headerParameters.length > 0) {
    lines.push('operationEditor := func(_ context.Context, request *http.Request) error {');
    for (const parameter of headerParameters) {
      if (parameter.required) {
        lines.push(
          `\trequest.Header.Set(${JSON.stringify(parameter.jsonName)}, ${goValue(parameter, `params.${parameter.fieldName}`)})`,
        );
      } else {
        lines.push(`\tif params.${parameter.fieldName} != nil {`);
        lines.push(
          `\t\trequest.Header.Set(${JSON.stringify(parameter.jsonName)}, ${goValue(parameter, `*params.${parameter.fieldName}`)})`,
        );
        lines.push('\t}');
      }
    }
    lines.push('\treturn nil');
    lines.push('}');
    lines.push('editors = append([]RequestEditorFn{operationEditor}, editors...)');
  }
  lines.push(
    `return c.do(ctx, http.Method${goName(operation.method.toLowerCase())}, routePath, query, ${operation.bodyType ? 'body' : 'nil'}, editors)`,
  );

  const deprecated = operation.deprecated
    ? `// Deprecated: ${operation.method} ${operation.routePath} is retained only for the published migration window.\n`
    : '';
  chunks.push(
    `${deprecated}func (c *Client) ${operation.name}(${argumentsList.join(', ')}) (*Response, error) {\n${lines.map((line) => `\t${line}`).join('\n')}\n}`,
  );
  return chunks.join('\n\n');
}

function generateSource(document, sourceHash, sourceLabel, packageName) {
  if (document.openapi !== '3.1.0') {
    fail(`Expected OpenAPI 3.1.0, received ${JSON.stringify(document.openapi)}`);
  }
  const version = document.info?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    fail('OpenAPI info.version must be an exact semantic version');
  }
  const operations = collectOperations(document);
  const usesStrconv = operations.some((operation) =>
    operation.parameters.some((parameter) => parameter.type === 'int' || parameter.type === 'float64' || parameter.type === 'bool'),
  );
  const operationMetadata = operations
    .map(
      (operation) =>
        `\t{OperationID: ${JSON.stringify(operation.operationId)}, Method: ${JSON.stringify(operation.method)}, Path: ${JSON.stringify(operation.routePath)}, Deprecated: ${operation.deprecated}},`,
    )
    .join('\n');
  const generatedOperations = operations.map(generateOperation).join('\n\n');

  return `// Code generated by scripts/go-sdk.mjs; DO NOT EDIT.
// Source: ${sourceLabel}
// Source SHA-256: ${sourceHash}

package ${packageName}

import (
\t"bytes"
\t"context"
\t"encoding/json"
\t"errors"
\t"fmt"
\t"io"
\t"net/http"
\t"net/url"
${usesStrconv ? '\t"strconv"\n' : ''}\t"strings"
)

const APIVersion = ${JSON.stringify(version)}
const DefaultMaxResponseBytes int64 = 1 << 20

var ErrResponseTooLarge = errors.New("goexample SDK response exceeds configured size limit")

type HTTPClient interface {
\tDo(*http.Request) (*http.Response, error)
}

type RequestEditorFn func(context.Context, *http.Request) error
type ClientOption func(*Client) error

type Client struct {
\tbaseURL          *url.URL
\thttpClient       HTTPClient
\tmaxResponseBytes int64
\trequestEditors   []RequestEditorFn
}

type Operation struct {
\tOperationID string
\tMethod     string
\tPath       string
\tDeprecated bool
}

var publishedOperations = [...]Operation{
${operationMetadata}
}

type Response struct {
\tStatusCode   int
\tHeader       http.Header
\tBody         []byte
\tHTTPResponse *http.Response
}

func PublishedOperations() []Operation {
\treturn append([]Operation(nil), publishedOperations[:]...)
}

${generateModels(document)}

func WithHTTPClient(httpClient HTTPClient) ClientOption {
\treturn func(client *Client) error {
\t\tif httpClient == nil {
\t\t\treturn errors.New("goexample SDK HTTP client cannot be nil")
\t\t}
\t\tclient.httpClient = httpClient
\t\treturn nil
\t}
}

func WithMaxResponseBytes(maxResponseBytes int64) ClientOption {
\treturn func(client *Client) error {
\t\tif maxResponseBytes <= 0 || maxResponseBytes > 64<<20 {
\t\t\treturn errors.New("goexample SDK response size limit must be between 1 byte and 64 MiB")
\t\t}
\t\tclient.maxResponseBytes = maxResponseBytes
\t\treturn nil
\t}
}

func WithRequestEditor(editor RequestEditorFn) ClientOption {
\treturn func(client *Client) error {
\t\tif editor == nil {
\t\t\treturn errors.New("goexample SDK request editor cannot be nil")
\t\t}
\t\tclient.requestEditors = append(client.requestEditors, editor)
\t\treturn nil
\t}
}

func NewClient(server string, options ...ClientOption) (*Client, error) {
\tserver = strings.TrimSpace(server)
\tbaseURL, err := url.Parse(server)
\tif err != nil || baseURL.Host == "" || (baseURL.Scheme != "http" && baseURL.Scheme != "https") {
\t\treturn nil, errors.New("goexample SDK server must be an absolute HTTP(S) URL")
\t}
\tif baseURL.User != nil || baseURL.RawQuery != "" || baseURL.Fragment != "" {
\t\treturn nil, errors.New("goexample SDK server cannot contain credentials, query, or fragment")
\t}
\tbaseURL.Path = strings.TrimRight(baseURL.Path, "/")
\tclient := &Client{
\t\tbaseURL:          baseURL,
\t\thttpClient:       http.DefaultClient,
\t\tmaxResponseBytes: DefaultMaxResponseBytes,
\t}
\tfor _, option := range options {
\t\tif option == nil {
\t\t\treturn nil, errors.New("goexample SDK client option cannot be nil")
\t\t}
\t\tif err := option(client); err != nil {
\t\t\treturn nil, err
\t\t}
\t}
\treturn client, nil
}

func (response *Response) DecodeJSON(target any) error {
\tif response == nil {
\t\treturn errors.New("goexample SDK response cannot be nil")
\t}
\tif target == nil {
\t\treturn errors.New("goexample SDK JSON target cannot be nil")
\t}
\tif err := json.Unmarshal(response.Body, target); err != nil {
\t\treturn fmt.Errorf("decode goexample SDK response: %w", err)
\t}
\treturn nil
}

func (response *Response) DecodeEnvelope() (Envelope, error) {
\tvar envelope Envelope
\terr := response.DecodeJSON(&envelope)
\treturn envelope, err
}

func (c *Client) do(ctx context.Context, method, routePath string, query url.Values, body any, editors []RequestEditorFn) (*Response, error) {
\tif ctx == nil {
\t\treturn nil, errors.New("goexample SDK request context cannot be nil")
\t}
\tendpoint := *c.baseURL
\tescapedPath := c.baseURL.EscapedPath() + routePath
\tdecodedPath, err := url.PathUnescape(escapedPath)
\tif err != nil {
\t\treturn nil, fmt.Errorf("build goexample SDK request path: %w", err)
\t}
\tendpoint.Path = decodedPath
\tendpoint.RawPath = escapedPath
\tendpoint.RawQuery = query.Encode()
\tvar requestBody io.Reader = http.NoBody
\tif body != nil {
\t\tencodedBody, err := json.Marshal(body)
\t\tif err != nil {
\t\t\treturn nil, fmt.Errorf("encode goexample SDK request: %w", err)
\t\t}
\t\trequestBody = bytes.NewReader(encodedBody)
\t}
\trequest, err := http.NewRequestWithContext(ctx, method, endpoint.String(), requestBody)
\tif err != nil {
\t\treturn nil, fmt.Errorf("create goexample SDK request: %w", err)
\t}
\trequest.Header.Set("Accept", "application/json")
\tif body != nil {
\t\trequest.Header.Set("Content-Type", "application/json")
\t}
\tfor _, editor := range append(append([]RequestEditorFn{}, c.requestEditors...), editors...) {
\t\tif editor == nil {
\t\t\treturn nil, errors.New("goexample SDK request editor cannot be nil")
\t\t}
\t\tif err := editor(ctx, request); err != nil {
\t\t\treturn nil, fmt.Errorf("edit goexample SDK request: %w", err)
\t\t}
\t}
\thttpResponse, err := c.httpClient.Do(request)
\tif err != nil {
\t\treturn nil, fmt.Errorf("execute goexample SDK request: %w", err)
\t}
\tdefer httpResponse.Body.Close()
\tresponseBody, err := io.ReadAll(io.LimitReader(httpResponse.Body, c.maxResponseBytes+1))
\tif err != nil {
\t\treturn nil, fmt.Errorf("read goexample SDK response: %w", err)
\t}
\tif int64(len(responseBody)) > c.maxResponseBytes {
\t\treturn nil, ErrResponseTooLarge
\t}
\thttpResponse.Body = io.NopCloser(bytes.NewReader(responseBody))
\treturn &Response{
\t\tStatusCode:   httpResponse.StatusCode,
\t\tHeader:       httpResponse.Header.Clone(),
\t\tBody:         responseBody,
\t\tHTTPResponse: httpResponse,
\t}, nil
}

${generatedOperations}
`;
}

function gofmt(filePath) {
  const executableName = process.platform === 'win32' ? 'gofmt.exe' : 'gofmt';
  const workspace = readFileSync(path.join(repositoryRoot, 'go.work'), 'utf8');
  const versionMatch = workspace.match(/^toolchain\s+go(\d+\.\d+\.\d+)$/m);
  const candidates = [
    process.env.GOFMT_BINARY?.trim(),
    versionMatch
      ? path.join(
          repositoryRoot,
          '.temp',
          'toolchain',
          `go${versionMatch[1]}`,
          'go',
          'bin',
          executableName,
        )
      : null,
    path.join(repositoryRoot, '.temp', 'toolchain', 'go', 'bin', executableName),
    executableName,
  ].filter(Boolean);
  formatGoFileWithCandidatesSync(filePath, {
    candidates,
    cwd: repositoryRoot,
  });
}

const source = sourceDocument.content;
const document = assertOpenAPIDocument(source, sourcePath);
const sourceHash = createHash('sha256').update(source).digest('hex');
const generated = generateSource(document, sourceHash, sourceDocument.source, project.sdk.package);
const formatted = formatGeneratedGoSDKSourceSync(generated, {
  stagingRoot,
  formatFile: gofmt,
});

if (task === 'generate') {
  publishGeneratedGoSDKSync({
    clientPath: targetPath,
    versionPath,
    formattedSource: formatted,
    version: document.info.version,
  });
  console.log(`Generated ${path.relative(repositoryRoot, targetPath)} from ${sourceDocument.source} (${collectOperations(document).length} operations)`);
} else {
  if (!existsSync(targetPath)) {
    fail(`Generated SDK for ${project.name} is missing; run yarn sdk:generate --project ${project.name}`);
  }
  const expected = readFileSync(targetPath, 'utf8');
  if (formatted !== expected) {
        fail(`Generated Go SDK is stale for ${project.name}; run yarn sdk:generate --project ${project.name} and commit the result`);
  }
  const sdkVersion = readFileSync(versionPath, 'utf8').trim();
  if (sdkVersion !== document.info.version) {
    fail(`SDK version ${sdkVersion} does not match ${project.name} OpenAPI version ${document.info.version}`);
  }
  console.log(`Go SDK matches OpenAPI ${sdkVersion} (${collectOperations(document).length} operations)`);
}
