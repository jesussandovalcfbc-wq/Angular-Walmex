import { Pool } from 'pg';
export declare const pool: Pool;
export declare function getFacturasData(): Promise<any[]>;
export declare function getDevolucionesData(): Promise<any[]>;
export declare function setDevolucionVerification(id: number, verified: boolean): Promise<any>;
export declare function setDevolucionesVerification(ids: number[], verified: boolean): Promise<any[]>;
type InvoiceItemUpdate = {
    id: number;
    unidades: number;
};
export declare function updateInvoice(folio: string, items: InvoiceItemUpdate[], reason: string): Promise<any[]>;
export declare function cancelInvoice(folio: string): Promise<number>;
export declare function restSelect(table: string, query: Record<string, any>): Promise<any[]>;
export declare function restInsert(table: string, query: Record<string, any>, payload: any): Promise<any[]>;
export declare function restUpdate(table: string, query: Record<string, any>, payload: any): Promise<any[]>;
export declare function restDelete(table: string, query: Record<string, any>): Promise<any[]>;
export declare function verifyDatabase(): Promise<void>;
export {};
//# sourceMappingURL=database.d.ts.map