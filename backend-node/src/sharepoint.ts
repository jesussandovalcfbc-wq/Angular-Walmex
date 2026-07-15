import { ConfidentialClientApplication } from '@azure/msal-node';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  filePath: string;
}

export function getSharepointCfg(): SharePointConfig {
  return {
    tenantId: process.env.TENANT_ID || '',
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    siteUrl: process.env.SITE_URL || '',
    filePath: process.env.FILE_PATH || '',
  };
}

// Simple in-memory cache for tokens and site IDs to replicate Streamlit's @st.cache_data
const tokenCache = new Map<string, { token: string, expiresAt: number }>();
const siteIdCache = new Map<string, string>();

export async function getSharepointAccessToken(cfg: SharePointConfig): Promise<string> {
  const cacheKey = `${cfg.tenantId}-${cfg.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const msalConfig = {
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      clientSecret: cfg.clientSecret,
    }
  };
  const cca = new ConfidentialClientApplication(msalConfig);
  const authResponse = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });

  if (!authResponse || !authResponse.accessToken) {
    throw new Error('Failed to acquire SharePoint access token');
  }

  // Cache token for 50 minutes (MSAL tokens usually valid for 60 mins)
  tokenCache.set(cacheKey, {
    token: authResponse.accessToken,
    expiresAt: Date.now() + 50 * 60 * 1000 
  });

  return authResponse.accessToken;
}

export async function getSharepointSiteId(cfg: SharePointConfig): Promise<string> {
  const cacheKey = cfg.siteUrl;
  if (siteIdCache.has(cacheKey)) {
    return siteIdCache.get(cacheKey)!;
  }

  const parts = cfg.siteUrl.replace(/\/$/, '').split('/');
  const hostname = parts[2];
  const sitePath = parts.slice(3).join('/');
  
  const token = await getSharepointAccessToken(cfg);
  
  const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${hostname}:/${sitePath}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Error fetching site ID: ${res.statusText}`);
  
  const data = await res.json();
  siteIdCache.set(cacheKey, data.id);
  return data.id;
}

export async function getSharepointFileMeta(): Promise<any> {
  const cfg = getSharepointCfg();
  if (!cfg.siteUrl || !cfg.tenantId) return {};

  const token = await getSharepointAccessToken(cfg);
  const siteId = await getSharepointSiteId(cfg);
  
  const filePathEncoded = cfg.filePath.replace(/^\//, '');
  
  const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${filePathEncoded}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Error fetching file meta: ${res.statusText}`);
  
  const item = await res.json();
  const etag = item.eTag || item.cTag || '';
  const lastModified = item.lastModifiedDateTime || '';
  const size = item.size || 0;
  
  const versionSeed = `${etag}|${lastModified}|${size}`;
  const cacheKey = crypto.createHash('md5').update(versionSeed).digest('hex').substring(0, 16);
  
  return {
    cacheKey,
    etag,
    lastModified,
    size,
    name: item.name || '',
  };
}

export async function downloadExcelSharepoint(): Promise<{ localPath: string, cacheKey: string }> {
  const cfg = getSharepointCfg();
  const token = await getSharepointAccessToken(cfg);
  const siteId = await getSharepointSiteId(cfg);
  
  const fileUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:${cfg.filePath}:/content`;
  
  const res = await fetch(fileUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Error downloading excel: ${res.statusText}`);
  
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  const tmpPath = path.join(os.tmpdir(), `walmex_${Date.now()}.xlsx`);
  fs.writeFileSync(tmpPath, buffer);
  
  const cacheKey = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 16);
  return { localPath: tmpPath, cacheKey };
}

function encodeShareUrlGraph(url: string): string {
  let b64 = Buffer.from(url).toString('base64');
  b64 = b64.replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/, '');
  return 'u!' + b64;
}

export async function downloadViaGraphSharedLink(sharedLink: string): Promise<Buffer> {
  const cfg = getSharepointCfg();
  const token = await getSharepointAccessToken(cfg);
  const shareId = encodeShareUrlGraph(sharedLink);
  
  const res = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`, {
    headers: { 'Authorization': `Bearer ${token}` },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`Error downloading via shared link: ${res.statusText}`);
  
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

type GraphErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function graphRequest(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json() as GraphErrorBody;
      detail = body.error?.message || body.error?.code || '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`Microsoft Graph respondió ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  return res;
}

async function graphRequestWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await graphRequest(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

export type SharepointCell = string | number | boolean;

export interface SharepointChunkImport {
  workbookUrl: string;
  sessionId: string;
  sessionHeaders: Record<string, string>;
  tableName: string;
  totalRows: number;
  nextRow: number;
}

const IMPORT_COLUMN_COUNT = 45;
const IMPORT_CHUNK_LIMIT = 500;

function validateImportRows(rows: unknown): asserts rows is SharepointCell[][] {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > IMPORT_CHUNK_LIMIT) {
    throw new Error(`Cada bloque debe contener entre 1 y ${IMPORT_CHUNK_LIMIT} filas.`);
  }
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== IMPORT_COLUMN_COUNT) {
      throw new Error(`La fila ${rowIndex + 1} del bloque no contiene ${IMPORT_COLUMN_COUNT} columnas.`);
    }
    row.forEach(value => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error('El bloque contiene un valor no permitido.');
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('El bloque contiene un número no válido.');
      }
    });
  });
}

