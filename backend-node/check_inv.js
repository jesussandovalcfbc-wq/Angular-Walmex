const fs = require('fs');
if (fs.existsSync('.wa123_cache/data_latest.json')) {
    const data = JSON.parse(fs.readFileSync('.wa123_cache/data_latest.json', 'utf8'));
    console.log('Inventario por Producto:');
    const prods = data.inventario_por_producto || {};
    let count = 0;
    for (const key in prods) {
        if (count >= 5) break;
        console.log('- ' + key + ': ' + prods[key].total);
        count++;
    }
} else {
    console.log('No hay cache');
}
