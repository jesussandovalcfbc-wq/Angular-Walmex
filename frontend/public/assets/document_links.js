(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WalmexDocumentLinks = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var SHAREPOINT_DOCUMENT_ROOT =
    'https://pacificafarms.sharepoint.com/sites/requerimientovsproyeccion/Shared%20Documents';

  function escapeAttribute(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function encodePath(path) {
    return String(path)
      .split('/')
      .filter(Boolean)
      .map(function (segment) {
        var decoded = segment;
        try {
          decoded = decodeURIComponent(segment);
        } catch (_) {
          // Keep the original segment if it contains malformed escaping.
        }
        return encodeURIComponent(decoded);
      })
      .join('/');
  }

  function buildSharePointFileUrl(relativePath) {
    return SHAREPOINT_DOCUMENT_ROOT + '/' + encodePath(relativePath);
  }

  function resolveDocumentUrl(url) {
    var rawUrl = String(url || '').trim();
    if (!rawUrl) return '';

    var pathWithoutQuery = rawUrl.split(/[?#]/)[0].replace(/^\/+/, '');
    var sharePointMarker = 'requerimiento vs proyeccion/WALMEX/Gastos/';
    var markerIndex = pathWithoutQuery.toLowerCase().indexOf(sharePointMarker.toLowerCase());

    if (markerIndex !== -1) {
      var sharePointPath = pathWithoutQuery.slice(markerIndex);
      if (/^requerimiento vs proyeccion\/WALMEX\/Gastos\/(?:Facturas|Acuses)\/[^/]+$/i.test(sharePointPath)) {
        return buildSharePointFileUrl(sharePointPath);
      }
    }

    if (/^https?:\/\//i.test(rawUrl)) {
      var legacyMatch = rawUrl.match(/\/(Facturas|Acuses)\/([^/?#]+)(?:[?#].*)?$/i);
      if (/supabase\.co/i.test(rawUrl) && legacyMatch) {
        var legacyFileName = legacyMatch[2];
        try {
          legacyFileName = decodeURIComponent(legacyFileName);
        } catch (_) {
          // Keep the original filename if it contains malformed escaping.
        }
        return buildSharePointFileUrl(
          'requerimiento vs proyeccion/WALMEX/Gastos/' + legacyMatch[1] + '/' + legacyFileName,
        );
      }
      return rawUrl;
    }

    return rawUrl.charAt(0) === '/' ? rawUrl : '';
  }

  function buildDocumentLink(url, label, iconClass) {
    var rawUrl = resolveDocumentUrl(url);
    if (!rawUrl) return '';

    var safeLabel = escapeAttribute(label || 'Documento');
    var safeIcon = /^[a-z0-9- ]+$/i.test(String(iconClass || ''))
      ? String(iconClass)
      : 'fa-file';

    return '<a href="' + escapeAttribute(rawUrl) + '" target="_blank" rel="noopener noreferrer"' +
      ' title="Ver ' + safeLabel + '" aria-label="Abrir ' + safeLabel + ' en una pestaña nueva"' +
      ' style="display:inline-flex;align-items:center;justify-content:center;width:25px;height:25px;' +
      'border:1px solid #ccc;border-radius:4px;background:#fff;color:#155eef;text-decoration:none;' +
      'box-shadow:0 2px 4px rgba(0,0,0,0.1);">' +
      '<i class="fa-solid ' + safeIcon + '" aria-hidden="true"></i></a>';
  }

  return {
    buildDocumentLink: buildDocumentLink,
    resolveDocumentUrl: resolveDocumentUrl,
  };
});
