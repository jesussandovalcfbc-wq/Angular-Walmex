import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { getSupabaseData, getDevolucionesData } from './supabase';
import { cargarDatos, cargarGasolina, cargarNomina, invalidateDashboardCache } from './data_processing';
import { uploadExcelToSharepoint } from './sharepoint';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

let GLOBAL_DATA: any = null;
let uploadInProgress = false;

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

app.post('/api/upload-excel', async (req, res) => {
  if (uploadInProgress) {
    return res.status(409).json({ error: 'Ya hay una importación en proceso. Espera a que termine.' });
  }

  uploadInProgress = true;
  try {
    const { content } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'No se recibió el contenido del archivo Excel.' });
    }

    const fileBuffer = Buffer.from(content, 'base64');
    const rowCount = await uploadExcelToSharepoint(fileBuffer);

    invalidateDashboardCache();
    const refreshedMainData = await cargarDatos();
    GLOBAL_DATA = { ...(GLOBAL_DATA || {}), ...refreshedMainData };

    res.json({
      message: `¡Listo! ${rowCount} filas escritas en SharePoint (hoja Data, A→AS).`,
      rowCount,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    uploadInProgress = false;
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Node backend running on port ${PORT}`);
});
