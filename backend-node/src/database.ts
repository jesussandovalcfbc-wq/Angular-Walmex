import fs from 'fs';
import path from 'path';
import { Pool, types } from 'pg';

types.setTypeParser(1700, (value) => Number(value));

const TABLE_COLUMNS: Record<string, Set<string>> = {
  facturas_folios: new Set([
    'id', 'diario', 'ruta', 'viajes_por_ruta', 'prueba', 'sem', 'tienda', 'salida',
    'folio', 'producto', 'unidades', 'precio_unidad', 'venta_total', 'created_at',
    'url_factura', 'url_acuse', 'razon_sin_acuse'
  ]),
  facturas_canceladas: new Set([
    'id', 'diario', 'ruta', 'viajes_por_ruta', 'prueba', 'sem', 'tienda', 'salida',
    'folio', 'producto', 'unidades', 'precio_unidad', 'venta_total', 'created_at',
    'fecha_cancelacion', 'url_factura', 'url_acuse', 'razon_sin_acuse'
  ]),
  devoluciones: new Set([
    'id', 'created_at', 'folio', 'serie', 'producto', 'cantidad_devuelta',
    'precio_unidad', 'total_devolucion', 'razon_devolucion'
  ]),
  walmex_resumen_captura: new Set(['id', 'data', 'updated_at']),
  walmex_resumen_captura_v2: new Set([
    'id', 'mode', 'producto', 'tienda', 'semana', 'valores', 'updated_at'
  ])
};

function readCentralDatabaseUrl(): string {
  const envPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Yisus', 'Desktop', 'migration-secrets.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith('TARGET_DATABASE_URL='));
  return line ? line.slice('TARGET_DATABASE_URL='.length).trim() : '';
}

const connectionString = process.env.DATABASE_URL || process.env.TARGET_DATABASE_URL || readCentralDatabaseUrl();
if (!connectionString) {
  throw new Error('DATABASE_URL de Neon no esta configurada.');
}

// Neon entrega `sslmode=require`; pg 8 lo trata hoy como verificacion completa,
// pero avisa que esa semantica cambiara. Dejamos el modo explicito y seguro.
const secureConnectionString = connectionString.replace(/sslmode=require/gi, 'sslmode=verify-full');

export const pool = new Pool({
  connectionString: secureConnectionString,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  ssl: secureConnectionString.includes('sslmode=') ? undefined : { rejectUnauthorized: true }
});

function allowedTable(table: string): Set<string> {
  const columns = TABLE_COLUMNS[table];
  if (!columns) throw new Error('Tabla no permitida.');
  return columns;
}

function allowedColumn(table: string, column: string): string {
  if (!allowedTable(table).has(column)) throw new Error(`Columna no permitida: ${column}`);
  return column;
}

export async function getFacturasData(): Promise<any[]> {
  const result = await pool.query('SELECT * FROM facturas_folios ORDER BY id');
  return result.rows;
}

export async function getDevolucionesData(): Promise<any[]> {
  const result = await pool.query('SELECT * FROM devoluciones ORDER BY created_at DESC');
  return result.rows;
}

type InvoiceItemUpdate = {
  id: number;
  unidades: number;
};

