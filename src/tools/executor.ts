import type { ToolArguments, ToolName, ToolResult } from './catalog.js';

export interface ToolExecutionContext {
  signal?: AbortSignal;
}

export type ToolExecutor = {
  [Name in ToolName]: (
    args: ToolArguments<Name>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult<Name>>;
};