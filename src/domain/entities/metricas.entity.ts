export interface MetricasAdmin {
  enviosTotales: number;
  enviosActivos: number;
  entregados: number;
  ingresosCop: number;
  conductoresAprobados: number;
  conductoresPendientes: number;
  calificacionPromedio: number;
  porZona: { zona: string; envios: number }[];
  porEstado: { estado: string; envios: number }[];
}
