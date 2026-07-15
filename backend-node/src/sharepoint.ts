import { ConfidentialClientApplication } from '@azure/msal-node';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';

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

function cleanExcelValue(value: unknown): string | number | boolean {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

export function extractSharepointRows(fileBuffer: Buffer): Array<Array<string | number | boolean>> {
  const isZipWorkbook = fileBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const isLegacyWorkbook = fileBuffer.subarray(0, 8).equals(
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  );
  if (!isZipWorkbook && !isLegacyWorkbook) {
    throw new Error('El archivo no es un Excel .xlsx, .xlsm o .xls válido.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new Error('El archivo no es un Excel válido o está dañado.');
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('El archivo no contiene hojas.');

  const sourceSheet = workbook.Sheets[firstSheetName];
  if (!sourceSheet) throw new Error('No se pudo leer la primera hoja del archivo.');

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sourceSheet, {
    header: 1,
    range: 25,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const rows: Array<Array<string | number | boolean>> = [];
  for (const rawRow of rawRows) {
    const sourceValues = Array.from({ length: 45 }, (_, index) => rawRow[index] ?? null);
    if (sourceValues.every(value => value == null)) break;
    rows.push(sourceValues.map(cleanExcelValue));
  }

  if (!rows.length) throw new Error('No se encontraron datos desde la fila 26.');
  return rows;
}

/**
 * Replica la importación del proyecto Streamlit: lee la primera hoja desde la
 * fila 26, conserva las columnas A:AS y reemplaza el contenido de la hoja Data
 * del libro configurado en SharePoint mediante una sesión persistente de Excel.
 */
export async function uploadExcelToSharepoint(fileBuffer: Buffer): Promise<number> {
  if (!fileBuffer.length) throw new Error('El archivo Excel está vacío.');
  const rows = extractSharepointRows(fileBuffer);

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

  const sessionHeaders = { ...headers, 'workbook-session-id': session.id };
  const chunkSize = 200;

  const patchRange = async (startRow: number, values: Array<Array<string | number | boolean>>) => {
    const endRow = startRow + values.length - 1;
    const address = `Data!A${startRow}:AS${endRow}`;
    await graphRequest(
      `${workbookUrl}/worksheets/Data/range(address='${address}')`,
      { method: 'PATCH', headers: sessionHeaders, body: JSON.stringify({ values }) },
      120_000,
    );
  };

  try {
    const usedRangeRes = await graphRequest(
      `${workbookUrl}/worksheets/Data/usedRange`,
      { headers: sessionHeaders },
      30_000,
    );
    const usedRange = await usedRangeRes.json() as { rowCount?: number };
    const currentRowCount = Math.max(0, Number(usedRange.rowCount) || 0);

    for (let start = 1; start <= currentRowCount; start += chunkSize) {
      const count = Math.min(chunkSize, currentRowCount - start + 1);
      await patchRange(start, Array.from({ length: count }, () => Array(45).fill('')));
    }

    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      await patchRange(offset + 1, rows.slice(offset, offset + chunkSize));
    }
  } finally {
    await fetch(`${workbookUrl}/closeSession`, {
      method: 'POST',
      headers: sessionHeaders,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  }

  return rows.length;
}
