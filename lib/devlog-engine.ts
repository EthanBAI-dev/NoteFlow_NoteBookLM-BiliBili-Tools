/**
 * DevLog Engine — 目标导向型项目复盘与笔记自动生成助手
 *
 * 核心职责:
 * 1. 管理当前任务状态（进行中/已完成）
 * 2. 根据任务状态控制笔记触发逻辑
 * 3. 同目标笔记的聚合与去重
 * 4. 全局开发日志的生成与记录
 */

// ─── 类型定义 ─────────────────────────────────────────

/** 任务状态 */
export type TaskStatus = 'in_progress' | 'completed';

/** 会话状态 — 记录当前上下文 */
export interface SessionState {
  currentGoalId: string | null;
  currentGoalName: string | null;
  currentModule: string | null;
  taskStatus: TaskStatus;
  /** 当前 session 内已归档的 goalId 列表，用于防止同一 session 内重复归档 */
  archivedGoalIds: string[];
}

/** 被舍弃的方案 */
export interface AbandonedApproach {
  approach: string;
  reason: string;
}

/** 经验沉淀 */
export interface Takeaway {
  type: 'technical' | 'prevention';
  content: string;
}

/** 单条笔记内容 */
export interface DevLogNote {
  noteId: string;
  timestamp: number;
  /** true = 首次完成归档, false = 后续改进迭代 */
  isCompletion: boolean;
  /** 核心改进内容摘要 */
  summary: string;
  background: string;
  breakthroughs: string[];
  abandoned: AbandonedApproach[];
  takeaways: Takeaway[];
  /** 内容指纹，用于去重校验 */
  dedupHash: string;
}

/** 目标条目 — 同一目标下可包含多条笔记 */
export interface GoalEntry {
  goalId: string;
  goalName: string;
  module: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  notes: DevLogNote[];
}

/** 全局开发日志条目 — 极简风格 */
export interface DevLogGlobalEntry {
  goalId: string;
  goalName: string;
  completedAt: number;
  summary: string;
}

// ─── 工具函数 ─────────────────────────────────────────

/** 生成简单的内容哈希用于去重 */
export function computeDedupHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) + content.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16).padStart(8, '0');
}

/** 生成唯一 ID */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `goal-${timestamp}-${random}`;
}

/** 生成笔记 ID */
export function generateNoteId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `note-${timestamp}-${random}`;
}

// ─── DevLog 引擎 ──────────────────────────────────────

export class DevLogEngine {
  /** 所有目标条目，按 goalId 索引 */
  private goals: Map<string, GoalEntry> = new Map();

  /** 全局开发日志 */
  private globalLog: DevLogGlobalEntry[] = [];

  /** 当前会话状态 */
  private session: SessionState = {
    currentGoalId: null,
    currentGoalName: null,
    currentModule: null,
    taskStatus: 'in_progress',
    archivedGoalIds: [],
  };

  // ─── 会话管理 ──────────────────────────────────────

  /**
   * 获取当前会话状态
   */
  getSessionState(): Readonly<SessionState> {
    return { ...this.session };
  }

  /**
   * 设置当前任务状态
   */
  setTaskStatus(status: TaskStatus): void {
    this.session.taskStatus = status;
  }

  /**
   * 将当前标记为已完成
   */
  markTaskCompleted(): void {
    this.session.taskStatus = 'completed';
  }

  /**
   * 切换到新目标（主题切换）
   * @returns 是否允许自动触发笔记: true=任务已完成可触发, false=任务未完成不触发
   */
  switchGoal(goalId: string, goalName: string, module: string): { allowAutoTrigger: boolean } {
    const prevGoalId = this.session.currentGoalId;
    const wasCompleted = this.session.taskStatus === 'completed';

    // 更新会话状态到新目标
    this.session.currentGoalId = goalId;
    this.session.currentGoalName = goalName;
    this.session.currentModule = module;

    // 重置任务状态
    this.session.taskStatus = 'in_progress';

    // 如果是从已完成的目标切换过来，允许自动触发
    if (prevGoalId && wasCompleted && prevGoalId !== goalId) {
      return { allowAutoTrigger: true };
    }
    return { allowAutoTrigger: false };
  }

  /**
   * 手动触发笔记创建（用户主动发起）
   */
  manualTriggerCurrentGoal(): { allowTrigger: boolean } {
    if (!this.session.currentGoalId) {
      return { allowTrigger: false };
    }
    return { allowTrigger: true };
  }

  // ─── 笔记管理 ──────────────────────────────────────

  /**
   * 查找或创建目标条目
   */
  private getOrCreateGoal(goalName: string, module: string, tags: string[]): GoalEntry {
    const goalId = this.session.currentGoalId || generateId();

    if (this.goals.has(goalId)) {
      return this.goals.get(goalId)!;
    }

    const entry: GoalEntry = {
      goalId,
      goalName,
      module,
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: [],
    };
    this.goals.set(goalId, entry);

    // 更新会话状态
    this.session.currentGoalId = goalId;
    this.session.currentGoalName = goalName;
    this.session.currentModule = module;

    return entry;
  }

  /**
   * 检查内容是否与目标下已有笔记重复
   * @param goalId 目标ID
   * @param content 待检查的内容
   * @returns 是否重复
   */
  isDuplicate(goalId: string, content: string): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;

