import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPClient {
  private clients: Map<string, Client> = new Map();

  async connect(config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
    });

    const client = new Client({
      name: 'squid',
      version: '0.1.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    this.clients.set(config.name, client);
  }

  async disconnect(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.close();
      this.clients.delete(name);
    }
  }

  getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }

  listConnections(): string[] {
    return Array.from(this.clients.keys());
  }
}
