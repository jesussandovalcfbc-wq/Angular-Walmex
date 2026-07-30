export interface SharePointConfig {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    siteUrl: string;
    filePath: string;
}
export declare function getSharepointCfg(): SharePointConfig;
export declare function getSharepointAccessToken(cfg: SharePointConfig): Promise<string>;
export declare function getSharepointSiteId(cfg: SharePointConfig): Promise<string>;
export declare function getSharepointFileMeta(): Promise<any>;
export declare function downloadExcelSharepoint(): Promise<{
    localPath: string;
    cacheKey: string;
}>;
export declare function downloadViaGraphSharedLink(sharedLink: string): Promise<Buffer>;
export declare function extractSharepointRows(fileBuffer: Buffer): Array<Array<string | number | boolean>>;
/**
 * Replica la importación del proyecto Streamlit: lee la primera hoja desde la
 * fila 26, conserva las columnas A:AS y reemplaza el contenido de la hoja Data
 * del libro configurado en SharePoint mediante una sesión persistente de Excel.
 */
export declare function uploadExcelToSharepoint(fileBuffer: Buffer): Promise<number>;
//# sourceMappingURL=sharepoint.d.ts.map