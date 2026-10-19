#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer({ databasePath: process.env.ANTINOTE_DB_PATH });
server.connect(new StdioServerTransport()).catch(() => {
  console.error('Unable to start antinote-mcp. Check your MCP client configuration.');
  process.exitCode = 1;
});
