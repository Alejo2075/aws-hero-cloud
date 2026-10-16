import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHeroMcpServer } from './server.js';
import type { HeroMcpOptions } from './server.js';

/**
 * Serves the tools over standard input and output, the way assistants start a local server.
 * Standard output carries the protocol only, so nothing else may be printed there. Resolves when
 * the assistant closes the connection.
 */
export async function serveStdio(options: HeroMcpOptions): Promise<void> {
  const mcp = createHeroMcpServer(options);
  const transport = new StdioServerTransport();
  await new Promise<void>((resolve, reject) => {
    transport.onclose = () => {
      mcp.close();
      resolve();
    };
    transport.onerror = (error) => {
      mcp.close();
      reject(error);
    };
    mcp.server.connect(transport).catch(reject);
  });
}
