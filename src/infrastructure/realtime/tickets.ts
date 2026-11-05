import { randomBytes } from 'crypto';
import { Actor } from '../../domain/entities/actor.entity';

/** Vigencia de un ticket para abrir el canal de eventos. */
export const VIGENCIA_TICKET_MS = 60_000;

/**
 * EventSource no permite enviar la cabecera Authorization. En lugar de poner el JWT en la URL
 * (quedaría en logs e historiales), el cliente pide un ticket de un solo uso que vence en 60 s.
 */
export class TicketsEventos {
  private readonly tickets = new Map<string, { actor: Actor; vence: number }>();

  constructor(private readonly ahora: () => number = Date.now) {}

  emitir(actor: Actor): string {
    this.limpiar();
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { actor, vence: this.ahora() + VIGENCIA_TICKET_MS });
    return ticket;
  }

  canjear(ticket: unknown): Actor | null {
    if (typeof ticket !== 'string') return null;
    const t = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return t && t.vence > this.ahora() ? t.actor : null;
  }

  private limpiar(): void {
    const ahora = this.ahora();
    for (const [k, v] of this.tickets) if (v.vence <= ahora) this.tickets.delete(k);
  }
}
