FROM node:22-alpine

WORKDIR /app

# Las dependencias se instalan en una capa propia: cambiar código de la app no
# invalida el caché de npm install.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

# Modo desarrollo. El compose monta el código desde el host para hot reload.
CMD ["npm", "run", "dev"]
