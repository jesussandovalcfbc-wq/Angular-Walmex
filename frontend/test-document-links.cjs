const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDocumentLink, resolveDocumentUrl } = require('./src/assets/document_links.js');

test('construye un enlace que abre el documento en una pestaña nueva', () => {
  const html = buildDocumentLink(
    'https://contoso.sharepoint.com/sites/walmex/Factura%201.pdf?download=0',
    'Factura',
    'fa-file-invoice',
  );

  assert.match(html, /href="https:\/\/contoso\.sharepoint\.com\/sites\/walmex\/Factura%201\.pdf\?download=0"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /fa-file-invoice/);
});

test('no genera un enlace para una URL vacía', () => {
  assert.equal(buildDocumentLink('', 'Acuse', 'fa-file-circle-check'), '');
});

test('convierte la ruta relativa de SharePoint del consolidado en una URL abrible', () => {
  const relativePath = 'requerimiento vs proyeccion/WALMEX/Gastos/Facturas/factura_1156_1788890294.jpg';
  const expected = 'https://pacificafarms.sharepoint.com/sites/requerimientovsproyeccion/Shared%20Documents/requerimiento%20vs%20proyeccion/WALMEX/Gastos/Facturas/factura_1156_1788890294.jpg';

  assert.equal(resolveDocumentUrl(relativePath), expected);
  assert.match(buildDocumentLink(relativePath, 'Factura', 'fa-file-invoice'), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
