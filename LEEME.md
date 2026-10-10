# CRM CCTV · LV Seguridad Moreno (versión Netlify)

Sitio ya creado en Netlify: `lvseguridad-crm-cctv` (id: 5a5f6945-34ab-4cc0-b5b6-6c47f4895acd)
Dirección: http://lvseguridad-crm-cctv.netlify.app

## Publicarlo desde tu computadora

Necesitás Node.js. En una terminal, dentro de esta carpeta:

    npm install -g netlify-cli
    netlify login
    netlify deploy --prod --site 5a5f6945-34ab-4cc0-b5b6-6c47f4895acd

Netlify instala solo lo necesario (`@netlify/blobs`) y publica la web y el servidor (carpeta `netlify/functions`).

## Primer uso

1. Abrí la dirección y creá el **administrador** (el primero que entra queda como admin: hacelo vos antes de compartir el link).
2. Configuración > Instaladores: creá a cada instalador con usuario y contraseña.
3. Cargá trabajos y asignalos.

## Mantenimientos anuales

- Cuando un trabajo pasa a **Instalado** (lo marque el instalador o el administrador), el servidor crea solo un mantenimiento para **1 año después**.
- Para clientes anteriores: Mantenimientos > Nuevo mantenimiento.
- Estados: **Vencido** (rojo), **Próximo** (vence en 30 días o menos, amarillo), **Al día** (verde).
- Al abrir la app, un aviso amarillo y el número en la pestaña muestran cuántos hay para atender.
- Desde cada mantenimiento: Recordar por WhatsApp, Llamar, Agregar al calendario (Google Calendar) y Registrar mantenimiento hecho (guarda la visita y programa el siguiente a 1 año).
- El instalador asignado ve solo sus mantenimientos y puede registrarlos como hechos.
- Los avisos aparecen cuando alguien abre la app; no se mandan solos por WhatsApp ni email.

## Instalar como app / APK

Con el sitio publicado, abrilo en Chrome del celular > "Instalar app". Para el APK: https://www.pwabuilder.com con tu dirección.
