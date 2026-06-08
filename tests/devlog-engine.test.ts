/**
 * DevLog Engine 测试文件
 *
 * 测试覆盖:
 * 1. 触发逻辑 — 任务未完成时切换场景不触发
 * 2. 触发逻辑 — 任务完成后切换场景自动触发
 * 3. 主动触发 — 手动触发不受任务状态限制
 * 4. 同目标聚合 — 同一目标下追加改进内容
 * 5. 去重校验 — 重复内容被拦截
 * 6. 全局开发日志 — 自动记录与 Markdown 生成
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DevLogEngine, computeDedupHash } from '../lib/devlog-engine';

describe('DevLogEngine', () => {
  let engine: DevLogEngine;

  // 基础笔记参数
  const baseNote = {
    goalName: '优化 PDF 生成性能',
    module: 'PDF 生成服务',
    tags: ['#TargetAchieved', '#Performance'],
    background: '生成大文件时内存占用过高',
    breakthroughs: ['采用流式分页写入'],
    takeaways: [],
    summary: '将 PDF 渲染改为流式分页写入，内存占用降低 60%',
  };

  beforeEach(() => {
    engine = new DevLogEngine();
  });

  // ═════════════════════════════════════════════════════
  // 测试 1: 触发逻辑 — 任务状态判断
  // ═════════════════════════════════════════════════════

  describe('触发逻辑 — 任务状态判断', () => {
    it('任务未完成时，自动触发应被拒绝', () => {
      // 模拟: 用户正在处理目标 A，任务尚未完成
      engine.switchGoal('goal-A', '优化 PDF 生成性能', 'PDF 生成服务');

      // 尝试自动创建笔记（不传 isManual = false 默认）
      const result = engine.createNote(baseNote);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('任务尚未完成');
    });

    it('任务完成后切换目标，允许自动触发', () => {
      // 模拟: 用户完成了目标 A
      engine.switchGoal('goal-A', '优化 PDF 生成性能', 'PDF 生成服务');
      engine.markTaskCompleted();

      // 切换到目标 B
      const switchResult = engine.switchGoal(
        'goal-B',
        '新增 RSS 导入功能',
        'RSS 服务',
      );

      expect(switchResult.allowAutoTrigger).toBe(true);
    });

    it('任务未完成时切换目标，不允许自动触发', () => {
      // 模拟: 用户处理目标 A 中途切换到目标 B
      engine.switchGoal('goal-A', '优化 PDF 生成性能', 'PDF 生成服务');
      // 注意: 没有 markTaskCompleted

      const switchResult = engine.switchGoal(
        'goal-B',
        '新增 RSS 导入功能',
        'RSS 服务',
      );

      expect(switchResult.allowAutoTrigger).toBe(false);
    });

    it('首次切换目标（无前一个目标）不应触发', () => {
      // 首次启动，没有前一个目标
      const result = engine.switchGoal('goal-A', '优化 PDF', 'PDF');

      expect(result.allowAutoTrigger).toBe(false);
    });

    it('completed 状态 + createNote 组合验证完整流程', () => {
      // 完整流程: 完成任务 → 创建笔记 → 切换目标
      engine.switchGoal('goal-A', '优化 PDF', 'PDF 服务');
      engine.markTaskCompleted();

      // 在切换前为已完成的 goal-A 创建笔记
      const noteResult = engine.createNote({
        goalName: '优化 PDF',
        module: 'PDF 服务',
        tags: ['#TargetAchieved'],
        background: '内存占用过高',
        breakthroughs: ['流式分页'],
        summary: '内存降低 60%',
      });

      expect(noteResult.success).toBe(true);
      expect(noteResult.note).toBeDefined();

      // 切换新目标，此时 allowAutoTrigger = true
      const switchResult = engine.switchGoal('goal-B', '新增 RSS', 'RSS 服务');
      expect(switchResult.allowAutoTrigger).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════
  // 测试 2: 主动触发 — 手动触发入口
  // ═════════════════════════════════════════════════════

  describe('主动触发 — 手动触发不受任务状态限制', () => {
    it('手动触发在任务未完成时应能成功创建笔记', () => {
      engine.switchGoal('goal-A', '优化 PDF', 'PDF 服务');
      // 任务未完成

      const result = engine.createNote(baseNote, true); // isManual = true

      expect(result.success).toBe(true);
      expect(result.note).toBeDefined();
    });

    it('手动触发在无当前目标时应被拒绝', () => {
      // 没有设置任何目标
      const triggerResult = engine.manualTriggerCurrentGoal();

      expect(triggerResult.allowTrigger).toBe(false);
    });

    it('手动触发在有目标时允许', () => {
      engine.switchGoal('goal-A', '优化 PDF', 'PDF 服务');

      const triggerResult = engine.manualTriggerCurrentGoal();

      expect(triggerResult.allowTrigger).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════
  // 测试 3: 同目标聚合 — 笔记追加
  // ═════════════════════════════════════════════════════

  describe('同目标聚合 — 笔记追加', () => {
    it('同一目标下可追加多条改进笔记', () => {
      // 首次记录（手动触发，因为任务状态可能为 in_progress）
      const first = engine.createNote(
        {
          ...baseNote,
          summary: '首次实现流式分页写入',
          breakthroughs: ['流式分页写入'],
        },
        true,
      );
      expect(first.success).toBe(true);

      // 追加改进 1
      const second = engine.createNote(
        {
          ...baseNote,
          summary: '优化内存缓存策略',
          breakthroughs: ['引入 LRU 缓存'],
        },
        true,
      );
      expect(second.success).toBe(true);

      // 追加改进 2
      const third = engine.createNote(
        {
          ...baseNote,
          summary: '增加并发控制',
          breakthroughs: ['限流队列'],
        },
        true,
      );
      expect(third.success).toBe(true);

      // 验证: 同一目标下有 3 条笔记
      const goal = engine.getGoal(first.note!.noteId.split('-').slice(0, -2).join('-'));
      // 用 goalId 查询
      const allGoals = engine.getAllGoals();
      expect(allGoals).toHaveLength(1);
      expect(allGoals[0].notes).toHaveLength(3);

      // 第一条是 completion, 后两条是 improvement
      expect(allGoals[0].notes[0].isCompletion).toBe(true);
      expect(allGoals[0].notes[1].isCompletion).toBe(false);
      expect(allGoals[0].notes[2].isCompletion).toBe(false);
    });

    it('不同目标应分别存储', () => {
      engine.switchGoal('goal-A', '目标 A', '模块 A');
      engine.createNote(
        {
          goalName: '目标 A',
          module: '模块 A',
          tags: ['#A'],
          background: '背景 A',
          breakthroughs: ['方案 A'],
          summary: '完成 A',
        },
        true,
      );

      engine.switchGoal('goal-B', '目标 B', '模块 B');
      engine.createNote(
        {
          goalName: '目标 B',
          module: '模块 B',
          tags: ['#B'],
          background: '背景 B',
          breakthroughs: ['方案 B'],
          summary: '完成 B',
        },
        true,
      );

      const goals = engine.getAllGoals();
      expect(goals).toHaveLength(2);
    });
  });

  // ═════════════════════════════════════════════════════
  // 测试 4: 去重校验
  // ═════════════════════════════════════════════════════

  describe('去重校验 — 重复内容拦截', () => {
    it('完全相同的内容不应重复记录', () => {
      // 首次记录
      const first = engine.createNote(baseNote, true);
      expect(first.success).toBe(true);

      // 重复记录
      const second = engine.createNote(baseNote, true);

      expect(second.success).toBe(false);
      expect(second.isDuplicate).toBe(true);
    });

    it('isDuplicate 方法应正确检测重复', () => {
      engine.createNote(baseNote, true);

      // 获取目标 ID 后检查
      const goals = engine.getAllGoals();
      const goalId = goals[0].goalId;

      const testContent = `${baseNote.summary}|${baseNote.background}|${baseNote.breakthroughs.join('|')}`;
      expect(engine.isDuplicate(goalId, testContent)).toBe(true);

      const differentContent = '全新的内容|不同的背景|不同的方案';
      expect(engine.isDuplicate(goalId, differentContent)).toBe(false);
    });

    it('相同目标但不同内容应都能记录', () => {
      const first = engine.createNote(
        {
          ...baseNote,
          summary: '第一次改进',
          breakthroughs: ['方案 A'],
        },
        true,
      );
      expect(first.success).toBe(true);

      const second = engine.createNote(
        {
          ...baseNote,
          summary: '第二次改进（完全不同）',
          breakthroughs: ['方案 B'],
        },
        true,
      );
      expect(second.success).toBe(true);

      // 第三次与第一次重复
      const third = engine.createNote(
        {
          ...baseNote,
          summary: '第一次改进',
          breakthroughs: ['方案 A'],
        },
        true,
      );
      expect(third.success).toBe(false);
      expect(third.isDuplicate).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════
  // 测试 5: 全局开发日志
  // ═════════════════════════════════════════════════════

  describe('全局开发日志 — 自动记录与生成', () => {
    it('首次完成归档时应自动记录全局日志', () => {
      engine.createNote(
        {
          ...baseNote,
          summary: '首次完成 PDF 优化',
        },
        true,
      );

      const log = engine.getGlobalLog();
      expect(log).toHaveLength(1);
      expect(log[0].goalName).toBe('优化 PDF 生成性能');
      expect(log[0].summary).toBe('首次完成 PDF 优化');
    });

    it('改进迭代不生成新的全局日志', () => {
      // 首次
      engine.createNote(
        { ...baseNote, summary: '首次完成' },
        true,
      );

      // 改进
      engine.createNote(
        { ...baseNote, summary: '改进 1' },
        true,
      );

      const log = engine.getGlobalLog();
      expect(log).toHaveLength(1); // 只有首次
    });

    it('generateGlobalLogMarkdown 应生成正确的 Markdown', () => {
      engine.switchGoal('goal-A', '优化 PDF 性能', 'PDF 服务');
      engine.createNote(
        {
          goalName: '优化 PDF 性能',
          module: 'PDF',
          tags: ['#A'],
          background: '内存高',
          breakthroughs: ['流式'],
          summary: '内存降低 60%',
        },
        true,
      );

      engine.switchGoal('goal-B', '新增 RSS 导入', 'RSS 服务');
      engine.createNote(
        {
          goalName: '新增 RSS 导入',
          module: 'RSS',
          tags: ['#B'],
          background: '缺少导入',
          breakthroughs: ['XML 解析'],
          summary: '支持 OPML 导入',
        },
        true,
      );

      const md = engine.generateGlobalLogMarkdown();

      expect(md).toContain('优化 PDF 性能');
      expect(md).toContain('新增 RSS 导入');
      expect(md).toContain('内存降低 60%');
      expect(md).toContain('支持 OPML 导入');
      expect(md).toContain('全局开发日志');
    });

    it('无记录时生成空日志 Markdown', () => {
      const md = engine.generateGlobalLogMarkdown();

      expect(md).toContain('暂无记录');
    });
  });

  // ═════════════════════════════════════════════════════
  // 测试 6: 序列化与恢复
  // ═════════════════════════════════════════════════════

  describe('序列化与恢复', () => {
    it('exportData 和 importData 应完整保留数据', () => {
      engine.createNote(
        { ...baseNote, summary: '完成 A' },
        true,
      );
      engine.createNote(
        { ...baseNote, summary: '完成 B' },
        true,
      );

      const exported = engine.exportData();
      expect(exported.goals).toHaveLength(1);

      // 新引擎恢复
      const newEngine = new DevLogEngine();
      newEngine.importData(exported);

      const goals = newEngine.getAllGoals();
      expect(goals).toHaveLength(1);
      expect(goals[0].notes).toHaveLength(2);
      expect(newEngine.getGlobalLog()).toHaveLength(1);
    });
  });

  // ═════════════════════════════════════════════════════
  // 测试 7: computeDedupHash 工具函数
  // ═════════════════════════════════════════════════════

  describe('computeDedupHash 工具函数', () => {
    it('相同内容应产生相同哈希', () => {
      const hash1 = computeDedupHash('测试内容');
      const hash2 = computeDedupHash('测试内容');
      expect(hash1).toBe(hash2);
    });

    it('不同内容应产生不同哈希', () => {
      const hash1 = computeDedupHash('内容 A');
      const hash2 = computeDedupHash('内容 B');
      expect(hash1).not.toBe(hash2);
    });
  });
});
