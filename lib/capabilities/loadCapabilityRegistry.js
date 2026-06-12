import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = path.join(process.cwd(), 'capabilities', 'capability-registry.json');

export const CAPABILITY_STATUSES = Object.freeze([
  'available',
  'available_when_configured',
  'configuration_pending',
  'staged',
  'disabled',
  'degraded',
  'unknown',
]);

const ENTITY_TYPES = new Set(['capability', 'external_workspace']);
const STATUS_SET = new Set(CAPABILITY_STATUSES);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORBIDDEN_RUNTIME_FIELDS = [
  'adapterId',
  'agentId',
  'command',
  'executionMode',
  'liveConnected',
  'systemId',
  'systemType',
];

let cache = null;

function fail(message) {
  throw new Error(`Invalid capability registry: ${message}`);
}

function assertNonEmptyString(value, field, id) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`record "${id}" must define a non-empty ${field}`);
  }
}

function validateRecord(record, index, ids) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail(`record at index ${index} must be an object`);
  }

  assertNonEmptyString(record.id, 'id', `index ${index}`);
  if (!ID_PATTERN.test(record.id)) fail(`record "${record.id}" has an invalid id`);
  if (ids.has(record.id)) fail(`duplicate record id "${record.id}"`);
  ids.add(record.id);

  assertNonEmptyString(record.displayName, 'displayName', record.id);
  assertNonEmptyString(record.category, 'category', record.id);
  assertNonEmptyString(record.description, 'description', record.id);

  if (!ENTITY_TYPES.has(record.entityType)) {
    fail(`record "${record.id}" has unsupported entityType "${record.entityType}"`);
  }
  if (!STATUS_SET.has(record.status)) {
    fail(`record "${record.id}" has unsupported status "${record.status}"`);
  }
  if (typeof record.visibleInSidebar !== 'boolean') {
    fail(`record "${record.id}" must define boolean visibleInSidebar`);
  }
  if (typeof record.hiddenByDefault !== 'boolean') {
    fail(`record "${record.id}" must define boolean hiddenByDefault`);
  }
  if (record.workspaceRoute !== null && (
    typeof record.workspaceRoute !== 'string' || !ROUTE_PATTERN.test(record.workspaceRoute)
  )) {
    fail(`record "${record.id}" has an invalid workspaceRoute`);
  }
  for (const field of FORBIDDEN_RUNTIME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      fail(`record "${record.id}" cannot define runtime field "${field}"`);
    }
  }

  if (record.entityType === 'capability') {
    if (record.visibleInSidebar) fail(`capability "${record.id}" cannot be visible in the sidebar`);
    if (!record.hiddenByDefault) fail(`capability "${record.id}" must be hidden by default`);
    if (record.workspaceRoute !== null) fail(`capability "${record.id}" cannot define a workspace route`);
  }

  if (record.entityType === 'external_workspace') {
    if (!record.visibleInSidebar) fail(`external workspace "${record.id}" must be visible in the sidebar`);
    if (record.hiddenByDefault) fail(`external workspace "${record.id}" cannot be hidden by default`);
    if (!record.workspaceRoute) fail(`external workspace "${record.id}" must define a workspace route`);
  }

  return Object.freeze({ ...record });
}

export function validateCapabilityRegistry(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    fail('root must be an object');
  }
  if (document.schemaVersion !== 1) {
    fail(`unsupported schemaVersion "${document.schemaVersion}"`);
  }
  if (!Array.isArray(document.records)) {
    fail('records must be an array');
  }

  const ids = new Set();
  const records = document.records.map((record, index) => validateRecord(record, index, ids));
  const omi = records.find(record => record.id === 'omi');
  const paperclip = records.find(record => record.id === 'paperclip');

  if (!omi || omi.entityType !== 'capability' || omi.category !== 'memory') {
    fail('Omi must exist as a hidden memory capability');
  }
  if (!paperclip || paperclip.entityType !== 'external_workspace') {
    fail('Paperclip must exist as an external_workspace record');
  }
  if (paperclip.workspaceRoute !== 'paperclip') {
    fail('Paperclip must use workspaceRoute "paperclip"');
  }
  if (!['staged', 'configuration_pending'].includes(paperclip.status)) {
    fail('Paperclip must use a staged or configuration_pending status');
  }

  return Object.freeze({
    schemaVersion: document.schemaVersion,
    records: Object.freeze(records),
  });
}

export function loadCapabilityRegistry() {
  if (cache) return cache;

  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  cache = validateCapabilityRegistry(parsed);
  return cache;
}

export function getCapabilityById(id) {
  return loadCapabilityRegistry().records.find(record => record.id === id) || null;
}

export function getHiddenCapabilities() {
  return loadCapabilityRegistry().records.filter(record => record.entityType === 'capability');
}
