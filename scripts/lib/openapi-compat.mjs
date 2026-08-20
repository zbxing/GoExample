const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function resolveLocalReference(document, value, location) {
  let resolved = value;
  const visited = new Set();
  while (isObject(resolved) && typeof resolved.$ref === 'string') {
    const reference = resolved.$ref;
    if (!reference.startsWith('#/')) {
      throw new Error(`${location} uses unsupported external reference ${reference}`);
    }
    if (visited.has(reference)) {
      throw new Error(`${location} contains a reference cycle at ${reference}`);
    }
    visited.add(reference);
    resolved = reference.slice(2).split('/').reduce((current, segment) => {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      return isObject(current) || Array.isArray(current) ? current[key] : undefined;
    }, document);
    if (resolved === undefined) {
      throw new Error(`${location} cannot resolve ${reference}`);
    }
  }
  return resolved;
}

function validateDocument(document, name) {
  if (!isObject(document) || typeof document.openapi !== 'string' || !document.openapi.startsWith('3.')) {
    throw new Error(`${name} must be an OpenAPI 3.x JSON document`);
  }
  if (!isObject(document.paths)) {
    throw new Error(`${name} must define a paths object`);
  }
}

function operationMap(document) {
  const operations = new Map();
  for (const [path, pathItemValue] of Object.entries(document.paths)) {
    const pathItem = resolveLocalReference(document, pathItemValue, `paths.${path}`);
    if (!isObject(pathItem)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !isObject(operation)) {
        continue;
      }
      const key = `${method.toUpperCase()} ${path}`;
      operations.set(key, { key, operation, pathItem });
    }
  }
  return operations;
}

function effectiveSecurity(document, operation) {
  if (Array.isArray(operation.security)) {
    return operation.security;
  }
  return Array.isArray(document.security) ? document.security : [];
}

function securityAlternativeAllows(baselineRequirement, currentRequirement) {
  if (!isObject(currentRequirement) || !isObject(baselineRequirement)) {
    return false;
  }
  return Object.entries(currentRequirement).every(([scheme, scopes]) => {
    const baselineScopes = baselineRequirement[scheme];
    return Array.isArray(scopes)
      && Array.isArray(baselineScopes)
      && scopes.every((scope) => baselineScopes.includes(scope));
  });
}

function securityWasTightened(baselineSecurity, currentSecurity) {
  if (currentSecurity.length === 0) {
    return false;
  }
  if (baselineSecurity.length === 0) {
    return true;
  }
  return baselineSecurity.some((baselineRequirement) => (
    !currentSecurity.some((currentRequirement) => (
      securityAlternativeAllows(baselineRequirement, currentRequirement)
    ))
  ));
}

