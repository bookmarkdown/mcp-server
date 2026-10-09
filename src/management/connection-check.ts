export interface ConnectionCheck {
  server: 'passed' | 'failed';
  extension: 'registered' | 'missing';
  tool: 'passed' | 'not-run' | 'failed';
  checkedAt: string;
  code?: string;
}

// The URL and token come from the running daemon, never from management input.
// Only initialization, catalog discovery and a bounded tab count are performed.
export async function checkMcpConnection(url: string, token: string, instanceId?: string): Promise<ConnectionCheck> {
  const checkedAt = new Date().toISOString();
  const result: ConnectionCheck = {server: 'failed', extension: instanceId ? 'registered' : 'missing', tool: 'not-run', checkedAt};
  const signal = AbortSignal.timeout(6000);
  let id = 0;
  const request = async (method: string, params: unknown) => {
    const response = await fetch(url, {
      method: 'POST', signal,
      headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
    });
    if (!response.ok) throw new Error('HTTP_CHECK_FAILED');
    const body = await response.json() as {result?: Record<string, unknown>; error?: unknown};
    if (body.error || !body.result) throw new Error('HTTP_CHECK_FAILED');
    return body.result;
  };
  try {
    await request('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'bookmarkdown-management-check', version: '1.0.0'}});
    const catalog = await request('tools/list', {});
    if (!Array.isArray(catalog.tools) || !catalog.tools.some(tool => tool?.name === 'browser.countOpenTabs')) throw new Error('HTTP_CHECK_FAILED');
    result.server = 'passed';
    if (!instanceId) return result;
    const tool = await request('tools/call', {name: 'browser.countOpenTabs', arguments: {instanceId}});
    const data = tool.structuredContent as {count?: unknown} | undefined;
    if (tool.isError || !data || !Number.isSafeInteger(data.count) || (data.count as number) < 0) {
      result.tool = 'failed';
      result.code = 'BROWSER_READ_FAILED';
    } else result.tool = 'passed';
  } catch {
    if (result.server === 'passed') { result.tool = 'failed'; result.code = 'BROWSER_READ_FAILED'; }
    else result.code = 'HTTP_CHECK_FAILED';
  }
  return result;
}
