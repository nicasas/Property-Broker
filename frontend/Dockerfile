FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

# El puerto lo decide el entorno: en local el compose no define PORT y se usa
# 3000; los proveedores gestionados asignan uno al azar y esperan que el proceso
# escuche ahi.
ENV PORT=3000

# `next build` compila la aplicacion. Sin esto el contenedor arrancaria en modo
# desarrollo, recompilando en cada request: lento y con el doble de memoria.
#
# En local el compose sobreescribe el CMD con `npm run dev`, que ahi si conviene
# —recarga en caliente—, asi que este build solo pesa al desplegar.
RUN npm run build

# `exec` reemplaza al shell por el proceso de Next, asi que SIGTERM le llega
# directo: el contenedor se apaga limpio en vez de esperar el SIGKILL. Sin eso,
# cada reinicio del despliegue tarda diez segundos de mas.
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
