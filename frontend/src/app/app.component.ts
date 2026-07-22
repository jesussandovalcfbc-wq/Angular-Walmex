import { Component, AfterViewInit, ViewEncapsulation, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, FormsModule],
  templateUrl: './app.component.html',
  encapsulation: ViewEncapsulation.None
})
export class AppComponent implements AfterViewInit, OnDestroy {
  title = 'frontend';

  private readonly apiUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:8000/api'
    : 'https://walmex-api.onrender.com/api';

  selectedFile: File | null = null;
  uploadStatus: string = '';
  isChatOpen: boolean = false;
  isResumenTab: boolean = false;
  invoiceEditorOpen = false;
  invoiceSaving = false;
  invoiceActionMessage = '';
  editingInvoice: any = null;
  private dashboardData: any = null;
  private facturasData: any[] = [];
  private devolucionesData: any[] = [];

  // ── Clones fijos eliminados a favor de CSS nativo ──────────────

  constructor(private http: HttpClient) {}

  ngAfterViewInit() {
    const loaderTxt = document.querySelector('.ld-txt');
    if (loaderTxt) loaderTxt.innerHTML = 'Conectando...';

    forkJoin({
      dashboard:    this.http.get(`${this.apiUrl}/dashboard-data`),
      facturas:     this.http.get(`${this.apiUrl}/facturas-data`),
      devoluciones: this.http.get(`${this.apiUrl}/devoluciones`)
    }).subscribe({
      next: (responses: any) => {
        if (loaderTxt) loaderTxt.innerHTML = 'Conectando...';

        // La logica heredada conserva el mismo contrato REST, pero ahora apunta
        // al backend local que protege la conexion privada de Neon.
        const DATABASE_REST_URL = `${this.apiUrl}/db`;
        const DATABASE_CLIENT_TOKEN = 'local-neon';

        this.dashboardData = responses.dashboard;
        this.facturasData = Array.isArray(responses.facturas) ? responses.facturas : [];
        this.devolucionesData = Array.isArray(responses.devoluciones) ? responses.devoluciones : [];
        if (typeof (window as any).initWalmexJS === 'function') {
          (window as any).initWalmexJS(
            responses.dashboard,
            responses.facturas,
            responses.devoluciones,
            DATABASE_REST_URL,
            DATABASE_CLIENT_TOKEN
          );
        } else {
          console.error('initWalmexJS not found.');
          if (loaderTxt) loaderTxt.innerHTML = 'Error: initWalmexJS no encontrado en extracted_logic.js';
        }
      },
      error: (err) => {
        console.error('Failed to load data from backend API:', err);
        if (loaderTxt) loaderTxt.innerHTML = 'Error API: ' + (err.message || 'Desconocido');
      }
    });
  }

  ngOnInit() {
    (window as any).openInvoiceEditor = (folio: string) => this.openInvoiceEditor(folio);
    (window as any).cancelInvoice = (folio: string) => this.cancelInvoice(folio);
    (window as any).persistDevolucionVerification = (id: number, verified: boolean) =>
      this.persistDevolucionVerification(id, verified);
    (window as any).persistAllDevolucionesVerification = (ids: number[], verified: boolean) =>
      this.persistAllDevolucionesVerification(ids, verified);
    // ── CSS variable para la altura del global header ─────────────────
    setInterval(() => {
      if ((window as any).state) {
        this.isResumenTab = (window as any).state.view === 'resumen';
      }
      const gh = document.querySelector('.global-sticky-header');
      if (gh) {
        document.documentElement.style.setProperty(
          '--global-header-height', `${gh.getBoundingClientRect().height}px`
        );
      }
    }, 300);


    // Esperar a que la vista Resumen cargue
    this.waitForResumenAndInit();
    // Actualizar las alturas iniciales y cuando se cambie el tamaño
    setTimeout(() => this.updateStickyHeights(), 500);
    window.addEventListener('resize', () => this.updateStickyHeights());
  }

  ngAfterViewChecked() {
    this.updateStickyHeights();
  }

