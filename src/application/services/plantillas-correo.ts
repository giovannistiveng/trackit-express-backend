import { CorreoSaliente } from '../../domain/ports/platform.ports';

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Correo con la marca de TrackIt: encabezado naranja, botón y enlace de respaldo. */
function plantilla(o: { para: string; asunto: string; titulo: string; parrafos: string[]; boton?: { texto: string; url: string }; pie: string }): CorreoSaliente {
  const cuerpo = o.parrafos.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapar(p)}</p>`).join('');
  const boton = o.boton
    ? `<p style="margin:24px 0"><a href="${escapar(o.boton.url)}" style="background:#c2410c;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;display:inline-block">${escapar(o.boton.texto)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#6b625c">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escapar(o.boton.url)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f6f3ef;font-family:Arial,Helvetica,sans-serif;color:#1f1a17">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#c2410c;color:#fff;padding:20px 28px;font-size:20px;font-weight:800">TrackIt <span style="color:#f5c518">Express</span></td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 16px;font-size:22px">${escapar(o.titulo)}</h1>${cuerpo}${boton}
    <p style="margin:24px 0 0;font-size:12px;color:#8a817c">${escapar(o.pie)}</p>
  </td></tr></table>
  <p style="font-size:12px;color:#8a817c">TrackIt Express · Fusagasugá, Cundinamarca</p>
  </td></tr></table></body></html>`;
  const texto = [o.titulo, '', ...o.parrafos, '', o.boton ? `${o.boton.texto}: ${o.boton.url}` : '', '', o.pie].join('\n');
  return { para: o.para, asunto: o.asunto, html, texto };
}

export function correoVerificacion(para: string, nombre: string, url: string): CorreoSaliente {
  return plantilla({
    para,
    asunto: 'Confirma tu correo en TrackIt Express',
    titulo: `¡Hola, ${nombre.split(' ')[0]}!`,
    parrafos: ['Gracias por registrarte en TrackIt Express.', 'Confirma tu correo para proteger tu cuenta y poder recuperarla si olvidas la contraseña.'],
    boton: { texto: 'Confirmar mi correo', url },
    pie: 'El enlace vence en 48 horas. Si no creaste esta cuenta, ignora este mensaje.',
  });
}

export function correoRecuperacion(para: string, nombre: string, url: string): CorreoSaliente {
  return plantilla({
    para,
    asunto: 'Restablece tu contraseña de TrackIt Express',
    titulo: 'Restablecer contraseña',
    parrafos: [`Hola, ${nombre.split(' ')[0]}. Recibimos una solicitud para cambiar la contraseña de tu cuenta.`, 'Usa el botón para elegir una contraseña nueva.'],
    boton: { texto: 'Elegir contraseña nueva', url },
    pie: 'El enlace vence en 1 hora y solo se puede usar una vez. Si no pediste el cambio, ignora este correo: tu contraseña sigue igual.',
  });
}

export function correoContrasenaCambiada(para: string, nombre: string): CorreoSaliente {
  return plantilla({
    para,
    asunto: 'Tu contraseña de TrackIt Express cambió',
    titulo: 'Contraseña actualizada',
    parrafos: [`Hola, ${nombre.split(' ')[0]}. La contraseña de tu cuenta se cambió correctamente.`],
    pie: 'Si no fuiste tú, restablece tu contraseña de inmediato y escríbenos a soporte@trackit.com.co.',
  });
}
