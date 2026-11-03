import { EventBusPort, EventoTiempoReal } from '../../domain/repositories/platform.ports';

/**
 * Bus de eventos en memoria. Cada pestaña abierta con /api/eventos se suscribe con el id del
 * usuario y recibe sus avisos al instante. Con varias instancias del servidor habría que
 * cambiarlo por Redis (pub/sub) sin tocar el resto de la aplicación.
 */
export class EventBusMemoria implements EventBusPort {
  private readonly suscriptores = new Map<number, Set<(e: EventoTiempoReal) => void>>();

  publicar(id_usuario: number, evento: EventoTiempoReal): void {
    for (const fn of this.suscriptores.get(id_usuario) ?? []) {
      try {
        fn(evento);
      } catch {
        // Una conexión rota no afecta a las demás
      }
    }
  }

  suscribir(id_usuario: number, fn: (e: EventoTiempoReal) => void): () => void {
    const lista = this.suscriptores.get(id_usuario) ?? new Set();
    lista.add(fn);
    this.suscriptores.set(id_usuario, lista);
    return () => {
      lista.delete(fn);
      if (lista.size === 0) this.suscriptores.delete(id_usuario);
    };
  }

  conexiones(id_usuario?: number): number {
    if (id_usuario !== undefined) return this.suscriptores.get(id_usuario)?.size ?? 0;
    let n = 0;
    for (const s of this.suscriptores.values()) n += s.size;
    return n;
  }
}
