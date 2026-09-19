"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInvoiceCorrection = isInvoiceCorrection;
exports.correctionNote = correctionNote;
function isInvoiceCorrection(originalUnits, newUnits, previouslyReturnedUnits) {
    return Number(newUnits) > Number(originalUnits) && Number(previouslyReturnedUnits) > 0;
}
function correctionNote(folio, producto, originalUnits, newUnits) {
    return `Correccion de devolucion: folio ${folio}, producto ${producto}, unidades restauradas de ${originalUnits} a ${newUnits}.`;
}
//# sourceMappingURL=invoice-corrections.js.map