function collectParameters(document, pathItem, operation, location) {
  const parameters = new Map();
  for (const candidate of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const parameter = resolveLocalReference(document, candidate, `${location} parameter`);
    if (!isObject(parameter) || typeof parameter.name !== 'string' || typeof parameter.in !== 'string') {
      throw new Error(`${location} contains a parameter without name/in`);
    }
    parameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return parameters;
}

function schemaTypes(schema) {
  if (typeof schema.type === 'string') {
    return new Set([schema.type]);
  }
  if (Array.isArray(schema.type)) {
    return new Set(schema.type);
  }
  if (isObject(schema.properties)) {
    return new Set(['object']);
  }
  if (schema.items !== undefined) {
    return new Set(['array']);
  }
  return new Set();
}

function setContains(container, values) {
  return [...values].every((value) => container.has(value));
}

function compareNumericConstraint(issues, baseline, current, name, direction, location) {
  const baselineValue = baseline[name];
  const currentValue = current[name];
  const minimum = name.startsWith('min') || name === 'minimum' || name === 'exclusiveMinimum';
  const defaultValue = minimum
    ? (name === 'minLength' || name === 'minItems' ? 0 : Number.NEGATIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const effectiveBaseline = typeof baselineValue === 'number' ? baselineValue : defaultValue;
  const effectiveCurrent = typeof currentValue === 'number' ? currentValue : defaultValue;
  const narrowedRequest = direction === 'request'
    && (minimum ? effectiveCurrent > effectiveBaseline : effectiveCurrent < effectiveBaseline);
  const widenedResponse = direction === 'response'
    && (minimum ? effectiveCurrent < effectiveBaseline : effectiveCurrent > effectiveBaseline);
  if (narrowedRequest || widenedResponse) {
    issues.push(`${location} ${name} changed from ${baselineValue ?? 'unbounded'} to ${currentValue ?? 'unbounded'}`);
  }
}

function compareSchema(issues, baselineDocument, currentDocument, baselineValue, currentValue, direction, location, seen) {
  const baseline = resolveLocalReference(baselineDocument, baselineValue, `${location} baseline schema`);
  const current = resolveLocalReference(currentDocument, currentValue, `${location} current schema`);
  if (!isObject(baseline) || !isObject(current)) {
    if (canonical(baseline) !== canonical(current)) {
      issues.push(`${location} schema changed`);
    }
    return;
  }

  let currentMatches = seen.get(baseline);
  if (!currentMatches) {
    currentMatches = new WeakSet();
    seen.set(baseline, currentMatches);
  } else if (currentMatches.has(current)) {
    return;
  }
  currentMatches.add(current);

  const baselineTypes = schemaTypes(baseline);
  const currentTypes = schemaTypes(current);
  const typesCompatible = direction === 'request'
    ? setContains(currentTypes, baselineTypes)
    : setContains(baselineTypes, currentTypes);
  if (baselineTypes.size > 0 && currentTypes.size > 0 && !typesCompatible) {
    issues.push(`${location} ${direction} types changed from ${[...baselineTypes]} to ${[...currentTypes]}`);
  }

  const baselineEnum = Array.isArray(baseline.enum) ? baseline.enum : null;
  const currentEnum = Array.isArray(current.enum) ? current.enum : null;
  const requestEnumNarrowed = direction === 'request'
    && currentEnum !== null
    && (baselineEnum === null || baselineEnum.some((value) => (
      !currentEnum.some((candidate) => canonical(candidate) === canonical(value))
    )));
  const responseEnumWidened = direction === 'response'
    && baselineEnum !== null
    && (currentEnum === null || currentEnum.some((value) => (
      !baselineEnum.some((candidate) => canonical(candidate) === canonical(value))
    )));
  if (requestEnumNarrowed || responseEnumWidened) {
    issues.push(`${location} ${direction} enum compatibility narrowed`);
  }

  if (baseline.format !== current.format && (baseline.format !== undefined || current.format !== undefined)) {
    issues.push(`${location} format changed from ${baseline.format ?? 'unspecified'} to ${current.format ?? 'unspecified'}`);
  }
  if (baseline.pattern !== current.pattern && (baseline.pattern !== undefined || current.pattern !== undefined)) {
    issues.push(`${location} pattern changed`);
  }
  for (const name of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    compareNumericConstraint(issues, baseline, current, name, direction, location);
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'not']) {
    if (baseline[keyword] !== undefined || current[keyword] !== undefined) {
      if (canonical(baseline[keyword]) !== canonical(current[keyword])) {
        issues.push(`${location} ${keyword} changed and requires explicit versioning review`);
      }
    }
  }

  const baselineRequired = new Set(Array.isArray(baseline.required) ? baseline.required : []);
  const currentRequired = new Set(Array.isArray(current.required) ? current.required : []);
  const incompatibleRequired = direction === 'request'
    ? [...currentRequired].filter((name) => !baselineRequired.has(name))
    : [...baselineRequired].filter((name) => !currentRequired.has(name));
  for (const name of incompatibleRequired) {
    issues.push(`${location}.${name} became incompatible with the ${direction} required-property contract`);
  }

  const baselineProperties = isObject(baseline.properties) ? baseline.properties : {};
  const currentProperties = isObject(current.properties) ? current.properties : {};
  for (const [name, baselineProperty] of Object.entries(baselineProperties)) {
    if (!(name in currentProperties)) {
      issues.push(`${location}.${name} property was removed from the ${direction} schema`);
      continue;
    }
    compareSchema(
      issues,
      baselineDocument,
      currentDocument,
      baselineProperty,
      currentProperties[name],
      direction,
      `${location}.${name}`,
      seen,
    );
  }

  if (direction === 'request' && baseline.additionalProperties !== false && current.additionalProperties === false) {
    issues.push(`${location} no longer accepts additional request properties`);
  }
  if (direction === 'response' && baseline.additionalProperties === false && current.additionalProperties !== false) {
    issues.push(`${location} may now emit additional response properties`);
  }
  if (direction === 'request' && baseline.items === undefined && current.items !== undefined) {
    issues.push(`${location} added a restrictive request item schema`);
  }
  if (baseline.items !== undefined && current.items === undefined) {
    if (direction === 'response') {
      issues.push(`${location} removed its response item schema`);
    }
  } else if (baseline.items !== undefined && current.items !== undefined) {
    compareSchema(issues, baselineDocument, currentDocument, baseline.items, current.items, direction, `${location}[]`, seen);
  }
}

function compareContent(issues, baselineDocument, currentDocument, baselineContent, currentContent, direction, location) {
  const baselineMedia = isObject(baselineContent) ? baselineContent : {};
  const currentMedia = isObject(currentContent) ? currentContent : {};
  for (const [mediaType, baselineDefinition] of Object.entries(baselineMedia)) {
    const currentDefinition = currentMedia[mediaType];
    if (!isObject(currentDefinition)) {
      issues.push(`${location} removed media type ${mediaType}`);
      continue;
    }
    if (isObject(baselineDefinition) && baselineDefinition.schema !== undefined) {
      if (currentDefinition.schema === undefined) {
        issues.push(`${location} removed the ${mediaType} schema`);
      } else {
        compareSchema(
          issues,
          baselineDocument,
          currentDocument,
          baselineDefinition.schema,
          currentDefinition.schema,
          direction,
          `${location} ${mediaType}`,
          new WeakMap(),
        );
      }
    }
  }
}

function compareRequestBody(issues, baselineDocument, currentDocument, baselineOperation, currentOperation, location) {
  const baselineValue = baselineOperation.requestBody;
  const currentValue = currentOperation.requestBody;
  if (baselineValue === undefined) {
    if (currentValue !== undefined) {
      const current = resolveLocalReference(currentDocument, currentValue, `${location} requestBody`);
      if (current.required === true) {
        issues.push(`${location} added a required request body`);
      }
    }
    return;
  }
  if (currentValue === undefined) {
    issues.push(`${location} removed its documented request body`);
    return;
  }
  const baseline = resolveLocalReference(baselineDocument, baselineValue, `${location} baseline requestBody`);
  const current = resolveLocalReference(currentDocument, currentValue, `${location} current requestBody`);
  if (baseline.required !== true && current.required === true) {
    issues.push(`${location} request body became required`);
  }
  compareContent(issues, baselineDocument, currentDocument, baseline.content, current.content, 'request', `${location} requestBody`);
}

function compareResponses(issues, baselineDocument, currentDocument, baselineOperation, currentOperation, location) {
  const baselineResponses = isObject(baselineOperation.responses) ? baselineOperation.responses : {};
  const currentResponses = isObject(currentOperation.responses) ? currentOperation.responses : {};
  for (const [status, baselineValue] of Object.entries(baselineResponses)) {
    if (!(status in currentResponses)) {
      issues.push(`${location} removed response ${status}`);
      continue;
    }
    const baseline = resolveLocalReference(baselineDocument, baselineValue, `${location} response ${status}`);
    const current = resolveLocalReference(currentDocument, currentResponses[status], `${location} response ${status}`);
    const baselineHeaders = isObject(baseline.headers) ? baseline.headers : {};
    const currentHeaders = isObject(current.headers) ? current.headers : {};
    for (const [name, baselineHeaderValue] of Object.entries(baselineHeaders)) {
      if (!(name in currentHeaders)) {
        issues.push(`${location} response ${status} removed header ${name}`);
        continue;
      }
      const baselineHeader = resolveLocalReference(baselineDocument, baselineHeaderValue, `${location} response ${status} header ${name}`);
      const currentHeader = resolveLocalReference(currentDocument, currentHeaders[name], `${location} response ${status} header ${name}`);
      if (baselineHeader.schema !== undefined && currentHeader.schema !== undefined) {
        compareSchema(
          issues,
          baselineDocument,
          currentDocument,
          baselineHeader.schema,
          currentHeader.schema,
          'response',
          `${location} response ${status} header ${name}`,
          new WeakMap(),
        );
      }
    }
    compareContent(issues, baselineDocument, currentDocument, baseline.content, current.content, 'response', `${location} response ${status}`);
  }
}

export function findOpenAPIBreakingChanges(baselineDocument, currentDocument) {
  validateDocument(baselineDocument, 'baseline');
  validateDocument(currentDocument, 'current');
  const issues = [];
  const baselineOperations = operationMap(baselineDocument);
  const currentOperations = operationMap(currentDocument);

  for (const [key, baselineEntry] of baselineOperations) {
    const currentEntry = currentOperations.get(key);
    if (!currentEntry) {
      issues.push(`${key} operation was removed`);
      continue;
    }
    const baselineOperation = baselineEntry.operation;
    const currentOperation = currentEntry.operation;
    if (baselineOperation.operationId !== currentOperation.operationId) {
      issues.push(`${key} operationId changed from ${baselineOperation.operationId} to ${currentOperation.operationId}`);
    }
    if (securityWasTightened(
      effectiveSecurity(baselineDocument, baselineOperation),
      effectiveSecurity(currentDocument, currentOperation),
    )) {
      issues.push(`${key} security requirements were tightened`);
    }

    const baselineParameters = collectParameters(baselineDocument, baselineEntry.pathItem, baselineOperation, key);
    const currentParameters = collectParameters(currentDocument, currentEntry.pathItem, currentOperation, key);
    for (const [parameterKey, baselineParameter] of baselineParameters) {
      const currentParameter = currentParameters.get(parameterKey);
      if (!currentParameter) {
        issues.push(`${key} removed parameter ${parameterKey}`);
        continue;
      }
      if (baselineParameter.required !== true && currentParameter.required === true) {
        issues.push(`${key} parameter ${parameterKey} became required`);
      }
      if (baselineParameter.schema !== undefined && currentParameter.schema !== undefined) {
        compareSchema(
          issues,
          baselineDocument,
          currentDocument,
          baselineParameter.schema,
          currentParameter.schema,
          'request',
          `${key} parameter ${parameterKey}`,
          new WeakMap(),
        );
      }
    }
    for (const [parameterKey, currentParameter] of currentParameters) {
      if (!baselineParameters.has(parameterKey) && currentParameter.required === true) {
        issues.push(`${key} added required parameter ${parameterKey}`);
      }
    }

    compareRequestBody(issues, baselineDocument, currentDocument, baselineOperation, currentOperation, key);
    compareResponses(issues, baselineDocument, currentDocument, baselineOperation, currentOperation, key);
  }

  return [...new Set(issues)].sort();
}
