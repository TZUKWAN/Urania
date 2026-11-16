/** MV1-01 — motion schema contract tests (positive + boundary negatives). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	validateProjectId, validateRevision, validateOperationKey, validateRender,
	validateSources, validateTimeRange, validateHfIdSet, validateRevisionManifest,
	safeRelativePath, SchemaError
} from '../host/motion/schema.js';

const ok = (fn, ...args) => { fn(...args); };
const throws = (code, fn) => { try { fn(); assert.fail('expected throw ' + code); } catch (e) { assert.ok(e instanceof SchemaError, 'SchemaError expected, got ' + e.constructor.name); assert.equal(e.code, code, 'code mismatch: got ' + e.code); } };

const validRender = { fps: { num: 30, den: 1 }, durationFrames: 120, width: 1280, height: 720 };
const validSources = { 'composition.html': { bytes: 100, sha256: 'a'.repeat(64), encoding: 'utf8' } };
const validManifest = {
	schemaVersion: 1, projectId: 'motion-' + '0123abcd-00e4-4f00-a000-000000000000',
	revision: 'b'.repeat(64), parentRevision: null, title: 'T',
	authoringFormat: 'hyperframes-html', entryFile: 'composition.html',
	render: validRender, sources: validSources
};

test('projectId: valid', () => ok(validateProjectId, 'motion-0123abcd-00e4-4f00-a000-000000000000'));
test('projectId: bad prefix', () => throws('E_PROJECT_ID', () => validateProjectId('dc-0123abcd-00e4-4f00-a000-000000000000')));
test('projectId: bad uuid', () => throws('E_PROJECT_ID', () => validateProjectId('motion-not-a-uuid')));
test('revision: valid sha256', () => ok(validateRevision, 'a'.repeat(64)));
test('revision: short sha refused', () => throws('E_REVISION', () => validateRevision('abc')));
test('operationKey: valid', () => ok(validateOperationKey, 'op_123.abc-def'));
test('operationKey: bad char', () => throws('E_OP_KEY', () => validateOperationKey('op/slash')));

test('render: 24/25/30 accepted', () => { for (const n of [24, 25, 30]) validateRender({ ...validRender, fps: { num: n, den: 1 } }); });
test('render: fps 60 refused', () => throws('E_FPS_VALUE', () => validateRender({ ...validRender, fps: { num: 60, den: 1 } })));
test('render: den != 1 refused', () => throws('E_FPS_DEN', () => validateRender({ ...validRender, fps: { num: 30000, den: 1001 } })));
test('render: zero frames refused', () => throws('E_FRAMES', () => validateRender({ ...validRender, durationFrames: 0 })));
test('render: negative frames refused', () => throws('E_FRAMES', () => validateRender({ ...validRender, durationFrames: -5 })));
test('render: over-size edge refused', () => throws('E_SIZE_MAX', () => validateRender({ ...validRender, width: 1921, height: 1080 })));
test('render: over-area refused (1920x1081 > 2073600)', () => throws('E_PIXELS_MAX', () => validateRender({ ...validRender, width: 1920, height: 1081 })));
test('render: 1920x1080 accepted (exactly at area cap)', () => validateRender({ ...validRender, width: 1920, height: 1080 }));
test('render: NaN fps refused', () => throws('E_FPS_SHAPE', () => validateRender({ ...validRender, fps: { num: NaN, den: 1 } })));

test('sources: valid', () => ok(validateSources, validSources));
test('sources: empty refused', () => throws('E_SOURCES_EMPTY', () => validateSources({})));
test('sources: traversal refused', () => throws('E_PATH_TRAVERSAL', () => validateSources({ '../evil.html': { bytes: 1, sha256: 'a'.repeat(64) } })));
test('sources: absolute refused', () => throws('E_PATH_ABS', () => validateSources({ '/etc/passwd': { bytes: 1, sha256: 'a'.repeat(64) } })));
test('sources: drive letter refused', () => throws('E_PATH_ABS', () => validateSources({ 'C:/x.html': { bytes: 1, sha256: 'a'.repeat(64) } })));
test('sources: backslash refused', () => throws('E_PATH_SEP', () => validateSources({ 'a\\b.html': { bytes: 1, sha256: 'a'.repeat(64) } })));
test('sources: executable ext refused', () => throws('E_PATH_EXEC', () => validateSources({ 'run.exe': { bytes: 1, sha256: 'a'.repeat(64) } })));
test('sources: bad sha refused', () => throws('E_SOURCE_SHA', () => validateSources({ 'a.html': { bytes: 1, sha256: 'zz' } })));

test('timeRange: valid', () => ok(validateTimeRange, { startFrame: 0, endFrame: 90 }, validRender));
test('timeRange: reversed refused', () => throws('E_RANGE_ORDER', () => validateTimeRange({ startFrame: 90, endFrame: 90 }, validRender)));
test('timeRange: end beyond duration refused', () => throws('E_RANGE_END', () => validateTimeRange({ startFrame: 0, endFrame: 121 }, validRender)));

test('hfIds: valid set', () => ok(validateHfIdSet, ['hf-a', 'hf-b']));
test('hfIds: empty refused', () => throws('E_SEL_EMPTY', () => validateHfIdSet([])));
test('hfIds: duplicate refused', () => throws('E_SEL_DUP', () => validateHfIdSet(['hf-a', 'hf-a'])));

test('manifest: valid roundtrip', () => { const m = validateRevisionManifest(validManifest); assert.equal(m.entryFile, 'composition.html'); assert.equal(m.render.durationFrames, 120); });
test('manifest: entry missing from sources refused', () => throws('E_ENTRY_MISSING', () => validateRevisionManifest({ ...validManifest, entryFile: 'nope.html' })));
test('manifest: bad schemaVersion refused', () => throws('E_SCHEMA_VERSION', () => validateRevisionManifest({ ...validManifest, schemaVersion: 2 })));

test('safeRelativePath: nested ok', () => assert.equal(safeRelativePath('assets/sub/a.png'), 'assets/sub/a.png'));
test('safeRelativePath: dot segment refused', () => throws('E_PATH_TRAVERSAL', () => safeRelativePath('a/./b')));
test('safeRelativePath: dotdot refused', () => throws('E_PATH_TRAVERSAL', () => safeRelativePath('a/../b')));
