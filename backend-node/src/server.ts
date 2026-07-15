import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
dotenv.config();

import { getSupabaseData, getDevolucionesData } from './supabase';
import { cargarDatos, cargarGasolina, cargarNomina, invalidateDashboardCache } from './data_processing';
import {
  cancelChunkedSharepointImport,
  finishChunkedSharepointImport,
  startChunkedSharepointImport,
  writeSharepointImportChunk,
} from './sharepoint';
import type { SharepointChunkImport } from './sharepoint';

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

let GLOBAL_DATA: any = null;
type ActiveImport = {
  context: SharepointChunkImport;
  lastActivity: number;
};
const activeImports = new Map<string, ActiveImport>();
let activeImportId: string | null = null;
const IMPORT_EXPIRATION_MS = 20 * 60 * 1000;

async function initData() {
  console.log("Loading dashboard data...");
  try {
    const mainData = await cargarDatos();
    const gasData = await cargarGasolina();
    const nomData = await cargarNomina();
    
    GLOBAL_DATA = {
      ...mainData,
      ...gasData,
      ...nomData
    };
    console.log("Data loaded successfully.");
  } catch (e) {
    console.error("Error loading initial data:", e);
  }
}

// Start loading in the background
initData();

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/dashboard-data', (req, res) => {
  if (!GLOBAL_DATA) {
    return res.status(503).json({ error: 'Data is still loading. Please try again later.' });
  }
  res.json(GLOBAL_DATA);
});

app.get('/api/supabase-data', async (req, res) => {
  try {
    const data = await getSupabaseData();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/devoluciones', async (req, res) => {
  try {
    const data = await getDevolucionesData();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload-excel/start', async (req, res) => {
  try {
    if (activeImportId) {
      const active = activeImports.get(activeImportId);
      if (active && Date.now() - active.lastActivity < IMPORT_EXPIRATION_MS) {
        return res.status(409).json({ error: 'Ya hay una importación en proceso. Espera a que termine.' });
      }
      if (active) await cancelChunkedSharepointImport(active.context);
      activeImports.delete(activeImportId);
      activeImportId = null;
    }

    const totalRows = Number(req.body?.totalRows);
    const context = await startChunkedSharepointImport(totalRows, req.body?.header);
    const uploadId = randomUUID();
    activeImports.set(uploadId, { context, lastActivity: Date.now() });
    activeImportId = uploadId;
    res.json({ uploadId, totalRows, chunkSize: 500, tableName: context.tableName });
  } catch (e: any) {
    console.error('Error al iniciar importación:', e);
    res.status(500).json({ error: e.message || 'No se pudo iniciar la importación.' });
  }
});

app.post('/api/upload-excel/chunk', async (req, res) => {
  try {
    const uploadId = String(req.body?.uploadId || '');
    const active = activeImports.get(uploadId);
    if (!active || uploadId !== activeImportId) {
      return res.status(404).json({ error: 'La sesión de importación ya no está disponible.' });
    }
    const writtenThrough = await writeSharepointImportChunk(
      active.context,
      Number(req.body?.startRow),
      req.body?.rows,
    );
    active.lastActivity = Date.now();
    res.json({ writtenThrough, totalRows: active.context.totalRows });
  } catch (e: any) {
    console.error('Error al escribir bloque de importación:', e);
    res.status(500).json({ error: e.message || 'No se pudo escribir el bloque.' });
  }
});

app.post('/api/upload-excel/finish', async (req, res) => {
  const uploadId = String(req.body?.uploadId || '');
  const active = activeImports.get(uploadId);
  if (!active || uploadId !== activeImportId) {
    return res.status(404).json({ error: 'La sesión de importación ya no está disponible.' });
  }
  try {
    await finishChunkedSharepointImport(active.context);
    activeImports.delete(uploadId);
    activeImportId = null;

    invalidateDashboardCache();
    let refreshed = true;
    try {
      const refreshedMainData = await cargarDatos();
      GLOBAL_DATA = { ...(GLOBAL_DATA || {}), ...refreshedMainData };
    } catch (refreshError) {
      refreshed = false;
      console.error('La importación terminó, pero no se pudo refrescar el dashboard:', refreshError);
    }
    res.json({
      message: `¡Listo! ${active.context.totalRows} filas escritas en SharePoint (Tabla4).`,
      rowCount: active.context.totalRows,
      refreshed,
    });
  } catch (e: any) {
    console.error('Error al finalizar importación:', e);
    res.status(500).json({ error: e.message || 'No se pudo finalizar la importación.' });
  }
});

app.post('/api/upload-excel/cancel', async (req, res) => {
  const uploadId = String(req.body?.uploadId || '');
  const active = activeImports.get(uploadId);
  if (active) await cancelChunkedSharepointImport(active.context);
  activeImports.delete(uploadId);
  if (activeImportId === uploadId) activeImportId = null;
  res.status(204).send();
});

app.post('/api/upload-excel', (_req, res) => {
  res.status(410).json({ error: 'Actualiza la página para utilizar la importación por bloques.' });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Node backend running on port ${PORT}`);
});
