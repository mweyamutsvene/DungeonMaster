import { describe, it, expect } from 'vitest';
import { normalizeToolName, extractFilePath, extractCommand } from './normalize.js';

describe('normalizeToolName', () => {
  it('passes through Claude tool names', () => {
    expect(normalizeToolName('Edit')).toBe('Edit');
    expect(normalizeToolName('Write')).toBe('Write');
    expect(normalizeToolName('Bash')).toBe('Bash');
    expect(normalizeToolName('Read')).toBe('Read');
  });

  it('maps Copilot tool names to Claude equivalents', () => {
    expect(normalizeToolName('editFiles')).toBe('Edit');
    expect(normalizeToolName('replace_string_in_file')).toBe('Edit');
    expect(normalizeToolName('createFile')).toBe('Write');
    expect(normalizeToolName('runCommand')).toBe('Bash');
    expect(normalizeToolName('search')).toBe('Grep');
    expect(normalizeToolName('findFiles')).toBe('Glob');
  });

  it('returns Other for unknown or empty', () => {
    expect(normalizeToolName('UnknownTool')).toBe('Other');
    expect(normalizeToolName(undefined)).toBe('Other');
    expect(normalizeToolName('')).toBe('Other');
  });
});

describe('extractFilePath', () => {
  it('reads Claude snake_case file_path', () => {
    expect(extractFilePath({ file_path: '/repo/src/foo.ts' })).toBe('/repo/src/foo.ts');
  });

  it('reads Copilot camelCase filePath', () => {
    expect(extractFilePath({ filePath: '/repo/src/foo.ts' })).toBe('/repo/src/foo.ts');
  });

  it('falls back to path key', () => {
    expect(extractFilePath({ path: '/repo/foo.ts' })).toBe('/repo/foo.ts');
  });

  it('reads first entry of Copilot multi-file files array', () => {
    expect(extractFilePath({ files: ['/repo/a.ts', '/repo/b.ts'] })).toBe('/repo/a.ts');
  });

  it('returns undefined for empty input', () => {
    expect(extractFilePath(undefined)).toBeUndefined();
    expect(extractFilePath({})).toBeUndefined();
  });
});

describe('extractCommand', () => {
  it('reads command field', () => {
    expect(extractCommand({ command: 'pnpm test' })).toBe('pnpm test');
  });

  it('returns undefined when missing', () => {
    expect(extractCommand({})).toBeUndefined();
    expect(extractCommand(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string command', () => {
    expect(extractCommand({ command: '' })).toBeUndefined();
  });
});
