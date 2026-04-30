/**
 * Command Validator Unit Tests
 *
 * Tests for the CommandValidator implementation.
 * @see Requirements 1.1, 1.2, 1.5
 */

import { describe, it, expect } from 'vitest';
import {
  CommandValidator,
  ALLOWED_COMMANDS,
  DANGEROUS_PATTERNS,
} from './commandValidator';

describe('CommandValidator', () => {
  const validator = new CommandValidator();

  describe('validateCommand', () => {
    describe('white-listed commands', () => {
      it('should accept npm commands', () => {
        const result = validator.validateCommand('npm install lodash');
        expect(result.valid).toBe(true);
        expect(result.sanitizedCommand).toBe('npm install lodash');
        expect(result.command).toBe('npm');
        expect(result.args).toEqual(['install', 'lodash']);
      });

      it('should accept npx commands', () => {
        const result = validator.validateCommand('npx create-react-app my-app');
        expect(result.valid).toBe(true);
        expect(result.sanitizedCommand).toBe('npx create-react-app my-app');
      });

      it('should accept pip commands', () => {
        const result = validator.validateCommand('pip install requests');
        expect(result.valid).toBe(true);
        expect(result.sanitizedCommand).toBe('pip install requests');
      });

      it('should accept all allowed commands', () => {
        for (const cmd of ALLOWED_COMMANDS) {
          const result = validator.validateCommand(`${cmd} --version`);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      });
    });

    describe('non-white-listed commands', () => {
      it('should reject rm command', () => {
        const result = validator.validateCommand('rm -rf /');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('命令不在允许列表中');
      });

      it('should reject curl command', () => {
        const result = validator.validateCommand('curl http://evil.com');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('命令不在允许列表中');
      });

      it('should reject bash command', () => {
        const result = validator.validateCommand('bash -c "echo hello"');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('命令不在允许列表中');
      });
    });

    describe('dangerous characters', () => {
      it('should reject commands with semicolon', () => {
        const result = validator.validateCommand('npm install; rm -rf /');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不安全字符');
      });

      it('should reject commands with pipe', () => {
        const result = validator.validateCommand('npm list | grep lodash');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不安全字符');
      });

      it('should reject commands with ampersand', () => {
        const result = validator.validateCommand('npm install & rm -rf /');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不安全字符');
      });

      it('should reject commands with backtick', () => {
        const result = validator.validateCommand('npm install `whoami`');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不安全字符');
      });

      it('should reject commands with dollar sign', () => {
        const result = validator.validateCommand('npm install $(whoami)');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不安全字符');
      });

      it('should reject commands with angle brackets', () => {
        const result = validator.validateCommand('npm list > output.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不安全字符');
      });
    });

    describe('edge cases', () => {
      it('should reject empty command', () => {
        const result = validator.validateCommand('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should reject whitespace-only command', () => {
        const result = validator.validateCommand('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不能为空');
      });

      it('should handle command with extra whitespace', () => {
        const result = validator.validateCommand('  npm   install   lodash  ');
        expect(result.valid).toBe(true);
        expect(result.sanitizedCommand).toBe('npm install lodash');
      });
    });
  });

  describe('validateCommandParts', () => {
    it('should accept allowed command and args', () => {
      const result = validator.validateCommandParts('npm', ['install', 'lodash']);

      expect(result.valid).toBe(true);
      expect(result.command).toBe('npm');
      expect(result.args).toEqual(['install', 'lodash']);
      expect(result.sanitizedCommand).toBe('npm install lodash');
    });

    it('should reject command not in whitelist', () => {
      const result = validator.validateCommandParts('rm', ['-rf', '/']);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('命令不在允许列表中');
    });

    it('should reject dangerous args before execution', () => {
      const result = validator.validateCommandParts('npm', ['install', 'lodash;rm']);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('不安全字符');
    });

    it('should reject non-array args', () => {
      const result = validator.validateCommandParts('npm', 'install' as unknown as string[]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('数组');
    });
  });

  describe('containsDangerousChars', () => {
    it('should return false for safe strings', () => {
      expect(validator.containsDangerousChars('hello')).toBe(false);
      expect(validator.containsDangerousChars('npm-package')).toBe(false);
      expect(validator.containsDangerousChars('my_package')).toBe(false);
      expect(validator.containsDangerousChars('package123')).toBe(false);
    });

    it('should return true for strings with dangerous characters', () => {
      expect(validator.containsDangerousChars('hello;world')).toBe(true);
      expect(validator.containsDangerousChars('hello|world')).toBe(true);
      expect(validator.containsDangerousChars('hello&world')).toBe(true);
      expect(validator.containsDangerousChars('hello`world')).toBe(true);
      expect(validator.containsDangerousChars('hello$world')).toBe(true);
      expect(validator.containsDangerousChars('hello(world)')).toBe(true);
      expect(validator.containsDangerousChars('hello{world}')).toBe(true);
      expect(validator.containsDangerousChars('hello[world]')).toBe(true);
      expect(validator.containsDangerousChars('hello<world>')).toBe(true);
      expect(validator.containsDangerousChars("hello'world")).toBe(true);
      expect(validator.containsDangerousChars('hello"world')).toBe(true);
      expect(validator.containsDangerousChars('hello\\world')).toBe(true);
    });

    it('should handle empty and null-like inputs', () => {
      expect(validator.containsDangerousChars('')).toBe(false);
      expect(validator.containsDangerousChars(null as unknown as string)).toBe(false);
      expect(validator.containsDangerousChars(undefined as unknown as string)).toBe(false);
    });
  });

  describe('escapeArgument', () => {
    it('should return safe strings unchanged', () => {
      expect(validator.escapeArgument('hello')).toBe('hello');
      expect(validator.escapeArgument('npm-package')).toBe('npm-package');
      expect(validator.escapeArgument('my_package')).toBe('my_package');
    });

    it('should escape dangerous characters', () => {
      expect(validator.escapeArgument('hello;world')).toBe('hello\\;world');
      expect(validator.escapeArgument('hello|world')).toBe('hello\\|world');
      expect(validator.escapeArgument('hello&world')).toBe('hello\\&world');
    });

    it('should be idempotent (escaping twice gives same result)', () => {
      const input = 'hello;world|test&foo';
      const escaped1 = validator.escapeArgument(input);
      const escaped2 = validator.escapeArgument(escaped1);
      expect(escaped1).toBe(escaped2);
    });

    it('should handle empty and null-like inputs', () => {
      expect(validator.escapeArgument('')).toBe('');
      expect(validator.escapeArgument(null as unknown as string)).toBe('');
      expect(validator.escapeArgument(undefined as unknown as string)).toBe('');
    });
  });

  describe('getAllowedCommands', () => {
    it('should return the allowed commands list', () => {
      const commands = validator.getAllowedCommands();
      expect(commands).toEqual(ALLOWED_COMMANDS);
    });

    it('should include expected package managers', () => {
      const commands = validator.getAllowedCommands();
      expect(commands).toContain('npm');
      expect(commands).toContain('pip');
      expect(commands).toContain('composer');
      expect(commands).toContain('cargo');
      expect(commands).toContain('gem');
    });
  });

  describe('DANGEROUS_PATTERNS constant', () => {
    it('should match all expected dangerous characters', () => {
      const dangerousChars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', '\\', "'", '"'];
      for (const char of dangerousChars) {
        expect(DANGEROUS_PATTERNS.test(char)).toBe(true);
      }
    });
  });
});
