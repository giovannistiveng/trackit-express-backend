export interface MetricasAdmin {
  enviosTotales: number;
  enviosActivos: number;
  entregados: number;
  cancelados: number;
  ingresosCop: number;
  conductoresAprobados: number;
  conductoresPendientes: number;
  calificacionPromedio: number;
  porZona: { zona: string; envios: number }[];
  porEstado: { estado: string; envios: number }[];
}

/** Cifras que se muestran en el sitio público. */
export interface EstadisticasPublicas {
  enviosEntregados: number;
  conductoresActivos: number;
  zonasCubiertas: number;
  calificacionPromedio: number;
}
