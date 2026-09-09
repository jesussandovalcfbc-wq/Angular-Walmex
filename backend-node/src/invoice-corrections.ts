export function isInvoiceCorrection(
  originalUnits: number,
  newUnits: number,
  previouslyReturnedUnits: number
): boolean {
  return Number(newUnits) > Number(originalUnits) && Number(previouslyReturnedUnits) > 0;
}

export function correctionNote(
  folio: string,
  producto: string,
  originalUnits: number,
  newUnits: number
): string {
  return `Correccion de devolucion: folio ${folio}, producto ${producto}, unidades restauradas de ${originalUnits} a ${newUnits}.`;
}
