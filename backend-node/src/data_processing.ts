import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { downloadExcelSharepoint, getSharepointFileMeta, downloadViaGraphSharedLink } from './sharepoint';

const CACHE_DIR = path.join(__dirname, '..', '.wa123_cache');
const CACHE_LATEST = path.join(CACHE_DIR, 'data_latest.json');

export function invalidateDashboardCache(): void {
  try {
    if (fs.existsSync(CACHE_LATEST)) fs.unlinkSync(CACHE_LATEST);
  } catch (error) {
    console.warn('No se pudo eliminar el caché principal del dashboard.', error);
  }
}

const VEHICULOS_GASOLINA = ['FORD / TRANSIT 250 / 2020', 'FORD / TRANSIT / 2019'];
const GASOLINA_SHARED_LINK = "https://pacificafarms-my.sharepoint.com/:x:/g/personal/anahi_mora_cfbc_co/IQANE_rjNbe-T5n5XZuwt3FwAa9dla1RGnbl1oC9PGuNO-o?e=x7qeXl";
const NOMINA_SHARED_LINK = "https://pacificafarms-my.sharepoint.com/:x:/g/personal/anahi_mora_cfbc_co/IQAQCb79SzHtRrTQR71pSNQcAT7r1BbxaVtGuiSy1lUzZOY?e=hxAq81&download=1";

