import { Component, AfterViewInit, ViewEncapsulation, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  encapsulation: ViewEncapsulation.None
})
export class AppComponent implements AfterViewInit, OnDestroy {
  title = 'frontend';

  selectedFile: File | null = null;
  uploadStatus: string = '';
  isChatOpen: boolean = false;
  isResumenTab: boolean = false;

  // ── Clones fijos eliminados a favor de CSS nativo ──────────────

  constructor(private http: HttpClient) {}

  ngAfterViewInit() {
    const loaderTxt = document.querySelector('.ld-txt');
    if (loaderTxt) loaderTxt.innerHTML = 'Conectando...';

    const API_URL = 'https://walmex-api.onrender.com/api';

    forkJoin({
      dashboard:    this.http.get(`${API_URL}/dashboard-data`),
      supabase:     this.http.get(`${API_URL}/supabase-data`),
      devoluciones: this.http.get(`${API_URL}/devoluciones`)
    }).subscribe({
      next: (responses: any) => {
        if (loaderTxt) loaderTxt.innerHTML = 'Conectando...';

        const SUPABASE_URL = 'https://fzrhklskjjuscckfvvfa.supabase.co';
        const SUPABASE_KEY = 'sb_publishable_63XnbBC_gPjZwxqjPnOBOg_4Qnxz5y9';

        if (typeof (window as any).initWalmexJS === 'function') {
          (window as any).initWalmexJS(
            responses.dashboard,
            responses.supabase,
            responses.devoluciones,
            SUPABASE_URL,
            SUPABASE_KEY
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
    // Limpieza si es necesaria
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
      this.http.post('https://walmex-api.onrender.com/api/upload-excel', {
        content: base64Content,
        fileName: this.selectedFile?.name
      }).subscribe({
        next: (res: any) => { this.uploadStatus = `✓ Éxito: ${res.message}`; setTimeout(() => window.location.reload(), 1500); },
        error: (err) => { this.uploadStatus = `✕ Error: ${err.error?.error || err.message || 'Error al importar el archivo'}`; }
      });
    };
  }
}
