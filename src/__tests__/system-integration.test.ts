import { describe, it, expect } from 'vitest';
import { TaskStateMachine } from '../tasks/state-machine';
import { WorkspaceManager } from '../workspace/manager';
import { PermissionEngine } from '../permissions/engine';
import { SkillLoader } from '../skills/loader';
import { ExpertManager } from '../experts/manager';
import { ClawServer } from '../claw/server';
import { ClawTaskHandler } from '../claw/task-handler';

describe('System Integration Test', () => {
  it('should initialize all core modules', () => {
    // Task state machine
    const stateMachine = new TaskStateMachine('ask');
    expect(stateMachine.getCurrentMode()).toBe('ask');

    // Workspace manager
    const workspaceManager = new WorkspaceManager();
    expect(workspaceManager).toBeDefined();

    // Permission engine
    const permissionEngine = new PermissionEngine();
    expect(permissionEngine).toBeDefined();

    // Skill loader
    const skillLoader = new SkillLoader();
    expect(skillLoader).toBeDefined();

    // Expert manager
    const expertManager = new ExpertManager();
    expect(expertManager).toBeDefined();

  });

  it('should create and manage Claw server', async () => {
    const server = new ClawServer({ port: 3002, host: 'localhost' });
    const handler = new ClawTaskHandler();

    handler.registerRoutes(server.getServer());
    await server.start();

    const response = await fetch('http://localhost:3002/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'integration test' })
    });

    expect(response.status).toBe(201);
    await server.stop();
  });

  it('should handle task state transitions', () => {
    const sm = new TaskStateMachine('ask');

    // Ask -> Craft
    sm.transition('craft');
    expect(sm.getCurrentMode()).toBe('craft');

    // Craft -> Plan
    sm.transition('plan');
    expect(sm.getCurrentMode()).toBe('plan');

    // Plan -> Ask
    sm.transition('ask');
    expect(sm.getCurrentMode()).toBe('ask');
  });

  it('should load built-in experts', () => {
    const expertManager = new ExpertManager();
    const experts = expertManager.list();

    expect(experts.length).toBeGreaterThan(0);
    expect(experts.some(e => e.id === 'software-engineer')).toBe(true);
    expect(experts.some(e => e.id === 'data-analyst')).toBe(true);
  });
});
