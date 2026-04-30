/**
 * Input Validator Unit Tests
 *
 * Tests for the InputValidator implementation.
 * @see Requirements 2.1, 2.2, 2.3
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  InputValidator,
  NPM_PACKAGE_PATTERN,
  PIP_PACKAGE_PATTERN,
  PATH_TRAVERSAL_PATTERN,
  VALID_PACKAGE_MANAGERS,
} from './inputValidator';

describe('InputValidator', () => {
  const validator = new InputValidator();

  describe('validatePackageName', () => {
    describe('valid npm package names', () => {
      it('should accept simple package names', () => {
        const result = validator.validatePackageName('lodash');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('lodash');
      });

      it('should accept package names with hyphens', () => {
        const result = validator.validatePackageName('react-dom');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('react-dom');
      });

      it('should accept package names with dots', () => {
        const result = validator.validatePackageName('socket.io');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('socket.io');
      });

      it('should accept package names with underscores', () => {
        const result = validator.validatePackageName('lodash_es');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('lodash_es');
      });

      it('should accept scoped package names', () => {
        const result = validator.validatePackageName('@types/node');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('@types/node');
      });

      it('should accept scoped package names with hyphens', () => {
        const result = validator.validatePackageName('@angular/core');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('@angular/core');
      });

      it('should accept package names starting with numbers', () => {
        const result = validator.validatePackageName('7zip-bin');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('7zip-bin');
      });
    });

    describe('valid pip package names', () => {
      it('should accept simple pip package names', () => {
        const result = validator.validatePackageName('requests');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('requests');
      });

      it('should accept pip package names with uppercase', () => {
        const result = validator.validatePackageName('Django');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('Django');
      });

      it('should accept pip package names with hyphens', () => {
        const result = validator.validatePackageName('scikit-learn');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('scikit-learn');
      });

      it('should accept pip package names with underscores', () => {
        const result = validator.validatePackageName('typing_extensions');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('typing_extensions');
      });

      it('should accept pip package names with dots', () => {
        const result = validator.validatePackageName('zope.interface');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('zope.interface');
      });
    });

    describe('invalid package names', () => {
      it('should reject empty string', () => {
        const result = validator.validatePackageName('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject whitespace-only string', () => {
        const result = validator.validatePackageName('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject package names with special characters', () => {
        const result = validator.validatePackageName('package;rm -rf');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('无效的包名格式');
      });

      it('should reject package names with spaces', () => {
        const result = validator.validatePackageName('my package');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('无效的包名格式');
      });

      it('should reject package names starting with dot', () => {
        const result = validator.validatePackageName('.hidden');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('无效的包名格式');
      });

      it('should reject package names with path traversal', () => {
        const result = validator.validatePackageName('../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('无效的包名格式');
      });
    });

    describe('edge cases', () => {
      it('should trim whitespace from valid package names', () => {
        const result = validator.validatePackageName('  lodash  ');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('lodash');
      });

      it('should accept single character package names', () => {
        const result = validator.validatePackageName('a');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('a');
      });
    });
  });

  describe('validatePID', () => {
    describe('valid PIDs', () => {
      it('should accept positive integer 1', () => {
        const result = validator.validatePID(1);
        expect(result.valid).toBe(true);
        expect(result.value).toBe(1);
      });

      it('should accept typical PID values', () => {
        const result = validator.validatePID(12345);
        expect(result.valid).toBe(true);
        expect(result.value).toBe(12345);
      });

      it('should accept large PID values', () => {
        const result = validator.validatePID(999999);
        expect(result.valid).toBe(true);
        expect(result.value).toBe(999999);
      });
    });

    describe('invalid PIDs', () => {
      it('should reject zero', () => {
        const result = validator.validatePID(0);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('正整数');
      });

      it('should reject negative numbers', () => {
        const result = validator.validatePID(-1);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('正整数');
      });

      it('should reject floating point numbers', () => {
        const result = validator.validatePID(1.5);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('整数');
      });

      it('should reject NaN', () => {
        const result = validator.validatePID(NaN);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('NaN');
      });

      it('should reject Infinity', () => {
        const result = validator.validatePID(Infinity);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('有限数');
      });

      it('should reject negative Infinity', () => {
        const result = validator.validatePID(-Infinity);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('有限数');
      });

      it('should reject string numbers', () => {
        const result = validator.validatePID('123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('数字类型');
      });

      it('should reject null', () => {
        const result = validator.validatePID(null);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('数字类型');
      });

      it('should reject undefined', () => {
        const result = validator.validatePID(undefined);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('数字类型');
      });

      it('should reject objects', () => {
        const result = validator.validatePID({ pid: 123 });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('数字类型');
      });

      it('should reject arrays', () => {
        const result = validator.validatePID([123]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('数字类型');
      });
    });
  });

  describe('validatePath', () => {
    describe('valid paths', () => {
      it('should accept simple file names', () => {
        const result = validator.validatePath('file.txt');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('file.txt');
      });

      it('should accept absolute paths', () => {
        const result = validator.validatePath('/home/user/file.txt');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('/home/user/file.txt');
      });

      it('should accept relative paths without traversal', () => {
        const result = validator.validatePath('src/main/index.ts');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('src/main/index.ts');
      });

      it('should accept Windows-style paths', () => {
        const result = validator.validatePath('C:\\Users\\user\\file.txt');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('C:\\Users\\user\\file.txt');
      });

      it('should accept paths with single dots', () => {
        const result = validator.validatePath('./src/file.ts');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('./src/file.ts');
      });
    });

    describe('invalid paths (path traversal)', () => {
      it('should reject paths with double dots', () => {
        const result = validator.validatePath('../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('路径遍历');
      });

      it('should reject paths with double dots in middle', () => {
        const result = validator.validatePath('/home/user/../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('路径遍历');
      });

      it('should reject paths with multiple traversals', () => {
        const result = validator.validatePath('../../../../../../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('路径遍历');
      });

      it('should reject Windows-style path traversal', () => {
        const result = validator.validatePath('C:\\Users\\..\\Admin\\file.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('路径遍历');
      });
    });

    describe('edge cases', () => {
      it('should reject empty string', () => {
        const result = validator.validatePath('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject whitespace-only string', () => {
        const result = validator.validatePath('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject null bytes', () => {
        const result = validator.validatePath('/tmp/file\0.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('空字节');
      });

      it('should reject Windows device paths', () => {
        const result = validator.validatePath('\\\\?\\C:\\Users\\file.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Windows');
      });

      it('should trim whitespace from valid paths', () => {
        const result = validator.validatePath('  /home/user/file.txt  ');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('/home/user/file.txt');
      });
    });
  });

  describe('validateResolvedPath', () => {
    it('should resolve an existing path inside allowed root', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-janitor-path-'));
      const child = path.join(root, 'child');
      await fs.mkdir(child);

      const result = await validator.validateResolvedPath(child, {
        allowedRoots: [root],
      });

      expect(result.valid).toBe(true);
      expect(result.value?.realPath).toBe(await fs.realpath(child));

      await fs.rm(root, { recursive: true, force: true });
    });

    it('should reject existing path outside allowed root', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-janitor-root-'));
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-janitor-outside-'));

      const result = await validator.validateResolvedPath(outside, {
        allowedRoots: [root],
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('允许的目录');

      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    });

    it('should reject missing path when existence is required', async () => {
      const result = await validator.validateResolvedPath(
        path.join(os.tmpdir(), 'dev-janitor-missing-path'),
        { mustExist: true }
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('不存在');
    });
  });

  describe('validatePackageManager', () => {
    describe('valid package managers', () => {
      it('should accept npm', () => {
        const result = validator.validatePackageManager('npm');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('npm');
      });

      it('should accept pip', () => {
        const result = validator.validatePackageManager('pip');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('pip');
      });

      it('should accept composer', () => {
        const result = validator.validatePackageManager('composer');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('composer');
      });

      it('should accept uppercase variants (case-insensitive)', () => {
        const result = validator.validatePackageManager('NPM');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('npm');
      });

      it('should accept mixed case variants', () => {
        const result = validator.validatePackageManager('Pip');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('pip');
      });
    });

    describe('invalid package managers', () => {
      it('should reject unknown package managers', () => {
        const result = validator.validatePackageManager('yarn');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('无效的包管理器');
      });

      it('should reject empty string', () => {
        const result = validator.validatePackageManager('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject whitespace-only string', () => {
        const result = validator.validatePackageManager('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject package managers with special characters', () => {
        const result = validator.validatePackageManager('npm;rm');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('无效的包管理器');
      });
    });

    describe('edge cases', () => {
      it('should trim whitespace from valid package managers', () => {
        const result = validator.validatePackageManager('  npm  ');
        expect(result.valid).toBe(true);
        expect(result.value).toBe('npm');
      });
    });
  });

  describe('Pattern constants', () => {
    describe('NPM_PACKAGE_PATTERN', () => {
      it('should match valid npm package names', () => {
        expect(NPM_PACKAGE_PATTERN.test('lodash')).toBe(true);
        expect(NPM_PACKAGE_PATTERN.test('react-dom')).toBe(true);
        expect(NPM_PACKAGE_PATTERN.test('@types/node')).toBe(true);
      });

      it('should not match invalid npm package names', () => {
        expect(NPM_PACKAGE_PATTERN.test('Package')).toBe(false); // uppercase
        expect(NPM_PACKAGE_PATTERN.test('.hidden')).toBe(false);
        expect(NPM_PACKAGE_PATTERN.test('my package')).toBe(false);
      });
    });

    describe('PIP_PACKAGE_PATTERN', () => {
      it('should match valid pip package names', () => {
        expect(PIP_PACKAGE_PATTERN.test('requests')).toBe(true);
        expect(PIP_PACKAGE_PATTERN.test('Django')).toBe(true);
        expect(PIP_PACKAGE_PATTERN.test('scikit-learn')).toBe(true);
      });

      it('should not match invalid pip package names', () => {
        expect(PIP_PACKAGE_PATTERN.test('-invalid')).toBe(false);
        expect(PIP_PACKAGE_PATTERN.test('invalid-')).toBe(false);
        expect(PIP_PACKAGE_PATTERN.test('.hidden')).toBe(false);
      });
    });

    describe('PATH_TRAVERSAL_PATTERN', () => {
      it('should match path traversal patterns', () => {
        expect(PATH_TRAVERSAL_PATTERN.test('..')).toBe(true);
        expect(PATH_TRAVERSAL_PATTERN.test('../etc')).toBe(true);
        expect(PATH_TRAVERSAL_PATTERN.test('/home/../etc')).toBe(true);
      });

      it('should not match safe paths', () => {
        expect(PATH_TRAVERSAL_PATTERN.test('.')).toBe(false);
        expect(PATH_TRAVERSAL_PATTERN.test('./src')).toBe(false);
        expect(PATH_TRAVERSAL_PATTERN.test('/home/user')).toBe(false);
      });
    });

    describe('VALID_PACKAGE_MANAGERS', () => {
      it('should contain expected package managers', () => {
        expect(VALID_PACKAGE_MANAGERS).toContain('npm');
        expect(VALID_PACKAGE_MANAGERS).toContain('pip');
        expect(VALID_PACKAGE_MANAGERS).toContain('composer');
      });

      it('should have exactly 3 package managers', () => {
        expect(VALID_PACKAGE_MANAGERS.length).toBe(3);
      });
    });
  });
});
