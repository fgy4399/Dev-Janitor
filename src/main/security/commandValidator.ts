/**
 * Command Validator - Shell 命令验证器
 *
 * 负责验证和清理 shell 命令输入，防止命令注入攻击。
 * 遵循 Electron 安全最佳实践 (2025/2026)。
 *
 * @see Requirements 1.1, 1.4, 2.5, 3.1
 */

/**
 * 命令验证结果
 */
export interface CommandValidationResult {
  /** 验证是否通过 */
  valid: boolean;
  /** 清理后的命令（仅当验证通过时） */
  sanitizedCommand?: string;
  /** 命令名（仅当验证通过时） */
  command?: string;
  /** 参数数组（仅当验证通过时） */
  args?: string[];
  /** 错误信息（仅当验证失败时） */
  error?: string;
}

/**
 * 命令验证器接口
 */
export interface ICommandValidator {
  /**
   * 验证命令是否在白名单中
   * @param command - 要验证的命令
   * @returns 验证结果
   */
  validateCommand(command: string): CommandValidationResult;

  /**
   * 验证命令名和参数数组。
   * @param command - 命令名
   * @param args - 参数数组
   * @returns 验证结果
   */
  validateCommandParts(command: string, args: string[]): CommandValidationResult;

  /**
   * 检查输入是否包含危险字符
   * @param input - 要检查的输入字符串
   * @returns 是否包含危险字符
   */
  containsDangerousChars(input: string): boolean;

  /**
   * 转义命令参数
   * @param arg - 要转义的参数
   * @returns 转义后的参数
   */
  escapeArgument(arg: string): string;

  /**
   * 获取允许的命令列表
   * @returns 允许执行的命令白名单
   */
  getAllowedCommands(): readonly string[];
}

/**
 * 允许的命令白名单 (仅限开发工具相关命令)
 */
export const ALLOWED_COMMANDS: readonly string[] = [
  'npm',
  'npx',
  'pip',
  'pip3',
  'composer',
  'cargo',
  'gem',
  'node',
  'python',
  'python3',
] as const;

/**
 * 危险字符模式 - 防止命令注入
 * 包括: ; | & ` $ ( ) { } [ ] < > \ ' " 以及换行符和回车符
 * 也检测 Unicode 控制字符和零宽字符
 */
