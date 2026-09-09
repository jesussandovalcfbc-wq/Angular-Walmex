(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WalmexInvoiceDevolutions = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function getReturnedUnits(rows, folio, producto) {
    var wantedFolio = normalize(folio);
    var wantedProduct = normalize(producto);

    return (Array.isArray(rows) ? rows : []).reduce(function (total, row) {
      if (normalize(row && row.folio) !== wantedFolio || normalize(row && row.producto) !== wantedProduct || row && (row.modificada === true || row.modificada === 'true')) {
        return total;
      }
      var quantity = Number(row && row.cantidad_devuelta);
      return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
    }, 0);
  }

  function getPendingReturnUnits(originalUnits, newUnits) {
    var original = Number(originalUnits);
    var current = Number(newUnits);
    if (!Number.isFinite(original) || !Number.isFinite(current)) return 0;
    return Math.max(0, original - current);
  }

  return {
    getReturnedUnits: getReturnedUnits,
    getPendingReturnUnits: getPendingReturnUnits,
  };
});