export async function updateInvoice(
  folio: string,
  items: InvoiceItemUpdate[],
  reason: string
): Promise<any[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT * FROM facturas_folios WHERE folio = $1 ORDER BY id FOR UPDATE',
      [folio]
    );
    if (!current.rows.length) throw new Error('La factura ya no existe o fue cancelada.');

    const currentById = new Map(current.rows.map((row: any) => [Number(row.id), row]));
    if (items.length !== current.rows.length) {
      throw new Error('La factura cambio mientras se editaba. Actualiza la pagina e intenta nuevamente.');
    }

    const normalized = items.map((item) => {
      const id = Number(item.id);
      const unidades = Number(item.unidades);
      const row: any = currentById.get(id);
      if (!row) throw new Error('Uno de los productos ya no pertenece a esta factura.');
      if (!Number.isInteger(unidades) || unidades < 0) {
        throw new Error('Las unidades deben ser numeros enteros iguales o mayores a cero.');
      }
      return { id, unidades, row };
    });

    const hasReduction = normalized.some(({ unidades, row }) => unidades < Number(row.unidades || 0));
    if (hasReduction && !reason.trim()) throw new Error('Escribe el motivo de la reduccion.');

    for (const item of normalized) {
      const oldUnits = Number(item.row.unidades || 0);
      const unitPrice = Number(item.row.precio_unidad || 0);
      await client.query(
        'UPDATE facturas_folios SET unidades = $1, venta_total = $2 WHERE id = $3 AND folio = $4',
        [item.unidades, item.unidades * unitPrice, item.id, folio]
      );
      const returned = oldUnits - item.unidades;
      if (returned > 0) {
        await client.query(
          `INSERT INTO devoluciones
            (folio, serie, producto, cantidad_devuelta, precio_unidad, total_devolucion, razon_devolucion)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [folio, '', item.row.producto, returned, unitPrice, returned * unitPrice, reason.trim()]
        );
      }
    }

    const updated = await client.query(
      'SELECT * FROM facturas_folios WHERE folio = $1 ORDER BY id',
      [folio]
    );
    await client.query('COMMIT');
    return updated.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelInvoice(folio: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT * FROM facturas_folios WHERE folio = $1 ORDER BY id FOR UPDATE',
      [folio]
    );
    if (!current.rows.length) throw new Error('La factura ya no existe o ya fue cancelada.');

    await client.query(
      `INSERT INTO facturas_canceladas
        (diario, ruta, viajes_por_ruta, prueba, sem, tienda, salida, folio, producto,
         unidades, precio_unidad, venta_total, created_at, fecha_cancelacion,
         url_factura, url_acuse, razon_sin_acuse)
       SELECT diario, ruta, viajes_por_ruta, prueba, sem, tienda, salida, folio, producto,
         unidades, precio_unidad, venta_total, created_at, NOW(),
         url_factura, url_acuse, razon_sin_acuse
       FROM facturas_folios WHERE folio = $1`,
      [folio]
    );

    for (const row of current.rows) {
      const units = Number(row.unidades || 0);
      const unitPrice = Number(row.precio_unidad || 0);
      if (units <= 0) continue;
      await client.query(
        `INSERT INTO devoluciones
          (folio, serie, producto, cantidad_devuelta, precio_unidad, total_devolucion, razon_devolucion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [folio, '', row.producto, units, unitPrice, units * unitPrice, 'Cancelada automaticamente']
      );
    }

    const deleted = await client.query('DELETE FROM facturas_folios WHERE folio = $1', [folio]);
    await client.query('COMMIT');
    return deleted.rowCount || 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

type Filter = { column: string; operator: 'eq' | 'gt'; value: string };

function parseFilters(table: string, query: Record<string, any>): Filter[] {
  const ignored = new Set(['select', 'on_conflict', 'order', 'limit', 'offset']);
  const filters: Filter[] = [];
  for (const [column, raw] of Object.entries(query)) {
    if (ignored.has(column) || typeof raw !== 'string') continue;
    allowedColumn(table, column);
    const dot = raw.indexOf('.');
    if (dot <= 0) continue;
    const operator = raw.slice(0, dot);
    if (operator !== 'eq' && operator !== 'gt') throw new Error('Operador no permitido.');
    filters.push({ column, operator, value: raw.slice(dot + 1) });
  }
  return filters;
}

function whereSql(filters: Filter[], values: any[]): string {
  if (!filters.length) return '';
  return ' WHERE ' + filters.map((filter) => {
    values.push(filter.value);
    return `"${filter.column}" ${filter.operator === 'eq' ? '=' : '>'} $${values.length}`;
  }).join(' AND ');
}

export async function restSelect(table: string, query: Record<string, any>): Promise<any[]> {
  const columns = allowedTable(table);
  const requested = typeof query.select === 'string' && query.select !== '*'
    ? query.select.split(',').map((column: string) => allowedColumn(table, column.trim()))
    : Array.from(columns);
  const values: any[] = [];
  let sql = `SELECT ${requested.map((column) => `"${column}"`).join(',')} FROM "${table}"`;
  sql += whereSql(parseFilters(table, query), values);
  if (typeof query.order === 'string') {
    const [column = '', direction = 'asc'] = query.order.split('.');
    allowedColumn(table, column);
    sql += ` ORDER BY "${column}" ${direction === 'desc' ? 'DESC' : 'ASC'}`;
  }
  if (query.limit && Number.isFinite(Number(query.limit))) sql += ` LIMIT ${Math.max(0, Number(query.limit))}`;
  const result = await pool.query(sql, values);
  return result.rows;
}

export async function restInsert(table: string, query: Record<string, any>, payload: any): Promise<any[]> {
  const rows = Array.isArray(payload) ? payload : [payload];
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]).filter((column) => column !== 'id' || rows[0][column] != null);
  columns.forEach((column) => allowedColumn(table, column));
  const values: any[] = [];
  const groups = rows.map((row) => `(${columns.map((column) => {
    values.push(row[column]);
    return `$${values.length}`;
  }).join(',')})`);
  let sql = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES ${groups.join(',')}`;
  const conflict = typeof query.on_conflict === 'string'
    ? query.on_conflict.split(',').map((column: string) => allowedColumn(table, column.trim()))
    : [];
  if (conflict.length) {
    const updates = columns.filter((column) => !conflict.includes(column));
    sql += ` ON CONFLICT (${conflict.map((column) => `"${column}"`).join(',')}) DO UPDATE SET `;
    sql += updates.length
      ? updates.map((column) => `"${column}" = EXCLUDED."${column}"`).join(',')
      : `"${conflict[0]}" = EXCLUDED."${conflict[0]}"`;
  }
  sql += ' RETURNING *';
  return (await pool.query(sql, values)).rows;
}

export async function restUpdate(table: string, query: Record<string, any>, payload: any): Promise<any[]> {
  const columns = Object.keys(payload || {});
  if (!columns.length) return [];
  columns.forEach((column) => allowedColumn(table, column));
  const values: any[] = [];
  const assignments = columns.map((column) => {
    values.push(payload[column]);
    return `"${column}" = $${values.length}`;
  });
  if (allowedTable(table).has('updated_at') && !columns.includes('updated_at')) assignments.push('"updated_at" = NOW()');
  let sql = `UPDATE "${table}" SET ${assignments.join(',')}`;
  sql += whereSql(parseFilters(table, query), values);
  sql += ' RETURNING *';
  return (await pool.query(sql, values)).rows;
}

export async function restDelete(table: string, query: Record<string, any>): Promise<any[]> {
  const values: any[] = [];
  const filters = parseFilters(table, query);
  if (!filters.length) throw new Error('Se requiere filtro para eliminar.');
  let sql = `DELETE FROM "${table}"` + whereSql(filters, values) + ' RETURNING *';
  return (await pool.query(sql, values)).rows;
}

export async function verifyDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}
