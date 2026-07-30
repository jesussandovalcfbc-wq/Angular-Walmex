const fs = require('fs');
if (fs.existsSync('.wa123_cache/data_latest.json')) {
    const data = JSON.parse(fs.readFileSync('.wa123_cache/data_latest.json', 'utf8'));
    console.log('Fechas en detalle_inventario:', data.detalle_inventario.fechas);
    console.log('Tiendas en detalle_inventario:', Object.keys(data.detalle_inventario.data || {}).length);
} else {
    console.log('No hay cache');
}