    const newHash = computeDedupHash(content);
    return goal.notes.some((note) => note.dedupHash === newHash);
  }

  /**
   * 获取重复的笔记（返回匹配的笔记列表）
   */
  findDuplicates(goalId: string, content: string): DevLogNote[] {
    const goal = this.goals.get(goalId);
    if (!goal) return [];

    const newHash = computeDedupHash(content);
    return goal.notes.filter((note) => note.dedupHash === newHash);
  }

  /**
   * 创建笔记（首次归档或改进迭代）
   *
   * @param params 笔记参数
   * @param isManual 是否为手动触发
   * @returns 创建结果
   */
  createNote(
    params: {
      goalName: string;
      module: string;
      tags: string[];
      background: string;
      breakthroughs: string[];
      abandoned?: AbandonedApproach[];
      takeaways?: Takeaway[];
      summary: string;
    },
    isManual = false,
  ): { success: boolean; note?: DevLogNote; isDuplicate?: boolean; reason?: string } {
    // 如果是自动触发，检查任务状态
    if (!isManual) {
      if (this.session.taskStatus !== 'completed') {
        return {
          success: false,
          reason: '任务尚未完成，跳过自动笔记生成。如需记录请使用手动触发。',
        };
      }
    }

    const goal = this.getOrCreateGoal(params.goalName, params.module, params.tags);

    // 计算内容指纹
    const contentToHash = `${params.summary}|${params.background}|${params.breakthroughs.join('|')}`;
    const dedupHash = computeDedupHash(contentToHash);

    // 去重检查
    if (this.isDuplicate(goal.goalId, contentToHash)) {
      const duplicates = this.findDuplicates(goal.goalId, contentToHash);
      return {
        success: false,
        isDuplicate: true,
        reason: `内容与已有笔记重复 (匹配笔记: ${duplicates.map((n) => n.noteId).join(', ')})`,
      };
    }

    const note: DevLogNote = {
      noteId: generateNoteId(),
      timestamp: Date.now(),
      isCompletion: goal.notes.length === 0, // 第一条为完成归档，后续为改进
      summary: params.summary,
      background: params.background,
      breakthroughs: params.breakthroughs,
      abandoned: params.abandoned || [],
      takeaways: params.takeaways || [],
      dedupHash,
    };

    goal.notes.push(note);
    goal.updatedAt = Date.now();

    // 记录全局开发日志
    if (note.isCompletion) {
      this.globalLog.push({
        goalId: goal.goalId,
        goalName: params.goalName,
        completedAt: Date.now(),
        summary: params.summary,
      });
    }

    return { success: true, note };
  }

  // ─── 全局开发日志 ──────────────────────────────────

  /**
   * 获取全局开发日志（按时间倒序）
   */
  getGlobalLog(): DevLogGlobalEntry[] {
    return [...this.globalLog].sort((a, b) => b.completedAt - a.completedAt);
  }

  /**
   * 生成全局开发日志的 Markdown
   */
  generateGlobalLogMarkdown(): string {
    const sorted = this.getGlobalLog();
    if (sorted.length === 0) {
      return '# 📋 全局开发日志\n\n暂无记录。\n';
    }

    let md = `# 📋 全局开发日志\n\n`;
    md += `> 极简记录 · 仅保留关键时间节点与目标完成摘要\n\n`;
    md += `---\n\n`;

    for (const entry of sorted) {
      const date = new Date(entry.completedAt).toISOString().replace('T', ' ').substring(0, 19);
      md += `### ✅ ${entry.goalName}\n`;
      md += `- **完成时间:** ${date}\n`;
      md += `- **摘要:** ${entry.summary}\n\n`;
    }

    return md;
  }

  // ─── 目标查询 ──────────────────────────────────────

  /**
   * 获取指定目标的所有笔记
   */
  getGoalNotes(goalId: string): DevLogNote[] | null {
    const goal = this.goals.get(goalId);
    return goal ? [...goal.notes] : null;
  }

  /**
   * 获取指定目标的完整信息
   */
  getGoal(goalId: string): GoalEntry | undefined {
    return this.goals.get(goalId);
  }

  /**
   * 获取所有目标（按更新时间倒序）
   */
  getAllGoals(): GoalEntry[] {
    return Array.from(this.goals.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ─── 序列化 ────────────────────────────────────────

  /**
   * 导出所有数据（用于持久化）
   */
  exportData(): { goals: GoalEntry[]; globalLog: DevLogGlobalEntry[] } {
    return {
      goals: this.getAllGoals(),
      globalLog: this.getGlobalLog(),
    };
  }

  /**
   * 导入数据（用于恢复）
   */
  importData(data: { goals: GoalEntry[]; globalLog: DevLogGlobalEntry[] }): void {
    this.goals.clear();
    for (const goal of data.goals) {
      this.goals.set(goal.goalId, goal);
    }
    this.globalLog = [...data.globalLog];
  }

  /**
   * 重置所有状态
   */
  reset(): void {
    this.goals.clear();
    this.globalLog = [];
    this.session = {
      currentGoalId: null,
      currentGoalName: null,
      currentModule: null,
      taskStatus: 'in_progress',
      archivedGoalIds: [],
    };
  }
}
