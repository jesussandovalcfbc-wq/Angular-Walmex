import * as XLSX from 'xlsx';

export type ExcelUploadCell = string | number | boolean;

const COLUMN_COUNT = 45;
const SOURCE_START_ROW = 25;

function cleanExcelValue(value: unknown): ExcelUploadCell {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

function hasExcelSignature(bytes: Uint8Array): boolean {
  const isZipWorkbook = bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isLegacyWorkbook = bytes.length >= oleSignature.length
    && oleSignature.every((value, index) => bytes[index] === value);
  return isZipWorkbook || isLegacyWorkbook;
}

export function extractExcelUploadRows(arrayBuffer: ArrayBuffer): ExcelUploadCell[][] {
  const bytes = new Uint8Array(arrayBuffer);
  if (!hasExcelSignature(bytes)) {
    throw new Error('El archivo no es un Excel .xlsx, .xlsm o .xls válido.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      dense: true,
    });
  } catch {
    throw new Error('El archivo no es un Excel válido o está dañado.');
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('El archivo no contiene hojas.');

  const sourceSheet = workbook.Sheets[firstSheetName];
  if (!sourceSheet) throw new Error('No se pudo leer la primera hoja del archivo.');

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sourceSheet, {
    header: 1,
    range: SOURCE_START_ROW,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const rows: ExcelUploadCell[][] = [];
  for (const rawRow of rawRows) {
    const sourceValues = Array.from(
      { length: COLUMN_COUNT },
      (_, index) => rawRow[index] ?? null,
    );
    if (sourceValues.every(value => value == null)) break;
    rows.push(sourceValues.map(cleanExcelValue));
  }

  if (rows.length < 2) {
    throw new Error('No se encontraron datos desde la fila 26.');
  }
  if (rows.length > 100_000) {
    throw new Error('El archivo supera el máximo permitido de 100,000 filas.');
  }

  return rows;
}