  private updateStickyHeights() {
    const globalHd = document.querySelector('.global-sticky-header');
    if (globalHd) {
      const h = globalHd.getBoundingClientRect().height;
      if (h > 0) document.body.style.setProperty('--global-header-height', h + 'px');
    }
    const boxHdr = document.querySelector('#resumenTitle');
    if (boxHdr) {
      const h = boxHdr.getBoundingClientRect().height;
      if (h > 0) document.body.style.setProperty('--box-hdr-height', h + 'px');
    }
  }

  ngOnDestroy() {
    delete (window as any).openInvoiceEditor;
    delete (window as any).cancelInvoice;
    delete (window as any).persistDevolucionVerification;
    delete (window as any).persistAllDevolucionesVerification;
  }

  // ── Espera a que exista el box-hdr del Resumen ───────────────────────
  private waitForResumenAndInit() {
    // Clones JS desactivados a favor de CSS nativo flex-layout
  }



  // ── Chat y archivo ────────────────────────────────────────────────────
  toggleChat() { this.isChatOpen = !this.isChatOpen; }

  onFileSelected(event: any) { this.selectedFile = event.target.files[0]; }

  uploadFile() {
    if (!this.selectedFile) { this.uploadStatus = '⚠️ Selecciona un archivo Excel primero'; return; }
    this.uploadStatus = '🔄 Subiendo datos a SharePoint...';
    const reader = new FileReader();
    reader.readAsDataURL(this.selectedFile);
    reader.onload = () => {
      const base64Content = (reader.result as string).split(',')[1];
      this.http.post(`${this.apiUrl}/upload-excel`, {
        content: base64Content,
        fileName: this.selectedFile?.name
      }).subscribe({
        next: (res: any) => { this.uploadStatus = `✓ Éxito: ${res.message}`; setTimeout(() => window.location.reload(), 1500); },
        error: (err) => { this.uploadStatus = `✕ Error: ${err.error?.error || err.message || 'Error al importar el archivo'}`; }
      });
    };
  }

  onConsolidadoEstadoChange(event: Event, peerSelectId: string) {
    const select = event.target as HTMLSelectElement;
    const peerSelect = document.getElementById(peerSelectId) as HTMLSelectElement | null;

    if (peerSelect) peerSelect.value = select.value;
    if (typeof (window as any).renderChoferes === 'function') {
      (window as any).renderChoferes();
    }
  }

  openInvoiceEditor(folio: string) {
    const rows = this.facturasData.filter((row) => String(row.folio ?? '') === String(folio));
    if (!rows.length) {
      alert('La factura ya no esta disponible. Actualiza la pagina e intenta nuevamente.');
      return;
    }
    this.editingInvoice = {
      folio: String(folio),
      tienda: rows[0]?.tienda || '',
      reason: '',
      items: rows.map((row) => ({
        id: Number(row.id),
        producto: row.producto || '',
        precio: Number(row.precio_unidad || 0),
        originalUnits: Number(row.unidades || 0),
        unidades: Number(row.unidades || 0)
      }))
    };
    this.invoiceActionMessage = '';
    this.invoiceEditorOpen = true;
  }

  closeInvoiceEditor() {
    if (this.invoiceSaving) return;
    this.invoiceEditorOpen = false;
    this.editingInvoice = null;
    this.invoiceActionMessage = '';
  }

  invoiceHasReduction(): boolean {
    return !!this.editingInvoice?.items?.some(
      (item: any) => Number(item.unidades) < Number(item.originalUnits)
    );
  }

  invoiceTotal(): number {
    return (this.editingInvoice?.items || []).reduce(
      (total: number, item: any) => total + Number(item.unidades || 0) * Number(item.precio || 0), 0
    );
  }

  saveInvoiceChanges() {
    if (!this.editingInvoice || this.invoiceSaving) return;
    const invalid = this.editingInvoice.items.some(
      (item: any) => !Number.isInteger(Number(item.unidades)) || Number(item.unidades) < 0
    );
    if (invalid) {
      this.invoiceActionMessage = 'Las unidades deben ser numeros enteros iguales o mayores a cero.';
      return;
    }
    if (this.invoiceHasReduction() && !String(this.editingInvoice.reason || '').trim()) {
      this.invoiceActionMessage = 'Escribe el motivo de la reduccion para enviarla a Devoluciones.';
      return;
    }

    this.invoiceSaving = true;
    this.invoiceActionMessage = '';
    const folio = encodeURIComponent(this.editingInvoice.folio);
    this.http.patch(`${this.apiUrl}/facturas/${folio}`, {
      items: this.editingInvoice.items.map((item: any) => ({ id: item.id, unidades: Number(item.unidades) })),
      reason: String(this.editingInvoice.reason || '').trim()
    }).subscribe({
      next: () => this.refreshInvoiceData('Factura modificada correctamente.'),
      error: (err) => {
        this.invoiceSaving = false;
        this.invoiceActionMessage = err.error?.error || err.message || 'No se pudo modificar la factura.';
      }
    });
  }