function parseExcelDate(v: any): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 0) {
    return new Date((v - 25569) * 86400 * 1000 + new Date().getTimezoneOffset() * 60000);
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function sv(val: any): number {
  if (val == null || val === '') return 0.0;
  const num = parseFloat(val);
  return isNaN(num) ? 0.0 : num;
}

function getISOWeekInfo(d: Date): { year: number, week: number } {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return { year: date.getFullYear(), week };
}

function formatDateStr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateYMD(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${yyyy}/${mm}/${dd}`;
}

export async function cargarGasolina(): Promise<any> {
  try {
    const buffer = await downloadViaGraphSharedLink(GASOLINA_SHARED_LINK);
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find(s => s.toLowerCase() === 'base datos') || wb.SheetNames[0];
    if (!sheetName) throw new Error('El archivo de gasolina no contiene hojas.');
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`No se pudo leer la hoja ${sheetName}.`);
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

    const COL_FECHA = 5, COL_TOTAL = 11, COL_VEH = 17;
    const resultado: any = {};
    VEHICULOS_GASOLINA.forEach(v => resultado[v] = {});
    const semanasSet = new Set<number>();

    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length <= Math.max(COL_FECHA, COL_TOTAL, COL_VEH)) continue;
      
      const vehiculo = String(row[COL_VEH] || '').trim();
      if (!VEHICULOS_GASOLINA.includes(vehiculo)) continue;
      
      const date = parseExcelDate(row[COL_FECHA]);
      if (!date) continue;
      
      const total = sv(row[COL_TOTAL]);
      const iso = getISOWeekInfo(date);
      const sem = iso.year * 100 + iso.week;
      
      resultado[vehiculo][sem] = (resultado[vehiculo][sem] || 0) + total;
      semanasSet.add(sem);
    }
    
    return {
      gasolina_por_vehiculo: resultado,
      gasolina_semanas: Array.from(semanasSet).sort((a: any, b: any) => a - b),
      vehiculos_gasolina: VEHICULOS_GASOLINA
    };
  } catch (e) {
    console.error("Error cargarGasolina", e);
    return { gasolina_por_vehiculo: {}, gasolina_semanas: [], vehiculos_gasolina: VEHICULOS_GASOLINA };
  }
}

export async function cargarNomina(): Promise<any> {
  try {
    const buffer = await downloadViaGraphSharedLink(NOMINA_SHARED_LINK);
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const resultado: any = {};
    const semanasSet = new Set<number>();

    for (const sname of wb.SheetNames) {
      const clean = sname.trim().toUpperCase();
      if (clean.startsWith('WK')) {
        const match = clean.match(/\d+/);
        if (match) {
          const numStr = match[0];
          if (numStr.length >= 4) {
            const yy = parseInt(numStr.substring(0, 2), 10);
            const ww = parseInt(numStr.substring(2, 4), 10);
            const yyyy = yy < 100 ? 2000 + yy : yy;
            const semKey = yyyy * 100 + ww;
            
            const ws = wb.Sheets[sname];
            if (!ws) continue;
            const cellRef = XLSX.utils.encode_cell({ r: 47, c: 5 });
            const cell = ws[cellRef];
            const val = cell ? sv(cell.v) : 0;
            
            resultado[semKey] = val;
            semanasSet.add(semKey);
          }
        }
      }
    }
    
    return {
      nomina_data: resultado,
      nomina_semanas: Array.from(semanasSet).sort((a: any, b: any) => a - b)
    };
  } catch (e) {
    console.error("Error cargarNomina", e);
    return { nomina_data: {}, nomina_semanas: [] };
  }
}

export async function cargarDatos(cacheKey = "") {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  let sourceLastModified = "";

  const withSourceMeta = (data: any) => {
    if (sourceLastModified) data._source_last_modified = sourceLastModified;
    return data;
  };

  // Ask SharePoint for the current file version before trusting a local cache.
  // Previously data_latest.json was returned immediately, so it could remain
  // stale forever even after Analisis Walmart.xlsx had changed.
  if (!cacheKey) {
    try {
      const meta = await getSharepointFileMeta();
      cacheKey = meta.cacheKey || "";
      sourceLastModified = meta.lastModified || "";
    } catch (e) {
      console.warn("No se pudo validar la versión en SharePoint; se intentará usar el último caché local.", e);
    }
  }
  
  if (cacheKey) {
    const p = path.join(CACHE_DIR, `data_${cacheKey}.json`);
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (d.resumen_diario) return withSourceMeta(d);
      } catch (e) {}
    }
  }

  if (fs.existsSync(CACHE_LATEST)) {
    try {
      const d = JSON.parse(fs.readFileSync(CACHE_LATEST, 'utf-8'));
      if (d.resumen_diario && (!cacheKey || d._source_cache_key === cacheKey)) return withSourceMeta(d);
    } catch (e) {}
  }

  // If SharePoint metadata was unavailable, allow the latest valid cache as a
  // temporary fallback. Otherwise, only the cache matching the current remote
  // version is accepted.
  if (!cacheKey && fs.existsSync(CACHE_LATEST)) {
    try {
      const d = JSON.parse(fs.readFileSync(CACHE_LATEST, 'utf-8'));
      if (d.resumen_diario) return withSourceMeta(d);
    } catch (e) {}
  }

  const { localPath, cacheKey: downloadedCacheKey } = await downloadExcelSharepoint();
  cacheKey = cacheKey || downloadedCacheKey;

  const dataCacheFile = path.join(CACHE_DIR, `data_${cacheKey}.json`);
  if (fs.existsSync(dataCacheFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(dataCacheFile, 'utf-8'));
      fs.writeFileSync(CACHE_LATEST, JSON.stringify(d));
      return withSourceMeta(d);
    } catch (e) {}
  }

  const wb = XLSX.readFile(localPath);
  const ws = wb.Sheets['Data'];
  if (!ws) throw new Error("No sheet 'Data'");

  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
  const headers = (rows[0] || []).map(h => String(h || '').trim());
  const col = (name: string) => {
    const idx = headers.indexOf(name);
    return idx;
  };
  
  const idxProd = col('Desc Art 1');
  const idxTienda = col('Nombre Tienda/Club');
  const idxSemana = col('SEM');
  const idxFecha = col('Diario');
  const idxVentas = col('Cnt POS');
  const idxEmbarque = col('Cntd Embarque');
  const idxMerma = col('Cant VC Tienda');

  const findCol = (names: string[]) => {
    for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i; }
    return -1;
  }
  const idxVentaCfbc = findCol(['Venta CFBC / Costo (Facturado)', 'Venta CFBC/Costo (Facturado)', 'Venta CFBC', 'CFBC']);
  const idxVentaWmx = findCol(['Venta WMX / Precio Costo (Vendido)', 'Venta WMX/Precio Costo (Vendido)', 'Venta WMX', 'WMX']);
  const idxRetailVc = findCol(['Costo VC Tienda', 'Suma de Retail VC Tienda', 'Retail VC Tienda', 'Suma Retail VC Tienda', 'Retail VC', 'Suma de Retail VC', 'Suma de Retail VC Tienda ']);
  const idxInventario = findCol(['Cantidad Actual en Existentes de la tienda', 'Cantidad Actual en Existentes', 'Cantidad Actual', 'Inventario Actual', 'Existentes']);
  const idxVentaPos = findCol(['Venta POS']);
  const idxField1 = findCol(['Field1']);

  const dias = ['Sab', 'Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie'];
  const ctdNombres: any = {'Sab': 'Cnt Sab', 'Dom': 'Ctd Dom', 'Lun': 'Ctd Lun', 'Mar': 'Ctd Mar', 'Mie': 'Ctd Mie', 'Jue': 'Ctd Jue', 'Vie': 'Ctd Vie'};
  const idxCtd: any = {}, idxVtas: any = {};
  for (const d of dias) {
    idxCtd[d] = findCol([ctdNombres[d]]);
    idxVtas[d] = findCol([`Ventas ${d}`]);
  }

  const records: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[idxProd] || !row[idxTienda] || !row[idxSemana]) continue;
    
    const p = String(row[idxProd]).trim();
    const t = String(row[idxTienda]).trim();
    const semNum = parseInt(row[idxSemana], 10);
    if (!p || !t || isNaN(semNum)) continue;
    
    const rawF = row[idxFecha];
    let anio = null, fecha = '', fechaYmd = '';
    const dateObj = parseExcelDate(rawF);
    if (dateObj) {
      anio = dateObj.getFullYear();
      fecha = formatDateStr(dateObj);
      fechaYmd = formatDateYMD(dateObj);
    } else if (rawF) {
      fecha = String(rawF).trim();
      fechaYmd = fecha;
    }
    
    const rec: any = {
      producto: p, tienda: t, _semana_num: semNum, _anio: anio,
      semana: anio ? anio * 100 + semNum : semNum,
      fecha, fecha_ymd: fechaYmd,
      ventas_u: sv(row[idxVentas]),
      embarque_u: sv(row[idxEmbarque]),
      merma_u: sv(row[idxMerma]),
      venta_cfbc: idxVentaCfbc >= 0 ? sv(row[idxVentaCfbc]) : 0,
      venta_wmx: idxVentaWmx >= 0 ? sv(row[idxVentaWmx]) : 0,
      venta_pos: idxVentaPos >= 0 ? sv(row[idxVentaPos]) : 0,
      field1: idxField1 >= 0 ? sv(row[idxField1]) : 0,
      retail_vc: idxRetailVc >= 0 ? sv(row[idxRetailVc]) : 0,
      inventario: idxInventario >= 0 ? sv(row[idxInventario]) : 0,
    };
    for (const d of dias) {
      rec[`ctd_${d.toLowerCase()}`] = idxCtd[d] >= 0 ? sv(row[idxCtd[d]]) : 0;
      rec[`vtas_${d.toLowerCase()}`] = idxVtas[d] >= 0 ? sv(row[idxVtas[d]]) : 0;
    }
    records.push(rec);
  }

  const semanas = Array.from(new Set(records.map(r => r.semana))).sort((a: any, b: any) => a - b);
  const tiendas = Array.from(new Set(records.map(r => r.tienda))).sort();
  const productos = Array.from(new Set(records.map(r => r.producto))).sort();

  const byStp: any = {};
  const fechaPorSemana: any = {};
  const totalesTienda: any = {};
  const rawSemana: any = {};
  const totalesProdTienda: any = {};
  const resumenDiario: any = {};
  const weekStartsToSemana: any = {};

  for (const r of records) {
    const sem = r.semana, t = r.tienda, p = r.producto;
    
    if (!byStp[sem]) byStp[sem] = {};
    if (!byStp[sem][t]) byStp[sem][t] = {};
    if (!byStp[sem][t][p]) byStp[sem][t][p] = { ventas_u: 0, embarque_u: 0, merma_u: 0, venta_cfbc: 0, venta_wmx: 0, retail_vc: 0, inventario: 0 };
    const b = byStp[sem][t][p];
    b.ventas_u += r.ventas_u; b.embarque_u += r.embarque_u; b.merma_u += r.merma_u;
    b.venta_cfbc += r.venta_cfbc; b.venta_wmx += r.venta_wmx; b.retail_vc += r.retail_vc; b.inventario += r.inventario;
    for (const d of dias) {
      const kl = d.toLowerCase();
      b[`ctd_${kl}`] = (b[`ctd_${kl}`] || 0) + r[`ctd_${kl}`];
      b[`vtas_${kl}`] = (b[`vtas_${kl}`] || 0) + r[`vtas_${kl}`];
    }
    
    if (r.fecha) fechaPorSemana[sem] = r.fecha;
    if (r.fecha && r.semana) {
      const dtParts = r.fecha.split('/'); 
      if (dtParts.length === 3) {
        const dateObj = new Date(parseInt(dtParts[2]), parseInt(dtParts[1])-1, parseInt(dtParts[0]));
        if (!isNaN(dateObj.getTime())) {
            const wStart = new Date(dateObj);
            wStart.setDate(wStart.getDate() - wStart.getDay()); 
            weekStartsToSemana[formatDateYMD(wStart)] = r.semana;
        }
      }
    }

    if (!totalesTienda[t]) totalesTienda[t] = { embarque_u:0, venta_cfbc:0, venta_wmx:0, merma_u:0, retail_vc:0, inventario:0, ventas_u:0 };
    const tt = totalesTienda[t];
    tt.embarque_u += r.embarque_u; tt.venta_cfbc += r.venta_cfbc; tt.venta_wmx += r.venta_wmx;
    tt.merma_u += r.merma_u; tt.retail_vc += r.retail_vc; tt.inventario += r.inventario; tt.ventas_u += r.ventas_u;
    
    if (!rawSemana[t]) rawSemana[t] = {};
    if (!rawSemana[t][sem]) rawSemana[t][sem] = { embarque_u:0, venta_cfbc:0, venta_wmx:0, merma_u:0, retail_vc:0, inventario:0, ventas_u:0 };
    const rs = rawSemana[t][sem];
    rs.embarque_u += r.embarque_u; rs.venta_cfbc += r.venta_cfbc; rs.venta_wmx += r.venta_wmx;
    rs.merma_u += r.merma_u; rs.retail_vc += r.retail_vc; rs.inventario += r.inventario; rs.ventas_u += r.ventas_u;
    
    if (!totalesProdTienda[t]) totalesProdTienda[t] = {};
    if (!totalesProdTienda[t][p]) totalesProdTienda[t][p] = { embarque_u:0, venta_cfbc:0, venta_wmx:0, merma_u:0, retail_vc:0, inventario:0, ventas_u:0 };
    const tp = totalesProdTienda[t][p];
    tp.embarque_u += r.embarque_u; tp.venta_cfbc += r.venta_cfbc; tp.venta_wmx += r.venta_wmx;
    tp.merma_u += r.merma_u; tp.retail_vc += r.retail_vc; tp.inventario += r.inventario; tp.ventas_u += r.ventas_u;
    for (const d of dias) {
      const kl = d.toLowerCase();
      tp[`ctd_${kl}`] = (tp[`ctd_${kl}`] || 0) + r[`ctd_${kl}`];
      tp[`vtas_${kl}`] = (tp[`vtas_${kl}`] || 0) + r[`vtas_${kl}`];
    }
    
    if (r.fecha_ymd) {
      if (!resumenDiario[t]) resumenDiario[t] = {};
      if (!resumenDiario[t][sem]) resumenDiario[t][sem] = {};
      if (!resumenDiario[t][sem][p]) resumenDiario[t][sem][p] = {};
      if (!resumenDiario[t][sem][p][r.fecha_ymd]) resumenDiario[t][sem][p][r.fecha_ymd] = { embarque:0, ventas:0, merma:0, venta_pos:0, venta_cfbc:0, field1:0, inventario:0 };
      const rd = resumenDiario[t][sem][p][r.fecha_ymd];
      rd.embarque += r.embarque_u; rd.ventas += r.ventas_u; rd.merma += r.merma_u; rd.venta_pos += r.venta_pos;
      rd.venta_cfbc += r.venta_cfbc; rd.field1 += r.field1; rd.inventario += r.inventario;
    }
  }

  const data: any = {};
  for (const t of tiendas) {
    data[t] = {};
    for (const s of semanas) {
      const idx = semanas.indexOf(s);
      const last12 = semanas.slice(Math.max(0, idx - 11), idx + 1);
      const last3 = semanas.slice(Math.max(0, idx - 2), idx + 1);
      const prodData: any = {};
      for (const p of productos) {
        let v12=0, v3=0, emb3=0, m3=0, cfbc3=0, retail3=0, wmx3=0;
        for (const sem of last12) v12 += (byStp[sem]?.[t]?.[p]?.ventas_u || 0);
        for (const sem of last3) {
          const b = byStp[sem]?.[t]?.[p] || {};
          v3 += (b.ventas_u || 0); emb3 += (b.embarque_u || 0); m3 += (b.merma_u || 0);
          cfbc3 += (b.venta_cfbc || 0); retail3 += (b.retail_vc || 0); wmx3 += (b.venta_wmx || 0);
        }
        const avg = v3 / 3;
        const mermaRatio = emb3 > 0 ? m3 / emb3 : 0;
        const proj = mermaRatio < 1 ? avg / (1 - mermaRatio) : avg;
        
        prodData[p] = {
          v12: Math.round(v12), v3: Math.round(v3), n12: Math.min(Number(s) % 100, 12),
          emb: Math.round(emb3), m3: Math.round(m3), avg: Math.round(avg * 10) / 10,
          proj: Math.round(proj), pct_merma: emb3 > 0 ? Math.round((m3/emb3)*100) : 0,
          cfbc: Math.round(cfbc3), retail: Math.round(retail3), wmx: Math.round(wmx3)
        };
      }
      data[t][s] = prodData;
    }
  }

  const inventarioPorTienda: any = {};
  for (const t of tiendas) {
    let totalInv = 0;
    const prods: any = {};
    for (const p of productos) {
      const inv = totalesProdTienda[t]?.[p]?.inventario || 0;
      totalInv += inv;
      if (inv > 0) prods[p] = Math.round(inv);
    }
    inventarioPorTienda[t] = { total: Math.round(totalInv), productos: prods };
  }

  const inventarioPorProducto: any = {};
  for (const p of productos) {
    let totalInv = 0;
    const ts: any = {};
    for (const t of tiendas) {
      const inv = totalesProdTienda[t]?.[p]?.inventario || 0;
      totalInv += inv;
      if (inv > 0) ts[t] = Math.round(inv);
    }
    inventarioPorProducto[p] = { total: Math.round(totalInv), tiendas: ts };
  }

  const rawProdSemana: any = {};
  for (const t of tiendas) {
    rawProdSemana[t] = {};
    for (const s of semanas) {
      rawProdSemana[t][s] = {};
      for (const p of productos) {
        const d = byStp[s]?.[t]?.[p] || {};
        const keys = ['ventas_u','venta_cfbc','venta_wmx','merma_u','retail_vc','embarque_u','inventario','ctd_sab','ctd_dom','ctd_lun','ctd_mar','ctd_mie','ctd_jue','ctd_vie'];
        if (keys.some(k => d[k] > 0)) {
          const r: any = {};
          keys.forEach(k => r[k] = Math.round(d[k] || 0));
          ['dom','lun','mar','mie','jue','vie','sab'].forEach(d_str => {
             r[`vtas_${d_str}`] = Math.round(d[`vtas_${d_str}`] || 0);
          });
          rawProdSemana[t][s][p] = r;
        }
      }
    }
  }

  
  const PRODUCTO_GASTO: any = {
      'BQT ALSTROEMERI 8T': 15.00,
      'BQT GIRASOL 6T': 10.00,
      'BQT LILI ASIATIC 6T': 15.00,
      'BQT MINI CLAVEL 8T': 15.00,
      'BQT MIXTO 12T': 23.00,
      'BQT MIXTO 15T': 23.00,
      'BQT MIXTO 18 T': 10.00,
      'BQT MIXTO 9T': 15.00,
      'BQT ROSAS 12T': 20.00,
      'BQT ROSAS 12T BAJA': 20.00,
      'BQT ROSAS 6T': 15.00,
      'BQT SNAPDRAGON 8T': 10.00,
      'BQT ROSAS 6T BAJA': 10.00
  };

  const TIENDA_RUTA: any = {
      'SC LOMAS DE SANTA FE': 'Rutas Playas',
      'SC ENSENADA CENTRO': 'ENS',
      'SC ENSENADA': 'ENS',
      'SC ROSARITO': 'Rutas Playas',
      'SC PLAYAS DE TIJUANA': 'Rutas Playas',
      'SC MACROPLAZA INSURGENTES': 'Ruta 2000',
      'SC DIAZ ORDAZ': 'Ruta 2000',
      'SC TIJUANA HIPODROMO': 'Ruta 2000',
      'SC PACIFICO': 'Rutas Playas',
      'SC TIJUANA 2000': 'Ruta 2000',
      'SC MEXICALI NOVENA': 'MXL 1',
      'SC PLAZA SAN PEDRO': 'MXL 1',
      'SC GALERIAS DEL VALLE': 'MXL 1',
      'SC MEXICALI': 'MXL 1',
      'SC TECATE GARITA': 'Ruta 2000',
      'SC NUEVO MEXICALI': 'MXL 1'
  };

  const gastoData: any = {};
  for (const r of records) {
    const ruta = TIENDA_RUTA[r.tienda];
    const gasto = PRODUCTO_GASTO[r.producto] || 0;
    if (ruta && gasto > 0) {
      if (!gastoData[ruta]) gastoData[ruta] = {};
      if (!gastoData[ruta][r.semana]) gastoData[ruta][r.semana] = {};
      gastoData[ruta][r.semana][r.producto] = (gastoData[ruta][r.semana][r.producto] || 0) + r.embarque_u;
    }
  }

  let wsDetalle = null;
  let wsGastos = null;
  let wsReporteGastosApp = null;
  for (const sheetName of wb.SheetNames) {
    if (sheetName.trim().toLowerCase() === 'detalle') wsDetalle = wb.Sheets[sheetName];
    if (sheetName.trim().toLowerCase() === 'gastos') wsGastos = wb.Sheets[sheetName];
    if (sheetName.trim().toLowerCase() === 'reporte-gastosapp') wsReporteGastosApp = wb.Sheets[sheetName];
  }

  const detalleInventario = { fechas: [] as string[], fechas_por_semana: {} as any, fecha_to_semana: {} as any, data: {} as any };
  if (wsDetalle) {
    const detRows = XLSX.utils.sheet_to_json<any[]>(wsDetalle, { header: 1 });
    const detHeaders = (detRows[0] || []).map(h => String(h || '').trim().toLowerCase());
    const idxTienda = detHeaders.indexOf('tienda');
    const idxFecha = detHeaders.indexOf('fecha');
    const idxProducto = detHeaders.indexOf('producto');
    const idxInventario = detHeaders.indexOf('inventario');

    if (idxTienda >= 0 && idxFecha >= 0 && idxProducto >= 0 && idxInventario >= 0) {
      const detData: any = {};
      const fechasSet = new Set<string>();
      const fechaToSemana: any = {};
      const fechasPorSemana: any = {};

      for (let i = 1; i < detRows.length; i++) {
        const row = detRows[i];
        if (!row) continue;
        const td = String(row[idxTienda] || '').trim();
        const pd2 = String(row[idxProducto] || '').trim();
        const invV = sv(row[idxInventario]);
        const fechaRaw = row[idxFecha];
        
        let fechaStr = '';
        let dateObj = parseExcelDate(fechaRaw);
        if (dateObj) {
            fechaStr = formatDateStr(dateObj); 
        } else if (fechaRaw) {
            fechaStr = String(fechaRaw).trim();
            dateObj = parseExcelDate(fechaStr);
        }

        if (td && pd2 && fechaStr) {
          fechasSet.add(fechaStr);
          if (!detData[td]) detData[td] = {};
          if (!detData[td][pd2]) detData[td][pd2] = {};
          detData[td][pd2][fechaStr] = (detData[td][pd2][fechaStr] || 0) + invV;

          if (dateObj && !fechaToSemana[fechaStr]) {
            const wStart = new Date(dateObj);
            wStart.setDate(wStart.getDate() - wStart.getDay());
            const wStartStr = formatDateYMD(wStart);
            const sem = weekStartsToSemana[wStartStr];
            if (sem) {
              fechaToSemana[fechaStr] = sem;
              if (!fechasPorSemana[sem]) fechasPorSemana[sem] = [];
              if (!fechasPorSemana[sem].includes(fechaStr)) fechasPorSemana[sem].push(fechaStr);
            }
          }
        }
      }

      detalleInventario.fechas = Array.from(fechasSet).sort();
      detalleInventario.fechas_por_semana = fechasPorSemana;
      detalleInventario.fecha_to_semana = fechaToSemana;
      detalleInventario.data = detData;
    }
  }

  const gastosOtros: any = {};
  const gastosTipos: string[] = [];
  const gastosSc: string[] = [];
  const corteReporteGastosApp = new Date(2026, 5, 29);

  const agregarGasto = (ruta: string, concepto: string, semKey: any, monto: number) => {
    if (!ruta || !concepto || !semKey || monto <= 0) return;
    if (!gastosSc.includes(ruta)) gastosSc.push(ruta);
    if (!gastosTipos.includes(concepto)) gastosTipos.push(concepto);
    if (!gastosOtros[ruta]) gastosOtros[ruta] = {};
    if (!gastosOtros[ruta][concepto]) gastosOtros[ruta][concepto] = {};
    gastosOtros[ruta][concepto][semKey] = (gastosOtros[ruta][concepto][semKey] || 0) + monto;
  };

  if (wsGastos) {
    const gasRows = XLSX.utils.sheet_to_json<any[]>(wsGastos, { header: 1 });
    const gasHeaders = (gasRows[0] || []).map(h => String(h || '').trim());
    
    const gastoCols = [];
    for (let i = 2; i < gasHeaders.length; i++) {
        if (gasHeaders[i]) gastoCols.push({ idx: i, h: gasHeaders[i] });
    }

    const _conceptoGasto = (tipo: string, detSc: string) => {
        const tl = tipo.toLowerCase();
        if (tl === 'viaje / caseta') return 'VIATICOS_CASETAS';
        if (tl === 'gasolina / diésel') return 'GASOLINA';
        if (tl.includes('merma')) return 'MERMA_BODEGA';
        if (tl.includes('renta')) return 'RENTA_BODEGA';
        if (tl.includes('nomina') || tl.includes('nómina')) return 'NOMINA_BODEGA';
        if (tl.includes('empaque')) return 'EMPAQUE_INSUMOS';
        return tipo.toUpperCase();
    };

    for (let i = 1; i < gasRows.length; i++) {
      const row = gasRows[i];
      if (!row) continue;
      
      const dtObj = parseExcelDate(row[0]);
      // La hoja anterior conserva únicamente el histórico hasta junio de 2026.
      if (dtObj && dtObj >= corteReporteGastosApp) continue;
      let semKey = null;
      if (dtObj) {
          const wStart = new Date(dtObj);
          wStart.setDate(wStart.getDate() - wStart.getDay());
          const wStartStr = formatDateYMD(wStart);
          semKey = weekStartsToSemana[wStartStr];
      }
      if (!semKey) continue;
      
      const sc = String(row[1] || '').trim();
      const scUpper = sc.toUpperCase();
      let finalSc = scUpper.startsWith('SC') ? scUpper : 'NA';
      let scDetalle = scUpper;
      if (scUpper.includes('TIJUANA') || scUpper.includes('PLAYAS') || scUpper.includes('PACIFICO') || scUpper.includes('ENSENADA') || scUpper.includes('TECATE') || scUpper.includes('ROSARITO') || scUpper.includes('LOMAS DE SANTA FE') || scUpper.includes('DIAZ ORDAZ')) {
          finalSc = 'TIJUANA';
      } else if (scUpper.includes('MEXICALI') || scUpper.includes('SAN PEDRO') || scUpper.includes('GALERIAS')) {
          finalSc = 'MEXICALI';
      } else if (!scUpper.startsWith('SC') && scUpper !== '') {
          finalSc = scUpper;
      }
      
      for (const gc of gastoCols) {
         const monto = sv(row[gc.idx]);
         if (monto > 0) {
            const concepto = _conceptoGasto(gc.h || '', scDetalle);
            agregarGasto(finalSc, concepto, semKey, monto);
         }
      }
    }
  }

  // Desde el 29 de junio de 2026, Otros Gastos se obtiene de REPORTE-GASTOSAPP.
  // Columnas utilizadas: Tienda, Fecha del Gasto, Categoria y Monto.
  if (wsReporteGastosApp) {
    const appRows = XLSX.utils.sheet_to_json<any[]>(wsReporteGastosApp, { header: 1 });
    const normalizar = (value: any) => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const parseFechaGastoApp = (value: any) => {
      // Las fechas numéricas ahora vienen en formato normal en Excel
      if (typeof value === 'number') {
        const excelDate = new Date(Math.round((value - 25569) * 86400 * 1000));
        if (isNaN(excelDate.getTime())) return null;
        const day = excelDate.getUTCDate();
        const month = excelDate.getUTCMonth() + 1;
        const year = excelDate.getUTCFullYear();
        const corrected = new Date(year, month - 1, day);
        if (corrected.getFullYear() === year && corrected.getMonth() === month - 1 && corrected.getDate() === day) return corrected;
        return null;
      }
      if (typeof value === 'string') {
        const match = value.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (match) {
          const day = Number(match[1]);
          const month = Number(match[2]);
          const year = Number(match[3]);
          const parsed = new Date(year, month - 1, day);
          if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) return parsed;
          return null;
        }
      }
      return parseExcelDate(value);
    };
    const appHeaders = (appRows[0] || []).map(normalizar);
    const idxAppTienda = appHeaders.indexOf('TIENDA');
    const idxAppFechaGasto = appHeaders.indexOf('FECHA DEL GASTO');
    const idxAppCategoria = appHeaders.indexOf('CATEGORIA');
    const idxAppMonto = appHeaders.indexOf('MONTO');

    const rutaDesdeTienda = (value: any) => {
      const raw = String(value || '').trim();
      const key = normalizar(raw).replace(/\s+/g, ' ');
      if (key === 'MEXICALI' || key === 'MXL' || key === 'MXL 1' || key === 'MXL1') return 'MXL 1';
      if (key === 'RUTA 2000' || key === 'RUTA2000') return 'Ruta 2000';
      if (key === 'RUTAS PLAYAS' || key === 'RUTA PLAYAS' || key === 'PLAYAS') return 'Rutas Playas';
      if (key === 'ENS' || key === 'ENSENADA') return 'ENS';
      return raw;
    };

    if (idxAppTienda >= 0 && idxAppFechaGasto >= 0 && idxAppCategoria >= 0 && idxAppMonto >= 0) {
      for (let i = 1; i < appRows.length; i++) {
        const row = appRows[i];
        if (!row) continue;

        const fechaGasto = parseFechaGastoApp(row[idxAppFechaGasto]);
        // Ignorar registros de junio aunque se hayan capturado durante julio.
        if (!fechaGasto || fechaGasto < corteReporteGastosApp) continue;

        const monto = sv(row[idxAppMonto]);
        if (monto <= 0) continue;

        const ruta = rutaDesdeTienda(row[idxAppTienda]);
        const categoria = normalizar(row[idxAppCategoria]);
        if (!ruta || !categoria) continue;

        const wStart = new Date(fechaGasto);
        wStart.setDate(wStart.getDate() - wStart.getDay());
        const semKey = weekStartsToSemana[formatDateYMD(wStart)];
        if (!semKey) continue;

        agregarGasto(ruta, categoria, semKey, monto);
      }
    } else {
      console.warn('REPORTE-GASTOSAPP no contiene las columnas requeridas: Tienda, Fecha del Gasto, Categoria y Monto.');
    }
  }

  const resultDict = {

    _source_cache_key: cacheKey,
    _source_last_modified: sourceLastModified,
    semanas, tiendas, productos,
    fecha_por_semana: fechaPorSemana,
    semana_to_week_starts: weekStartsToSemana,
    data,
    totales_tienda: totalesTienda,
    raw_semana: rawSemana,
    raw_prod_semana: rawProdSemana,
    totales_prod_tienda: totalesProdTienda,
    resumen_diario: resumenDiario,
    resumen_has_field1: idxField1 >= 0,
    inventario_por_tienda: inventarioPorTienda,
    inventario_por_producto: inventarioPorProducto,
    detalle_inventario: detalleInventario,
    producto_gasto: PRODUCTO_GASTO,
    tienda_ruta: TIENDA_RUTA,
    gasto_data: gastoData,
    gastos_otros: gastosOtros,
    gastos_tipos: gastosTipos,
    gastos_sc: gastosSc
  };

  try {
    fs.writeFileSync(dataCacheFile, JSON.stringify(resultDict));
    fs.writeFileSync(CACHE_LATEST, JSON.stringify(resultDict));
  } catch (e) {}

  return resultDict;
}
