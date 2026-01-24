/**
 * Input Validator - IPC 参数验证器
 *
 * 负责验证所有 IPC 调用的参数，防止注入攻击。
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

/**
 * 验证结果泛型接口
 */
export interface ValidationResult<T> {
  /** 验证是否通过 */
  valid: boolean;
  /** 验证后的值（仅当验证通过时） */
  value?: T;
  /** 错误信息（仅当验证失败时） */
  error?: string;
}

/**
 * 支持的包管理器类型
 */
export type PackageManagerType = 'npm' | 'pip' | 'composer';

/**
 * 输入验证器接口
 */
export interface IInputValidator {
  /**
   * 验证包名格式
   * @param name - 包名
   * @returns 验证结果
   */
  validatePackageName(name: string): ValidationResult<string>;

  /**
   * 验证 PID (进程 ID)
   * @param pid - 进程 ID
   * @returns 验证结果
   */
  validatePID(pid: unknown): ValidationResult<number>;

  /**
   * 验证路径（检测路径遍历）
   * @param path - 文件路径
   * @returns 验证结果
   */
  validatePath(path: string): ValidationResult<string>;

  /**
   * 验证包管理器类型
   * @param manager - 包管理器名称
   * @returns 验证结果
   */
  validatePackageManager(manager: string): ValidationResult<PackageManagerType>;
}

/**
 * npm 包名正则表达式
 * 支持 scoped packages (@scope/name) 和普通包名
 */
export const NPM_PACKAGE_PATTERN =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * pip 包名正则表达式
 */
export const PIP_PACKAGE_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/**
 * Homebrew 包名正则表达式
 * 允许常见的 formula/cask 名称格式（例如 python@3.11、icu4c@78、ca-certificates）
 */
export const BREW_PACKAGE_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9@._+-]*$/;

/**
 * 路径遍历检测模式
 */
export const PATH_TRAVERSAL_PATTERN = /\.\./;

/**
 * 有效的包管理器列表
 */
export const VALID_PACKAGE_MANAGERS: readonly PackageManagerType[] = [
  'npm',
  'pip',
  'composer',
] as const;

/**
 * Input Validator 实现
 *
 * 验证所有 IPC 调用的参数，防止注入攻击。
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */
export class InputValidator implements IInputValidator {
  /**
   * 验证包名格式
   *
   * 支持 npm 和 pip 包名格式：
   * - npm: 支持 scoped packages (@scope/name) 和普通包名
   * - pip: 支持字母数字开头和结尾，中间可包含 . _ -
   *
   * @param name - 包名
   * @returns 验证结果
   * @see Requirements 2.1
   */
  validatePackageName(name: string): ValidationResult<string> {
    // 检查是否为空或非字符串
    if (typeof name !== 'string' || name.trim() === '') {
      return {
        valid: false,
        error: '包名不能为空',
      };
    }

    const trimmedName = name.trim();

    // 检查是否符合 npm 包名格式
    if (NPM_PACKAGE_PATTERN.test(trimmedName)) {
      return {
        valid: true,
        value: trimmedName,
      };
    }

    // 检查是否符合 pip 包名格式
    if (PIP_PACKAGE_PATTERN.test(trimmedName)) {
      return {
        valid: true,
        value: trimmedName,
      };
    }

    // 检查是否符合 Homebrew 包名格式（brew formula/cask）
    if (BREW_PACKAGE_PATTERN.test(trimmedName)) {
      return {
        valid: true,
        value: trimmedName,
      };
    }

    return {
      valid: false,
      error: '无效的包名格式。包名必须符合 npm、pip 或 Homebrew 包名规范',
    };
  }

  /**
   * 验证 PID (进程 ID)
   *
   * PID 必须是正整数。
   *
   * @param pid - 进程 ID
   * @returns 验证结果
   * @see Requirements 2.2
   */
  validatePID(pid: unknown): ValidationResult<number> {
    // 检查是否为数字类型
    if (typeof pid !== 'number') {
      return {
        valid: false,
        error: 'PID 必须是数字类型',
      };
    }

    // 检查是否为 NaN
    if (Number.isNaN(pid)) {
      return {
        valid: false,
        error: 'PID 不能是 NaN',
      };
    }

    // 检查是否为有限数
    if (!Number.isFinite(pid)) {
      return {
        valid: false,
        error: 'PID 必须是有限数',
      };
    }

    // 检查是否为整数
    if (!Number.isInteger(pid)) {
      return {
        valid: false,
        error: 'PID 必须是整数',
      };
    }

    // 检查是否为正整数
    if (pid <= 0) {
      return {
        valid: false,
        error: 'PID 必须是正整数',
      };
    }

    return {
      valid: true,
      value: pid,
    };
  }

  /**
   * 验证路径（检测路径遍历）
   *
   * 检查路径是否包含路径遍历字符 (..)
   *
   * @param path - 文件路径
   * @returns 验证结果
   * @see Requirements 2.3
   */
  validatePath(path: string): ValidationResult<string> {
    // 检查是否为空或非字符串
    if (typeof path !== 'string' || path.trim() === '') {
      return {
        valid: false,
        error: '路径不能为空',
      };
    }

    const trimmedPath = path.trim();

    // 检测路径遍历模式
    if (PATH_TRAVERSAL_PATTERN.test(trimmedPath)) {
      return {
        valid: false,
        error: '路径包含不安全字符 (..)，可能存在路径遍历攻击',
      };
    }

    return {
      valid: true,
      value: trimmedPath,
    };
  }

  /**
   * 验证包管理器类型
   *
   * 检查包管理器是否在支持的列表中：npm, pip, composer
   *
   * @param manager - 包管理器名称
   * @returns 验证结果
   */
  validatePackageManager(manager: string): ValidationResult<PackageManagerType> {
    // 检查是否为空或非字符串
    if (typeof manager !== 'string' || manager.trim() === '') {
      return {
        valid: false,
        error: '包管理器名称不能为空',
      };
    }

    const trimmedManager = manager.trim().toLowerCase();

    // 检查是否在有效列表中
    if (VALID_PACKAGE_MANAGERS.includes(trimmedManager as PackageManagerType)) {
      return {
        valid: true,
        value: trimmedManager as PackageManagerType,
      };
    }

    return {
      valid: false,
      error: `无效的包管理器。支持的包管理器: ${VALID_PACKAGE_MANAGERS.join(', ')}`,
    };
  }
}

// 导出默认实例
export const inputValidator = new InputValidator();
