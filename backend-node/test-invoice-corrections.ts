import test from 'node:test';
import assert from 'node:assert/strict';

import { isInvoiceCorrection, correctionNote } from './src/invoice-corrections';

test('detecta una correccion cuando se restauran unidades despues de una devolucion', () => {
  assert.equal(isInvoiceCorrection(0, 16, 15), true);
  assert.equal(isInvoiceCorrection(10, 10, 2), false);
  assert.equal(isInvoiceCorrection(10, 8, 2), false);
  assert.equal(isInvoiceCorrection(0, 16, 0), false);
});

test('genera una nota auditable para la correccion', () => {
  assert.equal(
    correctionNote('811', 'BOUQUET MIXTO 12 T', 0, 16),
    'Correccion de devolucion: folio 811, producto BOUQUET MIXTO 12 T, unidades restauradas de 0 a 16.'
  );
});
