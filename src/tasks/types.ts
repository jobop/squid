export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ImageAttachment {
  type: 'image';
  mimeType: string;
  dataUrl: string;
  source?: 'paste' | 'mention';
  name?: string;
  path?: string;
}

export type TaskMode = 'ask' | 'craft' | 'plan';

export interface Task {
  id: string;
  title: string;
  mode: TaskMode;
  workDir: string;
  messages: Message[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  modelProvider?: string;
  skillId?: string;
  expertId?: string;
}

export interface TaskCreateOptions {
  title: string;
  mode: TaskMode;
  workDir?: string;
  initialPrompt: string;
  modelProvider?: string;
  skillId?: string;
  expertId?: string;
}
