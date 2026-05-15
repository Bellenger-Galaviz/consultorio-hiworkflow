# Despliegue en DigitalOcean

Esta guía asume:

- Dominio: `hiworkflow.mx`
- Subdominio del sistema: `consultorio.hiworkflow.mx`
- Servidor DigitalOcean: `143.110.144.5`
- Base de datos PostgreSQL en el mismo servidor

## 1. En Hostinger DNS

Crea o conserva este registro:

```text
Tipo: A
Nombre: consultorio
Apunta a: 143.110.144.5
TTL: 14400
```

## 2. Entrar al servidor

```bash
ssh root@143.110.144.5
```

## 3. Instalar dependencias del servidor

```bash
apt update
apt install -y git nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
```

## 4. Crear base de datos PostgreSQL

Cambia `PON_UNA_PASSWORD_SEGURA` por una contraseña real.

```bash
sudo -u postgres psql
```

Dentro de PostgreSQL:

```sql
CREATE DATABASE consultorio_db;
CREATE USER consultorio_user WITH ENCRYPTED PASSWORD 'PON_UNA_PASSWORD_SEGURA';
GRANT ALL PRIVILEGES ON DATABASE consultorio_db TO consultorio_user;
\c consultorio_db
GRANT ALL ON SCHEMA public TO consultorio_user;
\q
```

## 5. Clonar el proyecto

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/TU_USUARIO/consultorio-hiworkflow.git
cd consultorio-hiworkflow
```

## 6. Crear `.env` en el servidor

```bash
nano .env
```

Contenido:

```env
DATABASE_URL="postgresql://consultorio_user:PON_UNA_PASSWORD_SEGURA@localhost:5432/consultorio_db?schema=public"
N8N_REMINDER_WEBHOOK_URL="https://n8n.hiworkflow.mx/webhook/recordatorio-cita"
N8N_WEBHOOK_SECRET="CAMBIA_ESTE_SECRETO_POR_UNO_LARGO"
APP_PUBLIC_URL="https://consultorio.hiworkflow.mx"
```

Guarda con `Ctrl+O`, Enter, y sal con `Ctrl+X`.

## 7. Instalar y preparar app

```bash
npm install
npm run prisma:generate
npm run db:deploy
npm run build
```

## 8. Crear primer usuario

Abre el sitio cuando ya esté publicado y crea tu usuario desde la pantalla de registro.

No uses `npm run seed` en producción salvo que quieras cargar datos demo.

## 9. Correr con PM2

```bash
pm2 start npm --name consultorio -- start
pm2 save
pm2 startup
```

Después de `pm2 startup`, copia y ejecuta el comando que PM2 te muestre.

## 10. Configurar Nginx

```bash
nano /etc/nginx/sites-available/consultorio
```

Pega:

```nginx
server {
    server_name consultorio.hiworkflow.mx;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activa el sitio:

```bash
ln -s /etc/nginx/sites-available/consultorio /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 11. Activar HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d consultorio.hiworkflow.mx
```

## 12. Configurar n8n

En el workflow `Ejecutar recordatorios automáticos de citas`, el HTTP Request debe llamar:

```text
POST https://consultorio.hiworkflow.mx/api/reminders/due
Header: x-webhook-secret = CAMBIA_ESTE_SECRETO_POR_UNO_LARGO
```

En el workflow de respuestas entrantes, el HTTP Request debe llamar:

```text
POST https://consultorio.hiworkflow.mx/api/whatsapp/inbound
Header: x-webhook-secret = CAMBIA_ESTE_SECRETO_POR_UNO_LARGO
```

El secreto debe coincidir con `N8N_WEBHOOK_SECRET`.
