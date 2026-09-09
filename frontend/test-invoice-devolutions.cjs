const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getReturnedUnits,
  getPendingReturnUnits,
} = require('./src/assets/invoice_devolutions.js');

test('suma las devoluciones previas del mismo folio y producto', () => {
  const rows = [
    { folio: '1042', producto: 'BOUQUET ROSAS 6 T', cantidad_devuelta: 2 },
    { folio: '1042', producto: 'BOUQUET ROSAS 6 T', cantidad_devuelta: 1 },
    { folio: '1042', producto: 'BOUQUET ROSAS 6 T', cantidad_devuelta: 7, modificada: true },
    { folio: '1042', producto: 'BOUQUET MIXTO 12 T', cantidad_devuelta: 5 },
    { folio: '9999', producto: 'BOUQUET ROSAS 6 T', cantidad_devuelta: 8 },
  ];

  assert.equal(getReturnedUnits(rows, '1042', 'BOUQUET ROSAS 6 T'), 3);
});

test('calcula la devolución que se generaría al reducir unidades', () => {
  assert.equal(getPendingReturnUnits(6, 4), 2);
  assert.equal(getPendingReturnUnits(6, 6), 0);
  assert.equal(getPendingReturnUnits(6, 8), 0);
});

test('el modal muestra una sola columna de devolución registrada', () => {
  const templatePath = path.join(__dirname, 'src', 'app', 'app.component.html');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.equal((template.match(/>Devolución<\/th>/g) || []).length, 1);
  assert.equal(template.includes('>Devuelto</th>'), false);
  assert.equal(template.includes('>A devolver</th>'), false);
  assert.equal((template.match(/item\.returnedUnits/g) || []).length, 1);
  assert.equal(template.includes('invoicePendingReturn(item)'), false);
});

test('muestra el boton de correccion cuando la factura tiene una devolucion', () => {
  const templatePath = path.join(__dirname, 'src', 'app', 'app.component.html');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.equal(template.includes('*ngIf="invoiceHasReturn()"'), true);
  assert.equal(template.includes('[disabled]="invoiceSaving || !invoiceHasCorrection()"'), true);
  assert.equal(template.includes('Aplicar corrección'), true);
});