async function closeWorkbookSession(context: SharepointChunkImport): Promise<void> {
  await fetch(`${context.workbookUrl}/closeSession`, {
    method: 'POST',
    headers: context.sessionHeaders,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

export async function startChunkedSharepointImport(
  totalRows: number,
  incomingHeader: unknown,
): Promise<SharepointChunkImport> {
  if (!Number.isInteger(totalRows) || totalRows < 2 || totalRows > 100_000) {
    throw new Error('La cantidad total de filas no es válida.');
  }
  if (!Array.isArray(incomingHeader) || incomingHeader.length !== IMPORT_COLUMN_COUNT) {
    throw new Error(`El encabezado debe contener ${IMPORT_COLUMN_COUNT} columnas.`);
  }

  const cfg = getSharepointCfg();
  const missing = [
    ['TENANT_ID', cfg.tenantId],
    ['CLIENT_ID', cfg.clientId],
    ['CLIENT_SECRET', cfg.clientSecret],
    ['SITE_URL', cfg.siteUrl],
    ['FILE_PATH', cfg.filePath],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Falta configurar: ${missing.join(', ')}`);

  const token = await getSharepointAccessToken(cfg);
  const siteId = await getSharepointSiteId(cfg);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const filePath = cfg.filePath.replace(/^\/+/, '');
  const itemRes = await graphRequest(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${filePath}`,
    { headers },
    30_000,
  );
  const item = await itemRes.json() as { id?: string };
  if (!item.id) throw new Error('SharePoint no devolvió el identificador del archivo destino.');

  const workbookUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${item.id}/workbook`;
  const sessionRes = await graphRequest(
    `${workbookUrl}/createSession`,
    { method: 'POST', headers, body: JSON.stringify({ persistChanges: true }) },
    30_000,
  );
  const session = await sessionRes.json() as { id?: string };
  if (!session.id) throw new Error('No se pudo crear la sesión de Excel en SharePoint.');

  const context: SharepointChunkImport = {
    workbookUrl,
    sessionId: session.id,
    sessionHeaders: { ...headers, 'workbook-session-id': session.id },
    tableName: '',
    totalRows,
    nextRow: 1,
  };

  try {
    const tablesRes = await graphRequest(
      `${workbookUrl}/worksheets/Data/tables`,
      { headers: context.sessionHeaders },
      30_000,
    );
    const tablesData = await tablesRes.json() as { value?: Array<{ name?: string }> };
    const tables = (tablesData.value || []).filter(table => table.name);
    const table = tables.find(item => item.name === 'Tabla4') || tables[0];
    if (!table?.name) throw new Error('La hoja Data no contiene una tabla de Excel.');
    context.tableName = table.name;

    const encodedTableName = encodeURIComponent(context.tableName);
    const headerRes = await graphRequest(
      `${workbookUrl}/tables/${encodedTableName}/headerRowRange`,
      { headers: context.sessionHeaders },
      30_000,
    );
    const headerData = await headerRes.json() as { values?: unknown[][] };
    const existingHeader = headerData.values?.[0] || [];
    const normalize = (value: unknown) => String(value ?? '').trim().toLocaleUpperCase('es-MX');
    const mismatchIndex = incomingHeader.findIndex(
      (value, index) => normalize(value) !== normalize(existingHeader[index]),
    );
    if (mismatchIndex >= 0) {
      throw new Error(`El encabezado no coincide con Tabla4 en la columna ${mismatchIndex + 1}.`);
    }

    const tableRangeRes = await graphRequest(
      `${workbookUrl}/tables/${encodedTableName}/range`,
      { headers: context.sessionHeaders },
      30_000,
    );
    const tableRange = await tableRangeRes.json() as { rowCount?: number };
    const currentTableRows = Math.max(1, Number(tableRange.rowCount) || 1);

    if (totalRows > currentTableRows) {
      let rowsToAdd = totalRows - currentTableRows;
      while (rowsToAdd > 0) {
        const count = Math.min(IMPORT_CHUNK_LIMIT, rowsToAdd);
        const blankRows = Array.from(
          { length: count },
          () => Array<SharepointCell>(IMPORT_COLUMN_COUNT).fill(''),
        );
        await graphRequestWithRetry(
          `${workbookUrl}/tables/${encodedTableName}/rows/add`,
          {
            method: 'POST',
            headers: context.sessionHeaders,
            body: JSON.stringify({ index: null, values: blankRows }),
          },
          120_000,
        );
        rowsToAdd -= count;
      }
    }

    const rowsToClear = Math.max(currentTableRows, totalRows);
    await graphRequestWithRetry(
      `${workbookUrl}/worksheets/Data/range(address='A1:AS${rowsToClear}')/clear`,
      {
        method: 'POST',
        headers: context.sessionHeaders,
        body: JSON.stringify({ applyTo: 'Contents' }),
      },
      120_000,
    );

    return context;
  } catch (error) {
    await closeWorkbookSession(context);
    throw error;
  }
}

export async function writeSharepointImportChunk(
  context: SharepointChunkImport,
  startRow: number,
  rows: unknown,
): Promise<number> {
  validateImportRows(rows);
  const endRow = startRow + rows.length - 1;

  // Si Graph escribió el bloque pero la respuesta se perdió, el navegador lo
  // reintentará. Reconocerlo como completado hace el reintento idempotente y
  // evita duplicar o desplazar información.
  if (endRow < context.nextRow) return endRow;
  if (startRow !== context.nextRow) {
    throw new Error(`El siguiente bloque debe comenzar en la fila ${context.nextRow}.`);
  }
  if (endRow > context.totalRows) {
    throw new Error('El bloque supera el total de filas declarado.');
  }

  await graphRequestWithRetry(
    `${context.workbookUrl}/worksheets/Data/range(address='A${startRow}:AS${endRow}')`,
    {
      method: 'PATCH',
      headers: context.sessionHeaders,
      body: JSON.stringify({ values: rows }),
    },
    120_000,
  );
  context.nextRow = endRow + 1;
  return endRow;
}

export async function finishChunkedSharepointImport(
  context: SharepointChunkImport,
): Promise<void> {
  if (context.nextRow - 1 !== context.totalRows) {
    throw new Error(`La importación está incompleta: ${context.nextRow - 1} de ${context.totalRows} filas.`);
  }
  await closeWorkbookSession(context);
}

export async function cancelChunkedSharepointImport(
  context: SharepointChunkImport,
): Promise<void> {
  await closeWorkbookSession(context);
}
