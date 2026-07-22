import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import {
  getFacturasData,
  getDevolucionesData,
  restSelect,
  restInsert,
  restUpdate,
  restDelete,
  verifyDatabase
} from './database';
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

app.get('/api/db-health', async (_req, res) => {
  try {
    await verifyDatabase();
    res.status(200).json({ status: 'ok', database: 'neon' });
  } catch (error: any) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

app.get('/api/dashboard-data', (req, res) => {
  if (!GLOBAL_DATA) {
    return res.status(503).json({ error: 'Data is still loading. Please try again later.' });
  }
  res.json(GLOBAL_DATA);
});

app.get('/api/facturas-data', async (_req, res) => {
  try {
    const data = await getFacturasData();
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

app.all('/api/db/rest/v1/:table', async (req, res) => {
  try {
    const table = req.params.table;
    let data: any[];
    if (req.method === 'GET') data = await restSelect(table, req.query);
    else if (req.method === 'POST') data = await restInsert(table, req.query, req.body);
    else if (req.method === 'PATCH') data = await restUpdate(table, req.query, req.body);
    else if (req.method === 'DELETE') data = await restDelete(table, req.query);
    else return res.status(405).json({ error: 'Metodo no permitido.' });
    res.status(req.method === 'POST' ? 201 : 200).json(data);
  } catch (error: any) {
    console.error('[Neon REST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/gemini-chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Gemini no está configurado en el servidor local.' });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const rawContext = typeof req.body?.context === 'string' ? req.body.context : '';
  const context = rawContext.slice(0, 700_000);
  console.log(`[Gemini] Contexto chars: ${rawContext.length} → truncado a ${context.length}`);
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];

  if (!message) {
    return res.status(400).json({ error: 'Escribe una consulta para Gemini.' });
  }
  if (!context) {
    return res.status(400).json({ error: 'No hay datos visibles para analizar con los filtros actuales.' });
  }

  const history = rawHistory
    .filter((item: any) => item && typeof item.content === 'string')
    .map((item: any) => ({
      role: item.role === 'assistant' || item.role === 'model' ? 'model' : 'user',
      parts: [{ text: item.content.slice(0, 8_000) }],
    }));

  const systemInstruction = `Eres el analista ejecutivo del tablero Walmex de Pacífica Farms.
Responde siempre en español claro, directo y administrativo. Analiza exclusivamente los datos proporcionados; jamás inventes cifras, tiendas, productos, semanas o causas.

Definiciones obligatorias:
- Ventas POS: unidades vendidas por Walmart al consumidor.
- Embarque: unidades realmente enviadas a Walmart.
- Sell Through: Ventas POS / Embarque; puede superar 100% por inventario previo, por lo que no representa por sí solo inventario físico.
- Merma: unidades reportadas como pérdida.
- Una semana parcial debe compararse contra los mismos días transcurridos de las semanas anteriores, no contra semanas completas.

Reglas de análisis:
1. Respeta los filtros actuales y menciona las semanas, tiendas o productos usados cuando ayude a entender la respuesta.
2. Para rankings o comparaciones, entrega cifras y diferencias; separa hechos, lectura y recomendación.
3. Si preguntan qué enviar o programar, presenta una sugerencia, no una certeza: usa venta POS reciente, tendencia por días comparables, embarques y riesgo de faltante. Aclara supuestos y nivel de confianza.
4. No confundas embarcado con vendido. No declares inventario disponible si no aparece en los datos.
5. Si falta información para responder con seguridad, dilo y especifica exactamente qué dato falta.
6. Prioriza respuestas breves, pero incluye evidencia suficiente para que un jefe pueda tomar una decisión.

TABLAS: Cuando el usuario pida una tabla o el análisis se preste para comparar varias métricas/filas, usa tablas Markdown con este formato exacto:
| Columna1 | Columna2 | Columna3 |
|----------|----------|----------|
| valor    | valor    | valor    |

GRÁFICAS: Cuando el usuario pida una gráfica o chart, responde con un bloque \`\`\`chart seguido de un JSON válido de Chart.js (tipo bar, line o pie) y ciérralo con \`\`\`. Solo incluye los campos: type, data (labels + datasets con label y data), y opcionalmente options.title. No uses colores ni estilos en el JSON (el sistema los aplica automáticamente). Ejemplo mínimo:
\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["Sem 27", "Sem 28", "Sem 29"],
    "datasets": [{"label": "Ventas POS", "data": [290, 320, 410]}]
  },
  "options": {"plugins": {"title": {"display": true, "text": "Ventas por semana"}}}
}
\`\`\`
Puedes combinar texto explicativo + tabla + gráfica en la misma respuesta.

DATOS ACTIVOS DEL TABLERO:
${context}`;

  try {
    const contents: any[] = [
      ...history,
      { role: 'user', parts: [{ text: message.slice(0, 8_000) }] },
    ];
    const answerParts: string[] = [];
    let finishReason = '';
    let continuationCount = 0;

    // Gemini 2.5 puede consumir el límite de salida en razonamiento interno. Para
    // este tablero necesitamos que el presupuesto se use en la respuesta visible.
    // Si aun así alcanza el límite, se solicita la continuación automáticamente.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 16_384,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );

      const payload: any = await geminiResponse.json().catch(() => ({}));
      if (!geminiResponse.ok) {
        const detail = payload?.error?.message || `Gemini respondió HTTP ${geminiResponse.status}.`;
        return res.status(geminiResponse.status).json({ error: detail });
      }

      const candidate = payload?.candidates?.[0];
      const partText = candidate?.content?.parts
        ?.map((part: any) => part?.text || '')
        .join('')
        .trim();
      finishReason = candidate?.finishReason || '';
      const usageTokens = payload?.usageMetadata;
      console.log(`[Gemini] attempt=${attempt} finishReason=${finishReason} partLen=${partText?.length ?? 0} usage=${JSON.stringify(usageTokens)}`);

      if (partText) {
        answerParts.push(partText);
      }

      // Continuar si el modelo se detuvo por límite de tokens
      const hitTokenLimit = finishReason === 'MAX_TOKENS' || finishReason === 'RECITATION';
      if (!hitTokenLimit || !partText) {
        break;
      }

      continuationCount += 1;
      contents.push(
        { role: 'model', parts: [{ text: partText }] },
        {
          role: 'user',
          parts: [{
            text: 'Continúa exactamente desde donde se interrumpió. No repitas lo anterior y termina la respuesta completa.',
          }],
        },
      );
    }

    let text = answerParts.join('\n').trim();

    if (!text) {
      return res.status(502).json({ error: 'Gemini no devolvió una respuesta utilizable.' });
    }

    // Si tras los reintentos sigue truncado, avisar al usuario
    const wasTruncated = finishReason === 'MAX_TOKENS' && continuationCount >= 2;
    if (wasTruncated) {
      text += '\n\n⚠️ *La respuesta fue muy larga y se cortó al límite máximo. Intenta una pregunta más específica o con menos semanas/tiendas activas.*';
    }

    console.log(`[Gemini] Respuesta final: ${text.length} chars, continuaciones: ${continuationCount}, finishReason: ${finishReason}`);
    console.log("=== RAW GEMINI OUTPUT ===");
    console.log(text);
    console.log("=========================");
    return res.json({ text, finishReason, continuationCount, wasTruncated });
  } catch (error: any) {
    console.error('Error consultando Gemini:', error);
    return res.status(502).json({ error: 'No se pudo conectar con Gemini desde el servidor local.' });
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