  cancelInvoice(folio: string) {
    const rows = this.facturasData.filter((row) => String(row.folio ?? '') === String(folio));
    if (!rows.length) {
      alert('La factura ya no esta disponible.');
      return;
    }
    const units = rows.reduce((total, row) => total + Number(row.unidades || 0), 0);
    const accepted = confirm(
      `¿Cancelar la factura ${folio} completa?\n\n` +
      `${rows.length} producto(s) y ${units} unidad(es) se moveran a Devoluciones.\n` +
      'Esta accion no se puede deshacer desde esta pantalla.'
    );
    if (!accepted) return;

    this.invoiceSaving = true;
    this.http.post(`${this.apiUrl}/facturas/${encodeURIComponent(folio)}/cancelar`, {}).subscribe({
      next: () => this.refreshInvoiceData(`Factura ${folio} cancelada y enviada a Devoluciones.`),
      error: (err) => {
        this.invoiceSaving = false;
        alert(err.error?.error || err.message || 'No se pudo cancelar la factura.');
      }
    });
  }

  private refreshInvoiceData(message: string) {
    forkJoin({
      facturas: this.http.get(`${this.apiUrl}/facturas-data`),
      devoluciones: this.http.get(`${this.apiUrl}/devoluciones`)
    }).subscribe({
      next: (responses: any) => {
        this.facturasData = Array.isArray(responses.facturas) ? responses.facturas : [];
        this.devolucionesData = Array.isArray(responses.devoluciones) ? responses.devoluciones : [];
        if (typeof (window as any).updateChoferesData === 'function') {
          (window as any).updateChoferesData(this.facturasData, this.devolucionesData);
        }
        this.invoiceSaving = false;
        this.invoiceEditorOpen = false;
        this.editingInvoice = null;
        alert(message);
      },
      error: (err) => {
        this.invoiceSaving = false;
        this.invoiceActionMessage = 'El cambio se guardo, pero no se pudo refrescar la tabla. Recarga la pagina.';
        console.error(err);
      }
    });
  }

  private persistDevolucionVerification(id: number, verified: boolean) {
    this.http.patch(`${this.apiUrl}/devoluciones/${id}/verificacion`, {
      verificado: verified
    }).subscribe({
      next: (response: any) => {
        const updated = response?.row;
        if (updated) {
          this.devolucionesData = this.devolucionesData.map((row) =>
            Number(row.id) === Number(updated.id) ? updated : row
          );
          this.renderUpdatedDevoluciones();
        }
      },
      error: (err) => {
        alert(err.error?.error || err.message || 'No se pudo guardar la verificacion.');
      }
    });
  }

  private persistAllDevolucionesVerification(ids: number[], verified: boolean) {
    this.http.patch(`${this.apiUrl}/devoluciones/verificacion`, {
      ids,
      verificado: verified
    }).subscribe({
      next: (response: any) => {
        const updatedRows = Array.isArray(response?.rows) ? response.rows : [];
        const updatedById = new Map(updatedRows.map((row: any) => [Number(row.id), row]));
        this.devolucionesData = this.devolucionesData.map((row) =>
          updatedById.get(Number(row.id)) || row
        );
        this.renderUpdatedDevoluciones();
      },
      error: (err) => {
        alert(err.error?.error || err.message || 'No se pudieron guardar las verificaciones.');
      }
    });
  }

  private renderUpdatedDevoluciones() {
    if (typeof (window as any).updateChoferesData === 'function') {
      (window as any).updateChoferesData(this.facturasData, this.devolucionesData);
    }
  }
}