export const DANGEROUS_PATTERNS = /[;&|`$(){}[\]<>\\'"\n\r\t\x00-\x1F\x7F\u200B-\u200D\uFEFF]/;

/**
 * Command Validator 实现
 *
 * 实现命令白名单验证、危险字符检测和参数转义功能。
 * @see Requirements 1.1, 1.2, 1.5
 */
export class CommandValidator implements ICommandValidator {
  /**
   * 验证命令是否在白名单中且不包含危险字符
   *
   * @param command - 要验证的完整命令字符串
   * @returns 验证结果，包含是否有效、清理后的命令或错误信息
   *
   * @example
   * validateCommand('npm install lodash') // { valid: true, sanitizedCommand: 'npm install lodash' }
   * validateCommand('rm -rf /') // { valid: false, error: '命令不在允许列表中: rm' }
   * validateCommand('npm install; rm -rf /') // { valid: false, error: '命令包含不安全字符' }
   */
  validateCommand(command: string): CommandValidationResult {
    // 处理空命令
    if (!command || typeof command !== 'string') {
      return {
        valid: false,
        error: '命令不能为空',
      };
    }

    const trimmedCommand = command.trim();
    if (trimmedCommand.length === 0) {
      return {
        valid: false,
        error: '命令不能为空',
      };
    }

    const parts = trimmedCommand.split(/\s+/);
    const baseCommand = parts[0];
    const args = parts.slice(1);

    return this.validateCommandParts(baseCommand, args);
  }

  /**
   * 验证命令名和参数数组。
   *
   * 新代码应优先使用这个接口，并配合 execFile 执行，避免 shell 字符串解析。
   */
  validateCommandParts(command: string, args: string[]): CommandValidationResult {
    if (!command || typeof command !== 'string' || command.trim() === '') {
      return {
        valid: false,
        error: '命令不能为空',
      };
    }

    const baseCommand = command.trim();

    if (!ALLOWED_COMMANDS.includes(baseCommand)) {
      return {
        valid: false,
        error: `命令不在允许列表中: ${baseCommand}`,
      };
    }

    if (!Array.isArray(args)) {
      return {
        valid: false,
        error: '命令参数必须是数组',
      };
    }

    for (const arg of args) {
      if (typeof arg !== 'string') {
        return {
          valid: false,
          error: '命令参数必须是字符串',
        };
      }

      if (arg.trim() === '') {
        return {
          valid: false,
          error: '命令参数不能为空',
        };
      }

      if (this.containsDangerousChars(arg)) {
        return {
          valid: false,
          error: '命令参数包含不安全字符',
        };
      }
    }

    const sanitizedArgs = args.map(arg => arg.trim());

    return {
      valid: true,
      sanitizedCommand: [baseCommand, ...sanitizedArgs].join(' '),
      command: baseCommand,
      args: sanitizedArgs,
    };
  }

  /**
   * 检查输入是否包含危险字符
   *
   * 危险字符包括: ; | & ` $ ( ) { } [ ] < > \ ' "
   * 这些字符可能被用于命令注入攻击
   *
   * @param input - 要检查的输入字符串
   * @returns 如果包含危险字符返回 true，否则返回 false
   *
   * @example
   * containsDangerousChars('hello') // false
   * containsDangerousChars('hello; rm -rf /') // true
   * containsDangerousChars('$(whoami)') // true
   */
  containsDangerousChars(input: string): boolean {
    if (!input || typeof input !== 'string') {
      return false;
    }
    return DANGEROUS_PATTERNS.test(input);
  }

  /**
   * 转义命令参数中的危险字符
   *
   * 通过在危险字符前添加反斜杠进行转义。
   * 此操作是幂等的：多次转义结果相同。
   *
   * @param arg - 要转义的参数
   * @returns 转义后的参数
   *
   * @example
   * escapeArgument('hello') // 'hello'
   * escapeArgument('hello;world') // 'hello\;world'
   * escapeArgument('hello\;world') // 'hello\;world' (幂等)
   */
  escapeArgument(arg: string): string {
    if (!arg || typeof arg !== 'string') {
      return '';
    }

    // 定义需要转义的危险字符（不包括反斜杠，因为它用于转义）
    const dangerousChars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', "'", '"'];

    let result = '';
    let i = 0;

    while (i < arg.length) {
      const char = arg[i];

      // 如果当前字符是反斜杠
      if (char === '\\') {
        // 检查下一个字符是否是危险字符（已经被转义）
        if (i + 1 < arg.length && dangerousChars.includes(arg[i + 1])) {
          // 保留已转义的字符
          result += char + arg[i + 1];
          i += 2;
          continue;
        }
        // 转义反斜杠本身（如果后面不是危险字符）
        // 检查是否已经被转义
        if (i + 1 < arg.length && arg[i + 1] === '\\') {
          result += '\\\\';
          i += 2;
          continue;
        }
        result += '\\\\';
        i++;
        continue;
      }

      // 如果当前字符是危险字符，添加转义
      if (dangerousChars.includes(char)) {
        result += '\\' + char;
        i++;
        continue;
      }

      // 普通字符直接添加
      result += char;
      i++;
    }

    return result;
  }

  /**
   * 获取允许的命令列表
   * @returns 允许执行的命令白名单
   */
  getAllowedCommands(): readonly string[] {
    return ALLOWED_COMMANDS;
  }
}

/**
 * 验证 IPC 消息发送者 (Electron 安全指南第 17 条)
 * 确保消息来自预期的渲染进程
 *
 * @param event - Electron IPC 事件
 * @returns 发送者是否可信
 *
 * TODO: 在 Task 3.3 中集成到 IPC Handlers
 */
export function validateIPCSender(
  event: Electron.IpcMainInvokeEvent
): boolean {
  const webContents = event.sender;
  const url = webContents.getURL();
  // 验证 URL 是否来自应用本身
  return url.startsWith('file://') || url.startsWith('http://localhost');
}

// 导出默认实例
export const commandValidator = new CommandValidator();
